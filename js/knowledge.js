// knowledge.js — "Get Fast Knowledge": exhaustive, chunked analysis of a long video transcript with DeepSeek.
// Every chunk is analysed separately so nothing is summarised away; a final pass adds the overview, big ideas and actions.
import * as db from './db.js';
import * as ai from './ai.js';
import * as store from './store.js';
import { uid, nowISO, hashStr } from './utils.js';

const CHUNK_WORDS = 2000;
const DEV = /[ऀ-ॿ]/, GUJ = /[઀-૿]/;

export function chunkTranscript(text, segments) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += CHUNK_WORDS) chunks.push({ index: chunks.length, text: words.slice(i, i + CHUNK_WORDS).join(' '), startWord: i });
  // attach a start time per chunk from segments (by cumulative word count)
  if (segments && segments.length) {
    let acc = 0; const marks = [];
    for (const s of segments) { marks.push({ w: acc, t: s.t }); acc += s.text.split(/\s+/).length; }
    for (const c of chunks) { let best = marks[0]; for (const m of marks) { if (m.w <= c.startWord) best = m; else break; } c.t = best ? best.t : null; }
  }
  return chunks;
}

export async function estimate(text) {
  const p = await ai.getPrices(); const inr = await db.getSetting('inrRate', 84);
  const inTok = Math.ceil(text.length / 4) + 400 * Math.ceil(text.split(/\s+/).length / CHUNK_WORDS) + 1500;
  const outTok = Math.ceil(inTok * 0.45) + 1200;
  const usd = (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
  return { usd, inr: usd * inr, inTok, outTok, chunks: Math.ceil(text.split(/\s+/).length / CHUNK_WORDS) };
}

async function callJSON(system, user, maxTokens) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ai.chat({ json: true, temperature: 0.3, maxTokens, system, messages: [{ role: 'user', content: user }] });
    try { return JSON.parse(r.content); } catch { const m = r.content.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* retry */ } } }
  }
  throw new Error('The tutor returned malformed JSON twice.');
}

const CHUNK_SYSTEM = (level, title, i, n) => `You are an expert note-taker helping a Hindi- and Gujarati-speaking Indian learner (English level ${level}) get EVERYTHING out of a long video ("${title}"). This is part ${i + 1} of ${n} of the transcript.
Extract EVERY distinct learning, idea, argument, story, tip, number, framework and example in this part. Do NOT compress: if a point is explained at length in the video, explain it at length; if it is brief, keep it brief. Never drop a point because it seems minor. Write in simple, clear English (short sentences, everyday words) but keep technical terms and explain them.
Return JSON only:
{"chapter_title": "5-9 word title for this part",
 "learnings": [{"title": "what the point is, in one line", "explanation": "full explanation in simple English, as long as the video's treatment deserves (2–12 sentences)", "examples": ["concrete examples, stories, data or numbers mentioned, verbatim where possible"], "steps": ["actionable steps or advice if any"], "quote": "a memorable verbatim sentence from the speaker, or empty"}],
 "terms": [{"term": "important word or phrase a learner may not know", "en": "simple English meaning (under 15 words)", "hi": "Hindi meaning in Devanagari", "gu": "Gujarati meaning in Gujarati script"}] (every term worth knowing; 5–20),
 "hi_summary": "3–6 sentence Hindi (Devanagari) summary of this part's learnings",
 "gu_summary": "3–6 sentence Gujarati (Gujarati script) summary of this part's learnings"}`;

const FINAL_SYSTEM = (level, title) => `You are finishing an exhaustive study guide for the video "${title}" for a Hindi- and Gujarati-speaking learner (English level ${level}). You receive the chapter titles and every learning title already extracted. Return JSON only:
{"overview": "what this video is about and why it matters, 4–8 sentences, simple English",
 "big_ideas": ["the 5–10 most important takeaways, each one full sentence"],
 "actions": ["a checklist of 5–12 concrete things the learner can do or apply, each starting with a verb"],
 "who_for": "one sentence on who benefits most",
 "hi_overview": "the overview in Hindi (Devanagari)",
 "gu_overview": "the overview in Gujarati (Gujarati script)",
 "study_tip": "one sentence: how to review this guide to remember it"}`;

/**
 * Analyse a whole transcript. onProgress(i, n, label). Returns the saved record.
 */
export async function analyse({ videoId, title, channel, thumb, url, duration, transcript, segments }, { onProgress = null } = {}) {
  const level = await store.level();
  const chunks = chunkTranscript(transcript, segments);
  const est = await estimate(transcript);
  await ai.checkCap(est.usd);
  const chapters = []; const terms = new Map(); let failed = 0; let done = 0;
  const work = async (c) => {
    try {
      const j = await callJSON(CHUNK_SYSTEM(level, title, c.index, chunks.length), c.text, 6000);
      const learnings = (j.learnings || []).filter((l) => l && l.title && l.explanation).map((l) => ({ title: l.title, explanation: l.explanation, examples: Array.isArray(l.examples) ? l.examples.filter(Boolean) : [], steps: Array.isArray(l.steps) ? l.steps.filter(Boolean) : [], quote: l.quote || '' }));
      chapters.push({ index: c.index, title: j.chapter_title || `Part ${c.index + 1}`, t: c.t ?? null, learnings, hi_summary: DEV.test(j.hi_summary || '') ? j.hi_summary : '', gu_summary: GUJ.test(j.gu_summary || '') ? j.gu_summary : '', words: c.text.split(/\s+/).length });
      for (const t of j.terms || []) { if (t && t.term && t.en && !terms.has(t.term.toLowerCase())) terms.set(t.term.toLowerCase(), { term: t.term, en: t.en, hi: DEV.test(t.hi || '') ? t.hi : '', gu: GUJ.test(t.gu || '') ? t.gu : '', chapter: c.index }); }
    } catch (e) {
      if (e.message === 'CAP_REACHED' || e.message === 'NO_KEY') throw e;
      failed++; chapters.push({ index: c.index, title: `Part ${c.index + 1} (analysis failed: ${e.message})`, t: c.t ?? null, learnings: [], hi_summary: '', gu_summary: '', words: c.text.split(/\s+/).length, failed: true });
    }
    done++; onProgress && onProgress(done, chunks.length, `Analysed part ${done} of ${chunks.length}…`);
  };
  onProgress && onProgress(0, chunks.length, `Analysing ${chunks.length} part${chunks.length > 1 ? 's' : ''} (two at a time)…`);
  const queue = chunks.slice();
  await Promise.all([0, 1].map(async () => { while (queue.length) await work(queue.shift()); }));
  chapters.sort((a, b) => a.index - b.index);
  onProgress && onProgress(chunks.length, chunks.length, 'Writing the overview…');
  let final = {};
  try { final = await callJSON(FINAL_SYSTEM(level, title), chapters.map((ch) => `## ${ch.title}\n` + ch.learnings.map((l) => `- ${l.title}`).join('\n')).join('\n\n'), 1800); } catch (e) { if (e.message === 'CAP_REACHED') throw e; }
  const rec = {
    id: `kn:${videoId}`, kind: 'knowledge', refId: videoId, title, ts: nowISO(),
    data: { channel, thumb, url, duration, words: transcript.split(/\s+/).length, chunks: chunks.length, failed,
      overview: final.overview || '', big_ideas: final.big_ideas || [], actions: (final.actions || []).map((a) => ({ text: a, done: false })), who_for: final.who_for || '', hi_overview: final.hi_overview || '', gu_overview: final.gu_overview || '', study_tip: final.study_tip || '',
      chapters, terms: [...terms.values()], myNotes: '', estimatedUsd: est.usd, level },
  };
  await db.put('generated', rec);
  await store.bumpDay({ attempts: 1, skill: 'listening' });
  return rec;
}

export async function get(videoId) { return db.get('generated', `kn:${videoId}`); }
export async function list() { return (await db.getAll('generated', { index: 'kind', query: 'knowledge' })).sort((a, b) => b.ts.localeCompare(a.ts)); }
export async function save(rec) { return db.put('generated', rec); }
export async function remove(videoId) { return db.del('generated', `kn:${videoId}`); }

/** Markdown export of a guide (also used for the Notes page). */
export function toMarkdown(rec) {
  const d = rec.data; const L = [];
  L.push(`# ${rec.title}`); if (d.channel) L.push(`*${d.channel}* · ${d.url || ''}`); L.push('');
  if (d.overview) { L.push('## Overview', d.overview, ''); }
  if (d.hi_overview) L.push('**हिन्दी:** ' + d.hi_overview, '');
  if (d.gu_overview) L.push('**ગુજરાતી:** ' + d.gu_overview, '');
  if (d.big_ideas.length) { L.push('## Big ideas'); d.big_ideas.forEach((b) => L.push(`- ${b}`)); L.push(''); }
  for (const ch of d.chapters) {
    L.push(`## ${ch.index + 1}. ${ch.title}${ch.t != null ? ` (${fmt(ch.t)})` : ''}`);
    for (const l of ch.learnings) {
      L.push(`### ${l.title}`, l.explanation);
      if (l.examples.length) { L.push('Examples:'); l.examples.forEach((e) => L.push(`- ${e}`)); }
      if (l.steps.length) { L.push('Steps:'); l.steps.forEach((s, i) => L.push(`${i + 1}. ${s}`)); }
      if (l.quote) L.push(`> ${l.quote}`);
      L.push('');
    }
    if (ch.hi_summary) L.push('**हिन्दी सार:** ' + ch.hi_summary, '');
    if (ch.gu_summary) L.push('**ગુજરાતી સાર:** ' + ch.gu_summary, '');
  }
  if (d.terms.length) { L.push('## Glossary (English · हिन्दी · ગુજરાતી)'); d.terms.forEach((t) => L.push(`- **${t.term}** — ${t.en}${t.hi ? ' · ' + t.hi : ''}${t.gu ? ' · ' + t.gu : ''}`)); L.push(''); }
  if (d.actions.length) { L.push('## Action checklist'); d.actions.forEach((a) => L.push(`- [${a.done ? 'x' : ' '}] ${a.text}`)); L.push(''); }
  if (d.myNotes) L.push('## My notes', d.myNotes, '');
  return L.join('\n');
}
export function fmt(sec) { if (sec == null) return ''; const m = Math.floor(sec / 60), s = Math.floor(sec % 60); const h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; }

/** One-click: create/update the Notes page for this video. */
export async function saveToNotes(rec) {
  const id = `nt:kn:${rec.refId}`;
  const existing = await db.get('notes', id);
  const note = { id, title: `🦉 ${rec.title}`, body: toMarkdown(rec), tags: ['video', 'knowledge', ...(existing ? existing.tags.filter((t) => !['video', 'knowledge'].includes(t)) : [])], attachedTo: `kn:${rec.refId}`, createdAt: existing ? existing.createdAt : nowISO() };
  await store.saveNote(note);
  return note;
}
