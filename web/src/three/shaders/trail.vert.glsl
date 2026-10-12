// The BMU trail (D-057), vertex stage: a ribbon through the recent best-matching nodes, just over the
// chip surface (positions are computed on the CPU from the node lifts).
// Inputs : position (world), aAge (0 newest .. 1 oldest), aSide (-1 .. 1 across the ribbon)
// Output : vAge, vSide
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
void main() {
  vAge = aAge;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
