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
