#version 300 es
// BMU trail over the last seconds as a soft line through node centres (docs/LIVE.md 2.8).
// Inputs : uTrail[i] = (x_node, y_node, age fraction), oldest first; uCount points;
//          uNodes grid side in nodes; uMargin in nodes; uHalfWidth in nodes; uOpacity peak level.
// Output : single channel intensity in [0, 1] over the whole canvas area (top row = row 0).
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec3 uTrail[96];
uniform int uCount;
uniform float uNodes, uMargin, uHalfWidth, uOpacity;
void main() {
  float span = uNodes + 2.0 * uMargin;
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * span - uMargin;   // node units, y down
  float best = 0.0;
  for (int i = 1; i < 96; i++) {
    if (i >= uCount) break;
    vec2 a = uTrail[i - 1].xy + 0.5, b = uTrail[i].xy + 0.5;
    vec2 ab = b - a;
    float len2 = dot(ab, ab);
    if (len2 < 1e-6) continue;
    float t = clamp(dot(p - a, ab) / len2, 0.0, 1.0);
    float d = length(p - (a + ab * t));
    float prof = 1.0 - smoothstep(0.5 * uHalfWidth, 1.5 * uHalfWidth, d);
    float level = uOpacity * (1.0 - uTrail[i].z);
    best = max(best, prof * level);
  }
  o = vec4(best, best, best, 1.0);
}
