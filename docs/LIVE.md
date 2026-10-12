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
g      = clamp(A_i + ring_i, 0, 1)
m      = min(1, global_mix + 0.85 · g)                      # D-025: global_mix 0.40 moves the whole grid
L      = static_L + 0.18 · g + 0.16 · (2·loud − 1)          # live_lightness_boost, global_lightness_swing; clamp 0.05..0.86 (D-026)
H, C   = mix static (H, C) toward (live_H, live_C) by m     # hue mixed linearly on the palette scale (not the shortest arc); C × live_chroma_gain 1.4
```
Convert to sRGB with the shared OKLab code (GLSL port; tests compare with Python).

**2.8 Trail.** Draw the BMU path over the last 2.0 s as a soft line (width 0.8 cells) through cell centers, fading with age. Trail drawn under the dots, above the background.

**2.9 Node drawing.** The frame is pooled to the display grid (`render.display_grid`, D-030: colours by OKLab mean, radius scale by mean, trail coordinates mapped to node units) and drawn by the configured node style (`render.node.style`, `src/synesthesia/nodes.py`). The `dot` style uses the static geometry (radius `render.node.dot.radius_ratio` = 0.41 · pitch, glow σ `render.node.dot.glow_sigma_ratio` · pitch = 0.24, D-055), but radius may swell by up to +12% with `A_i` (to 0.46 · pitch, gap 0.08 · pitch at full swell). The response field, smoothing, diffusion and ripples all stay on the 64 × 64 analysis grid.

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

**As built (M7, D-042).** The response field, smoothing, diffusion, ripples, trail and per-cell colour run on the CPU in `web/src/engine/live.ts` (typed arrays, no per-frame allocation, about 4 ms per frame; a number-for-number port of `live.py`, tested against it). Gamut mapping uses a (lightness x hue) table plus a 9-step exact refinement. The GPU (`web/src/gl/`) draws the pooled 32 x 32 nodes: trail pass, dot pass, half-resolution Gaussian glow and a screen composite; shaders are `shaders/*.glsl`. The Canvas2D fallback draws the same pooled frame on the main thread (no worker needed at this cost). Parity with the Python preview: mean per-pixel difference 1.9-3.2 / 255 at five timestamps (budget 6).
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

## 10. 3D live view: stained-glass chips (M7b phase 3, D-046, D-056)

The default live view draws each of the 32 x 32 nodes as a shallow glass chip (three.js, lazily loaded
`web/src/three/`); "True colour" (key T) switches to the flat 2D renderer of section 4. Static card,
thumbnails and exports always use the 2D render (D-050, D-055).

- **Inputs:** the same pooled frame as the 2D renderer (node sRGB, radius scale) plus the pooled wave
  height (`EngineFrame.height`, mean over each 2 x 2 block).
- **Wave field** (`web/src/engine/wave.ts`, config `live.flow`): damped 2D wave equation on the 64 x 64
  grid, `wave_speed` 13 cells/s, `damping` 1.5/s, sponge border 7 cells (+3.5/s), carried by a current
  (`current_speed` 2.6 cells/s x (1 + 1.2 (loud - 0.5)), curl noise 0.30 at 0.11/cell, deterministic integer
  hash), sources: Gaussian (sigma 1.3 cells) at the best-matching cell x loudness (gain 0.85 x 10/s) and an
  impulse at each beat whose onset passes the ripple threshold (gain 1.6 x 14). Integrated at `substep_hz`
  120 up to the audio time with sources sampled per substep, so the surface is a function of audio time
  (not of the display rate); reset to flat on seek; at most 0.5 s of catch-up; |h| <= 1.
- **Chips** (config `web3d`): face colour = node colour (sRGB, no tone mapping, no conversion) with only
  zero-mean, headroom-limited modulation; lighting only on the rounded rim and sides. Surface z = 2.4 A +
  1.0 h pitch (A = pooled live activation, h = wave height, D-057); tilt = clamp(1.6 x slope of z) x 8 deg.
  Camera FOV 20 deg; straight on at rest; while playing it eases (spring 0.9 s, damping 1) into a
  three-quarter view (pitch 26 deg, yaw 10 deg, distance x 1.22). Pointer parallax <= 3 deg (spring 0.5 s),
  only while the pointer moves.
- **Trail** (D-057): the best-matching path of the last 2 s as a faint additive line (width 0.40 pitch,
  peak 0.45, fading with age) floating 0.60 pitch over the chip surface. A live overlay; none at rest.
- **Pause:** lift, wave and pose ease back (400 ms smoothstep for the surface, the pose spring for the
  camera). **Reduced motion:** no lift, no pose, no trail, no parallax.
- **Fidelity:** measured on straight-on renders by `web/tests/e2e/fidelity3d.spec.ts` (D-046 gates).
- **Versioning:** `web3d.live_view_version` (2, D-057) is bumped whenever a live-view or 3D parameter changes.
