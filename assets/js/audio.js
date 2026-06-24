/* =====================================================================
   audio.js — grafo Web Audio: gain per traccia, pan, master, scheduling,
   keyframe di volume, ducking, VU meter, disegno waveform sulle clip.
   ===================================================================== */
import { evalGain } from './state.js';

class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;

    // --- VU meter stereo: tap analizzatore sul master ---
    this.splitter = this.ctx.createChannelSplitter(2);
    this.analyserL = this.ctx.createAnalyser(); this.analyserL.fftSize = 512;
    this.analyserR = this.ctx.createAnalyser(); this.analyserR.fftSize = 512;
    this.master.connect(this.splitter);
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
    this._vuL = new Float32Array(this.analyserL.fftSize);
    this._vuR = new Float32Array(this.analyserR.fftSize);
    this._smL = 0; this._smR = 0;   // livelli smussati

    this.master.connect(this.ctx.destination);
    this.trackGains = new Map();   // trackId -> GainNode
    this.active = [];              // sorgenti schedulate {src, gain}
  }

  resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }

  trackGain(trackId) {
    if (!this.trackGains.has(trackId)) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.trackGains.set(trackId, g);
    }
    return this.trackGains.get(trackId);
  }

  setTrackMuted(trackId, muted) {
    const g = this.trackGain(trackId).gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.value = muted ? 0 : 1;
  }

  /* livelli RMS L/R 0..1 (con leggero smussamento per il VU) */
  getLevels() {
    if (this.ctx.state !== 'running') { this._smL *= 0.8; this._smR *= 0.8; return { l: this._smL, r: this._smR }; }
    this.analyserL.getFloatTimeDomainData(this._vuL);
    this.analyserR.getFloatTimeDomainData(this._vuR);
    const rms = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.min(1, Math.sqrt(s / b.length) * 1.6); };
    const l = rms(this._vuL), r = rms(this._vuR);
    // attacco rapido, rilascio lento
    this._smL = l > this._smL ? l : this._smL * 0.82 + l * 0.18;
    this._smR = r > this._smR ? r : this._smR * 0.82 + r * 0.18;
    return { l: this._smL, r: this._smR };
  }

  /* ducking: abbassa il volume delle tracce duckTrackIds quando, tra triggerIntervals
     (in secondi sulla timeline), c'è audio su altre tracce. startSec = playhead. */
  applyDucking(duckTrackIds, triggerIntervals, startSec, totalDur, duckLevel = 0.28) {
    const now = this.ctx.currentTime;
    const span = (totalDur || 0) - startSec;
    if (span <= 0 || !duckTrackIds.length) return;
    const steps = Math.max(2, Math.ceil(span * 25));   // ~40ms di risoluzione
    for (const tid of duckTrackIds) {
      const g = this.trackGain(tid).gain;
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) {
        const t = startSec + (i / (steps - 1)) * span;
        const ducked = triggerIntervals.some(([s, e]) => t >= s - 0.04 && t <= e + 0.04);
        curve[i] = ducked ? duckLevel : 1;
      }
      try { g.cancelScheduledValues(now); g.setValueCurveAtTime(curve, now, span); } catch (_) {}
    }
  }

  stopAll() {
    for (const a of this.active) { try { a.src.stop(); } catch (_) {} }
    this.active = [];
  }

  /* Avvia la riproduzione di tutte le clip audio a partire da playheadSec.
     getBuffer(mediaId) -> AudioBuffer|null ; tracksMuteSolo: info mute/solo. */
  play(audioClips, getBuffer, startSec) {
    this.resume();
    this.stopAll();
    const now = this.ctx.currentTime;
    for (const { trackId, clip } of audioClips) {
      const buffer = getBuffer(clip.mediaId);
      if (!buffer) continue;
      const clipEnd = clip.start + (clip.out - clip.in);
      if (clipEnd <= startSec) continue;

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const g = this.ctx.createGain();
      const baseGain = clip.gain ?? 1;
      g.gain.value = baseGain;
      // pan stereo per clip (se supportato dal browser)
      let tail = g;
      if (this.ctx.createStereoPanner && (clip.pan ?? 0) !== 0) {
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = Math.max(-1, Math.min(1, clip.pan));
        g.connect(pan); tail = pan;
      }
      src.connect(g); tail.connect(this.trackGain(trackId));

      // offset nel buffer e tempo di avvio sulla timeline
      let when = now, offset = clip.in, dur;
      if (startSec <= clip.start) {
        when = now + (clip.start - startSec);
        offset = clip.in;
        dur = clip.out - clip.in;
      } else {
        when = now;
        offset = clip.in + (startSec - clip.start);
        dur = clip.out - (offset);
      }
      if (dur <= 0) continue;

      const hasGainKf = clip.kf && clip.kf.gain && clip.kf.gain.length;
      if (hasGainKf) {
        // envelope di volume da keyframe (con easing campionato)
        const firstLocal = Math.max(0, startSec - clip.start);
        const steps = Math.max(2, Math.ceil(dur * 30));
        const curve = new Float32Array(steps);
        for (let i = 0; i < steps; i++) {
          const lt = firstLocal + (i / (steps - 1)) * dur;
          curve[i] = Math.max(0, evalGain(clip, lt));
        }
        try { g.gain.setValueCurveAtTime(curve, when, dur); }
        catch (_) { g.gain.value = evalGain(clip, firstLocal); }
      } else {
        // fade in/out classici
        if (clip.fadeIn > 0) {
          g.gain.setValueAtTime(0, when);
          g.gain.linearRampToValueAtTime(baseGain, when + Math.min(clip.fadeIn, dur));
        }
        if (clip.fadeOut > 0) {
          const t = when + dur - Math.min(clip.fadeOut, dur);
          g.gain.setValueAtTime(baseGain, t);
          g.gain.linearRampToValueAtTime(0, when + dur);
        }
      }

      try { src.start(when, Math.max(0, offset), dur); } catch (_) { continue; }
      this.active.push({ src, gain: g });
    }
  }
}

export const audio = new AudioEngine();

/* ---------- waveform ---------- */
export function drawWaveform(canvas, audioBuffer, inSec, outSec, color = 'rgba(180,235,200,0.9)') {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!audioBuffer) return;
  const data = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const startSample = Math.floor(inSec * sr);
  const endSample = Math.min(data.length, Math.floor(outSec * sr));
  const span = Math.max(1, endSample - startSample);
  const step = Math.max(1, Math.floor(span / w));
  ctx.fillStyle = color;
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    let min = 1, max = -1;
    const s0 = startSample + x * step;
    for (let i = 0; i < step; i++) {
      const v = data[s0 + i] || 0;
      if (v < min) min = v; if (v > max) max = v;
    }
    const y1 = mid + min * mid;
    const y2 = mid + max * mid;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}
