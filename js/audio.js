// audio.js — record with MediaRecorder, play back, persist latest recording per item.
import { get, put, del, getAll } from './db.js';
import { toast } from './ui.js';

export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

let stream = null;
let recorder = null;
let chunks = [];
let startedAt = 0;
let ctx = null, analyser = null, meterTimer = null;

function pickMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
  for (const t of types) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

export async function start({ onLevel } = {}) {
  if (!canRecord()) { toast('Recording is not supported in this browser.', 'warn'); return false; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Microphone permission denied. Allow it in Settings → Safari → Microphone.' : `Microphone error: ${e.message}`, 'err', { timeout: 6000 });
    return false;
  }
  const mime = pickMime();
  try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
  catch { recorder = new MediaRecorder(stream); }
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start(250);
  startedAt = performance.now();
  if (onLevel) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser(); analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      meterTimer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      }, 80);
    } catch { /* meter optional */ }
  }
  return true;
}

export function isRecording() { return !!(recorder && recorder.state === 'recording'); }

/** Stop and resolve { blob, mime, seconds } */
export function stop() {
  return new Promise((resolve) => {
    if (!recorder) { resolve(null); return; }
    const rec = recorder;
    const seconds = (performance.now() - startedAt) / 1000;
    rec.onstop = () => {
      const mime = rec.mimeType || chunks[0]?.type || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      cleanup();
      resolve({ blob, mime, seconds });
    };
    try { rec.state !== 'inactive' ? rec.stop() : rec.onstop(); } catch { cleanup(); resolve(null); }
  });
}
function cleanup() {
  clearInterval(meterTimer); meterTimer = null;
  if (ctx) { try { ctx.close(); } catch { /* ignore */ } ctx = null; analyser = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  recorder = null; chunks = [];
}
export function cancel() { try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ } cleanup(); }

let player = null;
export function play(blob) {
  return new Promise((resolve) => {
    stopPlayback();
    const url = URL.createObjectURL(blob);
    player = new Audio(url);
    player.onended = () => { URL.revokeObjectURL(url); player = null; resolve(true); };
    player.onerror = () => { URL.revokeObjectURL(url); player = null; toast('Could not play recording.', 'err'); resolve(false); };
    player.play().catch(() => { resolve(false); });
  });
}
export function stopPlayback() { if (player) { try { player.pause(); } catch { /* ignore */ } player = null; } }

/* ---------------- persistence (latest recording per refId, capped) ---------------- */
const CAP = 200;
export async function saveRecording(refId, blob, mime, seconds) {
  await put('audio', { id: refId, blob, mime, seconds, ts: new Date().toISOString() });
  // LRU eviction
  const all = await getAll('audio', { index: 'ts' });
  if (all.length > CAP) {
    const evict = all.slice(0, all.length - CAP);
    for (const r of evict) await del('audio', r.id);
  }
}
export async function getRecording(refId) { return get('audio', refId); }
export async function deleteRecording(refId) { return del('audio', refId); }
export async function recordingCount() { return (await getAll('audio')).length; }
export async function clearRecordings() { const all = await getAll('audio'); for (const r of all) await del('audio', r.id); return all.length; }
