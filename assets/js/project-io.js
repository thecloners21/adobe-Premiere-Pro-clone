/* =====================================================================
   project-io.js — salva/apri su server + import/export file .cpproj
   ===================================================================== */
import { store } from './state.js';
import { renderBin, runtime } from './media.js';
import * as api from './api-client.js';

/* I blob URL non sono serializzabili: salviamo solo i metadati media +
   eventuale serverSrc (caricato su server). */
export function serializable(project) {
  const p = JSON.parse(JSON.stringify(project, (k, v) => (k === '_file' ? undefined : v)));
  // sostituisci src blob con serverSrc se presente
  for (const m of p.media) {
    if (m.serverSrc) m.src = m.serverSrc;
    else if (String(m.src).startsWith('blob:')) m.src = '';
  }
  return p;
}

/* ---------- salva/apri su server ---------- */
export async function serverSave(toast) {
  try {
    const res = await api.saveProject(serializable(store.project));
    if (res.ok) { store.project.id = res.id; toast('Progetto salvato sul server', 'ok'); }
    else toast('Salvataggio rifiutato dal server', 'err');
  } catch (e) {
    toast('Server non disponibile — usa "Esporta progetto" per il file locale', 'err');
  }
}

export async function serverOpen(toast) {
  let list;
  try { const r = await api.listProjects(); list = r.projects || []; }
  catch (_) { return toast('Server non disponibile per "Apri"', 'err'); }
  if (!list.length) return toast('Nessun progetto salvato sul server');
  showChooser(list, async (id) => {
    try {
      const r = await api.loadProject(id);
      if (r.ok && r.project) { adoptProject(r.project); toast('Progetto caricato', 'ok'); }
    } catch (_) { toast('Caricamento fallito', 'err'); }
  });
}

/* ---------- file .cpproj ---------- */
export function exportProjectFile() {
  const data = JSON.stringify(serializable(store.project), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (store.project.name || 'progetto').replace(/[^\w\-]+/g, '_') + '.cpproj';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importProjectFile(file, toast) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const project = JSON.parse(reader.result);
      if (!project.tracks) throw new Error('formato non valido');
      adoptProject(project);
      const missing = project.media.filter(m => !m.src || String(m.src).startsWith('blob:')).length;
      toast(missing ? `Progetto importato — ${missing} media da ricollegare (re-importa i file)` : 'Progetto importato', missing ? 'warn' : 'ok');
    } catch (e) { toast('File progetto non valido', 'err'); }
  };
  reader.readAsText(file);
}

/* ---------- helper ---------- */
function adoptProject(project) {
  // ricollega i media con src http (serverSrc) creando gli elementi runtime
  store.load(project);
  for (const m of project.media) {
    if (m.src && !String(m.src).startsWith('blob:')) {
      if (m.kind === 'image') {
        const img = new Image(); img.src = m.src; runtime.set(m.id, { element: img, thumb: m.src });
      } else {
        const el = document.createElement(m.kind === 'audio' ? 'audio' : 'video');
        el.src = m.src; el.muted = true; el.crossOrigin = 'anonymous'; el.preload = 'auto';
        runtime.set(m.id, { element: el });
      }
    }
  }
  document.getElementById('projName').textContent = project.name || 'Progetto';
  renderBin();
  store.emit('load');
}

/* upload best-effort dei media sul server (per export server-side) */
export async function uploadAllMedia() {
  for (const m of store.project.media) {
    if (m.serverSrc || !m._file) continue;
    try {
      const r = await api.uploadMedia(m._file);
      if (r.ok) m.serverSrc = r.path;
    } catch (_) { /* hosting senza upload: si userà wasm */ }
  }
}

/* mini chooser overlay per "Apri" */
function showChooser(list, onPick) {
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML = `<div class="modal-card"><h3>Apri progetto</h3>
    <div id="chooserList" style="max-height:300px;overflow:auto;display:flex;flex-direction:column;gap:6px"></div>
    <div class="modal-actions"><button data-x="c">Chiudi</button></div></div>`;
  const cl = ov.querySelector('#chooserList');
  list.forEach(p => {
    const b = document.createElement('button');
    b.className = 'bin-item';
    b.style.textAlign = 'left';
    b.innerHTML = `<div class="bin-meta"><div class="bin-name">${esc(p.name)}</div><div class="bin-sub">${esc(p.updated || '')}</div></div>`;
    b.onclick = () => { document.body.removeChild(ov); onPick(p.id); };
    cl.appendChild(b);
  });
  ov.querySelector('[data-x="c"]').onclick = () => document.body.removeChild(ov);
  document.body.appendChild(ov);
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
