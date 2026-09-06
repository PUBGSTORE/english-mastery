// lemma.js — tokeniser + rule-based lemmatiser with an irregular map and a lexicon for stem checks.
import { load } from './content.js';

let irregular = null;   // Map form → lemma
let stoplist = null;    // Set
let lexicon = null;     // Set of known lemmas (frequency-5000 + deck headwords)
let freqRank = null;    // Map lemma → rank

export async function ready() {
  if (irregular && stoplist && lexicon) return;
  const [irr, stop, freq] = await Promise.all([load('irregular-verbs'), load('stoplist'), load('frequency-5000')]);
  irregular = new Map(irr.map((x) => [x.form, x.lemma]));
  stoplist = new Set(stop);
  freqRank = new Map(freq.map((x) => [x.l, x.r]));
  lexicon = new Set(freq.map((x) => x.l));
  try {
    const { allVocab } = await import('./content.js');
    for (const w of await allVocab()) { const h = w.word.toLowerCase(); if (!h.includes(' ')) lexicon.add(h); }
  } catch { /* decks optional */ }
}
export const isStop = (w) => !!(stoplist && stoplist.has(w));
export const rankOf = (l) => (freqRank && freqRank.get(l)) || null;
export const bandOf = (l) => { const r = rankOf(l); return r ? Math.ceil(r / 1000) : 6; };
export const inLexicon = (l) => !!(lexicon && lexicon.has(l));
export function addToLexicon(words) { if (lexicon) for (const w of words) lexicon.add(w); }

const VOWELS = 'aeiou';
const isVowel = (c) => VOWELS.includes(c);

/** Lemmatise one lowercase token. Pure rules; relies on `ready()` having been called. */
const PLURAL_ONLY = new Set(['news', 'series', 'means', 'species', 'physics', 'mathematics', 'economics', 'politics', 'ethics', 'statistics', 'linguistics', 'thanks', 'clothes', 'headquarters', 'diabetes', 'measles', 'billiards', 'darts', 'crossroads', 'outskirts', 'premises', 'proceeds', 'remains', 'scissors', 'trousers', 'jeans', 'goods', 'congratulations', 'whereabouts', 'aerobics', 'genetics', 'electronics', 'logistics', 'analytics', 'forensics', 'diagnostics']);
const NO_ED = new Set(['need', 'seed', 'feed', 'weed', 'reed', 'deed', 'speed', 'breed', 'greed', 'bleed', 'shed', 'sled', 'sped', 'wed', 'red', 'bed', 'fed', 'led', 'hundred', 'sacred', 'naked', 'wicked', 'rugged', 'ragged', 'jagged', 'crooked', 'beloved', 'wretched', 'learned', 'aged', 'blessed', 'hatred', 'kindred', 'infrared', 'unprecedented']);
function pickStem(stem, extra = []) {
  // Prefer restoring a silent e for very short stems (hop-ed → hope, us-ed → use), doubled consonants undo (stopp → stop).
  const doubled = /([^aeiou])\1$/.test(stem) ? stem.slice(0, -1) : null;
  const order = doubled ? [doubled, stem, stem + 'e'] : stem.length <= 3 ? [stem + 'e', stem] : [stem, stem + 'e'];
  for (const c of [...order, ...extra]) if (c && inLexicon(c)) return c;
  // Unknown stem: Latinate endings almost always take a silent e (remediat-ed → remediate, optimiz-ing → optimize).
  if (/(at|iz|is|ut|ov|iv|ur|id|ag|ud|ib|ul|ar|or|in)$/.test(stem) && !doubled && stem.length >= 5) return stem + 'e';
  return null;
}
export function lemmatise(w) {
  if (!w) return w;
  if (irregular && irregular.has(w)) return irregular.get(w);
  if (PLURAL_ONLY.has(w)) return w;
  let out = w;
  if (out.endsWith("'s")) out = out.slice(0, -2);
  else if (out.endsWith("s'")) out = out.slice(0, -1);
  if (irregular && irregular.has(out)) return irregular.get(out);
  if (out.length <= 3) return out;
  // plurals / 3rd person
  const r1 = plural(out);
  if (r1 !== out) return r1;
  // -ing
  if (out.endsWith('ing') && out.length > 5) {
    const stem = out.slice(0, -3);
    const c = pickStem(stem);
    if (c) return c;
    if (/([^aeiou])\1$/.test(stem)) return stem.slice(0, -1);
    return stem.length >= 3 ? stem : out;
  }
  // -ied → y ; -ed
  if (out.endsWith('ied') && out.length > 4) return out.slice(0, -3) + 'y';
  if (out.endsWith('ed') && out.length > 3 && !NO_ED.has(out)) {
    const stem = out.slice(0, -2);
    const c = pickStem(stem, [out.slice(0, -1)]);
    if (c) return c;
    if (stem.length < 3) return out;
    if (/([^aeiou])\1$/.test(stem)) return stem.slice(0, -1);
    return stem;
  }
  // comparatives / superlatives / -ly (only when the stem is a real word)
  if (out.endsWith('est') && out.length > 5) { const s = out.slice(0, -3); const c = pickStem(s); if (c && (!inLexicon(out) || c.length <= 4)) return c; if (s.endsWith('i') && inLexicon(s.slice(0, -1) + 'y')) return s.slice(0, -1) + 'y'; }
  if (out.endsWith('er') && out.length > 4 && !inLexicon(out)) { const s = out.slice(0, -2); const c = pickStem(s); if (c) return c; if (s.endsWith('i') && inLexicon(s.slice(0, -1) + 'y')) return s.slice(0, -1) + 'y'; }
  if (out.endsWith('ly') && out.length > 4) { const s = out.slice(0, -2); if (inLexicon(s)) return s; if (s.endsWith('i') && inLexicon(s.slice(0, -1) + 'y')) return s.slice(0, -1) + 'y'; if (s.endsWith('al') && inLexicon(s.slice(0, -2))) return s; if (s.endsWith('b') && inLexicon(s + 'le')) return s + 'le'; }
  return out;
}
function plural(w) {
  if (w.length < 4 || !w.endsWith('s') || w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  const cands = [];
  if (w.endsWith('ies') && w.length > 4) cands.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ves')) cands.push(w.slice(0, -3) + 'fe', w.slice(0, -3) + 'f');
  if (/(ches|shes|sses|xes|zes)$/.test(w)) cands.push(w.slice(0, -2));
  if (w.endsWith('oes')) cands.push(w.slice(0, -2));
  if (w.endsWith('es')) cands.push(w.slice(0, -1), w.slice(0, -2));
  cands.push(w.slice(0, -1));
  for (const c of cands) if (inLexicon(c)) return c;
  if (inLexicon(w)) return w; // a real word in its own right (e.g. "bus" handled above, "canvas", "atlas")
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ches|shes|sses|xes|zes|ses)$/.test(w)) return w.slice(0, -2);
  return w.slice(0, -1);
}

/**
 * Tokenise text into sentences and tokens with proper-noun detection.
 * Returns { sentences: [{ text, tokens: [{ w, lemma, proper, stop }] }] }
 */
export function tokenise(text) {
  return splitSentences(text).map(tokeniseSentence);
}
const lemmaCache = new Map();
function lemmaOf(p) { let l = lemmaCache.get(p); if (l === undefined) { l = lemmatise(p); if (lemmaCache.size < 50000) lemmaCache.set(p, l); } return l; }
export function tokeniseSentence(s) {
  {
    const raw = s.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g) || [];
    const tokens = [];
    raw.forEach((t, i) => {
      const w = t.replace(/’/g, "'");
      const lower = w.toLowerCase();
      if (/\d/.test(w) || lower.length < 2) return;
      const capital = /^[A-Z]/.test(w);
      const allCaps = /^[A-Z]{2,}$/.test(w);
      const proper = (capital && i > 0 && !inLexicon(lower) && !isStop(lower)) || allCaps;
      const bare = lower.replace(/^'+|'+$/g, '');
      if (!bare) return;
      // contractions
      const parts = splitContraction(bare);
      for (const p of parts) { const l = lemmaOf(p); tokens.push({ w: p, lemma: l, proper, stop: isStop(p) || isStop(l) }); }
    });
    return { text: s, tokens };
  }
}
function splitContraction(w) {
  const m = w.match(/^(.+?)('(?:s|re|ve|ll|d|m|t))$/);
  if (!m) return [w];
  if (m[2] === "'t") { if (m[1] === 'can') return ['can', 'not']; if (m[1] === 'won') return ['will', 'not']; return [m[1].replace(/n$/, ''), 'not']; }
  if (m[2] === "'s") return [m[1]]; // is / has / possessive: ignore the clitic
  return [m[1]];
}
export function splitSentences(text) {
  // Newlines are hard boundaries (caption lines / paragraphs); then split on sentence terminators.
  const out = [];
  for (const line of String(text).split(/\n+/)) {
    const t = line.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const parts = t.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [t];
    for (const p of parts) { const q = p.trim(); if (q.length > 1) out.push(q); }
  }
  return out;
}
