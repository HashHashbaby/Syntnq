// Liquid-glass material for controls (docs/UI.md section 4, D-051). Three tiers, chosen once and
// re-chosen when the transparency or contrast settings change:
//   refract  Chromium: backdrop-filter through an SVG displacement map (edge refraction) + frost
//   frost    Safari, Firefox: blur + saturate + tint (Firefox parses url() in backdrop-filter and
//            passes @supports but draws nothing, so the engine is detected, not the feature)
//   solid    reduced transparency, more contrast, or no backdrop-filter at all
// Every element with the class `glass` gets the material from app.css; in the refract tier this
// module also builds one displacement map per (width, height, radius) and points the element's
// `--glass-lens` at it. Sizes, bezel and strength are CSS tokens (styles/tokens.css): one source.

export type GlassTier = "refract" | "frost" | "solid";

/** Elements that wear the glass material; the same list is in styles/app.css. */
export const GLASS_SELECTOR = ".glass, .btn:not(.btn-plain), .segmented, .search, .player";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SIDE = 2048;
/** Filters kept before the cache is cleared (window resizes create one per new control size). */
const MAX_FILTERS = 64;

/** Rounded-rectangle signed distance (negative inside), in pixels. */
function roundedRectSdf(px: number, py: number, w: number, h: number, r: number): number {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Displacement map for a convex glass edge: RGBA bytes (w x h), red = x offset, green = y offset,
 * 128 = none. Inside the bezel the sample point moves inward along the edge normal with a
 * quadratic falloff, so the rim bends what is behind it and the centre stays undistorted.
 */
export function displacementMap(w: number, h: number, radius: number, bezel: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const r = Math.min(radius, w / 2, h / 2);
  const eps = 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const d = roundedRectSdf(cx, cy, w, h, r);
      const inside = -d;
      let dx = 0;
      let dy = 0;
      if (inside > 0 && inside < bezel) {
        const nx = roundedRectSdf(cx + eps, cy, w, h, r) - roundedRectSdf(cx - eps, cy, w, h, r);
        const ny = roundedRectSdf(cx, cy + eps, w, h, r) - roundedRectSdf(cx, cy - eps, w, h, r);
        const len = Math.hypot(nx, ny) || 1;
        const s = 1 - inside / bezel;
        const mag = s * s;
        dx = (-nx / len) * mag;
        dy = (-ny / len) * mag;
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(128 + 127 * dx);
      out[o + 1] = Math.round(128 + 127 * dy);
      out[o + 2] = 128;
      out[o + 3] = 255;
    }
  }
  return out;
}

function cssNumber(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

function isChromium(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  if (brands) return brands.some((b) => b.brand === "Chromium");
  return /Chrome\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
}

/** Which tier this browser and these settings get. */
export function detectTier(): GlassTier {
  const root = document.documentElement;
  const mq = (q: string): boolean => typeof matchMedia === "function" && matchMedia(q).matches;
  if (root.dataset.transparency === "reduced" || root.dataset.contrast === "more") return "solid";
  if (mq("(prefers-reduced-transparency: reduce)") || mq("(prefers-contrast: more)")) return "solid";
  const supports = typeof CSS !== "undefined" && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)"));
  if (!supports) return "solid";
  const forced = new URLSearchParams(location.search).get("glass");
  if (forced === "frost" || forced === "solid") return forced;
  if (isChromium() && CSS.supports("backdrop-filter", "url(#a)")) return "refract";
  return "frost";
}

class GlassLayer {
  private tier: GlassTier = "frost";
  private defs: SVGDefsElement | null = null;
  private readonly filters = new Map<string, string>();
  private serial = 0;
  private sizes = new WeakMap<Element, string>();
  private resize: ResizeObserver | null = null;
  private mutations: MutationObserver | null = null;

  start(): void {
    this.apply();
    if (typeof matchMedia === "function") {
      for (const q of ["(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"]) {
        matchMedia(q).addEventListener("change", () => this.apply());
      }
    }
  }

  /** Re-detect the tier (call after the transparency or contrast setting changes). */
  apply(): void {
    this.tier = detectTier();
    document.documentElement.dataset.glass = this.tier;
    if (this.tier === "refract") this.observe();
    else this.stop();
  }

  private observe(): void {
    if (this.resize) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    this.defs = document.createElementNS(SVG_NS, "defs");
    svg.appendChild(this.defs);
    document.body.appendChild(svg);
    this.resize = new ResizeObserver((entries) => {
      for (const e of entries) this.fit(e.target as HTMLElement, e.borderBoxSize?.[0]);
    });
    const scan = (root: ParentNode): void => {
      if (root instanceof HTMLElement && root.matches(GLASS_SELECTOR)) this.resize?.observe(root);
      root.querySelectorAll?.(GLASS_SELECTOR).forEach((el) => this.resize?.observe(el));
    };
    scan(document.body);
    this.mutations = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n));
    });
    this.mutations.observe(document.body, { childList: true, subtree: true });
  }

  private stop(): void {
    this.resize?.disconnect();
    this.mutations?.disconnect();
    this.resize = null;
    this.mutations = null;
    this.defs?.parentElement?.remove();
    this.defs = null;
    this.filters.clear();
  }

  private fit(el: HTMLElement, box?: ResizeObserverSize): void {
    const w = Math.round(box?.inlineSize ?? el.offsetWidth);
    const h = Math.round(box?.blockSize ?? el.offsetHeight);
    if (w < 2 || h < 2 || w > MAX_SIDE || h > MAX_SIDE) return;
    const r = Math.round(Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2));
    const key = `${w}x${h}r${r}`;
    if (this.sizes.get(el) === key) return;
    if (!this.filters.has(key) && this.filters.size >= MAX_FILTERS) {
      // too many sizes seen (window resizes): rebuild the cache from the elements on screen now
      this.filters.clear();
      this.defs?.replaceChildren();
      this.sizes = new WeakMap();
      this.serial++;
      document.querySelectorAll<HTMLElement>(GLASS_SELECTOR).forEach((other) => other !== el && this.fit(other));
    }
    this.sizes.set(el, key);
    el.style.setProperty("--glass-lens", `url(#${this.filter(w, h, r, key)})`);
  }

  private filter(w: number, h: number, r: number, key: string): string {
    const known = this.filters.get(key);
    if (known) return known;
    const id = `syn-glass-${this.serial}-${this.filters.size}`;
    const bezel = Math.min(cssNumber("--glass-bezel", 14), h / 2, w / 2);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return id;
    ctx.putImageData(new ImageData(displacementMap(w, h, r, bezel), w, h), 0, 0);
    const f = document.createElementNS(SVG_NS, "filter");
    f.setAttribute("id", id);
    f.setAttribute("x", "0");
    f.setAttribute("y", "0");
    f.setAttribute("width", String(w));
    f.setAttribute("height", String(h));
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    const img = document.createElementNS(SVG_NS, "feImage");
    img.setAttribute("href", canvas.toDataURL("image/png"));
    img.setAttribute("x", "0");
    img.setAttribute("y", "0");
    img.setAttribute("width", String(w));
    img.setAttribute("height", String(h));
    img.setAttribute("result", "map");
    const disp = document.createElementNS(SVG_NS, "feDisplacementMap");
    disp.setAttribute("in", "SourceGraphic");
    disp.setAttribute("in2", "map");
    disp.setAttribute("scale", String(cssNumber("--glass-refraction", 18)));
    disp.setAttribute("xChannelSelector", "R");
    disp.setAttribute("yChannelSelector", "G");
    f.append(img, disp);
    this.defs?.appendChild(f);
    this.filters.set(key, id);
    return id;
  }
}

export const glass = new GlassLayer();
