// One team's records and rules on the hub: members, their devices, invites, and the access log. It takes a SQL handle
// shaped like Cloudflare's Durable Object storage (`exec(query, ...bindings)` returning rows with toArray()), so the
// same code runs in the Worker (team.js) and in the unit tests (Node's built-in SQLite).
//
// The hub only relays: it never holds a member's code, prompts or conversations, and it has no way to send a command
// to anyone's computer.
import {
  INVITE_TTL_MS, MSG_MAX, NONCE_KEEP_MS, cleanEvents, cleanName, cleanRoom, formatInvite, hashCode, isInviteCode, keyId,
  makeInviteCode, verifyRequest, wsHeaders,
} from '../../shared/team-protocol.js';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  // role: 'member' for everyone for now; an admin role comes later (docs/features/team-mode.md)
  'CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'member\', joined_at INTEGER NOT NULL, left_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS devices (key TEXT PRIMARY KEY, member_id TEXT NOT NULL, added_at INTEGER NOT NULL, revoked_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT, used_at INTEGER)',
  // who may watch a closed room, until when (used from step 4: knocking, QR codes, the trusted list)
  'CREATE TABLE IF NOT EXISTS grants (room TEXT NOT NULL, viewer TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, PRIMARY KEY (room, viewer))',
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

export class HubError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new HubError(status, code); };

export class TeamCore {
  /** sql: { exec(query, ...bindings) -> { toArray() } }. */
  constructor(sql, { now = () => Date.now() } = {}) {
    this.sql = sql; this.now = now;
    // the tables are made only when a team is created, so a request for a team that doesn't exist writes nothing
    this.ready = this.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0;
    if (this.ready) for (const q of SCHEMA) this.sql.exec(q);   // (a team made by an older version gets the tables added since)
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
    this.sql.exec('INSERT INTO members (id, name, joined_at) VALUES (?, ?, ?)', id, name, t);
    this.sql.exec('INSERT INTO devices (key, member_id, added_at) VALUES (?, ?, ?)', v.key, id, t);
    this.log(id, 'create', team);
    return { status: 201, body: { team: { id: req.teamId, name: team }, me: { id, name, role: 'member' } } };
  }

  async invite(req) {
    const m = await this.member(req), t = this.now();
    const open = this.row('SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND used_at IS NULL AND expires_at > ?', m.id, t).n;
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
    const bad = !inv ? 'invite-unknown' : inv.used_at ? 'invite-used' : inv.expires_at < t ? 'invite-expired' : null;
    if (bad) { this.log(null, 'join-failed', bad); fail(bad === 'invite-unknown' ? 404 : 410, bad); }
    const dev = this.row('SELECT d.member_id, d.revoked_at, m.left_at FROM devices d JOIN members m ON m.id = d.member_id WHERE d.key = ?', v.key);
    if (dev && !dev.revoked_at && !dev.left_at) fail(409, 'already-member');
    const id = await keyId(v.key);
    this.sql.exec('UPDATE invites SET used_by = ?, used_at = ? WHERE hash = ?', id, t, inv.hash);
    // someone who left and comes back with the same key is the same member again
    this.sql.exec(`INSERT INTO members (id, name, joined_at) VALUES (?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, joined_at = excluded.joined_at, left_at = NULL`, id, name, t);
    this.sql.exec(`INSERT INTO devices (key, member_id, added_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET member_id = excluded.member_id, added_at = excluded.added_at, revoked_at = NULL`, v.key, id, t);
    this.log(id, 'join', `by ${inv.created_by}`);
    return { status: 201, body: { team: this.teamOut(), me: { id, name, role: 'member' } } };
  }

  async me(req) {
    const m = await this.member(req);
    const members = this.rows('SELECT id, name, role, joined_at FROM members WHERE left_at IS NULL ORDER BY joined_at')
      .map((r) => ({ id: r.id, name: r.name, role: r.role, joinedAt: r.joined_at }));
    return { status: 200, body: { team: this.teamOut(), me: { id: m.id, name: m.name, role: m.role, owner: this.isOwner(m.id) }, members, policy: this.policyOut() } };
  }

  /* ---------- the team's settings ----------
     details: whether open rooms may show file names and commands. Off by default; only the team's creator (the key the
     team was made with, kept as root_key) may change it, until there is an admin role. */
  isOwner(memberId) { return !!this.row('SELECT 1 AS x FROM devices WHERE member_id = ? AND key = ? AND revoked_at IS NULL', memberId, this.meta('root_key')); }
  policyOut() { return { details: this.meta('policy_details') === '1' }; }
  async policy(req) {
    const m = await this.member(req), b = this.body(req);
    if (!this.isOwner(m.id)) fail(403, 'not-owner');
    if (typeof b.details !== 'boolean') fail(400, 'bad-request');
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', 'policy_details', b.details ? '1' : '0');
    this.log(m.id, 'policy', `details=${b.details}`);
    return { status: 200, body: { policy: this.policyOut() }, policy: this.policyOut() };
  }

  /* ---------- the relay ----------
     The Durable Object (team.js) owns the sockets; these work out what to tell whom. online(id) says whether a member
     has a socket open now. Every message out is the same for every other member, so the caller sends it to all of
     them but its author. */
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
  roomOut(member, online) {
    const r = online ? this.saved(member.id) : null;
    return { member: { id: member.id, name: member.name }, online: !!online, ...(r ? { ...r.room, at: r.at } : { mode: 'closed', counts: { work: 0, rest: 0, wait: 0 } }) };
  }
  /** What a member gets when it connects: who it is, the team's settings, and every other member's room. */
  hello(viewerId, online) {
    const me = this.members().find((m) => m.id === viewerId);
    return { t: 'hello', team: this.teamOut(), me: me ? { id: me.id, name: me.name, owner: this.isOwner(me.id) } : null, policy: this.policyOut(),
      rooms: this.members().filter((m) => m.id !== viewerId).map((m) => this.roomOut(m, online(m.id))) };
  }
  /** A member came online or went offline. */
  presenceOut(memberId, online) {
    const m = this.members().find((x) => x.id === memberId);
    return m ? { t: 'room', room: this.roomOut(m, online) } : null;
  }
  /** A message from a member's socket. Returns what to pass on to everyone else ([] for nothing). */
  ingest(memberId, text) {
    if (typeof text !== 'string' || text.length > MSG_MAX) return [];
    let msg; try { msg = JSON.parse(text); } catch { return []; }
    const m = this.members().find((x) => x.id === memberId);
    if (!m || !msg || typeof msg !== 'object') return [];
    const { details } = this.policyOut(), t = this.now();
    if (msg.t === 'room') {
      const room = cleanRoom(msg.room, { details });
      if (!room) return [];
      const prev = this.saved(memberId), changed = !prev || JSON.stringify(prev.room) !== JSON.stringify(room);
      const entry = { room, at: t, savedAt: prev?.savedAt || 0 };
      if (t - entry.savedAt >= ROOM_SAVE_MS || (changed && prev?.room.mode !== room.mode)) {
        this.sql.exec('INSERT INTO rooms (member_id, data, at) VALUES (?, ?, ?) ON CONFLICT (member_id) DO UPDATE SET data = excluded.data, at = excluded.at', memberId, JSON.stringify(room), t);
        entry.savedAt = t;
      }
      this.live.set(memberId, entry);
      return changed ? [{ t: 'room', room: this.roomOut(m, true) }] : [];
    }
    if (msg.t === 'ev') {
      // only an open room's events go anywhere
      if (this.saved(memberId)?.room.mode !== 'open') return [];
      const list = cleanEvents(msg.list, { details });
      return list.length ? [{ t: 'ev', member: memberId, list }] : [];
    }
    return [];
  }

  async leave(req) {
    const m = await this.member(req), t = this.now();
    this.sql.exec('UPDATE members SET left_at = ? WHERE id = ?', t, m.id);
    this.sql.exec('UPDATE devices SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL', t, m.id);
    this.sql.exec('DELETE FROM grants WHERE room = ? OR viewer = ?', m.id, m.id);
    this.sql.exec('DELETE FROM rooms WHERE member_id = ?', m.id);
    this.live?.delete(m.id);
    this.log(m.id, 'leave');
    return { status: 200, body: { ok: true }, left: m.id };
  }

  teamOut() { return { id: this.meta('team_id'), name: this.meta('name') }; }
}
