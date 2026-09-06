// ai.js — DeepSeek chat client (streaming), tutor prompts, structured grading.
import { getSetting, setSetting, get, put, getAll, del } from './db.js';
import { estimateTokens, uid, nowISO } from './utils.js';

export const ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const MODEL = 'deepseek-chat';
// USD per 1M tokens; editable in Settings. Defaults reflect DeepSeek list pricing (cache miss).
export const DEFAULT_PRICES = { input: 0.27, output: 1.10 };

export async function getKey() { return (await getSetting('apiKey', '')) || ''; }
export async function hasKey() { return !!(await getKey()); }
export async function getPrices() { return (await getSetting('prices', null)) || DEFAULT_PRICES; }

export function tutorSystem(level = 'A2', context = null) {
  let s = `You are a patient English tutor for a Hindi-speaking adult learner at level ${level}. Explain in simple English, then give the same explanation in Hindi (Devanagari). Always give 3+ examples. If the user's message contains English errors, correct them gently at the end under 'Quick fix:'. Be concise. Use short paragraphs and markdown lists; no tables.`;
  if (context && context.text) s += `\n\nThe learner is currently studying: ${context.title ? context.title + ' — ' : ''}${context.text}`;
  return s;
}

/**
 * Stream a chat completion. onToken(delta, fullSoFar). Resolves { content, usage }.
 */
export async function chat({ messages, system, temperature = 0.7, onToken, signal, json = false, maxTokens = 1200 }) {
  const key = await getKey();
  if (!key) throw new Error('NO_KEY');
  await checkCap(0);
  const body = {
    model: MODEL, temperature, stream: !json, max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(ENDPOINT, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || JSON.stringify(j); } catch { /* ignore */ }
    if (res.status === 401) throw new Error('Invalid API key (401). Check Settings.');
    if (res.status === 402) throw new Error('DeepSeek balance is empty (402). Top up your account.');
    if (res.status === 429) throw new Error('Rate limited (429). Wait a moment and try again.');
    throw new Error(`DeepSeek error: ${msg}`);
  }
  const inputTokens = estimateTokens(system) + messages.reduce((a, m) => a + estimateTokens(m.content), 0);
  if (json) {
    const j = await res.json();
    const content = j.choices?.[0]?.message?.content || '';
    const usage = j.usage ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } : { input: inputTokens, output: estimateTokens(content) };
    await addUsage(usage);
    return { content, usage };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', content = '', usage = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content || '';
        if (j.usage) usage = { input: j.usage.prompt_tokens, output: j.usage.completion_tokens };
        if (delta) { content += delta; onToken && onToken(delta, content); }
      } catch { /* partial line */ }
    }
  }
  usage ||= { input: inputTokens, output: estimateTokens(content) };
  await addUsage(usage);
  return { content, usage };
}

async function addUsage(u) {
  const cur = (await getSetting('usage', null)) || { input: 0, output: 0, calls: 0 };
  cur.input += u.input || 0; cur.output += u.output || 0; cur.calls += 1;
  await setSetting('usage', cur);
  const byMonth = (await getSetting('usageByMonth', null)) || {};
  const k = new Date().toISOString().slice(0, 7);
  const m = byMonth[k] || { input: 0, output: 0, calls: 0 };
  m.input += u.input || 0; m.output += u.output || 0; m.calls += 1; byMonth[k] = m;
  await setSetting('usageByMonth', byMonth);
}
export async function usageSummary() {
  const u = (await getSetting('usage', null)) || { input: 0, output: 0, calls: 0 };
  const p = await getPrices();
  const cost = (u.input / 1e6) * p.input + (u.output / 1e6) * p.output;
  return { ...u, cost };
}
export async function resetUsage() { await setSetting('usage', { input: 0, output: 0, calls: 0 }); }

/* ---------------- threads ---------------- */
export async function createThread({ title = 'New chat', context = null } = {}) {
  const t = { id: uid('th'), title, context, summary: '', createdAt: nowISO(), updatedAt: nowISO(), tokensIn: 0, tokensOut: 0, count: 0 };
  await put('threads', t);
  return t;
}
export async function listThreads() {
  const all = await getAll('threads');
  return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
export async function getThread(id) { return get('threads', id); }
export async function deleteThread(id) {
  const msgs = await getAll('messages', { index: 'threadId', query: id });
  for (const m of msgs) await del('messages', m.id);
  await del('threads', id);
}
export async function threadMessages(threadId) {
  const msgs = await getAll('messages', { index: 'threadId', query: threadId });
  return msgs.sort((a, b) => a.ts.localeCompare(b.ts));
}
export async function addMessage(threadId, role, content, extra = {}) {
  const m = { id: uid('msg'), threadId, role, content, ts: nowISO(), ...extra };
  await put('messages', m);
  return m;
}

/**
 * Build the message list to send: rolling summary + last N verbatim.
 * If the thread has > 12 messages and no summary covering them, summarise older ones (one cheap call).
 */
export async function buildContext(thread, msgs, { keep = 10 } = {}) {
  const older = msgs.slice(0, Math.max(0, msgs.length - keep));
  const recent = msgs.slice(-keep);
  let summary = thread.summary || '';
  const summarisedCount = thread.summarisedCount || 0;
  if (older.length > summarisedCount + 4) {
    try {
      const text = older.slice(summarisedCount).map((m) => `${m.role}: ${m.content}`).join('\n');
      const r = await chat({
        system: 'Summarise this English-tutoring conversation in under 120 words, keeping the learner\'s level, recurring mistakes, and topics covered. Output plain text.',
        messages: [{ role: 'user', content: (summary ? `Previous summary: ${summary}\n\nNew turns:\n` : '') + text }],
        temperature: 0.3, maxTokens: 250,
      });
      summary = r.content.trim();
      thread.summary = summary; thread.summarisedCount = older.length;
      await put('threads', thread);
    } catch (e) { console.warn('[ai] summary failed', e); }
  }
  const out = [];
  if (summary) out.push({ role: 'user', content: `(Summary of our earlier conversation: ${summary})` }, { role: 'assistant', content: 'Understood, I remember the context.' });
  for (const m of recent) out.push({ role: m.role, content: m.content });
  return out;
}

/* ---------------- structured helpers ---------------- */
function parseJSON(s) {
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  throw new Error('AI returned invalid JSON');
}

/** Grade a learner's sentence using a target word. */
export async function gradeSentence(word, sentence, level) {
  const r = await chat({
    json: true, temperature: 0.3, maxTokens: 400,
    system: `You grade one English sentence written by a Hindi-speaking learner (level ${level}) who is practising the word "${word}". Respond with JSON only: {"ok": boolean (word used correctly and sentence grammatical), "score": 0-10, "corrected": "corrected sentence or same", "why_en": "one or two short sentences", "why_hi": "same in Devanagari Hindi", "natural": "a more natural alternative sentence using the word"}`,
    messages: [{ role: 'user', content: sentence }],
  });
  return parseJSON(r.content);
}

/** Grade free production for a grammar lesson (3 sentences). */
export async function gradeProduction(lessonTitle, pattern, text, level) {
  const r = await chat({
    json: true, temperature: 0.3, maxTokens: 900,
    system: `You are checking sentences written by a Hindi-speaking English learner (level ${level}) practising the grammar point "${lessonTitle}" (pattern: ${pattern}). For each sentence return a correction. Respond with JSON only: {"overall": 0-10, "summary_en": "...", "summary_hi": "Devanagari", "items": [{"original": "...", "corrected": "...", "ok": boolean, "why_en": "...", "why_hi": "...", "rule": "short rule name"}]}`,
    messages: [{ role: 'user', content: text }],
  });
  return parseJSON(r.content);
}

/** Writing studio rubric. */
export async function gradeWriting(task, register, text, level) {
  const r = await chat({
    json: true, temperature: 0.3, maxTokens: 1800,
    system: `You are an expert English writing coach for a Hindi-speaking security engineer (level ${level}). Task: ${task}. Expected register: ${register}. Grade the text and return JSON only:
{"scores": {"grammar": 0-10, "vocabulary": 0-10, "coherence": 0-10, "register": 0-10, "naturalness": 0-10},
 "corrected": "the full corrected text, same structure and meaning, natural native English, no commentary",
 "changes": [{"from": "exact original fragment", "to": "replacement", "why_en": "short reason", "why_hi": "Devanagari", "rule": "short rule tag e.g. articles, present-perfect, indianism, register"}],
 "strengths_en": "one or two sentences", "advice_en": "the single most valuable thing to work on", "advice_hi": "Devanagari"}
Keep changes to the 3-12 most important ones. Flag Indianisms (kindly, revert back, do the needful, the same, prepone).`,
    messages: [{ role: 'user', content: text }],
  });
  return parseJSON(r.content);
}

/** Speaking feedback from a transcript. */
export async function speakingFeedback(prompt, transcript, seconds, level) {
  const r = await chat({
    json: true, temperature: 0.4, maxTokens: 1000,
    system: `You are an English speaking coach for a Hindi-speaking adult (level ${level}). The learner spoke for ${Math.round(seconds)} seconds in response to: "${prompt}". You receive an automatic transcript (may contain recognition errors; ignore obvious ASR noise). Return JSON only:
{"scores": {"grammar": 0-10, "vocabulary": 0-10, "fluency": 0-10, "task": 0-10},
 "fillers": ["list of filler words/phrases detected, e.g. basically, actually, like"],
 "corrections": [{"from": "...", "to": "...", "why_en": "...", "why_hi": "Devanagari", "rule": "tag"}],
 "better_version": "a natural 60-100 word model answer at the learner's level+1",
 "feedback_en": "3-4 sentences of specific, encouraging feedback", "feedback_hi": "Devanagari"}`,
    messages: [{ role: 'user', content: transcript || '(no speech recognised)' }],
  });
  return parseJSON(r.content);
}

/** Generate new vocabulary entries in the app's schema for a topic. Returns an array. */
export async function generateWords(topic, level, n = 5, avoid = []) {
  const r = await chat({
    json: true, temperature: 0.6, maxTokens: 3500,
    system: `You create vocabulary entries for a Hindi-speaking English learner (level ${level}). Return JSON only: {"words":[...]} with exactly ${n} entries. Each entry: {"word":"...","ipa":"/.../","pos":"noun|verb|adjective|adverb|phrase|phrasal verb|idiom","cefr":"A1|A2|B1|B2|C1","en_def":"simple English definition","hi_def":"Hindi meaning in Devanagari","hi_nuance":"one sentence on how Hindi speakers misuse or confuse this word","examples":[{"en":"natural sentence","hi":"Devanagari translation"}] (exactly 5, varied, real-world),"collocations":["..."],"synonyms":["..."],"antonyms":["..."],"word_family":["..."],"register":"formal|neutral|informal|technical","common_mistake":{"wrong":"a typical Indian-English error sentence","right":"corrected","why":"short reason"},"cloze":{"sentence":"a sentence with ____ where the word goes","answer":"the word form that fills it"}}. Choose genuinely useful, high-frequency words for the topic that a ${level} learner may not know. Do not use any of these words: ${avoid.slice(0, 300).join(', ')}.`,
    messages: [{ role: 'user', content: `Topic: ${topic}` }],
  });
  const j = parseJSON(r.content);
  const list = Array.isArray(j) ? j : (j.words || j.entries || []);
  return list.filter((w) => w && w.word && w.en_def && w.hi_def && Array.isArray(w.examples));
}

/** Grade a Hindi→English translation against a reference (alternatives are accepted). */
export async function gradeTranslation(hindi, reference, typed, level) {
  const r = await chat({
    json: true, temperature: 0.2, maxTokens: 400,
    system: `A Hindi-speaking learner (level ${level}) translated a Hindi sentence into English. The reference translation is only one acceptable answer; accept any natural, grammatical English with the same meaning. Return JSON only: {"ok": boolean (acceptable as-is), "score": 0-10, "corrected": "the learner's sentence corrected minimally (or unchanged)", "why_en": "one short sentence", "why_hi": "same in Devanagari", "rule": "short tag such as articles, tense, preposition, word order, word choice, or 'fine'"}`,
    messages: [{ role: 'user', content: `Hindi: ${hindi}\nReference: ${reference}\nLearner: ${typed}` }],
  });
  return parseJSON(r.content);
}

/* ---------------- Phase 7: monthly spend cap + word enrichment ---------------- */
export const monthKey = () => new Date().toISOString().slice(0, 7);
export async function monthSpend() {
  const m = (await getSetting('usageByMonth', null)) || {};
  const u = m[monthKey()] || { input: 0, output: 0, calls: 0 };
  const p = await getPrices();
  return { ...u, usd: (u.input / 1e6) * p.input + (u.output / 1e6) * p.output };
}
export async function checkCap(projectedUsd = 0) {
  const cap = +(await getSetting('monthlyCapUsd', 0)) || 0;
  if (!cap) return true;
  const { usd } = await monthSpend();
  if (usd + projectedUsd > cap) throw new Error('CAP_REACHED');
  return true;
}
/** Look up a batch of lemmas (≤ 40). Returns an object keyed by lemma. */
export async function enrichWords(lemmasList, level = 'B1', sentences = {}) {
  await checkCap(0.01);
  const ctx = lemmasList.map((l) => sentences[l] ? `${l}: "${String(sentences[l]).slice(0, 140)}"` : l).join('\n');
  const r = await chat({
    json: true, temperature: 0.2, maxTokens: 4000,
    system: `You are a dictionary for a Hindi-speaking English learner (level ${level}). For EVERY word in the list return an entry. Respond with JSON only: {"<word>": {"word": "dictionary headword (lemma)", "ipa": "/…/", "pos": "noun|verb|adjective|adverb|phrase|other", "cefr": "A1|A2|B1|B2|C1|C2", "en_def": "simple English, A2 vocabulary, under 15 words, matching the sense used in the quoted sentence if given", "hi_def": "natural Devanagari Hindi meaning (not transliteration)", "hi_nuance": "one short sentence for Hindi speakers, or empty", "example_en": "one natural example sentence", "example_hi": "its Devanagari translation", "synonyms": ["up to 3"], "register": "formal|neutral|informal|technical|slang"}}. Keys must be exactly the words given.`,
    messages: [{ role: 'user', content: ctx }],
  });
  const j = parseJSON(r.content);
  // tolerate {"words":[...]} shape
  if (Array.isArray(j.words)) { const o = {}; for (const e of j.words) if (e && e.word) o[String(e.word).toLowerCase()] = e; return o; }
  const out = {}; for (const [k, v] of Object.entries(j)) out[String(k).toLowerCase().trim()] = v; return out;
}
