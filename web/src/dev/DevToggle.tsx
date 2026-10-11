// Dev-only switch for the worst-case data modes. Plain chrome: it is not part of the design
// under test. Selecting a mode rewrites `?data=` and reloads so the URL keeps the state.
import { DATA_MODES, dataMode, type DataMode } from "./worstcase";

const LABEL: Record<DataMode, string> = { demo: "Demo data", worst: "Worst case", empty: "Empty", one: "One", many: "1,284 rows" };

export function DevToggle() {
  // shown only while testing: add ?data=worst (or ?dev=1) to the address
  const q0 = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  if (!import.meta.env.DEV || !(q0.has('data') || q0.has('dev'))) return null;
  const active = dataMode();
  const pick = (m: DataMode): void => {
    const q = new URLSearchParams(location.search);
    if (m === "demo") q.delete("data");
    else q.set("data", m);
    location.search = q.toString();
  };
  return (
    <div
      role="group"
      aria-label="Data mode (dev only)"
      style={{ position: "fixed", bottom: 8, left: "50%", transform: "translateX(-50%)", zIndex: 200, display: "flex", gap: 2, padding: 2, borderRadius: 9, background: "#8e8e93", fontSize: 12, fontFamily: "system-ui, sans-serif" }}
    >
      {DATA_MODES.map((m) => (
        <button
          key={m}
          aria-pressed={m === active}
          onClick={() => pick(m)}
          style={{ border: 0, borderRadius: 7, padding: "4px 8px", background: m === active ? "#fff" : "transparent", color: m === active ? "#000" : "#fff", cursor: "pointer" }}
        >
          {LABEL[m]}
        </button>
      ))}
    </div>
  );
}
