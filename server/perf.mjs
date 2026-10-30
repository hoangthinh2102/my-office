// Performance: what each piece of work cost and what came of it. A "job" is one task you gave a person (a prompt) until
// they finished it (Stop), failed (StopFailure) or were interrupted. For each job the office writes down:
//   cost      the tokens it took (read from the transcripts, subagents included: the session's usage when the job
//             ended minus when it started), the API-price equivalent, the time, tool calls and how many failed, and
//             how much of it ran outside office hours (overtime)
//   outcome   commits and pushes made meanwhile (the office watches git), CI going red, and, with the agent-support
//             skills, the Lark tasks it worked on and the merge requests it opened (server/agent-support.mjs)
//   kind      'task' (/do-task), 'daily' (/daily-tasks), 'rework' (/fix-mr: changes asked for in review), 'chat'
// One line per job in data/perf/YYYY-MM-DD.jsonl, kept 60 days.
//
// The board (/api/perf) adds them up per person, per project and per Lark task, and gives each person a score out of
// 100 with its parts shown, so it can be argued with:
//   delivered 30%  jobs that produced something (a commit, a push or a merge request) ÷ jobs that were work
//   cost      30%  the team's median cost per delivered job ÷ theirs (100 = like the team; capped at twice as good)
//   done      20%  jobs finished ÷ jobs started
//   clean     20%  tool calls that didn't fail
//   minus up to 15 for rework (review sent work back: /fix-mr) and up to 10 for CI turning red
// A job's size depends on the task, so the score compares like with like only over many jobs: a yardstick, not a
// verdict.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { minutes } from './company.mjs';

const KEEP_DAYS = 60;
const day = (ts) => new Date(ts).toLocaleDateString('sv-SE');

/** Minutes of [from, to] outside office hours (all of it on a day off). */
export function overtimeMin(from, to, sched) {
  if (!(to > from)) return 0;
  let ot = 0;
  const s = minutes(sched.start), e = minutes(sched.end);
  for (let t = from; t < to;) {
    const d = new Date(t), midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), next = midnight + 864e5;
    const a = t, b = Math.min(to, next), total = (b - a) / 60e3;
    if (!sched.days.includes(d.getDay())) ot += total;
    else {
      const ws = midnight + s * 60e3, we = midnight + e * 60e3;
      ot += total - Math.max(0, Math.min(b, we) - Math.max(a, ws)) / 60e3;
    }
    t = b;
  }
  return Math.round(ot);
}
/** what kind of job a prompt starts */
export const kindOf = (prompt) => {
  const p = String(prompt || '').trim();
  if (/^\/(agent-support:)?fix-mr\b/i.test(p)) return 'rework';
  if (/^\/(agent-support:)?do-task\b/i.test(p)) return 'task';
  if (/^\/(agent-support:)?daily-tasks?\b/i.test(p)) return 'daily';
  return 'chat';
};
const median = (xs) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const tokensOf = (j) => (j.tokIn || 0) + (j.out || 0);

/** schedule() -> office hours; taskOf(prompt) -> a Lark task guid in it; taskInfo(guid) -> its summary, link… */
export function createPerf({ dataDir, schedule, taskOf = () => null, taskInfo = async () => null }) {
  const dir = path.join(dataDir, 'perf');
  fs.mkdirSync(dir, { recursive: true });
  const open = new Map();   // session key -> the job running
  let todayCache = { day: '', jobs: [] };   // today's finished jobs, for budgets
  let writeQ = Promise.resolve();

  function prune() {
    fsp.readdir(dir).then((names) => {
      const cut = day(Date.now() - KEEP_DAYS * 864e5);
      for (const n of names) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(0, 10) < cut) fsp.rm(path.join(dir, n), { force: true }).catch(() => {});
    }).catch(() => {});
  }
  prune(); setInterval(prune, 12 * 3600e3).unref();
  try {   // today's jobs so far (a restart in the middle of the day keeps the budgets right)
    const text = fs.readFileSync(path.join(dir, `${day(Date.now())}.jsonl`), 'utf8');
    todayCache = { day: day(Date.now()), jobs: text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
  } catch { /* none yet */ }

  const snap = (u) => ({ in: u?.in || 0, cr: u?.cr || 0, out: u?.out || 0, cost: u?.cost || 0 });

  /** A job starts: who, what, and their usage so far (already read up to now). */
  function begin(s, { prompt, usage, src }) {
    if (open.get(s.key)) finish(s, { usage, ok: true, why: 'next' });   // (a new task while one was open: the old one is done)
    open.set(s.key, { start: Date.now(), prompt: String(prompt || '').slice(0, 140), base: snap(usage), tools: 0, fails: 0, edits: 0, subs: 0, commits: 0, pushes: 0, ciRed: 0, src: src || 'ide' });
  }
  /** a tool call in the running job (failed or not; an edit; a subagent sent off) */
  function tool(s, { failed = false, edit = false, sub = false } = {}) {
    const j = open.get(s.key); if (!j) return;
    j.tools++; if (failed) j.fails++; if (edit) j.edits++; if (sub) j.subs++;
  }
  /** something git showed while the job ran: 'commit', 'push', 'cired' */
  function note(s, what) {
    const j = open.get(s.key); if (!j) return;
    if (what === 'commit') j.commits++; else if (what === 'push') j.pushes++; else if (what === 'cired') j.ciRed++;
  }
  const has = (s) => open.has(s.key);
  /** how much the running job has used so far (tokens), for budgets */
  function live(s, usage) { const j = open.get(s.key); if (!j) return 0; const u = snap(usage); return Math.max(0, (u.in - u.cr) - (j.base.in - j.base.cr)) + Math.max(0, u.out - j.base.out); }
  /** The job ends: what it cost is the usage now minus the usage when it started. Returns the line written. */
  function finish(s, { usage, ok, why = '', extra = null }) {
    const j = open.get(s.key); if (!j) return null;
    open.delete(s.key);
    const now = Date.now(), u = snap(usage), b = j.base;
    const own = taskOf(j.prompt);
    const tasks = [...new Set([...(own ? [own] : []), ...(extra?.tasks || [])])].slice(0, 20);
    const rec = {
      ts: now, start: j.start, dur: now - j.start,
      sid: s.sid || '', name: s.title || s.name || '', project: path.basename(s.cwd || '') || '',
      prompt: j.prompt, kind: kindOf(j.prompt), model: usage?.model || '',
      tokIn: Math.max(0, (u.in - u.cr) - (b.in - b.cr)), cacheRead: Math.max(0, u.cr - b.cr), out: Math.max(0, u.out - b.out),
      cost: Math.max(0, Math.round((u.cost - b.cost) * 10000) / 10000),
      tools: j.tools, fails: j.fails, edits: j.edits, subs: j.subs,
      commits: j.commits, pushes: j.pushes, ciRed: j.ciRed, mrs: (extra?.mrs || []).slice(0, 20), tasks,
      ok: !!ok, why, src: j.src, ot: overtimeMin(j.start, now, schedule()),
    };
    // one write at a time, in order (two jobs ending together would otherwise race)
    writeQ = writeQ.then(() => fsp.appendFile(path.join(dir, `${day(now)}.jsonl`), JSON.stringify(rec) + '\n')).catch(() => {});
    if (todayCache.day !== day(now)) todayCache = { day: day(now), jobs: [] };
    todayCache.jobs.push(rec);
    return rec;
  }
  /** tokens used today (finished jobs), by person (sid) and by project */
  function today() {
    if (todayCache.day !== day(Date.now())) todayCache = { day: day(Date.now()), jobs: [] };
    const bySid = new Map(), byProject = new Map();
    for (const j of todayCache.jobs) {
      bySid.set(j.sid, (bySid.get(j.sid) || 0) + tokensOf(j));
      byProject.set(j.project, (byProject.get(j.project) || 0) + tokensOf(j));
    }
    return { bySid, byProject };
  }

  async function readDays(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      let text = ''; try { text = await fsp.readFile(path.join(dir, `${day(Date.now() - i * 864e5)}.jsonl`), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* half a line */ } }
    }
    return out;
  }
  const delivered = (j) => (j.commits || 0) + (j.pushes || 0) + (j.mrs?.length || 0) > 0;

  /** The board over the last `days` days: per person, per project, per Lark task, the latest jobs, and the totals. */
  async function board(days = 7) {
    await writeQ;   // (the jobs just finished are on disk)
    days = Math.max(1, Math.min(KEEP_DAYS, Math.round(days) || 7));
    const jobs = await readDays(days);
    const group = (keyOf, nameOf) => {
      const m = new Map();
      for (const j of jobs) {
        const k = keyOf(j); if (!k) continue;
        let g = m.get(k);
        if (!g) m.set(k, g = { key: k, name: nameOf(j), project: j.project, jobs: 0, done: 0, work: 0, delivered: 0, rework: 0, tokIn: 0, out: 0, cacheRead: 0, cost: 0, dur: 0, tools: 0, fails: 0, edits: 0, commits: 0, pushes: 0, mrs: 0, ciRed: 0, ot: 0, last: 0, people: new Set() });
        g.jobs++; if (j.ok) g.done++;
        if (j.kind !== 'chat' || j.edits || delivered(j)) g.work++;   // (a question answered is not work to deliver)
        if (delivered(j)) g.delivered++;
        if (j.kind === 'rework') g.rework++;
        g.tokIn += j.tokIn; g.out += j.out; g.cacheRead += j.cacheRead; g.cost += j.cost; g.dur += j.dur;
        g.tools += j.tools; g.fails += j.fails; g.edits += j.edits; g.ot += j.ot || 0;
        g.commits += j.commits || 0; g.pushes += j.pushes || 0; g.mrs += j.mrs?.length || 0; g.ciRed += j.ciRed || 0;
        if (j.name) g.people.add(j.name);
        if (j.ts > g.last) { g.last = j.ts; g.name = nameOf(j) || g.name; }   // (a person's latest name: titles change)
      }
      return [...m.values()].map((g) => ({ ...g, people: [...g.people], cost: Math.round(g.cost * 10000) / 10000 }));
    };
    const people = group((j) => j.sid || j.name, (j) => j.name || j.sid.slice(0, 8));
    const per = (p) => p.cost / Math.max(1, p.delivered || p.jobs);   // cost per delivered job (per job when nothing was delivered)
    const teamMedian = median(people.map(per));
    for (const p of people) {
      const costScore = per(p) > 0 && teamMedian > 0 ? Math.min(200, (teamMedian / per(p)) * 100) / 2 : 50;   // 0–100
      const deliveredScore = p.work ? (p.delivered / p.work) * 100 : 50;
      const doneScore = (p.done / p.jobs) * 100, cleanScore = p.tools ? (1 - p.fails / p.tools) * 100 : 100;
      const reworkPenalty = Math.min(15, p.work ? (p.rework / p.work) * 30 : 0), ciPenalty = Math.min(10, p.ciRed * 2);
      p.score = Math.max(0, Math.min(100, Math.round(deliveredScore * 0.3 + costScore * 0.3 + doneScore * 0.2 + cleanScore * 0.2 - reworkPenalty - ciPenalty)));
      p.parts = { delivered: Math.round(deliveredScore), cost: Math.round(costScore), done: Math.round(doneScore), clean: Math.round(cleanScore), rework: reworkPenalty ? -Math.round(reworkPenalty) : 0, ci: ciPenalty ? -ciPenalty : 0 };
      p.perJob = { tokens: Math.round((p.tokIn + p.out) / p.jobs), cost: Math.round((p.cost / p.jobs) * 10000) / 10000, min: Math.round(p.dur / p.jobs / 6e3) / 10, perDelivered: p.delivered ? Math.round((p.cost / p.delivered) * 10000) / 10000 : null };
      p.cost = Math.round(p.cost * 100) / 100;
    }
    people.sort((a, b) => b.score - a.score || b.jobs - a.jobs);
    const projects = group((j) => j.project || '—', (j) => j.project || '—').sort((a, b) => b.cost - a.cost);
    // per Lark task: a job that touched several tasks splits its cost evenly between them
    const byTask = new Map();
    for (const j of jobs) {
      const ts = j.tasks || []; if (!ts.length) continue;
      for (const g of ts) {
        let t = byTask.get(g);
        if (!t) byTask.set(g, t = { guid: g, jobs: 0, rework: 0, tokens: 0, cost: 0, dur: 0, mrs: new Set(), people: new Set(), first: j.start, last: j.ts });
        t.jobs++; if (j.kind === 'rework') t.rework++;
        t.tokens += Math.round(tokensOf(j) / ts.length); t.cost += j.cost / ts.length; t.dur += j.dur / ts.length;
        for (const m of j.mrs || []) t.mrs.add(m);
        if (j.name) t.people.add(j.name);
        t.first = Math.min(t.first, j.start); t.last = Math.max(t.last, j.ts);
      }
    }
    const tasks = await Promise.all([...byTask.values()].sort((a, b) => b.last - a.last).slice(0, 40).map(async (t) => {
      const info = await taskInfo(t.guid).catch(() => null);
      return { ...t, cost: Math.round(t.cost * 10000) / 10000, mrs: [...new Set([...t.mrs, ...(info?.mrs || [])])], people: [...t.people],
        summary: info?.summary || '', url: info?.url || '', status: info?.status || '', pipeline: info?.pipeline || '' };
    }));
    const total = jobs.reduce((t, j) => ({ jobs: t.jobs + 1, done: t.done + (j.ok ? 1 : 0), delivered: t.delivered + (delivered(j) ? 1 : 0), tokIn: t.tokIn + j.tokIn, out: t.out + j.out, cacheRead: t.cacheRead + j.cacheRead, cost: t.cost + j.cost, ot: t.ot + (j.ot || 0), mrs: t.mrs + (j.mrs?.length || 0) }),
      { jobs: 0, done: 0, delivered: 0, tokIn: 0, out: 0, cacheRead: 0, cost: 0, ot: 0, mrs: 0 });
    total.cost = Math.round(total.cost * 100) / 100;
    const byDay = new Map();
    for (let i = days - 1; i >= 0; i--) byDay.set(day(Date.now() - i * 864e5), { day: day(Date.now() - i * 864e5), jobs: 0, cost: 0, tokens: 0 });
    for (const j of jobs) { const d = byDay.get(day(j.ts)); if (d) { d.jobs++; d.cost = Math.round((d.cost + j.cost) * 100) / 100; d.tokens += tokensOf(j); } }
    const recent = jobs.slice(-40).reverse().map(({ ts, dur, name, project, prompt, kind, tokIn, out, cacheRead, cost, ok, why, tools, fails, ot, sid, commits, pushes, mrs, tasks: tk }) =>
      ({ ts, dur, name, project, prompt, kind, tokIn, out, cacheRead, cost, ok, why, tools, fails, ot, sid, commits: commits || 0, pushes: pushes || 0, mrs: mrs || [], tasks: tk || [] }));
    return { ok: true, days, total, people, projects, tasks, byDay: [...byDay.values()], recent, teamMedian: Math.round(teamMedian * 10000) / 10000 };
  }

  return { begin, tool, note, finish, has, live, today, board, startOf: (s) => open.get(s.key)?.start || 0, openJobs: () => open.size };
}
