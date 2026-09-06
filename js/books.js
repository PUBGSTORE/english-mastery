// books.js — 📚 Book explainer: identify a book, explain every chapter in full, finish with study notes. Chunked calls, strict JSON, saved forever.
import * as db from './db.js';
import * as ai from './ai.js';
import * as store from './store.js';
import { nowISO, hashStr } from './utils.js';

const DEV = /[ऀ-ॿ]/, GUJ = /[઀-૿]/;
const PER_CALL = 3; // chapters explained per request

async function callJSON(system, user, maxTokens) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ai.chat({ feature: 'books', json: true, temperature: 0.3, maxTokens, system, messages: [{ role: 'user', content: user }] });
    try { return JSON.parse(r.content); } catch { const m = r.content.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* retry */ } } }
  }
  throw new Error('The tutor returned malformed JSON twice.');
}

export const bookId = (title, author = '') => `bk:${hashStr((title + '|' + author).toLowerCase().replace(/\s+/g, ' ').trim()).toString(36)}`;

/** Step 1: identify the book and list its chapters. */
export async function identify(title, author = '') {
  const level = await store.level();
  const j = await callJSON(`You are a well-read teacher helping a Hindi- and Gujarati-speaking learner (English level ${level}). Identify the book the user names. If you know it well, list its actual chapters (or parts/sections) in order with their real titles. If the book has no named chapters, divide it into its natural sections. If you do not know the book, say so. Return JSON only:
{"known": true|false, "title": "exact title", "author": "author", "year": "first published year or empty", "genre": "e.g. self-help, business, novel, memoir, psychology", "one_line": "what the book is about in one sentence", "hi_one_line": "same in Devanagari", "gu_one_line": "same in Gujarati script", "chapters": [{"n": 1, "title": "chapter title"}], "confidence": "high|medium|low", "note": "if confidence is not high, say what you are unsure about"}`, `Book: ${title}${author ? `\nAuthor: ${author}` : ''}`, 1500);
  if (!j.known || !Array.isArray(j.chapters) || !j.chapters.length) throw new Error(`The tutor does not know "${title}"${author ? ` by ${author}` : ''} well enough to explain it. Check the spelling, add the author, or try a better-known book.`);
  return { title: j.title || title, author: j.author || author, year: j.year || '', genre: j.genre || '', one_line: j.one_line || '', hi_one_line: j.hi_one_line || '', gu_one_line: j.gu_one_line || '', chapters: j.chapters.map((c, i) => ({ n: c.n || i + 1, title: c.title || `Chapter ${i + 1}` })), confidence: j.confidence || 'medium', note: j.note || '' };
}

export async function estimate(chapterCount) {
  const p = await ai.getPrices(); const inr = await db.getSetting('inrRate', 84);
  const calls = Math.ceil(chapterCount / PER_CALL) + 2;
  const inTok = calls * 700, outTok = chapterCount * 1300 + 1800;
  const usd = (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
  return { usd, inr: usd * inr, calls };
}

const CHAPTER_SYSTEM = (level, meta) => `You are explaining the book "${meta.title}" by ${meta.author} to a Hindi- and Gujarati-speaking learner (English level ${level}) who wants to understand the WHOLE book without reading it. For each chapter requested, explain it fully and faithfully: what it argues, the stories and examples it uses, the evidence or reasoning, and what the reader should take from it. Do not compress: a dense chapter deserves a long explanation, a short chapter a short one. Simple, clear English (short sentences, everyday words); keep and explain the book's own terms. Never invent chapters, characters or quotes; if unsure of an exact quote, paraphrase and say "paraphrased".
Return JSON only: {"chapters": [{"n": 1, "title": "...", "summary": "one paragraph: what the chapter is about", "key_ideas": [{"idea": "one line", "explanation": "full explanation, 3–10 sentences", "example": "the story, case or example the author uses, or empty"}], "quotes": ["memorable lines, verbatim or marked paraphrased (0–3)"], "terms": [{"term": "...", "en": "simple meaning under 15 words", "hi": "Devanagari", "gu": "Gujarati script"}], "lesson": "the one thing to remember from this chapter, one or two sentences", "hi_summary": "3–5 sentence Hindi (Devanagari) summary", "gu_summary": "3–5 sentence Gujarati (Gujarati script) summary"}]}`;

const NOTES_SYSTEM = (level, meta) => `You are finishing study notes on "${meta.title}" by ${meta.author} for a Hindi- and Gujarati-speaking learner (English level ${level}). You receive the chapter lessons already written. Return JSON only:
{"overview": "what the whole book says and why it matters, 5–8 sentences, simple English", "big_ideas": ["the 7–12 most important ideas of the book, each a full sentence"], "actions": ["8–15 concrete things the reader can do or change, each starting with a verb"], "quotes": ["5–8 memorable lines from the book (verbatim or marked paraphrased)"], "apply_en": "how to apply this book in the life of a working Indian professional, 4–6 sentences", "critique": "2–3 sentences on the book's limits or common criticisms", "similar": ["3 books to read next, with one line each"], "hi_overview": "overview in Hindi (Devanagari)", "gu_overview": "overview in Gujarati (Gujarati script)", "revision_plan": "one sentence: how to review these notes to remember the book"}`;

/** Full run. onProgress(done, total, label). */
export async function explain(meta, { onProgress = null } = {}) {
  const level = await store.level();
  const est = await estimate(meta.chapters.length);
  await ai.checkCap(est.usd);
  const groups = []; for (let i = 0; i < meta.chapters.length; i += PER_CALL) groups.push(meta.chapters.slice(i, i + PER_CALL));
  const chapters = []; const terms = new Map(); let failed = 0; let done = 0;
  const work = async (g) => {
    try {
      const j = await callJSON(CHAPTER_SYSTEM(level, meta), `Explain these chapters:\n${g.map((c) => `${c.n}. ${c.title}`).join('\n')}`, 6000);
      for (const c of g) {
        const got = (j.chapters || []).find((x) => +x.n === +c.n) || (j.chapters || [])[g.indexOf(c)];
        if (!got || !got.summary) { chapters.push({ n: c.n, title: c.title, failed: true, key_ideas: [], quotes: [], hi_summary: '', gu_summary: '', lesson: '', summary: '' }); failed++; continue; }
        chapters.push({ n: c.n, title: got.title || c.title, summary: got.summary, key_ideas: (got.key_ideas || []).filter((k) => k && k.idea && k.explanation).map((k) => ({ idea: k.idea, explanation: k.explanation, example: k.example || '' })), quotes: (got.quotes || []).filter(Boolean).slice(0, 3), lesson: got.lesson || '', hi_summary: DEV.test(got.hi_summary || '') ? got.hi_summary : '', gu_summary: GUJ.test(got.gu_summary || '') ? got.gu_summary : '' });
        for (const t of got.terms || []) if (t && t.term && t.en && !terms.has(t.term.toLowerCase())) terms.set(t.term.toLowerCase(), { term: t.term, en: t.en, hi: DEV.test(t.hi || '') ? t.hi : '', gu: GUJ.test(t.gu || '') ? t.gu : '', chapter: c.n });
      }
    } catch (e) {
      if (e.message === 'CAP_REACHED' || e.message === 'NO_KEY') throw e;
      for (const c of g) { chapters.push({ n: c.n, title: c.title, failed: true, error: e.message, key_ideas: [], quotes: [], hi_summary: '', gu_summary: '', lesson: '', summary: '' }); failed++; }
    }
    done += g.length; onProgress && onProgress(done, meta.chapters.length, `Explained ${done} of ${meta.chapters.length} chapters…`);
  };
  onProgress && onProgress(0, meta.chapters.length, `Explaining ${meta.chapters.length} chapters (two groups at a time)…`);
  const queue = groups.slice();
  await Promise.all([0, 1].map(async () => { while (queue.length) await work(queue.shift()); }));
  chapters.sort((a, b) => a.n - b.n);
  onProgress && onProgress(meta.chapters.length, meta.chapters.length, 'Writing the study notes…');
  let notes = {};
  try { notes = await callJSON(NOTES_SYSTEM(level, meta), chapters.map((c) => `${c.n}. ${c.title}: ${c.lesson || c.summary.slice(0, 200)}`).join('\n'), 2200); } catch (e) { if (e.message === 'CAP_REACHED') throw e; }
  const rec = {
    id: bookId(meta.title, meta.author), kind: 'book', refId: meta.title, title: meta.title, ts: nowISO(),
    data: { author: meta.author, year: meta.year, genre: meta.genre, one_line: meta.one_line, hi_one_line: meta.hi_one_line, gu_one_line: meta.gu_one_line, confidence: meta.confidence, note: meta.note, chapters, terms: [...terms.values()], failed,
      overview: notes.overview || '', big_ideas: notes.big_ideas || [], actions: (notes.actions || []).map((a) => ({ text: a, done: false })), quotes: notes.quotes || [], apply_en: notes.apply_en || '', critique: notes.critique || '', similar: notes.similar || [], hi_overview: notes.hi_overview || '', gu_overview: notes.gu_overview || '', revision_plan: notes.revision_plan || '', myNotes: '', level, estimatedUsd: est.usd },
  };
  await db.put('generated', rec);
  await store.bumpDay({ attempts: 1, skill: 'vocab' });
  return rec;
}

/** Go deeper on one chapter (appends to key_ideas). */
export async function deepen(rec, n) {
  const level = await store.level();
  const ch = rec.data.chapters.find((c) => c.n === n);
  const j = await callJSON(`You are explaining chapter ${n} ("${ch.title}") of "${rec.title}" by ${rec.data.author} to a Hindi- and Gujarati-speaking learner (level ${level}) who has already read this summary: ${ch.summary}. Go deeper: give 4–8 ADDITIONAL points not yet covered (sub-arguments, second-order consequences, how the ideas connect to other chapters, objections and the author's answers, practical scenarios in an Indian workplace or home). Return JSON only: {"key_ideas":[{"idea":"...","explanation":"3–8 sentences","example":"..."}]}`, `Already covered: ${ch.key_ideas.map((k) => k.idea).join('; ')}`, 2500);
  const more = (j.key_ideas || []).filter((k) => k && k.idea && k.explanation).map((k) => ({ ...k, deeper: true }));
  ch.key_ideas.push(...more); ch.deepened = (ch.deepened || 0) + 1;
  await db.put('generated', rec);
  return more.length;
}

export async function get(id) { return db.get('generated', id); }
export async function list() { return (await db.getAll('generated', { index: 'kind', query: 'book' })).sort((a, b) => b.ts.localeCompare(a.ts)); }
export async function save(rec) { return db.put('generated', rec); }
export async function remove(id) { return db.del('generated', id); }

export function toMarkdown(rec) {
  const d = rec.data; const L = [];
  L.push(`# ${rec.title}`, `*${d.author}${d.year ? ', ' + d.year : ''}${d.genre ? ' · ' + d.genre : ''}*`, '', d.one_line, '');
  if (d.overview) L.push('## Overview', d.overview, '');
  if (d.hi_overview) L.push('**हिन्दी:** ' + d.hi_overview, ''); if (d.gu_overview) L.push('**ગુજરાતી:** ' + d.gu_overview, '');
  if (d.big_ideas.length) { L.push('## Big ideas'); d.big_ideas.forEach((b) => L.push(`- ${b}`)); L.push(''); }
  for (const c of d.chapters) {
    L.push(`## Chapter ${c.n}: ${c.title}`, c.summary, '');
    for (const k of c.key_ideas) { L.push(`### ${k.idea}`, k.explanation); if (k.example) L.push(`Example: ${k.example}`); L.push(''); }
    if (c.quotes.length) c.quotes.forEach((q) => L.push(`> ${q}`)); if (c.lesson) L.push('', `**Lesson:** ${c.lesson}`, '');
    if (c.hi_summary) L.push('**हिन्दी सार:** ' + c.hi_summary, ''); if (c.gu_summary) L.push('**ગુજરાતી સાર:** ' + c.gu_summary, '');
  }
  L.push('## Study notes');
  if (d.quotes.length) { L.push('### Memorable quotes'); d.quotes.forEach((q) => L.push(`> ${q}`)); L.push(''); }
  if (d.actions.length) { L.push('### Action checklist'); d.actions.forEach((a) => L.push(`- [${a.done ? 'x' : ' '}] ${a.text}`)); L.push(''); }
  if (d.apply_en) L.push('### How to apply it', d.apply_en, ''); if (d.critique) L.push('### Limits and criticism', d.critique, '');
  if (d.similar.length) { L.push('### Read next'); d.similar.forEach((s) => L.push(`- ${s}`)); L.push(''); }
  if (d.terms.length) { L.push('### Glossary (English · हिन्दी · ગુજરાતી)'); d.terms.forEach((t) => L.push(`- **${t.term}** — ${t.en}${t.hi ? ' · ' + t.hi : ''}${t.gu ? ' · ' + t.gu : ''}`)); L.push(''); }
  if (d.revision_plan) L.push(`*${d.revision_plan}*`, '');
  if (d.myNotes) L.push('## My notes', d.myNotes, '');
  return L.join('\n');
}
export async function saveToNotes(rec) {
  const id = `nt:${rec.id}`;
  const existing = await db.get('notes', id);
  const note = { id, title: `📚 ${rec.title}`, body: toMarkdown(rec), tags: ['book', 'knowledge', ...(existing ? existing.tags.filter((t) => !['book', 'knowledge'].includes(t)) : [])], attachedTo: rec.id, createdAt: existing ? existing.createdAt : nowISO() };
  await store.saveNote(note);
  return note;
}
