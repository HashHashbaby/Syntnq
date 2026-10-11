// Playback clock maths (docs/LIVE.md section 5). All motion is a function of the audio time `s`
// derived from the audio context clock, never of frame counts.

export interface ClockState {
  /** Context time at which source position 0 would have started (seconds). */
  startTime: number;
  /** Output latency of the device in seconds (0 when unknown). */
  outputLatency: number;
}

/** Latency compensation: outputLatency, else baseLatency, else 0 (seconds). */
export function deviceLatency(ctx: { outputLatency?: number; baseLatency?: number }): number {
  const out = ctx.outputLatency;
  if (typeof out === "number" && Number.isFinite(out) && out > 0) return out;
  const base = ctx.baseLatency;
  return typeof base === "number" && Number.isFinite(base) && base > 0 ? base : 0;
}

/** Position in the source file (seconds) that is being heard at context time `now`. */
export function sourcePosition(now: number, c: ClockState): number {
  return now - c.startTime - c.outputLatency;
}

/** Analysis time (seconds) for a source position: leading silence trimmed at ingest is removed. */
export function analysisTime(sourceS: number, audioOffsetS: number): number {
  return sourceS - audioOffsetS;
}

/** `startTime` that makes the source position equal `positionS` at context time `now`. */
export function startTimeFor(now: number, positionS: number, outputLatency: number): number {
  return now - positionS - outputLatency;
}

/** Index of the analysis frame shown at analysis time `s`. */
export function frameIndex(s: number, fps: number): number {
  return Math.floor(Math.max(s, 0) * fps);
}
