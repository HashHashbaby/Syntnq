// Small shared components: segmented control, thumbnail, virtualised list, sheet, icon.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ICON_STROKE, icons, type IconName } from "../icons";

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const C = icons[name];
  return <C size={size} strokeWidth={ICON_STROKE} aria-hidden="true" />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; ariaLabel?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} aria-label={o.ariaLabel} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 32 x 32 static thumbnail drawn from the record's stored colours. */
export function Thumb({ bytes }: { bytes: Uint8Array | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.fillStyle = "#000";
    c.fillRect(0, 0, 40, 40);
    if (!bytes) return;
    const n = 32;
    const px = 40 / (n + 2);
    for (let i = 0; i < n * n; i++) {
      c.fillStyle = `rgb(${bytes[i * 3]},${bytes[i * 3 + 1]},${bytes[i * 3 + 2]})`;
      c.beginPath();
      c.arc(((i % n) + 1.5) * px, (Math.floor(i / n) + 1.5) * px, px * 0.4, 0, Math.PI * 2);
      c.fill();
    }
  }, [bytes]);
  return <canvas ref={ref} className="thumb" width={40} height={40} aria-hidden="true" />;
}

/** Fixed-row-height virtualised list: renders only the visible rows plus a small buffer. */
export function VirtualList<T>({
  items,
  rowHeight,
  render,
  onNearEnd,
  label,
}: {
  items: T[];
  rowHeight: number;
  render: (item: T, index: number) => ReactNode;
  onNearEnd?: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const buffer = 6;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + buffer);
  useEffect(() => {
    if (onNearEnd && last >= items.length - 10 && items.length > 0) onNearEnd();
  }, [last, items.length, onNearEnd]);
  return (
    <div ref={ref} className="list" role="listbox" aria-label={label} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: "relative" }}>
        {items.slice(first, last).map((item, k) => (
          <div key={first + k} style={{ position: "absolute", top: (first + k) * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {render(item, first + k)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>("button, [href], input, select, [tabindex]:not([tabindex='-1'])");
        if (f.length === 0) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={ref} className="sheet material" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="grabber" />
        <div className="toolbar" style={{ padding: 0 }}>
          <h2 className="t-title-2 grow">{title}</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="xmark" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

export function formatTime(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
