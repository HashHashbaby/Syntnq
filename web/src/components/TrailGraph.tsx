// The live trail chart (D-062): loudness (dBFS) across, brightness (Hz, log) up, on the frozen calibration
// ranges so every song shares the axes. It draws from the screen's FrameClock in the same frame and with
// the same `s` as the grid. The trail is the last `trail_s` of the song up to s (engine/graph.ts); a faint
// cloud shows the whole song. Axes and labels are DOM text; the trail and the dot are drawn on a canvas.
import { useEffect, useMemo, useRef } from "react";
import type { FrameClock } from "../audio/frameClock";
import { oklchToSrgb8 } from "../color/oklab";
import { GraphSampler, formatDb, formatHz, ticks } from "../engine/graph";
import { params } from "../params";
import type { OpenSong } from "../state/store";

const MAX_DPR = 2;
const DOT_L = 0.8; // the current-moment dot: OKLCH lightness and chroma; hue = the grid's brightness hue
const DOT_C = 0.13;
const HUE_STOPS = 9;

declare global {
  interface Window {
    /** The chart as drawn: [frame time, s] per drawn frame, and the last point, for tests. */
    __synGraph?: { log: Array<[number, number]>; last: () => { db: number; hz: number; x: number; y: number; s: number } | null };
  }
}

interface Props {
  open: OpenSong;
  clock: FrameClock;
  reduced: boolean;
}

const g = params.ui.trail_graph;
const hueAt = (t: number): number => params.color.hue.from_deg + (params.color.hue.to_deg - params.color.hue.from_deg) * t;

export function TrailGraph({ open, clock, reduced }: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
  const cloudRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<HTMLCanvasElement>(null);
  const figRef = useRef<HTMLDivElement>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const sampler = useMemo(() => new GraphSampler(open.live, params), [open]);
  const a = sampler.axes;
  const xTicks = ticks(g.loudness_ticks_dbfs, a.dbLo, a.dbHi, false);
  const yTicks = ticks(g.brightness_ticks_hz, a.logHzLo, a.logHzHi, true);
  // the y-axis hue strip: the same brightness -> hue mapping that colours the grid
  const strip = useMemo(() => {
    const stops: string[] = [];
    for (let i = 0; i < HUE_STOPS; i++) {
      const t = i / (HUE_STOPS - 1);
      stops.push(`oklch(0.7 0.13 ${hueAt(t).toFixed(1)}) ${(t * 100).toFixed(1)}%`);
    }
    return `linear-gradient(to top, ${stops.join(", ")})`;
  }, []);

  useEffect(() => {
    const plot = plotRef.current, cloud = cloudRef.current, trail = trailRef.current, fig = figRef.current;
    if (!plot || !cloud || !trail || !fig) return;
    const ctx = trail.getContext("2d");
    const cctx = cloud.getContext("2d");
    if (!ctx || !cctx) return;
    const density = sampler.density();
    let w = 0, h = 0, dpr = 1;
    let lastS = -1, lastPlaying = false, pauseAt = -1, fadeDone = true, dirty = true, lastAlt = 0;
    const rgb = new Uint8Array(3);
    const log: Array<[number, number]> = [];
    let last: { db: number; hz: number; x: number; y: number; s: number } | null = null;
    window.__synGraph = { log, last: () => last };

    const paintCloud = (): void => {
      cctx.clearRect(0, 0, cloud.width, cloud.height);
      const b = g.cloud_bins;
      const img = new ImageData(b, b);
      for (let i = 0; i < b * b; i++) {
        img.data[i * 4] = 255;
        img.data[i * 4 + 1] = 255;
        img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = Math.round(density[i] * g.cloud_opacity * 255);
      }
      const tmp = document.createElement("canvas");
      tmp.width = b;
      tmp.height = b;
      tmp.getContext("2d")!.putImageData(img, 0, 0);
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = "high";
      cctx.drawImage(tmp, 0, 0, cloud.width, cloud.height);
    };

    const resize = (): void => {
      const r = plot.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      w = Math.max(1, Math.round(r.width * dpr));
      h = Math.max(1, Math.round(r.height * dpr));
      for (const c of [cloud, trail]) {
        c.width = w;
        c.height = h;
      }
      paintCloud();
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(plot);
    resize();

    const draw = (now: number): void => {
      const s = clock.s, playing = clock.playing;
      if (playing !== lastPlaying) {
        if (!playing) {
          pauseAt = now;
          fadeDone = false;
        }
        lastPlaying = playing;
      }
      const fading = !playing && !fadeDone;
      if (!dirty && !playing && !fading && s === lastS) return; // nothing changed: no redraw
      dirty = false;
      lastS = s;
      let k = 1; // trail strength: 1 playing, easing to 0 over the grid's pause fade
      if (!playing) {
        const t = pauseAt < 0 ? 1 : Math.min((now - pauseAt) / g.pause_fade_ms, 1);
        k = 1 - t * t * (3 - 2 * t);
        if (t >= 1) fadeDone = true;
      }
      if (reducedRef.current) k = 0;
      const tr = sampler.at(s);
      ctx.clearRect(0, 0, w, h);
      const px = (i: number): number => tr.pts[i * 3] * w;
      const py = (i: number): number => (1 - tr.pts[i * 3 + 1]) * h;
      if (k > 0.001 && (playing || pauseAt >= 0)) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = g.line_width_px * dpr;
        for (let i = 1; i < tr.n; i++) {
          const age = tr.pts[i * 3 + 2];
          ctx.strokeStyle = `rgba(255,255,255,${(g.trail_opacity * (1 - age) * k).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(px(i - 1), py(i - 1));
          ctx.lineTo(px(i), py(i));
          ctx.stroke();
        }
      }
      const i = tr.n - 1;
      const x = px(i), y = py(i);
      const r = g.dot_radius_px * dpr;
      oklchToSrgb8(DOT_L, DOT_C, hueAt(tr.brightNorm), rgb); // one exact conversion (the fast path builds a table first)
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (tr.now.clipped) {
        ctx.lineWidth = 2 * dpr; // outside the calibration range: pinned to the edge, drawn open
        ctx.strokeStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fill();
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
      }
      const hz = 10 ** tr.now.logHz;
      last = { db: tr.now.db, hz, x: tr.pts[i * 3], y: tr.pts[i * 3 + 1], s };
      log.push([now, s]);
      if (log.length > 1200) log.splice(0, 600);
      if (now - lastAlt > 1000 / g.alt_text_hz || !playing) {
        lastAlt = now;
        fig.setAttribute("aria-label", `Loudness ${formatDb(tr.now.db)}, brightness ${formatHz(hz)}`);
      }
    };
    const off = clock.subscribe(draw);
    return () => {
      off();
      ro.disconnect();
      if (window.__synGraph?.log === log) delete window.__synGraph;
    };
  }, [sampler, clock]);

  return (
    <section className="pane graph-pane" aria-label="Loudness and brightness" data-testid="trail-graph">
      <h2 className="t-headline">Loudness and brightness</h2>
      <div className="graph" ref={figRef} role="img" aria-label="Loudness and brightness of the current moment">
        <div className="graph-ytitle t-cap secondary" aria-hidden="true">Brightness (Hz)</div>
        <div className="graph-yticks" aria-hidden="true">
          {yTicks.map((t) => (
            <span key={t.value} className="t-cap tabular secondary" style={{ bottom: `${(t.at * 100).toFixed(2)}%` }}>
              {t.value >= 1000 ? `${t.value / 1000}k` : t.value}
            </span>
          ))}
        </div>
        <div className="graph-plot" ref={plotRef}>
          {xTicks.map((t) => <i key={`x${t.value}`} className="graph-grid-v" style={{ left: `${(t.at * 100).toFixed(2)}%` }} />)}
          {yTicks.map((t) => <i key={`y${t.value}`} className="graph-grid-h" style={{ bottom: `${(t.at * 100).toFixed(2)}%` }} />)}
          <i className="graph-hue" style={{ background: strip, width: g.hue_strip_px }} />
          <canvas ref={cloudRef} className="graph-layer" />
          <canvas ref={trailRef} className="graph-layer" />
        </div>
        <div className="graph-xticks" aria-hidden="true">
          {xTicks.map((t) => (
            <span key={t.value} className="t-cap tabular secondary" style={{ left: `${(t.at * 100).toFixed(2)}%` }}>
              {t.value}
            </span>
          ))}
        </div>
        <div className="graph-xtitle t-cap secondary" aria-hidden="true">Loudness (dBFS)</div>
      </div>
      <p className="t-foot secondary">The same scale for every song. The grid groups sounds by similarity, so its trail traces a different shape.</p>
    </section>
  );
}
