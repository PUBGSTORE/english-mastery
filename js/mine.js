// mine.js — the mining pipeline: text → lemmas → subtract known → rank → cap → sentences; DeepSeek enrichment with a permanent cache.
import * as db from './db.js';
import * as ai from './ai.js';
import * as lemmas from './lemmas.js';
import { tokeniseSentence, ready as lemmaReady, bandOf, inLexicon, isStop } from './lemma.js';
import { splitSentences } from './lemma.js';
import { allVocab } from './content.js';
import { sleep, hashStr, nowISO } from './utils.js';

const BAND_WEIGHT = { 1: 1.0, 2: 1.0, 3: 1.3, 4: 1.6, 5: 2.0, 6: 2.4 };
let deckLemmas = null;
async function deckSet() {
  if (deckLemmas) return deckLemmas;
  await lemmaReady();
  const { lemmatise } = await import('./lemma.js');
  const v = await allVocab();
  deckLemmas = new Map();
  for (const w of v) { const h = w.word.toLowerCase(); if (!h.includes(' ')) deckLemmas.set(lemmatise(h), w.id); }
  return deckLemmas;
}
export function invalidateDecks() { deckLemmas = null; }

/**
 * Analyse text. Yields to the UI between chunks so a 45-minute transcript never freezes the page.
 * Returns { sentences: [{ text, t, tokens:[{w, lemma, state, proper, stop, inDeck}] }], candidates: [...], stats }
 * segments: optional [{ t, text }] to keep timestamps per sentence.
 */
export async function analyse(text, { segments = null, cap = 40, onProgress = null, level = null } = {}) {
  await lemmaReady();
  const states = await lemmas.all();
  const decks = await deckSet();
  // Prior: a learner at level L is assumed to know frequency bands below their level's band
  // (A1: none, A2: band 1, B1: bands 1-2, B2: 1-3, C1: 1-4). Explicit lemma states always win.
  if (!level) { try { level = await db.getSetting('level', 'A2'); } catch { level = 'A2'; } }
  const assumedBands = Math.max(0, ['A1', 'A2', 'B1', 'B2', 'C1'].indexOf(level));
  const sentenceTexts = splitSentences(text);
  // map sentence → timestamp by walking segments
  const stamps = alignTimestamps(sentenceTexts, segments);
  const sentences = [];
  const counts = new Map();
  let total = 0, knownish = 0, unknownTok = 0;
  for (let i = 0; i < sentenceTexts.length; i++) {
    const sent = tokeniseSentence(sentenceTexts[i]);
    if (!sent) continue;
    const toks = sent.tokens.map((tk) => {
      const st = states.get(tk.lemma);
      const state = st ? st.state : 0;
      const inDeck = decks.has(tk.lemma);
      const proper = tk.proper;
      if (!proper) {
        total++;
        const band = bandOf(tk.lemma);
        const assumed = state === 0 && band <= assumedBands;
        const isKnown = tk.stop || state >= 2 || state === -1 || inDeck || assumed;
        if (isKnown) knownish++; else unknownTok++;
        if (!tk.stop && !inDeck && !assumed && state <= 1 && tk.lemma.length > 2 && !/^[^a-z]/.test(tk.lemma)) {
          const c = counts.get(tk.lemma);
          if (c) { c.count++; } else counts.set(tk.lemma, { lemma: tk.lemma, count: 1, first: i, sentence: window(sentenceTexts[i], tk.w), t: stamps[i], form: tk.w, state });
        }
      }
      return { w: tk.w, lemma: tk.lemma, state, proper, stop: tk.stop, inDeck };
    });
    sentences.push({ text: sentenceTexts[i], t: stamps[i], tokens: toks });
    if (i % 60 === 59) { onProgress && onProgress(i / sentenceTexts.length); await sleep(0); }
  }
  const candidates = [...counts.values()].map((c) => ({ ...c, band: bandOf(c.lemma), rank: (BAND_WEIGHT[bandOf(c.lemma)] || 2.4) * c.count }))
    .sort((a, b) => b.rank - a.rank || a.first - b.first);
  const density = total ? knownish / total : 1;
  const stats = { tokens: total, uniqueLemmas: counts.size + [...new Set(sentences.flatMap((s) => s.tokens.filter((t) => !t.proper).map((t) => t.lemma)))].length - counts.size, unknownTokens: unknownTok, unknownLemmas: counts.size, density: Math.round(density * 1000) / 10, sentences: sentences.length };
  return { sentences, candidates: cap > 0 ? candidates.slice(0, cap) : candidates, allCandidates: candidates, stats };
}
/** Keep candidate sentences short: a ±12-word window around the word when the sentence is very long. */
function window(sentence, word) {
  if (sentence.length <= 220) return sentence;
  const words = sentence.split(' ');
  const idx = words.findIndex((x) => x.toLowerCase().replace(/[^a-z']/g, '') === word);
  const a = Math.max(0, idx - 12), b = Math.min(words.length, idx + 13);
  return (a > 0 ? '… ' : '') + words.slice(a, b).join(' ') + (b < words.length ? ' …' : '');
}
function alignTimestamps(sentenceTexts, segments) {
  const out = new Array(sentenceTexts.length).fill(null);
  if (!segments || !segments.some((s) => s.t != null)) return out;
  // Build cumulative char offsets of segments in the joined text and of sentences in the same text.
  let pos = 0; const segStarts = [];
  for (const s of segments) { segStarts.push({ pos, t: s.t }); pos += s.text.trim().length + 1; }
  let sp = 0;
  for (let i = 0; i < sentenceTexts.length; i++) {
    let best = segStarts[0];
    for (const s of segStarts) { if (s.pos <= sp) best = s; else break; }
    out[i] = best ? best.t : null;
    sp += sentenceTexts[i].length + 1;
  }
  return out;
}

export function verdict(densityPct) {
  if (densityPct >= 95) return { level: 'ok', text: `${densityPct}% known — watch it, you'll follow most of it.` };
  if (densityPct >= 90) return { level: 'mid', text: `${densityPct}% known — fine for listening practice; pre-teach the top words first.` };
  return { level: 'hard', text: `${densityPct}% known — too hard right now. Learn the top words first or pick something easier.` };
}

/* ---------------- enrichment with permanent cache ---------------- */
export async function cached(lemmaList) {
  const out = new Map();
  for (const l of lemmaList) { const r = await db.get('wordCache', l); if (r) out.set(l, r); }
  return out;
}
export async function estimate(nNew) {
  const p = await ai.getPrices();
  const inr = await db.getSetting('inrRate', 84);
  const inTok = 120 + 6 * nNew, outTok = 120 * nNew;
  const usd = (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
  return { usd, inr: usd * inr, inTok, outTok };
}
// A usable entry needs a headword and an English meaning; everything else is optional (missing Hindi is shown as blank, never as a failure).
function valid(e) { return !!(e && typeof e === 'object' && typeof e.en_def === 'string' && e.en_def.trim()); }
function findEntry(got, l) {
  if (!got) return null;
  const key = l.toLowerCase();
  if (got[key]) return got[key];
  for (const [k, v] of Object.entries(got)) { if (String(k).toLowerCase().trim() === key) return v; if (v && typeof v === 'object' && String(v.word || '').toLowerCase().trim() === key) return v; }
  // inflection tolerance: "scanner" vs "scanners"
  for (const [k, v] of Object.entries(got)) { const kk = String(k).toLowerCase(); if (kk.startsWith(key) || key.startsWith(kk)) return v; }
  return null;
}
/**
 * Enrich lemmas (cache-first). onBatch(i, n). Returns { entries: Map, skipped: [] }.
 * Never calls the API for a word that is already cached.
 */
export async function enrich(lemmaList, { level = 'B1', onBatch = null, sentences = {} } = {}) {
  const entries = await cached(lemmaList);
  const missing = lemmaList.filter((l) => !entries.has(l));
  const skipped = [];
  const batches = []; for (let i = 0; i < missing.length; i += 40) batches.push(missing.slice(i, i + 40));
  for (let bi = 0; bi < batches.length; bi++) {
    onBatch && onBatch(bi, batches.length);
    const batch = batches[bi];
    let got = null;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      try { got = await ai.enrichWords(batch, level, sentences); } catch (e) { if (e.message === 'NO_KEY' || e.message === 'CAP_REACHED') throw e; if (attempt === 1) skipped.push(...batch); }
    }
    if (!got) continue;
    const rows = [];
    for (const l of batch) {
      const e = findEntry(got, l);
      if (valid(e)) rows.push({ lemma: l, word: String(e.word || l).trim().toLowerCase(), ipa: e.ipa || '', pos: e.pos || 'other', cefr: normCefr(e.cefr), en_def: e.en_def, hi_def: /[ऀ-ॿ]/.test(e.hi_def || '') ? e.hi_def : (e.hi_def || ''), gu_def: /[઀-૿]/.test(e.gu_def || '') ? e.gu_def : '', hi_nuance: e.hi_nuance || '', example_en: e.example_en || '', example_hi: e.example_hi || '', synonyms: Array.isArray(e.synonyms) ? e.synonyms.slice(0, 5) : [], register: e.register || 'neutral', ts: nowISO(), model: ai.MODEL });
      else skipped.push(l);
    }
    if (rows.length) { await db.bulkPut('wordCache', rows); for (const r of rows) entries.set(r.lemma, r); }
  }
  return { entries, skipped };
}
function normCefr(c) { const x = String(c || '').toUpperCase().slice(0, 2); return ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(x) ? x : 'B2'; }

/** Save a mined word as a custom vocab entry (so the whole SRS machinery applies) and return its id. */
export async function toCustomWord(cacheEntry, sentence, source) {
  const { addCustomWords } = await import('./content.js');
  const word = cacheEntry.word || cacheEntry.lemma;
  const re = new RegExp(`\\b${escapeRe(cacheEntry.form || word)}\\b`, 'i');
  const clozeSentence = sentence && re.test(sentence) ? sentence.replace(re, '____') : (cacheEntry.example_en || '').replace(new RegExp(`\\b${escapeRe(word)}\\w*`, 'i'), '____');
  const answer = sentence && re.test(sentence) ? sentence.match(re)[0] : word;
  const examples = [];
  if (sentence) examples.push({ en: sentence, hi: cacheEntry.example_hi && sentence === cacheEntry.example_en ? cacheEntry.example_hi : `(वीडियो से) ${cacheEntry.hi_def}` });
  if (cacheEntry.example_en && cacheEntry.example_en !== sentence) examples.push({ en: cacheEntry.example_en, hi: cacheEntry.example_hi });
  const saved = await addCustomWords([{ word, ipa: cacheEntry.ipa, pos: cacheEntry.pos, cefr: cacheEntry.cefr, en_def: cacheEntry.en_def, hi_def: cacheEntry.hi_def, gu_def: cacheEntry.gu_def || '', hi_nuance: cacheEntry.hi_nuance, examples, synonyms: cacheEntry.synonyms, register: cacheEntry.register, cloze: { sentence: clozeSentence, answer }, word_family: [word] }], { topic: source && source.title ? `video:${source.title.slice(0, 24)}` : 'mined' });
  if (saved.length) { saved[0].source = source; await db.put('custom', saved[0]); return saved[0].id; }
  // already exists as a custom word → find it
  const { allVocab: av } = await import('./content.js');
  const hit = (await av()).find((w) => w.word.toLowerCase() === word.toLowerCase());
  return hit ? hit.id : null;
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------------- punctuation repair for auto-captions ---------------- */
export async function repunctuate(text, { onChunk = null } = {}) {
  const words = text.split(' ');
  const chunks = []; for (let i = 0; i < words.length; i += 700) chunks.push(words.slice(i, i + 700).join(' '));
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    onChunk && onChunk(i, chunks.length);
    const r = await ai.chat({ feature: 'miner-punctuation', system: 'You receive an English auto-caption transcript with no punctuation or capitalisation. Return the SAME words in the SAME order with correct sentence punctuation, capitalisation and paragraph breaks. Do not add, remove, translate or paraphrase any word. Output plain text only.', messages: [{ role: 'user', content: chunks[i] }], temperature: 0.1, maxTokens: 2400 });
    out.push(r.content.trim());
  }
  return out.join('\n\n');
}
export async function estimateRepunctuate(text) {
  const p = await ai.getPrices(); const inr = await db.getSetting('inrRate', 84);
  const tok = Math.ceil(text.length / 4);
  const usd = (tok / 1e6) * p.input + (tok / 1e6) * p.output;
  return { usd, inr: usd * inr };
}
export const textId = (text) => `text:${hashStr(text.slice(0, 5000) + text.length).toString(36)}`;

/** Look up one word (cache-first) and, if it is a custom word without a real meaning, fill the custom entry in place. */
export const PLACEHOLDER_HI = 'अर्थ अभी नहीं मिला';
export function isPlaceholder(w) { return !w || !w.en_def || w.hi_def === PLACEHOLDER_HI || /^(Seen in:|Frequency rank)/.test(w.en_def); }
export async function fillCustomWord(word, { level = 'B1', sentence = '' } = {}) {
  const lemma = String(word.word || '').toLowerCase();
  const r = await enrich([lemma], { level, sentences: sentence ? { [lemma]: sentence } : {} });
  const c = r.entries.get(lemma);
  if (!c) throw new Error(`No meaning came back for "${word.word}".`);
  const row = { ...word, ipa: c.ipa || word.ipa, pos: c.pos || word.pos, cefr: c.cefr || word.cefr, en_def: c.en_def, hi_def: c.hi_def || word.hi_def, gu_def: c.gu_def || word.gu_def || '', hi_nuance: c.hi_nuance || word.hi_nuance, synonyms: c.synonyms && c.synonyms.length ? c.synonyms : word.synonyms, register: c.register || word.register };
  const ex = (row.examples || []).filter((x) => x && x.en && !/^\(वीडियो से\)/.test(x.hi || ''));
  if (c.example_en) ex.push({ en: c.example_en, hi: c.example_hi || '' });
  for (const x of row.examples || []) if (x && x.en && /^\(वीडियो से\)/.test(x.hi || '')) ex.unshift({ en: x.en, hi: c.hi_def ? `(वीडियो से) ${c.hi_def}` : x.hi });
  row.examples = ex.slice(0, 7);
  await db.put('custom', row);
  return row;
}
