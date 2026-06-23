/* =====================================================================
   interchange.js — import/export nei formati di scambio "originali"
   supportati da Premiere: EDL (CMX 3600) e FCPXML.
   (Il .prproj nativo è XML proprietario gzip: non garantibile, escluso.)
   ===================================================================== */
import { store, makeClip, uid } from './state.js';

/* ---------- timecode HH:MM:SS:FF ---------- */
function f2tc(sec, fps) {
  sec = Math.max(0, sec);
  const total = Math.round(sec * fps);
  const f = total % fps;
  const s = Math.floor(total / fps) % 60;
  const m = Math.floor(total / (fps * 60)) % 60;
  const h = Math.floor(total / (fps * 3600));
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

/* ===================== EXPORT EDL (CMX 3600) ===================== */
export function toEDL() {
  const p = store.project, fps = p.fps;
  const lines = [`TITLE: ${(p.name || 'PROGETTO').toUpperCase()}`, 'FCM: NON-DROP FRAME'];
  let ev = 1;
  // l'EDL classico è mono-traccia: usiamo la prima traccia video
  const vtrack = p.tracks.find(t => t.type === 'video' && t.clips.length);
  if (vtrack) {
    const clips = vtrack.clips.slice().sort((a, b) => a.start - b.start);
    for (const c of clips) {
      const m = store.media(c.mediaId);
      const reel = (m ? m.name : 'CLIP').replace(/\W+/g, '').slice(0, 8).toUpperCase() || 'CLIP';
      const srcIn = f2tc(c.in, fps), srcOut = f2tc(c.out, fps);
      const recIn = f2tc(c.start, fps), recOut = f2tc(c.start + (c.out - c.in), fps);
      const transCode = c.transition > 0 ? `D    ${String(Math.round(c.transition * fps)).padStart(3, '0')}` : 'C        ';
      lines.push(`${String(ev).padStart(3, '0')}  ${reel.padEnd(8)} V     ${transCode} ${srcIn} ${srcOut} ${recIn} ${recOut}`);
      if (m) lines.push(`* FROM CLIP NAME: ${m.name}`);
      ev++;
    }
  }
  return lines.join('\n') + '\n';
}

/* ===================== EXPORT FCPXML ===================== */
export function toFCPXML() {
  const p = store.project, fps = p.fps;
  const fd = `${1}/${fps}s`;       // frame duration
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fr = sec => `${Math.round(sec * fps)}/${fps}s`;

  const assets = p.media.map(m =>
    `    <asset id="${m.id}" name="${esc(m.name)}" src="${esc(m.serverSrc || m.src || m.name)}" hasVideo="${m.kind !== 'audio' ? 1 : 0}" hasAudio="${m.hasAudio ? 1 : 0}" duration="${fr(m.duration || 0)}"/>`
  ).join('\n');

  const spine = [];
  const vtrack = p.tracks.find(t => t.type === 'video' && t.clips.length);
  if (vtrack) {
    for (const c of vtrack.clips.slice().sort((a, b) => a.start - b.start)) {
      const m = store.media(c.mediaId);
      spine.push(
        `        <clip name="${esc(m ? m.name : 'clip')}" offset="${fr(c.start)}" duration="${fr(c.out - c.in)}" start="${fr(c.in)}">
          <video ref="${c.mediaId}" offset="${fr(c.start)}" duration="${fr(c.out - c.in)}" start="${fr(c.in)}"/>
        </clip>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat" frameDuration="${fd}" width="${p.width}" height="${p.height}"/>
${assets}
  </resources>
  <library>
    <event name="${esc(p.name)}">
      <project name="${esc(p.name)}">
        <sequence format="r1" duration="${fr(store.duration())}">
          <spine>
${spine.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}

/* ===================== IMPORT FCPXML (base) ===================== */
export function fromFCPXML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML non valido');

  const fmt = doc.querySelector('format');
  const fd = fmt ? fmt.getAttribute('frameDuration') : '1/30s';
  const fps = parseFps(fd);
  const w = fmt ? parseInt(fmt.getAttribute('width')) || 1280 : 1280;
  const h = fmt ? parseInt(fmt.getAttribute('height')) || 720 : 720;

  const project = {
    id: uid('prj'), name: (doc.querySelector('project')?.getAttribute('name')) || 'FCPXML',
    fps, width: w, height: h, sampleRate: 48000,
    media: [], tracks: [
      { id: uid('v'), type: 'video', name: 'V1', clips: [], mute: false, solo: false },
      { id: uid('a'), type: 'audio', name: 'A1', clips: [], mute: false, solo: false },
    ],
  };

  const idMap = {};
  doc.querySelectorAll('asset').forEach(a => {
    const m = {
      id: uid('m'), name: a.getAttribute('name') || 'asset',
      kind: a.getAttribute('hasVideo') === '1' ? 'video' : 'audio',
      src: a.getAttribute('src') || '', serverSrc: a.getAttribute('src') || '',
      duration: toSec(a.getAttribute('duration'), fps), width: w, height: h,
      hasAudio: a.getAttribute('hasAudio') === '1',
    };
    idMap[a.getAttribute('id')] = m.id;
    project.media.push(m);
  });

  const vtrack = project.tracks[0];
  doc.querySelectorAll('spine > clip, spine > video').forEach(node => {
    const ref = (node.querySelector('video') || node).getAttribute('ref') || node.getAttribute('ref');
    const mediaId = idMap[ref];
    if (!mediaId) return;
    const c = {
      id: uid('c'), mediaId,
      start: toSec(node.getAttribute('offset'), fps),
      in: toSec(node.getAttribute('start'), fps),
      out: toSec(node.getAttribute('start'), fps) + toSec(node.getAttribute('duration'), fps),
      gain: 1, fadeIn: 0, fadeOut: 0, transition: 0,
      fx: { brightness: 0, contrast: 0, saturation: 0, opacity: 1, scale: 1 },
    };
    vtrack.clips.push(c);
  });
  return project;
}

function parseFps(fd) {
  // "1/30s" -> 30 ; "1001/30000s" -> ~29.97
  const m = /(\d+)\/(\d+)/.exec(fd || '');
  if (!m) return 30;
  return Math.round(parseInt(m[2]) / parseInt(m[1]));
}
function toSec(v, fps) {
  if (!v) return 0;
  const m = /(\d+)\/(\d+)/.exec(v);
  if (m) return parseInt(m[1]) / parseInt(m[2]);
  const s = parseFloat(v);
  return isNaN(s) ? 0 : s;
}

/* download helper */
export function download(text, filename, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
