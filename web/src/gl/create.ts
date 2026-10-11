import type { Params } from "../params";
import { Canvas2DRenderer } from "./canvas2d";
import { GridRenderer, webgl2Supported, type GridRendererLike } from "./renderer";

/** WebGL2 when available (and not forced off), Canvas2D otherwise. */
export function createRenderer(canvas: HTMLCanvasElement, p: Params, forceCanvas = false): GridRendererLike {
  if (!forceCanvas && webgl2Supported()) {
    try {
      return new GridRenderer(canvas, p);
    } catch {
      // fall through to Canvas2D
    }
  }
  return new Canvas2DRenderer(canvas, p);
}
