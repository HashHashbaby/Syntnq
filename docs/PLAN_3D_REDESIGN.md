# Plan: premium 3D redesign of the web app (proposal, nothing built)

Status: **approved by the owner 2026-10-12** with the answers recorded in D-045..D-050 (section 10). Each phase
below ends in evidence and a stop. Where an answer differs from a recommendation below, the D-entry wins (font stack: D-048).

Skills read for this plan (owner asked for them): `apple-design`, `emil-design-eng`, `animation-vocabulary`,
`animate`, `animation-performance`, `review-animations`, `break-ui`. They are applied in the build phases
(each phase ends with `review-animations`, `animation-performance` and `break-ui`).

---

## 0. Where M7 stands (audit)

| Area | State |
| --- | --- |
| Built | React 18 + Vite + TS strict + Zustand; raw WebGL2 renderer (`web/src/gl/`, 5 shaders) drawing the 32 x 32 pooled grid; CPU live engine in TS (`web/src/engine/live.ts`, port of `live.py`, D-042); Canvas2D fallback; Web Audio clock; library on IndexedDB with paged queries; maps; export sheet stub; first landing (scroll stage, mapping key, handoff to the signature card); PWA; motion refinements (D-044). |
| Tests | Vitest 28, Playwright 81 (UI checklist in 48 contexts, motion, break-ui, WebGL vs Python parity 1.9-3.2/255). |
| Measured | 60.0 fps, frame p95 16.8 ms, CPU 6.2 ms/frame on an RTX 3050 laptop (discrete GPU). Not measured: integrated GPU, M1 Air, iPhone 13, Safari. |
| Approved | D-033 (UI direction), D-043 (contrast fixes), D-044 (motion rules, locked 2026-10-12). |
| Pending | **M7 gate sign-off by the owner** (package `out/ui_review/m7_approval/`). M8 (export) not started. 3D visuals: this plan is the specification the memory note asked for. |
| First-load size today | JS 229 kB (75.7 kB gzip), CSS 16 kB (4.1 kB gzip), no fonts (system stack). |

### Things the brief assumes that the repository does not say (need your ruling)

These are the "two sources disagree, stop and ask" cases from CLAUDE.md.

1. **"Approved flat-translucent stained-glass chips."** The approved look is D-030: **flat glowing dots**.
   The stained-glass chip (backlit transmission, lead gaps, rim glint) is **D-029, proposed and never
   approved**, parked on branch `m3-glass-look`. Phase 3 would revive D-029's look in 3D. Please confirm.
2. **"The existing ripple-tank wave height."** The current engine has **Gaussian beat rings** (LIVE.md 2.6),
   not a wave equation. The damped 2D wave equation ("river ripple", `live.flow.wave_speed` 13 cells/s,
   `damping` 1.5/s) exists only on `m3-glass-look`. Phase 3 would port it to the TS engine as a visual-only
   height field. Please confirm.
3. **"Fidelity gates."** They exist only on the parked branch (`scripts/lens_gates.py`): OKLab ΔE p95 ≤ 0.02,
   lightness r ≥ 0.99, mean hue error ≤ 3°, dim cells ΔL ≤ 0.02. I propose adopting exactly these.
4. **"`render_hash`", "freeze rules" and "the M8 rule that exports stay 2D".** None of these exist in
   `MILESTONES.md` or the code. I propose adding them (section 9.3).
5. **Existing locked rules this brief changes:** D-015 (raw WebGL2, no three.js), UI.md dark default,
   system font stack (UI.md 3), "no smooth-scroll hijacking, no animation framework, no idle loops" (D-044),
   "the signature canvas always sits on black" (UI.md 2). Each change below gets its own DECISIONS entry.

---

## 1. Reference study

### 1.1 landonorris.com (checked live, 2026-10-12, built-in browser, 800 x 450 viewport)

Method: sampled screenshots while hovering, holding still and scrolling; read the page's canvas list and the
names of shader uniforms in its public JS bundle to tell cursor-driven from time-driven motion. **Nothing is
copied** (no code, shaders, assets, layout, type, colour); notes describe behaviour only. Screenshots stay in
the session scratch area, not in the repo. The earlier frame-by-frame analysis of `ui_example/landowebsite.mp4`
(UI_REFERENCES.md section 4) still holds; I did not make a new recording because the built-in browser cannot
record video, and the uniform names answered the open question more reliably than frames would.

| What | Observed |
| --- | --- |
| Hero | A full-viewport WebGL canvas: a 3D head with the portrait projected onto it, on an off-white ground with faint contour lines. A wordmark top left, one lime button and a menu button top right. |
| **Cursor reveal: confirmed** | Your description is right. The pointer's eased position **and its speed** feed a fluid/trail texture; where the trail is strong, the face texture switches to the helmet livery, with a glitchy, blocky edge. Moving fast paints more helmet; the trail fades over roughly 1-2 s. A slow time-based noise keeps the edge alive when the pointer is still, so the hero never fully freezes. |
| Hover on helmet links | A separate wipe: a vertical transition with a sine-curved edge sweeps face to helmet. |
| First scroll | The cursor effect fades out over 0.25 s once the head section starts leaving; the hero shrinks into a framed rectangle on a dark olive ground while giant outline marquee text runs behind it (shared-element handoff). |
| Next | A huge lime signature stroke draws over a monochrome portrait (scroll-scrubbed vector animation); then a full-screen statement in very heavy uppercase type with highlighted words. |
| Further | A scattered photo collage that drifts with scroll; light contour-line ground returns; "On track / Off track" split with cut-out figures at the edges. |
| Scrolling | Inertial smooth scroll (the `lenis` class is set on `<html>`); scroll position is the master timeline for most scenes. |
| Buttons | Small, flat, lime; no glass, no blur. |
| Fonts | A variable grotesque plus a serif accent (both custom, not ours to use). |

What makes it feel premium, in principle: one hero object that persists and transforms; motion that responds
to the pointer's **speed**, not just position; scroll that scrubs scenes instead of revealing blocks; extreme
type scale contrast; a restrained palette with one accent; every transition is a handoff, never a cut.

### 1.2 Liquid glass on the web (research)

| Technique | How | Support (Oct 2026) |
| --- | --- | --- |
| Refraction | `backdrop-filter: url(#lens) blur(2px) saturate(160%)` where `#lens` is an SVG filter with `feImage` (displacement map) + `feDisplacementMap` | **Chromium only.** Safari: open WebKit bug, renders no refraction. Firefox: parses it, passes `@supports`, renders nothing, so detection cannot rely on `@supports`. |
| Frost and tint | `backdrop-filter: blur() saturate()` + translucent fill | All current engines. |
| Specular rim | inset box-shadows / gradient border on a pseudo-element, plus a soft top highlight | All engines (paint-only). |
| Limits | Refraction only samples pixels inside the element's box; not standardised (a W3C issue filed June 2026 is unassigned). | |

Sources: [WebKit bug 313914](https://bugs.webkit.org/show_bug.cgi?id=313914),
[LogRocket](https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/),
[ekino](https://medium.com/ekino-france/liquid-glass-in-css-and-svg-839985fcb88d),
[buildmvpfast recipes](https://www.buildmvpfast.com/blog/liquid-glass-css-backdrop-filter-recipes-2026),
[DEV: 6 ways](https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07).

### 1.3 `ui_example/`
Already reviewed (UI_REFERENCES.md). New relevance: the tech-stack note lists the studio's stack (three.js,
GSAP, Lenis, Rive, Draco, KTX2). We need only a small part of it (section 2).

---

## 2. Stack decision (proposed D-045, amends D-015)

**Recommendation: add `three` 0.186.1 (plain, imperative). No React Three Fiber, no drei, no GSAP, no Lenis,
no Rive.** The 2D raw-WebGL2 grid renderer stays as the reference renderer.

| Option | Bundle (gzip, est.) | Effort | Fit |
| --- | --- | --- | --- |
| A. Raw WebGL2 only (today) | +0 | High for disc, lighting, env reflections, instancing, camera; we would rebuild a small engine | Keeps D-015, but slow to reach the polish asked for |
| **B. three.js, imperative (recommended)** | ~130-160 kB, in a lazy chunk | Medium | Matches our imperative `GridRenderer` style; we write our own `ShaderMaterial`s so colour fidelity stays in our hands; React does not reconcile per frame |
| C. three.js + R3F + drei | ~190-230 kB | Lower for scene setup | R3F 9 requires React 19 (we are on 18.3); R3F 8 is the old line. A React upgrade adds risk across the whole app for convenience we barely need |

Architecture:
- **One three.js renderer, one transparent canvas, one rAF loop** for every 3D surface on a screen (grid
  chips, disc, landing hero), drawing each view into the rectangle of its DOM placeholder (scissor and
  viewport per view). One WebGL context instead of three; the DOM keeps layout, focus and accessibility.
- **The live engine is unchanged** (`live.ts`, D-042). Both renderers consume the same pooled frame
  (colours, activation, radius, plus the new height field from section 4). The Python parity test keeps
  testing the 2D renderer; a new test checks that the 3D faces show the same colours (section 5).
- **The 2D renderer stays** for: the "True colour" view, the static card, exports (M8), the Canvas2D
  fallback, reduced-transparency/low-power fallback, and the WebGL-vs-Python comparison.
- **Lazy loading:** `import("./three/scene")` only when a 3D view first mounts; the library, settings and 2D
  card paint without it. Vite `manualChunks` keeps three in its own chunk. Preload hint on landing only.
- **Assets:** no downloaded models. The disc is procedural (lathe geometry, grooves and anisotropic sheen in
  the shader); the environment light is generated at runtime (three's procedural room environment, PMREM).
  So there is nothing to Draco/Meshopt/KTX2-compress and nothing to license. If a model is ever needed: made
  by us in Blender, glTF with Meshopt, KTX2 textures, licence recorded in `docs/DATA_RESEARCH.md`.
- **Versions pinned exactly** (no `^`): `three@0.186.1`, `@types/three@0.186.0` (both published September 2026).

---

## 3. Feature: rotating disc for the playing track (phase 4)

- **Form:** a thin dark disc, smoked-glass body with fine concentric grooves (procedural normal), a narrow
  polished rim, a small spindle. Premium and quiet, not a cartoon record. It sits in the player area on
  desktop (beside the title) and as a compact disc in the phone player bar, plus the hero on the landing.
- **Label = the song's signature card**, rendered by the 2D renderer to an offscreen canvas and used as a
  texture (sRGB, no mipmap colour shift). The label uses an **unlit** shader: colours are the card's pixels
  exactly; one bounded specular sweep may cross it (capped, measured with the fidelity script).
- **Motion, driven by the audio clock** (all numbers in `config/default.yaml → web3d.disc`):
  - steady rate 33⅓ rpm = 3.49 rad/s; while playing at speed, `dθ/ds` is computed from audio time `s`, never
    from frame counts;
  - play/pause: angular velocity follows a critically damped spring to 3.49 or 0 (response ~0.6 s, a real
    platter's spin-up), so pressing pause coasts to a stop;
  - seek/scrub: while scrubbing, the disc turns with the scrubber (Δθ = ω·Δs, so dragging back spins it
    back); a jump seek animates the angle difference with a 300 ms spring;
  - reduced motion: no rotation; the angle is set to `ω·s` only on seek or pause, so position still means
    something.
- Lighting: one key light + generated environment for the body and rim only. Tone mapping off on label
  and chip faces (`NoToneMapping` for those materials) so no curve alters data colours.

---

## 4. Feature: 3D grid chips (phase 3)

- **Instanced mesh, 1,024 instances** (32 x 32), one draw call. Chip = shallow rounded box (bevelled
  slab, ~0.18 pitch thick), gaps ~0.08 pitch (the D-029 "lead" gap, dark, not white).
- **Look:** D-029's flat translucent glass in real depth: face is backlit transmission (data colour),
  mean-preserving absorption toward the edge, faint deterministic grain, thin dark gaps, one soft rim glint.
  **No uniform white outlines.** (Needs your confirmation, see section 0.)
- **Live:** the visual-only wave field (damped 2D wave equation on the 64 x 64 grid, sources = BMU x loudness
  and beat rings, pooled to 32 x 32) drives each chip's **z offset (≤ 0.35 pitch)** and **tilt from the local
  gradient (≤ 8°)**. Computed in `live.ts` from audio time like everything else; bounded and clamped;
  ~0.3 ms per frame estimated (4,096 cells, two passes).
- **Camera:** orthographic-like narrow FOV (~15°) so the straight-on view matches the 2D layout. Pointer
  parallax ±3° with a critically damped spring; optional slow orbit (±6°, one cycle per 40 s) **off by
  default** (D-044 and apple-design §14 discourage idle loops near 0.2 Hz; 0.025 Hz is far below, still
  opt-in). No orbit, parallax or z motion under reduced motion; chips lie flat.
- **Static card and exports stay 2D and deterministic** (proposed M8 rule, section 9.3).

## 5. Colour fidelity in 3D (non-negotiable)

- Chip face fragment = data sRGB at normal incidence, unlit. Lighting adds only: a rim/bevel highlight
  confined to the bevel (outside the face), capped at +0.06 L; side faces darker. Hue and face lightness are
  untouched by design; the gates verify it.
- `renderer.outputColorSpace = SRGBColorSpace`, data colours uploaded as linear-converted floats with our
  own OKLab code (`color/oklab.ts`) so three's colour management cannot double-convert.
- **Gates on a straight-on render** (new `web/tests/e2e/fidelity3d.spec.ts` + a Python checker reusing
  `lens_gates.py` maths): per-chip face-centre samples vs the 2D renderer's node colours, on 3 songs and 5
  timestamps: OKLab ΔE p95 ≤ 0.02, lightness r ≥ 0.99, mean hue error ≤ 3°, dim chips ΔL ≤ 0.02. Numbers
  reported each phase.
- **"True colour" toggle** (segmented control in the stage toolbar, key `T`): swaps to the flat 2D renderer
  instantly (keyboard) or with a 200 ms cross-fade (pointer).
- Glass UI never covers the signature square (UI_REFERENCES §7: chrome never alters signature colour).

---

## 6. Feature: landing page (phase 5; built as D-063 with two changes: the disc leans 12 deg instead of a 3/4 view, and the depth beat was dropped after D-058)

Our own content and layout; the *feel* of section 1.1, not its design.

| Beat | Scroll | What happens |
| --- | --- | --- |
| Hero | 0 | Large type "Hear the music. / See its signature." in heavy display size. Centre: the sample song's **signature card** (2D, stained-glass chips at rest). **Cursor reveal:** pointer position and speed paint a fading trail (our own 128 x 128 decay texture, ~1.5 s half-life); under the trail the card becomes the **live 3D grid** playing silently on the sample's timeline. Touch: drag paints; keyboard and reduced motion: a "See it live" button toggles the reveal. |
| Disc | 0-25 % | The card lifts off and becomes the label of the disc, which tilts into 3/4 view and starts turning (scroll-scrubbed angle, not idle spin). |
| Depth | 25-50 % | Back to the grid: chips rise into 3D as you scroll (z amplitude = f(scroll)), the wave runs; statements change with the D-044 dip through dark. |
| Maps | 50-75 % | The grid flattens and the structure map fades in, as today. |
| Key and actions | 75-100 % | **Mapping key (D-038)** set as a designed typographic panel (large hue ramp bar, three rows, honest "not a prediction" line), then "Add a song" and "Try a sample" (shared-element handoff to the signature card, as today). |

- **Scrolling: native, never hijacked (hand-rolled, recommended).** The page scrolls normally (keyboard,
  Page Down, Space, find-in-page, screen readers, scroll restoration all work). The *visuals* follow a damped
  copy of scroll progress (critically damped follow, ~120 ms) so scenes glide with inertia while input
  stays 1:1. This gives most of the Lenis feel at zero bytes and without D-044's objection. Alternative
  if you want true inertial scroll: `lenis@1.3.26`, only on the landing, disabled for reduced motion and touch.
- Skip always visible; shown once; replay in Settings (D-033 unchanged).

---

## 7. Visual system (phase 1)

### 7.1 Typography: Helvetica

| Option | What you get | Cost / risk |
| --- | --- | --- |
| (a) Licensed Helvetica Now (Text + Display, web licence) | The real face with optical sizes | About $300-500 for desktop packs on MyFonts; web licences at Monotype are typically priced by monthly pageviews and renewed yearly; price must be quoted. |
| **(b) TeX Gyre Heros, self-hosted (recommended)** | Helvetica metrics and shapes from URW's Nimbus Sans lineage; 4 styles (regular, bold, italics) + condensed | Free; GUST Font License (LPPL-based), embedding allowed as far as the README and Font Squirrel's reading go. No 500/600 weights and no optical sizes. The licence asks that modified versions (subsetting to WOFF2 counts) be renamed: we would ship it as "Syn Heros" with the licence file. |
| (c) Stack only | Helvetica Neue on Mac, Arial on most Windows machines | Free; inconsistent. |

Recommended stack: `"Helvetica Neue", "Syn Heros", Helvetica, Arial, sans-serif` (Mac users get the system
Helvetica Neue; everyone else gets the same self-hosted face). Note: **your PC has `Helvetica.ttf` and
`Helvetica-Bold.ttf` installed** in `C:\Windows\Fonts`, so a plain `Helvetica` already looks right *on your
machine* and would hide the problem; other Windows users would see Arial. With (b) the design uses two
weights only (400, 700), which suits Swiss typography; "optical sizes" are emulated with size-specific
tracking and leading. Upgrade path to (a) is a one-file `@font-face` swap. Licence to be re-read from the
current GFL text before shipping. Budget: Latin subset, 2 weights, WOFF2, ≤ 50 kB, `font-display: swap`,
preload the regular only.

Type scale (rem, so text size settings scale it):

| Style | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| Hero display | clamp(3.5rem, 9vw, 9rem) / 0.92 | 700 | -0.045em |
| Display | clamp(2.5rem, 5vw, 4rem) / 1.0 | 700 | -0.035em |
| Title 1 / 2 | 1.75 / 1.375rem, line 1.15 / 1.2 | 700 | -0.02em / -0.015em |
| Body / reading | 1.0625rem / 1.45 (app) and 1.6 (reading) | 400 | -0.005em |
| Footnote / caption | 0.8125 / 0.75rem, line 1.4 | 400 | +0.01em / +0.02em |
| Data | tabular-nums everywhere numbers change | 400 | 0 |

### 7.2 Colour: light default

- **Light (new default):** ground `#F6F4EF` (warm off-white), raised `#FBFAF7`, grouped `#EDEAE3`, ink `#141414`,
  secondary ink `rgba(20,20,20,0.66)`, hairlines `rgba(20,20,20,0.10)`, accent: one restrained ink-blue
  `#2B4BF2` for focus/links, filled buttons in ink black. All text pairs checked at AA (≥ 4.5:1) before
  freezing.
- **Dark (setting):** today's tokens, kept for the gates.
- **The signature card on a light page:** the glow and the backlit glass both need a dark ground. Proposal:
  the card is a **dark "lightbox" object** (deep `#0B0B0C`, soft contact shadow) placed on the light page,
  like a backlit panel on a gallery wall. This keeps D-026 colour limits valid. (Decision needed.)

### 7.3 Liquid-glass controls

Three tiers, chosen once at start-up:

| Tier | When | Material |
| --- | --- | --- |
| A Refraction | Chromium (detected by engine, since Firefox passes `@supports` falsely), transparency allowed, not over a live canvas above the area budget | `backdrop-filter: url(#syn-lens) blur(6px) saturate(170%)` with our own generated displacement map (rounded-rect edge bend), tint, specular rim (inset highlights, bright top edge), soft drop shadow via `filter: drop-shadow` |
| B Frost | Safari, Firefox, or over-budget | blur + saturate + tint + the same rim |
| C Solid | reduced transparency or `prefers-contrast: more` | solid fill, 1 px contrasting border |

- Press: `scale(0.97)` on pointer-down (D-044) plus a spring on release (response 0.3 s, damping 0.8 only
  after a flick); hover lifts the rim highlight (behind `hover: hover`). Focus ring: 2 px ink-blue ring
  outside the rim with a 2 px gap, visible on glass and on the dark card.
- **Performance risk:** a backdrop filter over a canvas that changes every frame is re-filtered every frame.
  Phase 1 builds a stress page (0 / 6 / 12 / 24 glass controls over the live canvas) and measures frame time;
  the result sets a **glass-area budget** (e.g. the sum of glass rectangles over a live canvas ≤ N % of the
  viewport) and which controls drop to tier B while playing.
- Lucide icons stay. No Apple assets, fonts or names.

---

## 8. Feature: loading mural (phase 2)

- **When:** only while the 3D chunk loads and its first frame compiles. Show after a **150 ms delay** (built with **400 ms**, D-052: measured first paint is 176-247 ms)
  (fast loads never see it); once shown, keep it **≥ 600 ms** so it does not flash; cross-fade out in 300 ms
  into the first rendered frame. On repeat visits the chunk is cached and the mural normally never appears.
- **Where:** inline in `index.html` (HTML + ≤ 6 kB CSS, no JS dependency) so it renders before any bundle;
  inside the app it fills only the 3D stage area.
- **Look:** a 12 x 8 mural of dark stained-glass tiles in the app's hue ramp (265° to 30°, very low
  lightness), thin dark lead lines. Tiles flip on Y one after another in a diagonal sweep (CSS 3D
  `rotateY`, `preserve-3d`, staggered delays from distance); as a tile turns edge-on, light from behind
  "leaks" through: a static radial white backlight layer, a pre-blurred bloom layer (blur is static, never
  animated), and a faint dust/caustic texture (inline SVG `feTurbulence`, static). Only `transform` and
  `opacity` animate.
- Reduced motion: static backlit mural with one gentle opacity breathe-in, then the fade out.

---

## 9. Quality bars and process

### 9.1 Performance budget
| Item | Budget |
| --- | --- |
| First load (landing or library), JS | ≤ 110 kB gzip (today 75.7) |
| 3D chunk (three + our scene code) | ≤ 170 kB gzip, lazy |
| Fonts | ≤ 50 kB |
| Models / textures | 0 (procedural) |
| Frame at 1440 x 900, integrated GPU | p95 ≤ 16.7 ms with grid + disc + glass on screen; target ≤ 14 ms |
| Split | CPU engine ≤ 6.5 ms, three.js draw ≤ 5 ms GPU, glass compositing ≤ 3 ms |
| Adaptive quality | DPR clamp 1.5 on integrated GPUs, then drop bloom/env reflections, then glass tier B, driven by a frame-time governor |

**How we test integrated graphics:** your laptop has an RTX 3050, which in most laptops sits next to an Intel
or AMD integrated GPU. Setting Chrome to "Power saving" in Windows Graphics settings runs it on the
integrated GPU (confirmed in `chrome://gpu`). The existing `perf.spec.ts` reports p50/p95/max frame time and
CPU time per frame; it gains a 3D scenario. 120 Hz screens get the same budget at 60 fps (frame-rate cap)
unless the governor has headroom.

### 9.2 Accessibility
Reduced motion: no orbit, parallax, chip z, disc spin or scroll scrubbing; fades instead. Reduced
transparency: glass tier C, mural without bloom. Focus styles designed for glass and the dark card. Contrast
AA on light and dark, including text on glass over the brightest cells (existing white-dot screenshot test).
3D canvases are `aria-hidden`; the existing `role="img"` description stays on the stage.

### 9.3 Freeze rules to add to MILESTONES
- `render_hash` (new): SHA-256 of the 2D static render parameters + the 2D shader sources, written into the
  web params and the export metadata. Any change to the signature render bumps it and re-runs the fidelity
  gates and the WebGL-vs-Python comparison.
- `live_view_version` (new): bumps whenever a live-view or 3D parameter changes; recorded in DECISIONS.
- M8 rule: exports and the static card are always the 2D deterministic render, never the 3D view.
- Every new number (disc rpm, spring constants, chip thickness, wave constants, parallax limits, mural
  timings) goes into `config/default.yaml` (`web3d:` block) and reaches the web through `params.json`.

### 9.4 Where this fits the gates
I propose: you sign off M7 as built (or list what blocks it), then this work runs as **M7b "3D redesign"**
before M8, each phase a mini-gate. M8's export stays on the 2D renderer, so nothing here blocks it.

### 9.5 Phases (each ends with screenshots at 390 x 844, 820 x 1180, 1440 x 900, light and dark, a short
screen recording, `review-animations` + `animation-performance` + `break-ui`, then a stop for approval)

| # | Phase | Main files | Evidence | Size |
| --- | --- | --- | --- | --- |
| 1 | Tokens: type, light/dark colour, glass tiers; glass stress test | `styles/tokens.css`, `styles/app.css`, `public/fonts/`, `components/Glass.tsx`, `dev/glass-stress` | static screenshots, contrast table, glass frame-time table | M |
| 2 | Loading mural | `index.html`, `styles/loader.css`, `three/loader.ts` | recording, timings (delay, min, fade), reduced-motion still | S |
| 3 | 3D grid chips + wave field + true-colour toggle | `three/scene.ts`, `three/chips.ts`, `three/shaders/*.glsl`, `engine/live.ts` (height field), tests | **fidelity numbers**, frame times on iGPU, recording | L |
| 4 | Rotating disc | `three/disc.ts`, `audio/clock.ts` hooks | recording of play/pause/seek, rpm measured from frames | M |
| 5 | Landing | `screens/FirstLanding.tsx`, `three/reveal.ts` | recording, keyboard-only and reduced-motion runs | L |
| 6 | Polish pass across all screens | all | full checklist, final perf table | M |

DECISIONS entries to write as phases are approved: D-045 stack (phase 1 start), D-046 type and colour,
D-047 glass tiers, D-048 loader, D-049 3D chips + wave + fidelity gates, D-050 disc, D-051 landing and
scroll approach. UI.md and LIVE.md are updated in the same commit as each.

### 9.6 Risks
| Risk | Mitigation |
| --- | --- |
| Integrated GPU misses 60 fps with glass over the live canvas | glass-area budget, tier B while playing, governor |
| three.js colour management shifts data colours | own shaders, tone mapping off on data, fidelity gates every phase |
| Two WebGL contexts (2D + 3D) on one screen | only one renderer mounted per stage; toggle swaps them |
| WebGL context loss on laptops switching GPUs | `webglcontextlost` handler, fall back to the 2D renderer |
| Safari and iPhone untested (no devices) | stated as unverified, as in D-042 |
| Landing too close to the reference | our own content and layout; no copied code, assets, fonts or colours |
| Scope (6 phases) | each phase is usable alone; stop after any phase |

---

## 10. Questions for the owner (needed before phase 1)

1. Revive the **D-029 stained-glass chip** look (unapproved, parked) for the 3D view, while the 2D
   true-colour view stays the approved flat dots (D-030)? Or should the 2D view become chips too?
2. Signature card on the light page: **dark lightbox card** (recommended) or a light ground?
3. Font: **(b) TeX Gyre Heros as "Syn Heros"** (recommended), (a) buy Helvetica Now, or (c) stack only?
4. Stack: **plain three.js** (recommended) or R3F + drei with a React 19 upgrade?
5. Scrolling on the landing: **native scroll with damped visuals** (recommended) or Lenis?
6. Gate placement: sign off M7 now and run this as **M7b** before M8?

---

## 11. Phase 2b: graphite redesign (owner request 2026-10-12, plan only; nothing built)

Inserted before phase 3. It changes the look of phases 1 and 2; phases 3-6 then build on it.

### 11.1 What the owner asked for
1. Loading page dark; keep the "SYNESTHESIA" wordmark under the mural; keep the tile chips and make them bigger.
2. Main app: the 32 x 32 grid larger on screen, and each node larger in radius.
3. The whole site on a **dark grey gradient**, almost black behind the grid square, instead of a light page
   with an opaque black card.
4. Side bars and sections as **floating, white-tinted glass panes with refraction** over that gradient
   (library and upload section, inspector, toolbar, player bar, sheets).

### 11.2 Conflicts with locked decisions (need explicit owner approval)
| Request | Conflicts with | Consequence |
| --- | --- | --- |
| Dark grey gradient everywhere | D-047 (light default, signature on a dark lightbox card) | New decision superseding D-047's default and card; light theme kept only as a setting (or dropped, owner's choice) |
| Larger node radius | **D-050 render freeze**: the dot radius (`render.node.dot.radius_ratio` 0.34) is part of the frozen 2D static render, and M7b may change only the 3D/live view and chrome | Changing it re-opens the frozen render: DECISIONS entry, new `render_hash`, Python renders, exports (M8), WebGL-vs-Python parity and the fidelity gates all re-run on the new radius |
| Larger grid on screen | none (stage size is app chrome) | Free to change |
| Dark, larger loading mural | D-052 (proposed, not yet approved) | Amend D-052 |

### 11.3 Proposed design
**Background ("graphite").** One fixed, full-viewport layer: a radial gradient centred on the grid square,
`#000` at the square (the canvas background is `#000`, so the square's edge disappears and the grid looks
lit from inside the page), easing to `#121214` around the square and `#2A2A2E` at the far corners. A
faint static grain (the mural's noise texture at about 4 %) stops banding on 8-bit screens. The gradient's
centre follows the stage rectangle (set by a ResizeObserver, never per frame). The card's edge and shadow
are removed; the corner radius of the canvas stays.

**Ambient light (optional, recommended so that refraction is visible).** Glass over a smooth gradient has
nothing to bend, so refraction would be invisible. Option: a very dim, heavily blurred copy of the static
signature colours (a 16 x 16 downsample, blur about 120 px, at most 12 % opacity) spread behind the panes,
far outside the grid square. It gives the panes something to refract and ties the page to the song, like
album-art backdrops. It never draws over the grid square. Simultaneous-contrast risk: measured with the
fidelity script on the square's pixels with and without it.

**Floating glass panes.** Every region becomes a pane floating 12 px from the edges and from each other
(8 px on phones), radius 24 px, white-tinted glass: tint `rgba(255,255,255,0.07-0.10)`, refraction lens
generated per pane size (the existing `glass.ts`, larger bezel about 24 px on panes), blur 10-14 px,
saturate 140 %, bright top rim, hairline edge, soft dark shadow so the pane lifts off the gradient.
- Desktop: library pane (left, 320 px, holds search, sort, list and the add/upload section, which becomes
  its own floating bar at the top of that pane), inspector pane (right, 280 px), toolbar as a floating
  pill above the grid, player as a floating pill below it, sheets as glass panes.
- Phone: library becomes one full-height pane; on the signature screen the toolbar and player float as
  pills over the gradient.
- Panes never overlap the grid square (chrome never alters signature colours, D-046/D-047 rule kept).
- Text: white ink on tinted glass; secondary text checked AA on the brightest point of the gradient and
  the ambient glow.

**Bigger grid on screen.** The square grows to the largest square that fits between the panes:
desktop `min(available width, 100vh - 168px)` instead of `100vh - 260px` (about +90 px at 1440 x 900),
phone full width minus 16 px. This is chrome only and needs no decision.

**Bigger nodes (needs the freeze lifted).** Today the dot radius is 0.34 of the node pitch (gap 0.32
pitch). Candidates: 0.38, 0.41, 0.44 (gap 0.24 / 0.18 / 0.12 pitch). Above about 0.40 the glow (sigma 0.30
pitch, opacity 0.30) starts to fill the gaps and mix neighbouring hues, which was the D-017 problem, so a
larger radius likely needs a slightly smaller glow sigma (about 0.24). Before deciding: a contact sheet of
3 songs x 4 radii x 2 glow settings from the Python renderer, plus the same in the web app.
Alternative if the freeze should stay: keep 0.34 for the static view and exports, and give the 3D live
chips (phase 3) the larger size only.

**Loading mural.** Ground becomes the graphite gradient (black at the centre); the mural grows to
`min(92vw, 960px, (100vh - 9rem) x 1.5)`, so tiles are about 75 px at 1440 x 900 instead of 44 px; same
12 x 8 tiles, same sweep and backlight; the wordmark stays below in the same type, slightly larger
(0.875 rem) and lighter (62 % white). The in-app cover uses the same ground.

### 11.4 Performance
Large panes are the expensive part of glass: blur cost grows with pane area. The backdrop behind the panes
is static (gradient, optional ambient glow), so the browser re-filters only when something under a pane
changes; the live canvas is never under a pane. Measured before approval with the stress page extended to
panes: frame time uncapped with 0, 2 and 4 panes, refract vs frost, at 1440 x 900, and the same with the
grid playing. Budget unchanged (glass <= 3 ms on the reference GPU). Integrated graphics still unverified.

### 11.5 Steps and evidence (phase 2b, one stop)
1. Comparison images first, no app changes: background gradient (3 strengths), pane tint (3 levels),
   ambient glow on and off, node radius 0.34 / 0.38 / 0.41 / 0.44 with glow 0.30 and 0.24. Owner picks.
2. Decisions: D-053 graphite default (supersedes D-047 default and card), D-054 floating glass panes,
   D-052 amended (dark, larger mural), and only if approved D-055 node radius with a new `render_hash`.
3. Build: tokens and background layer, pane layout, stage sizing, mural; glass lens bezel per pane size.
4. Tests: UI checklist (48 contexts), contrast on panes, pane cost table, loader tests, render freeze
   (unchanged, or re-frozen under D-055 with parity and fidelity re-run).
5. Evidence: screenshots at 3 sizes, recording, `review-animations`, `animation-performance`, `break-ui`.

---

## 12. Phase 4b: longer start mural, live trail graph (owner request 2026-10-12; approved with all recommendations 2026-10-13, built as D-061, D-062)

### 12.1 Start mural stays too briefly

**Why it is short today (D-052).** The boot mural in `web/index.html` appears only if loading takes longer than
`delay_ms` 400, stays at least `min_ms` 600, then fades in `fade_ms` 300. A normal start therefore shows it for
about 0.6-1.0 s, starting 0.4 s in. One full diagonal sweep needs 1.93 s: the flip runs from 8 % to 36 % of the
2.6 s period (208-936 ms) and the last of the 12 x 8 tiles starts (11 + 7) x 55 = 990 ms late. So the owner
sees the first tiles mid-flip and never the finished sweep.

**Proposal.** Treat it as the opening on a cold start, not a loading spinner:
- shown from the first paint (`delay_ms` 0) on every cold start of the app;
- stays for one full sweep plus a short hold on the finished mural with the wordmark:
  `min_ms` = 1,930 + 420 = **2,350 ms**, then a **450 ms** fade (was 300);
- if loading takes longer, it keeps sweeping (the animation already loops) until the app has painted;
- skippable: any key, click or tap after 600 ms starts the fade;
- reduced motion: the static mural for **1,000 ms**, then the fade;
- the in-app mural for the 3D chunk (`LoadingMural`, D-052 gate 400 / 600 / 300) is unchanged;
- the timings move from the inline JSON to `config/default.yaml` (`ui.mural`) and reach `index.html`
  through the fixtures script, with a unit test keeping them equal (as the hue range is today).

Cost: a cold start now holds the user for about 2.35 s even when the app is ready sooner. Options
for the owner: (a) every cold start (recommended, as asked), (b) only the first start per browser session,
later reloads fast.

### 12.2 Live trail graph

**What it shows.** A new floating glass pane with a chart whose axes are the two features the grid's
orientation already uses (D-031: brightness up, loudness right), in physical units:
- **x: Loudness, dBFS** (frame RMS, `20 log10 rms`), linear, -46 to -18 dBFS, ticks every 5 dB;
- **y: Brightness, spectral centroid in Hz**, log scale, 406 Hz to 4.09 kHz, ticks 500 Hz, 1 kHz,
  2 kHz, 4 kHz; a thin hue strip on the y axis (265 deg at the bottom to 30 deg at the top), the same
  mapping that colours the grid, so the chart also explains the colours;
- the axis ranges are the frozen global calibration ranges (`config/calibration.yaml`, 2nd-98th
  percentile over 30 tracks), so every song is drawn on the same axes and songs can be compared;
  values outside are pinned to the edge and drawn as an open marker;
- **the trail:** the last 2 s (`live.trail.length_s`, the same window as the grid's trail) as a line
  fading with age, and a dot at the current moment filled with the current live colour;
- **context (recommended):** the whole song as a faint static density cloud behind the trail, so you
  see where "now" sits within the song.

Note: the grid places sounds by similarity per song; this chart places them by absolute loudness and
brightness. The two trails move together but trace different shapes. That's expected, and the caption
says so.

**Data, no API change.** `live.bin` already carries `color_t` (T x 5 u8): brightness and loudness
normalised over the same calibration ranges. Brightness is `log10 Hz`, so the chart reads
`log10 Hz = lo + q / 255 x (hi - lo)` back to Hz, and the same for dBFS. Resolution: 0.11 dB and 0.9 % in Hz
per step, finer than the smoothing (9 frames, about 0.2 s). Interpolated between frames exactly like the
engine (LIVE.md 2.1).

**Same time as the grid, by construction.** The chart doesn't run its own clock. `GridCanvas` already
computes `s = analysisTime(player.position(), audioOffsetS)` once per animation frame. It will publish that
`s` to subscribers in the same `requestAnimationFrame` callback, and the chart draws from that exact
value in the same frame. A test asserts that the grid and the chart report the identical `s` on every
frame (not merely "close").
Behaviour: playing, it follows `s`; seek, the trail resets (as the grid's does after a jump of more than 0.5 s);
pause, the trail fades out over the grid's 400 ms and the dot stays at the paused moment.

**Drawing.** Canvas2D for the trail and dot (about 86 segments per frame, well under 0.2 ms); axes, ticks and
labels as static SVG/DOM text in TeX Gyre Heros with tabular figures, so they stay crisp and readable by screen
readers. `role="img"` with a live text alternative updated at 2 Hz, for example "Loudness -24 dBFS, brightness
1.6 kHz". Reduced motion: no fading trail, the dot only.

**Where it sits.**
- Desktop (>= 1069 px): in the right column, a pane under the inspector, square, the column's width (about
  280 px).
- Tablet: under the stage, beside the player.
- Phone: a pane under the player bar, full width, above the inspector.
- A small toggle (chart icon, key G, remembered) hides it.

This also resolves the phase-4 break: on phones the time label can go to its own row in the new layout, so the
scrubber keeps its width at 320 px and 200 % text.

**Numbers in config** (`ui.trail_graph`): trail length (default `live.trail.length_s`), tick sets, cloud
opacity, line width, dot size, alt-text rate.

**Tests and evidence.**
- Unit: dequantisation against Python's physical values (a fixture of 20 frames per song, error <= half a
  step), axis tick placement, log scale.
- e2e: same `s` in grid and chart per frame; chart dot position vs the interpolated value at that `s`; seek
  resets the trail; reduced motion.
- Screenshots at 390 / 820 / 1440, a recording of grid and chart together, frame-time table (target: no
  change in p95), and the break-ui pass on the new pane.

**Decisions to record:** D-061 start mural timing; D-062 trail graph.

### 12.3 Questions for the owner
1. Start mural: (a) every cold start, about 2.35 s (recommended), or (b) first start per session only?
2. Chart axes: loudness (dBFS) by brightness (Hz) as above (recommended), or a time chart instead (x = time in
   seconds, y = one feature)?
3. Trail length on the chart: 2 s like the grid (recommended), or longer (for example 8 s) so the shape reads
   better?
4. Show the faint whole-song cloud behind the trail? (recommended: yes)
