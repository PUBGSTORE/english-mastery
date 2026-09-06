// lemmas.js — the word-state model: unknown 0 · learning 1 · familiar 2 · known 3 · ignored -1.
import * as db from './db.js';
import { load, allVocab } from './content.js';
import { lemmatise, ready as lemmaReady, bandOf, isStop } from './lemma.js';
import { isMastered, isLearned } from './srs.js';
import { nowISO } from './utils.js';

export const STATE = { unknown: 0, learning: 1, familiar: 2, known: 3, ignored: -1 };
export const STATE_LABEL = { 0: 'unknown', 1: 'learning', 2: 'familiar', 3: 'known', '-1': 'ignored' };

let cache = null; // Map lemma → record

export async function all() {
  if (cache) return cache;
  const rows = await db.getAll('lemmas');
  cache = new Map(rows.map((r) => [r.lemma, r]));
  return cache;
}
export async function stateOf(lemma) { const m = await all(); const r = m.get(lemma); return r ? r.state : 0; }
export async function setState(lemma, state, source = 'user') {
  const m = await all();
  const r = { lemma, state, source, updatedAt: nowISO() };
  m.set(lemma, r);
  await db.put('lemmas', r);
  return r;
}
export async function setMany(entries, source) {
  const m = await all();
  const rows = entries.map(([lemma, state]) => ({ lemma, state, source, updatedAt: nowISO() }));
  for (const r of rows) m.set(r.lemma, r);
  if (rows.length) await db.bulkPut('lemmas', rows);
}

/**
 * Seed from SRS cards and shipped decks. Runs once per day at most; never downgrades a state the user set by hand.
 * cards with interval ≥ 21 → known; other reviewed cards → learning; deck words with no card → familiar.
 */
export async function seed({ force = false } = {}) {
  const last = await db.getSetting('lemmaSeedAt', null);
  if (!force && last && Date.now() - new Date(last).getTime() < 12 * 3600000) return { skipped: true };
  await lemmaReady();
  const m = await all();
  const cards = await db.getAll('cards');
  const vocab = await allVocab();
  const byRef = new Map(cards.filter((c) => c.kind === 'vocab').map((c) => [c.refId, c]));
  const updates = [];
  const consider = (lemma, state, source) => {
    const cur = m.get(lemma);
    if (cur && cur.source === 'user') return;            // manual decisions win
    if (cur && cur.state === STATE.ignored) return;
    if (!cur || cur.state < state || (cur.source !== 'user' && cur.state !== state && source === 'srs')) updates.push([lemma, state, source]);
  };
  for (const w of vocab) {
    const head = w.word.toLowerCase();
    if (head.includes(' ')) continue;
    const lemma = lemmatise(head);
    const c = byRef.get(w.id);
    if (c && isMastered(c)) consider(lemma, STATE.known, 'srs');
    else if (c && isLearned(c)) consider(lemma, STATE.learning, 'srs');
    else consider(lemma, STATE.familiar, 'deck');
  }
  if (updates.length) {
    const rows = updates.map(([lemma, state, source]) => ({ lemma, state, source, updatedAt: nowISO() }));
    for (const r of rows) m.set(r.lemma, r);
    await db.bulkPut('lemmas', rows);
  }
  await db.setSetting('lemmaSeedAt', nowISO());
  return { updated: updates.length };
}

/** Counts per band and coverage estimates. */
export async function coverage() {
  await lemmaReady();
  const freq = await load('frequency-5000');
  const m = await all();
  const bands = [1, 2, 3, 4, 5].map((b) => ({ band: b, total: 0, known: 0, learning: 0, familiar: 0 }));
  for (const f of freq) {
    const b = bands[f.b - 1]; b.total++;
    const st = m.get(f.l);
    const s = st ? st.state : (isStop(f.l) ? STATE.known : 0);
    if (s === STATE.known) b.known++; else if (s === STATE.learning) b.learning++; else if (s === STATE.familiar) b.familiar++;
  }
  const share = bands.map((b) => (b.known + 0.5 * b.familiar + 0.5 * b.learning) / b.total);
  const W = { general: [0.72, 0.08, 0.04, 0.025, 0.02, 0.115], news: [0.65, 0.10, 0.06, 0.04, 0.03, 0.12], academic: [0.58, 0.10, 0.07, 0.05, 0.04, 0.16] };
  const est = {};
  for (const [k, w] of Object.entries(W)) {
    let s = 0; for (let i = 0; i < 5; i++) s += share[i] * w[i];
    // Beyond 5000: assume the learner knows a fraction proportional to band-5 share, discounted.
    s += w[5] * share[4] * 0.6;
    est[k] = Math.round(s * 100);
  }
  const knownTotal = [...m.values()].filter((r) => r.state === STATE.known).length;
  return { bands, share, est, knownTotal, learningTotal: [...m.values()].filter((r) => r.state === STATE.learning).length };
}

/** Highest-value unknown lemmas by frequency (skipping stoplist, ignored, and words already in decks/cards). */
export async function nextWords(n = 20) {
  await lemmaReady();
  const freq = await load('frequency-5000');
  const m = await all();
  const out = [];
  for (const f of freq) {
    if (isStop(f.l) || f.l.length < 3) continue;
    const st = m.get(f.l);
    if (st && st.state !== STATE.unknown) continue;
    out.push({ lemma: f.l, rank: f.r, band: f.b });
    if (out.length >= n) break;
  }
  return out;
}
export function invalidate() { cache = null; }
