// pitch.js — §9 autocorrelation f0 contour, speaking rate, pauses from a recorded Blob (works on iOS, no ASR needed).
const FMIN = 75, FMAX = 350;

export async function analyseBlob(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let buf;
  try { buf = await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { try { ctx.close(); } catch { /* ignore */ } }
  const sr = buf.sampleRate; const x = buf.getChannelData(0);
  const frame = 2048, hop = 1024;
  const f0 = []; const energy = [];
  const minLag = Math.floor(sr / FMAX), maxLag = Math.ceil(sr / FMIN);
  for (let start = 0; start + frame <= x.length; start += hop) {
    let e = 0; for (let k = 0; k < frame; k++) e += x[start + k] * x[start + k];
    const rms = Math.sqrt(e / frame); energy.push(rms);
    let hz = 0, clarity = 0;
    if (rms > 0.01) {
      // normalised autocorrelation over the lag range
      let best = 0, bestLag = 0;
      let r0 = 0; for (let k = 0; k < frame; k++) r0 += x[start + k] * x[start + k];
      for (let lag = minLag; lag <= maxLag; lag++) {
        let r = 0; for (let k = 0; k < frame - lag; k += 2) r += x[start + k] * x[start + k + lag];
        r = (2 * r) / r0;
        if (r > best) { best = r; bestLag = lag; }
      }
      if (best > 0.3 && bestLag) { hz = sr / bestLag; clarity = best; }
    }
    f0.push({ t: start / sr, hz, clarity });
  }
  // median filter (5) on voiced frames
  const voiced = f0.map((p) => p.hz);
  for (let i = 2; i < voiced.length - 2; i++) { if (!voiced[i]) continue; const w = [voiced[i - 2], voiced[i - 1], voiced[i], voiced[i + 1], voiced[i + 2]].filter(Boolean).sort((a, b) => a - b); f0[i].hz = w[Math.floor(w.length / 2)]; }
  const hzs = f0.filter((p) => p.hz).map((p) => p.hz);
  const median = hzs.length ? hzs.slice().sort((a, b) => a - b)[Math.floor(hzs.length / 2)] : 0;
  const semis = f0.map((p) => ({ t: p.t, st: p.hz && median ? 12 * Math.log2(p.hz / median) : null }));
  // pauses: energy below threshold for > 250 ms
  const thr = Math.max(0.004, Math.max(...energy) * 0.04);
  const pauses = []; let run = 0; let runStart = 0;
  energy.forEach((e, i) => { if (e < thr) { if (!run) runStart = i; run++; } else { if (run * hop / sr > 0.25 && runStart > 0) pauses.push({ t: runStart * hop / sr, d: run * hop / sr }); run = 0; } });
  const speech = energy.filter((e) => e >= thr).length * hop / sr;
  // syllable nuclei ≈ energy peaks in the voiced envelope
  let syll = 0; for (let i = 1; i < energy.length - 1; i++) if (energy[i] > thr * 2 && energy[i] > energy[i - 1] && energy[i] >= energy[i + 1] && f0[i].hz) syll++;
  const duration = x.length / sr;
  const range = hzs.length ? Math.max(...hzs) - Math.min(...hzs) : 0;
  return { f0, semis, median, duration, speech, pauses, pauseCount: pauses.length, avgPause: pauses.length ? pauses.reduce((a, p) => a + p.d, 0) / pauses.length : 0, syllables: syll, rate: speech > 0 ? syll / speech : 0, rangeHz: range, rangeSemis: hzs.length ? 12 * Math.log2(Math.max(...hzs) / Math.min(...hzs)) : 0 };
}

/** Compare my contour to a model contour (0–3 per word) → verdict text. */
export function verdict(res, model = null, type = null) {
  const notes = [];
  if (res.rangeSemis < 3) notes.push('Your pitch is almost flat. English moves 6–10 semitones inside a sentence; let it rise and fall.');
  if (model && model.length >= 2) {
    const end = endSlope(res.semis);
    const modelEnd = model[model.length - 1] - model[model.length - 2];
    if (modelEnd > 0 && end < 0.3) notes.push(`Your pitch stays flat or falls at the end${type === 'yes-no' ? ' of a yes/no question' : ''}. English rises there.`);
    if (modelEnd < 0 && end > 0.5) notes.push('You rise at the end where English falls. Falling makes it sound finished and confident.');
  }
  if (res.rate && res.rate < 2.5) notes.push(`Speaking rate ${res.rate.toFixed(1)} syllables/sec is slow; natural English is 3.5–5.`);
  if (res.rate > 6) notes.push('Very fast: stressed syllables need more time than the others.');
  if (res.pauseCount > 3 && res.avgPause > 0.6) notes.push(`${res.pauseCount} long pauses (avg ${res.avgPause.toFixed(1)}s). Aim for one breath per phrase.`);
  return notes.length ? notes[0] : 'Pitch movement and rhythm look natural.';
}
function endSlope(semis) {
  const v = semis.filter((p) => p.st !== null);
  if (v.length < 6) return 0;
  const tail = v.slice(-Math.max(4, Math.floor(v.length * 0.2)));
  return (tail[tail.length - 1].st - tail[0].st) / Math.max(1, tail.length - 1);
}

/** Resample my contour to N points (per word) for overlay. */
export function toWordContour(semis, n) {
  const v = semis.filter((p) => p.st !== null);
  if (!v.length) return new Array(n).fill(null);
  const out = [];
  for (let i = 0; i < n; i++) { const a = Math.floor((i / n) * v.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * v.length)); const seg = v.slice(a, b); out.push(seg.reduce((s, p) => s + p.st, 0) / seg.length); }
  // normalise to 0–3 like the model
  const min = Math.min(...out), max = Math.max(...out);
  return out.map((x) => (max > min ? ((x - min) / (max - min)) * 3 : 1.5));
}
