// session.js — the Today session state + the sticky bar shown across modules.
import * as db from './db.js';
import { html, icon } from './ui.js';
import { uid, nowISO, todayKey } from './utils.js';
import { navigate, onRoute, parseHash } from './router.js';

export async function getSession() { const s = await db.getSetting('todaySession', null); return s && !s.completedAt && !s.abandoned ? s : null; }
export async function startSession(preset, plan) {
  const s = { id: uid('ss'), day: todayKey(), preset, plan, done: [], startedAt: nowISO(), completedAt: null };
  await db.setSetting('todaySession', s); await db.put('sessions', s); renderBar(s); return s;
}
export async function advance(skipped = false) {
  const s = await getSession(); if (!s) return;
  s.done.push({ step: s.done.length, skipped, at: nowISO() });
  if (s.done.length >= s.plan.length) { s.completedAt = nowISO(); await db.put('sessions', s); await db.setSetting('todaySession', s); renderBar(null); navigate('/today'); const { toast } = await import('./ui.js'); toast(`Session complete: ${s.plan.length} steps in ${Math.round((new Date(s.completedAt) - new Date(s.startedAt)) / 60000)} min`, 'ok', { timeout: 6000 }); return; }
  await db.setSetting('todaySession', s); await db.put('sessions', s); renderBar(s); navigate(s.plan[s.done.length].route);
}
export async function endSession(completed = false) {
  const s = await getSession(); if (!s) return;
  if (completed) s.completedAt = nowISO(); else s.abandoned = true;
  await db.put('sessions', s); await db.setSetting('todaySession', s); renderBar(null);
}
export function renderBar(s) {
  let bar = document.getElementById('session-bar');
  if (!s) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'session-bar'; bar.className = 'session-bar'; document.body.appendChild(bar); }
  const i = s.done.length; const step = s.plan[i];
  bar.innerHTML = String(html`<div class="progress"><span style="width:${(i / s.plan.length) * 100}%"></span></div><div class="row between" style="flex-wrap:nowrap"><span class="xs"><strong>${i + 1}/${s.plan.length}</strong> ${step.label} <span class="faint">~${step.minutes} min</span></span><span class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn btn-sm btn-ghost" data-skip>Skip</button><button class="btn btn-sm btn-primary" data-next>Done ${icon('next')}</button></span></div>`);
  bar.querySelector('[data-next]').onclick = () => advance(false);
  bar.querySelector('[data-skip]').onclick = () => advance(true);
}
export async function init() {
  const s = await getSession();
  renderBar(s);
  onRoute(async () => { const cur = await getSession(); if (cur && !document.getElementById('session-bar')) renderBar(cur); if (!cur) renderBar(null); });
}
