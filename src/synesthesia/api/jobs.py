"""In-process job queue backed by sqlite (docs/API.md section 2).

One worker thread, FIFO, ``queued -> running -> done | failed | cancelled``. Cancellation is
checked at stage boundaries (the pipeline's ``on_stage`` callback); a job exceeding
``api.job_timeout_s`` fails with ``E_INTERNAL`` at the next boundary.
"""

from __future__ import annotations

import queue
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from synesthesia.api.storage import Storage
from synesthesia.config import Config
from synesthesia.errors import USER_MESSAGES, ErrorCode, SynError
from synesthesia.ingest import decode_file
from synesthesia.io import write_result_to
from synesthesia.pipeline import analyze_audio

STAGES = ("reading", "listening", "mapping", "coloring", "maps", "writing")
_STAGE_INDEX = {name: i for i, name in enumerate(STAGES)}
_N_STAGES = len(STAGES)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    stage TEXT,
    progress REAL NOT NULL DEFAULT 0,
    song_id TEXT,
    error_code TEXT,
    error_message TEXT,
    upload_path TEXT,
    title TEXT,
    artist TEXT,
    created_at REAL NOT NULL,
    cancel INTEGER NOT NULL DEFAULT 0
)
"""


class JobCancelledError(Exception):
    """Raised inside the pipeline callback to stop a cancelled job."""


@dataclass(frozen=True)
class JobView:
    """Public job status (the ``GET /jobs/{id}`` body)."""

    state: str
    stage: str | None
    progress: float
    song_id: str | None
    error: dict[str, str] | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "stage": self.stage,
            "progress": self.progress,
            "song_id": self.song_id,
            "error": self.error,
        }


class JobManager:
    """sqlite job records plus a single analysis worker."""

    def __init__(self, storage: Storage, config: Config) -> None:
        self._storage, self._config = storage, config
        self._db = sqlite3.connect(storage.db_path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._thread: threading.Thread | None = None
        with self._lock:
            self._db.execute(_SCHEMA)
            # a restart drops in-flight work: mark it failed so clients stop polling
            self._db.execute(
                "UPDATE jobs SET state='failed', error_code=?, error_message=? "
                "WHERE state IN ('queued','running')",
                (ErrorCode.E_INTERNAL.value, "The server restarted before this job finished."),
            )
            self._db.commit()

    # -- lifecycle -------------------------------------------------------------------------------
    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="syn-worker", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        if self._thread is not None:
            self._queue.put(None)
            self._thread.join(timeout=5.0)
            self._thread = None
        with self._lock:
            self._db.close()

    # -- public API ------------------------------------------------------------------------------
    def submit(self, job_id: str, upload_path: Path, title: str | None, artist: str | None) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO jobs "
                "(job_id, state, stage, progress, upload_path, title, artist, created_at) "
                "VALUES (?, 'queued', NULL, 0, ?, ?, ?, ?)",
                (job_id, str(upload_path), title, artist, time.time()),
            )
            self._db.commit()
        self._queue.put(job_id)

    @staticmethod
    def new_job_id() -> str:
        return uuid.uuid4().hex

    def get(self, job_id: str) -> JobView | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            return None
        err = None
        if row["error_code"]:
            err = {"code": row["error_code"], "message": row["error_message"] or ""}
        return JobView(row["state"], row["stage"], float(row["progress"]), row["song_id"], err)

    def cancel(self, job_id: str) -> bool:
        """Request cancellation. Returns False when the job does not exist."""
        with self._lock:
            row = self._db.execute(
                "SELECT state, upload_path FROM jobs WHERE job_id=?", (job_id,)
            ).fetchone()
            if row is None:
                return False
            if row["state"] == "queued":
                self._db.execute("UPDATE jobs SET state='cancelled' WHERE job_id=?", (job_id,))
                upload = row["upload_path"]
            elif row["state"] == "running":
                self._db.execute("UPDATE jobs SET cancel=1 WHERE job_id=?", (job_id,))
                upload = None
            else:
                upload = None
            self._db.commit()
        if upload:
            self._storage.delete_upload(Path(upload))
        return True

    # -- worker ----------------------------------------------------------------------------------
    def _update(self, job_id: str, **fields: Any) -> None:
        cols = ", ".join(f"{k}=?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE jobs SET {cols} WHERE job_id=?", (*fields.values(), job_id))  # noqa: S608
            self._db.commit()

    def _is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            row = self._db.execute("SELECT cancel FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        return bool(row and row["cancel"])

    def _run(self) -> None:
        while True:
            job_id = self._queue.get()
            if job_id is None:
                return
            view = self.get(job_id)
            if view is None or view.state != "queued":
                continue
            try:
                self._process(job_id)
            except Exception as exc:  # worker must survive any single job
                self._update(
                    job_id,
                    state="failed",
                    error_code=ErrorCode.E_INTERNAL.value,
                    error_message=USER_MESSAGES[ErrorCode.E_INTERNAL],
                )
                del exc

    def _stage(self, job_id: str, name: str, started: float) -> None:
        if self._is_cancelled(job_id):
            raise JobCancelledError
        if time.monotonic() - started > self._config.api.job_timeout_s:
            raise SynError(ErrorCode.E_INTERNAL, "job timed out")
        self._update(job_id, stage=name, progress=_STAGE_INDEX[name] / _N_STAGES)

    def _process(self, job_id: str) -> None:
        with self._lock:
            row = self._db.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        upload = Path(row["upload_path"])
        started = time.monotonic()
        self._update(job_id, state="running", stage="reading", progress=0.0)
        keep = self._config.api.keep_audio
        try:
            try:
                audio = decode_file(upload, self._config)
            finally:
                if not keep:
                    self._storage.delete_upload(upload)  # right after ingest, even when it fails
            result = analyze_audio(
                audio,
                self._config,
                source_name=upload.name,
                on_stage=lambda name: self._stage(job_id, name, started),
            )
            self._stage(job_id, "writing", started)
            song_dir = self._storage.song_dir(result.song_id)
            write_result_to(result, song_dir, self._config)
            self._storage.write_meta(
                result.song_id, row["title"], row["artist"], result.ingest.duration_s
            )
            self._update(
                job_id, state="done", stage="writing", progress=1.0, song_id=result.song_id
            )
        except JobCancelledError:
            self._update(job_id, state="cancelled")
        except SynError as exc:
            self._update(
                job_id, state="failed", error_code=exc.code.value, error_message=exc.user_message
            )
