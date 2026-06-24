/* =====================================================================
   api-client.js — chiamate al backend PHP (best-effort)
   L'endpoint base è configurabile dalle Impostazioni (server ffmpeg remoto).
   ===================================================================== */
import { serverBase } from './settings.js';

function api(path) {
  const b = serverBase();
  return (b ? b + '/' : '') + 'api/' + path;
}

export async function checkEngine() {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(api('export.php?probe=1'), { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) return { server: false };
    return await r.json();   // { server: true/false, ffmpeg: "..." }
  } catch (_) { return { server: false }; }
}

export async function uploadMedia(file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const r = await fetch(api('upload.php'), { method: 'POST', body: fd });
  if (!r.ok) throw new Error('upload HTTP ' + r.status);
  return await r.json();     // { ok, path, name }
}

export async function saveProject(project) {
  const r = await fetch(api('project_save.php'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  if (!r.ok) throw new Error('save HTTP ' + r.status);
  return await r.json();     // { ok, id }
}

export async function listProjects() {
  const r = await fetch(api('project_list.php'), { cache: 'no-store' });
  if (!r.ok) throw new Error('list HTTP ' + r.status);
  return await r.json();     // { ok, projects:[{id,name,updated}] }
}

export async function loadProject(id) {
  const r = await fetch(api('project_load.php?id=' + encodeURIComponent(id)), { cache: 'no-store' });
  if (!r.ok) throw new Error('load HTTP ' + r.status);
  return await r.json();     // { ok, project }
}

export async function serverExport(project, opts) {
  const r = await fetch(api('export.php'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, opts }),
  });
  if (!r.ok) throw new Error('export HTTP ' + r.status);
  return await r.json();     // { ok, url, log }
}
