# Design references

Inspiration for the app UI (`docs/UI.md`). **Principles only.** We copy no text, images, icons, code,
logos or page layouts, bundle nobody's fonts, and clone no page. Values below were measured from the
live pages as facts about their design; they are evidence for our own tokens, not assets to reuse.
The signature grid (today the flat `dot` node style, later possibly glass chips via `NodeStyle`,
D-030) is always the focus; everything here is judged by whether it helps that.

- Measured: 2026-10-11, in the app's built-in browser at 390, 820 and 1440 px wide (computed styles
  read from the live DOM; light and dark emulated where the site supports it).
- **Captures saved** (2026-10-11, Playwright + Chromium, `scripts/capture_references.py`) to `data/references/`
  (git-ignored): `<site>_<390|820|1440>_<light|dark>.png`, 12 files. Apple's page is full-page; Landonorris is
  the first viewport after a 7 s settle. Headless Chromium does not render the site's WebGL portrait
  (the hero photo area is blank), and with a desktop user agent at 390 px the page shows its hero rather
  than the "rotate your device" gate seen under phone emulation. Neither site blocked capture.
- Reference 3 and the "don't like" lists were left as `[...]` in the brief; they are marked **TODO**.
- Motion measured from screen recordings and the resulting decisions: `docs/UI_REFERENCES.md` (D-044).

---

## 1. landonorris.com (athlete portfolio)

**You like:** the fluid motions and crazy animations as you scroll. **You don't like:** TODO.

### Access and capture
Loads fine; no blocking. Portrait phones (390 px) show a full-screen "rotate your device" gate and no
content, so there is no 390 px layout to sample. 820 px portrait and 1440 px landscape render fully.

### Structure
| Aspect | Observed |
| --- | --- |
| Page model | Stack of full-viewport "scenes" (hero 900 px = 100vh, marquee, a pinned horizontal-scroll track about 3,100 px tall, helmets, footer); total about 13.6k px at 1440 |
| Scale model | Everything scales with the viewport: design width 1728, `1rem = 100vw / 1728 * 16` (13.33 px at 1440, 9.48 px at 1024); breakpoints only re-arrange |
| Breakpoints (CSS) | max-width 991, 767, 479 px; a min-width 1920 cap (`--max-width` 1920) |
| Grid | 4 equal columns on desktop (about 331 px each at 1440, gap `1.25rem`), 2 columns for text blocks; container padding `1.25rem` |
| Chrome | Fixed top bar 3.75rem: wordmark left, a lime "Store" button and a menu button right, a small centre mark |

### Type
| Token (from the page) | Value | Use |
| --- | --- | --- |
| Display / UI family | a variable sans (custom), weights 400-800 | all UI and headings |
| Accent family | a custom serif | rotate-device line, editorial moments |
| `--text--h1` | 4rem (53 px at 1440), line 1.16, weight 700, uppercase | scene titles |
| `--text--med` | 2.76rem, weight 400 | statements |
| `--text--h3` / `h4` / `h6` | 2rem / 1.5rem / 1rem | sub-heads |
| eyebrow | 0.578rem, weight 800, uppercase | tiny labels (most frequent text on the page) |
| body | 14 px at 1024 (about 1rem), line 1.43 | copy |

Feel of the type: very heavy, uppercase, tightly leaded display against tiny wide-tracked labels.
Hierarchy is made by extreme size contrast rather than by many steps.

### Colour (as tokens)
| Token | Value | Role |
| --- | --- | --- |
| `--color--dark-green` | #282C20 | page ground for dark scenes |
| off-white | #F4F4ED | text on dark, light scenes, footer ground |
| `--color--lime` | #D2FF00 | the one accent: buttons, signature scribble, loader |
| `--color--black` | #111112 | text on light |
| `--color--grey-1` / `-off-white-1` / `-on-track` | #EBEEE0 / #DDE1D2 / #B9BBAD | tints |
| `--color--dark-green-tint-1` | #3B3C38 | raised dark surfaces |
| `--color--orange` | #FF6B00 | rare highlight |

One loud accent on a muted, slightly green neutral ramp. Scenes flip between dark and light as you scroll.

### Shape, material, depth
| Aspect | Observed |
| --- | --- |
| Radii | buttons 7 px at 1440 (scales with the viewport), pills `3rem`, large `6.25rem`; icon buttons 10 px |
| Material / blur | none (`backdrop-filter` unused) |
| Shadows | none; separation by colour and scale |
| Imagery | one portrait photo, contour-line artwork, 21 `<canvas>` layers (WebGL and 2D effects) |

### Motion
| Aspect | Observed |
| --- | --- |
| Scroll | inertial smooth scrolling (a Lenis-style library); scroll position drives pinned scenes, a horizontal track, marquee text and a drawn signature |
| Main easing | `cubic-bezier(0.65, 0.05, 0, 1)` at **0.75 s**, on 100+ elements (buttons, colour, borders) |
| Secondary | `cubic-bezier(0.19, 1, 0.22, 1)` (expo-out) at 0.6 s; small UI at 0.1-0.3 s `ease` |
| Hover | slow, deliberate colour/border changes at 0.75 s, no movement |
| Focus | not distinguishable from hover in the live DOM (custom components); treat as unmeasured |
| Entry | full-screen lime loader before the hero |

**Overall feel:** a loud, editorial, poster-like stage where scroll is the performer; confident and
playful, high energy.

### Borrow (principles)
1. **One hero object, driven by scroll.** A sticky stage whose state is a pure function of scroll
   progress. For us the stage is the signature itself (static signature, then live liquid state, then
   a companion map), not a photo.
2. **Long, soft ease-in-out for large moves** (0.6-0.75 s, strong ease at both ends) so big transitions
   feel physical; short transitions stay short.
3. **Scale-with-viewport sizing for the marketing/landing scene** (fluid type and spacing) so the
   scene keeps its composition on every width.
4. **A single accent against a restrained neutral palette.** For us the accent is the signature's own
   colour; UI chrome stays grey (already `docs/UI.md` principle 1).
5. **Extreme size contrast in headings** for the one landing scene.

### Do not borrow
- The lime brand colour, the custom fonts, the photography, the scribble, the contour art or any
  layout of the page.
- Orientation lock: the app must work in portrait on phones.
- Scroll-jacking and pinned horizontal tracks inside product screens, and any motion that cannot be
  turned off (`prefers-reduced-motion` must remove it).
- A blocking loader longer than the analysis itself; 21 stacked canvases (budget is one WebGL canvas).
- All-caps heavy display type in the product UI.

---

## 2. developer.apple.com/design/resources

**You like:** how Apple uses clean, professional typography. **You don't like:** TODO.

### Access and capture
Loads fine at all widths; both light and dark appearances are served via `prefers-color-scheme`
(black ground in dark, white ground in light).

### Structure
| Aspect | Observed |
| --- | --- |
| Breakpoints (CSS) | 734 / 735, 1068 / 1069, 1440 / 1441 px (small, medium, large, XL); also 767 and 833 for components |
| Content width | 980 px reading column, 1024 px max for the global bar content, side padding 22 px |
| Chrome | 44 px global bar (light) / 48 px local bar, sticky, translucent |
| Page model | long document of sections on alternating grounds; large type, large gaps, icon rows and two-up cards |

### Type
| Style | Size / line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| Page title (h1) | 48 / 52 at 1440 (40 / 44 at 820) | 600 | -0.14 px | hero |
| Section title | 32 / 36 and 28 / 32 | 600 | tight | sections |
| Subhead | 21 / 25 | 600 | small negative | card titles |
| Body | 17 / 25 | 400 | **-0.374 px** | paragraphs |
| Small | 14 / 20 | 400 | -0.224 px | secondary |
| Caption / footnote | 12 / 16 | 400 | -0.12 px | labels (most frequent on page) |
| Smallest | 11 / 12 | 400 | | legal |
| Family | the platform system font (display cut for large sizes, text cut for body), Helvetica Neue fallback | | | |

What makes it read as professional: a short scale of two weights (400 and 600), negative tracking that
tightens as the size rises, line height about 1.1 for display and 1.45 for body, generous space between
blocks, and a near-white (#F5F5F7) text colour on black rather than pure white.

### Colour (as tokens)
| Role | Dark | Light |
| --- | --- | --- |
| Ground | #000000 | #FFFFFF |
| Text | #F5F5F7 | #1D1D1F |
| Secondary text | #86868B | #6E6E73 |
| Link / accent | #2997FF | #0071E3 |
| Raised fill | #1D1D1F / #323232 | #F5F5F7 |
| Danger (asides) | #FF3037 | |

### Shape, material, depth
| Aspect | Observed |
| --- | --- |
| Radii | 10 px cards and tiles (most used), 6 px small, 12 px, 980 px (pill) |
| Material | translucent global bar: `backdrop-filter: saturate(1.8) blur(20px)` |
| Shadows | none; hairline separators and tonal steps |

### Motion, hover, focus
| Aspect | Observed |
| --- | --- |
| Standard transition | **0.32 s** and **0.24 s** `cubic-bezier(0.4, 0, 0.6, 1)` (symmetric, restrained) |
| Others | 0.15 s ease-out for press feedback; 0.24 s `cubic-bezier(0.28, 0.11, 0.32, 1)` for menus; `steps()` to toggle visibility |
| Reduced motion | a `prefers-reduced-motion` branch exists in the CSS |
| Focus | keyboard focus draws a solid 1.6 px outline in the link blue (#0071E3 on light), inset on nav items |
| Hover | colour shift of text/links; no scale or shadow |

**Overall feel:** calm, exact and quiet; the content is the star and the chrome disappears.

### Borrow (principles)
1. **Two weights and a short scale**, with tracking that tightens as size grows; body 17 / 25.
2. **Near-white text on black** (#F5F5F7), not #FFF, and a clear secondary grey.
3. **Translucent bar with blur 20 px and saturate 180%.** Our `docs/UI.md` material already matches the
   measured values, so no change is needed.
4. **Symmetric 0.24-0.32 s transitions** for ordinary state changes; large moves get the expressive curve.
5. **Hairlines and tonal steps instead of shadows.**
6. **Visible 1.5-2 px keyboard focus ring** in the accent colour.
7. **Responsive display size** (40 to 48 px) instead of one fixed title size.

### Do not borrow
- SF fonts (never bundled; the system stack renders them on Apple devices), SF Symbols, Apple logos,
  product names, device bezels or the page's imagery and copy.
- The two-column card gallery layout of this page; our screens are built around the square signature.

---

## 3. TODO

Reference 3 was left as `[...]`. Send the URL (and likes / dislikes) and I will add it in the same format.

---

## 4. Synthesis for SYNESTHESIA

| Question | Answer |
| --- | --- |
| What is the hero? | The signature grid, always. Chrome recedes (Apple), motion is allowed to be bold only on the signature and on one landing scene (Landonorris) |
| Where can scroll-driven motion live? | A single optional landing scene and the "analysis finished" reveal, never in the library or inspector |
| Does motion conflict with the Apple direction? | Not if split by role: quiet 0.24-0.32 s UI motion everywhere, one expressive 0.6-0.75 s curve for stage transitions, all removed by reduced motion |
| Does the UI compete with the grid? | Keep chrome neutral and flat; materials stay blur 20 px. If the grid later becomes glass chips, chrome should not add a second glass language (no stacked blurs near the grid) |

---

## 5. Changes to `docs/UI.md` (approved in whole 2026-10-11, D-033; applied)

```diff
--- a/docs/UI.md
+++ b/docs/UI.md
@@ 2. Design tokens (dark default)
-  --label: #FFFFFF;
+  --label: #F5F5F7;              /* near-white text on black, as measured on Apple's page */
@@
   --accent: #0A84FF;
+  --link: #2997FF;               /* text links on dark; AA on #000 */
@@ spacing / radii
-  --radius-control: 12px; --radius-card: 20px; --radius-sheet: 24px;
+  --radius-small: 6px; --radius-control: 12px; --radius-card: 20px; --radius-sheet: 24px;
+  --radius-pill: 980px;
@@ motion
   --ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
-  --dur-fast: 200ms; --dur: 350ms; --dur-slow: 500ms;
+  --ease-standard: cubic-bezier(0.4, 0, 0.6, 1);     /* ordinary state changes */
+  --ease-stage: cubic-bezier(0.65, 0.05, 0, 1);      /* large, stage-level transitions only */
+  --dur-fast: 200ms; --dur-ui: 240ms; --dur: 350ms; --dur-slow: 500ms; --dur-stage: 700ms;
+  /* below: light-theme counterparts */
+  --label (light): #1D1D1F; --link (light): #0071E3;
@@ 3. Typography
+| Display (hero, landing) | 48 / 52 at >= 1069 px, 40 / 44 below | 600 | -0.14px |
+Tracking tokens: body 17 px -0.374px; subheadline 15 px -0.24px; footnote 13 px -0.08px;
+caption 12 px -0.12px. Only two weights are used in UI: 400 and 600 (700 stays for Large Title).
@@ 5. Layout
-Phone (< 768 px wide) ... Tablet and desktop (>= 768 px)
+Breakpoints: phone <= 734, tablet 735-1068, desktop 1069-1440, wide >= 1441 (matches Apple's
+web breakpoints; supersedes the 768 / 1200 split). Reading column max 980 px.
@@ 7. Components
+| Stage (landing only) | One sticky square canvas; its state is a pure function of scroll progress 0..1;
+  transitions use --ease-stage / --dur-stage; reduced motion = static steps, no pinning; never used
+  in library, inspector or sheets |
+| Focus ring | 2 px solid --focus-ring, 2 px offset (unchanged); inset variant for bars |
@@ 8. Motion
+- Ordinary state changes: --ease-standard, --dur-ui (240 ms). Sheets/segmented: --ease-spring.
+- Stage transitions: --ease-stage, --dur-stage; interruptible; removed under reduced motion.
@@ 12. Licensing and branding
+- Inspiration notes live in docs/REFERENCES.md: principles only, no assets, text or fonts copied.
```

Unchanged on purpose: dark default, `#000` signature ground, material (blur 20 px, saturate 180%),
44 px hit areas, system font stack, Lucide icons, one filled button per screen.

### Decisions (owner, 2026-10-11)
1. The scroll-driven landing stage is present **only on the first landing** (first visit, once, skippable); not used elsewhere.
2. The diff above is approved in whole and applied to `docs/UI.md`.
3. Playwright capture done (12 images in `data/references/`). Open: reference 3 and the "don't like" lists.
