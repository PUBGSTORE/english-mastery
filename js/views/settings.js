// settings.js — preferences, API key, export/import, reset.
import { html, mount, icon, toast, confirmDialog, openSheet, closeSheet, $ } from '../ui.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as tts from '../tts.js';
import * as ai from '../ai.js';
import * as audio from '../audio.js';
import * as sync from '../sync.js';
import { download, readFileText, CEFR } from '../utils.js';
import { getTheme, setTheme } from '../app.js';
import { isHindi, setHindi } from '../i18n.js';

export async function render(container) {
  const s = await store.settings();
  const key = await ai.getKey();
  const usage = await ai.usageSummary();
  const prices = await ai.getPrices();
  const est = await db.estimateUsage();
  const recs = await audio.recordingCount();
  const voices = tts.getVoices();
  const ghToken = await sync.getToken();
  const ghUser = await db.getSetting('ghUser', '');
  const gistId = await sync.getGistId();
  const lastCloud = await db.getSetting('lastCloudBackup', null);
  const lastCloudBytes = await db.getSetting('lastCloudBackupBytes', 0);
  mount(container, html`
    <div class="page-head"><div><h1>Settings</h1><p class="sub">Everything is stored on this device only.</p></div></div>

    <div class="card"><h3>Appearance</h3>
      <div class="field"><label>Theme</label><div class="btn-row"><button class="btn ${getTheme() === 'dark' ? 'btn-primary' : ''}" data-theme-btn="dark">${icon('moon')} Dark</button><button class="btn ${getTheme() === 'light' ? 'btn-primary' : ''}" data-theme-btn="light">${icon('sun')} Light</button></div></div>
      <label class="switch"><input type="checkbox" id="hindi-default" ${isHindi() ? 'checked' : ''}><span class="track"></span><span>Show Hindi by default (हिन्दी दिखाएँ)</span></label>
      <p class="help muted small">Off = English first, Hindi one tap away. On = Hindi always visible.</p>
    </div>

    <div class="card"><h3>Learning</h3>
      <div class="field"><label for="level">Your level (CEFR)</label><select class="select" id="level">${CEFR.map((l) => html`<option value="${l}" ${s.level === l ? 'selected' : ''}>${l}</option>`)}</select><span class="help">${s.placementDone ? 'Set by placement test. ' : ''}<a href="#/placement">Retake placement test</a></span></div>
      <div class="grid-2">
        <div class="field"><label for="newPerDay">New cards per day</label><input class="input" id="newPerDay" type="number" min="0" max="100" value="${s.newPerDay}"></div>
        <div class="field"><label for="reviewPerDay">Max reviews per day</label><input class="input" id="reviewPerDay" type="number" min="10" max="1000" value="${s.reviewPerDay}"></div>
        <div class="field"><label for="dailyGoalMin">Daily goal (minutes)</label><input class="input" id="dailyGoalMin" type="number" min="5" max="240" value="${s.dailyGoalMin}"></div>
        <div class="field"><label for="streakFreezes">Streak freezes available</label><input class="input" id="streakFreezes" type="number" min="0" max="3" value="${s.streakFreezes}"><span class="help">You earn one every 7-day streak (max 3).</span></div>
      </div>
    </div>

    <div class="card"><h3>Voice</h3>
      <div class="field"><label for="voice">Text-to-speech voice</label><select class="select" id="voice"><option value="">Automatic (best available)</option>${voices.map((v) => html`<option value="${v.name}" ${s.voice === v.name ? 'selected' : ''}>${v.name} (${v.lang})</option>`)}</select>
        <span class="help">${voices.length ? `${voices.length} English voices found.` : 'No voices listed yet. On iOS, tap Test once and reopen Settings.'} On iPad, download an Enhanced voice under Settings → Accessibility → Spoken Content → Voices → English for much better audio.</span></div>
      <div class="field"><label for="ttsRate">Speed: <span id="rate-val">${s.ttsRate}</span>×</label><input type="range" id="ttsRate" min="0.6" max="1.3" step="0.05" value="${s.ttsRate}"></div>
      <button class="btn" id="test-voice">${icon('speaker')} Test voice</button>
    </div>

    <div class="card"><h3>AI tutor (DeepSeek)</h3>
      <div class="field"><label for="apiKey">API key</label><input class="input" id="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-…" value="${key}">
        <span class="help">Stored only in this browser's IndexedDB and sent only to api.deepseek.com. Never open this app on a shared device. Get a key at platform.deepseek.com and set a spending limit there.</span></div>
      <div class="btn-row"><button class="btn btn-primary" id="save-key">Save key</button><button class="btn" id="test-key">Test connection</button><button class="btn btn-ghost" id="clear-key">Remove</button></div>
      <hr>
      <div class="grid-3">
        <div class="stat"><div class="label">Calls</div><div class="value">${usage.calls}</div></div>
        <div class="stat"><div class="label">Tokens in / out</div><div class="value" style="font-size:var(--fs-md)">${(usage.input / 1000).toFixed(1)}k / ${(usage.output / 1000).toFixed(1)}k</div></div>
        <div class="stat"><div class="label">Est. spend</div><div class="value">$${usage.cost.toFixed(3)}</div></div>
      </div>
      <div class="grid-2 mt">
        <div class="field"><label for="priceIn">Price per 1M input tokens ($)</label><input class="input" id="priceIn" type="number" step="0.01" value="${prices.input}"></div>
        <div class="field"><label for="priceOut">Price per 1M output tokens ($)</label><input class="input" id="priceOut" type="number" step="0.01" value="${prices.output}"></div>
      </div>
      <button class="btn btn-ghost btn-sm" id="reset-usage">Reset counter</button>
    </div>

    <div class="card accent"><h3>Backup</h3>
      <p class="small muted">This is your only backup. A cleared browser cache deletes everything. Export at least weekly; keep the file in iCloud Drive or Files.</p>
      <p class="small">Last export: <strong>${s.lastExport ? new Date(s.lastExport).toLocaleString() : 'never'}</strong></p>
      <div class="btn-row"><button class="btn btn-primary" id="export">${icon('download')} Export all progress</button>
        <label class="btn" for="import-file">${icon('upload')} Import…</label><input type="file" id="import-file" accept="application/json,.json" hidden></div>
    </div>

    <div class="card ${ghToken ? 'green' : 'accent'}"><h3>Cloud backup (your GitHub account)</h3>
      <p class="small muted">Your progress is saved automatically to a <strong>private Gist</strong> on your GitHub account, about 90 seconds after you stop studying and at least once a day. Open the app on any other browser or device, paste the same token, tap Restore, and everything is back. Nothing is sent anywhere except api.github.com.</p>
      ${ghToken ? html`<p class="small">Connected${ghUser ? ` as <strong>${ghUser}</strong>` : ''} · last backup: <strong>${lastCloud ? new Date(lastCloud).toLocaleString() : 'not yet'}</strong>${lastCloudBytes ? ` · ${(lastCloudBytes / 1024).toFixed(0)} KB` : ''}${gistId ? html` · <a href="https://gist.github.com/${gistId}" target="_blank" rel="noopener">view gist</a>` : ''}</p>
        <div class="btn-row"><button class="btn btn-primary" id="cloud-backup">${icon('upload')} Back up now</button><button class="btn" id="cloud-restore">${icon('download')} Restore from cloud</button><button class="btn btn-ghost" id="cloud-remove">Disconnect</button></div>`
      : html`<div class="field"><label for="ghToken">GitHub token (classic, scope: <code>gist</code>)</label><input class="input" id="ghToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…">
          <span class="help">Create one at <a href="https://github.com/settings/tokens/new?scopes=gist&description=English%20Mastery%20backup" target="_blank" rel="noopener">github.com/settings/tokens/new</a> (tick only <em>gist</em>, set no expiry or one year). Or, on your Mac, run <code>gh auth token</code> in Terminal and paste the result. The token is stored only on this device.</span></div>
        <div class="btn-row"><button class="btn btn-primary" id="cloud-connect">Connect</button><button class="btn" id="cloud-connect-restore">Connect and restore existing backup</button></div>`}
    </div>

    <div class="card"><h3>Storage</h3>
      <p class="small muted">Using ${(est.usage / 1048576).toFixed(1)} MB${est.quota ? ` of ${(est.quota / 1048576).toFixed(0)} MB available` : ''}. ${recs} saved recordings (not included in exports).</p>
      <div class="btn-row"><button class="btn" id="clear-recs">Delete recordings</button><button class="btn btn-danger" id="reset-all">${icon('trash')} Reset all progress</button></div>
    </div>

    <div class="card"><h3>About</h3><p class="small muted mb-0">English Mastery · offline-first · no server. Add to Home Screen on iPad: Share → Add to Home Screen. Content lives in <code>data/*.json</code>; see README to add your own.</p></div>
  `);

  const save = async (k, v) => { await store.setSetting(k, v); toast('Saved', 'ok', { timeout: 1200 }); };
  container.querySelectorAll('[data-theme-btn]').forEach((b) => b.onclick = () => { setTheme(b.dataset.themeBtn); container.querySelectorAll('[data-theme-btn]').forEach((x) => x.classList.toggle('btn-primary', x === b)); });
  $('#hindi-default', container).onchange = (e) => { setHindi(e.target.checked); store.setSetting('hindiDefault', e.target.checked); };
  $('#level', container).onchange = (e) => save('level', e.target.value);
  for (const k of ['newPerDay', 'reviewPerDay', 'dailyGoalMin', 'streakFreezes']) $('#' + k, container).onchange = (e) => save(k, Math.max(0, parseInt(e.target.value, 10) || 0));
  $('#voice', container).onchange = (e) => { tts.setPreferredVoice(e.target.value); save('voice', e.target.value); };
  $('#ttsRate', container).oninput = (e) => { $('#rate-val', container).textContent = e.target.value; };
  $('#ttsRate', container).onchange = (e) => { const r = parseFloat(e.target.value); tts.setRate(r); save('ttsRate', r); };
  $('#test-voice', container).onclick = () => { tts.speak('Hello Balvant. This is your English voice. The weather was wonderful yesterday.'); setTimeout(() => render(container), 800); };

  $('#save-key', container).onclick = async () => { const v = $('#apiKey', container).value.trim(); await store.setSetting('apiKey', v); toast(v ? 'API key saved on this device' : 'API key removed', 'ok'); };
  $('#clear-key', container).onclick = async () => { $('#apiKey', container).value = ''; await store.setSetting('apiKey', ''); toast('API key removed', 'ok'); };
  $('#test-key', container).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Testing…';
    try {
      await store.setSetting('apiKey', $('#apiKey', container).value.trim());
      const r = await ai.chat({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 5 });
      toast(`Connected. Reply: ${r.content.trim().slice(0, 20)}`, 'ok');
    } catch (err) { toast(err.message === 'NO_KEY' ? 'Enter a key first.' : err.message, 'err', { timeout: 6000 }); }
    b.disabled = false; b.textContent = 'Test connection';
  };
  const savePrices = () => store.setSetting('prices', { input: parseFloat($('#priceIn', container).value) || 0, output: parseFloat($('#priceOut', container).value) || 0 });
  $('#priceIn', container).onchange = savePrices; $('#priceOut', container).onchange = savePrices;
  $('#reset-usage', container).onclick = async () => { await ai.resetUsage(); render(container); };

  $('#export', container).onclick = async () => {
    try {
      const data = await db.exportAll();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      download(`english-mastery-backup-${stamp}.json`, JSON.stringify(data));
      await store.setSetting('lastExport', new Date().toISOString());
      toast(`Exported ${Object.values(data.counts).reduce((a, b) => a + b, 0)} records`, 'ok');
      setTimeout(() => render(container), 500);
    } catch (e) { toast('Export failed: ' + e.message, 'err'); }
  };
  $('#import-file', container).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    let data;
    try { data = JSON.parse(await readFileText(file)); } catch (err) { toast('Not valid JSON: ' + err.message, 'err'); return; }
    const problems = db.validateExport(data);
    const fatal = problems.filter((p) => !p.includes('will be skipped'));
    const counts = Object.entries(data.stores || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : '?'}`).join(', ');
    const body = openSheet(html`<h3>Import backup</h3>
      <p class="small muted">Exported ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : '?'} · format ${data.format}</p>
      <p class="small">${counts}</p>
      ${problems.length ? html`<div class="feedback ${fatal.length ? 'bad' : 'close'}"><strong>${fatal.length ? 'Cannot import:' : 'Warnings:'}</strong><ul>${problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : ''}
      ${fatal.length ? '' : html`<p class="small mt"><strong>Merge</strong> keeps your current data and adds/updates from the file (newer wins). <strong>Replace</strong> wipes everything first.</p>
      <div class="btn-row right"><button class="btn" data-x="cancel">Cancel</button><button class="btn btn-danger" data-x="replace">Replace</button><button class="btn btn-primary" data-x="merge">Merge</button></div>`}`, { dialog: true });
    body.querySelector('[data-x="cancel"]')?.addEventListener('click', closeSheet);
    for (const mode of ['merge', 'replace']) body.querySelector(`[data-x="${mode}"]`)?.addEventListener('click', async () => {
      if (mode === 'replace' && !(await confirmDialog('Replace ALL current progress with the backup file?', { okLabel: 'Replace', danger: true }))) return;
      try {
        const summary = await db.importAll(data, mode);
        closeSheet();
        toast(`Imported: ${Object.entries(summary).map(([k, v]) => `${k} ${v}`).join(', ')}`, 'ok', { timeout: 6000 });
        setTimeout(() => location.reload(), 800);
      } catch (err) { toast('Import failed: ' + err.message, 'err'); }
    });
    e.target.value = '';
  };
  const connect = async (restoreAfter) => {
    const t = $('#ghToken', container).value.trim();
    if (!t) { toast('Paste a GitHub token first.', 'warn'); return; }
    await store.setSetting('ghToken', t);
    try {
      const user = await sync.whoAmI();
      await store.setSetting('ghUser', user);
      toast(`Connected to GitHub as ${user}`, 'ok');
      if (restoreAfter) {
        const remote = await sync.fetchRemote();
        if (!remote) { toast('No backup found on this account yet. Backing up now.', '', { timeout: 5000 }); await sync.backup({ reason: 'manual' }); }
        else if (await confirmDialog(`Found a backup from ${new Date(remote.updatedAt).toLocaleString()} (${(remote.size / 1024).toFixed(0)} KB). Merge it into this device?`, { okLabel: 'Restore' })) {
          const r = await sync.restore('merge'); toast(`Restored: ${Object.entries(r.summary).map(([k, v]) => `${k} ${v}`).join(', ')}`, 'ok', { timeout: 6000 }); setTimeout(() => location.reload(), 900); return;
        }
      } else await sync.backup({ reason: 'manual' });
      render(container);
    } catch (e) { await store.setSetting('ghToken', ''); toast(e.message, 'err', { timeout: 7000 }); }
  };
  const cc = $('#cloud-connect', container); if (cc) cc.onclick = () => connect(false);
  const ccr = $('#cloud-connect-restore', container); if (ccr) ccr.onclick = () => connect(true);
  const cb = $('#cloud-backup', container); if (cb) cb.onclick = async () => { cb.disabled = true; await sync.backup({ reason: 'manual' }); render(container); };
  const cr = $('#cloud-restore', container); if (cr) cr.onclick = async () => {
    cr.disabled = true;
    try {
      const remote = await sync.fetchRemote();
      if (!remote) { toast('No cloud backup found.', 'warn'); cr.disabled = false; return; }
      const body = openSheet(html`<h3>Restore from cloud</h3><p class="small muted">Backup from ${new Date(remote.updatedAt).toLocaleString()} · ${(remote.size / 1024).toFixed(0)} KB · ${Object.entries(remote.data.counts || {}).map(([k, v]) => `${k} ${v}`).join(', ')}</p>
        <p class="small"><strong>Merge</strong> keeps what is on this device and adds the cloud copy (newer wins). <strong>Replace</strong> wipes this device first.</p>
        <div class="btn-row right"><button class="btn" data-x="cancel">Cancel</button><button class="btn btn-danger" data-x="replace">Replace</button><button class="btn btn-primary" data-x="merge">Merge</button></div>`, { dialog: true });
      body.querySelector('[data-x="cancel"]').onclick = () => { closeSheet(); cr.disabled = false; };
      for (const mode of ['merge', 'replace']) body.querySelector(`[data-x="${mode}"]`).onclick = async () => {
        if (mode === 'replace' && !(await confirmDialog('Replace ALL progress on this device with the cloud copy?', { okLabel: 'Replace', danger: true }))) return;
        const r = await sync.restore(mode); closeSheet();
        toast(`Restored: ${Object.entries(r.summary).map(([k, v]) => `${k} ${v}`).join(', ')}`, 'ok', { timeout: 6000 });
        setTimeout(() => location.reload(), 900);
      };
    } catch (e) { toast(e.message, 'err', { timeout: 6000 }); cr.disabled = false; }
  };
  const crm = $('#cloud-remove', container); if (crm) crm.onclick = async () => { if (await confirmDialog('Disconnect cloud backup? The Gist stays on GitHub; this device just stops syncing.', { okLabel: 'Disconnect' })) { await store.setSetting('ghToken', ''); await store.setSetting('ghUser', ''); render(container); } };
  $('#clear-recs', container).onclick = async () => { if (await confirmDialog('Delete all saved recordings?', { okLabel: 'Delete', danger: true })) { const n = await audio.clearRecordings(); toast(`Deleted ${n} recordings`, 'ok'); render(container); } };
  $('#reset-all', container).onclick = async () => {
    if (!(await confirmDialog('This deletes every card, review, mistake, note and chat on this device. Export first! Continue?', { okLabel: 'Delete everything', danger: true, title: 'Reset all progress' }))) return;
    if (!(await confirmDialog('Last chance. Really delete all progress?', { okLabel: 'Yes, delete', danger: true }))) return;
    await db.wipeAll();
    try { localStorage.removeItem('em.route'); } catch { /* ignore */ }
    toast('All progress deleted', 'ok');
    setTimeout(() => { location.hash = '#/'; location.reload(); }, 600);
  };
}
