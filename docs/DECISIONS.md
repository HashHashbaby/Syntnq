# Decision log

Newest last. Each entry: ID, date, decision, reason, status (`locked`, `assumed — confirm`, `superseded by D-xxx`). Changing a locked decision requires evidence and a new entry; update the affected spec in the same commit.

| ID | Date | Decision | Reason | Status |
| --- | --- | --- | --- | --- |
| D-001 | 2026-10-10 | Each dot is a kind of sound (a cluster of moments), not a time × frequency cell. | The owner wants every dot to represent the music at an instance, with the signature built from all instances; a time-column layout is close to a spectrogram. | locked |
| D-002 | 2026-10-10 | Grid 64 × 64 (4,096 cells), replacing the pitched 100 × 100. | 10,000 cells far exceed the distinct sonic states in a song (empty, noisy cells); 64 × 64 keeps fine texture; confirmed by the owner. Re-checked in M2. | locked |
| D-003 | 2026-10-10 | Layout by per-song batch SOM with PCA init and canonical orientation. | Smooth neighborhoods (matches the mockup look), deterministic, consistent orientation across songs. | locked |
| D-004 | 2026-10-10 | Train on all analysis frames (hop 512, ≈ 43 fps, ≤ 16,384 strided) instead of 4,096 equal slices. | Slices would make density depend on song length and are too coarse for live playback; frames give one consistent "moment" for the SOM, occupancy and the live stream. | locked |
| D-005 | 2026-10-10 | Layout features are standardized per song; color uses fixed global ranges calibrated once (M2). | Per-song scaling uses the whole map; global ranges keep songs visibly different (avoids "every song is the same rainbow"). | locked |
| D-006 | 2026-10-10 | OKLCH color: hue = spectral centroid (265° → 30°), lightness = 0.6 occupancy + 0.4 loudness, chroma = harmonicity. | Perceptually even color; each channel has one measurable job. | locked |
| D-007 | 2026-10-10 | Signature is a family of maps; v1 = sound map, feature grids, structure, rhythm, dynamics. Harmony and emotion later. | One picture cannot carry timbre, rhythm, structure and mood. | locked |
| D-008 | 2026-10-10 | Live liquid grid: response field + asymmetric smoothing + diffusion + beat ripples on top of the fixed static signature, synced to the audio clock. | Owner wants to watch the cells' values change live per instance in a liquid grid. | locked |
| D-009 | 2026-10-10 | Cross-song comparison via a 133-value fingerprint, never pixel positions. | Per-song layouts make positions incomparable. | locked |
| D-010 | 2026-10-10 | UI mimics Apple's design language without Apple assets; web PWA first. | Owner's request; licensing of SF fonts/Symbols outside Apple platforms is unconfirmed. | locked (UI style); web-first is assumed — confirm |
| D-011 | 2026-10-10 | Hero artwork with supporting map views (not equal panels). | Art-first product; panels remain available in the map switcher. | assumed — confirm |
| D-012 | 2026-10-10 | Uploaded audio deleted after analysis; only features kept. | Copyright and privacy. | assumed — confirm |
| D-013 | 2026-10-10 | Prototype corpus = 30 MTG-Jamendo tracks (5 genre groups × 6); DEAM and PMEmo for emotion only. | Full-length, varied, Creative Commons; DEAM clips are short. | assumed — confirm the list in M2 |
| D-014 | 2026-10-10 | Commercial-success research deferred and exploratory only. | Heavily confounded; HSP data has features, not audio. | locked |
| D-015 | 2026-10-10 | Stack: Python 3.11 (uv) analysis + FastAPI; React + TypeScript + Vite + raw WebGL2 web app; Lucide icons. | Mature audio tooling in Python; small custom renderer gives full control of the liquid grid. | locked |
| D-016 | 2026-10-10 | Harmonicity = harmonic share of total frame energy with HPSS `margin = 2.0` (was `H²/(H²+P²)` with margin 1.0). | The original formula gives 0.50 for white noise (H and P split evenly), contradicting the §15 test (noise < 0.2). Measured medians with the new definition: white noise 0.05, pink 0.25, chord 0.99, A/B/A 0.96. Owner chose this option during M1. | locked |
| D-017 | 2026-10-10 | Static render glow: σ = 0.25 · pitch at 0.35 opacity (was 0.50 / 0.60). | At 0.5 / 0.6 the blur (wider than the 0.32 · pitch gap between dots) filled the gaps with a muddy haze and mixed neighboring hues at region boundaries; owner reported dots bleeding together. Compared 4 settings on the A/B/A fixture; 0.25 / 0.35 keeps a soft halo with clean dot separation. Re-check in M2 on real tracks. | assumed — confirm |

## Pending entries to add during the build

- M2: frozen calibration ranges and their hash; grid-size check outcome.
- M3: tuned live parameters.
- M7: links to the Figma mockups.
- M10: emotion model metrics and the valence-blend decision.
- M11: pre-registered analysis plan (before any rating data is collected).
