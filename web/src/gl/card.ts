// The static signature card drawn by the frozen 2D renderer (Canvas2D path) into an offscreen canvas:
// the disc's label (D-060) and the landing's cursor-reveal cover (D-063) both use it.
import { Pooler } from "../engine/pool";
import { params } from "../params";
import type { StaticData } from "../data/formats";
import { Canvas2DRenderer } from "./canvas2d";

export function drawCard(stat: StaticData, px: number): HTMLCanvasElement {
  const n = params.render.display_grid;
  const ones = new Float32Array(params.grid.size * params.grid.size).fill(1);
  const frame = new Pooler(params.grid.size, n, 1).pool(stat.colorSrgb, ones, new Float32Array(0), 0);
  const card = document.createElement("canvas");
  const r = new Canvas2DRenderer(card, params);
  r.resize(px, 1);
  r.draw(frame);
  return card;
}
