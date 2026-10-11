// Tiny 32 x 32 thumbnail of a static signature for library rows.
import { params } from "../params";
import { Pooler } from "../engine/pool";
import { parseStatic } from "./formats";

export function makeThumb(staticBuf: ArrayBuffer): Uint8Array {
  const st = parseStatic(staticBuf);
  const pooler = new Pooler(params.grid.size, params.render.display_grid, 1);
  const ones = new Float32Array(st.cells).fill(1);
  return pooler.pool(st.colorSrgb, ones, new Float32Array(0), 0).srgb.slice();
}
