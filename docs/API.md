# API, jobs, storage and file formats

MVP: a single FastAPI process with an in-process job worker, local filesystem storage, no accounts. Runs locally or on one small server. Built in M6.

## 1. Endpoints (prefix `/api`)

| Method | Path | Purpose | Response |
| --- | --- | --- | --- |
| `GET` | `/health` | liveness | `{"status":"ok","pipeline_version":"<PIPELINE_VERSION>"}` |
| `POST` | `/analyze` | multipart upload (`file`; optional `title`, `artist`, `genre`, `release_year`, `source`, `chart_peak`, `chart_weeks`) | `202 {"job_id": "...", "song_id": null}`; if the same audio was already analyzed with the same config: `200 {"job_id": null, "song_id": "..."}` |
| `GET` | `/jobs/{job_id}` | job status | `{"state": "...", "stage": "...", "progress": 0.0-1.0, "song_id": "...|null", "error": {"code","message"}|null}` |
| `DELETE` | `/jobs/{job_id}` | cancel | `204` |
| `GET` | `/songs?limit=&offset=&q=&sort=recent\|title&include=fingerprint` | paged library (default 100, max 500); `X-Total-Count` header | `[{"song_id","title","artist","genre","release_year","source","chart_peak","chart_weeks","duration_s","created_at","fingerprint?"}]` |
| `GET` | `/songs/{id}/signature.json` | metadata | JSON (`docs/ANALYSIS.md §11`) |
| `GET` | `/songs/{id}/static.bin` | static colors, occupancy, feature grids | binary (§3) |
| `GET` | `/songs/{id}/maps.bin` | structure, tempogram, dynamics | binary (§3) |
| `GET` | `/songs/{id}/live.bin` | live stream | binary (§3) |
| `GET` | `/songs/{id}/proto.bin` | prototypes | binary (§3) |
| `GET` | `/songs/{id}/fingerprint` | 133 floats | JSON array |
| `GET` | `/songs/{id}/render.png?view=sound&px=1024` | server render | PNG |
| `GET` | `/songs/{id}/export?px=4096&format=png&caption=0` | export | PNG or SVG (deterministic bytes) |
| `GET` | `/songs/{a}/compare/{b}` | similarity (M9) | `{"distance","label","top_differences":[...]}` |
| `POST` | `/songs/{id}/rating` | liking rating (M9) | body `{"rating":1-7,"listener_id":"anon uuid"}` → `204` |
| `DELETE` | `/songs/{id}` | delete all outputs | `204` |

Errors return `{"error": {"code": "E_...", "message": "..."}}` with HTTP 400 (client file problems), 404, 409, 413 (size) or 500.

## 2. Jobs

- States: `queued → running → done | failed | cancelled`.
- Stages (shown in the UI): `reading` (ingest) → `listening` (features) → `mapping` (SOM + orientation) → `coloring` → `maps` → `writing`. Progress = stage index / 6, with SOM epochs updating progress within `mapping`.
- One worker (`max_concurrent_jobs: 1`), FIFO queue, timeout 300 s → `failed` with `E_INTERNAL`.
- Deduplication: song ID (hash of normalized audio) + config hash; identical requests return the existing result.
- Job records live in `storage/jobs.sqlite` (stdlib `sqlite3`); results in the filesystem.
- Cancellation checks between stages and between SOM epochs.

## 3. Binary formats (little-endian)

All binary files start with a 16-byte header:

| Offset | Type | Field |
| --- | --- | --- |
| 0 | 4 × char | magic (`SYNS`, `SYNM`, `SYNL`, `SYNP`) |
| 4 | u16 | format version (1) |
| 6 | u16 | grid size (64) |
| 8 | u32 | count (frames for `SYNL`, cells otherwise) |
| 12 | u32 | reserved (0) |

**`static.bin` (`SYNS`):** `color_srgb` 4096×3 u8 · `color_oklch` 4096×3 f32 · `occ_norm` 4096 f32 · `hits` 4096 u32 · `feature_grids` 5×4096 f32.

**`maps.bin` (`SYNM`):** `structure` 256×256 f16 · `tempogram` 128×256 f16 · `dyn_envelope` 1024 f32 · `dyn_hist` 40 f32 · then u32 beat count `B` and `B` f32 beat times.

**`live.bin` (`SYNL`):** f32 `fps` · f32 `tau` · u16 `D` (17) · u16 padding · `x` T×D f16 · `bmu` T u16 · `loud` T u8 · `onset` T u8 · `color` T×5 u8 · u32 `B` · `B` f32 beat times.

**`proto.bin` (`SYNP`):** u16 `D` · u16 padding · prototypes 4096×D f16.

Web loaders (`web/src/data/`) parse with `DataView` and typed arrays, validate magic and version, and reject unknown versions. Unit tests round-trip each format between Python writers and TS readers using a fixture file generated in CI.

## 4. Storage layout

```
storage/
  jobs.sqlite
  uploads/<job_id>.<ext>        # deleted right after ingest when keep_audio is false
  songs/<song_id>/<config_hash_12>/   # same layout as out/<song_id>/ in ANALYSIS.md §11
```

- `keep_audio: false` (default): the upload is deleted as soon as ingest finishes (or fails). The browser keeps its own copy for playback (IndexedDB, user-controllable in Settings).
- Retention: outputs of anonymous uploads deleted after `retention_days` (30) by a startup cleanup task; library items the client still references are re-requested and re-analysis requires the audio.
- No personal data is stored beyond an anonymous random `listener_id` for ratings.

## 5. Security and limits

- Upload limit 100 MB enforced by the server before reading the body fully.
- File type checked by decoding, not by extension alone.
- ffmpeg runs with a timeout and no network protocols (`-protocol_whitelist file,pipe`).
- CORS: allow the web app origin only (configurable).
- Rate limit: 10 analyses per hour per IP (simple in-memory token bucket) in the MVP.

## 5a. Song metadata (D-041)

Optional, nullable, never affects any array: `title`, `artist`, `genre`, `release_year` (1900-2100), `source` (free text, e.g. "Jamendo", "user upload"), `chart_peak` (>= 1), `chart_weeks` (>= 0). `chart_*` exist for the exploratory research of D-014 only. They are validated at upload (400 `E_BAD_REQUEST`), stored in the song's `meta.json` and in `signature.json` under `song`, and returned by `GET /songs`. The fingerprint (133 floats) is stored with the library entry so lists, similarity and later map views need no extra requests; the web library keeps it too.

## 5b. Implementation notes (M6)

- Run: `make api-dev` (uvicorn factory `synesthesia.api.app:create_app`, 127.0.0.1:8000). `create_app(config, storage_root)` is also what the tests use.
- `POST /analyze` decodes and normalizes the upload in the request to get the song ID, so decode errors return 400/413 immediately and an already-analyzed song returns `200` without a job. The worker decodes again (cheap) and runs the pipeline with stage callbacks (`reading`, `listening`, `mapping`, `coloring`, `maps`, `writing`).
- Progress is stage index / 6 (SOM epochs do not report sub-progress yet). Cancellation and the 300 s timeout are checked at stage boundaries, not mid-stage.
- Extra error codes outside `docs/ANALYSIS.md` section 13: `E_NOT_FOUND` (404), `E_BAD_REQUEST` (400), `E_RATE_LIMIT` (429), `E_NOT_IMPLEMENTED` (501, compare and rating until M9).
- `export` supports `caption=0` only until the caption renderer exists. Rate limit is per client IP, in memory.
- ffmpeg and ffprobe run with `-protocol_whitelist file,pipe` and a timeout (`ingest.decode_timeout_s`).
- Fixtures for the web loaders: `scripts/make_format_fixtures.py`.

## 6. Tests

- Integration: upload a synthetic 30 s file → poll → all endpoints return valid data; formats parse.
- Dedup: same audio twice → one job.
- Error mapping: each `E_*` code reachable with a fixture.
- Retention and `keep_audio` behavior.
- Latency: 4-minute track upload → `done` in ≤ 40 s on the reference machine.
