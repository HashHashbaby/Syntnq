import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { Library } from "../../src/data/library";
import { recordFromApi, type ApiSong } from "../../src/data/types";

const N = 600;

function fake(i: number): ApiSong {
  const fp = Array.from({ length: 133 }, (_, k) => ((i * 31 + k) % 97) / 97);
  return {
    song_id: i.toString(16).padStart(16, "0"),
    title: `Song ${String(i).padStart(4, "0")}`,
    artist: i % 3 === 0 ? "Alpha Band" : "Beta Group",
    genre: i % 5 === 0 ? "electronic" : "rock",
    release_year: 1990 + (i % 30),
    source: "test",
    chart_peak: null,
    chart_weeks: null,
    duration_s: 180 + (i % 60),
    created_at: 1_700_000_000 + i,
    fingerprint: fp,
  };
}

describe("library data layer", () => {
  let lib: Library;
  beforeEach(async () => {
    lib = await Library.open(`test-${Math.random()}`);
    await lib.putMany(Array.from({ length: N }, (_, i) => recordFromApi(fake(i))));
  });

  it("stores hundreds of songs with fingerprints and pages them newest first", async () => {
    expect(await lib.count()).toBe(N);
    const p = await lib.page({ limit: 50, offset: 100 });
    expect(p.total).toBe(N);
    expect(p.items).toHaveLength(50);
    expect(p.items[0].title).toBe(`Song ${String(N - 1 - 100).padStart(4, "0")}`);
    expect(p.items[49].title).toBe(`Song ${String(N - 1 - 149).padStart(4, "0")}`);
  });

  it("round-trips the 133-value fingerprint and the optional metadata", async () => {
    const rec = await lib.get((7).toString(16).padStart(16, "0"));
    expect(rec?.fingerprint).toBeInstanceOf(Float32Array);
    expect(rec?.fingerprint).toHaveLength(133);
    expect(rec?.fingerprint?.[0]).toBeCloseTo(((7 * 31) % 97) / 97, 6);
    expect(rec?.releaseYear).toBe(1997);
    expect(rec?.chartPeak).toBeNull();
    expect(await lib.fingerprints()).toHaveLength(N);
  });

  it("sorts by title and searches title, artist and genre", async () => {
    const byTitle = await lib.page({ limit: 3, offset: 0, sort: "title" });
    expect(byTitle.items.map((s) => s.title)).toEqual(["Song 0000", "Song 0001", "Song 0002"]);
    const q = await lib.page({ limit: 10, offset: 5, query: "ELECTRONIC" });
    expect(q.total).toBe(N / 5);
    expect(q.items).toHaveLength(10);
    expect(q.items.every((s) => s.genre === "electronic")).toBe(true);
    expect(await lib.page({ limit: 10, offset: 0, query: "zzzz" })).toEqual({ items: [], total: 0 });
  });

  it("pages quickly enough for a responsive list", async () => {
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) await lib.page({ limit: 50, offset: k * 50 });
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("deletes a song with its cached data and audio", async () => {
    const id = (3).toString(16).padStart(16, "0");
    await lib.putAudio(id, new Blob(["x"]));
    const one = new ArrayBuffer(1);
    await lib.putData(id, { signature: {}, static: one, maps: one, live: one, proto: one });
    await lib.delete(id);
    expect(await lib.get(id)).toBeUndefined();
    expect(await lib.getAudio(id)).toBeUndefined();
    expect(await lib.getData(id)).toBeUndefined();
    expect(await lib.count()).toBe(N - 1);
  });
});

describe("ratings (M9)", () => {
  it("upgrades a version-1 library in place and keeps its songs", async () => {
    const name = `v1-${Math.random()}`;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        // the version-1 schema, with one song in it
        const db = req.result;
        const songs = db.createObjectStore("songs", { keyPath: "songId" });
        songs.createIndex("createdAt", "createdAt");
        songs.createIndex("titleKey", "titleKey");
        db.createObjectStore("data", { keyPath: "songId" });
        db.createObjectStore("audio", { keyPath: "songId" });
        songs.put(recordFromApi(fake(1)));
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    const lib = await Library.open(name);
    expect(await lib.count()).toBe(1);
    await lib.putRating({ songId: fake(1).song_id, rating: 6, listenerId: "x", ratedAt: 1 });
    expect((await lib.getRating(fake(1).song_id))?.rating).toBe(6);
  });

  it("keeps the latest rating per song, exports CSV, and forgets it with the song", async () => {
    const { rate, ratingsCsv } = await import("../../src/data/ratings");
    const lib = await Library.open(`r-${Math.random()}`);
    const song = recordFromApi({ ...fake(2), title: 'Say "Hi", Jo' });
    await lib.put(song);
    await rate(lib, song.songId, 3);
    await rate(lib, song.songId, 7);
    await expect(rate(lib, song.songId, 8)).rejects.toThrow();
    const csv = (await ratingsCsv(lib)).trim().split("\n");
    expect(csv[0]).toBe("song_id,title,artist,listener_id,rating,rated_at");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain(`${song.songId},"Say ""Hi"", Jo",`);
    expect(csv[1]).toMatch(/,7,\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    await lib.delete(song.songId);
    expect(await lib.ratings()).toEqual([]);
  });
});
