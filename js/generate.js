// generate.js — §3 infinite practice: material generated from my weakest cards, recurring mistakes and level. Strict JSON, validated, cached in `generated`.
import * as db from './db.js';
import * as ai from './ai.js';
import * as store from './store.js';
import * as content from './content.js';
import { uid, nowISO, hashStr, dayKey, addDays } from './utils.js';

const DEV = /[ऀ-ॿ]/;

export async function estimate(kind) {
  const p = await ai.getPrices(); const inr = await db.getSetting('inrRate', 84);
  const tok = { cloze: [400, 900], passage: [500, 700], dialogue: [500, 900], practice: [900, 1800], quiz: [1200, 2200], questions: [1500, 700] }[kind] || [500, 800];
  const usd = (tok[0] / 1e6) * p.input + (tok[1] / 1e6) * p.output;
  return { usd, inr: usd * inr };
}

/** Weakest vocab cards: lowest ease / most lapses among reviewed cards. */
export async function weakestWords(n = 8) {
  const cards = (await store.allCards()).filter((c) => c.kind === 'vocab' && c.state !== 'new');
  cards.sort((a, b) => (a.ease - b.ease) || (b.lapses - a.lapses));
  const out = [];
  for (const c of cards.slice(0, n * 2)) { const w = await content.wordById(c.refId); if (w) out.push({ card: c, word: w }); if (out.length >= n) break; }
  return out;
}
export async function recentMistakes(days = 7, n = 25) {
  const cutoff = dayKey(addDays(new Date(), -days));
  const all = await store.allMistakes();
  return all.filter((m) => !m.resolved && (m.lastAt || m.day || '') >= cutoff).sort((a, b) => b.count - a.count).slice(0, n);
}

async function call(system, user, maxTokens) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ai.chat({ feature: 'generate', json: true, temperature: 0.5, maxTokens, system, messages: [{ role: 'user', content: user }] });
    try { last = JSON.parse(r.content); return last; } catch (e) { const m = r.content.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* retry */ } } }
  }
  throw new Error('The tutor returned malformed JSON twice. Try again.');
}
async function save(kind, refId, title, data, meta = {}) {
  const rec = { id: uid('gen'), kind, refId, title, data, ts: nowISO(), ...meta };
  await db.put('generated', rec);
  return rec;
}
export async function list(kind = null) { const all = await db.getAll('generated'); return (kind ? all.filter((g) => g.kind === kind) : all).sort((a, b) => b.ts.localeCompare(a.ts)); }
export const remove = (id) => db.del('generated', id);

/** 10 fresh cloze sentences for a word. Saved and appended to the word's cloze pool (used by the review 'cloze' face). */
export async function clozeSet(word) {
  const level = await store.level();
  const j = await call(`Write 10 natural, varied English sentences (work, home, tech, travel) for a Hindi-speaking learner (level ${level}) using the word "${word.word}" (${word.pos}: ${word.en_def}). Each sentence must contain the word or an inflected form exactly once. Return JSON only: {"items":[{"sentence":"... with the word replaced by ____","answer":"the exact form removed","hi":"Devanagari translation of the full sentence"}]}`, word.word, 1200);
  const items = (j.items || []).filter((x) => x && typeof x.sentence === 'string' && x.sentence.includes('____') && x.answer && DEV.test(x.hi || '')).slice(0, 10);
  if (items.length < 5) throw new Error('Generated cloze set was incomplete; nothing saved.');
  return save('cloze', word.id, `Cloze × ${items.length}: ${word.word}`, { items, word: word.word });
}
export async function clozePool(wordId) { const g = await list('cloze'); return g.filter((x) => x.refId === wordId).flatMap((x) => x.data.items); }

/** Graded reading passage reusing the 8 weakest words. Opens in Reader mode. */
export async function passage(words) {
  const level = await store.level();
  const j = await call(`Write a coherent, interesting reading passage of 120–200 words at CEFR ${level} for a Hindi-speaking security engineer. It must naturally use ALL of these words at least once each: ${words.map((w) => w.word).join(', ')}. Return JSON only: {"title":"...","text":"the passage (plain text, 2-3 paragraphs)","hi_summary":"two-sentence Devanagari summary","questions":[{"q":"comprehension question","a":"short answer"}] (3 items)}`, words.map((w) => `${w.word}: ${w.en_def}`).join('\n'), 900);
  if (!j.text || j.text.split(' ').length < 80) throw new Error('Passage too short; nothing saved.');
  const rec = await save('passage', null, j.title || 'Generated passage', { text: j.text, hi_summary: j.hi_summary || '', questions: j.questions || [], words: words.map((w) => w.word) });
  await db.put('texts', { id: `text:gen:${rec.id}`, title: j.title || 'Generated passage', text: j.text, source: 'generated', words: j.text.split(' ').length, ts: nowISO(), position: 0, wordsRead: 0 });
  return rec;
}

/** Dialogue on a grammar point I keep breaking. */
export async function dialogue(lesson, mistakes = []) {
  const level = await store.level();
  const j = await call(`Write a natural 10–14 line two-person dialogue (A/B) at CEFR ${level} that uses the grammar point "${lesson.title}" (${lesson.pattern}) at least 6 times, in a workplace or daily-life-in-India setting. Return JSON only: {"title":"...","lines":[{"speaker":"A|B","en":"...","hi":"Devanagari"}],"notes_en":"two sentences on what to notice"}`, mistakes.length ? `The learner's recent errors: ${mistakes.map((m) => `"${m.original}" → "${m.fix}"`).join('; ')}` : 'No recent errors provided.', 1000);
  const lines = (j.lines || []).filter((l) => l && l.en && DEV.test(l.hi || ''));
  if (lines.length < 6) throw new Error('Dialogue too short; nothing saved.');
  return save('dialogue', lesson.id, j.title || `Dialogue: ${lesson.title}`, { lines, notes_en: j.notes_en || '', lesson: lesson.title });
}

/** 10 new practice items for a lesson, in the grammar.practice schema. */
export async function practiceItems(lesson) {
  const level = await store.level();
  const j = await call(`Create 10 NEW practice items for the grammar lesson "${lesson.title}" (pattern: ${lesson.pattern}) for a Hindi-speaking learner (level ${level}). Mix types: fill (prompt contains ___), choose (options 3-4), fix (prompt is a wrong sentence, answer the corrected one), tf (answer ["true"] or ["false"]). Return JSON only: {"items":[{"type":"fill|choose|fix|tf","prompt":"...","options":["..."] (choose only),"answer":["accepted answer(s)"],"hi":"Devanagari hint","feedback_en":"why","feedback_hi":"Devanagari"}]}`, lesson.contrast.slice(0, 3).map((c) => `${c.wrong} → ${c.right}`).join('\n'), 2000);
  const items = (j.items || []).filter((it) => it && ['fill', 'choose', 'fix', 'tf'].includes(it.type) && it.prompt && Array.isArray(it.answer) && it.answer.length && (it.type !== 'fill' || it.prompt.includes('___')) && (it.type !== 'choose' || (Array.isArray(it.options) && it.options.length >= 3))).slice(0, 10)
    .map((it, i) => ({ ...it, id: `${lesson.id}:gen:${hashStr(it.prompt).toString(36)}:${i}` }));
  if (items.length < 5) throw new Error('Too few valid items; nothing saved.');
  return save('practice', lesson.id, `Practice × ${items.length}: ${lesson.title}`, { items, lesson: lesson.title });
}

/** Weekly quiz over everything I got wrong this week. */
export async function weeklyQuiz() {
  const ms = await recentMistakes(7, 25);
  if (ms.length < 3) throw new Error('Fewer than 3 mistakes this week. Nothing to quiz yet.');
  const level = await store.level();
  const j = await call(`Build a 10-item quiz for a Hindi-speaking learner (level ${level}) from their mistakes this week. Each item must test the SAME rule as one mistake but with a NEW sentence. Types: fill (___), choose (3-4 options), fix. Return JSON only: {"items":[{"type":"fill|choose|fix","prompt":"...","options":[...] (choose only),"answer":["..."],"rule":"short rule","feedback_en":"...","feedback_hi":"Devanagari"}]}`, ms.map((m) => `"${m.original}" → "${m.fix}" (${m.rule})`).join('\n'), 2200);
  const items = (j.items || []).filter((it) => it && ['fill', 'choose', 'fix'].includes(it.type) && it.prompt && Array.isArray(it.answer) && it.answer.length).slice(0, 10).map((it, i) => ({ ...it, id: `quiz:${dayKey()}:${i}` }));
  if (items.length < 5) throw new Error('Quiz came back incomplete; nothing saved.');
  return save('quiz', null, `Weekly quiz · ${dayKey()}`, { items, from: ms.length });
}

/** §12 comprehension questions from a transcript. */
export async function comprehension(video) {
  const level = await store.level();
  const j = await call(`From this transcript, write 5 comprehension questions for a Hindi-speaking learner (level ${level}): 3 multiple-choice (4 options) about facts or main ideas, 2 short-answer. Return JSON only: {"items":[{"type":"choose|short","q":"...","options":["..."] (choose only),"answer":"...","hi":"Devanagari translation of the question"}]}`, video.transcript.slice(0, 9000), 900);
  const items = (j.items || []).filter((it) => it && it.q && it.answer).slice(0, 5);
  if (items.length < 3) throw new Error('Could not generate questions.');
  return save('questions', video.id, `Questions: ${video.title}`, { items });
}
