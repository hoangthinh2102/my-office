// The director's office (the briefcase in the top bar; markup: src/components/office/DirectorModal.tsx). You run the
// company from here:
//   Talk      one conversation per person. What you write goes into that person's own Claude Code conversation (the
//             server carries it on, or branches it when it is open in your editor) and their answer comes back here,
//             with the tokens and the API-price equivalent it took. "Hire" starts someone new in a project folder with a
//             job title and a brief; they walk into the office like any session.
//   Results   the performance board: per person and per project, the jobs, tokens, cost, time, failed tool calls,
//             overtime and a score (server/perf.mjs explains it).
//   Rules     the company's rules, given to every session as it starts (the SessionStart hook), and the skills every
//             session on this computer already loads (agent-support and the like).
//   Hours     office hours: arriving, breakfast, lunch, the nap, the coffee, going home, the working days. Everyone in
//             the office lives by them (core/schedule.js).
import { $, el, short, pad2 } from '../core/env.js';
import { SCHEDULE, DEFAULT_SCHEDULE, setSchedule, dayPart } from '../core/schedule.js';
import { TOKEN } from '../net/live.js';
import { DEMO } from '../demo/demo.js';
import { PALETTE, dn, hash, sessions, workers } from '../people/workers.js';
import { free } from '../people/errands.js';
import { standBy, wayTo } from '../people/navigation.js';
import { mdBlocks } from './session-drawer.js';
import { toast, fmtTok, fmtUsd } from './activity.js';
import { icon } from './icons.js';
import { perms, permCard, permClick, permWatch, renderPerms, setShownElsewhere } from './permissions.js';
import { t as tr, num, locale } from '../../i18n/index.js';

const T = (k, v) => tr(`director.${k}`, v);
const api = (p) => `${p}${TOKEN ? `${p.includes('?') ? '&' : '?'}k=${encodeURIComponent(TOKEN)}` : ''}`;
const getJ = (p) => fetch(api(p), { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
const postJ = (p, body) => fetch(api(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));

let history = [];   // what the selected person did before (their own conversation), shown above your messages
let live = [];      // the work going on now, step by step (while they work on what you sent)
let picks = new Set();   // options ticked on a report that lets you pick several
let jumpEnd = true;      // a conversation just opened: show its end (later updates keep where you scrolled to)
let modal, tab = 'talk', co = null, sel = null, thread = null, hiring = false, perfDays = 7, perfData = null, unread = 0, perfT = null, forceArmed = false;
const PERM_KEYS = ['auto', 'ask', 'dev', 'qa', 'reviewer'];
// a <select> of permission profiles, and one of the people to hand finished work to
function permSelect(sel, value = 'auto') { sel.replaceChildren(...(co?.perms || PERM_KEYS).map((k) => { const o = el('option', null, T(`perm.${k}`)); o.value = k; o.title = T(`perm.${k}Hint`); return o; })); sel.value = value || 'auto'; sel.title = T(`perm.${sel.value}Hint`); return sel; }
function nextSelect(sel, value = '', not = '') {
  const people = [...(co?.people || []).map((p) => ({ sid: p.sid, name: p.role?.title ? `${p.name} · ${p.role.title}` : p.name })),
    ...(co?.dms || []).filter((d) => d.sid && !(co?.people || []).some((p) => p.sid === d.sid)).map((d) => ({ sid: d.sid, name: d.role?.title ? `${d.name} · ${d.role.title}` : d.name }))].filter((x) => x.sid !== not);
  const none = el('option', null, T('next.none')); none.value = '';
  sel.replaceChildren(none, ...people.map((x) => { const o = el('option', null, short(x.name, 40)); o.value = x.sid; return o; }));
  sel.value = value || ''; return sel;
}
const isOpen = () => modal && !modal.hidden;

/* ---------- open / close / tabs ---------- */
export async function openDirector(which = tab) {
  modal.hidden = false; $('btn-director')?.setAttribute('aria-pressed', 'true'); fitKeyboard();
  unread = 0; badge();
  showTab(which);
  await loadCompany();
}
function close() { modal.hidden = true; $('btn-director')?.setAttribute('aria-pressed', 'false'); fitKeyboard(); renderPerms(); }
// on a phone the people list and a conversation take turns on the screen (director.css)
function showConvo(on) { modal.querySelector('.dir-talk')?.classList.toggle('is-convo', on); }
function back() { hiring = false; $('dir-hire').hidden = true; showConvo(false); }
// a phone's keyboard covers the bottom of the screen: keep the window (and Send) in the part still showing
function fitKeyboard() {
  const card = modal?.querySelector('.dir-card'), vv = window.visualViewport;
  if (!card) return;
  if (!isOpen() || !vv || !document.documentElement.classList.contains('is-phone')) { modal.style.top = modal.style.height = ''; return; }
  modal.style.top = `${vv.offsetTop}px`; modal.style.height = `${vv.height}px`;
  if (document.activeElement === $('dir-text')) { const m = $('dir-msgs'); m.scrollTop = m.scrollHeight; }
}
function showTab(which) {
  tab = which;
  for (const b of modal.querySelectorAll('.dir-tab')) b.classList.toggle('is-sel', b.dataset.tab === which);
  for (const p of modal.querySelectorAll('.dir-pane')) p.hidden = p.dataset.pane !== which;
  renderPerms();
  if (which === 'perf') loadPerf();
  if (which === 'rules') renderRules();
  if (which === 'hours') renderHours();
  if (which === 'auto') renderAuto();
}
function badge() { const b = $('dir-badge'); if (!b) return; b.hidden = !unread; b.textContent = unread > 9 ? '9+' : String(unread); }

/* ---------- the company, the people ---------- */
async function loadCompany() {
  if (DEMO) { co = demoCompany(); renderPeople(); renderRules(); renderHours(); return; }
  const j = await getJ('/api/company');
  if (!j?.ok) { $('dir-plist').replaceChildren(el('p', 'dir-note', T('offline'))); return; }
  co = j;
  if (j.schedule) setSchedule(j.schedule);
  $('dir-sub').textContent = j.name ? T('subNamed', { name: j.name }) : T('sub');
  renderPeople();
  if (tab === 'rules') renderRules();
  if (tab === 'hours') renderHours();
  if (tab === 'auto') renderAuto();
  if (sel) loadThread(sel);
}
function demoCompany() {
  const people = [...sessions.values()].slice(0, 8).map((s, i) => ({ id: s.id, sid: `demo-${i}`, name: s.title || s.name, dir: s.dir, status: s.status, role: i === 0 ? { title: 'Tech lead', brief: '' } : null, editor: i % 2 === 0 }));
  return { ok: true, name: 'Demo Co.', rules: '', rulesOn: true, schedule: SCHEDULE, roles: {}, skills: [{ name: 'daily-tasks', kind: 'skill', desc: 'Daily tasks from the tracker' }], hook: true, local: true, people, projects: [], dms: [], demo: true };
}
const colourOf = (name) => PALETTE[hash(String(name || '')) % PALETTE.length];
function personRow({ key, name, sub, status, badgeText, running, awaiting }) {
  const b = el('button', 'dir-person'); b.type = 'button'; b.dataset.key = key;
  if (key === sel) b.classList.add('is-sel');
  const ava = el('span', 'dir-ava', String(name || '?').trim().slice(0, 1).toUpperCase()); ava.style.background = colourOf(name);
  if (status) ava.dataset.st = status;
  const nm = el('span', 'dir-pname'); nm.append(el('b', null, short(name, 28)), el('small', null, sub || ''));
  b.append(ava, nm);
  if (awaiting) b.append(el('span', 'dir-pbadge is-wait', T('approve.badge')));
  else if (running) b.append(el('span', 'dir-pbadge is-run', T('working')));
  else if (badgeText) b.append(el('span', 'dir-pbadge', badgeText));
  b.addEventListener('click', () => { hiring = false; select(key); });
  return b;
}
function renderPeople() {
  const list = $('dir-plist'); if (!list || !co) return;
  const rows = [], here = new Set();
  const dmOf = new Map((co.dms || []).map((d) => [d.key, d]));
  if (co.people?.length) {
    rows.push(el('div', 'dir-pgroup', T('group.here')));
    for (const p of co.people) {
      here.add(p.sid);
      const d = dmOf.get(p.sid);
      rows.push(personRow({ key: p.sid, name: p.name, sub: p.role?.title || p.dir, status: p.status, running: d?.running, awaiting: d?.awaiting, badgeText: d?.msgs?.length ? T('talked') : '' }));
    }
  }
  const past = (co.dms || []).filter((d) => !here.has(d.key));
  if (past.length) {
    rows.push(el('div', 'dir-pgroup', T('group.past')));
    for (const d of past) rows.push(personRow({ key: d.key, name: d.name, sub: d.role?.title || d.dir, running: d.running, awaiting: d.awaiting }));
  }
  // every other conversation of the last two weeks: message them and they carry on, no editor needed
  const older = (co.recent || []).filter((x) => !here.has(x.sid) && !(co.dms || []).some((d) => d.key === x.sid));
  if (older.length) {
    rows.push(el('div', 'dir-pgroup', T('group.recent')));
    for (const x of older) rows.push(personRow({ key: x.sid, name: x.name, sub: `${x.role?.title || x.dir} · ${ago(x.at)}` }));
  }
  if (!rows.length) rows.push(el('p', 'dir-note', T('noPeople')));
  list.replaceChildren(...rows);
}
// "5 minutes ago", "yesterday", "3 days ago"
function ago(t) {
  const s = (t - Date.now()) / 1000, f = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (s > -3600) return f.format(Math.round(s / 60), 'minute');
  if (s > -86400) return f.format(Math.round(s / 3600), 'hour');
  return f.format(Math.round(s / 86400), 'day');
}
const personOf = (key) => co?.people?.find((p) => p.sid === key) || co?.recent?.find((x) => x.sid === key) || null;

/* ---------- one conversation ---------- */
async function select(key) {
  sel = key; hiring = false; $('dir-hire').hidden = true; showConvo(true); live = []; picks = new Set(); jumpEnd = true;
  for (const b of $('dir-plist').querySelectorAll('.dir-person')) b.classList.toggle('is-sel', b.dataset.key === key);
  thread = (co?.dms || []).find((d) => d.key === key) || null; history = [];
  renderThread(); renderPerms();
  await loadThread(key);
}
async function loadThread(key) {
  if (DEMO || !key) return;
  const [j, h] = await Promise.all([getJ(`/api/dm?key=${encodeURIComponent(key)}`), getJ(`/api/dm/history?key=${encodeURIComponent(key)}`)]);
  if (sel !== key) return;
  thread = j?.ok ? j.d : null;
  history = h?.items || [];
  renderThread(); renderPerms(); jumpEnd = false;
}
// their own conversation (the editor, a terminal): what they were asked there, what they answered, the steps between
function histNode(it) {
  if (it.role === 'tools') return el('div', 'dir-hist-tools', T('history.tools', { n: it.n }));
  const b = el('div', `dir-msg dir-hist-msg${it.role === 'user' ? ' is-me' : ''}`);
  if (it.role === 'user') b.append(el('span', 'dir-tag', T('history.you')), document.createTextNode(it.text)); else b.append(mdBlocks(it.text));
  if (it.ts) { const d = new Date(it.ts), meta = el('div', 'dir-meta'); meta.append(el('span', null, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`), el('span', null, T('history.where'))); b.append(meta); }
  return b;
}
// one timeline: their own conversation and what was said here, in the order it happened
function timeline(msgs) {
  const rows = [...history.map((it, i) => ({ at: it.ts || 0, i, node: () => histNode(it) })), ...msgs.map((m, i) => ({ at: m.at || 0, i: 1e6 + i, node: () => msgNode(m) }))];
  return rows.sort((a, b) => a.at - b.at || a.i - b.i).map((r) => r.node());
}
function backBtn() {   // (only shown on a phone)
  const b = el('button', 'dir-back'); b.type = 'button'; b.setAttribute('aria-label', T('back')); b.title = T('back');
  const ic = icon('chevron'); ic.style.transform = 'scaleX(-1)'; b.append(ic);
  b.addEventListener('click', back); return b;
}
function renderHead() {
  const head = $('dir-chead');
  if (hiring) { head.replaceChildren(backBtn(), el('span', 'dir-cname', T('hire.title'))); return; }
  if (!sel) { head.replaceChildren(); return; }
  const p = personOf(sel), name = p?.name || thread?.name || sel, dir = p?.dir || thread?.dir || '';
  const role = p?.role || thread?.role || null;
  const kids = [backBtn(), el('span', 'dir-cname', name), el('span', 'dir-cdir', dir)];
  if (co?.local && thread?.msgs?.length && co.terminal) {   // carry it on outside the office: Terminal, or copy the command
    const acts = el('div', 'dir-cacts');
    const term = el('button', 'btn', T('resume.open')); term.type = 'button'; term.title = T('resume.openTitle');
    term.addEventListener('click', async () => { const r = await postJ('/api/dm/open', { key: thread.key }); toast(r.ok ? T('resume.opened') : T('failed')); });
    const copy = el('button', 'btn', T('resume.copy')); copy.type = 'button';
    copy.addEventListener('click', async () => { const r = await postJ('/api/dm/open', { key: thread.key, copy: true }); if (r.cmd) { try { await navigator.clipboard.writeText(r.cmd); toast(T('resume.copied')); } catch { toast(r.cmd, 9000); } } });
    acts.append(term, copy); kids.push(acts);
  }
  if (co?.local && !String(sel).startsWith('new-')) {   // the role: a title, a brief, what they may do alone, whom they hand over to
    const box = el('div', 'dir-role');
    const ti = el('input'); ti.placeholder = T('roleTitlePh'); ti.maxLength = 60; ti.value = role?.title || '';
    const br = el('input'); br.placeholder = T('roleBriefPh'); br.maxLength = 600; br.value = role?.brief || '';
    const pm = permSelect(el('select'), role?.perm); pm.title = T('perm.label');
    const nx = nextSelect(el('select'), role?.next, sel); nx.title = T('next.label');
    const save = el('button', 'btn', T('save')); save.type = 'button';
    save.addEventListener('click', async () => {
      const r = await postJ('/api/company/role', { sid: sel, title: ti.value, brief: br.value, perm: pm.value, next: nx.value });
      toast(r.ok ? T('roleSaved') : T('failed'));
      if (r.ok && p) p.role = r.company?.roles?.[sel] || null;
      renderPeople();
    });
    box.append(ti, br, pm, nx, save); kids.push(box);
  }
  head.replaceChildren(...kids);
}
function msgNode(m) {
  const b = el('div', `dir-msg${m.from === 'me' ? ' is-me' : ''}${m.from === 'sys' ? ' is-sys' : ''}${m.from === 'handoff' ? ' is-handoff' : ''}${m.from === 'auto' ? ' is-auto' : ''}${m.error ? ' is-err' : ''}`);
  if (m.from === 'sys') { b.textContent = m.text; return b; }
  if (m.from === 'handoff' || m.from === 'auto') b.append(el('span', 'dir-tag', T(`tag.${m.from}`)));
  if (m.from === 'me' || m.from === 'handoff' || m.from === 'auto') b.append(document.createTextNode(m.text));
  else b.append(mdBlocks(m.text));
  const meta = el('div', 'dir-meta');
  const d = new Date(m.at); meta.append(el('span', null, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`));
  if (m.from === 'me' && m.mode) meta.append(el('span', null, T(`mode.${m.mode}`)));
  if (m.usage) {
    const u = m.usage;
    meta.append(el('span', null, T('used', { tokens: fmtTok((u.in || 0) + (u.out || 0)), cache: fmtTok(u.cacheRead || 0) })));
    if (u.cost != null) meta.append(el('span', null, fmtUsd(u.cost)));
    if (u.turns) meta.append(el('span', null, T('turns', { n: u.turns })));
    if (u.ms) meta.append(el('span', null, T('took', { s: Math.round(u.ms / 1000) })));
  }
  b.append(meta);
  return b;
}
function renderThread() {
  renderHead();
  const box = $('dir-msgs'), text = $('dir-text'), send = $('dir-send');
  const can = !!(hiring || sel);
  text.disabled = send.disabled = !can || !!thread?.running;
  $('dir-stop').hidden = !thread?.running;
  renderAsk();
  if (hiring) {
    box.replaceChildren(el('p', 'dir-empty', T('hire.note')));
    $('dir-mode').textContent = T('modeHint.hire');
    return;
  }
  if (!sel) { box.replaceChildren(el('p', 'dir-empty', T('pick'))); $('dir-mode').textContent = ''; return; }
  const msgs = thread?.msgs || [];
  const keep = !jumpEnd && !nearEnd() ? box.scrollTop : null;   // (reading further up: stay there while it updates)
  box.replaceChildren(...timeline(msgs),
    ...(msgs.length ? [] : [el('p', history.length ? 'dir-note dir-hist-hint' : 'dir-empty', T(history.length ? 'history.hint' : 'first', { name: personOf(sel)?.name || thread?.name || '' }))]));
  if (thread?.running) box.append(liveNode(), el('div', 'dir-typing', T('typing', { name: personOf(sel)?.name || thread?.name || '' })));
  box.append(el('div', 'dir-pending'));
  renderPending();
  box.scrollTop = keep ?? box.scrollHeight;
  const p = personOf(sel);
  $('dir-mode').textContent = thread?.branch ? T('modeHint.branch') : p?.editor ? T('modeHint.willBranch') : T('modeHint.direct');
}
async function sendNow(e) {
  e?.preventDefault();
  const text = $('dir-text').value.trim(); if (!text) return;
  if (DEMO) { toast(T('demo')); return; }
  let body;
  if (hiring) {
    const dir = $('dir-hire-dir').value;
    if (!dir) { toast(T('hire.noProject')); return; }
    body = { hire: { dir, title: $('dir-hire-title').value, brief: $('dir-hire-brief').value, perm: $('dir-hire-perm').value, next: $('dir-hire-next').value }, text };
  } else body = { sid: sel, text };
  if (forceArmed) body.force = true;
  $('dir-send').disabled = true;
  const r = await postJ('/api/dm', body);
  if (!r.ok && r.code === 'overBudget') {   // past the budget: say so, and the next press sends it anyway
    forceArmed = true; $('dir-mode').textContent = r.message; $('dir-send').lastChild.textContent = T('budget.sendAnyway'); $('dir-send').disabled = false; return;
  }
  forceArmed = false; $('dir-send').lastChild.textContent = T('send');
  if (!r.ok) { toast(r.message || T('failed')); $('dir-send').disabled = false; return; }
  $('dir-text').value = '';
  if (hiring) { hiring = false; $('dir-hire').hidden = true; for (const id of ['dir-hire-title', 'dir-hire-brief']) $(id).value = ''; }
  sel = r.key;
  await loadCompany();
  await loadThread(r.key);
}
function startHire() {
  hiring = true; sel = null; thread = null;
  for (const b of $('dir-plist').querySelectorAll('.dir-person')) b.classList.remove('is-sel');
  const pick = $('dir-hire-dir');
  // the whole agent-support workspace first (its skills pick the repo themselves), then single project folders
  const ws = co?.workspace ? [Object.assign(el('option', null, T('hire.workspace', { root: co.workspace.root, n: co.workspace.repos.length })), { value: '@workspace', title: co.workspace.repos.join(', ') })] : [];
  pick.replaceChildren(...ws, ...(co?.projects || []).map((p) => { const o = el('option', null, `${p.name} — ${p.dir}`); o.value = p.dir; return o; }));
  if (!pick.options.length) { const o = el('option', null, T('hire.noProjects')); o.value = ''; pick.append(o); }
  permSelect($('dir-hire-perm'), 'auto'); nextSelect($('dir-hire-next'));
  $('dir-hire').hidden = false; showConvo(true);
  renderThread();
  $('dir-hire-title').focus();
}

/* ---------- the performance board ---------- */
async function loadPerf() {
  for (const b of $('dir-days').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === perfDays));
  perfData = DEMO ? demoPerf() : await getJ(`/api/perf?days=${perfDays}`);
  renderPerf();
}
function demoPerf() {
  const names = [...sessions.values()].map((s) => s.title || s.name).slice(0, 6);
  const people = names.map((name, i) => {
    const jobs = 6 + ((i * 7) % 11), done = jobs - (i % 3), tokIn = 180000 * jobs / (i + 1.5), out = 40000 * jobs / (i + 2), cost = (tokIn * 4 + out * 20) / 1e6;
    const delivered = Math.max(1, done - (i % 2)), rework = i % 3;
    return { key: name, name, jobs, done, work: jobs, delivered, rework, tokIn, out, cacheRead: tokIn * 9, cost, dur: jobs * 6e5, tools: jobs * 14, fails: i * 2, ot: i * 25, score: 92 - i * 9,
      parts: { delivered: Math.round(delivered / jobs * 100), cost: 90 - i * 10, done: Math.round(done / jobs * 100), clean: 98 - i * 3, rework: -rework * 3, ci: 0 }, perJob: { tokens: Math.round((tokIn + out) / jobs), cost: cost / jobs, min: 10, perDelivered: cost / delivered } };
  });
  const total = people.reduce((t, p) => ({ jobs: t.jobs + p.jobs, done: t.done + p.done, tokIn: t.tokIn + p.tokIn, out: t.out + p.out, cacheRead: t.cacheRead + p.cacheRead, cost: t.cost + p.cost, ot: t.ot + p.ot }), { jobs: 0, done: 0, tokIn: 0, out: 0, cacheRead: 0, cost: 0, ot: 0 });
  const byDay = Array.from({ length: perfDays }, (_, i) => { const d = new Date(Date.now() - (perfDays - 1 - i) * 864e5); return { day: d.toLocaleDateString('sv-SE'), jobs: 3 + (i * 5) % 9, cost: 2 + (i * 3) % 7 }; });
  total.delivered = people.reduce((n, p) => n + p.delivered, 0); total.mrs = Math.round(total.delivered / 2);
  return { ok: true, days: perfDays, total, people, projects: [], tasks: [], byDay, recent: [] };
}
const whyText = (w) => { const k = `director.perf.why.${w}`, v = tr(k); return v === k ? w || '—' : v; };
const hours = (min) => (min >= 60 ? T('perf.h', { h: num(Math.round(min / 6) / 10, 1) }) : T('perf.m', { m: Math.round(min) }));
function cells(tag, list) { const r = el('tr'); for (const c of list) { const x = el(tag); if (c instanceof Node) x.append(c); else x.textContent = c; r.append(x); } return r; }
function scoreCell(p) {
  const s = el('span', `dir-score${p.score < 50 ? ' is-low' : p.score < 70 ? ' is-mid' : ''}`), bar = el('i'), fill = el('b');
  fill.style.width = `${Math.max(0, Math.min(100, p.score))}%`; bar.append(fill); s.append(bar, el('b', null, String(p.score)));
  s.title = T('perf.parts', p.parts);
  return s;
}
function link(text, url) { if (!url) return text; const a = el('a', null, text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
function budgetRows(d) {
  const box = $('dir-budget-now'), b = d.budget;
  if (!b || (!b.personDay && !b.projectDay)) { box.hidden = true; return; }
  box.hidden = false;
  const row = (name, used, limit) => {
    const r = el('div', `dir-brow${used >= limit ? ' is-over' : used >= limit * 0.8 ? ' is-near' : ''}`), bar = el('i'), fill = el('b');
    fill.style.width = `${Math.min(100, Math.round((used / limit) * 100))}%`; bar.append(fill);
    r.append(el('span', null, short(name, 24)), bar, el('span', null, `${fmtTok(used)} / ${fmtTok(limit)}`)); return r;
  };
  box.replaceChildren(el('b', null, T('budget.today')),
    ...(b.personDay ? b.people.slice(0, 8).map((p) => row(p.name, p.used, b.personDay)) : []),
    ...(b.projectDay ? b.projects.slice(0, 6).map((p) => row(`📁 ${p.name}`, p.used, b.projectDay)) : []));
}
function renderPerf() {
  const d = perfData;
  if (!d?.ok) { $('dir-tiles').replaceChildren(el('p', 'dir-note', T('offline'))); return; }
  const t = d.total;
  const tile = (v, k) => { const x = el('div', 'dir-tile'); x.append(el('b', null, v), el('span', null, k)); return x; };
  $('dir-tiles').replaceChildren(
    tile(num(t.jobs), T('perf.jobs')),
    tile(t.jobs ? `${Math.round((t.done / t.jobs) * 100)}%` : '—', T('perf.doneRate')),
    tile(num(t.delivered || 0), T('perf.delivered')),
    tile(num(t.mrs || 0), T('perf.mrs')),
    tile(fmtTok(t.tokIn + t.out), T('perf.tokens')),
    tile(fmtTok(t.cacheRead), T('perf.cache')),
    tile(fmtUsd(t.cost), T('perf.cost')),
    tile(hours(t.ot), T('perf.ot')),
  );
  const max = Math.max(0.01, ...d.byDay.map((x) => x.cost));
  $('dir-chart').replaceChildren(...d.byDay.map((x) => {
    const b = el('div', 'dir-bar'), bar = el('i'); bar.style.height = `${Math.round((x.cost / max) * 100)}%`;
    b.title = T('perf.dayTitle', { day: x.day, jobs: x.jobs, cost: fmtUsd(x.cost) });
    b.append(bar, el('small', null, d.byDay.length > 14 ? x.day.slice(8) : x.day.slice(5).split('-').reverse().join('/'))); return b;
  }));
  budgetRows(d);
  const pt = $('dir-people-table');
  pt.replaceChildren(cells('th', [T('perf.col.person'), T('perf.col.jobs'), T('perf.col.done'), T('perf.col.delivered'), T('perf.col.rework'), T('perf.col.tokens'), T('perf.col.perJob'), T('perf.col.cost'), T('perf.col.costDelivered'), T('perf.col.min'), T('perf.col.fails'), T('perf.col.ot'), T('perf.col.score')]),
    ...(d.people.length ? d.people.map((p) => cells('td', [p.name, num(p.jobs), `${Math.round((p.done / p.jobs) * 100)}%`, `${p.delivered}/${p.work}`, num(p.rework), fmtTok(p.tokIn + p.out), fmtTok(p.perJob.tokens), fmtUsd(p.cost),
      p.perJob.perDelivered == null ? '—' : fmtUsd(p.perJob.perDelivered), num(p.perJob.min, 1), `${p.fails}/${p.tools}`, hours(p.ot), scoreCell(p)]))
      : [cells('td', [T('perf.none')])]));
  $('dir-task-table').replaceChildren(cells('th', [T('perf.col.larkTask'), T('perf.col.status'), T('perf.col.people'), T('perf.col.jobs'), T('perf.col.rework'), T('perf.col.tokens'), T('perf.col.cost'), T('perf.col.time'), 'MR']),
    ...(d.tasks?.length ? d.tasks.map((x) => {
      const mrs = el('span'); x.mrs.slice(0, 3).forEach((u, i) => { if (i) mrs.append(' '); mrs.append(link(`!${u.split('/').pop()}`, u)); });
      const r = cells('td', [link(short(x.summary || x.guid.slice(0, 8), 60), x.url), x.status ? T(`perf.status.${x.status}`) : '—', short(x.people.join(', '), 30), num(x.jobs), num(x.rework), fmtTok(x.tokens), fmtUsd(x.cost), hours(x.dur / 6e4), mrs]);
      r.children[0].className = 'l'; return r;
    }) : [cells('td', [T('perf.noTasks')])]));
  $('dir-proj-table').replaceChildren(cells('th', [T('perf.col.project'), T('perf.col.jobs'), T('perf.col.delivered'), T('perf.col.tokens'), T('perf.col.cost'), T('perf.col.ot')]),
    ...(d.projects.length ? d.projects.map((p) => cells('td', [p.name, num(p.jobs), num(p.delivered || 0), fmtTok(p.tokIn + p.out), fmtUsd(p.cost), hours(p.ot)])) : [cells('td', [T('perf.none')])]));
  const fmt = new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  $('dir-jobs-table').replaceChildren(cells('th', [T('perf.col.when'), T('perf.col.person'), T('perf.col.task'), T('perf.col.made'), T('perf.col.tokens'), T('perf.col.cost'), T('perf.col.min'), T('perf.col.result')]),
    ...(d.recent.length ? d.recent.map((j) => {
      const made = [j.commits ? `${j.commits} commit` : '', j.pushes ? `${j.pushes} push` : '', j.mrs?.length ? `${j.mrs.length} MR` : ''].filter(Boolean).join(' · ') || '—';
      const r = cells('td', [fmt.format(new Date(j.ts)), short(j.name, 24), j.prompt || '—', made, fmtTok(j.tokIn + j.out), fmtUsd(j.cost), num(Math.round(j.dur / 6e3) / 10, 1), j.ok ? T('perf.ok') : whyText(j.why)]);
      r.children[2].className = 'prompt'; r.children[2].title = j.prompt || '';
      r.lastChild.className = j.ok ? 'dir-ok' : 'dir-bad';
      return r;
    }) : [cells('td', [T('perf.none')])]));
}
function csv() {
  const d = perfData; if (!d?.people) return;
  const rows = [['person', 'jobs', 'done', 'delivered', 'rework', 'tokens_in', 'tokens_out', 'cache_read', 'cost_usd', 'cost_per_delivered', 'minutes', 'tool_calls', 'tool_fails', 'overtime_min', 'score'],
    ...d.people.map((p) => [p.name, p.jobs, p.done, p.delivered, p.rework, Math.round(p.tokIn), Math.round(p.out), Math.round(p.cacheRead), p.cost, p.perJob.perDelivered ?? '', Math.round(p.dur / 6e4), p.tools, p.fails, p.ot, p.score])];
  const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `my-office-performance-${perfDays}d.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- a report waiting for you: they stopped to ask (a phase to approve, a choice; the morning plan too) ----------
   Approve is one press (what you typed below goes with it as a note); to change something, type it and press "Ask for
   changes"; a choice is one press on the option (several: tick them, then send). Writing a message of your own answers
   it too. */
function renderAsk() {
  const bar = $('dir-approve'), ask = thread?.ask, on = !hiring && !!thread?.awaiting && !thread?.running;
  bar.hidden = !on;
  $('dir-text').placeholder = on ? T('ask.notePh') : T('inputPh');
  if (!on) return;
  const gate = !!thread.gate, choose = ask?.kind === 'choose' && ask.options?.length;
  $('dir-approve-text').textContent = choose ? T(ask.multi ? 'ask.barMany' : 'ask.barChoose') : gate ? T('approve.bar') : ask?.open ? T('ask.barOpen') : T('ask.bar');
  const ok = $('dir-approve-ok'), no = $('dir-approve-no'), opts = $('dir-opts');
  no.textContent = gate ? T('approve.revise') : T('ask.revise');
  ok.textContent = choose ? T('ask.send') : gate ? T('approve.ok') : ask?.open ? T('ask.agree') : T('ask.approve');
  ok.hidden = !!choose && !ask.multi;
  opts.replaceChildren(...(choose ? ask.options.map((o, i) => {
    const b = el('button', `btn dir-opt${picks.has(i) ? ' is-on' : ''}`); b.type = 'button'; b.dataset.i = i;
    b.append(el('b', null, `${i + 1}`), document.createTextNode(o));
    b.addEventListener('click', () => {
      if (!ask.multi) { approve(true, [i]); return; }
      if (picks.has(i)) picks.delete(i); else picks.add(i);
      b.classList.toggle('is-on', picks.has(i));
    });
    return b;
  }) : []));
  opts.hidden = !choose;
}
async function approve(ok, pick = null) {
  if (!thread?.key) return;
  const note = $('dir-text').value.trim(), ask = thread.ask || {};
  if (ok && ask.kind === 'choose' && ask.multi && !pick) { pick = [...picks]; if (!pick.length) { toast(T('ask.needPick')); return; } }
  if (!ok && !note) { toast(T(thread.gate ? 'approve.needNote' : 'ask.needNote')); $('dir-text').focus(); return; }
  if (DEMO) { toast(T('demo')); return; }
  const btns = [...$('dir-approve').querySelectorAll('button')];
  for (const b of btns) b.disabled = true;
  const r = await postJ('/api/dm/approve', { key: thread.key, ok, note, pick: pick || [] });
  for (const b of btns) b.disabled = false;
  if (!r.ok) { toast(r.message || T('failed')); return; }
  $('dir-text').value = ''; picks = new Set();
  toast(pick?.length ? T('ask.chose') : thread.gate ? T(ok ? 'approve.done' : 'approve.sentBack') : T(ok ? 'ask.done' : 'ask.sentBack'));
  await loadCompany();
  await loadThread(thread.key);
}
// what they ask in the middle of the work (Claude's questions, a plan, a command to allow): the same cards as over the
// office, inside this conversation; the office's stack leaves them to this window while it shows them
function renderPending() {
  const box = $('dir-msgs')?.querySelector('.dir-pending'); if (!box) return;
  const mine = thread ? [...perms.values()].filter((p) => p.dm && p.dm === thread.key) : [];
  const have = new Set([...box.querySelectorAll('.perm-card')].map((c) => c.dataset.id));
  if (mine.length === have.size && mine.every((p) => have.has(p.id))) return;
  const near = nearEnd();
  box.replaceChildren(...(mine.length ? [el('div', 'dir-pending-title', T('ask.pending')), ...mine.map(permCard)] : []));
  if (near) $('dir-msgs').scrollTop = $('dir-msgs').scrollHeight;
}
const nearEnd = () => { const m = $('dir-msgs'); return !m || m.scrollHeight - m.scrollTop - m.clientHeight < 120; };
// their steps while they work: what they say and the tools they use, newest last
function liveNode() {
  const box = el('div', 'dir-live'); box.id = 'dir-live';
  for (const it of live.slice(-14)) {
    if (it.role === 'tool') box.append(el('div', 'dir-live-tool', `🔧 ${it.text}`));
    else { const b = el('div', 'dir-msg dir-live-msg'); b.append(mdBlocks(it.text)); box.append(b); }
  }
  box.hidden = !live.length;
  return box;
}
const sig = (items) => `${items.length}:${items.at(-1)?.ts || ''}:${(items.at(-1)?.text || '').length}`;
async function loadLive() {
  const key = thread?.key; if (!key || DEMO) return;
  const j = await getJ(`/api/dm/live?key=${encodeURIComponent(key)}`);
  if (!j || thread?.key !== key || sig(j.items || []) === sig(live)) return;
  live = j.items || [];
  const old = $('dir-live'); if (!old) return;
  const near = nearEnd(); old.replaceWith(liveNode());
  if (near) $('dir-msgs').scrollTop = $('dir-msgs').scrollHeight;
}
/* While a conversation is open: keep it current even when the office's live stream misses something (a phone on a
   tunnel, a sleeping tab): the thread, their steps while they work, and their own conversation (the editor). */
let tickN = 0;
async function refresh() {
  if (!isOpen() || tab !== 'talk' || hiring || !sel || DEMO || document.visibilityState !== 'visible') return;
  tickN++;
  const key = sel, j = await getJ(`/api/dm?key=${encodeURIComponent(key)}`);
  if (sel !== key) return;
  if (j?.ok) {
    const was = thread, d = j.d;
    const moved = !was || was.msgs?.length !== d.msgs.length || was.msgs?.at(-1)?.id !== d.msgs.at(-1)?.id || !!was.running !== !!d.running || !!was.awaiting !== !!d.awaiting;
    if (moved) { if (!d.running) live = []; thread = d; renderThread(); renderPeople(); }
    if (d.running) { await loadLive(); return; }
  }
  if (tickN % 2 === 0) {   // (their own conversation moved on: in the editor, a terminal)
    const h = await getJ(`/api/dm/history?key=${encodeURIComponent(key)}`);
    if (sel === key && h?.items && sig(h.items) !== sig(history)) { history = h.items; renderThread(); }
  }
}

/* ---------- automation: budgets and the morning run ---------- */
function renderAuto() {
  if (!co) return;
  const b = co.budget || {}, a = co.auto || {};
  $('dir-b-person').value = b.personDay ? Math.round(b.personDay / 1000) : '';
  $('dir-b-project').value = b.projectDay ? Math.round(b.projectDay / 1000) : '';
  $('dir-b-stop').checked = !!b.stop;
  $('dir-a-on').checked = !!a.on;
  $('dir-a-approve').checked = a.approve !== false;
  $('dir-a-at').value = a.at || SCHEDULE.start;
  $('dir-a-prompt').value = a.prompt || '/daily-tasks';
  $('dir-a-title').value = a.title || '';
  permSelect($('dir-a-perm'), a.perm || 'dev');
  for (const id of ['dir-b-person', 'dir-b-project', 'dir-b-stop', 'dir-a-on', 'dir-a-approve', 'dir-a-at', 'dir-a-prompt', 'dir-a-title', 'dir-a-perm', 'dir-auto-save']) $(id).disabled = !co.local;
}
async function saveAuto() {
  if (DEMO) { toast(T('demo')); return; }
  const k = (id) => Math.max(0, Math.round(Number($(id).value) || 0)) * 1000;
  const at = $('dir-a-at').value;
  const r = await postJ('/api/company', { budget: { personDay: k('dir-b-person'), projectDay: k('dir-b-project'), stop: $('dir-b-stop').checked },
    auto: { on: $('dir-a-on').checked, approve: $('dir-a-approve').checked, at: at === SCHEDULE.start ? '' : at, prompt: $('dir-a-prompt').value, title: $('dir-a-title').value, perm: $('dir-a-perm').value } });
  if (r.ok) co = { ...co, ...r.company };
  $('dir-auto-saved').textContent = r.ok ? T('savedAuto') : T('failed');
  setTimeout(() => { $('dir-auto-saved').textContent = ''; }, 5000);
}

/* ---------- a hand-over in the office: the one who finished carries the file to the next one's desk ---------- */
function handoffWalk(fromId, toId) {
  const w = workers.get(fromId), to = workers.get(toId);
  if (!w || !to || w === to || !free(w) || to.away) return;
  const x = to.pos.x, z = to.pos.y, spot = wayTo(w, x, z) || standBy(x, z); if (!spot) return;
  w.carry = 'box';
  w.errand({ spot, look: [x, z], type: 'idle', anim: 'idle', wait: 0.6, hold: 1.4, linger: 1.2, line: T('handoff.walk', { name: short(dn(sessions.get(toId) || {}), 20) }),
    arrived: () => { w.carry = null; const line = T('handoff.thanks'); to.say('idle', line); setTimeout(() => { if (to.lastSay?.text === line) to.hush(); }, 4000); },
    at: () => T('handoff.give'), done: () => { w.carry = null; } });
}

/* ---------- the rules ---------- */
function renderRules() {
  if (!co) return;
  $('dir-company').value = co.name || '';
  $('dir-rules-on').checked = co.rulesOn !== false;
  if (document.activeElement !== $('dir-rules')) $('dir-rules').value = co.rules || '';
  for (const id of ['dir-company', 'dir-rules-on', 'dir-rules', 'dir-rules-save', 'dir-rules-tpl']) $(id).disabled = !co.local;
  const hook = $('dir-hook'); hook.classList.toggle('is-off', !co.hook);
  hook.replaceChildren();
  if (co.hook) hook.textContent = T('rules.hookOn');
  else { hook.append(T('rules.hookOff') + ' '); hook.append(el('code', null, 'node bin/cli.mjs install')); }
  const ul = $('dir-skills');
  ul.replaceChildren(...(co.skills?.length ? co.skills.map((s) => { const li = el('li'); li.append(el('b', null, `${s.kind === 'plugin' ? '🧩' : '📘'} ${s.name}`)); if (s.desc) li.append(el('small', null, short(s.desc, 200))); return li; }) : [el('li', null, T('rules.noSkills'))]));
}
async function saveRules() {
  if (DEMO) { toast(T('demo')); return; }
  const r = await postJ('/api/company', { name: $('dir-company').value, rules: $('dir-rules').value, rulesOn: $('dir-rules-on').checked });
  $('dir-rules-saved').textContent = r.ok ? T('savedRules') : T('failed');
  setTimeout(() => { $('dir-rules-saved').textContent = ''; }, 5000);
  if (r.ok) { co = { ...co, ...r.company }; $('dir-sub').textContent = co.name ? T('subNamed', { name: co.name }) : T('sub'); }
}
function template() {
  const skills = (co?.skills || []).filter((s) => s.kind === 'skill').map((s) => s.name);
  const cur = $('dir-rules').value.trim();
  $('dir-rules').value = (cur ? `${cur}\n\n` : '') + T('rules.tpl', { skills: skills.length ? skills.join(', ') : T('rules.tplNoSkills') });
}

/* ---------- office hours ---------- */
const HOUR_KEYS = ['arrive', 'breakfast', 'start', 'lunch', 'napStart', 'napEnd', 'coffee', 'end'];
function renderHours(s = SCHEDULE) {
  const grid = $('dir-hgrid');
  grid.replaceChildren(...HOUR_KEYS.map((k) => { const l = el('label', null, T(`hours.${k}`)); const i = el('input'); i.type = 'time'; i.step = 300; i.value = s[k]; i.dataset.k = k; i.disabled = !co?.local; l.append(i); return l; }));
  const days = $('dir-wdays');
  const name = (i) => new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + i)));
  days.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((i) => { const l = el('label'); const c = el('input'); c.type = 'checkbox'; c.value = String(i); c.checked = s.days.includes(i); c.disabled = !co?.local; l.append(c, name(i)); return l; }));
  $('dir-today').textContent = T(`hours.now.${dayPart()}`);
  for (const id of ['dir-hours-save', 'dir-hours-reset']) $(id).disabled = !co?.local;
}
async function saveHours() {
  if (DEMO) { toast(T('demo')); return; }
  const s = { days: [...$('dir-wdays').querySelectorAll('input:checked')].map((c) => Number(c.value)) };
  for (const i of $('dir-hgrid').querySelectorAll('input')) s[i.dataset.k] = i.value;
  const r = await postJ('/api/company', { schedule: s });
  if (r.ok) { setSchedule(r.company.schedule); renderHours(); }
  const fixed = r.ok && HOUR_KEYS.some((k) => r.company.schedule[k] !== s[k]);
  $('dir-hours-saved').textContent = !r.ok ? T('failed') : fixed ? T('hours.fixed') : T('savedHours');
  setTimeout(() => { $('dir-hours-saved').textContent = ''; }, 6000);
}

/* ---------- from the live connection (net: demo/demo.js applyMsg) ---------- */
export function onDirectorMsg(d) {
  if (d.k === 'company') { if (d.c?.schedule) setSchedule(d.c.schedule); if (co) co = { ...co, ...d.c }; if (isOpen() && tab === 'hours') renderHours(); return; }
  if (d.k === 'perf') { if (isOpen() && tab === 'perf') { clearTimeout(perfT); perfT = setTimeout(loadPerf, 800); } return; }
  if (d.k === 'handoff') { handoffWalk(d.from, d.to); return; }
  if (d.k === 'budget') { if (d.text) toast(d.text, 7000); return; }
  if (d.k !== 'dm') return;
  if (d.was && sel === d.was) sel = d.d.key;   // (the new hire's conversation got its real id)
  if (co) { const i = (co.dms || []).findIndex((x) => x.key === d.d.key || x.key === d.was); const row = { ...d.d, msgs: d.m ? [d.m] : [] }; if (i >= 0) co.dms[i] = row; else (co.dms ||= []).unshift(row); }
  if (isOpen() && sel === d.d.key) {
    thread = thread && thread.key === d.d.key ? { ...thread, ...d.d, msgs: d.m && !thread.msgs.some((m) => m.id === d.m.id) ? [...thread.msgs, d.m] : thread.msgs } : null;
    if (!thread) loadThread(sel); else renderThread();
  }
  if (isOpen()) { if (d.was) loadCompany(); else renderPeople(); }
  if (d.m?.from === 'agent' && (!isOpen() || sel !== d.d.key)) { unread++; badge(); toast(T(d.d.awaiting ? (d.d.gate ? 'approve.toast' : 'ask.pushTitle') : 'replied', { name: d.d.name }), d.d.awaiting ? 9000 : 3400); }
}
export function onSnapSchedule(s) { if (s) setSchedule(s); }

export function setup() {
  modal = $('dir-modal'); if (!modal) return;
  for (const n of modal.querySelectorAll('[data-icon]')) if (!n.firstChild) n.append(icon(n.dataset.icon));
  $('btn-director')?.addEventListener('click', () => (isOpen() ? close() : openDirector()));
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
  for (const b of modal.querySelectorAll('.dir-tab')) b.addEventListener('click', () => showTab(b.dataset.tab));
  $('dir-input').addEventListener('submit', sendNow);
  window.visualViewport?.addEventListener('resize', fitKeyboard); window.visualViewport?.addEventListener('scroll', fitKeyboard);
  $('dir-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendNow(e); });
  $('dir-stop').addEventListener('click', () => { if (thread?.key) postJ('/api/dm/stop', { key: thread.key }); });
  $('dir-hire-btn').addEventListener('click', startHire);
  for (const b of $('dir-days').querySelectorAll('button')) b.addEventListener('click', () => { perfDays = Number(b.dataset.days); loadPerf(); });
  $('dir-csv').addEventListener('click', csv);
  $('dir-rules-save').addEventListener('click', saveRules);
  $('dir-rules-tpl').addEventListener('click', template);
  $('dir-hours-save').addEventListener('click', saveHours);
  $('dir-hours-reset').addEventListener('click', () => renderHours({ ...DEFAULT_SCHEDULE }));
  $('dir-auto-save').addEventListener('click', saveAuto);
  $('dir-approve-ok').addEventListener('click', () => approve(true));
  $('dir-msgs').addEventListener('click', (e) => { if (e.target.closest('.dir-pending')) permClick(e); });
  setShownElsewhere((p) => isOpen() && tab === 'talk' && !!thread && !!p.dm && p.dm === thread.key);
  permWatch.add(() => { if (isOpen() && thread) renderPending(); });
  setInterval(() => { refresh().catch(() => {}); }, 2500);
  document.addEventListener('visibilitychange', () => { tickN = 1; refresh().catch(() => {}); });   // (back to the page, a phone unlocked: catch up at once)
  setInterval(() => { for (const c of modal.querySelectorAll('.dir-pending .perm-card')) c._tick?.(); }, 1000);
  $('dir-approve-no').addEventListener('click', () => approve(false));
  $('dir-text').addEventListener('input', () => { if (forceArmed) { forceArmed = false; $('dir-send').lastChild.textContent = T('send'); } });
  if (new URLSearchParams(location.search).has('director')) setTimeout(() => openDirector(), 600);
}
