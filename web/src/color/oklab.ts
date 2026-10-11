// OKLab / OKLCH <-> sRGB, gamut mapping by chroma bisection. Port of src/synesthesia/color.py;
// the numbers below are Ottosson's matrices, the same as the Python reference.

const M1 = [
  0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619,
  0.2817188376, 0.6299787005,
];
const M2 = [
  0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371,
  0.7827717662, -0.808675766,
];

function inv3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

const M1I = inv3(M1);
const M2I = inv3(M2);

export const GAMUT_STEPS = 24;
const GAMUT_EPS = 1e-9;
const DEG = Math.PI / 180;

/** OKLab (L, a, b) to linear sRGB, written to `out[o..o+2]` (not clipped). */
export function oklabToLinear(L: number, a: number, b: number, out: Float64Array, o = 0): void {
  const l_ = M2I[0] * L + M2I[1] * a + M2I[2] * b;
  const m_ = M2I[3] * L + M2I[4] * a + M2I[5] * b;
  const s_ = M2I[6] * L + M2I[7] * a + M2I[8] * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  out[o] = M1I[0] * l + M1I[1] * m + M1I[2] * s;
  out[o + 1] = M1I[3] * l + M1I[4] * m + M1I[5] * s;
  out[o + 2] = M1I[6] * l + M1I[7] * m + M1I[8] * s;
}

/** Linear sRGB to OKLab, written to `out[o..o+2]`. */
export function linearToOklab(r: number, g: number, b: number, out: Float64Array, o = 0): void {
  const l = Math.cbrt(M1[0] * r + M1[1] * g + M1[2] * b);
  const m = Math.cbrt(M1[3] * r + M1[4] * g + M1[5] * b);
  const s = Math.cbrt(M1[6] * r + M1[7] * g + M1[8] * b);
  out[o] = M2[0] * l + M2[1] * m + M2[2] * s;
  out[o + 1] = M2[3] * l + M2[4] * m + M2[5] * s;
  out[o + 2] = M2[6] * l + M2[7] * m + M2[8] * s;
}

const scratch = new Float64Array(3);

function inGamutLch(L: number, C: number, hRad: number): boolean {
  oklabToLinear(L, C * Math.cos(hRad), C * Math.sin(hRad), scratch);
  for (let k = 0; k < 3; k++) {
    if (scratch[k] < -GAMUT_EPS || scratch[k] > 1 + GAMUT_EPS) return false;
  }
  return true;
}

/** Largest chroma <= `c` that is inside sRGB at fixed lightness and hue (24-step bisection). */
export function gamutChroma(L: number, c: number, hDeg: number): number {
  const h = hDeg * DEG;
  if (inGamutLch(L, c, h)) return c;
  let lo = 0, hi = c;
  for (let i = 0; i < GAMUT_STEPS; i++) {
    const mid = 0.5 * (lo + hi);
    if (inGamutLch(L, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function encode(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(v, 0), 1) * 255);
}

/** Linear channel (clipped to [0, 1]) to a gamma-encoded byte. */
export function linearToSrgb8(c: number): number {
  const x = c < 0 ? 0 : c > 1 ? 1 : c;
  return encode(x);
}

/** Gamma-encoded byte to linear light. */
const DEC_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  DEC_LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function srgb8ToLinear(v: number): number {
  return DEC_LUT[v];
}

/** OKLCH (hue in degrees) to a gamut-mapped sRGB triple of bytes written to `out[o..o+2]`. */
export function oklchToSrgb8(L: number, C: number, hDeg: number, out: Uint8Array, o = 0): void {
  const c = gamutChroma(L, C, hDeg);
  const h = hDeg * DEG;
  oklabToLinear(L, c * Math.cos(h), c * Math.sin(h), scratch);
  out[o] = linearToSrgb8(scratch[0]);
  out[o + 1] = linearToSrgb8(scratch[1]);
  out[o + 2] = linearToSrgb8(scratch[2]);
}
