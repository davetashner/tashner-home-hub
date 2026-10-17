/** Wave background shaders, ported unchanged from the Wave Studio prototype (hub-gj6.17). */
export const VERTEX = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

export const FRAGMENT = `
precision highp float;
uniform vec2 uRes; uniform float uTime, uAmp, uCols, uRows, uDot;
uniform vec3 uBg0, uBg1, uBg2, uBloom, uSheetA, uSheetB, uLine, uDotC;
uniform float uSheetAlpha, uLineAlpha, uDotAlpha, uVignette;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float waveY(float x, float t, float s){
  return 0.55*sin(x*1.9 + t*0.31 + s) + 0.30*sin(x*3.3 - t*0.23 + s*1.7) + 0.15*sin(x*6.1 + t*0.47 + s*2.9);
}
float thick(float x, float t, float s){ return 0.75 + 0.25*sin(x*1.2 - t*0.17 + s*3.1); }
vec4 sheet(vec2 p, float t, float center, float s, float h){
  float px = 1.0 / uRes.y;
  float H = h * thick(p.x, t, s);
  float y0 = center + uAmp * waveY(p.x, t, s) - 0.5*H;
  float v = (p.y - y0) / H;
  float inside = smoothstep(-0.03, 0.08, v) * (1.0 - smoothstep(0.92, 1.03, v));
  float fill = inside * mix(0.3, 1.0, v);
  float dT = p.y - (y0 + H), dB = p.y - y0;
  float edge = exp(-dT*dT / (px*px*5.0)) + 0.45*exp(-dB*dB / (px*px*5.0));
  float aspect = uRes.x / uRes.y;
  float dx = aspect / uCols;
  float drift = t * 0.012;
  float k = floor((p.x + drift) / dx + 0.5);
  float xc = k*dx - drift;
  float Hc = h * thick(xc, t, s);
  float y0c = center + uAmp * waveY(xc, t, s) - 0.5*Hc;
  float j = clamp(floor((p.y - y0c) / Hc * uRows + 0.5), 0.0, uRows);
  float yc = y0c + j / uRows * Hc;
  float d = length(vec2(p.x - xc, p.y - yc));
  float bulge = sin(3.14159 * j / uRows);
  float r = uDot * (0.45 + 0.75*bulge);
  float tw = 0.55 + 0.45*sin(t*1.3 + hash(vec2(k, j + s*13.0)) * 6.2831);
  float dotA = (1.0 - smoothstep(r - px, r + px, d)) * (0.2 + 0.8*bulge) * tw;
  float halo = exp(-d*d / (r*r*10.0)) * 0.22 * bulge * tw;
  return vec4(fill, edge, dotA, halo);
}
void main(){
  vec2 f = gl_FragCoord.xy;
  vec2 q = f / uRes;
  vec2 p = f / uRes.y;
  float t = uTime;
  float g = clamp(q.x*0.55 + (1.0 - q.y)*0.45 + 0.08*sin(t*0.05), 0.0, 1.0);
  vec3 col = mix(mix(uBg0, uBg1, g*2.0), mix(uBg1, uBg2, g*2.0 - 1.0), step(0.5, g));
  vec2 bc = vec2(0.72 + 0.06*sin(t*0.07), 0.8);
  col = mix(col, uBloom, exp(-dot(q - bc, q - bc) * 3.2) * 0.55);
  vec4 s1 = sheet(p, t,        0.44, 0.0, 0.22);
  vec4 s2 = sheet(p, t*0.85,   0.58, 2.3, 0.15);
  vec4 s3 = sheet(p, t*1.1,    0.30, 4.7, 0.11);
  col = mix(col, uSheetA, clamp(s1.x*uSheetAlpha, 0.0, 1.0));
  col = mix(col, uSheetB, clamp(s2.x*uSheetAlpha*0.8, 0.0, 1.0));
  col = mix(col, uSheetA, clamp(s3.x*uSheetAlpha*0.6, 0.0, 1.0));
  col = mix(col, uLine, clamp((s1.y + 0.8*s2.y + 0.6*s3.y) * uLineAlpha, 0.0, 1.0));
  float dots = s1.z + 0.8*s2.z + 0.7*s3.z + 0.6*(s1.w + s2.w + s3.w);
  col = mix(col, uDotC, clamp(dots * uDotAlpha, 0.0, 1.0));
  col *= 1.0 - uVignette * dot(q - 0.5, q - 0.5);
  col += (hash(f + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;
