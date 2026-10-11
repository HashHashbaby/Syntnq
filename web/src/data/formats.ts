// Parsers for the binary files of docs/API.md section 3 (little-endian, 16-byte header).
// Each parser validates magic and version and rejects unknown versions.

export const FORMAT_VERSION = 1;
const HEADER_BYTES = 16;

export class FormatError extends Error {}

let halfLut: Float32Array | null = null;
/** IEEE half to float32 lookup table (65,536 entries, built once). */
export function halfTable(): Float32Array {
  if (halfLut) return halfLut;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    t[h] = e === 0 ? s * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024);
  }
  halfLut = t;
  return t;
}

export function halfToFloat(src: Uint16Array): Float32Array {
  const lut = halfTable();
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = lut[src[i]];
  return out;
}

class Reader {
  readonly view: DataView;
  pos = 0;
  constructor(readonly buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }
  take<T extends Uint8Array | Uint16Array | Uint32Array | Float32Array>(
    ctor: { new (b: ArrayBuffer): T; BYTES_PER_ELEMENT: number },
    n: number,
  ): T {
    const bytes = n * ctor.BYTES_PER_ELEMENT;
    if (this.pos + bytes > this.buf.byteLength) throw new FormatError("file is truncated");
    const out = new ctor(this.buf.slice(this.pos, this.pos + bytes)); // copy: alignment-safe
    this.pos += bytes;
    return out;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
}

function header(buf: ArrayBuffer, magic: string): { reader: Reader; gridSize: number; count: number } {
  if (buf.byteLength < HEADER_BYTES) throw new FormatError("file is too short");
  const r = new Reader(buf);
  const m = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  r.pos = 4;
  const version = r.u16();
  const gridSize = r.u16();
  const count = r.u32();
  r.u32();
  if (m !== magic) throw new FormatError(`bad magic ${m}, expected ${magic}`);
  if (version !== FORMAT_VERSION) throw new FormatError(`unsupported version ${version}`);
  return { reader: r, gridSize, count };
}

export interface StaticData {
  gridSize: number;
  cells: number;
  colorSrgb: Uint8Array; // (K, 3)
  colorOklch: Float32Array; // (K, 3) L, C, hue degrees
  occNorm: Float32Array; // (K)
  hits: Uint32Array; // (K)
  featureGrids: Float32Array; // (5, K)
}

export function parseStatic(buf: ArrayBuffer): StaticData {
  const { reader: r, gridSize, count: k } = header(buf, "SYNS");
  return {
    gridSize,
    cells: k,
    colorSrgb: r.take(Uint8Array, k * 3),
    colorOklch: r.take(Float32Array, k * 3),
    occNorm: r.take(Float32Array, k),
    hits: r.take(Uint32Array, k),
    featureGrids: r.take(Float32Array, 5 * k),
  };
}

export interface MapsData {
  structure: Float32Array; // (256, 256) in [-1, 1]
  tempogram: Float32Array; // (128, 256)
  dynEnvelope: Float32Array; // (1024) dBFS
  dynHist: Float32Array; // (40)
  beatTimes: Float32Array;
}

export const STRUCTURE_SIZE = 256;
export const TEMPO_ROWS = 128;
export const TEMPO_COLS = 256;
export const ENVELOPE_POINTS = 1024;
export const HIST_BINS = 40;

export function parseMaps(buf: ArrayBuffer): MapsData {
  const { reader: r } = header(buf, "SYNM");
  const structure = halfToFloat(r.take(Uint16Array, STRUCTURE_SIZE * STRUCTURE_SIZE));
  const tempogram = halfToFloat(r.take(Uint16Array, TEMPO_ROWS * TEMPO_COLS));
  const dynEnvelope = r.take(Float32Array, ENVELOPE_POINTS);
  const dynHist = r.take(Float32Array, HIST_BINS);
  const n = r.u32();
  return { structure, tempogram, dynEnvelope, dynHist, beatTimes: r.take(Float32Array, n) };
}

export interface LiveStream {
  fps: number;
  tau: number;
  dim: number;
  frames: number;
  x: Float32Array; // (T, D)
  bmu: Uint16Array; // (T)
  loud: Uint8Array;
  onset: Uint8Array;
  color: Uint8Array; // (T, 5)
  beatTimes: Float32Array;
  audioOffsetS: number; // seconds trimmed at ingest (from signature.json)
}

export function parseLive(buf: ArrayBuffer, audioOffsetS = 0): LiveStream {
  const { reader: r, count: t } = header(buf, "SYNL");
  const fps = r.f32();
  const tau = r.f32();
  const dim = r.u16();
  r.u16();
  const x = halfToFloat(r.take(Uint16Array, t * dim));
  const bmu = r.take(Uint16Array, t);
  const loud = r.take(Uint8Array, t);
  const onset = r.take(Uint8Array, t);
  const color = r.take(Uint8Array, t * 5);
  const nb = r.u32();
  const beatTimes = r.take(Float32Array, nb);
  return { fps, tau, dim, frames: t, x, bmu, loud, onset, color, beatTimes, audioOffsetS };
}

export interface Prototypes {
  cells: number;
  dim: number;
  w: Float32Array; // (K, D)
}

export function parseProto(buf: ArrayBuffer): Prototypes {
  const { reader: r, count: k } = header(buf, "SYNP");
  const dim = r.u16();
  r.u16();
  return { cells: k, dim, w: halfToFloat(r.take(Uint16Array, k * dim)) };
}
