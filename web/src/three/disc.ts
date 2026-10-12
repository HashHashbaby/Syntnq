// The rotating disc in the player bar (D-060): a thin smoked-glass disc whose label is the song's
// signature card. Drawn with three.js in the lazily loaded 3D chunk, on its own small transparent canvas.
// It draws only when asked (the caller runs the loop while the disc moves); the angle comes from
// DiscMotion (engine/disc.ts), driven by the audio clock.
// All numbers: config web3d.disc (params.json).
import { CanvasTexture, CylinderGeometry, LinearFilter, Mesh, NoColorSpace, NoToneMapping, PerspectiveCamera, Scene, ShaderMaterial, Vector2, WebGLRenderer } from "three";
import type { Params } from "../params";
import edgeFragment from "./shaders/disc-edge.frag.glsl?raw";
import fragmentShader from "./shaders/disc.frag.glsl?raw";
import vertexShader from "./shaders/disc.vert.glsl?raw";

const DEG = Math.PI / 180;
const SEGMENTS = 160;
const FIT = 1.08; // visible half-height / disc radius, so the tilted rim stays inside the canvas

export interface DiscRendererLike {
  setLabel(card: HTMLCanvasElement): void;
  resize(cssSize: number, dpr: number): void;
  draw(angle: number): void;
  /** The angle last drawn (radians, clockwise), for the rpm test. */
  readonly drawnAngle: number;
  dispose(): void;
}

export class DiscRenderer implements DiscRendererLike {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly mesh: Mesh;
  private readonly top: ShaderMaterial;
  private readonly edge: ShaderMaterial;
  private texture: CanvasTexture | null = null;
  private px = 0;
  drawnAngle = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly p: Params,
  ) {
    const d = p.web3d.disc;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    const dist = FIT / Math.tan((d.camera_fov_deg * DEG) / 2);
    this.camera = new PerspectiveCamera(d.camera_fov_deg, 1, dist * 0.5, dist * 2);
    const tilt = d.tilt_deg * DEG;
    // from above, leaning toward the viewer by the tilt; screen up is the disc's -z (the card's top row)
    this.camera.position.set(0, Math.cos(tilt) * dist, Math.sin(tilt) * dist);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    const light = new Vector2(Math.cos(d.light_angle_deg * DEG), Math.sin(d.light_angle_deg * DEG));
    this.top = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
        uLabel: { value: null },
        uLabelR: { value: d.label_ratio },
        uSpindleR: { value: d.spindle_ratio },
        uRimW: { value: d.rim_ratio },
        uBody: { value: d.body_level },
        uGrooves: { value: d.groove_cycles },
        uGrooveDepth: { value: d.groove_depth },
        uGaps: { value: [d.track_gaps[0] ?? 0, d.track_gaps[1] ?? 0, d.track_gaps[2] ?? 0] },
        uSheen: { value: d.sheen },
        uSheenPower: { value: d.sheen_power },
        uLightDir: { value: light },
        uRim: { value: d.rim_level },
      },
    });
    this.edge = new ShaderMaterial({
      vertexShader,
      fragmentShader: edgeFragment,
      uniforms: { uBody: { value: d.body_level }, uRim: { value: d.rim_level } },
    });
    const geo = new CylinderGeometry(1, 1, d.thickness, SEGMENTS, 1, false);
    geo.translate(0, -d.thickness / 2, 0); // the top face on y = 0
    // CylinderGeometry groups: 0 side, 1 top, 2 bottom
    this.mesh = new Mesh(geo, [this.edge, this.top, this.edge]);
    this.scene.add(this.mesh);
  }

  setLabel(card: HTMLCanvasElement): void {
    this.texture?.dispose();
    const t = new CanvasTexture(card);
    t.colorSpace = NoColorSpace; // the card's sRGB bytes pass through untouched
    t.flipY = false;
    t.generateMipmaps = false; // no mip colour shift
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.texture = t;
    this.top.uniforms.uLabel.value = t;
  }

  resize(cssSize: number, dpr: number): void {
    const px = Math.max(16, Math.round(cssSize * Math.min(dpr, this.p.web3d.max_dpr)));
    if (px === this.px) return;
    this.px = px;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(px, px, false);
  }

  draw(angle: number): void {
    if (this.px === 0) this.resize(this.canvas.clientWidth || 56, window.devicePixelRatio || 1);
    this.mesh.rotation.y = -angle; // clockwise seen from above
    this.renderer.render(this.scene, this.camera);
    this.drawnAngle = angle;
  }

  dispose(): void {
    this.texture?.dispose();
    this.mesh.geometry.dispose();
    this.top.dispose();
    this.edge.dispose();
    this.renderer.dispose();
  }
}

export function createDiscRenderer(canvas: HTMLCanvasElement, p: Params): DiscRendererLike {
  return new DiscRenderer(canvas, p);
}
