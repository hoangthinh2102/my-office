// One team's records and rules on the hub: members, their devices, invites, and the access log. It takes a SQL handle
// shaped like Cloudflare's Durable Object storage (`exec(query, ...bindings)` returning rows with toArray()), so the
// same code runs in the Worker (team.js) and in the unit tests (Node's built-in SQLite).
//
// The hub only relays: it never holds a member's code, prompts or conversations, and it has no way to send a command
// to anyone's computer.
import {
  CODE_GRANT_MS, GRANTS, INVITE_TTL_MS, KNOCK_TTL_MS, MSG_MAX, NONCE_KEEP_MS, VIEW_CODE_TTL_MS, cleanEvents, cleanName, cleanRoom,
  formatInvite, grantUntil, hashCode, hashViewCode, isInviteCode, keyId, makeInviteCode, normalizeCode, verifyRequest, wsHeaders,
} from '../../shared/team-protocol.js';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  // role: 'admin' (invites, adds admins, removes members, changes the team's settings) or 'member'
  'CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'member\', joined_at INTEGER NOT NULL, left_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS devices (key TEXT PRIMARY KEY, member_id TEXT NOT NULL, added_at INTEGER NOT NULL, revoked_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT, used_at INTEGER)',
  // who may watch a closed room, until when (expires_at NULL: always, the trusted list)
  'CREATE TABLE IF NOT EXISTS grants (room TEXT NOT NULL, viewer TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, PRIMARY KEY (room, viewer))',
  // a knock on a closed room's door, waiting for its owner's answer (KNOCK_TTL_MS)
  'CREATE TABLE IF NOT EXISTS knocks (room TEXT NOT NULL, viewer TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (room, viewer))',
  // one-time view codes a room's owner gives out (only their hash)
  'CREATE TABLE IF NOT EXISTS view_codes (hash TEXT PRIMARY KEY, room TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT, used_at INTEGER)',
  // each room's comings and goings, for its owner: knocks, answers, codes, revokes (the last LOG_KEEP a room)
  'CREATE TABLE IF NOT EXISTS access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, room TEXT NOT NULL, viewer TEXT, action TEXT NOT NULL, detail TEXT)',
  'CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT)',
  'CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL)',
  // each member's room as last sent (already cleaned), saved at most every ROOM_SAVE_MS: the hub may sleep between messages
  'CREATE TABLE IF NOT EXISTS rooms (member_id TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL)',
];
const ROOM_SAVE_MS = 30_000;   // (the Workers Free plan allows 100,000 rows written a day)
const MAX_OPEN_INVITES = 10;      // per member, at one time
const JOIN_FAILS_MAX = 20;        // wrong invite codes per team in JOIN_FAILS_WINDOW before joining is paused
const JOIN_FAILS_WINDOW = 10 * 60_000;
const BODY_MAX = 16 * 1024;
const KNOCKS_MAX = 5;             // knocks a member may make in ACCESS_WINDOW
const REDEEM_FAILS_MAX = 10;      // wrong view codes a member may try in ACCESS_WINDOW
const ACCESS_WINDOW = 10 * 60_000;
const MAX_OPEN_VIEW_CODES = 5;    // per room, at one time
const LOG_KEEP = 200;             // access log lines kept per room
const LOG_OUT = 50;               // and shown to its owner

export class HubError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new HubError(status, code); };

export class TeamCore {
  /** sql: { exec(query, ...bindings) -> { toArray() } }. */
  constructor(sql, { now = () => Date.now(), online = () => true } = {}) {
    this.sql = sql; this.now = now;
    this.online = online;   // whether a member has a socket open now (the Durable Object knows; the tests say yes)
    // the tables are made only when a team is created, so a request for a team that doesn't exist writes nothing
    this.ready = this.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0;
    if (this.ready) { for (const q of SCHEMA) this.sql.exec(q); this.firstAdmin(); }   // (a team made by an older version gets the tables added since)
  }
  // a team made before admins existed: its creator (the key it was made with) becomes its first admin
  firstAdmin() {
    if (this.row("SELECT 1 AS x FROM members WHERE role = 'admin' AND left_at IS NULL")) return;
    const creator = this.row('SELECT member_id FROM devices WHERE key = ? AND revoked_at IS NULL', this.meta('root_key'))?.member_id;
    if (creator) this.sql.exec("UPDATE members SET role = 'admin' WHERE id = ? AND left_at IS NULL", creator);
  }
  init() { if (!this.ready) { for (const q of SCHEMA) this.sql.exec(q); this.ready = true; } }
  rows(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  row(q, ...b) { return this.rows(q, ...b)[0] || null; }
  meta(k) { return this.ready ? this.row('SELECT v FROM meta WHERE k = ?', k)?.v ?? null : null; }
  log(actor, action, detail = '') { this.sql.exec('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)', this.now(), actor, action, detail); }

  /** One request to this team. req: { method, path (with query), body (text), headers, teamId, hub }. Returns { status, body }. */
  async handle(req) {
    try {
      if ((req.body || '').length > BODY_MAX) fail(413, 'too-large');
      const route = `${req.method.toUpperCase()} ${req.action}`;
      switch (route) {
        case 'POST create': return await this.create(req);
        case 'POST join': return await this.join(req);
        case 'POST invites': return await this.invite(req);
        case 'GET me': return await this.me(req);
        case 'POST leave': return await this.leave(req);
        case 'POST policy': return await this.policy(req);
        case 'POST promote': return await this.promote(req);
        case 'POST stepdown': return await this.stepDown(req);
        case 'POST remove': return await this.remove(req);
        case 'POST knock': return await this.knock(req);
        case 'POST answer': return await this.answer(req);
        case 'POST revoke': return await this.revoke(req);
        case 'POST code': return await this.viewCode(req);
        case 'POST redeem': return await this.redeem(req);
        case 'GET access': return await this.accessOut(req);
        case 'GET name': return { status: 200, body: { name: this.ready ? this.meta('name') || null : null } };   // (the Worker's invite page only: not in its ACTIONS)
        default: fail(404, 'not-found');
      }
    } catch (e) {
      if (e instanceof HubError) return { status: e.status, body: { error: e.code } };
      throw e;
    }
  }

  /* ---------- signatures ---------- */
  async signed(req) {
    const v = await verifyRequest({ method: req.method, path: req.path, body: req.body, headers: req.headers, now: this.now() });
    if (!v.ok) fail(401, v.why);
    this.init();   // (only reached without tables by a correctly signed create: other routes stop at 'no-team' first)
    const t = this.now();
    this.sql.exec('DELETE FROM nonces WHERE at < ?', t - NONCE_KEEP_MS);
    if (this.row('SELECT 1 AS x FROM nonces WHERE nonce = ?', v.nonce)) fail(401, 'replay');
    this.sql.exec('INSERT INTO nonces (nonce, at) VALUES (?, ?)', v.nonce, t);
    return v;
  }
  // the signer must be an active member's device
  async member(req) {
    if (!this.meta('team_id')) fail(404, 'no-team');
    const v = await this.signed(req);
    const m = this.row(`SELECT m.id, m.name, m.role FROM devices d JOIN members m ON m.id = d.member_id
      WHERE d.key = ? AND d.revoked_at IS NULL AND m.left_at IS NULL`, v.key);
    if (!m) fail(403, 'not-member');
    return m;
  }
  body(req) {
    try { const o = JSON.parse(req.body || '{}'); return o && typeof o === 'object' ? o : fail(400, 'bad-request'); } catch { return fail(400, 'bad-request'); }
  }

  /* ---------- routes ---------- */
  async create(req) {
    const b = this.body(req), team = cleanName(b.team), name = cleanName(b.name);
    if (!team || !name) fail(400, 'bad-request');
    if (this.meta('team_id')) fail(409, 'exists');
    const v = await this.signed(req);
    const id = await keyId(v.key), t = this.now();
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?), (?, ?), (?, ?), (?, ?)', 'team_id', req.teamId, 'name', team, 'root_key', v.key, 'created_at', String(t));
    this.sql.exec("INSERT INTO members (id, name, role, joined_at) VALUES (?, ?, 'admin', ?)", id, name, t);
    this.sql.exec('INSERT INTO devices (key, member_id, added_at) VALUES (?, ?, ?)', v.key, id, t);
    this.log(id, 'create', team);
    return { status: 201, body: { team: { id: req.teamId, name: team }, me: this.meOut(id) } };
  }

  async invite(req) {
    const m = await this.member(req), t = this.now();
    if (!this.isAdmin(m.id)) fail(403, 'not-owner');   // (only admins bring people in; the code predates admins)
    const open = this.row('SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND expires_at > ?', m.id, t).n;
    if (open >= MAX_OPEN_INVITES) fail(429, 'too-many-invites');
    this.sql.exec('DELETE FROM invites WHERE expires_at < ?', t - 24 * 3600_000);   // (expired a day ago: nothing left to show)
    const teamId = this.meta('team_id'), code = makeInviteCode(), expiresAt = t + INVITE_TTL_MS;
    this.sql.exec('INSERT INTO invites (hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)', await hashCode(teamId, code), m.id, t, expiresAt);
    this.log(m.id, 'invite');
    return { status: 201, body: { invite: formatInvite(req.hub, teamId, code), code, expiresAt } };
  }

  async join(req) {
    if (!this.meta('team_id')) fail(404, 'no-team');
    const t = this.now();
    const fails = this.row('SELECT COUNT(*) AS n FROM audit WHERE action = ? AND at > ?', 'join-failed', t - JOIN_FAILS_WINDOW).n;
    if (fails >= JOIN_FAILS_MAX) fail(429, 'join-paused');
    const v = await this.signed(req), b = this.body(req), name = cleanName(b.name);
    if (!name || !isInviteCode(b.code)) fail(400, 'bad-request');
    const inv = this.row('SELECT * FROM invites WHERE hash = ?', await hashCode(this.meta('team_id'), b.code));
    // a link works for everyone who has it until it runs out (an hour); used_by / used_at keep the last one in
    const bad = !inv ? 'invite-unknown' : inv.expires_at < t ? 'invite-expired' : null;
    if (bad) { this.log(null, 'join-failed', bad); fail(bad === 'invite-unknown' ? 404 : 410, bad); }
    const dev = this.row('SELECT d.member_id, d.revoked_at, m.left_at FROM devices d JOIN members m ON m.id = d.member_id WHERE d.key = ?', v.key);
    if (dev && !dev.revoked_at && !dev.left_at) fail(409, 'already-member');
    const id = await keyId(v.key);
    this.sql.exec('UPDATE invites SET used_by = ?, used_at = ? WHERE hash = ?', id, t, inv.hash);
    // someone who left and comes back with the same key is the same member again (an ordinary member: roles don't come back)
    this.sql.exec(`INSERT INTO members (id, name, joined_at) VALUES (?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, joined_at = excluded.joined_at, left_at = NULL, role = 'member'`, id, name, t);
    this.sql.exec(`INSERT INTO devices (key, member_id, added_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET member_id = excluded.member_id, added_at = excluded.added_at, revoked_at = NULL`, v.key, id, t);
    this.log(id, 'join', `by ${inv.created_by}`);
    return { status: 201, body: { team: this.teamOut(), me: this.meOut(id) }, send: this.membersFan() };
  }

  async me(req) {
    const m = await this.member(req);
    return { status: 200, body: { team: this.teamOut(), me: this.meOut(m.id), members: this.membersOut(), policy: this.policyOut() } };
  }
  membersOut() {
    return this.rows('SELECT id, name, role, joined_at FROM members WHERE left_at IS NULL ORDER BY joined_at')
      .map((r) => ({ id: r.id, name: r.name, role: r.role === 'admin' ? 'admin' : 'member', joinedAt: r.joined_at }));
  }
  // (owner: an admin. The name is older than admins, and offices from before them read it.)
  meOut(id) {
    const m = this.row('SELECT id, name, role FROM members WHERE id = ? AND left_at IS NULL', id);
    return m ? { id: m.id, name: m.name, role: m.role === 'admin' ? 'admin' : 'member', owner: m.role === 'admin' } : null;
  }
  /** Everyone's list of who is in the team and who is an admin, after it changed: [{ to, msg }]. */
  membersFan() { const list = this.membersOut(); return list.map((m) => ({ to: m.id, msg: { t: 'members', list, me: this.meOut(m.id) } })); }

  /* ---------- admins ----------
     The creator is the first admin. An admin invites people, makes another member an admin, removes members, and
     changes the team's settings. Nobody can take an admin away but that admin (stepping down), and the last admin
     can't step down or leave while there are other members: someone must still be able to invite. */
  isAdmin(memberId) { return !!this.row("SELECT 1 AS x FROM members WHERE id = ? AND role = 'admin' AND left_at IS NULL", memberId); }
  admins() { return this.row("SELECT COUNT(*) AS n FROM members WHERE role = 'admin' AND left_at IS NULL").n; }
  target(b) { const t = typeof b.member === 'string' ? this.row('SELECT id, name, role FROM members WHERE id = ? AND left_at IS NULL', b.member) : null; return t || fail(404, 'no-member'); }
  async promote(req) {
    const m = await this.member(req), b = this.body(req);
    if (!this.isAdmin(m.id)) fail(403, 'not-owner');
    const t = this.target(b);
    if (t.role === 'admin') fail(409, 'already-admin');
    this.sql.exec("UPDATE members SET role = 'admin' WHERE id = ?", t.id);
    this.log(m.id, 'promote', t.id);
    return { status: 200, body: { members: this.membersOut(), me: this.meOut(m.id) }, send: this.membersFan() };
  }
  async stepDown(req) {
    const m = await this.member(req);
    if (!this.isAdmin(m.id)) fail(409, 'not-admin');
    if (this.admins() <= 1) fail(409, 'last-admin');
    this.sql.exec("UPDATE members SET role = 'member' WHERE id = ?", m.id);
    this.log(m.id, 'stepdown');
    return { status: 200, body: { members: this.membersOut(), me: this.meOut(m.id) }, send: this.membersFan() };
  }
  async remove(req) {
    const m = await this.member(req), b = this.body(req);
    if (!this.isAdmin(m.id)) fail(403, 'not-owner');
    const t = this.target(b);
    if (t.id === m.id) fail(409, 'remove-self');   // (leave instead)
    if (t.role === 'admin') fail(403, 'is-admin');   // (only an admin takes themselves away)
    const send = this.drop(t.id);
    this.log(m.id, 'remove', t.id);
    return { status: 200, body: { members: this.membersOut(), me: this.meOut(m.id) }, left: t.id, send: [...send, ...this.membersFan()] };
  }

  /* ---------- the team's settings ----------
     details: whether open rooms may show file names and commands. Off by default; only admins change it. */
  policyOut() { return { details: this.meta('policy_details') === '1' }; }
  async policy(req) {
    const m = await this.member(req), b = this.body(req);
    if (!this.isAdmin(m.id)) fail(403, 'not-owner');
    if (typeof b.details !== 'boolean') fail(400, 'bad-request');
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', 'policy_details', b.details ? '1' : '0');
    this.log(m.id, 'policy', `details=${b.details}`);
    return { status: 200, body: { policy: this.policyOut() }, policy: this.policyOut() };
  }

  /* ---------- the relay ----------
     The Durable Object (team.js) owns the sockets; these work out what to tell whom, as [{ to: member id, msg }]: a
     closed room looks different to someone it has let in (step 4), so every viewer gets their own copy. */
  async authWs(req) {
    const u = new URL(req.path, 'http://hub');
    return this.member({ ...req, path: u.pathname, body: '', headers: wsHeaders(u.searchParams) });
  }
  members() { return this.rows('SELECT id, name FROM members WHERE left_at IS NULL ORDER BY joined_at'); }
  saved(id) {
    this.live ||= new Map();
    if (!this.live.has(id)) {
      const r = this.row('SELECT data, at FROM rooms WHERE member_id = ?', id);
      this.live.set(id, r ? { room: JSON.parse(r.data), at: r.at, savedAt: r.at } : null);
    }
    return this.live.get(id);
  }
  /** A member's room as `viewer` may see it: everyone sees an open room; a closed one shows its people (and when the
   *  viewer's access ends) only to a viewer it has let in. */
  roomOut(member, online, viewer = null) {
    const base = { member: { id: member.id, name: member.name }, online: !!online };
    const r = online ? this.saved(member.id) : null;
    const g = viewer && r?.room.mode !== 'open' ? this.grantOf(member.id, viewer) : null;
    const access = g ? { access: { until: g.until } } : {};
    if (!r) return { ...base, mode: 'closed', counts: { work: 0, rest: 0, wait: 0 }, ...access };
    return { ...base, ...(g && r.full ? r.full : r.room), at: r.at, ...access };
  }
  viewers(except) { return this.members().filter((v) => v.id !== except && this.online(v.id)); }
  // a member's room, to each other member online, as each may see it
  fanRoom(m, online = this.online(m.id), only = null) {
    return this.viewers(m.id).filter((v) => !only || only.includes(v.id)).map((v) => ({ to: v.id, msg: { t: 'room', room: this.roomOut(m, online, v.id) } }));
  }
  /** What a member gets when it connects: who it is, the team's settings, every other member's room as it may see it,
   *  who may watch its own room, who is knocking, and the knocks it is waiting on. */
  hello(viewerId, online) {
    const me = this.members().find((m) => m.id === viewerId);
    return { t: 'hello', team: this.teamOut(), me: me ? this.meOut(me.id) : null, policy: this.policyOut(), members: this.membersOut(),
      rooms: this.members().filter((m) => m.id !== viewerId).map((m) => this.roomOut(m, online(m.id), viewerId)),
      grants: this.grantsOut(viewerId), knocks: this.knocksOut(viewerId), asks: this.asksOut(viewerId) };
  }
  /** A member came online or went offline: [{ to, msg }]. */
  presenceOut(memberId, online) {
    const m = this.members().find((x) => x.id === memberId);
    return m ? this.fanRoom(m, online) : [];
  }
  /** A message from a member's socket. Returns what to pass on to everyone else ([] for nothing). */
  ingest(memberId, text) {
    if (typeof text !== 'string' || text.length > MSG_MAX) return [];
    let msg; try { msg = JSON.parse(text); } catch { return []; }
    const m = this.members().find((x) => x.id === memberId);
    if (!m || !msg || typeof msg !== 'object') return [];
    const { details } = this.policyOut(), t = this.now();
    if (msg.t === 'room') {
      // a closed room's people are kept only while someone is let in, only in memory, and only for those people
      const share = this.sharing(memberId), clean = cleanRoom(msg.room, { details, share });
      if (!clean) return [];
      const room = clean.mode === 'open' ? clean : { mode: clean.mode, counts: clean.counts };
      const full = clean.mode !== 'open' && share && clean.people ? clean : null;
      const prev = this.saved(memberId);
      const changed = !prev || JSON.stringify(prev.room) !== JSON.stringify(room) || JSON.stringify(prev.full || null) !== JSON.stringify(full);
      const entry = { room, full, at: t, savedAt: prev?.savedAt || 0 };
      if (t - entry.savedAt >= ROOM_SAVE_MS || (changed && prev?.room.mode !== room.mode)) {
        this.sql.exec('INSERT INTO rooms (member_id, data, at) VALUES (?, ?, ?) ON CONFLICT (member_id) DO UPDATE SET data = excluded.data, at = excluded.at', memberId, JSON.stringify(room), t);
        entry.savedAt = t;
      }
      this.live.set(memberId, entry);
      return changed ? this.fanRoom(m, true) : [];
    }
    if (msg.t === 'ev') {
      // an open room's events go to everyone; a closed room's only to whoever it has let in
      const r = this.saved(memberId);
      if (!r) return [];
      const open = r.room.mode === 'open';
      if (!open && !this.sharing(memberId)) return [];
      const list = cleanEvents(msg.list, { details });
      if (!list.length) return [];
      return this.viewers(memberId).filter((v) => open || this.grantOf(memberId, v.id)).map((v) => ({ to: v.id, msg: { t: 'ev', member: memberId, list } }));
    }
    return [];
  }

  async leave(req) {
    const m = await this.member(req);
    if (m.role === 'admin' && this.admins() <= 1 && this.members().length > 1) fail(409, 'last-admin');   // (make someone else an admin first)
    const send = this.drop(m.id);
    this.log(m.id, 'leave');
    return { status: 200, body: { ok: true }, left: m.id, send: [...send, ...this.membersFan()] };
  }
  // a member gone (left, or removed by an admin): no devices, no grants either way, no room. Returns who to tell what.
  drop(id) {
    const t = this.now();
    const hosts = this.rows('SELECT room FROM grants WHERE viewer = ?', id).map((r) => r.room);   // rooms that had let them in
    this.sql.exec('UPDATE members SET left_at = ? WHERE id = ?', t, id);
    this.sql.exec('UPDATE devices SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL', t, id);
    this.sql.exec('DELETE FROM grants WHERE room = ? OR viewer = ?', id, id);
    this.sql.exec('DELETE FROM knocks WHERE room = ? OR viewer = ?', id, id);
    this.sql.exec('DELETE FROM view_codes WHERE room = ?', id);
    this.sql.exec('DELETE FROM access_log WHERE room = ?', id);
    this.sql.exec('DELETE FROM rooms WHERE member_id = ?', id);
    this.live?.delete(id);
    return hosts.map((h) => ({ to: h, msg: { t: 'grants', list: this.grantsOut(h) } }));
  }

  /* ---------- closed rooms: who may watch (step 4) ----------
     A closed room shows only how many are in. Its owner can let someone in: by answering their knock (for an hour,
     until the end of the owner's day, or always: the trusted list), or with a one-time view code (an hour). The owner
     sees who is let in and can take it back; every step is in the room's access log. Admins have no say
     over anyone else's room. */
  grantOf(room, viewer) {
    const g = this.row('SELECT expires_at FROM grants WHERE room = ? AND viewer = ?', room, viewer);
    return g && (g.expires_at === null || g.expires_at > this.now()) ? { until: g.expires_at } : null;
  }
  sharing(room) { return !!this.row('SELECT 1 AS x FROM grants WHERE room = ? AND (expires_at IS NULL OR expires_at > ?)', room, this.now()); }
  grantsOut(room) {
    return this.rows(`SELECT g.viewer, m.name, g.expires_at, g.created_at FROM grants g JOIN members m ON m.id = g.viewer
      WHERE g.room = ? AND m.left_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?) ORDER BY g.created_at`, room, this.now())
      .map((r) => ({ viewer: { id: r.viewer, name: r.name }, until: r.expires_at, since: r.created_at }));
  }
  knocksOut(room) {
    return this.rows(`SELECT k.viewer, m.name, k.at FROM knocks k JOIN members m ON m.id = k.viewer
      WHERE k.room = ? AND m.left_at IS NULL AND k.at > ? ORDER BY k.at`, room, this.now() - KNOCK_TTL_MS)
      .map((r) => ({ viewer: { id: r.viewer, name: r.name }, at: r.at }));
  }
  asksOut(viewer) {
    return this.rows('SELECT room, at FROM knocks WHERE viewer = ? AND at > ?', viewer, this.now() - KNOCK_TTL_MS).map((r) => ({ room: r.room, at: r.at }));
  }
  access(room, viewer, action, detail = '') {
    this.sql.exec('INSERT INTO access_log (at, room, viewer, action, detail) VALUES (?, ?, ?, ?, ?)', this.now(), room, viewer, action, detail);
    this.sql.exec('DELETE FROM access_log WHERE room = ? AND id NOT IN (SELECT id FROM access_log WHERE room = ? ORDER BY id DESC LIMIT ?)', room, room, LOG_KEEP);
  }
  activeMember(id) { return typeof id === 'string' ? this.row('SELECT id, name FROM members WHERE id = ? AND left_at IS NULL', id) : null; }
  // what changes for a viewer whose access to `owner`'s room changed, and for the owner
  accessChanged(owner, viewerId, state, until) {
    return [
      { to: viewerId, msg: { t: 'access', room: owner.id, state, ...(until !== undefined ? { until } : {}) } },
      ...this.fanRoom(owner, this.online(owner.id), [viewerId]),
      { to: owner.id, msg: { t: 'grants', list: this.grantsOut(owner.id) } },
      { to: owner.id, msg: { t: 'knocks', list: this.knocksOut(owner.id) } },
    ];
  }
  setGrant(room, viewer, until) {
    this.sql.exec(`INSERT INTO grants (room, viewer, created_at, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (room, viewer) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at`, room, viewer, this.now(), until);
  }

  async knock(req) {
    const me = await this.member(req), b = this.body(req), t = this.now(), owner = this.activeMember(b.room);
    if (!owner || owner.id === me.id) fail(404, 'no-room');
    if (this.saved(owner.id)?.room.mode === 'open') fail(409, 'room-open');
    if (this.grantOf(owner.id, me.id)) fail(409, 'already-allowed');
    const waiting = this.row('SELECT at FROM knocks WHERE room = ? AND viewer = ? AND at > ?', owner.id, me.id, t - KNOCK_TTL_MS);
    if (waiting) return { status: 200, body: { knock: { room: owner.id, at: waiting.at } } };   // (already waiting: no second ring)
    const recent = this.row('SELECT COUNT(*) AS n FROM access_log WHERE viewer = ? AND action = ? AND at > ?', me.id, 'knock', t - ACCESS_WINDOW).n;
    if (recent >= KNOCKS_MAX) fail(429, 'too-many-knocks');
    this.sql.exec('INSERT INTO knocks (room, viewer, at) VALUES (?, ?, ?) ON CONFLICT (room, viewer) DO UPDATE SET at = excluded.at', owner.id, me.id, t);
    this.access(owner.id, me.id, 'knock');
    return { status: 201, body: { knock: { room: owner.id, at: t } },
      send: [{ to: owner.id, msg: { t: 'knock', knock: { viewer: { id: me.id, name: me.name }, at: t } } }, { to: owner.id, msg: { t: 'knocks', list: this.knocksOut(owner.id) } }] };
  }

  async answer(req) {
    const me = await this.member(req), b = this.body(req), t = this.now(), viewer = this.activeMember(b.viewer);
    if (!viewer || (b.grant !== 'no' && !GRANTS.has(b.grant))) fail(400, 'bad-request');
    if (!this.row('SELECT 1 AS x FROM knocks WHERE room = ? AND viewer = ? AND at > ?', me.id, viewer.id, t - KNOCK_TTL_MS)) fail(404, 'no-knock');
    this.sql.exec('DELETE FROM knocks WHERE room = ? AND viewer = ?', me.id, viewer.id);
    if (b.grant === 'no') {
      this.access(me.id, viewer.id, 'deny');
      return { status: 200, body: { grants: this.grantsOut(me.id), knocks: this.knocksOut(me.id) }, send: this.accessChanged(me, viewer.id, 'denied') };
    }
    const until = grantUntil(b.grant, t, b.dayEnd);
    this.setGrant(me.id, viewer.id, until);
    this.access(me.id, viewer.id, 'grant', b.grant);
    return { status: 200, body: { grants: this.grantsOut(me.id), knocks: this.knocksOut(me.id) }, send: this.accessChanged(me, viewer.id, 'granted', until), alarm: true };
  }

  async revoke(req) {
    const me = await this.member(req), b = this.body(req), viewer = this.activeMember(b.viewer);
    if (!viewer) fail(400, 'bad-request');
    if (!this.row('SELECT 1 AS x FROM grants WHERE room = ? AND viewer = ?', me.id, viewer.id)) fail(404, 'no-grant');
    this.sql.exec('DELETE FROM grants WHERE room = ? AND viewer = ?', me.id, viewer.id);
    this.access(me.id, viewer.id, 'revoke');
    return { status: 200, body: { grants: this.grantsOut(me.id) }, send: this.accessChanged(me, viewer.id, 'revoked') };
  }

  async viewCode(req) {
    const me = await this.member(req), t = this.now();
    const open = this.row('SELECT COUNT(*) AS n FROM view_codes WHERE room = ? AND used_at IS NULL AND expires_at > ?', me.id, t).n;
    if (open >= MAX_OPEN_VIEW_CODES) fail(429, 'too-many-codes');
    this.sql.exec('DELETE FROM view_codes WHERE expires_at < ?', t - 24 * 3600_000);
    const code = makeInviteCode(), expiresAt = t + VIEW_CODE_TTL_MS;
    this.sql.exec('INSERT INTO view_codes (hash, room, created_at, expires_at) VALUES (?, ?, ?, ?)', await hashViewCode(this.meta('team_id'), code), me.id, t, expiresAt);
    this.access(me.id, null, 'code');
    return { status: 201, body: { code, expiresAt } };
  }

  async redeem(req) {
    const me = await this.member(req), b = this.body(req), t = this.now();
    const fails = this.row('SELECT COUNT(*) AS n FROM access_log WHERE viewer = ? AND action = ? AND at > ?', me.id, 'redeem-failed', t - ACCESS_WINDOW).n;
    if (fails >= REDEEM_FAILS_MAX) fail(429, 'redeem-paused');
    if (!isInviteCode(b.code)) fail(400, 'bad-request');
    const vc = this.row('SELECT * FROM view_codes WHERE hash = ?', await hashViewCode(this.meta('team_id'), normalizeCode(b.code)));
    const owner = vc ? this.activeMember(vc.room) : null;
    const bad = !vc || !owner ? 'code-unknown' : vc.used_at ? 'code-used' : vc.expires_at < t ? 'code-expired' : vc.room === me.id ? 'own-room' : null;
    if (bad) { this.access(owner?.id || '-', me.id, 'redeem-failed', bad); fail(bad === 'code-unknown' ? 404 : bad === 'own-room' ? 409 : 410, bad); }
    this.sql.exec('UPDATE view_codes SET used_by = ?, used_at = ? WHERE hash = ?', me.id, t, vc.hash);
    const had = this.grantOf(owner.id, me.id), until = had && (had.until === null || had.until > t + CODE_GRANT_MS) ? had.until : t + CODE_GRANT_MS;
    this.setGrant(owner.id, me.id, until);
    this.sql.exec('DELETE FROM knocks WHERE room = ? AND viewer = ?', owner.id, me.id);
    this.access(owner.id, me.id, 'redeem');
    return { status: 200, body: { room: { id: owner.id, name: owner.name }, until }, send: this.accessChanged(owner, me.id, 'granted', until), alarm: true };
  }

  /** For a room's owner: who is let in, who is knocking, and the room's access log (newest first). */
  async accessOut(req) {
    const me = await this.member(req);
    const log = this.rows(`SELECT a.at, a.viewer, m.name, a.action, a.detail FROM access_log a LEFT JOIN members m ON m.id = a.viewer
      WHERE a.room = ? ORDER BY a.id DESC LIMIT ?`, me.id, LOG_OUT).map((r) => ({ at: r.at, viewer: r.viewer ? { id: r.viewer, name: r.name || '' } : null, action: r.action, detail: r.detail || '' }));
    return { status: 200, body: { grants: this.grantsOut(me.id), knocks: this.knocksOut(me.id), log } };
  }

  /** The next time a grant runs out (for the Durable Object's alarm), or null. */
  nextExpiry() {
    if (!this.ready) return null;
    return this.row('SELECT MIN(expires_at) AS t FROM grants WHERE expires_at IS NOT NULL AND expires_at > ?', this.now())?.t ?? null;
  }
  /** Grants that ran out: gone, logged, and both sides told. Returns [{ to, msg }]. */
  expire() {
    if (!this.ready) return [];
    const done = this.rows('SELECT room, viewer FROM grants WHERE expires_at IS NOT NULL AND expires_at <= ?', this.now());
    const out = [];
    for (const g of done) {
      this.sql.exec('DELETE FROM grants WHERE room = ? AND viewer = ?', g.room, g.viewer);
      const owner = this.activeMember(g.room);
      if (!owner || !this.activeMember(g.viewer)) continue;
      this.access(g.room, g.viewer, 'expired');
      out.push(...this.accessChanged(owner, g.viewer, 'expired'));
    }
    return out;
  }

  teamOut() { return { id: this.meta('team_id'), name: this.meta('name') }; }
}
