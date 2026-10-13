// Companion maps, live part (D-064): where "now" sits in each map, as a pure function of the audio time
// s (the same `s` the grid draws, from the screen's FrameClock). The maps themselves stay fixed per song.
// - structure, rhythm, dynamics: their time axis spans the analysed frames, so now = s x fps / frames;
// - rhythm: the tempo at now is the strongest of the 128 log-spaced BPM rows (40-240) in that column;
// - features: the current sound is the best-matching cell, drawn on the display grid with a short trail.
// All numbers: config ui.maps_live, color.ranges; map shapes from docs/ANALYSIS.md section 8.
import { ENVELOPE_POINTS, TEMPO_COLS, TEMPO_ROWS, type LiveStream } from "../data/formats";
import type { Params } from "../params";

export const BPM_LO = 40;
export const BPM_HI = 240;

/** Fraction of the song (0..1) at analysis time s. */
export function songFraction(s: number, live: LiveStream): number {
  return Math.min(Math.max((s * live.fps) / Math.max(live.frames - 1, 1), 0), 1);
}

/** BPM of tempogram row r (0 = 40 BPM at the bottom, TEMPO_ROWS - 1 = 240 BPM). */
export function bpmOfRow(r: number): number {
  return BPM_LO * Math.pow(BPM_HI / BPM_LO, r / (TEMPO_ROWS - 1));
}

/** Plot fraction (0 bottom .. 1 top) of a BPM on the log axis. */
export function rowOfBpm(bpm: number): number {
  return Math.log(bpm / BPM_LO) / Math.log(BPM_HI / BPM_LO);
}

/** The strongest tempo in the tempogram column at fraction f, with its strength (columns are normalised to max 1). */
export function tempoAt(tempogram: Float32Array, f: number): { bpm: number; strength: number } {
  const c = Math.min(TEMPO_COLS - 1, Math.floor(f * TEMPO_COLS));
  let best = 0, row = 0;
  for (let r = 0; r < TEMPO_ROWS; r++) {
    const v = tempogram[r * TEMPO_COLS + c];
    if (v > best) {
      best = v;
      row = r;
    }
  }
  return { bpm: bpmOfRow(row), strength: best };
}

/** Loudness (dBFS) of the dynamics envelope at fraction f. */
export function envelopeAt(env: Float32Array, f: number): number {
  return env[Math.min(ENVELOPE_POINTS - 1, Math.round(f * (ENVELOPE_POINTS - 1)))];
}

/** Display-grid node coordinates of the best-matching cells over the last trail_s up to s: (n, 3) x, y, age. */
export function nodeTrail(live: LiveStream, s: number, p: Params): { pts: Float32Array; n: number } {
  const size = p.grid.size;
  const block = size / p.render.display_grid;
  const span = p.ui.maps_live.now_trail_s;
  const t0 = Math.min(Math.max(Math.floor(s * live.fps), 0), live.frames - 1);
  const k = Math.max(2, Math.round(span * live.fps));
  const lo = Math.max(0, t0 - k + 1);
  const pts = new Float32Array((t0 - lo + 1) * 3);
  let n = 0;
  for (let t = lo; t <= t0; t++) {
    const cell = live.bmu[t];
    pts[n * 3] = (cell % size) / block;
    pts[n * 3 + 1] = Math.floor(cell / size) / block;
    pts[n * 3 + 2] = Math.min(Math.max((s - t / live.fps) / span, 0), 1);
    n++;
  }
  return { pts, n };
}

/** Time ticks for a song of `duration` seconds: start, intervals, end. */
export function timeTicks(duration: number, intervals: number): number[] {
  return Array.from({ length: intervals + 1 }, (_, i) => (duration * i) / intervals);
}

export interface FeatureLegend {
  low: string; // what the dark end means
  high: string; // what the light end means
  lowValue: string; // physical value at the dark end (calibration range)
  highValue: string;
}

const hz = (log10: number): string => {
  const v = 10 ** log10;
  return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
};

/** Legend for a feature grid: the ramp's ends in words and in physical units (the frozen calibration ranges). */
export function featureLegend(feature: string, p: Params): FeatureLegend {
  const r = p.ranges;
  switch (feature) {
    case "brightness":
      return { low: "dark, low", high: "bright, high", lowValue: hz(r.centroid_log10_hz[0]), highValue: hz(r.centroid_log10_hz[1]) };
    case "loudness":
      return { low: "quiet", high: "loud", lowValue: `${Math.round(r.loudness_dbfs[0])} dBFS`, highValue: `${Math.round(r.loudness_dbfs[1])} dBFS` };
    case "noisiness":
      return { low: "pure, tonal", high: "noise-like", lowValue: `flatness ${(10 ** r.noisiness_log10[0]).toExponential(0)}`, highValue: `${(10 ** r.noisiness_log10[1]).toFixed(2)}` };
    case "harmonicity":
      return { low: "percussive, noisy", high: "harmonic", lowValue: `${Math.round(r.harmonicity[0] * 100)} % harmonic`, highValue: `${Math.round(r.harmonicity[1] * 100)} %` };
    default:
      return { low: "steady", high: "changing", lowValue: `change ${r.change_z[0].toFixed(1)}`, highValue: `${r.change_z[1].toFixed(1)}` };
  }
}
