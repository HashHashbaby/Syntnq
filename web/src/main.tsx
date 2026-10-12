import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { glass } from "./glass/glass";
import { finishBoot } from "./loading/gate";
import "./styles/tokens.css";
import "./styles/app.css";

// Input modality: keyboard-initiated changes are instant, pointer ones animate (D-044).
const root = document.documentElement;
window.addEventListener("keydown", () => (root.dataset.input = "keyboard"), true);
window.addEventListener("pointerdown", () => (root.dataset.input = "pointer"), true);

glass.start();

// Dev-only pages and comparisons (never in production builds):
//   ?dev=glass&n=12[&glass=frost|solid]  glass stress test over the live canvas (D-051)
//   ?font=heros  the stack without Helvetica (what a Windows machine without Helvetica sees)
//   ?font=inter  Inter, which the owner allowed as an alternative face (D-048)
//   ?dev=mural&ms=1500  the in-app loading mural over a simulated load (D-052)
//   ?mural=hold  keep the boot mural on screen (for screenshots)
const q = new URLSearchParams(location.search);
async function boot(): Promise<void> {
  let view = <App />;
  if (import.meta.env.DEV) {
    const font = q.get("font");
    if (font === "heros") root.style.setProperty("--font", '"TeX Gyre Heros", Arial, sans-serif');
    if (font === "inter") {
      await import("@fontsource-variable/inter");
      root.style.setProperty("--font", '"Inter Variable", Arial, sans-serif');
    }
    if (q.get("dev") === "glass") {
      const { GlassStress } = await import("./dev/GlassStress");
      view = <GlassStress />;
    }
    // tests reach the store to open each bundled sample (dev builds only)
    (window as unknown as { __synApp?: unknown }).__synApp = (await import("./state/store")).useApp;
    if (q.get("dev") === "mural") {
      const { MuralPreview } = await import("./dev/MuralPreview");
      view = <MuralPreview />;
    }
  }
  createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode>{view}</StrictMode>);
  // the boot mural leaves once the app has painted its first frame (D-052)
  const hold = import.meta.env.DEV && q.get("mural") === "hold";
  if (!hold) requestAnimationFrame(() => requestAnimationFrame(() => finishBoot()));
}
void boot();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
