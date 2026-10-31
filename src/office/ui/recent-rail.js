// The session list's "All" filter: everyone in the office, then every Claude Code conversation of the last two weeks
// that isn't open now (server/recent.mjs), under "Closed". Tapping a closed one opens the session drawer like anyone's,
// and "Give work" there messages them without reopening anything in an editor. The search box filters them too. activity.js calls sync()
// after each render of the list with its filter; the count on the "All" button is the office plus these.
import { $, el, short } from '../core/env.js';
import { TOKEN } from '../net/live.js';
import { DEMO } from '../demo/demo.js';
import { sessions } from '../people/workers.js';
import { icon } from './icons.js';
import { openClosed } from './session-drawer.js';
import { t as tr, locale } from '../../i18n/index.js';

const api = (p) => `${p}${TOKEN ? `${p.includes('?') ? '&' : '?'}k=${encodeURIComponent(TOKEN)}` : ''}`;
let head, rows = [], items = [], filter = null, query = '', sig = '', loadedAt = 0, loading = false;

function ago(t) {
  const s = (t - Date.now()) / 1000, f = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (s > -3600) return f.format(Math.round(s / 60), 'minute');
  if (s > -86400) return f.format(Math.round(s / 3600), 'hour');
  return f.format(Math.round(s / 86400), 'day');
}
function row(x) {
  const li = el('li', 'ri-li rr-li');
  const b = el('button', 'ri rr'); b.type = 'button'; b.dataset.recent = x.sid; b.dataset.status = 'closed';
  b.title = `${x.name} · ${x.dir}`;
  const av = el('span', 'av'), txt = el('span', 'av-txt', String(x.name || '?').trim().slice(0, 1).toUpperCase()); av.append(txt);
  const main = el('span', 'ri-main'), top = el('span', 'ri-top'), name = el('span', 'ri-name', short(x.name, 60));
  const proj = String(x.dir || '').split('/').filter(Boolean).pop();
  top.append(name); if (proj && proj !== x.name) top.append(el('span', 'ri-proj', proj));
  const doing = el('span', 'ri-doing'), dIco = el('span', 'ri-dico'); dIco.append(icon('chat'));
  doing.append(dIco, el('span', 'ri-dtxt', x.role?.title ? `${x.role.title} · ${ago(x.at)}` : ago(x.at)));
  main.append(top, doing);
  b.append(av, main);
  li.append(b);
  return li;
}
// (people who walked into the office since the last load aren't "closed" any more)
const closed = () => { const open = new Set([...sessions.values()].map((s) => s.sid).filter(Boolean)); return items.filter((x) => !open.has(x.sid)); };
/** after the list renders: show the closed ones under "All", keep them at the end, and count everyone */
export function sync(railFilter = filter) {
  if (railFilter === 'all' && filter !== 'all' && Date.now() - loadedAt > 15_000) load(true);   // (just picked: fresh)
  filter = railFilter;
  const list = $('rail-list'); if (!list || !head) return;
  const all = closed(), n = $('st-all'); if (n) n.textContent = sessions.size + all.length;
  const on = filter === 'all', q = query.trim().toLowerCase();
  const shown = on ? all.filter((x) => !q || x.name.toLowerCase().includes(q) || String(x.dir).toLowerCase().includes(q)) : [];
  const next = shown.map((x) => `${x.sid}:${x.name}:${x.at}`).join('|');
  if (next !== sig) { sig = next; for (const r of rows) r.remove(); rows = shown.map(row); }
  head.querySelector('b').textContent = shown.length;
  head.hidden = !shown.length;
  if (list.lastElementChild !== (rows.at(-1) || head)) list.append(head, ...rows);
}
// (in the background only the first load: a hidden page doesn't refresh)
async function load(force = false) {
  if (DEMO || loading || (document.hidden && !force)) return;
  loading = true;
  try {
    const r = await fetch(api('/api/recent'), { cache: 'no-store' }).then((x) => x.json());
    if (Array.isArray(r?.items)) { items = r.items; loadedAt = Date.now(); sync(); }
  } catch { /* the server is away: keep what we had */ }
  finally { loading = false; }
}
export function setup() {
  const list = $('rail-list'); if (!list) return;
  head = el('li', 'grp rr-grp'); head.hidden = true;
  const b = el('button', 'grp-btn'); b.type = 'button'; b.disabled = true;
  b.append(el('span', null, tr('activity.group.closed')), el('b'));
  head.append(b);
  list.append(head);
  // a closed one opens like anyone in the office: the session drawer, with their conversation
  list.addEventListener('click', (ev) => {
    const r = ev.target.closest('[data-recent]'); if (!r) return;
    const x = items.find((i) => i.sid === r.dataset.recent); if (x) openClosed(x);
  });
  $('sess-search')?.addEventListener('input', (e) => { query = e.target.value; sync(); });
  load(true);
  setInterval(() => load(), 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
