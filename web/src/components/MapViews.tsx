// Companion map views drawn on 2D canvases (docs/ANALYSIS.md section 8, docs/UI.md section 6.6).
// Each map is fixed per song. D-064 adds, around each one, axes in real units and two or three reading
// pointers, and over it a live "now" layer driven by the screen's FrameClock (the grid's own `s`): a ring
// and short trail on the features grid, a crosshair on the structure map, a playhead and the current tempo
// on the rhythm map, a playhead and the current level on the dynamics charts. The maps themselves, their
// colours and the exports are unchanged.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { FrameClock } from "../audio/frameClock";
import { oklchToSrgb8 } from "../color/oklab";
import { ENVELOPE_POINTS, HIST_BINS, STRUCTURE_SIZE, TEMPO_COLS, TEMPO_ROWS, type LiveStream, type MapsData, type StaticData } from "../data/formats";
import { envelopeAt, featureLegend, nodeTrail, rowOfBpm, songFraction, tempoAt, timeTicks } from "../engine/mapsNow";
import { params } from "../params";
import { InfoFloat } from "./InfoFloat";
import { formatTime } from "./parts";

export type MapView = "sound" | "features" | "structure" | "rhythm" | "dynamics";
export const FEATURES = ["brightness", "loudness", "noisiness", "harmonicity", "change"] as const;
export type FeatureName = (typeof FEATURES)[number];

const rgb = new Uint8Array(3);
const ML = params.ui.maps_live;
const MAX_DPR = 2;
const DB_LO = -60; // dynamics charts: dBFS range (ANALYSIS.md section 8: histogram over -60..0)
const DB_TICKS = [-50, -40, -30, -20, -10];
const RAMP_STOPS = 7;
const NOW = "rgba(255,255,255,0.92)";
// viewport height kept for the chrome around a map (toolbar, caption, player, axes), so the player stays in view
const FIG_RESERVE_PX = 360;
const FEATURES_RESERVE_PX = 440; // plus the feature picker above and the colour bar below

/** Dark-to-light single-hue ramp (maps.ramp), t in [0, 1]. */
export function ramp(t: number, hueDeg: number, out: Uint8Array, o: number): void {
  const [l0, l1] = params.maps.ramp.lightness;
  const tt = Math.min(Math.max(t, 0), 1);
  oklchToSrgb8(l0 + (l1 - l0) * tt, params.maps.ramp.chroma, hueDeg, rgb);
  out[o] = rgb[0];
  out[o + 1] = rgb[1];
  out[o + 2] = rgb[2];
}

function rampCss(hue: number): string {
  const c = new Uint8Array(3);
  const stops = Array.from({ length: RAMP_STOPS }, (_, i) => {
    ramp(i / (RAMP_STOPS - 1), hue, c, 0);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function imageFrom(w: number, h: number, fill: (x: number, y: number, out: Uint8Array, o: number) => void): ImageData {
  const bytes = new Uint8ClampedArray(w * h * 4);
  const px = new Uint8Array(3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fill(x, y, px, 0);
      const o = (y * w + x) * 4;
      bytes[o] = px[0];
      bytes[o + 1] = px[1];
      bytes[o + 2] = px[2];
      bytes[o + 3] = 255;
    }
  }
  return new ImageData(bytes, w, h);
}

function useCanvas(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (c) draw(c, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Live context for the now layer: the shared clock, the live stream, and whether this map is on screen. */
export interface MapLive {
  clock: FrameClock | null;
  live: LiveStream;
  active: boolean;
}

/** The now layer: a canvas over the plot, redrawn from the clock only when `s` changes (D-064). */
function useNowLayer(ml: MapLive | undefined, draw: (c: CanvasRenderingContext2D, w: number, h: number, s: number, dpr: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !ml?.clock || !ml.active) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let lastS = -1, lastW = 0;
    const off = ml.clock.subscribe(() => {
      const s = ml.clock!.s;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (s === lastS && w === lastW) return;
      lastS = s;
      lastW = w;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h, s, dpr);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml?.clock, ml?.active, ...deps]);
  return ref;
}

interface Tick {
  label: string;
  at: number; // 0..1 along the axis (x: left to right; y: bottom to top)
}

/** A map with axes: [y title] / [y ticks | plot] / [x ticks] / [x title] / legend; its reading pointers float
 *  over it from a corner chip (they open while the pointer is over the map) so they never push the layout. */
function Figure(props: { label: string; yTitle?: string; yTicks?: Tick[]; xTitle?: string; xTicks?: Tick[]; aspect: number; plot: ReactNode; legend?: ReactNode; pointers: ReactNode[]; reserve?: number }) {
  const { label, yTitle, yTicks = [], xTitle, xTicks = [], aspect, plot, legend, pointers, reserve = FIG_RESERVE_PX } = props;
  return (
    <figure className="mapfig" aria-label={label} style={{ ["--aspect" as string]: String(aspect), ["--reserve" as string]: `${reserve}px` }}>
      <div className="mapfig-head">
        <span className="mapfig-ytitle t-cap secondary">{yTitle}</span>
        <InfoFloat items={pointers} hoverHost />
      </div>
      <div className="mapfig-yticks" aria-hidden="true">
        {yTicks.map((t) => (
          <span key={t.label} className="t-cap tabular secondary" style={{ bottom: `${(t.at * 100).toFixed(2)}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <div className="mapfig-plot" style={{ aspectRatio: String(aspect) }}>
        {plot}
      </div>
      <div className="mapfig-xticks" aria-hidden="true">
        {xTicks.map((t, i) => (
          <span key={t.label} className="t-cap tabular secondary" style={{ left: `${(t.at * 100).toFixed(2)}%` }} data-edge={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : undefined}>
            {t.label}
          </span>
        ))}
      </div>
      {xTitle && <div className="mapfig-xtitle t-cap secondary">{xTitle}</div>}
      {legend && <div className="mapfig-legend">{legend}</div>}
    </figure>
  );
}

function songTicks(live: LiveStream): Tick[] {
  const dur = (live.frames - 1) / live.fps;
  return timeTicks(dur, ML.time_ticks).map((t) => ({ label: formatTime(t), at: dur > 0 ? t / dur : 0 }));
}

/** Pointers for the Sound map (the main grid): a chip on the stage that opens on its own hover, tap or focus
 *  (hovering the grid itself shows the dot inspector). */
export function SoundPointers() {
  return (
    <InfoFloat
      up
      items={[
        <>
          <b>Position:</b> brighter sounds sit higher, louder ones further right (within this song).
        </>,
        <>
          <b>Colour:</b> blue is a dark, low sound, orange a bright, high one; a glowing dot is loud and common in the song.
        </>,
        <>
          <b>Line of light:</b> where the music is now and the last 2 seconds.
        </>,
      ]}
    />
  );
}

/** A feature grid in the dot style of the hero, pooled to the display grid, with the current sound ringed. */
export function FeatureGridView({ stat, feature, live }: { stat: StaticData; feature: FeatureName; live?: MapLive }) {
  const size = params.grid.size;
  const n = params.render.display_grid;
  const m = params.render.margin_cells;
  const px = 640;
  const hue = params.maps.ramp_hues[feature];
  const ref = useCanvas(
    (c) => {
      const idx = FEATURES.indexOf(feature);
      const block = size / n;
      const pitch = px / (n + 2 * m);
      c.fillStyle = params.render.background;
      c.fillRect(0, 0, px, px);
      const col = new Uint8Array(3);
      for (let ny = 0; ny < n; ny++) {
        for (let nx = 0; nx < n; nx++) {
          let v = 0;
          for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) v += stat.featureGrids[idx * stat.cells + (ny * block + dy) * size + nx * block + dx];
          ramp(v / (block * block), hue, col, 0);
          c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
          c.beginPath();
          c.arc((nx + 0.5 + m) * pitch, (ny + 0.5 + m) * pitch, params.render.node.dot.radius_ratio * pitch, 0, Math.PI * 2);
          c.fill();
        }
      }
    },
    px,
    px,
    [stat, feature],
  );
  const now = useNowLayer(
    live,
    (c, w, _h, s, dpr) => {
      const tr = nodeTrail(live!.live, s, params);
      const pitch = w / (n + 2 * m);
      const at = (i: number): [number, number] => [(tr.pts[i * 3] + 0.5 + m) * pitch, (tr.pts[i * 3 + 1] + 0.5 + m) * pitch];
      c.lineCap = "round";
      c.lineJoin = "round";
      c.lineWidth = ML.playhead_px * dpr;
      for (let i = 1; i < tr.n; i++) {
        const [x0, y0] = at(i - 1), [x1, y1] = at(i);
        c.strokeStyle = `rgba(255,255,255,${(0.6 * (1 - tr.pts[i * 3 + 2])).toFixed(3)})`;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
      }
      const [x, y] = at(tr.n - 1);
      c.strokeStyle = NOW;
      c.lineWidth = ML.ring_px * dpr;
      c.beginPath();
      c.arc(x, y, pitch * 0.85, 0, Math.PI * 2);
      c.stroke();
    },
    [feature],
  );
  const lg = featureLegend(feature, params);
  return (
    <Figure
      label={`${feature} of each sound on the signature grid`}
      yTitle="↑ brighter sounds"
      xTitle="louder sounds →"
      aspect={1}
      reserve={FEATURES_RESERVE_PX}
      plot={
        <>
          <canvas ref={ref} width={px} height={px} role="img" aria-label={`${feature} of each sound on the signature grid`} />
          <canvas ref={now} className="mapfig-now" aria-hidden="true" />
        </>
      }
      legend={
        <div className="map-ramp">
          <div className="map-ramp-bar" style={{ background: rampCss(hue) }} aria-hidden="true" />
          <div className="map-ramp-ends t-cap secondary">
            <span>
              {lg.low} <span className="tabular">({lg.lowValue})</span>
            </span>
            <span>
              {lg.high} <span className="tabular">({lg.highValue})</span>
            </span>
          </div>
        </div>
      }
      pointers={[
        <>The same dots as the sound map, each coloured by its {feature} alone. Light dots: {lg.high}. Dark dots: {lg.low}.</>,
        <>The ring is the sound playing now; its tail is the last 2 seconds.</>,
      ]}
    />
  );
}

export function StructureView({ maps, live }: { maps: MapsData; live?: MapLive }) {
  const ref = useCanvas(
    (c) => {
      c.putImageData(
        imageFrom(STRUCTURE_SIZE, STRUCTURE_SIZE, (x, y, out) => ramp(Math.max(maps.structure[y * STRUCTURE_SIZE + x], 0), 250, out, 0)),
        0,
        0,
      );
    },
    STRUCTURE_SIZE,
    STRUCTURE_SIZE,
    [maps],
  );
  const now = useNowLayer(
    live,
    (c, w, h, s, dpr) => {
      const f = songFraction(s, live!.live);
      const x = f * w, y = f * h;
      c.strokeStyle = "rgba(255,255,255,0.55)";
      c.lineWidth = ML.playhead_px * dpr * 0.75;
      c.setLineDash([4 * dpr, 4 * dpr]);
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = NOW;
      c.beginPath();
      c.arc(x, y, 4 * dpr, 0, Math.PI * 2);
      c.fill();
    },
    [maps],
  );
  if (!live) return <canvas ref={ref} width={STRUCTURE_SIZE} height={STRUCTURE_SIZE} style={{ imageRendering: "auto" }} role="img" aria-label="Self-similarity of the song over time" />;
  const ticks = songTicks(live.live);
  return (
    <Figure
      label="Self-similarity of the song over time"
      yTitle="Time ↓"
      yTicks={ticks.map((t) => ({ ...t, at: 1 - t.at }))}
      xTitle="Time →"
      xTicks={ticks}
      aspect={1}
      plot={
        <>
          <canvas ref={ref} width={STRUCTURE_SIZE} height={STRUCTURE_SIZE} role="img" aria-label="Self-similarity of the song over time" />
          <canvas ref={now} className="mapfig-now" aria-hidden="true" />
        </>
      }
      pointers={[
        <>The diagonal is each moment matched with itself. A bright square away from it is a part that comes back, like a chorus.</>,
        <>The dot is now: follow its lines across to see where this part was heard before or will return.</>,
      ]}
    />
  );
}

export function RhythmView({ maps, live }: { maps: MapsData; live?: MapLive }) {
  const ref = useCanvas(
    (c) => {
      c.putImageData(
        imageFrom(TEMPO_COLS, TEMPO_ROWS, (x, y, out) => ramp(maps.tempogram[(TEMPO_ROWS - 1 - y) * TEMPO_COLS + x], 30, out, 0)),
        0,
        0,
      );
    },
    TEMPO_COLS,
    TEMPO_ROWS,
    [maps],
  );
  const readout = useRef<HTMLSpanElement>(null);
  const now = useNowLayer(
    live,
    (c, w, h, s, dpr) => {
      const f = songFraction(s, live!.live);
      const x = f * w;
      const t = tempoAt(maps.tempogram, f);
      c.strokeStyle = NOW;
      c.lineWidth = ML.playhead_px * dpr;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
      const y = (1 - rowOfBpm(t.bpm)) * h;
      c.fillStyle = NOW;
      c.beginPath();
      c.arc(x, y, 4 * dpr, 0, Math.PI * 2);
      c.fill();
      if (readout.current) readout.current.textContent = t.strength > 0 ? `Now: about ${Math.round(t.bpm)} BPM` : "Now: no clear pulse";
    },
    [maps],
  );
  const bpmTicks = useMemo(() => ML.bpm_ticks.map((b) => ({ label: String(b), at: rowOfBpm(b) })), []);
  if (!live) return <canvas ref={ref} width={TEMPO_COLS} height={TEMPO_ROWS} role="img" aria-label="Tempogram: tempo over time" />;
  return (
    <Figure
      label="Tempogram: tempo over time"
      yTitle="Tempo (BPM)"
      yTicks={bpmTicks}
      xTitle="Time →"
      xTicks={songTicks(live.live)}
      aspect={TEMPO_COLS / TEMPO_ROWS}
      plot={
        <>
          <canvas ref={ref} width={TEMPO_COLS} height={TEMPO_ROWS} role="img" aria-label="Tempogram: tempo over time" />
          <canvas ref={now} className="mapfig-now" aria-hidden="true" />
        </>
      }
      pointers={[
        <>A bright horizontal band is a steady pulse at that tempo; where it fades, the beat loosens.</>,
        <>Bands at double or half the tempo are normal: the same beat counted twice as fast or half as fast.</>,
        <span ref={readout} className="tabular">Now: press play</span>,
      ]}
    />
  );
}

function dbY(db: number, h: number): number {
  return ((0 - Math.min(Math.max(db, DB_LO), 0)) / -DB_LO) * h;
}

export function DynamicsView({ maps, live, summary }: { maps: MapsData; live?: MapLive; summary?: { lra: number | null; mean: number | null; peak: number | null } }) {
  const ew = 640, eh = 220, hw = 640, hh = 150;
  const env = useCanvas(
    (c) => {
      c.fillStyle = "#000";
      c.fillRect(0, 0, ew, eh);
      c.strokeStyle = "rgba(255,255,255,0.1)";
      c.lineWidth = 1;
      for (const db of DB_TICKS) {
        const y = dbY(db, eh);
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(ew, y);
        c.stroke();
      }
      c.strokeStyle = "#78c8ff";
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < ENVELOPE_POINTS; i++) {
        const y = dbY(maps.dynEnvelope[i], eh);
        const x = (i / (ENVELOPE_POINTS - 1)) * ew;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    },
    ew,
    eh,
    [maps],
  );
  const hist = useCanvas(
    (c) => {
      c.fillStyle = "#000";
      c.fillRect(0, 0, hw, hh);
      let peak = 1e-9;
      for (let i = 0; i < HIST_BINS; i++) peak = Math.max(peak, maps.dynHist[i]);
      const bw = hw / HIST_BINS;
      c.fillStyle = "#78aadc";
      for (let i = 0; i < HIST_BINS; i++) {
        const bh = (maps.dynHist[i] / peak) * (hh - 8);
        c.fillRect(i * bw + 1, hh - bh, bw - 2, bh);
      }
    },
    hw,
    hh,
    [maps],
  );
  const envNow = useNowLayer(
    live,
    (c, w, h, s, dpr) => {
      const f = songFraction(s, live!.live);
      const x = f * w;
      c.fillStyle = "rgba(255,255,255,0.07)"; // the part already played
      c.fillRect(0, 0, x, h);
      c.strokeStyle = NOW;
      c.lineWidth = ML.playhead_px * dpr;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
      c.fillStyle = NOW;
      c.beginPath();
      c.arc(x, dbY(envelopeAt(maps.dynEnvelope, f), h), 4 * dpr, 0, Math.PI * 2);
      c.fill();
    },
    [maps],
  );
  const histNow = useNowLayer(
    live,
    (c, w, h, s, dpr) => {
      const db = envelopeAt(maps.dynEnvelope, songFraction(s, live!.live));
      const x = ((Math.min(Math.max(db, DB_LO), 0) - DB_LO) / -DB_LO) * w;
      c.strokeStyle = NOW;
      c.lineWidth = ML.playhead_px * dpr;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    },
    [maps],
  );
  if (!live) {
    return (
      <div className="mapfig-stack">
        <canvas ref={env} width={ew} height={eh} role="img" aria-label="Loudness over time" />
        <canvas ref={hist} width={hw} height={hh} role="img" aria-label="How often each loudness level occurs" />
      </div>
    );
  }
  const dbTicks = DB_TICKS.map((db) => ({ label: String(db), at: 1 - dbY(db, 1) }));
  const levelTicks = [-60, -40, -20, 0].map((db) => ({ label: String(db), at: (db - DB_LO) / -DB_LO }));
  const fmt = (v: number | null): string => (v === null ? "n/a" : `${v.toFixed(1)}`);
  return (
    <div className="mapfig-stack">
      <Figure
        label="Loudness over time"
        yTitle="Loudness (dBFS)"
        yTicks={dbTicks}
        xTitle="Time →"
        xTicks={songTicks(live.live)}
        aspect={ew / eh}
        plot={
          <>
            <canvas ref={env} width={ew} height={eh} role="img" aria-label="Loudness over time" />
            <canvas ref={envNow} className="mapfig-now" aria-hidden="true" />
          </>
        }
        pointers={[<>The line is the loudness moment to moment; the shaded part has played. Higher is louder (0 dBFS is the digital maximum).</>]}
      />
      <Figure
        label="How often each loudness level occurs"
        yTitle="Share of the song"
        xTitle="Loudness (dBFS) →"
        xTicks={levelTicks}
        aspect={hw / hh}
        plot={
          <>
            <canvas ref={hist} width={hw} height={hh} role="img" aria-label="How often each loudness level occurs" />
            <canvas ref={histNow} className="mapfig-now" aria-hidden="true" />
          </>
        }
        pointers={[
          <>Tall bars are the levels the song spends most time at; a narrow cluster means steady loudness. The line is the level now.</>,
          <span className="tabular">
            Loudness range {fmt(summary?.lra ?? null)} dB · average {fmt(summary?.mean ?? null)} dBFS · peak {fmt(summary?.peak ?? null)} dBFS
          </span>,
        ]}
      />
    </div>
  );
}

export const CAPTIONS: Record<MapView, string> = {
  sound: "Sound map: every dot is a kind of sound in the song. Similar sounds sit close together.",
  features: "Features: how bright, loud, noisy, tonal and changing each kind of sound is.",
  structure: "Structure: the song compared with itself. Bright squares are repeated sections.",
  rhythm: "Rhythm: how strong each tempo is over time. Bright bands are the pulse.",
  dynamics: "Dynamics: loudness over time (top) and how often each level occurs (bottom).",
};
