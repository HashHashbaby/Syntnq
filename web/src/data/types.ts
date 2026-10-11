// Records shared by the API client and the library (docs/API.md section 1, D-041).

/** A song in the library. Metadata fields other than title/artist are carried, not shown (D-041). */
export interface SongRecord {
  songId: string;
  title: string | null;
  artist: string | null;
  genre: string | null;
  releaseYear: number | null;
  source: string | null;
  chartPeak: number | null;
  chartWeeks: number | null;
  durationS: number;
  createdAt: number; // seconds since epoch
  fingerprint: Float32Array | null; // 133 values
  /** 32 x 32 x 3 sRGB bytes of the static signature, for list thumbnails. */
  thumb: Uint8Array | null;
  hasAudio: boolean;
  /** Lowercased title, artist and genre; used by search. */
  search: string;
  /** Lowercased title; the title index. */
  titleKey: string;
}

export interface ApiSong {
  song_id: string;
  title: string | null;
  artist: string | null;
  genre: string | null;
  release_year: number | null;
  source: string | null;
  chart_peak: number | null;
  chart_weeks: number | null;
  duration_s: number;
  created_at: number;
  fingerprint?: number[] | null;
}

export function recordFromApi(s: ApiSong, hasAudio = false, thumb: Uint8Array | null = null): SongRecord {
  const title = s.title ?? null;
  const artist = s.artist ?? null;
  return {
    songId: s.song_id,
    title,
    artist,
    genre: s.genre ?? null,
    releaseYear: s.release_year ?? null,
    source: s.source ?? null,
    chartPeak: s.chart_peak ?? null,
    chartWeeks: s.chart_weeks ?? null,
    durationS: s.duration_s,
    createdAt: s.created_at,
    fingerprint: s.fingerprint ? new Float32Array(s.fingerprint) : null,
    thumb,
    hasAudio,
    search: [title, artist, s.genre].filter(Boolean).join(" ").toLowerCase(),
    titleKey: (title ?? "").toLowerCase(),
  };
}

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobStatus {
  state: JobState;
  stage: string | null;
  progress: number;
  song_id: string | null;
  error: { code: string; message: string } | null;
}

export interface SongData {
  signature: Record<string, unknown>;
  static: ArrayBuffer;
  maps: ArrayBuffer;
  live: ArrayBuffer;
  proto: ArrayBuffer;
}
