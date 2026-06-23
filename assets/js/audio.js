/* =====================================================================
   audio.js — grafo Web Audio: gain per traccia, master, scheduling,
   disegno waveform sulle clip.
   ===================================================================== */

class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
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
    this.trackGain(trackId).gain.value = muted ? 0 : 1;
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
      g.gain.value = clip.gain ?? 1;
      src.connect(g).connect(this.trackGain(trackId));

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

      // fade in/out
      if (clip.fadeIn > 0) {
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(clip.gain ?? 1, when + Math.min(clip.fadeIn, dur));
      }
      if (clip.fadeOut > 0) {
        const t = when + dur - Math.min(clip.fadeOut, dur);
        g.gain.setValueAtTime(clip.gain ?? 1, t);
        g.gain.linearRampToValueAtTime(0, when + dur);
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
