// Library (docs/UI.md section 6): Large Title, search, paged virtualised list of songs, the one
// filled "+" button, in-progress analyses and the empty state.
import { useCallback } from "react";
import { Icon, Segmented, Thumb, VirtualList, formatTime } from "../components/parts";
import { PAGE_SIZE, useApp } from "../state/store";
import type { SongRecord } from "../data/types";

const ROW_H = 60;

export function Library({ onAdd, onSettings }: { onAdd: () => void; onSettings: () => void }) {
  const { items, total, query, sort, selectedId, jobs, samples } = useApp();
  const { setQuery, setSort, selectSong, refresh, cancelJob, dismissJob, addSample } = useApp.getState();

  const more = useCallback(() => {
    if (useApp.getState().items.length < useApp.getState().total) void refresh({ append: true });
  }, [refresh]);

  const empty = total === 0 && !query && jobs.length === 0;

  return (
    <>
      <div className="library-head">
        <div className="toolbar" style={{ padding: 0 }}>
          <h1 className="t-large-title grow">Library</h1>
          <button className="btn btn-icon" onClick={onSettings} aria-label="Settings">
            <Icon name="gearshape" />
          </button>
          <button className="btn btn-icon btn-filled" onClick={onAdd} aria-label="Add song">
            <Icon name="plus" />
          </button>
        </div>
        {!empty && (
          <>
            <input
              className="search"
              type="search"
              placeholder="Search"
              aria-label="Search library"
              value={query}
              onChange={(e) => void setQuery(e.target.value)}
            />
            <Segmented
              label="Sort"
              value={sort}
              options={[
                { value: "recent", label: "Recent" },
                { value: "title", label: "Title" },
              ]}
              onChange={(v) => void setSort(v)}
            />
          </>
        )}
      </div>

      {jobs.map((j) => (
        <div key={j.id} className="row" style={{ cursor: "default", height: "auto", padding: "var(--space-3) var(--space-4)", gridTemplateColumns: "1fr auto" }} role="status">
          <div>
            <p className="t-headline truncate" title={j.title} dir="auto">{j.title}</p>
            {j.state === "running" ? (
              <>
                <p className="t-foot secondary">{STAGE_LABELS[j.stage ?? "reading"] ?? "Working"}...</p>
                <div className="progress" role="progressbar" aria-valuenow={Math.round(j.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Analysis progress">
                  <div style={{ transform: `scaleX(${Math.max(0.04, j.progress)})` }} />
                </div>
              </>
            ) : (
              <p className="t-foot" style={{ color: "var(--danger)" }}>
                {j.error ?? "Cancelled"}
              </p>
            )}
          </div>
          {j.state === "running" ? (
            <button className="btn btn-plain" onClick={() => void cancelJob(j.id)}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-plain" onClick={() => dismissJob(j.id)}>
              Choose another file
            </button>
          )}
        </div>
      ))}

      {empty ? (
        <div className="empty">
          <p className="t-title-2">Add a song to see its signature.</p>
          <button className="btn btn-filled" onClick={onAdd}>
            Add Song
          </button>
          {samples.length > 0 && (
            <button className="btn btn-plain" onClick={() => void addSample(samples[0].slug)}>
              Try a sample
            </button>
          )}
        </div>
      ) : (
        <VirtualList<SongRecord>
          label="Songs"
          items={items}
          rowHeight={ROW_H}
          onNearEnd={items.length >= PAGE_SIZE ? more : undefined}
          render={(s) => (
            <button className="row" role="option" aria-selected={s.songId === selectedId} onClick={() => void selectSong(s.songId)}>
              <Thumb bytes={s.thumb} />
              <span style={{ minWidth: 0 }}>
                <span className="t-headline truncate" style={{ display: "block" }} title={s.title?.trim() || "Untitled"} dir="auto">
                  {s.title?.trim() || "Untitled"}
                </span>
                <span className="t-sub secondary truncate" style={{ display: "block" }} title={s.artist?.trim() || undefined} dir="auto">
                  {s.artist?.trim() || " "}
                </span>
              </span>
              <span className="t-foot tabular secondary">{formatTime(s.durationS)}</span>
            </button>
          )}
        />
      )}
    </>
  );
}

const STAGE_LABELS: Record<string, string> = {
  reading: "Reading audio",
  listening: "Listening",
  mapping: "Mapping sounds",
  coloring: "Coloring",
  maps: "Drawing maps",
  writing: "Drawing maps",
};
