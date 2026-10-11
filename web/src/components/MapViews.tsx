// Companion map views drawn on 2D canvases (docs/ANALYSIS.md section 8, docs/UI.md section 6.6).
import { useEffect, useRef } from "react";
import { oklchToSrgb8 } from "../color/oklab";
import { ENVELOPE_POINTS, HIST_BINS, STRUCTURE_SIZE, TEMPO_COLS, TEMPO_ROWS, type MapsData, type StaticData } from "../data/formats";
import { params } from "../params";

export type MapView = "sound" | "features" | "structure" | "rhythm" | "dynamics";
export const FEATURES = ["brightness", "loudness", "noisiness", "harmonicity", "change"] as const;
export type FeatureName = (typeof FEATURES)[number];

const rgb = new Uint8Array(3);

/** Dark-to-light single-hue ramp (maps.ramp), t in [0, 1]. */
export function ramp(t: number, hueDeg: number, out: Uint8Array, o: number): void {
  const [l0, l1] = params.maps.ramp.lightness;
  const tt = Math.min(Math.max(t, 0), 1);
  oklchToSrgb8(l0 + (l1 - l0) * tt, params.maps.ramp.chroma, hueDeg, rgb);
  out[o] = rgb[0];
  out[o + 1] = rgb[1];
  out[o + 2] = rgb[2];
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

/** A feature grid in the dot style of the hero, pooled to the display grid. */
export function FeatureGridView({ stat, feature }: { stat: StaticData; feature: FeatureName }) {
  const size = params.grid.size;
  const n = params.render.display_grid;
  const px = 640;
  const ref = useCanvas(
    (c) => {
      const idx = FEATURES.indexOf(feature);
      const hue = params.maps.ramp_hues[feature];
      const block = size / n;
      const pitch = px / (n + 2 * params.render.margin_cells);
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
          c.arc((nx + 0.5 + params.render.margin_cells) * pitch, (ny + 0.5 + params.render.margin_cells) * pitch, params.render.node.dot.radius_ratio * pitch, 0, Math.PI * 2);
          c.fill();
        }
      }
    },
    px,
    px,
    [stat, feature],
  );
  return <canvas ref={ref} width={px} height={px} role="img" aria-label={`${feature} of each sound on the signature grid`} />;
}

export function StructureView({ maps }: { maps: MapsData }) {
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
  return <canvas ref={ref} width={STRUCTURE_SIZE} height={STRUCTURE_SIZE} style={{ imageRendering: "auto" }} role="img" aria-label="Self-similarity of the song over time" />;
}

export function RhythmView({ maps }: { maps: MapsData }) {
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
  return <canvas ref={ref} width={TEMPO_COLS} height={TEMPO_ROWS} role="img" aria-label="Tempogram: tempo over time" />;
}

export function DynamicsView({ maps }: { maps: MapsData }) {
  const w = 640;
  const h = 360;
  const ref = useCanvas(
    (c) => {
      c.fillStyle = "#000";
      c.fillRect(0, 0, w, h);
      const top = 150;
      c.strokeStyle = "rgba(255,255,255,0.18)";
      for (const db of [-50, -40, -30, -20, -10]) {
        const y = ((0 - db) / 60) * top;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
        c.fillStyle = "rgba(255,255,255,0.45)";
        c.font = "11px system-ui";
        c.fillText(`${db}`, 4, y - 3);
      }
      c.strokeStyle = "#78c8ff";
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < ENVELOPE_POINTS; i++) {
        const y = ((0 - Math.min(Math.max(maps.dynEnvelope[i], -60), 0)) / 60) * top;
        const x = (i / (ENVELOPE_POINTS - 1)) * w;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
      let peak = 1e-9;
      for (let i = 0; i < HIST_BINS; i++) peak = Math.max(peak, maps.dynHist[i]);
      const base = h - 24;
      const bw = w / HIST_BINS;
      c.fillStyle = "#78aadc";
      for (let i = 0; i < HIST_BINS; i++) {
        const bh = (maps.dynHist[i] / peak) * (base - top - 24);
        c.fillRect(i * bw + 1, base - bh, bw - 2, bh);
      }
      c.fillStyle = "rgba(255,255,255,0.45)";
      for (let db = -60; db <= 0; db += 10) c.fillText(`${db}`, ((db + 60) / 60) * (w - 18) + 2, h - 8);
    },
    w,
    h,
    [maps],
  );
  return <canvas ref={ref} width={w} height={h} role="img" aria-label="Loudness over time and its distribution" />;
}

export const CAPTIONS: Record<MapView, string> = {
  sound: "Sound map: every dot is a kind of sound in the song. Similar sounds sit close together.",
  features: "Features: how bright, loud, noisy, tonal and changing each kind of sound is.",
  structure: "Structure: the song compared with itself. Bright squares are repeated sections.",
  rhythm: "Rhythm: how strong each tempo is over time. Bright bands are the pulse.",
  dynamics: "Dynamics: loudness over time (top) and how often each level occurs (bottom).",
};
