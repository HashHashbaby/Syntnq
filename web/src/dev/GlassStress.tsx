// Dev-only stress page for the glass material (plan section 7.3, D-051): N glass controls over
// the live grid canvas, which re-renders every frame, so every backdrop filter is re-run every
// frame. Open with ?dev=glass&n=12 (and &glass=frost|solid to force a tier). After a warm-up the
// page records requestAnimationFrame intervals and publishes p50 / p95 / max on
// window.__glassStress for tests/e2e/glass-stress.spec.ts.
import { useEffect, useRef, useState } from "react";
import { GridCanvas } from "../components/GridCanvas";
import { fetchSongData } from "../data/api";
import { recordFromApi } from "../data/types";
import { parseData, type OpenSong } from "../state/store";

const WARMUP_MS = 1000;
const MEASURE_MS = 6000;
const LIVE_START_S = 8;

declare global {
  interface Window {
    __glassStress?: { n: number; tier: string; frames: number; p50: number; p95: number; max: number };
  }
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

export function GlassStress() {
  const n = Number(new URLSearchParams(location.search).get("n") ?? "12");
  const [song, setSong] = useState<OpenSong | null>(null);
  const time = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      const idx = (await (await fetch("/samples/index.json")).json()) as { slug: string; song_id: string; title: string; artist: string; genre: string | null; duration_s: number }[];
      const info = idx.find((s) => s.slug === "electronic") ?? idx[0];
      const data = await fetchSongData(info.song_id, `/samples/${info.slug}`);
      const rec = recordFromApi({ song_id: info.song_id, title: info.title, artist: info.artist, genre: info.genre, release_year: null, source: null, chart_peak: null, chart_weeks: null, duration_s: info.duration_s, created_at: 0 });
      setSong(parseData(rec, data, null));
    })();
  }, []);

  useEffect(() => {
    if (!song) return;
    const t0 = performance.now();
    const gaps: number[] = [];
    let last = t0;
    let raf = 0;
    const frame = (now: number): void => {
      time.current = LIVE_START_S + (now - t0) / 1000;
      if (now - t0 > WARMUP_MS) gaps.push(now - last);
      last = now;
      if (now - t0 < WARMUP_MS + MEASURE_MS) raf = requestAnimationFrame(frame);
      else {
        const s = [...gaps].sort((a, b) => a - b);
        window.__glassStress = { n, tier: document.documentElement.dataset.glass ?? "", frames: s.length, p50: quantile(s, 0.5), p95: quantile(s, 0.95), max: s[s.length - 1] ?? 0 };
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [song, n]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--bg)" }}>
      {song && (
        <div className="stage-card" style={{ width: "min(96vw, 96vh)", position: "relative" }}>
          <GridCanvas open={song} player={null} reduced={false} externalTimeRef={time} ariaLabel="Stress test grid" />
          <div style={{ position: "absolute", inset: 24, display: "flex", flexWrap: "wrap", gap: 12, alignContent: "flex-start", pointerEvents: "none" }}>
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className="glass btn" style={{ display: "inline-grid", placeItems: "center", minWidth: 120 }}>
                Glass {i + 1}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
