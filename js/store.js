// store.js — high-level progress operations on top of db.js. Views use this, not db directly.
import * as db from './db.js';
import * as srs from './srs.js';
import { uid, nowISO, todayKey, dayKey, addDays, daysBetween, mulberry32, hashStr, shuffle, cefrIndex, CEFR, normalize } from './utils.js';
import { VOCAB_DECKS, loadDeck, wordById, deckOfWord } from './content.js';

export const DEFAULTS = {
  level: 'A2', newPerDay: 10, reviewPerDay: 100, hindiDefault: false, voice: '', ttsRate: 1.0,
  streakFreezes: 1, lastExport: null, placementDone: false, dailyGoalMin: 15, autoDaily5: true,
};

export async function settings() {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) { const v = await db.getSetting(k, undefined); if (v !== undefined && v !== null) out[k] = v; }
  return out;
}
export const getSetting = (k) => db.getSetting(k, DEFAULTS[k]);
export const setSetting = db.setSetting;

/* ---------------- cards ---------------- */
export async function allCards() { return db.getAll('cards'); }
export async function getCard(id) { return db.get('cards', id); }
export async function cardsForRef(refId) { return db.getAll('cards', { index: 'refId', query: refId }); }
export const vocabCardId = (wordId) => `card:${wordId}`;

/** Ensure vocab cards exist for the given word ids. priority>0 bypasses new-card cap (used by Daily 5). */
export async function ensureVocabCards(wordIds, { priority = 0 } = {}) {
  const created = [];
  const toPut = [];
  for (const wid of wordIds) {
    const id = vocabCardId(wid);
    const existing = await db.get('cards', id);
    if (existing) { if (priority && !(existing.priority > 0) && existing.state === 'new') { existing.priority = priority; toPut.push(existing); } continue; }
    const c = srs.newCard({ id, refId: wid, deck: deckOfWord(wid) || 'vocab', kind: 'vocab', cardType: 'rotate' });
    if (priority) c.priority = priority;
    toPut.push(c); created.push(c);
  }
  if (toPut.length) await db.bulkPut('cards', toPut);
  return created;
}
export async function addDeckToSrs(deckId) {
  const rows = await loadDeck(deckId);
  const created = await ensureVocabCards(rows.map((w) => w.id));
  await bumpDay({ newCards: 0 });
  return created.length;
}
export async function removeDeckFromSrs(deckId) {
  const cards = await db.getAll('cards', { index: 'deck', query: deckId });
  for (const c of cards) await db.del('cards', c.id);
  return cards.length;
}
export async function deckStats(deckId) {
  const cards = await db.getAll('cards', { index: 'deck', query: deckId });
  return {
    total: cards.length,
    learned: cards.filter(srs.isLearned).length,
    mastered: cards.filter(srs.isMastered).length,
    due: srs.dueCount(cards),
  };
}
/** Generic card creation for non-vocab atoms. Returns existing if present. */
export async function ensureCard({ id, refId, deck, kind, cardType = null, payload = {}, priority = 0 }) {
  const existing = await db.get('cards', id);
  if (existing) return existing;
  const c = srs.newCard({ id, refId, deck, kind, cardType, payload });
  if (priority) c.priority = priority;
  await db.put('cards', c);
  return c;
}
export async function suspendCard(id, suspended = true) {
  const c = await db.get('cards', id);
  if (!c) return;
  c.suspended = suspended;
  await db.put('cards', c);
}
export async function deleteCard(id) { return db.del('cards', id); }

/* ---------------- reviews ---------------- */
export async function reviewQueue(opts = {}) {
  const cards = await allCards();
  const s = await settings();
  const today = await getDay(todayKey());
  return srs.buildQueue(cards, {
    newPerDay: s.newPerDay, reviewPerDay: s.reviewPerDay,
    newToday: today.newCards || 0, reviewsToday: today.reviews || 0, ...opts,
  });
}
export async function dueSummary() {
  const cards = await allCards();
  const s = await settings();
  const today = await getDay(todayKey());
  const q = srs.buildQueue(cards, { newPerDay: s.newPerDay, reviewPerDay: s.reviewPerDay, newToday: today.newCards || 0, reviewsToday: today.reviews || 0 });
  return { ...q.counts, totalCards: cards.length, learned: cards.filter(srs.isLearned).length, mastered: cards.filter(srs.isMastered).length };
}
/** Apply a grade: updates card, logs review, updates day aggregate. Returns updated card. */
export async function gradeCard(card, grade, { elapsedMs = 0, face = null } = {}) {
  const wasNew = card.state === 'new';
  const updated = srs.schedule(card, grade);
  if (updated.priority) delete updated.priority;
  await db.put('cards', updated);
  await db.put('reviews', { id: uid('rv'), cardId: card.id, refId: card.refId, kind: card.kind, grade, face, day: todayKey(), ts: nowISO(), elapsedMs, wasNew, interval: updated.interval });
  await bumpDay({ reviews: 1, newCards: wasNew ? 1 : 0, skill: skillOfKind(card.kind) });
  return updated;
}
function skillOfKind(kind) {
  return ({ vocab: 'vocab', collocation: 'vocab', grammar: 'grammar', mistake: 'grammar', correction: 'writing', phoneme: 'pronunciation', pair: 'pronunciation', shadow: 'pronunciation', dictation: 'listening', note: 'vocab' })[kind] || 'vocab';
}
export async function reviewsForCard(cardId) { return db.getAll('reviews', { index: 'cardId', query: cardId }); }
export async function reviewsForRef(refId) { const all = await db.getAll('reviews'); return all.filter((r) => r.refId === refId); }
export async function allReviews() { return db.getAll('reviews'); }

/* ---------------- days / streak / study time ---------------- */
export async function getDay(day) { return (await db.get('days', day)) || { day, reviews: 0, newCards: 0, studyMs: 0, skills: {}, attempts: 0, v: 1 }; }
export async function bumpDay({ reviews = 0, newCards = 0, studyMs = 0, skill = null, attempts = 0 } = {}, day = todayKey()) {
  const d = await getDay(day);
  d.reviews += reviews; d.newCards += newCards; d.studyMs += studyMs; d.attempts = (d.attempts || 0) + attempts;
  if (skill) { d.skills ||= {}; d.skills[skill] = (d.skills[skill] || 0) + 1; }
  await db.put('days', d);
  return d;
}
export async function addStudyTime(ms) { return bumpDay({ studyMs: ms }); }
export async function allDays() { return db.getAll('days'); }
const isActive = (d) => d && ((d.reviews || 0) > 0 || (d.attempts || 0) > 0 || (d.studyMs || 0) >= 5 * 60000);

/** Streak with freezes. Returns { current, best, frozenDays[], freezesLeft, activeToday } */
export async function streak() {
  const days = await allDays();
  const map = new Map(days.map((d) => [d.day, d]));
  const s = await settings();
  const freezesRecord = (await db.getSetting('freezeLog', [])) || [];
  const usedFreezes = new Set(freezesRecord);
  const today = todayKey();
  let cur = 0; let d = today; const frozen = [];
  const activeToday = isActive(map.get(today));
  if (!activeToday) d = dayKey(addDays(new Date(), -1)); // today doesn't break the streak yet
  let available = s.streakFreezes;
  while (true) {
    const rec = map.get(d);
    if (isActive(rec)) { cur++; }
    else if (usedFreezes.has(d)) { frozen.push(d); }
    else if (available > 0 && cur > 0 && d !== today) {
      // consume a freeze for this gap
      available--; frozen.push(d); freezesRecord.push(d);
      await db.setSetting('freezeLog', freezesRecord);
      await db.setSetting('streakFreezes', available);
    } else break;
    d = dayKey(addDays(new Date(d + 'T12:00:00'), -1));
    if (cur > 2000) break;
  }
  // best streak
  const active = days.filter(isActive).map((x) => x.day).sort();
  let best = 0, run = 0, prev = null;
  for (const k of active) { run = prev && daysBetween(prev, k) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = k; }
  best = Math.max(best, cur);
  // Earn a freeze every 7 consecutive active days (max 3)
  if (cur > 0 && cur % 7 === 0) {
    const earnedKey = `freezeEarned:${cur}`;
    if (!(await db.getSetting(earnedKey, false))) {
      await db.setSetting(earnedKey, true);
      const nf = Math.min(3, (await db.getSetting('streakFreezes', DEFAULTS.streakFreezes)) + 1);
      await db.setSetting('streakFreezes', nf);
      available = nf;
    }
  }
  return { current: cur, best, frozenDays: frozen, freezesLeft: available, activeToday };
}

/* ---------------- Daily 5 ---------------- */
export async function daily5(day = todayKey()) {
  const existing = await db.get('daily', day);
  if (existing) return existing;
  const s = await settings();
  const lvlIdx = cefrIndex(s.level);
  const decks = VOCAB_DECKS.filter((d) => { const i = cefrIndex(d.cefr); return i === lvlIdx || i === lvlIdx - 1; });
  const pool = [];
  for (const d of decks) pool.push(...(await loadDeck(d.id)));
  // exclude words already in SRS and past daily sets
  const cards = await allCards();
  const inSrs = new Set(cards.map((c) => c.refId));
  const past = await db.getAll('daily');
  const used = new Set(past.flatMap((p) => p.wordIds));
  let candidates = pool.filter((w) => !inSrs.has(w.id) && !used.has(w.id));
  if (candidates.length < 5) candidates = pool.filter((w) => !used.has(w.id));
  if (candidates.length < 5) candidates = pool;
  const rng = mulberry32(hashStr(`${day}|${s.level}`));
  const picked = shuffle(candidates, rng).slice(0, 5).map((w) => w.id);
  const rec = { day, wordIds: picked, completed: false, completedAt: null, level: s.level, createdAt: nowISO() };
  await db.put('daily', rec);
  if (picked.length) await ensureVocabCards(picked, { priority: 2 });
  return rec;
}
export async function completeDaily(day = todayKey()) {
  const rec = await db.get('daily', day);
  if (!rec) return;
  rec.completed = true; rec.completedAt = nowISO();
  await db.put('daily', rec);
  await bumpDay({ attempts: 1, skill: 'vocab' });
}
export async function dailyHistory() {
  const all = await db.getAll('daily');
  return all.sort((a, b) => b.day.localeCompare(a.day));
}
export async function wordRetention(wordId) {
  const revs = await db.getAll('reviews', { index: 'cardId', query: vocabCardId(wordId) });
  return srs.retention(revs);
}

/* ---------------- attempts (pronunciation, dictation, shadowing) ---------------- */
export async function logAttempt({ kind, refId, accuracy = null, fluency = null, completeness = null, transcript = '', selfRating = null, extra = {} }) {
  const a = { id: uid('at'), kind, refId, accuracy, fluency, completeness, transcript, selfRating, ...extra, day: todayKey(), ts: nowISO() };
  await db.put('attempts', a);
  const skill = ['dictation', 'numbers', 'dates', 'spelling'].includes(kind) ? 'listening' : kind === 'speaking' ? 'speaking' : ['writing', 'translate'].includes(kind) ? 'writing' : ['stress', 'sentence-stress'].includes(kind) ? 'pronunciation' : 'pronunciation';
  await bumpDay({ attempts: 1, skill });
  return a;
}
export async function attemptsFor(refId) { return db.getAll('attempts', { index: 'refId', query: refId }); }
export async function attemptsByKind(kind) { return db.getAll('attempts', { index: 'kind', query: kind }); }
export async function allAttempts() { return db.getAll('attempts'); }

/* ---------------- mistakes ---------------- */
/**
 * Log a mistake. Same normalised (original → fix) increments count instead of duplicating.
 * source: 'vocab' | 'grammar' | 'dictation' | 'pronunciation' | 'writing' | 'speaking' | 'placement'
 */
export async function logMistake({ source, refId = null, lessonId = null, original, fix, rule = 'general', why_en = '', why_hi = '', makeCard = true }) {
  if (!original || !fix) return null;
  const key = `mk:${hashStr(normalize(original) + '→' + normalize(fix))}`;
  let m = await db.get('mistakes', key);
  if (m) { m.count = (m.count || 1) + 1; m.lastAt = nowISO(); m.day = todayKey(); }
  else m = { id: key, source, refId, lessonId, original, fix, rule, why_en, why_hi, count: 1, day: todayKey(), firstAt: nowISO(), lastAt: nowISO(), resolved: false };
  await db.put('mistakes', m);
  if (makeCard) {
    await ensureCard({ id: `card:${key}`, refId: key, deck: 'mistakes', kind: 'mistake', payload: { original, fix, rule, why_en, why_hi, lessonId, source }, priority: 1 });
  }
  return m;
}
export async function allMistakes() { return db.getAll('mistakes'); }
export async function topMistakes(n = 5) {
  const all = await allMistakes();
  return all.filter((m) => !m.resolved).sort((a, b) => (b.count - a.count) || (b.lastAt || '').localeCompare(a.lastAt || '')).slice(0, n);
}
export async function resolveMistake(id, resolved = true) {
  const m = await db.get('mistakes', id);
  if (!m) return;
  m.resolved = resolved;
  await db.put('mistakes', m);
  if (resolved) await suspendCard(`card:${id}`, true); else await suspendCard(`card:${id}`, false);
}
export async function deleteMistake(id) { await db.del('mistakes', id); await db.del('cards', `card:${id}`); }

/* ---------------- notes ---------------- */
export async function saveNote(note) {
  if (!note.id) { note.id = uid('nt'); note.createdAt = nowISO(); }
  note.tags = (note.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  await db.put('notes', note);
  return note;
}
export async function allNotes() { const all = await db.getAll('notes'); return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); }
export async function notesFor(refId) { return db.getAll('notes', { index: 'attachedTo', query: refId }); }
export async function deleteNote(id) { return db.del('notes', id); }

/* ---------------- level ---------------- */
export async function level() { return getSetting('level'); }
export async function setLevel(l) { if (CEFR.includes(l)) await setSetting('level', l); }
export function isUnlocked(itemLevel, userLevel) { return cefrIndex(itemLevel) <= cefrIndex(userLevel) + 1; }

/* ---------------- skill scores (for radar) ---------------- */
export async function skillScores() {
  const cards = await allCards();
  const reviews = await allReviews();
  const attempts = await allAttempts();
  const recent = (arr, days = 30) => { const cutoff = dayKey(addDays(new Date(), -days)); return arr.filter((r) => r.day >= cutoff); };
  const rate = (arr) => arr.length ? Math.round((arr.filter((r) => r.grade > 0).length / arr.length) * 100) : 0;
  const rv = recent(reviews);
  const at = recent(attempts);
  const avgOf = (arr, key) => { const v = arr.map((a) => a[key]).filter((x) => typeof x === 'number'); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0; };
  const pron = at.filter((a) => ['pair', 'phoneme', 'shadow', 'sentence', 'twister'].includes(a.kind));
  const listen = at.filter((a) => ['dictation', 'numbers', 'dates', 'spelling'].includes(a.kind));
  const speak = at.filter((a) => a.kind === 'speaking');
  const writing = at.filter((a) => a.kind === 'writing');
  const vocabCards = cards.filter((c) => c.kind === 'vocab' || c.kind === 'collocation');
  const vocabScore = Math.min(100, Math.round((vocabCards.filter(srs.isMastered).length / 300) * 60 + rate(rv.filter((r) => r.kind === 'vocab')) * 0.4));
  return {
    Vocab: vocabScore,
    Grammar: Math.min(100, Math.round(rate(rv.filter((r) => r.kind === 'grammar' || r.kind === 'mistake')) * 0.6 + Math.min(40, cards.filter((c) => c.kind === 'grammar' && srs.isLearned(c)).length * 2))),
    Listening: avgOf(listen, 'accuracy'),
    Speaking: speak.length ? avgOf(speak, 'accuracy') : 0,
    Pronunciation: pron.length ? Math.round((avgOf(pron, 'accuracy') || avgOf(pron, 'selfRating') * 20)) : 0,
    Writing: writing.length ? avgOf(writing, 'accuracy') : 0,
  };
}

/* ---------------- study timer ---------------- */
let timerStart = null; let timerAcc = 0; let flushTimer = null;
function visible() { return document.visibilityState === 'visible'; }
export function startStudyTimer() {
  if (timerStart !== null) return;
  timerStart = Date.now();
  flushTimer = setInterval(flushStudyTime, 60000);
  document.addEventListener('visibilitychange', () => { if (visible()) { if (timerStart === null) timerStart = Date.now(); } else flushStudyTime(); });
  window.addEventListener('pagehide', flushStudyTime);
}
export async function flushStudyTime() {
  if (timerStart === null) return;
  const delta = Date.now() - timerStart;
  timerStart = visible() ? Date.now() : null;
  timerAcc += delta;
  if (timerAcc >= 30000) { const ms = Math.min(timerAcc, 10 * 60000); timerAcc = 0; try { await addStudyTime(ms); } catch { /* toasted */ } }
}
