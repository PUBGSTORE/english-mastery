// content.js — loads ./data/*.json lazily and builds lookup maps.
import { toast } from './ui.js';

const cache = new Map();
const inflight = new Map();

export const VOCAB_DECKS = [
  { id: 'vocab-a1', file: 'vocab-a1', name: 'Core A1', cefr: 'A1', desc: 'The 200 most useful beginner words' },
  { id: 'vocab-a2', file: 'vocab-a2', name: 'Core A2', cefr: 'A2', desc: 'Everyday life, work, travel, feelings' },
  { id: 'vocab-b1', file: 'vocab-b1', name: 'Core B1', cefr: 'B1', desc: 'Opinions, abstract nouns, work life' },
  { id: 'vocab-b2', file: 'vocab-b2', name: 'Core B2 + Academic', cefr: 'B2', desc: 'Academic word list and workplace English' },
  { id: 'vocab-c1', file: 'vocab-c1', name: 'Advanced C1', cefr: 'C1', desc: 'Precise, professional, nuanced' },
  { id: 'vocab-tech', file: 'vocab-tech', name: 'Security & Reports', cefr: 'B2', desc: 'Vulnerability reports, triage, disclosure' },
  { id: 'phrasal-verbs', file: 'phrasal-verbs', name: 'Phrasal Verbs', cefr: 'B1', desc: 'Separable and inseparable' },
  { id: 'idioms', file: 'idioms', name: 'Idioms', cefr: 'B2', desc: 'Modern workplace and daily idioms' },
];

export async function load(name) {
  if (cache.has(name)) return cache.get(name);
  if (inflight.has(name)) return inflight.get(name);
  const p = (async () => {
    try {
      const res = await fetch(`./data/${name}.json`, { cache: 'default' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      cache.set(name, json);
      return json;
    } catch (e) {
      console.error('[content] failed to load', name, e);
      toast(`Could not load ${name}.json (${e.message}). Are you online?`, 'err', { timeout: 6000 });
      throw e;
    } finally { inflight.delete(name); }
  })();
  inflight.set(name, p);
  return p;
}

export const index = () => load('index');

/* ---------------- vocabulary ---------------- */
let vocabMap = null;
let vocabDeckOf = null;

export async function loadDeck(deckId) {
  const deck = VOCAB_DECKS.find((d) => d.id === deckId);
  if (!deck) throw new Error(`Unknown deck ${deckId}`);
  const rows = await load(deck.file);
  indexVocab(deckId, rows);
  return rows;
}
function indexVocab(deckId, rows) {
  vocabMap ||= new Map(); vocabDeckOf ||= new Map();
  for (const w of rows) { vocabMap.set(w.id, w); vocabDeckOf.set(w.id, deckId); }
}
export async function allVocab() {
  const lists = await Promise.all(VOCAB_DECKS.map((d) => loadDeck(d.id)));
  return lists.flat();
}
export async function wordById(id) {
  if (vocabMap && vocabMap.has(id)) return vocabMap.get(id);
  // Infer deck from id prefix: v:a1:0001 → vocab-a1 ; v:pv → phrasal-verbs ; v:id → idioms ; v:tech → vocab-tech
  const m = /^v:([a-z0-9]+):/.exec(id);
  if (m) {
    const key = m[1];
    const deckId = key === 'pv' ? 'phrasal-verbs' : key === 'id' ? 'idioms' : `vocab-${key}`;
    if (VOCAB_DECKS.some((d) => d.id === deckId)) { await loadDeck(deckId); return vocabMap.get(id); }
  }
  await allVocab();
  return vocabMap.get(id);
}
export function deckOfWord(id) {
  if (vocabDeckOf && vocabDeckOf.has(id)) return vocabDeckOf.get(id);
  const m = /^v:([a-z0-9]+):/.exec(id || '');
  if (!m) return null;
  const key = m[1];
  return key === 'pv' ? 'phrasal-verbs' : key === 'id' ? 'idioms' : `vocab-${key}`;
}
export async function searchVocab(q) {
  const all = await allVocab();
  const s = q.toLowerCase().trim();
  if (!s) return [];
  const starts = [], contains = [], defs = [];
  for (const w of all) {
    const word = w.word.toLowerCase();
    if (word.startsWith(s)) starts.push(w);
    else if (word.includes(s)) contains.push(w);
    else if ((w.en_def || '').toLowerCase().includes(s) || (w.hi_def || '').includes(s) || (w.word_family || []).some((f) => f.toLowerCase().startsWith(s))) defs.push(w);
  }
  return [...starts, ...contains, ...defs].slice(0, 60);
}

/* ---------------- other content ---------------- */
export const collocations = () => load('collocations');
export const grammar = () => load('grammar');
export const indianisms = () => load('indianisms');
export const phonemes = () => load('phonemes');
export const minimalPairs = () => load('minimal-pairs');
export const stress = () => load('stress');
export const tongueTwisters = () => load('tongue-twisters');
export const shadowing = () => load('shadowing');
export const listening = () => load('listening');
export const writingPrompts = () => load('writing-prompts');
export const speakingPrompts = () => load('speaking-prompts');
export const placement = () => load('placement');

export async function grammarById(id) {
  const all = await grammar();
  return all.find((l) => l.id === id);
}
export async function grammarSorted() {
  const all = await grammar();
  return all.slice().sort((a, b) => a.order - b.order);
}
export async function phonemeById(id) { return (await phonemes()).find((p) => p.id === id); }
export async function pairById(id) { return (await minimalPairs()).find((p) => p.id === id); }
export async function shadowById(id) { return (await shadowing()).find((p) => p.id === id); }
export async function collocationById(id) { return (await collocations()).find((p) => p.id === id); }

/** Resolve any content id to a display object { title, sub, href } */
export async function describeRef(refId) {
  if (!refId) return null;
  try {
    if (refId.startsWith('v:')) { const w = await wordById(refId); return w ? { title: w.word, sub: w.en_def, href: `#/word/${refId}` } : null; }
    if (refId.startsWith('col:')) { const c = await collocationById(refId); return c ? { title: c.phrase, sub: c.en_def, href: '#/vocab/collocations' } : null; }
    if (refId.startsWith('g:')) { const lessonId = refId.split(':').slice(0, 2).join(':'); const g = await grammarById(lessonId); return g ? { title: g.title, sub: `Grammar · ${g.cefr}`, href: `#/grammar/${lessonId}` } : null; }
    if (refId.startsWith('mp:')) { const p = await pairById(refId); return p ? { title: `${p.a.word} / ${p.b.word}`, sub: p.contrast_label, href: `#/pron/pairs/${p.contrast}` } : null; }
    if (refId.startsWith('ph:')) { const p = await phonemeById(refId); return p ? { title: `/${p.ipa}/`, sub: p.label, href: `#/pron/phonemes/${refId}` } : null; }
    if (refId.startsWith('sh:')) { const s = await shadowById(refId); return s ? { title: s.title || s.text.slice(0, 40), sub: `Shadowing · ${s.cefr}`, href: `#/shadow/${refId}` } : null; }
    if (refId.startsWith('ld:')) { const l = await listening(); const d = l.dictation.find((x) => x.id === refId); return d ? { title: d.text, sub: 'Dictation', href: '#/listen/dictation' } : null; }
    if (refId.startsWith('ws:')) { const s = await stress(); const w = s.word_stress.find((x) => x.id === refId); return w ? { title: w.word, sub: 'Word stress', href: '#/pron/stress' } : null; }
  } catch { /* content missing */ }
  return null;
}
