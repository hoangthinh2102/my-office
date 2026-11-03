// Team mode without the command line: the team's creator makes an invite link in the building panel, and someone not
// in a team yet joins with one in Settings → More (markup: TeamModal.tsx, SettingsPanel.tsx). Both go through this
// computer's server (POST /api/team/invite, POST /api/team/join), which only answers the computer the office runs on.
import { state } from '../core/state.js';
import { $, el } from '../core/env.js';
import { icon } from './icons.js';
import { toast } from './activity.js';
import { post } from './team-access.js';
import { t as tr } from '../../i18n/index.js';

let apply = () => {}, lastInvite = null;
/** team.js hands over how to show a new team state (its onTeam). */
export function setApply(fn) { apply = fn; }
const demo = () => state.team?.team?.id === 'demo';
const local = () => !!state.isLocal || demo();
const clock = (ms) => new Date(ms).toLocaleTimeString(tr('team.access.locale'), { hour: '2-digit', minute: '2-digit' });
const errText = (code) => {
  for (const k of [`team.join.err.${code}`, `team.access.err.${code}`]) { const s = tr(k); if (s !== k) return s; }
  return tr('team.join.failed', { why: code });
};

/** Follows the team state: the invite block in the panel, the join form in Settings. */
export function syncJoin(t) {
  const inTeam = !!t?.inTeam, owner = !!t?.me?.owner;
  // the building panel: only the team's creator invites
  const make = $('team-invite-make');
  if (make) {
    make.hidden = !owner; make.disabled = !local();
    make.title = local() ? '' : tr('team.mine.phone');
    $('team-invite-note').textContent = owner ? tr('team.join.inviteNote') : tr('team.join.ownerOnly');
    const out = $('team-invite-out');
    if (owner && lastInvite && lastInvite.expiresAt > Date.now()) {
      out.hidden = false;
      const link = el('code', 'team-invite-link', lastInvite.invite);
      const copy = el('button', 'team-code-copy'); copy.type = 'button'; copy.append(icon('clipboard')); copy.title = tr('team.access.copy');
      copy.addEventListener('click', () => navigator.clipboard?.writeText(lastInvite.invite).then(() => toast(tr('team.join.copied')), () => {}));
      out.replaceChildren(link, copy, el('small', null, tr('team.join.linkNote', { time: clock(lastInvite.expiresAt) })));
    } else { out.hidden = true; out.replaceChildren(); }
  }
  // Settings → More: join with a link, or which team you are in
  const box = $('st-team'); if (!box) return;
  $('st-team-in').hidden = !inTeam;
  if (inTeam) $('st-team-name-now').textContent = tr('team.join.youAreIn', { team: t.team?.name || '', name: t.me?.name || '' });
  $('st-team-join').hidden = inTeam || !local();
  $('st-team-phone').hidden = inTeam || local();
}

async function makeInvite() {
  if (demo()) { lastInvite = { invite: 'https://my-office-hub.example.workers.dev/j/demo.DEMO-INVITE', expiresAt: Date.now() + 15 * 60e3 }; syncJoin(state.team); return; }
  try { const j = await post('/api/team/invite', {}); lastInvite = { invite: j.invite, expiresAt: j.expiresAt }; syncJoin(state.team); } catch (e) { toast(errText(e.message)); }
}

async function join(e) {
  e.preventDefault();
  const link = $('st-team-link').value.trim(), name = $('st-team-name').value.trim(), go = $('st-team-go');
  if (!link) { $('st-team-link').focus(); return; }
  go.disabled = true;
  try {
    const j = await post('/api/team/join', { link, name });
    $('st-team-link').value = ''; $('st-team-name').value = '';
    apply(j.team);
    toast(tr('team.join.joined', { team: j.team?.team?.name || '', name: j.team?.me?.name || '' }), 5000);
  } catch (err) { toast(errText(err.message), 5000); } finally { go.disabled = false; }
}

export function setup() {
  for (const n of document.querySelectorAll('#st-team [data-icon], #team-invite [data-icon]')) if (!n.firstChild) n.append(icon(n.dataset.icon));
  $('team-invite-make')?.addEventListener('click', makeInvite);
  $('st-team-join')?.addEventListener('submit', join);
  $('st-team-open')?.addEventListener('click', () => { $('st-close')?.click(); $('btn-team')?.click(); });
  syncJoin(state.team);
}
