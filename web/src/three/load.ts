// Loading the 3D chunk (three.js + the chip renderer, D-045): once, shared. App start-up prefetches it
// when the browser is idle so opening a song never parses it in the middle of a transition.
import type { ChipFactory } from "../components/GridCanvas";

let chipModule: Promise<ChipFactory> | null = null;

export function loadChips(): Promise<ChipFactory> {
  chipModule ??= import("./chips").then((m) => m.createChipRenderer as ChipFactory);
  return chipModule;
}

/** Fetch and parse the chunk when the browser is idle (never on the first paint). */
export function prefetchChips(): void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const go = (): void => void loadChips().catch(() => undefined);
  if (idle) idle(go, { timeout: 3000 });
  else setTimeout(go, 1500);
}

let discModule: Promise<typeof import("./disc").createDiscRenderer> | null = null;

/** The disc renderer (D-060), from the same lazily loaded three.js chunk. */
export function loadDisc(): Promise<typeof import("./disc").createDiscRenderer> {
  discModule ??= import("./disc").then((m) => m.createDiscRenderer);
  return discModule;
}
