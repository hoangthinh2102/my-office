// The company: what you, the director, decide for everyone who works here. Kept in data/company.json.
//
//   rules     the company's rules, in your words. Every Claude Code session gets them as it starts (the SessionStart
//             hook /hook/session-start answers with them as additionalContext), and every run the office starts
//             gets them through --append-system-prompt, so the editor's sessions and the office's follow the same ones.
//   schedule  office hours: arrival, breakfast, lunch, the nap, going home, the working days. The people in the 3D
//             office live by it (src/office/core/schedule.js); work that is still running keeps them at their desk
//             (overtime, counted in the performance board).
//   roles     a job title and a brief for a person (a conversation, by its session id): "Backend dev — owns the API".
//             The brief goes with every message you send that person from the office.
//
// skills() lists the skills and plugins Claude Code loads for every session on this machine (~/.claude/skills,
// ~/.claude/plugins), so the director can see which ways of working everyone already follows.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_SCHEDULE = Object.freeze({
  arrive: '08:00',      // people start coming in (each at their own minute, until `start`)
  start: '08:30',       // work starts
  breakfast: '08:00',   // breakfast at the pantry, until `start`
  lunch: '11:45',       // lunch at the pantry, until `napStart`
  napStart: '12:30',
  napEnd: '13:30',
  coffee: '15:00',      // the afternoon coffee queue (45 minutes)
  end: '18:00',         // work ends: whoever has nothing running packs up and goes home
  days: [1, 2, 3, 4, 5],   // 0 Sunday … 6 Saturday
});
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RULES = 8000, MAX_ROLE = 600;
export const minutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

/** A schedule from anything (a form, an old file): every field valid, in order, else the default's. */
export function cleanSchedule(x = {}) {
  const s = { ...DEFAULT_SCHEDULE };
  for (const k of ['arrive', 'start', 'breakfast', 'lunch', 'napStart', 'napEnd', 'coffee', 'end']) if (HHMM.test(String(x?.[k] || ''))) s[k] = x[k];
  if (Array.isArray(x?.days)) { const d = [...new Set(x.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(); if (d.length) s.days = d; }
  const m = (k) => minutes(s[k]);
  // the day must read in order; a schedule that doesn't (lunch after going home…) falls back to the default
  const order = ['arrive', 'start', 'lunch', 'napStart', 'napEnd', 'end'];
  if (order.some((k, i) => i && m(k) < m(order[i - 1])) || m('breakfast') < m('arrive') || m('breakfast') > m('start')) return { ...DEFAULT_SCHEDULE, days: s.days };
  return s;
}

const DEFAULT_RULES = '';

/* What a person may do without asking (a run the office starts: claude -p with these flags). 'auto' (the default) is
   Claude Code's auto mode, as in your own sessions: Claude decides what is safe by itself, with your autoMode rules
   from ~/.claude/settings.json, and only what it would ask you about comes to you (in the office, or on your phone).
   'ask' leaves every approval to you. The job profiles run in auto mode too, with their own allow and deny lists.
   Deny rules win over allow rules; agent-support's own guard hook still blocks pushing to main / dev. */
const READ = ['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'Skill', 'TodoWrite', 'Task', 'Agent', 'TaskCreate', 'TaskUpdate', 'TaskList'];
const SHELL_READ = ['git status', 'git diff', 'git log', 'git show', 'git branch', 'git fetch', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'pwd', 'which', 'python3'].map((c) => `Bash(${c}:*)`);
const SHELL_BUILD = ['git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'tsc', 'go', 'make', 'cargo', 'pytest', 'mkdir', 'cp', 'mv', 'touch'].map((c) => `Bash(${c}:*)`);
const NEVER_EVER = ['git push --force', 'git push -f', 'git push origin main', 'git push origin master'].map((c) => `Bash(${c}:*)`);
const NEVER = ['git push --force', 'git push -f', 'git push origin main', 'git push origin master', 'git push origin dev', 'git reset --hard', 'rm -rf', 'sudo', 'git clean -fd'].map((c) => `Bash(${c}:*)`);
export const PERMS = {
  auto: { mode: 'auto', allow: [], deny: NEVER_EVER },
  ask: { mode: 'default', allow: [], deny: [] },
  dev: { mode: 'auto', allow: [...READ, 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', ...SHELL_READ, ...SHELL_BUILD], deny: NEVER },
  qa: { mode: 'auto', allow: [...READ, 'Edit', 'MultiEdit', 'Write', ...SHELL_READ, ...SHELL_BUILD], deny: [...NEVER, 'Bash(git push:*)'] },
  reviewer: { mode: 'auto', allow: [...READ, ...SHELL_READ], deny: [...NEVER, 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash(git commit:*)', 'Bash(git push:*)'] },
};
/** the command-line flags for a permission profile */
export const DEFAULT_PERM = 'auto';
export function permArgs(perm) {
  const p = PERMS[perm] || PERMS[DEFAULT_PERM];
  return ['--permission-mode', p.mode, ...(p.allow.length ? ['--allowedTools', ...p.allow] : []), ...(p.deny.length ? ['--disallowedTools', ...p.deny] : [])];
}
export const DEFAULT_BUDGET = Object.freeze({ personDay: 0, projectDay: 0, stop: false });   // tokens a day (0: no limit)
// the morning run: on by default, Monday to Friday (the schedule's days); with `approve`, it only reads and proposes a plan,
// and gets `perm` once you approve it
export const DEFAULT_AUTO = Object.freeze({ on: process.env.OFFICE_AUTO_DEFAULT !== 'off', at: '', prompt: '/daily-tasks', title: 'Trưởng nhóm', perm: 'auto', approve: true, last: '' });
const cleanBudget = (b = {}) => ({ personDay: Math.max(0, Math.min(1e9, Math.round(Number(b?.personDay) || 0))), projectDay: Math.max(0, Math.min(1e9, Math.round(Number(b?.projectDay) || 0))), stop: !!b?.stop });
const cleanAuto = (a = {}, prev = DEFAULT_AUTO) => ({ on: !!a?.on, at: HHMM.test(String(a?.at || '')) ? a.at : '', prompt: String(a?.prompt ?? prev.prompt).trim().slice(0, 400) || DEFAULT_AUTO.prompt,
  title: String(a?.title ?? prev.title).trim().slice(0, 60), perm: Object.hasOwn(PERMS, a?.perm) ? a.perm : prev.perm, approve: typeof a?.approve === 'boolean' ? a.approve : prev.approve !== false,
  last: typeof a?.last === 'string' ? a.last : prev.last || '' });

export function createCompany({ dataDir, claudeDir }) {
  const file = path.join(dataDir, 'company.json');
  let c = { name: '', rules: DEFAULT_RULES, rulesOn: true, schedule: { ...DEFAULT_SCHEDULE }, roles: {}, budget: { ...DEFAULT_BUDGET }, auto: { ...DEFAULT_AUTO } };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    c = { ...c, ...j, schedule: cleanSchedule(j.schedule), roles: j.roles && typeof j.roles === 'object' ? j.roles : {}, budget: cleanBudget(j.budget), auto: cleanAuto(j.auto) };
  } catch { /* first run */ }
  let saveT = null;
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => { fsp.writeFile(`${file}.tmp`, JSON.stringify(c, null, 2)).then(() => fsp.rename(`${file}.tmp`, file)).catch(() => {}); }, 300);
  };

  /** The rules as Claude reads them: a short header so it knows who wrote them and that they bind. '' when off or empty. */
  function rulesContext(role = null, { rules: withRules = true } = {}) {
    const parts = [];
    const rules = withRules && c.rulesOn ? String(c.rules || '').trim() : '';
    if (rules) parts.push(`# Company rules (from the director${c.name ? ` of ${c.name}` : ''}, via My Office)\nFollow these in everything you do in this session. If a rule conflicts with an explicit instruction the user gives you in this conversation, follow the user and say so.\n\n${rules}`);
    if (role?.title || role?.brief) parts.push(`# Your role in the company\n${[role.title, role.brief].filter(Boolean).join(' — ')}`);
    return parts.join('\n\n');
  }

  /** Skills and plugins every session on this machine loads (names and one line each), for the director's view. */
  async function skills() {
    const out = [];
    const dirs = [path.join(claudeDir, 'skills')];
    for (const d of dirs) {
      let names = []; try { names = await fsp.readdir(d); } catch { continue; }
      for (const n of names) {
        const f = path.join(d, n, 'SKILL.md');
        let text = ''; try { text = await fsp.readFile(f, 'utf8'); } catch { continue; }
        const desc = /^description:\s*(.+)$/m.exec(text)?.[1] || '';
        out.push({ name: n, kind: 'skill', desc: desc.replace(/^["']|["']$/g, '').slice(0, 220) });
      }
    }
    try {
      const j = JSON.parse(await fsp.readFile(path.join(claudeDir, 'plugins', 'installed_plugins.json'), 'utf8'));
      for (const name of Object.keys(j.plugins || j || {})) if (name !== 'version') out.push({ name, kind: 'plugin', desc: '' });
    } catch { /* no plugins */ }
    return out;
  }

  return {
    get: () => c,
    pub: () => ({ name: c.name, rules: c.rules, rulesOn: c.rulesOn, schedule: c.schedule, roles: c.roles, budget: c.budget, auto: c.auto }),
    rulesContext,
    roleOf: (sid) => (sid && c.roles[sid]) || null,
    skills,
    /** { name?, rules?, rulesOn?, schedule? } -> the company as it is now */
    set(b = {}) {
      if (typeof b.name === 'string') c.name = b.name.trim().slice(0, 60);
      if (typeof b.rules === 'string') c.rules = b.rules.slice(0, MAX_RULES);
      if (typeof b.rulesOn === 'boolean') c.rulesOn = b.rulesOn;
      if (b.schedule && typeof b.schedule === 'object') c.schedule = cleanSchedule(b.schedule);
      if (b.budget && typeof b.budget === 'object') c.budget = cleanBudget(b.budget);
      if (b.auto && typeof b.auto === 'object') c.auto = cleanAuto(b.auto, c.auto);
      save();
      return c;
    },
    /** the morning run went today (so it doesn't go twice) */
    autoRan(dayKey) { c.auto = { ...c.auto, last: dayKey }; save(); },
    /** a role for a conversation (session id): a title, a brief, what they may do without asking (PERMS), and whom
        they hand their finished work to (another conversation's id). Empty, it is taken away. */
    setRole(sid, { title = '', brief = '', perm = DEFAULT_PERM, next = '' } = {}) {
      if (!/^[\w-]{8,64}$/.test(String(sid || ''))) return false;
      title = String(title).trim().slice(0, 60); brief = String(brief).trim().slice(0, MAX_ROLE);
      perm = Object.hasOwn(PERMS, perm) ? perm : DEFAULT_PERM;
      next = /^[\w-]{8,64}$/.test(String(next || '')) && next !== sid ? String(next) : '';
      if (!title && !brief && perm === DEFAULT_PERM && !next) delete c.roles[sid]; else c.roles[sid] = { title, brief, perm, next };
      const keys = Object.keys(c.roles); if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete c.roles[k];
      save();
      return true;
    },
  };
}
