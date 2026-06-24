/* =====================================================================
   webcodecs.js — precisione fotogramma e proxy.
   • seek frame-accurate via requestVideoFrameCallback (+ WebCodecs VideoFrame
     quando disponibile) così il fotogramma mostrato corrisponde esattamente al
     timecode;
   • generazione di un proxy a bassa risoluzione per un editing più fluido.
   ===================================================================== */

export function hasWebCodecs() {
  return typeof window.VideoFrame === 'function' && typeof window.VideoEncoder === 'function';
}
export function hasRVFC() {
  return typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
}

/* etichetta capacità per il badge */
export function precisionLabel() {
  if (hasRVFC() && hasWebCodecs()) return 'frame-accurate (WebCodecs)';
  if (hasRVFC()) return 'frame-accurate (rVFC)';
  return 'seek standard';
}

/* Imposta il tempo e risolve quando il fotogramma è effettivamente presentato.
   Usa requestVideoFrameCallback se disponibile (preciso al fotogramma),
   altrimenti l'evento 'seeked'. Timeout di sicurezza per non bloccarsi. */
export function seekExact(video, t, timeoutMs = 220) {
  return new Promise((resolve) => {
    if (!video || video.tagName !== 'VIDEO') return resolve(false);
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(tm); resolve(ok); };
    const tm = setTimeout(() => finish(false), timeoutMs);
    try { video.currentTime = Math.max(0, t); }
    catch (_) { return finish(false); }
    if (hasRVFC()) {
      try { video.requestVideoFrameCallback(() => finish(true)); }
      catch (_) { video.addEventListener('seeked', () => finish(true), { once: true }); }
    } else {
      video.addEventListener('seeked', () => finish(true), { once: true });
    }
  });
}

/* Cattura il fotogramma corrente come VideoFrame WebCodecs (se supportato);
   il chiamante DEVE chiamare frame.close(). Ritorna null se non disponibile. */
export function grabFrame(video) {
  if (!hasWebCodecs() || !video) return null;
  try { return new window.VideoFrame(video); } catch (_) { return null; }
}

/* Genera un proxy a `targetW` px di larghezza ricodificando in WebM mentre la
   sorgente scorre una volta (real-time). Ritorna un Blob, o null in caso d'errore.
   onProgress(0..1) per la UI. */
export function makeProxy(srcVideo, { targetW = 640, fps = 25, onProgress } = {}) {
  return new Promise((resolve) => {
    try {
      if (!srcVideo || !srcVideo.videoWidth) return resolve(null);
      if (typeof MediaRecorder === 'undefined') return resolve(null);
      const ratio = srcVideo.videoHeight / srcVideo.videoWidth;
      const w = Math.min(targetW, srcVideo.videoWidth);
      const h = Math.round(w * ratio / 2) * 2;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(fps);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_200_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: mime }) : null);

      const dur = isFinite(srcVideo.duration) ? srcVideo.duration : 0;
      const wasMuted = srcVideo.muted, wasTime = srcVideo.currentTime;
      srcVideo.muted = true;
      let raf = 0;
      const tick = () => {
        try { ctx.drawImage(srcVideo, 0, 0, w, h); } catch (_) {}
        if (onProgress && dur) onProgress(Math.min(1, srcVideo.currentTime / dur));
        if (srcVideo.ended || (dur && srcVideo.currentTime >= dur - 0.05)) {
          cancelAnimationFrame(raf);
          try { rec.stop(); } catch (_) {}
          try { srcVideo.pause(); srcVideo.currentTime = wasTime; srcVideo.muted = wasMuted; } catch (_) {}
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      const start = () => { rec.start(200); srcVideo.play().then(() => { raf = requestAnimationFrame(tick); }).catch(() => resolve(null)); };
      srcVideo.currentTime = 0;
      if (srcVideo.readyState >= 2) start();
      else srcVideo.addEventListener('seeked', start, { once: true });
    } catch (_) { resolve(null); }
  });
}
