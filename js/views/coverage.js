// coverage.js — where you stand against the 5,000 most frequent lemmas.
import { html, mount, icon, toast, confirmDialog, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as lemmas from '../lemmas.js';
import * as mine from '../mine.js';
import * as ai from '../ai.js';
import { setContext } from '../router.js';

export async function render(container) {
  await lemmas.seed();
  const cov = await lemmas.coverage();
  const next = await lemmas.nextWords(20);
  const cache = await mine.cached(next.map((n) => n.lemma));
  const key = await ai.hasKey();
  const level = await store.level();
  const bandLabel = ['1–1000', '1001–2000', '2001–3000', '3001–4000', '4001–5000'];
  mount(container, html`
    <div class="page-head"><div><h1>Coverage</h1><p class="sub">${cov.knownTotal.toLocaleString()} lemmas known · ${cov.learningTotal} learning. "Improve my vocabulary" as a number that moves.</p></div></div>
    <div class="grid-3">
      ${[['general text', cov.est.general], ['news', cov.est.news], ['academic writing', cov.est.academic]].map(([l, v]) => html`<div class="stat"><div class="label">${l}</div><div class="value">${v}%</div><div class="xs muted">of words understood</div></div>`)}
    </div>
    <div class="card mt"><h3>The 5,000 most frequent words</h3>
      ${cov.bands.map((b, i) => { const k = b.known / b.total * 100, l = b.learning / b.total * 100, f = b.familiar / b.total * 100; return html`<div class="row mb" style="gap:8px"><span class="xs muted" style="width:90px;flex:none">${bandLabel[i]}</span>
        <div style="flex:1;height:14px;border-radius:7px;overflow:hidden;background:var(--bg-4);display:flex" title="known ${b.known} · learning ${b.learning} · in decks ${b.familiar} · unknown ${b.total - b.known - b.learning - b.familiar}"><span style="width:${k}%;background:var(--green)"></span><span style="width:${l}%;background:var(--amber)"></span><span style="width:${f}%;background:color-mix(in srgb,var(--accent) 45%,var(--bg-4))"></span></div>
        <span class="xs" style="width:44px;text-align:right">${Math.round(k + l * 0.5 + f * 0.5)}%</span></div>`; })}
      <div class="legend"><span><i style="background:var(--green)"></i>known</span><span><i style="background:var(--amber)"></i>learning</span><span><i style="background:color-mix(in srgb,var(--accent) 45%,var(--bg-4))"></i>in your decks, not yet mastered</span></div>
      <p class="xs muted mt mb-0">Known = mastered in reviews, marked known, or in the top ${['0', '1,000', '2,000', '3,000', '4,000'][['A1', 'A2', 'B1', 'B2', 'C1'].indexOf(level)]} for your level (${level}). Mark words known or unknown in Reader or the miner to sharpen this.</p></div>
    <div class="card"><div class="card-title"><h3>Highest-value next 20 words</h3><button class="btn btn-sm btn-primary" id="add-all">${icon('plus')} Add all to SRS</button></div>
      <p class="xs muted">Unknown words ranked by frequency. Learning these moves every number above.</p>
      <div class="chips" id="next">${next.map((n) => { const c = cache.get(n.lemma); return html`<span class="chip" title="rank ${n.rank}${c ? ' · ' + c.en_def : ''}">${n.lemma}<span class="faint"> #${n.rank}</span></span>`; })}</div>
      ${key ? html`<p class="xs muted mt mb-0">Meanings for words not yet cached are looked up when you add them (≈ ₹0.01 each).</p>` : html`<p class="xs muted mt mb-0">Without a DeepSeek key the words are added with their frequency rank and a blank meaning you can fill in.</p>`}</div>`);
  $('#add-all', container).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try {
      let entries = cache;
      if (key) { const r = await mine.enrich(next.map((n) => n.lemma), { level }); entries = r.entries; }
      let added = 0;
      for (const n of next) {
        const c = entries.get(n.lemma) || { lemma: n.lemma, word: n.lemma, ipa: '', pos: 'other', cefr: 'B1', en_def: `Frequency rank #${n.rank}`, hi_def: 'अर्थ अभी नहीं मिला', example_en: '', example_hi: '', synonyms: [], register: 'neutral' };
        const wid = await mine.toCustomWord(c, c.example_en || '', { title: 'coverage' });
        if (wid) { await store.ensureVocabCards([wid]); added++; }
        await lemmas.setState(n.lemma, lemmas.STATE.learning, 'mine');
      }
      mine.invalidateDecks();
      toast(`Added ${added} words to your reviews`, 'ok');
      render(container);
    } catch (err) { toast(err.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : err.message, 'err'); b.disabled = false; b.textContent = 'Add all to SRS'; }
  };
  setContext({ title: 'Vocabulary coverage', text: `Knows ${cov.est.general}% of general text, ${cov.est.news}% of news, ${cov.est.academic}% of academic writing. Next words: ${next.slice(0, 10).map((n) => n.lemma).join(', ')}.` });
}
