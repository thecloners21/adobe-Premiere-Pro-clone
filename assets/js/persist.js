/* =====================================================================
   persist.js — persistenza locale automatica:
   • struttura progetto (EDL/titoli/effetti) in localStorage
   • file media (blob) in IndexedDB, per ricostruirli dopo il refresh
   Nessuna dipendenza da altri moduli (evita import circolari).
   ===================================================================== */

const LS_KEY = 'cp-autosave-v1';
const DB_NAME = 'clonepremiere';
const STORE = 'media';
const DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    let r;
    try { r = indexedDB.open(DB_NAME, DB_VER); }
    catch (e) { return reject(e); }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/* ---------- blob dei media (IndexedDB) ---------- */
export async function putBlob(id, file) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(file, id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  } catch (_) { return false; }
}

export async function getBlob(id) {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  } catch (_) { return null; }
}

export async function clearBlobs() {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  } catch (_) { return false; }
}

/* ---------- struttura progetto (localStorage) ---------- */
export function saveProjectLocal(projectJson) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(projectJson)); return true; }
  catch (_) { return false; }   // quota superata: si ignora
}

export function loadProjectLocal() {
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; }
  catch (_) { return null; }
}

export function clearProjectLocal() {
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
}
