import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeys, randomId, signRequest } from '../../shared/team-protocol.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TeamCore } from '../../hub/src/core.js';

/* Admins (hub/src/core.js): the creator is the first; admins invite, add admins, remove members, change settings;
   only an admin takes themselves away, and the last one stays while others remain. */
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node without node:sqlite: skipped */ }
const needsSqlite = { skip: !DatabaseSync && 'needs node:sqlite' };

async function teamOf(...names) {
  const db = new DatabaseSync(':memory:');
  const sql = { exec: (q, ...b) => { const rows = db.prepare(q).all(...b); return { toArray: () => rows }; } };
  const clock = { t: 1_800_000_000_000 }, teamId = randomId(16);
  let core = new TeamCore(sql, { now: () => clock.t });
  const send = async (keys, method, action, body) => {
    const text = body == null ? '' : JSON.stringify(body), p = action === 'create' ? '/teams' : `/t/${teamId}/${action}`;
    clock.t += 1;
    return core.handle({ method, path: p, body: text, headers: await signRequest(keys, { method, path: p, body: text, now: clock.t }), teamId, action, hub: 'https://hub.test' });
  };
  const people = [];
  for (const [i, name] of names.entries()) {
    const keys = await generateKeys();
    if (i === 0) await send(keys, 'POST', 'create', { team: 'T', name });
    else { const inv = await send(people[0].keys, 'POST', 'invites', {}); await send(keys, 'POST', 'join', { code: inv.body.code, name }); }
    people.push({ keys, id: (await send(keys, 'GET', 'me')).body.me.id });
  }
  const reopen = () => { core = new TeamCore(sql, { now: () => clock.t }); };   // (the Durable Object waking up)
  return { db, clock, send, people, reopen, role: async (k) => (await send(k, 'GET', 'me')).body.me.role };
}

test('the creator is the first admin; admins invite and change settings, members don\'t', needsSqlite, async () => {
  const { send, people: [a, b], role } = await teamOf('An', 'Bình');
  assert.equal(await role(a.keys), 'admin');
  assert.equal(await role(b.keys), 'member');
  assert.equal((await send(a.keys, 'GET', 'me')).body.me.owner, true);   // (what offices from before admins read)
  assert.equal((await send(b.keys, 'POST', 'invites', {})).body.error, 'not-owner');
  assert.equal((await send(b.keys, 'POST', 'policy', { details: true })).body.error, 'not-owner');
  assert.equal((await send(b.keys, 'POST', 'promote', { member: b.id })).body.error, 'not-owner');
});

test('an admin makes another admin, who can then invite; everyone hears the new list', needsSqlite, async () => {
  const { send, people: [a, b, c], role } = await teamOf('An', 'Bình', 'Chi');
  const up = await send(a.keys, 'POST', 'promote', { member: b.id });
  assert.equal(up.status, 200);
  assert.deepEqual(up.send.map((o) => o.to).sort(), [a.id, b.id, c.id].sort());
  assert.equal(up.send.find((o) => o.to === b.id).msg.me.owner, true);
  assert.equal(up.body.members.find((m) => m.id === b.id).role, 'admin');
  assert.equal(await role(b.keys), 'admin');
  assert.equal((await send(b.keys, 'POST', 'invites', {})).status, 201);
  assert.equal((await send(a.keys, 'POST', 'promote', { member: b.id })).body.error, 'already-admin');
  assert.equal((await send(a.keys, 'POST', 'promote', { member: 'nobody' })).body.error, 'no-member');
  assert.equal((await send(a.keys, 'POST', 'promote', {})).body.error, 'no-member');
});

test('admins remove members, never another admin; the removed one is out at once', needsSqlite, async () => {
  const { send, people: [a, b, c] } = await teamOf('An', 'Bình', 'Chi');
  await send(a.keys, 'POST', 'promote', { member: b.id });
  assert.equal((await send(a.keys, 'POST', 'remove', { member: b.id })).body.error, 'is-admin');
  assert.equal((await send(b.keys, 'POST', 'remove', { member: a.id })).body.error, 'is-admin');
  assert.equal((await send(a.keys, 'POST', 'remove', { member: a.id })).body.error, 'remove-self');
  assert.equal((await send(c.keys, 'POST', 'remove', { member: a.id })).body.error, 'not-owner');
  const out = await send(b.keys, 'POST', 'remove', { member: c.id });
  assert.equal(out.status, 200);
  assert.equal(out.left, c.id);   // (the Durable Object closes Chi's socket and tells everyone)
  assert.deepEqual(out.body.members.map((m) => m.id).sort(), [a.id, b.id].sort());
  assert.equal((await send(c.keys, 'GET', 'me')).body.error, 'not-member');
  assert.equal((await send(a.keys, 'POST', 'remove', { member: c.id })).body.error, 'no-member');
});

test('an admin steps down only for themselves, and the last admin stays', needsSqlite, async () => {
  const { send, people: [a, b], role } = await teamOf('An', 'Bình');
  assert.equal((await send(a.keys, 'POST', 'stepdown', {})).body.error, 'last-admin');
  assert.equal((await send(a.keys, 'POST', 'leave', {})).body.error, 'last-admin');
  assert.equal((await send(b.keys, 'POST', 'stepdown', {})).body.error, 'not-admin');
  await send(a.keys, 'POST', 'promote', { member: b.id });
  assert.equal((await send(a.keys, 'POST', 'stepdown', {})).status, 200);
  assert.equal(await role(a.keys), 'member');
  assert.equal((await send(a.keys, 'POST', 'invites', {})).body.error, 'not-owner');
  // the last admin alone in the team may leave; leaving and coming back doesn't bring the role back
  assert.equal((await send(a.keys, 'POST', 'leave', {})).status, 200);
  assert.equal((await send(b.keys, 'POST', 'leave', {})).status, 200);
});

test('a team made before admins: its creator becomes the first admin when the hub wakes up', needsSqlite, async () => {
  const { db, people: [a, b], reopen, role } = await teamOf('An', 'Bình');
  db.prepare("UPDATE members SET role = 'member'").run();   // (as an older hub left it)
  reopen();
  assert.equal(await role(a.keys), 'admin');
  assert.equal(await role(b.keys), 'member');
});

test('relay: the members list and your role follow what the hub sends', async () => {
  process.env.OFFICE_TEAM_KEYSTORE = 'file';
  const { createRelay } = await import('../../server/team/relay.mjs');
  const { saveKeys } = await import('../../server/team/identity.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-admins-')), keys = await generateKeys();
  fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify({ hub: 'https://hub.test', teamId: randomId(16), teamName: 'T', memberId: 'm1', name: 'An', publicKey: keys.publicKey, keyStore: await saveKeys(dir, keys), room: { mode: 'closed' } }));
  const sockets = [];
  class FakeWS { constructor(url) { this.url = url; this.sent = []; this.on = {}; sockets.push(this); } addEventListener(k, f) { this.on[k] = f; } send(t) { this.sent.push(JSON.parse(t)); } close() { this.closed = true; } }
  const relay = createRelay({ dataDir: dir, sessions: () => [], WebSocket: FakeWS });
  relay.start();
  try {
    await new Promise((r) => setTimeout(r, 50));
    const s = sockets[0], list = [{ id: 'm1', name: 'An', role: 'admin', joinedAt: 1 }, { id: 'm2', name: 'Bình', role: 'member', joinedAt: 2 }];
    s.on.open(); s.on.message({ data: JSON.stringify({ t: 'hello', me: { id: 'm1', name: 'An', role: 'admin', owner: true }, policy: {}, rooms: [], members: list }) });
    assert.deepEqual(relay.state().members.map((m) => [m.name, m.role]), [['An', 'admin'], ['Bình', 'member']]);
    assert.equal(relay.state().me.owner, true);
    // An makes Bình an admin and steps down
    s.on.message({ data: JSON.stringify({ t: 'members', list: [{ ...list[0], role: 'member' }, { ...list[1], role: 'admin' }], me: { id: 'm1', name: 'An', role: 'member', owner: false } }) });
    assert.equal(relay.state().me.owner, false);
    assert.deepEqual(relay.state().members.map((m) => m.role), ['member', 'admin']);
    // what an API call answered shows at once
    relay.setMembers({ members: [list[0]], me: { id: 'm1', name: 'An', role: 'admin', owner: true } });
    assert.deepEqual([relay.state().members.length, relay.state().me.owner], [1, true]);
  } finally { relay.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
