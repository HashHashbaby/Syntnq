// Stained-glass chip, vertex stage (D-046, D-056). One instance per display node.
// Inputs : position, normal (rounded box in node-pitch units, centred, face at +z)
//          instanceMatrix (node centre on the z = 0 plane), aColor (sRGB node colour 0..1),
//          aLift (x: z offset in pitch, y: tilt about x in radians, z: tilt about y, w: size scale)
// Output : vLocal (position on the chip face, -0.5..0.5 of the chip side), vNormal (view space),
//          vFace (1 on the front face, 0 elsewhere), vColor, vSeed (per-chip grain seed)
uniform float uChipSize;
attribute vec3 aColor;
attribute vec4 aLift;
varying vec2 vLocal;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFace;
varying vec3 vColor;
varying float vSeed;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }

void main() {
  mat3 tilt = rotY(aLift.z) * rotX(aLift.y);
  vec3 p = tilt * (position * aLift.w);
  vec4 world = instanceMatrix * vec4(p, 1.0);
  world.z += aLift.x;
  vec4 view = modelViewMatrix * world;
  gl_Position = projectionMatrix * view;
  vLocal = position.xy / uChipSize;
  vNormal = normalize(normalMatrix * (tilt * normal));
  vViewDir = normalize(-view.xyz);
  vFace = step(0.98, normal.z);
  vColor = aColor;
  vSeed = float(gl_InstanceID);
}
