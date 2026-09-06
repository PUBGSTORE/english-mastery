// weaksounds.js — §12 personal weak-sound detector: aggregate every pronunciation attempt, map failed words to sounds, rank, build a personal drill.
import * as db from './db.js';
import * as store from './store.js';
import * as content from './content.js';
import { dayKey, addDays } from './utils.js';

// Spelling → sound heuristics for the contrasts Indian speakers collapse.
const PATTERNS = [
  { id: 'v-w', label: '/v/ vs /w/', test: (w) => /(^|[^a-z])[vw]|[aeiou][vw]/.test(w) && /[vw]/.test(w), contrast: 'v-w' },
  { id: 'th', label: '/θ/ /ð/ (th)', test: (w) => /th/.test(w), contrast: 'th-t' },
  { id: 'final-ed', label: 'final -ed', test: (w) => /[a-z]ed$/.test(w) && w.length > 3, contrast: 'final-clusters' },
  { id: 's-sh', label: '/s/ vs /ʃ/', test: (w) => /sh|ss|[^s]s[^s]|^s/.test(w), contrast: 's-sh' },
  { id: 'z-j', label: '/z/ vs /dʒ/', test: (w) => /z|j|dge|ge$/.test(w), contrast: 'z-j' },
  { id: 'ae-e', label: '/æ/ vs /e/', test: (w) => /[^aeiou][ae][^aeiou]/.test(w), contrast: 'ae-e' },
  { id: 'i-ii', label: '/ɪ/ vs /iː/', test: (w) => /ee|ea|i[^aeiou]e?/.test(w), contrast: 'i-ii' },
  { id: 'clusters', label: 'final clusters (-sts, -sks, -xts)', test: (w) => /(sts|sks|xts|lfths|ngths|pts|cts)$/.test(w), contrast: 'final-clusters' },
  { id: 'r-l', label: '/r/ vs /l/', test: (w) => /[rl]/.test(w) && /r.*l|l.*r/.test(w), contrast: 'r-l' },
  { id: 'o-ou', label: '/ɒ/ vs /oʊ/', test: (w) => /o[^aeiou]e|oa|ow|o[^aeiou]$/.test(w), contrast: 'o-ou' },
];

export async function analyse({ days = 30 } = {}) {
  const cutoff = dayKey(addDays(new Date(), -days));
  const attempts = (await store.allAttempts()).filter((a) => a.day >= cutoff);
  const counts = {}; const words = {};
  const bump = (id, w, fail) => { const c = (counts[id] ||= { fail: 0, total: 0 }); c.total++; if (fail) { c.fail++; (words[id] ||= new Set()).add(w); } };
  const pairs = await content.minimalPairs();
  const pairMap = new Map(pairs.map((p) => [p.id, p]));
  for (const a of attempts) {
    if (a.kind === 'pair') { const p = pairMap.get(a.refId); if (!p) continue; const pat = PATTERNS.find((x) => x.contrast === p.contrast) || { id: p.contrast, label: p.contrast_label }; bump(pat.id, `${p.a.word}/${p.b.word}`, (a.accuracy || 0) < 100); PATTERNS.some((x) => x.id === pat.id) || PATTERNS.push({ ...pat, contrast: p.contrast, test: () => false }); }
    else if (['sentence', 'shadow', 'twister', 'phoneme', 'say'].includes(a.kind) && a.transcript !== undefined && a.extra && a.extra.words) {
      for (const w of a.extra.words) for (const pat of PATTERNS) if (pat.test(w.word)) bump(pat.id, w.word, w.status === 'red');
    }
  }
  const ranked = Object.entries(counts).filter(([, c]) => c.total >= 3).map(([id, c]) => ({ id, label: (PATTERNS.find((p) => p.id === id) || {}).label || id, contrast: (PATTERNS.find((p) => p.id === id) || {}).contrast || id, failRate: Math.round((c.fail / c.total) * 100), fail: c.fail, total: c.total, words: [...(words[id] || [])].slice(0, 8) }))
    .sort((a, b) => b.failRate - a.failRate || b.fail - a.fail);
  return { ranked, attempts: attempts.length };
}

/** Build/refresh the personal drill deck: minimal-pair cards for the top 3 weak contrasts + say-the-word cards for failed words. */
export async function buildDrill() {
  const { ranked } = await analyse();
  const top = ranked.slice(0, 3);
  const pairs = await content.minimalPairs();
  let added = 0;
  for (const r of top) {
    for (const p of pairs.filter((x) => x.contrast === r.contrast).slice(0, 4)) { const before = await store.getCard(`card:${p.id}`); await store.ensureCard({ id: `card:${p.id}`, refId: p.id, deck: 'personal-drill', kind: 'pair', priority: 1 }); if (!before) added++; }
  }
  await db.setSetting('weakSounds', { at: new Date().toISOString(), top: top.map((t) => ({ id: t.id, label: t.label, failRate: t.failRate })) });
  return { top, added };
}
