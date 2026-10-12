// The rotating disc (D-060), edge and underside: a dark polished band, lit from the key direction.
// Inputs : vNormal (view space), uBody (linear grey), uRim (highlight peak)
// Output : sRGB colour
uniform float uBody;
uniform float uRim;
varying vec3 vNormal;
varying vec2 vLocal;
varying vec2 vScreen;
void main() {
  vec3 n = normalize(vNormal);
  float key = max(dot(n, normalize(vec3(-0.5, 0.6, 0.6))), 0.0);
  float c = uBody * 0.8 + uRim * 0.5 * pow(key, 8.0);
  c = c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
  gl_FragColor = vec4(vec3(c), 1.0);
}
