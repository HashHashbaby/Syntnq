// Pool the 64 x 64 analysis frame to the drawn grid (docs/ANALYSIS.md section 12, D-030):
// colours by the mean in OKLab, radius scale by the mean, trail coordinates to node units.
// Port of src/synesthesia/display.py.
import { linearToOklab, linearToSrgb8, oklabToLinear, srgb8ToLinear } from "../color/oklab";

export interface PooledFrame {
  nodes: number; // nodes per side
  srgb: Uint8Array; // (N, 3)
  radiusScale: Float32Array; // (N)
  trail: Float32Array; // (M, 3) x_node, y_node, age
  trailLength: number;
}

const tmp = new Float64Array(3);

export class Pooler {
  readonly block: number;
  readonly nodes: number;
  readonly out: PooledFrame;

  constructor(readonly size: number, displayGrid: number, trailMax: number) {
    if (size % displayGrid !== 0) throw new Error(`display grid ${displayGrid} must divide ${size}`);
    this.block = size / displayGrid;
    this.nodes = displayGrid;
    this.out = {
      nodes: displayGrid,
      srgb: new Uint8Array(displayGrid * displayGrid * 3),
      radiusScale: new Float32Array(displayGrid * displayGrid),
      trail: new Float32Array(trailMax * 3),
      trailLength: 0,
    };
  }

  pool(srgb: Uint8Array, radius: Float32Array, trail: Float32Array, trailLength: number): PooledFrame {
    const { block, nodes, size, out } = this;
    const per = block * block;
    for (let ny = 0; ny < nodes; ny++) {
      for (let nx = 0; nx < nodes; nx++) {
        let L = 0, A = 0, B = 0, r = 0;
        for (let dy = 0; dy < block; dy++) {
          for (let dx = 0; dx < block; dx++) {
            const c = (ny * block + dy) * size + nx * block + dx;
            if (block === 1) {
              out.srgb[(ny * nodes + nx) * 3] = srgb[c * 3];
              out.srgb[(ny * nodes + nx) * 3 + 1] = srgb[c * 3 + 1];
              out.srgb[(ny * nodes + nx) * 3 + 2] = srgb[c * 3 + 2];
            }
            linearToOklab(srgb8ToLinear(srgb[c * 3]), srgb8ToLinear(srgb[c * 3 + 1]), srgb8ToLinear(srgb[c * 3 + 2]), tmp);
            L += tmp[0];
            A += tmp[1];
            B += tmp[2];
            r += radius[c];
          }
        }
        const n = ny * nodes + nx;
        out.radiusScale[n] = r / per;
        if (block > 1) {
          oklabToLinear(L / per, A / per, B / per, tmp);
          out.srgb[n * 3] = linearToSrgb8(tmp[0]);
          out.srgb[n * 3 + 1] = linearToSrgb8(tmp[1]);
          out.srgb[n * 3 + 2] = linearToSrgb8(tmp[2]);
        }
      }
    }
    const m = Math.min(trailLength, out.trail.length / 3);
    for (let i = 0; i < m; i++) {
      out.trail[i * 3] = (trail[i * 3] + 0.5) / block - 0.5;
      out.trail[i * 3 + 1] = (trail[i * 3 + 1] + 0.5) / block - 0.5;
      out.trail[i * 3 + 2] = trail[i * 3 + 2];
    }
    out.trailLength = m;
    return out;
  }
}
