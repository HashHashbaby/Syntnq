// Export sheet (docs/UI.md section 6.8, M8, D-065). The API renders the file (deterministic bytes); when
// the service is unreachable or does not hold the song (a bundled sample), the PNG is drawn locally with
// the same frozen 2D renderer and the same caption band (gl/caption.ts).
import { useState } from "react";
import { exportUrl } from "../data/api";
import { Pooler } from "../engine/pool";
import { bandHeight, drawCaption, loadCaptionFonts, type CaptionText } from "../gl/caption";
import { createRenderer } from "../gl/create";
import { Sheet } from "../components/parts";
import { params } from "../params";
import { useApp, type OpenSong } from "../state/store";

const SIZES = params.export.sizes;

/** Caption lines for a song: title, artist, and the licence attribution of Creative Commons tracks. */
export function captionFor(open: OpenSong): CaptionText {
  const lic = (open.signature as { license?: { name?: string; attribution?: string } }).license;
  const cc = (lic?.name ?? "").toUpperCase().startsWith("CC");
  return {
    title: open.record.title?.trim() || "Untitled",
    artist: open.record.artist?.trim() ?? "",
    attribution: (cc ? lic?.attribution?.trim() || lic?.name : "") || open.attribution?.trim() || "",
  };
}

async function localPng(open: OpenSong, px: number, caption: boolean): Promise<Blob> {
  const square = document.createElement("canvas");
  const renderer = createRenderer(square, params, true);
  renderer.resize(px, 1);
  const n = params.render.display_grid;
  const ones = new Float32Array(open.stat.cells).fill(1);
  renderer.draw(new Pooler(params.grid.size, n, 1).pool(open.stat.colorSrgb, ones, new Float32Array(0), 0));
  let out = square;
  if (caption) {
    await loadCaptionFonts(px);
    out = document.createElement("canvas");
    out.width = px;
    out.height = px + bandHeight(px);
    const ctx = out.getContext("2d")!;
    ctx.drawImage(square, 0, 0);
    drawCaption(ctx, px, captionFor(open));
  }
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png"));
}

export function ExportSheet({ open, onClose }: { open: OpenSong; onClose: () => void }) {
  const [px, setPx] = useState<number>(SIZES[0]);
  const [format, setFormat] = useState<"png" | "svg">("png");
  const [caption, setCaption] = useState(true);
  const [busy, setBusy] = useState(false);
  const showToast = useApp((s) => s.showToast);
  const name = `${(open.record.title ?? "signature").replace(/[^\w-]+/g, "_")}.${format}`;

  const fetchBlob = async (): Promise<Blob> => {
    const r = await fetch(exportUrl(open.record.songId, px, format, caption)).catch(() => null);
    if (r?.ok) return r.blob();
    if (format === "png") return localPng(open, px, caption);
    throw new Error("The analysis service is needed for SVG export.");
  };

  const save = async (share: boolean): Promise<void> => {
    setBusy(true);
    try {
      const blob = await fetchBlob();
      const file = new File([blob], name, { type: blob.type });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: open.record.title ?? "Signature" });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Export" onClose={onClose}>
      <div className="group" style={{ marginTop: "var(--space-4)" }}>
        <label htmlFor="exp-size">Size</label>
        <select id="exp-size" value={px} onChange={(e) => setPx(Number(e.target.value))}>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s} px
            </option>
          ))}
        </select>
        <label htmlFor="exp-format">Format</label>
        <select id="exp-format" value={format} onChange={(e) => setFormat(e.target.value as "png" | "svg")}>
          <option value="png">PNG</option>
          <option value="svg">SVG</option>
        </select>
        <label htmlFor="exp-caption">Caption</label>
        <input id="exp-caption" type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} aria-describedby="exp-caption-help" />
      </div>
      <p id="exp-caption-help" className="t-foot secondary" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        Title, artist and the SYNESTHESIA wordmark under the signature, plus the licence for Creative Commons songs.
      </p>
      <div className="toolbar" style={{ padding: 0, justifyContent: "flex-end" }}>
        <button className="btn" disabled={busy} onClick={() => void save(true)}>
          Share
        </button>
        <button className="btn btn-filled" disabled={busy} onClick={() => void save(false)}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
