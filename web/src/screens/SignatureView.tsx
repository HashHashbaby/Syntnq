// Signature screen (docs/UI.md section 6.5-6.7): the stage, player bar, map switcher, inspector.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer } from "../audio/player";
import { reportStage } from "../components/Backdrop";
import { GridCanvas, type ChipFactory } from "../components/GridCanvas";
import { LoadingMural } from "../loading/Mural";
import { DUR_HANDOFF_MS } from "../motion/tokens";
import { loadChips } from "../three/load";
import { CAPTIONS, DynamicsView, FEATURES, FeatureGridView, RhythmView, StructureView, type FeatureName, type MapView } from "../components/MapViews";
import { Icon, Segmented, formatTime, useMedia, usePhone } from "../components/parts";
import { keyboardDriven, reduced as motionNow } from "../motion/tokens";
import { params } from "../params";
import { motionReduced, useSettings } from "../state/settings";
import { useApp, type OpenSong } from "../state/store";
import { ExportSheet } from "./ExportSheet";

const VIEWS: { value: MapView; label: string }[] = [
  { value: "sound", label: "Sound" },
  { value: "features", label: "Features" },
  { value: "structure", label: "Structure" },
  { value: "rhythm", label: "Rhythm" },
  { value: "dynamics", label: "Dynamics" },
];
const FEATURE_LABELS: Record<FeatureName, string> = { brightness: "Brightness", loudness: "Loudness", noisiness: "Noise", harmonicity: "Harmony", change: "Change" };
const SEEK_SHORT_S = 5;
const SEEK_LONG_S = 30;

interface NodeInfo {
  row: number;
  col: number;
  share: number;
  brightnessHz: number;
  loudnessDb: number;
  noisiness: number;
  harmonicity: number;
  change: number;
  playing: boolean;
}

function nodeInfo(open: OpenSong, row: number, col: number, bmu: number | null): NodeInfo {
  const size = params.grid.size;
  const block = size / params.render.display_grid;
  const st = open.stat;
  const acc = [0, 0, 0, 0, 0];
  let hits = 0;
  let playing = false;
  for (let dy = 0; dy < block; dy++) {
    for (let dx = 0; dx < block; dx++) {
      const c = (row * block + dy) * size + col * block + dx;
      for (let f = 0; f < 5; f++) acc[f] += st.featureGrids[f * st.cells + c];
      hits += st.hits[c];
      if (bmu === c) playing = true;
    }
  }
  const per = block * block;
  const total = st.hits.reduce((a, b) => a + b, 0) || 1;
  const r = params.ranges;
  const lerp = (rng: [number, number], t: number): number => rng[0] + (rng[1] - rng[0]) * t;
  return {
    row,
    col,
    share: hits / total,
    brightnessHz: Math.pow(10, lerp(r.centroid_log10_hz, acc[0] / per)),
    loudnessDb: lerp(r.loudness_dbfs, acc[1] / per),
    noisiness: acc[2] / per,
    harmonicity: lerp(r.harmonicity, acc[3] / per),
    change: acc[4] / per,
    playing,
  };
}

function InspectorBody({ info }: { info: NodeInfo | null }) {
  if (!info) return <p className="t-sub secondary">Hover a dot to see what it is.</p>;
  return (
    <div className="kv t-sub tabular">
      <span className="secondary">Position</span><span>row {info.row + 1}, col {info.col + 1}</span>
      <span className="secondary">Share of song</span><span>{(info.share * 100).toFixed(1)}%</span>
      <span className="secondary">Brightness</span><span>{Math.round(info.brightnessHz)} Hz</span>
      <span className="secondary">Loudness</span><span>{info.loudnessDb.toFixed(0)} dBFS</span>
      <span className="secondary">Noisiness</span><span>{Math.round(info.noisiness * 100)}%</span>
      <span className="secondary">Harmonic</span><span>{Math.round(info.harmonicity * 100)}%</span>
      <span className="secondary">Change</span><span>{Math.round(info.change * 100)}%</span>
      <span className="secondary">Now</span><span>{info.playing ? "playing this sound" : "-"}</span>
    </div>
  );
}

export function SignatureView({ open, onBack }: { open: OpenSong; onBack: () => void }) {
  const settings = useSettings();
  const mountedAt = useRef(performance.now());
  const trueColour = settings.trueColour;
  const [chips, setChips] = useState<ChipFactory | null>(null);
  const [chipsLoading, setChipsLoading] = useState(false);
  useEffect(() => {
    if (trueColour || chips) return;
    let alive = true;
    // start after any arrival transition (the landing handoff): parsing the chunk is a long task
    const wait = Math.max(0, DUR_HANDOFF_MS + 150 - (performance.now() - mountedAt.current));
    const t = window.setTimeout(() => {
      setChipsLoading(true);
      loadChips()
        .then((f) => alive && setChips(() => f))
        .catch(() => undefined)
        .finally(() => alive && setChipsLoading(false));
    }, wait);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [trueColour, chips]);
  // the chips take over only after any arrival transition (the landing handoff) and when the browser is
  // idle: creating the WebGL renderer and compiling shaders is a long task that must not land mid-motion
  const [chipsReady, setChipsReady] = useState(false);
  useEffect(() => {
    if (!chips || chipsReady) return;
    const mountedFor = performance.now() - mountedAt.current;
    let idleId = 0;
    const t = window.setTimeout(() => {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idleId = idle(() => setChipsReady(true), { timeout: 500 });
      else setChipsReady(true);
    }, Math.max(0, DUR_HANDOFF_MS + 150 - mountedFor));
    return () => {
      window.clearTimeout(t);
      (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
    };
  }, [chips, chipsReady]);
  const stageChips = trueColour || !chipsReady ? null : chips;
  const stageKey = stageChips ? "chips" : "flat";
  const lib = useApp((s) => s.lib);
  const removeSong = useApp((s) => s.removeSong);
  const showToast = useApp((s) => s.showToast);
  const reduced = motionReduced(settings);
  const [view, setView] = useState<MapView>("sound");
  const [feature, setFeature] = useState<FeatureName>("brightness");
  const [sheet, setSheet] = useState(false);
  const [hover, setHover] = useState<{ info: NodeInfo; x: number; y: number } | null>(null);
  const [bmu, setBmu] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const [, force] = useState(0);
  const phone = usePhone();
  // the map switcher rides in the toolbar pill only where there is room for it and the title (D-054)
  const wide = useMedia("(min-width: 1069px)");
  const fresh = useApp((s) => s.fresh === open.record.songId);
  const trackRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef<{ target: number; t: number } | null>(null);
  const settle = useRef<number | undefined>(undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // the reveal plays once, on the first view after an analysis finishes
  useEffect(() => {
    if (fresh) useApp.setState({ fresh: null });
  }, []);

  // phone: bring the card for the chosen map into view (instant for keyboard and reduced motion)
  useEffect(() => {
    const el = trackRef.current;
    if (!phone || !el) return;
    const card = el.children[VIEWS.findIndex((v) => v.value === view)] as HTMLElement | undefined;
    if (!card) return;
    // relative to the first card, so the result does not depend on which ancestor is positioned
    const left = card.offsetLeft - (el.children[0] as HTMLElement).offsetLeft;
    if (Math.abs(el.scrollLeft - left) < 2) return;
    programmatic.current = { target: left, t: performance.now() };
    el.scrollTo({ left, behavior: keyboardDriven() || motionNow() ? "auto" : "smooth" });
  }, [view, phone]);

  // phone: a swipe that comes to rest on another card selects that map
  const onTrackScroll = (): void => {
    const el0 = trackRef.current;
    const mine0 = programmatic.current;
    if (el0 && mine0 && Math.abs(el0.scrollLeft - mine0.target) < 2) programmatic.current = null; // arrived
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = trackRef.current;
      if (!el || el.children.length < 2) return;
      const mine = programmatic.current;
      if (mine) {
        // our own scrollTo still travelling: wait for it to arrive (or 700 ms to pass)
        if (performance.now() - mine.t < 700) return;
        programmatic.current = null;
      }
      const pitch = (el.children[1] as HTMLElement).offsetLeft - (el.children[0] as HTMLElement).offsetLeft;
      const i = Math.min(VIEWS.length - 1, Math.max(0, Math.round(el.scrollLeft / pitch)));
      if (VIEWS[i].value !== view) setView(VIEWS[i].value);
    }, 90);
  };

  const player = useMemo(() => new AudioPlayer(), [open.record.songId]);
  useEffect(() => {
    // while audio plays, the two large side panes drop refraction (measured +2.3 ms per frame, D-054)
    const mark = (): void => {
      if (player.state === "playing") document.documentElement.dataset.playing = "true";
      else delete document.documentElement.dataset.playing;
    };
    const off = player.onChange(() => {
      mark();
      force((n) => n + 1);
    });
    if (open.audio) void player.load(open.audio);
    return () => {
      delete document.documentElement.dataset.playing;
      off();
      player.dispose();
    };
  }, [player, open.audio]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number): void => {
      if (now - last > 100) {
        last = now;
        setPos(player.position());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  const toggle = useCallback(() => {
    if (player.state === "playing") player.pause();
    else void player.play();
  }, [player]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") return;
      if (e.key === " " && t.tagName !== "BUTTON") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" && t.tagName !== "INPUT") player.seek(player.position() + (e.shiftKey ? SEEK_LONG_S : SEEK_SHORT_S));
      else if (e.key === "ArrowLeft" && t.tagName !== "INPUT") player.seek(player.position() - (e.shiftKey ? SEEK_LONG_S : SEEK_SHORT_S));
      else if (/^[1-5]$/.test(e.key) && !e.metaKey && !e.ctrlKey) setView(VIEWS[Number(e.key) - 1].value);
      else if (e.key.toLowerCase() === "t" && !e.metaKey && !e.ctrlKey && t.tagName !== "INPUT") useSettings.getState().set({ trueColour: !useSettings.getState().trueColour });
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setSheet(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [player, toggle]);

  const onPointer = (e: React.PointerEvent): void => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const n = params.render.display_grid;
    const pitch = r.width / (n + 2 * params.render.margin_cells);
    const col = Math.floor((e.clientX - r.left) / pitch - params.render.margin_cells);
    const row = Math.floor((e.clientY - r.top) / pitch - params.render.margin_cells);
    if (col < 0 || row < 0 || col >= n || row >= n) setHover(null);
    else setHover({ info: nodeInfo(open, row, col, bmu), x: e.clientX, y: e.clientY });
  };

  const addAudio = async (f: File | undefined): Promise<void> => {
    if (!f || !lib) return;
    await lib.putAudio(open.record.songId, f);
    await useApp.getState().selectSong(open.record.songId);
    showToast("Audio added on this device.");
  };

  const renderMap = (v: MapView): JSX.Element | null => {
    if (v === "features") return <FeatureGridView stat={open.stat} feature={feature} />;
    if (v === "structure") return <StructureView maps={open.maps} />;
    if (v === "rhythm") return <RhythmView maps={open.maps} />;
    if (v === "dynamics") return <DynamicsView maps={open.maps} />;
    return null;
  };

  const title = open.record.title?.trim() || "Untitled";
  const byline = open.record.artist?.trim() || open.attribution || "";
  // the graphite gradient follows the square on screen (grid or map card), D-053
  useEffect(() => {
    const find = (): Element | null => document.querySelector('[data-testid="stage"], [data-testid="map-card"]');
    let raf = 0;
    const update = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => reportStage(find()));
    };
    const ro = new ResizeObserver(update);
    const el = find();
    if (el) ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      reportStage(null);
    };
  }, [view, phone]);

  const duration = player.duration || open.record.durationS;
  const ariaLabel = `Signature of ${title}`;
  const caption = view === "features" ? `${CAPTIONS.features} Showing ${FEATURE_LABELS[feature].toLowerCase()}.` : CAPTIONS[view];

  return (
    <>
      <div className="toolbar pane">
        <button className="btn btn-icon only-phone" onClick={onBack} aria-label="Back to library">
          <Icon name="chevron.left" />
        </button>
        <div className="grow">
          <h1 className="t-headline truncate" title={title} dir="auto">{title}</h1>
          <p className="t-foot secondary truncate" title={byline} dir="auto">{byline}</p>
        </div>
        {wide && (
          <Segmented
            label="Map view"
            value={view}
            options={VIEWS.map((v, i) => ({ ...v, ariaLabel: `${v.label} (${i + 1})` }))}
            onChange={setView}
          />
        )}
        {view === "sound" && (
          <button
            className="btn btn-icon"
            aria-pressed={trueColour}
            aria-label="True colour"
            title="True colour: flat dots instead of 3D glass (T)"
            onClick={() => settings.set({ trueColour: !trueColour })}
          >
            <Icon name="cube" />
          </button>
        )}
        <button className="btn btn-icon" onClick={() => setSheet(true)} aria-label="Export">
          <Icon name="square.and.arrow.up" />
        </button>
        <button
          className="btn btn-icon"
          aria-label="Delete song"
          onClick={() => {
            if (confirm(`Delete "${title}" from this device?`)) void removeSong(open.record.songId).then(onBack);
          }}
        >
          <Icon name="trash" />
        </button>
      </div>

      <div className="view" data-inspector="true">
        <div className="view-body">
          {!wide && (
            <Segmented
              label="Map view"
              value={view}
              options={VIEWS.map((v, i) => ({ ...v, ariaLabel: `${v.label} (${i + 1})` }))}
              onChange={setView}
            />
          )}
          {view === "features" && (
            <Segmented
              label="Feature"
              value={feature}
              options={FEATURES.map((f) => ({ value: f, label: FEATURE_LABELS[f] }))}
              onChange={setFeature}
            />
          )}

          {phone ? (
            <>
              <div className="carousel" ref={trackRef} onScroll={onTrackScroll} role="group" aria-label="Maps">
                {VIEWS.map((v) => (
                  <div key={v.value} className="carousel-card" aria-hidden={v.value !== view} data-view={v.value}>
                    {v.value === "sound" ? (
                      <div
                        ref={stageRef}
                        className="stage-card"
                        onPointerMove={onPointer}
                        onPointerLeave={() => setHover(null)}
                        data-testid={view === "sound" ? "stage" : undefined}
                      >
                        <GridCanvas key={stageKey} open={open} player={player} reduced={reduced} reveal={fresh} onBmu={setBmu} ariaLabel={ariaLabel} chips={stageChips} />
                        <LoadingMural loading={chipsLoading} label="Loading the 3D view" />
                      </div>
                    ) : (
                      <div className="maps-card" data-testid={v.value === view ? "map-card" : undefined}>
                        {renderMap(v.value)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="dots" aria-hidden="true">
                {VIEWS.map((v) => (
                  <span key={v.value} data-active={v.value === view} />
                ))}
              </div>
            </>
          ) : view === "sound" ? (
            <div
              ref={stageRef}
              className="stage-card"
              onPointerMove={onPointer}
              onPointerLeave={() => setHover(null)}
              data-testid="stage"
            >
              <GridCanvas key={stageKey} open={open} player={player} reduced={reduced} reveal={fresh} onBmu={setBmu} ariaLabel={ariaLabel} chips={stageChips} />
              <LoadingMural loading={chipsLoading} label="Loading the 3D view" />
            </div>
          ) : (
            <div className="maps-card" data-testid="map-card">
              {renderMap(view)}
            </div>
          )}
          <p className="caption t-foot secondary">{caption}</p>

          <div className="player" role="group" aria-label="Playback">
            <button className="btn btn-icon btn-filled" onClick={toggle} disabled={!open.audio || player.state === "idle"} aria-label={player.state === "playing" ? "Pause" : "Play"}>
              <Icon name={player.state === "playing" ? "pause.fill" : "play.fill"} />
            </button>
            <input
              className="scrub"
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              step={0.1}
              value={Math.min(pos, duration)}
              disabled={!open.audio || player.state === "idle"}
              onChange={(e) => player.seek(Number(e.target.value))}
              aria-label="Seek"
              aria-valuetext={`${formatTime(pos)} of ${formatTime(duration)}`}
            />
            <span className="t-foot tabular secondary">
              {formatTime(pos)} / {formatTime(duration)}
            </span>
          </div>
          {!open.audio && (
            <div className="toolbar" style={{ justifyContent: "center" }}>
              <p className="t-sub secondary">Re-add audio to play.</p>
              <button className="btn btn-plain" onClick={() => picker.current?.click()}>
                Choose file
              </button>
              <input ref={picker} type="file" accept="audio/*" hidden onChange={(e) => void addAudio(e.target.files?.[0])} />
            </div>
          )}
          {open.attribution && <p className="t-foot secondary caption">{open.attribution}</p>}
        </div>

        <aside className="inspector pane" aria-label="Inspector">
          <h2 className="t-headline">Inspector</h2>
          <InspectorBody info={hover?.info ?? null} />
        </aside>
      </div>

      {hover && (
        <div className="popover material" style={{ left: hover.x + 14, top: hover.y + 14 }} role="status">
          <InspectorBody info={hover.info} />
        </div>
      )}
      {sheet && <ExportSheet open={open} onClose={() => setSheet(false)} />}
    </>
  );
}
