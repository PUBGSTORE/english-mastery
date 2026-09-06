// asr.js — speech recognition + word-level scoring.
import { alignWords, tokenize, damerau, soundKey } from './utils.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const supported = () => !!SR;

/** True on iOS/iPadOS Safari where SpeechRecognition is missing or unreliable. */
export function isAppleMobile() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS;
}

let current = null;

/**
 * Recognise one utterance. Resolves { transcript, alternatives[], confidence } or rejects with an Error(code).
 * options: lang, timeoutMs (max listening time), onInterim(text), onStart
 */
export function recognise({ lang = 'en-US', timeoutMs = 15000, onInterim, onStart } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) { reject(new Error('unsupported')); return; }
    stop();
    const rec = new SR();
    current = rec;
    rec.lang = lang;
    rec.interimResults = !!onInterim;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    let finalText = '';
    let alts = [];
    let conf = 0;
    let done = false;
    const timer = setTimeout(() => { try { rec.stop(); } catch { /* ignore */ } }, timeoutMs);
    rec.onstart = () => onStart && onStart();
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          finalText += r[0].transcript + ' ';
          conf = r[0].confidence || conf;
          alts = Array.from({ length: r.length }, (_, k) => r[k].transcript);
        } else interim += r[0].transcript;
      }
      if (onInterim) onInterim((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (done) return; done = true; clearTimeout(timer); current = null;
      const code = e.error || 'error';
      if (code === 'no-speech' || code === 'aborted') resolve({ transcript: '', alternatives: [], confidence: 0, error: code });
      else reject(new Error(code));
    };
    rec.onend = () => {
      if (done) return; done = true; clearTimeout(timer); current = null;
      resolve({ transcript: finalText.trim(), alternatives: alts, confidence: conf });
    };
    try { rec.start(); } catch (e) { done = true; clearTimeout(timer); reject(e); }
  });
}
export function stop() { if (current) { try { current.abort(); } catch { /* ignore */ } current = null; } }

/**
 * Score a spoken attempt against a target sentence.
 * Considers all alternatives and keeps the best-scoring one.
 * Returns { words: [{word, status: 'green'|'amber'|'red'}], extra: [..], accuracy, completeness, fluency, wps, transcript }
 */
export function score(target, result, seconds, targetWps = [2.0, 3.0]) {
  const candidates = [result.transcript, ...(result.alternatives || [])].filter(Boolean);
  if (!candidates.length) candidates.push('');
  let best = null;
  for (const c of candidates) {
    const s = scoreOne(target, c);
    if (!best || s.accuracy > best.accuracy) best = { ...s, transcript: c };
  }
  const spokenWords = tokenize(best.transcript).length;
  const wps = seconds > 0 ? spokenWords / seconds : 0;
  let fluency = 0;
  if (seconds > 0 && spokenWords > 0) {
    const [lo, hi] = targetWps;
    if (wps >= lo && wps <= hi) fluency = 100;
    else if (wps < lo) fluency = Math.max(0, Math.round((wps / lo) * 100));
    else fluency = Math.max(0, Math.round(100 - ((wps - hi) / hi) * 100));
  }
  return { ...best, wps: Math.round(wps * 10) / 10, fluency, seconds: Math.round(seconds * 10) / 10 };
}

function scoreOne(target, transcript) {
  const T = tokenize(target);
  const H = tokenize(transcript);
  const ops = alignWords(T, H);
  const words = [];
  const extra = [];
  let green = 0, amber = 0;
  for (const op of ops) {
    if (op.type === 'eq') { words.push({ word: op.a, status: 'green' }); green++; }
    else if (op.type === 'sub') {
      const close = damerau(op.a, op.b) <= (op.a.length <= 4 ? 1 : 2) || (soundKey(op.a) && soundKey(op.a) === soundKey(op.b));
      words.push({ word: op.a, status: close ? 'amber' : 'red', heard: op.b });
      if (close) amber++;
    }
    else if (op.type === 'del') words.push({ word: op.a, status: 'red' });
    else extra.push(op.b);
  }
  const n = T.length || 1;
  const accuracy = Math.round(((green + 0.5 * amber) / n) * 100);
  const completeness = Math.round(((green + amber) / n) * 100);
  return { words, extra, accuracy, completeness };
}

/** Render the coloured word tiles */
export function tilesHtml(words, extra = []) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let h = '<div class="word-tiles">';
  for (const w of words) h += `<span class="word-tile ${w.status}" title="${w.heard ? 'heard: ' + esc(w.heard) : ''}">${esc(w.word)}</span>`;
  for (const x of extra) h += `<span class="word-tile extra">+${esc(x)}</span>`;
  return h + '</div>';
}
