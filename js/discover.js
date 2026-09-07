// discover.js — 🧠 Daily Discovery: a random topic from any field every day (or your own genre), explained simply with real-life application. One AI call, saved forever.
import * as db from './db.js';
import * as ai from './ai.js';
import * as store from './store.js';
import * as content from './content.js';
import { nowISO, hashStr, mulberry32, shuffle, todayKey, dayKey } from './utils.js';

const DEV = /[ऀ-ॿ]/, GUJ = /[઀-૿]/;

export const fields = () => content.load('discover-topics');
export const topicId = (title) => `tp:${hashStr(title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).toString(36)}`;

/** Three topics for a given day, from three different fields, deterministic. */
export async function picksFor(day = todayKey()) {
  const all = await fields();
  const rng = mulberry32(hashStr(day + '|discover'));
  return shuffle(all, rng).slice(0, 3).map((f) => { const t = f.topics[Math.floor(rng() * f.topics.length)]; return { field: f, ...t }; });
}
export async function surprise() {
  const all = await fields(); const f = all[Math.floor(Math.random() * all.length)]; const t = f.topics[Math.floor(Math.random() * f.topics.length)];
  return { field: f, ...t };
}

export async function estimate() {
  const p = await ai.getPrices(); const inr = await db.getSetting('inrRate', 84);
  const usd = (900 / 1e6) * p.input + (3200 / 1e6) * p.output;
  return { usd, inr: usd * inr };
}

async function callJSON(system, user, maxTokens) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ai.chat({ feature: 'discover', json: true, temperature: 0.4, maxTokens, system, messages: [{ role: 'user', content: user }] });
    try { return JSON.parse(r.content); } catch { const m = r.content.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* retry */ } } }
  }
  throw new Error('The tutor returned malformed JSON twice.');
}

const SYSTEM = (level, profile) => `You are a brilliant, friendly teacher explaining one topic from any field to a curious Hindi- and Gujarati-speaking adult (English level ${level}; ${profile}). Goal: they should understand the topic in 10 minutes, see where it appears in their real life, and be able to use it. Rules: SHORT sentences, everyday English, no jargon without an immediate plain meaning. Every abstract idea gets a concrete example (prefer Indian everyday life: rupees, trains, cricket, chai, offices, family). Be accurate; if something is debated, say so. Do not pad.
If the input is a broad field or genre (e.g. "neuroscience", "economics"), CHOOSE one specific, interesting, useful topic inside it and explain that. If the input is a specific topic, explain that topic.
Return JSON only:
{"title": "clear topic title (max 8 words)", "field": "field name", "emoji": "one emoji", "hook": "one sentence that makes the reader curious",
 "eli10": "explain it to a smart 10-year-old in 3–4 sentences",
 "core": "the real explanation in 7–12 short sentences; the reader should fully understand the topic after this",
 "how_it_works": ["3–6 steps or parts, each one sentence, showing the mechanism"],
 "examples": [{"title": "short label", "text": "a concrete real-world example, 2–3 sentences"} × 3],
 "real_life": [{"situation": "a moment in the reader's life (home, money, health, work, phone)", "how": "how this topic applies there and what to do differently, 2–3 sentences"} × 3],
 "why_useful": "why knowing this helps in real life, 3–4 sentences",
 "apply_steps": ["5 concrete actions the reader can take this week, each starting with a verb"],
 "for_security_engineer": "how this topic connects to the reader's work in cybersecurity, 2–4 sentences (find a genuine link; if none, connect to working in tech)",
 "mental_model": {"name": "a memorable name for the one-line model", "line": "the topic compressed into one memorable sentence"},
 "misconceptions": [{"myth": "what people wrongly believe", "truth": "what is actually true, one or two sentences"} × 2–3],
 "deeper": "what experts know that beginners do not: 5–8 sentences, still plain English",
 "facts": ["3–5 surprising, true, specific facts with numbers or names"],
 "history": "who discovered or developed this and when, 2–4 sentences",
 "quiz": [{"q": "question", "options": ["A", "B", "C", "D"], "answer": 0, "why": "one-sentence explanation"} × 4],
 "teach_prompt": "a prompt asking the reader to explain the topic in their own words in 3 sentences to a friend",
 "terms": [{"term": "key word or phrase", "en": "simple meaning under 12 words", "hi": "Devanagari", "gu": "Gujarati script"} × 5–8],
 "related": ["5 related topics worth exploring next, each max 6 words"],
 "further": ["3 well-known books, videos or sources to go deeper, name + one clause"],
 "hi_summary": "5–6 sentence summary in Hindi (Devanagari script)",
 "gu_summary": "5–6 sentence summary in Gujarati (Gujarati script)"}`;

/** Explain a topic (or a field/genre). Returns the saved record. */
export async function explain(input, { field = '' } = {}) {
  const level = await store.level();
  const est = await estimate(); await ai.checkCap(est.usd);
  const j = await callJSON(SYSTEM(level, 'works as a security engineer in India'), `Topic or field: ${input}${field ? `\nField: ${field}` : ''}`, 5000);
  const title = j.title || input;
  const rec = {
    id: topicId(title), kind: 'topic', refId: input, title, ts: nowISO(), day: todayKey(),
    data: { input, field: j.field || field, emoji: j.emoji || '🧠', hook: j.hook || '', eli10: j.eli10 || '', core: j.core || '', how_it_works: j.how_it_works || [], examples: (j.examples || []).filter((e) => e && e.text), real_life: (j.real_life || []).filter((r) => r && r.how), why_useful: j.why_useful || '', apply_steps: (j.apply_steps || []).map((t) => ({ text: t, done: false })), for_security_engineer: j.for_security_engineer || '', mental_model: j.mental_model || null, misconceptions: (j.misconceptions || []).filter((m) => m && m.myth), deeper: j.deeper || '', facts: j.facts || [], history: j.history || '', quiz: (j.quiz || []).filter((q) => q && q.q && Array.isArray(q.options) && q.options.length >= 2), quizResult: null, teach_prompt: j.teach_prompt || '', teachBack: null, terms: (j.terms || []).filter((t) => t && t.term && t.en).map((t) => ({ term: t.term, en: t.en, hi: DEV.test(t.hi || '') ? t.hi : '', gu: GUJ.test(t.gu || '') ? t.gu : '' })), related: j.related || [], further: j.further || [], hi_summary: DEV.test(j.hi_summary || '') ? j.hi_summary : '', gu_summary: GUJ.test(j.gu_summary || '') ? j.gu_summary : '', more: [], myNotes: '', level, estimatedUsd: est.usd },
  };
  await db.put('generated', rec);
  await store.bumpDay({ attempts: 1, skill: 'vocab' });
  return rec;
}

/** Go deeper: 4–6 more advanced points, appended to data.more. */
export async function deepen(rec) {
  const level = await store.level();
  const j = await callJSON(`You are continuing a lesson on "${rec.title}" (${rec.data.field}) for a Hindi- and Gujarati-speaking adult (English level ${level}). They already understood: ${rec.data.core} Give 4–6 ADDITIONAL, more advanced points not yet covered (edge cases, debates, second-order effects, numbers, how professionals use it), each with a concrete example. Plain English, short sentences. Return JSON only: {"points":[{"title":"...","text":"3–6 sentences","example":"..."}]}`, `Already covered: ${rec.data.how_it_works.join('; ')} | ${rec.data.facts.join('; ')}`, 2500);
  const pts = (j.points || []).filter((p) => p && p.title && p.text);
  rec.data.more.push(...pts); await db.put('generated', rec); return pts.length;
}

/** Grade the reader's own explanation: understanding + English. */
export async function gradeTeachBack(rec, text) {
  const level = await store.level();
  const j = await callJSON(`You are checking whether a learner (English level ${level}, Hindi/Gujarati speaker) understood "${rec.title}". The correct explanation: ${rec.data.core} Grade their explanation. Return JSON only: {"understanding": 0-10, "english": 0-10, "correct": ["what they got right, 1–3 short items"], "missing": ["important ideas they missed or got wrong, 1–3 items"], "corrected": "their text rewritten in natural, correct English (keep their ideas)", "tip": "one sentence of encouragement plus the single most useful next step"}`, text, 900);
  rec.data.teachBack = { text, ts: nowISO(), ...j }; await db.put('generated', rec); return rec.data.teachBack;
}

export async function get(id) { return db.get('generated', id); }
export async function list() { return (await db.getAll('generated', { index: 'kind', query: 'topic' })).sort((a, b) => b.ts.localeCompare(a.ts)); }
export async function save(rec) { return db.put('generated', rec); }
export async function remove(id) { return db.del('generated', id); }

/** Streak of consecutive days (ending today or yesterday) with at least one discovery. */
export function streakOf(recs) {
  const days = new Set(recs.map((r) => r.day || dayKey(new Date(r.ts))));
  let n = 0; const d = new Date(); if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function toMarkdown(rec) {
  const d = rec.data; const L = [];
  L.push(`# ${d.emoji} ${rec.title}`, `*${d.field}*`, '', d.hook, '');
  L.push('## In simple words', d.eli10, '', '## The real explanation', d.core, '');
  if (d.how_it_works.length) { L.push('## How it works'); d.how_it_works.forEach((s, i) => L.push(`${i + 1}. ${s}`)); L.push(''); }
  if (d.examples.length) { L.push('## Examples'); d.examples.forEach((e) => L.push(`- **${e.title}.** ${e.text}`)); L.push(''); }
  if (d.real_life.length) { L.push('## In your real life'); d.real_life.forEach((r) => L.push(`- **${r.situation}:** ${r.how}`)); L.push(''); }
  if (d.why_useful) L.push('## Why it is useful', d.why_useful, '');
  if (d.apply_steps.length) { L.push('## Apply it this week'); d.apply_steps.forEach((a) => L.push(`- [${a.done ? 'x' : ' '}] ${a.text}`)); L.push(''); }
  if (d.for_security_engineer) L.push('## For a security engineer', d.for_security_engineer, '');
  if (d.mental_model) L.push(`## Mental model: ${d.mental_model.name}`, `> ${d.mental_model.line}`, '');
  if (d.misconceptions.length) { L.push('## Misconceptions'); d.misconceptions.forEach((m) => L.push(`- ❌ ${m.myth}\n  ✅ ${m.truth}`)); L.push(''); }
  if (d.deeper) L.push('## Going deeper', d.deeper, '');
  d.more.forEach((p) => L.push(`### ${p.title}`, p.text, p.example ? `Example: ${p.example}` : '', ''));
  if (d.facts.length) { L.push('## Facts'); d.facts.forEach((f) => L.push(`- ${f}`)); L.push(''); }
  if (d.history) L.push('## History', d.history, '');
  if (d.terms.length) { L.push('## Terms (English · हिन्दी · ગુજરાતી)'); d.terms.forEach((t) => L.push(`- **${t.term}** — ${t.en}${t.hi ? ' · ' + t.hi : ''}${t.gu ? ' · ' + t.gu : ''}`)); L.push(''); }
  if (d.quiz.length) { L.push('## Quiz'); d.quiz.forEach((q, i) => L.push(`${i + 1}. ${q.q}`, ...q.options.map((o, k) => `   - ${k === q.answer ? '**' : ''}${o}${k === q.answer ? '** ✓' : ''}`), `   ${q.why}`)); L.push(''); }
  if (d.related.length) L.push('## Explore next', d.related.map((r) => `- ${r}`).join('\n'), '');
  if (d.further.length) L.push('## Go further', d.further.map((r) => `- ${r}`).join('\n'), '');
  if (d.hi_summary) L.push('## हिन्दी सार', d.hi_summary, ''); if (d.gu_summary) L.push('## ગુજરાતી સાર', d.gu_summary, '');
  if (d.teachBack) L.push('## My explanation', d.teachBack.text, '', `Understanding ${d.teachBack.understanding}/10 · English ${d.teachBack.english}/10`, d.teachBack.corrected, '');
  if (d.myNotes) L.push('## My notes', d.myNotes, '');
  return L.join('\n');
}
export async function saveToNotes(rec) {
  const id = `nt:${rec.id}`;
  const existing = await db.get('notes', id);
  const note = { id, title: `${rec.data.emoji} ${rec.title}`, body: toMarkdown(rec), tags: ['discover', 'knowledge', ...(existing ? existing.tags.filter((t) => !['discover', 'knowledge'].includes(t)) : [])], attachedTo: rec.id, createdAt: existing ? existing.createdAt : nowISO() };
  await store.saveNote(note);
  return note;
}
