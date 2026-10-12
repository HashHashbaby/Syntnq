// Appearance, motion and transparency settings, persisted in localStorage (a per-viewer
// convenience: the app renders correctly when storage is unavailable).
import { create } from "zustand";
import { glass } from "../glass/glass";

export type Appearance = "auto" | "dark" | "light";
export type Toggle = "auto" | "on";

interface SettingsState {
  appearance: Appearance;
  reduceMotion: Toggle;
  reduceTransparency: Toggle;
  keepAudio: boolean;
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
  appearance: "light", // D-047: light by default; dark and auto are settings
  reduceMotion: "auto",
  reduceTransparency: "auto",
  keepAudio: true,
  landingDone: false,
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { appearance, reduceMotion, reduceTransparency, keepAudio, landingDone } = get();
      localStorage.setItem(KEY, JSON.stringify({ appearance, reduceMotion, reduceTransparency, keepAudio, landingDone }));
    } catch {
      // storage unavailable: keep in memory only
    }
  },
}));

/** Applies settings to the document root (data attributes read by tokens.css and app.css). */
export function applySettings(s: Pick<SettingsState, "appearance" | "reduceMotion" | "reduceTransparency">): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", s.appearance);
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
