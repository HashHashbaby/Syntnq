import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LoadGate, bootTimes, type Clock } from "../../src/loading/gate";
import { params } from "../../src/params";

/** A manual clock: timers fire only when advance() passes them. */
function fakeClock(): Clock & { advance: (ms: number) => void } {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    set: (fn, ms) => {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (k) => void timers.delete(k as number),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

const T = { delayMs: 150, minMs: 600, fadeMs: 300 };

function run(loadMs: number) {
  const clock = fakeClock();
  const log: [string, number][] = [];
  const gate = new LoadGate(T, { show: () => log.push(["show", clock.now()]), hide: () => log.push(["hide", clock.now()]), remove: () => log.push(["remove", clock.now()]) }, clock);
  gate.start();
  clock.advance(loadMs);
  gate.finish();
  clock.advance(5000);
  return log;
}

describe("loading gate", () => {
  it("never shows for a load shorter than the delay, and adds no wait", () => {
    expect(run(120)).toEqual([["remove", 120]]);
  });

  it("once shown, stays the minimum time, then fades out", () => {
    expect(run(200)).toEqual([["show", 150], ["hide", 750], ["remove", 1050]]);
  });

  it("a long load leaves right after it finishes", () => {
    expect(run(2000)).toEqual([["show", 150], ["hide", 2000], ["remove", 2300]]);
  });

  it("finish is idempotent", () => {
    const clock = fakeClock();
    let removes = 0;
    const gate = new LoadGate(T, { show: () => undefined, hide: () => undefined, remove: () => removes++ }, clock);
    gate.start();
    gate.finish();
    gate.finish();
    clock.advance(2000);
    expect(removes).toBe(1);
  });

  it("adopts a boot gate that has not shown yet and cancels its timer", () => {
    const clock = fakeClock();
    let cancelled = false;
    const log: string[] = [];
    const gate = new LoadGate(T, { show: () => log.push("show"), hide: () => log.push("hide"), remove: () => log.push("remove") }, clock);
    gate.adopt(null, () => (cancelled = true));
    gate.finish();
    expect(cancelled).toBe(true);
    expect(log).toEqual(["remove"]);
  });
});

describe("cold start (D-061)", () => {
  it("skips to the fade once the load is done, and only then", () => {
    const clock = fakeClock();
    const log: string[] = [];
    const gate = new LoadGate({ delayMs: 0, minMs: 2350, fadeMs: 450 }, { show: () => log.push("show"), hide: () => log.push("hide"), remove: () => log.push("remove") }, clock);
    gate.adopt(0, () => undefined);
    expect(gate.skip()).toBe(false); // not finished loading: nothing to skip to
    clock.advance(700);
    gate.finish();
    expect(log).toEqual([]); // waiting for the minimum time
    expect(gate.skip()).toBe(true);
    expect(log).toEqual(["hide"]);
    clock.advance(450);
    expect(log).toEqual(["hide", "remove"]);
    expect(gate.skip()).toBe(false);
  });

  it("holds one full sweep plus a hold; the still mural under reduced motion", () => {
    const p = params.ui.mural;
    const sweep = (p.cols + p.rows - 2) * p.stagger_ms + 0.36 * p.period_ms; // last tile's flip ends
    expect(bootTimes({ ...p, hue_from_deg: 0, hue_to_deg: 0 }, false).minMs).toBeGreaterThanOrEqual(sweep);
    expect(bootTimes({ ...p, hue_from_deg: 0, hue_to_deg: 0 }, true).minMs).toBe(p.boot_min_reduced_ms);
  });
});

describe("mural parameters", () => {
  const html = readFileSync(join(__dirname, "../../index.html"), "utf-8");
  const json = JSON.parse(html.match(/<script type="application\/json" id="syn-mural-params">([\s\S]*?)<\/script>/)![1]);

  it("equal config ui.mural (index.html carries a copy for the inline boot script)", () => {
    const { hue_from_deg: _f, hue_to_deg: _t, ...rest } = json;
    expect(rest).toEqual(params.ui.mural);
  });

  it("fade the boot mural out over boot_fade_ms", () => {
    expect(html).toContain(`#syn-mural.out { opacity: 0; visibility: visible; transition: opacity ${json.boot_fade_ms}ms`);
  });

  it("use the signature hue range from config/default.yaml", () => {
    expect(json.hue_from_deg).toBe(params.color.hue.from_deg);
    expect(json.hue_to_deg).toBe(params.color.hue.to_deg);
  });

  it("fade in the CSS equals fade_ms (index.html and app.css)", () => {
    const css = readFileSync(join(__dirname, "../../src/styles/app.css"), "utf-8");
    expect(html).toContain(`#syn-mural.show { opacity: 1; visibility: visible; transition: opacity ${json.fade_ms}ms`);
    expect(css).toContain(`.mural-cover { position: absolute; inset: 0; z-index: 5; display: grid; background: #000; opacity: 1; transition: opacity ${json.fade_ms}ms`);
  });
});
