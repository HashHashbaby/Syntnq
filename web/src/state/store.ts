// App state: library list (paged from IndexedDB), the open song, analysis jobs and toasts.
import { create } from "zustand";
import { dataMode, isSynthetic, shapePage, syntheticMeta } from "../dev/worstcase";
import * as api from "../data/api";
import { parseLive, parseMaps, parseProto, parseStatic, type LiveStream, type MapsData, type Prototypes, type StaticData } from "../data/formats";
import { Library, type SortKey } from "../data/library";
import { makeThumb } from "../data/thumb";
import { recordFromApi, type SongData, type SongRecord } from "../data/types";

export interface OpenSong {
  record: SongRecord;
  stat: StaticData;
  maps: MapsData;
  live: LiveStream;
  proto: Prototypes;
  signature: Record<string, unknown>;
  audio: Blob | null;
  attribution?: string;
}

export interface Job {
  id: string;
  title: string;
  stage: string | null;
  progress: number;
  state: "running" | "failed" | "cancelled";
  error: string | null;
  jobId: string | null;
}

export interface SampleInfo {
  slug: string;
  song_id: string;
  title: string;
  artist: string;
  genre: string;
  duration_s: number;
  license: string;
  license_url: string;
  source_url: string;
  attribution: string;
  fingerprint: number[];
}

const POLL_MS = 400;
export const PAGE_SIZE = 100;

interface AppState {
  lib: Library | null;
  items: SongRecord[];
  total: number;
  query: string;
  sort: SortKey;
  selectedId: string | null;
  open: OpenSong | null;
  /** Song id whose analysis just finished: its first view plays the reveal. */
  fresh: string | null;
  jobs: Job[];
  toast: string | null;
  samples: SampleInfo[];
  init: () => Promise<void>;
  refresh: (opts?: { append?: boolean }) => Promise<void>;
  setQuery: (q: string) => Promise<void>;
  setSort: (s: SortKey) => Promise<void>;
  selectSong: (id: string | null) => Promise<void>;
  addFile: (file: File, keepAudio: boolean) => Promise<void>;
  addSample: (slug: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  dismissJob: (id: string) => void;
  removeSong: (id: string) => Promise<void>;
  showToast: (msg: string) => void;
}

export function parseData(record: SongRecord, data: SongData, audio: Blob | null, attribution?: string): OpenSong {
  const live = parseLive(data.live, Number((data.signature as { live?: { audio_offset_s?: number } }).live?.audio_offset_s ?? 0));
  return { record, stat: parseStatic(data.static), maps: parseMaps(data.maps), live, proto: parseProto(data.proto), signature: data.signature, audio, attribution };
}

function titleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
}

export const useApp = create<AppState>((set, get) => ({
  lib: null,
  items: [],
  total: 0,
  query: "",
  sort: "recent",
  selectedId: null,
  open: null,
  fresh: null,
  jobs: [],
  toast: null,
  samples: [],

  init: async () => {
    const lib = await Library.open();
    set({ lib });
    await get().refresh();
    try {
      const r = await fetch("/samples/index.json");
      if (r.ok) set({ samples: (await r.json()) as SampleInfo[] });
    } catch {
      // no bundled samples in this build
    }
  },

  refresh: async (opts) => {
    const { lib, query, sort, items } = get();
    if (!lib) return;
    const offset = opts?.append ? items.length : 0;
    const real = await lib.page({ limit: PAGE_SIZE, offset, query, sort });
    const page = shapePage(dataMode(), offset, PAGE_SIZE) ?? real; // dev-only worst-case data
    set({ items: opts?.append ? [...items, ...page.items] : page.items, total: page.total });
  },

  setQuery: async (q) => {
    set({ query: q });
    await get().refresh();
  },

  setSort: async (s) => {
    set({ sort: s });
    await get().refresh();
  },

  selectSong: async (id) => {
    const { lib } = get();
    if (!id || !lib) {
      set({ selectedId: null, open: null });
      return;
    }
    let realId = id;
    let override: ReturnType<typeof syntheticMeta> | null = null;
    if (isSynthetic(id)) {
      // dev-only: a worst-case row opens the first real song under its awkward title
      const first = await lib.page({ limit: 1, offset: 0, query: "", sort: "recent" });
      if (!first.items[0]) {
        get().showToast("Add a song first: worst-case rows borrow a real song's data.");
        return;
      }
      realId = first.items[0].songId;
      override = syntheticMeta(id);
    }
    const stored = await lib.get(realId);
    const record = stored && override ? { ...stored, title: override.title, artist: override.artist } : stored;
    const data = await lib.getData(realId);
    if (!record || !data) {
      get().showToast("This song's data is not on this device.");
      return;
    }
    const audio = (await lib.getAudio(realId)) ?? null;
    const sample = get().samples.find((s) => s.song_id === realId);
    set((s) => ({ selectedId: id, open: parseData(record, data, audio, sample?.attribution), fresh: s.fresh === id ? id : null }));
  },

  addFile: async (file, keepAudio) => {
    const { lib } = get();
    if (!lib) return;
    const localId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const title = titleFromName(file.name);
    const upd = (patch: Partial<Job>) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === localId ? { ...j, ...patch } : j)) }));
    set((s) => ({ jobs: [...s.jobs, { id: localId, title, stage: "reading", progress: 0, state: "running", error: null, jobId: null }] }));
    try {
      const res = await api.analyze(file, title);
      let songId = res.songId;
      if (!songId && res.jobId) {
        upd({ jobId: res.jobId });
        for (;;) {
          const st = await api.jobStatus(res.jobId);
          if (st.state === "done") {
            songId = st.song_id;
            break;
          }
          if (st.state === "failed") throw new api.ApiError(st.error?.code ?? "E_INTERNAL", st.error?.message ?? "Analysis failed.", 500);
          if (st.state === "cancelled") {
            upd({ state: "cancelled" });
            return;
          }
          upd({ stage: st.stage, progress: st.progress });
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      }
      if (!songId) throw new Error("no song id");
      const data = await api.fetchSongData(songId);
      const fp = (await (await fetch(`/api/songs/${songId}/fingerprint`)).json()) as number[];
      const sig = data.signature as { song?: Record<string, unknown> };
      const s = sig.song ?? {};
      const record = recordFromApi(
        {
          song_id: songId,
          title: (s.title as string | null) ?? title,
          artist: (s.artist as string | null) ?? null,
          genre: (s.genre as string | null) ?? null,
          release_year: (s.release_year as number | null) ?? null,
          source: (s.source as string | null) ?? null,
          chart_peak: (s.chart_peak as number | null) ?? null,
          chart_weeks: (s.chart_weeks as number | null) ?? null,
          duration_s: Number(s.duration_s ?? 0),
          created_at: Date.now() / 1000,
          fingerprint: fp,
        },
        keepAudio,
        makeThumb(data.static),
      );
      await lib.put(record);
      await lib.putData(songId, data);
      if (keepAudio) await lib.putAudio(songId, file);
      await get().refresh();
      set((st) => ({ jobs: st.jobs.filter((j) => j.id !== localId), fresh: songId }));
      await get().selectSong(songId);
    } catch (e) {
      const msg = e instanceof api.ApiError ? e.message : "We couldn't reach the analysis service.";
      upd({ state: "failed", error: msg });
    }
  },

  addSample: async (slug) => {
    const { lib, samples } = get();
    const info = samples.find((s) => s.slug === slug);
    if (!lib || !info) return;
    const base = `/samples/${slug}`;
    const data = await api.fetchSongData(info.song_id, base);
    const audio = await (await fetch(`${base}/audio.mp3`)).blob();
    const record = recordFromApi(
      {
        song_id: info.song_id,
        title: info.title,
        artist: info.artist,
        genre: info.genre,
        release_year: null,
        source: "Bundled sample",
        chart_peak: null,
        chart_weeks: null,
        duration_s: info.duration_s,
        created_at: Date.now() / 1000,
        fingerprint: info.fingerprint,
      },
      true,
      makeThumb(data.static),
    );
    await lib.put(record);
    await lib.putData(info.song_id, data);
    await lib.putAudio(info.song_id, audio);
    await get().refresh();
    await get().selectSong(info.song_id);
  },

  cancelJob: async (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (job?.jobId) await api.cancelJob(job.jobId).catch(() => undefined);
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
  },

  dismissJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),

  removeSong: async (id) => {
    const { lib } = get();
    if (!lib) return;
    await lib.delete(id);
    await api.deleteSong(id).catch(() => undefined);
    if (get().selectedId === id) set({ selectedId: null, open: null });
    await get().refresh();
  },

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 3000);
  },
}));
