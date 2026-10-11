// Dev-only worst-case data (the `break-ui` pass, D-044). `?data=worst|empty|one|many` swaps the
// library data at the store boundary; the production build never reads it (import.meta.env.DEV).
// Every value is something a real person or file could produce.
import type { SongRecord } from "../data/types";

export type DataMode = "demo" | "worst" | "empty" | "one" | "many";
export const DATA_MODES: DataMode[] = ["demo", "worst", "empty", "one", "many"];
export const MANY_COUNT = 1284;
const PREFIX = "dev-";

export function dataMode(): DataMode {
  if (!import.meta.env.DEV || typeof location === "undefined") return "demo";
  const v = new URLSearchParams(location.search).get("data");
  return DATA_MODES.includes(v as DataMode) ? (v as DataMode) : "demo";
}

interface Meta {
  title: string | null;
  artist: string | null;
  durationS: number;
}

const WORST: Meta[] = [
  { title: "Aleksandra Wiśniewska-Kowalczyk: Greatest Hits, Remastered (Deluxe Edition) [2025]", artist: "Bartholomew Fitzgerald-Montgomery III & The Northwind Industries Symphony Orchestra", durationS: 12 * 3600 + 34 * 60 },
  { title: "Jo", artist: "J", durationS: 3 },
  { title: "Đặng Thị Ngọc Hân", artist: "Ólafur Darri Ólafsson", durationS: 61 },
  { title: "王秀英", artist: "نور الهدى عبد الرحمن", durationS: 187 },
  { title: "🦊 Fox", artist: "👩🏽‍💻 Priya", durationS: 240 },
  { title: "Q3 Board Deck — FINAL (revised) v12 [approved by legal]", artist: null, durationS: 3599 },
  { title: null, artist: null, durationS: 0 },
  { title: "Benachrichtigungseinstellungen", artist: "María José de la Cruz y Fernández", durationS: 59.6 },
  { title: "IMG_20250914_183022_HDR_portrait_edited_edited", artist: "", durationS: 305 },
  { title: "  Sam   Lee ", artist: "<script>alert(1)</script> &amp; **bold**", durationS: 215 },
];

function metaAt(i: number): Meta {
  return WORST[i % WORST.length];
}

function record(i: number, m: Meta): SongRecord {
  const title = m.title;
  const artist = m.artist;
  return {
    songId: `${PREFIX}${i}`,
    title,
    artist,
    genre: null,
    releaseYear: null,
    source: null,
    chartPeak: null,
    chartWeeks: null,
    durationS: m.durationS,
    createdAt: 1_700_000_000 - i * 3600,
    fingerprint: null,
    thumb: null,
    hasAudio: false,
    search: [title, artist].filter(Boolean).join(" ").toLowerCase(),
    titleKey: (title ?? "").toLowerCase(),
  };
}

/** Shapes a page of the real library for the active mode. Returns null in demo mode. */
export function shapePage(mode: DataMode, offset: number, limit: number): { items: SongRecord[]; total: number } | null {
  if (mode === "demo") return null;
  if (mode === "empty") return { items: [], total: 0 };
  if (mode === "one") return { items: [record(0, WORST[0])], total: 1 };
  const total = mode === "many" ? MANY_COUNT : 24;
  const items: SongRecord[] = [];
  for (let i = offset; i < Math.min(total, offset + limit); i++) {
    items.push(record(i, mode === "many" ? { title: `Track ${i + 1}: ${metaAt(i).title ?? "Untitled"}`, artist: metaAt(i).artist, durationS: metaAt(i).durationS } : metaAt(i)));
  }
  return { items, total };
}

export function isSynthetic(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** Title, artist and duration to show when a synthetic row is opened (its data is a real song's). */
export function syntheticMeta(id: string): Meta {
  const i = Number(id.slice(PREFIX.length));
  return metaAt(Number.isFinite(i) ? i : 0);
}
