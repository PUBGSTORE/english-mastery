// progress.js — dashboard: words learned/mastered, retention, heatmap, pronunciation trend, time, streak, radar, CEFR bar.
import { html, mount, icon, progressBar } from '../ui.js';
import * as store from '../store.js';
import * as charts from '../charts.js';
import { isMastered, isLearned } from '../srs.js';
import { setContext } from '../router.js';
import { fmtDuration, dayKey, addDays, CEFR, cefrIndex, avg, groupBy } from '../utils.js';

export async function render(container) {
  const [cards, reviews, attempts, days, streak, s, skills, mistakes] = await Promise.all([
    store.allCards(), store.allReviews(), store.allAttempts(), store.allDays(), store.streak(), store.settings(), store.skillScores(), store.allMistakes(),
  ]);
  const vocab = cards.filter((c) => c.kind === 'vocab');
  const learned = vocab.filter(isLearned).length;
  const mastered = vocab.filter(isMastered).length;
  const cutoff30 = dayKey(addDays(new Date(), -30));
  const recentRv = reviews.filter((r) => r.day >= cutoff30);
  const retention = recentRv.length ? Math.round((recentRv.filter((r) => r.grade > 0).length / recentRv.length) * 100) : null;
  const totalMs = days.reduce((a, d) => a + (d.studyMs || 0), 0);
  const heat = {}; for (const d of days) heat[d.day] = (d.reviews || 0) + (d.attempts || 0);
  const pron = attempts.filter((a) => ['pair', 'sentence', 'shadow', 'twister', 'phoneme'].includes(a.kind) && typeof a.accuracy === 'number');
  const byDay = groupBy(pron, (a) => a.day);
  const pronPoints = Object.entries(byDay).map(([d, list]) => ({ x: d, y: Math.round(avg(list.map((a) => a.accuracy))) })).sort((a, b) => a.x.localeCompare(b.x)).slice(-60);
  const listen = attempts.filter((a) => ['dictation', 'numbers', 'dates', 'spelling'].includes(a.kind));
  const listenPoints = Object.entries(groupBy(listen, (a) => a.day)).map(([d, list]) => ({ x: d, y: Math.round(avg(list.map((a) => a.accuracy || 0))) })).sort((a, b) => a.x.localeCompare(b.x)).slice(-60);
  const lvlIdx = cefrIndex(s.level);
  const grammarDone = Object.keys((await store.getSetting('grammarDone')) || {}).length;
  // CEFR progress: within level, blend of mastered words, grammar lessons done, skill average
  const skillAvg = avg(Object.values(skills));
  const cefrPct = Math.min(100, Math.round((Math.min(1, mastered / 250) * 40 + Math.min(1, grammarDone / 12) * 30 + (skillAvg / 100) * 30)));
  const week = charts.weekDays().map((k) => days.find((d) => d.day === k) || { day: k, studyMs: 0, reviews: 0 });
  mount(container, html`
    <div class="page-head"><div><h1>Progress</h1><p class="sub">${cards.length} cards · ${reviews.length} reviews · ${fmtDuration(totalMs)} studied</p></div><a class="btn btn-sm btn-ghost" href="#/settings">${icon('settings')} Settings</a></div>
    <div class="card accent"><div class="row between"><div><div class="label xs muted" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">CEFR level</div><div style="font-size:var(--fs-3xl);font-weight:800;line-height:1">${s.level}</div></div><div class="grow" style="min-width:160px"><div class="row between xs muted"><span>${s.level}</span><span>${CEFR[lvlIdx + 1] || 'C2'}</span></div>${progressBar(cefrPct)}<div class="xs muted mt">${cefrPct}% towards ${CEFR[lvlIdx + 1] || 'C2'} · ${mastered}/250 words mastered · ${grammarDone}/12 lessons at this level</div></div></div>
      <div class="chips mt">${CEFR.map((l, i) => html`<span class="chip ${i < lvlIdx ? 'green' : i === lvlIdx ? 'active' : ''}">${l}</span>`)}</div></div>
    <div class="grid-3">
      <div class="stat"><div class="label">Words learned</div><div class="value">${learned}<small> / ${vocab.length}</small></div></div>
      <div class="stat"><div class="label">Mastered</div><div class="value">${mastered}</div></div>
      <div class="stat"><div class="label">Retention (30d)</div><div class="value">${retention === null ? '–' : retention + '%'}</div></div>
      <div class="stat"><div class="label">Streak</div><div class="value">${streak.current}<small> best ${streak.best}</small></div></div>
      <div class="stat"><div class="label">Time studied</div><div class="value" style="font-size:var(--fs-lg)">${fmtDuration(totalMs)}</div></div>
      <div class="stat"><div class="label">Mistakes fixed</div><div class="value">${mistakes.filter((m) => m.resolved).length}<small> / ${mistakes.length}</small></div></div>
    </div>
    <div class="card mt"><div class="card-title"><h3>Activity</h3><span class="xs muted">last 20 weeks</span></div>${{ toString: () => charts.heatmap(heat) }}
      <div class="legend mt"><span>Less</span><i class="l0" style="background:var(--bg-4)"></i><i style="background:color-mix(in srgb,var(--accent) 30%,var(--bg-4))"></i><i style="background:color-mix(in srgb,var(--accent) 55%,var(--bg-4))"></i><i style="background:var(--accent)"></i><span>More</span></div></div>
    <div class="grid-2">
      <div class="card"><h3>Skills</h3>${{ toString: () => charts.radar(Object.keys(skills), Object.values(skills)) }}<p class="xs muted center mb-0">Based on the last 30 days. Empty axes mean you have not practised that skill yet.</p></div>
      <div class="card"><h3>This week</h3>${{ toString: () => charts.bars(week.map((d) => ({ label: new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' }), value: (d.studyMs || 0) / 60000, max: Math.max(30, s.dailyGoalMin), display: `${Math.round((d.studyMs || 0) / 60000)} min · ${d.reviews || 0} rev` }))) }}</div>
    </div>
    <div class="card"><div class="card-title"><h3>Pronunciation accuracy</h3><span class="xs muted">${pron.length} attempts</span></div>${pronPoints.length >= 2 ? html`${{ toString: () => charts.line([{ label: 'Accuracy', points: pronPoints }]) }}` : html`<p class="muted small mb-0">Do a few minimal-pair or shadowing sessions on different days and the trend appears here.</p>`}</div>
    <div class="card"><div class="card-title"><h3>Listening accuracy</h3><span class="xs muted">${listen.length} attempts</span></div>${listenPoints.length >= 2 ? html`${{ toString: () => charts.line([{ label: 'Accuracy', points: listenPoints, color: 'var(--green)' }]) }}` : html`<p class="muted small mb-0">Dictation results will chart here.</p>`}</div>
    <div class="card"><h3>Review grades (30 days)</h3>${{ toString: () => charts.bars([0, 1, 2, 3].map((g) => ({ label: ['Again', 'Hard', 'Good', 'Easy'][g], value: recentRv.filter((r) => r.grade === g).length, max: Math.max(1, recentRv.length), color: ['var(--red)', 'var(--amber)', 'var(--green)', 'var(--accent)'][g] }))) }}</div>
  `);
  const hm = container.querySelector('.heatmap'); if (hm) hm.scrollLeft = hm.scrollWidth;
  setContext({ title: 'Progress', text: `Level ${s.level}, ${learned} words learned, ${mastered} mastered, retention ${retention ?? 'n/a'}%, streak ${streak.current}.` });
}
