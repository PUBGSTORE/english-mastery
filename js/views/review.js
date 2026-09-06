// review.js — the SRS review engine. One card at a time, every kind, keyboard + swipe.
import { html, mount, icon, el, $, setShortcuts, bindSwipe, toast, speakButton, haptic } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as tts from '../tts.js';
import * as audio from '../audio.js';
import * as ai from '../ai.js';
import { GRADES, previewIntervals, vocabFace } from '../srs.js';
import { fuzzyMatch, sentenceMatch, charDiffHtml, fmtDuration, pick, wordDiffHtml } from '../utils.js';
import { mountExercise } from '../exercise.js';
import { setContext } from '../router.js';

let state = null;

export async function render(container, params, query) {
  const { queue, counts } = await store.reviewQueue({ deck: query.deck || undefined, kind: query.kind || undefined, interleave: query.interleave === '1' || (await store.getSetting('interleave')) === true });
  if (!queue.length) {
    mount(container, html`<div class="hero"><h1>Nothing due</h1><p>${counts.newAvailable ? `${counts.newAvailable} new cards are waiting for tomorrow's limit (change it in Settings).` : 'Add words from Daily 5 or a deck, and they will come back here on schedule.'}</p>
      <div class="btn-row"><a class="btn btn-primary" href="#/daily">Daily 5</a><a class="btn" href="#/vocab">Decks</a><a class="btn" href="#/">Home</a></div></div>`);
    return;
  }
  state = { queue, i: 0, total: queue.length, startedAt: Date.now(), cardStart: Date.now(), results: [0, 0, 0, 0], done: 0, revealed: false, suggested: null, cleanup: null };
  await showCard(container);
  return () => { tts.stop(); audio.cancel(); state = null; };
}

async function showCard(container) {
  if (!state) return;
  if (state.i >= state.queue.length) return finish(container);
  const card = state.queue[state.i];
  state.revealed = false; state.suggested = null; state.cardStart = Date.now();
  if (state.cleanup) { state.cleanup(); state.cleanup = null; }
  let face = null;
  let front, back, typed = null;
  try {
    const built = await buildCard(card);
    ({ front, back, typed, face } = built);
  } catch (e) {
    console.warn('card build failed', card, e);
    // Content missing (e.g. deck removed): skip this card
    state.i++; return showCard(container);
  }
  const done = state.done, total = state.total;
  mount(container, html`
    <div class="review-top">
      <a class="btn btn-ghost btn-sm" href="#/" aria-label="Exit review">${icon('x')}</a>
      <div class="review-progress"><div class="progress"><span style="width:${(done / total) * 100}%"></span></div></div>
      <span class="xs muted">${done}/${total}</span>
    </div>
    <div class="flashcard" id="fc">
      <span class="kind">${kindLabel(card, face)}</span>
      <span class="counter">${card.state === 'new' ? 'new' : card.state}</span>
      <div class="front">${front}</div>
      <div class="typed" ${typed ? '' : 'hidden'}></div>
      <div class="answer" id="answer" hidden>${back}</div>
      <div class="swipe-hint" id="swipe-hint" ${typed ? 'hidden' : ''}>Tap to reveal · swipe → Good · ← Again</div>
    </div>
    <div id="actions">
      ${typed ? '' : html`<button class="btn btn-primary btn-lg btn-block" id="reveal">Show answer</button>`}
    </div>
    <div class="grade-bar" id="grades" hidden>${GRADES.map((g, i) => html`<button class="btn g${i}" data-grade="${i}"><span>${g}</span><small data-iv></small></button>`)}</div>
    <div class="hint-keys">Space reveal · 1–4 grade · Enter apply suggested</div>
  `);
  const fc = $('#fc', container);
  if (typed) {
    const ctl = await typed(fc.querySelector('.typed'), (status, meta) => { onTypedResult(container, card, status, meta); });
    state.cleanup = ctl && ctl.cleanup;
  } else {
    $('#reveal', container).onclick = () => reveal(container, card);
    fc.addEventListener('click', (e) => { if (!state.revealed && !e.target.closest('button')) reveal(container, card); });
  }
  container.querySelectorAll('[data-grade]').forEach((b) => b.onclick = () => grade(container, card, +b.dataset.grade));
  const un = bindSwipe(fc, {
    onLeft: () => { if (state.revealed) grade(container, card, 0); },
    onRight: () => { if (state.revealed) grade(container, card, 2); },
  });
  const prevCleanup = state.cleanup;
  state.cleanup = () => { un(); prevCleanup && prevCleanup(); };
  setShortcuts({
    ' ': () => { if (!state.revealed && !typed) reveal(container, card); else if (state.revealed && state.suggested !== null) grade(container, card, state.suggested); },
    Enter: () => { if (state.revealed && state.suggested !== null) grade(container, card, state.suggested); },
    1: () => state.revealed && grade(container, card, 0), 2: () => state.revealed && grade(container, card, 1),
    3: () => state.revealed && grade(container, card, 2), 4: () => state.revealed && grade(container, card, 3),
    Escape: () => { location.hash = '#/'; },
  });
  setContext({ title: 'Reviewing', text: fc.querySelector('.front').textContent.trim().slice(0, 300) });
}

function reveal(container, card, suggested = null) {
  if (!state || state.revealed) return;
  state.revealed = true; state.suggested = suggested;
  $('#answer', container).hidden = false;
  $('#swipe-hint', container).hidden = true;
  const r = $('#reveal', container); if (r) r.remove();
  const g = $('#grades', container); g.hidden = false;
  const ivs = previewIntervals(card);
  g.querySelectorAll('[data-iv]').forEach((s, i) => (s.textContent = ivs[i]));
  if (suggested !== null) g.querySelector(`[data-grade="${suggested}"]`).classList.add('suggested');
  haptic();
}

function onTypedResult(container, card, status, meta = {}) {
  const suggested = status === 'exact' ? (meta.easy ? 3 : 2) : status === 'close' ? 1 : 0;
  if (status === 'wrong' && meta.original && meta.fix && card.kind === 'vocab') {
    store.logMistake({ source: 'vocab', refId: card.refId, original: meta.original, fix: meta.fix, rule: meta.rule || 'vocabulary recall', makeCard: false }).catch(() => {});
  }
  reveal(container, card, suggested);
}

async function grade(container, card, g) {
  if (!state || !state.revealed) return;
  state.revealed = false;
  const elapsedMs = Date.now() - state.cardStart;
  const face = card.kind === 'vocab' ? vocabFace(card) : card.cardType;
  const updated = await store.gradeCard(card, g, { elapsedMs, face });
  state.results[g]++;
  state.done++;
  // Re-queue learning cards inside this session
  if (updated.interval < 1) {
    const pos = Math.min(state.queue.length, state.i + 1 + (g === 0 ? 3 : 6));
    state.queue.splice(pos, 0, updated);
    state.total++;
  }
  state.i++;
  tts.stop();
  await showCard(container);
}

function finish(container) {
  const [a, h, gd, e] = state.results;
  const ms = Date.now() - state.startedAt;
  mount(container, html`<div class="hero center"><h1>Session complete</h1><p>${state.done} cards in ${fmtDuration(ms)}</p>
    <div class="grid-3 mt">
      <div class="stat"><div class="label">Again</div><div class="value" style="color:var(--red)">${a}</div></div>
      <div class="stat"><div class="label">Hard</div><div class="value" style="color:var(--amber)">${h}</div></div>
      <div class="stat"><div class="label">Good</div><div class="value" style="color:var(--green)">${gd}</div></div>
      <div class="stat"><div class="label">Easy</div><div class="value" style="color:var(--accent)">${e}</div></div>
    </div>
    <div class="btn-row center mt-lg"><a class="btn btn-primary btn-lg" href="#/">Home</a><a class="btn btn-lg" href="#/review">Check for more</a></div></div>`);
  setShortcuts({});
}

function kindLabel(card, face) {
  const map = { vocab: `word · ${face}`, collocation: 'collocation', grammar: 'grammar', mistake: 'your mistake', correction: 'correction', pair: 'minimal pair', phoneme: 'phoneme', shadow: 'shadowing', dictation: 'dictation', note: 'note', stress: 'word stress' };
  return map[card.kind] || card.kind;
}

/* ============================================================
   Card builders: return { front: Raw, back: Raw, typed?: async (el, done) => ctl, face }
   ============================================================ */
async function buildCard(card) {
  switch (card.kind) {
    case 'vocab': return buildVocab(card);
    case 'collocation': return buildCollocation(card);
    case 'grammar': return buildGrammar(card);
    case 'mistake': return buildMistake(card);
    case 'correction': return buildCorrection(card);
    case 'pair': return buildPair(card);
    case 'phoneme': return buildPhoneme(card);
    case 'shadow': return buildShadow(card);
    case 'dictation': return buildDictation(card);
    case 'note': return buildNote(card);
    case 'stress': return buildStress(card);
    case 'chunk': case 'phrase': return buildChunk(card);
    case 'root': return buildRoot(card);
    case 'confusable': return buildConfusable(card);
    default: throw new Error('unknown kind ' + card.kind);
  }
}

const exampleHtml = (ex) => ex ? html`<div class="example">“${ex.en}” ${speakButton(ex.en)}<div>${hi(ex.hi)}</div></div>` : '';

async function buildVocab(card) {
  const w = await content.wordById(card.refId);
  if (!w) throw new Error('word missing');
  const face = vocabFace(card);
  const ex = pick(w.examples || []);
  const full = html`<div class="def">${w.en_def}</div><div>${hi(w.hi_def)}</div>${exampleHtml(ex)}
    ${w.common_mistake ? html`<div class="small mt"><span class="wrong" style="color:var(--red);text-decoration:line-through">${w.common_mistake.wrong}</span> → <span style="color:var(--green)">${w.common_mistake.right}</span></div>` : ''}
    <div class="mt small"><a href="#/word/${w.id}">Full entry ${icon('next')}</a></div>`;
  const wordHead = html`<div class="word">${w.word}</div><div class="row"><span class="ipa">${w.ipa}</span><span class="pos">${w.pos}</span>${speakButton(w.word)}</div>`;
  if (face === 'meaning') return { face, front: wordHead, back: full };
  if (face === 'produce') {
    return {
      face, front: html`<div class="prompt muted small">Which English word means…</div><div class="def hi-text" lang="hi" style="font-size:var(--fs-xl)">${w.hi_def}</div><div class="small muted mt">${w.pos} · ${w.en_def}</div>`,
      back: html`${wordHead}${exampleHtml(ex)}`,
      typed: typedInput({ accepted: [w.word, ...(w.word_family || []).slice(0, 0)], placeholder: 'Type the English word', rule: 'vocabulary recall' }),
    };
  }
  if (face === 'cloze') {
    const c = w.cloze || { sentence: (ex ? ex.en.replace(new RegExp(w.word, 'i'), '____') : `____`), answer: w.word };
    const exHi = (w.examples || []).find((x) => x.en.toLowerCase().includes((c.answer || '').toLowerCase()));
    return {
      face, front: html`<div class="cloze">${{ toString: () => String(html`${c.sentence}`).replace(/_{3,}/, '<span class="blank">&nbsp;</span>') }}</div>${exHi ? html`<div class="mt">${hi(exHi.hi)}</div>` : ''}<div class="small muted mt">${w.pos} · ${w.en_def}</div>`,
      back: html`${wordHead}<div class="example">“${c.sentence.replace(/_{3,}/, c.answer)}” ${speakButton(c.sentence.replace(/_{3,}/, c.answer))}</div>`,
      typed: typedInput({ accepted: [c.answer, w.word], placeholder: 'Fill the blank', rule: 'vocabulary recall' }),
    };
  }
  if (face === 'listen') {
    return {
      face, front: html`<div class="prompt muted small">Listen and type the word</div><div class="center mt"><button class="btn btn-lg" data-speak="${w.word}" id="listen-btn">${icon('speaker')} Play</button></div>`,
      back: html`${wordHead}<div class="def">${w.en_def}</div><div>${hi(w.hi_def)}</div>`,
      typed: typedInput({ accepted: [w.word], placeholder: 'Type what you hear', rule: 'spelling', autoSpeak: w.word }),
    };
  }
  if (face === 'say') {
    // §12: say the word aloud; ASR scores it where available, otherwise record + self-compare.
    return {
      face, front: html`<div class="prompt muted small">Say it aloud</div><div class="word">${w.word}</div><div class="row"><span class="ipa">${w.ipa}</span><span class="pos">${w.pos}</span></div>`,
      back: html`<div class="def">${w.en_def}</div><div>${hi(w.hi_def)}</div>${exampleHtml(ex)}`,
      typed: async (el, done) => {
        const pron = await import('./pronunciation.js');
        const cleanup = pron.mountRecorder(el, { refId: w.id, modelText: w.word, kind: 'say', targetWps: [0.5, 3], onResult: (r) => {
          const status = r.selfRating ? (r.selfRating >= 4 ? 'exact' : r.selfRating >= 3 ? 'close' : 'wrong') : (r.accuracy >= 90 ? 'exact' : r.accuracy >= 50 ? 'close' : 'wrong');
          done(status, { easy: status === 'exact' && (r.selfRating === 5 || r.accuracy === 100) });
        } });
        return { cleanup };
      },
    };
  }
  // use it
  return {
    face, front: html`<div class="prompt muted small">Write your own sentence using</div><div class="word">${w.word}</div><div class="small muted">${w.pos} · ${w.en_def}${w.collocations && w.collocations.length ? ` · e.g. “${w.collocations[0]}”` : ''}</div>`,
    back: html`<div class="section-label">Model sentences</div>${(w.examples || []).slice(0, 2).map(exampleHtml)}`,
    typed: useItInput(w),
  };
}

function typedInput({ accepted, placeholder, rule, autoSpeak = null, sentence = false }) {
  return async (el, done) => {
    mount(el, html`<form class="row" data-form autocomplete="off"><input class="input" data-in placeholder="${placeholder}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"><button class="btn btn-primary" type="submit">Check</button></form><div class="fb"></div>`);
    const input = el.querySelector('[data-in]');
    if (window.matchMedia('(min-width: 768px)').matches) setTimeout(() => input.focus(), 50);
    if (autoSpeak) setTimeout(() => tts.speak(autoSpeak), 300);
    el.querySelector('[data-form]').onsubmit = (e) => {
      e.preventDefault();
      const typed = input.value.trim(); if (!typed) return;
      const r = sentence ? sentenceMatch(typed, accepted) : fuzzyMatch(typed, accepted);
      input.disabled = true; e.target.querySelector('button').disabled = true;
      input.classList.add(r.status === 'exact' ? 'ok' : r.status === 'close' ? 'close' : 'bad');
      mount(el.querySelector('.fb'), html`<div class="feedback ${r.status === 'exact' ? 'ok' : r.status === 'close' ? 'close' : 'bad'}">${r.status === 'exact' ? 'Correct' : r.status === 'close' ? `Close — it's “${accepted[0]}”` : `Not quite — “${accepted[0]}”`}</div>`);
      done(r.status, { original: typed, fix: accepted[0], rule });
    };
    return { cleanup: () => {} };
  };
}

function useItInput(w) {
  return async (el, done) => {
    const key = await ai.hasKey();
    mount(el, html`<textarea class="textarea" data-in rows="2" placeholder="Your sentence with “${w.word}”…" autocapitalize="sentences" style="min-height:70px"></textarea>
      <div class="btn-row mt"><button class="btn btn-primary" data-check>${key ? html`${icon('sparkle')} Check with AI` : 'Compare with models'}</button></div><div class="fb"></div>`);
    const ta = el.querySelector('[data-in]');
    el.querySelector('[data-check]').onclick = async (e) => {
      const text = ta.value.trim(); if (!text) return;
      const b = e.currentTarget; b.disabled = true; ta.disabled = true;
      if (!key) { done('exact', { easy: false }); state.suggested = null; $('#grades').querySelector('.suggested')?.classList.remove('suggested'); return; }
      b.innerHTML = '<span class="spinner"></span> Grading…';
      try {
        const lvl = await store.level();
        const r = await ai.gradeSentence(w.word, text, lvl);
        mount(el.querySelector('.fb'), html`<div class="feedback ${r.ok ? 'ok' : 'bad'}"><div class="bold">${r.ok ? 'Good sentence' : 'Needs a fix'} · ${r.score}/10</div>
          ${!r.ok || r.corrected !== text ? html`<div class="diff mt">${{ toString: () => wordDiffHtml(text, r.corrected || text) }}</div>` : ''}
          <div class="small mt">${r.why_en}</div><div class="small">${hi(r.why_hi)}</div>
          ${r.natural ? html`<div class="small mt muted">More natural: “${r.natural}”</div>` : ''}</div>`);
        if (!r.ok && r.corrected) store.logMistake({ source: 'vocab', refId: w.id, original: text, fix: r.corrected, rule: 'word usage', why_en: r.why_en, why_hi: r.why_hi }).catch(() => {});
        done(r.ok ? (r.score >= 9 ? 'exact' : 'exact') : r.score >= 5 ? 'close' : 'wrong', { easy: r.score >= 9 });
      } catch (err) {
        toast(err.message === 'NO_KEY' ? 'Add your DeepSeek key in Settings.' : err.message, 'err');
        done('exact', {}); state.suggested = null;
      }
    };
    return { cleanup: () => {} };
  };
}

async function buildCollocation(card) {
  const c = await content.collocationById(card.refId);
  if (!c) throw new Error('collocation missing');
  const ex = pick(c.examples || []);
  return {
    face: 'collocation',
    front: html`<div class="prompt muted small">Say it the natural way</div><div class="def" style="font-size:var(--fs-xl)"><span style="color:var(--red);text-decoration:line-through">${c.wrong}</span></div><div class="small muted mt">${c.en_def}</div><div>${hi(c.hi_def)}</div>`,
    back: html`<div class="word" style="font-size:var(--fs-2xl)">${c.phrase}</div><div class="small muted">${c.pattern}</div>${c.why_en ? html`<div class="small mt">${c.why_en}</div><div class="small">${hi(c.why_hi)}</div>` : ''}${exampleHtml(ex)}`,
    typed: typedInput({ accepted: [c.phrase], placeholder: 'Type the correct collocation', rule: 'collocation', sentence: true }),
  };
}

async function buildGrammar(card) {
  const item = card.payload.item;
  const lesson = card.payload.lessonId ? await content.grammarById(card.payload.lessonId) : null;
  return {
    face: 'grammar',
    front: html`<div class="prompt muted small">${lesson ? lesson.title : 'Grammar'}</div>`,
    back: html`<div class="def">${item.answer[0]}</div>${item.feedback_en ? html`<div class="small mt">${item.feedback_en}</div>` : ''}${lesson ? html`<div class="small mt"><a href="#/grammar/${lesson.id}">Open lesson ${icon('next')}</a></div>` : ''}`,
    typed: async (el, done) => {
      const r = await mountExercise(el, item);
      if (r.status === 'wrong') store.logMistake({ source: 'grammar', refId: item.id, lessonId: card.payload.lessonId, original: r.typed, fix: r.answer, rule: lesson ? lesson.title : 'grammar', why_en: item.feedback_en, why_hi: item.feedback_hi, makeCard: false }).catch(() => {});
      done(r.status, {});
      return { cleanup: () => {} };
    },
  };
}

async function buildMistake(card) {
  const p = card.payload;
  return {
    face: 'mistake',
    front: html`<div class="prompt muted small">You wrote this before. Fix it:</div><div class="def" style="color:var(--red)">${p.original}</div><div class="small muted mt">${p.rule}</div>`,
    back: html`<div class="def" style="color:var(--green)">${p.fix}</div>${p.why_en ? html`<div class="small mt">${p.why_en}</div>` : ''}${p.why_hi ? html`<div class="small">${hi(p.why_hi)}</div>` : ''}${p.lessonId ? html`<div class="small mt"><a href="#/grammar/${p.lessonId}">Review the rule ${icon('next')}</a></div>` : ''}`,
    typed: typedInput({ accepted: [p.fix], placeholder: 'Type the correct version', rule: p.rule, sentence: true }),
  };
}

async function buildCorrection(card) {
  const p = card.payload;
  return {
    face: 'correction',
    front: html`<div class="prompt muted small">Your writing — make it natural:</div><div class="def" style="color:var(--red)">${p.from}</div><div class="small muted mt">${p.rule || ''}</div>`,
    back: html`<div class="def" style="color:var(--green)">${p.to}</div>${p.why_en ? html`<div class="small mt">${p.why_en}</div>` : ''}${p.why_hi ? html`<div class="small">${hi(p.why_hi)}</div>` : ''}`,
    typed: typedInput({ accepted: [p.to], placeholder: 'Type the corrected version', rule: p.rule || 'writing', sentence: true }),
  };
}

async function buildPair(card) {
  const p = await content.pairById(card.refId);
  if (!p) throw new Error('pair missing');
  const target = Math.random() < 0.5 ? 'a' : 'b';
  const word = p[target].word;
  return {
    face: 'pair',
    front: html`<div class="prompt muted small">${p.contrast_label} — which word do you hear?</div><div class="center mt"><button class="btn btn-lg" data-speak="${word}">${icon('speaker')} Play</button></div>`,
    back: html`<div class="row"><span class="word" style="font-size:var(--fs-xl)">${word}</span> ${speakButton(word)}</div><div class="small mt">${p.tip_en}</div><div class="small">${hi(p.tip_hi)}</div><div class="small mt"><a href="#/pron/pairs/${p.contrast}">Drill this contrast ${icon('next')}</a></div>`,
    typed: async (el, done) => {
      mount(el, html`<div class="pair-choice">${['a', 'b'].map((k) => html`<button class="btn" data-k="${k}"><span>${p[k].word}</span><span class="ipa">${p[k].ipa}</span></button>`)}</div>`);
      setTimeout(() => tts.speak(word), 300);
      el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
        const ok = b.dataset.k === target;
        el.querySelectorAll('[data-k]').forEach((x) => { x.disabled = true; if (x.dataset.k === target) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        store.logAttempt({ kind: 'pair', refId: p.id, accuracy: ok ? 100 : 0, extra: { mode: 'ear' } }).catch(() => {});
        done(ok ? 'exact' : 'wrong', {});
      });
      return { cleanup: () => {} };
    },
  };
}

async function buildPhoneme(card) {
  const ph = await content.phonemeById(card.refId);
  if (!ph) throw new Error('phoneme missing');
  return {
    face: 'phoneme',
    front: html`<div class="word">/${ph.ipa}/</div><div class="muted">${ph.label}</div><div class="chips mt">${ph.examples.slice(0, 4).map((w) => html`<button class="chip" data-speak="${w}">${icon('speaker')} ${w}</button>`)}</div><p class="small muted mt">Say each word aloud, then reveal and compare.</p>`,
    back: html`<div class="small">${ph.mouth_en}</div><div class="small">${hi(ph.mouth_hi)}</div><div class="small mt" style="color:var(--amber)">${ph.hindi_trap}</div><div class="small mt"><a href="#/pron/phonemes/${ph.id}">Open phoneme lab ${icon('next')}</a></div>`,
  };
}

async function buildShadow(card) {
  const s = await content.shadowById(card.refId);
  if (!s) throw new Error('shadow missing');
  return {
    face: 'shadow',
    front: html`<div class="prompt" style="font-size:var(--fs-lg);line-height:1.6">${s.text}</div><div class="btn-row mt"><button class="btn" data-speak="${s.text}">${icon('speaker')} 1.0×</button><button class="btn" data-speak="${s.text}" data-rate="0.75">${icon('speaker')} 0.75×</button></div><p class="small muted mt">Shadow it aloud twice, then reveal.</p>`,
    back: html`<div>${hi(s.hi)}</div><div class="small mt muted">Focus: ${(s.focus || []).join(', ')}</div><div class="small mt"><a href="#/shadow/${s.id}">Full shadowing flow with recording ${icon('next')}</a></div>`,
  };
}

async function buildDictation(card) {
  const text = card.payload.text;
  return {
    face: 'dictation',
    front: html`<div class="prompt muted small">Listen and type the sentence</div><div class="btn-row mt"><button class="btn btn-lg" data-speak="${text}">${icon('speaker')} Play</button><button class="btn" data-speak="${text}" data-rate="0.75">0.75×</button></div>`,
    back: html`<div class="def">${text}</div>${card.payload.hi ? html`<div>${hi(card.payload.hi)}</div>` : ''}`,
    typed: async (el, done) => {
      mount(el, html`<form data-form class="stack"><textarea class="textarea" data-in rows="2" placeholder="Type what you hear" autocapitalize="sentences" autocorrect="off" spellcheck="false" style="min-height:64px"></textarea><button class="btn btn-primary" type="submit">Check</button></form><div class="fb"></div>`);
      setTimeout(() => tts.speak(text), 300);
      const ta = el.querySelector('[data-in]');
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('[data-form]').requestSubmit(); } });
      el.querySelector('[data-form]').onsubmit = (e) => {
        e.preventDefault(); const typed = ta.value.trim(); if (!typed) return;
        const r = sentenceMatch(typed, [text]); ta.disabled = true;
        mount(el.querySelector('.fb'), html`<div class="feedback ${r.status === 'exact' ? 'ok' : r.status === 'close' ? 'close' : 'bad'}"><div class="diff chars">${{ toString: () => charDiffHtml(text, typed) }}</div></div>`);
        done(r.status, {});
      };
      return { cleanup: () => {} };
    },
  };
}

async function buildNote(card) {
  const p = card.payload;
  return { face: 'note', front: html`<div class="prompt" style="font-size:var(--fs-lg)">${p.front}</div>`, back: html`<div class="md">${{ toString: () => p.backHtml || '' }}</div>${p.noteId ? html`<div class="small mt"><a href="#/notes/${p.noteId}">Open note ${icon('next')}</a></div>` : ''}` };
}

/** Production-first: cue (function + Hindi) → produce the chunk/phrase. */
async function buildChunk(card) {
  const p = card.payload;
  return {
    face: card.kind,
    front: html`<div class="prompt muted small">${card.kind === 'chunk' ? `Say it like a native · ${p.cue}` : `Everyday phrase · ${p.cue}`}</div><div class="def hi-text" lang="hi" style="font-size:var(--fs-xl)">${p.hi}</div>${p.clumsy ? html`<div class="small mt"><span class="muted">Not:</span> <span style="color:var(--red);text-decoration:line-through">${p.clumsy}</span></div>` : ''}`,
    back: html`<div class="word" style="font-size:var(--fs-xl)">${p.text} ${speakButton(p.text)}</div><div class="xs muted">${p.register}</div>${p.example ? html`<div class="example">“${p.example.en}” ${speakButton(p.example.en)}<div>${hi(p.example.hi)}</div></div>` : ''}`,
    typed: typedInput({ accepted: [p.text.replace(/…/g, '').trim()], placeholder: 'Type the English', rule: card.kind, sentence: true }),
  };
}
async function buildRoot(card) {
  const p = card.payload;
  return {
    face: 'root',
    front: html`<div class="prompt muted small">${p.type} · what does it mean? Name two words built on it.</div><div class="word">${p.part}</div>`,
    back: html`<div class="def">${p.meaning_en}</div><div>${hi(p.meaning_hi)}</div><div class="chips mt">${(p.derived || []).map((d) => html`<span class="chip">${d}</span>`)}</div>`,
  };
}
async function buildConfusable(card) {
  const p = card.payload;
  const q = pick(p.quiz || []);
  const opts = [p.a, p.b, ...(p.c ? [p.c] : [])];
  return {
    face: 'confusable',
    front: html`<div class="prompt muted small">${opts.join(' / ')}</div><div class="cloze">${{ toString: () => String(html`${q ? q.sentence : ''}`).replace(/_{3,}/g, '<span class="blank">&nbsp;</span>') }}</div>`,
    back: html`<div class="def">${q ? q.sentence.replace(/_{3,}/, q.answer) : ''}</div><div class="small mt">${p.rule_en}</div><div class="small">${hi(p.rule_hi)}</div>`,
    typed: async (el, done) => {
      mount(el, html`<div class="option-list">${opts.map((o) => html`<button class="btn" data-o="${o}">${o}</button>`)}</div>`);
      el.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => {
        const ok = q && b.dataset.o.toLowerCase() === q.answer.toLowerCase();
        el.querySelectorAll('[data-o]').forEach((x) => { x.disabled = true; if (q && x.dataset.o.toLowerCase() === q.answer.toLowerCase()) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        done(ok ? 'exact' : 'wrong', {});
      });
      return { cleanup: () => {} };
    },
  };
}

async function buildStress(card) {
  const p = card.payload;
  return {
    face: 'stress',
    front: html`<div class="prompt muted small">Tap the stressed syllable</div><div class="word">${p.word}</div>`,
    back: html`<div class="def">${p.syllables.map((s, i) => i === p.stressed ? s.toUpperCase() : s).join('-')} ${speakButton(p.word)}</div>${p.rule_en ? html`<div class="small mt">${p.rule_en}</div>` : ''}`,
    typed: async (el, done) => {
      mount(el, html`<div class="syllables">${p.syllables.map((s, i) => html`<button class="syl" data-i="${i}">${s}</button>`)}</div>`);
      el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => {
        const ok = +b.dataset.i === p.stressed;
        el.querySelectorAll('[data-i]').forEach((x) => { x.disabled = true; if (+x.dataset.i === p.stressed) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        done(ok ? 'exact' : 'wrong', {});
      });
      return { cleanup: () => {} };
    },
  };
}
