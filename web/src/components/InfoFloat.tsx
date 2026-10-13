// "How to read" pointers that float over a chart instead of pushing the layout down (D-064): a small glass
// chip beside the chart (in a map's header row, on the sound grid's caption line) opens into a glass panel. It opens while the pointer is over the chart
// (`hoverHost`; maps) or over the chip itself (the sound grid, where hovering a dot shows the inspector),
// on keyboard focus, and on tap (touch toggles it). Escape or leaving closes it.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./parts";

const OPEN_DELAY_MS = 120; // a pointer passing over the chart on its way elsewhere does not open it

export function InfoFloat({ items, label = "How to read", hoverHost = false, up = false }: { items: ReactNode[]; label?: string; hoverHost?: boolean; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false); // opened by a tap or click: stays until tapped again or Escape
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // the element whose hover opens it: the whole figure (maps), or the chip's own wrapper
    const host = hoverHost ? (el.closest("figure") ?? el) : el;
    const fine = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;
    let t = 0;
    const enter = (): void => {
      if (!fine) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    };
    const leave = (): void => {
      window.clearTimeout(t);
      if (!pinned.current) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        pinned.current = false;
        setOpen(false);
      }
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    el.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(t);
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      el.removeEventListener("keydown", key);
    };
  }, [hoverHost]);

  return (
    <div
      className="info-float"
      ref={ref}
      data-open={open}
      data-up={up || undefined}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !pinned.current) setOpen(false);
      }}
    >
      <button
        type="button"
        className="info-chip t-cap"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          pinned.current = !(open && pinned.current);
          setOpen(pinned.current || !open);
        }}
      >
        <Icon name="info.circle" size={14} />
        {label}
      </button>
      <ul className="info-panel t-foot" id={id} role="note" aria-label={label}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
