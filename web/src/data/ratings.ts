// Liking ratings (M9, D-066): 1-7 per song, kept in the library on this device with an anonymous listener
// id (a random uuid made once per browser; no personal data), sent to the analysis service when it holds
// the song, and exported as CSV in the same columns as the service's /api/ratings.csv.
import type { Library, Rating } from "./library";

const LISTENER_KEY = "synesthesia.listener";
export const RATING_MIN = 1;
export const RATING_MAX = 7;
const CSV_HEADER = ["song_id", "title", "artist", "listener_id", "rating", "rated_at"];

/** This browser's anonymous listener id (created on first use; in memory only if storage is blocked). */
let memoryId: string | null = null;
export function listenerId(): string {
  try {
    const have = localStorage.getItem(LISTENER_KEY);
    if (have) return have;
    const id = crypto.randomUUID();
    localStorage.setItem(LISTENER_KEY, id);
    return id;
  } catch {
    memoryId ??= crypto.randomUUID();
    return memoryId;
  }
}

/** Save a rating locally, then tell the service (ignored when it does not hold the song or is offline). */
export async function rate(lib: Library, songId: string, rating: number): Promise<Rating> {
  if (!Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) throw new Error("rating must be 1-7");
  const r: Rating = { songId, rating, listenerId: listenerId(), ratedAt: Date.now() };
  await lib.putRating(r);
  void fetch(`/api/songs/${songId}/rating`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating, listener_id: r.listenerId }),
  }).catch(() => undefined);
  return r;
}

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** All ratings on this device as CSV (oldest first), with the song's title and artist. */
export async function ratingsCsv(lib: Library): Promise<string> {
  const rows = (await lib.ratings()).sort((a, b) => a.ratedAt - b.ratedAt);
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    const song = await lib.get(r.songId);
    const stamp = new Date(r.ratedAt).toISOString().replace(/\.\d{3}Z$/, "Z");
    lines.push([r.songId, song?.title ?? "", song?.artist ?? "", r.listenerId, r.rating, stamp].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}
