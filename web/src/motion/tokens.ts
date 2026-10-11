// Motion constants used from TypeScript (WAAPI, springs, the reveal). They mirror the CSS
// tokens in styles/tokens.css and docs/UI.md section 8; a unit test keeps the two in sync.
import { motionReduced, useSettings } from "../state/settings";

export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";
export const EASE_STAGE = "cubic-bezier(0.65, 0.05, 0, 1)";

export const DUR_HANDOFF_MS = 450;
export const DUR_REVEAL_MS = 450;
export const DIP_OUT_MS = 250;
export const DUR_SHEET_EXIT_MS = 250;
export const REDUCED_FADE_MS = 200;

/** Release velocity (px per ms) above which a drag dismisses regardless of distance (docs/UI.md section 7). */
export const FLICK_VELOCITY = 0.11;
/** Share of the sheet height a slow drag must cover to dismiss. */
export const DISMISS_FRACTION = 0.3;

/** Spring parameters (Apple-style: response in seconds, damping ratio). */
export const SPRING_DEFAULT = { response: 0.4, damping: 1 };
export const SPRING_FLICK = { response: 0.4, damping: 0.85 };

export function reduced(): boolean {
  return motionReduced(useSettings.getState());
}

/** True while the last input was the keyboard: shortcut-triggered changes are instant (D-044). */
export function keyboardDriven(): boolean {
  return document.documentElement.dataset.input === "keyboard";
}
