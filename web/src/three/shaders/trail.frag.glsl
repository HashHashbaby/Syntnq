// The BMU trail (D-057), fragment stage: a faint line of light just over the chip surface, soft
// across the ribbon, fading with age, added to what is behind (additive blending). It is a deliberate
// live overlay, like the 2D trail; the fidelity tests leave out the chips it crosses.
// Inputs : vAge, vSide, uOpacity (peak brightness)
uniform float uOpacity;
varying float vAge;
varying float vSide;
void main() {
  float fade = pow(clamp(1.0 - vAge, 0.0, 1.0), 1.5);
  float soft = exp(-vSide * vSide * 3.0);
  gl_FragColor = vec4(vec3(uOpacity * fade * soft), 1.0);
}
