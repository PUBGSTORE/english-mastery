// hub.js — Learn / Practice landing pages for the phone tab bar.
import { html, icon, mount } from '../ui.js';
import { current } from '../router.js';
import * as store from '../store.js';

const LEARN = [
  { href: '#/review', icon: 'zap', title: 'Review', sub: 'Spaced repetition — do this first', key: 'due' },
  { href: '#/daily', icon: 'calendar', title: 'Daily 5', sub: 'Five new words, every day' },
  { href: '#/vocab', icon: 'layers', title: 'Vocabulary', sub: '1,200+ words across 8 decks' },
  { href: '#/grammar', icon: 'book', title: 'Grammar', sub: '60 lessons, A1 → C1' },
  { href: '#/notes', icon: 'note', title: 'Notes', sub: 'Your own notes → flashcards' },
];
const PRACTICE = [
  { href: '#/pron', icon: 'wave', title: 'Pronunciation', sub: 'Phonemes, minimal pairs, stress, intonation' },
  { href: '#/shadow', icon: 'ear', title: 'Shadowing', sub: 'Copy native rhythm sentence by sentence' },
  { href: '#/listen', icon: 'speaker', title: 'Listening', sub: 'Dictation, numbers, dates, spelling' },
  { href: '#/speak', icon: 'mic', title: 'Speaking', sub: 'Daily prompt with AI feedback' },
  { href: '#/write', icon: 'pen', title: 'Writing studio', sub: 'Emails, bug reports, essays — graded' },
  { href: '#/mistakes', icon: 'alert', title: 'Mistakes', sub: 'Your error notebook' },
];

export async function render_(container, isLearn) {
  const items = isLearn ? LEARN : PRACTICE;
  let due = 0;
  try { due = (await store.dueSummary()).total; } catch { /* ignore */ }
  mount(container, html`
    <div class="page-head"><div><h1>${isLearn ? 'Learn' : 'Practice'}</h1><p class="sub">${isLearn ? 'Build the knowledge.' : 'Turn knowledge into skill.'}</p></div></div>
    <div class="list">
      ${items.map((i) => html`<a class="list-item" href="${i.href}">${icon(i.icon)}<div class="grow"><div class="title">${i.title}${i.key === 'due' && due ? html` <span class="badge">${due}</span>` : ''}</div><div class="sub">${i.sub}</div></div>${icon('next', 'arrow')}</a>`)}
    </div>`);
}
export function render(container) { return render_(container, current() === '/learn'); }
