// Team mode's building (the building button in the top bar; markup: src/components/office/TeamModal.tsx): your own room,
// which you can open, close or pause from this computer, and everyone else's rooms floor by floor, view only. What it
// shows comes from the server's relay (server/team/relay.mjs) in the live stream ({k:'team'}), or from demo mode.
import { state } from '../core/state.js';
import { $, HQ, el, fmtAgo, nowMs } from '../core/env.js';
import { PALETTE, hash } from '../people/workers.js';
import { TYPE_ICON, icon } from './icons.js';
import { toast } from './activity.js';
import { floorsOf, latest, seesIn, stateOf } from '../../shared/team-floors.js';
import { fillAccess, knockBlock, noticeKnocks, post, setApply } from './team-access.js';
import { syncLift } from './team-lift.js';
import { setApply as setJoinApply, syncJoin } from './team-join.js';
import { fillMembers, setApply as setMembersApply } from './team-members.js';
import { goTower } from '../world/team-tower.js';
import { updateState } from './update.js';
import { t as tr } from '../../i18n/index.js';

let modal, demoSet = null;
const isOpen = () => modal && !modal.hidden;
const team = () => state.team || null;

/** The relay's state ({ inTeam, team, me, room, connected, policy, rooms, members, grants, knocks, asks, answers }), from the stream or demo mode. */
export function onTeam(t) {
  state.team = t || null;
  const btn = $('btn-team');
  if (btn) {
    btn.hidden = !t?.inTeam;
    // while your sessions' conversations can be read, the building button says so (and so does its title)
    const log = !!t?.inTeam && t.room?.log === true && !t.room?.paused;
    btn.classList.toggle('is-log', log);
    btn.title = log ? `${tr('team.openTitle')} · ${tr('team.log.onTitle')}` : tr('team.openTitle');
  }
  if (!t?.inTeam && isOpen()) close();
  if (isOpen()) render();
  noticeKnocks(state.team);   // (a knock on your door: a toast, and a badge on the building button)
  syncJoin(state.team);       // (the invite button here, and Settings → More's join form)
  syncLift(state.team);   // the 3D building (headquarters plan)
}
/** Demo mode changes its own pretend room instead of asking the server. */
export function setDemoRoom(fn) { demoSet = fn; }

function open() { if (!team()?.inTeam) return; modal.hidden = false; $('btn-team')?.setAttribute('aria-pressed', 'true'); render(); }
function close() { modal.hidden = true; $('btn-team')?.setAttribute('aria-pressed', 'false'); }

// the team's setting (admins only; the hub checks it too): may open rooms show file names and commands?
async function setDetails(on) {
  if (demoSet) { demoSet({ details: on }); return; }
  try { onTeam((await post('/api/team/policy', { details: on })).team); } catch (e) { toast(tr('team.policy.failed', { why: e.message })); render(); }
}

// your own sessions' conversations: may people who see your room read them? (this computer only; off unless turned on)
async function setLog(on) {
  if (demoSet) { demoSet({ log: on }); return; }
  try { onTeam((await post('/api/team/room', { log: on })).team); } catch (e) { toast(tr('team.log.failed', { why: e.message })); render(); }
}

// (admins) every office in the team must run the newest main: a second click does it
let updArmed = 0;
async function requireUpdate() {
  if (Date.now() - updArmed > 4000) { updArmed = Date.now(); $('team-upd-l').textContent = tr('team.upd.confirm'); setTimeout(() => { if (Date.now() - updArmed >= 4000) render(); }, 4100); return; }
  updArmed = 0;
  if (demoSet) { toast(tr('team.upd.demo')); render(); return; }
  try {
    const j = await post('/api/team/update', {});
    toast(tr('team.upd.done', { n: j.version?.min, commit: j.commit || '' }), 6000);
  } catch (e) { const k = `team.upd.err.${e.message}`; toast(tr('team.upd.failed', { why: tr(k) === k ? e.message : tr(k) })); }
  render();
}

async function setMine(mode) {
  const body = mode === 'paused' ? { paused: true } : team()?.room?.paused ? { paused: false } : { mode };
  if (demoSet) { demoSet(mode); return; }
  try {
    // resuming keeps the room's mode; a click on open or closed while paused resumes first, then sets it
    let j = await post('/api/team/room', body);
    if (body.paused === false) j = await post('/api/team/room', { mode });
    onTeam(j.team);
  } catch (e) { toast(tr('team.mine.failed', { why: e.message })); }
}

/* ---------- drawing ---------- */
const ago = (ts) => tr('team.ago', { time: fmtAgo(Math.max(0, (nowMs() - ts) / 1000)) });
const actText = (type) => tr(`team.act.${type}`) === `team.act.${type}` ? tr('team.act.other') : tr(`team.act.${type}`);
const counts = (c = {}) => tr('team.counts', { work: c.work || 0, wait: c.wait || 0, rest: c.rest || 0 });

function render() {
  const t = team(); if (!t?.inTeam) return;
  $('team-title').textContent = tr('team.title', { team: t.team?.name || '' });
  $('team-sub').textContent = t.room?.paused ? tr('team.sub.paused') : t.problem === 'update' ? (['waiting', 'running'].includes(updateState()?.status) ? tr('team.upd.held') : tr('team.upd.heldStuck', { min: updateState()?.min || 1 })) : t.connected ? tr('team.sub.on', { n: t.rooms.length }) : t.problem === 'not-member' ? tr('team.sub.removed') : tr('team.sub.off');
  // your room
  const mine = t.room?.paused ? 'paused' : t.room?.mode === 'open' ? 'open' : 'closed', local = !!state.isLocal || !!demoSet;
  for (const b of modal.querySelectorAll('.team-seg-b')) {
    b.classList.toggle('is-sel', b.dataset.mode === mine);
    b.setAttribute('aria-pressed', String(b.dataset.mode === mine));
    b.disabled = !local;
  }
  $('team-mine-note').textContent = local ? tr(`team.mine.${mine}Hint`) : `${tr(`team.mine.${mine}Hint`)} ${tr('team.mine.phone')}`;
  // the team's setting: everyone sees it; admins change it (on the computer the office runs on)
  const details = !!t.policy?.details, owner = !!t.me?.owner;
  $('team-policy-t').textContent = `${tr(details ? 'team.policy.on' : 'team.policy.off')} ${owner ? tr('team.policy.youOwn') : tr('team.policy.byOwner')}`;
  $('team-policy-sw').hidden = !owner;
  const sw = $('team-policy-in'); sw.checked = details; sw.disabled = !local;
  const log = t.room?.log === true, lsw = $('team-convo-in');
  if (lsw) { lsw.checked = log; lsw.disabled = !local; }
  if ($('team-convo-t')) $('team-convo-t').textContent = `${tr(log ? 'team.log.on' : 'team.log.off')}${local ? '' : ` ${tr('team.mine.phone')}`}`;
  $('team-convo')?.classList.toggle('is-on', log);
  // the oldest version the team allows: everyone sees it; admins raise it to the newest (on this computer)
  const u = updateState(), build = u?.build || 0, min = u?.min || 0;
  const heldText = () => (['waiting', 'running'].includes(u?.status) || !u ? tr('team.upd.held') : tr('team.upd.heldStuck', { min: Math.max(min, 1) }));
  if ($('team-upd-t')) $('team-upd-t').textContent = u?.held ? heldText() : min > 0 ? tr('team.upd.min', { min, build }) : tr('team.upd.none', { build: build || '–' });
  if ($('team-upd-b')) { $('team-upd-b').hidden = !owner || !local; if (!updArmed) $('team-upd-l').textContent = tr('team.upd.button'); }
  $('team-mine').querySelector('.team-owner')?.remove();
  if (owner) $('team-mine').querySelector('.team-mine-head b').append(el('span', 'team-owner', tr('team.owner')));
  fillAccess(t);
  fillMembers(t);
  $('team-3d-note').textContent = HQ ? tr('team.lift.hint') : tr('team.lift.notHq');
  // everyone else's, floor by floor
  const box = $('team-floors'), floors = floorsOf(t.rooms);
  if (!floors.length) { box.replaceChildren(el('p', 'team-empty', tr('team.empty'))); return; }
  box.replaceChildren(...floors.map((f) => {
    const sec = el('section', 'team-floor');
    const h = el('h3', 'team-floor-h', tr('team.floor', { n: f.n }));
    if (HQ) {   // the floor in 3D (world/team-tower.js)
      const go = el('button', 'team-floor-go', tr('team.lift.see')); go.type = 'button';
      go.addEventListener('click', () => { close(); goTower(f.n); });
      h.append(go);
    }
    sec.append(h);
    const grid = el('div', 'team-rooms');
    grid.append(...f.rooms.map(roomCard));
    sec.append(grid);
    return sec;
  }));
}

function roomCard(r) {
  const st = stateOf(r), card = el('article', `team-room is-${st}`);
  const head = el('header', 'team-room-h');
  const ava = el('span', 'team-ava', [...(r.member.name || '?')][0].toUpperCase());
  ava.style.background = PALETTE[hash(r.member.id) % PALETTE.length];
  const names = el('div', 'team-room-names');
  names.append(el('b', null, r.member.name), el('small', null, st === 'offline' ? tr('team.offline') : counts(r.counts)));
  const badge = el('span', `team-badge is-${st}`);
  badge.append(icon(st === 'open' ? 'door' : st === 'shared' ? 'users' : st === 'closed' ? 'lock' : 'moon'), document.createTextNode(tr(st === 'open' ? 'team.roomOpen' : st === 'shared' ? 'team.roomShared' : st === 'closed' ? 'team.roomClosed' : 'team.offline')));
  head.append(ava, names, badge);
  card.append(head);
  if (st === 'closed') card.append(el('p', 'team-closed', tr('team.closedNote')));
  const access = knockBlock(r, st);   // (closed: knock to ask; let in: for how long)
  if (access) card.append(access);
  if (seesIn(st)) {
    const people = r.people || [];
    if (!people.length) card.append(el('p', 'team-closed', tr('team.nobody')));
    const list = el('ul', 'team-people');
    for (const p of people) {
      const li = el('li', `team-person is-${p.status}`);
      const dot = el('i', 'team-dot');
      const who = el('div', 'team-who');
      who.append(el('b', null, [p.role, p.project].filter(Boolean).join(' · ') || tr('common.session')));
      const what = el('small');
      if (p.act && p.status !== 'rest') { what.append(icon(TYPE_ICON[p.act] || 'sparkle')); what.append(document.createTextNode(p.label ? `${actText(p.act)}: ${p.label}` : actText(p.act))); }
      else what.textContent = tr(`team.status.${p.status}`);
      who.append(what);
      li.append(dot, who);
      if (p.subs) li.append(el('span', 'team-subs', tr('team.subs', { n: p.subs })));
      list.append(li);
    }
    card.append(list);
    const e = latest(r);
    if (e) {
      const line = el('p', 'team-last');
      line.append(icon(TYPE_ICON[e.type] || 'sparkle'), document.createTextNode(`${e.label ? `${actText(e.type)}: ${e.label}` : actText(e.type)} · ${ago(e.ts)}`));
      card.append(line);
    }
  }
  return card;
}

export function setup() {
  modal = $('team-modal'); if (!modal) return;
  for (const n of modal.querySelectorAll('[data-icon]')) if (!n.firstChild) n.append(icon(n.dataset.icon));
  const btn = $('btn-team');
  for (const n of btn?.querySelectorAll('[data-icon]') || []) if (!n.firstChild) n.append(icon(n.dataset.icon));
  btn?.addEventListener('click', () => (isOpen() ? close() : open()));
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
  for (const b of modal.querySelectorAll('.team-seg-b')) b.addEventListener('click', () => { if (!b.classList.contains('is-sel')) setMine(b.dataset.mode); });
  $('team-policy-in')?.addEventListener('change', (e) => setDetails(e.target.checked));
  $('team-convo-in')?.addEventListener('change', (e) => setLog(e.target.checked));
  $('team-upd-b')?.addEventListener('click', requireUpdate);
  setApply(onTeam); setJoinApply(onTeam); setMembersApply(onTeam);
  // "N min ago" stays true while the building is open
  setInterval(() => { if (isOpen()) render(); }, 30_000);
}
