/* =====================================================================
   state.js — modello progetto (EDL) + store osservabile
   ===================================================================== */

import { defaultFx, FX_PARAMS } from './effects.js';

let _uid = 1;
export const uid = (p = 'id') => `${p}${(_uid++).toString(36)}${Date.now().toString(36).slice(-3)}`;

export function newProject(name = 'Progetto senza titolo') {
  return {
    id: uid('prj'),
    name,
    fps: 30,
    width: 1280,
    height: 720,
    sampleRate: 48000,
    media: [],          // {id,name,kind:'video'|'audio'|'image',src,duration,width,height,hasAudio}
    markers: [],        // {id,t,label}
    tracks: [
      { id: uid('v'), type: 'video', name: 'V2', clips: [], mute: false, solo: false },
      { id: uid('v'), type: 'video', name: 'V1', clips: [], mute: false, solo: false },
      { id: uid('a'), type: 'audio', name: 'A1', clips: [], mute: false, solo: false },
      { id: uid('a'), type: 'audio', name: 'A2', clips: [], mute: false, solo: false },
    ],
  };
}

/* curve RGB di default (identità) */
export function defaultCurves() {
  const id = () => [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  return { rgb: id(), r: id(), g: id(), b: id() };
}

/* bilanciamento colore neutro (ombre/mezzitoni/luci) */
export function defaultColor() {
  const n = () => ({ color: '#808080', lum: 0 });
  return { shadows: n(), mids: n(), highlights: n() };
}

/* clip: {id, mediaId, start, in, out, gain, fadeIn, fadeOut, transType, fx{...}, kf{...}, curves{...}} */
export function makeClip(media, start, trackType) {
  const dur = media.duration || (media.kind === 'image' || media.kind === 'title' ? 5 : 0);
  return {
    id: uid('c'),
    mediaId: media.id,
    start,
    in: 0,
    out: dur,
    speed: 1,                 // velocità di riproduzione (1 = normale, >1 più veloce, <1 più lento)
    gain: 1,
    pan: 0,                   // panoramica stereo audio (-1 = sinistra, +1 = destra)
    fadeIn: 0,
    fadeOut: 0,
    transType: 'dissolve',    // tipo transizione in entrata (quando sovrapposta alla precedente)
    fx: defaultFx(),
    kf: {},                   // keyframe per parametro: { key: [{t,v}, ...] } (t = secondi dall'inizio clip)
    ease: {},                 // easing per parametro keyframato: { key: 'linear'|'in'|'out'|'inout'|'hold' }
    curves: defaultCurves(),  // curve RGB di color grading
    color: defaultColor(),    // bilanciamento Lift/Gamma/Gain
    mask: null,               // maschera {type:'ellipse'|'rect',cx,cy,w,h,feather,invert}
    secondary: null,          // qualificazione HSL {on,color,range,soft,satMin,dHue,dSat,dLum}
  };
}

/* maschera di default (ellisse centrata) */
export function defaultMask() {
  return { type: 'ellipse', cx: 0.5, cy: 0.5, w: 0.35, h: 0.35, feather: 0.06, invert: false };
}

/* qualificazione secondaria HSL di default */
export function defaultSecondary() {
  return { on: true, color: '#cc3030', range: 0.08, soft: 0.08, satMin: 0.15, dHue: 0, dSat: 0, dLum: 0 };
}

/* ---- velocità clip ----
   La durata sulla timeline è (out-in)/speed; un tempo locale (timeline) si
   mappa al tempo sorgente con in + localT*speed. */
export function clipSpeed(clip) { return (clip && clip.speed) ? clip.speed : 1; }
export function clipDur(clip) { return (clip.out - clip.in) / clipSpeed(clip); }
export function srcAt(clip, localT) { return clip.in + localT * clipSpeed(clip); }

/* curve di easing per i keyframe */
export const EASINGS = [
  { key: 'linear', label: 'Lineare' },
  { key: 'in',     label: 'Ease In' },
  { key: 'out',    label: 'Ease Out' },
  { key: 'inout',  label: 'Ease In/Out' },
  { key: 'hold',   label: 'Hold (a scatti)' },
];
export function applyEase(p, e) {
  switch (e) {
    case 'in':    return p * p;
    case 'out':   return 1 - (1 - p) * (1 - p);
    case 'inout': return p * p * (3 - 2 * p);
    case 'hold':  return 0;            // resta sul valore precedente fino al keyframe
    default:      return p;            // linear
  }
}

/* valuta un parametro fx tenendo conto dei keyframe + easing; localT = secondi dall'inizio clip */
export function evalParam(clip, key, localT) {
  const kfs = clip.kf && clip.kf[key];
  if (kfs && kfs.length) {
    if (localT <= kfs[0].t) return kfs[0].v;
    if (localT >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].v;
    const ease = (clip.ease && clip.ease[key]) || 'linear';
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i], b = kfs[i + 1];
      if (localT >= a.t && localT <= b.t) {
        const p = (localT - a.t) / Math.max(1e-6, b.t - a.t);
        return a.v + (b.v - a.v) * applyEase(p, ease);
      }
    }
  }
  return clip.fx ? (clip.fx[key] ?? 0) : 0;
}

/* valuta il volume audio (keyframe + easing) a localT; fallback su clip.gain */
export function evalGain(clip, localT) {
  const kfs = clip.kf && clip.kf.gain;
  if (kfs && kfs.length) {
    if (localT <= kfs[0].t) return kfs[0].v;
    if (localT >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].v;
    const ease = (clip.ease && clip.ease.gain) || 'linear';
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i], b = kfs[i + 1];
      if (localT >= a.t && localT <= b.t) {
        const p = (localT - a.t) / Math.max(1e-6, b.t - a.t);
        return a.v + (b.v - a.v) * applyEase(p, ease);
      }
    }
  }
  return clip.gain ?? 1;
}

/* tutti i parametri risolti a localT (per il compositor) */
export function resolvedParams(clip, localT) {
  const P = {};
  for (const p of FX_PARAMS) P[p.key] = evalParam(clip, p.key, localT);
  P.flipH = clip.fx?.flipH ? 1 : 0;
  P.flipV = clip.fx?.flipV ? 1 : 0;
  return P;
}

class Store {
  constructor() {
    this.project = newProject();
    this.selectedClip = null;   // {trackId, clipId}
    this.playhead = 0;          // secondi
    this.playing = false;
    this.pxPerSec = 100;        // zoom timeline
    this.tool = 'select';       // select | ripple | roll | slip | slide
    this.snap = true;           // magnete
    this._subs = new Set();
  }
  on(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  emit(reason = '') { this._subs.forEach(fn => fn(reason)); }

  load(project) {
    this.project = project;
    this.selectedClip = null;
    this.playhead = 0;
    this.playing = false;
    // riallinea il generatore di id per evitare collisioni
    this.emit('load');
  }

  /* ---- lookup ---- */
  media(id) { return this.project.media.find(m => m.id === id) || null; }
  track(id) { return this.project.tracks.find(t => t.id === id) || null; }
  clip(trackId, clipId) {
    const t = this.track(trackId);
    return t ? t.clips.find(c => c.id === clipId) || null : null;
  }
  selected() {
    if (!this.selectedClip) return null;
    return this.clip(this.selectedClip.trackId, this.selectedClip.clipId);
  }

  /* ---- mutazioni ---- */
  addMedia(m) { this.project.media.push(m); this.emit('media'); }

  /* rimuove un media dal bin + tutte le clip che lo usano */
  removeMedia(id) {
    this.project.media = this.project.media.filter(m => m.id !== id);
    for (const t of this.project.tracks) t.clips = t.clips.filter(c => c.mediaId !== id);
    if (this.selectedClip && !this.clip(this.selectedClip.trackId, this.selectedClip.clipId)) this.selectedClip = null;
    this.emit('clips');
    this.emit('media');
  }

  addClip(trackId, clip) {
    const t = this.track(trackId);
    if (!t) return;
    t.clips.push(clip);
    t.clips.sort((a, b) => a.start - b.start);
    this.emit('clips');
  }
  removeSelected() {
    if (!this.selectedClip) return;
    const t = this.track(this.selectedClip.trackId);
    if (!t) return;
    t.clips = t.clips.filter(c => c.id !== this.selectedClip.clipId);
    this.selectedClip = null;
    this.emit('clips');
  }
  select(trackId, clipId) {
    this.selectedClip = trackId ? { trackId, clipId } : null;
    this.emit('select');
  }

  /* divide la clip selezionata (o quella sotto al playhead) al playhead */
  splitAtPlayhead() {
    const t0 = this.playhead;
    let done = false;
    for (const t of this.project.tracks) {
      for (const c of [...t.clips]) {
        const cEnd = c.start + clipDur(c);
        if (t0 > c.start + 0.02 && t0 < cEnd - 0.02) {
          const cutSrc = srcAt(c, t0 - c.start);
          const right = { ...c, id: uid('c'), fx: { ...c.fx }, kf: JSON.parse(JSON.stringify(c.kf || {})), ease: { ...(c.ease || {}) }, curves: JSON.parse(JSON.stringify(c.curves || {})), color: JSON.parse(JSON.stringify(c.color || {})), mask: c.mask ? JSON.parse(JSON.stringify(c.mask)) : null, secondary: c.secondary ? JSON.parse(JSON.stringify(c.secondary)) : null };
          right.start = t0; right.in = cutSrc;
          c.out = cutSrc;
          t.clips.push(right);
          done = true;
        }
      }
      t.clips.sort((a, b) => a.start - b.start);
    }
    if (done) this.emit('clips');
    return done;
  }

  duration() {
    let d = 0;
    for (const t of this.project.tracks)
      for (const c of t.clips)
        d = Math.max(d, c.start + clipDur(c));
    return d;
  }

  /* tracce video dal basso verso l'alto (ordine di compositing) */
  videoTracksBottomUp() {
    return this.project.tracks.filter(t => t.type === 'video').slice().reverse();
  }
  audioTracks() { return this.project.tracks.filter(t => t.type === 'audio'); }

  /* ---- vicini sulla stessa traccia (per roll/slide) ---- */
  prevClip(track, clip) {
    let best = null;
    for (const c of track.clips) if (c !== clip && c.start < clip.start && (!best || c.start > best.start)) best = c;
    return best;
  }
  nextClip(track, clip) {
    let best = null;
    for (const c of track.clips) if (c !== clip && c.start > clip.start && (!best || c.start < best.start)) best = c;
    return best;
  }

  /* ---- marcatori ---- */
  addMarkerAt(t, label = '') {
    if (!this.project.markers) this.project.markers = [];
    this.project.markers.push({ id: uid('mk'), t: Math.max(0, t), label });
    this.project.markers.sort((a, b) => a.t - b.t);
    this.emit('clips');
  }
  removeMarker(id) {
    if (!this.project.markers) return;
    this.project.markers = this.project.markers.filter(m => m.id !== id);
    this.emit('clips');
  }

  /* clip attiva su una traccia ad un certo tempo */
  clipAt(track, t) {
    for (const c of track.clips) {
      const end = c.start + clipDur(c);
      if (t >= c.start && t < end) return c;
    }
    return null;
  }

  /* tutte le clip attive a t (per rilevare le sovrapposizioni = transizioni) */
  clipsAt(track, t) {
    return track.clips
      .filter(c => t >= c.start && t < c.start + clipDur(c))
      .sort((a, b) => a.start - b.start);
  }

  /* transizione attiva su una traccia a t: due clip sovrapposte */
  transitionAt(track, t) {
    const act = this.clipsAt(track, t);
    if (act.length < 2) return null;
    const A = act[act.length - 2], B = act[act.length - 1];   // A uscente, B entrante
    const ovStart = B.start;
    const ovEnd = Math.min(A.start + clipDur(A), B.start + clipDur(B));
    if (t < ovStart || t > ovEnd || ovEnd <= ovStart) return null;
    const p = (t - ovStart) / (ovEnd - ovStart);
    return { A, B, p, ovStart, ovEnd, type: B.transType || 'dissolve' };
  }
}

export const store = new Store();

/* timecode HH:MM:SS:FF */
export function tc(sec, fps = 30) {
  sec = Math.max(0, sec || 0);
  const f = Math.floor((sec - Math.floor(sec)) * fps);
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}
