# UI references from screen recordings (draft, nothing applied)

Status: **approved by the owner 2026-10-12 and applied** (D-044; `docs/UI.md` sections 2, 5, 6, 7, 8). Conflicts
C1-C10 were resolved as recommended in section 6. The 3D visuals the owner asked for are not covered here and
wait for a specification.

Inspiration only. No code, assets, fonts, icons, logos, copy or exact layouts are copied from any site,
and no Apple assets are used. Frames and recordings stay in `out/ui_review/` (git-ignored); this file
holds only numbers, descriptions and frame references. It complements `docs/REFERENCES.md`, which holds
values measured from the live pages' computed styles; this file measures *motion* from recordings.

## 1. Inventory

| File | Type | Size / length | What it shows |
| --- | --- | --- | --- |
| `ui_example/applewebsite.mp4` | H.264 screen recording, 1916 x 904, 30 fps, AAC audio | 31.3 MB, 41.8 s (1,255 frames) | Scroll-through of a product page: highlights carousel, a rotating 3D device with an option list, camera close-up, a card carousel, battery, chip and thermal sections |
| `ui_example/landowebsite.mp4` | H.264 screen recording, 1918 x 908, 30 fps, AAC audio | 28.9 MB, 31.4 s (941 frames) | Scroll-through of an athlete portfolio: hero portrait with animated visor mask, hero-to-section handoff, marquee and statement text, collage, helmet grid, merchandise, partners, social-card fan, footer |
| `ui_example/landowebsitetechstack.txt` | UTF-8 text, 13.8 KB, 583 lines | one document, 14 numbered sections | A chat-style write-up of how the portfolio site is built (stack, scroll model, assets) |

Both recordings have audio tracks; I did not transcribe or analyse them. Everything readable was read.

## 2. Method and what the numbers can and cannot say

- Extracted with ffmpeg into `out/ui_review/`: a frame every 1 s, scene-change frames (`scene > 0.3`: 3 in
  the Apple recording, 8 in the portfolio recording; too sparse to be useful on slow dissolves), and every
  frame at the native 30 fps across 13 chosen transitions.
- **Duration** = span where frame-to-frame change exceeds a noise-adaptive threshold, and "10-90 %" = time
  between 10 % and 90 % of the cumulative motion. Resolution is one frame (33 ms).
- **Easing** is estimated by phase-correlating consecutive frames (global translation), accumulating the
  displacement and comparing the curve with linear / ease-out / ease-in / ease-in-out. This is only
  meaningful for rigid slides. **Scroll-driven motion follows the person's wheel or trackpad, so a "linear"
  result there is the recording of a human scroll, not a designed curve.** I mark each row accordingly.
- Not measured from the recordings: type sizes, spacing, colours (see `docs/REFERENCES.md`, measured from
  the live DOM). Frame sizes here are 1916 px wide; I did not calibrate pixels to CSS px.

Contact sheets (all in `out/ui_review/sheets/`): `apple_1fps.png`, `lando_1fps.png`, and one per transition
named below. Labels `fN` are frame index at 30 fps from the start of the clip.

## 3. Recording A: product page (apple recording)

### What it shows (1 fps sheet `apple_1fps.png`, t in seconds)

| t | Content | Notes |
| --- | --- | --- |
| 0-5 | "Get the highlights" card carousel; neighbouring cards peek at both edges | pagination dots and a pause control underneath |
| 5-7 | camera section scrolls in; a heading rises into place | |
| 7-14 | a 3D device model rotates beside an option list that builds row by row | list rows appear t = 8-10 |
| 15-18 | extreme close-up of the camera module with a faint title | |
| 19-21 | previous text fades to near-black, then a new two-line statement fades in | clean dip, no overlap |
| 21-26 | row of photo cards with small captions; cards slide horizontally | |
| 26-29 | battery-life statement above a framed video | |
| 33-35 | charging scene | |
| 36-38 | chip scene with a glowing chip image | |
| 39-41 | thermal scene with a device cut-away | |

### Measured transitions

| Id | Sheet | Clip (s) | Motion | 10-90 % | Shape | Reliable? |
| --- | --- | --- | --- | --- | --- | --- |
| A1 carousel slide | `apple_a1_carousel_slide.png` f0-f38 | 1.73-2.80 | ~900 ms, 734 px travel | 667 ms | near-linear (RMSE 0.07 vs 0.17 ease-in-out); peak velocity 35 % in | medium (likely auto-advance) |
| A2 carousel to next card | `apple_a2_carousel_to_camera.png` f0-f35 | 3.43-4.40 | ~870 ms, 1,748 px | 633 ms | **ease-in-out** (0.11 vs 0.12 linear); peak velocity at 48 % | medium |
| A3 heading rises | `apple_a3_section_enter.png` | 5.27-5.73 | ~500 ms | 333 ms | scroll-scrubbed | low |
| A4 list select + rotate | `apple_a4_list_select.png` | 14.77-15.43 | ~630 ms | 567 ms | scroll-scrubbed | low |
| A5 dip to dark, new statement | `apple_a5_cinematic_in.png` f0-f27 (every 2nd frame) | 18.9-20.53 | ~1.5 s total; old content gone by ~0.5 s, new fades in ~0.8 s | 1.3 s | fade out then fade in, **no overlap** | high (visual) |
| A6 card row slide | `apple_a6_scroll_cards.png` | 23.53-25.27 | ~1.1 s, 1,198 px | 867 ms | scroll-scrubbed | low |
| A7 text swap | `apple_a7_text_swap.png` | 30.13-32.17 | ~1.2 s | 500 ms | scroll-scrubbed | low |
| A8 charging to chip | `apple_a8_charge_to_chip.png` | 34.5-36.43 | ~1.9 s | 1.6 s | ease-out fit (0.14 vs 0.18 linear); velocity peaks at start | low (scroll inertia) |

No spring overshoot was found in any transition (overshoot 0 % in A1-A6, A8; A7's 30 % is a scroll
back-off artefact of the estimator, not a designed bounce).

### Qualities worth borrowing
1. **Peeking neighbours.** Cards beside the active one are cropped at the edges, so the row reads as
   swipeable without arrows (A1, A2).
2. **Dip through dark between statements** (A5): the old text leaves first, the stage rests, the new text
   arrives. Two states never share the screen, which avoids the double-image look of a cross-fade.
3. **The hero object persists** while text changes around it (3D device, chip image).
4. **One short statement plus one small supporting line** per scene; large near-white text on black.
5. **Slide of ~0.6-0.9 s with ease-in-out** for a content row (A2), clearly slower than UI feedback and
   used only for large editorial moves.

### What does not suit SYNESTHESIA, and why
- Product photography, device renders and marketing copy: we have one hero, the signature.
- 0.9-1.9 s transitions for everyday UI: the library, sheets and inspector are used repeatedly; they stay at
  0.2-0.35 s (UI.md section 8).
- Autoplaying carousels: our maps are user-chosen views, not a slideshow.

## 4. Recording B: portfolio site (landonorris recording)

### What it shows (1 fps sheet `lando_1fps.png`)

| t | Content |
| --- | --- |
| 0-10 | light hero with a portrait; a patterned visor mask wipes on and off the face repeatedly (idle loop) |
| 11-13 | **hero scales down into a framed rectangle** on a dark green ground while marquee text slides in and a lime stroke is drawn |
| 13-15 | large statement text with highlighter bars revealing |
| 15-17 | scattered photo collage on a grey ground |
| 18-19 | split headline over a helmet close-up |
| 19-23 | helmet grid on black; a horizontal band scrolls |
| 24-26 | merchandise and partner rows on off-white |
| 26-28 | a phone mock-up turns into a fan of social cards that spreads |
| 28-30 | footer on dark green with a lime frame; the hero returns |

### Measured transitions

| Id | Sheet | Clip (s) | Motion | 10-90 % | Shape | Reliable? |
| --- | --- | --- | --- | --- | --- | --- |
| L1 hero to framed card (dark) | `lando_l1_hero_to_dark.png` f0-f13 | 11.33-11.57 | ~230-430 ms; scale-down + ground colour flip + diagonal wipe | ~200 ms | fast (mostly done in 4-6 frames) | medium (energy only) |
| L2 statement reveal | `lando_l2_text_reveal.png` | 12.97-14.10 | ~1.1 s | 833 ms | scroll-scrubbed | low |
| L3 long scroll | `lando_l3_long_scroll.png` (every 4th) | 16.27-21.23 | ~3.5 s, 4,359 px | 3.1 s | near-constant speed | low (user scroll) |
| L4 section to partners | `lando_l4_to_collab.png` | 26.87-27.80 | ~430 ms, 383 px | 333 ms | **ease-out** (0.13 vs 0.16 linear); peak velocity at 25 % | medium |
| L5 social cards to footer | `lando_l5_social_footer.png` | 28.17-28.53 | ~500 ms, 954 px | 333 ms | **ease-out** (0.14 vs 0.15 linear) | medium |

Cross-check with `docs/REFERENCES.md`: that file measured the page's main CSS easing as
`cubic-bezier(0.65, 0.05, 0, 1)` at 0.75 s on 100+ elements. The recording agrees in character (long,
soft ends for large moves); the fastest section moves (L1, L4, L5) are shorter than 0.75 s because they
are scroll-triggered handoffs, not hover/colour transitions.

### Qualities worth borrowing
1. **Shared-element handoff** (L1): the hero does not cut away; it shrinks into the frame that the next
   section uses. For us: the signature canvas resizes from the landing stage into the library/signature card.
2. **Time-based reveals of about 0.33-0.5 s with an ease-out** (L4, L5) for things that arrive after an
   event rather than under the finger.
3. **Ground colour flips as the state change** (light to dark green) instead of extra decoration.
4. **One accent colour against a muted ramp.** Already in UI.md principle 1; for us the signature is the accent.

### What does not suit SYNESTHESIA, and why
- Idle loops on the hero (the visor wipe repeats): a loop on the stage competes with the signature, and it
  would run against the research claim that the colours come from the audio only.
- Pinned horizontal tracks, marquee text, all-caps heavy display, lime accent, custom fonts, collage layouts.
- Orientation lock and a loader longer than the work (already rejected in REFERENCES.md).

## 5. The text guide (`landowebsitetechstack.txt`)

It is a secondary source written in a chat style; its claims come from a third-party reverse-engineering
write-up, and I did not fetch the links or verify the versions. I read it in full (583 lines, 14 numbered
sections). Concrete points, with section numbers:

| Section | Claim | Use for us |
| --- | --- | --- |
| 1, 14 | Site structure from a site builder; the "impressive" parts are a custom JS bundle on top | none: we already build custom |
| 2 | scroll position is converted to animation parameters by a timeline library | **already our model** (stage state = f(scroll), D-033) |
| 3 | a smooth-scroll library interpolates wheel input before the page sees it | **not adopted**: it takes over native scrolling, which UI.md and accessibility rely on |
| 4, 5, 12 | a real WebGL scene; geometry and texture compression; lazy-load expensive assets and initialise on need | lazy initialisation is useful: create the WebGL context only when the first signature or landing needs it |
| 6, 9 | a vector-animation runtime drives scroll-linked 2D scenes | not adopted (extra runtime, no need) |
| 7 | scroll position acts as one master timeline | same as section 2 |
| 8 | sections carry a theme attribute and the nav restyles when a section enters | not needed: our nav is neutral chrome on both grounds |
| 10, 11 | custom shaders and bloom post-processing; text rendered as signed-distance fields in WebGL | not needed; our glow is already a half-resolution blur pass |
| 13 | page transitions intercept navigation, play an animation, then reveal | maps to our landing exit and "analysis finished" reveal only |

The guide names a 3D library, a scroll-timeline library and a smooth-scroll library. `CLAUDE.md` locks the
stack to raw WebGL2 and plain CSS, so none of these would be adopted without a decision.

## 6. Agreement and conflicts with the skills and `docs/UI.md`

Skills read: `apple-design` (AD), `emil-design-eng` (EDE), `animation-vocabulary`, `animate`,
`review-animations`, `animation-performance`, `break-ui`.

### Agreements
| Topic | Where |
| --- | --- |
| Two weights, tracking tightening with size, system font, no bundled fonts | UI.md section 3 = AD section 15 |
| Reduced motion = gentler cross-fade, not zero; reduced transparency and contrast branches | UI.md sections 8, 10 = AD section 14 |
| Translucent material, blur 20 px; do not stack light on light | UI.md section 4 = AD section 12 |
| Enter and exit on the same path; interruptible transitions | UI.md section 8 = AD section 7, EDE |
| Press, hover only on pointer devices | UI.md section 7 = EDE accessibility |
| Both recordings use ease-out or ease-in-out for large moves, no bounce | A2, L4, L5 vs AD "damping 1.0 default" |

### Conflicts (not resolved; need an owner decision)

| # | UI.md says | Other source says | My recommendation |
| --- | --- | --- | --- |
| C1 | Keyboard 1-5 map views, Cmd/Ctrl+E, Esc all use the normal animation (sections 5, 8) | EDE/animate: never animate keyboard-initiated or high-frequency actions | Make keyboard-triggered map switches and sheet opens instant (or 0-80 ms fade); keep animation for pointer/touch |
| C2 | `--ease-standard: cubic-bezier(0.4,0,0.6,1)` symmetric for ordinary state changes (measured on Apple's page) | EDE: use ease-out for entering/exiting and a strong curve; never symmetric ease for responses | Keep symmetric only for hover/colour (EDE allows "ease"), use `cubic-bezier(0.23,1,0.32,1)` for enter/exit |
| C3 | Sheet drag-to-dismiss with CSS transitions (section 7) | AD sections 3-6: gesture-driven motion should be spring-driven, carry release velocity, project momentum; EDE: dismiss on velocity > 0.11 px/ms | Use a spring or WAAPI with velocity handoff for sheets only; keep CSS elsewhere |
| C4 | Sheet 500 ms, push/pop 350 ms | EDE: UI animations under 300 ms (modals/drawers 200-500 ms allowed) | Sheets 400 ms drawer curve, push/pop 300 ms; needs your call |
| C5 | No pressed-state spec | AD/EDE: respond on pointer-down, `scale(0.97)`, 100-160 ms | Add pressed state to Button/Segmented/List rows (addition, not a reversal) |
| C6 | Popover "arrow 12 px" with no origin | EDE: popovers scale from the trigger, modals stay centred | Add `transform-origin` at the trigger |
| C7 | Body 17/22 | Measured page text is 17/25 (REFERENCES.md) | Keep 17/22 for app UI, use 17/25 only for long reading (landing, About) |
| C8 | Landing may auto-play liquid state inside the stage | AD section 14: avoid large slow loops near 0.2 Hz and full-viewport moving backgrounds | Keep liquid state scroll-driven and only on the canvas (already so); no idle loops |
| C9 | `docs/REFERENCES.md` and this file both exist | CLAUDE.md doc map points design inspiration at REFERENCES.md | Link this file from REFERENCES.md and the doc map if you approve it |
| C10 | `--dur-stage: 700 ms` | time-based reveals measured at 330-500 ms with ease-out (L4, L5) | Keep 700 ms for scroll-linked stage; use 400-500 ms for time-based reveals |

## 7. Mapping to `docs/UI.md` tokens (proposal, not applied)

| Quality | Token or place in UI.md | Proposed value |
| --- | --- | --- |
| Dip through dark between landing beats | section 6 item 0, `--ease-standard` | text out 250 ms, rest 100 ms, text in 350 ms; grid stays |
| Shared-element handoff landing to library | section 6 item 0 and section 8 | canvas rect interpolated, `--ease-stage` at 450 ms, reduced motion = cross-fade 200 ms |
| Peeking neighbours on the phone map switcher | section 5 phone, `--space-4` | next map visible 24 px at the edge; swipe slide 300 ms, `--ease-drawer` |
| Time-based reveal | `--dur-reveal` (new) | 450 ms, `cubic-bezier(0.23,1,0.32,1)` |
| Press feedback | section 7 | `transform: scale(0.97)`, 120 ms, on pointer-down |
| Keyboard-instant | section 8 | 0 ms for shortcut-triggered map and sheet changes |
| Sheet gestures | section 7 Sheet | spring `duration 0.4, bounce 0` default; `bounce 0.15` only after a flick |
| UI chrome never alters signature colour | section 1 | no filter, tint, blend or blur over the canvas pixels except the existing glow pass |

## 8. Ranked: the 5 to 8 changes that would most improve our UI

1. **Shared-element handoff from landing to the library/signature card** (L1; A3 object persistence). The
   canvas stays one continuous object through the one scroll scene.
2. **Dip through dark between landing beats** (A5). Removes the cross-fade double image; cheap.
3. **Keyboard-instant map and sheet changes** (C1, skills). Matches how often these happen.
4. **Press feedback and pointer-down response everywhere** (C5). Missing today; large feel gain.
5. **Velocity-aware sheet gestures** (C3). The only place where a spring clearly beats CSS.
6. **Peeking next map and pagination dots on the phone switcher** (A1, A2). Shows there are five maps.
7. **Time-based reveals at 400-500 ms ease-out** for the analysis-finished cell reveal (L4, L5, C10).
8. **Lazy-initialise the WebGL context** (guide section 12). First paint no longer waits on the canvas.

Not recommended: smooth-scroll hijacking, a 3D/animation framework, idle hero loops, autoplaying carousels.
