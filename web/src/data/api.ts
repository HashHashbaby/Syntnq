// Client for the FastAPI service (docs/API.md). Errors carry the stable `E_*` code.
import type { ApiSong, JobStatus, SongData } from "./types";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const BASE = "/api";

async function check(r: Response): Promise<Response> {
  if (r.ok) return r;
  let code = "E_INTERNAL";
  let message = "Something went wrong. Please try again.";
  try {
    const body = (await r.json()) as { error?: { code: string; message: string } };
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // keep defaults
  }
  throw new ApiError(code, message, r.status);
}

export interface AnalyzeResult {
  jobId: string | null;
  songId: string | null;
}

export async function analyze(file: File, title?: string, artist?: string): Promise<AnalyzeResult> {
  const form = new FormData();
  form.append("file", file);
  if (title) form.append("title", title);
  if (artist) form.append("artist", artist);
  const r = await check(await fetch(`${BASE}/analyze`, { method: "POST", body: form }));
  const body = (await r.json()) as { job_id: string | null; song_id: string | null };
  return { jobId: body.job_id, songId: body.song_id };
}

export async function jobStatus(jobId: string): Promise<JobStatus> {
  return (await (await check(await fetch(`${BASE}/jobs/${jobId}`))).json()) as JobStatus;
}

export async function cancelJob(jobId: string): Promise<void> {
  await check(await fetch(`${BASE}/jobs/${jobId}`, { method: "DELETE" }));
}

export interface SongPage {
  items: ApiSong[];
  total: number;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: "recent" | "title";
  fingerprint?: boolean;
}

export async function listSongs(opts: ListOptions = {}): Promise<SongPage> {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts.offset) qs.set("offset", String(opts.offset));
  if (opts.q) qs.set("q", opts.q);
  if (opts.sort) qs.set("sort", opts.sort);
  if (opts.fingerprint) qs.set("include", "fingerprint");
  const r = await check(await fetch(`${BASE}/songs?${qs.toString()}`));
  return { items: (await r.json()) as ApiSong[], total: Number(r.headers.get("X-Total-Count") ?? 0) };
}

/** The five files of a song; `base` defaults to the API, bundled samples pass a static folder. */
export async function fetchSongData(songId: string, base = `${BASE}/songs/${songId}`): Promise<SongData> {
  const get = async (name: string): Promise<Response> => check(await fetch(`${base}/${name}`));
  const [signature, st, mp, lv, pr] = await Promise.all([
    get("signature.json").then((r) => r.json() as Promise<Record<string, unknown>>),
    get("static.bin").then((r) => r.arrayBuffer()),
    get("maps.bin").then((r) => r.arrayBuffer()),
    get("live.bin").then((r) => r.arrayBuffer()),
    get("proto.bin").then((r) => r.arrayBuffer()),
  ]);
  return { signature, static: st, maps: mp, live: lv, proto: pr };
}

export function exportUrl(songId: string, px: number, format: "png" | "svg", caption = false): string {
  return `${BASE}/songs/${songId}/export?px=${px}&format=${format}&caption=${caption ? 1 : 0}`;
}

export async function deleteSong(songId: string): Promise<void> {
  await check(await fetch(`${BASE}/songs/${songId}`, { method: "DELETE" }));
}
