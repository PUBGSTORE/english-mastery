// know.js — 🧠 Knowledge home: the non-English-learning half of the app (Daily Discovery, Get Fast Knowledge, Book explainer) in one place.
import { html, mount, icon } from '../ui.js';
import * as dc from '../discover.js';
import * as kn from '../knowledge.js';
import * as bk from '../books.js';
import { setContext } from '../router.js';
import { fmtDate, todayKey } from '../utils.js';

export async function render(container) {
  const [picks, topics, videos, books] = await Promise.all([dc.picksFor(), dc.list(), kn.list(), bk.list()]);
  const streak = dc.streakOf(topics);
  const recent = [
    ...topics.map((r) => ({ ts: r.ts, emoji: r.data.emoji, title: r.title, sub: r.data.field, href: `#/discover/${encodeURIComponent(r.id)}` })),
    ...videos.map((r) => ({ ts: r.ts, emoji: '🦉', title: r.title, sub: r.data.channel, href: `#/knowledge/${r.refId}` })),
    ...books.map((r) => ({ ts: r.ts, emoji: '📚', title: r.title, sub: r.data.author, href: `#/books/${encodeURIComponent(r.id)}` })),
  ].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8);
  const doneToday = topics.filter((r) => r.day === todayKey()).length;
  mount(container, html`
    <div class="know-hero"><div class="know-emoji">🧠</div><div class="grow"><h1>Knowledge</h1><p>Learn about the world, not just the language. Topics from every field, whole videos and whole books, explained simply, with हिन्दी and ગુજરાતી.</p></div>
      <div class="dc-stats"><div><strong>${streak}</strong><span>day streak</span></div><div><strong>${topics.length}</strong><span>topics</span></div><div><strong>${videos.length}</strong><span>videos</span></div><div><strong>${books.length}</strong><span>books</span></div></div></div>
    <div class="dc-grid">
      <a class="card know-tile dc" href="#/discover" style="margin:0"><div class="know-tile-emoji">🧠</div><h3>Daily Discovery</h3><p class="small">Three new topics a day, or your own genre. Simple explanation, examples, real-life use, quiz.</p>${doneToday ? html`<span class="chip green">${doneToday} done today</span>` : html`<span class="chip">Today's three waiting</span>`}</a>
      <a class="card know-tile owl" href="#/knowledge" style="margin:0"><div class="know-tile-emoji">🦉</div><h3>Get Fast Knowledge</h3><p class="small">Paste any long video. Every learning explained, chapter by chapter.</p><span class="chip">${videos.length} analysed</span></a>
      <a class="card know-tile book" href="#/books" style="margin:0"><div class="know-tile-emoji">📚</div><h3>Book explainer</h3><p class="small">Type a book. Every chapter explained, study notes at the end.</p><span class="chip">${books.length} on the shelf</span></a>
    </div>
    <h3 class="mt-lg">Today's three</h3>
    <div class="dc-grid">${picks.map((p, i) => { const r = topics.find((x) => x.id === dc.topicId(p.t)); return html`<a class="card dc-pick" href="${r ? `#/discover/${encodeURIComponent(r.id)}` : '#/discover'}" style="--dc-hue:${[262, 190, 330][i]};margin:0"><div class="dc-field">${p.field.emoji} ${p.field.name}</div><h3>${p.t}</h3><p class="small mb-0">${p.h}</p>${r ? html`<span class="chip green mt">${icon('check')} Read</span>` : ''}</a>`; })}</div>
    ${recent.length ? html`<h3 class="mt-lg">Recent</h3><div class="list">${recent.map((r) => html`<a class="list-item" href="${r.href}"><span style="font-size:22px">${r.emoji}</span><div class="grow"><div class="title">${r.title}</div><div class="sub">${r.sub} · ${fmtDate(r.ts)}</div></div>${icon('next', 'arrow')}</a>`)}</div>` : html`<div class="empty mt">${icon('sparkle')}<p>Nothing yet. Start with one of today's three topics.</p></div>`}`);
  setContext({ title: 'Knowledge', text: 'Daily Discovery, video analysis and book explanations.' });
}
