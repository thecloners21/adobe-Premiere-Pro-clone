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
export const TITLE_FONTS = [
  'Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Courier New',
  'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Palatino Linotype',
];

/* preset di stile (come gli "stili titolo" di Premiere) */
export const TITLE_STYLES = [
  { name: 'Bianco semplice', s: { color: '#ffffff', bold: true, shadow: true, stroke: { color: '#000000', width: 0 }, bg: 'transparent', band: false, font: 'Segoe UI' } },
  { name: 'Contorno nero',   s: { color: '#ffffff', bold: true, shadow: false, stroke: { color: '#000000', width: 6 }, bg: 'transparent', band: false, font: 'Arial' } },
  { name: 'Giallo cinema',   s: { color: '#ffe14d', bold: true, shadow: true, stroke: { color: '#3a2a00', width: 3 }, bg: 'transparent', band: false, font: 'Georgia' } },
  { name: 'Lower third',     s: { color: '#ffffff', bold: true, shadow: false, stroke: { color: '#000000', width: 0 }, bg: '#000000', band: true, bgOpacity: 0.55, align: 'left', valign: 'bottom', font: 'Segoe UI' } },
  { name: 'Impatto rosso',   s: { color: '#ffffff', bold: true, shadow: true, stroke: { color: '#8a0000', width: 5 }, bg: 'transparent', band: false, font: 'Impact' } },
  { name: 'Elegante serif',  s: { color: '#f4f1e8', bold: false, shadow: true, stroke: { color: '#000000', width: 0 }, bg: 'transparent', band: false, font: 'Palatino Linotype' } },
];

/* animazioni preset (renderizzate in anteprima e nell'export browser) */
export const TITLE_ANIMS = [
  { key: 'none',       label: 'Nessuna' },
  { key: 'fadeIn',     label: 'Dissolvenza in entrata' },
  { key: 'fadeInOut',  label: 'Dissolvenza in/out' },
  { key: 'slideUp',    label: 'Scorri dal basso' },
  { key: 'slideLeft',  label: 'Scorri da destra' },
  { key: 'zoomIn',     label: 'Zoom in' },
  { key: 'typewriter', label: 'Macchina da scrivere' },
];

export function defaultTitle() {
  return {
    text: 'Titolo', fontSize: 80, color: '#ffffff', bg: 'transparent', bgOpacity: 0.55, band: false,
    align: 'center', valign: 'middle', font: 'Segoe UI', bold: true, italic: false, shadow: true,
    stroke: { color: '#000000', width: 0 },
    anim: { type: 'none', dur: 1 },
  };
}

/* progress 0..1 per il typewriter; null = testo completo (statico) */
export function renderTitleCanvas(canvas, ti, W = 1280, H = 720, typeProgress = null) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const fontSize = ti.fontSize || 80;
  const weight = ti.bold ? '700' : '400';
  const style = ti.italic ? 'italic ' : '';
  ctx.font = `${style}${weight} ${fontSize}px "${ti.font || 'Segoe UI'}", sans-serif`;
  ctx.textAlign = ti.align || 'center';
  ctx.textBaseline = 'middle';

  let lines = String(ti.text || '').split('\n');
  if (typeProgress != null) {
    const full = lines.join('\n');
    const n = Math.round(full.length * Math.max(0, Math.min(1, typeProgress)));
    lines = full.slice(0, n).split('\n');
  }
  const lh = fontSize * 1.2;
  const x = ti.align === 'left' ? W * 0.08 : ti.align === 'right' ? W * 0.92 : W / 2;
  let y = ti.valign === 'top' ? H * 0.15 : ti.valign === 'bottom' ? H * 0.85 : H / 2;
  y -= (lines.length - 1) * lh / 2;

  // banda / sfondo
  if (ti.band && ti.bg && ti.bg !== 'transparent') {
    const pad = fontSize * 0.45;
    const bandH = lines.length * lh + pad * 2;
    ctx.save();
    ctx.globalAlpha = ti.bgOpacity ?? 0.55;
    ctx.fillStyle = ti.bg;
    ctx.fillRect(0, y - lh / 2 - pad, W, bandH);
    ctx.restore();
  } else if (!ti.band && ti.bg && ti.bg !== 'transparent') {
    ctx.save(); ctx.globalAlpha = ti.bgOpacity ?? 1; ctx.fillStyle = ti.bg; ctx.fillRect(0, 0, W, H); ctx.restore();
  }

  const st = ti.stroke || { width: 0 };
  lines.forEach((ln, i) => {
    const ly = y + i * lh;
    if (ti.shadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3; }
    else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
    if (st.width > 0) {
      ctx.linejoin = 'round'; ctx.lineWidth = st.width; ctx.strokeStyle = st.color || '#000';
      ctx.strokeText(ln, x, ly);
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; // niente ombra sul fill se già sul contorno
    if (ti.shadow && st.width <= 0) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3; }
    ctx.fillStyle = ti.color || '#fff';
    ctx.fillText(ln, x, ly);
  });
}

/* parametri d'animazione del titolo a progress p (0..1 sulla durata clip) */
export function titleAnimOpts(ti, localT, clipLen) {
  const a = ti.anim || { type: 'none' };
  if (!a.type || a.type === 'none') return null;
  const dur = Math.min(a.dur || 1, clipLen || 1);
  const tIn = Math.max(0, Math.min(1, localT / dur));
  const tOut = Math.max(0, Math.min(1, (clipLen - localT) / dur));
  switch (a.type) {
    case 'fadeIn':     return { alpha: tIn };
    case 'fadeInOut':  return { alpha: Math.min(tIn, tOut) };
    case 'slideUp':    return { slide: [0, (1 - tIn) * 0.5], alpha: tIn };
    case 'slideLeft':  return { slide: [(1 - tIn) * 0.6, 0], alpha: tIn };
    case 'zoomIn':     return { scale: 0.7 + 0.3 * tIn, alpha: tIn };
    case 'typewriter': return { typeProgress: tIn };
    default:           return null;
  }
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
