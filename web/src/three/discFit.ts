// Disc framing shared by the renderer (three/disc.ts, lazy chunk) and the landing (main bundle): kept
// free of three.js imports so the landing does not pull the 3D chunk into the first load.
/** Visible half-height / disc radius, so the tilted rim stays inside the canvas. */
export const FIT = 1.08;
