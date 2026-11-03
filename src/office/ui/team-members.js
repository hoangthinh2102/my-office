// Team mode's members, in the building panel (markup: TeamModal.tsx): who is in the team and who is an admin. Admins
// make a member an admin and take members (never another admin) out; an admin stops being one only themselves, and
// the last admin can't. The hub keeps the rules (hub/src/core.js); this computer's server passes the calls on
// (POST /api/team/member). Taking someone out and making someone an admin both ask for a second click.
import { state } from '../core/state.js';
import { $, el } from '../core/env.js';
import { PALETTE, hash } from '../people/workers.js';
import { toast } from './activity.js';
import { post } from './team-access.js';
import { t as tr } from '../../i18n/index.js';

let apply = () => {}, demo = null, armed = null, armTimer = null, busy = false;
/** team.js hands over how to show a new team state (its onTeam). */
export function setApply(fn) { apply = fn; }
/** Demo mode answers these calls itself: fn(action, member) -> what the server would. */
export function setDemoMembers(fn) { demo = fn; }
const local = () => !!state.isLocal || !!demo;
const errText = (code) => {
  for (const k of [`team.members.err.${code}`, `team.access.err.${code}`]) { const s = tr(k); if (s !== k) return s; }
  return tr('team.members.failed', { why: code });
};

async function act(action, m) {
  if (busy) return;
  busy = true; disarm();
  try {
    const j = demo ? demo(action, m.id) : await post('/api/team/member', { action, member: m.id });
    if (!j.ok) throw new Error(j.code || 'error');
    if (j.team) apply(j.team);
    toast(tr(`team.members.done.${action}`, { name: m.name }));
  } catch (e) { toast(errText(e.message), 6000); } finally { busy = false; fillMembers(state.team); }
}
// the first click turns the button into "click again to …" for a few seconds
function disarm() { armed = null; clearTimeout(armTimer); }
function twoStep(action, m) {
  const key = `${action}:${m.id}`;
  if (armed === key) { act(action, m); return; }
  disarm(); armed = key;
  armTimer = setTimeout(() => { armed = null; fillMembers(state.team); }, 5000);
  fillMembers(state.team);
}

function button(label, cls, onClick, { disabled = false, title = '' } = {}) {
  const b = el('button', `team-mem-b ${cls}`, label); b.type = 'button';
  b.disabled = disabled || !local() || busy; b.title = !local() ? tr('team.mine.phone') : title;
  b.addEventListener('click', onClick);
  return b;
}

/** The members list, as the hub last told this computer. */
export function fillMembers(t) {
  const box = $('team-members'); if (!box) return;
  const list = Array.isArray(t?.members) ? t.members : [];
  box.hidden = !t?.inTeam || !list.length;
  if (box.hidden) return;
  const meId = t.me?.id, iAdmin = !!t.me?.owner, admins = list.filter((m) => m.role === 'admin').length;
  $('team-members-n').textContent = tr('team.members.count', { n: list.length, a: admins });
  $('team-members-note').textContent = iAdmin ? tr('team.members.noteAdmin') : tr('team.members.note');
  const rows = [...list].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : (a.role === 'admin') === (b.role === 'admin') ? a.name.localeCompare(b.name) : a.role === 'admin' ? -1 : 1));
  $('team-members-list').replaceChildren(...rows.map((m) => {
    const li = el('li', 'team-mem'), me = m.id === meId, admin = m.role === 'admin';
    const ava = el('span', 'team-ava', [...(m.name || '?')][0].toUpperCase());
    ava.style.background = PALETTE[hash(m.id) % PALETTE.length];
    const who = el('span', 'team-mem-who');
    who.append(el('b', null, m.name));
    if (me) who.append(el('small', null, tr('team.members.you')));
    if (admin) who.append(el('span', 'team-owner', tr('team.owner')));
    const acts = el('span', 'team-mem-acts');
    if (me && admin) {
      const last = admins <= 1;
      acts.append(armed === `stepdown:${m.id}`
        ? button(tr('team.members.confirmStepdown'), 'is-warn', () => twoStep('stepdown', m))
        : button(tr('team.members.stepdown'), '', () => twoStep('stepdown', m), { disabled: last, title: last ? tr('team.members.lastAdmin') : '' }));
    } else if (iAdmin && !me && !admin) {
      acts.append(armed === `promote:${m.id}`
        ? button(tr('team.members.confirmPromote'), 'is-yes', () => twoStep('promote', m))
        : button(tr('team.members.promote'), '', () => twoStep('promote', m)));
      acts.append(armed === `remove:${m.id}`
        ? button(tr('team.members.confirmRemove', { name: m.name }), 'is-warn', () => twoStep('remove', m))
        : button(tr('team.members.remove'), 'is-quiet', () => twoStep('remove', m)));
    } else if (iAdmin && !me && admin) acts.append(el('small', 'team-mem-hint', tr('team.members.otherAdmin')));
    li.append(ava, who, acts);
    return li;
  }));
}
