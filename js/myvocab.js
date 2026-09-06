// myvocab.js — one personal vocabulary list: any word, anywhere, one tap. Stored as a Notes page (id nt:personal-vocab) + a structured list.
import * as db from './db.js';
import * as store from './store.js';
import * as content from './content.js';
import { nowISO } from './utils.js';

export const NOTE_ID = 'nt:personal-vocab';

export async function list() { return (await db.getSetting('personalVocab', [])) || []; }
export async function has(key) { return (await list()).some((x) => x.key === key); }

/**
 * Add a word. entry: { key (word id or lemma), word, en, hi, gu, ipa, source: {title, href} }
 */
export async function add(entry) {
  const cur = await list();
  if (cur.some((x) => x.key === entry.key)) return false;
  cur.unshift({ ...entry, addedAt: nowISO() });
  await db.setSetting('personalVocab', cur);
  await syncNote(cur);
  return true;
}
export async function remove(key) {
  const cur = (await list()).filter((x) => x.key !== key);
  await db.setSetting('personalVocab', cur);
  await syncNote(cur);
}
export async function toggle(entry) { if (await has(entry.key)) { await remove(entry.key); return false; } await add(entry); return true; }

async function syncNote(cur) {
  const body = ['# ❤ My vocabulary list', `${cur.length} words · tap any word in the app to add it here. Revise this page in your free time.`, '']
    .concat(cur.map((x) => `- **${x.word}**${x.ipa ? ' ' + x.ipa : ''} — ${x.en || ''}${x.hi ? ' · ' + x.hi : ''}${x.gu ? ' · ' + x.gu : ''}${x.source && x.source.title ? ` _(from ${x.source.title})_` : ''}`)).join('\n');
  const existing = await db.get('notes', NOTE_ID);
  await store.saveNote({ id: NOTE_ID, title: '❤ My vocabulary list', body, tags: ['vocab', 'personal'], attachedTo: null, createdAt: existing ? existing.createdAt : nowISO() });
}

/** Build an entry from a content word id. */
export async function fromWordId(id, source = null) {
  const w = await content.wordById(id);
  if (!w) return null;
  return { key: id, word: w.word, en: w.en_def, hi: w.hi_def, gu: w.gu_def || '', ipa: w.ipa, source: source || { title: content.deckOfWord(id), href: `#/word/${id}` } };
}
