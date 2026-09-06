// chunks.js — functional sentence frames (§4) and everyday spoken phrases (§5b), both production-first SRS cards.
import { html, mount, icon, toast, speakButton, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import { setContext, current } from '../router.js';
import { debounce } from '../utils.js';

export async function render(container, params) {
  const isPhrases = current().startsWith('/phrases');
  const items = await content.load(isPhrases ? 'daily-phrases' : 'chunks');
  const cards = new Set((await store.allCards()).filter((c) => c.kind === (isPhrases ? 'phrase' : 'chunk')).map((c) => c.refId));
  const groupKey = isPhrases ? 'topic' : 'function';
  const groups = [...new Set(items.map((x) => x[groupKey]))];
  let group = params.group ? decodeURIComponent(params.group) : groups[0]; let q = ''; let reg = '';
  const draw = () => {
    const list = items.filter((x) => (group === 'all' || x[groupKey] === group) && (!reg || x.register === reg) && (!q || `${x.chunk || x.phrase} ${x.hi} ${x.clumsy || x.stiff || ''}`.toLowerCase().includes(q)));
    const inList = list.filter((x) => !cards.has(x.id));
    mount($('#list', container), html`
      <div class="row between mb"><span class="xs muted">${list.length} items · ${list.length - inList.length} in reviews</span>${inList.length ? html`<button class="btn btn-sm" id="add-group">${icon('plus')} Add these ${inList.length}</button>` : ''}</div>
      ${list.map((x) => html`<div class="card compact"><div class="row between" style="align-items:flex-start"><div class="grow">
        <div style="font-size:var(--fs-lg);font-weight:700">${x.chunk || x.phrase} ${speakButton(x.chunk || x.phrase)}<span class="chip" style="min-height:22px;padding:0 8px;margin-left:6px">${x.register}</span></div>
        <div>${hi(x.hi)}</div>
        ${x.when_en ? html`<div class="small muted mt">${x.when_en}</div><div class="small">${hi(x.when_hi)}</div>` : ''}
        ${x.note_en ? html`<div class="small muted mt">${x.note_en}</div><div class="small">${hi(x.note_hi)}</div>` : ''}
        <div class="small mt"><span style="color:var(--red);text-decoration:line-through">${x.clumsy || x.stiff}</span></div>
        <div class="example-list mt">${(x.examples || []).map((ex) => html`<div class="ex"><div class="grow"><div>${ex.en}</div><div>${hi(ex.hi)}</div></div>${speakButton(ex.en)}</div>`)}</div></div>
        ${cards.has(x.id) ? html`<span class="chip green">${icon('check')}</span>` : html`<button class="btn btn-sm btn-primary" data-add="${x.id}">${icon('plus')}</button>`}</div></div>`)}`);
    $('#list', container).querySelectorAll('[data-add]').forEach((b) => b.onclick = async () => { await addOne(items.find((x) => x.id === b.dataset.add)); cards.add(b.dataset.add); draw(); });
    const ag = $('#add-group', container); if (ag) ag.onclick = async () => { for (const x of inList) { await addOne(x); cards.add(x.id); } toast(`Added ${inList.length}`, 'ok'); draw(); };
  };
  const addOne = (x) => store.ensureCard({ id: `card:${x.id}`, refId: x.id, deck: isPhrases ? 'phrases' : 'chunks', kind: isPhrases ? 'phrase' : 'chunk', payload: { text: x.chunk || x.phrase, hi: x.hi, cue: x.function || x.when_en, register: x.register, clumsy: x.clumsy || x.stiff, example: (x.examples || [])[0] || null } });
  mount(container, html`
    <div class="page-head"><div><h1>${isPhrases ? 'Everyday phrases' : 'Chunks'}</h1><p class="sub">${isPhrases ? '200 spoken phrases textbooks skip. Cards test you Hindi → phrase.' : 'Native fluency is stored frames, not assembled words. 300 frames by function; cards test you function → frame.'}</p></div>
      <div class="btn-row"><a class="btn btn-sm ${isPhrases ? '' : 'btn-primary'}" href="#/chunks">Chunks</a><a class="btn btn-sm ${isPhrases ? 'btn-primary' : ''}" href="#/phrases">Phrases</a>${cards.size ? html`<a class="btn btn-sm" href="#/review?kind=${isPhrases ? 'phrase' : 'chunk'}">${icon('zap')} Review</a>` : ''}</div></div>
    <div class="search mb">${icon('search')}<input class="input" type="search" id="q" placeholder="Search…"></div>
    <div class="chips scroll mb" id="groups"><button class="chip ${group === 'all' ? 'active' : ''}" data-g="all">all</button>${groups.map((g) => html`<button class="chip ${g === group ? 'active' : ''}" data-g="${g}">${g}</button>`)}</div>
    <div class="chips mb"><span class="xs muted">Register:</span>${['', 'formal', 'neutral', 'informal'].map((r) => html`<button class="chip ${r === reg ? 'active' : ''}" data-r="${r}">${r || 'any'}</button>`)}</div>
    <div id="list"></div>`);
  container.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => { group = b.dataset.g; container.querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  container.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { reg = b.dataset.r; container.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  $('#q', container).oninput = debounce(() => { q = $('#q', container).value.toLowerCase().trim(); if (q) group = 'all'; draw(); }, 120);
  draw();
  setContext({ title: isPhrases ? 'Everyday phrases' : 'Chunks', text: `${isPhrases ? 'Spoken phrases' : 'Functional sentence frames'} for ${group}.` });
}
