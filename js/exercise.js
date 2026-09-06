// exercise.js — renders one practice item (fill / choose / fix / reorder / tf) and reports the result.
// Used by grammar lessons, the review engine (grammar cards) and mistakes re-tests.
import { html, render, icon, el, $ } from './ui.js';
import { hi } from './i18n.js';
import { fuzzyMatch, sentenceMatch, shuffle, normalize, escapeHtml } from './utils.js';

/**
 * Mount an exercise. Resolves { status: 'exact'|'close'|'wrong', typed, answer } when the user answers.
 * opts.autoFocus, opts.showHindiHint
 */
export function mountExercise(container, item, { autoFocus = true } = {}) {
  return new Promise((resolve) => {
    const answers = Array.isArray(item.answer) ? item.answer : [item.answer];
    const done = (status, typed) => {
      showFeedback(container, item, status, typed, answers[0]);
      resolve({ status, typed, answer: answers[0] });
    };
    if (item.type === 'choose' || item.type === 'tf') {
      const options = item.type === 'tf' ? ['True', 'False'] : item.options;
      render(container, html`
        <div class="prompt-text" style="font-size:var(--fs-lg);margin-bottom:12px">${promptHtml(item.prompt)}</div>
        ${item.hi ? html`<div class="mb">${hi(item.hi)}</div>` : ''}
        <div class="option-list">${options.map((o) => html`<button type="button" class="btn" data-opt="${o}">${o}</button>`)}</div>
        <div class="fb"></div>`);
      container.querySelectorAll('[data-opt]').forEach((b) => b.onclick = () => {
        const v = b.dataset.opt;
        const ok = answers.some((a) => normalize(a) === normalize(v));
        container.querySelectorAll('[data-opt]').forEach((x) => { x.disabled = true; if (answers.some((a) => normalize(a) === normalize(x.dataset.opt))) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        done(ok ? 'exact' : 'wrong', v);
      });
      return;
    }
    if (item.type === 'reorder') {
      const words = item.words && item.words.length ? item.words : shuffle(answers[0].replace(/[.?!]$/, '').split(' '));
      let bank = words.slice(); let chosen = [];
      const draw = () => {
        render(container, html`
          <div class="prompt-text" style="font-size:var(--fs-md);margin-bottom:8px">${item.prompt || 'Put the words in the correct order.'}</div>
          ${item.hi ? html`<div class="mb">${hi(item.hi)}</div>` : ''}
          <div class="tile-bank mb" data-zone="chosen" aria-label="Your sentence">${chosen.map((w, i) => html`<button type="button" class="tile" data-c="${i}">${w}</button>`)}</div>
          <div class="tile-bank mb" data-zone="bank" aria-label="Word bank">${bank.map((w, i) => html`<button type="button" class="tile" data-b="${i}">${w}</button>`)}</div>
          <div class="btn-row"><button type="button" class="btn btn-primary" data-check ${bank.length ? 'disabled' : ''}>Check</button><button type="button" class="btn btn-ghost" data-reset>Reset</button></div>
          <div class="fb"></div>`);
        container.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { chosen.push(bank.splice(+b.dataset.b, 1)[0]); draw(); });
        container.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { bank.push(chosen.splice(+b.dataset.c, 1)[0]); draw(); });
        container.querySelector('[data-reset]').onclick = () => { bank = words.slice(); chosen = []; draw(); };
        container.querySelector('[data-check]').onclick = () => {
          const typed = chosen.join(' ');
          const r = sentenceMatch(typed, answers);
          container.querySelectorAll('.tile').forEach((t) => (t.disabled = true));
          done(r.status === 'wrong' ? 'wrong' : 'exact', typed);
        };
      };
      draw();
      return;
    }
    // fill / fix (typed)
    const isFix = item.type === 'fix';
    render(container, html`
      <div class="prompt-text" style="font-size:var(--fs-lg);margin-bottom:8px">${isFix ? html`<span class="muted small">Fix this sentence:</span><br><span class="wrong-sentence">${item.prompt}</span>` : promptHtml(item.prompt)}</div>
      ${item.hi ? html`<div class="mb">${hi(item.hi)}</div>` : ''}
      <form class="row" data-form autocomplete="off">
        ${isFix ? html`<textarea class="textarea" data-in rows="2" placeholder="Type the corrected sentence" autocapitalize="sentences" autocorrect="off" spellcheck="false" style="min-height:64px"></textarea>`
                : html`<input class="input" data-in placeholder="Type the missing word(s)" autocapitalize="off" autocorrect="off" spellcheck="false">`}
        <button type="submit" class="btn btn-primary">Check</button>
      </form>
      <div class="fb"></div>`);
    const input = container.querySelector('[data-in]');
    if (autoFocus && window.matchMedia('(min-width: 768px)').matches) setTimeout(() => input.focus(), 30);
    if (isFix) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); container.querySelector('[data-form]').requestSubmit(); } });
    container.querySelector('[data-form]').onsubmit = (e) => {
      e.preventDefault();
      const typed = input.value.trim();
      if (!typed) return;
      const r = isFix ? sentenceMatch(typed, answers) : fuzzyMatch(typed, answers);
      input.disabled = true; container.querySelector('[type="submit"]').disabled = true;
      input.classList.add(r.status === 'exact' ? 'ok' : r.status === 'close' ? 'close' : 'bad');
      done(r.status, typed);
    };
  });
}

function promptHtml(p) {
  const e = escapeHtml(p || '');
  return html`${{ toString: () => e.replace(/_{3,}/g, '<span class="blank" style="display:inline-block;min-width:70px;border-bottom:2px solid var(--accent)">&nbsp;</span>') }}`;
}

export function showFeedback(container, item, status, typed, answer) {
  const fb = container.querySelector('.fb');
  if (!fb) return;
  const cls = status === 'exact' ? 'ok' : status === 'close' ? 'close' : 'bad';
  const head = status === 'exact' ? 'Correct' : status === 'close' ? `Almost — the exact answer is “${answer}”` : `Not quite. Answer: “${answer}”`;
  render(fb, html`<div class="feedback ${cls}"><div class="bold">${status === 'exact' ? icon('check') : status === 'close' ? icon('info') : icon('x')} ${head}</div>
    ${item.feedback_en ? html`<div class="small mt">${item.feedback_en}</div>` : ''}
    ${item.feedback_hi ? html`<div class="small">${hi(item.feedback_hi)}</div>` : ''}</div>`);
}
