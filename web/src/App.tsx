import { useCallback, useEffect, useRef, useState } from "react";
import { Backdrop } from "./components/Backdrop";
import { DevToggle } from "./dev/DevToggle";
import { FirstLanding } from "./screens/FirstLanding";
import { Library } from "./screens/Library";
import { Settings } from "./screens/Settings";
import { SignatureView } from "./screens/SignatureView";
import { applySettings, useSettings } from "./state/settings";
import { prefetchChips } from "./three/load";
import { useApp } from "./state/store";

const AUDIO_TYPES = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;

export function App() {
  const settings = useSettings();
  const { open, selectedId, toast, total, jobs } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [landingLive, setLandingLive] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const firstPane = useRef<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void useApp.getState().init();
  }, []);
  useEffect(() => {
    applySettings(settings);
  }, [settings.reduceMotion, settings.reduceTransparency]);

  const choose = useCallback(() => picker.current?.click(), []);
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const f of Array.from(files)) {
        if (f.type.startsWith("audio/") || AUDIO_TYPES.test(f.name)) void useApp.getState().addFile(f, settings.keepAudio);
        else useApp.getState().showToast("This file type isn't supported. Try MP3, M4A, WAV, FLAC or OGG.");
      }
    },
    [settings.keepAudio],
  );

  useEffect(() => {
    let depth = 0;
    const over = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const enter = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files")) {
        depth++;
        setDragging(true);
      }
    };
    const leave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent): void => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
    };
    const key = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        choose();
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("keydown", key);
    };
  }, [addFiles, choose]);

  const pane = open || selectedId ? "detail" : "library";
  const wantLanding = !settings.landingDone && total === 0 && jobs.length === 0;
  // once shown, the landing stays mounted until its exit animation has finished
  useEffect(() => {
    if (wantLanding) setLandingLive(true);
  }, [wantLanding]);
  const showLanding = wantLanding || landingLive;
  // prefetch the 3D chunk when idle, but never while the first landing (and its handoff) is running
  useEffect(() => {
    if (!showLanding) prefetchChips();
  }, [showLanding]);
  useEffect(() => {
    if (firstPane.current === null) firstPane.current = pane;
    else if (pane !== firstPane.current) setNavigated(true);
  }, [pane]);

  return (
    <>
      <Backdrop colors={open?.stat.colorSrgb ?? null} />
      <div className="app" data-pane={pane} data-animate={navigated && !showLanding}>
        <nav className="sidebar pane" aria-label="Library">
          <Library onAdd={choose} onSettings={() => setSettingsOpen(true)} />
        </nav>
        <main className="detail">
          {open ? (
            <SignatureView key={open.record.songId} open={open} onBack={() => void useApp.getState().selectSong(null)} />
          ) : (
            <div className="empty">
              <p className="t-title-2">Pick a song</p>
              <p className="t-sub secondary">Its signature appears here. Press space to play.</p>
            </div>
          )}
        </main>
      </div>
      <input
        ref={picker}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <p className="t-title-1">Drop to analyze</p>
        </div>
      )}
      <DevToggle />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {toast && (
        <div className="toast material t-sub" role="status">
          {toast}
        </div>
      )}
      {showLanding && <FirstLanding onDone={() => setLandingLive(false)} onAdd={choose} />}
    </>
  );
}
