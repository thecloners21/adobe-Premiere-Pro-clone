/* =====================================================================
   curveeditor.js — editor interattivo delle curve RGB (color grading).
   Disegna griglia + curva del canale attivo; i punti si trascinano,
   clic per aggiungere, doppio clic per rimuovere (estremi non rimovibili).
   Le modifiche aggiornano clip.curves; l'anteprima si ridisegna da sola (rAF).
   ===================================================================== */
import { store, defaultCurves } from './state.js';
import { makeCurveSampler } from './effects.js';

const CH = [
  { key: 'rgb', label: 'RGB', stroke: '#e8e8ee' },
  { key: 'r',   label: 'R',   stroke: '#ff6b6b' },
  { key: 'g',   label: 'G',   stroke: '#43d17a' },
  { key: 'b',   label: 'B',   stroke: '#5a9bf0' },
];
let activeCh = 'rgb';   // persiste tra i re-render dell'inspector

const W = 232, H = 150, PAD = 12;
const toPx = (x, y) => [PAD + x * (W - 2 * PAD), H - PAD - y * (H - 2 * PAD)];
const toVal = (px, py) => [(px - PAD) / (W - 2 * PAD), 1 - (py - PAD) / (H - 2 * PAD)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function mountCurveEditor(container, clip) {
  if (!clip.curves) clip.curves = defaultCurves();

  const tabs = CH.map(c => `<button class="curve-tab${activeCh === c.key ? ' active' : ''}" data-ch="${c.key}" style="--cc:${c.stroke}">${c.label}</button>`).join('');
  container.innerHTML = `
    <div class="curve-tabs">${tabs}</div>
    <canvas class="curve-canvas" width="${W}" height="${H}"></canvas>
    <div class="curve-actions"><button class="curve-reset" data-act="reset">Reset canale</button>
      <button class="curve-reset" data-act="resetAll">Reset tutto</button></div>
    <p class="hint">Trascina i punti · clic = aggiungi · doppio clic = rimuovi.</p>`;

  const canvas = container.querySelector('.curve-canvas');
  const ctx = canvas.getContext('2d');
  const pts = () => clip.curves[activeCh];

  let saveTimer;
  const touch = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.emit('touch'), 350); };

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // sfondo + griglia
    ctx.fillStyle = '#15151a'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = PAD + i / 4 * (W - 2 * PAD), gy = PAD + i / 4 * (H - 2 * PAD);
      ctx.beginPath(); ctx.moveTo(gx, PAD); ctx.lineTo(gx, H - PAD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(W - PAD, gy); ctx.stroke();
    }
    // diagonale identità
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(...toPx(0, 0)); ctx.lineTo(...toPx(1, 1)); ctx.stroke(); ctx.setLineDash([]);
    // curva attiva
    const chDef = CH.find(c => c.key === activeCh);
    const f = makeCurveSampler(pts());
    ctx.strokeStyle = chDef.stroke; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 64; i++) { const x = i / 64; const [px, py] = toPx(x, clamp01(f(x))); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    // punti
    for (const p of pts()) {
      const [px, py] = toPx(p.x, p.y);
      ctx.fillStyle = chDef.stroke; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  let dragIdx = -1;
  const hit = (mx, my) => {
    const arr = pts();
    for (let i = 0; i < arr.length; i++) { const [px, py] = toPx(arr[i].x, arr[i].y); if (Math.hypot(px - mx, py - my) < 9) return i; }
    return -1;
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const [mx, my] = pos(e);
    const arr = pts();
    let i = hit(mx, my);
    if (i < 0) {
      // aggiungi punto
      let [vx, vy] = toVal(mx, my); vx = clamp01(vx); vy = clamp01(vy);
      arr.push({ x: vx, y: vy }); arr.sort((a, b) => a.x - b.x);
      i = arr.findIndex(p => p.x === vx && p.y === vy);
    }
    dragIdx = i;
    canvas.setPointerCapture(e.pointerId);
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragIdx < 0) return;
    const arr = pts(); const [mx, my] = pos(e);
    let [vx, vy] = toVal(mx, my); vy = clamp01(vy);
    const isEnd = dragIdx === 0 || dragIdx === arr.length - 1;
    if (isEnd) { vx = arr[dragIdx].x; }   // gli estremi non si spostano in x
    else {
      const lo = arr[dragIdx - 1].x + 0.01, hi = arr[dragIdx + 1].x - 0.01;
      vx = Math.max(lo, Math.min(vx, hi));
    }
    arr[dragIdx].x = vx; arr[dragIdx].y = vy;
    draw(); touch();
  });
  const endDrag = () => { dragIdx = -1; touch(); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', (e) => {
    const [mx, my] = pos(e); const arr = pts(); const i = hit(mx, my);
    if (i > 0 && i < arr.length - 1) { arr.splice(i, 1); draw(); touch(); }
  });

  container.querySelectorAll('.curve-tab').forEach(b => b.addEventListener('click', () => {
    activeCh = b.dataset.ch;
    container.querySelectorAll('.curve-tab').forEach(x => x.classList.toggle('active', x === b));
    draw();
  }));
  container.querySelector('[data-act="reset"]').addEventListener('click', () => {
    clip.curves[activeCh] = [{ x: 0, y: 0 }, { x: 1, y: 1 }]; draw(); touch();
  });
  container.querySelector('[data-act="resetAll"]').addEventListener('click', () => {
    clip.curves = defaultCurves(); draw(); touch();
  });

  draw();
}
