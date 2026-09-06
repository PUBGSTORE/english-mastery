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
