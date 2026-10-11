// WebGL2 renderer of the pooled grid (docs/LIVE.md section 4, adapted: the response field and
// colours are computed on the CPU by the engine; the GPU draws dots, trail and glow).
import type { Params } from "../params";
import type { PooledFrame } from "../engine/pool";
import blurFrag from "./shaders/blur.frag.glsl?raw";
import compositeFrag from "./shaders/composite.frag.glsl?raw";
import quadVert from "./shaders/quad.vert.glsl?raw";
import sceneFrag from "./shaders/scene.frag.glsl?raw";
import trailFrag from "./shaders/trail.frag.glsl?raw";

export interface GridRendererLike {
  resize(cssSize: number, dpr: number): void;
  draw(frame: PooledFrame): void;
  readPixels(): Uint8ClampedArray;
  dispose(): void;
  readonly kind: "webgl2" | "canvas2d";
}

const TRAIL_RES = 256;
const MAX_DPR = 2;
const MAX_TRAIL_POINTS = 96;
const BLUR_DOWNSCALE = 2;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

export function webgl2Supported(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

export class GridRenderer implements GridRendererLike {
  readonly kind = "webgl2" as const;
  private readonly gl: WebGL2RenderingContext;
  private readonly progTrail: WebGLProgram;
  private readonly progScene: WebGLProgram;
  private readonly progBlur: WebGLProgram;
  private readonly progComposite: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly nodeColorTex: WebGLTexture;
  private readonly nodeRadiusTex: WebGLTexture;
  private trail!: Target;
  private scene!: Target;
  private blurA!: Target;
  private blurB!: Target;
  private px = 0;
  private readonly n: number;
  private readonly bg: [number, number, number];
  private readonly trailBuf = new Float32Array(MAX_TRAIL_POINTS * 3);
  private readonly uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly p: Params,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.n = p.render.display_grid;
    this.bg = hexToRgb01(p.render.background);
    this.progTrail = this.program(quadVert, trailFrag);
    this.progScene = this.program(quadVert, sceneFrag);
    this.progBlur = this.program(quadVert, blurFrag);
    this.progComposite = this.program(quadVert, compositeFrag);
    this.vao = gl.createVertexArray() as WebGLVertexArrayObject;
    this.nodeColorTex = this.dataTexture(gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, this.n);
    this.nodeRadiusTex = this.dataTexture(gl.R32F, gl.RED, gl.FLOAT, this.n);
    this.trail = this.target(TRAIL_RES, TRAIL_RES, gl.LINEAR);
  }

  // -- setup -------------------------------------------------------------------------------
  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const prog = gl.createProgram() as WebGLProgram;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
    return prog;
  }

  private dataTexture(internal: number, format: number, type: number, n: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, n, n, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number, filter: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer() as WebGLFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  private free(t: Target | undefined): void {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  resize(cssSize: number, dpr: number): void {
    const px = Math.max(64, Math.round(cssSize * Math.min(dpr, MAX_DPR)));
    if (px === this.px) return;
    const gl = this.gl;
    this.px = px;
    this.canvas.width = px;
    this.canvas.height = px;
    this.free(this.scene);
    this.free(this.blurA);
    this.free(this.blurB);
    this.scene = this.target(px, px, gl.LINEAR);
    const bw = Math.max(32, Math.round(px / BLUR_DOWNSCALE));
    this.blurA = this.target(bw, bw, gl.LINEAR);
    this.blurB = this.target(bw, bw, gl.LINEAR);
  }

  // -- drawing -----------------------------------------------------------------------------
  private u(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.uniformCache.get(prog);
    if (!m) {
      m = new Map();
      this.uniformCache.set(prog, m);
    }
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(prog, name));
    return m.get(name) ?? null;
  }

  private bindTex(unit: number, tex: WebGLTexture): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
  }

  private pass(target: Target | null, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  draw(frame: PooledFrame): void {
    const gl = this.gl;
    const n = this.n;
    if (this.px === 0) this.resize(this.canvas.clientWidth || 512, window.devicePixelRatio || 1);
    const px = this.px;
    const render = this.p.render;
    const pitch = px / (n + 2 * render.margin_cells);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // upload node data
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.bindTex(0, this.nodeColorTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, n, gl.RGB, gl.UNSIGNED_BYTE, frame.srgb);
    this.bindTex(1, this.nodeRadiusTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, n, gl.RED, gl.FLOAT, frame.radiusScale);

    // trail
    const count = Math.min(frame.trailLength, MAX_TRAIL_POINTS);
    this.trailBuf.set(frame.trail.subarray(0, count * 3));
    gl.useProgram(this.progTrail);
    gl.uniform3fv(this.u(this.progTrail, "uTrail[0]"), this.trailBuf);
    gl.uniform1i(this.u(this.progTrail, "uCount"), count);
    gl.uniform1f(this.u(this.progTrail, "uNodes"), n);
    gl.uniform1f(this.u(this.progTrail, "uMargin"), render.margin_cells);
    gl.uniform1f(this.u(this.progTrail, "uHalfWidth"), this.p.live.trail.width_cells * 0.5);
    gl.uniform1f(this.u(this.progTrail, "uOpacity"), this.p.live.trail.opacity);
    this.pass(this.trail, TRAIL_RES, TRAIL_RES);

    // scene
    gl.useProgram(this.progScene);
    gl.uniform1i(this.u(this.progScene, "uNodeColor"), 0);
    gl.uniform1i(this.u(this.progScene, "uNodeRadius"), 1);
    this.bindTex(2, this.trail.tex);
    gl.uniform1i(this.u(this.progScene, "uTrailTex"), 2);
    gl.uniform1f(this.u(this.progScene, "uPx"), px);
    gl.uniform1f(this.u(this.progScene, "uNodes"), n);
    gl.uniform1f(this.u(this.progScene, "uMargin"), render.margin_cells);
    gl.uniform1f(this.u(this.progScene, "uRatio"), render.node.dot.radius_ratio);
    gl.uniform3f(this.u(this.progScene, "uBg"), this.bg[0], this.bg[1], this.bg[2]);
    this.pass(this.scene, px, px);

    // glow: blur at reduced resolution, sigma in texels of that resolution
    const sigma = (render.node.dot.glow_sigma_ratio * pitch) / BLUR_DOWNSCALE;
    gl.useProgram(this.progBlur);
    gl.uniform1f(this.u(this.progBlur, "uSigma"), sigma);
    gl.uniform1i(this.u(this.progBlur, "uSrc"), 0);
    this.bindTex(0, this.scene.tex);
    gl.uniform2f(this.u(this.progBlur, "uStep"), 1 / this.blurA.w, 0);
    this.pass(this.blurA, this.blurA.w, this.blurA.h);
    this.bindTex(0, this.blurA.tex);
    gl.uniform2f(this.u(this.progBlur, "uStep"), 0, 1 / this.blurB.h);
    this.pass(this.blurB, this.blurB.w, this.blurB.h);

    // composite to the canvas
    gl.useProgram(this.progComposite);
    this.bindTex(0, this.scene.tex);
    this.bindTex(1, this.blurB.tex);
    gl.uniform1i(this.u(this.progComposite, "uScene"), 0);
    gl.uniform1i(this.u(this.progComposite, "uGlow"), 1);
    gl.uniform1f(this.u(this.progComposite, "uOpacity"), render.node.dot.glow_opacity);
    this.pass(null, px, px);
  }

  /** Current canvas contents as RGBA bytes, top row first (for tests and export). */
  readPixels(): Uint8ClampedArray {
    const gl = this.gl;
    const px = this.px;
    const raw = new Uint8Array(px * px * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, px, px, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8ClampedArray(px * px * 4);
    for (let y = 0; y < px; y++) out.set(raw.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4);
    return out;
  }

  dispose(): void {
    const gl = this.gl;
    [this.progTrail, this.progScene, this.progBlur, this.progComposite].forEach((p) => gl.deleteProgram(p));
    [this.trail, this.scene, this.blurA, this.blurB].forEach((t) => this.free(t));
    gl.deleteTexture(this.nodeColorTex);
    gl.deleteTexture(this.nodeRadiusTex);
  }
}
