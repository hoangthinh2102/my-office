#!/usr/bin/env node
// My Office command line: start the server, add/remove the Claude Code hooks, install the login service, and
// check that everything is wired ("doctor"). Settings are backed up before every change and written atomically.
// "setup" does a whole first install in one go (setup.sh runs it), "update" brings a clone up to date.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrefs } from '../server/prefs.mjs';
import { serviceFor } from './service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const PORT = Number(process.env.OFFICE_PORT || 4310);
// Words in the office's language (data/prefs.json, picked in Settings; OFFICE_LANG until then), same folder as the server's.
// the server's data folder (OFFICE_DATA_DIR for a second copy; the launchd service and the hooks always use data/)
const DATA_DIR = process.env.OFFICE_DATA_DIR ? path.resolve(process.env.OFFICE_DATA_DIR) : path.join(ROOT, 'data');
const prefs = createPrefs(DATA_DIR), { tr } = prefs;
const minutesAgo = (ms) => tr('time.ago', { time: tr('time.min', { n: Math.max(0, Math.round((Date.now() - ms) / 60000)) }) });
const args = process.argv.slice(2), cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'start';
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || true : null; };
const SETTINGS = path.resolve(String(opt('--settings') || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'settings.json')));
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'PreCompact'];
// The hooks post each event to the office: curl where the shell has it (macOS, Linux), a small node script on Windows.
// Paths use forward slashes there, which both cmd and Git Bash accept.
const WIN = process.platform === 'win32', fwd = (p) => p.replace(/\\/g, '/');
const SEND = WIN ? `"${fwd(process.execPath)}" "${fwd(path.join(ROOT, 'hooks', 'send.mjs'))}"` : '';
const hookCmd = (route, wait) => (WIN ? `${SEND} http://127.0.0.1:${PORT}${route}${wait ? '' : ' --async'}`
  : wait ? `curl -s --max-time 50 -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${PORT}${route} || true`
    : `curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${PORT}${route} || true`);
const EVENT_CMD = hookCmd('/event', false);
const PERM_CMD = hookCmd('/hook/permission', true);
// Claude's questions (AskUserQuestion) and plans (ExitPlanMode) are answered through PreToolUse, the documented way.
const ASK_CMD = hookCmd('/hook/question', true);
const ASK_MATCHER = 'AskUserQuestion|ExitPlanMode';
// The company's rules (and a person's role), given to every session as it starts: its answer is the session's context.
const RULES_CMD = WIN ? hookCmd('/hook/session-start', true) : `curl -s --max-time 4 -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${PORT}/hook/session-start || true`;
// The status line feeds the plan's 5-hour / 7-day usage; an existing status line keeps running through ours.
const STATUS_SCRIPT = path.join(ROOT, 'hooks', 'status-line.mjs'), STATUS_PREV = path.join(ROOT, 'data', 'statusline-prev.json');
const STATUS_CMD = WIN ? `"${fwd(process.execPath)}" "${fwd(STATUS_SCRIPT)}"` : `"${process.execPath}" "${STATUS_SCRIPT}"`;
const oursStatus = (s) => typeof s?.command === 'string' && s.command.includes('status-line.mjs') && (s.command.includes(ROOT) || s.command.includes(fwd(ROOT)));
const ours = (h) => typeof h?.command === 'string' && h.command.includes(`127.0.0.1:${PORT}/`);
// --lan opens the server to the home wifi so a phone can watch (QR code or PIN). Off by default.
const LAN = args.includes('--lan');
const service = () => serviceFor({ root: ROOT, server: path.join(ROOT, 'server', 'index.mjs'), log: path.join(ROOT, 'data', 'server.log'), host: LAN ? '0.0.0.0' : '127.0.0.1', port: PORT });
const ok = (s) => console.log(`  ✓ ${s}`), warn = (s) => console.log(`  ⚠ ${s}`), bad = (s) => console.log(`  ✗ ${s}`);

async function readSettings() { try { return JSON.parse(await fsp.readFile(SETTINGS, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(tr('cli.readFailed', { file: SETTINGS, error: e.message })); } }
async function writeSettings(cfg) {
  await fsp.mkdir(path.dirname(SETTINGS), { recursive: true });
  if (fs.existsSync(SETTINGS)) { const bak = `${SETTINGS}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`; await fsp.copyFile(SETTINGS, bak); console.log(`  ${tr('cli.backedUp', { file: bak })}`); }
  const tmp = `${SETTINGS}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n'); await fsp.rename(tmp, SETTINGS);
}
const SERVER = path.join(ROOT, 'server', 'index.mjs');
// The page is a Next.js build: make it once (and after an update) before the server can show the office.
// The commit it was built from is kept next to it, so an update knows to build again.
const STAMP = path.join(ROOT, '.next', 'office-commit');
const git = (...a) => { try { return execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
function ensureBuild(force = false) {
  if (!force && fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) return;
  console.log(tr('cli.building'));
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  try { fs.writeFileSync(STAMP, `${git('rev-parse', 'HEAD')}\n`); } catch { /* not a clone */ }
}
const builtFrom = () => { try { return fs.readFileSync(STAMP, 'utf8').trim(); } catch { return ''; } };
const waitUp = async (sec = 40) => {
  for (let i = 0; i < sec * 2; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1000) })).ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
const openPage = (url) => {
  const how = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (!how) return false;
  try { spawn(how, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); return true; } catch { return false; }
};

async function install({ withService = args.includes('--service') } = {}) {
  console.log(tr('cli.install.title'));
  const cfg = await readSettings(); cfg.hooks ||= {};
  let added = 0;
  for (const ev of EVENTS) {
    const list = (cfg.hooks[ev] ||= []);
    if (!list.some((e) => (e.hooks || []).some((h) => ours(h) && h.command.includes('/event')))) { list.push({ hooks: [{ type: 'command', command: EVENT_CMD, timeout: 5, async: true }] }); added++; }
  }
  const perm = (cfg.hooks.PermissionRequest ||= []);
  if (!args.includes('--no-approve') && !perm.some((e) => (e.hooks || []).some((h) => ours(h) && h.command.includes('/hook/permission')))) { perm.push({ hooks: [{ type: 'command', command: PERM_CMD, timeout: 55 }] }); added++; }
  const pre = (cfg.hooks.PreToolUse ||= []);
  if (!args.includes('--no-approve') && !pre.some((e) => (e.hooks || []).some((h) => ours(h) && h.command.includes('/hook/question')))) { pre.push({ matcher: ASK_MATCHER, hooks: [{ type: 'command', command: ASK_CMD, timeout: 55 }] }); added++; }
  const start = (cfg.hooks.SessionStart ||= []);
  if (!args.includes('--no-rules') && !start.some((e) => (e.hooks || []).some((h) => ours(h) && h.command.includes('/hook/session-start')))) { start.push({ hooks: [{ type: 'command', command: RULES_CMD, timeout: 5 }] }); added++; }
  if (!args.includes('--no-status') && !oursStatus(cfg.statusLine)) {
    if (cfg.statusLine?.command) { await fsp.mkdir(path.dirname(STATUS_PREV), { recursive: true }); await fsp.writeFile(STATUS_PREV, JSON.stringify(cfg.statusLine)); ok(tr('cli.install.statusKept')); }
    cfg.statusLine = { type: 'command', command: STATUS_CMD, ...(cfg.statusLine?.padding != null ? { padding: cfg.statusLine.padding } : {}) };
    added++;
  }
  if (added) { await writeSettings(cfg); ok(tr('cli.install.added', { n: added, file: SETTINGS })); } else ok(tr('cli.install.already'));
  if (withService && !opt('--settings')) {
    await fsp.mkdir(path.join(ROOT, 'data'), { recursive: true });
    ensureBuild();
    const svc = service();
    if (await svc.install()) ok(tr('cli.install.service', { file: svc.file })); else warn(tr('cli.install.noService'));
    LAN ? warn(tr('cli.install.lan')) : ok(tr('cli.install.local'));
  }
  console.log(`\n${tr('cli.install.next', { port: PORT })}`);
}
/* ---------- the whole first install in one go (setup.sh runs this after cloning and npm ci) ----------
   my-office setup [--join <invite link>] [--name <your name>] [--lang vi|en] [--lan] [--no-open] */
async function setup() {
  const lang = opt('--lang');
  if (typeof lang === 'string') prefs.setLang(lang);   // (the office's language, before the service starts)
  console.log(`${tr('cli.setup.title')}\n`);
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) { bad(tr('cli.setup.node', { version: process.versions.node })); process.exitCode = 1; return; }
  ok(tr('cli.setup.nodeOk', { version: process.versions.node }));
  if (!fs.existsSync(path.dirname(SETTINGS))) warn(tr('cli.setup.noClaude'));
  await install({ withService: true });
  const up = await waitUp();
  up ? ok(tr('cli.setup.running', { port: PORT })) : warn(tr('cli.setup.notUp'));
  // the team, with the invite link from the hub's page
  const link = opt('--join');
  let joinedTo = null, retry = null;
  if (typeof link === 'string') {
    const { createTeamClient, TeamError } = await import('../server/team/client.mjs');
    const client = createTeamClient({ dataDir: DATA_DIR }), now = await client.readState();
    if (now) ok(tr('cli.setup.inTeam', { team: now.teamName, name: now.name }));
    else {
      try {
        const name = opt('--name');
        const s = await client.join({ link, name: typeof name === 'string' ? name : undefined });
        joinedTo = s; ok(tr('cli.team.joined', { team: s.teamName, name: s.name }));
      } catch (e) {
        if (!(e instanceof TeamError)) throw e;
        const key = `cli.team.err.${e.code}`, text = tr(key);
        warn(`${text === key ? tr('cli.team.err.other', { code: e.code }) : text} ${tr('cli.setup.joinLater')}`);
        retry = link;
      }
    }
  }
  const url = `http://localhost:${PORT}/${retry ? `?join=${encodeURIComponent(retry)}` : ''}`;
  if (up && !args.includes('--no-open') && openPage(url)) ok(tr('cli.setup.opened', { url }));
  console.log(`\n${tr('cli.setup.done', { url: `http://localhost:${PORT}` })}`);
  console.log(`  ${tr('cli.setup.newSession')}`);
  if (joinedTo) console.log(`  ${tr('cli.setup.roomClosed')}`);
  console.log(`  ${tr('cli.setup.later')}\n`);
}

/* ---------- bringing a clone up to date: pull, install packages if they changed, build, restart ----------
   --auto: the office runs it on its own (server/updater.mjs) when there is a newer version or the team requires one.
   Then only main is pulled, the outcome is kept in data/update.json for the office to show after its restart, and a
   build that fails goes back to the version that was running. OFFICE_RESTART_CMD replaces the service restart (tests). */
const UPDATE_FILE = path.join(DATA_DIR, 'update.json');
const noteUpdate = (o) => { try { const was = JSON.parse(fs.readFileSync(UPDATE_FILE, 'utf8')); fs.writeFileSync(UPDATE_FILE, JSON.stringify({ ...was, ...o }, null, 2)); } catch { /* not started by the office */ } };
async function update() {
  const auto = args.includes('--auto');
  console.log(`${tr('cli.update.title')}${auto ? ` (${new Date().toISOString()})` : ''}\n`);
  const fail = (key, why) => { bad(tr(key, { dir: ROOT })); if (auto) noteUpdate({ status: 'failed', why, at: Date.now() }); process.exitCode = 1; };
  if (!git('rev-parse', 'HEAD')) { fail('cli.update.notClone', 'no-git'); return; }
  if (git('status', '--porcelain', '--untracked-files=no')) { fail('cli.update.changed', 'changes'); return; }
  if (auto && git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') { fail('cli.update.notMain', 'branch'); return; }
  const before = git('rev-parse', 'HEAD');
  try { execFileSync('git', ['-C', ROOT, 'pull', '--ff-only', '--quiet', ...(auto ? ['origin', 'main'] : [])], { stdio: ['ignore', 'inherit', 'inherit'] }); } catch { fail('cli.update.pullFailed', 'pull'); return; }
  const after = git('rev-parse', 'HEAD');
  if (before === after && builtFrom() === after && !args.includes('--force')) { ok(tr('cli.update.latest', { commit: after.slice(0, 7) })); if (auto) noteUpdate({ status: 'failed', why: 'same', at: Date.now() }); return; }
  const lockChanged = (a, b) => a !== b && git('diff', '--name-only', a, b).split('\n').includes('package-lock.json');
  const packages = () => execSync('npm ci --no-audit --no-fund --loglevel=error', { cwd: ROOT, stdio: 'inherit' });
  if (before !== after) {
    ok(tr('cli.update.pulled', { from: before.slice(0, 7), to: after.slice(0, 7) }));
    for (const line of git('log', '--format=%s', `${before}..${after}`).split('\n').filter(Boolean).slice(0, 8)) console.log(`      · ${line}`);
  }
  let failed = null;
  try {
    if (lockChanged(before, after)) { console.log(tr('cli.update.packages')); packages(); }
    ensureBuild(true);
  } catch (e) { failed = e; }
  if (failed && before !== after) {
    // the new version doesn't build: back to the one that was running, so the office keeps working
    bad(tr('cli.update.buildFailed', { commit: before.slice(0, 7) }));
    try {
      execFileSync('git', ['-C', ROOT, 'reset', '--hard', '--quiet', before], { stdio: 'inherit' });
      if (lockChanged(after, before)) packages();
      ensureBuild(true);
      ok(tr('cli.update.rolledBack', { commit: before.slice(0, 7) }));
    } catch { bad(tr('cli.update.rollbackFailed')); }
    if (auto) noteUpdate({ status: 'failed', why: 'build', at: Date.now() });
    process.exitCode = 1;
  } else if (failed) { if (auto) noteUpdate({ status: 'failed', why: 'build', at: Date.now() }); throw failed; }
  const svc = service();
  let mine = false; try { mine = fs.readFileSync(svc.file, 'utf8').includes(ROOT); } catch { /* none */ }
  const restart = process.env.OFFICE_RESTART_CMD || (mine && (await svc.state()) !== 'missing' ? svc.restart : '');
  if (restart) {   // (only the service that runs this folder: another clone's is left alone)
    if (auto && !failed) noteUpdate({ restartAt: Date.now() });
    try { execSync(restart, { stdio: 'ignore' }); } catch { /* reported below */ }
    (await waitUp()) ? ok(tr('cli.update.restarted', { port: PORT })) : warn(tr('cli.update.notUp', { cmd: restart }));
  } else ok(tr('cli.update.noService'));
  console.log(`\n${tr('cli.update.done')}\n`);
}

async function uninstall() {
  console.log(tr('cli.uninstall.title'));
  const cfg = await readSettings(); let removed = 0;
  for (const [ev, list] of Object.entries(cfg.hooks || {})) {
    const kept = list.map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !ours(h)) })).filter((e) => e.hooks.length);
    removed += list.reduce((n, e) => n + (e.hooks || []).filter(ours).length, 0);
    if (kept.length) cfg.hooks[ev] = kept; else delete cfg.hooks[ev];
  }
  if (oursStatus(cfg.statusLine)) {
    let prev = null; try { prev = JSON.parse(await fsp.readFile(STATUS_PREV, 'utf8')); } catch { /* none */ }
    if (prev?.command) cfg.statusLine = prev; else delete cfg.statusLine;
    await fsp.rm(STATUS_PREV, { force: true }); removed++;
  }
  if (removed) { await writeSettings(cfg); ok(tr('cli.uninstall.removed', { n: removed, file: SETTINGS })); } else ok(tr('cli.uninstall.none'));
  // The login service is machine-wide: only touch it when working on the real settings (not a --settings copy).
  if (!opt('--settings') && (await service().uninstall())) ok(tr('cli.uninstall.service'));
  if (!opt('--settings') && unwrapEditors()) ok(tr('cli.uninstall.editors'));
}
// the editors' Claude Code started through the office's account script (the plan card's "Use" / switching): taken out,
// or Claude Code wouldn't start once the office is gone
function unwrapEditors() {
  const script = path.join(DATA_DIR, 'claude-switch.sh'), home = os.homedir(), key = 'claudeCode.claudeProcessWrapper';
  const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.config');
  let n = 0;
  for (const app of ['Code', 'Code - Insiders', 'Cursor', 'Windsurf', 'Antigravity', 'Antigravity IDE', 'Kiro', 'Trae', 'Positron']) {
    try {
      const f = fs.realpathSync(path.join(base, app, 'User', 'settings.json')), cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (cfg[key] !== script) continue;
      delete cfg[key]; fs.writeFileSync(f, `${JSON.stringify(cfg, null, 4)}\n`); n++;
    } catch { /* no such editor, or a file with comments */ }
  }
  try { fs.writeFileSync(path.join(DATA_DIR, 'account-now'), '\n'); } catch { /* none */ }
  return n;
}
async function doctor() {
  console.log(`${tr('cli.doctor.title')}\n`);
  const major = Number(process.versions.node.split('.')[0]);
  major >= 20 ? ok(`Node ${process.versions.node}`) : bad(tr('cli.doctor.nodeOld', { version: process.versions.node }));
  if (!WIN) { try { execFileSync('curl', ['--version'], { stdio: 'ignore' }); ok(tr('cli.doctor.curl')); } catch { bad(tr('cli.doctor.noCurl')); } }
  let info = null;
  try { const r = await fetch(`http://127.0.0.1:${PORT}/api/doctor`); info = await r.json(); ok(tr('cli.doctor.serverUp', { port: PORT, time: tr('time.min', { n: Math.round(info.uptime / 60) }) })); }
  catch { bad(tr('cli.doctor.serverDown', { port: PORT })); }
  const cfg = await readSettings().catch((e) => (bad(e.message), {}));
  const have = EVENTS.filter((ev) => (cfg.hooks?.[ev] || []).some((e) => (e.hooks || []).some((h) => ours(h) && h.command.includes('/event'))));
  have.length === EVENTS.length ? ok(tr('cli.doctor.hooksAll', { n: EVENTS.length, file: SETTINGS })) : warn(tr('cli.doctor.hooksSome', { have: have.length, total: EVENTS.length, missing: EVENTS.filter((e) => !have.includes(e)).join(', ') }));
  const perm = (cfg.hooks?.PermissionRequest || []).some((e) => (e.hooks || []).some((h) => ours(h) && h.command.includes('/hook/permission')));
  perm ? ok(tr('cli.doctor.perm')) : warn(tr('cli.doctor.noPerm'));
  const ask = (cfg.hooks?.PreToolUse || []).some((e) => (e.hooks || []).some((h) => ours(h) && h.command.includes('/hook/question')));
  ask ? ok(tr('cli.doctor.ask')) : warn(tr('cli.doctor.noAsk'));
  oursStatus(cfg.statusLine) ? ok(tr('cli.doctor.status')) : warn(tr('cli.doctor.noStatus'));
  const rules = (cfg.hooks?.SessionStart || []).some((e) => (e.hooks || []).some((h) => ours(h) && h.command.includes('/hook/session-start')));
  rules ? ok(tr('cli.doctor.rules')) : warn(tr('cli.doctor.noRules'));
  if (info) {
    if (!info.lastEventAt) warn(tr('cli.doctor.noEvents'));
    else ok(tr('cli.doctor.lastEvent', { ago: minutesAgo(info.lastEventAt), n: info.sessions }));
    if (oursStatus(cfg.statusLine)) {
      if (info.limitsAt) ok(tr('cli.doctor.limits', { ago: minutesAgo(info.limitsAt) }));
      else if (info.statusAt) warn(tr('cli.doctor.noLimits'));
      else warn(tr('cli.doctor.statusSilent'));
    }
  }
  if (fs.existsSync(path.join(DATA_DIR, 'team.json'))) {   // team mode (docs/features/team-mode.md)
    if (major < 22) bad(tr('cli.doctor.teamNode', { version: process.versions.node }));
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/api/team`)).json();
      if (t.room?.paused) warn(tr('cli.doctor.teamPaused', { team: t.team.name }));
      else if (t.connected) ok(tr('cli.doctor.teamUp', { team: t.team.name, n: t.rooms.length }));
      else warn(tr('cli.doctor.teamDown', { team: t.team?.name || '', why: tr(`cli.team.problem.${t.problem || 'reconnecting'}`) }));
    } catch { /* the server is down: said above */ }
  }
  const svc = service(), st = await svc.state();
  if (st === 'running') ok(tr('cli.doctor.serviceUp'));
  else if (st === 'stopped') warn(tr('cli.doctor.serviceDown', { restart: svc.restart }));
  else warn(tr('cli.doctor.noService'));
}
async function pin() {
  const file = path.join(DATA_DIR, 'pin');
  if (args.includes('--new') || !fs.existsSync(file)) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const { randomInt } = await import('node:crypto');
    await fsp.writeFile(file, String(randomInt(0, 1e6)).padStart(6, '0'), { mode: 0o600 });
    if (args.includes('--new')) ok(tr('cli.pin.changed'));
  }
  const p = (await fsp.readFile(file, 'utf8')).trim();
  const shown = p.length % 4 === 0 && p.length % 3 ? p.match(/\d{4}/g).join(' ') : p.replace(/\d{3}(?=\d{2})/g, '$& ');   // (as the phone window shows it)
  console.log(`  ${tr('cli.pin.show', { pin: shown })}`);
}
function start() {
  if (LAN) process.env.OFFICE_HOST = '0.0.0.0';
  ensureBuild();
  process.env.NODE_ENV ||= 'production';
  return import(SERVER);
}
/* ---------- team mode (docs/features/team-mode.md) ----------
   my-office team create --hub <url> --name <team> [--me <your name>] [--token <hub's create token>]
   my-office team invite | join <invite link> [--me <name>] | status | rename <new name> | leave [--local] | restore <recovery key>
   my-office team room open|closed | room log on|off | pause | resume | rooms | policy details on|off | update
   my-office team grants | revoke <name> | code | redeem <code>   (closed rooms: who may look in, view codes)
   my-office team admin add <name> | admin stepdown | remove <name>   (admins) */
async function team() {
  const { createTeamClient, TeamError } = await import('../server/team/client.mjs');
  const client = createTeamClient({ dataDir: DATA_DIR });
  const sub = args[1], arg = args[2] && !args[2].startsWith('-') ? args[2] : null;
  const val = (name) => { const v = opt(name); return typeof v === 'string' ? v : null; };
  const until = (ms) => new Date(ms).toLocaleTimeString(tr('cli.team.locale'), { hour: '2-digit', minute: '2-digit' });
  const where = (s) => tr(s.keyStore === 'keychain' ? 'cli.team.keyKeychain' : 'cli.team.keyFile');
  try {
    if (sub === 'create') {
      const hub = val('--hub'), name = val('--name');
      if (!hub || !name) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      const { state, recovery } = await client.create({ hub, team: name, name: val('--me'), token: val('--token') });
      ok(tr('cli.team.created', { team: state.teamName, name: state.name }));
      ok(where(state));
      console.log(`\n  ${tr('cli.team.recoveryTitle')}\n\n    ${recovery}\n\n  ${tr('cli.team.recoveryKeep')}\n`);
      console.log(`  ${tr('cli.team.nextInvite')}`);
    } else if (sub === 'invite') {
      const r = await client.invite();
      console.log(`\n  ${tr('cli.team.inviteTitle', { time: until(r.expiresAt) })}\n\n    ${r.invite}\n\n  ${tr('cli.team.inviteHow')}\n`);
    } else if (sub === 'join') {
      if (!arg) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      const s = await client.join({ link: arg, name: val('--me') });
      ok(tr('cli.team.joined', { team: s.teamName, name: s.name }));
      ok(where(s));
    } else if (sub === 'status') {
      const st = await client.readState();
      if (!st) { console.log(`  ${tr('cli.team.none')}`); return; }
      const r = await client.status();
      console.log(tr('cli.team.statusTitle', { team: r.team.name, hub: r.state.hub }));
      ok(tr('cli.team.you', { name: r.me.name, room: tr(`cli.team.room.${r.state.room?.mode || 'closed'}`) }));
      if (r.state.paused) warn(tr('cli.team.isPaused'));
      console.log(`  ${tr(r.policy?.details ? 'cli.team.policyIsOn' : 'cli.team.policyIsOff')}${r.me.owner ? ` ${tr('cli.team.youAdmin')}` : ''}`);
      console.log(`  ${tr('cli.team.members', { n: r.members.length })}`);
      for (const m of r.members) console.log(`    · ${m.name}${[m.role === 'admin' && tr('cli.team.admin'), m.id === r.me.id && tr('cli.team.itsYou')].filter(Boolean).map((x) => ` (${x})`).join('')}`);
    } else if (sub === 'room' && arg === 'log') {   // others may read your sessions' conversations (or not)
      const on = args[3];
      if (!['on', 'off'].includes(on)) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      await client.setRoomLog(on === 'on');
      ok(tr(on === 'on' ? 'cli.team.logOn' : 'cli.team.logOff'));
    } else if (sub === 'room') {
      if (!['open', 'closed'].includes(arg)) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      await client.setRoom(arg);
      ok(tr(`cli.team.roomSet.${arg}`));
    } else if (sub === 'pause' || sub === 'resume') {
      await client.setPaused(sub === 'pause');
      ok(tr(`cli.team.${sub}d`));
    } else if (sub === 'policy') {
      const on = args[3];
      if (arg !== 'details' || !['on', 'off'].includes(on)) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      const p = await client.setPolicy({ details: on === 'on' });
      ok(tr(p.details ? 'cli.team.policyOn' : 'cli.team.policyOff'));
    } else if (sub === 'update') {
      // (admins) every office in the team must run the newest main: older ones update themselves, the hub holds them
      // back until they have (server/updater.mjs). The version is main's commit count on this clone's remote.
      try { execFileSync('git', ['-C', ROOT, 'fetch', '--quiet', 'origin', 'main'], { stdio: 'ignore', timeout: 90_000 }); } catch { bad(tr('cli.team.updateFetch')); process.exitCode = 1; return; }
      const build = Number(git('rev-list', '--count', 'origin/main')) || 0, at = git('rev-parse', '--short', 'origin/main');
      if (!build) { bad(tr('cli.team.updateFetch')); process.exitCode = 1; return; }
      const v = await client.requireUpdate(build);
      ok(tr('cli.team.updateSet', { n: v.min, commit: at }));
      console.log(`  ${tr('cli.team.updateNote')}`);
    } else if (sub === 'rooms') {
      let st;
      try { st = await (await fetch(`http://127.0.0.1:${PORT}/api/team`)).json(); } catch { bad(tr('cli.doctor.serverDown', { port: PORT })); process.exitCode = 1; return; }
      if (!st.inTeam) { console.log(`  ${tr('cli.team.none')}`); return; }
      console.log(tr('cli.team.roomsTitle', { team: st.team.name }));
      if (st.room.paused) warn(tr('cli.team.isPaused'));
      else st.connected ? ok(tr('cli.team.connected')) : warn(tr('cli.team.notConnected', { why: tr(`cli.team.problem.${st.problem || 'reconnecting'}`) }));
      if (!st.rooms.length) console.log(`  ${tr('cli.team.noRooms')}`);
      for (const r of st.rooms) {
        const c = r.counts || {}, head = `${r.member.name} · ${r.online ? tr(`cli.team.mode.${r.mode}`) : tr('cli.team.offline')}`;
        console.log(`  ${r.online ? '●' : '○'} ${head}${r.online ? ` · ${tr('cli.team.counts', { work: c.work || 0, wait: c.wait || 0, rest: c.rest || 0 })}` : ''}`);
        for (const p of r.people || []) console.log(`      - ${[p.role, p.project].filter(Boolean).join(' · ') || '—'}: ${tr(`cli.team.status.${p.status}`)}${p.act ? ` (${p.act}${p.label ? `: ${p.label}` : ''})` : ''}`);
      }
    } else if (sub === 'grants') {
      const a = await client.access();
      const when = (ms) => (ms == null ? tr('cli.team.always') : tr('cli.team.untilTime', { time: until(ms) }));
      console.log(tr('cli.team.grantsTitle'));
      if (!a.grants.length) console.log(`  ${tr('cli.team.noGrants')}`);
      for (const g of a.grants) console.log(`  · ${g.viewer.name} (${when(g.until)})`);
      if (a.knocks.length) console.log(`\n${tr('cli.team.knocksTitle')}`);
      for (const k of a.knocks) console.log(`  · ${k.viewer.name} (${until(k.at)})`);
      if (a.log.length) console.log(`\n${tr('cli.team.logTitle')}`);
      for (const l of a.log.slice(0, 10)) console.log(`  ${until(l.at)}  ${tr(`cli.team.log.${l.action}`, { name: l.viewer?.name || '—' })}`);
    } else if (sub === 'revoke') {
      if (!arg) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      const g = (await client.access()).grants.filter((x) => x.viewer.name.toLowerCase() === arg.toLowerCase());
      if (g.length !== 1) { bad(tr(g.length ? 'cli.team.nameTwice' : 'cli.team.noSuchGrant', { name: arg })); process.exitCode = 1; return; }
      await client.revoke(g[0].viewer.id);
      ok(tr('cli.team.revoked', { name: g[0].viewer.name }));
    } else if (sub === 'code') {
      const r = await client.viewCode();
      console.log(`\n  ${tr('cli.team.codeTitle', { time: until(r.expiresAt) })}\n\n    ${r.code}\n\n  ${tr('cli.team.codeHow')}\n`);
    } else if (sub === 'redeem') {
      if (!arg) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      const r = await client.redeem(arg);
      ok(tr(r.until == null ? 'cli.team.redeemedAlways' : 'cli.team.redeemed', { name: r.room.name, time: r.until == null ? '' : until(r.until) }));
    } else if ((sub === 'admin' && arg === 'add') || sub === 'remove') {
      const who = sub === 'remove' ? arg : args[3];
      if (!who) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      const { me, members } = await client.status();
      const m = members.filter((x) => x.id !== me.id && x.name.toLowerCase() === who.toLowerCase());
      if (!m.length && me.name.toLowerCase() === who.toLowerCase()) { bad(tr(sub === 'remove' ? 'cli.team.err.remove-self' : 'cli.team.err.already-admin')); process.exitCode = 1; return; }
      if (m.length !== 1) { bad(tr(m.length ? 'cli.team.memberTwice' : 'cli.team.noSuchMember', { name: who })); process.exitCode = 1; return; }
      if (sub === 'remove') { await client.remove(m[0].id); ok(tr('cli.team.removed', { name: m[0].name })); }
      else { await client.promote(m[0].id); ok(tr('cli.team.promoted', { name: m[0].name })); }
    } else if (sub === 'rename') {
      const name = args.slice(2).filter((a) => !a.startsWith('--')).join(' ');
      if (!name.trim()) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      const r = await client.rename(name);
      ok(tr('cli.team.renamed', { name: r.me.name }));
    } else if (sub === 'admin' && arg === 'stepdown') {
      await client.stepDown();
      ok(tr('cli.team.steppedDown'));
    } else if (sub === 'leave') {
      await client.leave({ local: args.includes('--local') });
      ok(tr('cli.team.left'));
    } else if (sub === 'restore') {
      if (!arg) { console.log(tr('cli.team.usage')); process.exitCode = 1; return; }
      const s = await client.restore({ recovery: arg });
      ok(tr('cli.team.restored', { team: s.teamName, name: s.name }));
      ok(where(s));
    } else {
      console.log(tr('cli.team.usage')); process.exitCode = 1;
    }
  } catch (e) {
    if (!(e instanceof TeamError)) throw e;
    const key = `cli.team.err.${e.code}`, text = tr(key);
    bad(text === key ? tr('cli.team.err.other', { code: e.code }) : text);
    process.exitCode = 1;
  }
}
/* ---------- your skills (Settings → Skills; server/skills.mjs), on this computer only ----------
   my-office skills [list] | add <folder> [--copy] | remove <name> | search [words] | install <plugin@marketplace>
   my-office skills uninstall <plugin@marketplace> | market add <owner/repo | URL | folder> */
async function skills() {
  const { createSkills, claudeOnPath, SkillError } = await import('../server/skills.mjs');
  const s = createSkills({ claudeDir: process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), dataDir: DATA_DIR, claude: () => claudeOnPath() });
  const [sub = 'list', arg] = args.filter((a) => a !== '--copy').slice(1), words = args.slice(2).filter((a) => !a.startsWith('--')).join(' ');
  const usage = () => { console.log(tr('cli.skills.usage')); process.exitCode = 1; };
  const newSession = () => console.log(`  ${tr('cli.skills.newSession')}`);
  try {
    if (sub === 'list') {
      const l = await s.list();
      console.log(tr('cli.skills.title'));
      if (!l.skills.length && !l.plugins.length) console.log(`  ${tr('cli.skills.none')}`);
      for (const k of l.skills) console.log(`  ${k.broken ? '✗' : '·'} ${k.name}  (${tr(k.broken ? 'cli.skills.broken' : k.link ? 'cli.skills.linked' : 'cli.skills.folder', { from: k.from || '' })})${k.desc ? `\n      ${k.desc.slice(0, 110)}` : ''}`);
      for (const p of l.plugins) console.log(`  · ${p.id}  (${tr('cli.skills.plugin')}${p.enabled ? '' : `, ${tr('cli.skills.off')}`})`);
      if (l.problem === 'no-claude') warn(tr('cli.skills.err.no-claude'));
      else if (l.markets.length) console.log(`\n  ${tr('cli.skills.markets', { list: l.markets.map((m) => m.name).join(', ') })}`);
    } else if (sub === 'add') {
      if (!arg) return usage();
      const r = await s.addFolder({ dir: arg, copy: args.includes('--copy') });
      for (const n of r.added) ok(tr(args.includes('--copy') ? 'cli.skills.copied' : 'cli.skills.linkedOk', { name: n }));
      for (const k of r.skipped) warn(`${k.name}: ${tr(`cli.skills.why.${k.why}`)}`);
      if (r.added.length) newSession();
    } else if (sub === 'remove') {
      if (!arg) return usage();
      const r = await s.remove(arg);
      ok(r.was === 'link' ? tr('cli.skills.unlinked', { name: r.name }) : tr('cli.skills.removed', { name: r.name, to: r.movedTo }));
    } else if (sub === 'search') {
      const r = await s.search(words, { limit: 20 });
      console.log(words ? tr('cli.skills.found', { n: r.total }) : tr('cli.skills.popular'));
      for (const p of r.list) console.log(`  ${p.installed ? '✓' : '·'} ${p.id}${p.installs ? `  (${p.installs})` : ''}\n      ${p.desc.slice(0, 110)}`);
      if (r.list.length) console.log(`\n  ${tr('cli.skills.howInstall')}`);
    } else if (sub === 'install' || sub === 'uninstall') {
      if (!arg) return usage();
      await s[sub](arg);
      ok(tr(sub === 'install' ? 'cli.skills.installed' : 'cli.skills.uninstalled', { name: arg }));
      if (sub === 'install') newSession();
    } else if (sub === 'market' && arg === 'add') {
      if (!args[3]) return usage();
      await s.addMarket(args[3]);
      ok(tr('cli.skills.marketAdded'));
    } else return usage();
  } catch (e) {
    if (!(e instanceof SkillError)) throw e;
    const key = `cli.skills.err.${e.code}`, text = tr(key);
    bad(text === key ? tr('cli.skills.err.other', { code: e.detail || e.code }) : text);
    process.exitCode = 1;
  }
}
const run = { start, install, setup, update, uninstall, doctor, pin, team, skills }[cmd];
if (!run) { console.log(tr('cli.usage')); process.exit(1); }
Promise.resolve(run()).catch((e) => { console.error(tr('cli.error', { message: e.message })); process.exit(1); });
