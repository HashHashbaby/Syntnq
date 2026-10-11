// Canvas2D fallback when WebGL2 is unavailable (docs/LIVE.md section 4): same pooled frame,
// drawn with 2D primitives; runs at the display's frame rate on the main thread (the engine
// math is cheap, see D-042).
import type { PooledFrame } from "../engine/pool";
import type { Params } from "../params";
import type { GridRendererLike } from "./renderer";

const MAX_DPR = 2;

export class Canvas2DRenderer implements GridRendererLike {
  readonly kind = "canvas2d" as const;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private readonly layerCtx: CanvasRenderingContext2D;
  private px = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly p: Params,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D unavailable");
    this.ctx = ctx;
    this.layer = document.createElement("canvas");
    const lc = this.layer.getContext("2d");
    if (!lc) throw new Error("Canvas2D unavailable");
    this.layerCtx = lc;
  }

  resize(cssSize: number, dpr: number): void {
    const px = Math.max(64, Math.round(cssSize * Math.min(dpr, MAX_DPR)));
    if (px === this.px) return;
    this.px = px;
    this.canvas.width = px;
    this.canvas.height = px;
    this.layer.width = px;
    this.layer.height = px;
  }

  draw(frame: PooledFrame): void {
    if (this.px === 0) this.resize(this.canvas.clientWidth || 512, window.devicePixelRatio || 1);
    const { px, p } = this;
    const n = p.render.display_grid;
    const pitch = px / (n + 2 * p.render.margin_cells);
    const m = p.render.margin_cells;
    const c = this.layerCtx;
    c.globalCompositeOperation = "source-over";
    c.fillStyle = p.render.background;
    c.fillRect(0, 0, px, px);

    if (frame.trailLength >= 2) {
      c.lineCap = "round";
      c.lineJoin = "round";
      c.lineWidth = Math.max(1, p.live.trail.width_cells * pitch);
      for (let i = 1; i < frame.trailLength; i++) {
        const level = p.live.trail.opacity * (1 - frame.trail[i * 3 + 2]);
        c.strokeStyle = `rgba(255,255,255,${level.toFixed(3)})`;
        c.beginPath();
        c.moveTo((frame.trail[(i - 1) * 3] + 0.5 + m) * pitch, (frame.trail[(i - 1) * 3 + 1] + 0.5 + m) * pitch);
        c.lineTo((frame.trail[i * 3] + 0.5 + m) * pitch, (frame.trail[i * 3 + 1] + 0.5 + m) * pitch);
        c.stroke();
      }
    }
    const ratio = p.render.node.dot.radius_ratio;
    for (let i = 0; i < n * n; i++) {
      const cx = ((i % n) + 0.5 + m) * pitch;
      const cy = (Math.floor(i / n) + 0.5 + m) * pitch;
      c.fillStyle = `rgb(${frame.srgb[i * 3]},${frame.srgb[i * 3 + 1]},${frame.srgb[i * 3 + 2]})`;
      c.beginPath();
      c.arc(cx, cy, ratio * pitch * frame.radiusScale[i], 0, Math.PI * 2);
      c.fill();
    }

    const out = this.ctx;
    out.globalCompositeOperation = "source-over";
    out.filter = "none";
    out.globalAlpha = 1;
    out.drawImage(this.layer, 0, 0);
    out.globalCompositeOperation = "screen";
    out.globalAlpha = p.render.node.dot.glow_opacity;
    out.filter = `blur(${(p.render.node.dot.glow_sigma_ratio * pitch).toFixed(2)}px)`;
    out.drawImage(this.layer, 0, 0);
    out.filter = "none";
    out.globalAlpha = 1;
    out.globalCompositeOperation = "source-over";
  }

  readPixels(): Uint8ClampedArray {
    return this.ctx.getImageData(0, 0, this.px, this.px).data;
  }

  dispose(): void {
    // nothing to release
  }
}
