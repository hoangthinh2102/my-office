// Settings → Skills (markup: SettingsPanel.tsx): the skills and plugins Claude Code on this computer loads, and adding
// or removing them without the command line. A skill from a folder of yours (linked, or copied), a plugin from a
// marketplace (search, install), another marketplace. This computer only: the server (server/skills.mjs, /api/skills)
// answers nobody else, and nothing goes to the team. Removing asks for a second click.
import { state } from '../core/state.js';
import { $, el } from '../core/env.js';
import { TOKEN } from '../net/live.js';
import { icon } from './icons.js';
import { toast } from './activity.js';
import { t as tr } from '../../i18n/index.js';

let data = null, loading = false, busy = '', armed = '', armTimer = null, searchTimer = null, lastQ = null;
const q = (p) => `${p}${TOKEN ? `${p.includes('?') ? '&' : '?'}k=${encodeURIComponent(TOKEN)}` : ''}`;
const errText = (code, detail) => {
  const k = `settings.skills.err.${code}`, s = tr(k);
  return s === k ? tr('settings.skills.failed', { why: detail || code }) : s;
};
async function get(p) { const r = await fetch(q(p)); const j = await r.json().catch(() => ({})); if (!j.ok) throw Object.assign(new Error(j.code || r.status), { detail: j.detail }); return j; }
async function post(body) {
  const r = await fetch(q('/api/skills'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.code || j.message || r.status), { detail: j.detail });
  return j;
}

/** Settings opened its Skills tab: (re)load the list, and the most installed plugins once. */
export async function openSkills() {
  const local = !!state.isLocal;
  $('sk-phone').hidden = local; $('sk').hidden = !local;
  if (!local || loading) return;
  loading = true; render();
  try { data = await get('/api/skills'); } catch (e) { data = { skills: [], plugins: [], markets: [], problem: e.message }; } finally { loading = false; }
  render();
  if (lastQ === null) search('');
}

function twoStep(key, go) {
  if (armed === key) { armed = ''; clearTimeout(armTimer); go(); return; }
  armed = key; clearTimeout(armTimer);
  armTimer = setTimeout(() => { armed = ''; render(); }, 5000);
  render();
}
async function act(key, body, okText) {
  if (busy) return;
  busy = key; render(); renderResults();
  try {
    const j = await post(body);
    data = j; toast(okText(j.result || {}), 6000);
    if (lastQ !== null) search(lastQ, true);
  } catch (e) { toast(errText(e.message, e.detail), 7000); } finally { busy = ''; render(); renderResults(); }
}

function row(name, tag, desc, actions, cls = '') {
  const li = el('li', `sk-row ${cls}`), head = el('div', 'sk-row-h');
  head.append(el('b', null, name));
  if (tag) head.append(el('span', 'sk-tag', tag));
  li.append(head);
  if (desc) li.append(el('small', 'sk-desc', desc));
  if (actions) li.append(actions);
  return li;
}
function btn(label, cls, onClick, disabled = false) {
  const b = el('button', `sk-b ${cls}`, label); b.type = 'button'; b.disabled = disabled || !!busy;
  b.addEventListener('click', onClick); return b;
}

function render() {
  const list = $('sk-list'); if (!list) return;
  if (loading && !data) { list.replaceChildren(el('li', 'sk-none', tr('settings.skills.loading'))); return; }
  if (!data) return;
  const skills = data.skills || [], plugins = data.plugins || [];
  $('sk-n').textContent = String(skills.length + plugins.length);
  const rows = [];
  for (const s of skills) {
    const key = `rm:${s.name}`, acts = el('div', 'sk-acts');
    acts.append(armed === key
      ? btn(tr(s.link ? 'settings.skills.confirmUnlink' : 'settings.skills.confirmRemove'), 'is-warn', () => twoStep(key, () => act(key, { action: 'remove', name: s.name }, (r) => tr(r.was === 'link' ? 'settings.skills.unlinked' : 'settings.skills.removed', { name: s.name }))))
      : btn(busy === key ? tr('settings.skills.working') : tr('settings.skills.remove'), 'is-quiet', () => twoStep(key, () => {})));
    const tag = s.broken ? tr('settings.skills.broken') : tr(s.link ? 'settings.skills.linked' : 'settings.skills.folder');
    const li = row(s.name, tag, s.broken ? tr('settings.skills.brokenNote', { from: s.from || '' }) : s.desc, acts, s.broken ? 'is-broken' : '');
    if (s.link && s.from) li.title = s.from;
    rows.push(li);
  }
  for (const p of plugins) {
    const key = `un:${p.id}`, acts = el('div', 'sk-acts');
    acts.append(armed === key
      ? btn(tr('settings.skills.confirmUninstall'), 'is-warn', () => twoStep(key, () => act(key, { action: 'uninstall', plugin: p.id }, () => tr('settings.skills.uninstalled', { name: p.name }))))
      : btn(busy === key ? tr('settings.skills.working') : tr('settings.skills.uninstall'), 'is-quiet', () => twoStep(key, () => {})));
    rows.push(row(p.name, tr('settings.skills.plugin', { market: p.market }), p.desc, acts));
  }
  if (!rows.length) rows.push(el('li', 'sk-none', tr('settings.skills.none')));
  list.replaceChildren(...rows);
  // the marketplace part needs Claude Code's command
  const noClaude = data.problem === 'no-claude';
  $('sk-noclaude').hidden = !noClaude;
  $('sk-market').hidden = noClaude;
  const ms = data.markets || [];
  $('sk-markets-n').textContent = String(ms.length);
  $('sk-market-list').replaceChildren(...ms.map((m) => row(m.name, null, m.source)));
  for (const id of ['sk-add-go', 'sk-find-go', 'sk-market-go']) { const b = $(id); if (b) b.disabled = !!busy; }
}

let results = null;
async function search(text, quiet = false) {
  lastQ = text;
  if (!quiet) { results = { loading: true }; renderResults(); }
  try { const j = await get(`/api/skills/search?q=${encodeURIComponent(text)}`); if (lastQ === text) results = j; } catch (e) { if (lastQ === text) results = { error: e.message }; }
  if (lastQ === text) renderResults();
}
function renderResults() {
  const box = $('sk-results'); if (!box || !results) return;
  if (results.loading) { box.replaceChildren(el('li', 'sk-none', tr('settings.skills.searching'))); return; }
  if (results.error) { box.replaceChildren(el('li', 'sk-none', errText(results.error))); return; }
  const head = el('li', 'sk-none', lastQ ? tr('settings.skills.found', { n: results.total }) : tr('settings.skills.popular'));
  box.replaceChildren(head, ...(results.list || []).map((p) => {
    const key = `in:${p.id}`, acts = el('div', 'sk-acts');
    if (p.installed) acts.append(el('span', 'sk-have', tr('settings.skills.installed')));
    else acts.append(btn(busy === key ? tr('settings.skills.installing') : tr('settings.skills.install'), 'is-yes', () => act(key, { action: 'install', plugin: p.id }, () => tr('settings.skills.didInstall', { name: p.name }))));
    return row(p.name, `${p.market}${p.installs ? ` · ${tr('settings.skills.installs', { n: p.installs.toLocaleString(tr('settings.skills.locale')) })}` : ''}`, p.desc, acts);
  }));
}

export function setup() {
  const box = $('sk'); if (!box) return;
  for (const n of box.querySelectorAll('[data-icon]')) if (!n.firstChild) n.append(icon(n.dataset.icon));
  $('sk-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const dir = $('sk-dir').value.trim(); if (!dir) { $('sk-dir').focus(); return; }
    act('add', { action: 'add-folder', dir, copy: $('sk-copy').checked }, (r) => {
      $('sk-dir').value = '';
      const added = r.added || [], skipped = (r.skipped || []).map((s) => `${s.name} (${tr(`settings.skills.why.${s.why}`)})`);
      return [added.length ? tr('settings.skills.added', { names: added.join(', ') }) : '', skipped.length ? tr('settings.skills.skipped', { names: skipped.join(', ') }) : ''].filter(Boolean).join(' ');
    });
  });
  $('sk-find').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(searchTimer); search($('sk-q').value.trim()); });
  $('sk-q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search($('sk-q').value.trim()), 350); });
  $('sk-market-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const source = $('sk-market-src').value.trim(); if (!source) { $('sk-market-src').focus(); return; }
    act('market', { action: 'add-market', source }, () => { $('sk-market-src').value = ''; return tr('settings.skills.marketAdded'); });
  });
}
