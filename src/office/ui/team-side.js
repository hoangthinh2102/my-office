// The side columns while you look at someone else's room in the building (headquarters plan; markup: SessionRail.tsx
// #team-rail, ActivityPanel.tsx #team-feed): a click on a room or on someone in it (ui/team-lift.js) turns the left
// column into that room's sessions and the right one into its activity, view only, as the hub sent them (an open room:
// who is in and what they do, labels only when the team's details setting is on; a closed one: how many, and the knock).
// The activity is grouped by session like your own, with the same kind filters; a click on a session on the left shows
// only its activity (again: all of it). When the room's owner lets their sessions' conversations be read (room.log),
// each session has "Read the conversation" (ui/team-log.js). "Yours" at the top of either goes back to your own; so
// does leaving that floor.
import { $, el } from '../core/env.js';
import { icon, TYPE_ICON, TYPE_TONE } from './icons.js';
import { towerRoom, view } from '../world/team-tower.js';
import { seesIn, stateOf } from '../../shared/team-floors.js';
import { knockBlock } from './team-access.js';
import { cap } from './activity.js';
import { verb } from './event-text.js';
import { openTeamLog, syncTeamLog } from './team-log.js';
import { PALETTE, hash } from '../people/workers.js';
import { t as tr } from '../../i18n/index.js';

let at = null;         // { floor, i }: whose room the columns show, or null (your own)
let only = null;       // a session's id there: the activity shows only its own
const kinds = new Set();   // the activity's kind filters (as your own: activity.js KIND)
const KIND = { cmd: ['bash', 'command', 'test', 'testok', 'testfail', 'deploy', 'commit', 'push', 'ci'], edit: ['edit', 'write'], read: ['read', 'grep', 'glob', 'skill'], web: ['web', 'fetch', 'mcp'], agent: ['agent', 'substart', 'substop'] };
const KIND_ICON = { cmd: 'terminal', edit: 'pencil', read: 'file', web: 'globe', agent: 'users' };
const GROUP_MS = 240e3;   // events of one session this close together are one card (as your own)

/** Show room i of floor `floor` in the side columns. */
export function showTeamSide(floor, i) {
  if (!at || at.floor !== floor || at.i !== i) { only = null; kinds.clear(); }
  at = { floor, i }; render();
}
/** Back to your own sessions and activity. */
export function closeTeamSide() { if (!at) return; at = null; only = null; render(); }
/** The relay's state changed (ui/team-lift.js syncLift): the room shown follows it. */
export function refreshTeamSide() { if (at) render(); }
export const teamSideAt = () => (at ? { ...at } : null);

const act = (type) => (tr(`team.act.${type}`) === `team.act.${type}` ? tr('team.act.other') : tr(`team.act.${type}`));
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const nameOf = (p) => p?.project || p?.role || tr('common.session');
const evText = (e) => (e.label ? cap(verb(e)) : act(e.type));

function render() {
  const r = at && view.mode === 'floor' && view.floor === at.floor ? towerRoom(at.floor, at.i) : null;
  if (!r) at = null;
  syncTeamLog();
  for (const [side, box] of [[document.querySelector('.side-left'), $('team-rail')], [$('feed'), $('team-feed')]]) {
    side?.classList.toggle('is-team-side', !!r);
    if (box) box.hidden = !r;
  }
  if (!r) return;
  const st = stateOf(r), sees = seesIn(st), people = sees ? r.people || [] : [];
  if (only && !people.some((p) => p.id === only)) only = null;
  $('team-rail')?.replaceChildren(head(r, tr('team.card.room', { name: r.member.name })), ...railBody(r, st, sees, people));
  $('team-feed')?.replaceChildren(head(r, tr('team.side.feed', { name: r.member.name })), ...feedBody(r, sees, people));
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
  out.push(el('p', 'ts-counts', st === 'offline' ? tr('team.offline') : tr('team.counts', { work: c.work || 0, wait: c.wait || 0, rest: c.rest || 0 })));
  if (!sees) {
    if (st === 'closed') out.push(el('p', 'ts-note', tr('team.side.closed')));
    const k = knockBlock(r, st); if (k) out.push(k);
    return out;
  }
  if (r.log) out.push(el('p', 'ts-note ts-log-note', tr('team.side.logOn')));
  const ul = el('ul', 'ts-list');
  if (!people.length) ul.append(el('li', 'ts-empty', tr('team.side.none')));
  const order = { wait: 0, work: 1, rest: 2 };
  for (const p of [...people].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))) {
    const li = el('li', `ts-p is-${p.status}${only === p.id ? ' is-sel' : ''}`);
    // the session itself: a click shows only its activity on the right (again: all of it)
    const pick = el('button', 'ts-p-pick'); pick.type = 'button'; pick.setAttribute('aria-pressed', String(only === p.id));
    pick.title = tr(only === p.id ? 'team.side.showAll' : 'team.side.showOnly');
    pick.addEventListener('click', () => { only = only === p.id ? null : p.id; render(); });
    const top = el('span', 'ts-p-top'); top.append(el('i', 'ts-dot'), el('b', null, nameOf(p)));
    if (p.subs) top.append(el('span', 'ts-subs', tr('team.subs', { n: p.subs })));
    const what = el('span', 'ts-p-act');
    if (p.status === 'work' && p.act) what.append(icon(TYPE_ICON[p.act] || 'sparkle'), document.createTextNode(p.label ? `${act(p.act)}: ${p.label}` : act(p.act)));
    else what.textContent = tr(`team.status.${p.status}`);
    pick.append(top, what);
    if (p.role && p.project) pick.append(el('small', 'ts-p-role', p.role));
    li.append(pick);
    if (r.log) {
      const read = el('button', 'ts-read'); read.type = 'button';
      read.append(icon('chat'), el('span', null, tr('team.side.read')));
      read.addEventListener('click', () => openTeamLog(r, p));
      li.append(read);
    }
    ul.append(li);
  }
  out.push(ul);
  return out;
}
function feedBody(r, sees, people) {
  if (!sees) return [listOf([el('li', 'ts-empty', tr('team.side.closed'))])];
  const byId = new Map(people.map((p) => [p.id, p]));
  // the filters: one session (from the left), and kinds of thing (as your own column)
  const bar = el('div', 'type-chips ts-chips');
  if (only) {
    const all = el('button', 'ts-only'); all.type = 'button';
    all.append(el('span', null, tr('team.side.onlyOf', { name: nameOf(byId.get(only)) })), icon('x'));
    all.title = tr('team.side.showAll'); all.addEventListener('click', () => { only = null; render(); });
    bar.append(all);
  }
  for (const k of Object.keys(KIND)) {
    const b = el('button'); b.type = 'button'; b.dataset.k = k; b.setAttribute('aria-pressed', String(kinds.has(k)));
    b.append(icon(KIND_ICON[k]), document.createTextNode(tr(`ui.activityPanel.${k}`)));
    b.addEventListener('click', () => { if (kinds.has(k)) kinds.delete(k); else kinds.add(k); render(); });
    bar.append(b);
  }
  const ok = (e) => (!only || e.p === only) && (!kinds.size || [...kinds].some((k) => KIND[k].includes(e.type)));
  const list = [...(r.events || [])].filter(ok).sort((a, b) => b.ts - a.ts);
  const rows = [];
  if (!list.length) rows.push(el('li', 'ts-empty', tr(kinds.size || only ? 'team.side.emptyFilter' : 'team.side.empty')));
  // one card per run of a session's events close together, newest first (as your own column)
  const groups = [];
  for (const e of list) {
    const g = groups[groups.length - 1];
    if (g && g.p === e.p && g.items[g.items.length - 1].ts - e.ts < GROUP_MS) g.items.push(e); else groups.push({ p: e.p, items: [e] });
  }
  const latest = new Map(); for (const e of [...(r.events || [])].sort((a, b) => a.ts - b.ts)) latest.set(e.p, e);
  for (const g of groups) {
    const p = byId.get(g.p), first = g.items[0], live = p?.status === 'work' && latest.get(g.p) === first;
    const li = el('li', 'fg'), card = el('div', `fg-card ts-card${live ? ' fg--live' : ''}`);
    const h = el('span', 'fg-head'), dot = el('i'); dot.style.background = PALETTE[hash(g.p) % PALETTE.length];
    h.append(dot, el('b', null, nameOf(p)));
    if (live) h.append(el('span', 'fg-live', tr('activity.working')));
    h.append(el('time', null, hhmm(first.ts)));
    const lines = el('span', 'fg-lines');
    for (const e of g.items.slice(0, 4)) {
      const ln = el('span', 'fg-line'), ic = el('span', 'fi-ico');
      ic.append(icon(TYPE_ICON[e.type] || 'sparkle')); if (TYPE_TONE[e.type]) ic.dataset.tone = TYPE_TONE[e.type];
      ln.append(ic, el('span', 'fg-text', evText(e)));
      lines.append(ln);
    }
    if (g.items.length > 4) lines.append(el('span', 'fg-more', tr('activity.more', { n: g.items.length - 4 })));
    card.append(h, lines); li.append(card); rows.push(li);
  }
  return [bar, listOf(rows)];
}
function listOf(rows) { const ul = el('ul', 'ts-list ts-feed feed-list'); ul.append(...rows); return ul; }
