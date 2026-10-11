"""FastAPI application (docs/API.md).

``create_app()`` builds the service: sqlite-backed job queue with one in-process worker, local
filesystem storage, no accounts. Run with ``make api-dev`` (``uvicorn --factory``).
"""

from __future__ import annotations

import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from synesthesia import PIPELINE_VERSION
from synesthesia.api.jobs import JobManager
from synesthesia.api.storage import Storage, valid_job_id, valid_song_id
from synesthesia.config import Config, load_config
from synesthesia.errors import ErrorCode, SynError
from synesthesia.ingest import decode_file, normalize, song_id
from synesthesia.metadata import SongMetadata

_BYTES_PER_MB = 1024 * 1024
_SECONDS_PER_HOUR = 3600.0
_MIN_RENDER_PX = 128
_MAX_RENDER_PX = 4096
_HASH_CHARS = 12
_HTTP_FOR_CODE = {
    ErrorCode.E_FORMAT: 400,
    ErrorCode.E_DECODE: 400,
    ErrorCode.E_TOO_SHORT: 400,
    ErrorCode.E_TOO_LONG: 400,
    ErrorCode.E_SILENT: 400,
    ErrorCode.E_SIZE: 413,
    ErrorCode.E_INTERNAL: 500,
}
_BINARY_FILES = {"static.bin", "maps.bin", "live.bin", "proto.bin"}


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def _syn_error(exc: SynError) -> JSONResponse:
    return _error(_HTTP_FOR_CODE[exc.code], exc.code.value, exc.user_message)


class TokenBucket:
    """Per-key token bucket: ``capacity`` requests per hour, refilled continuously."""

    def __init__(self, capacity: int) -> None:
        self._capacity = float(capacity)
        self._state: dict[str, tuple[float, float]] = {}

    def allow(self, key: str, now: float | None = None) -> bool:
        t = time.monotonic() if now is None else now
        tokens, last = self._state.get(key, (self._capacity, t))
        tokens = min(self._capacity, tokens + (t - last) * self._capacity / _SECONDS_PER_HOUR)
        if tokens < 1.0:
            self._state[key] = (tokens, t)
            return False
        self._state[key] = (tokens - 1.0, t)
        return True


def create_app(config: Config | None = None, storage_root: Path | None = None) -> FastAPI:
    """Build the API application.

    Args:
        config: resolved configuration; defaults to ``load_config()``.
        storage_root: storage directory; defaults to ``config.api.storage_dir``.
    """
    cfg = config or load_config()
    storage = Storage(storage_root or Path(cfg.api.storage_dir), cfg.hash()[:_HASH_CHARS])
    jobs = JobManager(storage, cfg)
    bucket = TokenBucket(cfg.api.rate_limit_per_hour)
    max_bytes = cfg.ingest.max_file_mb * _BYTES_PER_MB

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        storage.purge_stale_uploads()
        storage.cleanup(cfg.api.retention_days)
        jobs.start()
        yield
        jobs.stop()

    app = FastAPI(title="SYNESTHESIA", version=PIPELINE_VERSION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.api.cors_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )
    api = APIRouter(prefix="/api")

    @api.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "pipeline_version": PIPELINE_VERSION}

    @api.post("/analyze", response_model=None)
    async def analyze(
        request: Request,
        file: UploadFile = File(...),  # noqa: B008
        title: str | None = Form(None),  # noqa: B008
        artist: str | None = Form(None),  # noqa: B008
        genre: str | None = Form(None),  # noqa: B008
        release_year: str | None = Form(None),  # noqa: B008
        source: str | None = Form(None),  # noqa: B008
        chart_peak: str | None = Form(None),  # noqa: B008
        chart_weeks: str | None = Form(None),  # noqa: B008
    ) -> Response:
        try:
            metadata = SongMetadata.parse(
                {
                    "title": title,
                    "artist": artist,
                    "genre": genre,
                    "release_year": release_year,
                    "source": source,
                    "chart_peak": chart_peak,
                    "chart_weeks": chart_weeks,
                },
                cfg,
            )
        except ValueError as exc:
            return _error(400, "E_BAD_REQUEST", str(exc))
        client = request.client.host if request.client else "unknown"
        if not bucket.allow(client):
            return _error(429, "E_RATE_LIMIT", "Too many analyses. Please try again later.")
        declared = request.headers.get("content-length")
        if (
            declared is not None
            and declared.isdigit()
            and int(declared) > max_bytes + _BYTES_PER_MB
        ):
            return _syn_error(SynError(ErrorCode.E_SIZE))
        suffix = re.sub(r"[^a-z0-9]", "", Path(file.filename or "").suffix.lower())[:8] or "bin"
        job_id = JobManager.new_job_id()
        path = storage.upload_path(job_id, suffix)
        written = 0
        chunk = cfg.api.upload_chunk_kb * 1024
        with path.open("wb") as out:
            while True:
                block = await file.read(chunk)
                if not block:
                    break
                written += len(block)
                if written > max_bytes:
                    out.close()
                    storage.delete_upload(path)
                    return _syn_error(SynError(ErrorCode.E_SIZE))
                out.write(block)

        def _ingest() -> str:
            y, _ = normalize(decode_file(path, cfg), cfg)
            return song_id(y)

        try:
            sid = await run_in_threadpool(_ingest)
        except SynError as exc:
            storage.delete_upload(path)
            return _syn_error(exc)
        if storage.has_song(sid):
            if not cfg.api.keep_audio:
                storage.delete_upload(path)
            return JSONResponse({"job_id": None, "song_id": sid}, status_code=200)
        jobs.submit(job_id, path, metadata)
        return JSONResponse({"job_id": job_id, "song_id": None}, status_code=202)

    @api.get("/jobs/{job_id}", response_model=None)
    def job_status(job_id: str) -> Response:
        view = jobs.get(job_id) if valid_job_id(job_id) else None
        if view is None:
            return _error(404, "E_NOT_FOUND", "Unknown job.")
        return JSONResponse(view.as_dict())

    @api.delete("/jobs/{job_id}", response_model=None)
    def cancel_job(job_id: str) -> Response:
        if not valid_job_id(job_id) or not jobs.cancel(job_id):
            return _error(404, "E_NOT_FOUND", "Unknown job.")
        return Response(status_code=204)

    @api.get("/songs", response_model=None)
    def list_songs(
        limit: int | None = None,
        offset: int = 0,
        q: str | None = None,
        sort: str = "recent",
        include: str | None = None,
    ) -> Response:
        size = min(cfg.api.page_size_default, cfg.api.page_size_max) if limit is None else limit
        if not 1 <= size <= cfg.api.page_size_max or offset < 0 or sort not in ("recent", "title"):
            return _error(400, "E_BAD_REQUEST", "Invalid paging parameters.")
        items, total = storage.page(limit=size, offset=offset, query=q, sort=sort)
        with_fp = include == "fingerprint"
        return JSONResponse(
            [m.as_dict(include_fingerprint=with_fp) for m in items],
            headers={"X-Total-Count": str(total)},
        )

    def _song_file(song: str, name: str) -> Path | None:
        if not valid_song_id(song):
            return None
        path = storage.song_dir(song) / name
        return path if path.is_file() else None

    @api.get("/songs/{song}/signature.json", response_model=None)
    def signature(song: str) -> Response:
        path = _song_file(song, "signature.json")
        if path is None:
            return _error(404, "E_NOT_FOUND", "Unknown song.")
        return FileResponse(path, media_type="application/json")

    @api.get("/songs/{song}/{name}.bin", response_model=None)
    def binary(song: str, name: str) -> Response:
        if f"{name}.bin" not in _BINARY_FILES:
            return _error(404, "E_NOT_FOUND", "Unknown file.")
        path = _song_file(song, f"{name}.bin")
        if path is None:
            return _error(404, "E_NOT_FOUND", "Unknown song.")
        return FileResponse(path, media_type="application/octet-stream")

    @api.get("/songs/{song}/fingerprint", response_model=None)
    def fingerprint(song: str) -> Response:
        from synesthesia.io import read_arrays

        path = _song_file(song, "arrays.npz")
        if path is None:
            return _error(404, "E_NOT_FOUND", "Unknown song.")
        return JSONResponse([float(v) for v in read_arrays(path)["fingerprint"]])

    def _render_view(song: str, view: str, px: int) -> bytes | None:
        from synesthesia.io import read_arrays, read_signature
        from synesthesia.maps.render_maps import render_all
        from synesthesia.render import png_bytes, render_sound_map

        sig_path, arr_path = _song_file(song, "signature.json"), _song_file(song, "arrays.npz")
        if sig_path is None or arr_path is None:
            return None
        sig, arrays = read_signature(sig_path), read_arrays(arr_path)
        meta = {
            "song_id": sig["song"]["id"],
            "pipeline_version": sig["pipeline_version"],
            "config_hash": sig["config_hash"].removeprefix("sha256:"),
        }
        if view == "sound":
            return png_bytes(render_sound_map(arrays["color_srgb"], cfg, px), meta)
        images = render_all(arrays, sig, cfg, px)
        key = view if view in images else None
        return png_bytes(images[key], meta) if key else b""

    @api.get("/songs/{song}/render.png", response_model=None)
    async def render_png(song: str, view: str = "sound", px: int = 1024) -> Response:
        if not valid_song_id(song) or not storage.has_song(song):
            return _error(404, "E_NOT_FOUND", "Unknown song.")
        if not _MIN_RENDER_PX <= px <= _MAX_RENDER_PX:
            return _error(400, "E_BAD_REQUEST", f"px must be {_MIN_RENDER_PX}-{_MAX_RENDER_PX}.")
        data = await run_in_threadpool(_render_view, song, view, px)
        if data is None:
            return _error(404, "E_NOT_FOUND", "Unknown song.")
        if data == b"":
            return _error(400, "E_BAD_REQUEST", f"Unknown view {view!r}.")
        return Response(data, media_type="image/png")

    @api.get("/songs/{song}/export", response_model=None)
    async def export(song: str, px: int = 4096, format: str = "png", caption: int = 0) -> Response:  # noqa: A002
        from synesthesia.io import read_arrays, read_signature
        from synesthesia.render import png_bytes, render_sound_map, render_svg

        if not valid_song_id(song) or not storage.has_song(song):
            return _error(404, "E_NOT_FOUND", "Unknown song.")
        if px not in cfg.render.export_px or format not in ("png", "svg") or caption != 0:
            return _error(400, "E_BAD_REQUEST", "Unsupported export options.")
        sig = read_signature(storage.song_dir(song) / "signature.json")
        arrays = read_arrays(storage.song_dir(song) / "arrays.npz")
        if format == "svg":
            text = render_svg(arrays["color_srgb"], cfg, px)
            return Response(text, media_type="image/svg+xml")
        meta = {
            "song_id": sig["song"]["id"],
            "pipeline_version": sig["pipeline_version"],
            "config_hash": sig["config_hash"].removeprefix("sha256:"),
        }
        data = await run_in_threadpool(
            lambda: png_bytes(render_sound_map(arrays["color_srgb"], cfg, px), meta)
        )
        return Response(data, media_type="image/png")

    @api.get("/songs/{a}/compare/{b}", response_model=None)
    def compare(a: str, b: str) -> Response:
        return _error(501, "E_NOT_IMPLEMENTED", "Compare arrives in M9.")

    @api.post("/songs/{song}/rating", response_model=None)
    def rating(song: str) -> Response:
        return _error(501, "E_NOT_IMPLEMENTED", "Ratings arrive in M9.")

    @api.delete("/songs/{song}", response_model=None)
    def delete_song(song: str) -> Response:
        if not valid_song_id(song) or not storage.delete_song(song):
            return _error(404, "E_NOT_FOUND", "Unknown song.")
        return Response(status_code=204)

    app.include_router(api)
    app.state.storage = storage
    app.state.jobs = jobs
    return app
