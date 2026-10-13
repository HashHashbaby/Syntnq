# SYNESTHESIA

> Hear the music. See its signature.

SYNESTHESIA turns a song into a visual signature: a **64 × 64 grid of glowing dots** where each cell is a *kind of sound* the song contains, laid out by sonic similarity (a self-organizing map), not by time. Companion maps (feature grids, structure, rhythm, dynamics) come from the same analysis. During playback the grid moves as a live **liquid field** that follows the audio instant by instant. The app UI follows Apple's design language. A later research layer tests whether signatures help explain listener preference.

This file is loaded every session. It holds the rules and the map of the project. The detailed specs live in `docs/` — **read the relevant spec before working on that area.**

## Current status

- **Current milestone:** M8 (export). **M7b (3D redesign) complete 2026-10-13** (D-045..D-064: phases 1-6 accepted; D-063 landing, D-064 maps polish) (D-061 start mural, D-062 live trail chart) (3D chips flat with a faint trail, D-056..D-059). **M7 passed 2026-10-12** (D-050: UI checklist 48 contexts, 60 fps on the RTX 3050, drift 0.42 analysis frames over 300 s, WebGL vs Python <= 3.26/255, real-track 4-minute upload 30.5 s); the 2D static render is frozen (`render_hash`, `config/render_freeze.yaml`) and M7b may change only the 3D/live view and app chrome. M6 passed 2026-10-11. M5 blind test gate **not met** (28.3% vs 25% chance, D-034) and **waived by the owner with conditions** (D-038: no human-recognition claim, mapping explained in the app). The DEAM-based emotion test (D-039) was **not adopted** (D-040); colour stays a feature-driven summary. Gates passed: M0, M1, M2 (exceptions D-022, D-023; calibration frozen, D-020), M3, M4 (D-031), M6, M7, M7b. Static display: 32 x 32 flat glowing dots over the 64 x 64 analysis (D-030); the 3D live view uses stained-glass chips (D-046). Update this line when a milestone's gate passes.
- **M5 evidence:** `out/blind_test_results/` (10 CSVs), `scripts/blind_test/analyze.py` and `diagnose.py`, D-034. Glass look work is parked on branch `m3-glass-look`.
- **M5c:** human-alignment check run (D-035): signature vs human mean colour r = -0.01 / +0.08 / +0.03 (lightness / chroma / hue) against ceilings 0.90 / 0.77 / 0.67. Pre-registered emotion term (D-036) evaluated on the held-out half and **not adopted** (D-037: held-out r +0.19 / +0.16 / -0.31, bar 0.40 / 0.40 / 0.30); code kept, disabled. Colour claims: feature-driven summary only.
- **Next action:** M8 export (2D only, `docs/MILESTONES.md`); then M9. At every gate: clean temporary files before reporting.

## Doc map: read before you work

| Working on | Read first |
| --- | --- |
| Audio ingest, features, SOM, color, companion maps, fingerprint, output files | `docs/ANALYSIS.md` |
| Live liquid grid (Python preview or WebGL shader) | `docs/LIVE.md` |
| Any UI, styling, screens, components, accessibility | `docs/UI.md` |
| Design inspiration, measured reference values, proposed UI token changes | `docs/REFERENCES.md`; motion from recordings: `docs/UI_REFERENCES.md` |
| Backend API, jobs, storage, binary formats | `docs/API.md` |
| What to build next, task lists, acceptance gates | `docs/MILESTONES.md` |
| Datasets, test tracks, blind test, research, licensing | `docs/DATA_RESEARCH.md` |
| Why something is the way it is; changing a decision | `docs/DECISIONS.md` |
| Every tunable number | `config/default.yaml` (single source of parameters) |

If a spec and the code disagree, the spec wins unless `docs/DECISIONS.md` records a newer decision. If two specs disagree, stop and ask.

## Non-negotiable rules

1. **Determinism.** Same normalized audio + same config + same pipeline version → byte-identical signature on the same machine, and values within 1e-5 across machines. No unseeded randomness; all randomness via `np.random.default_rng(config.seed)`. Limit BLAS/OpenMP to 1 thread inside the pipeline (`threadpoolctl`). Compute in float64, store in float32/float16.
2. **One source of parameters.** Every number lives in `config/default.yaml` and is read through the typed config model. No magic numbers in code. The config hash goes into every output.
3. **Gates before progress.** Work milestone by milestone. Do not start a milestone until the previous gate passes and the user has seen the evidence (images, videos, metrics).
4. **Show, don't claim.** For anything visual, render it and show it (PNG, MP4 or screenshots). For anything numeric, print the metric.
5. **Locked decisions stay locked.** Change one only when a prototype shows it fails, with evidence; record it in `docs/DECISIONS.md` and update the affected spec in the same commit.
6. **Honest research claims.** Never claim the signature beats spectrograms or predicts hits. Frame results as "interpretable and fixed-size, with X% of baseline performance".
7. **Data and legal.** Never commit audio. Never download more than 1 GB or a full dataset without asking. Uploaded user audio is deleted after analysis by default; only features are kept. Record license and attribution for every track used.
8. **Apple look, not Apple assets.** Follow `docs/UI.md`. Never bundle SF fonts, SF Symbols, Apple logos, device bezels or Apple product names, and never imply affiliation.
9. **Ask when unsure** about scope, data, licensing or a locked decision. Make small reversible choices yourself and note them in the commit message.

## Locked decisions (details in the specs)

| Area | Decision |
| --- | --- |
| Grid | 64 × 64 (4,096 cells) analysed; drawn as 32 × 32 nodes (`render.display_grid`, mean of 2 × 2 cells, D-030). `grid.size` is a parameter for experiments only. |
| Node look | Static view and exports: flat glowing `dot` (`NodeStyle`, D-030), radius 0.41 / glow 0.24 (D-055), frozen by `render_hash` (D-050, re-frozen D-055). 3D live view: flat stained-glass chips with a faint trail (D-046, D-058). Same per-cell colours; both pass the fidelity gates (2D judged on the dot fill, D-059). |
| What a cell is | A cluster of similar-sounding moments (a SOM prototype), not a time slice. |
| Moments | Analysis frames: 22,050 Hz, hop 512 (≈ 43.07 frames/s), features smoothed over 9 frames (≈ 0.2 s). The SOM trains on all frames (strided to ≤ 16,384). |
| Layout | Per-song batch SOM, PCA initialization, planar topology, then canonical orientation (brightness up, loudness right). |
| Layout vs color normalization | Layout uses per-song standardized features; color uses fixed global ranges so songs differ in absolute terms. |
| Hue (OKLCH) | Spectral centroid → hue 265° (dark, blue-violet) to 30° (bright, red-orange). Valence blend off until the emotion model exists. |
| Lightness | 0.6 × occupancy (soft, kernel-smoothed) + 0.4 × loudness. Rare/quiet = dim, central/loud = glowing. |
| Chroma | Harmonicity (harmonic vs percussive/noisy energy). |
| Live layer | Response field + temporal smoothing + diffusion + beat ripples, on top of the fixed static signature. Synced to the audio clock. |
| Comparison | Cross-song comparison uses the 133-value fingerprint, never pixel positions. |
| Stack | Python 3.11 analysis (uv, numpy, scipy, librosa, soxr, pyloudnorm, Pillow, FastAPI); web app in TypeScript + React + Vite; raw WebGL2 for the 2D reference renderer, plain three.js (pinned, lazy) for the 3D views (D-045). |
| UI | Apple-style web app (PWA), graphite only: dark grey gradient, black behind the grid, white-tinted floating glass panes with refraction and a song-colour ambient light; TeX Gyre Heros (D-048, D-051, D-053, D-054); see `docs/UI.md`. |
| Deferred | Commercial-success research, live microphone input, harmony and emotion maps (emotion arrives in M10). |

## Architecture

```
audio file ──► ingest ──► frames+features ──► SOM layout ──► color ──► static signature (npz/json/png)
                                   │                │
                                   ├──► companion maps (feature grids, structure, rhythm, dynamics)
                                   ├──► fingerprint (133 values)
                                   └──► live stream (per-frame features, BMU, loudness, onsets, beats)
                                                     │
              FastAPI (jobs, storage) ◄──────────────┘
                     │
                     ▼
     Web app: library · upload · signature view · WebGL2 liquid grid · maps · export
```

## Repository layout

```
synesthesia/
  CLAUDE.md
  README.md
  Makefile
  pyproject.toml            # uv-managed; exact versions locked in uv.lock
  uv.lock
  .pre-commit-config.yaml
  .github/workflows/ci.yml  # lint + type check + tests on ubuntu and macos
  config/
    default.yaml            # every parameter (see docs/ANALYSIS.md)
    calibration.yaml        # frozen global color ranges, written in M2
  docs/                     # specs (see doc map)
  src/synesthesia/
    __init__.py             # PIPELINE_VERSION
    config.py               # pydantic model, load + validate + hash
    determinism.py          # thread limits, rng factory, hashing helpers
    errors.py               # SynError with codes (docs/ANALYSIS.md §Errors)
    ingest.py               # decode, mono, resample, trim, loudness normalize
    features.py             # frame features, smoothing, change term
    standardize.py          # layout standardization + block weights
    som.py                  # batch SOM, PCA init, BMU, metrics
    orient.py               # canonical orientation (8 dihedral options)
    occupancy.py            # hits + kernel-smoothed occupancy
    color.py                # OKLab/OKLCH, mapping, gamut mapping to sRGB
    maps/
      feature_grids.py
      structure.py
      rhythm.py
      dynamics.py
      harmony.py            # later
    emotion.py              # M10: DEAM-trained regressor
    fingerprint.py
    live.py                 # live stream export + reference response field
    render.py               # static PNG/SVG renders, contact sheets
    display.py              # pool the 64 x 64 analysis to the drawn grid (32 x 32), raster geometry
    nodes.py                # NodeStyle seam: the look of one node (dot today), selected by render.node.style
    preview.py              # Python reference liquid-grid MP4 preview
    io.py                   # npz/json/bin writers and readers, schema versions
    pipeline.py             # analyze(path, config) -> SongResult
    cli.py                  # `syn analyze`, `syn render`, `syn preview`, `syn compare`
    api/
      app.py                # FastAPI app
      jobs.py               # job queue (in-process worker for MVP)
      storage.py
  scripts/
    fetch_manifest_tracks.py
    calibrate.py
    compare_sizes.py
    contact_sheet.py
    blind_test/             # static page generator (M5)
  tests/
    fixtures/make_signals.py  # synthetic audio, no network
    unit/ integration/ golden/
  data/                     # git-ignored: audio, datasets
    manifests/              # committed CSV manifests only
  out/                      # git-ignored: analysis outputs
  web/
    package.json  vite.config.ts  tsconfig.json
    public/manifest.webmanifest
    src/
      main.tsx  App.tsx
      styles/tokens.css     # design tokens (docs/UI.md)
      icons.ts              # icon map keyed by SF Symbol names
      audio/                # player, clock, latency compensation
      gl/                   # WebGL2 renderer, shaders, ping-pong buffers
      data/                 # binary loaders (docs/API.md formats)
      screens/  components/  state/
    tests/                  # vitest unit + playwright screenshots
```

## Commands

```
make setup          # uv sync, pre-commit install, web deps (when web exists)
make lint           # ruff check + ruff format --check + mypy
make test           # pytest (unit + integration + golden)
make test-determinism
make analyze SONG=path/to/file.mp3      # → out/<song_id>/
make render SONG_ID=<id>
make preview SONG=file.mp3 SECONDS=20   # liquid-grid MP4 with audio (or SONG_ID=<id> AUDIO=file)
make sync-check                         # click-track flash vs click timing on a finished MP4
make blind-test                         # M5: build out/blind_test/ (static page, clips, signatures)
make blind-test-analyze FOLDER=dir      # M5: analyze the participants' result CSVs
make calibrate                          # M2: writes config/calibration.yaml
make compare-sizes                      # M2: 32/40/64/100 contact sheets
make api-dev                            # FastAPI on :8000
make web-fixtures                       # M7: params.json + Python parity fixtures for the web tests
make web-samples                        # M7: bundled sample excerpts (needs corpus audio) -> web/public/samples
make web-fonts                          # M7b: TeX Gyre Heros WOFF2 subsets from CTAN -> web/public/fonts (D-048)
make web-dev                            # Vite on :5173 (proxies /api to :8000)
make web-test                           # tsc + vitest + playwright (parity, fallback, UI checklist, perf)
```

Create these targets in M0; keep this list in sync with the Makefile.

## Coding standards

**Python:** 3.11; type hints everywhere; `mypy --strict` on `src/`; `ruff` for lint and format; docstrings on public functions with units (Hz, dB, seconds, frames). Pure functions for analysis steps (input arrays + config → output arrays); I/O only in `io.py`, `cli.py`, `api/`. Arrays document shape in the docstring, e.g. `(T, D) float64`. No global state; no prints in library code (use `logging`).

**TypeScript:** `strict: true`; React function components; Zustand for state; no CSS framework — plain CSS with the tokens in `tokens.css`; raw WebGL2 for the 2D renderer and plain three.js (no R3F) for 3D views (D-045); every shader in its own `.glsl` file with a header comment naming its inputs.

**Naming:** `snake_case` Python, `camelCase` TS, files lowercase. Cell index `i = row * 64 + col`, row 0 at the top.

**Commits:** small and focused, conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`), mention the milestone (`feat(M1): batch SOM`).

## Testing

- **Unit:** each analysis step on synthetic signals from `tests/fixtures/make_signals.py` (sine sweep, white/pink noise, click track at 120 BPM, two-section A/B/A song, silence).
- **Determinism:** run `analyze` twice on the same input in fresh processes; assert identical bytes of `arrays.npz` and identical `signature.json` minus timing fields.
- **Golden:** store small golden outputs for two synthetic signals; any change to them needs a pipeline version bump and a DECISIONS entry.
- **Property checks:** brighter sweep → higher hue feature; noise → low chroma; louder gain → higher lightness (color uses global ranges).
- **Web:** vitest for data loaders and math; Playwright screenshots at 390×844, 820×1180, 1440×900, light and dark, reduced motion on and off.

## How to work on a task

1. Read the milestone in `docs/MILESTONES.md` and the relevant spec.
2. Write or update tests first where the behavior is specified.
3. Implement in small commits.
4. Run `make lint test`.
5. Produce the evidence the gate asks for and show it.
6. Update docs if anything changed; update "Current status" above when a gate passes.

## Definition of done (any task)

Tests pass · lint and types clean · determinism test passes · no hard-coded parameters · docs updated · evidence shown.

## Glossary

- **Frame / moment:** one analysis hop (512 samples ≈ 23.2 ms) with its smoothed feature vector.
- **Cell:** one of 4,096 SOM units; has a **prototype** vector.
- **BMU:** best-matching unit, the cell nearest to a frame's vector.
- **Occupancy:** kernel-smoothed share of frames assigned near a cell.
- **Static signature:** the deterministic 64 × 64 colored grid.
- **Response field:** per-frame match of the current moment to every cell; drives the liquid grid.
- **Fingerprint:** fixed 133-value vector for comparing songs.
