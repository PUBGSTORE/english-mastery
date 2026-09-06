// tts.js — speechSynthesis wrapper with iOS quirks handled.
import { toast } from './ui.js';

let voices = [];
let preferredVoiceName = null;
let warmed = false;
let currentRate = 1.0;
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export const supported = () => !!synth && 'SpeechSynthesisUtterance' in window;

function refreshVoices() {
  if (!synth) return;
  voices = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
}
if (synth) {
  refreshVoices();
  synth.addEventListener && synth.addEventListener('voiceschanged', refreshVoices);
  if (typeof synth.onvoiceschanged !== 'undefined') synth.onvoiceschanged = refreshVoices;
}

export function getVoices() { if (!voices.length) refreshVoices(); return voices; }
export function setPreferredVoice(name) { preferredVoiceName = name || null; }
export function setRate(r) { currentRate = r; }
export function getRate() { return currentRate; }

const PREFERRED = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Ava', 'Allison', 'Google US English', 'Google UK English Female', 'Microsoft Aria', 'Microsoft Jenny', 'Alex'];
export function pickVoice() {
  const list = getVoices();
  if (!list.length) return null;
  if (preferredVoiceName) { const v = list.find((x) => x.name === preferredVoiceName); if (v) return v; }
  // Prefer high-quality, non-compact voices on Apple platforms
  const premium = list.find((v) => /premium|enhanced/i.test(v.name) && /en[-_](US|GB)/i.test(v.lang));
  if (premium) return premium;
  for (const p of PREFERRED) { const v = list.find((x) => x.name.startsWith(p)); if (v) return v; }
  return list.find((v) => /en[-_]US/i.test(v.lang)) || list.find((v) => /en[-_]GB/i.test(v.lang)) || list[0];
}

/** iOS requires the first utterance to happen inside a user gesture. Call from any tap. */
export function warmup() {
  if (warmed || !supported()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0; u.rate = 1;
    synth.speak(u);
    warmed = true;
  } catch { /* ignore */ }
}
document.addEventListener('pointerdown', warmup, { once: true, capture: true });

function splitChunks(text) {
  // Safari drops long utterances; split on sentence boundaries into ≤ ~200 chars.
  const parts = String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*\s*/g) || [String(text)];
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 200 && cur) { chunks.push(cur.trim()); cur = p; } else cur += p;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

let active = null;
let keepAlive = null;

/**
 * Speak text. Resolves when finished (or cancelled). Options: rate, lang, pitch, onBoundary, onStart.
 */
export function speak(text, { rate, lang = 'en-US', pitch = 1, onStart, onEnd, onBoundary } = {}) {
  return new Promise((resolve) => {
    if (!supported()) { toast('Text-to-speech is not available in this browser.', 'warn'); resolve(false); return; }
    stop();
    const chunks = splitChunks(text);
    const voice = pickVoice();
    const r = rate ?? currentRate;
    let i = 0;
    let started = false;
    const token = { cancelled: false };
    active = token;
    const next = () => {
      if (token.cancelled) { finish(); return; }
      if (i >= chunks.length) { finish(true); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : lang;
      u.rate = r; u.pitch = pitch; u.volume = 1;
      u.onstart = () => { if (!started) { started = true; onStart && onStart(); } };
      u.onend = () => next();
      u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') console.warn('[tts]', e.error); finish(false); };
      if (onBoundary) u.onboundary = (e) => onBoundary(e);
      synth.speak(u);
    };
    const finish = (ok = false) => {
      if (active === token) active = null;
      clearInterval(keepAlive); keepAlive = null;
      onEnd && onEnd(ok);
      resolve(ok);
    };
    // Chrome bug: speech pauses after ~15s unless resumed periodically.
    clearInterval(keepAlive);
    keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 10000);
    // iOS Safari sometimes needs cancel() before speak() to reset a stuck queue.
    try { synth.cancel(); } catch { /* ignore */ }
    setTimeout(next, 30);
  });
}

export function stop() {
  if (!supported()) return;
  if (active) active.cancelled = true;
  active = null;
  clearInterval(keepAlive); keepAlive = null;
  try { synth.cancel(); } catch { /* ignore */ }
}
export const isSpeaking = () => !!(synth && synth.speaking);

// Delegated: any element with data-speak="text" speaks on click. data-rate optional.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-speak]');
  if (!b) return;
  e.preventDefault();
  const rate = b.getAttribute('data-rate');
  speak(b.getAttribute('data-speak'), { rate: rate ? parseFloat(rate) : undefined });
});
