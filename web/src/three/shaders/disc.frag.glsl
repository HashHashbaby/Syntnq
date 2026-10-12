// The rotating disc (D-060), top face: the signature card as the label (unlit: its pixels exactly),
// a smoked-glass body with fine grooves and smooth track gaps, an anisotropic sheen fixed in screen space
// (the "bow tie" a real record shows while it turns), a polished rim and a small spindle.
// Inputs : vLocal, vScreen (see disc.vert.glsl), uLabel (the 2D card, sRGB bytes, row 0 at the top),
//          uLabelR, uSpindleR, uRimW, uBody (linear grey), uGrooves (rings across the band), uGrooveDepth,
//          uGaps (track gap radii), uSheen, uSheenPower, uLightDir (unit, screen space), uRim
// Output : sRGB colour (no tone mapping; the label passes through untouched)
uniform sampler2D uLabel;
uniform float uLabelR;
uniform float uSpindleR;
uniform float uRimW;
uniform float uBody;
uniform float uGrooves;
uniform float uGrooveDepth;
uniform vec3 uGaps;
uniform float uSheen;
uniform float uSheenPower;
uniform vec2 uLightDir;
uniform float uRim;
varying vec2 vLocal;
varying vec2 vScreen;

float toSrgb(float c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 toSrgb(vec3 c) { return vec3(toSrgb(c.r), toSrgb(c.g), toSrgb(c.b)); }

void main() {
  float r = length(vLocal);
  float aa = fwidth(r);
  // the label: the square card inscribed in the label circle (half side = R / sqrt 2)
  if (r < uLabelR - aa) {
    vec2 uv = vLocal / (uLabelR * 0.70710678) * 0.5 + 0.5;
    uv.y = 1.0 - uv.y;
    vec3 card = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? vec3(0.0) : texture2D(uLabel, uv).rgb;
    if (r < uSpindleR) {
      // spindle: a small brushed-metal dome
      float d = r / uSpindleR;
      float lit = 0.35 + 0.45 * (1.0 - d * d) + 0.2 * max(dot(normalize(vScreen + 1e-5), uLightDir), 0.0) * d;
      card = vec3(toSrgb(lit * 0.5));
      card = mix(card, vec3(0.0), smoothstep(0.85, 1.0, d) * 0.6);
    }
    gl_FragColor = vec4(card, 1.0);
    return;
  }
  // body: grooves across the band, faded where a ring is finer than a pixel
  float band = clamp((r - uLabelR) / (1.0 - uRimW - uLabelR), 0.0, 1.0);
  float phase = band * uGrooves * 6.2831853;
  float fine = 1.0 - smoothstep(0.35, 0.9, fwidth(phase) / 3.14159);
  float groove = 0.5 + 0.5 * sin(phase);
  float gap = 0.0;
  for (int i = 0; i < 3; i++) gap = max(gap, 1.0 - smoothstep(0.004, 0.010, abs(r - uGaps[i])));
  float g = mix(groove, 0.5, max(gap, 1.0 - fine));
  // sheen: strongest where the grooves run across the light (radial direction along the light)
  vec2 radial = normalize(vScreen + 1e-5);
  float across = pow(abs(dot(radial, uLightDir)), uSheenPower);
  float sheen = uSheen * across * mix(1.0, 0.6 + 0.8 * g, uGrooveDepth) * (1.0 - 0.7 * gap);
  float body = uBody * (1.0 + uGrooveDepth * (g - 0.5)) + sheen;
  // label edge: a thin dark ring
  body *= mix(0.25, 1.0, smoothstep(uLabelR, uLabelR + 0.015, r));
  // rim: polished, brighter toward the outer edge and on the lit side
  float rim = smoothstep(1.0 - uRimW, 1.0 - uRimW * 0.3, r);
  float litSide = 0.5 + 0.5 * dot(radial, uLightDir);
  body = mix(body, uRim * (0.35 + 0.65 * litSide), rim * 0.8);
  vec3 col = vec3(toSrgb(clamp(body, 0.0, 1.0)));
  // soft outer edge
  float alpha = 1.0 - smoothstep(1.0 - aa * 1.5, 1.0, r);
  gl_FragColor = vec4(col * alpha, alpha);
}
