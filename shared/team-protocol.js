// The team protocol, shared by this computer's server (server/team/) and the team hub (hub/): keys, signed requests,
// invite links and recovery keys. Only WebCrypto and plain JS, so the same file runs in Node and in Cloudflare Workers.
// The full description is in docs/features/team-mode.md.

export const PROTOCOL = 1;
export const MAX_SKEW_MS = 60_000;          // a signed request older or newer than this is refused
export const NONCE_KEEP_MS = 2 * MAX_SKEW_MS;   // how long the hub remembers a nonce (longer than any accepted request lives)
export const INVITE_TTL_MS = 60 * 60_000;   // an invite link works for anyone who has it, for an hour
export const NAME_MAX = 40;
/* closed rooms (step 4): knocking, one-time view codes, grants */
export const KNOCK_TTL_MS = 10 * 60_000;     // a knock waits for an answer this long
export const VIEW_CODE_TTL_MS = 10 * 60_000; // a view code works once, for 10 minutes
export const CODE_GRANT_MS = 3600_000;       // and lets its user watch for an hour
export const GRANTS = new Set(['hour', 'day', 'always']);   // an hour, until the end of the room owner's day, or always (trusted)

const subtle = globalThis.crypto.subtle;
const ED = { name: 'Ed25519' };
const enc = new TextEncoder();

/* ---------- base64url ---------- */
export function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const B64U_RE = /^[A-Za-z0-9_-]+$/;

export async function sha256Hex(data) {
  const d = new Uint8Array(await subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const randomId = (bytes = 16) => b64u(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));

/* ---------- keys ----------
   A device's identity is an Ed25519 key pair: the public key (32 bytes, base64url) is who it is; the private key
   (PKCS#8, base64url) never leaves the device except inside a recovery key the person keeps. */
export async function generateKeys() {
  const k = await subtle.generateKey(ED, true, ['sign', 'verify']);
  return {
    publicKey: b64u(await subtle.exportKey('raw', k.publicKey)),
    privateKey: b64u(await subtle.exportKey('pkcs8', k.privateKey)),
  };
}
export const importPrivate = (pkcs8) => subtle.importKey('pkcs8', unb64u(pkcs8), ED, false, ['sign']);
export function importPublic(raw) {
  const b = unb64u(raw);
  if (b.length !== 32) throw new Error('bad-key');
  return subtle.importKey('raw', b, ED, false, ['verify']);
}
export const isPublicKey = (s) => typeof s === 'string' && s.length === 43 && B64U_RE.test(s);
// a short, stable id for a key: what the hub calls a member
export const keyId = async (publicKey) => (await sha256Hex(publicKey)).slice(0, 16);

/* ---------- signed requests ----------
   The signed text is the method, the path (with its query), the time, a nonce and the body's hash, one per line, so
   none of them can be changed or the request replayed elsewhere. The hub refuses a time more than MAX_SKEW_MS away
   and a nonce it has already seen. */
export const HEADERS = { key: 'x-office-key', ts: 'x-office-ts', nonce: 'x-office-nonce', sig: 'x-office-sig', v: 'x-office-protocol' };
const signedText = async ({ method, path, ts, nonce, body }) => [String(method).toUpperCase(), path, ts, nonce, await sha256Hex(body || '')].join('\n');

/** Headers for a request signed with this device's keys ({ publicKey, privateKey }). */
export async function signRequest(keys, { method, path, body = '', now = Date.now() }) {
  const ts = String(now), nonce = randomId(12);
  const key = keys.signer || await importPrivate(keys.privateKey);
  const sig = b64u(await subtle.sign(ED, key, enc.encode(await signedText({ method, path, ts, nonce, body }))));
  return { [HEADERS.key]: keys.publicKey, [HEADERS.ts]: ts, [HEADERS.nonce]: nonce, [HEADERS.sig]: sig, [HEADERS.v]: String(PROTOCOL) };
}

/** Checks a signed request. `headers` is anything with get(name) (a Headers object) or a plain object of lowercase names.
    Returns { ok: true, key, ts, nonce } or { ok: false, why }. Replays (a nonce seen before) are the caller's to check. */
export async function verifyRequest({ method, path, body = '', headers, now = Date.now(), maxSkew = MAX_SKEW_MS }) {
  const get = (n) => (typeof headers?.get === 'function' ? headers.get(n) : headers?.[n]) ?? null;
  const key = get(HEADERS.key), ts = get(HEADERS.ts), nonce = get(HEADERS.nonce), sig = get(HEADERS.sig);
  if (!key || !ts || !nonce || !sig) return { ok: false, why: 'unsigned' };
  if (!isPublicKey(key) || !B64U_RE.test(sig) || !/^\d{10,16}$/.test(ts) || !/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return { ok: false, why: 'bad-signature' };
  if (Math.abs(now - Number(ts)) > maxSkew) return { ok: false, why: 'clock' };
  let good = false;
  try { good = await subtle.verify(ED, await importPublic(key), unb64u(sig), enc.encode(await signedText({ method, path, ts, nonce, body }))); } catch { good = false; }
  return good ? { ok: true, key, ts: Number(ts), nonce } : { ok: false, why: 'bad-signature' };
}

/* ---------- invites ----------
   An invite is one link: <hub>/j/<team id>.<code>. The code is 10 characters from an alphabet without look-alikes
   (no 0/O, 1/I/L), so it can also be read out or typed from a QR code. The hub keeps only its hash. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LEN = 10;
export function makeInviteCode() {
  const r = globalThis.crypto.getRandomValues(new Uint8Array(CODE_LEN * 2));
  let s = '';
  for (let i = 0; s.length < CODE_LEN && i < r.length; i++) if (r[i] < 248) s += CODE_ALPHABET[r[i] % CODE_ALPHABET.length];   // (248 = 8 × 31: no bias)
  return s.length === CODE_LEN ? s : makeInviteCode();
}
export const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[\s-]/g, '');
export const isInviteCode = (code) => normalizeCode(code).length === CODE_LEN && [...normalizeCode(code)].every((c) => CODE_ALPHABET.includes(c));
export const hashCode = (teamId, code) => sha256Hex(`invite\n${teamId}\n${normalizeCode(code)}`);
export const hashViewCode = (teamId, code) => sha256Hex(`view\n${teamId}\n${normalizeCode(code)}`);
/** When a grant made now ends: an hour; the end of the owner's day (`dayEnd`, from the owner's own clock, at most a
 *  day away); or null for always. Returns undefined for anything else. */
export function grantUntil(kind, now, dayEnd) {
  if (kind === 'hour') return now + 3600_000;
  if (kind === 'always') return null;
  if (kind === 'day') { const t = Number(dayEnd); return Number.isFinite(t) && t > now ? Math.min(t, now + 24 * 3600_000) : now + 3600_000; }
  return undefined;
}
export const isTeamId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);

export const hubBase = (url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error('hub-not-https');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
};
export const formatInvite = (hub, teamId, code) => `${hubBase(hub)}/j/${teamId}.${code}`;
/** { hub, teamId, code } from an invite link, or null. */
/** The invite link in a page address's query (?join=…, from the hub's invite page), or null when there is none or it isn't one. */
export function inviteFromSearch(search) {
  const link = new URLSearchParams(search).get('join');
  return link && parseInvite(link) ? link.trim() : null;
}
export function parseInvite(link) {
  try {
    const u = new URL(String(link).trim());
    const m = u.pathname.match(/^(.*)\/j\/([A-Za-z0-9_-]{22})\.([A-Za-z0-9-]+)$/);
    if (!m || !isInviteCode(m[3])) return null;
    return { hub: hubBase(`${u.protocol}//${u.host}${m[1]}`), teamId: m[2], code: normalizeCode(m[3]) };
  } catch { return null; }
}

/* ---------- recovery key ----------
   Everything needed to be this member again on a new computer: the hub, the team and the private key, in one string to
   keep in a password manager. Whoever has it IS this member, so it is shown once and never sent anywhere. */
const RECOVERY_PREFIX = 'mo-team-1.';
export const makeRecovery = ({ hub, teamId, publicKey, privateKey }) => RECOVERY_PREFIX + b64u(enc.encode(JSON.stringify({ hub, teamId, publicKey, privateKey })));
export function parseRecovery(str) {
  const s = String(str || '').trim();
  if (!s.startsWith(RECOVERY_PREFIX)) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(unb64u(s.slice(RECOVERY_PREFIX.length))));
    return o && typeof o.hub === 'string' && isTeamId(o.teamId) && isPublicKey(o.publicKey) && typeof o.privateKey === 'string' ? o : null;
  } catch { return null; }
}

/** A person's or team's name as shown to others: one line, no control characters, at most NAME_MAX characters. */
export function cleanName(name) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, NAME_MAX).join('');
}

/* ---------- the relay (step 2) ----------
   Each member's office keeps one WebSocket to the hub: it sends its own room and receives everyone else's. What a room
   shows depends on its mode, and is cut down twice: on the member's computer before anything leaves it, and again on
   the hub before it goes to anyone else.
     closed (the default): online or not, and how many are working / resting / waiting
     open:                 also each person: status, project, job title, subagents, the KIND of thing being done
   A file name or command (the event's label) is added only while the team's "details" setting is on (only the team's
   creator can turn it on). Prompts, conversation titles, answers, folders, pids and costs never leave the computer,
   with one exception the room's owner chooses for their own room (off by default): "let others read my sessions'
   conversations" (log). Then someone allowed to see the room may ask for one session's recent conversation; the owner's
   computer answers that one viewer, through the hub, which passes it on and keeps none of it (cleanLog). */
export const RELAY_BATCH_MS = 1500;      // changes are sent at most this often
export const RELAY_BEAT_MS = 60_000;     // the whole room is sent again this often (the hub saves it from this)
export const MSG_MAX = 32 * 1024;
export const LOG_MSG_MAX = 192 * 1024;   // (a conversation going back to whoever asked for it: the one bigger message)
export const LOG_ITEMS = 60, LOG_TEXT_MAX = 1500;
export const LOG_REQ_MS = 3000;          // one request per viewer per room this often
export const LOG_WAIT_MS = 8000;         // how long the viewer waits for the owner's computer
export const MODES = new Set(['open', 'closed']);
export const STATUSES = new Set(['work', 'rest', 'wait']);
export const EVENT_TYPES = new Set(['agent', 'ask', 'bash', 'ci', 'command', 'commit', 'compact', 'deploy', 'edit', 'end', 'fail', 'fetch', 'glob',
  'grep', 'idle', 'interrupt', 'mcp', 'other', 'plan', 'prompt', 'push', 'read', 'skill', 'start', 'stop', 'substart', 'substop', 'test',
  'testfail', 'testok', 'wait', 'web', 'write']);
const PEOPLE_MAX = 60, EVENTS_MAX = 50, LABEL_MAX = 80;
const int = (n, max = 1e6) => (Number.isFinite(+n) ? Math.min(max, Math.max(0, Math.round(+n))) : 0);
const label = (s) => [...String(s ?? '').replace(/\s+/g, ' ').trim()].slice(0, LABEL_MAX).join('');
const evType = (t) => (EVENT_TYPES.has(t) ? t : 'other');
const statusOf = (s) => (STATUSES.has(s) ? s : 'rest');
export const isOpaqueId = (id) => typeof id === 'string' && /^[a-z0-9]{6,16}$/.test(id);

export function presence(sessions) {
  const c = { work: 0, rest: 0, wait: 0 };
  for (const s of sessions || []) c[statusOf(s?.status)]++;
  return c;
}

/** This computer's room as it may leave it. sessions: the server's public session views (server/index.mjs pub());
    idOf(sessionId): an opaque id for it; redact: masks secrets in a label. share: a closed room that someone has been
    let into (step 4) sends its people too; the hub passes them only to those people. */
export function roomView(sessions, { mode, details = false, idOf, redact = (x) => x, share = false, log = false }) {
  const m = MODES.has(mode) ? mode : 'closed', room = { mode: m, counts: presence(sessions) };
  if (m !== 'open' && !share) return room;
  if (log) room.log = true;   // (its sessions' conversations may be asked for)
  room.people = (sessions || []).slice(0, PEOPLE_MAX).map((s) => {
    const p = {
      id: idOf(s.id), status: statusOf(s.status),
      project: cleanName(s.git?.repo || String(s.dir || '').split(/[\\/]/).filter(Boolean).pop() || ''),
      role: cleanName(s.role || ''), subs: int((s.subs || []).length, 99),
      act: s.last?.type ? evType(s.last.type) : '', since: int(s.taskStart, 1e14), at: int(s.lastAt, 1e14),
    };
    if (details && s.last?.label) p.label = label(redact(s.last.label));
    return p;
  });
  return room;
}
/** One event as it may leave this computer (open rooms only). */
export function eventView(e, { details = false, idOf, redact = (x) => x }) {
  const v = { p: idOf(e.sess), type: evType(e.type), ts: int(e.ts, 1e14) };
  if (details && e.label) v.label = label(redact(e.label));
  return v;
}

/** What the hub keeps and passes on from what a member sent: every field checked and clipped, and nothing a closed
    room (or the team's details setting) doesn't allow. share: the room has viewers let in, so a closed room's people
    are kept too (for them only). Returns null for anything that isn't a room. */
export function cleanRoom(raw, { details = false, share = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = MODES.has(raw.mode) ? raw.mode : 'closed', c = raw.counts || {};
  const room = { mode, counts: { work: int(c.work, 999), rest: int(c.rest, 999), wait: int(c.wait, 999) } };
  if ((mode !== 'open' && !share) || !Array.isArray(raw.people)) return room;
  if (raw.log === true) room.log = true;
  room.people = raw.people.slice(0, PEOPLE_MAX).filter((p) => p && isOpaqueId(p.id)).map((p) => {
    const o = { id: p.id, status: statusOf(p.status), project: cleanName(p.project), role: cleanName(p.role), subs: int(p.subs, 99),
      act: p.act ? evType(p.act) : '', since: int(p.since, 1e14), at: int(p.at, 1e14) };
    if (details && p.label) o.label = label(p.label);
    return o;
  });
  return room;
}
export function cleanEvents(list, { details = false } = {}) {
  return (Array.isArray(list) ? list : []).slice(0, EVENTS_MAX).filter((e) => e && isOpaqueId(e.p)).map((e) => {
    const o = { p: e.p, type: evType(e.type), ts: int(e.ts, 1e14) };
    if (details && e.label) o.label = label(e.label);
    return o;
  });
}

/* The WebSocket's signature travels in its query (k, ts, n, sig), since a WebSocket can't carry headers everywhere. It
   signs GET and the path without that query, like any other request. */
export const wsPath = (teamId) => `/t/${teamId}/ws`;
// build: this office's version (server/updater.mjs: the count of commits on main it was built from), so the hub can hold
// back an office older than the team allows; not signed (each office only speaks for itself)
export async function signedWsUrl(keys, hub, teamId, now = Date.now(), build = 0) {
  const h = await signRequest(keys, { method: 'GET', path: wsPath(teamId), now });
  const u = new URL(hubBase(hub) + wsPath(teamId));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = new URLSearchParams({ k: h[HEADERS.key], ts: h[HEADERS.ts], n: h[HEADERS.nonce], sig: h[HEADERS.sig], v: h[HEADERS.v], ...(build > 0 ? { b: String(Math.floor(build)) } : {}) }).toString();
  return u.toString();
}
/** The signature headers carried in a WebSocket URL's query, for verifyRequest. */
export const wsHeaders = (searchParams) => ({
  [HEADERS.key]: searchParams.get('k'), [HEADERS.ts]: searchParams.get('ts'), [HEADERS.nonce]: searchParams.get('n'), [HEADERS.sig]: searchParams.get('sig'),
});

/* ---------- a session's conversation, asked for (the room's owner allows it: roomView log) ----------
   { t: 'logreq', room, p, id } viewer -> hub -> owner ({ t: 'logreq', from, p, id }); the owner answers
   { t: 'log', id, p, items } or { t: 'log', id, error } -> hub -> that viewer only ({ t: 'log', id, room, p, items | error }). */
export const LOG_ROLES = new Set(['user', 'claude', 'tool', 'note', 'summary']);
export const LOG_ERRORS = new Set(['off', 'gone', 'busy', 'timeout', 'denied']);
export const isReqId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,32}$/.test(id);
const clip = (s, n) => { const a = [...String(s ?? '')]; return a.length > n ? `${a.slice(0, n).join('')}…` : a.join(''); };
/** A conversation as it may travel: the last LOG_ITEMS items, each text at most LOG_TEXT_MAX characters, only the fields
 *  the page shows (role, text, tool type and label, time). redact masks secrets (the owner's computer does it first). */
export function cleanLog(items, redact = (x) => x) {
  return (Array.isArray(items) ? items : []).filter((it) => it && LOG_ROLES.has(it.role)).slice(-LOG_ITEMS).map((it) => {
    const o = { role: it.role, ts: int(it.ts, 1e14) };
    if (it.role === 'tool') { o.type = evType(it.type); o.label = clip(redact(String(it.label ?? '')), 300); if (it.desc) o.desc = clip(redact(String(it.desc)), 300); }
    else o.text = clip(redact(String(it.text ?? '')), LOG_TEXT_MAX);
    return o;
  });
}
