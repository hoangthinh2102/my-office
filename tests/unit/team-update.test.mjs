import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeys, randomId, signRequest } from '../../shared/team-protocol.js';
import { TeamCore } from '../../hub/src/core.js';
import { createUpdater } from '../../server/updater.mjs';

/* Requiring a newer office: the hub holds back older ones (hub/src/core.js), which update themselves (server/updater.mjs). */
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node without node:sqlite: skipped */ }
const needsSqlite = { skip: !DatabaseSync && 'needs node:sqlite' };

async function teamOf(...names) {
  const db = new DatabaseSync(':memory:');
  const sql = { exec: (q, ...b) => { const rows = db.prepare(q).all(...b); return { toArray: () => rows }; } };
  const clock = { t: 1_800_000_000_000 }, teamId = randomId(16), builds = new Map();
  const core = new TeamCore(sql, { now: () => clock.t, buildOf: (id) => builds.get(id) || 0 });
  const send = async (keys, method, action, body) => {
    const text = body == null ? '' : JSON.stringify(body), p = action === 'create' ? '/teams' : `/t/${teamId}/${action}`;
    return core.handle({ method, path: p, body: text, headers: await signRequest(keys, { method, path: p, body: text, now: clock.t }), teamId, action, hub: 'https://hub.test' });
  };
  const people = [];
  for (const [i, name] of names.entries()) {
    const keys = await generateKeys();
    if (i === 0) await send(keys, 'POST', 'create', { team: 'T', name });
    else { const inv = await send(people[0].keys, 'POST', 'invites', {}); await send(keys, 'POST', 'join', { code: inv.body.code, name }); }
    people.push({ keys, id: (await send(keys, 'GET', 'me')).body.me.id });
  }
  return { core, clock, send, people, builds };
}
const ROOM = JSON.stringify({ t: 'room', room: { mode: 'open', counts: { work: 1 }, people: [{ id: 'abcdef', status: 'work', project: 'shop', act: 'edit' }] } });
const roomIn = (core, viewer, owner) => core.hello(viewer, () => true).rooms.find((r) => r.member.id === owner);

/* ---------- the hub ---------- */
test('only an admin sets the oldest version the team allows', needsSqlite, async () => {
  const { core, send, people: [a, b] } = await teamOf('An', 'Bình');
  assert.equal((await send(b.keys, 'POST', 'update', { build: 100 })).body.error, 'not-owner');
  for (const bad of [-1, 1.5, '100', null, 1e8]) assert.equal((await send(a.keys, 'POST', 'update', { build: bad })).status, 400);
  assert.deepEqual(core.hello(b.id, () => true).version, { min: 0 });   // (nothing required yet)
  const r = await send(a.keys, 'POST', 'update', { build: 100 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.version, { min: 100 });
  assert.deepEqual(r.send.filter((o) => o.msg.t === 'update').map((o) => [o.to, o.msg.min]).sort(), [[a.id, 100], [b.id, 100]].sort());
});

test('an older office is held back: no rooms for it, its room offline for everyone, nothing it sends goes on', needsSqlite, async () => {
  const { core, send, builds, people: [a, b, c] } = await teamOf('An', 'Bình', 'Chi');
  builds.set(a.id, 120); builds.set(b.id, 120); builds.set(c.id, 120);
  core.ingest(b.id, ROOM);
  assert.equal(roomIn(core, c.id, b.id).people.length, 1);
  builds.set(b.id, 90);   // (Bình's office is older)
  const r = await send(a.keys, 'POST', 'update', { build: 100 });
  // Bình drops out of everyone's building at once
  assert.equal(r.send.find((o) => o.to === c.id && o.msg.t === 'room')?.msg.room.online, false);
  const hb = core.hello(b.id, () => true);
  assert.deepEqual([hb.rooms, hb.update], [[], { min: 100 }]);
  assert.equal(roomIn(core, c.id, b.id).online, false);
  assert.equal(roomIn(core, c.id, b.id).people, undefined);
  assert.deepEqual(core.ingest(b.id, ROOM), []);
  assert.deepEqual(core.ingest(b.id, JSON.stringify({ t: 'ev', list: [{ p: 'abcdef', type: 'read', ts: 1 }] })), []);
  assert.deepEqual(core.viewers(a.id).map((v) => v.id), [c.id]);   // (nor does it get anyone's room)
  // an office that says nothing (too old to know about versions) is held back too
  builds.delete(c.id);
  assert.deepEqual(core.hello(c.id, () => true).rooms, []);
  // updated: back in, as before
  builds.set(b.id, 101);
  assert.equal(core.hello(b.id, () => true).update, undefined);
  assert.equal(core.hello(b.id, () => true).rooms.length, 2);
  core.ingest(b.id, ROOM.replace('shop', 'shop2'));
  assert.equal(roomIn(core, a.id, b.id).people[0].project, 'shop2');
  // a lower minimum lets the held-back come back right away (and they get their rooms)
  const low = await send(a.keys, 'POST', 'update', { build: 0 });
  assert.equal(core.hello(c.id, () => true).rooms.length, 2);
  assert.ok(low.send.some((o) => o.to === c.id && o.msg.t === 'hello' && o.msg.rooms.length === 2));
});

test('the minimum is kept when the hub sleeps', needsSqlite, async () => {
  const { core, send, people: [a] } = await teamOf('An');
  await send(a.keys, 'POST', 'update', { build: 42 });
  core.minAt = null;   // (woken up: read again from SQLite)
  assert.equal(core.minBuild(), 42);
});

/* ---------- the office updating itself ---------- */
// a pretend git: `repo` says what each command answers (null: it fails)
function fakeGit(repo) {
  return async (args) => {
    const k = args.join(' ');
    if (k.startsWith('rev-parse --verify')) return repo.stamp ? repo.stamp : null;
    if (k === 'rev-parse HEAD') return repo.head;
    if (k === 'rev-list --count ' + repo.head || k === 'rev-list --count ' + repo.stamp) return String(repo.build);
    if (k === 'rev-list --count origin/main') return String(repo.latest);
    if (k === 'rev-parse origin/main') return repo.target;
    if (k.startsWith('fetch')) return repo.fetch === false ? null : '';
    if (k === 'rev-parse --abbrev-ref HEAD') return repo.branch;
    if (k.startsWith('status')) return repo.changes || '';
    if (k.startsWith('merge-base')) return repo.ancestor === false ? null : '';
    return null;
  };
}
function setup(over = {}, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-upd-')), dataDir = path.join(root, 'data');
  const repo = { head: 'aaa111', build: 100, latest: 100, target: 'bbb222', branch: 'main', ...over }, launched = [], changes = [];
  const u = createUpdater({ root, dataDir, git: fakeGit(repo), launch: (a) => launched.push(a), canRestart: () => true, onChange: (s) => changes.push(s), env: {}, busyWait: 5, ...opts });
  const file = path.join(dataDir, 'update.json');
  const done = () => fs.rmSync(root, { recursive: true, force: true });
  return { u, repo, launched, changes, file, root, dataDir, done };
}

test('updater: nothing newer, nothing done; newer on main: it updates itself', async () => {
  const s = setup();
  try {
    await s.u.start(); s.u.stop();
    assert.equal(s.u.build, 100);
    assert.equal((await s.u.check()).status, 'ok');
    assert.deepEqual(s.launched, []);
    s.repo.latest = 103;
    const st = await s.u.check();
    assert.deepEqual([st.status, st.toBuild], ['running', 103]);
    assert.deepEqual(s.launched, [['update', '--auto']]);
    const f = JSON.parse(fs.readFileSync(s.file, 'utf8'));
    assert.deepEqual([f.status, f.from, f.to, f.toBuild], ['running', 'aaa111', 'bbb222', 103]);
    await s.u.check();
    assert.equal(s.launched.length, 1);   // (once)
  } finally { s.done(); }
});

test('updater: a clone someone works in is left alone', async () => {
  for (const [over, why] of [[{ branch: 'feat/x' }, 'branch'], [{ changes: ' M server/index.mjs' }, 'changes'], [{ ancestor: false }, 'diverged']]) {
    const s = setup({ latest: 105, ...over });
    try {
      await s.u.start(); s.u.stop();
      const st = await s.u.check();
      assert.deepEqual([st.status, st.why], ['blocked', why]);
      assert.deepEqual(s.launched, []);
    } finally { s.done(); }
  }
  const s = setup({ latest: 105 }, { canRestart: () => false });
  try { await s.u.start(); s.u.stop(); assert.equal((await s.u.check()).why, 'no-service'); assert.deepEqual(s.launched, []); } finally { s.done(); }
  const n = setup({ head: '' });   // not a clone
  try { await n.u.start(); n.u.stop(); assert.equal(n.u.build, 0); assert.equal((await n.u.check()).status, 'ok'); assert.deepEqual(n.launched, []); } finally { n.done(); }
});

test('updater: it waits for approvals in hand to be answered', async () => {
  let busy = true;
  const s = setup({ latest: 101 }, { busy: () => busy });
  try {
    await s.u.start(); s.u.stop();
    assert.equal((await s.u.check()).status, 'waiting');
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(s.launched, []);
    busy = false;
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(s.launched, [['update', '--auto']]);
    assert.equal(s.u.state().status, 'running');
  } finally { s.u.stop(); s.done(); }
});

test('updater: the team requires a newer version', async () => {
  const s = setup({ latest: 100 });
  try {
    await s.u.start(); s.u.stop();
    s.u.require(110, true);   // (GitHub has nothing that new yet)
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual([s.u.state().status, s.u.state().why, s.u.state().held], ['blocked', 'no-newer', true]);
    s.repo.latest = 110;
    s.u.require(110, true);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(s.launched, [['update', '--auto']]);
    s.u.require(90);   // (lower than this office: nothing to do)
    assert.equal(s.launched.length, 1);
  } finally { s.done(); }
  const off = setup({ latest: 110 });
  try {
    const u = createUpdater({ root: off.root, dataDir: off.dataDir, git: fakeGit(off.repo), launch: (a) => off.launched.push(a), canRestart: () => true, env: { OFFICE_AUTO_UPDATE: '0' } });
    await u.start(); u.stop();
    u.require(110, true);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual([u.state().status, u.state().held], ['off', true]);
    assert.deepEqual(off.launched, []);
  } finally { off.done(); }
});

test('updater: after the restart it says how it went; a version that failed is not tried again at once', async () => {
  const s = setup({ head: 'bbb222', build: 103, latest: 103 });
  try {
    fs.mkdirSync(s.dataDir, { recursive: true });
    fs.writeFileSync(s.file, JSON.stringify({ status: 'running', from: 'aaa111', to: 'bbb222', toBuild: 103, at: Date.now() - 60_000 }));
    await s.u.start(); s.u.stop();
    assert.deepEqual([s.u.state().status, s.u.state().toBuild], ['done', 103]);
    assert.equal(JSON.parse(fs.readFileSync(s.file, 'utf8')).status, 'done');
  } finally { s.done(); }
  const f = setup({ latest: 103 });
  try {
    fs.mkdirSync(f.dataDir, { recursive: true });
    fs.writeFileSync(f.file, JSON.stringify({ status: 'failed', why: 'build', from: 'aaa111', to: 'bbb222', at: Date.now() - 60_000 }));
    await f.u.start(); f.u.stop();
    assert.deepEqual([f.u.state().status, f.u.state().why], ['failed', 'build']);
    await f.u.check();
    assert.deepEqual(f.launched, []);   // (the same version, within the hour)
    f.repo.target = 'ccc333'; f.repo.latest = 104;   // a newer one: tried
    await f.u.check();
    assert.equal(f.launched.length, 1);
  } finally { f.done(); }
});

/* ---------- the relay tells the hub its version, and passes the minimum on ---------- */
test('relay: says its version when it connects, and hands on what the team requires', async () => {
  process.env.OFFICE_TEAM_KEYSTORE = 'file';
  const { createRelay } = await import('../../server/team/relay.mjs');
  const { saveKeys } = await import('../../server/team/identity.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-relay-')), keys = await generateKeys();
  fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify({ hub: 'https://hub.test', teamId: randomId(16), teamName: 'T', memberId: 'm1', name: 'An', publicKey: keys.publicKey, keyStore: await saveKeys(dir, keys), room: { mode: 'open' } }));
  const sockets = [], seen = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.on = {}; sockets.push(this); }
    addEventListener(k, f) { this.on[k] = f; }
    send(t) { this.sent.push(JSON.parse(t)); }
    close() { this.closed = true; }
  }
  const relay = createRelay({ dataDir: dir, sessions: () => [], WebSocket: FakeWS, build: () => 123, onVersion: (min, held) => seen.push([min, held]) });
  relay.start();
  try {
    await new Promise((r) => setTimeout(r, 30));
    const s = sockets[0];
    assert.equal(new URL(s.url).searchParams.get('b'), '123');
    s.on.open(); s.on.message({ data: JSON.stringify({ t: 'hello', me: { id: 'm1', name: 'An' }, policy: { details: false }, rooms: [], version: { min: 150 }, update: { min: 150 } }) });
    assert.deepEqual(seen.at(-1), [150, true]);
    assert.equal(relay.state().problem, 'update');
    s.on.message({ data: JSON.stringify({ t: 'update', min: 160 }) });
    assert.deepEqual(seen.at(-1), [160, true]);
    s.on.message({ data: JSON.stringify({ t: 'hello', me: { id: 'm1', name: 'An' }, policy: { details: false }, rooms: [], version: { min: 100 } }) });
    assert.deepEqual(seen.at(-1), [100, false]);
    assert.equal(relay.state().problem, null);
  } finally { relay.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
