// The rotating disc (D-060), vertex stage, shared by the top face and the edge.
// Inputs : position, normal (cylinder of radius 1 around +y, top face at +y), modelMatrix (spin about y)
// Output : vLocal (disc coordinates on the top face: x right, y toward the card's top row, radius 1),
//          vScreen (the same point after the spin, so the sheen stays fixed while the disc turns),
//          vNormal (view space)
varying vec2 vLocal;
varying vec2 vScreen;
varying vec3 vNormal;
void main() {
  vLocal = vec2(position.x, -position.z);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vScreen = vec2(world.x, -world.z);
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
