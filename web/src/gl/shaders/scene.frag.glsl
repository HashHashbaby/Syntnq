#version 300 es
// Dots over the trail (the `dot` node style, docs/ANALYSIS.md 12 and docs/LIVE.md 2.9).
// Inputs : uNodeColor  (n x n RGB8, sRGB-encoded node colours), uNodeRadius (n x n R32F scale),
//          uTrailTex   (blurred trail intensity), uPx canvas side in pixels, uNodes, uMargin,
//          uRatio dot radius / pitch, uBg background colour.
// Output : sRGB-encoded scene colour (blending is done on encoded values, as the Python reference).
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uNodeColor, uNodeRadius, uTrailTex;
uniform float uPx, uNodes, uMargin, uRatio;
uniform vec3 uBg;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uPx - gl_FragCoord.y);          // pixels, y down
  float pitch = uPx / (uNodes + 2.0 * uMargin);
  vec2 l = frag / pitch - uMargin;
  vec2 idx = floor(l);
  float trail = texture(uTrailTex, vUv).r;
  vec3 base = uBg + vec3(trail);
  float cov = 0.0;
  vec3 col = vec3(0.0);
  if (idx.x >= 0.0 && idx.y >= 0.0 && idx.x < uNodes && idx.y < uNodes) {
    ivec2 id = ivec2(idx);
    vec2 centre = (idx + 0.5 + uMargin) * pitch;
    float dist = length(frag - centre);
    float radius = uRatio * pitch * texelFetch(uNodeRadius, id, 0).r;
    cov = clamp(radius - dist + 0.5, 0.0, 1.0);                   // 1 px anti-aliasing ramp
    col = texelFetch(uNodeColor, id, 0).rgb;
  }
  o = vec4(base * (1.0 - cov) + col * cov, 1.0);
}
