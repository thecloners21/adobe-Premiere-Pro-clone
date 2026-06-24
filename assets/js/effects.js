/* =====================================================================
   effects.js — compositor WebGL avanzato
   Set completo di effetti (Movimento, Colore, Stile) + transizioni reali.
   ===================================================================== */

/* ---- registro parametri effetto (usato da inspector + keyframe) ---- */
export const FX_PARAMS = [
  // Movimento
  { key: 'posX',       label: 'Posizione X', min: -1,   max: 1,   step: 0.005, def: 0,  group: 'Movimento' },
  { key: 'posY',       label: 'Posizione Y', min: -1,   max: 1,   step: 0.005, def: 0,  group: 'Movimento' },
  { key: 'scale',      label: 'Scala',       min: 0.1,  max: 3,   step: 0.01,  def: 1,  group: 'Movimento' },
  { key: 'rotation',   label: 'Rotazione',   min: -180, max: 180, step: 1,     def: 0,  group: 'Movimento' },
  { key: 'opacity',    label: 'Opacità',     min: 0,    max: 1,   step: 0.01,  def: 1,  group: 'Movimento' },
  // Colore
  { key: 'brightness', label: 'Luminosità',  min: -1, max: 1, step: 0.01, def: 0, group: 'Colore' },
  { key: 'contrast',   label: 'Contrasto',   min: -1, max: 1, step: 0.01, def: 0, group: 'Colore' },
  { key: 'saturation', label: 'Saturazione', min: -1, max: 1, step: 0.01, def: 0, group: 'Colore' },
  { key: 'exposure',   label: 'Esposizione', min: -1, max: 1, step: 0.01, def: 0, group: 'Colore' },
  { key: 'hue',        label: 'Tonalità',    min: -180, max: 180, step: 1, def: 0, group: 'Colore' },
  { key: 'temperature',label: 'Temperatura', min: -1, max: 1, step: 0.01, def: 0, group: 'Colore' },
  { key: 'tint',       label: 'Tinta',       min: -1, max: 1, step: 0.01, def: 0, group: 'Colore' },
  // Stile
  { key: 'blur',       label: 'Sfocatura',   min: 0, max: 1, step: 0.01, def: 0, group: 'Stile' },
  { key: 'sharpen',    label: 'Nitidezza',   min: 0, max: 1, step: 0.01, def: 0, group: 'Stile' },
  { key: 'vignette',   label: 'Vignettatura',min: 0, max: 1, step: 0.01, def: 0, group: 'Stile' },
  { key: 'grayscale',  label: 'Bianco e nero', min: 0, max: 1, step: 0.01, def: 0, group: 'Stile' },
  { key: 'sepia',      label: 'Seppia',      min: 0, max: 1, step: 0.01, def: 0, group: 'Stile' },
];

export const FX_GROUPS = ['Movimento', 'Colore', 'Stile'];

export function defaultFx() {
  const fx = {};
  for (const p of FX_PARAMS) fx[p.key] = p.def;
  fx.flipH = 0; fx.flipV = 0;
  return fx;
}

/* ---- transizioni: chiave UI -> nome xfade ffmpeg ---- */
export const TRANSITIONS = [
  { key: 'dissolve',  label: 'Dissolvenza incrociata', ff: 'fade' },
  { key: 'dipblack',  label: 'Dissolvenza al nero',    ff: 'fadeblack' },
  { key: 'dipwhite',  label: 'Dissolvenza al bianco',  ff: 'fadewhite' },
  { key: 'wipeleft',  label: 'Tendina →',              ff: 'wipeleft' },
  { key: 'wiperight', label: 'Tendina ←',              ff: 'wiperight' },
  { key: 'slideleft', label: 'Scorrimento →',          ff: 'slideleft' },
  { key: 'slideright',label: 'Scorrimento ←',          ff: 'slideright' },
  { key: 'push',      label: 'Spinta',                 ff: 'slideleft' },
];

/* ============================ shader ============================ */
const VERT = `
attribute vec2 aPos;
attribute vec2 aUV;
uniform float uScale;
uniform vec2  uTrans;
uniform float uRot;
uniform vec2  uFlip;
uniform float uAspect;
uniform vec2  uSlide;   // offset per slide/push
varying vec2 vUV;
void main() {
  vUV = aUV;
  vec2 p = aPos * uFlip * uScale;
  p.x *= uAspect;                     // correzione aspect per rotazione
  float c = cos(uRot), s = sin(uRot);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  p.x /= uAspect;
  p += uTrans + uSlide;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uSolid; uniform vec3 uColor;
uniform float uBright, uContrast, uSat, uExposure, uHue, uTemp, uTint;
uniform float uVignette, uGray, uSepia, uBlur, uSharpen, uOpacity;
uniform float uWipe; uniform vec2 uWipeDir;
uniform sampler2D uLUT; uniform float uUseLUT;   // curve RGB (color grading)

vec3 hueRotate(vec3 col, float ang) {
  float c = cos(ang), s = sin(ang);
  mat3 m = mat3(
    0.299 + 0.701*c + 0.168*s, 0.587 - 0.587*c + 0.330*s, 0.114 - 0.114*c - 0.497*s,
    0.299 - 0.299*c - 0.328*s, 0.587 + 0.413*c + 0.035*s, 0.114 - 0.114*c + 0.292*s,
    0.299 - 0.300*c + 1.250*s, 0.587 - 0.588*c - 1.050*s, 0.114 + 0.886*c - 0.203*s
  );
  return clamp(col * m, 0.0, 1.0);
}

vec4 sampleBlur(vec2 uv) {
  if (uBlur <= 0.0) return texture2D(uTex, uv);
  float r = uBlur * 4.0;
  vec4 sum = vec4(0.0); float wsum = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec2 off = vec2(float(x), float(y)) * uTexel * r;
      float w = 1.0;
      sum += texture2D(uTex, uv + off) * w; wsum += w;
    }
  }
  return sum / wsum;
}

void main() {
  if (uSolid > 0.5) { gl_FragColor = vec4(uColor, uOpacity); return; }
  if (uWipe >= 0.0) { if (dot(vUV, uWipeDir) > uWipe) discard; }

  vec4 c = sampleBlur(vUV);

  if (uSharpen > 0.0) {
    vec4 n = texture2D(uTex, vUV + vec2(uTexel.x,0.0)) + texture2D(uTex, vUV - vec2(uTexel.x,0.0))
           + texture2D(uTex, vUV + vec2(0.0,uTexel.y)) + texture2D(uTex, vUV - vec2(0.0,uTexel.y));
    c.rgb += (c.rgb * 4.0 - n.rgb) * uSharpen * 0.6;
  }

  // esposizione + luminosità
  c.rgb *= pow(2.0, uExposure);
  c.rgb += uBright;
  // contrasto
  c.rgb = (c.rgb - 0.5) * (1.0 + uContrast) + 0.5;
  // tonalità
  if (abs(uHue) > 0.001) c.rgb = hueRotate(c.rgb, uHue);
  // saturazione
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(vec3(l), c.rgb, 1.0 + uSat);
  // temperatura / tinta
  c.r += uTemp * 0.15; c.b -= uTemp * 0.15; c.g += uTint * 0.15;
  // curve RGB (color grading) — LUT 256x1
  c.rgb = clamp(c.rgb, 0.0, 1.0);
  if (uUseLUT > 0.5) {
    c.r = texture2D(uLUT, vec2(c.r, 0.5)).r;
    c.g = texture2D(uLUT, vec2(c.g, 0.5)).g;
    c.b = texture2D(uLUT, vec2(c.b, 0.5)).b;
  }
  // bianco e nero
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(c.rgb, vec3(g), uGray);
  // seppia
  vec3 sep = vec3(dot(c.rgb, vec3(0.393,0.769,0.189)), dot(c.rgb, vec3(0.349,0.686,0.168)), dot(c.rgb, vec3(0.272,0.534,0.131)));
  c.rgb = mix(c.rgb, sep, uSepia);
  // vignettatura
  if (uVignette > 0.0) {
    float d = distance(vUV, vec2(0.5));
    c.rgb *= 1.0 - smoothstep(0.4, 0.75, d) * uVignette;
  }
  c.rgb = clamp(c.rgb, 0.0, 1.0);
  c.a *= uOpacity;
  gl_FragColor = c;
}`;

export class GLCompositor {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: false })
            || canvas.getContext('experimental-webgl');
    this.gl = gl; this.canvas = canvas; this.ok = !!gl;
    if (!gl) return;

    this.prog = this._program(VERT, FRAG);
    gl.useProgram(this.prog);

    const verts = new Float32Array([-1,-1,0,1,  1,-1,1,1,  -1,1,0,0,  1,1,1,0]);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    const aUV = gl.getAttribLocation(this.prog, 'aUV');
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV);  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);

    this.u = {};
    for (const n of ['uScale','uTrans','uRot','uFlip','uAspect','uSlide','uTexel','uSolid','uColor',
      'uBright','uContrast','uSat','uExposure','uHue','uTemp','uTint','uVignette','uGray','uSepia',
      'uBlur','uSharpen','uOpacity','uWipe','uWipeDir','uTex','uLUT','uUseLUT'])
      this.u[n] = gl.getUniformLocation(this.prog, n);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // texture LUT (256x1) per le curve, su unità 1
    this.lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  clear() {
    const gl = this.gl; if (!gl) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /* P = parametri risolti (con eventuali keyframe già valutati)
     opts = { alpha, wipe:{dir:[x,y],edge}, slide:[x,y] } */
  draw(source, P = {}, opts = {}) {
    const gl = this.gl; if (!gl || !source) return;
    const ready = source.tagName === 'IMG' ? source.complete : (source.tagName === 'CANVAS' || source.readyState >= 2);
    if (!ready) return;
    try { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); }
    catch (_) { return; }

    gl.uniform1i(this.u.uTex, 0);
    // curve RGB (LUT) per questa clip
    if (opts.lut) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, opts.lut);
      gl.uniform1i(this.u.uLUT, 1);
      gl.uniform1f(this.u.uUseLUT, 1);
      gl.activeTexture(gl.TEXTURE0);
    } else {
      gl.uniform1f(this.u.uUseLUT, 0);
    }
    gl.uniform1f(this.u.uScale, P.scale ?? 1);
    gl.uniform2f(this.u.uTrans, (P.posX ?? 0), -(P.posY ?? 0));
    gl.uniform1f(this.u.uRot, (P.rotation ?? 0) * Math.PI / 180);
    gl.uniform2f(this.u.uFlip, P.flipH ? -1 : 1, P.flipV ? -1 : 1);
    gl.uniform1f(this.u.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform2f(this.u.uSlide, opts.slide ? opts.slide[0] : 0, opts.slide ? opts.slide[1] : 0);
    gl.uniform2f(this.u.uTexel, 1 / this.canvas.width, 1 / this.canvas.height);
    gl.uniform1f(this.u.uSolid, 0);
    gl.uniform3f(this.u.uColor, 0, 0, 0);
    gl.uniform1f(this.u.uBright, P.brightness ?? 0);
    gl.uniform1f(this.u.uContrast, P.contrast ?? 0);
    gl.uniform1f(this.u.uSat, P.saturation ?? 0);
    gl.uniform1f(this.u.uExposure, P.exposure ?? 0);
    gl.uniform1f(this.u.uHue, (P.hue ?? 0) * Math.PI / 180);
    gl.uniform1f(this.u.uTemp, P.temperature ?? 0);
    gl.uniform1f(this.u.uTint, P.tint ?? 0);
    gl.uniform1f(this.u.uVignette, P.vignette ?? 0);
    gl.uniform1f(this.u.uGray, P.grayscale ?? 0);
    gl.uniform1f(this.u.uSepia, P.sepia ?? 0);
    gl.uniform1f(this.u.uBlur, P.blur ?? 0);
    gl.uniform1f(this.u.uSharpen, P.sharpen ?? 0);
    gl.uniform1f(this.u.uOpacity, (P.opacity ?? 1) * (opts.alpha ?? 1));
    if (opts.wipe) { gl.uniform1f(this.u.uWipe, opts.wipe.edge); gl.uniform2f(this.u.uWipeDir, opts.wipe.dir[0], opts.wipe.dir[1]); }
    else { gl.uniform1f(this.u.uWipe, -1); gl.uniform2f(this.u.uWipeDir, 1, 0); }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* riempi con colore pieno (per le dissolvenze al nero/bianco) */
  fill(r, g, b, a) {
    const gl = this.gl; if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1f(this.u.uSolid, 1);
    gl.uniform3f(this.u.uColor, r, g, b);
    gl.uniform1f(this.u.uOpacity, a);
    gl.uniform1f(this.u.uScale, 1); gl.uniform2f(this.u.uTrans, 0, 0); gl.uniform1f(this.u.uRot, 0);
    gl.uniform2f(this.u.uFlip, 1, 1); gl.uniform2f(this.u.uSlide, 0, 0);
    gl.uniform1f(this.u.uWipe, -1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _program(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }
}

/* ===================== Curve RGB (color grading) ===================== */
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* interpolazione monotona cubica (Fritsch–Carlson): curva morbida senza overshoot */
export function makeCurveSampler(pts) {
  const p = (pts && pts.length ? pts : [{ x: 0, y: 0 }, { x: 1, y: 1 }]).slice().sort((a, b) => a.x - b.x);
  const n = p.length;
  if (n === 1) return () => p[0].y;
  const xs = p.map(q => q.x), ys = p.map(q => q.y);
  const dx = [], dyn = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 1e-6; dyn[i] = ys[i + 1] - ys[i]; m[i] = dyn[i] / dx[i]; }
  const t = new Array(n);
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = (m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
    else { const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b; if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; } }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 1 && x > xs[i + 1]) i++;
    const h = dx[i], u = (x - xs[i]) / h;
    const h00 = (1 + 2 * u) * (1 - u) * (1 - u), h10 = u * (1 - u) * (1 - u), h01 = u * u * (3 - 2 * u), h11 = u * u * (u - 1);
    return h00 * ys[i] + h10 * h * t[i] + h01 * ys[i + 1] + h11 * h * t[i + 1];
  };
}

export function isIdentityCurves(c) {
  if (!c) return true;
  const idc = (p) => p && p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 1 && p[1].y === 1;
  return idc(c.rgb) && idc(c.r) && idc(c.g) && idc(c.b);
}

/* costruisce una LUT 256x1 RGBA: per ogni livello applica master (rgb) poi il canale */
export function buildCurveLUT(curves) {
  if (!curves || isIdentityCurves(curves)) return null;
  const fM = makeCurveSampler(curves.rgb);
  const fR = makeCurveSampler(curves.r), fG = makeCurveSampler(curves.g), fB = makeCurveSampler(curves.b);
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const mv = clamp01(fM(i / 255));
    lut[i * 4 + 0] = Math.round(clamp01(fR(mv)) * 255);
    lut[i * 4 + 1] = Math.round(clamp01(fG(mv)) * 255);
    lut[i * 4 + 2] = Math.round(clamp01(fB(mv)) * 255);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}
