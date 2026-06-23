/* =====================================================================
   timeline.js — render e interazione timeline multitraccia
   ===================================================================== */
import { store, makeClip, tc } from './state.js';
import { runtime } from './media.js';
import { drawWaveform } from './audio.js';
import { seek, updatePlayheadUI, THEAD_W } from './preview.js';
import { audio } from './audio.js';

const tracksEl = document.getElementById('tracks');
const rulerEl = document.getElementById('ruler');
const timelineEl = document.getElementById('timeline');

let laneRects = [];   // cache per move tra tracce

export function renderTimeline() {
  renderRuler();
  renderTracks();
  updatePlayheadUI();
}

/* ----------------- righello ----------------- */
function renderRuler() {
  const pps = store.pxPerSec;
  const dur = Math.max(store.duration() + 5, 20);
  const width = dur * pps;
  rulerEl.style.width = width + 'px';
  rulerEl.innerHTML = '';
  // intervallo etichette ~ ogni 90px
  const targets = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  let step = targets.find(s => s * pps >= 70) || 300;
  for (let t = 0; t <= dur; t += step) {
    const tick = document.createElement('div');
    tick.className = 'tick major';
    tick.style.left = (t * pps) + 'px';
    tick.innerHTML = `<span>${tc(t, store.project.fps)}</span>`;
    rulerEl.appendChild(tick);
  }
}

/* seek cliccando sul righello */
rulerEl.addEventListener('pointerdown', (e) => {
  const rect = rulerEl.getBoundingClientRect();
  const x = e.clientX - rect.left;
  seek(x / store.pxPerSec);
  const move = (ev) => seek((ev.clientX - rect.left) / store.pxPerSec);
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

/* ----------------- tracce + clip ----------------- */
function renderTracks() {
  const pps = store.pxPerSec;
  const dur = Math.max(store.duration() + 5, 20);
  const laneWidth = dur * pps;
  tracksEl.innerHTML = '';

  for (const track of store.project.tracks) {
    const row = document.createElement('div');
    row.className = 'track ' + track.type;
    row.dataset.trackId = track.id;

    // testata
    const head = document.createElement('div');
    head.className = 'track-head';
    head.innerHTML = `
      <div class="th-top">
        <span class="th-name">${track.name}</span>
        <span class="th-kind">${track.type === 'video' ? 'Video' : 'Audio'}</span>
      </div>
      <div class="th-btns">
        <button data-b="M" class="${track.mute ? 'on' : ''}" title="Muto">M</button>
        <button data-b="S" class="${track.solo ? 'on' : ''}" title="Solo">S</button>
      </div>`;
    head.querySelector('[data-b="M"]').addEventListener('click', () => {
      track.mute = !track.mute;
      if (track.type === 'audio') audio.setTrackMuted(track.id, track.mute);
      store.emit('clips');
    });
    head.querySelector('[data-b="S"]').addEventListener('click', () => {
      track.solo = !track.solo; store.emit('clips');
    });

    // lane
    const lane = document.createElement('div');
    lane.className = 'track-lane';
    lane.style.width = laneWidth + 'px';
    lane.dataset.trackId = track.id;

    for (const clip of track.clips) lane.appendChild(buildClip(track, clip));

    // drop dal media bin
    lane.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      const mediaId = e.dataTransfer.getData('text/media-id');
      const m = store.media(mediaId);
      if (!m) return;
      // compatibilità traccia
      if (track.type === 'video' && m.kind === 'audio') return toast('Trascina l\'audio su una traccia A');
      if (track.type === 'audio' && m.kind !== 'audio') return toast('Le tracce A accettano solo audio');
      const rect = lane.getBoundingClientRect();
      let start = (e.clientX - rect.left) / store.pxPerSec;
      start = snap(Math.max(0, start), track, null);
      store.addClip(track.id, makeClip(m, start, track.type));
    });

    row.appendChild(head);
    row.appendChild(lane);
    tracksEl.appendChild(row);
  }
}

function buildClip(track, clip) {
  const m = store.media(clip.mediaId);
  const pps = store.pxPerSec;
  const len = clip.out - clip.in;
  const el = document.createElement('div');
  el.className = 'clip ' + track.type +
    (store.selectedClip && store.selectedClip.clipId === clip.id ? ' selected' : '');
  el.style.left = (clip.start * pps) + 'px';
  el.style.width = Math.max(8, len * pps) + 'px';
  el.dataset.clipId = clip.id;

  const label = document.createElement('div');
  label.className = 'clip-label';
  label.textContent = m ? m.name : 'clip';
  el.appendChild(label);

  const body = document.createElement('div');
  body.className = 'clip-body';
  if (track.type === 'audio') {
    const wave = document.createElement('canvas');
    wave.className = 'wave'; wave.width = Math.max(8, len * pps); wave.height = 30;
    body.appendChild(wave);
    const rt = runtime.get(clip.mediaId);
    if (rt && rt.audioBuffer) drawWaveform(wave, rt.audioBuffer, clip.in, clip.out);
  } else {
    const rt = runtime.get(clip.mediaId);
    if (rt && rt.thumb) { body.style.background = `#000 url('${rt.thumb}') center/cover`; body.style.opacity = .55; }
  }
  el.appendChild(body);

  // indicatore transizione: sovrapposizione con la clip precedente sulla stessa traccia
  const prev = track.clips.filter(c => c !== clip && c.start < clip.start)
    .sort((a, b) => b.start - a.start)[0];
  if (prev) {
    const prevEnd = prev.start + (prev.out - prev.in);
    const ov = prevEnd - clip.start;
    if (ov > 0.01) {
      const x = document.createElement('div');
      x.className = 'xfade';
      x.style.width = Math.max(6, ov * pps) + 'px';
      x.title = 'Transizione: ' + (clip.transType || 'dissolve');
      el.appendChild(x);
    }
  }

  // maniglie trim
  const hl = document.createElement('div'); hl.className = 'handle l';
  const hr = document.createElement('div'); hr.className = 'handle r';
  el.appendChild(hl); el.appendChild(hr);

  // selezione + move
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('handle')) return startTrim(e, track, clip, e.target.classList.contains('l'));
    startMove(e, track, clip);
  });
  return el;
}

/* ----------------- spostamento clip ----------------- */
function startMove(e, track, clip) {
  e.preventDefault();
  store.select(track.id, clip.id);
  cacheLaneRects();
  const startX = e.clientX;
  const origStart = clip.start;
  let curTrack = track;

  const move = (ev) => {
    const dx = (ev.clientX - startX) / store.pxPerSec;
    clip.start = snap(Math.max(0, origStart + dx), curTrack, clip);
    // cambio traccia (stesso tipo)
    const lane = laneRects.find(r => ev.clientY >= r.top && ev.clientY <= r.bottom && r.type === track.type);
    if (lane && lane.trackId !== curTrack.id) {
      const dest = store.track(lane.trackId);
      curTrack.clips = curTrack.clips.filter(c => c.id !== clip.id);
      dest.clips.push(clip);
      curTrack = dest;
      store.select(dest.id, clip.id);
    }
    store.emit('clips');
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ----------------- trim ----------------- */
function startTrim(e, track, clip, left) {
  e.preventDefault();
  e.stopPropagation();
  store.select(track.id, clip.id);
  const startX = e.clientX;
  const o = { start: clip.start, in: clip.in, out: clip.out };
  const m = store.media(clip.mediaId);
  const srcMax = m ? (m.duration || clip.out) : clip.out;

  const move = (ev) => {
    const d = (ev.clientX - startX) / store.pxPerSec;
    if (left) {
      let ni = Math.max(0, Math.min(o.in + d, o.out - 0.1));
      const delta = ni - o.in;
      clip.in = ni; clip.start = Math.max(0, o.start + delta);
    } else {
      clip.out = Math.max(clip.in + 0.1, Math.min(o.out + d, srcMax || (o.out + d)));
    }
    store.emit('clips');
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ----------------- snapping ----------------- */
function snap(value, track, exceptClip) {
  const pps = store.pxPerSec;
  const thr = 8 / pps; // 8px
  const points = [0, store.playhead];
  for (const t of store.project.tracks)
    for (const c of t.clips) {
      if (c === exceptClip) continue;
      points.push(c.start, c.start + (c.out - c.in));
    }
  for (const p of points) if (Math.abs(value - p) < thr) return p;
  return value;
}

function cacheLaneRects() {
  laneRects = [];
  tracksEl.querySelectorAll('.track-lane').forEach(lane => {
    const r = lane.getBoundingClientRect();
    const tr = store.track(lane.dataset.trackId);
    laneRects.push({ trackId: lane.dataset.trackId, type: tr.type, top: r.top, bottom: r.bottom });
  });
}

function toast(msg) { window.__toast && window.__toast(msg); }
