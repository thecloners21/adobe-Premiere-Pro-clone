/* =====================================================================
   main.js — bootstrap e wiring di tutta l'interfaccia
   ===================================================================== */
import { store, newProject } from './state.js';
import { importFiles, renderBin, createTitle } from './media.js';
import { renderTimeline } from './timeline.js';
import { renderInspector, syncInspectorValues } from './inspector.js';
import { startLoop, play, pause, toggle, seek, stepFrame, gotoStart, gotoEnd } from './preview.js';
import * as io from './project-io.js';
import * as ix from './interchange.js';
import { runExport } from './export.js';
import * as api from './api-client.js';
import { audio } from './audio.js';
import { renderLibraries, initLibraryTabs } from './library.js';

/* ---------- toast ---------- */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, kind = '') {
  toastEl.textContent = msg;
  toastEl.className = 'toast ' + kind;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.hidden = true, 3200);
}
window.__toast = toast;

/* ---------- render reattivo ---------- */
store.on((reason) => {
  if (['clips', 'media', 'load', 'select', 'seek'].includes(reason)) renderTimeline();
  if (['select', 'inspector', 'clips', 'load'].includes(reason)) renderInspector();
  if (['media', 'load'].includes(reason)) renderBin();
  if (reason === 'seek') syncInspectorValues();
});

/* ---------- tema ---------- */
const themeToggle = document.getElementById('themeToggle');
(function initTheme() {
  const saved = localStorage.getItem('cp-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  themeToggle.textContent = saved === 'dark' ? '🌙' : '☀️';
})();
themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  themeToggle.textContent = next === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('cp-theme', next);
});

/* ---------- nome progetto ---------- */
const projName = document.getElementById('projName');
projName.addEventListener('blur', () => { store.project.name = projName.textContent.trim() || 'Progetto senza titolo'; });
projName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); projName.blur(); } });

/* ---------- menu superiore ---------- */
const fileInput = document.getElementById('fileInput');
const projInput = document.getElementById('projInput');

document.querySelector('.menu').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  switch (act) {
    case 'new':
      if (store.project.media.length && !confirm('Creare un nuovo progetto? Le modifiche non salvate andranno perse.')) return;
      store.load(newProject()); projName.textContent = store.project.name; toast('Nuovo progetto'); break;
    case 'import': fileInput.click(); break;
    case 'title': createTitle(store.project); toast('Titolo creato — trascinalo in timeline', 'ok'); break;
    case 'save': io.serverSave(toast); break;
    case 'open': io.serverOpen(toast); break;
    case 'projExport': projectExportChooser(); break;
    case 'projImport': projInput.click(); break;
    case 'export': openExportModal(); break;
  }
});

fileInput.addEventListener('change', async () => {
  if (!fileInput.files.length) return;
  toast('Importazione…');
  await importFiles(fileInput.files);
  toast(`${fileInput.files.length} media importati`, 'ok');
  fileInput.value = '';
  io.uploadAllMedia().catch(() => {}); // upload best-effort in background
});

projInput.addEventListener('change', () => {
  const f = projInput.files[0]; if (!f) return;
  const name = f.name.toLowerCase();
  if (name.endsWith('.fcpxml') || name.endsWith('.xml')) {
    const r = new FileReader();
    r.onload = () => { try { const p = ix.fromFCPXML(r.result); store.load(p); projName.textContent = p.name; renderBin(); toast('FCPXML importato', 'ok'); } catch (err) { toast('FCPXML non valido', 'err'); } };
    r.readAsText(f);
  } else {
    io.importProjectFile(f, toast);
    setTimeout(() => projName.textContent = store.project.name, 200);
  }
  projInput.value = '';
});

/* drag&drop file dal sistema sul media bin */
const binList = document.getElementById('binList');
['dragover', 'dragenter'].forEach(ev => binList.addEventListener(ev, e => { e.preventDefault(); }));
binList.addEventListener('drop', async (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  await importFiles(e.dataTransfer.files);
  toast('Media importati', 'ok');
  io.uploadAllMedia().catch(() => {});
});

/* ---------- export progetto (scelta formato) ---------- */
function projectExportChooser() {
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML = `<div class="modal-card"><h3>Esporta progetto</h3>
    <p class="muted" style="margin-bottom:14px">Scegli il formato di interscambio.</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="primary" data-f="cpproj">Nativo .cpproj (completo)</button>
      <button data-f="fcpxml">FCPXML (Premiere / Final Cut)</button>
      <button data-f="edl">EDL CMX 3600</button>
    </div>
    <div class="modal-actions"><button data-f="x">Annulla</button></div></div>`;
  ov.addEventListener('click', (e) => {
    const f = e.target.dataset.f; if (!f) return;
    if (f === 'cpproj') io.exportProjectFile();
    else if (f === 'fcpxml') ix.download(ix.toFCPXML(), nameFor('fcpxml'), 'application/xml');
    else if (f === 'edl') ix.download(ix.toEDL(), nameFor('edl'), 'text/plain');
    if (f !== 'x' && f !== undefined) toast('Esportato', 'ok');
    document.body.removeChild(ov);
  });
  document.body.appendChild(ov);
}
function nameFor(ext) { return (store.project.name || 'progetto').replace(/[^\w\-]+/g, '_') + '.' + ext; }

/* ---------- transport ---------- */
document.querySelector('.transport').addEventListener('click', (e) => {
  const tp = e.target.closest('button')?.dataset.tp; if (!tp) return;
  switch (tp) {
    case 'start': gotoStart(); break;
    case 'end': gotoEnd(); break;
    case 'play': toggle(); break;
    case 'back': stepFrame(-1); break;
    case 'fwd': stepFrame(1); break;
    case 'split': store.splitAtPlayhead() ? toast('Clip divisa') : toast('Nessuna clip sotto il playhead'); break;
    case 'del': store.selected() ? (store.removeSelected(), toast('Clip eliminata')) : toast('Nessuna clip selezionata'); break;
  }
});

/* ---------- tastiera ---------- */
window.addEventListener('keydown', (e) => {
  if (e.target.isContentEditable || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  switch (e.key) {
    case ' ': e.preventDefault(); toggle(); break;
    case 's': case 'S': store.splitAtPlayhead(); break;
    case 'Delete': case 'Backspace': if (store.selected()) store.removeSelected(); break;
    case 'ArrowLeft': stepFrame(-1); break;
    case 'ArrowRight': stepFrame(1); break;
    case 'Home': gotoStart(); break;
    case 'End': gotoEnd(); break;
  }
});

/* ---------- zoom ---------- */
const zoom = document.getElementById('zoom');
zoom.addEventListener('input', () => { store.pxPerSec = parseInt(zoom.value); renderTimeline(); });

/* ---------- export modal ---------- */
const exportModal = document.getElementById('exportModal');
const expProgress = document.getElementById('expProgress');
function openExportModal() {
  if (store.duration() <= 0) return toast('Timeline vuota: aggiungi delle clip', 'err');
  exportModal.hidden = false;
  expProgress.hidden = true;
  expProgress.querySelector('.bar').style.width = '0%';
}
exportModal.addEventListener('click', async (e) => {
  const act = e.target.dataset.modal; if (!act) return;
  if (act === 'cancel') { exportModal.hidden = true; return; }
  if (act === 'go') {
    if (store.duration() <= 0) { toast('Timeline vuota: aggiungi delle clip', 'err'); return; }
    audio.resume(); // sblocca l'AudioContext nel contesto del gesto utente
    const goBtn = e.target;
    goBtn.disabled = true;
    const opts = {
      res: document.getElementById('expRes').value,
      fmt: document.getElementById('expFmt').value,
      engine: document.getElementById('expEngine').value,
    };
    expProgress.hidden = false;
    const ui = {
      progress(pct, label) {
        expProgress.querySelector('.bar').style.width = pct + '%';
        expProgress.querySelector('.lbl').textContent = (label || '') + ' ' + Math.round(pct) + '%';
      },
      log(m) { console.log('[export]', m); },
    };
    try {
      const res = await runExport(opts, ui);
      exportModal.hidden = true;
      deliver(res);
      toast('Export completato', 'ok');
    } catch (err) {
      ui.progress(0, 'Errore');
      toast('Export fallito: ' + err.message, 'err');
    } finally {
      goBtn.disabled = false;
    }
  }
});
function deliver(res) {
  const a = document.createElement('a');
  a.href = res.url;
  a.download = res.filename || (safeProj() + (res.url.endsWith('.webm') ? '.webm' : '.mp4'));
  if (res.kind === 'server') a.target = '_blank';
  document.body.appendChild(a); a.click(); a.remove();
}
function safeProj() { return (store.project.name || 'export').replace(/[^\w\-]+/g, '_'); }

/* ---------- badge motore ---------- */
(async function badge() {
  const el = document.getElementById('engineBadge');
  const eng = await api.checkEngine();
  if (eng.server && eng.ffmpeg) { el.textContent = 'server ffmpeg'; el.className = 'badge ok'; }
  else { el.textContent = 'browser render'; el.className = 'badge warn'; }
})();

/* ---------- avvio ---------- */
projName.textContent = store.project.name;
renderTimeline();
renderInspector();
renderBin();
renderLibraries();
initLibraryTabs();
startLoop();
toast('Pronto — importa un media per iniziare');
