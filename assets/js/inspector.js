/* =====================================================================
   inspector.js — pannello "Controllo effetti": effetti raggruppati,
   keyframe, transizioni, flip, editor titoli, audio.
   ===================================================================== */
import { store, tc, evalParam, evalGain, EASINGS, clipDur, clipSpeed, defaultMask, defaultSecondary } from './state.js';
import { FX_PARAMS, FX_GROUPS, TRANSITIONS } from './effects.js';
import { updateTitle, TITLE_FONTS, TITLE_STYLES, TITLE_ANIMS } from './media.js';
import { mountCurveEditor } from './curveeditor.js';

const box = document.getElementById('inspector');

function localT(clip) {
  return Math.max(0, Math.min(store.playhead - clip.start, clipDur(clip)));
}

export function renderInspector() {
  const clip = store.selected();
  if (!clip) { box.innerHTML = '<div class="empty">Seleziona una clip<br>per regolarne gli effetti</div>'; return; }
  const m = store.media(clip.mediaId);
  const track = store.track(store.selectedClip.trackId);
  const len = clipDur(clip);

  let html = `<div class="insp-clip"><b>${escapeHtml(m ? m.name : 'clip')}</b><br>
      ${track.name} · durata <span data-clip-dur>${tc(len, store.project.fps)}</span></div>`;

  if (m && m.kind === 'title') html += titleEditor(m);
  if (!m || m.kind !== 'image') html += speedDurGroup(clip);

  if (track.type === 'video') {
    for (const g of FX_GROUPS) html += fxGroup(clip, g);
    html += flipRow(clip);
    html += `<div class="fx-group"><div class="fx-title">Curve RGB</div><div id="curveMount"></div></div>`;
    html += colorBalanceGroup(clip);
    html += secondaryGroup(clip);
    html += maskGroup(clip);
    html += transitionRow(clip);
  } else {
    html += audioGroup(clip);
  }
  box.innerHTML = html;
  wire(clip, m, track);
  if (track.type === 'video') {
    const cm = box.querySelector('#curveMount');
    if (cm) mountCurveEditor(cm, clip);
  }
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

function colorBalanceGroup(clip) {
  if (!clip.color) clip.color = { shadows: { color: '#808080', lum: 0 }, mids: { color: '#808080', lum: 0 }, highlights: { color: '#808080', lum: 0 } };
  const c = clip.color;
  const row = (key, label) => {
    const r = c[key] || { color: '#808080', lum: 0 };
    return `<div class="lgg-row">
      <span class="lgg-label">${label}</span>
      <input type="color" data-lgg-color="${key}" value="${r.color || '#808080'}">
      <input type="range" data-lgg-lum="${key}" min="-1" max="1" step="0.02" value="${r.lum || 0}">
    </div>`;
  };
  return `<div class="fx-group"><div class="fx-title">Bilanciamento colore</div>
    ${row('shadows', 'Ombre')}
    ${row('mids', 'Mezzitoni')}
    ${row('highlights', 'Luci')}
    <button class="curve-reset" data-lgg-reset="1" style="width:100%;margin-top:6px">Reset bilanciamento</button>
  </div>`;
}

/* qualificazione secondaria HSL: corregge solo una banda di tonalità */
function secondaryGroup(clip) {
  const s = clip.secondary || { on: false };
  const on = !!s.on;
  let rows = '';
  if (on) {
    const r = (label, key, val, min, max, step) => `<div class="fx-row"><label>${label}</label>
        <input type="range" data-sec="${key}" min="${min}" max="${max}" step="${step}" value="${val}">
        <span class="val">${fmt(val)}</span></div>`;
    rows = `<div class="fx-row"><label>Colore chiave</label><input type="color" data-sec-color="1" value="${s.color || '#cc3030'}"><span></span></div>`
      + r('Ampiezza ton.', 'range', s.range ?? 0.08, 0.005, 0.5, 0.005)
      + r('Morbidezza', 'soft', s.soft ?? 0.08, 0, 0.3, 0.005)
      + r('Saturazione min', 'satMin', s.satMin ?? 0.15, 0, 1, 0.01)
      + `<div class="fx-title" style="margin-top:6px">Correzione</div>`
      + r('Sposta tonalità', 'dHue', s.dHue ?? 0, -180, 180, 1)
      + r('Saturazione', 'dSat', s.dSat ?? 0, -1, 1, 0.02)
      + r('Luminosità', 'dLum', s.dLum ?? 0, -1, 1, 0.02);
  }
  return `<div class="fx-group"><div class="fx-title">Secondaria HSL</div>
    <div class="toggle-row"><button class="tg${on ? ' on' : ''}" data-sec-toggle="1">${on ? 'Attiva' : 'Disattivata'}</button></div>
    ${rows}
    ${on ? '<p class="hint">Corregge solo i pixel nella banda di tonalità scelta. Anteprima ed export browser.</p>' : ''}
  </div>`;
}

/* maschera della clip (ellisse / rettangolo con feather, opz. invertita) */
function maskGroup(clip) {
  const mk = (clip.mask && clip.mask.type) ? clip.mask : { type: 'none' };
  const t = mk.type || 'none';
  const opt = (v, l) => `<option value="${v}" ${t === v ? 'selected' : ''}>${l}</option>`;
  let rows = '';
  if (t !== 'none') {
    const r = (label, key, val, min, max, step) => `<div class="fx-row"><label>${label}</label>
        <input type="range" data-mask="${key}" min="${min}" max="${max}" step="${step}" value="${val}">
        <span class="val">${fmt(val)}</span></div>`;
    rows = r('Centro X', 'cx', mk.cx ?? 0.5, 0, 1, 0.005)
         + r('Centro Y', 'cy', mk.cy ?? 0.5, 0, 1, 0.005)
         + r('Larghezza', 'w', mk.w ?? 0.35, 0.02, 0.5, 0.005)
         + r('Altezza', 'h', mk.h ?? 0.35, 0.02, 0.5, 0.005)
         + r('Sfumatura', 'feather', mk.feather ?? 0.06, 0, 0.3, 0.005)
         + `<div class="toggle-row"><button class="tg${mk.invert ? ' on' : ''}" data-mask-invert="1">Inverti maschera</button></div>`;
  }
  return `<div class="fx-group"><div class="fx-title">Maschera</div>
    <div class="fx-row"><label>Forma</label>
      <select data-mask-type="1" style="width:100%">${opt('none', 'Nessuna')}${opt('ellipse', 'Ellisse')}${opt('rect', 'Rettangolo')}</select></div>
    ${rows}
    ${t !== 'none' ? '<p class="hint">La maschera ritaglia la clip (le tracce sotto restano visibili). Onorata in anteprima ed export browser.</p>' : ''}
  </div>`;
}

/* velocità / durata della clip (slow & fast motion) */
function speedDurGroup(clip) {
  const sp = clipSpeed(clip);
  const pct = Math.round(sp * 100);
  const dur = clipDur(clip);
  const presets = [25, 50, 100, 200, 400]
    .map(p => `<button class="sp-preset${pct === p ? ' on' : ''}" data-sp="${p / 100}">${p}%</button>`).join('');
  return `<div class="fx-group"><div class="fx-title">Velocità / Durata</div>
    <div class="fx-row"><label>Velocità</label>
      <input type="range" data-speed="1" min="0.1" max="4" step="0.05" value="${sp}">
      <span class="val" data-speed-val>${pct}%</span></div>
    <div class="sp-presets">${presets}</div>
    <p class="hint" data-speed-dur>Durata risultante: ${tc(dur, store.project.fps)}</p>
  </div>`;
}

function transitionRow(clip) {
  const opts = TRANSITIONS.map(t => `<option value="${t.key}" ${clip.transType === t.key ? 'selected' : ''}>${t.label}</option>`).join('');
  return `<div class="fx-group"><div class="fx-title">Transizione in entrata</div>
    <p class="hint">Sovrapponi questa clip alla precedente sulla stessa traccia per attivarla.</p>
    <select data-trans="1" style="width:100%">${opts}</select></div>`;
}

function audioGroup(clip) {
  const kfd = clip.kf && clip.kf.gain && clip.kf.gain.length;
  const gv = evalGain(clip, localT(clip));
  let vol = `<div class="fx-row kf-row">
      <label>Volume</label>
      <button class="kf-btn${kfd ? ' on' : ''}" data-kfaudio="gain" title="Keyframe volume al playhead">◆</button>
      <input type="range" data-scope="audio" data-k="gain" min="0" max="2" step="0.01" value="${gv}">
      <span class="val">${fmt(gv)}</span></div>`;
  if (kfd) {
    const cur = (clip.ease && clip.ease.gain) || 'linear';
    const opts = EASINGS.map(e => `<option value="${e.key}" ${cur === e.key ? 'selected' : ''}>${e.label}</option>`).join('');
    vol += `<div class="fx-ease"><span>↳ accelerazione</span><select data-easeaudio="gain">${opts}</select></div>`;
  }
  return `<div class="fx-group"><div class="fx-title">Audio</div>
      ${vol}
      ${clipRange('Pan (L↔R)', 'pan', clip.pan ?? 0, -1, 1, 0.01)}
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
  const stroke = t.stroke || { color: '#000000', width: 0 };
  const anim = t.anim || { type: 'none', dur: 1 };
  const fontOpts = TITLE_FONTS.map(f => `<option value="${f}" ${t.font===f?'selected':''}>${f}</option>`).join('');
  const styleBtns = TITLE_STYLES.map((s, i) => `<button class="title-style" data-tstyle="${i}">${s.name}</button>`).join('');
  const animOpts = TITLE_ANIMS.map(a => `<option value="${a.key}" ${anim.type===a.key?'selected':''}>${a.label}</option>`).join('');
  return `<div class="fx-group"><div class="fx-title">Stili titolo</div>
    <div class="title-styles">${styleBtns}</div></div>
   <div class="fx-group"><div class="fx-title">Testo</div>
    <textarea class="title-text" rows="2" style="width:100%">${escapeHtml(t.text)}</textarea>
    <div class="fx-row"><label>Font</label><select data-ti="font" style="width:100%">${fontOpts}</select></div>
    <div class="fx-row"><label>Dimensione</label><input type="range" data-ti="fontSize" min="20" max="240" step="1" value="${t.fontSize}"><span class="val">${t.fontSize}</span></div>
    <div class="fx-row"><label>Colore</label><input type="color" data-ti="color" value="${t.color}"><span></span></div>
    <div class="toggle-row">
      <select data-ti="align"><option value="left" ${t.align==='left'?'selected':''}>Sinistra</option><option value="center" ${t.align==='center'?'selected':''}>Centro</option><option value="right" ${t.align==='right'?'selected':''}>Destra</option></select>
      <select data-ti="valign"><option value="top" ${t.valign==='top'?'selected':''}>Alto</option><option value="middle" ${t.valign==='middle'?'selected':''}>Mezzo</option><option value="bottom" ${t.valign==='bottom'?'selected':''}>Basso</option></select>
    </div>
    <div class="toggle-row">
      <button class="tg${t.bold?' on':''}" data-ti-tg="bold">Grassetto</button>
      <button class="tg${t.italic?' on':''}" data-ti-tg="italic">Corsivo</button>
      <button class="tg${t.shadow?' on':''}" data-ti-tg="shadow">Ombra</button>
    </div></div>
   <div class="fx-group"><div class="fx-title">Contorno e sfondo</div>
    <div class="fx-row"><label>Contorno</label><input type="color" data-ti-stroke="color" value="${stroke.color}"><span></span></div>
    <div class="fx-row"><label>Spessore</label><input type="range" data-ti-stroke="width" min="0" max="20" step="1" value="${stroke.width}"><span class="val">${stroke.width}</span></div>
    <div class="fx-row"><label>Sfondo</label><input type="color" data-ti="bg" value="${t.bg && t.bg!=='transparent' ? t.bg : '#000000'}"><span></span></div>
    <div class="fx-row"><label>Opacità sf.</label><input type="range" data-ti="bgOpacity" min="0" max="1" step="0.05" value="${t.bgOpacity ?? 0.55}"><span class="val">${t.bgOpacity ?? 0.55}</span></div>
    <div class="toggle-row">
      <button class="tg${t.band?' on':''}" data-ti-tg="band">Banda (lower third)</button>
      <button class="tg${(t.bg && t.bg!=='transparent')?' on':''}" data-ti-bgtoggle="1">Sfondo on/off</button>
    </div></div>
   <div class="fx-group"><div class="fx-title">Animazione</div>
    <div class="fx-row"><label>Tipo</label><select data-ti-anim="type" style="width:100%">${animOpts}</select></div>
    <div class="fx-row"><label>Durata</label><input type="range" data-ti-anim="dur" min="0.2" max="4" step="0.1" value="${anim.dur ?? 1}"><span class="val">${anim.dur ?? 1}</span></div>
    <p class="hint">Le animazioni si vedono in anteprima e nell'export browser.</p>
   </div>`;
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
      } else if (scope === 'audio') {
        // volume con keyframe (se attivi) altrimenti volume base
        if (clip.kf && clip.kf.gain && clip.kf.gain.length) addKf(clip, 'gain', localT(clip), v);
        else clip.gain = v;
      } else clip[key] = v;
      inp.parentElement.querySelector('.val').textContent = fmt(v);
      store.emit('inspector');
    });
  });
  // keyframe diamanti (fx)
  box.querySelectorAll('.kf-btn[data-kf]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.kf;
      const v = evalParam(clip, key, localT(clip));
      addKf(clip, key, localT(clip), v);
      btn.classList.add('on');
      store.emit('inspector');
    });
  });
  // keyframe diamante (volume audio)
  box.querySelectorAll('.kf-btn[data-kfaudio]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = evalGain(clip, localT(clip));
      addKf(clip, 'gain', localT(clip), v);
      btn.classList.add('on');
      store.emit('inspector');
    });
  });
  // easing keyframe (fx)
  box.querySelectorAll('[data-ease]').forEach(sel => sel.addEventListener('change', () => {
    if (!clip.ease) clip.ease = {};
    clip.ease[sel.dataset.ease] = sel.value;
    store.emit('inspector');
  }));
  // easing keyframe (volume audio)
  box.querySelectorAll('[data-easeaudio]').forEach(sel => sel.addEventListener('change', () => {
    if (!clip.ease) clip.ease = {};
    clip.ease.gain = sel.value;
    store.emit('inspector');
  }));
  // flip
  box.querySelectorAll('[data-flip]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.flip; clip.fx[k] = clip.fx[k] ? 0 : 1; b.classList.toggle('on'); store.emit('inspector');
  }));
  // transizione
  const ts = box.querySelector('[data-trans]');
  if (ts) ts.addEventListener('change', () => { clip.transType = ts.value; store.emit('clips'); });

  // velocità / durata (aggiorna timeline + etichette senza ricostruire l'inspector)
  const spRange = box.querySelector('[data-speed]');
  const applySpeed = (v) => {
    clip.speed = Math.max(0.1, Math.min(4, v));
    const pct = Math.round(clip.speed * 100);
    const dur = clipDur(clip);
    const sv = box.querySelector('[data-speed-val]'); if (sv) sv.textContent = pct + '%';
    const sd = box.querySelector('[data-speed-dur]'); if (sd) sd.textContent = 'Durata risultante: ' + tc(dur, store.project.fps);
    const cd = box.querySelector('[data-clip-dur]'); if (cd) cd.textContent = tc(dur, store.project.fps);
    box.querySelectorAll('.sp-preset').forEach(b => b.classList.toggle('on', Math.round(parseFloat(b.dataset.sp) * 100) === pct));
    if (spRange && document.activeElement !== spRange) spRange.value = clip.speed;
    store.emit('speed');
  };
  if (spRange) spRange.addEventListener('input', () => applySpeed(parseFloat(spRange.value)));
  box.querySelectorAll('.sp-preset').forEach(b => b.addEventListener('click', () => applySpeed(parseFloat(b.dataset.sp))));

  // bilanciamento colore (Lift/Gamma/Gain) — aggiorna senza ricostruire l'inspector
  box.querySelectorAll('[data-lgg-color]').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.lggColor; (clip.color[k] || (clip.color[k] = {})).color = inp.value; store.emit('touch');
  }));
  box.querySelectorAll('[data-lgg-lum]').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.lggLum; (clip.color[k] || (clip.color[k] = {})).lum = parseFloat(inp.value); store.emit('touch');
  }));
  const lggR = box.querySelector('[data-lgg-reset]');
  if (lggR) lggR.addEventListener('click', () => {
    clip.color = { shadows: { color: '#808080', lum: 0 }, mids: { color: '#808080', lum: 0 }, highlights: { color: '#808080', lum: 0 } };
    store.emit('inspector');
  });

  // secondaria HSL
  const stog = box.querySelector('[data-sec-toggle]');
  if (stog) stog.addEventListener('click', () => {
    if (!clip.secondary) clip.secondary = defaultSecondary();
    else clip.secondary.on = !clip.secondary.on;
    renderInspector();
  });
  const scol = box.querySelector('[data-sec-color]');
  if (scol) scol.addEventListener('input', () => {
    if (!clip.secondary) clip.secondary = defaultSecondary();
    clip.secondary.color = scol.value; store.emit('touch');
  });
  box.querySelectorAll('[data-sec]').forEach(inp => inp.addEventListener('input', () => {
    if (!clip.secondary) clip.secondary = defaultSecondary();
    clip.secondary[inp.dataset.sec] = parseFloat(inp.value);
    inp.parentElement.querySelector('.val').textContent = fmt(parseFloat(inp.value));
    store.emit('touch');
  }));

  // maschera
  const mtype = box.querySelector('[data-mask-type]');
  if (mtype) mtype.addEventListener('change', () => {
    if (mtype.value === 'none') clip.mask = null;
    else {
      if (!clip.mask || !clip.mask.type || clip.mask.type === 'none') clip.mask = defaultMask();
      clip.mask.type = mtype.value;
    }
    renderInspector();
  });
  box.querySelectorAll('[data-mask]').forEach(inp => inp.addEventListener('input', () => {
    if (!clip.mask) clip.mask = defaultMask();
    clip.mask[inp.dataset.mask] = parseFloat(inp.value);
    inp.parentElement.querySelector('.val').textContent = fmt(parseFloat(inp.value));
    store.emit('touch');
  }));
  const minv = box.querySelector('[data-mask-invert]');
  if (minv) minv.addEventListener('click', () => {
    if (!clip.mask) clip.mask = defaultMask();
    clip.mask.invert = !clip.mask.invert; minv.classList.toggle('on'); store.emit('touch');
  });

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
    // contorno
    box.querySelectorAll('[data-ti-stroke]').forEach(inp => inp.addEventListener('input', () => {
      if (!m.title.stroke) m.title.stroke = { color: '#000000', width: 0 };
      const k = inp.dataset.tiStroke;
      m.title.stroke[k] = inp.type === 'range' ? parseFloat(inp.value) : inp.value;
      const val = inp.parentElement.querySelector('.val'); if (val) val.textContent = inp.value;
      updateTitle(m);
    }));
    // animazione
    box.querySelectorAll('[data-ti-anim]').forEach(inp => inp.addEventListener('input', () => {
      if (!m.title.anim) m.title.anim = { type: 'none', dur: 1 };
      const k = inp.dataset.tiAnim;
      m.title.anim[k] = inp.type === 'range' ? parseFloat(inp.value) : inp.value;
      const val = inp.parentElement.querySelector('.val'); if (val) val.textContent = inp.value;
      updateTitle(m);
    }));
    // sfondo on/off
    const bgT = box.querySelector('[data-ti-bgtoggle]');
    if (bgT) bgT.addEventListener('click', () => {
      if (m.title.bg && m.title.bg !== 'transparent') m.title.bg = 'transparent';
      else m.title.bg = (box.querySelector('[data-ti="bg"]') || {}).value || '#000000';
      bgT.classList.toggle('on'); updateTitle(m);
    });
    // stili preset
    box.querySelectorAll('[data-tstyle]').forEach(b => b.addEventListener('click', () => {
      const s = TITLE_STYLES[parseInt(b.dataset.tstyle)].s;
      Object.assign(m.title, JSON.parse(JSON.stringify(s)));
      updateTitle(m); renderInspector();
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
  const av = box.querySelector('input[type=range][data-scope="audio"][data-k="gain"]');
  if (av && document.activeElement !== av && clip.kf && clip.kf.gain && clip.kf.gain.length) {
    const v = evalGain(clip, t);
    av.value = v; av.parentElement.querySelector('.val').textContent = fmt(v);
  }
}

function addKf(clip, key, t, v) {
  if (!clip.kf) clip.kf = {};
  const arr = clip.kf[key] || (clip.kf[key] = []);
  const i = arr.findIndex(k => Math.abs(k.t - t) < 0.02);
  if (i >= 0) arr[i].v = v; else { arr.push({ t, v }); arr.sort((a, b) => a.t - b.t); }
}

function fmt(v) { return (Math.round(v * 100) / 100).toString(); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
