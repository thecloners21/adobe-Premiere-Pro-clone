/* =====================================================================
   media.js — import file, decode metadati, thumbnail, media bin
   ===================================================================== */
import { store, uid } from './state.js';
import { audio } from './audio.js';
import { putBlob, deleteBlob } from './persist.js';
import { makeProxy } from './webcodecs.js';
import { getSettings } from './settings.js';

const binList = document.getElementById('binList');
const binCount = document.getElementById('binCount');

/* registro runtime: id media -> { element, objectURL, thumb, audioBuffer } */
export const runtime = new Map();

function kindOf(file) {
  if (file.type.startsWith('video')) return 'video';
  if (file.type.startsWith('audio')) return 'audio';
  if (file.type.startsWith('image')) return 'image';
  // fallback per estensione
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (['mp4', 'webm', 'mov', 'mkv', 'ogv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  return 'video';
}

export async function importFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    try { await importOne(file); }
    catch (e) { console.error('import fallito', file.name, e); }
  }
  renderBin();
}

function importOne(file) {
  return new Promise((resolve, reject) => {
    const kind = kindOf(file);
    const url = URL.createObjectURL(file);
    const media = {
      id: uid('m'), name: file.name, kind, src: url,
      duration: 0, width: 0, height: 0, hasAudio: kind !== 'image', _file: file,
    };

    const finish = (rt) => {
      runtime.set(media.id, rt);
      store.addMedia(media);
      putBlob(media.id, file).catch(() => {});   // persistenza per il refresh
      resolve(media);
    };

    if (kind === 'image') {
      const img = new Image();
      img.onload = () => {
        media.width = img.naturalWidth; media.height = img.naturalHeight;
        media.duration = 5; // durata default immagine
        finish({ element: img, objectURL: url, thumb: url });
      };
      img.onerror = reject;
      img.src = url;
      return;
    }

    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'auto'; el.muted = true; el.src = url; el.crossOrigin = 'anonymous';
    el.addEventListener('loadedmetadata', async () => {
      media.duration = isFinite(el.duration) ? el.duration : 0;
      media.width = el.videoWidth || 0; media.height = el.videoHeight || 0;
      let thumb = null;
      if (kind === 'video') { try { thumb = await grabThumb(el); } catch (_) {} }
      // decodifica audio per waveform/mix (best-effort)
      decodeAudio(media).catch(() => {});
      finish({ element: el, objectURL: url, thumb });
    }, { once: true });
    el.addEventListener('error', () => reject(new Error('decode fallito: ' + file.name)), { once: true });
  });
}

function grabThumb(video) {
  return new Promise((resolve, reject) => {
    const seekTo = Math.min(1, (video.duration || 2) / 3);
    const onSeek = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 104; c.height = 64;
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.6));
      } catch (e) { reject(e); }
      video.removeEventListener('seeked', onSeek);
      video.currentTime = 0;
    };
    video.addEventListener('seeked', onSeek);
    video.currentTime = seekTo;
  });
}

async function decodeAudio(media) {
  if (!media.hasAudio || !media._file) return;
  const buf = await media._file.arrayBuffer();
  const ctx = audio.ctx;
  const audioBuffer = await ctx.decodeAudioData(buf.slice(0));
  const rt = runtime.get(media.id) || {};
  rt.audioBuffer = audioBuffer;
  runtime.set(media.id, rt);
  store.emit('audio-decoded');
}

/* ---------- reidratazione dopo il refresh ----------
   Ricostruisce l'elemento runtime di un media già presente nel progetto,
   a partire dal File recuperato da IndexedDB. */
export function rehydrateFromBlob(media, file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    media.src = url; media._file = file;
    media.useProxy = false;   // il proxy è solo runtime: va rigenerato dopo il refresh
    if (media.kind === 'image') {
      const img = new Image();
      img.onload = () => { runtime.set(media.id, { element: img, objectURL: url, thumb: url }); resolve(); };
      img.onerror = () => resolve();
      img.src = url;
      return;
    }
    const el = document.createElement(media.kind === 'audio' ? 'audio' : 'video');
    el.preload = 'auto'; el.muted = true; el.src = url; el.crossOrigin = 'anonymous';
    el.addEventListener('loadedmetadata', async () => {
      let thumb = null;
      if (media.kind === 'video') { try { thumb = await grabThumb(el); } catch (_) {} }
      decodeAudio(media).catch(() => {});
      runtime.set(media.id, { element: el, objectURL: url, thumb });
      resolve();
    }, { once: true });
    el.addEventListener('error', () => resolve(), { once: true });
  });
}

/* ricostruisce il canvas runtime di un titolo dopo il refresh */
export function rehydrateTitle(media) {
  const canvas = document.createElement('canvas');
  renderTitleCanvas(canvas, media.title || defaultTitle(), media.width || 1280, media.height || 720);
  runtime.set(media.id, { element: canvas, thumb: canvas.toDataURL('image/jpeg', 0.5) });
}

/* ---------- titoli / testo ---------- */
export function defaultTitle() {
  return { text: 'Titolo', fontSize: 80, color: '#ffffff', bg: 'transparent',
           align: 'center', valign: 'middle', font: 'Segoe UI', bold: true, shadow: true };
}

export function renderTitleCanvas(canvas, ti, W = 1280, H = 720) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (ti.bg && ti.bg !== 'transparent') { ctx.fillStyle = ti.bg; ctx.fillRect(0, 0, W, H); }
  ctx.fillStyle = ti.color || '#fff';
  ctx.textAlign = ti.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${ti.bold ? '700' : '400'} ${ti.fontSize || 80}px ${ti.font || 'Segoe UI'}, sans-serif`;
  if (ti.shadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3; }
  const x = ti.align === 'left' ? W * 0.08 : ti.align === 'right' ? W * 0.92 : W / 2;
  let y = ti.valign === 'top' ? H * 0.15 : ti.valign === 'bottom' ? H * 0.85 : H / 2;
  const lines = String(ti.text || '').split('\n');
  const lh = (ti.fontSize || 80) * 1.2;
  y -= (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
}

export function createTitle(project) {
  const ti = defaultTitle();
  const media = { id: uid('m'), name: 'Titolo', kind: 'title', src: '', duration: 5,
                  width: project.width, height: project.height, hasAudio: false, title: ti };
  const canvas = document.createElement('canvas');
  renderTitleCanvas(canvas, ti, project.width, project.height);
  runtime.set(media.id, { element: canvas, thumb: canvas.toDataURL('image/jpeg', 0.5) });
  store.addMedia(media);
  renderBin();
  return media;
}

export function updateTitle(media) {
  const rt = runtime.get(media.id);
  if (!rt || !rt.element) return;
  renderTitleCanvas(rt.element, media.title, media.width, media.height);
  rt.thumb = rt.element.toDataURL('image/jpeg', 0.5);
  store.emit('clips');
}

/* rimuove completamente un media: clip, runtime, objectURL, proxy, blob persistito */
export function removeMediaFully(id) {
  const rt = runtime.get(id);
  if (rt && rt.objectURL) { try { URL.revokeObjectURL(rt.objectURL); } catch (_) {} }
  if (rt && rt.proxyURL) { try { URL.revokeObjectURL(rt.proxyURL); } catch (_) {} }
  runtime.delete(id);
  deleteBlob(id).catch(() => {});
  store.removeMedia(id);
}

/* crea (o attiva/disattiva) un proxy a bassa risoluzione per la clip video */
async function toggleProxy(m, btn) {
  const rt = runtime.get(m.id) || {};
  if (rt.proxyEl) {                       // già esistente: commuta
    m.useProxy = !m.useProxy;
    btn.classList.toggle('on', m.useProxy);
    store.emit('clips');
    window.__toast && window.__toast('Proxy ' + (m.useProxy ? 'attivo' : 'disattivo'), 'ok');
    return;
  }
  if (m.kind !== 'video' || !rt.element) return;
  btn.disabled = true; const old = btn.textContent;
  const targetW = getSettings().proxyWidth || 640;
  const blob = await makeProxy(rt.element, { targetW, onProgress: p => { btn.textContent = Math.round(p * 100) + '%'; } });
  btn.disabled = false; btn.textContent = old;
  if (!blob) return window.__toast && window.__toast('Proxy non riuscito', 'err');
  const url = URL.createObjectURL(blob);
  const pv = document.createElement('video');
  pv.src = url; pv.muted = true; pv.preload = 'auto'; pv.crossOrigin = 'anonymous';
  rt.proxyEl = pv; rt.proxyURL = url; runtime.set(m.id, rt);
  m.useProxy = true; btn.classList.add('on');
  store.emit('clips');
  window.__toast && window.__toast('Proxy creato (editing più fluido)', 'ok');
}

/* ---------- render del media bin ---------- */
export function renderBin() {
  const media = store.project.media;
  binCount.textContent = media.length;
  if (!media.length) {
    binList.innerHTML = '<div class="empty">Trascina qui i file<br>o premi <b>Importa media</b></div>';
    return;
  }
  binList.innerHTML = '';
  for (const m of media) {
    const rt = runtime.get(m.id) || {};
    const item = document.createElement('div');
    item.className = 'bin-item';
    item.draggable = true;
    item.dataset.mediaId = m.id;
    const thumbStyle = rt.thumb ? `style="background-image:url('${rt.thumb}')"` : '';
    const dur = m.duration ? secsToClock(m.duration) : '—';
    item.innerHTML = `
      <div class="bin-thumb ${m.kind === 'audio' ? 'audio' : ''}" ${thumbStyle}>
        ${m.kind === 'audio' ? '♪' : (rt.thumb ? '' : m.kind.toUpperCase().slice(0, 3))}
      </div>
      <div class="bin-meta">
        <div class="bin-name" title="${escapeAttr(m.name)}">${escapeHtml(m.name)}</div>
        <div class="bin-sub">${m.kind} · ${dur}${m.useProxy ? ' · <span class="proxy-tag">proxy</span>' : ''}</div>
      </div>
      ${m.kind === 'video' ? `<button class="bin-proxy${m.useProxy ? ' on' : ''}" title="Crea/usa un proxy a bassa risoluzione per un editing più fluido">PX</button>` : ''}
      <button class="bin-del" title="Rimuovi dal progetto">✕</button>`;
    item.addEventListener('dragstart', (e) => {
      item.classList.add('dragging');
      e.dataTransfer.setData('text/media-id', m.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.querySelector('.bin-del').addEventListener('click', (e) => {
      e.stopPropagation();
      const used = store.project.tracks.some(t => t.clips.some(c => c.mediaId === m.id));
      if (used && !confirm(`Rimuovere "${m.name}"? Verranno eliminate anche le clip che lo usano.`)) return;
      removeMediaFully(m.id);
      window.__toast && window.__toast('Media rimosso', 'ok');
    });
    const pxBtn = item.querySelector('.bin-proxy');
    if (pxBtn) pxBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleProxy(m, pxBtn); });
    binList.appendChild(item);
  }
}

function secsToClock(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
