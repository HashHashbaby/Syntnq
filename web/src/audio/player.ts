// Web Audio player: decodes a local file, plays through an AudioBufferSourceNode and exposes the
// current source position from the context clock (docs/LIVE.md section 5).
import { deviceLatency, sourcePosition, startTimeFor, type ClockState } from "./clock";

export type PlayerState = "idle" | "ready" | "playing" | "paused" | "ended";

type Listener = () => void;

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private clock: ClockState = { startTime: 0, outputLatency: 0 };
  private pausedAt = 0;
  private listeners = new Set<Listener>();
  state: PlayerState = "idle";

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** Decode a file or blob. Resolves when the player is ready. */
  async load(data: Blob): Promise<void> {
    this.stopSource();
    const ctx = this.context();
    const arr = await data.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(arr);
    this.pausedAt = 0;
    this.state = "ready";
    this.emit();
  }

  /** Current position in the source file in seconds. */
  position(): number {
    if (!this.buffer) return 0;
    if (this.state === "playing" && this.ctx) {
      return Math.min(sourcePosition(this.ctx.currentTime, this.clock), this.buffer.duration);
    }
    return this.pausedAt;
  }

  async play(): Promise<void> {
    if (!this.buffer) return;
    const ctx = this.context();
    if (ctx.state === "suspended") await ctx.resume();
    if (this.state === "ended") this.pausedAt = 0;
    this.startAt(this.pausedAt);
  }

  private startAt(position: number): void {
    const ctx = this.context();
    if (!this.buffer) return;
    this.stopSource();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      if (this.source === src && this.state === "playing") {
        this.state = "ended";
        this.pausedAt = this.buffer?.duration ?? 0;
        this.emit();
      }
    };
    const latency = deviceLatency(ctx);
    this.clock = { startTime: startTimeFor(ctx.currentTime, position, latency), outputLatency: latency };
    src.start(0, position);
    this.source = src;
    this.state = "playing";
    this.emit();
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.pausedAt = this.position();
    this.stopSource();
    this.state = "paused";
    this.emit();
  }

  seek(seconds: number): void {
    if (!this.buffer) return;
    const t = Math.min(Math.max(seconds, 0), this.buffer.duration);
    if (this.state === "playing") this.startAt(t);
    else {
      this.pausedAt = t;
      if (this.state === "ended") this.state = "paused";
      this.emit();
    }
  }

  private stopSource(): void {
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
      s.disconnect();
    }
  }

  dispose(): void {
    this.stopSource();
    void this.ctx?.close();
    this.ctx = null;
    this.listeners.clear();
  }
}
