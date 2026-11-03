// The team protocol, shared by this computer's server (server/team/) and the team hub (hub/): keys, signed requests,
// invite links and recovery keys. Only WebCrypto and plain JS, so the same file runs in Node and in Cloudflare Workers.
// The full description is in docs/features/team-mode.md.

export const PROTOCOL = 1;
export const MAX_SKEW_MS = 60_000;          // a signed request older or newer than this is refused
export const NONCE_KEEP_MS = 2 * MAX_SKEW_MS;   // how long the hub remembers a nonce (longer than any accepted request lives)
export const INVITE_TTL_MS = 15 * 60_000;   // an invite works once, for 15 minutes
export const NAME_MAX = 40;

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
export const isTeamId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);

export const hubBase = (url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error('hub-not-https');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
};
export const formatInvite = (hub, teamId, code) => `${hubBase(hub)}/j/${teamId}.${code}`;
/** { hub, teamId, code } from an invite link, or null. */
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
