// sync.js — cloud backup to a private GitHub Gist. Your GitHub account is the "account".
// Token (classic, scope: gist) lives only in IndexedDB. Data goes only to api.github.com.
import * as db from './db.js';
import { toast } from './ui.js';
import { debounce } from './utils.js';

const API = 'https://api.github.com';
const FILE = 'english-mastery-backup.json';
const MIN_GAP_MS = 5 * 60000;      // never back up more often than this
const IDLE_MS = 90 * 1000;         // back up this long after the last change
// Stores whose writes should not trigger a backup on their own (too chatty or already covered)
const QUIET = new Set(['audio', 'meta']);

let dirty = false; let inflight = null; let lastRun = 0; let started = false;
const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(s) { for (const fn of listeners) { try { fn(s); } catch { /* ignore */ } } }

export const getToken = () => db.getSetting('ghToken', '');
export const getGistId = () => db.getSetting('gistId', '');
export async function isConfigured() { return !!(await getToken()); }

async function gh(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  if (!token) throw new Error('NO_TOKEN');
  const res = await fetch(API + path, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('GitHub rejected this token (401). Gists need a CLASSIC token (github.com/settings/tokens → "Generate new token (classic)") with the gist box ticked; fine-grained tokens do not work for gists. Also check it was pasted completely and has not expired.');
  if (res.status === 403 && /rate limit/i.test(await res.clone().text())) throw new Error('GitHub rate limit hit. Try again later.');
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (!res.ok) { let m = res.status; try { m = (await res.json()).message || m; } catch { /* ignore */ } throw new Error(`GitHub error: ${m}`); }
  return res.json();
}

export async function whoAmI() { const u = await gh('/user'); return u.login; }

/** Find an existing backup gist on this account (so a new device restores without knowing the id). */
export async function findGist() {
  let id = await getGistId();
  if (id) { try { await gh(`/gists/${id}`); return id; } catch (e) { if (e.message !== 'NOT_FOUND') throw e; } }
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files && g.files[FILE]);
    if (hit) { await db.setSetting('gistId', hit.id); return hit.id; }
    if (list.length < 100) break;
  }
  return null;
}

/** Upload the full export. */
export async function backup({ reason = 'manual', silent = false } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    emit('saving');
    try {
      const data = await db.exportAll();
      const content = JSON.stringify(data);
      let id = await getGistId();
      const body = { description: `English Mastery backup (${data.counts.cards} cards, ${data.counts.reviews} reviews)`, files: { [FILE]: { content } } };
      if (id) {
        try { await gh(`/gists/${id}`, { method: 'PATCH', body }); }
        catch (e) { if (e.message === 'NOT_FOUND') { id = null; } else throw e; }
      }
      if (!id) { const g = await gh('/gists', { method: 'POST', body: { ...body, public: false } }); await db.setSetting('gistId', g.id); }
      dirty = false; lastRun = Date.now();
      await db.setSetting('lastCloudBackup', new Date().toISOString());
      await db.setSetting('lastCloudBackupBytes', content.length);
      emit('ok');
      if (!silent) toast('Backed up to your GitHub Gist', 'ok', { timeout: 2000 });
      return true;
    } catch (e) {
      emit('error');
      if (e.message === 'NO_TOKEN') return false;
      console.warn('[sync] backup failed', e);
      if (!silent || reason === 'manual') toast(`Cloud backup failed: ${e.message}`, 'err', { timeout: 6000 });
      return false;
    } finally { inflight = null; }
  })();
  return inflight;
}

/** Download the remote backup (parsed). Returns null if none. */
export async function fetchRemote() {
  const id = await findGist();
  if (!id) return null;
  const g = await gh(`/gists/${id}`);
  const f = g.files[FILE];
  if (!f) return null;
  let text = f.content;
  if (f.truncated || !text) { const r = await fetch(f.raw_url); text = await r.text(); }
  const data = JSON.parse(text);
  return { data, updatedAt: g.updated_at, id, size: f.size };
}

export async function restore(mode = 'merge') {
  const remote = await fetchRemote();
  if (!remote) throw new Error('No cloud backup found on this GitHub account.');
  const problems = db.validateExport(remote.data).filter((p) => !p.includes('will be skipped'));
  if (problems.length) throw new Error('Backup file invalid: ' + problems.join('; '));
  const summary = await db.importAll(remote.data, mode);
  await db.setSetting('lastCloudRestore', new Date().toISOString());
  return { summary, remote };
}

/* ---------------- automatic backups ---------------- */
const scheduleIdle = debounce(() => { if (dirty) backup({ reason: 'auto', silent: true }); }, IDLE_MS);
export function start() {
  if (started) return; started = true;
  db.onWrite((store) => {
    if (QUIET.has(store)) return;
    if (store === 'settings') return; // settings writes include our own bookkeeping
    dirty = true;
    if (Date.now() - lastRun >= MIN_GAP_MS) scheduleIdle();
    else setTimeout(() => { if (dirty) scheduleIdle(); }, MIN_GAP_MS - (Date.now() - lastRun));
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty && Date.now() - lastRun > 60000) backup({ reason: 'auto', silent: true }); });
  // Daily safety net even if nothing changed recently
  setInterval(async () => { if (!(await isConfigured())) return; const last = await db.getSetting('lastCloudBackup', null); if (!last || Date.now() - new Date(last).getTime() > 24 * 3600000) backup({ reason: 'auto', silent: true }); }, 30 * 60000);
}
export function markDirty() { dirty = true; scheduleIdle(); }
export const isDirty = () => dirty;
