// The rotating disc in the player bar (D-060). Its label is the song's signature card, drawn by the
// frozen 2D renderer (Canvas2D path) into an offscreen canvas. The angle follows the audio clock
// (engine/disc.ts); the loop runs only while the disc moves. Decorative: aria-hidden, no input.
import { useEffect, useRef } from "react";
import type { AudioPlayer } from "../audio/player";
import { DiscMotion } from "../engine/disc";
import { Pooler } from "../engine/pool";
import { Canvas2DRenderer } from "../gl/canvas2d";
import { params } from "../params";
import type { OpenSong } from "../state/store";
import type { DiscRendererLike } from "../three/disc";
import { loadDisc } from "../three/load";

const LABEL_PX = 512;
const IDLE_TIMEOUT_MS = 1200; // the chunk loads by then even on a busy page
const LOG_MAX = 900;
const HANDOFF_POLL_MS = 150; // re-check for the end of the landing handoff this often

declare global {
  interface Window {
    /** The disc as drawn: [wall s, audio s, angle rad (clockwise)] per drawn frame, for tests. */
    __synesthesiaDisc?: { log: Array<[number, number, number]>; omega: number; drawn: () => number };
  }
}

/** The static signature card, drawn by the 2D renderer at LABEL_PX. */
function drawCard(open: OpenSong): HTMLCanvasElement {
  const n = params.render.display_grid;
  const ones = new Float32Array(params.grid.size * params.grid.size).fill(1);
  const frame = new Pooler(params.grid.size, n, 1).pool(open.stat.colorSrgb, ones, new Float32Array(0), 0);
  const card = document.createElement("canvas");
  const r = new Canvas2DRenderer(card, params);
  r.resize(LABEL_PX, 1);
  r.draw(frame);
  return card;
}

interface Props {
  open: OpenSong;
  player: AudioPlayer;
  reduced: boolean;
}

export function Disc({ open, player, reduced }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let renderer: DiscRendererLike | null = null;
    let raf = 0;
    let dead = false;
    const motion = new DiscMotion(params.web3d.disc);
    motion.reset(player.position(), performance.now() / 1000);
    const log: Array<[number, number, number]> = [];
    window.__synesthesiaDisc = { log, omega: motion.omega, drawn: () => renderer?.drawnAngle ?? 0 };

    const frame = (): void => {
      raf = 0;
      if (!renderer) return;
      const wall = performance.now() / 1000;
      const s = player.position();
      const a = motion.step({ wall, s, playing: player.state === "playing", reduced: reducedRef.current });
      renderer.draw(a);
      log.push([wall, s, a]);
      if (log.length > 2 * LOG_MAX) log.splice(0, log.length - LOG_MAX); // trim in batches, not per frame
      if (!motion.atRest()) raf = requestAnimationFrame(frame);
    };
    const kick = (): void => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(() => {
      renderer?.resize(canvas.clientWidth, window.devicePixelRatio || 1);
      kick();
    });
    // load the 3D chunk when the browser is idle, never in the middle of the screen transition
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    // and not while the first landing hands its stage over (creating a GL context mid-travel stalls it,
    // as for the grid in GridCanvas): wait until the handoff has finished, then for an idle moment
    const handoffRunning = (): boolean => !!document.querySelector('.landing[data-exit="handoff"]');
    let handoffWait = 0;
    const start = (): void => {
      if (dead) return;
      if (handoffRunning()) {
        handoffWait = window.setTimeout(() => {
          handoffWait = 0;
          scheduleIdle();
        }, HANDOFF_POLL_MS);
        return;
      }
      void loadDisc()
        .then((create) => {
          if (dead) return;
          renderer = create(canvas, params);
          renderer.setLabel(drawCard(open));
          renderer.resize(canvas.clientWidth, window.devicePixelRatio || 1);
          canvas.dataset.ready = "true";
          ro.observe(canvas);
          kick();
        })
        .catch(() => {
          canvas.hidden = true; // no WebGL: the player bar works without the disc
        });
    };
    let cancelIdle: () => void = () => undefined;
    const scheduleIdle = (): void => {
      if (w.requestIdleCallback && w.cancelIdleCallback) {
        const h = w.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
        const cancel = w.cancelIdleCallback;
        cancelIdle = () => cancel(h);
      } else {
        const h = window.setTimeout(start, IDLE_TIMEOUT_MS);
        cancelIdle = () => window.clearTimeout(h);
      }
    };
    scheduleIdle();
    // play, pause and seek all emit a change: restart the loop if it had stopped
    const off = player.onChange(kick);
    return () => {
      dead = true;
      cancelIdle();
      window.clearTimeout(handoffWait);
      off();
      ro.disconnect();
      cancelAnimationFrame(raf);
      renderer?.dispose();
      if (window.__synesthesiaDisc?.log === log) delete window.__synesthesiaDisc;
    };
  }, [open, player]);

  return <canvas ref={ref} className="disc" aria-hidden="true" data-testid="disc" />;
}
