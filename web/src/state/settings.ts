// Appearance, motion and transparency settings, persisted in localStorage (a per-viewer
// convenience: the app renders correctly when storage is unavailable).
import { create } from "zustand";
import { glass } from "../glass/glass";

export type Toggle = "auto" | "on";

interface SettingsState {
  reduceMotion: Toggle;
  reduceTransparency: Toggle;
  keepAudio: boolean;
  /** Show the flat 2D dots instead of the 3D chips in the live view (D-046). */
  trueColour: boolean;
  /** Show the live trail chart (D-062). */
  showGraph: boolean;
  landingDone: boolean;
  set: (patch: Partial<Omit<SettingsState, "set">>) => void;
}

const KEY = "synesthesia.settings";

function load(): Partial<SettingsState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SettingsState>;
  } catch {
    return {};
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  reduceMotion: "auto",
  reduceTransparency: "auto",
  keepAudio: true,
  trueColour: false,
  showGraph: true,
  landingDone: false,
  ...(({ appearance: _ignored, ...rest }) => rest)(load() as Partial<SettingsState> & { appearance?: unknown }),
  set: (patch) => {
    set(patch);
    try {
      const { reduceMotion, reduceTransparency, keepAudio, landingDone, trueColour, showGraph } = get();
      localStorage.setItem(KEY, JSON.stringify({ reduceMotion, reduceTransparency, keepAudio, landingDone, trueColour, showGraph }));
    } catch {
      // storage unavailable: keep in memory only
    }
  },
}));

/** Applies settings to the document root (data attributes read by tokens.css and app.css). */
export function applySettings(s: Pick<SettingsState, "reduceMotion" | "reduceTransparency">): void {
  const root = document.documentElement;
  if (s.reduceMotion === "on") root.setAttribute("data-motion", "reduced");
  else root.removeAttribute("data-motion");
  if (s.reduceTransparency === "on") root.setAttribute("data-transparency", "reduced");
  else root.removeAttribute("data-transparency");
  glass.apply(); // the glass tier depends on the transparency setting
}

/** True when motion should be reduced: the in-app override or the system preference. */
export function motionReduced(s: Pick<SettingsState, "reduceMotion">): boolean {
  if (s.reduceMotion === "on") return true;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
