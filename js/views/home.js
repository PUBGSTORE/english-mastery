// home.js — "what do I do next?" in one glance.
import { html, mount, icon, progressBar } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import { todayKey, fmtDuration } from '../utils.js';
import { setContext } from '../router.js';

export async function render(container) {
  const [summary, streak, s] = await Promise.all([store.dueSummary(), store.streak(), store.settings()]);
  const today = await store.getDay(todayKey());
  mount(container, html`
    ${hero(summary, s)}
    <div class="grid-2">
      <div id="daily-card" class="card"><div class="row"><span class="spinner"></span></div></div>
      <div class="card">
        <div class="card-title"><h3>Streak</h3><a class="btn btn-sm btn-ghost" href="#/progress">Progress ${icon('next')}</a></div>
        <div class="streak"><span class="flame">${icon('flame')}</span><span class="bold" style="font-size:var(--fs-2xl)">${streak.current}</span><span class="muted">day${streak.current === 1 ? '' : 's'}</span>
          ${streak.freezesLeft ? html`<span class="chip" title="Streak freezes: one missed day will not break your streak">${icon('snow')} ${streak.freezesLeft} freeze${streak.freezesLeft > 1 ? 's' : ''}</span>` : ''}</div>
        <p class="muted small mb-0">${streak.activeToday ? 'You have studied today. ' : 'Not yet active today. '}Best: ${streak.best} days · Today: ${fmtDuration(today.studyMs || 0)} of ${s.dailyGoalMin} min</p>
        <div class="mt">${progressBar(Math.min(100, ((today.studyMs || 0) / 60000 / s.dailyGoalMin) * 100), 'green')}</div>
      </div>
    </div>
    <div id="mistakes-card"></div>
    <h3 class="mt-lg">Continue</h3>
    <div id="continue" class="grid"></div>
  `);
  renderDaily(container.querySelector('#daily-card'));
  renderMistakes(container.querySelector('#mistakes-card'));
  renderContinue(container.querySelector('#continue'), s);
  setContext({ title: 'Home', text: `Level ${s.level}. ${summary.total} cards due.` });
}

function hero(sum, s) {
  if (!sum.totalCards) {
    return html`<div class="hero"><h1>Welcome, let's begin</h1><p>Nothing to review yet. Start with today's five words, or add a whole deck.</p>
      <div class="btn-row"><a class="btn btn-primary btn-lg" href="#/daily">${icon('calendar')} Today's 5 words</a><a class="btn btn-lg" href="#/vocab">Browse decks</a>${!s.placementDone ? html`<a class="btn btn-lg" href="#/placement">Placement test</a>` : ''}</div></div>`;
  }
  if (!sum.total) {
    return html`<div class="hero"><h1>All caught up</h1><p>No cards due right now. ${sum.newAvailable ? `${sum.newAvailable} new cards are waiting for tomorrow's limit.` : 'Learn something new below.'}</p>
      <div class="btn-row"><a class="btn btn-lg" href="#/shadow">${icon('ear')} Shadow a sentence</a><a class="btn btn-lg" href="#/pron">${icon('wave')} Pronunciation drill</a></div></div>`;
  }
  return html`<div class="hero"><div class="big">${sum.total}</div><h1>Review ${sum.total} due item${sum.total === 1 ? '' : 's'}</h1>
    <p>${sum.due} review${sum.due === 1 ? '' : 's'} · ${sum.learning} learning · ${sum.newAllowed} new · ~${Math.max(1, Math.round(sum.total * 0.3))} min</p>
    <a class="btn btn-primary btn-lg" href="#/review">${icon('zap')} Start review</a></div>`;
}

async function renderDaily(el) {
  try {
    const d = await store.daily5();
    const words = await Promise.all(d.wordIds.map((id) => content.wordById(id)));
    mount(el, html`<div class="card-title"><h3>Daily 5</h3><a class="btn btn-sm btn-ghost" href="#/daily/history">History</a></div>
      <div class="chips">${words.filter(Boolean).map((w) => html`<a class="chip ${d.completed ? 'green' : ''}" href="#/word/${w.id}">${w.word}</a>`)}</div>
      <div class="mt"><a class="btn ${d.completed ? '' : 'btn-primary'} btn-block" href="#/daily">${d.completed ? `${icon('check')} Done today — revisit` : 'Learn today\'s words'}</a></div>`);
  } catch (e) { mount(el, html`<p class="muted">Daily words unavailable: ${e.message}</p>`); }
}

async function renderMistakes(el) {
  const top = await store.topMistakes(5);
  if (!top.length) return;
  mount(el, html`<div class="card amber"><div class="card-title"><h3>Your top recurring mistakes</h3><a class="btn btn-sm btn-ghost" href="#/mistakes">All ${icon('next')}</a></div>
    <div class="contrast">${top.map((m) => html`<div><span class="wrong">${m.original}</span> → <span class="right">${m.fix}</span> <span class="faint xs">×${m.count} · ${m.rule}</span></div>`)}</div></div>`);
}

async function renderContinue(el, s) {
  const items = [];
  try {
    const done = (await store.getSetting('grammarDone')) || {};
    const lessons = await content.grammarSorted();
    const next = lessons.find((l) => !done[l.id] && store.isUnlocked(l.cefr, s.level)) || lessons.find((l) => !done[l.id]);
    if (next) items.push({ href: `#/grammar/${next.id}`, icon: 'book', title: next.title, sub: `Grammar · ${next.cefr} · lesson ${next.order}` });
  } catch { /* ignore */ }
  try {
    const shadows = await content.shadowing();
    const attempts = await store.attemptsByKind('shadow');
    const doneIds = new Set(attempts.map((a) => a.refId));
    const lvlIdx = ['A1', 'A2', 'B1', 'B2', 'C1'].indexOf(s.level);
    const nextS = shadows.filter((x) => Math.abs(['A1', 'A2', 'B1', 'B2', 'C1'].indexOf(x.cefr) - lvlIdx) <= 1).find((x) => !doneIds.has(x.id)) || shadows[0];
    if (nextS) items.push({ href: `#/shadow/${nextS.id}`, icon: 'ear', title: nextS.title || nextS.text.slice(0, 40) + '…', sub: `Shadowing · ${nextS.cefr}` });
  } catch { /* ignore */ }
  items.push({ href: '#/speak', icon: 'mic', title: "Today's speaking prompt", sub: '45 seconds, AI feedback' });
  items.push({ href: '#/pron/pairs/v-w', icon: 'wave', title: 'v / w minimal pairs', sub: 'Ear training + production' });
  if (!s.placementDone) items.push({ href: '#/placement', icon: 'award', title: 'Placement test', sub: '30 questions · sets your level' });
  mount(el, html`${items.map((i) => html`<a class="card compact" href="${i.href}"><div class="row">${icon(i.icon)}<div class="grow"><div class="bold">${i.title}</div><div class="muted small">${i.sub}</div></div></div></a>`)}`);
}
