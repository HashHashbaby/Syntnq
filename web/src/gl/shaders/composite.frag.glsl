#version 300 es
// Glow: the blurred scene screen-blended over the scene at `uOpacity` (docs/LIVE.md 2.9).
// Inputs : uScene, uGlow (blurred scene), uOpacity.
// Output : final sRGB-encoded pixel.
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene, uGlow;
uniform float uOpacity;
void main() {
  vec3 a = texture(uScene, vUv).rgb;
  vec3 g = texture(uGlow, vUv).rgb * uOpacity;
  o = vec4(1.0 - (1.0 - a) * (1.0 - g), 1.0);
}
