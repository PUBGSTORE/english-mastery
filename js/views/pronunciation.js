// pronunciation.js — the flagship module: phoneme lab, minimal pairs, ASR scoring, stress, rhythm, connected speech, intonation, twisters.
import { html, mount, icon, toast, speakButton, backLink, progressBar, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as tts from '../tts.js';
import * as asr from '../asr.js';
import * as audio from '../audio.js';
import { intonation as intonationChart } from '../charts.js';
import { setContext } from '../router.js';
import { shuffle, pick, avg, fmtDate } from '../utils.js';

export async function render(container, params) {
  const sec = params.section;
  if (!sec) return renderHub(container);
  if (sec === 'phonemes') return params.id ? renderPhoneme(container, params.id) : renderPhonemeList(container);
  if (sec === 'pairs') return params.id ? renderPairDrill(container, params.id) : renderPairList(container);
  if (sec === 'stress') return renderWordStress(container);
  if (sec === 'rhythm') return renderRhythm(container);
  if (sec === 'connected') return renderConnected(container);
  if (sec === 'intonation') return renderIntonation(container);
  if (sec === 'twisters') return renderTwisters(container);
  if (sec === 'sentence') return renderSentenceScoring(container);
  return renderHub(container);
}

const SECTIONS = [
  { href: '#/pron/pairs/v-w', icon: 'ear', title: 'v / w · th · the big contrasts', sub: 'Minimal pairs: hear it, then say it' },
  { href: '#/pron/rhythm', icon: 'wave', title: 'Sentence stress & weak forms', sub: 'The real accent fix: stress-timing and schwa' },
  { href: '#/pron/stress', icon: 'zap', title: 'Word stress trainer', sub: 'PHO-to-graph / pho-TO-gra-pher' },
  { href: '#/pron/connected', icon: 'trending', title: 'Connected speech', sub: 'Linking, elision, assimilation, contractions' },
  { href: '#/pron/intonation', icon: 'chart', title: 'Intonation', sub: 'Rising, falling, lists, question tags' },
  { href: '#/pron/phonemes', icon: 'grid', title: 'Phoneme lab', sub: 'All 44 sounds, mouth positions, record & compare' },
  { href: '#/pron/sentence', icon: 'mic', title: 'Sentence scoring', sub: 'Say a sentence, get word-by-word feedback' },
  { href: '#/pron/twisters', icon: 'shuffle', title: 'Tongue twisters', sub: 'The gauntlet for hard clusters' },
];

async function renderHub(container) {
  const attempts = await store.allAttempts();
  const pron = attempts.filter((a) => ['pair', 'sentence', 'shadow', 'twister', 'phoneme'].includes(a.kind) && typeof a.accuracy === 'number');
  const recent = pron.slice(-20);
  const acc = recent.length ? Math.round(avg(recent.map((a) => a.accuracy))) : null;
  mount(container, html`
    <div class="page-head"><div><h1>Pronunciation</h1><p class="sub">Sounds are 30% of an accent. Rhythm and stress are the other 70%.</p></div></div>
    ${acc !== null ? html`<div class="card compact row between"><span>Recent accuracy across ${recent.length} attempts</span><strong style="font-size:var(--fs-xl)">${acc}%</strong></div>` : ''}
    ${!asr.supported() ? html`<div class="card amber compact small">${icon('info')} Speech recognition is not available in this browser${asr.isAppleMobile() ? ' (iOS Safari)' : ''}. Scoring drills fall back to record-and-compare, which is still the most honest feedback you can get: your ear improves faster than any algorithm.</div>` : ''}
    <div class="list">${SECTIONS.map((s) => html`<a class="list-item" href="${s.href}">${icon(s.icon)}<div class="grow"><div class="title">${s.title}</div><div class="sub">${s.sub}</div></div>${icon('next', 'arrow')}</a>`)}</div>`);
  setContext({ title: 'Pronunciation', text: 'Pronunciation practice for a Hindi speaker: v/w, th, stress-timing, weak forms, intonation.' });
}

/* ---------------- shared recording widget ---------------- */
/**
 * Mounts a record/compare widget. opts: { refId, modelText, onScore(result) , targetWps, kind }
 * If ASR supported: recognises and scores. Always records for A/B.
 */
export function mountRecorder(el, { refId, modelText, targetWps = [2, 3], kind = 'sentence', onResult } = {}) {
  let rec = null; let listening = false; let asrPromise = null; let t0 = 0;
  const canAsr = asr.supported();
  const draw = async () => {
    const saved = await audio.getRecording(refId);
    mount(el, html`
      <div class="row" style="justify-content:center;gap:16px">
        <button class="rec-btn" id="rec" aria-label="Record">${icon('mic')}</button>
        <div class="stack" style="flex:1;max-width:240px"><div class="meter"><span id="meter"></span></div><div class="xs muted center" id="rec-status">${canAsr ? 'Tap, say it, tap again' : 'Tap to record, tap again to stop'}</div></div>
      </div>
      <div class="btn-row center mt">
        <button class="btn btn-sm" data-speak="${modelText}">${icon('speaker')} Model</button>
        <button class="btn btn-sm" id="play-mine" ${saved ? '' : 'disabled'}>${icon('play')} Mine</button>
        <button class="btn btn-sm" id="ab" ${saved ? '' : 'disabled'}>${icon('refresh')} A/B</button>
      </div>
      <div id="rec-result" class="mt"></div>`);
    const btn = $('#rec', el); const status = $('#rec-status', el); const meter = $('#meter', el);
    btn.onclick = async () => {
      if (!listening) {
        tts.stop();
        const ok = await audio.start({ onLevel: (v) => { meter.style.width = `${Math.round(v * 100)}%`; } });
        if (!ok && !canAsr) return;
        listening = true; btn.classList.add('recording'); btn.innerHTML = String(icon('stop'));
        status.textContent = 'Listening… say it now'; t0 = performance.now();
        if (canAsr) asrPromise = asr.recognise({ timeoutMs: 20000, onInterim: (t) => { status.textContent = t || 'Listening…'; } }).catch((e) => ({ transcript: '', alternatives: [], error: e.message }));
      } else {
        listening = false; btn.classList.remove('recording'); btn.innerHTML = String(icon('mic'));
        status.textContent = 'Processing…';
        const seconds = (performance.now() - t0) / 1000;
        const r = await audio.stop();
        asr.stop();
        if (r && r.blob && r.blob.size > 0) { await audio.saveRecording(refId, r.blob, r.mime, r.seconds); rec = r.blob; }
        let result = null;
        if (canAsr && asrPromise) {
          const a = await asrPromise;
          if (a.error && a.error !== 'no-speech' && a.error !== 'aborted') toast(a.error === 'not-allowed' ? 'Microphone blocked for speech recognition.' : `Recognition error: ${a.error}`, 'warn');
          result = asr.score(modelText, a, seconds, targetWps);
          mount($('#rec-result', el), html`<div class="card compact">${{ toString: () => asr.tilesHtml(result.words, result.extra) }}
            <div class="grid-3 mt"><div class="stat"><div class="label">Accuracy</div><div class="value">${result.accuracy}%</div></div><div class="stat"><div class="label">Fluency</div><div class="value">${result.fluency}%<small> ${result.wps} w/s</small></div></div><div class="stat"><div class="label">Complete</div><div class="value">${result.completeness}%</div></div></div>
            ${result.transcript ? html`<div class="xs muted mt">Heard: “${result.transcript}”</div>` : html`<div class="xs muted mt">Nothing recognised. Speak louder, closer to the mic.</div>`}</div>`);
          await store.logAttempt({ kind, refId, accuracy: result.accuracy, fluency: result.fluency, completeness: result.completeness, transcript: result.transcript, extra: { seconds } });
          for (const w of result.words) if (w.status === 'red' && w.heard) store.logMistake({ source: 'pronunciation', refId, original: w.heard, fix: w.word, rule: 'pronunciation', makeCard: false }).catch(() => {});
        } else {
          mount($('#rec-result', el), html`<div class="card compact"><p class="small mb">Recorded ${seconds.toFixed(1)}s. Play the model, then yours. Rate how close you were:</p>
            <div class="btn-row stretch">${[1, 2, 3, 4, 5].map((n) => html`<button class="btn" data-rate="${n}">${n}</button>`)}</div><div class="xs muted center mt">1 = very different · 5 = nearly identical</div></div>`);
          el.querySelectorAll('[data-rate]').forEach((b) => b.onclick = async () => {
            el.querySelectorAll('[data-rate]').forEach((x) => { x.disabled = true; x.classList.toggle('btn-primary', x === b); });
            const n = +b.dataset.rate;
            await store.logAttempt({ kind, refId, selfRating: n, accuracy: n * 20, extra: { seconds, selfRated: true } });
            onResult && onResult({ selfRating: n, accuracy: n * 20 });
          });
        }
        $('#play-mine', el).disabled = !rec && !(await audio.getRecording(refId)); $('#ab', el).disabled = $('#play-mine', el).disabled;
        status.textContent = canAsr ? 'Tap to try again' : 'Recorded. Compare with the model.';
        if (result) onResult && onResult(result);
      }
    };
    $('#play-mine', el).onclick = async () => { const r = rec ? { blob: rec } : await audio.getRecording(refId); if (r) audio.play(r.blob); };
    $('#ab', el).onclick = async () => { const r = rec ? { blob: rec } : await audio.getRecording(refId); await tts.speak(modelText); if (r) await audio.play(r.blob); };
  };
  draw();
  return () => { if (listening) { audio.cancel(); asr.stop(); } };
}

/* ---------------- phoneme lab ---------------- */
async function renderPhonemeList(container) {
  const list = await content.phonemes();
  const groups = { consonant: [], vowel: [], diphthong: [] };
  for (const p of list) (groups[p.type] || groups.consonant).push(p);
  mount(container, html`
    ${backLink('#/pron', 'Pronunciation')}
    <div class="page-head"><div><h1>Phoneme lab</h1><p class="sub">44 sounds. Tap any to hear it, see the mouth position, and record yourself.</p></div></div>
    ${Object.entries(groups).map(([type, ps]) => html`<h3 class="mt-lg">${type}s</h3><div class="grid-3">${ps.map((p) => html`<a class="card compact center" href="#/pron/phonemes/${p.id}" style="margin:0"><div style="font-size:var(--fs-2xl);font-weight:800">/${p.ipa}/</div><div class="xs muted">${p.examples[0]}</div></a>`)}</div>`)}`);
}

async function renderPhoneme(container, id) {
  const list = await content.phonemes();
  const p = list.find((x) => x.id === id);
  if (!p) { mount(container, html`${backLink('#/pron/phonemes')}<div class="empty">Not found</div>`); return; }
  const idx = list.indexOf(p);
  const contrasts = (p.contrast_with || []).map((cid) => list.find((x) => x.id === cid)).filter(Boolean);
  const pairs = (await content.minimalPairs()).filter((mp) => mp.phonemes.includes(p.id));
  const card = await store.getCard(`card:${p.id}`);
  mount(container, html`
    ${backLink('#/pron/phonemes', 'Phoneme lab')}
    <div class="card center"><div style="font-size:64px;font-weight:800;line-height:1">/${p.ipa}/</div><div class="muted">${p.label} · ${p.type}${p.voiced === true ? ' · voiced' : p.voiced === false ? ' · voiceless' : ''}</div>
      <div class="chips mt" style="justify-content:center">${p.examples.map((w, i) => html`<button class="chip" data-speak="${w}">${icon('speaker')} ${w}${p.example_ipa && p.example_ipa[i] ? html` <span class="ipa">${p.example_ipa[i]}</span>` : ''}</button>`)}</div></div>
    <div class="card"><h3>Mouth position</h3><p>${p.mouth_en}</p>${hiBlock(p.mouth_hi)}
      <div class="feedback close mt"><strong>Hindi trap${p.hindi_letter ? ` (${p.hindi_letter})` : ''}:</strong> ${p.hindi_trap}</div></div>
    <div class="card"><h3>Record and compare</h3><p class="small muted">Say: <strong>${p.examples.slice(0, 3).join(', ')}</strong></p><div id="recorder"></div></div>
    ${contrasts.length ? html`<div class="card"><h3>Contrast with</h3><div class="chips">${contrasts.map((c) => html`<a class="chip" href="#/pron/phonemes/${c.id}">/${c.ipa}/ ${c.examples[0]}</a>`)}</div>${pairs.length ? html`<div class="mt"><a class="btn" href="#/pron/pairs/${pairs[0].contrast}">${icon('ear')} Drill ${pairs[0].contrast_label} (${pairs.length} pairs)</a></div>` : ''}</div>` : ''}
    <div class="btn-row between">${idx > 0 ? html`<a class="btn" href="#/pron/phonemes/${list[idx - 1].id}">${icon('back')} /${list[idx - 1].ipa}/</a>` : html`<span></span>`}
      ${card ? html`<span class="chip green">${icon('check')} in reviews</span>` : html`<button class="btn" id="add-card">${icon('plus')} Add to reviews</button>`}
      ${idx < list.length - 1 ? html`<a class="btn" href="#/pron/phonemes/${list[idx + 1].id}">/${list[idx + 1].ipa}/ ${icon('next')}</a>` : html`<span></span>`}</div>`);
  const cleanup = mountRecorder($('#recorder', container), { refId: p.id, modelText: p.examples.slice(0, 3).join('. '), kind: 'phoneme' });
  const add = $('#add-card', container); if (add) add.onclick = async () => { await store.ensureCard({ id: `card:${p.id}`, refId: p.id, deck: 'phonemes', kind: 'phoneme' }); toast('Added', 'ok'); renderPhoneme(container, id); };
  setContext({ title: `Phoneme /${p.ipa}/`, text: `${p.label}. ${p.mouth_en} Hindi trap: ${p.hindi_trap}` });
  return cleanup;
}

/* ---------------- minimal pairs ---------------- */
async function renderPairList(container) {
  const pairs = await content.minimalPairs();
  const groups = [];
  for (const p of pairs) { let g = groups.find((x) => x.contrast === p.contrast); if (!g) { g = { contrast: p.contrast, label: p.contrast_label, items: [] }; groups.push(g); } g.items.push(p); }
  const attempts = await store.attemptsByKind('pair');
  mount(container, html`
    ${backLink('#/pron', 'Pronunciation')}
    <div class="page-head"><div><h1>Minimal pairs</h1><p class="sub">${pairs.length} pairs in ${groups.length} contrasts, ordered by what Hindi speakers collapse most.</p></div></div>
    <div class="list">${groups.map((g) => { const ids = new Set(g.items.map((i) => i.id)); const at = attempts.filter((a) => ids.has(a.refId)); const acc = at.length ? Math.round(avg(at.slice(-20).map((a) => a.accuracy))) : null;
      return html`<a class="list-item" href="#/pron/pairs/${g.contrast}"><div class="grow"><div class="title">${g.label}</div><div class="sub">${g.items.slice(0, 4).map((i) => `${i.a.word}–${i.b.word}`).join(' · ')} · ${g.items.length} pairs</div></div>${acc !== null ? html`<span class="chip ${acc >= 80 ? 'green' : acc >= 60 ? 'amber' : 'red'}">${acc}%</span>` : ''}${icon('next', 'arrow')}</a>`; })}</div>`);
}

async function renderPairDrill(container, contrast) {
  const all = await content.minimalPairs();
  const items = all.filter((p) => p.contrast === contrast);
  if (!items.length) { mount(container, html`${backLink('#/pron/pairs')}<div class="empty">No pairs for ${contrast}</div>`); return; }
  const phon = await content.phonemes();
  const phs = items[0].phonemes.map((id) => phon.find((p) => p.id === id)).filter(Boolean);
  let order = shuffle(items); let i = 0; let earScore = 0; let earTotal = 0; let cleanupRec = null;
  const drawIntro = () => {
    mount(container, html`
      ${backLink('#/pron/pairs', 'Minimal pairs')}
      <div class="page-head"><div><h1>${items[0].contrast_label}</h1><p class="sub">${items.length} pairs · ear training, then production</p></div></div>
      ${phs.length ? html`<div class="grid-2">${phs.map((p) => html`<div class="card compact"><div class="row between"><strong style="font-size:var(--fs-xl)">/${p.ipa}/</strong><a class="xs" href="#/pron/phonemes/${p.id}">lab ${icon('next')}</a></div><div class="small">${p.mouth_en}</div><div class="small">${hi(p.mouth_hi)}</div></div>`)}</div>` : ''}
      <div class="card"><h3>All pairs</h3><div class="grid-3">${items.map((p) => html`<div class="row" style="gap:4px"><button class="chip" data-speak="${p.a.word}">${p.a.word}</button><span class="faint">/</span><button class="chip" data-speak="${p.b.word}">${p.b.word}</button></div>`)}</div></div>
      <div class="btn-row"><button class="btn btn-primary btn-lg" id="start">${icon('ear')} Start drill</button></div>`);
    $('#start', container).onclick = () => { i = 0; earScore = 0; earTotal = 0; order = shuffle(items); drawEar(); };
  };
  const drawEar = () => {
    if (cleanupRec) { cleanupRec(); cleanupRec = null; }
    if (i >= order.length) return drawSummary();
    const p = order[i];
    const homophone = p.homophone;
    const target = homophone ? 'a' : (Math.random() < 0.5 ? 'a' : 'b');
    const word = p[target].word;
    const sentence = target === 'a' ? p.sentence_a : p.sentence_b;
    mount(container, html`
      <div class="review-top"><a class="btn btn-ghost btn-sm" href="#/pron/pairs/${contrast}" id="exit">${icon('x')}</a><div class="review-progress">${progressBar((i / order.length) * 100)}</div><span class="xs muted">${i + 1}/${order.length}</span></div>
      ${homophone ? html`<div class="card"><h3>Silent letter</h3><p><strong>${p.a.word}</strong> and <strong>${p.b.word}</strong> sound the same: ${p.a.ipa}. ${p.tip_en}</p><div>${hi(p.tip_hi)}</div><div class="btn-row mt"><button class="btn" data-speak="${p.a.word}">${icon('speaker')} Hear it</button></div></div>`
        : html`<div class="card"><h3>1 · Ear: which word did you hear?</h3><div class="btn-row center mb"><button class="btn btn-lg" data-speak="${word}" id="play">${icon('speaker')} Play</button><button class="btn" data-speak="${sentence}">In a sentence</button></div>
        <div class="pair-choice">${['a', 'b'].map((k) => html`<button class="btn" data-k="${k}"><span>${p[k].word}</span><span class="ipa">${p[k].ipa}</span></button>`)}</div><div id="ear-fb" class="mt"></div></div>`}
      <div class="card" id="prod" ${homophone ? '' : 'hidden'}><h3>2 · Produce: say both words</h3><p class="small muted">Say “<strong>${p.a.word}</strong>, <strong>${p.b.word}</strong>”. ${p.tip_en}</p><div>${hi(p.tip_hi)}</div><div id="recorder" class="mt"></div></div>
      <div class="btn-row right"><button class="btn btn-primary" id="next" ${homophone ? '' : 'hidden'}>Next ${icon('next')}</button></div>`);
    if (!homophone) {
      setTimeout(() => tts.speak(word), 250);
      container.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
        const ok = b.dataset.k === target; earTotal++; if (ok) earScore++;
        container.querySelectorAll('[data-k]').forEach((x) => { x.disabled = true; if (x.dataset.k === target) x.classList.add('right'); });
        if (!ok) b.classList.add('wrong');
        mount($('#ear-fb', container), html`<div class="feedback ${ok ? 'ok' : 'bad'}">${ok ? 'Correct' : `It was “${word}”`} — ${p.tip_en}<div>${hi(p.tip_hi)}</div></div>`);
        await store.logAttempt({ kind: 'pair', refId: p.id, accuracy: ok ? 100 : 0, extra: { mode: 'ear', heard: word } });
        if (!ok) store.logMistake({ source: 'pronunciation', refId: p.id, original: p[b.dataset.k].word, fix: word, rule: `hearing ${p.contrast_label}`, makeCard: false }).catch(() => {});
        $('#prod', container).hidden = false; $('#next', container).hidden = false;
        cleanupRec = mountRecorder($('#recorder', container), { refId: p.id, modelText: `${p.a.word}, ${p.b.word}`, kind: 'pair', targetWps: [0.8, 2.5] });
      });
    } else {
      cleanupRec = mountRecorder($('#recorder', container), { refId: p.id, modelText: `${p.a.word}`, kind: 'pair', targetWps: [0.8, 2.5] });
    }
    $('#next', container).onclick = () => { i++; drawEar(); };
    setContext({ title: `Minimal pair ${p.contrast_label}`, text: `${p.a.word} ${p.a.ipa} vs ${p.b.word} ${p.b.ipa}. ${p.tip_en}` });
  };
  const drawSummary = async () => {
    const pctEar = earTotal ? Math.round((earScore / earTotal) * 100) : 0;
    const existing = await store.getCard(`card:${items[0].id}`);
    mount(container, html`<div class="hero center"><h1>${pctEar}% ear accuracy</h1><p>${earScore}/${earTotal} heard correctly for ${items[0].contrast_label}. ${pctEar >= 90 ? 'Your ear is there. Now it is all production.' : pctEar >= 70 ? 'Good. Drill again tomorrow; the contrast is settling.' : 'Keep at it. Listen to the phoneme lab notes on mouth position and try again.'}</p>
      <div class="btn-row center"><button class="btn btn-primary" id="again">Drill again</button>${existing ? '' : html`<button class="btn" id="add-srs">Add ${Math.min(6, items.length)} pairs to reviews</button>`}<a class="btn" href="#/pron/pairs">All contrasts</a></div></div>`);
    $('#again', container).onclick = () => { i = 0; earScore = 0; earTotal = 0; order = shuffle(items); drawEar(); };
    const add = $('#add-srs', container); if (add) add.onclick = async () => { for (const p of shuffle(items).slice(0, 6)) await store.ensureCard({ id: `card:${p.id}`, refId: p.id, deck: 'pairs', kind: 'pair' }); toast('Added to reviews', 'ok'); add.remove(); };
  };
  drawIntro();
  return () => { if (cleanupRec) cleanupRec(); };
}

/* ---------------- word stress ---------------- */
async function renderWordStress(container) {
  const data = await content.stress();
  let items = shuffle(data.word_stress); let i = 0; let score = 0; let total = 0;
  const cleanWord = (w) => w.replace(/\s*\(.*\)$/, '');
  const draw = () => {
    if (i >= items.length) { i = 0; items = shuffle(data.word_stress); }
    const w = items[i];
    mount(container, html`
      ${backLink('#/pron', 'Pronunciation')}
      <div class="page-head"><div><h1>Word stress</h1><p class="sub">Tap the syllable that carries the stress. ${total ? `${score}/${total} today` : ''}</p></div></div>
      <div class="card center"><div class="muted small">${w.word.includes('(') ? w.word.match(/\((.*)\)/)[1] : (w.cefr || '')}</div><div style="font-size:var(--fs-3xl);font-weight:800">${cleanWord(w.word)}</div><div class="ipa">${w.ipa}</div>
        <div class="syllables mt">${w.syllables.map((s, k) => html`<button class="syl" data-i="${k}">${s}</button>`)}</div>
        <div id="fb" class="mt"></div></div>
      <div class="btn-row between"><button class="btn" data-speak="${cleanWord(w.word)}">${icon('speaker')} Hear it</button><button class="btn btn-primary" id="next" hidden>Next ${icon('next')}</button></div>`);
    container.querySelectorAll('[data-i]').forEach((b) => b.onclick = async () => {
      const ok = +b.dataset.i === w.stressed; total++; if (ok) score++;
      container.querySelectorAll('[data-i]').forEach((x) => { x.disabled = true; if (+x.dataset.i === w.stressed) x.classList.add('right', 'stressed'); });
      if (!ok) b.classList.add('wrong');
      mount($('#fb', container), html`<div class="feedback ${ok ? 'ok' : 'bad'}"><div class="bold">${w.syllables.map((s, k) => k === w.stressed ? s.toUpperCase() : s).join('-')}</div>${w.rule_en ? html`<div class="small mt">${w.rule_en}</div><div class="small">${hi(w.rule_hi)}</div>` : ''}${w.hindi_trap ? html`<div class="small mt" style="color:var(--amber)">${w.hindi_trap}</div>` : ''}${w.family && w.family.length ? html`<div class="chips mt">${w.family.map((f) => { const [fw] = f.split(':'); return html`<button class="chip" data-speak="${fw}">${icon('speaker')} ${fw}</button>`; })}</div>` : ''}</div>`);
      tts.speak(cleanWord(w.word));
      await store.logAttempt({ kind: 'stress', refId: w.id, accuracy: ok ? 100 : 0 });
      if (!ok) { await store.ensureCard({ id: `card:${w.id}`, refId: w.id, deck: 'stress', kind: 'stress', payload: { word: cleanWord(w.word), syllables: w.syllables, stressed: w.stressed, rule_en: w.rule_en }, priority: 1 }); }
      $('#next', container).hidden = false; $('#next', container).focus();
    });
    $('#next', container).onclick = () => { i++; draw(); };
    setContext({ title: 'Word stress', text: `Word stress of "${cleanWord(w.word)}": ${w.syllables.join('-')}, stressed syllable ${w.stressed + 1}. Rule: ${w.rule_en}` });
  };
  draw();
}

/* ---------------- sentence stress & weak forms ---------------- */
async function renderRhythm(container) {
  const data = await content.stress();
  let tab = 'stress';
  const draw = () => {
    mount(container, html`
      ${backLink('#/pron', 'Pronunciation')}
      <div class="page-head"><div><h1>Rhythm & weak forms</h1><p class="sub">Hindi gives every syllable equal time. English squeezes function words and stretches content words.</p></div></div>
      <div class="tabs"><button class="${tab === 'stress' ? 'active' : ''}" data-t="stress">Sentence stress</button><button class="${tab === 'reduce' ? 'active' : ''}" data-t="reduce">Reduce it</button></div>
      <div id="pane"></div>`);
    container.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
    if (tab === 'stress') drawStress(); else drawReduce();
  };
  const drawStress = () => {
    let items = shuffle(data.sentence_stress); let i = 0;
    const one = () => {
      const s = items[i % items.length];
      const words = s.sentence.split(' ');
      const content_ = new Set(s.content);
      const weak = s.weak || {};
      mount($('#pane', container), html`
        <div class="card"><p class="small muted">Tap the words you would stress (content words). Then compare.</p>
          <div class="stress-sentence" id="ss">${words.map((w, k) => html`<button class="w chip" data-k="${k}" style="min-height:40px;font-size:1em">${w}</button>`)}</div>
          <div class="btn-row mt"><button class="btn btn-primary" id="check">Check</button><button class="btn" data-speak="${s.sentence}">${icon('speaker')} Hear it</button><button class="btn" data-speak="${s.sentence}" data-rate="0.7">0.7×</button></div>
          <div id="fb" class="mt"></div></div>
        <div class="btn-row right"><button class="btn" id="next">Next ${icon('next')}</button></div>`);
      const picked = new Set();
      container.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { const k = +b.dataset.k; if (picked.has(k)) picked.delete(k); else picked.add(k); b.classList.toggle('active', picked.has(k)); });
      $('#check', container).onclick = async () => {
        let hit = 0; for (const k of content_) if (picked.has(k)) hit++;
        const acc = Math.round(((hit + (words.length - content_.size - [...picked].filter((k) => !content_.has(k)).length)) / words.length) * 100);
        mount($('#ss', container), html`${words.map((w, k) => html`<span class="w ${content_.has(k) ? 'content' : 'function'} ${weak[w.toLowerCase().replace(/[^a-z']/g, '')] ? 'weak' : ''}" title="${weak[w.toLowerCase().replace(/[^a-z']/g, '')] || ''}">${w}</span>`)}`);
        mount($('#fb', container), html`<div class="feedback ${acc >= 80 ? 'ok' : 'close'}"><div class="bold">${acc}% — ${hit}/${content_.size} stressed words found</div>
          ${s.rhythm ? html`<div class="mono small mt">${s.rhythm}</div>` : ''}
          ${Object.keys(weak).length ? html`<div class="small mt">Weak forms: ${Object.entries(weak).map(([k, v]) => html`<span class="chip">${k} → <span class="ipa">${v}</span></span>`)}</div>` : ''}
          <div class="small mt">${hi(s.hi)}</div>${s.note_en ? html`<div class="small mt">${s.note_en}</div>` : ''}
          <div class="mt" id="rec-here"></div></div>`);
        await store.logAttempt({ kind: 'sentence-stress', refId: s.id, accuracy: acc });
        mountRecorder($('#rec-here', container), { refId: s.id, modelText: s.sentence, kind: 'sentence', targetWps: [2.0, 3.2] });
        tts.speak(s.sentence);
      };
      $('#next', container).onclick = () => { i++; one(); };
      setContext({ title: 'Sentence stress', text: `Sentence: "${s.sentence}". Stressed words: ${s.content.map((k) => words[k]).join(', ')}.` });
    };
    one();
  };
  const drawReduce = () => {
    let items = shuffle(data.reductions); let i = 0;
    const one = () => {
      const r = items[i % items.length];
      mount($('#pane', container), html`
        <div class="card center"><div class="muted small">Weak form of</div><div style="font-size:var(--fs-3xl);font-weight:800">${r.full}</div>
          <div class="row" style="justify-content:center;gap:20px;margin-top:8px"><div><div class="xs muted">strong</div><div class="ipa" style="font-size:var(--fs-lg)">${r.strong || ''}</div></div><div><div class="xs muted">weak</div><div class="ipa" style="font-size:var(--fs-lg);color:var(--accent)">${r.weak}</div></div></div>
          <p class="mt" style="font-size:var(--fs-lg)">${r.example}</p>${r.example_weak ? html`<p class="ipa">${r.example_weak}</p>` : ''}
          <div class="btn-row center"><button class="btn" data-speak="${r.example}">${icon('speaker')} Natural</button><button class="btn" data-speak="${r.example}" data-rate="0.7">Slow</button></div>
          <div class="small mt">${r.note_en}</div><div class="small">${hi(r.note_hi)}</div>
          <div class="mt" id="rec-here"></div></div>
        <div class="btn-row right"><button class="btn" id="next">Next ${icon('next')}</button></div>`);
      mountRecorder($('#rec-here', container), { refId: r.id, modelText: r.example, kind: 'sentence', targetWps: [2.0, 3.5] });
      $('#next', container).onclick = () => { i++; one(); };
      setContext({ title: 'Weak forms', text: `Weak form of "${r.full}": ${r.weak}. Example: ${r.example}. ${r.note_en}` });
    };
    one();
  };
  draw();
}

/* ---------------- connected speech ---------------- */
async function renderConnected(container) {
  const data = await content.stress();
  const types = [...new Set(data.connected.map((c) => c.type))];
  let type = types[0];
  const draw = () => {
    const items = data.connected.filter((c) => c.type === type);
    mount(container, html`
      ${backLink('#/pron', 'Pronunciation')}
      <div class="page-head"><div><h1>Connected speech</h1><p class="sub">Natives don't say words. They say phrases.</p></div></div>
      <div class="chips scroll mb">${types.map((t) => html`<button class="chip ${t === type ? 'active' : ''}" data-type="${t}">${t}</button>`)}</div>
      <div class="list">${items.map((c) => html`<div class="list-item" style="flex-wrap:wrap"><div class="grow"><div class="title">${c.phrase} <span class="muted">→</span> <span style="color:var(--accent)">${c.spoken}</span> ${c.ipa ? html`<span class="ipa xs">${c.ipa}</span>` : ''}</div><div class="sub">${c.rule_en}</div><div class="sub">${hi(c.rule_hi)}</div>${c.example_sentence ? html`<div class="sub mt">“${c.example_sentence}” ${speakButton(c.example_sentence)} ${hi(c.hi, { block: false })}</div>` : ''}</div>${speakButton(c.phrase)}</div>`)}</div>`);
    container.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => { type = b.dataset.type; draw(); });
    setContext({ title: `Connected speech: ${type}`, text: items.slice(0, 3).map((c) => `${c.phrase} → ${c.spoken}: ${c.rule_en}`).join('; ') });
  };
  draw();
}

/* ---------------- intonation ---------------- */
async function renderIntonation(container) {
  const data = await content.stress();
  const types = [...new Set(data.intonation.map((c) => c.type))];
  let type = types[0]; let i = 0;
  const draw = () => {
    const items = data.intonation.filter((c) => c.type === type);
    const it = items[i % items.length];
    const words = it.sentence.split(' ');
    mount(container, html`
      ${backLink('#/pron', 'Pronunciation')}
      <div class="page-head"><div><h1>Intonation</h1><p class="sub">Pitch tells the listener whether you are asking, listing, checking, or finished.</p></div></div>
      <div class="chips scroll mb">${types.map((t) => html`<button class="chip ${t === type ? 'active' : ''}" data-type="${t}">${t}</button>`)}</div>
      <div class="card"><div style="overflow-x:auto">${{ toString: () => intonationChart(words, it.contour) }}</div>
        <div class="small mt">${it.rule_en}</div><div class="small">${hi(it.rule_hi)}</div><div class="small mt">${hi(it.hi)}</div>${it.hindi_trap ? html`<div class="small mt" style="color:var(--amber)">${it.hindi_trap}</div>` : ''}
        <div class="btn-row mt"><button class="btn" data-speak="${it.sentence}">${icon('speaker')} Hear it</button><button class="btn" data-speak="${it.sentence}" data-rate="0.75">Slow</button><button class="btn btn-ghost" id="next">Next ${icon('next')}</button></div>
        <div class="mt" id="rec-here"></div></div>`);
    container.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => { type = b.dataset.type; i = 0; draw(); });
    $('#next', container).onclick = () => { i++; draw(); };
    mountRecorder($('#rec-here', container), { refId: it.id, modelText: it.sentence, kind: 'sentence', targetWps: [1.8, 3.2] });
    setContext({ title: `Intonation: ${type}`, text: `"${it.sentence}" — ${it.rule_en}` });
  };
  draw();
}

/* ---------------- sentence scoring ---------------- */
async function renderSentenceScoring(container) {
  const sh = await content.shadowing();
  const s = await store.settings();
  let pool = sh.filter((x) => x.cefr === s.level); if (pool.length < 5) pool = sh;
  let i = 0; let items = shuffle(pool);
  const attempts = (await store.attemptsByKind('sentence')).slice(-10);
  const draw = () => {
    const it = items[i % items.length];
    mount(container, html`
      ${backLink('#/pron', 'Pronunciation')}
      <div class="page-head"><div><h1>Sentence scoring</h1><p class="sub">${asr.supported() ? 'Read the sentence aloud. Green = recognised, amber = close, red = missed.' : 'Record and compare with the model (speech recognition unavailable here).'}</p></div></div>
      <div class="card"><p style="font-size:var(--fs-xl);line-height:1.6">${it.text}</p><div>${hi(it.hi)}</div><div class="btn-row mt"><button class="btn" data-speak="${it.text}">${icon('speaker')} Model</button><button class="btn btn-ghost" id="next">Another ${icon('next')}</button></div><div class="mt" id="rec-here"></div></div>
      ${attempts.length ? html`<p class="xs muted">Last ${attempts.length} attempts: ${attempts.map((a) => `${a.accuracy}%`).join(' · ')}</p>` : ''}`);
    $('#next', container).onclick = () => { i++; draw(); };
    mountRecorder($('#rec-here', container), { refId: it.id, modelText: it.text, kind: 'sentence', targetWps: it.target_wps });
    setContext({ title: 'Sentence practice', text: it.text });
  };
  draw();
}

/* ---------------- tongue twisters ---------------- */
async function renderTwisters(container) {
  const list = await content.tongueTwisters();
  let i = 0; let cleanup = null;
  const draw = () => {
    if (cleanup) cleanup();
    const t = list[i];
    mount(container, html`
      ${backLink('#/pron', 'Pronunciation')}
      <div class="page-head"><div><h1>Tongue twisters</h1><p class="sub">${i + 1} of ${list.length} · focus: ${(t.focus || []).join(', ')} · difficulty ${'★'.repeat(t.difficulty || 1)}</p></div></div>
      <div class="card"><p style="font-size:var(--fs-xl);line-height:1.6">${t.text}</p><div>${hi(t.hi)}</div>${t.tip_en ? html`<div class="small mt muted">${t.tip_en}</div><div class="small">${hi(t.tip_hi)}</div>` : ''}
        <div class="btn-row mt"><button class="btn" data-speak="${t.text}" data-rate="0.7">${icon('speaker')} Slow</button><button class="btn" data-speak="${t.text}">Normal</button><button class="btn" data-speak="${t.text}" data-rate="1.25">Fast</button></div>
        <div class="mt" id="rec-here"></div></div>
      <div class="btn-row between"><button class="btn" id="prev" ${i === 0 ? 'disabled' : ''}>${icon('back')} Previous</button><button class="btn btn-primary" id="next" ${i === list.length - 1 ? 'disabled' : ''}>Next ${icon('next')}</button></div>`);
    cleanup = mountRecorder($('#rec-here', container), { refId: t.id, modelText: t.text, kind: 'twister', targetWps: [2.0, 4.0] });
    $('#prev', container).onclick = () => { i--; draw(); }; $('#next', container).onclick = () => { i++; draw(); };
    setContext({ title: 'Tongue twister', text: t.text });
  };
  draw();
  return () => cleanup && cleanup();
}
