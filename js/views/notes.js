// notes.js — notes with tags, search, markdown-lite, attach to word/lesson, convert to SRS card.
import { html, mount, icon, toast, confirmDialog, backLink, $ } from '../ui.js';
import * as store from '../store.js';
import * as content from '../content.js';
import { setContext, parseHash } from '../router.js';
import { mdLite, debounce, fmtDate, hashStr } from '../utils.js';

export async function render(container, params) {
  if (params.id === 'new') return renderEditor(container, null, parseHash().query);
  if (params.id) return renderEditor(container, params.id);
  return renderList(container);
}

async function renderList(container) {
  const notes = await store.allNotes();
  const tags = [...new Set(notes.flatMap((n) => n.tags || []))].sort();
  let q = ''; let tag = '';
  const draw = () => {
    const list = notes.filter((n) => (!tag || (n.tags || []).includes(tag)) && (!q || `${n.title} ${n.body} ${(n.tags || []).join(' ')}`.toLowerCase().includes(q)));
    mount($('#list', container), html`${list.length ? list.map((n) => html`<a class="list-item" href="#/notes/${n.id}"><div class="grow"><div class="title">${n.title || 'Untitled'}${n.cardId ? html` <span class="chip green" style="min-height:20px;padding:0 6px">card</span>` : ''}</div><div class="sub">${(n.body || '').replace(/[#*`>]/g, '').slice(0, 100)}</div><div class="xs faint">${fmtDate(n.updatedAt)}${n.tags && n.tags.length ? ` · ${n.tags.map((t) => '#' + t).join(' ')}` : ''}</div></div>${icon('next', 'arrow')}</a>`) : html`<div class="empty">${icon('note')}<p>${notes.length ? 'No matches.' : 'No notes yet. Write anything: a phrase you heard, a rule in your own words, a sentence you liked. One tap turns it into a flashcard.'}</p></div>`}`);
  };
  mount(container, html`
    <div class="page-head"><div><h1>Notes</h1><p class="sub">${notes.length} notes</p></div><a class="btn btn-primary" href="#/notes/new">${icon('plus')} New note</a></div>
    <div class="search mb">${icon('search')}<input class="input" type="search" id="q" placeholder="Search notes…"></div>
    ${tags.length ? html`<div class="chips scroll mb" id="tags"><button class="chip active" data-tag="">all</button>${tags.map((t) => html`<button class="chip" data-tag="${t}">#${t}</button>`)}</div>` : ''}
    <div class="list" id="list"></div>`);
  $('#q', container).oninput = debounce(() => { q = $('#q', container).value.toLowerCase().trim(); draw(); }, 120);
  container.querySelectorAll('[data-tag]').forEach((b) => b.onclick = () => { tag = b.dataset.tag; container.querySelectorAll('[data-tag]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  draw();
  setContext({ title: 'Notes', text: 'My personal English notes.' });
}

async function renderEditor(container, id, query = {}) {
  const note = id ? await (await import('../db.js')).get('notes', id) : { title: query.title || '', body: '', tags: [], attachedTo: query.attach || null };
  if (!note) { mount(container, html`${backLink('#/notes')}<div class="empty">Note not found</div>`); return; }
  const attached = note.attachedTo ? await content.describeRef(note.attachedTo) : null;
  let preview = false;
  const draw = () => {
    mount(container, html`
      ${backLink('#/notes', 'Notes')}
      <div class="card">
        <input class="input mb" id="title" placeholder="Title" value="${note.title || ''}" style="font-weight:700;font-size:var(--fs-lg)">
        ${attached ? html`<div class="xs muted mb">${icon('tag')} Attached to <a href="${attached.href}">${attached.title}</a></div>` : ''}
        <div class="tabs"><button class="${preview ? '' : 'active'}" data-m="edit">Write</button><button class="${preview ? 'active' : ''}" data-m="preview">Preview</button></div>
        ${preview ? html`<div class="md" style="min-height:200px">${{ toString: () => mdLite(note.body || $('#body', container)?.value || '') }}</div>` : html`<textarea class="textarea" id="body" rows="10" placeholder="Write in markdown-lite: **bold**, *italic*, - lists, # headings, > quotes.&#10;&#10;Tip: put the question on the first line and the answer below — the card uses that split." style="min-height:220px">${note.body || ''}</textarea>`}
        <div class="field mt"><label for="tags">Tags (comma separated)</label><input class="input" id="tags" placeholder="grammar, phrasal, work" value="${(note.tags || []).join(', ')}" autocapitalize="off"></div>
        <div class="btn-row"><button class="btn btn-primary" id="save">Save</button><button class="btn" id="to-card">${note.cardId ? html`${icon('check')} Card exists` : html`${icon('zap')} Make flashcard`}</button>${id ? html`<button class="btn btn-ghost" id="del">${icon('trash')} Delete</button>` : ''}</div>
      </div>`);
    container.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { collect(); preview = b.dataset.m === 'preview'; draw(); });
    $('#save', container).onclick = async () => { collect(); if (!note.title && !note.body) { toast('Write something first', 'warn'); return; } const saved = await store.saveNote(note); toast('Saved', 'ok'); if (!id) location.hash = `#/notes/${saved.id}`; };
    $('#to-card', container).onclick = async () => {
      collect(); if (!note.body && !note.title) { toast('Write something first', 'warn'); return; }
      const saved = await store.saveNote(note); id = saved.id;
      const lines = (note.body || '').split('\n').filter((l) => l.trim());
      const front = note.title || lines[0] || 'Note';
      const back = note.title ? note.body : lines.slice(1).join('\n');
      const cardId = `card:note:${saved.id}`;
      await store.ensureCard({ id: cardId, refId: saved.id, deck: 'notes', kind: 'note', payload: { front, backHtml: mdLite(back || note.body), noteId: saved.id } });
      note.cardId = cardId; await store.saveNote(note);
      toast('Flashcard created. It will appear in your next review.', 'ok'); draw();
    };
    const del = $('#del', container); if (del) del.onclick = async () => { if (await confirmDialog('Delete this note?', { okLabel: 'Delete', danger: true })) { if (note.cardId) await store.deleteCard(note.cardId); await store.deleteNote(id); location.hash = '#/notes'; } };
    if (!id && !preview) setTimeout(() => $('#body', container).focus(), 80);
  };
  const collect = () => { note.title = $('#title', container).value.trim(); const b = $('#body', container); if (b) note.body = b.value; note.tags = $('#tags', container).value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean); };
  draw();
  setContext({ title: note.title || 'Note', text: (note.body || '').slice(0, 300) });
}
