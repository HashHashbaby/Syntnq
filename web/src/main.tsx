import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/app.css";

// Input modality: keyboard-initiated changes are instant, pointer ones animate (D-044).
const root = document.documentElement;
window.addEventListener("keydown", () => (root.dataset.input = "keyboard"), true);
window.addEventListener("pointerdown", () => (root.dataset.input = "pointer"), true);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
