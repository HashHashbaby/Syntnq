// The export caption drawn in the browser (D-065), for songs the analysis service does not hold (the
// bundled samples): the same band, sizes, positions and colours as the Python export
// (synesthesia/caption.py, config export.caption), in TeX Gyre Heros. The square above is the frozen 2D
// render; text is cut with an ellipsis to fit, as on the server.
import { params } from "../params";

export const WORDMARK = "SYNESTHESIA";
const ELLIPSIS = "\u2026";

export interface CaptionText {
  title: string;
  artist: string;
  attribution: string;
}

export function bandHeight(side: number): number {
  return Math.round(params.export.caption.band_ratio * side);
}

function font(size: number, bold: boolean): string {
  return `${bold ? 700 : 400} ${size}px ${params.export.caption.web_font}`;
}

/** Make sure the caption faces are loaded before drawing (canvas text does not wait for fonts). */
export async function loadCaptionFonts(side: number): Promise<void> {
  const c = params.export.caption;
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(font(Math.round(c.title_ratio * side), true)),
    document.fonts.load(font(Math.round(c.artist_ratio * side), false)),
  ]).catch(() => undefined);
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid).trimEnd() + ELLIPSIS).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + ELLIPSIS;
}

/** Draw the band under a square of `side` pixels (the canvas is side x (side + band)). */
export function drawCaption(ctx: CanvasRenderingContext2D, side: number, text: CaptionText): void {
  const c = params.export.caption;
  const r = params.render;
  const band = bandHeight(side);
  const margin = (r.margin_cells * side) / (r.display_grid + 2 * r.margin_cells);
  const right = side - margin;
  ctx.fillStyle = r.background;
  ctx.fillRect(0, side, side, band);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const markSize = Math.max(1, Math.round(c.wordmark_ratio * side));
  ctx.font = font(markSize, true);
  const track = c.wordmark_tracking_em * markSize;
  const markW = [...WORDMARK].reduce((w, ch) => w + ctx.measureText(ch).width, 0) + track * (WORDMARK.length - 1);
  let x = right - markW;
  ctx.fillStyle = c.colors.wordmark;
  for (const ch of WORDMARK) {
    ctx.fillText(ch, x, side + c.title_y * band);
    x += ctx.measureText(ch).width + track;
  }

  const lines: Array<[string, number, boolean, number, string, number]> = [
    [text.title, c.title_ratio, true, c.title_y, c.colors.title, right - markW - 2 * markSize - margin],
    [text.artist, c.artist_ratio, false, c.artist_y, c.colors.artist, right - margin],
    [text.attribution, c.attribution_ratio, false, c.attribution_y, c.colors.attribution, right - margin],
  ];
  for (const [line, ratio, bold, y, color, maxW] of lines) {
    if (!line) continue;
    ctx.font = font(Math.max(1, Math.round(ratio * side)), bold);
    ctx.fillStyle = color;
    ctx.fillText(fit(ctx, line, maxW), margin, side + y * band);
  }
}
