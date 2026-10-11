// The signature stage: owns the renderer, the live engine and the animation loop. Motion is a
// function of the audio time `s` from the player clock (docs/LIVE.md section 5), never of frame
// counts. Paused, the liquid layer eases back to the static signature in 400 ms.
import { useEffect, useRef, type MutableRefObject } from "react";
import { analysisTime } from "../audio/clock";
import type { AudioPlayer } from "../audio/player";
import { LiveEngine } from "../engine/live";
import { Pooler, type PooledFrame } from "../engine/pool";
import { createRenderer } from "../gl/create";
import { DUR_REVEAL_MS } from "../motion/tokens";
import type { GridRendererLike } from "../gl/renderer";
import { params } from "../params";
import type { OpenSong } from "../state/store";

const EASE_OUT_MS = 400;
const JUMP_RESET_S = 0.5;
const REPORT_HZ = 10;

export interface GridStats {
  kind: string;
  frames: number;
  lastMs: number;
  maxMs: number;
}

declare global {
  interface Window {
    __synesthesia?: {
      stats: GridStats;
      readPixels: () => Uint8ClampedArray;
      size: () => number;
      engineStep: (s: number) => void;
    };
  }
}

interface Props {
  open: OpenSong;
  player: AudioPlayer | null;
  reduced: boolean;
  forceCanvas?: boolean;
  /** Called at 10 Hz while playing with the best-matching cell of the current frame. */
  onBmu?: (bmu: number | null) => void;
  /** Drive the engine from the outside instead of the player (landing stage). */
  externalTime?: number | null;
  /** Same, read every frame from a ref so the caller does not re-render per scroll event. */
  externalTimeRef?: MutableRefObject<number | null>;
  /** Play the "analysis finished" reveal once on mount (cells grow in as a diagonal wave). */
  reveal?: boolean;
  ariaLabel: string;
}

const REVEAL_WAVE = 0.35;
const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

export function GridCanvas({ open, player, reduced, forceCanvas, onBmu, externalTime = null, externalTimeRef, reveal = false, ariaLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const extRef = useRef<number | null>(externalTime);
  extRef.current = externalTime;
  const onBmuRef = useRef(onBmu);
  onBmuRef.current = onBmu;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const start = (): (() => void) => {
    const renderer: GridRendererLike = createRenderer(canvas, params, forceCanvas);
    const engine = new LiveEngine(open.live, open.proto, open.stat.colorOklch, params, { reducedMotion: reduced });
    const trailMax = Math.max(2, Math.round(params.live.trail.length_s * open.live.fps));
    const pooler = new Pooler(params.grid.size, params.render.display_grid, trailMax);
    const n = params.render.display_grid;
    const ones = new Float32Array(open.stat.cells).fill(1);
    const staticFrame = new Pooler(params.grid.size, n, 1).pool(open.stat.colorSrgb, ones, new Float32Array(0), 0);
    const staticSrgb = staticFrame.srgb.slice();
    const lastLive = new Uint8Array(n * n * 3);
    const blend: PooledFrame = { nodes: n, srgb: new Uint8Array(n * n * 3), radiusScale: new Float32Array(n * n).fill(1), trail: new Float32Array(3), trailLength: 0 };
    const revealFrame: PooledFrame = { nodes: n, srgb: new Uint8Array(n * n * 3), radiusScale: new Float32Array(n * n).fill(1), trail: new Float32Array(3), trailLength: 0 };
    let revealStart = reveal ? -1 : -2; // -1: waiting for the first frame, -2: no reveal
    const stats: GridStats = { kind: renderer.kind, frames: 0, lastMs: 0, maxMs: 0 };
    window.__synesthesia = {
      stats,
      readPixels: () => renderer.readPixels(),
      size: () => canvas.width,
      engineStep: () => undefined,
    };

    let dirty = true;
    let wasLive = false;
    let easeStart = -1;
    let lastS = -1;
    let lastReport = 0;
    let raf = 0;

    const ro = new ResizeObserver(() => {
      const w = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
      renderer.resize(w, window.devicePixelRatio || 1);
      dirty = true;
    });
    ro.observe(canvas.parentElement ?? canvas);

    const liveAt = (s: number, now: number): void => {
      const t0 = performance.now();
      if (lastS < 0 || s < lastS || s - lastS > JUMP_RESET_S) engine.reset(s);
      const f = engine.step(s);
      lastS = s;
      const pf = pooler.pool(f.srgb, f.radiusScale, f.trail, f.trailLength);
      renderer.draw(pf);
      lastLive.set(pf.srgb);
      revealStart = -2;
      wasLive = true;
      easeStart = -1;
      const ms = performance.now() - t0;
      stats.frames++;
      stats.lastMs = ms;
      stats.maxMs = Math.max(stats.maxMs, ms);
      if (now - lastReport > 1000 / REPORT_HZ) {
        lastReport = now;
        onBmuRef.current?.(f.bmu);
      }
    };

    const loop = (now: number): void => {
      const ext = externalTimeRef ? externalTimeRef.current : extRef.current;
      if (ext !== null) {
        liveAt(ext, now);
      } else if (player && player.state === "playing") {
        liveAt(analysisTime(player.position(), open.live.audioOffsetS), now);
      } else if (revealStart !== -2) {
        if (revealStart === -1) revealStart = now;
        const t = Math.min((now - revealStart) / DUR_REVEAL_MS, 1);
        if (reduced) {
          const k = easeOutCubic(t);
          for (let i = 0; i < revealFrame.srgb.length; i++) revealFrame.srgb[i] = staticSrgb[i] * k;
        } else {
          revealFrame.srgb.set(staticSrgb);
          const p = t * (1 + REVEAL_WAVE);
          for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
              const d = (r + c) / (2 * (n - 1));
              revealFrame.radiusScale[r * n + c] = easeOutCubic(Math.min(Math.max((p - d) / REVEAL_WAVE, 0), 1));
            }
          }
        }
        renderer.draw(revealFrame);
        if (t >= 1) {
          revealStart = -2;
          dirty = true;
        }
      } else {
        lastS = -1;
        if (wasLive) {
          wasLive = false;
          if (reduced) dirty = true;
          else easeStart = now;
          onBmuRef.current?.(null);
        }
        if (easeStart >= 0) {
          const t = Math.min((now - easeStart) / EASE_OUT_MS, 1);
          if (t >= 1) {
            easeStart = -1;
            dirty = true;
          } else {
            const k = t * t * (3 - 2 * t);
            for (let i = 0; i < blend.srgb.length; i++) blend.srgb[i] = lastLive[i] + (staticSrgb[i] - lastLive[i]) * k;
            renderer.draw(blend);
          }
        }
        if (dirty && easeStart < 0) {
          renderer.draw(staticFrame);
          dirty = false;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
    };
    };
    // Create the GL context two frames after mount so the first paint never waits on it (D-044).
    let stop: (() => void) | undefined;
    let cancelled = false;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (!cancelled) stop = start();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      stop?.();
    };
  }, [open, player, reduced, forceCanvas]);

  return <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />;
}
