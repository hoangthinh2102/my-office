// What the agent-support skills (/do-task, /daily-tasks, /fix-mr) leave behind on this computer, read only:
//   ~/.agent-support/config.json         the workspace: repos this person may work on
//   ~/.agent-support/state/<guid>.json   one Lark task each: summary, link, status, MRs, the dev pipeline
//   ~/.agent-support/actions.jsonl       what they did and when: an MR opened, a Lark comment, a file attached…
// The performance board uses it to tie a job (a prompt until it finished) to the Lark tasks it worked on and to what it
// delivered (merge requests), so a task's cost can be read whole, not prompt by prompt.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function createAgentSupport({ home = os.homedir() } = {}) {
  const base = path.join(home, '.agent-support');
  const stateDir = path.join(base, 'state'), actionsFile = path.join(base, 'actions.jsonl');
  const exists = () => fs.existsSync(base);

  /** The workspace: its root folder and the repos in it ({ name, dir }), or null. */
  function workspace() {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(base, 'config.json'), 'utf8'));
      const repos = Object.entries(c.repo_paths || {}).filter(([, p]) => typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p));
      if (!repos.length) return null;
      // the root: the workspace root that holds most of the repos, the home folder only if no other is given (a repo
      // outside it is still opened to the tools with --add-dir)
      const all = (c.workspace_roots || []).filter((r) => typeof r === 'string' && path.isAbsolute(r) && fs.existsSync(r));
      const roots = all.filter((r) => path.resolve(r) !== home);
      if (!roots.length && all.length) roots.push(home);
      const holds = (r) => repos.filter(([, p]) => p.startsWith(r + path.sep)).length;
      const root = roots.sort((a, b) => holds(b) - holds(a) || b.length - a.length)[0] || path.dirname(repos[0][1]);
      return { root, repos: repos.map(([name, dir]) => ({ name, dir })) };
    } catch { return null; }
  }

  /** a Lark task's guid in what you typed (/do-task <link or guid>), or null */
  const taskInPrompt = (text) => UUID.exec(String(text || ''))?.[0]?.toLowerCase() || null;

  // the action log, re-read only when it changed (its tail: the last ~2 MB is weeks of work)
  let cache = { size: -1, mtime: 0, rows: [] };
  async function actions() {
    let st; try { st = await fsp.stat(actionsFile); } catch { return []; }
    if (st.size === cache.size && st.mtimeMs === cache.mtime) return cache.rows;
    const len = Math.min(st.size, 2 * 1024 * 1024), buf = Buffer.alloc(len), fh = await fsp.open(actionsFile, 'r');
    try { await fh.read(buf, 0, len, st.size - len); } finally { await fh.close(); }
    const rows = [];
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.startsWith('{')) continue;
      try { const r = JSON.parse(line); const ts = Date.parse(r.ts); if (Number.isFinite(ts)) rows.push({ ...r, at: ts }); } catch { /* a cut line */ }
    }
    cache = { size: st.size, mtime: st.mtimeMs, rows };
    return rows;
  }

  async function taskInfo(guid) {
    if (!UUID.test(String(guid || ''))) return null;
    try {
      const s = JSON.parse(await fsp.readFile(path.join(stateDir, `${guid}.json`), 'utf8'));
      const list = (v) => (Array.isArray(v) ? v : String(v || '').replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean));
      return { guid, summary: String(s.summary || '').slice(0, 160), url: typeof s.url === 'string' && /^https:\/\//.test(s.url) ? s.url : '', status: s.status || '', phase: s.phase || '',
        mrs: list(s.mrs).filter((u) => /^https:\/\//.test(u)), pipeline: s.dev_pipeline || '', updatedAt: Date.parse(s.updated_at) || 0 };
    } catch { return null; }
  }

  /** What the skills did between two moments: the Lark tasks they touched and the merge requests they opened. */
  async function during(from, to) {
    if (!exists()) return { tasks: [], mrs: [] };
    const tasks = new Set(), mrs = [];
    for (const r of await actions()) {
      if (r.at < from || r.at > to + 5000) continue;
      if (typeof r.task === 'string' && UUID.test(r.task)) tasks.add(r.task.toLowerCase());
      if (r.action === 'mr_create' && typeof r.mr === 'string') mrs.push(r.mr);
    }
    // a task whose state changed meanwhile (phases are written as the skill goes, even before anything is sent)
    try {
      for (const n of await fsp.readdir(stateDir)) {
        if (!n.endsWith('.json')) continue;
        const st = await fsp.stat(path.join(stateDir, n));
        if (st.mtimeMs >= from && st.mtimeMs <= to + 5000) tasks.add(n.slice(0, -5).toLowerCase());
      }
    } catch { /* no state yet */ }
    return { tasks: [...tasks].filter((g) => UUID.test(g)).slice(0, 20), mrs: [...new Set(mrs)].slice(0, 20) };
  }

  return { exists, workspace, taskInPrompt, taskInfo, during };
}
