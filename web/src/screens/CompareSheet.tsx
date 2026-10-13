// Compare sheet (docs/UI.md section 6.9, M9, D-066): pick a song from the library (nearest first), then
// both signatures side by side (stacked on phones), the plain-language label, how the pair ranks against
// the reference corpus, and the differences that stand out, from the fingerprints.
import { useEffect, useMemo, useRef, useState } from "react";
import { parseStatic, type StaticData } from "../data/formats";
import type { SongRecord } from "../data/types";
import { compare, type Comparison } from "../engine/compare";
import { drawCard } from "../gl/card";
import { Sheet, Thumb } from "../components/parts";
import { params } from "../params";
import { useApp, type OpenSong } from "../state/store";

const CARD_PX = 512;

function Card({ stat, tag, title, artist }: { stat: StaticData | null; tag: string; title: string; artist: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || !stat) return;
    const c = drawCard(stat, CARD_PX);
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", `Signature of ${title}`);
    host.replaceChildren(c);
  }, [stat, title]);
  return (
    <figure className="compare-card">
      <div className="compare-canvas" ref={ref} />
      <figcaption>
        <span className="compare-tag t-cap" aria-hidden="true">{tag}</span>
        <span className="t-sub truncate" dir="auto">{title}</span>
        <span className="t-foot secondary truncate" dir="auto">{artist || " "}</span>
      </figcaption>
    </figure>
  );
}

interface Choice {
  record: SongRecord;
  label: string;
  distance: number;
}

export function CompareSheet({ open, initialOther, onClose }: { open: OpenSong; initialOther?: string | null; onClose: () => void }) {
  const lib = useApp((s) => s.lib);
  const [other, setOther] = useState<string | null>(initialOther ?? null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [otherRec, setOtherRec] = useState<SongRecord | null>(null);
  const [otherStat, setOtherStat] = useState<StaticData | null>(null);
  const fp = open.record.fingerprint;

  useEffect(() => {
    if (!lib || !fp) return;
    let alive = true;
    void (async () => {
      const all = (await lib.fingerprints()).filter((f) => f.songId !== open.record.songId);
      const rows: Choice[] = [];
      for (const f of all) {
        const record = await lib.get(f.songId);
        if (!record) continue;
        const c = compare(fp, f.fingerprint, params);
        rows.push({ record, label: c.label, distance: c.distance });
      }
      rows.sort((a, b) => a.distance - b.distance);
      if (alive) setChoices(rows);
    })();
    return () => {
      alive = false;
    };
  }, [lib, fp, open.record.songId]);

  useEffect(() => {
    if (!lib || !other) return;
    let alive = true;
    setOtherStat(null);
    void (async () => {
      const [rec, data] = await Promise.all([lib.get(other), lib.getData(other)]);
      if (!alive) return;
      setOtherRec(rec ?? null);
      setOtherStat(data ? parseStatic(data.static) : null);
    })();
    return () => {
      alive = false;
    };
  }, [lib, other]);

  const result: Comparison | null = useMemo(() => (fp && otherRec?.fingerprint ? compare(fp, otherRec.fingerprint, params) : null), [fp, otherRec]);
  const titleA = open.record.title?.trim() || "Untitled";
  const titleB = otherRec?.title?.trim() || "Untitled";

  return (
    <Sheet title="Compare" onClose={onClose}>
      {!fp ? (
        <p className="t-sub secondary">This song has no fingerprint yet, so it cannot be compared.</p>
      ) : !other ? (
        <>
          <p className="t-foot secondary" style={{ margin: "var(--space-2) 0 var(--space-3)" }}>
            Compare <b>{titleA}</b> with a song in your library, nearest first.
          </p>
          {choices === null ? (
            <p className="t-foot secondary">Looking…</p>
          ) : choices.length === 0 ? (
            <p className="t-sub secondary">Add another song to compare with.</p>
          ) : (
            <ul className="similar-list compare-choices">
              {choices.map((c) => (
                <li key={c.record.songId}>
                  <button className="similar-row" onClick={() => setOther(c.record.songId)}>
                    <Thumb bytes={c.record.thumb} />
                    <span className="similar-text">
                      <span className="t-sub truncate" dir="auto">{c.record.title?.trim() || "Untitled"}</span>
                      <span className="t-foot secondary truncate" dir="auto">{c.record.artist?.trim() || " "}</span>
                    </span>
                    <span className="similar-label t-foot" data-label={c.label}>
                      {c.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="compare">
          <div className="compare-pair">
            <Card stat={open.stat} tag="A" title={titleA} artist={open.record.artist?.trim() ?? ""} />
            <Card stat={otherStat} tag="B" title={titleB} artist={otherRec?.artist?.trim() ?? ""} />
          </div>
          {result && (
            <div className="compare-result" aria-live="polite">
              <p className="t-title-2 compare-label" data-label={result.label}>
                {result.label}
              </p>
              <p className="t-foot secondary tabular">
                More alike than {Math.round(result.score)} % of song pairs in the reference set ({params.compare.calibration.tracks} tracks, {params.compare.calibration.pairs} pairs).
              </p>
              {result.topDifferences.length > 0 ? (
                <>
                  <h3 className="t-headline">What differs most</h3>
                  <ul className="compare-diffs t-sub">
                    {result.topDifferences.map((d) => (
                      <li key={d.key}>{d.text}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="t-sub">No notable differences.</p>
              )}
              <p className="t-cap secondary">From the songs' fingerprints: what kinds of sound each contains and how much, not where the dots sit.</p>
            </div>
          )}
          <div className="toolbar" style={{ padding: 0, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setOther(null)}>
              Choose another
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
