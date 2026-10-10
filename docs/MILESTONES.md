# Milestones

Work strictly in order. Each milestone lists tasks, deliverables and a **gate**. A gate passes only when the evidence has been shown to the user and they agree. Update "Current status" in `CLAUDE.md` when a gate passes.

| # | Milestone | Main output |
| --- | --- | --- |
| M0 | Scaffold | Repo, tooling, config, synthetic fixtures, CI |
| M1 | Analysis core | `syn analyze` → deterministic static signature arrays |
| M2 | Render, calibrate, grid-size check | Contact sheets, frozen color ranges, distinctiveness metrics |
| M3 | Live reference preview | MP4 liquid-grid previews with audio |
| M3b | Product preview shell | Static React app with real components and the glass grid; look-and-feel approval |
| M4 | Companion maps | Structure, rhythm, dynamics, feature grids |
| M5 | Blind test | Evidence that signatures are recognizable |
| M6 | API | FastAPI service, jobs, binary formats |
| M7 | Web app on the API | Shell wired to the API: upload, analysis progress, persistence, export |
| M8 | Export | Poster-grade PNG/SVG, share |
| M9 | Collection and comparison | Library, compare view, ratings |
| M10 | Emotion model | DEAM-trained valence/arousal, emotion map |
| M11 | Research | Preference pilot and baselines |

---

## M0 Scaffold

**Tasks**
1. `pyproject.toml` with uv; Python 3.11; dependencies: numpy, scipy, librosa, soundfile, soxr, pyloudnorm, pillow, pydantic, pyyaml, threadpoolctl; dev: pytest, ruff, mypy, pre-commit. Lock exact versions in `uv.lock`.
2. Package skeleton per the layout in `CLAUDE.md` (empty modules with docstrings).
3. `config.py`: pydantic model mirroring `config/default.yaml`; load, validate, canonical JSON, SHA-256 hash; merge `config/calibration.yaml` when present.
4. `determinism.py`: `threadpool_limits(1)` context, `rng(config)` factory, `sha256_array()` helper.
5. `errors.py` with the codes in `docs/ANALYSIS.md §13`.
6. `tests/fixtures/make_signals.py`: deterministic synthetic WAVs (sine sweep, white noise, pink noise, pure tone chord, 120 BPM click track, A/B/A song made of two different synth textures, silence, 10 s clip).
7. Makefile targets from `CLAUDE.md`; `.gitignore` (`data/`, `out/`, `storage/`, `*.wav`, `*.mp3`, `node_modules/`, `.venv/`).
8. CI: GitHub Actions on ubuntu-latest and macos-latest: lint, mypy, tests; ffmpeg installed.
9. `README.md`: what it is, setup, commands.

**Gate:** `make setup lint test` green locally and in CI; config hash stable across two runs; fixtures generate identically twice.

---

## M1 Analysis core

**Tasks**
1. `ingest.py` per spec §1 (decode, mono, soxr, trim, LUFS, song ID).
2. `features.py` per §2 (13 MFCC, brightness, loudness, noisiness, harmonicity, change, onset, chroma; smoothing).
3. `standardize.py` per §3.
4. `som.py` per §4 (PCA init with sign fix, batch training, chunked BMU, metrics).
5. `orient.py` per §5; `occupancy.py` per §6; `color.py` per §7 (own OKLab code, gamut bisection).
6. `fingerprint.py` per §9 (feature + hue/lightness blocks; the 5 scalars are set to 0 until M4 provides tempo and LRA, and `signature.json` carries `"fingerprint_complete": false` until then).
7. `io.py` writers/readers for `signature.json` and `arrays.npz`; `pipeline.py`; CLI `syn analyze <file> [--config]`.
8. A minimal `render.py` sound-map PNG (1024 px) so results can be seen.
9. Tests from `docs/ANALYSIS.md §15` that apply to M1, plus the determinism test in two fresh processes.
10. Profile a 4-minute track; record stage times.

**Gate:** sound maps for the synthetic fixtures plus 3 real tracks shown; determinism test passes; analysis of a 4-minute track ≤ 30 s; SOM metrics printed (topographic error < 0.15 on real tracks).

---

## M2 Render, calibrate, grid-size check

**Tasks**
1. Finish `render.py` (glow, 2× supersampling, deterministic PNG bytes, SVG).
2. `scripts/fetch_manifest_tracks.py`: download the 30 tracks listed in `data/manifests/prototype_30.csv` (MTG-Jamendo subset, see `docs/DATA_RESEARCH.md`), verify checksums, store license and attribution. Ask the user before downloading.
3. Analyze all 30.
4. `scripts/calibrate.py`: 2nd and 98th percentiles of each color feature over all frames of the corpus → `config/calibration.yaml` (with its own hash). Re-analyze with calibration.
5. `scripts/contact_sheet.py`: 30 signatures in a 6×5 sheet labeled with genre.
6. Distinctiveness metrics using `fingerprint.distance`: (a) nearest-neighbor genre retrieval accuracy (leave-one-out), (b) mean within-genre vs between-genre distance, (c) count of near-duplicate pairs (distance < 0.05).
7. `scripts/compare_sizes.py`: contact sheets and metrics at grid sizes 32, 40, 64, 100 for the same tracks.
8. Write findings to `docs/DECISIONS.md` (calibration ranges, any tuning).

**Gate:** user reviews the contact sheets and says the signatures look distinct and as smooth as the mockup; within-genre distance < between-genre distance on average; no near-duplicate pairs across genres; 64 × 64 confirmed (or a recorded decision to change it). Freeze calibration.

---

## M3 Live reference preview

**Tasks**
1. `live.py`: export the live stream (in-memory and `live.bin`/`proto.bin` writers) and the reference response-field math from `docs/LIVE.md §2`.
2. `preview.py` and `syn preview`: render MP4 with audio (30 fps, 1080 px).
3. Previews for 3 contrasting tracks (e.g. ambient, rock, electronic), 20 s each, plus one with reduced-motion settings.
4. Sync check: overlay a frame counter and a beat flash; verify on the click track that flashes land on clicks (≤ 1 video frame off).

**Gate:** user watches the previews and agrees the grid reads as flowing liquid, stays in sync, and differs per song. Parameters tuned in this milestone are recorded in `config/default.yaml` and `DECISIONS.md`.

---

## M3b Product preview shell

Purpose: the user approves the look and feel of the real product UI **before** any backend work. A static, backend-free web app with the real components, loading pre-exported data.

**Tasks**
1. Vite + React + TypeScript (strict) + Zustand under `web/`; tokens from `docs/UI.md §2`; Lucide icons through `icons.ts`. No backend, no upload, no network calls beyond the local static files.
2. Data: Python writers for `static.bin`, `live.bin` and `proto.bin` per `docs/API.md §3` (and `maps.bin` for the parts that exist now: beat times and the dynamics envelope/histogram if available; the full writer comes in M4), run over the 30 corpus songs into `web/public/data/` (git-ignored). TypeScript loaders with round-trip tests against Python-generated fixtures.
3. Audio: short clips (about 30 s, from the middle) of the 30 corpus tracks, served locally from `web/public/audio/` (git-ignored; never committed). Working Web Audio player, clock with latency compensation, seek, keyboard shortcuts.
4. Real components per `docs/UI.md §6`: tokens, library list, signature view with the glass grid renderer (WebGL2, `docs/LIVE.md §2.9`, static and liquid live mode, with the live engine ported to TS/GPU), player bar with working audio sync, map switcher, bottom sheet / split view, inspector, settings (appearance, reduced motion, reduced transparency).
5. Maps that do not exist yet (structure, rhythm, dynamics until M4) are shown as clearly labelled placeholders; M4 must add the real maps to the shell.
6. Accessibility and fallbacks: reduced motion (static highlights, no swirl flow), reduced transparency and weak GPU (flat lenses), simplified lens below the small-size threshold.
7. Tests: vitest (loaders, OKLab GLSL vs JS parity, clock math); Playwright screenshots at 390x844, 820x1180 and 1440x900, light and dark (supplementary evidence only).

**Gate:** the user reviews the shell in the browser at 390, 820 and 1440 px, light and dark, and approves or redirects the look and feel. Playwright screenshots are supplementary and do not substitute for this review. Figma mock-ups are optional.

---

## M4 Companion maps

**Tasks**
1. `maps/feature_grids.py`, `maps/structure.py`, `maps/rhythm.py`, `maps/dynamics.py` per `docs/ANALYSIS.md §8`.
2. Renders for each map with captions and axes.
3. Complete fingerprint scalars (tempo, pulse clarity, LRA, mean loudness, duration); recompute the M2 metrics.
4. Tests: click track tempo, A/B/A structure, dynamics histogram sums to 1, fixed shapes for 25 s and 11 min inputs.
5. Ablation: genre retrieval with fingerprint blocks removed one at a time.

**Gate:** all maps render for the 30 tracks (shown as a per-song panel); tests pass; ablation table shown, and each block either improves retrieval or is explicitly kept for interpretability.

---

## M5 Blind test

**Tasks**
1. `scripts/blind_test/`: generate a static HTML page (no server) with 12 trials: play a 20 s clip, choose its signature among 4 (1 correct + 3 random from different songs). Fixed trial order per participant seed; results downloadable as CSV.
2. Protocol and consent text in `docs/DATA_RESEARCH.md §4`.
3. Run with ≥ 10 participants (user recruits); analyze accuracy, per-song difficulty, binomial test vs 25% chance.

**Gate:** mean accuracy ≥ 50% and significantly above chance (p < 0.05). If not met: diagnose with the per-song results, adjust the color mapping, re-run M2 metrics, then re-test. Do not build the web app on unrecognizable signatures.

---

## M6 API

**Tasks**
1. FastAPI app per `docs/API.md` (endpoints, jobs in sqlite, stages, cancellation, dedup).
2. Binary writers for `static.bin`, `maps.bin`, `live.bin`, `proto.bin`; fixture files for TS round-trip tests.
3. Storage, `keep_audio` deletion, retention cleanup, limits, CORS, rate limit.
4. Integration tests and latency test.

**Gate:** all API tests pass; 4-minute track upload to `done` ≤ 40 s; formats round-trip.

---

## M7 Web app on the API

The look and feel was approved in M3b; M7 wires the approved shell to the backend.

**Tasks**
1. Replace the static data loaders with the API client (`docs/API.md`): signature, static/maps/live/proto binaries, fingerprint.
2. Screens that need the backend: add song (picker + drag-drop, upload), analyzing with stages and progress, error states, library persistence (IndexedDB for song IDs, titles, local audio blobs if the user allows).
3. Export entry points: export sheet calling the server export endpoint, Web Share with download fallback (the poster-grade renderer and caption layout are M8).
4. Bundled samples: 3 Creative Commons tracks with attribution (from the manifest) for "Try a sample".
5. PWA manifest and service worker.
6. Tests: vitest for the API client; Playwright screenshots per `docs/UI.md §13` for the new states; FPS measurement script; 5-minute drift test.
7. WebGL vs Python preview comparison at 5 timestamps (`docs/LIVE.md §6`).

**Gate:** UI checklist passes on screenshots at all three sizes, light and dark, reduced motion and transparency; 60 fps on M1 Air and iPhone 13 (or the closest devices the user has); drift ≤ 1 analysis frame over 5 minutes; WebGL matches the reference within tolerance; upload to signature works end to end.

---

## M8 Export

**Tasks**
1. Export sheet UI; server export endpoint (PNG 2048/4096/8192, SVG), optional caption (title, artist, small "SYNESTHESIA" wordmark, license attribution line for Creative Commons tracks).
2. Web Share API with file; download fallback.
3. Tests: deterministic bytes; export at 1024 matches the in-app static view (mean difference ≤ 3/255).

**Gate:** user prints or views a 4096 px export and approves the quality.

---

## M9 Collection and comparison

**Tasks**
1. Library: search, sort (recent, title), delete, thumbnails.
2. Compare view per `docs/UI.md §6.9` using `/compare`; plain-language similarity label thresholds calibrated on the 30-track corpus (quartiles).
3. "Similar in your library": top 3 nearest songs by fingerprint.
4. Liking rating (1-7) per song with an anonymous listener ID; export ratings as CSV.

**Gate:** user tests comparison on 10 songs of their own and finds the similar-song suggestions sensible in at least 7 of 10 cases.

---

## M10 Emotion model

**Tasks**
1. Download DEAM (ask first; about 1.3 GB audio + annotations).
2. Features: our frame features pooled over 3 s windows (mean and std), tempo, pulse clarity, chroma-based major/minor clarity → per-second targets (valence, arousal).
3. Model: ridge regression (closed form, deterministic), α chosen by 5-fold cross-validation **split by song**; report Pearson r and RMSE for valence and arousal. Optionally compare with a small MLP only if ridge is clearly insufficient (fixed seed).
4. Validate on PMEmo (dynamic labels) without retraining.
5. Integrate: `emotion.py` produces smoothed valence/arousal per 0.5 s (Gaussian σ 1.5 s); per-cell mean valence/arousal; emotion map (valence-arousal density + path); `valence_blend: 0.2` only if the model's valence r ≥ 0.4 on PMEmo.
6. Bump pipeline version; regenerate goldens; record in DECISIONS.

**Gate:** metrics table shown (cross-validated and PMEmo); emotion map renders; user decides whether valence blending stays on.

---

## M11 Research

See `docs/DATA_RESEARCH.md §5-6`. Pre-register the analysis plan in `docs/DECISIONS.md` before collecting ratings.

**Gate:** results reported honestly with baselines, confidence intervals and limitations.

---

## Later (not scheduled)

Poster printing service · yearly mosaic of a listener's songs · live microphone input (`docs/LIVE.md §9`) · harmony map · native SwiftUI + Metal app · shared public signature links · commercial-success exploration (HSP-S, feature-only baseline, clearly labeled exploratory).
