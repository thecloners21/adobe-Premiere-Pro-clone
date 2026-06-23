/* =====================================================================
   export.js — render del video finale
     • server: ffmpeg (qualità piena) via export.php
     • browser: MediaRecorder su canvas+audio (offline, nessuna dipendenza)
   ===================================================================== */
import { store } from './state.js';
import { audio } from './audio.js';
import * as api from './api-client.js';
import { play, pause, seek } from './preview.js';
import { uploadAllMedia } from './project-io.js';

const canvas = document.getElementById('preview');

export async function runExport(opts, ui) {
  // opts: { res:'1280x720', fmt:'mp4'|'webm', engine:'auto'|'server'|'wasm' }
  const wantServer = opts.engine === 'server' || opts.engine === 'auto';
  if (wantServer) {
    ui.progress(5, 'Verifico il server…');
    const eng = await api.checkEngine();
    if (eng.server && eng.ffmpeg) {
      try { return await serverRender(opts, ui); }
      catch (e) {
        if (opts.engine === 'server') throw e;
        ui.log('Server fallito, passo al browser…');
      }
    } else if (opts.engine === 'server') {
      throw new Error('Server ffmpeg non disponibile su questo hosting');
    }
  }
  return await browserRender(opts, ui);
}

/* ---------------- server (ffmpeg) ---------------- */
async function serverRender(opts, ui) {
  ui.progress(15, 'Carico i media sul server…');
  await uploadAllMedia();
  const haveAll = store.project.media.every(m => m.serverSrc || m.kind === 'image');
  if (!haveAll) throw new Error('Upload media incompleto');
  ui.progress(40, 'ffmpeg sta renderizzando…');
  const r = await api.serverExport(store.project, opts);
  if (!r.ok) throw new Error(r.error || 'render server fallito');
  ui.progress(100, 'Completato');
  return { url: r.url, kind: 'server' };
}

/* ---------------- browser (MediaRecorder) ---------------- */
function browserRender(opts, ui) {
  return new Promise((resolve, reject) => {
    const dur = store.duration();
    if (dur <= 0) return reject(new Error('Timeline vuota'));

    const fps = store.project.fps;
    const mime = pickMime(opts.fmt);
    if (!mime) return reject(new Error('MediaRecorder non supportato dal browser'));

    ui.progress(8, 'Preparo la registrazione (tempo reale)…');

    // stream video dal canvas WebGL + stream audio dal master
    const vStream = canvas.captureStream(fps);
    const aDest = audio.ctx.createMediaStreamDestination();
    audio.master.connect(aDest);
    const stream = new MediaStream([
      ...vStream.getVideoTracks(),
      ...aDest.stream.getAudioTracks(),
    ]);

    const chunks = [];
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 }); }
    catch (e) { return reject(e); }
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onerror = e => reject(e.error || new Error('errore registrazione'));
    rec.onstop = () => {
      try { audio.master.disconnect(aDest); } catch (_) {}
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      ui.progress(100, 'Completato');
      resolve({ url, kind: 'browser', filename: safeName() + '.' + (mime.includes('mp4') ? 'mp4' : 'webm') });
    };

    // avvia dall'inizio e registra in tempo reale
    seek(0);
    setTimeout(() => {
      rec.start(200);
      play();
      const t0 = performance.now();
      const tick = setInterval(() => {
        const pct = Math.min(99, 8 + (store.playhead / dur) * 90);
        ui.progress(pct, `Registrazione ${Math.round(store.playhead)}s / ${Math.round(dur)}s`);
        if (!store.playing || store.playhead >= dur - 0.05) {
          clearInterval(tick);
          pause();
          setTimeout(() => { try { rec.stop(); } catch (_) {} }, 300);
        }
        // guardia anti-blocco
        if (performance.now() - t0 > (dur + 5) * 1000 + 8000) { clearInterval(tick); try { rec.stop(); } catch (_) {} }
      }, 200);
    }, 250);
  });
}

function pickMime(fmt) {
  const cands = fmt === 'mp4'
    ? ['video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return cands.find(c => window.MediaRecorder && MediaRecorder.isTypeSupported(c)) || null;
}
function safeName() { return (store.project.name || 'export').replace(/[^\w\-]+/g, '_'); }
