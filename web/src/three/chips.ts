// The 3D live view (D-045, D-046, D-056): 1,024 stained-glass chips as one instanced mesh, drawn
// with three.js in a lazily loaded chunk. It consumes the same pooled frame as the 2D renderer
// (colours, radius scale) plus the wave height, which lifts and tilts each chip. The camera looks
// straight at the grid through a narrow field of view so that, at rest, chip centres sit exactly
// where the 2D dots are; pointer parallax tilts it by a few degrees with a critically damped spring.
// All numbers: config web3d (params.json).
import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { PooledFrame } from "../engine/pool";
import { stepSpring, type SpringState } from "../motion/spring";
import type { Params } from "../params";
import fragmentShader from "./shaders/chip.frag.glsl?raw";
import vertexShader from "./shaders/chip.vert.glsl?raw";

const DEG = Math.PI / 180;
const MAX_SCALE = 1.06; // live radius swell drives chip size, capped so the lead lines stay open
const LIGHT_DIR = new Vector3(-0.45, 0.6, 0.66).normalize(); // upper left, toward the viewer

export interface ChipRendererOptions {
  reducedMotion: boolean;
}

export class ChipRenderer {
  readonly kind = "three" as const;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly mesh: InstancedMesh;
  private readonly color: InstancedBufferAttribute;
  private readonly lift: InstancedBufferAttribute;
  private readonly n: number;
  private readonly span: number;
  private readonly distance: number;
  private last: PooledFrame | null = null;
  private px = 0;
  // parallax: target and springs in degrees
  private readonly target = { x: 0, y: 0 };
  private sx: SpringState = { x: 0, v: 0 };
  private sy: SpringState = { x: 0, v: 0 };
  private raf = 0;
  private lastT = 0;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onLeave: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly p: Params,
    private readonly opts: ChipRendererOptions,
  ) {
    const w = p.web3d;
    this.n = p.render.display_grid;
    this.span = this.n + 2 * p.render.margin_cells;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(new Color(p.render.background), 1);
    // the visible height at z = 0 equals the grid span (margins included), as in the 2D layout
    this.distance = this.span / 2 / Math.tan((w.camera_fov_deg * DEG) / 2);
    this.camera = new PerspectiveCamera(w.camera_fov_deg, 1, this.distance * 0.5, this.distance * 2);
    this.camera.position.set(0, 0, this.distance);
    this.camera.lookAt(0, 0, 0);

    const geo = new RoundedBoxGeometry(w.chip_size, w.chip_size, w.chip_thickness, 3, w.chip_corner);
    geo.translate(0, 0, -w.chip_thickness / 2); // the face sits on z = 0, the chip behind it
    const count = this.n * this.n;
    this.color = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.lift = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
    for (let i = 0; i < count; i++) this.lift.array[i * 4 + 3] = 1;
    geo.setAttribute("aColor", this.color);
    geo.setAttribute("aLift", this.lift);
    const mat = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uChipSize: { value: w.chip_size },
        uFlat: { value: 1 - (2 * w.chip_corner) / w.chip_size },
        uAbsorb: { value: w.absorb_edge },
        uAbsorbSat: { value: w.absorb_edge_sat },
        uGrain: { value: w.grain },
        uGlint: { value: w.glint },
        uSideShade: { value: w.side_shade },
        uLightDir: { value: LIGHT_DIR },
      },
    });
    this.mesh = new InstancedMesh(geo, mat, count);
    const m = new Matrix4();
    for (let r = 0; r < this.n; r++) {
      for (let c = 0; c < this.n; c++) {
        // row 0 at the top, as in the 2D renderer
        m.makeTranslation(c + 0.5 - this.n / 2, this.n / 2 - (r + 0.5), 0);
        this.mesh.setMatrixAt(r * this.n + c, m);
      }
    }
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    const host = canvas.parentElement ?? canvas;
    this.onMove = (e) => {
      if (this.opts.reducedMotion) return;
      const b = host.getBoundingClientRect();
      const nx = ((e.clientX - b.left) / b.width) * 2 - 1;
      const ny = ((e.clientY - b.top) / b.height) * 2 - 1;
      this.target.x = Math.max(-1, Math.min(1, nx)) * w.parallax_deg;
      this.target.y = Math.max(-1, Math.min(1, ny)) * w.parallax_deg;
      this.kick();
    };
    this.onLeave = () => {
      this.target.x = 0;
      this.target.y = 0;
      this.kick();
    };
    host.addEventListener("pointermove", this.onMove);
    host.addEventListener("pointerleave", this.onLeave);
  }

  resize(cssSize: number, dpr: number): void {
    const ratio = Math.min(dpr, this.p.web3d.max_dpr);
    const px = Math.max(64, Math.round(cssSize * ratio));
    if (px === this.px) return;
    this.px = px;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(px, px, false);
    if (this.last) this.render();
  }

  draw(frame: PooledFrame): void {
    const w = this.p.web3d;
    const n = this.n;
    const col = this.color.array as Float32Array;
    const lift = this.lift.array as Float32Array;
    const h = frame.height;
    const flat = this.opts.reducedMotion || !h;
    const tiltMax = w.tilt_max_deg * DEG;
    for (let i = 0; i < n * n; i++) {
      col[i * 3] = frame.srgb[i * 3] / 255;
      col[i * 3 + 1] = frame.srgb[i * 3 + 1] / 255;
      col[i * 3 + 2] = frame.srgb[i * 3 + 2] / 255;
      const r = Math.floor(i / n), c = i % n;
      let z = 0, ax = 0, ay = 0;
      if (!flat && h) {
        z = h[i] * w.z_amp;
        // slope in height per node, central differences, edge-clamped
        const up = h[Math.max(r - 1, 0) * n + c], dn = h[Math.min(r + 1, n - 1) * n + c];
        const lf = h[r * n + Math.max(c - 1, 0)], rt = h[r * n + Math.min(c + 1, n - 1)];
        ax = Math.max(-1, Math.min(1, ((dn - up) / 2) * w.tilt_gain)) * tiltMax; // rows grow downward
        ay = Math.max(-1, Math.min(1, ((rt - lf) / 2) * w.tilt_gain)) * tiltMax;
      }
      lift[i * 4] = z;
      lift[i * 4 + 1] = ax;
      lift[i * 4 + 2] = ay;
      lift[i * 4 + 3] = Math.min(Math.max(frame.radiusScale[i], 0), MAX_SCALE);
    }
    this.color.needsUpdate = true;
    this.lift.needsUpdate = true;
    this.last = frame;
    this.render();
  }

  private render(): void {
    if (this.px === 0) this.resize(this.canvas.clientWidth || 512, window.devicePixelRatio || 1);
    const d = this.distance;
    const ax = this.sx.x * DEG, ay = this.sy.x * DEG;
    this.camera.position.set(Math.sin(ax) * d, -Math.sin(ay) * d, Math.cos(ax) * Math.cos(ay) * d);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  /** Run the parallax springs until they rest (only while something moves; no idle loop). */
  private kick(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const resp = { response: this.p.web3d.parallax_response_s, damping: 1 };
    const tick = (now: number): void => {
      const dt = Math.min((now - this.lastT) / 1000, 0.05);
      this.lastT = now;
      this.sx = stepSpring(this.sx, this.target.x, resp, dt);
      this.sy = stepSpring(this.sy, this.target.y, resp, dt);
      if (this.last) this.render();
      const moving = Math.abs(this.sx.x - this.target.x) > 0.005 || Math.abs(this.sy.x - this.target.y) > 0.005 || Math.abs(this.sx.v) > 0.01 || Math.abs(this.sy.v) > 0.01;
      this.raf = moving ? requestAnimationFrame(tick) : 0;
    };
    this.raf = requestAnimationFrame(tick);
  }

  readPixels(): Uint8ClampedArray {
    const gl = this.renderer.getContext();
    const px = this.px;
    const raw = new Uint8Array(px * px * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, px, px, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8ClampedArray(px * px * 4);
    for (let y = 0; y < px; y++) out.set(raw.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4);
    return out;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    const host = this.canvas.parentElement ?? this.canvas;
    host.removeEventListener("pointermove", this.onMove);
    host.removeEventListener("pointerleave", this.onLeave);
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.renderer.dispose();
  }
}

/** Factory used by GridCanvas once this chunk has loaded. */
export function createChipRenderer(canvas: HTMLCanvasElement, p: Params, opts: ChipRendererOptions): ChipRenderer {
  return new ChipRenderer(canvas, p, opts);
}
