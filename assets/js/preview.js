/* =====================================================================
   preview.js — motore di riproduzione: clock, compositing WebGL delle
   tracce video, sincronizzazione audio, transport, playhead.
   ===================================================================== */
import { store, tc, resolvedParams, clipDur, clipSpeed, srcAt } from './state.js';
import { runtime, titleAnimOpts, renderTitleCanvas } from './media.js';
import { audio } from './audio.js';
import { GLCompositor, buildCurveLUT, computeLGG } from './effects.js';
import { seekExact } from './webcodecs.js';

/* cache della LUT curve per clip (ricostruita solo quando cambiano le curve) */
const lutCache = new WeakMap();
function lutFor(clip) {
  if (!clip || !clip.curves) return null;
  const key = JSON.stringify(clip.curves);
  const e = lutCache.get(clip);
  if (e && e.key === key) return e.lut;
  const lut = buildCurveLUT(clip.curves);
  lutCache.set(clip, { key, lut });
  return lut;
}

/* cache del bilanciamento Lift/Gamma/Gain per clip */
const lggCache = new WeakMap();
function lggFor(clip) {
  if (!clip || !clip.color) return null;
  const key = JSON.stringify(clip.color);
  const e = lggCache.get(clip);
  if (e && e.key === key) return e.lgg;
  const lgg = computeLGG(clip.color);
  lggCache.set(clip, { key, lgg });
  return lgg;
}

export const THEAD_W = 150;

/* in export forziamo gli originali (no proxy) per la massima qualità */
let exportMode = false;
export function setExportMode(v) { exportMode = !!v; }

const canvas = document.getElementById('preview');
const playBtn = document.getElementById('playBtn');
const tcDisplay = document.getElementById('tcDisplay');
const durDisplay = document.getElementById('durDisplay');
const timelineEl = document.getElementById('timeline');
const playheadEl = document.getElementById('playhead');
const vuCanvas = document.getElementById('vuMeter');
const vuCtx = vuCanvas ? vuCanvas.getContext('2d') : null;

const comp = new GLCompositor(canvas);

let anchorPerf = 0;    // performance.now() al via (clock indipendente dall'audio)
let anchorHead = 0;    // playhead al via

/* mantiene un solo elemento per media; usa il proxy in editing se attivo */
function elementFor(mediaId) {
  const rt = runtime.get(mediaId);
  if (!rt) return null;
  if (!exportMode) {
    const m = store.media(mediaId);
    if (m && m.useProxy && rt.proxyEl) return rt.proxyEl;
  }
  return rt.element;
}
function bufferFor(mediaId) {
  const rt = runtime.get(mediaId);
  return rt ? rt.audioBuffer : null;
}

/* ----------------- transport ----------------- */
export function play() {
  if (store.playing) return;
  if (store.playhead >= store.duration() - 0.01) store.playhead = 0;
  store.playing = true;
  audio.resume();
  anchorPerf = performance.now();
  anchorHead = store.playhead;

  // sincronizza mute tracce audio
  for (const t of store.audioTracks()) audio.setTrackMuted(t.id, t.mute);
  // schedula audio
  const clips = [];
  for (const t of store.audioTracks()) {
    if (t.mute) continue;
    for (const c of t.clips) clips.push({ trackId: t.id, clip: c });
  }
  audio.play(clips, bufferFor, store.playhead);
  applyDucking();

  // avvia gli elementi video attivi
  syncVideoElements(store.playhead, true);

  playBtn.classList.add('on');
  playBtn.textContent = '⏸';
  store.emit('play');
}

export function pause() {
  if (!store.playing) return;
  store.playing = false;
  audio.stopAll();
  for (const m of store.project.media) {
    const el = elementFor(m.id);
    if (el && el.pause) try { el.pause(); } catch (_) {}
  }
  playBtn.classList.remove('on');
  playBtn.textContent = '▶';
  store.emit('pause');
}

export function toggle() { store.playing ? pause() : play(); }

export function seek(t) {
  const d = store.duration();
  store.playhead = Math.max(0, Math.min(t, d));
  if (store.playing) { anchorPerf = performance.now(); anchorHead = store.playhead; audioReschedule(); syncVideoElements(store.playhead, true); }
  else scrub();
  updatePlayheadUI();
  store.emit('seek');
}

export function stepFrame(dir) {
  pause();
  seek(store.playhead + dir / store.project.fps);
}
export function gotoStart() { pause(); seek(0); }
export function gotoEnd() { pause(); seek(store.duration()); }

function audioReschedule() {
  const clips = [];
  for (const t of store.audioTracks()) {
    if (t.mute) continue;
    for (const c of t.clips) clips.push({ trackId: t.id, clip: c });
  }
  audio.play(clips, bufferFor, store.playhead);
  applyDucking();
}

/* costruisce gli intervalli di "voce" e fa abbassare le tracce con ducking attivo */
function applyDucking() {
  const duckIds = store.audioTracks().filter(t => t.duck && !t.mute).map(t => t.id);
  if (!duckIds.length) return;
  const intervals = [];
  for (const t of store.audioTracks()) {
    if (t.duck || t.mute) continue;          // le tracce non-ducked sono i trigger
    for (const c of t.clips) intervals.push([c.start, c.start + clipDur(c)]);
  }
  audio.applyDucking(duckIds, intervals, store.playhead, store.duration());
}

/* allinea gli elementi video al tempo T (per play o scrub) */
function syncVideoElements(T, startPlaying) {
  for (const track of store.project.tracks) {
    if (track.type !== 'video') continue;
    const c = store.clipAt(track, T);
    for (const clip of track.clips) {
      const el = elementFor(clip.mediaId);
      if (!el || el.tagName === 'IMG') continue;
      if (clip === c) {
        const target = srcAt(clip, T - clip.start);
        if (Math.abs((el.currentTime || 0) - target) > 0.25) {
          try { el.currentTime = target; } catch (_) {}
        }
        try { el.playbackRate = clipSpeed(clip); } catch (_) {}
        if (startPlaying) { el.muted = true; el.play().catch(() => {}); }
      } else if (startPlaying) {
        try { el.pause(); } catch (_) {}
      }
    }
  }
}

/* ----------------- render loop ----------------- */
function currentTime() {
  if (store.playing) return anchorHead + (performance.now() - anchorPerf) / 1000;
  return store.playhead;
}

function renderFrame() {
  let T = currentTime();
  const dur = store.duration();
  if (store.playing) {
    store.playhead = T;
    if (T >= dur) { store.playhead = dur; pause(); T = dur; }
  }

  comp.clear();
  if (comp.ok) {
    // compositing dal basso verso l'alto
    for (const track of store.videoTracksBottomUp()) {
      if (track.mute) continue;
      const trans = store.transitionAt(track, T);
      if (trans) { drawTransition(track, trans, T); continue; }
      const clip = store.clipAt(track, T);
      if (clip) drawClip(clip, T, {});
    }
  }

  // aggiorna UI
  tcDisplay.textContent = tc(store.playhead, store.project.fps);
  durDisplay.textContent = 'Durata ' + tc(dur, store.project.fps);
  updatePlayheadUI();
  drawVU();

  requestAnimationFrame(renderFrame);
}

/* VU meter stereo a barre con segmenti */
function drawVU() {
  if (!vuCtx) return;
  const { l, r } = audio.getLevels();
  const w = vuCanvas.width, h = vuCanvas.height;
  vuCtx.clearRect(0, 0, w, h);
  const gap = 2, barH = (h - gap) / 2;
  const seg = 3, segGap = 1, n = Math.floor(w / (seg + segGap));
  const draw = (level, y) => {
    const lit = Math.round(level * n);
    for (let i = 0; i < n; i++) {
      const on = i < lit;
      const frac = i / n;
      let col;
      if (frac > 0.85) col = on ? '#ff5b5b' : '#3a2326';
      else if (frac > 0.6) col = on ? '#ffd24a' : '#3a3622';
      else col = on ? '#43d17a' : '#1f2e26';
      vuCtx.fillStyle = col;
      vuCtx.fillRect(i * (seg + segGap), y, seg, barH);
    }
  };
  draw(l, 0);
  draw(r, barH + gap);
}

/* mantiene un elemento video allineato durante il play */
function alignEl(el, clip, T) {
  if (!el || el.tagName === 'IMG' || el.tagName === 'CANVAS') return;
  const target = srcAt(clip, T - clip.start);
  try { el.playbackRate = clipSpeed(clip); } catch (_) {}
  if (store.playing) {
    if (el.paused) { try { el.currentTime = target; el.muted = true; el.play().catch(() => {}); } catch (_) {} }
    else if (Math.abs(el.currentTime - target) > 0.35) { try { el.currentTime = target; } catch (_) {} }
  }
}

function drawClip(clip, T, opts) {
  const el = elementFor(clip.mediaId);
  if (!el) return;
  const m = store.media(clip.mediaId);
  const localT = T - clip.start;
  const P = resolvedParams(clip, localT);
  let o = opts || {};
  const lut = lutFor(clip);
  if (lut) o = { ...o, lut };
  const lgg = lggFor(clip);
  if (lgg) o = { ...o, lgg };
  if (clip.mask && clip.mask.type && clip.mask.type !== 'none') o = { ...o, mask: clip.mask };
  // animazioni titolo
  if (m && m.kind === 'title' && m.title) {
    const ao = titleAnimOpts(m.title, localT, clipDur(clip));
    if (ao) {
      if (ao.typeProgress != null) {
        renderTitleCanvas(el, m.title, m.width || store.project.width, m.height || store.project.height, ao.typeProgress);
      } else {
        o = { ...o };
        if (ao.alpha != null) o.alpha = (o.alpha != null ? o.alpha : 1) * ao.alpha;
        if (ao.slide) o.slide = ao.slide;
        if (ao.scale != null) P.scale = (P.scale || 1) * ao.scale;
      }
    }
  }
  alignEl(el, clip, T);
  comp.draw(el, P, o);
}

/* rende una transizione reale tra due clip sovrapposte */
function drawTransition(track, trans, T) {
  const { A, B, p, type } = trans;
  const elA = elementFor(A.mediaId), elB = elementFor(B.mediaId);
  if (!elA || !elB) { drawClip(B, T, {}); return; }
  alignEl(elA, A, T); alignEl(elB, B, T);
  const PA = resolvedParams(A, T - A.start), PB = resolvedParams(B, T - B.start);
  const la = lutFor(A), lb = lutFor(B), ga = lggFor(A), gb = lggFor(B);
  const mA = (A.mask && A.mask.type && A.mask.type !== 'none') ? A.mask : null;
  const mB = (B.mask && B.mask.type && B.mask.type !== 'none') ? B.mask : null;
  const dA = (extra = {}) => comp.draw(elA, PA, { ...extra, ...(la ? { lut: la } : {}), ...(ga ? { lgg: ga } : {}), ...(mA ? { mask: mA } : {}) });
  const dB = (extra = {}) => comp.draw(elB, PB, { ...extra, ...(lb ? { lut: lb } : {}), ...(gb ? { lgg: gb } : {}), ...(mB ? { mask: mB } : {}) });

  switch (type) {
    case 'dipblack':
      if (p < 0.5) { dA(); comp.fill(0, 0, 0, p / 0.5); }
      else { dB(); comp.fill(0, 0, 0, (1 - p) / 0.5); }
      break;
    case 'dipwhite':
      if (p < 0.5) { dA(); comp.fill(1, 1, 1, p / 0.5); }
      else { dB(); comp.fill(1, 1, 1, (1 - p) / 0.5); }
      break;
    case 'wipeleft':
      dA(); dB({ wipe: { dir: [1, 0], edge: p } });
      break;
    case 'wiperight':
      dA(); dB({ wipe: { dir: [-1, 0], edge: p - 1 } });
      break;
    case 'slideleft':
      dA(); dB({ slide: [(1 - p) * 2, 0] });
      break;
    case 'slideright':
      dA(); dB({ slide: [-(1 - p) * 2, 0] });
      break;
    case 'push':
      dA({ slide: [-p * 2, 0] }); dB({ slide: [(1 - p) * 2, 0] });
      break;
    default: // dissolve
      dA(); dB({ alpha: p });
  }
}

/* disegno singolo frame da fermo (scrub) — seek frame-accurate sui video attivi */
function scrub() {
  for (const track of store.project.tracks) {
    if (track.type !== 'video') continue;
    const c = store.clipAt(track, store.playhead);
    if (!c) continue;
    const el = elementFor(c.mediaId);
    if (!el) continue;
    if (el.tagName === 'VIDEO') {
      const target = srcAt(c, store.playhead - c.start);
      seekExact(el, target);   // il rAF ridisegna appena il fotogramma è pronto
    }
  }
}

export function updatePlayheadUI() {
  const x = THEAD_W + store.playhead * store.pxPerSec - timelineEl.scrollLeft;
  playheadEl.style.left = Math.max(THEAD_W, x) + 'px';
  playheadEl.style.display = x < THEAD_W - 1 ? 'none' : 'block';
}

timelineEl.addEventListener('scroll', updatePlayheadUI);

export function startLoop() { requestAnimationFrame(renderFrame); }
