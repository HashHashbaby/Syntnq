#version 300 es
// Separable Gaussian blur (one direction per pass).
// Inputs : uSrc, uStep = texel step of the direction (1/w, 0) or (0, 1/h), uSigma in texels.
// Output : blurred colour.
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform float uSigma;
void main() {
  int radius = int(min(ceil(3.0 * uSigma), 40.0));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -40; i <= 40; i++) {
    if (i < -radius || i > radius) continue;
    float w = exp(-0.5 * float(i * i) / (uSigma * uSigma));
    acc += w * texture(uSrc, vUv + uStep * float(i)).rgb;
    wsum += w;
  }
  o = vec4(acc / wsum, 1.0);
}
