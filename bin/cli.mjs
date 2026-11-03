#!/usr/bin/env node
// My Office command line: start the server, add/remove the Claude Code hooks, install the login service, and
// check that everything is wired ("doctor"). Settings are backed up before every change and written atomically.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrefs } from '../server/prefs.mjs';
import { serviceFor } from './service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const PORT = Number(process.env.OFFICE_PORT || 4310);
// Words in the office's language (data/prefs.json, picked in Settings; OFFICE_LANG until then), same folder as the server's.
// the server's data folder (OFFICE_DATA_DIR for a second copy; the launchd service and the hooks always use data/)
const DATA_DIR = process.env.OFFICE_DATA_DIR ? path.resolve(process.env.OFFICE_DATA_DIR) : path.join(ROOT, 'data');
const { tr } = createPrefs(DATA_DIR);
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
function ensureBuild() {
  if (fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) return;
  console.log(tr('cli.building'));
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
}

async function install() {
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
  if (args.includes('--service') && !opt('--settings')) {
    await fsp.mkdir(path.join(ROOT, 'data'), { recursive: true });
    ensureBuild();
    const svc = service();
    if (await svc.install()) ok(tr('cli.install.service', { file: svc.file })); else warn(tr('cli.install.noService'));
    LAN ? warn(tr('cli.install.lan')) : ok(tr('cli.install.local'));
  }
  console.log(`\n${tr('cli.install.next', { port: PORT })}`);
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
   my-office team invite | join <invite link> [--me <name>] | status | leave [--local] | restore <recovery key>
   my-office team room open|closed | pause | resume | rooms | policy details on|off */
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
      console.log(`  ${tr(r.policy?.details ? 'cli.team.policyIsOn' : 'cli.team.policyIsOff')}${r.me.owner ? ` ${tr('cli.team.youOwn')}` : ''}`);
      console.log(`  ${tr('cli.team.members', { n: r.members.length })}`);
      for (const m of r.members) console.log(`    · ${m.name}${m.id === r.me.id ? ` (${tr('cli.team.itsYou')})` : ''}`);
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
const run = { start, install, uninstall, doctor, pin, team }[cmd];
if (!run) { console.log(tr('cli.usage')); process.exit(1); }
Promise.resolve(run()).catch((e) => { console.error(tr('cli.error', { message: e.message })); process.exit(1); });
