// charts.js — hand-rolled SVG charts. All return HTML strings.
import { escapeHtml, dayKey, addDays, parseDayKey } from './utils.js';

/** GitHub-style heatmap. data: { 'YYYY-MM-DD': number }. weeks: how many weeks back. */
export function heatmap(data, { weeks = 20 } = {}) {
  const today = new Date();
  const end = new Date(today); // include today
  const start = addDays(end, -(weeks * 7 - 1));
  // align start to Sunday
  start.setDate(start.getDate() - start.getDay());
  const max = Math.max(1, ...Object.values(data));
  let cells = '';
  const d = new Date(start);
  while (d <= end) {
    const k = dayKey(d);
    const v = data[k] || 0;
    const lvl = v === 0 ? 0 : v < max * 0.25 ? 1 : v < max * 0.5 ? 2 : v < max * 0.75 ? 3 : 4;
    cells += `<i class="l${lvl}" title="${k}: ${v}" aria-label="${k}: ${v} reviews"></i>`;
    d.setDate(d.getDate() + 1);
  }
  return `<div class="heatmap" role="img" aria-label="Review activity heatmap">${cells}</div>`;
}

/** Line chart. series: [{ label, points: [{x: Date|string, y}] , color }] */
export function line(series, { width = 600, height = 200, yMax = 100, yMin = 0, yLabel = '%', showDots = true } = {}) {
  const padL = 34, padR = 10, padT = 12, padB = 26;
  const all = series.flatMap((s) => s.points);
  if (!all.length) return `<div class="empty small">No data yet</div>`;
  const xs = all.map((p) => +new Date(p.x));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const span = Math.max(1, x1 - x0);
  const X = (x) => padL + ((+new Date(x) - x0) / span) * (width - padL - padR);
  const Y = (y) => padT + (1 - (y - yMin) / (yMax - yMin)) * (height - padT - padB);
  let g = '';
  // grid
  for (let i = 0; i <= 4; i++) {
    const y = yMin + ((yMax - yMin) * i) / 4;
    g += `<line x1="${padL}" x2="${width - padR}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--border)" stroke-width="1"/>`;
    g += `<text x="${padL - 6}" y="${Y(y) + 4}" text-anchor="end" font-size="10" fill="var(--text-3)">${Math.round(y)}${yLabel}</text>`;
  }
  // x labels (first, middle, last)
  const fmt = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  [x0, (x0 + x1) / 2, x1].forEach((t, i) => {
    g += `<text x="${X(t)}" y="${height - 8}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}" font-size="10" fill="var(--text-3)">${fmt(t)}</text>`;
  });
  for (const s of series) {
    const pts = s.points.slice().sort((a, b) => +new Date(a.x) - +new Date(b.x));
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
    g += `<path d="${path}" fill="none" stroke="${s.color || 'var(--accent)'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (showDots) for (const p of pts) g += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="${s.color || 'var(--accent)'}"><title>${fmt(p.x)}: ${Math.round(p.y)}${yLabel}</title></circle>`;
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series.map((s) => s.label).join(', '))}">${g}</svg>`;
}

/** Radar chart. labels[], values[] (0-100) */
export function radar(labels, values, { size = 260 } = {}) {
  const n = labels.length; const c = size / 2; const r = size / 2 - 34;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, v) => [c + Math.cos(ang(i)) * r * v, c + Math.sin(ang(i)) * r * v];
  let g = '';
  for (const lvl of [0.25, 0.5, 0.75, 1]) {
    g += `<polygon points="${labels.map((_, i) => pt(i, lvl).map((x) => x.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--border)" stroke-width="1"/>`;
  }
  labels.forEach((_, i) => { const [x, y] = pt(i, 1); g += `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)"/>`; });
  g += `<polygon points="${values.map((v, i) => pt(i, Math.max(0.02, v / 100)).map((x) => x.toFixed(1)).join(',')).join(' ')}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>`;
  labels.forEach((l, i) => {
    const [x, y] = pt(i, 1.18);
    g += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--text-2)" font-weight="600">${escapeHtml(l)}</text>`;
    const [vx, vy] = pt(i, Math.max(0.02, values[i] / 100));
    g += `<circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="3" fill="var(--accent)"><title>${escapeHtml(l)}: ${Math.round(values[i])}</title></circle>`;
  });
  return `<svg class="chart" viewBox="0 0 ${size} ${size}" style="max-width:${size}px;margin:0 auto" role="img" aria-label="Skill radar">${g}</svg>`;
}

/** Horizontal bars. items: [{label, value, max, color}] */
export function bars(items, { width = 600, rowH = 26 } = {}) {
  const labelW = 130;
  const height = items.length * rowH + 4;
  let g = '';
  items.forEach((it, i) => {
    const y = i * rowH + 2;
    const w = Math.max(0, Math.min(1, it.value / (it.max || 100))) * (width - labelW - 60);
    g += `<text x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="12" fill="var(--text-2)">${escapeHtml(it.label)}</text>`;
    g += `<rect x="${labelW}" y="${y + 5}" width="${width - labelW - 60}" height="${rowH - 10}" rx="5" fill="var(--bg-4)"/>`;
    g += `<rect x="${labelW}" y="${y + 5}" width="${w.toFixed(1)}" height="${rowH - 10}" rx="5" fill="${it.color || 'var(--accent)'}"/>`;
    g += `<text x="${labelW + (width - labelW - 60) + 8}" y="${y + rowH / 2 + 4}" font-size="12" fill="var(--text)" font-weight="600">${escapeHtml(it.display ?? Math.round(it.value))}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${g}</svg>`;
}

/** Progress ring */
export function ring(pctVal, { size = 84, label = '', stroke = 8 } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pctVal / 100)));
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeHtml(label)} ${Math.round(pctVal)}%">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--bg-4)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dy="5" text-anchor="middle" font-size="${size / 5}" font-weight="700" fill="var(--text)">${Math.round(pctVal)}%</text></svg>`;
}

/** Intonation contour over words. contour: 0-3 per word */
export function intonation(words, contour, { width = null } = {}) {
  const n = words.length; const height = 130; const padX = 56;
  width = width || Math.max(380, n * 90);
  const step = (width - padX * 2) / Math.max(1, n - 1);
  const X = (i) => padX + i * step;
  const Y = (v) => 78 - v * 18;
  const pts = contour.map((v, i) => [X(i), Y(v)]);
  let d = '';
  pts.forEach(([x, y], i) => {
    if (i === 0) d += `M${x},${y}`;
    else { const [px, py] = pts[i - 1]; const cx = (px + x) / 2; d += ` C${cx},${py} ${cx},${y} ${x},${y}`; }
  });
  let g = `<path d="${d}"/>`;
  pts.forEach(([x, y]) => { g += `<circle cx="${x}" cy="${y}" r="4"/>`; });
  words.forEach((w, i) => { g += `<text x="${X(i)}" y="116" text-anchor="middle" font-size="${n > 7 ? 15 : 17}">${escapeHtml(w)}</text>`; });
  return `<svg class="intonation" viewBox="0 0 ${width} ${height}" role="img" aria-label="Intonation contour">${g}</svg>`;
}

export function weekDays() { const out = []; for (let i = 6; i >= 0; i--) out.push(dayKey(addDays(new Date(), -i))); return out; }
export { parseDayKey };

/** §9: my pitch contour (0–3 per word, may contain null) drawn over the model contour. */
export function pitchOverlay(words, model, mine, { width = null } = {}) {
  const n = words.length; const height = 150; const padX = 56;
  width = width || Math.max(380, n * 90);
  const step = (width - padX * 2) / Math.max(1, n - 1);
  const X = (i) => padX + i * step; const Y = (v) => 96 - v * 22;
  const path = (arr, cls) => { const pts = arr.map((v, i) => (v == null ? null : [X(i), Y(v)])); let d = ''; let started = false; pts.forEach((p, i) => { if (!p) { started = false; return; } if (!started) { d += `M${p[0]},${p[1]}`; started = true; } else { const q = pts[i - 1]; const cx = (q[0] + p[0]) / 2; d += ` C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`; } }); return `<path d="${d}" class="${cls}"/>`; };
  let g = path(model, 'model') + (mine ? path(mine, 'mine') : '');
  words.forEach((w, i) => { g += `<text x="${X(i)}" y="136" text-anchor="middle" font-size="${n > 7 ? 15 : 17}">${escapeHtml(w)}</text>`; });
  g += `<text x="${padX}" y="14" font-size="12" class="legend-model">— model</text><text x="${padX + 90}" y="14" font-size="12" class="legend-mine">— you</text>`;
  return `<svg class="intonation pitch" viewBox="0 0 ${width} ${height}" role="img" aria-label="Your pitch over the model">${g}</svg>`;
}
