// db.js — IndexedDB wrapper. Source of truth for all progress.
// Every public function catches errors and surfaces them as toasts.
import { toast } from './ui.js';
import { nowISO, hashStr } from './utils.js';

export const DB_NAME = 'english-mastery';
export const DB_VERSION = 3;
export const EXPORT_FORMAT = 1;

// Store definitions. Adding a store or index = bump DB_VERSION and add a case to migrate().
// Never remove or rename existing stores: migrations must be additive.
const STORES = {
  cards:    { keyPath: 'id', indexes: [['due', 'due'], ['deck', 'deck'], ['refId', 'refId'], ['state', 'state'], ['kind', 'kind']] },
  reviews:  { keyPath: 'id', indexes: [['cardId', 'cardId'], ['day', 'day'], ['ts', 'ts']] },
  attempts: { keyPath: 'id', indexes: [['refId', 'refId'], ['day', 'day'], ['kind', 'kind']] },
  mistakes: { keyPath: 'id', indexes: [['rule', 'rule'], ['day', 'day'], ['source', 'source'], ['count', 'count']] },
  daily:    { keyPath: 'day', indexes: [] },
  days:     { keyPath: 'day', indexes: [] },
  notes:    { keyPath: 'id', indexes: [['updatedAt', 'updatedAt'], ['tags', 'tags', { multiEntry: true }], ['attachedTo', 'attachedTo']] },
  threads:  { keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] },
  messages: { keyPath: 'id', indexes: [['threadId', 'threadId'], ['ts', 'ts']] },
  audio:    { keyPath: 'id', indexes: [['ts', 'ts']] },
  settings: { keyPath: 'key', indexes: [] },
  meta:     { keyPath: 'key', indexes: [] },
  custom:   { keyPath: 'id', indexes: [['kind', 'kind'], ['deck', 'deck']] }, // v2: user- and AI-generated content
  // v3 (Phase 7 — Infinite Input)
  lemmas:    { keyPath: 'lemma', indexes: [['state', 'state'], ['updatedAt', 'updatedAt']] },
  wordCache: { keyPath: 'lemma', indexes: [['cefr', 'cefr'], ['ts', 'ts']] },
  videos:    { keyPath: 'id', indexes: [['ts', 'ts'], ['status', 'status']] },
  texts:     { keyPath: 'id', indexes: [['ts', 'ts']] },
  generated: { keyPath: 'id', indexes: [['kind', 'kind'], ['refId', 'refId'], ['ts', 'ts']] },
  sessions:  { keyPath: 'id', indexes: [['day', 'day']] },
  tests:     { keyPath: 'id', indexes: [['kind', 'kind'], ['ts', 'ts']] },
  diary:     { keyPath: 'id', indexes: [['ts', 'ts']] },
  backups:   { keyPath: 'id', indexes: [['ts', 'ts']] },
};
export const STORE_NAMES = Object.keys(STORES);
// audio + diary hold Blobs (excluded from JSON export, documented in the UI); backups would nest exports.
const EXPORT_STORES = STORE_NAMES.filter((s) => !['audio', 'diary', 'backups'].includes(s));

let dbPromise = null;

// Write hooks: sync.js listens so cloud backup can run after changes.
const writeListeners = new Set();
export function onWrite(fn) { writeListeners.add(fn); return () => writeListeners.delete(fn); }
function notifyWrite(store) { for (const fn of writeListeners) { try { fn(store); } catch { /* ignore */ } } }

function migrate(db, oldVersion, tx) {
  // v1: all original stores. v2: adds `custom`. The loop below is additive, so any missing store or index is created
  // and existing data is never touched. Never remove or rename a store.
  for (const [name, def] of Object.entries(STORES)) {
    let store;
    if (!db.objectStoreNames.contains(name)) store = db.createObjectStore(name, { keyPath: def.keyPath });
    else store = tx.objectStore(name);
    for (const [idxName, keyPath, opts] of def.indexes) {
      if (!store.indexNames.contains(idxName)) store.createIndex(idxName, keyPath, opts || {});
    }
  }
}

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB not available')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => { migrate(req.result, e.oldVersion, req.transaction); };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; toast('Database updated in another tab. Reload to continue.', 'warn', { timeout: 8000 }); };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Failed to open database'));
    req.onblocked = () => toast('Database upgrade blocked by another tab. Close other tabs.', 'warn');
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
function txDone(tx) {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transaction aborted')); });
}

function fail(op, err) {
  console.error(`[db] ${op} failed`, err);
  const msg = (err && err.message) || String(err);
  if (/QuotaExceeded/i.test(msg) || (err && err.name === 'QuotaExceededError')) toast('Storage is full. Export your progress and clear old recordings.', 'err', { timeout: 8000 });
  else toast(`Storage error (${op}): ${msg}`, 'err', { timeout: 6000 });
  throw err;
}

export async function get(store, key) {
  try { const db = await open(); return await reqToPromise(db.transaction(store).objectStore(store).get(key)); }
  catch (e) { fail(`get ${store}`, e); }
}
export async function getAll(store, { index, query, count } = {}) {
  try {
    const db = await open();
    let src = db.transaction(store).objectStore(store);
    if (index) src = src.index(index);
    return await reqToPromise(src.getAll(query ?? null, count));
  } catch (e) { fail(`getAll ${store}`, e); }
}
export async function getAllKeys(store) {
  try { const db = await open(); return await reqToPromise(db.transaction(store).objectStore(store).getAllKeys()); }
  catch (e) { fail(`getAllKeys ${store}`, e); }
}
export async function count(store, { index, query } = {}) {
  try {
    const db = await open();
    let src = db.transaction(store).objectStore(store);
    if (index) src = src.index(index);
    return await reqToPromise(src.count(query ?? null));
  } catch (e) { fail(`count ${store}`, e); }
}
export async function put(store, value) {
  try {
    const db = await open();
    if (value && typeof value === 'object' && !(value instanceof Blob)) { value.updatedAt = nowISO(); if (value.v === undefined) value.v = 1; }
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await txDone(tx);
    notifyWrite(store);
    return value;
  } catch (e) { fail(`put ${store}`, e); }
}
export async function bulkPut(store, values) {
  try {
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const now = nowISO();
    for (const v of values) { if (v && typeof v === 'object') { v.updatedAt = v.updatedAt || now; if (v.v === undefined) v.v = 1; } os.put(v); }
    await txDone(tx);
    notifyWrite(store);
    return values.length;
  } catch (e) { fail(`bulkPut ${store}`, e); }
}
export async function del(store, key) {
  try { const db = await open(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); await txDone(tx); notifyWrite(store); }
  catch (e) { fail(`delete ${store}`, e); }
}
export async function clear(store) {
  try { const db = await open(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); await txDone(tx); }
  catch (e) { fail(`clear ${store}`, e); }
}
/** Iterate with a cursor over an index range; fn returns false to stop. */
export async function each(store, fn, { index, query, direction = 'next' } = {}) {
  try {
    const db = await open();
    let src = db.transaction(store).objectStore(store);
    if (index) src = src.index(index);
    await new Promise((res, rej) => {
      const req = src.openCursor(query ?? null, direction);
      req.onsuccess = () => { const c = req.result; if (!c) return res(); if (fn(c.value) === false) return res(); c.continue(); };
      req.onerror = () => rej(req.error);
    });
  } catch (e) { fail(`each ${store}`, e); }
}

/* ---------------- settings & meta ---------------- */
const settingsCache = new Map();
export async function getSetting(key, fallback = undefined) {
  if (settingsCache.has(key)) return settingsCache.get(key);
  const r = await get('settings', key);
  const v = r ? r.value : fallback;
  settingsCache.set(key, v);
  return v;
}
export async function setSetting(key, value) {
  settingsCache.set(key, value);
  await put('settings', { key, value });
  return value;
}
export async function getMeta(key) { const r = await get('meta', key); return r ? r.value : undefined; }
export async function setMeta(key, value) { return put('meta', { key, value }); }
export function clearSettingsCache() { settingsCache.clear(); }

/* ---------------- export / import ---------------- */
function checksum(stores) {
  return hashStr(JSON.stringify(stores)).toString(16);
}
export async function exportAll() {
  const stores = {};
  const counts = {};
  for (const s of EXPORT_STORES) {
    stores[s] = await getAll(s);
    counts[s] = stores[s].length;
  }
  return {
    app: 'english-mastery', format: EXPORT_FORMAT, schemaVersion: DB_VERSION,
    exportedAt: nowISO(), userAgent: navigator.userAgent, counts, checksum: checksum(stores), stores,
  };
}
export function validateExport(data) {
  const problems = [];
  if (!data || typeof data !== 'object') return ['Not a JSON object'];
  if (data.app !== 'english-mastery') problems.push('Not an English Mastery export (app field)');
  if (typeof data.format !== 'number' || data.format > EXPORT_FORMAT) problems.push(`Unsupported export format ${data.format}`);
  if (!data.stores || typeof data.stores !== 'object') { problems.push('Missing stores'); return problems; }
  if (data.checksum && checksum(data.stores) !== data.checksum) problems.push('Checksum mismatch: the file was modified or truncated');
  for (const [name, rows] of Object.entries(data.stores)) {
    if (!STORES[name]) { problems.push(`Unknown store "${name}" (will be skipped)`); continue; }
    if (!Array.isArray(rows)) { problems.push(`Store ${name} is not an array`); continue; }
    const kp = STORES[name].keyPath;
    const bad = rows.findIndex((r) => !r || typeof r !== 'object' || r[kp] === undefined);
    if (bad >= 0) problems.push(`Store ${name}: row ${bad} has no "${kp}"`);
  }
  return problems;
}
/** mode: 'replace' (wipe then load) or 'merge' (newer updatedAt wins) */
export async function importAll(data, mode = 'merge') {
  const db = await open();
  const summary = {};
  for (const [name, rows] of Object.entries(data.stores)) {
    if (!STORES[name] || !Array.isArray(rows)) continue;
    try {
      const tx = db.transaction(name, 'readwrite');
      const os = tx.objectStore(name);
      if (mode === 'replace') os.clear();
      let written = 0;
      if (mode === 'merge') {
        const existing = new Map((await reqToPromise(os.getAll())).map((r) => [r[STORES[name].keyPath], r]));
        for (const r of rows) {
          const cur = existing.get(r[STORES[name].keyPath]);
          if (!cur || !cur.updatedAt || !r.updatedAt || r.updatedAt >= cur.updatedAt) { os.put(r); written++; }
        }
      } else {
        for (const r of rows) { os.put(r); written++; }
      }
      await txDone(tx);
      summary[name] = written;
    } catch (e) { fail(`import ${name}`, e); }
  }
  clearSettingsCache();
  return summary;
}
export async function wipeAll() {
  for (const s of STORE_NAMES) await clear(s);
  clearSettingsCache();
}
export async function estimateUsage() {
  try {
    if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; }
  } catch { /* ignore */ }
  return { usage: 0, quota: 0 };
}
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
