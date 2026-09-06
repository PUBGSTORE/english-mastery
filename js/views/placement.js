// placement.js — 30-question adaptive placement test.
import { html, mount, icon, toast, progressBar, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as db from '../db.js';
import { CEFR, shuffle } from '../utils.js';
import { setContext } from '../router.js';

const TOTAL = 30;

export async function render(container) {
  const bank = await content.placement();
  const s = await store.settings();
  mount(container, html`
    <div class="hero"><h1>Placement test</h1><p>${TOTAL} adaptive questions, about 5 minutes. It gets harder when you are right and easier when you are wrong, then sets your CEFR level. You can change the level any time in Settings.</p>
      <div class="btn-row"><button class="btn btn-primary btn-lg" id="start">Start</button>${s.placementDone ? html`<a class="btn btn-lg" href="#/">Cancel</a>` : html`<button class="btn btn-lg" id="skip">Skip for now (start at A2)</button>`}</div></div>`);
  $('#start', container).onclick = () => run(container, bank);
  const skip = $('#skip', container); if (skip) skip.onclick = async () => { await db.setSetting('placementSkipped', true); location.hash = '#/'; };
  setContext({ title: 'Placement test', text: 'Taking an English placement test.' });
}

async function run(container, bank) {
  const byLevel = {}; for (const l of CEFR) byLevel[l] = shuffle(bank.filter((q) => q.cefr === l));
  let lvl = 2; // start at B1
  let n = 0; let streakOk = 0; let streakBad = 0;
  const path = []; const answers = [];
  const next = () => {
    if (n >= TOTAL) return finish();
    // pick from current level, fall back to neighbours if exhausted
    let q = null;
    for (const d of [0, 1, -1, 2, -2]) { const L = CEFR[lvl + d]; if (L && byLevel[L].length) { q = byLevel[L].shift(); break; } }
    if (!q) return finish();
    n++;
    const opts = q.options.map((o, i) => ({ o, i }));
    mount(container, html`
      <div class="review-top"><span class="xs muted">Question ${n} of ${TOTAL}</span><div class="review-progress">${progressBar((n / TOTAL) * 100)}</div><span class="chip">${q.cefr}</span></div>
      <div class="card"><div class="placement-q">${{ toString: () => String(html`${q.prompt}`).replace(/_{3,}/g, '<span style="display:inline-block;min-width:60px;border-bottom:2px solid var(--accent)">&nbsp;</span>') }}</div>
        <div class="option-list">${opts.map(({ o, i }) => html`<button class="btn" data-i="${i}">${o}</button>`)}</div><div id="fb" class="mt"></div></div>`);
    container.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => {
      const ok = +b.dataset.i === q.answer;
      container.querySelectorAll('[data-i]').forEach((x) => { x.disabled = true; if (+x.dataset.i === q.answer) x.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
      path.push({ lvl: q.cefr, ok }); answers.push({ q, ok });
      if (ok) { streakOk++; streakBad = 0; if (streakOk >= 2 && lvl < 4) { lvl++; streakOk = 0; } }
      else { streakBad++; streakOk = 0; if (streakBad >= 2 && lvl > 0) { lvl--; streakBad = 0; } }
      mount($('#fb', container), html`<div class="feedback ${ok ? 'ok' : 'bad'}"><div class="small">${ok ? 'Correct.' : `Answer: ${q.options[q.answer]}.`} ${q.explain_en || ''}</div>${q.explain_hi ? html`<div class="small">${hi(q.explain_hi)}</div>` : ''}<div class="btn-row right mt"><button class="btn btn-primary" id="nx">Next ${icon('next')}</button></div></div>`);
      $('#nx', container).onclick = next; $('#nx', container).focus();
    });
  };
  const finish = async () => {
    // Estimated level: highest level with ≥60% correct among answered questions (min 3), else the level below
    let est = 0;
    for (let i = 0; i < CEFR.length; i++) {
      const at = answers.filter((a) => a.q.cefr === CEFR[i]);
      if (at.length >= 3 && at.filter((a) => a.ok).length / at.length >= 0.6) est = i;
    }
    // Blend with where the adaptive path settled
    const tail = path.slice(-10).map((p) => CEFR.indexOf(p.lvl));
    const settled = tail.length ? Math.round(tail.reduce((a, b) => a + b, 0) / tail.length) : est;
    const finalIdx = Math.max(0, Math.min(4, Math.round((est + settled) / 2)));
    const level = CEFR[finalIdx];
    await store.setLevel(level);
    await store.setSetting('placementDone', true);
    await db.put('tests', { id: `test:cefr:${Date.now().toString(36)}`, kind: 'cefr', ts: new Date().toISOString(), level, score: answers.filter((a) => a.ok).length, total: answers.length });
    await store.setSetting('placementResult', { level, at: new Date().toISOString(), correct: answers.filter((a) => a.ok).length, total: answers.length, byLevel: Object.fromEntries(CEFR.map((L) => [L, answers.filter((a) => a.q.cefr === L).map((a) => a.ok)])) });
    for (const a of answers) if (!a.ok) await store.logMistake({ source: 'placement', refId: a.q.id, original: a.q.options[a.q.options.findIndex((_, i) => i !== a.q.answer)] || '', fix: a.q.options[a.q.answer], rule: a.q.skill, why_en: a.q.explain_en, why_hi: a.q.explain_hi, makeCard: false });
    const correct = answers.filter((a) => a.ok).length;
    mount(container, html`<div class="hero center"><div class="muted">Your level</div><div class="big" style="font-size:96px;font-weight:800;line-height:1">${level}</div><p>${correct}/${answers.length} correct. ${describe(level)}</p>
      <div class="chips" style="justify-content:center">${CEFR.map((L) => { const at = answers.filter((a) => a.q.cefr === L); return at.length ? html`<span class="chip ${at.filter((a) => a.ok).length / at.length >= 0.6 ? 'green' : 'amber'}">${L}: ${at.filter((a) => a.ok).length}/${at.length}</span>` : ''; })}</div>
      <div class="btn-row center mt-lg"><a class="btn btn-primary btn-lg" href="#/daily">Start Daily 5</a><a class="btn btn-lg" href="#/grammar">Grammar path</a></div></div>`);
    toast(`Level set to ${level}. Lessons up to ${CEFR[Math.min(4, finalIdx + 1)]} are unlocked.`, 'ok', { timeout: 6000 });
  };
  next();
}

function describe(l) {
  return {
    A1: 'You can handle basics. The fastest wins now: articles, present simple, word order, and the v/w sound.',
    A2: 'Solid everyday English. Focus on tenses (present perfect vs past), countable nouns, and stress-timing.',
    B1: 'You communicate well. Your gains come from precision: conditionals, embedded questions, collocations, weak forms.',
    B2: 'Strong. Work on nuance and naturalness: phrasal verbs, register, hedging, and connected speech.',
    C1: 'Advanced. Polish: cohesion, inversion, formal register in reports, and the last 10% of your accent.',
  }[l];
}
