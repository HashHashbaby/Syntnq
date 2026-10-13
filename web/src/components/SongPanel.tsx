// "This song" pane (M9, D-066): the songs in your library whose fingerprints are nearest (each opens the
// compare view), and your liking rating (1-7), kept on this device with an anonymous listener id.
import { useEffect, useId, useState } from "react";
import { rate, RATING_MAX, RATING_MIN } from "../data/ratings";
import type { SongRecord } from "../data/types";
import { compare, nearest } from "../engine/compare";
import { params } from "../params";
import { useApp, type OpenSong } from "../state/store";
import { Thumb } from "./parts";

interface Similar {
  record: SongRecord;
  label: string;
  score: number;
}

export function SongPanel({ open, onCompare }: { open: OpenSong; onCompare: (otherId: string | null) => void }) {
  const lib = useApp((s) => s.lib);
  const total = useApp((s) => s.total);
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const songId = open.record.songId;
  const labelId = useId();

  useEffect(() => {
    if (!lib) return;
    let alive = true;
    void (async () => {
      const fp = open.record.fingerprint;
      const all = (await lib.fingerprints()).filter((f) => f.songId !== songId);
      if (!fp) return alive && setSimilar([]);
      const near = nearest(fp, all.map((f) => ({ id: f.songId, fingerprint: f.fingerprint })), params);
      const rows: Similar[] = [];
      for (const n of near) {
        const record = await lib.get(n.id);
        if (!record?.fingerprint) continue;
        const c = compare(fp, record.fingerprint, params);
        rows.push({ record, label: c.label, score: Math.round(c.score) });
      }
      if (alive) setSimilar(rows);
    })();
    void lib.getRating(songId).then((r) => alive && setRating(r?.rating ?? null));
    return () => {
      alive = false;
    };
  }, [lib, songId, total, open.record.fingerprint]);

  const choose = async (v: number): Promise<void> => {
    if (!lib) return;
    setRating(v);
    await rate(lib, songId, v);
    setSaved(true);
  };

  return (
    <section className="pane song-pane" aria-label="This song">
      <div className="song-pane-head">
        <h2 className="t-headline">Similar in your library</h2>
        <button className="btn btn-plain" onClick={() => onCompare(null)}>
          Compare with…
        </button>
      </div>
      {similar === null ? (
        <p className="t-foot secondary">Looking…</p>
      ) : similar.length === 0 ? (
        <p className="t-foot secondary">Add more songs to see which ones sound alike.</p>
      ) : (
        <ul className="similar-list">
          {similar.map((s) => (
            <li key={s.record.songId}>
              <button className="similar-row" onClick={() => onCompare(s.record.songId)} aria-label={`Compare with ${s.record.title ?? "Untitled"}: ${s.label}`}>
                <Thumb bytes={s.record.thumb} />
                <span className="similar-text">
                  <span className="t-sub truncate" dir="auto">{s.record.title?.trim() || "Untitled"}</span>
                  <span className="t-foot secondary truncate" dir="auto">{s.record.artist?.trim() || " "}</span>
                </span>
                <span className="similar-label t-foot" data-label={s.label}>
                  {s.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2 className="t-headline" id={labelId}>
        How much do you like it?
      </h2>
      <div className="rating" role="radiogroup" aria-labelledby={labelId}>
        {Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => i + RATING_MIN).map((v) => (
          <button key={v} role="radio" aria-checked={rating === v} aria-label={`${v} of ${RATING_MAX}`} className="rating-dot tabular" onClick={() => void choose(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="rating-ends t-cap secondary" aria-hidden="true">
        <span>Not at all</span>
        <span>Very much</span>
      </div>
      <p className="t-cap secondary" role="status">
        {saved ? "Saved on this device." : "Ratings stay on this device (anonymous); export them in Settings."}
      </p>
    </section>
  );
}
