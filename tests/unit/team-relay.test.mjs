import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanEvents, cleanRoom, eventView, generateKeys, randomId, roomView, signRequest, signedWsUrl } from '../../shared/team-protocol.js';
import { TeamCore } from '../../hub/src/core.js';

// a session as the server shows it to its own page (server/index.mjs pub()), with everything that must not leave
const SECRET_PROMPT = 'fix the payment bug for customer 4242';
const session = (over = {}) => ({
  id: 'p123', sid: 'abcd-sid', pid: 4321, name: 'secret-folder-ab', title: 'Payment refactor for ACME', dir: '~/work/acme-secret',
  status: 'work', lastPrompt: SECRET_PROMPT, lastReply: 'done, see payments.ts', taskStart: 1_800_000_000_000, lastAt: 1_800_000_100_000,
  subs: [{ id: 'a1', type: 'Explore' }], last: { type: 'edit', label: 'src/payments.ts' }, role: 'Dev', git: { repo: 'be', branch: 'feat/x' },
  usage: { cost: 12.5 }, todos: [{ content: 'call bank' }], link: 'https://claude.ai/code/xyz', ...over,
});
const idOf = (id) => `x${id.replace(/[^a-z0-9]/g, '')}00`.slice(0, 12);
const FORBIDDEN = [SECRET_PROMPT, 'Payment refactor', 'acme-secret', 'secret-folder', '4321', 'abcd-sid', '12.5', 'call bank', 'claude.ai', 'feat/x', 'payments.ts', 'done, see'];
const leaks = (obj) => FORBIDDEN.filter((f) => JSON.stringify(obj).includes(f));

test('a closed room tells only how many are working, waiting and resting', () => {
  const r = roomView([session(), session({ id: 'p2', status: 'wait' }), session({ id: 'p3', status: 'rest' })], { mode: 'closed', idOf });
  assert.deepEqual(r, { mode: 'closed', counts: { work: 1, rest: 1, wait: 1 } });
  assert.deepEqual(roomView([session()], { mode: 'nonsense', idOf }).mode, 'closed');
});

test('an open room shows each person, but no prompt, title, folder, pid, cost, file or command', () => {
  const r = roomView([session()], { mode: 'open', idOf });
  assert.deepEqual(r.people, [{ id: 'xp12300', status: 'work', project: 'be', role: 'Dev', subs: 1, act: 'edit', since: 1_800_000_000_000, at: 1_800_000_100_000 }]);
  assert.deepEqual(leaks(r), []);
  // no repository: the folder's last part names the project, never the path
  assert.equal(roomView([session({ git: null, dir: '~/work/gamota-be' })], { mode: 'open', idOf }).people[0].project, 'gamota-be');
});

test('file names and commands show only with the team setting on, secrets masked', () => {
  const redact = (s) => s.replace(/sk-\w+/g, '•••');
  const r = roomView([session({ last: { type: 'bash', label: 'curl -H sk-abc123' } })], { mode: 'open', details: true, idOf, redact });
  assert.equal(r.people[0].label, 'curl -H •••');
  const e = { id: 9, ts: 5, sess: 'p123', name: 'x', type: 'read', label: 'src/a.ts' };
  assert.deepEqual(eventView(e, { idOf }), { p: 'xp12300', type: 'read', ts: 5 });
  assert.equal(eventView(e, { idOf, details: true }).label, 'src/a.ts');
  assert.equal(eventView({ ...e, type: '<script>' }, { idOf }).type, 'other');
});

test('the hub cleans whatever a member sends', () => {
  // a closed room that (wrongly) carries people: they are dropped
  assert.deepEqual(cleanRoom({ mode: 'closed', counts: { work: 2 }, people: [{ id: 'abcdef', status: 'work' }] }), { mode: 'closed', counts: { work: 2, rest: 0, wait: 0 } });
  const r = cleanRoom({ mode: 'open', counts: { work: -5, rest: 'x', wait: 1e9 }, people: [
    { id: 'abcdef', status: 'boss', project: 'p'.repeat(99), role: 'r\n\u0000x', subs: 1e6, act: 'hack', label: 'secret.ts', extra: 'nope' },
    { id: '../etc', status: 'work' }, null, 'junk'] });
  assert.deepEqual(r.counts, { work: 0, rest: 0, wait: 999 });
  assert.equal(r.people.length, 1);
  const p = r.people[0];
  assert.deepEqual([p.status, p.project.length, p.role, p.subs, p.act, p.label, p.extra], ['rest', 40, 'r x', 99, 'other', undefined, undefined]);
  assert.equal(cleanRoom({ mode: 'open', people: [{ id: 'abcdef', label: 'a.ts' }] }, { details: true }).people[0].label, 'a.ts');
  assert.deepEqual(cleanEvents([{ p: 'abcdef', type: 'edit', ts: 1, label: 'a.ts' }, { p: 'BAD!', type: 'edit' }]), [{ p: 'abcdef', type: 'edit', ts: 1 }]);
  assert.equal(cleanRoom('junk'), null);
});

/* ---------- the hub's relay rules (hub/src/core.js), on Node's built-in SQLite ---------- */
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node without node:sqlite: skipped */ }
const needsSqlite = { skip: !DatabaseSync && 'needs node:sqlite' };

async function teamOf(...names) {
  const db = new DatabaseSync(':memory:');
  const sql = { exec: (q, ...b) => { const rows = db.prepare(q).all(...b); return { toArray: () => rows }; } };
  const clock = { t: 1_800_000_000_000 }, teamId = randomId(16);
  const core = new TeamCore(sql, { now: () => clock.t });
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
  const ws = async (keys) => core.authWs({ method: 'GET', path: new URL(await signedWsUrl(keys, 'https://hub.test', teamId, clock.t)).pathname + new URL(await signedWsUrl(keys, 'https://hub.test', teamId, clock.t)).search });
  return { core, db, sql, clock, teamId, send, people, ws };
}
const roomMsg = (room) => JSON.stringify({ t: 'room', room });

test('hub relay: only members connect; a new member sees the others', needsSqlite, async () => {
  const { core, people, ws } = await teamOf('An', 'Bình');
  assert.equal((await ws(people[1].keys)).id, people[1].id);
  await assert.rejects(ws(await generateKeys()), (e) => e.code === 'not-member');
  const hello = core.hello(people[1].id, (id) => id === people[0].id);
  assert.equal(hello.me.name, 'Bình');
  assert.deepEqual(hello.rooms.map((r) => [r.member.name, r.online, r.mode]), [['An', true, 'closed']]);
});

test('hub relay: open rooms pass on people and events; closed rooms only counts', needsSqlite, async () => {
  const { core, people } = await teamOf('An', 'Bình'), a = people[0].id;
  const open = core.ingest(a, roomMsg({ mode: 'open', counts: { work: 1 }, people: [{ id: 'abcdef', status: 'work', act: 'edit', label: 'a.ts' }] }));
  assert.equal(open[0].room.people[0].act, 'edit');
  assert.equal(open[0].room.people[0].label, undefined);   // (the team's details setting is off)
  assert.deepEqual(core.ingest(a, roomMsg({ mode: 'open', counts: { work: 1 }, people: [{ id: 'abcdef', status: 'work', act: 'edit' }] })), []);   // unchanged: nothing to send
  assert.deepEqual(core.ingest(a, JSON.stringify({ t: 'ev', list: [{ p: 'abcdef', type: 'read', ts: 1 }] })), [{ t: 'ev', member: a, list: [{ p: 'abcdef', type: 'read', ts: 1 }] }]);
  const closed = core.ingest(a, roomMsg({ mode: 'closed', counts: { work: 1 }, people: [{ id: 'abcdef', status: 'work' }] }));
  assert.equal(closed[0].room.people, undefined);
  assert.deepEqual(core.ingest(a, JSON.stringify({ t: 'ev', list: [{ p: 'abcdef', type: 'read', ts: 1 }] })), []);
  for (const junk of ['not json', JSON.stringify({ t: 'nope' }), 'x'.repeat(40_000), JSON.stringify(null)]) assert.deepEqual(core.ingest(a, junk), []);
});

test('hub relay: only the creator turns details on, and then labels pass', needsSqlite, async () => {
  const { core, people, send } = await teamOf('An', 'Bình');
  const by = await send(people[1].keys, 'POST', 'policy', { details: true });
  assert.deepEqual([by.status, by.body.error], [403, 'not-owner']);
  const ok = await send(people[0].keys, 'POST', 'policy', { details: true });
  assert.deepEqual(ok.body.policy, { details: true });
  assert.equal((await send(people[0].keys, 'GET', 'me')).body.me.owner, true);
  const out = core.ingest(people[1].id, roomMsg({ mode: 'open', people: [{ id: 'abcdef', status: 'work', label: 'a.ts' }] }));
  assert.equal(out[0].room.people[0].label, 'a.ts');
  assert.equal((await send(people[0].keys, 'POST', 'policy', { details: 'yes' })).body.error, 'bad-request');
});

test('hub relay: rooms are saved for after a sleep, and a member who leaves is gone', needsSqlite, async () => {
  const { core, sql, clock, people, send } = await teamOf('An', 'Bình'), a = people[0].id;
  core.ingest(a, roomMsg({ mode: 'open', counts: { work: 1 }, people: [{ id: 'abcdef', status: 'work' }] }));
  const woken = new TeamCore(sql, { now: () => clock.t });   // (the Durable Object evicted and back)
  assert.equal(woken.hello(people[1].id, () => true).rooms[0].people[0].id, 'abcdef');
  assert.equal(woken.hello(people[1].id, () => false).rooms[0].people, undefined);   // offline: nothing but the name
  const left = await send(people[0].keys, 'POST', 'leave', {});
  assert.equal(left.left, a);
  assert.deepEqual(woken.hello(people[1].id, () => true).rooms, []);
});

/* ---------- this computer's relay (server/team/relay.mjs), with a pretend WebSocket ---------- */
test('relay: sends a closed room, then an open one, and stops when paused', async () => {
  process.env.OFFICE_TEAM_KEYSTORE = 'file';
  const { createRelay } = await import('../../server/team/relay.mjs');
  const { saveKeys } = await import('../../server/team/identity.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-relay-')), keys = await generateKeys(), teamId = randomId(16);
  const write = async (extra) => fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify({ hub: 'https://hub.test', teamId, teamName: 'T', memberId: 'm1', name: 'An', publicKey: keys.publicKey, keyStore: await saveKeys(dir, keys), room: { mode: 'closed' }, ...extra }));
  await write({});
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.on = {}; sockets.push(this); }
    addEventListener(k, f) { this.on[k] = f; }
    send(t) { this.sent.push(JSON.parse(t)); }
    close() { this.closed = true; }
  }
  const relay = createRelay({ dataDir: dir, sessions: () => [session()], WebSocket: FakeWS });
  relay.start();
  try {
    await new Promise((r) => setTimeout(r, 50));
    const s = sockets[0];
    const u = new URL(s.url);
    assert.equal(u.protocol, 'wss:');
    assert.deepEqual(['k', 'ts', 'n', 'sig'].map((k) => !!u.searchParams.get(k)), [true, true, true, true]);
    s.on.open(); s.on.message({ data: JSON.stringify({ t: 'hello', me: { id: 'm1', name: 'An' }, policy: { details: false }, rooms: [{ member: { id: 'm2', name: 'Bình' }, online: true, mode: 'closed', counts: {} }] }) });
    assert.deepEqual(s.sent.at(-1), { t: 'room', room: { mode: 'closed', counts: { work: 1, rest: 0, wait: 0 } } });
    relay.notify({ k: 'ev', e: { sess: 'p123', type: 'read', label: 'x.ts', ts: 1 } });
    relay.flush();
    assert.equal(s.sent.filter((m) => m.t === 'ev').length, 0);   // a closed room sends no events

    await write({ room: { mode: 'open' } }); relay.reload(); relay.flush();
    const open = s.sent.at(-1);
    assert.equal(open.room.mode, 'open');
    assert.deepEqual(leaks(s.sent), []);
    relay.notify({ k: 'ev', e: { sess: 'p123', type: 'read', label: 'x.ts', ts: 2 } }); relay.flush();
    assert.deepEqual(s.sent.at(-1).list.map((e) => [e.type, e.label]), [['read', undefined]]);
    assert.deepEqual(relay.state().rooms.map((r) => r.member.name), ['Bình']);

    await write({ paused: true }); relay.reload();
    assert.equal(s.closed, true);
    assert.equal(relay.state().connected, false);
    assert.equal(sockets.length, 1);   // paused: no new connection
  } finally { relay.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
