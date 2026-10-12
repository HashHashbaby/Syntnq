// The 3D live view (D-045, D-046, D-056, D-057): 1,024 stained-glass chips as one instanced mesh,
// drawn with three.js in a lazily loaded chunk. It consumes the same pooled frame as the 2D renderer
// (colours, radius scale). The chips lie flat on one plane and the camera looks straight at the grid,
// so chip centres sit exactly where the 2D dots are (D-058: no lift, no tilt, no playing pose). The BMU
// trail is a faint line of light just over the chip faces. Pointer parallax adds a few degrees.
// All numbers: config web3d (params.json).
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
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
import trailFragment from "./shaders/trail.frag.glsl?raw";
import trailVertex from "./shaders/trail.vert.glsl?raw";

const DEG = Math.PI / 180;
const MAX_SCALE = 1.06; // live radius swell drives chip size, capped so the lead lines stay open
const LIGHT_DIR = new Vector3(-0.45, 0.6, 0.66).normalize(); // upper left, toward the viewer
const TRAIL_MAX = 96; // trail points (2 s at the analysis frame rate is 86)
const SELF_RENDER_AFTER_MS = 30; // the springs render on their own only when no frame was drawn lately

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
  private readonly trail: Mesh;
  private readonly trailPos = new Float32Array(TRAIL_MAX * 2 * 3);
  private readonly trailAge = new Float32Array(TRAIL_MAX * 2);
  private readonly trailSide = new Float32Array(TRAIL_MAX * 2);
  private last: PooledFrame | null = null;
  private lastDraw = 0;
  private px = 0;
  // pointer parallax (degrees), on springs
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
    this.camera = new PerspectiveCamera(w.camera_fov_deg, 1, this.distance * 0.3, this.distance * 3);
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

    // the trail ribbon: two vertices per trail point, added to what is behind, just over the surface
    const tg = new BufferGeometry();
    tg.setAttribute("position", new BufferAttribute(this.trailPos, 3));
    tg.setAttribute("aAge", new BufferAttribute(this.trailAge, 1));
    tg.setAttribute("aSide", new BufferAttribute(this.trailSide, 1));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    tg.setIndex(idx);
    tg.setDrawRange(0, 0);
    this.trail = new Mesh(
      tg,
      new ShaderMaterial({
        vertexShader: trailVertex,
        fragmentShader: trailFragment,
        uniforms: { uOpacity: { value: w.trail_opacity } },
        transparent: true,
        depthWrite: false,
        depthTest: false, // an overlay: always over the chips it floats above
        blending: AdditiveBlending,
        side: DoubleSide, // the ribbon's winding flips with the direction of travel
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 1;
    this.scene.add(this.trail);

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
    const n = this.n;
    const col = this.color.array as Float32Array;
    const lift = this.lift.array as Float32Array;
    // the chips stay on the z = 0 plane, untilted (aLift x, y, z stay 0); only the size scale changes
    for (let i = 0; i < n * n; i++) {
      col[i * 3] = frame.srgb[i * 3] / 255;
      col[i * 3 + 1] = frame.srgb[i * 3 + 1] / 255;
      col[i * 3 + 2] = frame.srgb[i * 3 + 2] / 255;
      lift[i * 4 + 3] = Math.min(Math.max(frame.radiusScale[i], 0), MAX_SCALE);
    }
    this.color.needsUpdate = true;
    this.lift.needsUpdate = true;
    this.updateTrail(frame);
    this.last = frame;
    this.lastDraw = performance.now();
    this.render();
  }

  /** Rebuild the trail ribbon from the frame's trail (node coordinates, age 0 newest .. 1 oldest). */
  private updateTrail(frame: PooledFrame): void {
    const w = this.p.web3d;
    const m = this.opts.reducedMotion ? 0 : Math.min(frame.trailLength, TRAIL_MAX);
    const half = this.n / 2;
    const t = frame.trail;
    for (let k = 0; k < m; k++) {
      const x = t[k * 3] + 0.5 - half, y = half - (t[k * 3 + 1] + 0.5);
      const k0 = Math.max(k - 1, 0), k1 = Math.min(k + 1, m - 1);
      let dx = t[k1 * 3] - t[k0 * 3], dy = -(t[k1 * 3 + 1] - t[k0 * 3 + 1]);
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        dx = 1;
        dy = 0;
      } else {
        dx /= len;
        dy /= len;
      }
      const ox = -dy * (w.trail_width / 2), oy = dx * (w.trail_width / 2);
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        const v = 2 * k + s;
        this.trailPos[v * 3] = x + ox * sign;
        this.trailPos[v * 3 + 1] = y + oy * sign;
        this.trailPos[v * 3 + 2] = w.trail_lift;
        this.trailAge[v] = t[k * 3 + 2];
        this.trailSide[v] = sign;
      }
    }
    const g = this.trail.geometry;
    (g.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (g.getAttribute("aAge") as BufferAttribute).needsUpdate = true;
    (g.getAttribute("aSide") as BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, m > 1 ? (m - 1) * 6 : 0);
  }

  /** Per chip: canvas-pixel centre of its face as drawn now and its lift in pitch (x, y, z; z is 0 since
   *  D-058), for the fidelity tests. */
  centers(): number[] {
    const out: number[] = [];
    const v = new Vector3();
    const half = this.n / 2;
    this.camera.updateMatrixWorld();
    for (let i = 0; i < this.n * this.n; i++) {
      const r = Math.floor(i / this.n), c = i % this.n;
      v.set(c + 0.5 - half, half - (r + 0.5), 0).project(this.camera);
      out.push(((v.x + 1) / 2) * this.px, ((1 - v.y) / 2) * this.px, 0);
    }
    return out;
  }

  private render(): void {
    if (this.px === 0) this.resize(this.canvas.clientWidth || 512, window.devicePixelRatio || 1);
    const d = this.distance;
    const yaw = this.sx.x * DEG;
    const pitch = -this.sy.x * DEG;
    this.camera.position.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  /** Run the parallax springs until they rest (only while something moves; no idle loop). */
  private kick(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const w = this.p.web3d;
    const par = { response: w.parallax_response_s, damping: 1 };
    const tick = (now: number): void => {
      const dt = Math.min((now - this.lastT) / 1000, 0.05);
      this.lastT = now;
      this.sx = stepSpring(this.sx, this.target.x, par, dt);
      this.sy = stepSpring(this.sy, this.target.y, par, dt);
      // while frames are being drawn (playing) they render; otherwise the springs render themselves
      if (this.last && now - this.lastDraw > SELF_RENDER_AFTER_MS) this.render();
      const moving =
        Math.abs(this.sx.x - this.target.x) > 0.005 || Math.abs(this.sy.x - this.target.y) > 0.005 ||
        Math.abs(this.sx.v) > 0.01 || Math.abs(this.sy.v) > 0.01;
      if (!moving && this.last) this.render();
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
    this.trail.geometry.dispose();
    (this.trail.material as ShaderMaterial).dispose();
    this.renderer.dispose();
  }
}

/** Factory used by GridCanvas once this chunk has loaded. */
export function createChipRenderer(canvas: HTMLCanvasElement, p: Params, opts: ChipRendererOptions): ChipRenderer {
  return new ChipRenderer(canvas, p, opts);
}
