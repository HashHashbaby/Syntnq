# Analysis pipeline spec

Everything from an audio file to the static signature, companion maps, fingerprint and live stream. All parameters are in `config/default.yaml`; names below refer to config keys.

## 0. Contract

```python
def analyze(path: Path, config: Config) -> SongResult: ...
```

- Pure with respect to the audio content and config: metadata (file name, title tags) never affects arrays.
- Runs inside `threadpool_limits(1)`; all arithmetic in float64; outputs cast at write time.
- Every stage logs its wall time into `log.json`.
- `PIPELINE_VERSION` (semver in `src/synesthesia/__init__.py`): bump minor for any change that alters output arrays, patch otherwise.

## 1. Ingest (`ingest.py`)

1. **Validate:** extension in `ingest.formats`, size ≤ `max_file_mb` → else `E_FORMAT` / `E_SIZE`.
2. **Decode:** WAV/FLAC/OGG via `soundfile`; MP3/M4A/AAC/Opus via an `ffmpeg` subprocess to 32-bit float PCM at the file's native rate (`-f f32le -acodec pcm_f32le`). Decode errors → `E_DECODE`. Record the ffmpeg version in `log.json`.
3. **Mono:** mean of channels.
4. **Resample:** `soxr` (HQ) to `ingest.sample_rate` = 22,050 Hz. Never let librosa resample implicitly (`sr=None` on load).
5. **Trim:** remove leading/trailing audio below `trim_silence_dbfs` (−60 dBFS, frame-wise RMS over 2048-sample windows).
6. **Duration check:** `< min_duration_s` → `E_TOO_SHORT`; `> max_duration_s` → `E_TOO_LONG`.
7. **Loudness:** `pyloudnorm` integrated loudness. If `< silent_lufs` → `E_SILENT`. Apply gain to reach `target_lufs` (−23 LUFS), but cap gain so the sample peak stays ≤ `peak_ceiling_dbfs`. Record measured LUFS and applied gain.
8. **Song ID:** first 16 hex characters of SHA-256 over the normalized float32 PCM bytes (little-endian). Same audio → same ID regardless of file name or container.

Output: `y: (N,) float64` at 22,050 Hz, plus `IngestInfo` (duration, LUFS, gain, original channels and rate).

## 2. Frames and features (`features.py`)

STFT: `n_fft = 2048`, `hop = 512`, Hann, centered with reflect padding. Frame rate `fps = 22050 / 512 ≈ 43.066`. `T` = number of frames.

Per frame `t` compute (all float64):

| Name | Definition | Dims |
| --- | --- | --- |
| `mfcc` | MFCC from a 64-band mel spectrogram (30-11,025 Hz, power, `librosa.power_to_db` with ref=1.0, top_db=None), DCT type 2 ortho; keep c1..c13 | 13 |
| `brightness` | `log10(spectral_centroid_hz)`; centroid of the magnitude spectrum; silent frames (energy < 1e-10) take the song's median | 1 |
| `loudness` | `20 * log10(rms + 1e-10)` in dBFS from the frame's time-domain RMS | 1 |
| `noisiness` | `log10(spectral_flatness + 1e-10)` | 1 |
| `harmonicity` | HPSS (`kernel_size = 31`, `margin = 2.0`) on the magnitude STFT; `Σ_bins H² / (Σ_bins S² + 1e-10)`, the harmonic share of the frame's total energy (residual counts as non-harmonic; D-016) | 1 |
| `change` | novelty: Euclidean distance between the mean standardized feature vector over the previous `change.window_s` and the next `window_s` (frames clipped at edges), using the per-song z-scored `mfcc, brightness, loudness, noisiness` (16 dims) | 1 |
| `onset` | `librosa.onset.onset_strength` (median aggregate), normalized to `[0,1]` by the song's 99th percentile, clipped | 1 (live only) |
| `chroma` | `chroma_stft`, 12 bins, for structure/harmony maps | 12 (maps only) |

**Smoothing:** centered moving average of width `smooth_frames = 9` (edge-padded by repetition) applied to `mfcc, brightness, loudness, noisiness, harmonicity`. `change` is computed from the smoothed values. `onset` and `chroma` are not smoothed here.

Two derived matrices:

- `F_color: (T, 5)` = `[brightness, loudness, noisiness, harmonicity, change]` in physical units (used with global ranges for color).
- `F_layout: (T, 17)` = standardized and weighted (next section).

## 3. Layout standardization (`standardize.py`)

1. Stack `[mfcc(13), brightness, loudness, noisiness, change]` → `(T, 17)`. (Harmonicity is a color channel, not a layout dimension.)
2. Per-song z-score each column (`std` floor 1e-8).
3. Multiply each block by `weight / sqrt(block_dims)`: timbre 0.50/√13, brightness 0.15, loudness 0.15, noisiness 0.10, change 0.10.
4. Store `mean`, `std` and weights in the output so the live stream and any later frame can be projected identically.

Rationale: per-song scaling lets every song use the whole map; global color ranges keep absolute differences visible.

## 4. Self-organizing map (`som.py`)

**Training set:** `F_layout`. If `T > max_som_frames` (16,384), take every `ceil(T / 16384)`-th frame starting at 0 (deterministic stride).

**Grid:** `K = 64 × 64 = 4096` units at coordinates `(r, c)`, `r` down, `c` right, unit index `i = r*64 + c`.

**PCA initialization:**
1. Center the training data; compute the top 2 principal components with `numpy.linalg.svd` on the covariance (float64).
2. **Sign fix:** for each component, flip so that its largest-magnitude loading is positive. (Prevents BLAS-dependent sign flips.)
3. `w_i = mean + a_r * s1 * PC1 + b_c * s2 * PC2`, where `s1, s2` are the component standard deviations and `a_r, b_c` run linearly from −2 to 2 over rows and columns.

**Batch training:** for epoch `e = 0..E−1` (`E = 40`):
1. `σ_e = σ_start * (σ_end/σ_start) ** (e / (E−1))` with `σ_start = 16`, `σ_end = 1`.
2. BMU of each frame: `argmin_i ||x − w_i||²`, computed in chunks of `frame_chunk` frames as `||x||² − 2 x·w + ||w||²`; ties → lowest index.
3. Neighborhood `h_ij = exp(−d_grid(i,j)² / (2 σ_e²))` with Euclidean grid distance (precompute as separable row/column Gaussians for speed).
4. Update `w_j = Σ_i h_ij · S_i / Σ_i h_ij · n_i`, where `S_i` is the sum and `n_i` the count of frames whose BMU is `i`. If the denominator < 1e-12, keep `w_j`.

No sampling order, no learning rate, no randomness: batch SOM is deterministic given the init.

**Final assignment:** BMU for **all** `T` frames (not just the strided set) → `bmu: (T,) uint16`, `bmu_dist: (T,)`.

**Quality metrics** (stored): quantization error (mean BMU distance), topographic error (share of training frames whose first and second BMUs are not grid neighbors, 8-connectivity), share of units with zero hits.

## 5. Canonical orientation (`orient.py`)

A SOM is arbitrary up to the 8 symmetries of the square. To make artworks consistent:

1. For each prototype compute its brightness and loudness in physical units (de-standardize the prototype's brightness and loudness dims).
2. For each of the 8 dihedral transforms, compute `score = corr(brightness, −row) + corr(loudness, col)` (Pearson over the 4,096 units).
3. Pick the transform with the highest score; ties → first in the fixed order `[identity, rot90, rot180, rot270, flipH, flipV, transpose, antitranspose]`.
4. Apply it to prototypes, hit counts and the BMU index map. Store the transform name.

Result: bright sounds sit toward the top, loud sounds toward the right, in every song.

## 6. Cell statistics (`occupancy.py`)

- `hits: (4096,) uint32` — frames per unit (all `T` frames).
- `occupancy`: hits reshaped to 64×64, Gaussian-smoothed with `kernel_sigma_cells = 1.5` (`scipy.ndimage.gaussian_filter`, `mode="constant"`), divided by its max, then `** gamma` (0.5) → `occ_norm ∈ [0,1]`.
- `cell_features: (5, 4096)` — per unit, the mean of `F_color` over its frames. For units with zero hits, use the de-standardized prototype values instead (so empty cells still have a plausible color).
- `empty: occ_norm < empty_threshold (0.02)`.

## 7. Color (`color.py`)

Normalize each color feature with the **global** range `[lo, hi]` from `config/calibration.yaml` (falls back to `color.ranges` before calibration): `n = clip((v − lo) / (hi − lo), 0, 1)`.

Per cell, in OKLCH:

```
t     = n_brightness                       # (optionally 0.8 t + 0.2 n_valence when valence_blend > 0)
H     = 265 + (30 − 265) * t                # degrees; blue-violet → red-orange via teal, green, yellow
L     = 0.22 + (0.82 − 0.22) * (0.6 * occ_norm + 0.4 * n_loudness)     # D-026; spec max 0.86
C     = 0.08 + (0.24 − 0.08) * n_harmonicity     # D-025; D-018 0.06 .. 0.20; spec 0.03 .. 0.18
if empty: L = 0.16; C = C * 0.35
```

Then:
- **Display smoothing:** Gaussian (σ = 0.6 cells) on the L grid only; set `display_smoothing_sigma: 0` to disable.
- **OKLCH → OKLab → linear sRGB → sRGB** with Björn Ottosson's matrices, implemented in `color.py` (no third-party color library, so results are identical everywhere).
- **Gamut mapping:** if any linear sRGB channel falls outside `[0,1]`, bisect chroma (24 steps) at fixed L and H until in gamut.
- Store `color_oklch: (4096, 3) float32` and `color_srgb: (4096, 3) uint8`.

The same OKLab code is ported to GLSL for the live layer (`docs/LIVE.md`); unit tests compare the two on 1,000 random colors (max error 1/255).

## 8. Companion maps (`maps/`)

All maps have fixed shapes regardless of song length.

### Feature grids (`feature_grids.py`)
For each of `brightness, loudness, noisiness, harmonicity, change`: the normalized per-cell value (§7 normalization) as a `(64, 64) float32` grid, in the oriented layout. Rendered with a fixed sequential ramp (dark → light, single hue per feature) and the same dot style as the hero.

### Structure map (`structure.py`)
1. Pool `[chroma(12), mfcc(13)]` (unsmoothed mfcc) into blocks of `block_s = 0.5` s (mean).
2. L2-normalize each block vector; cosine self-similarity `S = B Bᵀ`.
3. Resize to `256 × 256` with area averaging when there are more than 256 blocks, nearest-neighbor when fewer.
4. Store `structure: (256, 256) float16` in `[−1, 1]`; render with a fixed sequential ramp, values below 0 clipped to 0 for display.

### Rhythm map (`rhythm.py`)
1. Onset envelope → `librosa.feature.tempogram(win_length=384)`.
2. Convert lag bins to BPM; resample to 128 log-spaced BPM bins over 40-240 BPM (linear interpolation in log-BPM).
3. Resample time to 256 columns (area average).
4. Normalize each column to max 1.
5. Global tempo: `librosa.beat.beat_track(start_bpm=120)` → `tempo_bpm`, `beat_times_s`.
6. `pulse_clarity` = max of the time-averaged normalized tempogram.
7. Store `tempogram: (128, 256) float16`, tempo, beat times (float32 seconds), pulse clarity.

### Dynamics (`dynamics.py`)
1. `envelope`: frame loudness (dBFS, unsmoothed) averaged into 1024 equal time segments → `(1024,) float32`.
2. `hist`: histogram of frame loudness over 40 bins in −60..0 dBFS, normalized to sum 1.
3. Short-term loudness: mean power over 3 s windows (hop 1 s) in dB; `lra_db` = 95th − 10th percentile.
4. `mean_loudness_db`, `peak_loudness_db` (99th percentile of frame loudness).

### Harmony (later, `harmony.py`)
`chroma_cqt` pooled to 256 columns; key and mode via Krumhansl-Schmuckler profiles. Not computed in v1.

### Emotion (M10, `emotion.py`)
See `docs/MILESTONES.md` M10. Until then, emotion fields are absent from outputs (not zero-filled).

## 9. Fingerprint (`fingerprint.py`)

Fixed length 133, `float32`, version 1:

| Block | Size | Definition |
| --- | --- | --- |
| Feature histograms | 5 × 16 = 80 | For each color feature, histogram of normalized frame values (all `T` frames) over 16 bins in [0,1]; each block sums to 1 |
| Hue × lightness | 12 × 4 = 48 | Joint histogram of per-cell hue (12 bins over 30-265°) and L (4 bins over 0.16-0.86), weighted by hits; sums to 1 |
| Scalars | 5 | `log2(tempo/120)`, pulse clarity, `lra_db / 30`, `(mean_loudness_db + 60) / 60`, `log2(duration_s / 180)` |

Distance between songs: Jensen-Shannon divergence averaged over histogram blocks, plus Euclidean distance over scalars, combined `0.8 · JS + 0.2 · scalar` (both scaled to [0,1] over the corpus). Implement in `fingerprint.distance()`.

## 10. Live stream (`live.py`)

Exported for the liquid grid (format in `docs/API.md`):
- `F_layout` for every frame (float16), using the stored standardization.
- `bmu` per frame (uint16, oriented indices).
- `loudness_n` and `onset_n` per frame (uint8, 0-255).
- `color_n` per frame: the 5 normalized color features (uint8).
- `beat_times_s` (float32), `tau` = `tau_scale` × median BMU distance.
- Prototypes `(4096, 17)` float16, oriented.

`live.py` also contains the **reference** response-field math used by `preview.py` and mirrored by the shader (see `docs/LIVE.md`).

## 11. Outputs (`io.py`)

```
out/<song_id>/
  signature.json     # metadata (below)
  arrays.npz         # numeric arrays (below), np.savez (not compressed, for byte determinism)
  live.bin           # live stream (docs/API.md)
  proto.bin          # oriented prototypes (docs/API.md)
  renders/
    sound_map.png            # 1024 px
    features_<name>.png      # 1024 px each
    structure.png  rhythm.png  dynamics.png
  log.json           # timings, library versions, ffmpeg version, warnings
```

`signature.json`:

```json
{
  "schema_version": 1,
  "pipeline_version": "0.1.0",
  "config_hash": "sha256:...",
  "calibration_hash": "sha256:... | null",
  "song": {"id": "3f2a9c1e5b7d4e8a", "title": null, "artist": null,
           "duration_s": 213.4, "source_name": "file.mp3",
           "measured_lufs": -9.8, "applied_gain_db": -13.2},
  "grid": {"size": 64, "orientation": "rot90", "frames": 9190, "fps": 43.066},
  "som": {"quantization_error": 0.41, "topographic_error": 0.06, "empty_units": 0.18},
  "rhythm": {"tempo_bpm": 121.8, "pulse_clarity": 0.62},
  "dynamics": {"lra_db": 7.9, "mean_loudness_db": -24.1, "peak_loudness_db": -11.0},
  "live": {"tau": 0.53},
  "license": {"name": "CC BY-SA 4.0 | unknown | user_upload", "attribution": "..."}
}
```

Title and artist come from tags or user input and never affect arrays.

`arrays.npz` keys: `prototypes (4096,17) f32`, `std_mean (17,) f64`, `std_scale (17,) f64`, `block_weights (17,) f64`, `hits (4096,) u32`, `occ_norm (4096,) f32`, `cell_features (5,4096) f32`, `color_oklch (4096,3) f32`, `color_srgb (4096,3) u8`, `feature_grids (5,64,64) f32`, `structure (256,256) f16`, `tempogram (128,256) f16`, `beat_times (n,) f32`, `dyn_envelope (1024,) f32`, `dyn_hist (40,) f32`, `fingerprint (133,) f32`.

Readers check `schema_version` and refuse unknown majors.

## 12. Static rendering (`render.py`)

- Canvas `px` (1024 preview; 2048/4096/8192 export), background `#000000`.
- **Display grid (D-030):** the signature is drawn as `render.display_grid` × `render.display_grid` nodes (32 × 32). Each node is the mean (OKLab) of a `block × block` square of analysis cells (`block = grid.size / display_grid` = 2). Analysis, calibration, fingerprint and companion maps stay at 64 × 64; set `display_grid: 64` for one node per cell.
- Margin = `margin_cells` × pitch; pitch = `px / (display_grid + 2·margin_cells)`.
- **Node look (D-030):** drawn by the style named in `render.node.style` (`src/synesthesia/nodes.py`); the numbers below are the `dot` style.
- Each node: a filled circle of radius `0.34 · pitch` at its center in the pooled colour, anti-aliased (render at 2× and downsample with Lanczos).
- Glow: copy of the dot layer blurred with σ = `0.30 · pitch`, composited with screen blend at 0.45 opacity (D-017, D-018; the original 0.5 / 0.6 filled the gaps between dots and mixed neighboring colors).
- Export PNG with an embedded text chunk: song ID, pipeline version, config hash. Same input → same bytes (fix Pillow compression level; no timestamps).
- SVG export: one `<circle>` per node (1,024 at 32 × 32) plus an SVG Gaussian blur filter for the glow.
- Contact sheets (`contact_sheet.py`): N signatures in a grid with file name and genre labels, for review.

## 13. Errors (`errors.py`)

| Code | When | User message |
| --- | --- | --- |
| `E_FORMAT` | unsupported extension or container | "This file type isn't supported. Try MP3, M4A, WAV, FLAC or OGG." |
| `E_SIZE` | file > 100 MB | "This file is larger than 100 MB." |
| `E_DECODE` | decoder failure or DRM | "We couldn't read this audio file." |
| `E_TOO_SHORT` | < 20 s after trimming | "Songs need to be at least 20 seconds long." |
| `E_TOO_LONG` | > 12 min | "Songs longer than 12 minutes aren't supported yet." |
| `E_SILENT` | integrated loudness < −60 LUFS | "This file seems to be silent." |
| `E_INTERNAL` | anything else | "Something went wrong. Please try again." |

## 14. Performance budgets

- 4-minute song, full analysis (excluding preview video): ≤ 30 s on an Apple M1 / 8 GB or comparable x86, single thread, peak RAM ≤ 1.5 GB.
- Biggest costs: HPSS and SOM. If over budget: compute HPSS on a 1,024-point FFT, then reduce SOM epochs to 30 only after showing the visual difference is negligible.
- Profile with `cProfile` in M1 and record per-stage times in `log.json`.

## 15. Tests specific to this spec

- Sine sweep 100 Hz → 8 kHz: brightness increases monotonically (Spearman > 0.95).
- White noise: noisiness normalized > 0.8, harmonicity < 0.2. Pure tones: harmonicity > 0.8.
- Click track 120 BPM: tempo 120 ± 2.
- A/B/A synthetic song: structure map shows off-diagonal blocks (A-A similarity > A-B similarity by 0.2).
- −6 dB gain before ingest: outputs match within 1e-4 (loudness normalization works; use a signal whose peak ceiling does not engage). Gain applied after normalization in a test hook: lightness increases.
- Orientation: rotating prototypes before `orient` yields the same final output.
- OKLab round-trip error < 1e-9; gamut-mapped colors all inside sRGB.
- Determinism: two fresh processes → identical `arrays.npz` bytes.
