import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_GRANT_MS, KNOCK_TTL_MS, VIEW_CODE_TTL_MS, cleanRoom, generateKeys, grantUntil, randomId, roomView, signRequest } from '../../shared/team-protocol.js';
import { TeamCore } from '../../hub/src/core.js';

/* Closed rooms (step 4): knocking, answers, view codes, revokes, expiry, on the hub's rules (hub/src/core.js). */
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
  return { core, db, clock, send, people };
}
const roomMsg = (room) => JSON.stringify({ t: 'room', room });
const PEOPLE = [{ id: 'abcdef', status: 'work', project: 'secret-repo', act: 'edit' }];
// what `viewer` was sent about `member`'s room, from a list of [{ to, msg }]
const roomFor = (out, viewer) => out.find((o) => o.to === viewer && o.msg.t === 'room')?.msg.room;

test('a knock, an answer: only the one let in sees the closed room', needsSqlite, async () => {
  const { core, db, send, people } = await teamOf('An', 'Bình', 'Chi'), [a, b, c] = people;
  core.ingest(a.id, roomMsg({ mode: 'closed', counts: { work: 1 }, people: PEOPLE }));
  assert.equal(core.hello(b.id, () => true).rooms[0].people, undefined);   // closed: counts only

  const k = await send(b.keys, 'POST', 'knock', { room: a.id });
  assert.equal(k.status, 201);
  assert.deepEqual(k.send.find((o) => o.msg.t === 'knock').msg.knock.viewer, { id: b.id, name: 'Bình' });
  assert.equal(k.send[0].to, a.id);   // (only the owner hears the knock)
  assert.equal((await send(b.keys, 'POST', 'knock', { room: a.id })).status, 200);   // waiting already: no second ring
  assert.equal(core.hello(b.id, () => true).asks[0].room, a.id);
  assert.equal(core.hello(a.id, () => true).knocks[0].viewer.id, b.id);

  // someone else can't answer for An
  assert.equal((await send(c.keys, 'POST', 'answer', { viewer: b.id, grant: 'hour' })).body.error, 'no-knock');
  const yes = await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'hour' });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.grants[0].viewer.id, b.id);
  assert.equal(yes.send.find((o) => o.to === b.id && o.msg.t === 'access').msg.state, 'granted');

  // An's office now sends its people (it knows someone is let in); Bình gets them, Chi doesn't
  const out = core.ingest(a.id, roomMsg({ mode: 'closed', counts: { work: 1 }, people: PEOPLE }));
  assert.equal(roomFor(out, b.id).people[0].project, 'secret-repo');
  assert.ok(roomFor(out, b.id).access.until > 0);
  assert.equal(roomFor(out, c.id)?.people, undefined);
  assert.equal(core.hello(c.id, () => true).rooms.find((r) => r.member.id === a.id).people, undefined);
  // a closed room's people never reach the database
  assert.ok(!JSON.stringify(db.prepare('SELECT data FROM rooms').all()).includes('secret-repo'));
  // its events only to Bình
  const ev = core.ingest(a.id, JSON.stringify({ t: 'ev', list: [{ p: 'abcdef', type: 'read', ts: 1 }] }));
  assert.deepEqual(ev.map((o) => o.to), [b.id]);
});

test('a refused knock, and knocks are limited', needsSqlite, async () => {
  const { core, clock, send, people } = await teamOf('An', 'Bình'), [a, b] = people;
  await send(b.keys, 'POST', 'knock', { room: a.id });
  const no = await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'no' });
  assert.equal(no.send.find((o) => o.to === b.id && o.msg.t === 'access').msg.state, 'denied');
  assert.deepEqual(core.hello(b.id, () => true).asks, []);
  assert.equal((await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'no' })).body.error, 'no-knock');
  // a knock unanswered for long enough is gone
  await send(b.keys, 'POST', 'knock', { room: a.id });
  clock.t += KNOCK_TTL_MS + 1;
  assert.deepEqual(core.hello(a.id, () => true).knocks, []);
  // five knocks in ten minutes, then a pause
  for (let i = 0; i < 5; i++) { clock.t += KNOCK_TTL_MS / 10; await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'no' }); await send(b.keys, 'POST', 'knock', { room: a.id }); }
  await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'no' });
  assert.equal((await send(b.keys, 'POST', 'knock', { room: a.id })).body.error, 'too-many-knocks');
  // nobody knocks on their own door, an open one, or a room that isn't there
  assert.equal((await send(a.keys, 'POST', 'knock', { room: a.id })).body.error, 'no-room');
  assert.equal((await send(a.keys, 'POST', 'knock', { room: 'nobody' })).body.error, 'no-room');
  core.ingest(b.id, roomMsg({ mode: 'open', counts: {} }));
  assert.equal((await send(a.keys, 'POST', 'knock', { room: b.id })).body.error, 'room-open');
});

test('grants run out; a revoke takes effect at once; leaving takes them all', needsSqlite, async () => {
  const { core, clock, send, people } = await teamOf('An', 'Bình', 'Chi'), [a, b, c] = people;
  core.ingest(a.id, roomMsg({ mode: 'closed', counts: { work: 1 } }));
  await send(b.keys, 'POST', 'knock', { room: a.id });
  await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'hour' });
  await send(c.keys, 'POST', 'knock', { room: a.id });
  await send(a.keys, 'POST', 'answer', { viewer: c.id, grant: 'always' });
  assert.equal(core.nextExpiry(), clock.t + 3600_000);
  clock.t += 3600_000;
  const out = core.expire();
  assert.equal(out.find((o) => o.to === b.id && o.msg.t === 'access').msg.state, 'expired');
  assert.deepEqual(out.find((o) => o.to === a.id && o.msg.t === 'grants').msg.list.map((g) => [g.viewer.id, g.until]), [[c.id, null]]);
  assert.equal(core.nextExpiry(), null);   // (always: nothing left to run out)
  // revoke
  const r = await send(a.keys, 'POST', 'revoke', { viewer: c.id });
  assert.equal(r.send.find((o) => o.to === c.id && o.msg.t === 'access').msg.state, 'revoked');
  assert.equal(roomFor(r.send, c.id).people, undefined);
  assert.equal((await send(a.keys, 'POST', 'revoke', { viewer: c.id })).body.error, 'no-grant');
  // the access log, newest first, for An only
  const log = (await send(a.keys, 'GET', 'access')).body.log.map((l) => l.action);
  assert.deepEqual(log.slice(0, 3), ['revoke', 'expired', 'grant']);
  assert.deepEqual((await send(b.keys, 'GET', 'access')).body.log, []);
  // grant 'day' ends when An's day does (An's own clock), never more than a day away
  assert.equal(grantUntil('day', 1000, 5000), 5000);
  assert.equal(grantUntil('day', 1000, 1000 + 48 * 3600_000), 1000 + 24 * 3600_000);
  assert.equal(grantUntil('day', 1000, 'x'), 1000 + 3600_000);
  assert.equal(grantUntil('nope', 1000), undefined);
  // someone who leaves: their grants and the grants on their room go
  await send(b.keys, 'POST', 'knock', { room: a.id });
  await send(a.keys, 'POST', 'answer', { viewer: b.id, grant: 'always' });
  const left = await send(b.keys, 'POST', 'leave', {});
  assert.deepEqual(left.send.map((o) => [o.to, o.msg.t, o.msg.list.length]), [[a.id, 'grants', 0]]);
});

test('a view code: once, for ten minutes, an hour of watching; wrong codes are limited', needsSqlite, async () => {
  const { core, clock, send, people } = await teamOf('An', 'Bình', 'Chi'), [a, b, c] = people;
  core.ingest(a.id, roomMsg({ mode: 'closed', counts: { work: 1 } }));
  const made = await send(a.keys, 'POST', 'code', {});
  assert.equal(made.status, 201);
  assert.equal(made.body.expiresAt, clock.t + VIEW_CODE_TTL_MS);
  assert.equal((await send(a.keys, 'POST', 'redeem', { code: made.body.code })).body.error, 'own-room');
  const used = await send(b.keys, 'POST', 'redeem', { code: made.body.code.toLowerCase() });
  assert.deepEqual([used.status, used.body.room.id, used.body.until], [200, a.id, clock.t + CODE_GRANT_MS]);
  assert.equal(used.send.find((o) => o.to === a.id && o.msg.t === 'grants').msg.list[0].viewer.id, b.id);
  assert.equal((await send(c.keys, 'POST', 'redeem', { code: made.body.code })).body.error, 'code-used');
  const late = await send(a.keys, 'POST', 'code', {});
  clock.t += VIEW_CODE_TTL_MS + 1;
  assert.equal((await send(c.keys, 'POST', 'redeem', { code: late.body.code })).body.error, 'code-expired');
  // a trusted viewer keeps "always" after using a code
  await send(c.keys, 'POST', 'knock', { room: a.id });
  await send(a.keys, 'POST', 'answer', { viewer: c.id, grant: 'always' });
  const again = await send(a.keys, 'POST', 'code', {});
  assert.equal((await send(c.keys, 'POST', 'redeem', { code: again.body.code })).body.until, null);
  // guessing: ten wrong codes in ten minutes, then a pause
  let last;
  for (let i = 0; i < 11; i++) last = await send(b.keys, 'POST', 'redeem', { code: 'ABCDEFGHJK' });
  assert.equal(last.body.error, 'redeem-paused');
  assert.equal((await send(b.keys, 'POST', 'redeem', { code: 'nope' })).body.error, 'redeem-paused');
  // at most five open codes per room
  for (let i = 0; i < 5; i++) await send(a.keys, 'POST', 'code', {});
  assert.equal((await send(a.keys, 'POST', 'code', {})).body.error, 'too-many-codes');
});

test('an office sends a closed room\'s people only while someone is let in', () => {
  const sessions = [{ id: 's1', status: 'work', dir: '/x/secret-repo', last: { type: 'edit', label: 'a.ts' } }];
  const idOf = () => 'abcdef12';
  assert.equal(roomView(sessions, { mode: 'closed', idOf }).people, undefined);
  assert.equal(roomView(sessions, { mode: 'closed', idOf, share: true }).people[0].project, 'secret-repo');
  assert.equal(roomView(sessions, { mode: 'closed', idOf, share: true }).people[0].label, undefined);   // (details off)
  assert.equal(cleanRoom({ mode: 'closed', people: [{ id: 'abcdef' }] }).people, undefined);
  assert.equal(cleanRoom({ mode: 'closed', people: [{ id: 'abcdef' }] }, { share: true }).people.length, 1);
});
