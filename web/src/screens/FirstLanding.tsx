// First landing (docs/UI.md section 6.0, D-033, D-063): one scroll-driven stage, shown once to a new
// visitor. Scroll stays native (D-049); the visuals follow a critically damped copy of the progress.
// Beats (landing/reveal.ts): the hero (giant type, the signature card; the pointer paints a fading trail
// that reveals the live grid underneath), the card shrinking into the label of a disc that turns with
// scroll, the live grid scrubbed by scroll, the structure map; then the mapping key and the actions.
// Skip is always visible. With reduced motion there is no pinning, reveal or disc: the steps are stacked.
// Leaving (D-044): "Try a sample" hands the stage over to the signature card (a shared-element
// transition of the live canvas); Skip and "Add a song" fade the landing out.
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSongData } from "../data/api";
import { GridCanvas } from "../components/GridCanvas";
import { StructureView } from "../components/MapViews";
import { oklchToSrgb8 } from "../color/oklab";
import { drawCard } from "../gl/card";
import { beatAt, RevealMask } from "../landing/reveal";
import { stepSpring, type SpringState } from "../motion/spring";
import { DIP_OUT_MS, DUR_HANDOFF_MS, EASE_OUT, EASE_STAGE, REDUCED_FADE_MS } from "../motion/tokens";
import { params } from "../params";
import { motionReduced, useSettings } from "../state/settings";
import { parseData, useApp, type OpenSong } from "../state/store";
import type { DiscRendererLike } from "../three/disc";
import { FIT } from "../three/discFit";
import { loadChips, loadDisc } from "../three/load";
import type { ChipFactory } from "../components/GridCanvas";
import { recordFromApi } from "../data/types";

const L = params.ui.landing;
const KEY_STOPS = 9;
const MAX_DPR = 2;
// the card is inscribed in the disc's label circle: card side / disc canvas side
const CARD_IN_DISC = (params.web3d.disc.label_ratio / Math.SQRT2) / FIT;

declare global {
  interface Window {
    /** Landing state for tests: damped progress, the beat, reveal coverage, the disc angle drawn. */
    __synLanding?: { progress: () => number; beat: () => ReturnType<typeof beatAt>; coverage: () => number; discAngle: () => number | null; live: () => boolean };
  }
}

function swatch(t: number): string {
  const px = new Uint8Array(3);
  const h = params.color.hue.from_deg + (params.color.hue.to_deg - params.color.hue.from_deg) * t;
  oklchToSrgb8(0.7, 0.16, h, px);
  return `rgb(${px[0]},${px[1]},${px[2]})`;
}

function Key() {
  const ramp = useMemo(() => `linear-gradient(to right, ${Array.from({ length: KEY_STOPS }, (_, i) => swatch(i / (KEY_STOPS - 1))).join(", ")})`, []);
  return (
    <div className="key" aria-label="How to read the colours">
      <h2 className="t-title-1">How to read it</h2>
      <div className="key-ramp">
        <div className="key-bar" aria-hidden="true" style={{ background: ramp }} />
        <div className="key-ends t-foot secondary">
          <span>Dark, low sounds</span>
          <span>Bright, high sounds</span>
        </div>
      </div>
      <div className="key-row">
        <span className="t-headline">Colour</span>
        <p className="t-sub">Blue is a dark, low sound; orange is a bright, high one.</p>
      </div>
      <div className="key-row">
        <span className="t-headline">Brightness</span>
        <p className="t-sub">A dot glows more when its sound is loud and common in the song.</p>
      </div>
      <div className="key-row">
        <span className="t-headline">Vividness</span>
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
  const [chips, setChips] = useState<ChipFactory | null>(null); // the live layer as 3D glass chips, once loaded
  const [liveAll, setLiveAll] = useState(false); // "See it live": the whole card revealed (keyboard, touch)
  const liveAllRef = useRef(false);
  liveAllRef.current = liveAll;
  const extTime = useRef<number | null>(null);
  const exitRef = useRef<"fade" | "handoff" | null>(null);
  const [exit, setExit] = useState<"fade" | "handoff" | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLCanvasElement>(null);
  const discRef = useRef<HTMLCanvasElement>(null);
  const discWrapRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const target = useRef(0); // raw scroll progress 0..1 over the pinned track
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

  // native scroll only records the target; the frame loop below follows it with a damped spring
  const onScroll = (): void => {
    const el = scroller.current;
    const track = trackRef.current;
    if (!el || !track) return;
    target.current = Math.min(1, Math.max(0, el.scrollTop / Math.max(1, track.offsetHeight - el.clientHeight)));
  };

  // the frame loop: damped progress -> beat -> composited styles, the reveal cover, the disc, the live clock
  useEffect(() => {
    if (!demo || reduced) return;
    const cover = coverRef.current, layers = layersRef.current, card = cardRef.current, discWrap = discWrapRef.current, hero = heroRef.current, head = headRef.current;
    if (!cover || !layers || !card || !discWrap || !hero || !head) return;
    const ctx = cover.getContext("2d");
    if (!ctx) return;
    const mask = new RevealMask(L);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = mask.n;
    maskCanvas.height = mask.n;
    const mctx = maskCanvas.getContext("2d")!;
    const maskImg = mctx.createImageData(mask.n, mask.n);
    let cardImg: HTMLCanvasElement | null = null;
    let disc: DiscRendererLike | null = null;
    let lastDisc = { angle: -1, tilt: -1, size: 0 };
    let spring: SpringState = { x: target.current, v: 0 };
    let lastT = performance.now();
    let lastStep = -1;
    let coverDirty = true;
    let raf = 0;
    let dead = false;
    let beat = beatAt(spring.x, L);
    const liveStart = performance.now();
    let live = false;

    const size = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const px = Math.max(64, Math.round(layers.clientWidth * dpr));
      if (cover.width !== px) {
        cover.width = px;
        cover.height = px;
        cardImg = drawCard(demo.stat, px);
        coverDirty = true;
      }
      const dpx = Math.round((layers.clientWidth / CARD_IN_DISC) * dpr);
      if (disc && dpx !== lastDisc.size) {
        disc.resize(dpx / dpr, dpr);
        lastDisc = { angle: -1, tilt: -1, size: dpx };
      }
    };
    const ro = new ResizeObserver(size);
    ro.observe(layers);
    size();

    // the disc comes from the lazily loaded 3D chunk, fetched when the browser is idle
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const startDisc = (): void => {
      // under the trail the flat card becomes the live 3D glass grid (the app's live view, D-056)
      void loadChips().then((f) => !dead && setChips(() => f)).catch(() => undefined);
      void loadDisc().then((create) => {
        if (dead || !discRef.current) return;
        disc = create(discRef.current, params);
        disc.setLabel(drawCard(demo.stat, 512));
        lastDisc = { angle: -1, tilt: -1, size: 0 };
        size();
        // draw once while invisible: three compiles its shaders on the first render, which must not land mid-scroll
        disc.setTilt(0);
        disc.draw(0);
      }).catch(() => undefined);
    };
    if (w.requestIdleCallback) w.requestIdleCallback(startDisc, { timeout: 2000 });
    else window.setTimeout(startDisc, 1500);

    // the pointer paints the reveal; touch paints with a sideways drag (vertical drags scroll the page)
    const onMove = (e: PointerEvent): void => {
      if (beat.hero < 0.5 || exitRef.current) return;
      if (e.pointerType === "touch" && e.buttons === 0) return;
      const r = layers.getBoundingClientRect();
      const s = Math.max(r.width, 1);
      mask.move((e.clientX - r.left) / s, (e.clientY - r.top) / s, e.timeStamp / 1000);
      coverDirty = true;
    };
    const onLeave = (): void => mask.lift();
    const host = scroller.current!;
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("pointerup", onLeave);

    window.__synLanding = { progress: () => spring.x, beat: () => beat, coverage: () => mask.coverage(), discAngle: () => (disc ? disc.drawnAngle : null), live: () => live };

    const frame = (now: number): void => {
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      spring = stepSpring(spring, target.current, { response: L.scroll_follow_s, damping: 1 }, dt);
      if (Math.abs(spring.x - target.current) < 1e-4 && Math.abs(spring.v) < 1e-3) spring = { x: target.current, v: 0 };
      const p = Math.min(Math.max(spring.x, 0), 1);
      beat = beatAt(p, L);

      // composited properties only: transform and opacity
      hero.style.opacity = beat.hero.toFixed(3);
      hero.style.visibility = beat.hero > 0.01 ? "visible" : "hidden"; // faded out: out of reach and of the accessibility tree
      hero.style.transform = `scale(${(1 - (1 - L.headline_scale) * (1 - beat.hero)).toFixed(4)})`;
      head.style.opacity = (1 - beat.hero).toFixed(3);
      card.style.transform = `scale(${beat.cardScale.toFixed(4)})`;
      layers.style.opacity = beat.card.toFixed(3);
      discWrap.style.opacity = disc ? beat.disc.toFixed(3) : "0";
      if (beat.step !== lastStep) {
        lastStep = beat.step;
        setStep(beat.step);
      }

      // the reveal: decay, then erase the static card where the trail is
      if (beat.hero > 0.01 && !liveAllRef.current) {
        if (mask.coverage() > 0) {
          mask.decay(dt);
          coverDirty = true;
        }
      } else if (mask.coverage() > 0) {
        mask.clear();
        coverDirty = true;
      }
      // the flat card covers the 3D layer in the hero (where the trail erases it) and through the disc beat
      // (the disc's label is this same card, so the swap is exact)
      const coverOn = (beat.hero > 0.01 && !liveAllRef.current) || (beat.step === 1 && beat.hero <= 0.01);
      cover.style.opacity = coverOn ? "1" : "0";
      if (coverDirty && cardImg) {
        coverDirty = false;
        for (let i = 0; i < mask.cells.length; i++) maskImg.data[i * 4 + 3] = Math.round(mask.cells[i] * 255);
        mctx.putImageData(maskImg, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, cover.width, cover.height);
        ctx.drawImage(cardImg, 0, 0);
        ctx.globalCompositeOperation = "destination-out";
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(maskCanvas, 0, 0, cover.width, cover.height);
        ctx.globalCompositeOperation = "source-over";
      }

      // the live clock under the card: the hero loops the sample while anything is revealed; the live beat
      // is scrubbed by scroll; elsewhere the grid rests on the static signature
      const heroLive = beat.hero > 0.01 && (liveAllRef.current || mask.coverage() > 0.0005);
      live = !exitRef.current && (heroLive || beat.step === 2);
      if (exitRef.current) extTime.current = null;
      else if (heroLive) extTime.current = L.live_start_s + (((now - liveStart) / 1000) % L.live_span_s);
      else if (beat.step === 2) extTime.current = L.live_start_s + beat.liveT * L.live_span_s;
      else extTime.current = null;

      // the disc: drawn only when its angle or tilt changes and while it is visible
      if (disc && beat.disc > 0.001 && (Math.abs(beat.discAngle - lastDisc.angle) > 1e-4 || Math.abs(beat.discTilt - lastDisc.tilt) > 1e-3)) {
        disc.setTilt(beat.discTilt);
        disc.draw(beat.discAngle);
        lastDisc = { ...lastDisc, angle: beat.discAngle, tilt: beat.discTilt };
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerup", onLeave);
      disc?.dispose();
      delete window.__synLanding;
    };
  }, [demo, reduced]);

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
    { h: "Every song has a shape.", t: "Each dot is a kind of sound the song contains; alike sounds sit together. Made from the whole track, the card travels with the song like a label." },
    { h: "Press play and it moves.", t: "The grid follows the music from moment to moment, flowing to the beat." },
    { h: "And it keeps going.", t: "Maps show where a song repeats itself, how its rhythm moves and how its loudness rises and falls." },
  ];
  const hint = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches ? "Move across the card to see it come alive." : "Drag sideways across the card to see it live.";

  return (
    <div className="landing" ref={scroller} onScroll={onScroll} data-static={reduced} data-exit={exit ?? undefined} role="dialog" aria-modal="true" aria-label="Welcome">
      <button className="btn btn-plain landing-skip" style={{ position: "fixed", top: 12, right: 12, zIndex: 3, color: "#f5f5f7" }} onClick={() => finish()}>
        Skip
      </button>
      <div className="landing-track" ref={trackRef}>
        <div className="landing-sticky">
          {!reduced && (
            <div className="landing-hero" ref={heroRef}>
              <span className="t-hero" aria-hidden="true">Hear the music.</span>
              <span className="landing-hero-foot">
                <span className="t-hero landing-hero-2" aria-hidden="true">See its signature.</span>
                {demo && (
                  <span className="landing-hint t-foot">
                    <span className="secondary">{hint}</span>{" "}
                    <button className="btn btn-plain" aria-pressed={liveAll} onClick={() => setLiveAll((v) => !v)}>
                      {liveAll ? "Show the still card" : "See it live"}
                    </button>
                  </span>
                )}
              </span>
            </div>
          )}
          <h1 className="t-display landing-head" ref={headRef} style={{ textAlign: "center", opacity: reduced ? 1 : 0 }}>
            Hear the music. <span className="secondary" style={{ color: "rgba(235,235,245,0.6)" }}>See its signature.</span>
          </h1>
          {demo && !reduced ? (
            <div className="landing-stage" data-testid="landing-stage" ref={stageRef}>
              <div className="landing-card" ref={cardRef}>
                <div className="landing-disc" ref={discWrapRef} aria-hidden="true" style={{ inset: `${(-((1 / CARD_IN_DISC - 1) / 2) * 100).toFixed(3)}%` }}>
                  <canvas ref={discRef} />
                </div>
                <div className="landing-layers stage-card" ref={layersRef}>
                  {/* the canvas stays mounted for the whole landing (creating a GL context costs about 100 ms); the cover and the map overlay it */}
                  <GridCanvas open={demo} player={null} reduced={false} externalTimeRef={extTime} ariaLabel="Example signature" chips={chips} />
                  <canvas className="landing-cover" ref={coverRef} aria-hidden="true" />
                  {step === 3 && (
                    <div className="maps-card" style={{ position: "absolute", inset: 0 }}>
                      <StructureView maps={demo.maps} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div />
          )}
          <div className="landing-copy">
            {copy.map((c, i) => (
              <div key={c.h} className="landing-step" data-active={step === i + 1 || reduced}>
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
