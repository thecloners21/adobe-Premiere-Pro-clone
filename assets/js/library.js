/* =====================================================================
   library.js — librerie Effetti e Transizioni con anteprime,
   applicabili alla clip selezionata.
   ===================================================================== */
import { store } from './state.js';
import { TRANSITIONS } from './effects.js';

/* preset effetto: nome, fx parziali da fondere, filtro CSS per l'anteprima */
const EFFECT_PRESETS = [
  { name: 'Bianco e nero', fx: { grayscale: 1 }, css: 'grayscale(1)' },
  { name: 'Seppia',        fx: { sepia: 1 }, css: 'sepia(1)' },
  { name: 'Vignettatura',  fx: { vignette: 0.6 }, css: 'brightness(.9) contrast(1.1)' },
  { name: 'Sfocatura',     fx: { blur: 0.35 }, css: 'blur(2px)' },
  { name: 'Nitidezza',     fx: { sharpen: 0.6 }, css: 'contrast(1.3) saturate(1.1)' },
  { name: 'Vintage',       fx: { sepia: 0.5, contrast: 0.1, vignette: 0.4, saturation: -0.2 }, css: 'sepia(.5) contrast(1.1) saturate(.8)' },
  { name: 'Freddo',        fx: { temperature: -0.5 }, css: 'hue-rotate(-12deg) saturate(1.1) brightness(1.02)' },
  { name: 'Caldo',         fx: { temperature: 0.5 }, css: 'sepia(.25) saturate(1.2)' },
  { name: 'Alto contrasto',fx: { contrast: 0.4, saturation: 0.2 }, css: 'contrast(1.4) saturate(1.2)' },
  { name: 'Cinema',        fx: { contrast: 0.2, saturation: -0.1, vignette: 0.35 }, css: 'contrast(1.2) saturate(.9) brightness(.97)' },
  { name: 'Reset effetti', fx: '__reset__', css: 'none' },
];

const THUMB_BG = 'linear-gradient(135deg,#3a6aa8 0%,#d2a8ff 45%,#e6c14b 75%,#2f6b4f 100%)';

function applyEffect(preset) {
  const clip = store.selected();
  if (!clip) return window.__toast && window.__toast('Seleziona una clip nella timeline', 'err');
  if (preset.fx === '__reset__') {
    for (const k of Object.keys(clip.fx)) {
      if (['scale', 'opacity'].includes(k)) clip.fx[k] = 1;
      else if (['flipH', 'flipV'].includes(k)) clip.fx[k] = 0;
      else clip.fx[k] = 0;
    }
  } else {
    Object.assign(clip.fx, preset.fx);
  }
  store.emit('inspector');
  window.__toast && window.__toast('Effetto applicato: ' + preset.name, 'ok');
}

function applyTransition(tr) {
  const clip = store.selected();
  if (!clip) return window.__toast && window.__toast('Seleziona la clip entrante nella timeline', 'err');
  clip.transType = tr.key;
  store.emit('clips');
  window.__toast && window.__toast('Transizione: ' + tr.label + ' — sovrapponi le clip per attivarla', 'ok');
}

export function renderLibraries() {
  const fxBox = document.getElementById('fxLib');
  const trBox = document.getElementById('transLib');

  fxBox.innerHTML = '';
  for (const p of EFFECT_PRESETS) {
    const el = document.createElement('button');
    el.className = 'lib-item';
    el.innerHTML = `<span class="lib-thumb" style="background:${THUMB_BG};filter:${p.css}"></span>
                    <span class="lib-name">${p.name}</span>`;
    el.addEventListener('click', () => applyEffect(p));
    fxBox.appendChild(el);
  }

  trBox.innerHTML = '';
  for (const t of TRANSITIONS) {
    const el = document.createElement('button');
    el.className = 'lib-item';
    el.innerHTML = `<span class="lib-thumb trans-thumb" data-t="${t.key}"></span>
                    <span class="lib-name">${t.label}</span>`;
    el.addEventListener('click', () => applyTransition(t));
    trBox.appendChild(el);
  }
}

/* commutazione schede del pannello sinistro */
export function initLibraryTabs() {
  const tabs = document.querySelectorAll('.lib-tab');
  const panes = {
    media: document.getElementById('binList'),
    fx: document.getElementById('fxLib'),
    trans: document.getElementById('transLib'),
  };
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const sel = tab.dataset.libtab;
    for (const [k, el] of Object.entries(panes)) el.hidden = (k !== sel);
  }));
}
