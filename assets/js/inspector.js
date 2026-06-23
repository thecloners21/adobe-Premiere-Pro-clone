/* =====================================================================
   inspector.js — pannello "Controllo effetti": effetti raggruppati,
   keyframe, transizioni, flip, editor titoli, audio.
   ===================================================================== */
import { store, tc, evalParam, EASINGS } from './state.js';
import { FX_PARAMS, FX_GROUPS, TRANSITIONS } from './effects.js';
import { updateTitle } from './media.js';

const box = document.getElementById('inspector');

function localT(clip) {
  return Math.max(0, Math.min(store.playhead - clip.start, clip.out - clip.in));
}

export function renderInspector() {
  const clip = store.selected();
  if (!clip) { box.innerHTML = '<div class="empty">Seleziona una clip<br>per regolarne gli effetti</div>'; return; }
  const m = store.media(clip.mediaId);
  const track = store.track(store.selectedClip.trackId);
  const len = clip.out - clip.in;

  let html = `<div class="insp-clip"><b>${escapeHtml(m ? m.name : 'clip')}</b><br>
      ${track.name} · durata ${tc(len, store.project.fps)}</div>`;

  if (m && m.kind === 'title') html += titleEditor(m);

  if (track.type === 'video') {
    for (const g of FX_GROUPS) html += fxGroup(clip, g);
    html += flipRow(clip);
    html += transitionRow(clip);
  } else {
    html += audioGroup(clip);
  }
  box.innerHTML = html;
  wire(clip, m, track);
}

/* gruppo di effetti con slider + diamante keyframe */
function fxGroup(clip, group) {
  const params = FX_PARAMS.filter(p => p.group === group);
  let rows = '';
  for (const def of params) {
    const v = evalParam(clip, def.key, localT(clip));
    const kfd = clip.kf && clip.kf[def.key] && clip.kf[def.key].length;
    const on = kfd ? ' on' : '';
    rows += `<div class="fx-row kf-row">
        <label>${def.label}</label>
        <button class="kf-btn${on}" data-kf="${def.key}" title="Keyframe al playhead">◆</button>
        <input type="range" data-scope="fx" data-k="${def.key}" min="${def.min}" max="${def.max}" step="${def.step}" value="${v}">
        <span class="val">${fmt(v)}</span>
      </div>`;
    if (kfd) {
      const cur = (clip.ease && clip.ease[def.key]) || 'linear';
      const opts = EASINGS.map(e => `<option value="${e.key}" ${cur === e.key ? 'selected' : ''}>${e.label}</option>`).join('');
      rows += `<div class="fx-ease"><span>↳ accelerazione</span><select data-ease="${def.key}">${opts}</select></div>`;
    }
  }
  return `<div class="fx-group"><div class="fx-title">${group}</div>${rows}</div>`;
}

function flipRow(clip) {
  return `<div class="fx-group"><div class="fx-title">Capovolgi</div>
    <div class="toggle-row">
      <button class="tg${clip.fx.flipH ? ' on' : ''}" data-flip="flipH">Orizzontale</button>
      <button class="tg${clip.fx.flipV ? ' on' : ''}" data-flip="flipV">Verticale</button>
    </div></div>`;
}

function transitionRow(clip) {
  const opts = TRANSITIONS.map(t => `<option value="${t.key}" ${clip.transType === t.key ? 'selected' : ''}>${t.label}</option>`).join('');
  return `<div class="fx-group"><div class="fx-title">Transizione in entrata</div>
    <p class="hint">Sovrapponi questa clip alla precedente sulla stessa traccia per attivarla.</p>
    <select data-trans="1" style="width:100%">${opts}</select></div>`;
}

function audioGroup(clip) {
  return `<div class="fx-group"><div class="fx-title">Audio</div>
      ${clipRange('Volume', 'gain', clip.gain, 0, 2, 0.01)}
      ${clipRange('Fade in', 'fadeIn', clip.fadeIn, 0, 5, 0.05)}
      ${clipRange('Fade out', 'fadeOut', clip.fadeOut, 0, 5, 0.05)}
    </div>`;
}
function clipRange(label, key, val, min, max, step) {
  return `<div class="fx-row"><label>${label}</label>
      <input type="range" data-scope="clip" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}">
      <span class="val">${fmt(val)}</span></div>`;
}

function titleEditor(m) {
  const t = m.title;
  return `<div class="fx-group"><div class="fx-title">Testo</div>
    <textarea class="title-text" rows="2" style="width:100%">${escapeHtml(t.text)}</textarea>
    <div class="fx-row"><label>Dimensione</label><input type="range" data-ti="fontSize" min="20" max="200" step="1" value="${t.fontSize}"><span class="val">${t.fontSize}</span></div>
    <div class="fx-row"><label>Colore</label><input type="color" data-ti="color" value="${t.color}"><span></span></div>
    <div class="toggle-row">
      <select data-ti="align"><option value="left" ${t.align==='left'?'selected':''}>Sinistra</option><option value="center" ${t.align==='center'?'selected':''}>Centro</option><option value="right" ${t.align==='right'?'selected':''}>Destra</option></select>
      <select data-ti="valign"><option value="top" ${t.valign==='top'?'selected':''}>Alto</option><option value="middle" ${t.valign==='middle'?'selected':''}>Mezzo</option><option value="bottom" ${t.valign==='bottom'?'selected':''}>Basso</option></select>
    </div>
    <div class="toggle-row">
      <button class="tg${t.bold?' on':''}" data-ti-tg="bold">Grassetto</button>
      <button class="tg${t.shadow?' on':''}" data-ti-tg="shadow">Ombra</button>
    </div></div>`;
}

/* ---------- wiring ---------- */
function wire(clip, m, track) {
  // slider effetti / clip
  box.querySelectorAll('input[type=range][data-k]').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.k, scope = inp.dataset.scope, v = parseFloat(inp.value);
      if (scope === 'fx') {
        if (clip.kf && clip.kf[key] && clip.kf[key].length) addKf(clip, key, localT(clip), v);
        else clip.fx[key] = v;
      } else clip[key] = v;
      inp.parentElement.querySelector('.val').textContent = fmt(v);
      store.emit('inspector');
    });
  });
  // keyframe diamanti
  box.querySelectorAll('.kf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.kf;
      const v = evalParam(clip, key, localT(clip));
      addKf(clip, key, localT(clip), v);
      btn.classList.add('on');
      store.emit('inspector');
    });
  });
  // easing keyframe
  box.querySelectorAll('[data-ease]').forEach(sel => sel.addEventListener('change', () => {
    if (!clip.ease) clip.ease = {};
    clip.ease[sel.dataset.ease] = sel.value;
    store.emit('inspector');
  }));
  // flip
  box.querySelectorAll('[data-flip]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.flip; clip.fx[k] = clip.fx[k] ? 0 : 1; b.classList.toggle('on'); store.emit('inspector');
  }));
  // transizione
  const ts = box.querySelector('[data-trans]');
  if (ts) ts.addEventListener('change', () => { clip.transType = ts.value; store.emit('clips'); });

  // titolo
  if (m && m.kind === 'title') {
    const txt = box.querySelector('.title-text');
    if (txt) txt.addEventListener('input', () => { m.title.text = txt.value; updateTitle(m); });
    box.querySelectorAll('[data-ti]').forEach(inp => inp.addEventListener('input', () => {
      const k = inp.dataset.ti; m.title[k] = inp.type === 'range' ? parseFloat(inp.value) : inp.value;
      const val = inp.parentElement.querySelector('.val'); if (val) val.textContent = inp.value;
      updateTitle(m);
    }));
    box.querySelectorAll('[data-ti-tg]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.tiTg; m.title[k] = !m.title[k]; b.classList.toggle('on'); updateTitle(m);
    }));
  }
}

/* aggiorna i valori degli slider quando si sposta il playhead (senza ricostruire) */
export function syncInspectorValues() {
  const clip = store.selected(); if (!clip) return;
  const t = localT(clip);
  box.querySelectorAll('input[type=range][data-scope="fx"]').forEach(inp => {
    if (document.activeElement === inp) return;
    const v = evalParam(clip, inp.dataset.k, t);
    inp.value = v; inp.parentElement.querySelector('.val').textContent = fmt(v);
  });
}

function addKf(clip, key, t, v) {
  if (!clip.kf) clip.kf = {};
  const arr = clip.kf[key] || (clip.kf[key] = []);
  const i = arr.findIndex(k => Math.abs(k.t - t) < 0.02);
  if (i >= 0) arr[i].v = v; else { arr.push({ t, v }); arr.sort((a, b) => a.t - b.t); }
}

function fmt(v) { return (Math.round(v * 100) / 100).toString(); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
