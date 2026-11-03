import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_TTL_MS, MAX_SKEW_MS, cleanName, formatInvite, generateKeys, hubBase, isInviteCode, makeInviteCode, makeRecovery,
  parseInvite, parseRecovery, randomId, signRequest, verifyRequest,
} from '../../shared/team-protocol.js';
import { TeamCore } from '../../hub/src/core.js';

const HUB = 'https://hub.example.workers.dev';

test('a signed request verifies, and any change to it does not', async () => {
  const keys = await generateKeys(), now = 1_800_000_000_000;
  const req = { method: 'POST', path: '/t/abc/invites', body: '{"a":1}' };
  const headers = await signRequest(keys, { ...req, now });
  assert.deepEqual((await verifyRequest({ ...req, headers, now })).ok, true);
  assert.equal((await verifyRequest({ ...req, headers, now })).key, keys.publicKey);
  for (const change of [{ body: '{"a":2}' }, { path: '/t/abc/leave' }, { method: 'GET' }]) {
    assert.equal((await verifyRequest({ ...req, ...change, headers, now })).why, 'bad-signature', JSON.stringify(change));
  }
  const other = await generateKeys();
  assert.equal((await verifyRequest({ ...req, headers: { ...headers, 'x-office-key': other.publicKey }, now })).why, 'bad-signature');
});

test('a request too far from the hub clock, or not signed, is refused', async () => {
  const keys = await generateKeys(), now = 1_800_000_000_000, req = { method: 'GET', path: '/t/x/me' };
  const headers = await signRequest(keys, { ...req, now });
  assert.equal((await verifyRequest({ ...req, headers, now: now + MAX_SKEW_MS + 1 })).why, 'clock');
  assert.equal((await verifyRequest({ ...req, headers, now: now - MAX_SKEW_MS - 1 })).why, 'clock');
  assert.equal((await verifyRequest({ ...req, headers: {}, now })).why, 'unsigned');
  assert.equal((await verifyRequest({ ...req, headers: { ...headers, 'x-office-key': 'nope' }, now })).why, 'bad-signature');
});

test('invite links: made, read back, and junk refused', () => {
  const code = makeInviteCode(), team = randomId(16);
  assert.ok(isInviteCode(code) && code.length === 10 && !/[01ILO]/.test(code));
  const link = formatInvite(`${HUB}/`, team, code);
  assert.equal(link, `${HUB}/j/${team}.${code}`);
  assert.deepEqual(parseInvite(link), { hub: HUB, teamId: team, code });
  assert.deepEqual(parseInvite(`  ${HUB}/j/${team}.${code.toLowerCase()}  `)?.code, code);   // typed in lower case, with spaces
  for (const junk of ['', 'hello', `${HUB}/j/short.${code}`, `${HUB}/j/${team}.ABC`, `${HUB}/x/${team}.${code}`]) assert.equal(parseInvite(junk), null, junk);
  assert.equal(parseInvite(`http://evil.example/j/${team}.${code}`), null);   // a hub on the internet must be https
  assert.equal(hubBase('http://localhost:8787/'), 'http://localhost:8787');
  assert.throws(() => hubBase('http://hub.example.com'), /hub-not-https/);
});

test('recovery keys round-trip; anything else is refused', async () => {
  const keys = await generateKeys(), teamId = randomId(16);
  const r = makeRecovery({ hub: HUB, teamId, ...keys });
  assert.deepEqual(parseRecovery(r), { hub: HUB, teamId, ...keys });
  assert.equal(parseRecovery('mo-team-1.bm90IGpzb24'), null);
  assert.equal(parseRecovery('hello'), null);
});

test('names are one clean line of at most 40 characters', () => {
  assert.equal(cleanName('  Thịnh\n\tNguyễn\u200b '), 'Thịnh Nguyễn');
  assert.equal([...cleanName('x'.repeat(100))].length, 40);
  assert.equal(cleanName(null), '');
});

/* ---------- the hub's rules (hub/src/core.js), on Node's built-in SQLite ---------- */
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node without node:sqlite (20, early 22): skipped */ }

function hub() {
  const db = new DatabaseSync(':memory:');
  const sql = { exec: (q, ...b) => { const rows = db.prepare(q).all(...b); return { toArray: () => rows }; } };
  const clock = { t: 1_800_000_000_000 };
  const core = new TeamCore(sql, { now: () => clock.t });
  const teamId = randomId(16);
  // a request as the Worker hands it over: the path as signed, plus the team and action it saw
  const send = async (keys, method, action, body, { path, headers } = {}) => {
    const text = body == null ? '' : JSON.stringify(body);
    const p = path || (action === 'create' ? '/teams' : `/t/${teamId}/${action}`);
    const h = headers || await signRequest(keys, { method, path: p, body: text, now: clock.t });
    const out = await core.handle({ method, path: p, body: text, headers: h, teamId, action, hub: HUB });
    return { ...out, headers: h };
  };
  return { core, clock, teamId, send };
}

test('hub: create a team, invite, join, list, leave', { skip: !DatabaseSync && 'needs node:sqlite' }, async () => {
  const { send, teamId } = hub(), a = await generateKeys(), b = await generateKeys();
  const made = await send(a, 'POST', 'create', { team: 'Gamota', name: 'An' });
  assert.equal(made.status, 201);
  assert.equal(made.body.team.id, teamId);
  assert.equal((await send(b, 'POST', 'create', { team: 'Other', name: 'B' })).body.error, 'exists');

  const inv = await send(a, 'POST', 'invites', {});
  assert.equal(inv.status, 201);
  assert.deepEqual(parseInvite(inv.body.invite)?.teamId, teamId);
  assert.equal((await send(b, 'POST', 'join', { code: inv.body.code, name: 'Bình' })).status, 201);
  const me = await send(b, 'GET', 'me');
  assert.deepEqual(me.body.members.map((m) => m.name), ['An', 'Bình']);
  assert.equal(me.body.me.name, 'Bình');

  assert.equal((await send(b, 'POST', 'leave', {})).status, 200);
  assert.equal((await send(b, 'GET', 'me')).body.error, 'not-member');
  assert.deepEqual((await send(a, 'GET', 'me')).body.members.map((m) => m.name), ['An']);

  // coming back with the same key and a new invite: the same member again
  const again = await send(a, 'POST', 'invites', {});
  assert.equal((await send(b, 'POST', 'join', { code: again.body.code, name: 'Bình' })).status, 201);
  assert.equal((await send(a, 'GET', 'me')).body.members.length, 2);
});

test('hub: an invite works once, for 15 minutes, and only its own code', { skip: !DatabaseSync && 'needs node:sqlite' }, async () => {
  const { send, clock } = hub(), a = await generateKeys();
  await send(a, 'POST', 'create', { team: 'T', name: 'A' });
  const inv = await send(a, 'POST', 'invites', {});
  assert.equal((await send(await generateKeys(), 'POST', 'join', { code: inv.body.code, name: 'B' })).status, 201);
  const used = await send(await generateKeys(), 'POST', 'join', { code: inv.body.code, name: 'C' });
  assert.deepEqual([used.status, used.body.error], [410, 'invite-used']);

  const late = await send(a, 'POST', 'invites', {});
  clock.t += INVITE_TTL_MS + 1;
  assert.equal((await send(await generateKeys(), 'POST', 'join', { code: late.body.code, name: 'D' })).body.error, 'invite-expired');
  assert.equal((await send(await generateKeys(), 'POST', 'join', { code: makeInviteCode(), name: 'E' })).body.error, 'invite-unknown');
  assert.equal((await send(await generateKeys(), 'POST', 'join', { code: 'short', name: 'F' })).body.error, 'bad-request');
});

test('hub: wrong codes pause joining; open invites are capped', { skip: !DatabaseSync && 'needs node:sqlite' }, async () => {
  const { send } = hub(), a = await generateKeys();
  await send(a, 'POST', 'create', { team: 'T', name: 'A' });
  for (let i = 0; i < 20; i++) await send(await generateKeys(), 'POST', 'join', { code: makeInviteCode(), name: 'X' });
  assert.equal((await send(await generateKeys(), 'POST', 'join', { code: makeInviteCode(), name: 'X' })).body.error, 'join-paused');

  for (let i = 0; i < 10; i++) assert.equal((await send(a, 'POST', 'invites', {})).status, 201);
  assert.equal((await send(a, 'POST', 'invites', {})).body.error, 'too-many-invites');
});

test('hub: replays, outsiders and an unknown team are refused', { skip: !DatabaseSync && 'needs node:sqlite' }, async () => {
  const { send, teamId, clock } = hub(), a = await generateKeys();
  assert.equal((await send(a, 'GET', 'me')).body.error, 'no-team');
  await send(a, 'POST', 'create', { team: 'T', name: 'A' });
  const first = await send(a, 'GET', 'me');
  assert.equal(first.status, 200);
  const replay = await send(a, 'GET', 'me', null, { headers: first.headers });
  assert.deepEqual([replay.status, replay.body.error], [401, 'replay']);
  const outsider = await send(await generateKeys(), 'POST', 'invites', {});
  assert.deepEqual([outsider.status, outsider.body.error], [403, 'not-member']);
  // signed for another path (another team), sent here
  const elsewhere = await signRequest(a, { method: 'GET', path: '/t/someone-else/me', now: clock.t });
  assert.equal((await send(a, 'GET', 'me', null, { path: `/t/${teamId}/me`, headers: elsewhere })).body.error, 'bad-signature');
  assert.equal((await send(a, 'POST', 'create', { team: '', name: '' })).body.error, 'bad-request');
});

test('hub: asking about a team that does not exist writes nothing', { skip: !DatabaseSync && 'needs node:sqlite' }, async () => {
  const { send, core } = hub(), a = await generateKeys();
  const tables = () => core.rows("SELECT name FROM sqlite_master WHERE type = 'table'").length;
  for (const [method, action] of [['GET', 'me'], ['POST', 'invites'], ['POST', 'join'], ['POST', 'leave']]) {
    assert.equal((await send(a, method, action, method === 'GET' ? null : { code: makeInviteCode(), name: 'X' })).body.error, 'no-team');
  }
  assert.equal((await send(a, 'POST', 'create', { team: 'T', name: 'A' }, { headers: {} })).body.error, 'unsigned');
  assert.equal(tables(), 0);
  assert.equal((await send(a, 'POST', 'create', { team: 'T', name: 'A' })).status, 201);
  assert.ok(tables() > 0);
});
