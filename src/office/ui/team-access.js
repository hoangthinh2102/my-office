// Team mode's closed rooms (docs/features/team-mode.md, step 4): knocking on someone's closed door, answering knocks
// on yours (an hour, the rest of the day, always, or no), who may look in and taking that back, one-time view codes,
// and your room's access log. The hub keeps the rules (hub/src/core.js); this computer's server passes the calls on
// (POST /api/team/knock|answer|revoke|code|redeem, GET /api/team/access). Markup: src/components/office/TeamModal.tsx.
import { state } from '../core/state.js';
import { $, el, fmtAgo, nowMs } from '../core/env.js';
import { TOKEN } from '../net/live.js';
import { icon } from './icons.js';
import { toast } from './activity.js';
import { t as tr } from '../../i18n/index.js';

let apply = () => {}, demo = null, lastCode = null, accessKey = '';
const seenKnocks = new Set();
/** team.js hands over how to show a new team state (its onTeam). */
export function setApply(fn) { apply = fn; }
/** Demo mode answers these calls itself: fn(action, body) -> what the server would. */
export function setDemoAccess(fn) { demo = fn; }
const local = () => !!state.isLocal || !!demo;

export const post = async (path, body) => {
  const r = await fetch(`${path}${TOKEN ? `?k=${encodeURIComponent(TOKEN)}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.code || j.message || r.status);
  return j;
};
const errText = (code) => { const k = `team.access.err.${code}`, s = tr(k); return s === k ? tr('team.access.failed', { why: code }) : s; };
async function call(action, body = {}) {
  try {
    const j = demo ? demo(action, body) : await post(`/api/team/${action}`, body);
    if (!j.ok) throw new Error(j.code || 'error');
    if (j.team) apply(j.team);
    return j;
  } catch (e) { toast(errText(e.message)); return null; }
}
async function getAccess() {
  if (demo) return demo('access', {});
  try {
    const r = await fetch(`/api/team/access${TOKEN ? `?k=${encodeURIComponent(TOKEN)}` : ''}`);
    const j = await r.json(); return j.ok ? j : null;
  } catch { return null; }
}

/* ---------- words ---------- */
const clock = (ms) => new Date(ms).toLocaleTimeString(tr('team.access.locale'), { hour: '2-digit', minute: '2-digit' });
/** How long a grant has left: "always", "42 min left", or "until 23:59". */
export function leftText(until) {
  if (until == null) return tr('team.access.always');
  const min = Math.max(1, Math.ceil((until - nowMs()) / 60_000));
  return min < 120 ? tr('team.access.minsLeft', { n: min }) : tr('team.access.until', { time: clock(until) });
}
const ago = (ts) => tr('team.ago', { time: fmtAgo(Math.max(0, (nowMs() - ts) / 1000)) });
const button = (cls, text, onClick, ic) => {
  const b = el('button', cls); b.type = 'button';
  if (ic) b.append(icon(ic));
  b.append(document.createTextNode(text));
  b.disabled = !local();
  if (!local()) b.title = tr('team.mine.phone');
  b.addEventListener('click', onClick);
  return b;
};

/* ---------- someone else's closed room: knock ---------- */
/** What a closed room's card (the building's list, or the 3D card) shows about getting in, or null. */
export function knockBlock(r, st, t = state.team) {
  if (st === 'shared') return el('p', 'team-access-note is-in', tr('team.access.youSee', { left: leftText(r.access?.until) }));
  if (st !== 'closed') return null;
  const id = r.member.id, box = el('div', 'team-knock');
  const answer = (t?.answers || []).find((a) => a.room === id);
  if ((t?.asks || []).some((a) => a.room === id)) { box.append(el('p', 'team-access-note', tr('team.access.waiting', { name: r.member.name }))); return box; }
  if (answer) box.append(el('p', 'team-access-note', tr(`team.access.answer.${answer.state}`, { name: r.member.name })));
  box.append(button('team-knock-b', tr(answer ? 'team.access.knockAgain' : 'team.access.knock'), () => call('knock', { room: id }), 'door'));
  return box;
}

/* ---------- your room: knocks, who may look in, codes, log ---------- */
export function fillAccess(t) {
  const wrap = $('team-access'); if (!wrap || !t) return;
  const knocks = t.knocks || [], grants = t.grants || [], open = t.room?.mode === 'open';
  const key = JSON.stringify([knocks, grants, open, local(), lastCode, Math.floor(nowMs() / 60_000)]);
  if (key === accessKey) return;   // (unchanged: keep the buttons under the pointer)
  accessKey = key;
  $('team-access-open').hidden = !open;
  // knocks waiting for an answer
  $('team-knocks').replaceChildren(...knocks.map((k) => {
    const row = el('div', 'team-ask');
    const who = el('p', 'team-ask-t');
    who.append(el('b', null, k.viewer.name), document.createTextNode(` ${tr('team.access.asks')} · ${ago(k.at)}`));
    const acts = el('div', 'team-ask-b');
    for (const g of ['hour', 'day', 'always']) acts.append(button('team-ask-yes', tr(`team.access.grant.${g}`), () => call('answer', { viewer: k.viewer.id, grant: g })));
    acts.append(button('team-ask-no', tr('team.access.grant.no'), () => call('answer', { viewer: k.viewer.id, grant: 'no' })));
    row.append(who, acts);
    return row;
  }));
  // who may look in now
  const list = $('team-grants');
  list.replaceChildren(...(grants.length ? grants.map((g) => {
    const li = el('li', 'team-grant');
    li.append(el('b', null, g.viewer.name), el('small', null, leftText(g.until)), button('team-grant-x', tr('team.access.revoke'), () => call('revoke', { viewer: g.viewer.id })));
    return li;
  }) : [el('li', 'team-grant-none', tr('team.access.noGrants'))]));
  // the last code you made, while it still works
  const out = $('team-code-out');
  if (lastCode && lastCode.expiresAt > nowMs()) {
    out.hidden = false;
    const code = el('code', 'team-code', lastCode.code);
    const copy = el('button', 'team-code-copy'); copy.type = 'button'; copy.append(icon('clipboard')); copy.title = tr('team.access.copy');
    copy.addEventListener('click', () => navigator.clipboard?.writeText(lastCode.code).then(() => toast(tr('team.access.copied')), () => {}));
    out.replaceChildren(code, copy, el('small', null, tr('team.access.codeNote', { time: clock(lastCode.expiresAt) })));
  } else { out.hidden = true; out.replaceChildren(); lastCode = null; }
  for (const id of ['team-code-make', 'team-redeem-in', 'team-redeem-go']) { const n = $(id); if (n) n.disabled = !local(); }
}

async function fillLog() {
  const box = $('team-log-list'); if (!box) return;
  box.replaceChildren(el('li', 'team-log-none', tr('team.access.loading')));
  const a = await getAccess();
  if (!a) { box.replaceChildren(el('li', 'team-log-none', tr('team.access.logFailed'))); return; }
  box.replaceChildren(...(a.log?.length ? a.log.map((l) => {
    const li = el('li', 'team-log-row');
    li.append(el('time', null, clock(l.at)), el('span', null, tr(`team.access.log.${l.action}`, { name: l.viewer?.name || '—', detail: l.detail ? tr(`team.access.grant.${l.detail}`) : '' })));
    return li;
  }) : [el('li', 'team-log-none', tr('team.access.logEmpty'))]));
}

/* ---------- knocks you haven't seen yet: a toast and the badge on the building button ---------- */
export function noticeKnocks(t) {
  const knocks = t?.knocks || [], badge = $('team-badge');
  if (badge) { badge.hidden = !knocks.length; badge.textContent = knocks.length ? String(knocks.length) : ''; }
  for (const k of knocks) {
    const id = `${k.viewer.id}/${k.at}`;
    if (seenKnocks.has(id)) continue;
    seenKnocks.add(id);
    if (nowMs() - k.at < 60_000) toast(tr('team.access.knocked', { name: k.viewer.name }), 6000);
  }
}

export function setup() {
  $('team-code-make')?.addEventListener('click', async () => {
    const j = await call('code');
    if (j?.code) { lastCode = { code: j.code, expiresAt: j.expiresAt }; accessKey = ''; fillAccess(state.team); }
  });
  $('team-redeem')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('team-redeem-in'), code = inp.value.trim();
    if (!code) return;
    const j = await call('redeem', { code });
    if (j?.room) { inp.value = ''; toast(tr(j.until == null ? 'team.access.redeemedAlways' : 'team.access.redeemed', { name: j.room.name, time: j.until == null ? '' : clock(j.until) }), 5000); }
  });
  $('team-log')?.addEventListener('toggle', (e) => { if (e.target.open) fillLog(); });
}
