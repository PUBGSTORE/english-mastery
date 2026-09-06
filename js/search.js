// search.js — §11 global search across words, lessons, chunks, roots, notes, mistakes, saved sentences, chat threads.
import * as db from './db.js';
import * as content from './content.js';
import { html, openSheet, closeSheet, icon, $ } from './ui.js';
import { debounce, escapeHtml } from './utils.js';

let index = null;
export async function build() {
  const items = [];
  try { for (const w of await content.allVocab()) items.push({ t: 'word', title: w.word, sub: `${w.en_def} · ${w.hi_def}`, href: `#/word/${w.id}`, key: `${w.word} ${w.en_def} ${w.hi_def}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const l of await content.grammarSorted()) items.push({ t: 'lesson', title: l.title, sub: `Grammar · ${l.cefr}`, href: `#/grammar/${l.id}`, key: `${l.title} ${l.pattern} ${(l.tags || []).join(' ')}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const c of await content.load('chunks')) items.push({ t: 'chunk', title: c.chunk, sub: `${c.function} · ${c.hi}`, href: `#/chunks/${encodeURIComponent(c.function)}`, key: `${c.chunk} ${c.hi} ${c.function}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const p of await content.load('daily-phrases')) items.push({ t: 'phrase', title: p.phrase, sub: p.hi, href: '#/phrases', key: `${p.phrase} ${p.hi}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const r of await content.load('morphology')) items.push({ t: 'root', title: r.part, sub: `${r.meaning_en} · ${r.derived.slice(0, 4).map((d) => d.word).join(', ')}`, href: `#/roots/${encodeURIComponent(r.id)}`, key: `${r.part} ${r.meaning_en} ${r.derived.map((d) => d.word).join(' ')}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const c of await content.load('confusables')) items.push({ t: 'confusable', title: `${c.a} / ${c.b}`, sub: c.rule_en, href: '#/confusables', key: `${c.a} ${c.b} ${c.c || ''}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const n of await db.getAll('notes')) items.push({ t: (n.tags || []).includes('sentence') ? 'sentence' : 'note', title: n.title || 'Note', sub: (n.body || '').slice(0, 80), href: `#/notes/${n.id}`, key: `${n.title} ${n.body} ${(n.tags || []).join(' ')}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const m of await db.getAll('mistakes')) items.push({ t: 'mistake', title: `${m.original} → ${m.fix}`, sub: m.rule, href: '#/mistakes', key: `${m.original} ${m.fix} ${m.rule}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const t of await db.getAll('threads')) items.push({ t: 'chat', title: t.title, sub: t.summary || '', href: `#/chat/${t.id}`, key: `${t.title} ${t.summary || ''}`.toLowerCase() }); } catch { /* ignore */ }
  try { for (const v of await db.getAll('videos')) items.push({ t: 'video', title: v.title, sub: `${v.words.length} mined words`, href: `#/mine/${encodeURIComponent(v.id)}`, key: `${v.title} ${v.words.map((w) => w.lemma).join(' ')}`.toLowerCase() }); } catch { /* ignore */ }
  index = items;
  return items;
}
export function invalidate() { index = null; }
export async function query(q) {
  if (!index) await build();
  const s = q.toLowerCase().trim(); if (!s) return [];
  const starts = [], contains = [];
  for (const it of index) { if (it.title.toLowerCase().startsWith(s)) starts.push(it); else if (it.key.includes(s)) contains.push(it); if (starts.length > 40) break; }
  return [...starts, ...contains].slice(0, 40);
}
export function openSearch() {
  const body = openSheet(html`<div class="search">${icon('search')}<input class="input" type="search" id="gs" placeholder="Search words, lessons, chunks, roots, notes, mistakes, chats…" autocomplete="off"></div><div class="list mt" id="gs-out"><div class="xs muted center">Type to search everything.</div></div>`, { wide: true });
  const input = $('#gs', body); const out = $('#gs-out', body);
  input.oninput = debounce(async () => {
    const hits = await query(input.value);
    out.innerHTML = hits.length ? hits.map((h) => `<a class="list-item" href="${h.href}"><span class="chip" style="min-height:22px;padding:0 8px">${h.t}</span><div class="grow"><div class="title">${escapeHtml(h.title)}</div><div class="sub">${escapeHtml(h.sub)}</div></div></a>`).join('') : `<div class="xs muted center">No matches</div>`;
    out.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => closeSheet()));
  }, 120);
  setTimeout(() => input.focus(), 80);
}
