// The side columns while you look at someone else's room in the building (headquarters plan; markup: SessionRail.tsx
// #team-rail, ActivityPanel.tsx #team-feed): a click on a room or on someone in it (ui/team-lift.js) turns the left
// column into that room's sessions and the right one into its activity, view only, as the hub sent them (an open room:
// who is in and what they do, labels only when the team's details setting is on; a closed one: how many, and the knock).
// "Yours" at the top of either goes back to your own; so does leaving that floor.
import { $, el } from '../core/env.js';
import { icon, TYPE_ICON } from './icons.js';
import { towerRoom, view } from '../world/team-tower.js';
import { seesIn, stateOf } from '../../shared/team-floors.js';
import { knockBlock } from './team-access.js';
import { PALETTE, hash } from '../people/workers.js';
import { t as tr } from '../../i18n/index.js';

let at = null;   // { floor, i }: whose room the columns show, or null (your own)

/** Show room i of floor `floor` in the side columns. */
export function showTeamSide(floor, i) { at = { floor, i }; render(); }
/** Back to your own sessions and activity. */
export function closeTeamSide() { if (!at) return; at = null; render(); }
/** The relay's state changed (ui/team-lift.js syncLift): the room shown follows it. */
export function refreshTeamSide() { if (at) render(); }
export const teamSideAt = () => (at ? { ...at } : null);

const act = (type) => (tr(`team.act.${type}`) === `team.act.${type}` ? tr('team.act.other') : tr(`team.act.${type}`));
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const nameOf = (p) => p?.project || p?.role || tr('common.session');

function render() {
  const r = at && view.mode === 'floor' && view.floor === at.floor ? towerRoom(at.floor, at.i) : null;
  if (!r) at = null;
  for (const [side, box] of [[document.querySelector('.side-left'), $('team-rail')], [$('feed'), $('team-feed')]]) {
    side?.classList.toggle('is-team-side', !!r);
    if (box) box.hidden = !r;
  }
  if (!r) return;
  const st = stateOf(r), sees = seesIn(st), people = sees ? r.people || [] : [];
  $('team-rail')?.replaceChildren(head(r, tr('team.card.room', { name: r.member.name })), ...railBody(r, st, sees, people));
  $('team-feed')?.replaceChildren(head(r, tr('team.side.feed', { name: r.member.name })), feedBody(r, sees, people));
}
function head(r, title) {
  const h = el('header', 'ts-head');
  const back = el('button', 'ts-back'); back.type = 'button'; back.title = tr('team.side.backTitle');
  back.append(icon('chevron'), el('span', null, tr('team.side.back')));
  back.addEventListener('click', closeTeamSide);
  const ava = el('span', 'team-ava', [...(r.member.name || '?')][0].toUpperCase()); ava.style.background = PALETTE[hash(r.member.id) % PALETTE.length];
  const names = el('div', 'ts-names'); names.append(el('b', null, title), el('small', null, tr('team.side.sub', { n: at.floor })));
  const row = el('div', 'ts-who'); row.append(ava, names);
  h.append(back, row);
  return h;
}
function railBody(r, st, sees, people) {
  const c = r.counts || {}, out = [];
  const counts = el('p', 'ts-counts'); counts.textContent = st === 'offline' ? tr('team.offline') : tr('team.counts', { work: c.work || 0, wait: c.wait || 0, rest: c.rest || 0 });
  out.push(counts);
  if (!sees) {
    if (st === 'closed') out.push(el('p', 'ts-note', tr('team.side.closed')));
    const k = knockBlock(r, st); if (k) out.push(k);
    return out;
  }
  const ul = el('ul', 'ts-list');
  if (!people.length) ul.append(el('li', 'ts-empty', tr('team.side.none')));
  const order = { wait: 0, work: 1, rest: 2 };
  for (const p of [...people].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))) {
    const li = el('li', `ts-p is-${p.status}`);
    const top = el('div', 'ts-p-top'); top.append(el('i', 'ts-dot'), el('b', null, nameOf(p)));
    if (p.subs) top.append(el('span', 'ts-subs', tr('team.subs', { n: p.subs })));
    const what = el('p', 'ts-p-act');
    if (p.status === 'work' && p.act) what.append(icon(TYPE_ICON[p.act] || 'sparkle'), document.createTextNode(p.label ? `${act(p.act)}: ${p.label}` : act(p.act)));
    else what.textContent = tr(`team.status.${p.status}`);
    li.append(top, what);
    if (p.role && p.project) li.append(el('small', 'ts-p-role', p.role));
    ul.append(li);
  }
  out.push(ul);
  return out;
}
function feedBody(r, sees, people) {
  const ul = el('ul', 'ts-list ts-feed');
  if (!sees) { ul.append(el('li', 'ts-empty', tr('team.side.closed'))); return ul; }
  const byId = new Map(people.map((p) => [p.id, p]));
  const list = [...(r.events || [])].sort((a, b) => b.ts - a.ts);
  if (!list.length) ul.append(el('li', 'ts-empty', tr('team.side.empty')));
  for (const e of list) {
    const li = el('li', `ts-ev is-${e.type}`);
    li.append(icon(TYPE_ICON[e.type] || 'sparkle'));
    const txt = el('div', 'ts-ev-t'); txt.append(el('b', null, nameOf(byId.get(e.p))), el('span', null, e.label ? `${act(e.type)}: ${e.label}` : act(e.type)));
    li.append(txt, el('time', null, hhmm(e.ts)));
    ul.append(li);
  }
  return ul;
}
