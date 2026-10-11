#version 300 es
// Full-screen triangle.
// Inputs : none (vertex id only)
// Outputs: vUv in [0, 1]^2 (GL orientation, row 0 at the bottom)
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
