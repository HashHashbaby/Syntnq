import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { glass } from "./glass/glass";
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
  }
  createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode>{view}</StrictMode>);
}
void boot();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
