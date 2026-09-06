// myvocab.js (view) — ❤ My vocabulary list: everything you starred, anywhere, with a revise mode.
import { html, mount, icon, toast, confirmDialog, speakButton, $ } from '../ui.js';
import * as mv from '../myvocab.js';
import * as store from '../store.js';
import { setContext } from '../router.js';
import { fmtDate, shuffle, download } from '../utils.js';

export async function render(container) {
  const items = await mv.list();
  let mode = 'list'; let q = '';
  const draw = () => {
    const list = items.filter((x) => !q || `${x.word} ${x.en} ${x.hi} ${x.gu}`.toLowerCase().includes(q));
    mount($('#mv', container), mode === 'list' ? html`${list.length ? list.map((x) => html`<div class="list-item"><div class="grow"><div class="title">${x.word} ${x.ipa ? html`<span class="ipa xs">${x.ipa}</span>` : ''} ${speakButton(x.word)}</div><div class="sub">${x.en}</div><div class="sub"><span class="hi-text" lang="hi">${x.hi || ''}</span>${x.gu ? html` · <span class="hi-text" lang="gu">${x.gu}</span>` : ''}</div>${x.source && x.source.title ? html`<div class="xs faint">from ${x.source.href ? html`<a href="${x.source.href}">${x.source.title}</a>` : x.source.title} · ${fmtDate(x.addedAt)}</div>` : ''}</div>
        <div class="stack" style="gap:4px"><a class="btn btn-sm btn-ghost" href="https://www.google.com/search?q=${encodeURIComponent('define ' + x.word)}" target="_blank" rel="noopener" aria-label="Google">G</a>${x.key.startsWith('v:') ? html`<button class="btn btn-sm" data-srs="${x.key}" aria-label="Add to reviews">${icon('zap')}</button>` : ''}<button class="btn btn-sm btn-ghost" data-rm="${x.key}" aria-label="Remove">${icon('trash')}</button></div></div>`) : html`<div class="empty">${icon('star')}<p>Empty so far. Tap ❤ on any word — in a deck, a mined video, the reader, a glossary — and it lands here.</p></div>`}`
      : revise(list));
    container.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => { await mv.remove(b.dataset.rm); items.splice(items.findIndex((x) => x.key === b.dataset.rm), 1); draw(); });
    container.querySelectorAll('[data-srs]').forEach((b) => b.onclick = async () => { await store.ensureVocabCards([b.dataset.srs], { priority: 1 }); toast('Added to reviews', 'ok'); });
  };
  const revise = (list) => {
    const order = shuffle(list); let i = 0;
    setTimeout(() => {
      const one = () => {
        if (!order.length) return;
        const x = order[i % order.length];
        mount($('#mv', container), html`<div class="flashcard" id="mv-card"><span class="kind">revise ${i + 1}/${order.length}</span><div class="word">${x.word}</div><div class="row"><span class="ipa">${x.ipa || ''}</span>${speakButton(x.word)}</div><div class="answer" id="mv-ans" hidden><div class="def">${x.en}</div><div class="hi-text" lang="hi">${x.hi || ''}</div>${x.gu ? html`<div class="hi-text" lang="gu">${x.gu}</div>` : ''}</div></div>
          <div class="btn-row center mt"><button class="btn btn-primary" id="mv-reveal">Show meaning</button><button class="btn" id="mv-next" hidden>Next ${icon('next')}</button></div>`);
        $('#mv-reveal', container).onclick = () => { $('#mv-ans', container).hidden = false; $('#mv-reveal', container).hidden = true; $('#mv-next', container).hidden = false; };
        $('#mv-next', container).onclick = () => { i++; one(); };
      };
      one();
    }, 0);
    return html`<div id="mv-inner"></div>`;
  };
  mount(container, html`
    <div class="page-head"><div><h1>❤ My vocabulary list</h1><p class="sub">${items.length} words you chose to keep. Revise them in your free time; the same list is a page in Notes.</p></div>
      <div class="btn-row"><button class="btn ${mode === 'list' ? 'btn-primary' : ''}" id="m-list">List</button><button class="btn" id="m-revise">${icon('refresh')} Revise</button><a class="btn" href="#/notes/${mv.NOTE_ID}">${icon('note')} Notes page</a><button class="btn btn-ghost" id="exp">${icon('download')} Export</button></div></div>
    <div class="search mb">${icon('search')}<input class="input" type="search" id="q" placeholder="Search my list…"></div>
    <div class="list" id="mv"></div>`);
  $('#q', container).oninput = (e) => { q = e.target.value.toLowerCase().trim(); draw(); };
  $('#m-list', container).onclick = () => { mode = 'list'; draw(); };
  $('#m-revise', container).onclick = () => { if (!items.length) { toast('Add some words first.', 'warn'); return; } mode = 'revise'; draw(); };
  $('#exp', container).onclick = () => download('my-vocabulary.txt', items.map((x) => `${x.word}\t${x.en}\t${x.hi || ''}\t${x.gu || ''}`).join('\n'), 'text/plain');
  draw();
  setContext({ title: 'My vocabulary list', text: items.slice(0, 30).map((x) => x.word).join(', ') });
}
