// One clock per signature screen (D-062): a single requestAnimationFrame loop reads the audio time once
// per display frame and hands the same value to every live view (the grid, the trail chart), in that
// order, in the same callback. So the views agree on `s` by construction, not by being close.
import { analysisTime } from "./clock";
import type { AudioPlayer } from "./player";

export type FrameListener = (now: number) => void;

const LOG_MAX = 600;

export class FrameClock {
  /** Analysis time of this frame (seconds). */
  s = 0;
  playing = false;
  now = 0;
  /** [now, s] per frame (the last LOG_MAX), for the sync test. */
  readonly log: Array<[number, number]> = [];
  private readonly subs: FrameListener[] = [];
  private raf = 0;

  constructor(
    private readonly player: AudioPlayer,
    private readonly audioOffsetS: number,
  ) {}

  /** Listeners run in subscription order; returns the unsubscribe function. */
  subscribe(fn: FrameListener): () => void {
    this.subs.push(fn);
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    return () => {
      const i = this.subs.indexOf(fn);
      if (i >= 0) this.subs.splice(i, 1);
      if (!this.subs.length && this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
    };
  }

  private readonly tick = (now: number): void => {
    this.now = now;
    this.playing = this.player.state === "playing";
    this.s = analysisTime(this.player.position(), this.audioOffsetS);
    this.log.push([now, this.s]);
    if (this.log.length > 2 * LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    for (const fn of this.subs.slice()) fn(now);
    this.raf = this.subs.length ? requestAnimationFrame(this.tick) : 0;
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.subs.length = 0;
  }
}
