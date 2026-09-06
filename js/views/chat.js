// chat.js — DeepSeek tutor: threads, streaming, quick-action chips, context injection. Also mounted in the Ask sheet.
import { html, mount, icon, toast, confirmDialog, promptDialog, openSheet, closeSheet, $ } from '../ui.js';
import * as ai from '../ai.js';
import * as store from '../store.js';
import { getContext } from '../router.js';
import { mdLite, fmtDate, debounce, estimateTokens } from '../utils.js';

const CHIPS = [
  { label: 'Explain simpler', text: 'Explain that again more simply, with a Hindi explanation.' },
  { label: '5 more examples', text: 'Give me 5 more example sentences for this, each with Hindi.' },
  { label: 'Quiz me', text: 'Quiz me on this with 3 short questions. Wait for my answers.' },
  { label: 'Translate to Hindi', text: 'Translate your last answer into Hindi (Devanagari).' },
  { label: 'Is my sentence correct?', text: 'Is this sentence correct? If not, fix it and explain: ' },
];

export async function render(container, params) {
  const key = await ai.hasKey();
  if (params.id) { return mountThread(container, params.id, { embedded: false }); }
  const threads = await ai.listThreads();
  const usage = await ai.usageSummary();
  const memory = await ai.getMemory();
  const inr = await (await import('../db.js')).getSetting('inrRate', 84);
  mount(container, html`
    <div class="page-head"><div><h1>AI tutor</h1><p class="sub">${key ? `deepseek-chat · ${usage.calls} calls · ≈ ₹${(usage.cost * inr).toFixed(2)} ($${usage.cost.toFixed(3)}) spent` : 'No API key yet'}</p></div><div class="btn-row"><button class="btn" id="memory">${icon('star')} Memory (${memory.length})</button><button class="btn btn-primary" id="new">${icon('plus')} New chat</button></div></div>
    ${!key ? noKeyHtml() : ''}
    <div class="search mb">${icon('search')}<input class="input" type="search" id="q" placeholder="Search chats…"></div>
    <div class="list" id="threads">${threads.length ? threads.map(threadRow) : html`<div class="empty">${icon('chat')}<p>No conversations yet. Tap the Ask button on any screen: the tutor already knows what you are studying.</p></div>`}</div>`);
  $('#new', container).onclick = async () => { const t = await ai.createThread({ title: 'New chat' }); location.hash = `#/chat/${t.id}`; };
  $('#memory', container).onclick = async () => {
    const draw = async () => {
      const m = await ai.getMemory();
      const body = openSheet(html`<h3>What the tutor remembers about you</h3><p class="small muted">These facts are added to every conversation so the tutor never starts from zero. They are learned automatically every few messages, and you can add or delete any.</p>
        <div class="list">${m.length ? m.map((x) => html`<div class="list-item"><div class="grow"><div class="small">${x.text}</div><div class="xs faint">${x.source === 'auto' ? 'learned' : 'added by you'} · ${fmtDate(x.ts)}</div></div><button class="btn btn-sm btn-ghost" data-mem-del="${x.id}">${icon('trash')}</button></div>`) : html`<div class="xs muted">Nothing yet. Chat a little, or add a fact below.</div>`}</div>
        <form class="row mt" id="mem-form"><input class="input" id="mem-in" placeholder="e.g. I want to sound natural in client calls" style="flex:1"><button class="btn btn-primary" type="submit">Add</button></form>`, { wide: true });
      body.querySelectorAll('[data-mem-del]').forEach((b) => b.onclick = async () => { await ai.removeMemory(b.dataset.memDel); closeSheet(); setTimeout(draw, 250); });
      body.querySelector('#mem-form').onsubmit = async (e) => { e.preventDefault(); const v = body.querySelector('#mem-in').value.trim(); if (!v) return; await ai.addMemory(v, 'user'); closeSheet(); setTimeout(draw, 250); };
    };
    draw();
  };
  $('#q', container).oninput = debounce(async () => {
    const q = $('#q', container).value.toLowerCase().trim();
    if (!q) { mount($('#threads', container), html`${threads.map(threadRow)}`); return; }
    const hits = [];
    for (const t of threads) {
      if (t.title.toLowerCase().includes(q)) { hits.push(t); continue; }
      const msgs = await ai.threadMessages(t.id);
      if (msgs.some((m) => m.content.toLowerCase().includes(q))) hits.push(t);
    }
    mount($('#threads', container), html`${hits.length ? hits.map(threadRow) : html`<div class="empty small">No matches</div>`}`);
  }, 200);
}
const threadRow = (t) => html`<a class="list-item" href="#/chat/${t.id}"><div class="grow"><div class="title">${t.title}</div><div class="sub">${fmtDate(t.updatedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${t.count || 0} messages${t.context && t.context.title ? ` · ${t.context.title}` : ''}</div></div>${icon('next', 'arrow')}</a>`;

function noKeyHtml() {
  return html`<div class="card amber"><h3>Add your DeepSeek key</h3><p class="small">The tutor uses DeepSeek's <code>deepseek-chat</code> model (a few rupees per hundred messages). Create a key at platform.deepseek.com, set a monthly limit there, then paste it in Settings. It is stored only on this device.</p><a class="btn btn-primary" href="#/settings">Open Settings</a></div>`;
}

/** Mount the chat UI for the Ask sheet or the full page. */
export async function mountChat(container, { context = null, embedded = true, threadId = null, initialMessage = null } = {}) {
  let thread;
  if (threadId) thread = await ai.getThread(threadId);
  if (!thread) {
    // Remember: reuse the most recent thread if it was used in the last 24h (same context → same thread; otherwise continue the latest one).
    const ctx = context || getContext();
    const recent = (await ai.listThreads()).filter((t) => Date.now() - new Date(t.updatedAt).getTime() < 24 * 3600000);
    thread = recent.find((t) => ctx && ctx.title && t.context && t.context.title === ctx.title) || recent[0] || null;
    if (thread && ctx) { thread.context = ctx; await (await import('../db.js')).put('threads', thread); }
    if (!thread) thread = await ai.createThread({ title: ctx && ctx.title ? `About: ${ctx.title}` : 'Quick question', context: ctx });
  }
  return mountThread(container, thread.id, { embedded, context: context || thread.context, initialMessage });
}

async function mountThread(container, threadId, { embedded, context = null, initialMessage = null }) {
  const thread = await ai.getThread(threadId);
  if (!thread) { mount(container, html`<div class="empty">Chat not found. <a href="#/chat">Back</a></div>`); return; }
  const ctx = context || thread.context;
  const key = await ai.hasKey();
  const level = await store.level();
  let msgs = await ai.threadMessages(threadId);
  let busy = false; let abort = null;
  mount(container, html`
    <div class="chat ${embedded ? 'embedded' : ''}">
      <div class="row between mb" style="flex-wrap:nowrap">
        ${embedded ? html`<strong class="grow wrap">${thread.title}</strong>` : html`<a class="back" href="#/chat" style="margin:0">${icon('back')} Chats</a><strong class="grow wrap center" id="title-btn" style="cursor:pointer">${thread.title}</strong>`}
        <div class="row" style="flex-wrap:nowrap;gap:4px">${embedded ? html`<a class="btn btn-sm btn-ghost" href="#/chat/${threadId}" id="open-full">Open</a>` : html`<button class="btn btn-sm btn-ghost" id="rename" aria-label="Rename">${icon('edit')}</button><button class="btn btn-sm btn-ghost" id="del" aria-label="Delete">${icon('trash')}</button>`}</div>
      </div>
      ${ctx && ctx.text ? html`<div class="xs muted mb wrap">${icon('info')} Context: ${ctx.title ? ctx.title + ' — ' : ''}${ctx.text.slice(0, 160)}${ctx.text.length > 160 ? '…' : ''}</div>` : ''}
      <div class="chat-log" id="log"></div>
      <div class="chips scroll mt">${CHIPS.map((c) => html`<button class="chip" data-chip="${c.text}">${c.label}</button>`)}</div>
      <div class="chat-input"><textarea class="textarea" id="in" rows="1" placeholder="${key ? 'Ask anything about English…' : 'Add your API key in Settings first'}" ${key ? '' : 'disabled'}></textarea><button class="btn btn-primary btn-icon" id="send" aria-label="Send" ${key ? '' : 'disabled'}>${icon('send')}</button></div>
      <div class="xs faint mt" id="cost"></div>
    </div>`);
  const log = $('#log', container); const input = $('#in', container); const sendBtn = $('#send', container);
  const drawLog = () => {
    mount(log, html`${!key ? noKeyHtml() : ''}${msgs.length ? '' : html`<div class="msg system">Ask about the word, rule or sentence you are studying. Answers come in English, then Hindi.</div>`}${msgs.map((m) => html`<div class="msg ${m.role}">${m.role === 'assistant' ? html`<div class="md">${{ toString: () => mdLite(m.content) }}</div>` : m.content}</div>`)}`);
    log.scrollTop = log.scrollHeight;
  };
  drawLog();
  const inr2 = await (await import('../db.js')).getSetting('inrRate', 84);
  const updateCost = async () => { const u = await ai.usageSummary(); $('#cost', container).textContent = `All-time: ${((u.input + u.output) / 1000).toFixed(1)}k tokens · ≈ ₹${(u.cost * inr2).toFixed(2)} ($${u.cost.toFixed(4)})`; };
  updateCost();
  const autoGrow = () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; };
  input.oninput = autoGrow;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 768px)').matches) { e.preventDefault(); send(); } });
  container.querySelectorAll('[data-chip]').forEach((b) => b.onclick = () => { const t = b.dataset.chip; if (t.endsWith(': ')) { input.value = t; input.focus(); autoGrow(); } else { input.value = t; send(); } });
  sendBtn.onclick = () => (busy ? (abort && abort.abort()) : send());
  if (embedded) $('#open-full', container).onclick = () => closeSheet();
  if (!embedded) {
    $('#rename', container).onclick = async () => { const t = await promptDialog('Chat title', { value: thread.title, okLabel: 'Rename' }); if (t) { thread.title = t.trim() || thread.title; await ai.chat && (await import('../db.js')).put('threads', thread); $('#title-btn', container).textContent = thread.title; } };
    $('#del', container).onclick = async () => { if (await confirmDialog('Delete this conversation?', { okLabel: 'Delete', danger: true })) { await ai.deleteThread(threadId); location.hash = '#/chat'; } };
  }
  async function send() {
    const text = input.value.trim(); if (!text || busy) return;
    input.value = ''; autoGrow();
    const um = await ai.addMessage(threadId, 'user', text);
    msgs.push(um); drawLog();
    busy = true; sendBtn.innerHTML = String(icon('stop'));
    const el = document.createElement('div'); el.className = 'msg assistant'; el.innerHTML = '<div class="md cursor-blink"></div>'; log.appendChild(el); log.scrollTop = log.scrollHeight;
    abort = new AbortController();
    try {
      const history = await ai.buildContext(thread, msgs);
      const memory = await ai.getMemory();
      const r = await ai.chat({ feature: 'chat', system: ai.tutorSystem(level, ctx, memory), messages: history, signal: abort.signal, onToken: (_, full) => { el.firstElementChild.innerHTML = mdLite(full); log.scrollTop = log.scrollHeight; } });
      el.firstElementChild.classList.remove('cursor-blink');
      const am = await ai.addMessage(threadId, 'assistant', r.content, { usage: r.usage });
      msgs.push(am);
      thread.count = msgs.length; thread.tokensIn = (thread.tokensIn || 0) + (r.usage.input || 0); thread.tokensOut = (thread.tokensOut || 0) + (r.usage.output || 0);
      if (thread.title === 'New chat' || thread.title === 'Quick question') thread.title = text.slice(0, 48);
      await (await import('../db.js')).put('threads', thread);
      if (!embedded) $('#title-btn', container).textContent = thread.title;
      updateCost();
      ai.maybeExtractMemory(thread, msgs).then((n) => { if (n) toast(`Remembered ${n} thing${n > 1 ? 's' : ''} about you`, '', { timeout: 2000 }); });
    } catch (e) {
      el.remove();
      if (e.name === 'AbortError') toast('Stopped', '', { timeout: 1200 });
      else if (e.message === 'NO_KEY') { toast('Add your DeepSeek key in Settings.', 'warn'); }
      else toast(e.message, 'err', { timeout: 7000 });
    }
    busy = false; abort = null; sendBtn.innerHTML = String(icon('send'));
  }
  if (!embedded && window.matchMedia('(min-width: 768px)').matches) input.focus();
  if (initialMessage && key && !msgs.length) { input.value = initialMessage; send(); }
}
