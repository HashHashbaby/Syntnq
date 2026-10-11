// First landing (docs/UI.md section 6.0, D-033): one scroll-driven stage, shown once to a new
// visitor. Its state is a function of scroll progress: static signature, the liquid state, then a
// companion map; it ends in the mapping key and the actions. Skip is always visible. With reduced
// motion there is no pinning: the same three steps are stacked.
// Leaving (D-044): "Try a sample" hands the stage over to the signature card (a shared-element
// transition of the live canvas; from the map step the map fades to the signature on the way);
// Skip and "Add a song" fade the landing out.
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSongData } from "../data/api";
import { GridCanvas } from "../components/GridCanvas";
import { StructureView } from "../components/MapViews";
import { oklchToSrgb8 } from "../color/oklab";
import { DIP_OUT_MS, DUR_HANDOFF_MS, EASE_OUT, EASE_STAGE, REDUCED_FADE_MS } from "../motion/tokens";
import { params } from "../params";
import { motionReduced, useSettings } from "../state/settings";
import { parseData, useApp, type OpenSong } from "../state/store";
import { recordFromApi } from "../data/types";

const LIQUID_FROM = 0.3;
const MAP_FROM = 0.66;
const LIQUID_START_S = 8;
const LIQUID_SPAN_S = 14;

function swatch(t: number): string {
  const px = new Uint8Array(3);
  const h = params.color.hue.from_deg + (params.color.hue.to_deg - params.color.hue.from_deg) * t;
  oklchToSrgb8(0.7, 0.16, h, px);
  return `rgb(${px[0]},${px[1]},${px[2]})`;
}

function Key() {
  const hues = useMemo(() => Array.from({ length: 8 }, (_, i) => swatch(i / 7)), []);
  return (
    <div className="key" aria-label="How to read the colours">
      <div className="key-row">
        <span className="t-foot secondary">Colour</span>
        <div>
          <div className="swatches" aria-hidden="true">
            {hues.map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </div>
          <p className="t-sub">Blue is a dark, low sound; orange is a bright, high one.</p>
        </div>
      </div>
      <div className="key-row">
        <span className="t-foot secondary">Brightness</span>
        <p className="t-sub">A dot glows more when its sound is loud and common in the song.</p>
      </div>
      <div className="key-row">
        <span className="t-foot secondary">Vividness</span>
        <p className="t-sub">Vivid dots are tonal, like a voice or a chord; muted ones are noisy.</p>
      </div>
      <p className="t-foot secondary">Colours summarise the sound. They are not a prediction of how anyone would colour music.</p>
    </div>
  );
}

export function FirstLanding({ onDone, onAdd }: { onDone: () => void; onAdd: () => void }) {
  const settings = useSettings();
  const reduced = motionReduced(settings);
  const samples = useApp((s) => s.samples);
  const addSample = useApp((s) => s.addSample);
  const [demo, setDemo] = useState<OpenSong | null>(null);
  const [step, setStep] = useState(0);
  const extTime = useRef<number | null>(null);
  const exitRef = useRef<"fade" | "handoff" | null>(null);
  const [exit, setExit] = useState<"fade" | "handoff" | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const demoInfo = samples.find((s) => s.slug === "electronic") ?? samples[0];

  useEffect(() => {
    const info = demoInfo;
    if (!info) return;
    let cancelled = false;
    void fetchSongData(info.song_id, `/samples/${info.slug}`).then((data) => {
      if (cancelled) return;
      const rec = recordFromApi({ song_id: info.song_id, title: info.title, artist: info.artist, genre: info.genre, release_year: null, source: null, chart_peak: null, chart_weeks: null, duration_s: info.duration_s, created_at: 0 });
      setDemo(parseData(rec, data, null));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [samples]);

  // progress runs over the pinned track only; the key and the actions follow it
  const onScroll = (): void => {
    const el = scroller.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const p = Math.min(1, Math.max(0, el.scrollTop / Math.max(1, track.offsetHeight - el.clientHeight)));
    const st = p < LIQUID_FROM ? 0 : p < MAP_FROM ? 1 : 2;
    const liquidT = Math.min(Math.max((p - LIQUID_FROM) / (MAP_FROM - LIQUID_FROM), 0), 1);
    // the liquid clock is read by the canvas every frame from this ref: no re-render per scroll event
    extTime.current = !reduced && st === 1 && !exitRef.current ? LIQUID_START_S + liquidT * LIQUID_SPAN_S : null;
    setStep(st);
  };

  const finish = (after?: () => void, handoff = false): void => {
    if (exit) return;
    settings.set({ landingDone: true });
    const mode = handoff && !reduced && demo && stageRef.current ? "handoff" : "fade";
    exitRef.current = mode;
    extTime.current = null;
    setExit(mode);
    after?.();
  };

  useEffect(() => {
    if (!exit) return;
    const root = scroller.current;
    const stage = stageRef.current;
    let cancelled = false;
    let raf = 0;
    const animations: Animation[] = [];
    const complete = (): void => {
      if (!cancelled) onDone();
    };
    const fade = (): void => {
      if (!root) return complete();
      const a = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? REDUCED_FADE_MS : DIP_OUT_MS, easing: EASE_OUT, fill: "forwards" });
      animations.push(a);
      void a.finished.then(complete, () => undefined);
    };
    if (exit === "fade" || !stage) {
      fade();
    } else {
      const t0 = performance.now();
      const seek = (): void => {
        if (cancelled) return;
        const target = document.querySelector<HTMLElement>('[data-testid="stage"]');
        const to = target?.getBoundingClientRect();
        if (to && to.width > 0) {
          const from = stage.getBoundingClientRect();
          const dx = to.left + to.width / 2 - (from.left + from.width / 2);
          const dy = to.top + to.height / 2 - (from.top + from.height / 2);
          const k = to.width / from.width;
          const a = stage.animate(
            [{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }],
            { duration: DUR_HANDOFF_MS, easing: EASE_STAGE, fill: "forwards" },
          );
          animations.push(a);
          void a.finished.then(complete, () => undefined);
        } else if (performance.now() - t0 < 2500) {
          raf = requestAnimationFrame(seek);
        } else {
          fade();
        }
      };
      seek();
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      animations.forEach((a) => a.cancel());
    };
  }, [exit]);

  const copy = [
    { h: "Every song has a shape.", t: "Each dot is a kind of sound the song contains. Sounds that are alike sit close together." },
    { h: "Press play and it moves.", t: "The grid follows the music from moment to moment, flowing to the beat." },
    { h: "And it keeps going.", t: "Maps show where a song repeats itself, how its rhythm moves and how its loudness rises and falls." },
  ];

  return (
    <div className="landing" ref={scroller} onScroll={onScroll} data-static={reduced} data-exit={exit ?? undefined} role="dialog" aria-modal="true" aria-label="Welcome">
      <button className="btn btn-plain landing-skip" style={{ position: "fixed", top: 12, right: 12, zIndex: 2, color: "#f5f5f7" }} onClick={() => finish()}>
        Skip
      </button>
      <div className="landing-track" ref={trackRef}>
        <div className="landing-sticky">
          <h1 className="t-display" style={{ textAlign: "center" }}>
            Hear the music. <span className="secondary" style={{ color: "rgba(235,235,245,0.6)" }}>See its signature.</span>
          </h1>
          {demo && !reduced ? (
            <div className="landing-stage stage-card" data-testid="landing-stage" ref={stageRef}>
              {/* the canvas stays mounted for the whole landing (creating a GL context costs about 100 ms); the map overlays it */}
              <GridCanvas open={demo} player={null} reduced={false} externalTimeRef={extTime} ariaLabel="Example signature" />
              {step === 2 && (
                <div className="maps-card" style={{ position: "absolute", inset: 0 }}>
                  <StructureView maps={demo.maps} />
                </div>
              )}
            </div>
          ) : (
            <div />
          )}
          <div className="landing-copy">
            {copy.map((c, i) => (
              <div key={c.h} className="landing-step" data-active={step === i || reduced}>
                <h2 className="t-title-1">{c.h}</h2>
                <p className="t-reading" style={{ color: "rgba(235,235,245,0.6)" }}>{c.t}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="landing-after">
        {reduced && demo && (
          <div style={{ padding: "0 var(--space-4)" }}>
            <div className="landing-stage stage-card" style={{ marginBottom: "var(--space-6)" }}>
              <GridCanvas open={demo} player={null} reduced ariaLabel="Example signature" />
            </div>
          </div>
        )}
        <section className="landing-actions-wrap" style={{ padding: "var(--space-6) var(--space-4) var(--space-10)", display: "grid", gap: "var(--space-6)" }}>
          <Key />
          <div className="landing-actions">
            <button className="btn btn-filled" onClick={() => finish(onAdd)}>
              Add a song
            </button>
            {samples.length > 0 && (
              <button className="btn" onClick={() => finish(() => void addSample((demoInfo ?? samples[0]).slug), true)}>
                Try a sample
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
