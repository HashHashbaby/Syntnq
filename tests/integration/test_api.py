"""API integration tests (docs/API.md section 6)."""

from __future__ import annotations

import io
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from PIL import Image

from synesthesia.api.app import TokenBucket, create_app
from synesthesia.api.storage import Storage
from synesthesia.config import Config, load_config
from synesthesia.io import (
    decode_maps_bin,
    decode_proto_bin,
    decode_static_bin,
    encode_maps_bin,
    encode_static_bin,
)
from synesthesia.metadata import SongMetadata
from synesthesia.pipeline import SongResult

ROOT = Path(__file__).resolve().parents[2]

POLL_TIMEOUT_S = 180.0
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@contextmanager
def _client(tmp_path: Path, **api: Any) -> Iterator[TestClient]:
    overrides: dict[str, Any] = {"api": {"rate_limit_per_hour": 1000, **api}}
    cfg = load_config(overrides=overrides)
    with TestClient(create_app(cfg, storage_root=tmp_path / "storage")) as c:
        yield c


def _upload(c: TestClient, path: Path, **form: str) -> Any:
    with path.open("rb") as f:
        return c.post("/api/analyze", files={"file": (path.name, f)}, data=form)


def _wait(c: TestClient, job_id: str, timeout_s: float = POLL_TIMEOUT_S) -> dict[str, Any]:
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout_s:
        body: dict[str, Any] = c.get(f"/api/jobs/{job_id}").json()
        if body["state"] in ("done", "failed", "cancelled"):
            return body
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def test_health(tmp_path: Path) -> None:
    with _client(tmp_path) as c:
        r = c.get("/api/health")
        assert r.status_code == 200 and r.json()["status"] == "ok"
        assert r.json()["pipeline_version"]


def test_full_flow_endpoints_formats_dedup_and_audio_deletion(
    wavs: dict[str, Path], tmp_path: Path
) -> None:
    with _client(tmp_path) as c:
        r = _upload(c, wavs["aba_song"], title="Test", artist="Synth")
        assert r.status_code == 202 and r.json()["job_id"]
        job = _wait(c, r.json()["job_id"])
        assert job["state"] == "done" and job["progress"] == 1.0 and job["error"] is None
        sid = job["song_id"]

        # upload deleted right after ingest (keep_audio false)
        assert list((tmp_path / "storage" / "uploads").iterdir()) == []

        songs = c.get("/api/songs").json()
        assert [s["song_id"] for s in songs] == [sid]
        assert songs[0]["title"] == "Test" and songs[0]["artist"] == "Synth"

        sig = c.get(f"/api/songs/{sid}/signature.json").json()
        assert sig["song"]["id"] == sid and sig["fingerprint_complete"] is True

        static = decode_static_bin(c.get(f"/api/songs/{sid}/static.bin").content)
        assert static["color_srgb"].shape == (4096, 3) and static["feature_grids"].shape == (
            5,
            4096,
        )
        maps = decode_maps_bin(c.get(f"/api/songs/{sid}/maps.bin").content)
        assert maps["structure"].shape == (256, 256) and maps["tempogram"].shape == (128, 256)
        assert maps["dyn_hist"].sum() == pytest.approx(1.0, abs=1e-5)
        assert decode_proto_bin(c.get(f"/api/songs/{sid}/proto.bin").content).shape[0] == 4096
        assert c.get(f"/api/songs/{sid}/live.bin").content[:4] == b"SYNL"
        assert len(c.get(f"/api/songs/{sid}/fingerprint").json()) == 133

        for view in ("sound", "features_brightness", "structure", "rhythm", "dynamics"):
            png = c.get(f"/api/songs/{sid}/render.png", params={"view": view, "px": 256})
            assert png.status_code == 200 and png.content[:8] == PNG_MAGIC, view
        assert c.get(f"/api/songs/{sid}/render.png", params={"view": "nope"}).status_code == 400
        assert c.get(f"/api/songs/{sid}/render.png", params={"px": 8}).status_code == 400

        svg_a = c.get(f"/api/songs/{sid}/export", params={"format": "svg", "px": 2048})
        svg_b = c.get(f"/api/songs/{sid}/export", params={"format": "svg", "px": 2048})
        assert svg_a.status_code == 200 and svg_a.content == svg_b.content
        assert svg_a.text.count("<circle") == 32 * 32
        png_a = c.get(f"/api/songs/{sid}/export", params={"format": "png", "px": 2048})
        png_b = c.get(f"/api/songs/{sid}/export", params={"format": "png", "px": 2048})
        assert png_a.content[:8] == PNG_MAGIC and png_a.content == png_b.content
        assert c.get(f"/api/songs/{sid}/export", params={"px": 1000}).status_code == 400
        assert c.get(f"/api/songs/{sid}/export", params={"caption": 2}).status_code == 400
        # M8 caption (D-065): band under the same square, deterministic, SVG text; 503 without fonts
        cap = {"format": "png", "px": 2048, "caption": 1}
        if (ROOT / load_config().export.caption.font_regular).is_file():
            cap_a = c.get(f"/api/songs/{sid}/export", params=cap)
            cap_b = c.get(f"/api/songs/{sid}/export", params=cap)
            assert cap_a.status_code == 200 and cap_a.content == cap_b.content
            img = Image.open(io.BytesIO(cap_a.content))
            plain = Image.open(io.BytesIO(png_a.content))
            assert img.size == (2048, 2048 + round(0.17 * 2048))
            assert img.crop((0, 0, 2048, 2048)).tobytes() == plain.convert(img.mode).tobytes()
            svg_cap = c.get(f"/api/songs/{sid}/export", params={**cap, "format": "svg"})
            assert svg_cap.status_code == 200 and "SYNESTHESIA</text>" in svg_cap.text
        else:
            assert c.get(f"/api/songs/{sid}/export", params=cap).status_code == 503

        # dedup: same audio and config -> the existing result, no new job
        again = _upload(c, wavs["aba_song"])
        assert again.status_code == 200
        assert again.json() == {"job_id": None, "song_id": sid}

        assert c.delete(f"/api/songs/{sid}").status_code == 204
        assert c.get(f"/api/songs/{sid}/signature.json").status_code == 404
        assert c.delete(f"/api/songs/{sid}").status_code == 404


def test_keep_audio_keeps_the_upload(wavs: dict[str, Path], tmp_path: Path) -> None:
    with _client(tmp_path, keep_audio=True) as c:
        job = _wait(c, _upload(c, wavs["chord"]).json()["job_id"])
        assert job["state"] == "done"
        assert len(list((tmp_path / "storage" / "uploads").iterdir())) == 1


def test_errors_map_to_codes_and_statuses(wavs: dict[str, Path], tmp_path: Path) -> None:
    with _client(tmp_path) as c:
        bad_ext = tmp_path / "notes.txt"
        bad_ext.write_text("hello")
        r = _upload(c, bad_ext)
        assert r.status_code == 400 and r.json()["error"]["code"] == "E_FORMAT"

        garbage = tmp_path / "garbage.wav"
        garbage.write_bytes(b"this is not audio" * 100)
        r = _upload(c, garbage)
        assert r.status_code == 400 and r.json()["error"]["code"] == "E_DECODE"

        r = _upload(c, wavs["short_10s"])
        assert r.status_code == 400 and r.json()["error"]["code"] == "E_TOO_SHORT"

        r = _upload(c, wavs["silence"])
        assert r.status_code == 400 and r.json()["error"]["code"] == "E_SILENT"

        assert c.get("/api/jobs/" + "0" * 32).status_code == 404
        assert c.get("/api/jobs/not-a-job").status_code == 404
        assert c.get("/api/songs/zzzz/signature.json").status_code == 404
        assert c.get("/api/songs/0123456789abcdef/static.bin").status_code == 404
        assert list((tmp_path / "storage" / "uploads").iterdir()) == []  # failures leave nothing


def test_too_large_upload_is_413(wavs: dict[str, Path], tmp_path: Path) -> None:
    cfg = load_config(overrides={"ingest": {"max_file_mb": 0}, "api": {"rate_limit_per_hour": 100}})
    with TestClient(create_app(cfg, storage_root=tmp_path / "s")) as c:
        r = _upload(c, wavs["chord"])
        assert r.status_code == 413 and r.json()["error"]["code"] == "E_SIZE"


def test_rate_limit(wavs: dict[str, Path], tmp_path: Path) -> None:
    with _client(tmp_path, rate_limit_per_hour=1) as c:
        first = _upload(c, wavs["silence"])
        assert first.status_code == 400  # counted even though it failed validation
        second = _upload(c, wavs["silence"])
        assert second.status_code == 429 and second.json()["error"]["code"] == "E_RATE_LIMIT"


def test_token_bucket_refills() -> None:
    b = TokenBucket(10)
    assert all(b.allow("a", now=0.0) for _ in range(10))
    assert not b.allow("a", now=0.0)
    assert b.allow("a", now=361.0)  # 10 per hour -> one token per 360 s
    assert b.allow("other", now=0.0)


def test_queued_job_can_be_cancelled(wavs: dict[str, Path], tmp_path: Path) -> None:
    with _client(tmp_path) as c:
        a = _upload(c, wavs["aba_song"]).json()["job_id"]
        b = _upload(c, wavs["chord"]).json()["job_id"]
        assert c.delete(f"/api/jobs/{b}").status_code == 204
        assert _wait(c, b)["state"] == "cancelled"
        assert _wait(c, a)["state"] == "done"
        assert c.delete("/api/jobs/" + "f" * 32).status_code == 404


def test_retention_removes_old_songs(
    results: dict[str, SongResult], config: Config, tmp_path: Path
) -> None:
    from synesthesia.io import write_result_to

    st = Storage(tmp_path, config.hash()[:12])
    r = results["chord"]
    write_result_to(r, st.song_dir(r.song_id), config)
    st.write_meta(r.song_id, SongMetadata(title="t", artist="a"), r.ingest.duration_s)
    assert st.has_song(r.song_id)
    assert st.cleanup(30, now=time.time()) == []
    day = 86400.0
    assert st.cleanup(30, now=time.time() + 31 * day) == [r.song_id]
    assert not st.has_song(r.song_id)


def test_binary_formats_round_trip(results: dict[str, SongResult]) -> None:
    r = results["aba_song"]
    s = decode_static_bin(encode_static_bin(r, 64))
    assert np.array_equal(s["color_srgb"], r.colors.srgb)
    assert np.allclose(s["color_oklch"], r.colors.oklch.astype(np.float32))
    assert np.array_equal(s["hits"], r.stats.hits)
    assert np.allclose(s["feature_grids"], r.feature_grids.reshape(5, -1))
    m = decode_maps_bin(encode_maps_bin(r, 64))
    assert np.array_equal(m["structure"], r.maps.structure)
    assert np.array_equal(m["tempogram"], r.maps.rhythm.tempogram)
    assert np.allclose(m["dyn_envelope"], r.maps.dynamics.envelope)
    assert np.array_equal(m["beat_times"], r.maps.rhythm.beat_times_s)
    with pytest.raises(ValueError):
        decode_static_bin(encode_maps_bin(r, 64))  # wrong magic is rejected


def test_four_minute_upload_is_done_within_the_latency_budget(tmp_path: Path) -> None:
    from fixtures import make_signals as ms

    path = tmp_path / "four_minutes.wav"
    sf.write(path, ms.aba_song(duration_s=240.0), ms.SAMPLE_RATE, subtype="PCM_16", format="WAV")
    with _client(tmp_path) as c:
        t0 = time.monotonic()
        r = _upload(c, path)
        assert r.status_code == 202
        job = _wait(c, r.json()["job_id"], timeout_s=120.0)
        elapsed = time.monotonic() - t0
    assert job["state"] == "done"
    assert elapsed <= 40.0, f"4-minute upload took {elapsed:.1f} s (budget 40 s)"


def test_metadata_fields_flow_through_signature_and_library(
    wavs: dict[str, Path], tmp_path: Path
) -> None:
    form = {
        "title": "Test", "artist": "Synth", "genre": "electronic", "release_year": "1999",
        "source": "Jamendo", "chart_peak": "3", "chart_weeks": "12",
    }  # fmt: skip
    with _client(tmp_path) as c:
        r = _upload(c, wavs["chord"], **form)
        job = _wait(c, r.json()["job_id"])
        assert job["state"] == "done"
        sid = job["song_id"]
        song = c.get(f"/api/songs/{sid}/signature.json").json()["song"]
        assert song["genre"] == "electronic" and song["release_year"] == 1999
        assert song["source"] == "Jamendo" and song["chart_peak"] == 3 and song["chart_weeks"] == 12
        item = c.get("/api/songs").json()[0]
        assert (
            item["genre"] == "electronic"
            and item["chart_weeks"] == 12
            and "fingerprint" not in item
        )
        fp = c.get("/api/songs", params={"include": "fingerprint"}).json()[0]["fingerprint"]
        assert len(fp) == 133

        # absent fields stay null
        job2 = _wait(c, _upload(c, wavs["sine_sweep"]).json()["job_id"])
        song2 = c.get(f"/api/songs/{job2['song_id']}/signature.json").json()["song"]
        assert (
            song2["genre"] is None and song2["release_year"] is None and song2["chart_peak"] is None
        )


def test_invalid_metadata_is_rejected(wavs: dict[str, Path], tmp_path: Path) -> None:
    with _client(tmp_path) as c:
        for bad in ({"release_year": "abc"}, {"release_year": "1200"}, {"chart_peak": "0"},
                    {"chart_weeks": "-1"}, {"genre": "x" * 500}):  # fmt: skip
            r = _upload(c, wavs["chord"], **bad)
            assert r.status_code == 400 and r.json()["error"]["code"] == "E_BAD_REQUEST", bad
        assert list((tmp_path / "storage" / "uploads").iterdir()) == []


def test_library_listing_is_paged_searchable_and_sortable(
    results: dict[str, SongResult], config: Config, tmp_path: Path
) -> None:
    from synesthesia.io import write_result_to

    cfg = load_config(overrides={"api": {"rate_limit_per_hour": 1000, "page_size_max": 3}})
    store = Storage(tmp_path / "storage", cfg.hash()[:12])
    names = [("chord", "Charlie"), ("sine_sweep", "alpha"), ("aba_song", "Bravo"),
             ("white_noise", "delta"), ("pink_noise", "Echo")]  # fmt: skip
    for key, title in names:
        r = results[key]
        meta = SongMetadata(title=title, artist="X", genre="rock" if key == "aba_song" else "pop")
        write_result_to(r, store.song_dir(r.song_id), cfg, meta)
        store.write_meta(r.song_id, meta, r.ingest.duration_s, [float(v) for v in r.fingerprint])
        time.sleep(0.01)  # distinct created_at
    with TestClient(create_app(cfg, storage_root=tmp_path / "storage")) as c:
        page1 = c.get("/api/songs", params={"limit": 2, "offset": 0})
        assert page1.headers["X-Total-Count"] == "5" and len(page1.json()) == 2
        assert page1.json()[0]["title"] == "Echo"  # newest first
        page3 = c.get("/api/songs", params={"limit": 2, "offset": 4}).json()
        assert [s["title"] for s in page3] == ["Charlie"]
        by_title = c.get("/api/songs", params={"sort": "title", "limit": 3}).json()
        assert [s["title"] for s in by_title] == ["alpha", "Bravo", "Charlie"]
        found = c.get("/api/songs", params={"q": "ROCK"})
        assert [s["title"] for s in found.json()] == ["Bravo"] and found.headers[
            "X-Total-Count"
        ] == "1"
        assert c.get("/api/songs", params={"limit": 0}).status_code == 400
        assert c.get("/api/songs", params={"limit": 4}).status_code == 400  # above page_size_max
        assert c.get("/api/songs", params={"sort": "nope"}).status_code == 400
