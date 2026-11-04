// This office keeping itself up to date (server/updater.mjs; the live stream's {k:'update'}): a bar over the stage
// while a newer version is waiting or being installed, a note after it was, and what to do when it can't update on its
// own while the team requires a newer version. The page reloads itself once the new version runs (demo.js: build).
import { $, el } from '../core/env.js';
import { icon } from './icons.js';
import { toast } from './activity.js';
import { t as tr } from '../../i18n/index.js';

let bar = null, last = null, shut = '';
const SEEN = 'office-update-seen';

/** The updater's state: { build, latest, min, held, status, why, toBuild, at }. */
export function onUpdate(u) {
  last = u || null;
  if (!u) { show(null); return; }
  if (u.status === 'done') {   // (once per update: the page reloaded into it)
    let seen = ''; try { seen = localStorage.getItem(SEEN) || ''; } catch { /* storage blocked */ }
    if (seen !== String(u.at)) { toast(tr('ui.update.done', { n: u.toBuild || u.build }), 6000); try { localStorage.setItem(SEEN, String(u.at)); } catch { /* ignore */ } }
    show(null); return;
  }
  if (u.status === 'waiting') show('wait', tr('ui.update.waiting', { n: u.toBuild }));
  else if (u.status === 'running') show('run', tr('ui.update.running', { n: u.toBuild }));
  else if (u.status === 'failed') show('bad', tr(u.held ? 'ui.update.failedHeld' : 'ui.update.failed', { why: why(u.why), min: u.min, build: u.build }), !u.held);
  else if (u.held && (u.status === 'blocked' || u.status === 'off')) show('bad', tr('ui.update.held', { min: u.min, build: u.build, why: why(u.status === 'off' ? 'off' : u.why) }));
  else show(null);
}
export const updateState = () => last;
const why = (code) => (tr(`ui.update.why.${code}`) === `ui.update.why.${code}` ? tr('ui.update.why.other') : tr(`ui.update.why.${code}`));

function show(kind, text = '', closable = false) {
  if (!bar) return;
  const key = `${kind}|${text}`;
  if (!kind || shut === key) { bar.hidden = true; return; }
  bar.className = `upd-bar is-${kind}`;
  const x = el('button', 'upd-x'); x.type = 'button'; x.setAttribute('aria-label', tr('common.close')); x.append(icon('x'));
  x.addEventListener('click', () => { shut = key; bar.hidden = true; });
  bar.replaceChildren(icon(kind === 'bad' ? 'alert' : 'rocket'), el('span', 'upd-t', text), ...(closable || kind === 'bad' ? [x] : []));
  bar.hidden = false;
}

export function setup() {
  const at = $('stage-wrap') || document.body;
  bar = el('div', 'upd-bar'); bar.hidden = true; bar.setAttribute('role', 'status'); bar.id = 'upd-bar';
  at.append(bar);
  if (last) onUpdate(last);
}
