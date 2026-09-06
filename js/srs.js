// srs.js — SM-2 scheduling. Pure functions; no DB access.
import { nowISO, fmtInterval } from './utils.js';

export const GRADES = ['Again', 'Hard', 'Good', 'Easy'];
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.0;
export const MAX_INTERVAL = 365;
const MIN = 1 / 1440; // one minute in days

// Learning steps in days
const STEPS = { again: 1 * MIN, hard: 6 * MIN, good: 10 * MIN, graduate: 1, easy: 4 };
const MISTAKE = { ease: 2.2, graduate: 1, easy: 3 };

/** Card kinds that are re-tested more aggressively */
export const AGGRESSIVE_KINDS = new Set(['mistake', 'correction']);

export function newCard({ id, refId, deck, kind, cardType = null, payload = {}, due = null }) {
  const now = nowISO();
  return {
    id, refId, deck, kind, cardType, payload,
    ease: AGGRESSIVE_KINDS.has(kind) ? MISTAKE.ease : 2.5,
    interval: 0, reps: 0, lapses: 0, state: 'new',
    due: due || now, lastReview: null, createdAt: now, updatedAt: now, v: 1,
  };
}

function fuzz(days) {
  if (days < 3) return days;
  const f = 1 + (Math.random() * 0.1 - 0.05);
  return days * f;
}

/**
 * Apply an SM-2 grade to a card. Returns a NEW card object (does not mutate).
 * grade: 0 Again, 1 Hard, 2 Good, 3 Easy
 */
export function schedule(card, grade, now = new Date()) {
  const c = { ...card };
  const aggressive = AGGRESSIVE_KINDS.has(c.kind);
  let ease = c.ease ?? 2.5;
  let interval = c.interval ?? 0;
  let state = c.state || 'new';

  if (state === 'new' || state === 'learning' || state === 'relearning') {
    if (grade === 0) { interval = STEPS.again; state = state === 'relearning' ? 'relearning' : 'learning'; if (state === 'relearning') { /* lapses already counted */ } }
    else if (grade === 1) { interval = STEPS.hard; state = state === 'new' ? 'learning' : state; }
    else if (grade === 2) {
      // From learning: first Good → 10 min step; second Good → graduate.
      if (state === 'new') { interval = STEPS.good; state = 'learning'; }
      else if (state === 'relearning') { interval = Math.max(1, Math.round((c.interval > 1 ? c.interval * 0.5 : 1))); state = 'review'; }
      else if ((c.interval || 0) < STEPS.good) { interval = STEPS.good; state = 'learning'; }
      else { interval = aggressive ? MISTAKE.graduate : STEPS.graduate; state = 'review'; }
    } else {
      interval = aggressive ? MISTAKE.easy : STEPS.easy; state = 'review';
      ease = Math.min(MAX_EASE, ease + 0.15);
    }
  } else {
    // review state
    if (grade === 0) {
      c.lapses = (c.lapses || 0) + 1;
      ease = Math.max(MIN_EASE, ease - 0.2);
      interval = STEPS.again; state = 'relearning';
      c.lapseInterval = c.interval;
    } else if (grade === 1) {
      ease = Math.max(MIN_EASE, ease - 0.15);
      interval = Math.max(interval + 1, interval * 1.2);
    } else if (grade === 2) {
      interval = Math.max(interval + 1, interval * ease);
    } else {
      ease = Math.min(MAX_EASE, ease + 0.15);
      interval = Math.max(interval + 2, interval * ease * 1.3);
    }
    if (aggressive) interval = interval * 0.8;
    interval = Math.min(MAX_INTERVAL, fuzz(interval));
  }

  c.ease = Math.round(ease * 100) / 100;
  c.interval = interval;
  c.state = state;
  c.reps = (c.reps || 0) + 1;
  c.lastReview = now.toISOString();
  c.due = new Date(now.getTime() + interval * 86400000).toISOString();
  c.updatedAt = c.lastReview;
  return c;
}

/** Preview intervals for the 4 grade buttons */
export function previewIntervals(card) {
  const now = new Date();
  return [0, 1, 2, 3].map((g) => fmtInterval(schedule(card, g, now).interval));
}

/** Retention estimate for a card based on reviews (grade>0 / total) */
export function retention(reviews) {
  if (!reviews.length) return null;
  const ok = reviews.filter((r) => r.grade > 0).length;
  return Math.round((ok / reviews.length) * 100);
}

/** Is the card "mastered"? interval ≥ 21 days and in review state. */
export const isMastered = (c) => c.state === 'review' && c.interval >= 21;
export const isLearned = (c) => c.state !== 'new';

/**
 * Build today's review queue.
 * @param cards all cards
 * @param opts { newPerDay, reviewPerDay, newToday (already introduced), reviewsToday, deckFilter, kindFilter, now }
 */
export function buildQueue(cards, opts = {}) {
  const now = opts.now || new Date();
  const nowMs = now.getTime();
  const deckOk = (c) => (!opts.deck || c.deck === opts.deck) && (!opts.kind || c.kind === opts.kind);
  const due = [], learning = [], fresh = [];
  for (const c of cards) {
    if (!deckOk(c)) continue;
    if (c.suspended) continue;
    const dueMs = Date.parse(c.due);
    if (c.state === 'new') { fresh.push(c); continue; }
    if (dueMs <= nowMs) {
      if (c.state === 'learning' || c.state === 'relearning') learning.push(c); else due.push(c);
    }
  }
  learning.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  due.sort((a, b) => Date.parse(a.due) - Date.parse(b.due)); // most overdue first
  // Priority: daily-5 & mistakes first among new
  fresh.sort((a, b) => {
    const pa = (a.priority || 0), pb = (b.priority || 0);
    if (pa !== pb) return pb - pa;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
  const reviewCap = Math.max(0, (opts.reviewPerDay ?? 100) - (opts.reviewsToday || 0));
  const newCap = Math.max(0, (opts.newPerDay ?? 10) - (opts.newToday || 0));
  const priorityNew = fresh.filter((c) => c.priority > 0);
  const normalNew = fresh.filter((c) => !(c.priority > 0)).slice(0, newCap);
  let dueSlice = due.slice(0, reviewCap);
  if (opts.interleave) {
    // Round-robin by kind: mixing item types is harder in the moment and remembered far better.
    const byKind = {}; for (const c of dueSlice) (byKind[c.kind] ||= []).push(c);
    const kinds = Object.keys(byKind); const mixed = [];
    while (mixed.length < dueSlice.length) for (const k of kinds) { const x = byKind[k].shift(); if (x) mixed.push(x); }
    dueSlice = mixed;
  }
  const queue = [...learning, ...dueSlice, ...priorityNew, ...normalNew];
  return {
    queue,
    counts: { learning: learning.length, due: due.length, newAvailable: fresh.length, newAllowed: priorityNew.length + normalNew.length, total: queue.length },
  };
}

/** Count of cards due before end of today (for badges) */
export function dueCount(cards, now = new Date()) {
  const ms = now.getTime();
  let n = 0;
  for (const c of cards) if (c.state !== 'new' && !c.suspended && Date.parse(c.due) <= ms) n++;
  return n;
}

/** Vocab prompt face rotation: 5 faces cycle by reps */
export const VOCAB_FACES = ['meaning', 'produce', 'cloze', 'say', 'listen', 'use'];
export function vocabFace(card) {
  if (card.cardType && card.cardType !== 'rotate') return card.cardType;
  const r = card.reps || 0;
  // First reviews: recognition, then cloze, then say it aloud (a word cannot reach "mastered" unspoken), then rotate.
  if (r === 0) return 'meaning';
  if (r === 1) return 'cloze';
  if (r === 2) return 'say';
  const rot = ['produce', 'listen', 'use', 'cloze', 'say', 'meaning'];
  return rot[(r - 3) % rot.length];
}
