// Team mode's members, in the building panel (markup: TeamModal.tsx): who is in the team and who is an admin. Admins
// make a member an admin and take members (never another admin) out; an admin stops being one only themselves, and
// the last admin can't. The hub keeps the rules (hub/src/core.js); this computer's server passes the calls on
// (POST /api/team/member). Taking someone out and making someone an admin both ask for a second click. Everyone can
// change their own name (Rename on their own row), nobody else's.
import { state } from '../core/state.js';
import { $, el } from '../core/env.js';
import { PALETTE, hash } from '../people/workers.js';
import { toast } from './activity.js';
import { post } from './team-access.js';
import { t as tr } from '../../i18n/index.js';
import { NAME_MAX, cleanName } from '../../../shared/team-protocol.js';

let apply = () => {}, demo = null, armed = null, armTimer = null, busy = false;
// your own name being changed: the list isn't drawn again meanwhile, so what you type stays put
let editing = false;
/** team.js hands over how to show a new team state (its onTeam). */
export function setApply(fn) { apply = fn; }
/** Demo mode answers these calls itself: fn(action, member, name) -> what the server would. */
export function setDemoMembers(fn) { demo = fn; }
const local = () => !!state.isLocal || !!demo;
const errText = (code) => {
  for (const k of [`team.members.err.${code}`, `team.access.err.${code}`]) { const s = tr(k); if (s !== k) return s; }
  return tr('team.members.failed', { why: code });
};

async function act(action, m, name) {
  if (busy) return false;
  busy = true; disarm();
  let ok = false;
  try {
    const j = demo ? demo(action, m.id, name) : await post('/api/team/member', action === 'rename' ? { action, name } : { action, member: m.id });
    if (!j.ok) throw new Error(j.code || 'error');
    if (action === 'rename') editing = false;
    if (j.team) apply(j.team);
    toast(tr(`team.members.done.${action}`, { name: action === 'rename' ? name : m.name }));
    ok = true;
  } catch (e) { toast(errText(e.message), 6000); } finally { busy = false; fillMembers(state.team); }
  return ok;
}
// your own row while renaming: a field with your name, Save and Cancel (Enter, Esc)
function renameRow(m) {
  const form = el('form', 'team-mem-rename');
  const field = el('input', 'team-mem-in'); field.type = 'text'; field.maxLength = NAME_MAX; field.value = m.name; field.autocomplete = 'off';
  field.setAttribute('aria-label', tr('team.members.renameLabel'));
  const save = button(tr('team.members.save'), 'is-yes', () => {}); save.type = 'submit';
  const cancel = button(tr('team.members.cancel'), 'is-quiet', () => stopEditing());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = cleanName(field.value);
    if (!name || name === m.name) { stopEditing(); return; }
    save.disabled = true;
    if (!(await act('rename', m, name))) { save.disabled = false; field.focus(); }   // (the field keeps what you typed)
  });
  field.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); stopEditing(); } });
  form.append(field, save, cancel);
  requestAnimationFrame(() => { field.focus(); field.select(); });
  return form;
}
function stopEditing() { editing = false; fillMembers(state.team, true); }
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

/** The members list, as the hub last told this computer (not while you are typing a new name, unless `force`). */
export function fillMembers(t, force = false) {
  const box = $('team-members'); if (!box) return;
  if (editing && !force && box.querySelector('.team-mem-rename')) return;
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
    if (me && editing) { li.classList.add('is-editing'); li.append(ava, renameRow(m)); return li; }
    if (me) acts.append(button(tr('team.members.rename'), 'is-quiet', () => { disarm(); editing = true; fillMembers(state.team, true); }));
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
