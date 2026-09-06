// mistakes.js — the error notebook: grouped by rule, re-test, resolve.
import { html, mount, icon, toast, confirmDialog, openSheet, $ } from '../ui.js';
import * as ai from '../ai.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import { setContext } from '../router.js';
import { fmtDate, groupBy } from '../utils.js';

export async function render(container) {
  const all = await store.allMistakes();
  const open = all.filter((m) => !m.resolved).sort((a, b) => (b.count - a.count) || (b.lastAt || '').localeCompare(a.lastAt || ''));
  const resolved = all.filter((m) => m.resolved);
  const bySource = groupBy(open, (m) => m.source || 'other');
  const byRule = groupBy(open, (m) => m.rule || 'general');
  const topRules = Object.entries(byRule).map(([r, list]) => ({ rule: r, n: list.reduce((a, m) => a + m.count, 0), items: list })).sort((a, b) => b.n - a.n);
  let view = 'rule';
  const draw = () => {
    const groups = view === 'rule' ? topRules.map((g) => ({ title: g.rule, items: g.items, n: g.n })) : Object.entries(bySource).map(([k, v]) => ({ title: k, items: v, n: v.length }));
    mount($('#list', container), html`${groups.length ? groups.map((g) => html`<h3 class="mt-lg">${g.title} <span class="badge muted">${g.n}</span></h3><div class="list">${g.items.map(row)}</div>`) : html`<div class="empty">${icon('award')}<p>No mistakes logged yet. Wrong answers in reviews, grammar practice, dictation and AI corrections land here automatically.</p></div>`}`);
    container.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = async () => { await store.resolveMistake(b.dataset.resolve, true); toast('Marked as fixed', 'ok'); render(container); });
    container.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirmDialog('Delete this mistake and its card?', { okLabel: 'Delete', danger: true })) { await store.deleteMistake(b.dataset.del); render(container); } });
    container.querySelectorAll('[data-explain]').forEach((b) => b.onclick = async () => {
      const m = open.find((x) => x.id === b.dataset.explain); if (!m) return;
      if (!(await ai.hasKey())) { toast('Add your DeepSeek key in Settings to get explanations.', 'warn'); return; }
      const mod = await import('./chat.js');
      const body = openSheet('<div class="chat-sheet"></div>', { wide: true });
      await mod.mountChat(body.querySelector('.chat-sheet'), { embedded: true, context: { title: 'My mistake', text: `I wrote "${m.original}"; the correct version is "${m.fix}" (rule: ${m.rule}).` },
        initialMessage: `Why is "${m.original}" wrong and "${m.fix}" right? Explain the rule simply, give 3 more examples, and tell me the Hindi-transfer reason behind this mistake.` });
    });
  };
  const row = (m) => html`<div class="list-item"><div class="grow"><div><span style="color:var(--red);text-decoration:line-through">${m.original}</span></div><div style="color:var(--green);font-weight:600">${m.fix}</div>
    ${m.why_en ? html`<div class="sub">${m.why_en}</div>` : ''}${m.why_hi ? html`<div class="sub">${hi(m.why_hi)}</div>` : ''}
    <div class="xs faint mt">${m.source} · ${m.rule} · ×${m.count} · last ${fmtDate(m.lastAt)}${m.lessonId ? html` · <a href="#/grammar/${m.lessonId}">lesson</a>` : ''}</div></div>
    <div class="stack"><button class="btn btn-sm" data-explain="${m.id}" title="Explain with AI" aria-label="Explain with AI">${icon('sparkle')}</button><button class="btn btn-sm" data-resolve="${m.id}" title="Mark as fixed" aria-label="Mark as fixed">${icon('check')}</button><button class="btn btn-sm btn-ghost" data-del="${m.id}" title="Delete" aria-label="Delete">${icon('trash')}</button></div></div>`;
  mount(container, html`
    <div class="page-head"><div><h1>Mistakes</h1><p class="sub">${open.length} open · ${resolved.length} fixed · your personal curriculum</p></div>
      ${open.length ? html`<a class="btn btn-primary" href="#/review?kind=mistake">${icon('zap')} Re-test</a>` : ''}</div>
    ${open.length ? html`<div class="card amber compact"><strong>Top 5 recurring</strong><div class="contrast mt">${open.slice(0, 5).map((m) => html`<div><span style="color:var(--red);text-decoration:line-through">${m.original}</span> → <span style="color:var(--green)">${m.fix}</span> <span class="faint xs">×${m.count}</span></div>`)}</div></div>` : ''}
    <div class="chips mb"><button class="chip active" data-v="rule">By rule</button><button class="chip" data-v="source">By source</button></div>
    <div id="list"></div>
    ${resolved.length ? html`<details class="mt-lg"><summary class="muted small" style="cursor:pointer">Fixed (${resolved.length})</summary><div class="list mt">${resolved.map((m) => html`<div class="list-item"><div class="grow"><div class="sub"><s>${m.original}</s> → ${m.fix}</div></div><button class="btn btn-sm btn-ghost" data-reopen="${m.id}">Reopen</button></div>`)}</div></details>` : ''}`);
  container.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { view = b.dataset.v; container.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  container.querySelectorAll('[data-reopen]').forEach((b) => b.onclick = async () => { await store.resolveMistake(b.dataset.reopen, false); render(container); });
  draw();
  setContext({ title: 'Mistakes notebook', text: open.slice(0, 5).map((m) => `"${m.original}" should be "${m.fix}" (${m.rule})`).join('; ') });
}
