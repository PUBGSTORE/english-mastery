// everyday.js — 🌞 Every day vocab: the 600-item everyday deck by real-life situation, plus 200 spoken phrases. Simple words people actually use.
import { html, mount, icon, toast, speakButton, backLink, progressBar, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import { setContext } from '../router.js';
import { shuffle, mulberry32, hashStr, todayKey } from '../utils.js';

const TOPICS = [
  { id: 'home-kitchen', name: 'Home & kitchen', emoji: '🏠' }, { id: 'clothes-laundry', name: 'Clothes & laundry', emoji: '👕' },
  { id: 'food-cooking-eating-out', name: 'Food & eating out', emoji: '🍛' }, { id: 'shopping-paying', name: 'Shopping & paying', emoji: '🛒' },
  { id: 'transport-directions-booking', name: 'Transport & directions', emoji: '🚕' }, { id: 'phone-internet', name: 'Phone & internet', emoji: '📱' },
  { id: 'bank-bills-forms-appointments', name: 'Bank, bills & forms', emoji: '🏦' }, { id: 'doctor-chemist-feelings-body', name: 'Doctor & health', emoji: '🩺' },
  { id: 'work-meetings-help', name: 'Work & meetings', emoji: '💼' }, { id: 'weather-seasons', name: 'Weather', emoji: '🌦️' },
  { id: 'time-expressions', name: 'Time expressions', emoji: '⏰' }, { id: 'feelings-reactions', name: 'Feelings & reactions', emoji: '😊' },
  { id: 'family-relationships', name: 'Family & people', emoji: '👨‍👩‍👧' }, { id: 'routine-body', name: 'Daily routine', emoji: '🛏️' },
  { id: 'small-talk', name: 'Small talk', emoji: '☕' }, { id: 'numbers-dates-measurements', name: 'Numbers & dates', emoji: '🔢' },
];

export async function render(container, params) {
  const deck = await content.loadDeck('vocab-everyday');
  const cards = new Map((await store.allCards()).filter((c) => c.deck === 'vocab-everyday').map((c) => [c.refId, c]));
  if (params.id === 'today') return renderToday(container, deck, cards);
  if (params.id === 'phrases') return renderPhrases(container);
  if (params.id) return renderTopic(container, params.id, deck, cards);
  const learned = deck.filter((w) => cards.has(w.id) && cards.get(w.id).state !== 'new').length;
  const mastered = deck.filter((w) => cards.has(w.id) && cards.get(w.id).interval >= 21).length;
  mount(container, html`
    <div class="sun-hero"><div class="sun-emoji">🌞</div><div><h1>Every day vocab</h1><p>Simple words and phrases people actually use: at home, in shops, on calls, at the doctor, with friends. Nothing rare, nothing that makes people stare. ${learned}/${deck.length} learned · ${mastered} mastered.</p></div></div>
    ${progressBar((learned / deck.length) * 100, 'green')}
    <div class="grid-2 mt">
      <a class="card sun-card" href="#/everyday/today"><div class="row between"><h3 class="mb-0">☀️ Today's 10</h3><span class="chip">${todayLabel()}</span></div><p class="muted small mb-0">Ten everyday words picked for today, with examples you can say tonight.</p></a>
      <a class="card sun-card" href="#/everyday/phrases"><div class="row between"><h3 class="mb-0">💬 Ready-made sentences</h3><span class="chip">200</span></div><p class="muted small mb-0">"It's up to you." "I'll get back to you." "Take your time." The phrases textbooks skip.</p></a>
    </div>
    <h3 class="mt-lg">By situation</h3>
    <div class="grid-3">${TOPICS.map((t) => { const ws = deck.filter((w) => (w.tags || []).includes(t.id)); const l = ws.filter((w) => cards.has(w.id) && cards.get(w.id).state !== 'new').length; return html`<a class="card sun-topic" href="#/everyday/${t.id}" style="margin:0"><div style="font-size:30px">${t.emoji}</div><strong>${t.name}</strong><div class="xs muted">${ws.length} items · ${l} learned</div>${progressBar(ws.length ? (l / ws.length) * 100 : 0, 'green')}</a>`; })}</div>`);
  setContext({ title: 'Every day vocab', text: 'Everyday English vocabulary by situation.' });
}
function todayLabel() { return new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }

function wordCard(w, c, extra = '') {
  return html`<div class="card sun-word"><div class="row between" style="align-items:flex-start"><div class="grow">
      <div class="row" style="gap:8px"><strong style="font-size:var(--fs-xl)">${w.word}</strong><span class="ipa">${w.ipa}</span>${speakButton(w.word)}<span class="chip" style="min-height:22px;padding:0 8px">${w.cefr}</span></div>
      <div style="font-size:var(--fs-lg)">${w.en_def}</div><div class="hi-text" lang="hi">${w.hi_def}</div>${w.gu_def ? html`<div class="hi-text" lang="gu">${w.gu_def}</div>` : ''}
      ${(w.examples || []).slice(0, 2).map((ex) => html`<div class="sun-ex">“${ex.en}” ${speakButton(ex.en)}<div>${hi(ex.hi)}</div></div>`)}
      ${w.common_mistake ? html`<div class="xs mt"><span style="color:var(--red);text-decoration:line-through">${w.common_mistake.wrong}</span> → <span style="color:var(--green)">${w.common_mistake.right}</span></div>` : ''}</div>
    <div class="stack" style="gap:4px">${c ? html`<span class="chip ${c.interval >= 21 ? 'green' : c.state === 'new' ? '' : 'amber'}" style="min-height:26px">${c.state === 'new' ? 'queued' : c.interval >= 21 ? 'mastered' : 'learning'}</span>` : html`<button class="btn btn-sm btn-primary" data-add="${w.id}">${icon('plus')} Learn</button>`}<button class="btn btn-sm btn-ghost" data-fav="${w.id}" aria-label="My list">❤</button><a class="btn btn-sm btn-ghost" href="#/word/${w.id}">${icon('next')}</a></div></div>${extra}</div>`;
}
async function wire(container, deck, cards) {
  const mv = await import('../myvocab.js'); const favKeys = new Set((await mv.list()).map((x) => x.key));
  container.querySelectorAll('[data-fav]').forEach((b) => { if (favKeys.has(b.dataset.fav)) b.style.color = 'var(--red)'; b.onclick = async () => { const added = await mv.toggle(await mv.fromWordId(b.dataset.fav)); b.style.color = added ? 'var(--red)' : ''; toast(added ? 'Added to your list' : 'Removed', 'ok', { timeout: 1200 }); }; });
  container.querySelectorAll('[data-add]').forEach((b) => b.onclick = async () => { await store.ensureVocabCards([b.dataset.add], { priority: 1 }); b.replaceWith(Object.assign(document.createElement('span'), { className: 'chip', textContent: 'queued' })); toast('Added to reviews', 'ok', { timeout: 1200 }); });
}

async function renderTopic(container, topicId, deck, cards) {
  const t = TOPICS.find((x) => x.id === topicId);
  if (!t) { mount(container, html`${backLink('#/everyday')}<div class="empty">Not found</div>`); return; }
  const ws = deck.filter((w) => (w.tags || []).includes(topicId));
  const notYet = ws.filter((w) => !cards.has(w.id));
  mount(container, html`${backLink('#/everyday', 'Every day vocab')}
    <div class="page-head"><div><h1>${t.emoji} ${t.name}</h1><p class="sub">${ws.length} items · ${ws.length - notYet.length} in your reviews</p></div>${notYet.length ? html`<button class="btn btn-primary" id="add-all">${icon('plus')} Learn all ${notYet.length}</button>` : html`<a class="btn" href="#/review?deck=vocab-everyday">${icon('zap')} Review</a>`}</div>
    <div id="list">${ws.map((w) => wordCard(w, cards.get(w.id)))}</div>`);
  const aa = $('#add-all', container); if (aa) aa.onclick = async () => { await store.ensureVocabCards(notYet.map((w) => w.id), { priority: 1 }); toast(`Added ${notYet.length} words; they arrive at your daily new-card limit.`, 'ok'); render(container, { id: topicId }); };
  await wire(container, deck, cards);
  setContext({ title: `Everyday: ${t.name}`, text: ws.slice(0, 12).map((w) => `${w.word}: ${w.en_def}`).join('; ') });
}

async function renderToday(container, deck, cards) {
  const notYet = deck.filter((w) => !cards.has(w.id));
  const pool = notYet.length >= 10 ? notYet : deck;
  const rng = mulberry32(hashStr(todayKey() + '|everyday'));
  const ten = shuffle(pool, rng).slice(0, 10);
  mount(container, html`${backLink('#/everyday', 'Every day vocab')}
    <div class="page-head"><div><h1>☀️ Today's 10</h1><p class="sub">${todayLabel()} · same ten all day, new ten tomorrow. Say each example aloud once.</p></div><button class="btn btn-primary" id="add-ten">${icon('plus')} Learn all 10</button></div>
    <div id="list">${ten.map((w, i) => wordCard(w, cards.get(w.id)))}</div>
    <div class="btn-row center mt"><a class="btn btn-lg" href="#/review?deck=vocab-everyday">${icon('zap')} Review everyday words now</a></div>`);
  $('#add-ten', container).onclick = async () => { await store.ensureVocabCards(ten.map((w) => w.id), { priority: 2 }); toast('Added today\'s 10 to your reviews', 'ok'); render(container, { id: 'today' }); };
  await wire(container, deck, cards);
  setContext({ title: "Today's 10 everyday words", text: ten.map((w) => w.word).join(', ') });
}

async function renderPhrases(container) {
  const phrases = await content.load('daily-phrases');
  const topics = [...new Set(phrases.map((p) => p.topic))];
  const cards = new Set((await store.allCards()).filter((c) => c.kind === 'phrase').map((c) => c.refId));
  let topic = topics[0];
  const draw = () => {
    const list = phrases.filter((p) => p.topic === topic);
    mount($('#pl', container), html`${list.map((p) => html`<div class="card sun-word"><div class="row between" style="align-items:flex-start"><div class="grow"><div style="font-size:var(--fs-lg);font-weight:700">${p.phrase} ${speakButton(p.phrase)}</div><div class="hi-text" lang="hi">${p.hi}</div><div class="small muted mt">${p.when_en}</div><div class="sun-ex">“${p.examples[0].en}”<div>${hi(p.examples[0].hi)}</div></div><div class="xs mt"><span class="muted">Instead of:</span> <span style="color:var(--red);text-decoration:line-through">${p.stiff}</span></div></div>${cards.has(p.id) ? html`<span class="chip green">${icon('check')}</span>` : html`<button class="btn btn-sm btn-primary" data-ph="${p.id}">${icon('plus')}</button>`}</div></div>`)}`);
    container.querySelectorAll('[data-ph]').forEach((b) => b.onclick = async () => { const p = phrases.find((x) => x.id === b.dataset.ph); await store.ensureCard({ id: `card:${p.id}`, refId: p.id, deck: 'phrases', kind: 'phrase', payload: { text: p.phrase, hi: p.hi, cue: p.when_en, register: p.register, clumsy: p.stiff, example: p.examples[0] } }); cards.add(p.id); draw(); });
  };
  mount(container, html`${backLink('#/everyday', 'Every day vocab')}
    <div class="page-head"><div><h1>💬 Ready-made sentences</h1><p class="sub">Say these as they are. Cards test you Hindi → English.</p></div><a class="btn" href="#/phrases">Full phrase browser</a></div>
    <div class="chips scroll mb">${topics.map((t) => html`<button class="chip ${t === topic ? 'active' : ''}" data-t="${t}">${t}</button>`)}</div><div id="pl"></div>`);
  container.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { topic = b.dataset.t; container.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  draw();
  setContext({ title: 'Everyday phrases', text: 'Ready-made spoken sentences by topic.' });
}
