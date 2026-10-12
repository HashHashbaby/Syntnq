// The loading mural inside the app (D-052): the same tiles as the boot mural in index.html (built by
// the one builder that page defines), shown over a surface while something loads, through LoadGate.
// Phase 3 wraps the 3D scene chunk with it; `?dev=mural&ms=1500` previews it over a fake load.
import { useEffect, useRef, useState } from "react";
import { LoadGate, gateTimes } from "./gate";

type Phase = "waiting" | "shown" | "leaving" | "gone";

/** Covers its parent while `loading` is true, following the gate's delay, minimum and fade. */
export function LoadingMural({ loading, label = "Loading" }: { loading: boolean; label?: string }) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const gate = useRef<LoadGate | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const g = new LoadGate(gateTimes(), {
      show: () => setPhase("shown"),
      hide: () => setPhase("leaving"),
      remove: () => setPhase("gone"),
    });
    gate.current = g;
    g.start();
    return () => g.finish();
  }, []);

  useEffect(() => {
    if (!loading) gate.current?.finish();
  }, [loading]);

  useEffect(() => {
    const el = grid.current;
    if (el && el.childElementCount === 0) window.__synMuralBuild?.(el);
  }, [phase]);

  if (phase === "gone" || phase === "waiting") return null;
  return (
    <div className="mural-cover" data-phase={phase} role="status" aria-label={label}>
      <div className="mural" aria-hidden="true">
        <div className="mural-light" />
        <div className="mural-bloom" />
        <div className="mural-grid" ref={grid} />
        <div className="mural-dust" />
      </div>
    </div>
  );
}
