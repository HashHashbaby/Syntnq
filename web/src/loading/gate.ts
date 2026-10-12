// When a loading surface (the mural, D-052) appears and leaves. It never shows for loads shorter
// than `delayMs`; once shown it stays at least `minMs` so it never flashes; then it fades out over
// `fadeMs` and is removed. No artificial delay: a load that finishes before `delayMs` ends at once.
// The cold start uses its own times (D-061): shown from the first paint for one full sweep, then a
// slower fade; a key, click or tap after `skip_after_ms` ends it early.
// The numbers live in index.html (#syn-mural-params, a copy of config ui.mural), read through muralParams().

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
  private waiting: unknown = null; // the minimum-time timer after finish()
  private hidden = false;

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
    this.waiting = this.clock.set(() => {
      this.waiting = null;
      this.leave();
    }, wait);
  }

  /** Cut the minimum time short (the user asked to skip): fade out now if the load is done. */
  skip(): boolean {
    if (!this.finished || this.waiting === null || this.hidden) return false;
    this.clock.clear(this.waiting);
    this.waiting = null;
    this.leave();
    return true;
  }

  /** Shown for at least this long (ms), or null when not shown. */
  shownFor(): number | null {
    return this.shownAt === null ? null : this.clock.now() - this.shownAt;
  }

  private leave(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.hooks.hide();
    this.clock.set(() => this.hooks.remove(), this.t.fadeMs);
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
  boot_delay_ms: number;
  boot_min_ms: number;
  boot_min_reduced_ms: number;
  boot_fade_ms: number;
  skip_after_ms: number;
}

/** The mural parameters from index.html (single source for the inline script and the app). */
export function muralParams(): MuralParams {
  const el = document.getElementById("syn-mural-params");
  return JSON.parse(el?.textContent ?? "{}") as MuralParams;
}

export function gateTimes(p: MuralParams = muralParams()): GateTimes {
  return { delayMs: p.delay_ms, minMs: p.min_ms, fadeMs: p.fade_ms };
}

/** The cold-start times (D-061): one full sweep plus a hold, or the still mural under reduced motion. */
export function bootTimes(p: MuralParams, reduced: boolean): GateTimes {
  return { delayMs: p.boot_delay_ms, minMs: reduced ? p.boot_min_reduced_ms : p.boot_min_ms, fadeMs: p.boot_fade_ms };
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

/** Ends the boot mural once the app has painted its first frame (called from main.tsx): after its
 *  minimum time, or earlier when the user presses a key, clicks or taps (after `skip_after_ms`). */
export function finishBoot(): void {
  const el = document.getElementById("syn-mural");
  const state = window.__synBoot;
  if (!el || !state) return;
  const p = muralParams();
  const root = document.documentElement;
  const reduced = root.getAttribute("data-motion") === "reduced" || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const log = { shownAt: state.shownAt, hideAt: null as number | null, removedAt: null as number | null };
  window.__synMuralLog = log;
  const onInput = (e: Event): void => {
    const age = gate.shownFor();
    if (age === null || age < p.skip_after_ms) return;
    // the press ends the opening and does nothing else (a space must not also start playback)
    e.preventDefault();
    e.stopPropagation();
    gate.skip();
  };
  const listen = (on: boolean): void => {
    for (const type of ["keydown", "pointerdown"]) (on ? window.addEventListener : window.removeEventListener)(type, onInput, { capture: true });
  };
  const gate = new LoadGate(bootTimes(p, reduced), {
    show: () => undefined,
    hide: () => {
      log.hideAt = performance.now();
      el.classList.add("out");
      listen(false);
    },
    remove: () => {
      log.removedAt = performance.now();
      listen(false);
      el.remove();
    },
  });
  gate.adopt(state.shownAt, () => clearTimeout(state.timer));
  listen(true);
  gate.finish();
}
