# Live playback spec: the liquid grid

During playback every one of the 4,096 cells changes color in real time, so the viewer watches the song's values move across the grid instant by instant. The static signature stays fixed and deterministic underneath; the live layer is a visual animation on top of it and is not part of the deterministic output.

Two implementations share one math spec:
- **Python reference** (`live.py` + `preview.py`): renders an MP4 with the audio muxed in. Built in M3 to judge the feel before any web work.
- **WebGL2 renderer** (`web/src/gl/`): built in M7, must match the reference visually.

All parameters: `config/default.yaml → live`.

## 1. Inputs (from `live.bin` and `proto.bin`, see `docs/API.md`)

| Name | Shape | Meaning |
| --- | --- | --- |
| `x_t` | `(T, 17)` f16 | standardized, weighted layout features per frame |
| `w_i` | `(4096, 17)` f16 | oriented prototypes |
| `bmu_t` | `(T,)` u16 | best-matching cell per frame |
| `loud_t` | `(T,)` u8 | normalized loudness 0-255 |
| `onset_t` | `(T,)` u8 | normalized onset strength 0-255 |
| `color_t` | `(T, 5)` u8 | normalized color features per frame |
| `beats` | `(B,)` f32 | beat times in seconds |
| `tau` | scalar | response width |
| `static_i` | `(4096, 3)` | static OKLCH colors (from `signature.json`/`arrays`) |
| `fps` | scalar | 43.066 frames/s |

## 2. Per-display-frame computation

At display time `s` (seconds of audio, see §5):

**2.1 Frame interpolation.** `f = s · fps`; `t0 = floor(f)`, `a = f − t0`. Interpolate `x = (1−a)·x_t0 + a·x_t0+1` and likewise loudness, onset, color features.

**2.2 Response field.**
```
d²_i = ||x − w_i||²
r_i  = exp(−d²_i / (2 τ²))
r_i  = r_i / max_j r_j            # the best match is always 1
```
`τ` is chosen per song (D-024): at the median of ~1,024 sampled frames, `live.tau_target_share` (4%) of the cells have `r ≥ 0.5`, i.e. `τ = tau_scale · sqrt(median(d²_k − d²_min) / (2 ln 2))` with `k = share · 4096`. (The original `tau_scale · median BMU distance` varied 4-5× between songs and either lit one cell or the whole map.)

**2.3 Loudness-dependent glow width.** Blur `r` on the grid with Gaussian σ = `lerp(1.0, 3.0, loud)` cells (separable, two passes). Quiet passages give a tight point of light, loud passages a wide bloom. With `live.blur_renormalize` (on, D-024) the blurred field is rescaled so its peak stays 1; without it the blur divides a sharp peak by up to ~50 and the layer is nearly invisible.

**2.4 Temporal smoothing (asymmetric).** With display step `Δ` seconds:
```
k_up   = 1 − exp(−Δ / 0.040)      # attack 40 ms
k_down = 1 − exp(−Δ / 0.250)      # release 250 ms
A_i   += (r_i − A_i) · (r_i > A_i ? k_up : k_down)
```
`A` persists across display frames (a ping-pong texture on the GPU). Seeking resets `A` to the response at the new position.

**2.5 Diffusion.** `diffusion_passes = 2` per display frame:
```
A_i ← (1 − 0.20) · A_i + 0.20 · mean(A over the 8 neighbors of i)
```
This is what makes color flow like a liquid instead of jumping.

**2.6 Beat ripples.** A beat belongs to the display frame nearest to it (window `(s − Δ/2, s + Δ/2]`, so a beat fires at most half a frame early rather than up to a full frame late). Beat times are the onset-envelope peaks, parabola-refined to sub-frame precision and shifted by `live.beat_latency_s` (20 ms, the measured lag of flux peaks behind sharp clicks). At each such beat, if `onset ≥ 0.35`, spawn a ripple at the current BMU cell with amplitude `0.5 · onset`. Each ripple is a ring:
```
radius(t) = 24 · (t − t_spawn)              # cells
ring_i    = amp · exp(−(dist_i − radius)² / (2·1.5²)) · exp(−(t − t_spawn)/0.6)
```
Keep at most 8 ripples (drop the oldest). Add `ring_i` to the display intensity (not to `A`).

**2.7 Color.** For each cell, in OKLCH:
```
live_H = hue from color_t brightness (same formula as static, docs/ANALYSIS.md §7)
live_C = chroma from color_t harmonicity
m      = 0.85 · clamp(A_i + ring_i, 0, 1)                  # live_mix_max
L      = static_L + 0.30 · clamp(A_i + ring_i, 0, 1)        # live_lightness_boost, clamp ≤ 0.95
H, C   = mix static (H, C) toward (live_H, live_C) by m     # hue mixed along the shortest arc
```
Convert to sRGB with the shared OKLab code (GLSL port; tests compare with Python).

**2.8 Trail.** Draw the BMU path over the last 2.0 s as a soft line (width 0.8 cells) through cell centers, fading with age. Trail drawn under the dots, above the background.

**2.9 Dot drawing.** Same geometry as the static render (radius 0.34 · pitch, glow σ `render.glow_sigma_ratio` · pitch (0.30, D-018)), but radius may swell by up to +12% with `A_i`.

## 3. Reduced motion

When `prefers-reduced-motion` is set (or the in-app override is on): no ripples, no diffusion, release 500 ms, no dot swelling, trail off. The current region still brightens and fades smoothly.

## 4. GPU architecture (WebGL2)

- **Textures:** prototypes as a `RGBA16F` texture of size `(17·4096)` packed into 5 RGBA texels per cell (5×4 = 20 ≥ 17); frame features uploaded as a small uniform array per display frame (17 floats + 5 color + loudness + onset).
- **Pass 1 (response):** fragment shader on a 64×64 target computes `r_i` (17-dim distance, exp). Max normalization: a 2-pass reduction (64×64 → 8×8 → 1×1) or compute `exp(−(d² − d²_min)/2τ²)` using `d²_min` of the BMU computed on the CPU from `bmu_t` (preferred: cheaper; the BMU is precomputed).
- **Pass 2 (glow blur):** separable Gaussian on 64×64, σ from loudness.
- **Pass 3 (temporal + diffusion):** ping-pong `R16F` textures `A_prev → A_next`, then the diffusion passes.
- **Pass 4 (composite):** full-screen quad; for each pixel find its cell, draw the anti-aliased dot with color from §2.7, add ripples (uniform array of ≤ 8 ripples), trail (uniform array of recent cell positions).
- **Pass 5 (bloom):** half-resolution two-pass Gaussian blur of pass 4, screen-blended at 0.6.
- **Fallback:** Canvas2D at 30 fps computing the same math on the CPU in a Web Worker if WebGL2 is unavailable.
- Use `devicePixelRatio` up to 2 (cap at 2 for performance); resize on `ResizeObserver`.

## 5. Audio sync

- Playback via the Web Audio API (`AudioContext` + `AudioBufferSourceNode` decoded from the original upload, or an `<audio>` element routed through `MediaElementAudioSourceNode` for long files).
- Display time `s = ctx.currentTime − startTime − outputLatency` (use `ctx.outputLatency` when available, else `baseLatency`, else 0). Pausing and seeking update `startTime`.
- The render loop uses `requestAnimationFrame`, but all motion is computed from `s` and `Δ` derived from `s`, never from frame counts.
- **Drift test:** over 5 minutes, |visual frame index − audio frame index| ≤ 1 analysis frame (≈ 23 ms).
- Audio served is the decoded original during the session; if the server deleted the upload (`keep_audio: false`), the client plays its own local file object. Library songs without audio show the static signature only, with a "Re-add audio to play" hint.

## 6. Python reference preview (`preview.py`)

```
syn preview <audio file | song_id> [--audio FILE] --seconds 20 --start 30 --fps 30 --px 1080 [--reduced-motion] [--overlay]
```
Given an audio file the command analyzes it first (writing `out/<song_id>/` including `live.bin` and `proto.bin`); given a song ID it reads those files and needs `--audio`. Analysis time `s` is source-file time `s + audio_offset_s` (leading silence trimmed at ingest). `scripts/sync_check.py` renders the 120 BPM click track with `--overlay` and measures flash-versus-click time in the finished MP4.
- Recomputes §2 at 30 fps on the CPU (numpy), renders each frame with `render.py` primitives, pipes raw frames to `ffmpeg` (H.264, CRF 18, yuv420p), muxes the matching audio segment (AAC 192 kb/s).
- Writes `out/<song_id>/preview_<start>_<seconds>.mp4`.
- Used for the M3 gate and as the visual reference the WebGL renderer must match (side-by-side screenshot comparison at 5 timestamps; mean per-pixel difference ≤ 6/255 after both use identical parameters, ripples disabled).

## 7. Performance targets

- 60 fps on an Apple M1 MacBook Air (Safari, Chrome) and an iPhone 13 (Safari) at full-screen resolution.
- GPU frame time ≤ 6 ms on M1; no per-frame allocations in JS; frame data in preallocated typed arrays.
- Initial load of `live.bin` for a 4-minute song: about 9,200 frames × (17×2 + 2 + 1 + 1 + 5) bytes ≈ 400 KB; prototypes 4096 × 17 × 2 ≈ 140 KB. Serve gzip/brotli.

## 8. Inspector values

Hover (desktop) or long-press (touch) on a cell shows a popover: cell coordinates, static values (brightness Hz, loudness dBFS, noisiness, harmonicity, share of song), and live values (current match `A_i`, whether it is the BMU). Values update at 10 Hz to stay readable.

## 9. Later: live microphone input

Same shader; features computed on the fly in an `AudioWorklet` (mel, MFCC, centroid, flatness, RMS) and projected with a *reference* standardization and prototypes (no per-song SOM for live input). Out of scope until after M9.
