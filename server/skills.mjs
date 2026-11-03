// Your skills (Settings → Skills, `my-office skills …`): what Claude Code on this computer loads, and adding or
// removing it, for this computer only. Nothing goes to the team.
//   - personal skills: folders in ~/.claude/skills, each with a SKILL.md. One of yours is added as a link (edits in
//     your folder show up) or as a copy; a folder holding several skills adds them all. Removing a link only removes
//     the link; removing a copied folder moves it to My Office's data/skills-removed, not the bin.
//   - plugins from a marketplace, through Claude Code's own commands (claude plugin list|install|uninstall,
//     claude plugin marketplace list|add), which keep their own records and checks.
// Claude Code picks the changes up in sessions started after them.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { front } from './slash.mjs';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PLUGIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(@[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/;
const MARKET_RE = /^([A-Za-z0-9][\w.-]{0,99}\/[\w.-]{1,100}|https:\/\/\S{4,400}|git@[\w.-]+:\S{3,300}|[~/]\S{0,500})$/;
const COPY_MAX_FILES = 2000, COPY_MAX_BYTES = 50 * 1024 * 1024, MANY_MAX = 100;
const SKIP = new Set(['.git', 'node_modules', '.DS_Store']);
const CATALOG_MS = 10 * 60e3, RUN_MS = 180_000;

/** The claude command for `my-office skills` (the server has its own, wider search: findClaude in index.mjs). */
export function claudeOnPath(env = process.env, home = os.homedir()) {
  const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  if (env.OFFICE_CLAUDE_BIN && isFile(env.OFFICE_CLAUDE_BIN)) return env.OFFICE_CLAUDE_BIN;
  for (const d of String(env.PATH || '').split(path.delimiter)) if (d && isFile(path.join(d, 'claude'))) return path.join(d, 'claude');
  return [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(isFile) || null;
}

export class SkillError extends Error {
  constructor(code, detail = '') { super(code); this.code = code; this.detail = String(detail || '').slice(0, 400); }
}
const exists = async (p) => { try { await fsp.lstat(p); return true; } catch { return false; } };
async function skillAt(dir) {
  let text; try { text = await fsp.readFile(path.join(dir, 'SKILL.md'), 'utf8'); } catch { return null; }
  const f = front(text);
  return { name: f.name || path.basename(dir), desc: String(f.description || '').slice(0, 300) };
}
// how big a folder is, without following links inside it; stops counting past the limits
async function sizeOf(dir, acc = { files: 0, bytes: 0 }) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await sizeOf(p, acc);
    else if (e.isFile()) { acc.files++; acc.bytes += (await fsp.stat(p)).size; }
    if (acc.files > COPY_MAX_FILES || acc.bytes > COPY_MAX_BYTES) break;
  }
  return acc;
}

/**
 * claudeDir: ~/.claude (or CLAUDE_CONFIG_DIR); dataDir: My Office's data folder; claude(): the claude binary's path, or
 * null. The plugin commands run with this process's environment, so they act on the same Claude Code config.
 */
export function createSkills({ claudeDir, dataDir, claude = () => null, home = os.homedir(), env = process.env }) {
  const SKILLS = path.join(claudeDir, 'skills');
  // the marketplaces' plugins: { at, list, installed: Set }. `claude plugin list --available` leaves out the installed
  // ones, so every plugin seen once is kept (seen) for search to show it as installed
  let catalog = null;
  const seen = new Map();

  const expand = (p) => path.resolve(String(p).replace(/^~(?=$|\/)/, home));
  function run(args) {
    const bin = claude();
    if (!bin) return Promise.reject(new SkillError('no-claude'));
    return new Promise((resolve, reject) => {
      execFile(bin, ['plugin', ...args, '--json'], { env, timeout: RUN_MS, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        const text = String(stdout || '').trim();
        let out = null;
        try { out = JSON.parse(text); } catch { try { out = JSON.parse(text.split('\n').filter(Boolean).at(-1)); } catch { /* not JSON */ } }
        if (out && typeof out === 'object') { resolve(out); return; }
        reject(new SkillError(err?.killed ? 'timeout' : 'claude-failed', err?.message || text));
      });
    });
  }
  // install / uninstall / marketplace add answer { outcome: 'ok' | 'failed', failureCode?, message }
  const done = (out) => {
    if (out?.outcome === 'ok') return out;
    const msg = String(out?.message || '');
    throw new SkillError(/command|confirm|-y\b/i.test(msg) && !out?.failureCode ? 'needs-terminal' : out?.failureCode || 'failed', msg);
  };

  /** The personal skills: [{ name, desc, link, from, broken }]. */
  async function personal() {
    let entries = []; try { entries = await fsp.readdir(SKILLS, { withFileTypes: true }); } catch { return []; }
    const out = [];
    for (const e of entries) {
      if (e.name === 'synced' || e.name.startsWith('.') || !(e.isDirectory() || e.isSymbolicLink())) continue;
      const p = path.join(SKILLS, e.name), link = e.isSymbolicLink();
      let from = null; if (link) { try { from = path.resolve(SKILLS, await fsp.readlink(p)); } catch { /* unreadable */ } }
      const s = await skillAt(p);
      out.push({ name: e.name, desc: s?.desc || '', link, from, broken: !s });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getCatalog(force = false) {
    if (!force && catalog && Date.now() - catalog.at < CATALOG_MS) return catalog;
    const out = await run(['list', '--available']);
    for (const p of Array.isArray(out?.available) ? out.available : []) if (p?.pluginId) seen.set(p.pluginId, p);
    const installed = new Set((Array.isArray(out?.installed) ? out.installed : []).map((p) => p?.id).filter(Boolean));
    catalog = { at: Date.now(), installed, list: [...seen.values()] };
    return catalog;
  }
  /** Installed plugins: [{ id, name, market, version, enabled, scope, desc }]. */
  // a plugin's own description, from its manifest where Claude Code installed it
  async function descOf(p) {
    if (seen.get(p.id)?.description) return seen.get(p.id).description;
    try { return JSON.parse(await fsp.readFile(path.join(p.installPath, '.claude-plugin', 'plugin.json'), 'utf8')).description || ''; } catch { return ''; }
  }
  async function plugins() {
    const list = await run(['list']);
    return Promise.all((Array.isArray(list) ? list : []).filter((p) => p?.id).map(async (p) => {
      const [name, market = ''] = String(p.id).split('@');
      return { id: p.id, name, market, version: p.version || '', enabled: p.enabled !== false, scope: p.scope || 'user', desc: String(await descOf(p)).slice(0, 300) };
    }));
  }
  async function markets() {
    const list = await run(['marketplace', 'list']);
    return (Array.isArray(list) ? list : []).filter((m) => m?.name).map((m) => ({ name: m.name, source: m.repo || m.url || m.path || m.source || '' }));
  }

  return {
    personal, plugins, markets,
    /** Everything for the Skills tab: { skills, plugins, markets, claude, problem }. Plugins need the claude command. */
    async list() {
      const skills = await personal();
      try {
        const [p, m] = await Promise.all([plugins(), markets()]);
        return { skills, plugins: p, markets: m, claude: true, problem: null };
      } catch (e) { return { skills, plugins: [], markets: [], claude: e.code !== 'no-claude', problem: e.code || 'error' }; }
    },
    /** Plugins in the marketplaces matching every word of q (all of them, most installed first, when q is empty). */
    async search(q = '', { limit = 30 } = {}) {
      const words = String(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
      const { list: all, installed: have } = await getCatalog();
      const hits = all.filter((p) => p?.pluginId && words.every((w) => `${p.name} ${p.description || ''}`.toLowerCase().includes(w)));
      hits.sort((a, b) => (b.installCount || 0) - (a.installCount || 0));
      return { total: hits.length, list: hits.slice(0, limit).map((p) => ({ id: p.pluginId, name: p.name, market: p.marketplaceName || '', desc: String(p.description || '').slice(0, 300), installs: p.installCount || 0, installed: have.has(p.pluginId) })) };
    },

    /** Adds the skill in `dir` (or each skill folder inside it): { added: [name], skipped: [{ name, why }] }. */
    async addFolder({ dir, copy = false } = {}) {
      if (typeof dir !== 'string' || !dir.trim()) throw new SkillError('no-folder');
      const src = expand(dir.trim());
      let st; try { st = await fsp.stat(src); } catch { throw new SkillError('no-folder'); }
      if (!st.isDirectory()) throw new SkillError('not-folder');
      if (src === SKILLS || src.startsWith(SKILLS + path.sep)) throw new SkillError('already-here');
      let found = [];
      const one = await skillAt(src);
      if (one) found = [{ dir: src, ...one }];
      else {
        for (const e of (await fsp.readdir(src, { withFileTypes: true })).slice(0, 500)) {
          if (!e.isDirectory() || SKIP.has(e.name)) continue;
          const s = await skillAt(path.join(src, e.name)); if (s) found.push({ dir: path.join(src, e.name), ...s });
          if (found.length >= MANY_MAX) break;
        }
      }
      if (!found.length) throw new SkillError('no-skill-md');
      await fsp.mkdir(SKILLS, { recursive: true });
      const added = [], skipped = [];
      for (const s of found) {
        const name = NAME_RE.test(s.name) ? s.name : NAME_RE.test(path.basename(s.dir)) ? path.basename(s.dir) : null;
        if (!name || name === 'synced') { skipped.push({ name: s.name, why: 'bad-name' }); continue; }
        const dest = path.join(SKILLS, name);
        if (await exists(dest)) { skipped.push({ name, why: 'exists' }); continue; }
        if (copy) {
          const size = await sizeOf(s.dir);
          if (size.files > COPY_MAX_FILES || size.bytes > COPY_MAX_BYTES) { skipped.push({ name, why: 'too-big' }); continue; }
          await fsp.cp(s.dir, dest, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true, filter: (p) => !SKIP.has(path.basename(p)) });
        } else await fsp.symlink(s.dir, dest, 'dir');
        added.push(name);
      }
      if (!added.length && found.length === 1) throw new SkillError(skipped[0].why, skipped[0].name);
      return { added, skipped };
    },
    /** Removes a personal skill: a link goes; a folder moves to data/skills-removed. { name, was: 'link' | 'folder', movedTo? } */
    async remove(name) {
      if (typeof name !== 'string' || !NAME_RE.test(name) || name === 'synced') throw new SkillError('no-skill');
      const p = path.join(SKILLS, name);
      let st; try { st = await fsp.lstat(p); } catch { throw new SkillError('no-skill'); }
      if (st.isSymbolicLink()) { await fsp.unlink(p); return { name, was: 'link' }; }
      if (!st.isDirectory()) throw new SkillError('no-skill');
      const bin = path.join(dataDir, 'skills-removed'), to = path.join(bin, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      await fsp.mkdir(bin, { recursive: true });
      try { await fsp.rename(p, to); } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        await fsp.cp(p, to, { recursive: true, verbatimSymlinks: true }); await fsp.rm(p, { recursive: true, force: true });
      }
      return { name, was: 'folder', movedTo: to };
    },

    /** Installs a marketplace plugin (name@marketplace) for this computer's user. */
    async install(id) {
      if (typeof id !== 'string' || !PLUGIN_RE.test(id)) throw new SkillError('bad-plugin');
      catalog = null;
      try { return done(await run(['install', id])); } finally { catalog = null; }   // (a search while it ran may have kept the old state)
    },
    async uninstall(id) {
      if (typeof id !== 'string' || !PLUGIN_RE.test(id)) throw new SkillError('bad-plugin');
      catalog = null;
      try { return done(await run(['uninstall', id])); } finally { catalog = null; }   // (a search while it ran may have kept the old state)
    },
    /** Adds a marketplace: owner/repo on GitHub, a git or https URL, or a folder. */
    async addMarket(source) {
      const s = typeof source === 'string' ? source.trim() : '';
      if (!MARKET_RE.test(s)) throw new SkillError('bad-market');
      try { return done(await run(['marketplace', 'add', s.startsWith('~') ? expand(s) : s])); } finally { catalog = null; }
    },
  };
}
