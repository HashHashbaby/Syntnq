// Small shared components: segmented control, thumbnail, virtualised list, sheet, icon.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ICON_STROKE, icons, type IconName } from "../icons";
import { DISMISS_FRACTION, FLICK_VELOCITY, REDUCED_FADE_MS, SPRING_DEFAULT, SPRING_FLICK, keyboardDriven, reduced } from "../motion/tokens";
import { releaseVelocity, rubberband, springTo, type SpringRun } from "../motion/spring";

/** True at phone widths (<= 734 px, D-033). */
export function usePhone(): boolean {
  const q = "(max-width: 734px)";
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = (): void => setOn(m.matches);
    m.addEventListener("change", f);
    f();
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

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
  const ref = useRef<HTMLDivElement>(null);
  // a segmented control that has to scroll (narrow screen, large text) keeps the selection in view
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [value]);
  return (
    <div className="segmented" role="group" aria-label={label} ref={ref}>
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

/**
 * Bottom sheet. Opening uses the drawer curve; closing from a pointer slides it back down
 * (faster than it came), and closing from the keyboard is instant. The grabber drags the sheet
 * 1:1: a flick above FLICK_VELOCITY or a pull past DISMISS_FRACTION closes it, otherwise a
 * spring returns it (docs/UI.md section 8).
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const spring = useRef<SpringRun | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const setOffset = useCallback((y: number): void => {
    const el = ref.current;
    if (el) el.style.transform = `translate(-50%, ${y}px)`;
    const h = el?.offsetHeight ?? 1;
    if (scrimRef.current) scrimRef.current.style.opacity = String(Math.max(0, Math.min(1, 1 - Math.max(0, y) / h)));
  }, []);

  const currentOffset = (el: HTMLElement): number => el.getBoundingClientRect().top - (window.innerHeight - el.offsetHeight);

  const dismiss = useCallback(
    (velocityPxPerMs?: number): void => {
      if (closing.current) return;
      closing.current = true;
      const el = ref.current;
      if (!el || keyboardDriven()) {
        closeRef.current();
        return;
      }
      spring.current?.cancel();
      if (reduced()) {
        const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, fill: "forwards" });
        scrimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, fill: "forwards" });
        void a.finished.then(() => closeRef.current(), () => closeRef.current());
        return;
      }
      const from = currentOffset(el);
      el.getAnimations().forEach((a) => a.cancel());
      const run = springTo(from, el.offsetHeight + 8, (velocityPxPerMs ?? 0) * 1000, { response: 0.3, damping: 1 }, setOffset);
      spring.current = run;
      void run.done.then(() => closeRef.current());
    },
    [setOffset],
  );

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") dismiss();
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
      spring.current?.cancel();
      prev?.focus();
    };
  }, [dismiss]);

  const onGrab = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el || closing.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    spring.current?.cancel();
    el.getAnimations().forEach((a) => a.cancel());
    const startY = e.clientY;
    const startOffset = currentOffset(el);
    const height = el.offsetHeight;
    const samples: { t: number; y: number }[] = [{ t: e.timeStamp, y: e.clientY }];
    const target = e.currentTarget;
    const move = (m: PointerEvent): void => {
      samples.push({ t: m.timeStamp, y: m.clientY });
      if (samples.length > 8) samples.shift();
      const dy = startOffset + (m.clientY - startY);
      setOffset(dy < 0 ? rubberband(dy, height) : dy);
    };
    const up = (u: PointerEvent): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      const v = releaseVelocity(samples);
      const offset = currentOffset(el);
      if (offset > height * DISMISS_FRACTION || v > FLICK_VELOCITY) {
        dismiss(Math.max(v, 0));
      } else if (reduced()) {
        setOffset(0);
      } else {
        const p = Math.abs(v) > FLICK_VELOCITY ? SPRING_FLICK : SPRING_DEFAULT;
        spring.current = springTo(offset, 0, v * 1000, p, setOffset);
      }
      void u;
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return (
    <>
      <div ref={scrimRef} className="scrim" onClick={() => dismiss()} />
      <div ref={ref} className="sheet material" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="grabber-hit" onPointerDown={onGrab} data-testid="sheet-grabber">
          <div className="grabber" />
        </div>
        <div className="toolbar" style={{ padding: 0 }}>
          <h2 className="t-title-2 grow">{title}</h2>
          <button className="btn btn-icon" onClick={() => dismiss()} aria-label="Close">
            <Icon name="xmark" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

export function formatTime(s: number): string {
  const t = Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
  const sec = String(t % 60).padStart(2, "0");
  if (t >= 3600) return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${sec}`;
  return `${Math.floor(t / 60)}:${sec}`;
}
