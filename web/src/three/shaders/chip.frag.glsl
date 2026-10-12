// Stained-glass chip, fragment stage (D-046, D-056). Colour fidelity is the rule: the front face is
// the node's data colour, modulated only by zero-mean terms (absorption toward the edge, denser
// colour at the rim, grain), so the face mean equals the data colour. Lighting acts only on the
// bevelled rim and the sides: a capped glint and shade. No tone mapping, no colour-space conversion:
// the data colour is sRGB-encoded and is written as is.
// Inputs : vLocal, vNormal, vViewDir, vFace, vColor (sRGB 0..1), vSeed
//          uAbsorb (edge lightness falloff), uAbsorbSat (edge chroma gain), uGrain (amplitude),
//          uGlint (rim highlight cap), uSideShade (side darkening), uLightDir (view space),
//          uFlat (half-width of the flat face as a fraction of the chip half-width)
uniform float uAbsorb;
uniform float uAbsorbSat;
uniform float uGrain;
uniform float uGlint;
uniform float uSideShade;
uniform vec3 uLightDir;
uniform float uFlat;
varying vec2 vLocal;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFace;
varying vec3 vColor;
varying float vSeed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 base = vColor;
  // radial position on the flat face, u and v in -1..1: r^2 = u^2 + v^2 has mean 2/3 over the square,
  // so k is zero-mean: a glowing centre and denser corners, like backlit glass, without moving the mean
  vec2 uv = clamp(vLocal * 2.0 / uFlat, -1.0, 1.0);
  float k = dot(uv, uv) - 2.0 / 3.0;
  float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
  // scale both terms by the colour's headroom so the face never clips: clipping would remove part of
  // the zero-mean modulation and move the face mean away from the data colour (k is -2/3 .. 4/3)
  float hi = max(max(base.r, base.g), base.b), lo = min(min(base.r, base.g), base.b);
  float absorb = min(uAbsorb, 1.5 * (1.0 / max(hi, 1e-3) - 1.0));
  float spread = max(luma - lo, hi - luma);
  float sat = min(uAbsorbSat, 0.75 * (min(luma, 1.0 - luma) / max(spread, 1e-3) - 1.0) + 0.0);
  sat = max(sat, 0.0);
  vec3 face = mix(vec3(luma), base, 1.0 + sat * k) * (1.0 - absorb * k);
  float g = hash(floor(vLocal * 22.0) + vSeed * 0.37) - 0.5; // deterministic, zero-mean grain
  face += uGrain * g;
  if (vFace > 0.5) {
    gl_FragColor = vec4(clamp(face, 0.0, 1.0), 1.0);
    return;
  }
  // bevel and sides: shaded glass with one soft, capped glint from the light
  vec3 n = normalize(vNormal);
  float rim = clamp(n.z, 0.0, 1.0); // 1 near the face, 0 on the sides
  vec3 shaded = base * mix(uSideShade * 0.6, uSideShade, rim);
  vec3 h = normalize(uLightDir + normalize(vViewDir));
  float spec = pow(max(dot(n, h), 0.0), 24.0);
  gl_FragColor = vec4(clamp(shaded + vec3(uGlint * spec), 0.0, 1.0), 1.0);
}
