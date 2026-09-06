// today.js — §7 one button, no decisions: composes a session and runs it module to module via the session bar in app.js.
import { html, mount, icon, toast, $ } from '../ui.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as content from '../content.js';
import { setContext, navigate } from '../router.js';
import { todayKey, nowISO, uid, cefrIndex, fmtDuration } from '../utils.js';
import { getSession, startSession, endSession } from '../session.js';

export async function render(container) {
  const active = await getSession();
  const [summary, streak, s, skills] = await Promise.all([store.dueSummary(), store.streak(), store.settings(), store.skillScores()]);
  const past = (await db.getAll('sessions', { index: 'day' })).filter((x) => x.completedAt).slice(-7).reverse();
  const weakest = Object.entries(skills).filter(([k]) => k !== 'Vocab').sort((a, b) => a[1] - b[1])[0]?.[0] || 'Pronunciation';
  mount(container, html`
    <div class="hero"><h1>Today</h1><p>${active ? `A ${active.preset}-minute session is in progress (${active.done.length}/${active.plan.length} steps).` : `${summary.total} due · streak ${streak.current} · weakest skill: ${weakest}. Pick a length and go.`}</p>
      ${active ? html`<div class="btn-row"><button class="btn btn-primary btn-lg" id="resume">${icon('play')} Continue session</button><button class="btn btn-ghost" id="abandon">Abandon</button></div>`
      : html`<div class="btn-row">${[10, 20, 40].map((m) => html`<button class="btn btn-lg ${m === 20 ? 'btn-primary' : ''}" data-m="${m}">${m} min</button>`)}</div>`}</div>
    <div class="card compact"><p class="small muted mb-0">Every session runs: due reviews (interleaved) → Daily 5 → your weakest skill → one lesson → shadowing or reading → and ends with you <em>producing</em> English. Skip any step; the bar at the top tracks you.</p></div>
    ${past.length ? html`<h3 class="mt-lg">Recent sessions</h3><div class="list">${past.map((p) => html`<div class="list-item"><div class="grow"><div class="title">${p.day} · ${p.preset} min</div><div class="sub">${p.done.length}/${p.plan.length} steps · ${fmtDuration((new Date(p.completedAt) - new Date(p.startedAt)) || 0)}</div></div>${p.done.length === p.plan.length ? icon('check') : ''}</div>`)}</div>` : ''}
    <p class="xs faint mt">Prefer choosing yourself? The classic <a href="#/">Home</a> and the Learn/Practice tabs are still there.</p>`);
  container.querySelectorAll('[data-m]').forEach((b) => b.onclick = async () => { const plan = await compose(+b.dataset.m, { summary, s, skills, weakest }); await startSession(+b.dataset.m, plan); navigate(plan[0].route); });
  const r = $('#resume', container); if (r) r.onclick = () => navigate(active.plan[active.done.length]?.route || '/today');
  const a = $('#abandon', container); if (a) a.onclick = async () => { await endSession(false); render(container); };
  setContext({ title: 'Today', text: `Composed study session. Weakest skill ${weakest}.` });
}

/** Rule-based composer. Each step: { route, label, minutes }. */
export async function compose(minutes, { summary, s, skills, weakest }) {
  const plan = [];
  const reviewMin = Math.min(Math.round(minutes * 0.4), Math.max(3, Math.ceil(summary.total * 0.3)));
  if (summary.total) plan.push({ route: '/review?interleave=1', label: `Review ${summary.total} due`, minutes: reviewMin });
  const daily = await store.daily5();
  if (!daily.completed) plan.push({ route: '/daily', label: 'Daily 5', minutes: 3 });
  const skillRoute = { Pronunciation: '/pron/pairs/v-w', Listening: '/listen/dictation', Speaking: '/speak', Writing: '/translate', Grammar: '/confusables/quiz', Vocab: '/coverage' }[weakest] || '/pron';
  plan.push({ route: skillRoute, label: `Weakest skill: ${weakest}`, minutes: minutes >= 20 ? 5 : 3 });
  if (minutes >= 20) {
    const done = (await store.getSetting('grammarDone')) || {};
    const lessons = await content.grammarSorted();
    const next = lessons.find((l) => !done[l.id] && store.isUnlocked(l.cefr, s.level));
    const roots = await content.load('morphology');
    const rootCards = new Set((await store.allCards()).filter((c) => c.kind === 'root').map((c) => c.refId));
    const nextRoot = roots.find((r) => !rootCards.has(r.id));
    if (next && (!nextRoot || Math.random() < 0.7)) plan.push({ route: `/grammar/${next.id}`, label: `Lesson: ${next.title}`, minutes: 7 });
    else if (nextRoot) plan.push({ route: `/roots/${encodeURIComponent(nextRoot.id)}`, label: `Root: ${nextRoot.part}`, minutes: 4 });
    const videos = await db.getAll('videos');
    const unread = videos.find((v) => v.protocol && v.protocol.watched && !v.protocol.reviewed3);
    if (unread) plan.push({ route: `/mine/${encodeURIComponent(unread.id)}?tab=protocol`, label: `Re-watch: ${unread.title.slice(0, 30)}`, minutes: 5 });
    else plan.push({ route: '/shadow', label: 'Shadowing', minutes: 5 });
  }
  if (minutes >= 40) { plan.push({ route: '/chunks', label: 'Chunks: add 5 frames', minutes: 4 }); plan.push({ route: '/read', label: 'Read something', minutes: 6 }); }
  // Always end with production
  plan.push(Math.random() < 0.5 ? { route: '/speak', label: 'Speak: 45 seconds', minutes: 3 } : { route: '/translate', label: 'Produce: translate 3 sentences', minutes: 3 });
  return plan;
}
