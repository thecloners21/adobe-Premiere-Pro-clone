/* =====================================================================
   settings.js — impostazioni applicative persistenti (localStorage).
   Le impostazioni di *sequenza* (fps, risoluzione, sample rate) vivono nel
   progetto; qui stanno le preferenze app: motore/render e proxy.
   ===================================================================== */

const KEY = 'cp-settings-v1';
const DEFAULTS = {
  defaultEngine: 'auto',   // auto | server | wasm
  serverBase: '',          // base URL del backend (vuoto = stessa origine)
  proxyWidth: 640,         // larghezza proxy predefinita
};

let cur = load();
function load() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch (_) { return { ...DEFAULTS }; }
}

export function getSettings() { return cur; }
export function saveSettings(patch) {
  cur = { ...cur, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (_) {}
  return cur;
}

/* base URL per le chiamate al backend (senza slash finale) */
export function serverBase() { return (cur.serverBase || '').replace(/\/+$/, ''); }
