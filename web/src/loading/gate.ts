// When a loading surface (the mural, D-052) appears and leaves. It never shows for loads shorter
// than `delayMs`; once shown it stays at least `minMs` so it never flashes; then it fades out over
// `fadeMs` and is removed. No artificial delay: a load that finishes before `delayMs` ends at once.
// The numbers live in index.html (#syn-mural-params), read through muralParams().

export interface GateTimes {
  delayMs: number;
  minMs: number;
  fadeMs: number;
}

export interface GateHooks {
  show: () => void;
  hide: () => void; // start the fade-out
  remove: () => void; // the fade has finished (or the surface was never shown)
}

export interface Clock {
  now: () => number;
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}

const realClock: Clock = {
  now: () => performance.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class LoadGate {
  private shownAt: number | null = null;
  private pending: unknown = null;
  private finished = false;

  constructor(
    private readonly t: GateTimes,
    private readonly hooks: GateHooks,
    private readonly clock: Clock = realClock,
  ) {}

  /** Start waiting; the surface shows after `delayMs` unless finish() comes first. */
  start(): void {
    this.pending = this.clock.set(() => {
      this.pending = null;
      this.shownAt = this.clock.now();
      this.hooks.show();
    }, this.t.delayMs);
  }

  /** Take over a gate started elsewhere (the inline boot script in index.html). */
  adopt(shownAt: number | null, cancelPending: () => void): void {
    this.shownAt = shownAt;
    this.pending = shownAt === null ? cancelPending : null;
  }

  /** The load is done: leave now if never shown, otherwise after the minimum time, with a fade. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.pending !== null) {
      if (typeof this.pending === "function") (this.pending as () => void)();
      else this.clock.clear(this.pending);
      this.pending = null;
    }
    if (this.shownAt === null) {
      this.hooks.remove();
      return;
    }
    const wait = Math.max(0, this.t.minMs - (this.clock.now() - this.shownAt));
    this.clock.set(() => {
      this.hooks.hide();
      this.clock.set(() => this.hooks.remove(), this.t.fadeMs);
    }, wait);
  }
}

export interface MuralParams {
  cols: number;
  rows: number;
  hue_from_deg: number;
  hue_to_deg: number;
  lightness: [number, number];
  chroma: [number, number];
  stagger_ms: number;
  period_ms: number;
  delay_ms: number;
  min_ms: number;
  fade_ms: number;
}

/** The mural parameters from index.html (single source for the inline script and the app). */
export function muralParams(): MuralParams {
  const el = document.getElementById("syn-mural-params");
  return JSON.parse(el?.textContent ?? "{}") as MuralParams;
}

export function gateTimes(p: MuralParams = muralParams()): GateTimes {
  return { delayMs: p.delay_ms, minMs: p.min_ms, fadeMs: p.fade_ms };
}

interface BootState {
  shownAt: number | null;
  timer: number;
}

declare global {
  interface Window {
    __synBoot?: BootState;
    __synMuralBuild?: (grid: HTMLElement) => void;
    __synMuralLog?: { shownAt: number | null; hideAt: number | null; removedAt: number | null };
  }
}

/** Ends the boot mural once the app has painted its first frame (called from main.tsx). */
export function finishBoot(): void {
  const el = document.getElementById("syn-mural");
  const state = window.__synBoot;
  if (!el || !state) return;
  const log = { shownAt: state.shownAt, hideAt: null as number | null, removedAt: null as number | null };
  window.__synMuralLog = log;
  const gate = new LoadGate(gateTimes(), {
    show: () => undefined,
    hide: () => {
      log.hideAt = performance.now();
      el.classList.add("out");
    },
    remove: () => {
      log.removedAt = performance.now();
      el.remove();
    },
  });
  gate.adopt(state.shownAt, () => clearTimeout(state.timer));
  gate.finish();
}
