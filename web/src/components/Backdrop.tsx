// The graphite ground (D-053): a dark grey gradient that is black past the corners of the grid
// square, a faint grain, and the ambient light (the open song's static colours, heavily blurred,
// masked away from the square) that gives the glass panes something to refract. The gradient
// follows the square through reportStage(); updates write CSS variables on this element only, never
// per frame and never through React state.
import { useEffect, useRef } from "react";

type Rect = { x: number; y: number; w: number; h: number } | null;
const listeners = new Set<(r: Rect) => void>();
let last: Rect = null;

/** Called by the signature view whenever the grid square moves or resizes (null when it unmounts). */
export function reportStage(el: Element | null): void {
  if (!el) last = null;
  else {
    const b = el.getBoundingClientRect();
    last = b.width > 0 ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
  }
  listeners.forEach((f) => f(last));
}

const AMBIENT_SIDE = 64;

export function Backdrop({ colors }: { colors: Uint8Array | null }) {
  const root = useRef<HTMLDivElement>(null);
  const ambient = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const apply = (r: Rect): void => {
      const el = root.current;
      if (!el) return;
      if (!r) {
        el.style.removeProperty("--gx");
        el.style.removeProperty("--gy");
        el.style.removeProperty("--gr");
        return;
      }
      el.style.setProperty("--gx", `${r.x + r.w / 2}px`);
      el.style.setProperty("--gy", `${r.y + r.h / 2}px`);
      el.style.setProperty("--gr", `${Math.max(r.w, r.h) / 2}px`);
    };
    listeners.add(apply);
    apply(last);
    return () => {
      listeners.delete(apply);
    };
  }, []);

  // the ambient layer: the song's static colours (analysis grid, i = row * side + col) on a tiny canvas
  useEffect(() => {
    const c = ambient.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    if (!colors) {
      ctx.clearRect(0, 0, c.width, c.height);
      return;
    }
    const cells = colors.length / 3;
    const side = Math.round(Math.sqrt(cells));
    const img = ctx.createImageData(side, side);
    for (let i = 0; i < cells; i++) {
      img.data[i * 4] = colors[i * 3];
      img.data[i * 4 + 1] = colors[i * 3 + 1];
      img.data[i * 4 + 2] = colors[i * 3 + 2];
      img.data[i * 4 + 3] = 255;
    }
    c.width = side;
    c.height = side;
    ctx.putImageData(img, 0, 0);
  }, [colors]);

  return (
    <div className="backdrop" ref={root} aria-hidden="true">
      <div className="backdrop-gradient" />
      <canvas className="backdrop-ambient" ref={ambient} width={AMBIENT_SIDE} height={AMBIENT_SIDE} data-empty={!colors} />
      <div className="backdrop-grain" />
    </div>
  );
}
