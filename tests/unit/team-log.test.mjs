import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOG_ITEMS, LOG_REQ_MS, LOG_TEXT_MAX, cleanLog, cleanRoom, generateKeys, randomId, roomView, signRequest } from '../../shared/team-protocol.js';
import { TeamCore } from '../../hub/src/core.js';

/* A room's recent activity kept on the hub, and reading a session's conversation in someone else's room (room.log). */
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node without node:sqlite: skipped */ }
const needsSqlite = { skip: !DatabaseSync && 'needs node:sqlite' };

async function teamOf(...names) {
  const db = new DatabaseSync(':memory:');
  const sql = { exec: (q, ...b) => { const rows = db.prepare(q).all(...b); return { toArray: () => rows }; } };
  const clock = { t: 1_800_000_000_000 }, teamId = randomId(16), online = new Set();
  const core = new TeamCore(sql, { now: () => clock.t, online: (id) => !online.has(`-${id}`) });
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
  return { core, db, clock, send, people, offline: (id) => online.add(`-${id}`) };
}
const PEOPLE = [{ id: 'abcdef', status: 'work', project: 'shop', act: 'edit' }];
const room = (over = {}) => JSON.stringify({ t: 'room', room: { mode: 'open', counts: { work: 1 }, people: PEOPLE, ...over } });
const ev = (n, ts0 = 1) => JSON.stringify({ t: 'ev', list: Array.from({ length: n }, (_, i) => ({ p: 'abcdef', type: 'read', ts: ts0 + i })) });
const roomIn = (core, viewer, owner) => core.hello(viewer, () => true).rooms.find((r) => r.member.id === owner);
const ask = (core, viewer, owner, id = 'req00001', p = 'abcdef') => core.ingest(viewer, JSON.stringify({ t: 'logreq', room: owner, p, id }));
const errOf = (out) => out[0]?.msg?.error;

/* ---------- the room's recent activity, kept on the hub ---------- */
test('the hub keeps an open room\'s last 50 events (in memory) for who comes online later', needsSqlite, async () => {
  const { core, db, people: [a, b] } = await teamOf('An', 'Bình');
  core.ingest(a.id, room());
  core.ingest(a.id, ev(30)); core.ingest(a.id, ev(30, 100));
  const r = roomIn(core, b.id, a.id);
  assert.equal(r.events.length, 50);
  assert.deepEqual([r.events[0].ts, r.events.at(-1).ts], [11, 129]);   // (the oldest went)
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM rooms').all()).includes('"ev'));   // not in the database
  // closed (nobody let in): they go, and nobody gets them
  core.ingest(a.id, room({ mode: 'closed', people: undefined }));
  core.ingest(a.id, room());
  assert.equal(roomIn(core, b.id, a.id).events, undefined);
});

test('a closed room\'s kept events reach only whoever is let in; the details setting turned off clears labels', needsSqlite, async () => {
  const { core, send, people: [a, b, c] } = await teamOf('An', 'Bình', 'Chi');
  await send(b.keys, 'POST', 'knock', { room: a.id });
  await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'hour' });
  core.ingest(a.id, room({ mode: 'closed' }));
  core.ingest(a.id, ev(3));
  assert.equal(roomIn(core, b.id, a.id).events.length, 3);
  assert.equal(roomIn(core, c.id, a.id).events, undefined);
  // with labels, then the team stops sharing them: what was kept goes
  await send(a.keys, 'POST', 'policy', { details: true });
  core.ingest(a.id, JSON.stringify({ t: 'ev', list: [{ p: 'abcdef', type: 'read', ts: 9, label: 'secret.ts' }] }));
  assert.equal(roomIn(core, b.id, a.id).events.at(-1).label, 'secret.ts');
  await send(a.keys, 'POST', 'policy', { details: false });
  assert.equal(roomIn(core, b.id, a.id).events, undefined);
});

test('a member who leaves takes their kept events with them', needsSqlite, async () => {
  const { core, send, people: [a, b, c] } = await teamOf('An', 'Bình', 'Chi');
  core.ingest(b.id, room()); core.ingest(b.id, ev(2));
  assert.equal(roomIn(core, c.id, b.id).events.length, 2);
  await send(b.keys, 'POST', 'leave');
  assert.equal(core.evs?.has(b.id), false);
  assert.equal(roomIn(core, c.id, b.id), undefined);
  void a;
});

/* ---------- reading a session's conversation ---------- */
test('the protocol: room.log only from a room that shows its people, and conversations cleaned', () => {
  const s = { id: 'p1', status: 'work', last: { type: 'edit' }, git: { repo: 'shop' } }, idOf = () => 'abcdef';
  assert.equal(roomView([s], { mode: 'open', idOf, log: true }).log, true);
  assert.equal(roomView([s], { mode: 'open', idOf }).log, undefined);   // (off unless the owner turns it on)
  assert.equal(roomView([s], { mode: 'closed', idOf, log: true }).log, undefined);   // closed, nobody let in: nothing to read
  assert.equal(cleanRoom({ mode: 'open', log: 'yes', people: [] }).log, undefined);
  assert.equal(cleanRoom({ mode: 'open', log: true, people: [] }).log, true);

  const long = 'x'.repeat(LOG_TEXT_MAX + 500);
  const items = cleanLog([
    { role: 'user', text: 'key sk-abc123', ts: 1, extra: 'nope' }, { role: 'claude', text: long, ts: 2 },
    { role: 'tool', type: 'bash', label: 'curl sk-abc123', desc: 'd', ts: 3 }, { role: 'tool', type: '<script>', label: 'x', ts: 4 },
    { role: 'system', text: 'no' }, null, 'junk',
  ], (t) => t.replace(/sk-\w+/g, '•••'));
  assert.deepEqual(items.map((i) => i.role), ['user', 'claude', 'tool', 'tool']);
  assert.equal(items[0].text, 'key •••');
  assert.equal(items[0].extra, undefined);
  assert.ok(items[1].text.length <= LOG_TEXT_MAX + 1);
  assert.deepEqual([items[2].label, items[3].type], ['curl •••', 'other']);
  assert.equal(cleanLog(Array.from({ length: LOG_ITEMS + 20 }, (_, i) => ({ role: 'user', text: `m${i}` }))).length, LOG_ITEMS);
  assert.deepEqual(cleanLog('junk'), []);
});

test('asking for a conversation: only of a room you see that allows it, at most every few seconds', needsSqlite, async () => {
  const { core, clock, people: [a, b] } = await teamOf('An', 'Bình');
  core.ingest(a.id, room());
  assert.equal(errOf(ask(core, b.id, a.id)), 'off');   // off unless An turns it on
  core.ingest(a.id, room({ log: true }));
  const out = ask(core, b.id, a.id);
  assert.deepEqual(out, [{ to: a.id, msg: { t: 'logreq', from: b.id, p: 'abcdef', id: 'req00001' } }]);   // (to An's computer only)
  assert.equal(errOf(ask(core, b.id, a.id, 'req00002')), 'busy');   // too soon
  clock.t += LOG_REQ_MS;
  assert.equal(ask(core, b.id, a.id, 'req00003')[0].to, a.id);
  // bad requests
  assert.equal(errOf(ask(core, b.id, a.id, 'req00004', '../etc')), 'denied');
  assert.deepEqual(ask(core, b.id, a.id, 'x'), []);   // (no id to answer to)
  assert.equal(errOf(ask(core, a.id, a.id, 'req00005')), 'denied');   // your own room: read it in your office
  assert.equal(errOf(ask(core, b.id, 'nobody00', 'req00006')), 'gone');
});

test('a closed room\'s conversations only for whoever it let in; an offline owner can\'t answer', needsSqlite, async () => {
  const { core, clock, send, offline, people: [a, b, c] } = await teamOf('An', 'Bình', 'Chi');
  core.ingest(a.id, room({ mode: 'closed', log: true }));
  assert.equal(errOf(ask(core, b.id, a.id)), 'denied');
  await send(b.keys, 'POST', 'knock', { room: a.id });
  await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'hour' });
  core.ingest(a.id, room({ mode: 'closed', log: true }));
  assert.equal(ask(core, b.id, a.id, 'req00002')[0].to, a.id);
  assert.equal(errOf(ask(core, c.id, a.id, 'req00003')), 'denied');
  clock.t += LOG_REQ_MS;
  offline(a.id);
  assert.equal(errOf(ask(core, b.id, a.id, 'req00004')), 'gone');
});

test('the answer goes only to who asked, once, cleaned; nothing of it is kept', needsSqlite, async () => {
  const { core, db, people: [a, b, c] } = await teamOf('An', 'Bình', 'Chi');
  core.ingest(a.id, room({ log: true }));
  ask(core, b.id, a.id);
  // someone else can't answer for An, nor can An answer what wasn't asked
  assert.deepEqual(core.ingest(c.id, JSON.stringify({ t: 'log', id: 'req00001', items: [{ role: 'user', text: 'fake' }] })), []);
  assert.deepEqual(core.ingest(a.id, JSON.stringify({ t: 'log', id: 'req09999', items: [] })), []);
  const items = [{ role: 'user', text: 'SECRET-PROMPT', ts: 1, junk: 1 }, { role: 'tool', type: 'edit', label: 'a.ts', ts: 2 }];
  const out = core.ingest(a.id, JSON.stringify({ t: 'log', id: 'req00001', items }));
  assert.equal(out.length, 1);
  assert.equal(out[0].to, b.id);
  assert.deepEqual(out[0].msg, { t: 'log', id: 'req00001', room: a.id, p: 'abcdef', items: [{ role: 'user', text: 'SECRET-PROMPT', ts: 1 }, { role: 'tool', type: 'edit', label: 'a.ts', ts: 2 }] });
  assert.deepEqual(core.ingest(a.id, JSON.stringify({ t: 'log', id: 'req00001', items })), []);   // once
  const dump = JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => db.prepare(`SELECT * FROM ${t.name}`).all()));
  assert.ok(!dump.includes('SECRET-PROMPT'));
});

test('the owner\'s error is passed on; a conversation may be big, other messages may not', needsSqlite, async () => {
  const { core, clock, people: [a, b] } = await teamOf('An', 'Bình');
  core.ingest(a.id, room({ log: true }));
  ask(core, b.id, a.id);
  assert.equal(core.ingest(a.id, JSON.stringify({ t: 'log', id: 'req00001', error: 'off' }))[0].msg.error, 'off');
  clock.t += LOG_REQ_MS; ask(core, b.id, a.id, 'req00002');
  assert.equal(core.ingest(a.id, JSON.stringify({ t: 'log', id: 'req00002', error: '<weird>' }))[0].msg.error, 'gone');
  // ~100 KB of conversation passes; a room message that big does not
  clock.t += LOG_REQ_MS; ask(core, b.id, a.id, 'req00003');
  const big = Array.from({ length: 60 }, (_, i) => ({ role: 'claude', text: 'y'.repeat(1500), ts: i }));
  assert.equal(core.ingest(a.id, JSON.stringify({ t: 'log', id: 'req00003', items: big }))[0].msg.items.length, 60);
  assert.deepEqual(core.ingest(a.id, room({ log: true, pad: 'z'.repeat(40_000) })), []);
});

test('each viewer\'s reading is in the room\'s access log, at most once in ten minutes', needsSqlite, async () => {
  const { core, clock, send, people: [a, b] } = await teamOf('An', 'Bình');
  core.ingest(a.id, room({ log: true }));
  ask(core, b.id, a.id);
  clock.t += LOG_REQ_MS; ask(core, b.id, a.id, 'req00002');
  const logOf = async () => (await send(a.keys, 'GET', 'access')).body.log.filter((l) => l.action === 'log');
  assert.equal((await logOf()).length, 1);
  assert.equal((await logOf())[0].viewer.id, b.id);
  clock.t += 10 * 60_000; ask(core, b.id, a.id, 'req00003');
  assert.equal((await logOf()).length, 2);
});

/* ---------- this computer's relay: answering, and asking ---------- */
test('relay: answers a teammate with the session\'s conversation only while the owner allows it', async () => {
  process.env.OFFICE_TEAM_KEYSTORE = 'file';
  const { createRelay } = await import('../../server/team/relay.mjs');
  const { saveKeys } = await import('../../server/team/identity.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-relay-')), keys = await generateKeys(), teamId = randomId(16);
  const write = async (room) => fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify({ hub: 'https://hub.test', teamId, teamName: 'T', memberId: 'm1', name: 'An', publicKey: keys.publicKey, keyStore: await saveKeys(dir, keys), room }));
  await write({ mode: 'open' });
  const sockets = [], asked = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.on = {}; sockets.push(this); }
    addEventListener(k, f) { this.on[k] = f; }
    send(t) { this.sent.push(JSON.parse(t)); }
    close() { this.closed = true; }
  }
  const sess = { id: 'p123', status: 'work', last: { type: 'edit' }, git: { repo: 'shop' } };
  const readLog = async (id) => { asked.push(id); return [{ role: 'user', text: 'token sk-abc123', ts: 1 }, { role: 'claude', text: 'ok', ts: 2 }]; };
  const relay = createRelay({ dataDir: dir, sessions: () => [sess], WebSocket: FakeWS, redact: (t) => t.replace(/sk-\w+/g, '•••'), readLog });
  relay.start();
  const tick = () => new Promise((r) => setTimeout(r, 20));
  try {
    await tick();
    const s = sockets[0];
    s.on.open(); s.on.message({ data: JSON.stringify({ t: 'hello', me: { id: 'm1', name: 'An' }, policy: { details: false }, rooms: [] }) });
    const sent = s.sent.at(-1).room, p = sent.people[0].id;
    assert.equal(sent.log, undefined);
    // off: the teammate is told so, and nothing is read
    s.on.message({ data: JSON.stringify({ t: 'logreq', from: 'm2', p, id: 'req00001' }) }); await tick();
    assert.deepEqual(s.sent.at(-1), { t: 'log', id: 'req00001', p, error: 'off' });
    assert.deepEqual(asked, []);
    // on: the room says so, and the answer is the conversation, secrets masked
    await write({ mode: 'open', log: true }); relay.reload(); relay.flush();
    assert.equal(s.sent.at(-1).room.log, true);
    assert.equal(relay.state().room.log, true);
    s.on.message({ data: JSON.stringify({ t: 'logreq', from: 'm2', p, id: 'req00002' }) }); await tick();
    assert.deepEqual(asked, ['p123']);
    assert.deepEqual(s.sent.at(-1).items, [{ role: 'user', text: 'token •••', ts: 1 }, { role: 'claude', text: 'ok', ts: 2 }]);
    // a session that isn't here
    s.on.message({ data: JSON.stringify({ t: 'logreq', from: 'm2', p: 'zzzzzz', id: 'req00003' }) }); await tick();
    assert.equal(s.sent.at(-1).error, 'gone');
  } finally { relay.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('relay: asking for someone else\'s conversation resolves with the answer, or says why not', async () => {
  process.env.OFFICE_TEAM_KEYSTORE = 'file';
  const { createRelay } = await import('../../server/team/relay.mjs');
  const { saveKeys } = await import('../../server/team/identity.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-relay-')), keys = await generateKeys();
  fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify({ hub: 'https://hub.test', teamId: randomId(16), teamName: 'T', memberId: 'm1', name: 'An', publicKey: keys.publicKey, keyStore: await saveKeys(dir, keys), room: { mode: 'closed' } }));
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.on = {}; sockets.push(this); }
    addEventListener(k, f) { this.on[k] = f; }
    send(t) { this.sent.push(JSON.parse(t)); }
    close() { this.closed = true; }
  }
  const relay = createRelay({ dataDir: dir, sessions: () => [], WebSocket: FakeWS });
  try {
    assert.deepEqual(await relay.requestLog('m2', 'abcdef'), { ok: false, error: 'offline' });   // (not connected yet)
    relay.start();
    await new Promise((r) => setTimeout(r, 20));
    const s = sockets[0];
    s.on.open(); s.on.message({ data: JSON.stringify({ t: 'hello', me: { id: 'm1', name: 'An' }, policy: { details: false }, rooms: [] }) });
    const got = relay.requestLog('m2', 'abcdef');
    const q = s.sent.at(-1);
    assert.deepEqual([q.t, q.room, q.p], ['logreq', 'm2', 'abcdef']);
    s.on.message({ data: JSON.stringify({ t: 'log', id: 'someoneelse', items: [{ role: 'user', text: 'no' }] }) });   // (not ours)
    s.on.message({ data: JSON.stringify({ t: 'log', id: q.id, room: 'm2', p: 'abcdef', items: [{ role: 'claude', text: 'hi', ts: 1 }] }) });
    assert.deepEqual(await got, { ok: true, items: [{ role: 'claude', text: 'hi', ts: 1 }] });
    const no = relay.requestLog('m2', 'abcdef');
    s.on.message({ data: JSON.stringify({ t: 'log', id: s.sent.at(-1).id, error: 'off' }) });
    assert.deepEqual(await no, { ok: false, error: 'off' });
  } finally { relay.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
