// utils.js — pure helpers, no DOM, no DB.

export function uid(prefix = '') {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}:${t}${r}` : `${t}${r}`;
}

/** FNV-1a 32-bit hash of a string → unsigned int */
export function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG. Returns a function producing [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Local-time day key YYYY-MM-DD */
export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export const todayKey = () => dayKey(new Date());

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function dayKeyOffset(n, from = new Date()) { return dayKey(addDays(from, n)); }
export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function daysBetween(keyA, keyB) {
  return Math.round((parseDayKey(keyB) - parseDayKey(keyA)) / 86400000);
}

export const nowISO = () => new Date().toISOString();

export function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  try { return new Date(iso).toLocaleDateString(undefined, opts); } catch { return iso; }
}
export function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
export function fmtRelDue(iso) {
  const diff = new Date(iso) - Date.now();
  const mins = Math.round(diff / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
export function fmtInterval(days) {
  if (days < 1) {
    const mins = Math.round(days * 1440);
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  }
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- text normalisation & matching ---------------- */

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(s) {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Standard Levenshtein distance between two strings or arrays */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Damerau-Levenshtein (optimal string alignment) — counts transpositions as 1 */
export function damerau(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = [];
  for (let i = 0; i <= m; i++) { d[i] = [i]; }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * Fuzzy check of a typed answer against accepted answers.
 * Returns { status: 'exact'|'close'|'wrong', best }.
 */
export function fuzzyMatch(typed, accepted) {
  const t = normalize(typed);
  const list = (Array.isArray(accepted) ? accepted : [accepted]).map(normalize).filter(Boolean);
  if (!t) return { status: 'wrong', best: list[0] || '' };
  let best = list[0] || '', bestD = Infinity;
  for (const a of list) {
    if (a === t) return { status: 'exact', best: a };
    const d = damerau(t, a);
    if (d < bestD) { bestD = d; best = a; }
  }
  const tol = best.length <= 5 ? 1 : 2;
  return { status: bestD <= tol ? 'close' : 'wrong', best, distance: bestD };
}

/** Loose sentence comparison: ignores punctuation/case, allows small edit distance per length */
export function sentenceMatch(typed, accepted) {
  const t = normalize(typed);
  const list = (Array.isArray(accepted) ? accepted : [accepted]).map(normalize);
  let bestD = Infinity, best = list[0] || '';
  for (const a of list) {
    if (a === t) return { status: 'exact', best: a, distance: 0 };
    const d = levenshtein(t, a);
    if (d < bestD) { bestD = d; best = a; }
  }
  const tol = Math.max(1, Math.floor(best.length * 0.08));
  return { status: bestD <= tol ? 'close' : 'wrong', best, distance: bestD };
}

/* ---------------- alignment / diffs ---------------- */

/**
 * Word-level alignment via Levenshtein DP with backtrace.
 * Returns ops: [{type:'eq'|'sub'|'del'|'ins', a, b}] where a is target word, b is hypothesis word.
 */
export function alignWords(target, hyp) {
  const m = target.length, n = hyp.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = target[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (target[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push({ type: target[i - 1] === hyp[j - 1] ? 'eq' : 'sub', a: target[i - 1], b: hyp[j - 1] });
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ type: 'del', a: target[i - 1], b: null }); i--;
    } else {
      ops.push({ type: 'ins', a: null, b: hyp[j - 1] }); j--;
    }
  }
  return ops.reverse();
}

/** Generic LCS diff over arrays of tokens → [{type:'eq'|'ins'|'del', value}] */
export function lcsDiff(a, b) {
  const m = a.length, n = b.length;
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: 'eq', value: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ type: 'del', value: a[i] }); i++; }
    else { out.push({ type: 'ins', value: b[j] }); j++; }
  }
  while (i < m) out.push({ type: 'del', value: a[i++] });
  while (j < n) out.push({ type: 'ins', value: b[j++] });
  return out;
}

/** Character diff (expected vs typed) → HTML string with <ins>/<del> */
export function charDiffHtml(expected, typed) {
  const ops = lcsDiff(Array.from(expected), Array.from(typed));
  let html = '';
  for (const op of ops) {
    const v = escapeHtml(op.value);
    if (op.type === 'eq') html += v;
    else if (op.type === 'del') html += `<del>${v}</del>`;
    else html += `<ins>${v}</ins>`;
  }
  return html;
}

/** Word diff (original vs corrected) → HTML with <del>/<ins> */
export function wordDiffHtml(original, corrected) {
  const a = original.split(/(\s+)/).filter((x) => x.length);
  const b = corrected.split(/(\s+)/).filter((x) => x.length);
  const ops = lcsDiff(a, b);
  let html = '';
  for (const op of ops) {
    const v = escapeHtml(op.value);
    if (op.type === 'eq') html += v;
    else if (op.type === 'del') html += `<del>${v}</del>`;
    else html += `<ins>${v}</ins>`;
  }
  return html;
}

/** Simple metaphone-ish key for "sounds similar" checks (rough, English-only). */
export function soundKey(w) {
  return normalize(w)
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/wh/g, 'w').replace(/gh/g, '')
    .replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

export function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
export function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
export function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) { const k = fn(x); (out[k] ||= []).push(x); }
  return out;
}
export function countWords(s) { return tokenize(s).length; }

export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1'];
export const cefrIndex = (l) => Math.max(0, CEFR.indexOf(l));

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

/** Markdown-lite → safe HTML (bold, italic, code, headings, lists, blockquote, paragraphs, links) */
export function mdLite(src) {
  const lines = String(src ?? '').split(/\r?\n/);
  const out = [];
  let list = null; let para = [];
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flushPara(); flushList(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); }
    else if ((m = line.match(/^>\s?(.*)/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join('');
}

/** Estimate tokens for cost display (~4 chars per token for English, ~2 for Devanagari) */
export function estimateTokens(text) {
  const s = String(text ?? '');
  const dev = (s.match(/[ऀ-ॿ]/g) || []).length;
  return Math.ceil((s.length - dev) / 4 + dev / 1.5);
}
