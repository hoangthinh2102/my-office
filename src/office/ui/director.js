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
import { t as tr, num, locale } from '../../i18n/index.js';

const T = (k, v) => tr(`director.${k}`, v);
const api = (p) => `${p}${TOKEN ? `${p.includes('?') ? '&' : '?'}k=${encodeURIComponent(TOKEN)}` : ''}`;
const getJ = (p) => fetch(api(p), { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
const postJ = (p, body) => fetch(api(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));

let modal, tab = 'talk', co = null, sel = null, thread = null, hiring = false, perfDays = 7, perfData = null, unread = 0, perfT = null, forceArmed = false;
const PERM_KEYS = ['ask', 'dev', 'qa', 'reviewer'];
// a <select> of permission profiles, and one of the people to hand finished work to
function permSelect(sel, value = 'ask') { sel.replaceChildren(...(co?.perms || PERM_KEYS).map((k) => { const o = el('option', null, T(`perm.${k}`)); o.value = k; o.title = T(`perm.${k}Hint`); return o; })); sel.value = value || 'ask'; sel.title = T(`perm.${sel.value}Hint`); return sel; }
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
  modal.hidden = false; $('btn-director')?.setAttribute('aria-pressed', 'true');
  unread = 0; badge();
  showTab(which);
  await loadCompany();
}
function close() { modal.hidden = true; $('btn-director')?.setAttribute('aria-pressed', 'false'); }
function showTab(which) {
  tab = which;
  for (const b of modal.querySelectorAll('.dir-tab')) b.classList.toggle('is-sel', b.dataset.tab === which);
  for (const p of modal.querySelectorAll('.dir-pane')) p.hidden = p.dataset.pane !== which;
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
  if (!rows.length) rows.push(el('p', 'dir-note', T('noPeople')));
  list.replaceChildren(...rows);
}
const personOf = (key) => co?.people?.find((p) => p.sid === key) || null;

/* ---------- one conversation ---------- */
async function select(key) {
  sel = key; hiring = false; $('dir-hire').hidden = true;
  for (const b of $('dir-plist').querySelectorAll('.dir-person')) b.classList.toggle('is-sel', b.dataset.key === key);
  thread = (co?.dms || []).find((d) => d.key === key) || null;
  renderThread();
  await loadThread(key);
}
async function loadThread(key) {
  if (DEMO || !key) return;
  const j = await getJ(`/api/dm?key=${encodeURIComponent(key)}`);
  if (sel !== key) return;
  thread = j?.ok ? j.d : null;
  renderThread();
}
function renderHead() {
  const head = $('dir-chead');
  if (hiring) { head.replaceChildren(el('span', 'dir-cname', T('hire.title'))); return; }
  if (!sel) { head.replaceChildren(); return; }
  const p = personOf(sel), name = p?.name || thread?.name || sel, dir = p?.dir || thread?.dir || '';
  const role = p?.role || thread?.role || null;
  const kids = [el('span', 'dir-cname', name), el('span', 'dir-cdir', dir)];
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
  $('dir-approve').hidden = hiring || !thread?.awaiting || !!thread?.running;
  if (hiring) {
    box.replaceChildren(el('p', 'dir-empty', T('hire.note')));
    $('dir-mode').textContent = T('modeHint.hire');
    return;
  }
  if (!sel) { box.replaceChildren(el('p', 'dir-empty', T('pick'))); $('dir-mode').textContent = ''; return; }
  const msgs = thread?.msgs || [];
  box.replaceChildren(...(msgs.length ? msgs.map(msgNode) : [el('p', 'dir-empty', T('first', { name: personOf(sel)?.name || thread?.name || '' }))]));
  if (thread?.running) box.append(el('div', 'dir-typing', T('typing', { name: personOf(sel)?.name || thread?.name || '' })));
  box.scrollTop = box.scrollHeight;
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
  permSelect($('dir-hire-perm'), 'dev'); nextSelect($('dir-hire-next'));
  $('dir-hire').hidden = false;
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

/* ---------- a plan waiting for you (the morning run): approve it and work starts, or send it back with a note ---------- */
async function approve(ok) {
  if (!thread?.key) return;
  const note = $('dir-text').value.trim();
  if (!ok && !note) { toast(T('approve.needNote')); $('dir-text').focus(); return; }
  if (DEMO) { toast(T('demo')); return; }
  for (const id of ['dir-approve-ok', 'dir-approve-no']) $(id).disabled = true;
  const r = await postJ('/api/dm/approve', { key: thread.key, ok, note });
  for (const id of ['dir-approve-ok', 'dir-approve-no']) $(id).disabled = false;
  if (!r.ok) { toast(r.message || T('failed')); return; }
  $('dir-text').value = '';
  toast(T(ok ? 'approve.done' : 'approve.sentBack'));
  await loadCompany();
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
  if (d.m?.from === 'agent' && (!isOpen() || sel !== d.d.key)) { unread++; badge(); toast(T(d.d.awaiting ? 'approve.toast' : 'replied', { name: d.d.name }), d.d.awaiting ? 9000 : 3400); }
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
  $('dir-approve-no').addEventListener('click', () => approve(false));
  $('dir-text').addEventListener('input', () => { if (forceArmed) { forceArmed = false; $('dir-send').lastChild.textContent = T('send'); } });
  if (new URLSearchParams(location.search).has('director')) setTimeout(() => openDirector(), 600);
}
