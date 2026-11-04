// Keeping this office up to date on its own (docs/features/team-mode.md, "Bắt buộc cập nhật"): now and then it looks at
// main on its own git remote (the repository it was installed from: the hub never sends code), and when there is a
// newer version, or the team's admin requires one (the hub's minimum, server/team/relay.mjs onVersion), it updates
// itself with `my-office update --auto` (bin/cli.mjs: pull, packages, build, restart the service, back to the old
// version if the build fails). Only a plain install does that: on main, no changes of its own, run by its own login
// service. A clone someone works in (another branch, local changes) is left alone and only told.
//
// A version is a number: how many commits main had at the commit the page was built from (.next/office-commit), so
// "older" means something on the hub without it knowing any commit.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

export const CHECK_MS = 15 * 60_000;      // how often it looks for a newer version
const FIRST_MS = 60_000;                  // the first look, a minute after starting
const BUSY_WAIT_MS = 15_000, BUSY_MAX_MS = 10 * 60_000;   // waiting for approvals in hand to be answered (at most 10 minutes)
const RETRY_MS = 60 * 60_000;             // a version that failed to build is tried again after an hour
const LOST_MS = 20 * 60_000;              // an update that started and never came back counts as failed

/**
 * root: the office's folder; dataDir: its data folder (update.json, update.log); distDir: the page's build folder;
 * busy(): approvals or questions waiting (a restart would drop them); canRestart(): this folder is run by its own
 * service (or OFFICE_RESTART_CMD); onChange(state): what the page shows changed. git(args) and launch(args) are
 * replaced in the unit tests.
 */
export function createUpdater({ root, dataDir, distDir = '.next', busy = () => false, canRestart = () => false, onChange = () => {}, log = () => {},
  env = process.env, now = () => Date.now(), git = null, launch = null, every = CHECK_MS, busyWait = BUSY_WAIT_MS }) {
  const FILE = path.join(dataDir, 'update.json');
  const run = git || ((args, timeout = 60_000) => new Promise((resolve) => {
    execFile('git', ['-C', root, ...args], { timeout, encoding: 'utf8' }, (err, out) => resolve(err ? null : String(out).trim()));
  }));
  const start = launch || ((args) => {
    fs.mkdirSync(dataDir, { recursive: true });
    const out = fs.openSync(path.join(dataDir, 'update.log'), 'a');
    // (its own process group: the service restart at its end must not take it down halfway)
    spawn(process.execPath, [path.join(root, 'bin', 'cli.mjs'), ...args], { cwd: root, env, detached: true, stdio: ['ignore', out, out] }).unref();
  });
  const off = env.OFFICE_AUTO_UPDATE === '0';
  let build = 0, commit = '', latest = 0, min = 0, held = false, timer = null, waitTimer = null;
  let st = { status: 'ok' };   // ok | waiting | running | done | failed | blocked | off
  const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };
  const write = (o) => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(o, null, 2)); } catch { /* read-only: just not remembered */ } };
  const set = (next) => { st = next; onChange(api.state()); };
  const count = async (ref) => Number(await run(['rev-list', '--count', ref])) || 0;

  // what this office runs, and how the last update went (it may have just restarted into the new version)
  async function init() {
    let stamp = ''; try { stamp = fs.readFileSync(path.join(root, distDir, 'office-commit'), 'utf8').trim(); } catch { /* not built by the cli */ }
    commit = (stamp && (await run(['rev-parse', '--verify', '--quiet', `${stamp}^{commit}`]))) || (await run(['rev-parse', 'HEAD'])) || '';
    build = commit ? await count(commit) : 0;
    const last = read();
    if (last?.status === 'running' && commit && last.from !== commit) { set({ status: 'done', toBuild: build, at: now() }); write({ ...last, status: 'done', doneAt: now() }); }
    else if (last?.status === 'running' && now() - (last.at || 0) > LOST_MS) { write({ ...last, status: 'failed', why: 'lost' }); set({ status: 'failed', why: 'lost', at: now() }); }
    else if (last?.status === 'failed' && now() - (last.at || 0) < RETRY_MS) set({ status: 'failed', why: last.why || 'build', at: last.at });
    if (off) set({ status: 'off' });
  }
  // why this folder can't update itself (null: it can)
  async function cannot() {
    if (!commit) return 'no-git';
    if ((await run(['rev-parse', '--abbrev-ref', 'HEAD'])) !== 'main') return 'branch';
    if ((await run(['status', '--porcelain', '--untracked-files=no'])) !== '') return 'changes';
    if ((await run(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'])) == null) return 'diverged';
    if (!canRestart()) return 'no-service';
    return null;
  }

  /** Looks at main on the remote; updates when there is something newer (or the team requires it). */
  async function check() {
    if (st.status === 'running') {   // (the update ended without a restart: it says how in update.json)
      const l = read();
      if (l?.status === 'failed') set({ status: 'failed', why: l.why || 'build', at: l.at }); else if (now() - (st.at || 0) > LOST_MS) set({ status: 'failed', why: 'lost', at: now() });
      return api.state();
    }
    if (!commit || st.status === 'waiting') return api.state();
    if ((await run(['fetch', '--quiet', 'origin', 'main'], 90_000)) == null) { log('update: could not reach the git remote'); return api.state(); }
    latest = await count('origin/main');
    const target = await run(['rev-parse', 'origin/main']);
    const forced = min > build;
    if (latest <= build && !forced) { if (!['done', 'failed', 'off'].includes(st.status)) set({ status: 'ok' }); else onChange(api.state()); return api.state(); }
    if (forced && latest < min) { set({ status: 'blocked', why: 'no-newer' }); return api.state(); }   // (the remote has nothing that new yet)
    if (off) { set({ status: 'off' }); return api.state(); }
    const why = await cannot();
    if (why) { set({ status: 'blocked', why }); return api.state(); }
    const last = read();
    if (last?.status === 'failed' && last.to === target && now() - (last.at || 0) < RETRY_MS) { set({ status: 'failed', why: last.why || 'build', at: last.at }); return api.state(); }
    set({ status: 'waiting', toBuild: latest, since: now() });
    go(target);
    return api.state();
  }
  // once no approval is waiting (or after ten minutes anyway): run the update; the service restarts into the new version
  function go(target) {
    clearTimeout(waitTimer);
    if (busy() && now() - st.since < BUSY_MAX_MS) { waitTimer = setTimeout(() => go(target), busyWait); waitTimer.unref?.(); return; }
    write({ status: 'running', from: commit, fromBuild: build, to: target, toBuild: latest, at: now() });
    set({ status: 'running', toBuild: latest, at: now() });
    log(`update: ${build} -> ${latest}`);
    try { start(['update', '--auto']); } catch (e) { write({ status: 'failed', from: commit, to: target, why: 'start', at: now() }); set({ status: 'failed', why: 'start', at: now() }); log(`update: ${e.message}`); }
  }

  const api = {
    get build() { return build; },
    async start() {
      await init();
      if (!commit) return;
      timer = setTimeout(function tick() { check().catch(() => {}); timer = setTimeout(tick, every); timer.unref?.(); }, FIRST_MS); timer.unref?.();
    },
    stop() { clearTimeout(timer); clearTimeout(waitTimer); },
    /** The hub said the oldest version the team allows (and whether this office is held back): update now if older. */
    require(next, isHeld = false) {
      const was = min; min = Math.max(0, Number(next) || 0); held = !!isHeld;
      if (min > build && (min !== was || st.status === 'ok' || st.status === 'blocked')) check().catch(() => {});
      else onChange(api.state());
    },
    /** For the page ({k:'update'}) and the snapshot. */
    state() { return { build, latest, min, held: held || min > build, ...st }; },
    /** The newest version on the remote (an admin requiring it for the team): { build, commit } or null. */
    async newest() {
      if ((await run(['fetch', '--quiet', 'origin', 'main'], 90_000)) == null) return null;
      const n = await count('origin/main'), c = await run(['rev-parse', 'origin/main']);
      return n ? { build: n, commit: c } : null;
    },
    check,
  };
  return api;
}
