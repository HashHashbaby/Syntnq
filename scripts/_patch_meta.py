"""One-off patch: song metadata + paged library listing (deleted after use)."""


def edit(path, pairs):
    s = open(path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    s = s.replace("\r\n", "\n")
    for old, new in pairs:
        assert old in s, (path, old[:80])
        s = s.replace(old, new, 1)
    open(path, "w", encoding="utf-8", newline="").write(s.replace("\n", nl))


# ---- config ---------------------------------------------------------------------------------
edit("src/synesthesia/config.py", [
    ("    rate_limit_per_hour: int\n    cors_origins: list[str]\n    upload_chunk_kb: int\n",
     "    rate_limit_per_hour: int\n    cors_origins: list[str]\n    upload_chunk_kb: int\n"
     "    metadata_max_len: int\n    metadata_year_range: tuple[int, int]\n"
     "    page_size_default: int\n    page_size_max: int\n"),
])
edit("config/default.yaml", [
    ("  upload_chunk_kb: 256\n",
     "  upload_chunk_kb: 256\n  metadata_max_len: 200         # characters per text field (title, artist, genre, source)\n"
     "  metadata_year_range: [1900, 2100]\n  page_size_default: 100        # GET /songs\n  page_size_max: 500\n"),
])

# ---- io: metadata in signature.json ---------------------------------------------------------
edit("src/synesthesia/io.py", [
    ("def signature_dict(result: SongResult, config_grid_size: int) -> dict[str, Any]:",
     "def signature_dict(\n    result: SongResult, config_grid_size: int, metadata: SongMetadata | None = None\n) -> dict[str, Any]:"),
    ("        \"song\": {\n            \"id\": result.song_id,\n            \"title\": None,\n            \"artist\": None,\n",
     "        \"song\": {\n            \"id\": result.song_id,\n            **(metadata or SongMetadata()).as_dict(),\n"),
    ("from synesthesia.config import Config\n", "from synesthesia.config import Config\nfrom synesthesia.metadata import SongMetadata\n"),
    ("def write_result_to(result: SongResult, song_dir: Path, config: Config) -> Path:",
     "def write_result_to(\n    result: SongResult, song_dir: Path, config: Config, metadata: SongMetadata | None = None\n) -> Path:"),
    ("    sig = signature_dict(result, grid_size)\n", "    sig = signature_dict(result, grid_size, metadata)\n"),
])

# ---- storage --------------------------------------------------------------------------------
edit("src/synesthesia/api/storage.py", [
    ("@dataclass(frozen=True)\nclass SongMeta:\n    song_id: str\n    title: str | None\n    artist: str | None\n    duration_s: float\n    created_at: float\n",
     "@dataclass(frozen=True)\nclass SongMeta:\n    \"\"\"Library entry: descriptive metadata plus the fingerprint (docs/API.md section 1).\"\"\"\n\n"
     "    song_id: str\n    metadata: SongMetadata\n    duration_s: float\n    created_at: float\n"
     "    fingerprint: list[float] | None = None\n\n"
     "    def as_dict(self, *, include_fingerprint: bool = False) -> dict[str, Any]:\n"
     "        d: dict[str, Any] = {\n            \"song_id\": self.song_id,\n            **self.metadata.as_dict(),\n"
     "            \"duration_s\": self.duration_s,\n            \"created_at\": self.created_at,\n        }\n"
     "        if include_fingerprint:\n            d[\"fingerprint\"] = self.fingerprint\n        return d\n"),
    ("from dataclasses import dataclass\nfrom pathlib import Path\n", "from dataclasses import dataclass\nfrom pathlib import Path\nfrom typing import Any\n\nfrom synesthesia.metadata import SongMetadata\n"),
])
s = open("src/synesthesia/api/storage.py", encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
s = s.replace("\r\n", "\n")
a = s.index("    def write_meta(")
b = s.index("    def delete_song(")
new_meta = '''    def write_meta(
        self,
        song_id: str,
        metadata: SongMetadata,
        duration_s: float,
        fingerprint: list[float] | None = None,
    ) -> None:
        doc = {
            "song_id": song_id,
            **metadata.as_dict(),
            "duration_s": duration_s,
            "created_at": time.time(),
            "fingerprint": fingerprint,
        }
        (self.song_dir(song_id) / _META_NAME).write_text(json.dumps(doc), encoding="utf-8")

    def read_meta(self, song_id: str) -> SongMeta | None:
        path = self.song_dir(song_id) / _META_NAME
        if not path.is_file():
            return None
        d = json.loads(path.read_text(encoding="utf-8"))
        return SongMeta(
            song_id=d["song_id"],
            metadata=SongMetadata.from_dict(d),
            duration_s=float(d["duration_s"]),
            created_at=float(d["created_at"]),
            fingerprint=d.get("fingerprint"),
        )

    def list_songs(self) -> list[SongMeta]:
        out = []
        for d in sorted(self.songs.iterdir()):
            if valid_song_id(d.name) and self.has_song(d.name):
                meta = self.read_meta(d.name)
                if meta is not None:
                    out.append(meta)
        return sorted(out, key=lambda m: m.created_at, reverse=True)

    def page(
        self, *, limit: int, offset: int, query: str | None = None, sort: str = "recent"
    ) -> tuple[list[SongMeta], int]:
        """One page of the library and the total number of matches.

        Args:
            limit: page size.
            offset: first item.
            query: case-insensitive substring over title, artist and genre.
            sort: ``recent`` (newest first) or ``title``.
        """
        items = self.list_songs()
        if query:
            q = query.lower()
            items = [
                m
                for m in items
                if any(
                    q in (v or "").lower()
                    for v in (m.metadata.title, m.metadata.artist, m.metadata.genre)
                )
            ]
        if sort == "title":
            items.sort(key=lambda m: ((m.metadata.title or "").lower(), m.song_id))
        return items[offset : offset + limit], len(items)

'''
s = s[:a] + new_meta + s[b:]
open("src/synesthesia/api/storage.py", "w", encoding="utf-8", newline="").write(s.replace("\n", nl))

# ---- jobs -----------------------------------------------------------------------------------
edit("src/synesthesia/api/jobs.py", [
    ("    title TEXT,\n    artist TEXT,\n", "    title TEXT,\n    artist TEXT,\n    meta_json TEXT,\n"),
    ("            self._db.execute(_SCHEMA)\n",
     "            self._db.execute(_SCHEMA)\n"
     "            cols = {r[1] for r in self._db.execute(\"PRAGMA table_info(jobs)\")}\n"
     "            if \"meta_json\" not in cols:  # databases created before song metadata existed\n"
     "                self._db.execute(\"ALTER TABLE jobs ADD COLUMN meta_json TEXT\")\n"),
    ("    def submit(\n        self, job_id: str, upload_path: Path, title: str | None, artist: str | None\n    ) -> None:",
     "    def submit(self, job_id: str, upload_path: Path, metadata: SongMetadata) -> None:"),
    ("                \"(job_id, state, stage, progress, upload_path, title, artist, created_at) \"\n                \"VALUES (?, 'queued', NULL, 0, ?, ?, ?, ?)\",\n                (job_id, str(upload_path), title, artist, time.time()),",
     "                \"(job_id, state, stage, progress, upload_path, title, artist, meta_json, created_at) \"\n                \"VALUES (?, 'queued', NULL, 0, ?, ?, ?, ?, ?)\",\n                (\n                    job_id,\n                    str(upload_path),\n                    metadata.title,\n                    metadata.artist,\n                    json.dumps(metadata.as_dict()),\n                    time.time(),\n                ),"),
    ("import queue\nimport sqlite3\n", "import json\nimport queue\nimport sqlite3\n"),
    ("from synesthesia.io import write_result_to\n", "from synesthesia.io import write_result_to\nfrom synesthesia.metadata import SongMetadata\n"),
    ("            write_result_to(result, song_dir, self._config)\n            self._storage.write_meta(\n                result.song_id, row[\"title\"], row[\"artist\"], result.ingest.duration_s\n            )\n",
     "            metadata = SongMetadata.from_dict(json.loads(row[\"meta_json\"] or \"{}\"))\n"
     "            write_result_to(result, song_dir, self._config, metadata)\n"
     "            self._storage.write_meta(\n                result.song_id,\n                metadata,\n                result.ingest.duration_s,\n                [float(v) for v in result.fingerprint],\n            )\n"),
])

# ---- app ------------------------------------------------------------------------------------
edit("src/synesthesia/api/app.py", [
    ("        title: str | None = Form(None),  # noqa: B008\n        artist: str | None = Form(None),  # noqa: B008\n",
     "        title: str | None = Form(None),  # noqa: B008\n        artist: str | None = Form(None),  # noqa: B008\n"
     "        genre: str | None = Form(None),  # noqa: B008\n        release_year: str | None = Form(None),  # noqa: B008\n"
     "        source: str | None = Form(None),  # noqa: B008\n        chart_peak: str | None = Form(None),  # noqa: B008\n"
     "        chart_weeks: str | None = Form(None),  # noqa: B008\n"),
    ("        client = request.client.host if request.client else \"unknown\"\n        if not bucket.allow(client):",
     "        try:\n            metadata = SongMetadata.parse(\n"
     "                {\n                    \"title\": title,\n                    \"artist\": artist,\n                    \"genre\": genre,\n"
     "                    \"release_year\": release_year,\n                    \"source\": source,\n"
     "                    \"chart_peak\": chart_peak,\n                    \"chart_weeks\": chart_weeks,\n                },\n"
     "                cfg,\n            )\n        except ValueError as exc:\n"
     "            return _error(400, \"E_BAD_REQUEST\", str(exc))\n"
     "        client = request.client.host if request.client else \"unknown\"\n        if not bucket.allow(client):"),
    ("        jobs.submit(job_id, path, title, artist)\n", "        jobs.submit(job_id, path, metadata)\n"),
    ("from synesthesia.ingest import decode_file, normalize, song_id\n", "from synesthesia.ingest import decode_file, normalize, song_id\nfrom synesthesia.metadata import SongMetadata\n"),
])
s = open("src/synesthesia/api/app.py", encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
s = s.replace("\r\n", "\n")
a = s.index('    @api.get("/songs")')
b = s.index("    def _song_file(")
new_list = '''    @api.get("/songs", response_model=None)
    def list_songs(
        limit: int | None = None,
        offset: int = 0,
        q: str | None = None,
        sort: str = "recent",
        include: str | None = None,
    ) -> Response:
        size = cfg.api.page_size_default if limit is None else limit
        if not 1 <= size <= cfg.api.page_size_max or offset < 0 or sort not in ("recent", "title"):
            return _error(400, "E_BAD_REQUEST", "Invalid paging parameters.")
        items, total = storage.page(limit=size, offset=offset, query=q, sort=sort)
        with_fp = include == "fingerprint"
        return JSONResponse(
            [m.as_dict(include_fingerprint=with_fp) for m in items],
            headers={"X-Total-Count": str(total)},
        )

'''
s = s[:a] + new_list + s[b:]
open("src/synesthesia/api/app.py", "w", encoding="utf-8", newline="").write(s.replace("\n", nl))
print("ok")
