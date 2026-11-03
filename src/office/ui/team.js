// Team mode's building (the building button in the top bar; markup: src/components/office/TeamModal.tsx): your own room,
// which you can open, close or pause from this computer, and everyone else's rooms floor by floor, view only. What it
// shows comes from the server's relay (server/team/relay.mjs) in the live stream ({k:'team'}), or from demo mode.
import { state } from '../core/state.js';
import { $, el, fmtAgo, nowMs } from '../core/env.js';
import { TOKEN } from '../net/live.js';
import { PALETTE, hash } from '../people/workers.js';
import { TYPE_ICON, icon } from './icons.js';
import { toast } from './activity.js';
import { floorsOf, latest, stateOf } from '../../shared/team-floors.js';
import { t as tr } from '../../i18n/index.js';

let modal, demoSet = null;
const isOpen = () => modal && !modal.hidden;
const team = () => state.team || null;

/** The relay's state ({ inTeam, team, me, room, connected, policy, rooms }), from the stream or demo mode. */
export function onTeam(t) {
  state.team = t || null;
  const btn = $('btn-team');
  if (btn) btn.hidden = !t?.inTeam;
  if (!t?.inTeam && isOpen()) close();
  if (isOpen()) render();
}
/** Demo mode changes its own pretend room instead of asking the server. */
export function setDemoRoom(fn) { demoSet = fn; }

function open() { if (!team()?.inTeam) return; modal.hidden = false; $('btn-team')?.setAttribute('aria-pressed', 'true'); render(); }
function close() { modal.hidden = true; $('btn-team')?.setAttribute('aria-pressed', 'false'); }

async function setMine(mode) {
  const body = mode === 'paused' ? { paused: true } : team()?.room?.paused ? { paused: false } : { mode };
  if (demoSet) { demoSet(mode); return; }
  try {
    // resuming keeps the room's mode; a click on open or closed while paused resumes first, then sets it
    let r = await fetch(`/api/team/room${TOKEN ? `?k=${encodeURIComponent(TOKEN)}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = await r.json();
    if (j.ok && body.paused === false) {
      r = await fetch(`/api/team/room${TOKEN ? `?k=${encodeURIComponent(TOKEN)}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      j = await r.json();
    }
    if (!j.ok) throw new Error(j.code || j.message || r.status);
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
  $('team-sub').textContent = t.room?.paused ? tr('team.sub.paused') : t.connected ? tr('team.sub.on', { n: t.rooms.length }) : tr('team.sub.off');
  // your room
  const mine = t.room?.paused ? 'paused' : t.room?.mode === 'open' ? 'open' : 'closed', local = !!state.isLocal || !!demoSet;
  for (const b of modal.querySelectorAll('.team-seg-b')) {
    b.classList.toggle('is-sel', b.dataset.mode === mine);
    b.setAttribute('aria-pressed', String(b.dataset.mode === mine));
    b.disabled = !local;
  }
  $('team-mine-note').textContent = local ? tr(`team.mine.${mine}Hint`) : `${tr(`team.mine.${mine}Hint`)} ${tr('team.mine.phone')}`;
  // everyone else's, floor by floor
  const box = $('team-floors'), floors = floorsOf(t.rooms);
  if (!floors.length) { box.replaceChildren(el('p', 'team-empty', tr('team.empty'))); return; }
  box.replaceChildren(...floors.map((f) => {
    const sec = el('section', 'team-floor');
    sec.append(el('h3', 'team-floor-h', tr('team.floor', { n: f.n })));
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
  badge.append(icon(st === 'open' ? 'door' : st === 'closed' ? 'lock' : 'moon'), document.createTextNode(st === 'open' ? tr('team.roomOpen') : st === 'closed' ? tr('team.roomClosed') : tr('team.offline')));
  head.append(ava, names, badge);
  card.append(head);
  if (st === 'closed') card.append(el('p', 'team-closed', tr('team.closedNote')));
  if (st === 'open') {
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
  // "N min ago" stays true while the building is open
  setInterval(() => { if (isOpen()) render(); }, 30_000);
}
