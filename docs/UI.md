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

Dark is the default appearance; light follows `prefers-color-scheme` and the in-app override.

```css
:root {
  /* dark (default) */
  --bg: #000000;
  --bg-2: #1C1C1E;
  --bg-3: #2C2C2E;
  --fill: rgba(120,120,128,0.36);
  --label: #F5F5F7;             /* near-white on black (docs/REFERENCES.md) */
  --label-2: rgba(235,235,245,0.60);
  --label-3: rgba(235,235,245,0.30);
  --separator: rgba(84,84,88,0.65);
  --accent: #0A84FF;
  --link: #2997FF;              /* text links on dark */
  --danger: #FF453A;
  --material: rgba(30,30,32,0.62);
  --material-border: rgba(255,255,255,0.10);
  --focus-ring: #0A84FF;

  --font: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;   /* uses SF Mono only if installed */

  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --radius-small: 6px; --radius-control: 12px; --radius-card: 20px; --radius-sheet: 24px;
  --radius-pill: 980px;
  --hit: 44px;

  --ease-spring: cubic-bezier(0.32, 0.72, 0, 1);       /* sheets, segmented control */
  --ease-standard: cubic-bezier(0.4, 0, 0.6, 1);       /* ordinary state changes */
  --ease-stage: cubic-bezier(0.65, 0.05, 0, 1);        /* stage-level transitions only */
  --dur-fast: 200ms; --dur-ui: 240ms; --dur: 350ms; --dur-slow: 500ms; --dur-stage: 700ms;
}
/* light: explicit override */
:root[data-theme="light"] {
  --bg: #F2F2F7; --bg-2: #FFFFFF; --bg-3: #F2F2F7;
  --label: #1D1D1F; --label-2: rgba(60,60,67,0.60); --label-3: rgba(60,60,67,0.30);
  --separator: rgba(60,60,67,0.29); --accent: #007AFF; --link: #0071E3; --danger: #FF3B30;
  --material: rgba(255,255,255,0.72); --material-border: rgba(0,0,0,0.08);
}
/* light: automatic, unless the user forced dark */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: #F2F2F7; --bg-2: #FFFFFF; --bg-3: #F2F2F7;
    --label: #1D1D1F; --label-2: rgba(60,60,67,0.60); --label-3: rgba(60,60,67,0.30);
    --separator: rgba(60,60,67,0.29); --accent: #007AFF; --link: #0071E3; --danger: #FF3B30;
    --material: rgba(255,255,255,0.72); --material-border: rgba(0,0,0,0.08);
  }
}
```

**The signature canvas always sits on pure black (`#000`) in both themes**, inside a rounded card in light mode, because the glow depends on a dark ground.

## 3. Typography

System stack only (renders SF Pro on Apple devices, no font files bundled). Sizes in `rem` (1 rem = 16 px default) so browser text-size settings scale the UI.

| Style | Size / line (px) | Weight | Use |
| --- | --- | --- | --- |
| Display | 48 / 52 at >= 1069 px, 40 / 44 below | 600 | Landing scene title only |
| Large Title | 34 / 41 | 700 | Library title on phone |
| Title 1 | 28 / 34 | 700 | Screen titles |
| Title 2 | 22 / 28 | 700 | Section titles |
| Headline | 17 / 22 | 600 | Song title in player bar |
| Body | 17 / 22 | 400 | Default |
| Callout | 16 / 21 | 400 | Inspector values |
| Subheadline | 15 / 20 | 400 | Artist, secondary info |
| Footnote | 13 / 18 | 400 | Metadata, help |
| Caption | 12 / 16 | 400 | Axis labels on maps |

Tracking (letter-spacing) tightens with size, as measured on Apple's pages: Body -0.374 px, Subheadline -0.24 px, Footnote -0.08 px, Caption -0.12 px, Display -0.14 px. UI uses two weights, 400 and 600 (700 stays for titles).

Numbers in the inspector use `font-variant-numeric: tabular-nums`. Minimum 11 px anywhere.

## 4. Materials

Floating controls (player bar, toolbars, sheets, popovers):
```css
background: var(--material);
backdrop-filter: blur(20px) saturate(180%);
-webkit-backdrop-filter: blur(20px) saturate(180%);
border: 0.5px solid var(--material-border);
```
Fallback to a solid `--bg-2` when `backdrop-filter` is unsupported or `prefers-reduced-transparency: reduce` (or the in-app "Reduce transparency" toggle) is set. Legibility check: text on materials must keep ≥ 4.5:1 contrast over the brightest signature cells (test with a white-dot screenshot).

## 5. Layout

The signature is always square (`aspect-ratio: 1`), centered, never cropped, scaled to the largest square that fits.

Breakpoints (D-033): phone <= 734 px, tablet 735-1068, desktop 1069-1440, wide >= 1441; reading column max 980 px.

**Phone (<= 734 px wide)**
- Library: Large Title "Library", inset grouped list of songs (thumbnail = tiny signature, title, artist, duration), floating "+" (Add song) as the one filled button.
- Signature screen: full-width square canvas within safe-area insets (`env(safe-area-inset-*)`); floating player bar at the bottom (title, artist, play/pause, thin scrubber). Tapping the bar opens a sheet (medium and large detents) with: map switcher (segmented), song details, Export, Compare (M9).
- Map switcher in the sheet: Sound · Features · Structure · Rhythm · Dynamics. "Features" shows a second segmented control: Brightness · Loudness · Noise · Harmony · Change.

**Tablet and desktop (≥ 735 px)**
- Split view: sidebar 320 px (library list, search field, "+" button) and detail area.
- Detail: toolbar at top (song title, segmented map switcher, Export button, more menu); canvas centered; inspector panel on the right (280 px) on ≥ 1069 px wide, otherwise a popover.
- Player bar docked at the bottom of the detail area.

**Keyboard (desktop)**
Space play/pause · ←/→ seek 5 s · Shift+←/→ seek 30 s · 1-5 map views · Cmd/Ctrl+E export · Cmd/Ctrl+O add song · Esc close sheet/popover · Tab moves focus visibly.

## 6. Screens and states

0. **First landing (scroll stage, first visit only):** a single scroll-driven stage shown the first time a person opens the app, before the library. A sticky square canvas whose state is a pure function of scroll progress: static signature, then the liquid state, then a companion map; transitions use `--ease-stage` / `--dur-stage`. It ends in the "Add a song" action. After it is completed or skipped once ("Skip" always visible), it is never shown again, including at later app launches; Settings has "Replay intro". Reduced motion: no pinning, a plain sequence of three static steps. It is not used in the library, inspector, sheets or any other screen (D-033).
1. **First launch / empty library:** centered short text "Add a song to see its signature." plus the filled "Add Song" button and "Try a sample" link (bundled Creative Commons samples, M7).
2. **Add song:** file picker or drag-and-drop anywhere on the window (drop overlay with dashed rounded rectangle, label "Drop to analyze").
3. **Analyzing:** a progress view on the canvas area with stage labels from the API (`Reading audio`, `Listening`, `Mapping sounds`, `Coloring`, `Drawing maps`) and a determinate bar; cancel button. The grid fades in cell by cell (≤ 600 ms) when done; reduced motion → simple fade.
4. **Error:** inline message from the error table (`docs/ANALYSIS.md §13`) with "Choose another file".
5. **Signature view:** static signature at rest; pressing play starts the liquid grid. Paused → liquid layer eases out (400 ms) to the static signature.
6. **Map views:** each map has a one-line caption under it explaining what it shows (e.g. "Structure: the song compared with itself. Bright squares are repeated sections."), plus axis labels where relevant (time, BPM).
7. **Inspector:** cell values (see `docs/LIVE.md §8`).
8. **Export sheet:** size (2048 / 4096 / 8192 px), format (PNG / SVG), caption toggle (title, artist, wordmark), "Save" and "Share" (Web Share API with file when supported, else download).
9. **Compare (M9):** two signatures side by side (stacked on phone), similarity score with a plain-language label ("Very similar", "Somewhat similar", "Different") and the top 3 differing features.
10. **Settings:** Appearance (Auto / Dark / Light), Reduce motion (Auto / On), Reduce transparency (Auto / On), Keep audio on this device (on), About and licenses.

## 7. Components

| Component | Spec |
| --- | --- |
| Segmented control | Height 32 px, radius 9, fill `--fill`, selected segment `--bg-3` (dark) / white (light) with a subtle shadow; slides with `--ease-spring` 250 ms |
| Button (filled) | Height 50 px on phone / 32 on desktop, radius 12, `--accent` fill, white Headline text; one per screen |
| Button (plain/tinted) | Text in `--accent`; tinted = accent at 15% opacity fill |
| List (inset grouped) | Rows 60 px, radius 12 group corners, separators inset 16 px, swipe-to-delete on touch, context menu on long-press/right-click |
| Sheet | Radius 24 top corners, grabber 36×5 px, detents medium (50%) and large (92%), drag to dismiss, backdrop dim 40% |
| Popover | Radius 14, material, arrow 12 px |
| Slider (scrubber) | Track 4 px (6 px while dragging), thumb hidden until hover/drag, elapsed and remaining time in Footnote tabular numbers |
| Toolbar | Height 52 px, material, items 44 px hit targets |
| Progress | Linear 4 px bar, radius 2, accent |
| Toast | Top-center capsule, material, auto-dismiss 3 s |
| Stage (first landing only) | Sticky square canvas; state = f(scroll progress 0..1); `--ease-stage`, `--dur-stage`; pinning removed under reduced motion; Skip always visible; shown once |

All interactive elements have ≥ 44×44 px hit areas, visible focus rings (2 px `--focus-ring`, 2 px offset), and hover states only on pointer devices (`@media (hover: hover)`).

## 8. Motion

- Ordinary state changes (hover, toggles, fades): `--ease-standard`, `--dur-ui` (240 ms).
- Sheets, segmented control, popovers: `--ease-spring`, 350 ms (sheets 500 ms), interruptible (CSS transitions or Web Animations; no blocking JS animations).
- Stage transitions on the first landing only: `--ease-stage`, `--dur-stage` (700 ms), scroll-linked; removed under reduced motion.
- Screen changes on phone: push/pop slide 350 ms; desktop: cross-fade 200 ms.
- Reduced motion: replace slides with 200 ms cross-fades; liquid grid per `docs/LIVE.md §3`.

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

- `manifest.webmanifest`: name "SYNESTHESIA", short name "Synesthesia", `display: standalone`, `theme_color: #000000`, `background_color: #000000`, original app icon (dark square with a small glowing dot grid; designed in-house, not Apple's icon templates' artwork).
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
4. Review against this checklist:
   - [ ] Signature is the dominant element on every main screen
   - [ ] One filled button per screen
   - [ ] All hit targets ≥ 44 px; visible focus rings
   - [ ] Text contrast passes, including on materials over bright cells
   - [ ] Layout correct with 200% text size
   - [ ] Safe areas respected on iPhone (notch, home indicator)
   - [ ] Reduced motion and reduced transparency honored
   - [ ] No Apple assets or names in the bundle (`grep` check in CI)
5. If a native app is built later: SwiftUI + Metal, real SF Symbols (same names as `icons.ts`), Icon Composer for the app icon; the Python analysis service is unchanged.
