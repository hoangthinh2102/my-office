// The "/" list of the director's office: the skills and commands a person's Claude Code would offer when you type "/",
// from the same places Claude Code reads them:
//   ~/.claude/skills/<name>/SKILL.md                       /name
//   ~/.claude/skills/synced/<id>/<name>/SKILL.md           /anthropic-skills:name   (skills synced from claude.ai)
//   ~/.claude/commands/**/<name>.md                        /name (a subfolder: /folder:name)
//   <project>/.claude/skills, <project>/.claude/commands   the same, for that project (and its git root)
//   enabled plugins (settings.json enabledPlugins)          /plugin:name
// Each gets its description and argument hint from its frontmatter. Listed at most every 30 seconds per project.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MAX = 300;
// the frontmatter's fields (one line each), else the first line of text as the description
function front(text) {
  const out = {}; const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (m) for (const line of m[1].split(/\r?\n/)) { const f = /^([\w-]+):\s*(.*)$/.exec(line); if (f) out[f[1]] = f[2].trim().replace(/^["']|["']$/g, ''); }
  if (!out.description) out.description = (m ? text.slice(m[0].length) : text).split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
  return out;
}
async function read(file) { try { return await fsp.readFile(file, 'utf8'); } catch { return null; } }
async function dirs(d) { try { return (await fsp.readdir(d, { withFileTypes: true })).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name); } catch { return []; } }

async function skillsIn(dir, prefix, src, out) {
  for (const n of await dirs(dir)) {
    if (n === 'synced') continue;
    const t = await read(path.join(dir, n, 'SKILL.md')); if (t == null) continue;
    const f = front(t);
    if (f['user-invocable'] === 'false') continue;
    out.push({ name: prefix + (f.name || n), desc: f.description, hint: f['argument-hint'] || '', src });
  }
}
async function commandsIn(dir, prefix, src, out, sub = '') {
  let entries = []; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!sub) await commandsIn(path.join(dir, e.name), prefix, src, out, `${e.name}:`); continue; }
    if (!e.name.endsWith('.md')) continue;
    const t = await read(path.join(dir, e.name)); if (t == null) continue;
    const f = front(t);
    out.push({ name: prefix + sub + e.name.slice(0, -3), desc: f.description, hint: f['argument-hint'] || '', src });
  }
}
// a project folder and the git root above it (where Claude Code also looks)
function projectDirs(dir) {
  const out = []; if (!dir) return out;
  let d = path.resolve(dir);
  out.push(d);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(d, '.git'))) { if (!out.includes(d)) out.push(d); break; }
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return out;
}

/** claudeDir: ~/.claude; home: for the settings and plugins. */
export function createSlash({ claudeDir }) {
  const cache = new Map();   // project dir -> { at, list }
  async function plugins(out) {
    let enabled = {}, known = {};
    try { enabled = JSON.parse(await fsp.readFile(path.join(claudeDir, 'settings.json'), 'utf8')).enabledPlugins || {}; } catch { /* none */ }
    try { known = JSON.parse(await fsp.readFile(path.join(claudeDir, 'plugins', 'known_marketplaces.json'), 'utf8')); } catch { /* none */ }
    for (const [id, on] of Object.entries(enabled)) {
      if (!on) continue;
      const [name, mkt] = id.split('@'), base = known[mkt]?.installLocation; if (!name || !base) continue;
      const root = ['plugins', 'external_plugins', '.'].map((p) => path.join(base, p, name)).find((p) => fs.existsSync(p)); if (!root) continue;
      await skillsIn(path.join(root, 'skills'), `${name}:`, 'plugin', out);
      await commandsIn(path.join(root, 'commands'), `${name}:`, 'plugin', out);
    }
  }
  async function build(dir) {
    const out = [];
    for (const p of projectDirs(dir)) {
      await skillsIn(path.join(p, '.claude', 'skills'), '', 'project', out);
      await commandsIn(path.join(p, '.claude', 'commands'), '', 'project', out);
    }
    await skillsIn(path.join(claudeDir, 'skills'), '', 'user', out);
    for (const id of await dirs(path.join(claudeDir, 'skills', 'synced'))) await skillsIn(path.join(claudeDir, 'skills', 'synced', id), 'anthropic-skills:', 'synced', out);
    await commandsIn(path.join(claudeDir, 'commands'), '', 'user', out);
    await plugins(out);
    // the first of a name wins (the project's over yours, as in Claude Code)
    const seen = new Set();
    return out.filter((x) => x.name && !seen.has(x.name) && seen.add(x.name)).map((x) => ({ ...x, desc: String(x.desc || '').slice(0, 240), hint: String(x.hint).slice(0, 80) })).slice(0, MAX);
  }
  return {
    /** the "/" list for a person working in dir (null: only yours and the plugins) */
    async list(dir) {
      const key = dir || '', c = cache.get(key);
      if (c && Date.now() - c.at < 30_000) return c.list;
      const list = await build(dir);
      cache.set(key, { at: Date.now(), list });
      if (cache.size > 50) cache.delete(cache.keys().next().value);
      return list;
    },
  };
}
