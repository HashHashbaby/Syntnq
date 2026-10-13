# UI spec: Apple-ecosystem look and feel

Goal: the web app should feel native on iPhone, iPad and Mac. References: Apple Design Resources (https://developer.apple.com/design/resources/) and the Human Interface Guidelines (https://developer.apple.com/design/human-interface-guidelines/). The resources page offers Figma and Sketch UI kits for iOS and iPadOS 27 and macOS 27, the SF font family, SF Symbols and Icon Composer.

We copy the **look and feel**, not Apple's assets or branding. Exact values below are a starting point drawn from Apple's published system styles; check them against the HIG and the UI kits before freezing.

## 1. Principles

1. **Artwork first.** The signature is the stage. Controls are translucent, few and recede. UI chrome stays neutral (grays) so it never competes with the signature's colors.
2. **Clarity.** One primary action per screen, short labels, obvious hierarchy.
3. **Depth through materials.** Layered translucent surfaces, not heavy shadows.
4. **Familiar patterns.** Standard Apple components (below) instead of invented ones.
5. **Motion with meaning.** The liquid grid is the hero motion; UI motion is quiet and interruptible.

## 2. Design tokens (`web/src/styles/tokens.css`)

**One theme: graphite** (D-053). A fixed dark grey radial gradient, black behind the grid square,
white ink, white-tinted glass panes floating over it. There is no light theme and no Appearance
setting. The file is the single source; this table lists the roles.

| Token | Value | Role |
| --- | --- | --- |
| `--graphite-center` / `-mid` / `-edge` | `#000` / `#121214` / `#2A2A2E` | the backdrop gradient: black out past the square's corners (1.42 x half-side), mid at 1.9 x, edge at 3.6 x |
| `--page` | `#2A2A2E` | body colour under the backdrop (the lightest ground; contrast is checked against it) |
| `--bg`, `--bg-2`, `--bg-3` | `#121214`, `#1C1C1F`, `#2A2A2E` | solid fallbacks (reduced transparency), grouped rows |
| `--label` / `--label-2` / `--label-3` | `#F5F5F7` / 72 % / 30 % | text; `--label-3` for separators and disabled UI only |
| `--accent`, `--link`, `--focus-ring` | `#8AA0FF`, `#9FB1FF` | links, focus, selection |
| `--accent-fill` / `--on-accent-fill` | white / black | filled buttons (white glass, black text) |
| `--glass-*` | tint 9 % white, rims, shadow | controls (section 4) |
| `--pane-*`, `--radius-pane` | bezel 24, refraction 36, gap 12 px, radius 24 px | floating panes (section 4) |
| `--ambient-opacity`, `--ambient-blur` | 0.16, 110 px | the song-colour ambient light behind the panes |

Spacing, radii, hit size and motion tokens are unchanged (motion: section 8, D-044).

**The signature square has no card**: the canvas background is `#000` and the gradient is black past the
square's corners, so the grid sits straight in the dark (D-053). Glass never covers the square.

## 3. Typography (D-048)

Stack: `"Helvetica Neue", Helvetica, "TeX Gyre Heros", Arial, sans-serif`. Mac renders Helvetica Neue;
machines without Helvetica get **TeX Gyre Heros**, self-hosted from `web/public/fonts/` (Latin WOFF2
subsets, 16 KiB per weight, built by `scripts/fetch_fonts.py` from the checksummed CTAN originals; GUST
Font License = LPPL 1.3c; files renamed per its request, MANIFEST alongside; git-ignored, rebuilt by
`make web-fonts`). Only regular (400) and bold (700) exist: **hierarchy comes from size, tracking and
colour, never synthesized weights**. Sizes in `rem` so browser text settings scale the UI.

| Style | Size / line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| Hero | clamp(3.5, 9vw, 9 rem) / 0.92 | 700 | -0.045em | landing hero only |
| Display | clamp(2.5, 5vw, 4 rem) / 1.0 | 700 | -0.035em | landing scene titles |
| Large Title | 34 px / 1.1 | 700 | -0.028em | library title |
| Title 1 / 2 | 28 / 22 px, 1.15 / 1.2 | 700 | -0.022 / -0.016em | screen and section titles |
| Headline | 17 px / 1.3 | 700 | -0.008em | song title |
| Body | 17 px / 1.45 | 400 | -0.005em | default |
| Reading | 17 px / 1.6 | 400 | -0.003em | landing copy, About |
| Subheadline | 15 px / 1.4 | 400 | 0 | artist, secondary |
| Footnote | 13 px / 1.4 | 400 | +0.01em | metadata, help |
| Caption | 12 px / 1.35 | 400 | +0.02em | axis labels |
| Eyebrow | 12 px / 1.2, uppercase | 700 | +0.08em | small section labels |

Tracking tightens as size grows and opens slightly below 15 px (optical sizing emulated). Numbers that
change use `font-variant-numeric: tabular-nums`. Minimum 11 px anywhere.

## 4. Materials: liquid glass (D-051, D-054)

Every button and control uses the glass material (`.glass`), chosen in three tiers by
`web/src/glass/glass.ts`:

| Tier | When | Material |
| --- | --- | --- |
| `refract` | Chromium, transparency allowed | `backdrop-filter: url(lens) blur(--glass-blur) saturate(--glass-saturate)`: a generated displacement map per control size bends the backdrop inside a `--glass-bezel` (14 px) rim with strength `--glass-refraction` (18 px); plus tint, specular rim, shadow |
| `frost` | Safari, Firefox (Firefox passes `@supports` for `url()` in `backdrop-filter` but draws nothing, so the engine is detected) | blur + saturate + tint + the same rim |
| `solid` | reduced transparency (system or in-app), `prefers-contrast: more`, or no backdrop-filter | `--glass-tint-solid` fill with a 1 px contrasting edge |

**Floating panes (D-054).** The library (with the upload section as its own floating bar), the
inspector, the signature toolbar pill, the player pill and sheets are panes: the same glass with a
24 px bezel and refraction strength 36 (read per element, so controls keep 14 / 18), radius 24 px,
a deep soft shadow, floating `--pane-gap` (12 px; 8 px on phones) from the edges and each other.
Large panes rebuild their displacement map only after a resize settles (120 ms). While audio plays, the library and inspector panes frost instead of refracting (`:root[data-playing]`; refraction there costs about 2.3 ms per frame during playback). Behind the panes the
**ambient light** (the open song's static colours, blurred 110 px, 16 %, masked away from the square)
gives the glass something to refract; it is hidden under reduced transparency.

Rim: a bright top inner edge (`--glass-rim-hi`), a shaded lower edge (`--glass-rim-lo`), a hairline
(`--glass-edge`) and a static specular highlight; shadow via `--glass-shadow`. Press: `scale(0.97)` on
pointer-down (D-044); hover raises the tint and the rim (pointer devices only). Focus: 2 px
`--focus-ring` outside the rim. **Glass never covers the signature card** (UI chrome never alters
signature colours). Sheets and popovers use the frosted `.material` (`--material`, blur 20 px,
saturate 180 %), solid under reduced transparency. Legibility: text on glass keeps >= 4.5:1.

## 5. Layout

The signature is always square (`aspect-ratio: 1`), centered, never cropped, scaled to the largest square that fits.

Breakpoints (D-033): phone <= 734 px, tablet 735-1068, desktop 1069-1440, wide >= 1441; reading column max 980 px.

**Phone (<= 734 px wide)**
- Library: Large Title "Library", inset grouped list of songs (thumbnail = tiny signature, title, artist, duration), floating "+" (Add song) as the one filled button.
- Signature screen: full-width square canvas within safe-area insets (`env(safe-area-inset-*)`); floating player bar at the bottom (title, artist, play/pause, thin scrubber). The five maps are a horizontal snap carousel under the segmented control: the next map peeks about 32 px at the edge, small pagination dots show the position, a swipe that rests on a card selects that map, and the segmented control and keys 1-5 move the carousel (instantly for keys). Tapping the bar opens a sheet (medium and large detents) with: song details, Export, Compare (M9).
- Map switcher in the sheet: Sound · Features · Structure · Rhythm · Dynamics. "Features" shows a second segmented control: Brightness · Loudness · Noise · Harmony · Change.

**Tablet and desktop (≥ 735 px)**
- Graphite layout (D-054): panes float 12 px apart; the map switcher sits in the toolbar pill; the grid square is `min(100%, 100vh - 230px)`.
- 3D live view (D-056): the Sound view draws glass chips; a "True colour" icon button in the toolbar (pressed = flat 2D dots, key T, remembered) switches views; the 3D chunk loads on first use under the loading mural.
- Split view: sidebar 320 px (library list, search field, "+" button) and detail area.
- Detail: toolbar at top (song title, segmented map switcher, Export button, more menu); canvas centered; inspector panel on the right (280 px) on ≥ 1069 px wide, otherwise a popover.
- Live trail chart (D-062): a "Loudness and brightness" pane (loudness dBFS across, brightness Hz up on a log axis, calibration ranges, the grid's 2 s trail and a dot for now, a faint whole-song cloud), in the right column above the inspector at >= 1200 px and under the player below that; toolbar toggle (chart icon, key G, remembered; not in the phone toolbar). It draws from the same frame clock as the grid.
- Start mural (D-061): the opening on every cold start, one full sweep (2.35 s) then a 450 ms fade; a key, click or tap after 0.6 s skips it.
- Companion maps (D-064): axes in real units around every map, a live "now" layer from the grid's clock (features ring and trail, structure crosshair, rhythm playhead and tempo, dynamics playhead and level), and reading pointers in a floating panel from a "How to read" chip in each chart's corner (opens while the pointer is over a map, over the chip on the sound grid, on focus and on tap; Escape closes). The pointers never push the layout; the player stays in view.
- Player bar docked at the bottom of the detail area. At its left end, concentric with the pill, the **rotating disc** (D-060, `--disc-size` 52 px, 46 px on phones): a smoked-glass disc whose label is the song's signature card; decorative (`aria-hidden`), it turns with the audio clock, coasts to a stop on pause, follows seeks and scrubs, stays still under reduced motion, and steps aside when WebGL is missing.

**Keyboard (desktop)**
Space play/pause · T true colour (flat 2D) · ←/→ seek 5 s · Shift+←/→ seek 30 s · 1-5 map views · Cmd/Ctrl+E export · Cmd/Ctrl+O add song · Esc close sheet/popover · Tab moves focus visibly.

## 6. Screens and states

0. **First landing (scroll stage, first visit only):** a single scroll-driven stage shown the first time a person opens the app, before the library. A sticky square canvas whose state is a pure function of scroll progress: static signature, then the liquid state, then a companion map; transitions use `--ease-stage` / `--dur-stage`. It ends in the "Add a song" action. After it is completed or skipped once ("Skip" always visible), it is never shown again, including at later app launches; Settings has "Replay intro". Reduced motion: no pinning, a plain sequence of three static steps. It is not used in the library, inspector, sheets or any other screen (D-033).
   - **Beats (D-063):** the visuals follow a critically damped copy of scroll progress (120 ms; scroll itself stays native, D-049). (1) **Hero:** giant type "Hear the music." above and "See its signature." below the sample's signature card (TeX Gyre Heros bold, hero size, capped at 13 vw). The pointer paints a fading trail (1.5 s half-life, wider when it moves faster); under the trail the flat card gives way to the live 3D glass grid playing the sample silently. Touch paints with a sideways drag (vertical drags scroll); "See it live" reveals the whole card for keyboard and touch. (2) **Disc:** the card shrinks to 42 % and becomes the label of a disc (the same card, flat, at angle 0, so the swap is exact); the disc turns with scroll (1.25 turns, never on its own) and leans to 12 deg. (3) **Live:** the 3D grid scrubbed by scroll. (4) **Map:** the structure map. Then the mapping key (a hue bar with its two ends named, three rows, the honest line) and the actions.
   - **Beats** dip through dark (D-044): the old line fades and lifts out (250 ms), the stage rests (100 ms), the new line arrives (350 ms); the two are never on screen together and the signature stays put.
   - **End state:** the pinned track ends and the mapping key and the actions ("Add a song", "Try a sample") scroll into view below the stage; both are on screen at the end of the scroll.
   - **Leaving:** "Try a sample" hands the live canvas over to the signature card (it travels and scales to the card's rectangle in 450 ms with `--ease-stage` while the chrome fades; from the map beat the map fades to the signature on the way). Skip and "Add a song" fade the whole landing out in 250 ms. Reduced motion: a 200 ms fade, no travel.
0b. **Loading mural (D-052, D-053):** on the graphite ground, up to 960 px wide with the "SYNESTHESIA" wordmark under it; while the app or a 3D chunk loads, a mural of dark stained-glass tiles flips in a diagonal sweep and white light floods through each turning tile. On a cold start it is the opening (D-061): shown from the first paint for one full sweep plus a hold (2.35 s), longer while loading continues, then a 450 ms fade; a key, click or tap after 0.6 s skips it. The in-app mural (3D chunk) appears only if loading takes longer than 400 ms, then stays at least 600 ms and fades out in 300 ms. The boot mural is inline in `index.html`; the in-app one (`LoadingMural`) covers the surface that is loading. Reduced motion: still tiles with a fade; reduced transparency: no bloom or grain.
1. **First launch / empty library:** centered short text "Add a song to see its signature." plus the filled "Add Song" button and "Try a sample" link (bundled Creative Commons samples, M7).
2. **Add song:** file picker or drag-and-drop anywhere on the window (drop overlay with dashed rounded rectangle, label "Drop to analyze").
3. **Analyzing:** a progress view on the canvas area with stage labels from the API (`Reading audio`, `Listening`, `Mapping sounds`, `Coloring`, `Drawing maps`) and a determinate bar; cancel button. The grid fades in cell by cell (≤ 600 ms) when done; reduced motion → simple fade.
4. **Error:** inline message from the error table (`docs/ANALYSIS.md §13`) with "Choose another file".
5. **Signature view:** static signature at rest; pressing play starts the liquid grid. Paused → liquid layer eases out (400 ms) to the static signature.
6. **Map views:** each map has a one-line caption under it explaining what it shows (e.g. "Structure: the song compared with itself. Bright squares are repeated sections."), plus axis labels where relevant (time, BPM).
7. **Inspector:** cell values (see `docs/LIVE.md §8`).
8. **Export sheet:** size (2048 / 4096 / 8192 px), format (PNG / SVG), caption toggle (title, artist, wordmark), "Save" and "Share" (Web Share API with file when supported, else download).
9. **Compare (M9):** two signatures side by side (stacked on phone), similarity score with a plain-language label ("Very similar", "Somewhat similar", "Different") and the top 3 differing features.
10. **Settings:** Reduce motion (Auto / On), Reduce transparency (Auto / On), Keep audio on this device (on), About and licenses.

## 7. Components

| Component | Spec |
| --- | --- |
| Segmented control | Height 32 px, radius 9, fill `--fill`, selected segment `--bg-3` (dark) / white (light) with a subtle shadow; slides with `--ease-spring` 250 ms |
| Button (filled) | Height 50 px on phone / 32 on desktop (44 px minimum hit area), radius 12, `--accent-fill`, white Headline text; one per pane. Every pressable (buttons, segments, list rows) scales to 0.97 on pointer-down and returns on release (`--dur-press`, `--ease-out`); reduced motion dims by 15 % instead |
| Button (plain/tinted) | Text in `--accent`; tinted = accent at 15% opacity fill |
| List (inset grouped) | Rows 60 px, radius 12 group corners, separators inset 16 px, swipe-to-delete on touch, context menu on long-press/right-click |
| Sheet | Radius 24 top corners, grabber 36×5 px (28 px tall hit area), detents medium (50%) and large (92%), backdrop dim 40% that fades with the drag. Drag follows the pointer 1:1 and resists upward with rubber-banding; release velocity above 0.11 px/ms or a pull past 30 % of the height dismisses, otherwise a spring returns it |
| Popover | Radius 14, material, arrow 12 px; scales from its trigger (`transform-origin` at the trigger), modals stay centred |
| Map carousel (phone) | Snap-x track of five cards, each `100% - 28 px` wide with a 12 px gap so the next card peeks; dots 6 px, active 18 px wide |
| Slider (scrubber) | Track 4 px (6 px while dragging), thumb hidden until hover/drag, elapsed and remaining time in Footnote tabular numbers |
| Toolbar | Height 52 px, material, items 44 px hit targets |
| Progress | Linear 4 px bar, radius 2, accent |
| Toast | Top-center capsule, material, auto-dismiss 3 s |
| Stage (first landing only) | Sticky square canvas; state = f(scroll progress 0..1); `--ease-stage`, `--dur-stage`; pinning removed under reduced motion; Skip always visible; shown once |

All interactive elements have ≥ 44×44 px hit areas, visible focus rings (2 px `--focus-ring`, 2 px offset), and hover states only on pointer devices (`@media (hover: hover)`).

## 8. Motion

Rules (D-044): animate `transform` and `opacity` (plus small colour/filter changes); never `transition: all`; hover motion only behind `@media (hover: hover)`; durations stay at or under 500 ms except the scroll-linked landing stage; keyboard-initiated and high-frequency actions are instant; enter and exit follow the same path, exit faster than enter; springs only where a person can grab or flick an element (sheets), CSS transitions everywhere else so they stay interruptible. Terms follow the animation vocabulary.

| Interaction | Term | Properties | Duration | Easing / spring | Reduced motion | Keyboard |
| --- | --- | --- | --- | --- | --- | --- |
| Press on buttons, segments, rows | Press / tap feedback | `transform: scale(0.97)` | 120 ms, in on pointer-down, out on release | `--ease-out` | no scale, brightness 0.85 | n/a |
| Hover, toggles, colour | Hover effect | `filter`, `background` | 240 ms | `--ease-standard` | none | none |
| Segmented selection | Layout animation (pill) | `background` | 200 ms | `--ease-drawer` | none | none |
| Sheet open | Slide in (drawer) | `transform` from 100 % | 400 ms | `--ease-drawer` | appears instantly | none |
| Sheet close, pointer | Slide out, spring | `transform` | spring, response 0.3 s, damping 1 | critically damped | 200 ms fade | none (instant) |
| Sheet drag | Drag, momentum, rubber-banding | `transform` set directly | 1:1 with the pointer | release: response 0.4 s, damping 1; after a flick 0.85 | follows pointer, releases without spring | n/a |
| Phone push / pop | Direction-aware transition | `opacity`, `transform` 24 px | 300 ms | `--ease-out` | none | n/a |
| Phone map carousel | Scroll snap with peeking neighbours | `scrollLeft` | browser smooth scroll, about 300-400 ms | snap | jumps | jumps (keys 1-5) |
| Landing beats | Orchestration: fade out, rest, fade in (dip) | `opacity`, `translateY` 8 px | 250 + 100 + 350 ms | `--ease-out` | static stack | n/a |
| Landing stage (scroll) | Scroll-driven animation | canvas state = f(scroll) | 700 ms for chrome | `--ease-stage` | no pinning | n/a |
| Landing to signature card | Shared element transition | `transform` of the live canvas | 450 ms | `--ease-stage` | 200 ms fade | n/a |
| Landing exit (skip, add) | Fade out | `opacity` | 250 ms | `--ease-out` | 200 ms | n/a |
| Analysis finished | Reveal: a diagonal wave of scale-in cells | dot radius | 450 ms, wave width 35 % | ease-out cubic | 450 ms fade from black | n/a |
| Pause | Ease back to the static signature | live layer blend | 400 ms smoothstep | smoothstep | instant | n/a |
| Glass hover | Hover effect | tint (`background-color`) only, no animated shadow | 240 ms | `--ease-standard` | none | none |
| Loading mural | Staggered flip (sweep) + fade | `transform: rotateY`, `opacity` | flip within a 2.6 s cycle, 55 ms stagger; cold start: from the first paint, min 2,350 ms, fade 450 ms (D-061); in-app: show after 400 ms, min 600 ms, fade 300 ms | `--ease-in-out` (flip), `--ease-out` (fade) | still tiles, fade only | n/a |
| Toast | Fade in with a small lift | `opacity`, `transform` 8 px | 240 ms | `--ease-out` | fade only | n/a |
| Map pagination dots | State indication | `width`, `background` | 200 ms | `--ease-out` | none | none |
| Inspector popover | follows the pointer, no animation (high frequency) | none | 0 | none | none | none |

Inputs: the app records the last input modality on `<html data-input="keyboard|pointer">`; every rule marked "Keyboard: none / instant" is a CSS rule under `:root[data-input="keyboard"]` or a check of that flag in code. Values are mirrored in `web/src/motion/tokens.ts` and a unit test keeps them equal to `tokens.css`.

## 9. Icons

Never bundle SF Symbols. Use **Lucide** (ISC license, similar line weight), stroke 1.75 px, sized to match text. All icons go through `web/src/icons.ts`, keyed by the SF Symbol name a native port would use:

| Key (SF Symbol name) | Use |
| --- | --- |
| `play.fill` / `pause.fill` | playback |
| `gobackward.5` / `goforward.5` | seek |
| `plus` | add song |
| `square.and.arrow.up` | export / share |
| `waveform` | dynamics view |
| `square.grid.3x3` | sound map |
| `slider.horizontal.3` | features |
| `metronome` | rhythm |
| `square.on.square` | compare |
| `info.circle` | inspector |
| `gearshape` | settings |
| `trash` | delete |

## 10. Accessibility

- Text scales with browser settings; layout reflows up to 200% text size without clipping.
- ARIA labels on every control; the canvas has `role="img"` and an `aria-label` generated from the analysis ("Bright, mostly loud signature; strong beat at 122 BPM; repeating chorus").
- A visually hidden live region announces the current section's character at most every 10 s during playback (opt-in setting, off by default).
- Contrast: text ≥ 4.5:1, large text and UI glyphs ≥ 3:1.
- Never rely on color alone: maps have captions and axes; compare view lists differences in text.
- Full keyboard operation; focus order follows visual order; sheets trap focus and restore it on close.
- Respect `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast: more` (thicker separators, solid materials).

## 11. PWA

- `manifest.webmanifest`: name "SYNESTHESIA", short name "Synesthesia", `display: standalone`, `theme_color` and `background_color` `#000000` (graphite, D-053), original app icon (dark square with a small glowing dot grid; designed in-house, not Apple's icon templates' artwork).
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `apple-mobile-web-app-capable`, status bar style black-translucent.
- Service worker caches the app shell and analyzed songs' signature data (not audio).

## 12. Licensing and branding

- The resources page does not state license terms. As understood, SF fonts and SF Symbols are licensed for Apple-platform apps and mockups; confirm before ever bundling them. The system font stack lets Apple devices render SF with nothing bundled.
- No Apple logos, device bezels, Apple product names (for example "Apple Music") or any implied affiliation. SYNESTHESIA keeps its own brand.
- Apple's UI kits may be used to make mockups in Figma; do not copy kit artwork into the product.
- Other design inspiration is recorded in `docs/REFERENCES.md`: principles only, no assets, text, code or fonts copied.

## 13. Workflow and review

1. Mock each key screen (Library, Signature, Sheet, Export, Compare) in Figma with the iOS and iPadOS 27 and macOS 27 UI kits before building it; save links in `docs/DECISIONS.md`.
2. Build with tokens only (no raw colors or sizes in components).
3. Playwright screenshots at 390×844, 820×1180 and 1440×900, light and dark, reduced motion and reduced transparency on and off.
4. The checklist is automated in `web/tests/e2e/screens.spec.ts` (48 contexts: 3 sizes x light/dark x reduced motion x reduced transparency; screenshots in `web/test-results/screens/`): no horizontal overflow, 44 px hit targets on touch sizes, visible 2 px focus ring, text contrast >= 4.5:1 (3:1 large), signature is the largest element, one filled button per pane, solid materials under reduced transparency, 200% text size without overflow. Review against this checklist:
   - [ ] Signature is the dominant element on every main screen
   - [ ] One filled button per screen
   - [ ] All hit targets ≥ 44 px; visible focus rings
   - [ ] Text contrast passes, including on materials over bright cells
   - [ ] Layout correct with 200% text size
   - [ ] Safe areas respected on iPhone (notch, home indicator)
   - [ ] Reduced motion and reduced transparency honored
   - [ ] No Apple assets or names in the bundle (`grep` check in CI)
5. If a native app is built later: SwiftUI + Metal, real SF Symbols (same names as `icons.ts`), Icon Composer for the app icon; the Python analysis service is unchanged.
