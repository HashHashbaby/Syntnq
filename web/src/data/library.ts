// Library data layer on IndexedDB (docs/UI.md section 6, D-041): song records with fingerprints,
// paged queries for lists of hundreds of songs, cached analysis files, optional local audio, and the
// listener's liking ratings (M9, D-066; database version 2 adds that store to existing libraries).
import type { SongData, SongRecord } from "./types";

const DB_NAME = "synesthesia";
const DB_VERSION = 2;
const S_SONGS = "songs";
const S_DATA = "data";
const S_AUDIO = "audio";
const S_RATINGS = "ratings";

/** A liking rating (1-7) given to a song on this device, by an anonymous listener id. */
export interface Rating {
  songId: string;
  rating: number;
  listenerId: string;
  ratedAt: number; // ms since epoch
}

export type SortKey = "recent" | "title";

export interface PageQuery {
  limit: number;
  offset: number;
  query?: string;
  sort?: SortKey;
}

export interface Page {
  items: SongRecord[];
  total: number;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class Library {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = DB_NAME): Promise<Library> {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        const songs = db.createObjectStore(S_SONGS, { keyPath: "songId" });
        songs.createIndex("createdAt", "createdAt");
        songs.createIndex("titleKey", "titleKey");
        db.createObjectStore(S_DATA, { keyPath: "songId" });
        db.createObjectStore(S_AUDIO, { keyPath: "songId" });
      }
      if (e.oldVersion < 2) db.createObjectStore(S_RATINGS, { keyPath: "songId" });
    };
    return new Library(await wrap(req));
  }

  close(): void {
    this.db.close();
  }

  async put(song: SongRecord): Promise<void> {
    const tx = this.db.transaction(S_SONGS, "readwrite");
    tx.objectStore(S_SONGS).put(song);
    await done(tx);
  }

  async putMany(songs: SongRecord[]): Promise<void> {
    const tx = this.db.transaction(S_SONGS, "readwrite");
    const st = tx.objectStore(S_SONGS);
    for (const s of songs) st.put(s);
    await done(tx);
  }

  async get(songId: string): Promise<SongRecord | undefined> {
    return (await wrap(this.db.transaction(S_SONGS).objectStore(S_SONGS).get(songId))) as SongRecord | undefined;
  }

  async count(): Promise<number> {
    return wrap(this.db.transaction(S_SONGS).objectStore(S_SONGS).count());
  }

  /**
   * One page of the library plus the total number of matches. Without a search query the page
   * is read with an index cursor and `advance(offset)` (no full scan); with a query the matching
   * records are counted in one pass.
   */
  async page(q: PageQuery): Promise<Page> {
    const sort = q.sort ?? "recent";
    const store = this.db.transaction(S_SONGS).objectStore(S_SONGS);
    const index = store.index(sort === "recent" ? "createdAt" : "titleKey");
    const dir: IDBCursorDirection = sort === "recent" ? "prev" : "next";
    const needle = q.query?.trim().toLowerCase() ?? "";
    const items: SongRecord[] = [];
    if (!needle) {
      const total = await wrap(store.count());
      await new Promise<void>((resolve, reject) => {
        const req = index.openCursor(null, dir);
        let skipped = q.offset === 0;
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve();
          if (!skipped) {
            skipped = true;
            cur.advance(q.offset);
            return;
          }
          items.push(cur.value as SongRecord);
          if (items.length >= q.limit) return resolve();
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
      return { items, total };
    }
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      const req = index.openCursor(null, dir);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const rec = cur.value as SongRecord;
        if (rec.search.includes(needle)) {
          if (total >= q.offset && items.length < q.limit) items.push(rec);
          total++;
        }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return { items, total };
  }

  /** All fingerprints (id, 133 floats) for similarity features; skips records without one. */
  async fingerprints(): Promise<{ songId: string; fingerprint: Float32Array }[]> {
    const all = (await wrap(this.db.transaction(S_SONGS).objectStore(S_SONGS).getAll())) as SongRecord[];
    return all.filter((s) => s.fingerprint).map((s) => ({ songId: s.songId, fingerprint: s.fingerprint as Float32Array }));
  }

  async putData(songId: string, data: SongData): Promise<void> {
    const tx = this.db.transaction(S_DATA, "readwrite");
    tx.objectStore(S_DATA).put({ songId, ...data });
    await done(tx);
  }

  async getData(songId: string): Promise<SongData | undefined> {
    return (await wrap(this.db.transaction(S_DATA).objectStore(S_DATA).get(songId))) as SongData | undefined;
  }

  async putAudio(songId: string, blob: Blob): Promise<void> {
    const tx = this.db.transaction(S_AUDIO, "readwrite");
    tx.objectStore(S_AUDIO).put({ songId, blob });
    await done(tx);
  }

  async getAudio(songId: string): Promise<Blob | undefined> {
    const rec = (await wrap(this.db.transaction(S_AUDIO).objectStore(S_AUDIO).get(songId))) as { blob: Blob } | undefined;
    return rec?.blob;
  }

  async delete(songId: string): Promise<void> {
    const tx = this.db.transaction([S_SONGS, S_DATA, S_AUDIO, S_RATINGS], "readwrite");
    tx.objectStore(S_SONGS).delete(songId);
    tx.objectStore(S_DATA).delete(songId);
    tx.objectStore(S_AUDIO).delete(songId);
    tx.objectStore(S_RATINGS).delete(songId);
    await done(tx);
  }

  async putRating(r: Rating): Promise<void> {
    const tx = this.db.transaction(S_RATINGS, "readwrite");
    tx.objectStore(S_RATINGS).put(r);
    await done(tx);
  }

  async getRating(songId: string): Promise<Rating | undefined> {
    return (await wrap(this.db.transaction(S_RATINGS).objectStore(S_RATINGS).get(songId))) as Rating | undefined;
  }

  async ratings(): Promise<Rating[]> {
    return (await wrap(this.db.transaction(S_RATINGS).objectStore(S_RATINGS).getAll())) as Rating[];
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction([S_SONGS, S_DATA, S_AUDIO, S_RATINGS], "readwrite");
    [S_SONGS, S_DATA, S_AUDIO, S_RATINGS].forEach((n) => tx.objectStore(n).clear());
    await done(tx);
  }
}
