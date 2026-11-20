package com.musii.studio.engine

/** GLSL-Quellen (OpenGL ES 2.0) für Ebenen- und Projekt-Shader. */
object Shaders {

    const val VERTEX = """
attribute vec4 aFramePosition;
varying vec2 vUv;
void main() {
  gl_Position = aFramePosition;
  vUv = vec2(aFramePosition.x * 0.5 + 0.5, aFramePosition.y * 0.5 + 0.5);
}
"""

    /** Gemeinsame Hilfsfunktionen. Erwartet eine Funktion `vec4 SRC(vec2 uv)` (uv: 0..1, y nach oben). */
    private const val COMMON = """
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hueRotate(vec3 c, float a) {
  float cosA = cos(a); float sinA = sin(a);
  mat3 m = mat3(
    0.299 + 0.701 * cosA + 0.168 * sinA, 0.299 - 0.299 * cosA - 0.328 * sinA, 0.299 - 0.300 * cosA + 1.250 * sinA,
    0.587 - 0.587 * cosA + 0.330 * sinA, 0.587 + 0.413 * cosA + 0.035 * sinA, 0.587 - 0.588 * cosA - 1.050 * sinA,
    0.114 - 0.114 * cosA - 0.497 * sinA, 0.114 - 0.114 * cosA + 0.292 * sinA, 0.114 + 0.886 * cosA - 0.203 * sinA);
  return m * c;
}
vec4 blurSample(vec2 uv, vec2 radiusUv) {
  vec4 acc = SRC(uv) * 0.2;
  acc += SRC(uv + radiusUv * vec2(1.0, 0.0)) * 0.1;
  acc += SRC(uv + radiusUv * vec2(-1.0, 0.0)) * 0.1;
  acc += SRC(uv + radiusUv * vec2(0.0, 1.0)) * 0.1;
  acc += SRC(uv + radiusUv * vec2(0.0, -1.0)) * 0.1;
  acc += SRC(uv + radiusUv * vec2(0.7, 0.7)) * 0.1;
  acc += SRC(uv + radiusUv * vec2(-0.7, 0.7)) * 0.1;
  acc += SRC(uv + radiusUv * vec2(0.7, -0.7)) * 0.1;
  acc += SRC(uv + radiusUv * vec2(-0.7, -0.7)) * 0.1;
  return acc;
}
vec4 blurSample2(vec2 uv, vec2 r) {
  return (blurSample(uv, r) * 0.5 + blurSample(uv, r * 0.45) * 0.5);
}

// ---- Effekte: Koordinaten verzerren ----
vec2 fxWarp(vec2 uv, float code, float k, float t, vec2 size) {
  float aspect = size.x / max(1.0, size.y);
  if (code == 2.0) {
    float cell = max(2.0, k * 60.0) * (size.y / 1080.0);
    vec2 px = uv * size;
    px = (floor(px / cell) + 0.5) * cell;
    return px / size;
  }
  if (code == 6.0) { return vec2(uv.x > 0.5 ? 1.0 - uv.x : uv.x, uv.y); }
  if (code == 7.0) {
    vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(d);
    float a = atan(d.y, d.x) + t * 0.3 * k;
    float seg = 6.2831853 / 6.0;
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    d = vec2(cos(a), sin(a)) * r;
    return d / vec2(aspect, 1.0) + 0.5;
  }
  if (code == 8.0) {
    float s = 1.0 + k * 0.18 * (0.5 + 0.5 * sin(t * 6.2831853 * 1.6));
    return (uv - 0.5) / s + 0.5;
  }
  if (code == 9.0) {
    float seed = floor(t * 24.0);
    vec2 o = vec2(hash1(seed) - 0.5, hash1(seed + 11.0) - 0.5) * 2.0 * k * 0.03;
    return (uv - 0.5) / (1.0 + 0.05 * k) + 0.5 + o;
  }
  if (code == 18.0) { return fract(uv * 2.0); }
  if (code == 19.0) { return fract(uv * 3.0); }
  if (code == 20.0) {
    vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(d);
    float R = 0.5;
    if (r < R) {
      float a = k * 6.2831853 * sin(t * 1.2) * (1.0 - r / R) * (1.0 - r / R);
      float c = cos(a); float s = sin(a);
      d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    }
    return d / vec2(aspect, 1.0) + 0.5;
  }
  if (code == 21.0) {
    vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(d);
    float R = 0.45;
    if (r < R) { d *= mix(1.0, smoothstep(0.0, R, r) , k * 0.9); }
    return d / vec2(aspect, 1.0) + 0.5;
  }
  if (code == 3.0) {
    float seed = floor(t * 14.0);
    float burst = step(hash1(seed), 0.35 + k * 0.4);
    float band = floor(uv.y * (6.0 + 10.0 * hash1(seed + 3.0)));
    float h = hash1(band * 7.13 + seed);
    float shift = burst * step(0.75 - k * 0.3, h) * (hash1(band + seed * 3.1) - 0.5) * 0.12 * k;
    return vec2(uv.x + shift, uv.y);
  }
  return uv;
}

// ---- Effekte: Farbe ----
vec4 fxColor(vec4 c, vec2 uv, float code, float k, float t, vec2 size) {
  float ref = size.y / 1080.0;
  vec2 px = 1.0 / size;
  if (code == 1.0) { return blurSample2(uv, px * k * 30.0 * ref); }
  if (code == 4.0 || code == 3.0 || code == 5.0) {
    float off = (code == 4.0 ? k * 24.0 : (code == 5.0 ? (3.0 + k * 8.0) : 4.0 * k + 30.0 * k * step(hash1(floor(t * 14.0)), 0.35 + k * 0.4) * (hash1(floor(t * 14.0) + 5.0) - 0.5))) * ref;
    vec4 rr = SRC(uv + vec2(off, 0.0) * px);
    vec4 bb = SRC(uv - vec2(off, 0.0) * px);
    c = vec4(rr.r, c.g, bb.b, max(c.a, max(rr.a, bb.a)));
    if (code == 5.0) {
      float scan = 0.85 + 0.15 * sin(uv.y * size.y * 1.5);
      c.rgb *= scan;
      c.rgb += (hash(uv * size + t * 61.0) - 0.5) * (0.12 + k * 0.15);
      float band = fract(t * 0.25);
      if (abs((1.0 - uv.y) - band) < 0.02) { c.rgb += 0.12; }
      c.rgb = mix(vec3(luma(c.rgb)), c.rgb, 0.85);
    }
    return c;
  }
  if (code == 10.0) {
    vec4 b = blurSample2(uv, px * 18.0 * ref);
    vec3 bright = max(b.rgb - 0.45, 0.0) * 1.8;
    c.rgb += bright * k * 1.6;
    return c;
  }
  if (code == 11.0) {
    float lv = 2.0 + (1.0 - k) * 10.0;
    c.rgb = floor(c.rgb * lv + 0.5) / lv;
    return c;
  }
  if (code == 12.0) { c.rgb = mix(c.rgb, 1.0 - c.rgb, max(0.2, k)); return c; }
  if (code == 13.0) {
    float tl = luma(SRC(uv + vec2(-1.0, 1.0) * px).rgb); float tm = luma(SRC(uv + vec2(0.0, 1.0) * px).rgb); float tr = luma(SRC(uv + vec2(1.0, 1.0) * px).rgb);
    float ml = luma(SRC(uv + vec2(-1.0, 0.0) * px).rgb); float mr = luma(SRC(uv + vec2(1.0, 0.0) * px).rgb);
    float bl = luma(SRC(uv + vec2(-1.0, -1.0) * px).rgb); float bm = luma(SRC(uv + vec2(0.0, -1.0) * px).rgb); float br = luma(SRC(uv + vec2(1.0, -1.0) * px).rgb);
    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * tm - tr + bl + 2.0 * bm + br;
    float e = clamp(length(vec2(gx, gy)) * (1.0 + k * 4.0), 0.0, 1.0);
    c.rgb = vec3(e) * c.rgb * 1.5 + vec3(e) * 0.3;
    return c;
  }
  if (code == 14.0) {
    float l = luma(c.rgb);
    vec3 cold = vec3(0.05, 0.0, 0.6); vec3 mid = vec3(0.9, 0.1, 0.4); vec3 hot = vec3(1.0, 0.9, 0.1);
    vec3 th = l < 0.5 ? mix(cold, mid, l * 2.0) : mix(mid, hot, (l - 0.5) * 2.0);
    c.rgb = mix(c.rgb, th, max(0.3, k));
    return c;
  }
  if (code == 15.0) {
    if (sin(t * 6.2831853 * (3.0 + k * 7.0)) > 0.3) { c.rgb *= 1.5 + k * 1.5; }
    return c;
  }
  if (code == 16.0) {
    float l = luma(c.rgb);
    vec3 sep = vec3(l * 1.07, l * 0.74, l * 0.43);
    c.rgb = mix(c.rgb, sep, 0.6 + k * 0.4);
    float d = distance(uv, vec2(0.5)) * 1.414;
    c.rgb *= 1.0 - (0.5 + k * 0.4) * smoothstep(0.4, 1.0, d);
    c.rgb += (hash(uv * size + t * 37.0) - 0.5) * (0.15 + k * 0.15);
    float seed = floor(t * 18.0);
    c.rgb *= 1.0 + (hash1(seed + 99.0) - 0.5) * 0.12 * k;
    for (int s = 0; s < 2; s++) {
      float fs = float(s);
      if (hash1(seed * 7.0 + fs) < 0.6) {
        float x = hash1(seed * 5.0 + fs);
        if (abs(uv.x - x) < 0.0012) { c.rgb = mix(c.rgb, vec3(1.0, 1.0, 0.95), 0.35 * k); }
      }
    }
    return c;
  }
  if (code == 17.0) {
    float bar = 0.04 + k * 0.12;
    if (uv.y < bar || uv.y > 1.0 - bar) { c = vec4(0.0, 0.0, 0.0, 1.0); }
    return c;
  }
  if (code == 22.0) {
    float ph = fract(t * 1.5);
    float a = max(0.0, 1.0 - ph * 4.0) * k;
    c.rgb = mix(c.rgb, vec3(1.0), a);
    c.a = max(c.a, a);
    return c;
  }
  if (code == 23.0 || code == 24.0) {
    vec2 p = uv * size / ref;
    float flakes = 0.0;
    if (code == 23.0) {
      for (int l = 0; l < 3; l++) {
        float fl = float(l);
        float sc = 40.0 + fl * 25.0;
        vec2 q = p / sc + vec2(sin(t * 0.8 + fl) * 0.4, t * (1.2 + fl * 0.5));
        vec2 cell = floor(q);
        vec2 f = fract(q);
        float rnd = hash(cell + fl * 17.0);
        if (rnd < 0.15 + k * 0.5) {
          vec2 cpos = vec2(hash(cell + 3.1), hash(cell + 7.7));
          float d = length(f - cpos);
          flakes += smoothstep(0.12 - fl * 0.02, 0.0, d);
        }
      }
      c.rgb = mix(c.rgb, vec3(1.0), clamp(flakes, 0.0, 1.0) * 0.9);
      c.a = max(c.a, clamp(flakes, 0.0, 1.0));
    } else {
      vec2 q = vec2(p.x / 14.0 + p.y * 0.012, p.y / 120.0 + t * 9.0);
      vec2 cell = floor(q);
      vec2 f = fract(q);
      float rnd = hash(cell);
      if (rnd < 0.1 + k * 0.4) {
        float x = hash(cell + 2.3);
        float line = smoothstep(0.08, 0.0, abs(f.x - x)) * smoothstep(0.0, 0.3, f.y) * smoothstep(1.0, 0.6, f.y);
        flakes = line;
      }
      c.rgb = mix(c.rgb, vec3(0.85, 0.9, 1.0), flakes * 0.55);
      c.a = max(c.a, flakes * 0.55);
    }
    return c;
  }
  if (code == 25.0) {
    float sp = 0.0;
    vec2 p = uv * vec2(size.x / size.y, 1.0) * 8.0;
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float frame = floor(t * 2.5);
    float rnd = hash(cell + frame);
    if (rnd < 0.15 + k * 0.4) {
      vec2 cpos = vec2(hash(cell + frame + 1.3), hash(cell + frame + 4.7));
      vec2 d = abs(f - cpos);
      float tw = 0.5 + 0.5 * sin(t * 6.0 + rnd * 20.0);
      sp = (smoothstep(0.03, 0.0, d.x * d.y * 30.0) * smoothstep(0.25, 0.0, length(d))) * tw;
      sp += smoothstep(0.06, 0.0, length(f - cpos)) * tw;
    }
    c.rgb += vec3(1.0, 1.0, 0.9) * sp;
    c.a = max(c.a, clamp(sp, 0.0, 1.0));
    return c;
  }
  if (code == 26.0) {
    vec2 ctr = vec2(0.5 + 0.45 * sin(t * 0.7), 0.4 + 0.3 * cos(t * 0.5));
    float d = distance(uv * vec2(size.x / size.y, 1.0), ctr * vec2(size.x / size.y, 1.0));
    float a = smoothstep(0.9, 0.0, d) * (0.75 * k + 0.15);
    vec3 leak = vec3(1.0, 0.45, 0.15);
    c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - leak * a);
    return c;
  }
  if (code == 27.0) {
    float d = distance(uv, vec2(0.5)) * 1.414;
    c.rgb *= 1.0 - (0.6 + k * 0.4) * smoothstep(0.75 - k * 0.35, 1.0, d);
    return c;
  }
  if (code == 28.0) {
    if (mod(floor(t * (2.0 + k * 6.0)), 2.0) < 1.0) { float l = luma(c.rgb); c.rgb = vec3(clamp((l - 0.5) * 1.4 + 0.5, 0.0, 1.0)); }
    return c;
  }
  if (code == 29.0) {
    float cell = (4.0 + k * 18.0) * ref;
    vec2 p = uv * size;
    float ang = 0.4;
    vec2 rp = vec2(cos(ang) * p.x - sin(ang) * p.y, sin(ang) * p.x + cos(ang) * p.y);
    vec2 f = fract(rp / cell) - 0.5;
    float l = luma(c.rgb);
    float rad = sqrt(1.0 - l) * 0.7;
    float dot = smoothstep(rad, rad - 0.08, length(f));
    c.rgb = mix(vec3(1.0), vec3(0.05), dot);
    return c;
  }
  if (code == 30.0) {
    float scan = 0.75 + 0.25 * sin(uv.y * size.y * 3.14159 / max(1.0, 2.0 * ref));
    c.rgb *= mix(1.0, scan, k);
    float d = distance(uv, vec2(0.5)) * 1.414;
    c.rgb *= 1.0 - 0.5 * k * smoothstep(0.6, 1.1, d);
    return c;
  }
  return c;
}
"""

    /** Farbbearbeitung (Filter + Regler); Werte normalisiert (-1..1) */
    private const val COLOR = """
uniform float uBright;
uniform float uContrast;
uniform float uSat;
uniform float uExposure;
uniform float uTemp;
uniform float uTint;
uniform float uHigh;
uniform float uShadow;
uniform float uVibrance;
uniform float uHue;
uniform float uSharpen;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;
uniform float uTone;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;

vec3 colorGrade(vec3 c, vec2 uv, vec2 size, float t) {
  if (uSharpen > 0.001) {
    vec2 px = 1.0 / size;
    vec3 b = (SRC(uv + vec2(px.x, 0.0)).rgb + SRC(uv - vec2(px.x, 0.0)).rgb + SRC(uv + vec2(0.0, px.y)).rgb + SRC(uv - vec2(0.0, px.y)).rgb) * 0.25;
    c += (c - b) * uSharpen * 2.0;
  }
  c *= pow(2.0, uExposure * 1.5);
  c += uBright * 0.25;
  c = (c - 0.5) * (1.0 + uContrast * 0.5) + 0.5;
  float l = luma(c);
  c = mix(vec3(l), c, 1.0 + uSat);
  if (abs(uVibrance) > 0.001) {
    float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b));
    c = mix(vec3(luma(c)), c, 1.0 + uVibrance * (1.0 - (mx - mn)));
  }
  c.r += uTemp * 0.12; c.b -= uTemp * 0.12;
  c.g -= uTint * 0.08; c.r += uTint * 0.03; c.b += uTint * 0.03;
  if (abs(uHue) > 0.001) { c = hueRotate(c, uHue * 3.14159); }
  l = clamp(luma(c), 0.0, 1.0);
  c += uHigh * 0.25 * smoothstep(0.45, 1.0, l);
  c += uShadow * 0.25 * (1.0 - smoothstep(0.0, 0.55, l));
  c += uShadowTint * (1.0 - l) + uHighTint * l;
  if (uFade > 0.001) { c = c * (1.0 - uFade * 0.22) + uFade * 0.16; }
  if (uTone > 0.5) {
    float g = luma(c);
    if (uTone < 1.5) { c = vec3(g); }
    else if (uTone < 2.5) { c = vec3(g * 1.07, g * 0.74, g * 0.43) + 0.03; }
    else { g = clamp((g - 0.5) * 1.35 + 0.5, 0.0, 1.0); c = vec3(g); }
  }
  if (abs(uVignette) > 0.001) {
    float d = distance(uv, vec2(0.5)) * 1.414;
    float v = smoothstep(0.4, 1.0, d);
    if (uVignette > 0.0) { c *= 1.0 - uVignette * v; } else { c = mix(c, vec3(1.0), -uVignette * v); }
  }
  if (uGrain > 0.001) { c += (hash(uv * size + fract(t * 7.0) * 100.0) - 0.5) * uGrain * 0.3; }
  return clamp(c, 0.0, 1.0);
}
"""

    /** Shader für Clip-Ebenen (Haupt- und Überlagerungsspuren). */
    val LAYER_FRAGMENT = """
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uInSize;      // Texturgröße
uniform vec2 uDispSize;    // angezeigte (gedrehte) Größe
uniform vec2 uOutSize;     // Canvas
uniform float uPreRot;     // 0, 90, 180, 270
uniform mat3 uM;           // Ausgabe-Pixel -> angezeigte Pixel
uniform vec4 uCrop;        // in angezeigten Pixeln (x, y, w, h)
uniform float uAlpha;
uniform float uTime;
uniform float uSpacer;
// Hintergrund
uniform float uBgMode;     // 0 transparent, 1 Farbe, 2 unscharf
uniform vec3 uBgColor;
uniform float uBgScale;
uniform float uBgBlur;
// Chroma-Key
uniform float uChroma;
uniform float uChromaHue;
uniform float uChromaTol;
uniform float uChromaSoft;
// Maske (angezeigte Pixel)
uniform float uMaskKind;
uniform vec2 uMaskCenter;
uniform float uMaskSize;
uniform float uMaskAspect;
uniform float uMaskRot;
uniform float uMaskFeather;
uniform float uMaskInvert;
// Übergang
uniform float uTMask;      // 0 keine, 1 Rechteck, 2 Kreis
uniform vec4 uTRect;       // normiert (oben links)
uniform float uTInvert;
uniform vec3 uTColor;
uniform float uTColorAmt;
uniform float uTBlur;
uniform float uTPixel;
uniform float uTGlitch;
// Effekte
uniform float uFx[4];
uniform float uFxAmt[4];

vec2 texUvFromDisp(vec2 n) {
  vec2 t = n;
  if (uPreRot > 45.0 && uPreRot < 135.0) { t = vec2(n.y, 1.0 - n.x); }
  else if (uPreRot > 135.0 && uPreRot < 225.0) { t = vec2(1.0 - n.x, 1.0 - n.y); }
  else if (uPreRot > 225.0) { t = vec2(1.0 - n.y, n.x); }
  return vec2(t.x, 1.0 - t.y);
}

// Quelle in "Effekt-UV" (0..1 über den Zuschnitt, y nach oben)
vec4 SRC(vec2 uv) {
  vec2 disp = vec2(uCrop.x + uv.x * uCrop.z, uCrop.y + (1.0 - uv.y) * uCrop.w);
  vec2 n = clamp(disp / uDispSize, 0.0, 1.0);
  return texture2D(uTex, texUvFromDisp(n));
}

$COMMON
$COLOR

float maskAlpha(vec2 disp) {
  if (uMaskKind < 0.5) return 1.0;
  vec2 p = disp - uMaskCenter;
  float c = cos(-uMaskRot); float s = sin(-uMaskRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float minSide = min(uCrop.z, uCrop.w);
  float f = max(0.5, uMaskFeather * minSide * 0.5);
  float a = 1.0;
  if (uMaskKind < 1.5) {
    float r = uMaskSize * minSide * 0.5;
    float d = length(vec2(p.x / max(0.1, uMaskAspect), p.y));
    a = 1.0 - smoothstep(r - f, r + 0.5, d);
  } else if (uMaskKind < 2.5) {
    float h = uMaskSize * minSide * 0.5;
    vec2 b = vec2(h * uMaskAspect, h);
    vec2 q = abs(p) - b;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    a = 1.0 - smoothstep(-f, 0.5, d);
  } else if (uMaskKind < 3.5) {
    a = smoothstep(f, -f, p.y);
  } else if (uMaskKind < 4.5) {
    float h = uMaskSize * minSide * 0.5;
    a = 1.0 - smoothstep(h - f, h + 0.5, abs(p.y));
  } else {
    float sz = uMaskSize * minSide * 0.5;
    vec2 q = p / max(1.0, sz);
    q.y = -q.y + 0.25;
    float x = q.x; float y = q.y;
    float v = x * x + pow(y - pow(abs(x), 0.66), 2.0);
    a = 1.0 - smoothstep(1.0 - uMaskFeather * 2.0, 1.0, v);
  }
  if (uMaskInvert > 0.5) a = 1.0 - a;
  return a;
}

void main() {
  if (uSpacer > 0.5) { gl_FragColor = vec4(0.0); return; }
  vec2 outPx = vec2(vUv.x * uOutSize.x, (1.0 - vUv.y) * uOutSize.y);
  vec2 canvasN = outPx / uOutSize;
  float ref = uOutSize.y / 1080.0;

  // Hintergrund
  vec4 bg = vec4(0.0);
  if (uBgMode > 0.5 && uBgMode < 1.5) { bg = vec4(uBgColor, 1.0); }
  else if (uBgMode > 1.5) {
    vec2 rel = (outPx - uOutSize * 0.5) / uBgScale;
    vec2 disp = vec2(uCrop.x + uCrop.z * 0.5, uCrop.y + uCrop.w * 0.5) + rel;
    vec2 euv = vec2((disp.x - uCrop.x) / uCrop.z, 1.0 - (disp.y - uCrop.y) / uCrop.w);
    vec2 r = vec2(0.02 + uBgBlur * 0.06) * vec2(uOutSize.y / uOutSize.x, 1.0);
    bg = blurSample2(clamp(euv, 0.0, 1.0), r);
    bg.rgb *= 0.88;
    bg.a = 1.0;
  }

  // Ebene
  vec3 dispP = uM * vec3(outPx, 1.0);
  vec2 disp = dispP.xy;
  vec4 col = vec4(0.0);
  bool inside = disp.x >= uCrop.x && disp.y >= uCrop.y && disp.x <= uCrop.x + uCrop.z && disp.y <= uCrop.y + uCrop.w;
  if (inside) {
    vec2 euv = vec2((disp.x - uCrop.x) / uCrop.z, 1.0 - (disp.y - uCrop.y) / uCrop.w);
    vec2 cropSize = uCrop.zw;
    for (int i = 0; i < 4; i++) {
      if (uFx[i] > 0.5) { euv = fxWarp(euv, uFx[i], uFxAmt[i], uTime, cropSize); }
    }
    if (uTGlitch > 0.001) { euv = fxWarp(euv, 3.0, uTGlitch, uTime * 3.0, cropSize); }
    if (uTPixel > 0.001) { euv = fxWarp(euv, 2.0, uTPixel * 1.2, uTime, cropSize); }
    euv = clamp(euv, 0.0, 1.0);
    col = SRC(euv);
    if (uTBlur > 0.001) { col = blurSample2(euv, vec2(uTBlur * 0.04) * vec2(cropSize.y / cropSize.x, 1.0)); }
    if (uChroma > 0.5) {
      vec3 hsv = rgb2hsv(col.rgb);
      float dh = abs(hsv.x - uChromaHue);
      dh = min(dh, 1.0 - dh);
      if (hsv.y > 0.18 && hsv.z > 0.12) {
        col.a *= smoothstep(uChromaTol, uChromaTol + uChromaSoft, dh);
      }
    }
    col.rgb = colorGrade(col.rgb, euv, cropSize, uTime);
    for (int i = 0; i < 4; i++) {
      if (uFx[i] > 0.5) { col = fxColor(col, euv, uFx[i], uFxAmt[i], uTime, cropSize); }
    }
    if (uTGlitch > 0.001) { col = fxColor(col, euv, 3.0, uTGlitch, uTime * 3.0, cropSize); }
    col.a *= maskAlpha(disp);
  }
  // Ebene über Hintergrund
  vec4 outC;
  float a = clamp(col.a, 0.0, 1.0);
  if (bg.a > 0.0) {
    outC = vec4(mix(bg.rgb, col.rgb, a), 1.0);
  } else {
    outC = vec4(col.rgb, a);
  }
  if (uTColorAmt > 0.001) { outC.rgb = mix(outC.rgb, uTColor, clamp(uTColorAmt, 0.0, 1.0)); }
  // Übergangsmaske (Ausgaberaum)
  float tm = 1.0;
  if (uTMask > 0.5 && uTMask < 1.5) {
    tm = (canvasN.x >= uTRect.x && canvasN.x <= uTRect.x + uTRect.z && canvasN.y >= uTRect.y && canvasN.y <= uTRect.y + uTRect.w) ? 1.0 : 0.0;
  } else if (uTMask > 1.5) {
    vec2 d = (canvasN - 0.5) * vec2(uOutSize.x / uOutSize.y, 1.0);
    tm = 1.0 - smoothstep(uTRect.z - 0.004, uTRect.z, length(d));
  }
  if (uTInvert > 0.5 && uTMask > 0.5) tm = 1.0 - tm;
  outC.a *= tm * uAlpha;
  gl_FragColor = outC;
}
"""

    /** Projekt-Shader: Texte/Sticker (als Bild) + Effekt-Ebenen auf das fertige Bild. */
    val PROJECT_FRAGMENT = """
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uTextTex;
uniform float uHasText;
uniform vec2 uOutSize;
uniform float uFx[6];
uniform float uFxAmt[6];
uniform float uFxTime[6];

vec4 SRC(vec2 uv) {
  vec4 base = texture2D(uTex, uv);
  if (uHasText > 0.5) {
    vec4 tx = texture2D(uTextTex, vec2(uv.x, 1.0 - uv.y));
    base.rgb = tx.rgb + base.rgb * (1.0 - tx.a);
    base.a = tx.a + base.a * (1.0 - tx.a);
  }
  return base;
}

$COMMON

void main() {
  vec2 uv = vUv;
  for (int i = 0; i < 6; i++) {
    if (uFx[i] > 0.5) { uv = fxWarp(uv, uFx[i], uFxAmt[i], uFxTime[i], uOutSize); }
  }
  uv = clamp(uv, 0.0, 1.0);
  vec4 c = SRC(uv);
  for (int i = 0; i < 6; i++) {
    if (uFx[i] > 0.5) { c = fxColor(c, uv, uFx[i], uFxAmt[i], uFxTime[i], uOutSize); }
  }
  c.a = 1.0;
  gl_FragColor = c;
}
"""
}
