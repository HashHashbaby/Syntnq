// The landing's cursor reveal and beats (D-063): the trail halves in half_life_s, faster strokes paint
// wider and stay continuous, and the scroll beats hand the card to the disc label and back.
import { describe, expect, it } from "vitest";
import { RevealMask, beatAt } from "../../src/landing/reveal";
import { params } from "../../src/params";

const L = params.ui.landing;

describe("reveal mask", () => {
  it("halves in reveal_half_life_s, at any frame rate", () => {
    for (const fps of [30, 60, 144]) {
      const m = new RevealMask(L);
      m.move(0.5, 0.5, 0);
      const c0 = m.coverage();
      for (let i = 0; i < Math.round(L.reveal_half_life_s * fps); i++) m.decay(1 / fps);
      expect(m.coverage() / c0).toBeCloseTo(0.5, 2);
    }
  });

  it("paints wider when the pointer moves faster, up to the cap", () => {
    const m = new RevealMask(L);
    expect(m.radius(0)).toBe(L.reveal_radius);
    expect(m.radius(1)).toBeGreaterThan(m.radius(0));
    expect(m.radius(1000)).toBe(L.reveal_radius_max);
  });

  it("keeps a fast stroke continuous (no gaps between stamps)", () => {
    const m = new RevealMask(L);
    m.move(0.1, 0.5, 0);
    m.move(0.9, 0.5, 0.05); // across the card in 50 ms
    const n = m.n, row = Math.floor(0.5 * n);
    for (let i = Math.ceil(0.12 * n); i < Math.floor(0.88 * n); i++) expect(m.cells[row * n + i]).toBeGreaterThan(0.5);
  });

  it("starts a new stroke after lift (no line across the jump)", () => {
    const m = new RevealMask(L);
    m.move(0.1, 0.1, 0);
    m.lift();
    m.move(0.9, 0.9, 0.05);
    const n = m.n;
    expect(m.cells[Math.floor(0.5 * n) * n + Math.floor(0.5 * n)]).toBe(0);
  });
});

describe("landing beats", () => {
  it("hero, then the card becomes the label (exact swap at angle 0, flat), turns with scroll, then gives it back", () => {
    const hero = beatAt(0, L);
    expect(hero.hero).toBe(1);
    expect(hero.card).toBe(1);
    expect(hero.disc).toBe(0);
    const swap = beatAt(L.disc_full, L);
    expect(swap.disc).toBeCloseTo(1, 6);
    expect(swap.card).toBe(0);
    expect(swap.discAngle).toBe(0);
    expect(swap.discTilt).toBe(0);
    expect(swap.cardScale).toBeCloseTo(L.disc_card_scale, 6);
    const end = beatAt(L.disc_to, L);
    expect(end.discAngle).toBeCloseTo(L.disc_turns * 2 * Math.PI, 6);
    expect(end.discTilt).toBeCloseTo(L.disc_tilt_deg, 6);
    const live = beatAt((L.live_from + L.map_from) / 2, L);
    expect(live.disc).toBe(0);
    expect(live.card).toBe(1);
    expect(live.cardScale).toBe(1);
    expect(live.step).toBe(2);
    expect(beatAt(0.9, L).step).toBe(3);
  });

  it("the angle only depends on scroll and grows with it", () => {
    let prev = -1;
    for (let p = L.disc_full; p <= L.disc_to; p += 0.01) {
      const a = beatAt(p, L).discAngle;
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
});
