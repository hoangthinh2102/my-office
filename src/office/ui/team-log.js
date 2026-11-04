// Read one session's conversation in someone else's room (team mode; markup: src/components/office/TeamLogDrawer.tsx):
// only when that room's owner lets it be read (room.log, their switch in the Team window or `my-office team room log`)
// and you may see the room. Your server asks the hub, the hub asks their computer, and their computer sends the last
// part of it (secrets masked, long texts cut) to you alone: nothing is kept on the hub. Read only, refreshed while open.
import { $, el } from '../core/env.js';
import { buildChat } from './session-drawer.js';
import { icon } from './icons.js';
import { view } from '../world/team-tower.js';
import { state } from '../core/state.js';
import { seesIn, stateOf } from '../../shared/team-floors.js';
import { t as tr } from '../../i18n/index.js';

const EVERY_MS = 10_000;
let dr = null, at = null, timer = 0, busy = false, demoLog = null;   // at: { floor, room (member id), p, name, owner }

/** Demo mode answers with its own made-up conversation. */
export function setDemoLog(fn) { demoLog = fn; }

/** Open session `p` of room `r` (a hub room view, ui/team-side.js). */
export function openTeamLog(r, p) {
  if (!dr) return;
  at = { floor: view.floor, room: r.member.id, p: p.id, name: p.project || p.role || tr('common.session'), owner: r.member.name };
  $('tc-name').textContent = at.name;
  $('tc-sub').textContent = tr('team.log.sub', { name: at.owner });
  $('tc-body').replaceChildren(el('p', 'muted tc-wait', tr('team.log.loading')));
  dr.hidden = false;
  for (const id of ['dr-session', 'dr-mac']) if ($(id)) $(id).hidden = true;   // (one drawer at a time)
  load(true);
  clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(false); }, EVERY_MS);
}
export function closeTeamLog() { if (!dr || dr.hidden) return; dr.hidden = true; at = null; clearInterval(timer); timer = 0; }
export const teamLogOpen = () => !!(dr && !dr.hidden);

// still allowed? (the room's owner may have turned it off, closed the room, gone offline, or you left the floor)
function room() {
  if (!at || view.mode !== 'floor' || view.floor !== at.floor) return null;
  return (state.team?.rooms || []).find((r) => r.member.id === at.room) || null;
}
/** The relay's state or the view changed (ui/team-side.js): close when the conversation can't be read any more. */
export function syncTeamLog() {
  if (!teamLogOpen()) return;
  const r = room();
  if (!r || !r.log || !seesIn(stateOf(r))) { closeTeamLog(); return; }
  if (!(r.people || []).some((p) => p.id === at.p)) note(tr('team.log.gone'));
}

async function load(first) {
  if (!at || busy) return;
  busy = true;
  const want = at;
  try {
    const j = demoLog ? demoLog(want.room, want.p)
      : await (await fetch(`/api/team/log?room=${encodeURIComponent(want.room)}&p=${encodeURIComponent(want.p)}`, { cache: 'no-store' })).json();
    if (at !== want) return;
    if (!j?.ok) { if (first || j?.error !== 'busy') note(errText(j?.error)); return; }
    show(j.items || [], first);
  } catch { if (at === want) note(errText('offline')); } finally { busy = false; }
}
const errText = (code) => (tr(`team.log.err.${code}`) === `team.log.err.${code}` ? tr('team.log.err.other') : tr(`team.log.err.${code}`));

function show(items, first) {
  const body = $('tc-body'), end = first || body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  const chat = buildChat(items, 'Claude', at.owner);
  const stamp = el('p', 'tc-stamp', tr('team.log.updated', { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));
  body.replaceChildren(chat, stamp);
  if (end) body.scrollTop = body.scrollHeight;
}
function note(text) {
  const body = $('tc-body');
  body.querySelector('.tc-err')?.remove();
  const p = el('p', 'tc-err'); p.append(icon('alert'), document.createTextNode(text));
  body.prepend(p);
}

export function setup() {
  dr = $('dr-team-log'); if (!dr) return;
  for (const n of dr.querySelectorAll('[data-icon]')) if (!n.firstChild) n.append(icon(n.dataset.icon));
  $('tc-close')?.addEventListener('click', closeTeamLog);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && teamLogOpen()) closeTeamLog(); });
}
