// Dev-only preview of the in-app loading mural (D-052): ?dev=mural&ms=1500 simulates a load of
// `ms` milliseconds inside a signature-sized lightbox card, so the gate (delay, minimum, fade) can
// be seen and recorded. ms below the gate delay shows that fast loads never flash the mural.
import { useEffect, useState } from "react";
import { LoadingMural } from "../loading/Mural";

export function MuralPreview() {
  const ms = Number(new URLSearchParams(location.search).get("ms") ?? "1500");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--bg)" }}>
      <div className="stage-card" style={{ width: "min(90vw, 70vh)" }} data-testid="mural-stage">
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <p className="t-eyebrow secondary">{loading ? "Loading" : "Loaded"}</p>
        </div>
        <LoadingMural loading={loading} label="Loading the 3D view" />
      </div>
    </div>
  );
}
