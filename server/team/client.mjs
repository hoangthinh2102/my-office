// This computer's side of team mode: what it knows about its team (data/team.json) and the signed calls to the hub
// (create, invite, join, status, leave, restore). Nothing is sent to a hub until the person runs `my-office team …`.
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  PROTOCOL, cleanName, generateKeys, hubBase, makeRecovery, parseInvite, parseRecovery, signRequest,
} from '../../shared/team-protocol.js';
import { deleteKeys, displayName, loadKeys, saveKeys } from './identity.mjs';

const TIMEOUT_MS = 10_000;
// the hub's address as given, checked: an https:// URL (http only on this computer)
function hubOf(url) {
  try { return hubBase(url); } catch (e) { throw new TeamError(e.message === 'hub-not-https' ? 'hub-not-https' : 'bad-hub-url'); }
}

// the end of today on this computer's clock (a grant "for the rest of the day")
export function endOfDay(now = new Date()) {
  const d = new Date(now); d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export class TeamError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}

export function createTeamClient({ dataDir, fetch = globalThis.fetch }) {
  const STATE = path.join(dataDir, 'team.json');

  async function readState() { try { return JSON.parse(await fsp.readFile(STATE, 'utf8')); } catch { return null; } }
  async function writeState(s) {
    await fsp.mkdir(dataDir, { recursive: true });
    const tmp = `${STATE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, STATE);
  }
  async function forget(s) { if (s) await deleteKeys(dataDir, s.keyStore); await fsp.rm(STATE, { force: true }); }

  async function call(hub, keys, method, route, body, extra = {}) {
    const text = body == null ? '' : JSON.stringify(body);
    const url = new URL(hubOf(hub) + route);
    const headers = { ...(await signRequest(keys, { method, path: url.pathname + url.search, body: text })), ...extra };
    if (text) headers['content-type'] = 'application/json';
    let res;
    try { res = await fetch(url, { method, headers, body: text || undefined, signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch { throw new TeamError('hub-unreachable'); }
    let out = null;
    try { out = await res.json(); } catch { /* not JSON: not a hub */ }
    if (!out) throw new TeamError('not-a-hub', res.status);
    if (!res.ok) throw new TeamError(out.error || 'hub-error', res.status);
    return out;
  }
  async function current() {
    const s = await readState();
    if (!s) throw new TeamError('no-team');
    const keys = await loadKeys(dataDir, s.keyStore);
    if (!keys) throw new TeamError('no-key');
    return { s, keys };
  }
  async function hubCall(method, action, body) {
    const { s, keys } = await current();
    return call(s.hub, keys, method, `/t/${s.teamId}/${action}`, method === 'GET' ? null : body);
  }
  async function notInTeam() { if (await readState()) throw new TeamError('already-in-team'); }
  // keep what the hub said about us, with the keys stored where this computer keeps them
  async function settle({ hub, keys, team, me }) {
    const keyStore = await saveKeys(dataDir, keys);
    const s = { protocol: PROTOCOL, hub: hubOf(hub), teamId: team.id, teamName: team.name, memberId: me.id, name: me.name, publicKey: keys.publicKey, keyStore, room: { mode: 'closed' }, joinedAt: Date.now() };
    await writeState(s);
    return s;
  }

  return {
    readState,

    /** A new team on `hub`, with this computer as its first member. Returns { state, recovery }. */
    async create({ hub, team, name, token }) {
      await notInTeam();
      if (!cleanName(team)) throw new TeamError('bad-team-name');
      const keys = await generateKeys();
      const out = await call(hub, keys, 'POST', '/teams', { team: cleanName(team), name: cleanName(name || await displayName()) }, token ? { 'x-create-token': String(token) } : {});
      const state = await settle({ hub, keys, ...out });
      return { state, recovery: makeRecovery({ hub: state.hub, teamId: state.teamId, ...keys }) };
    },

    /** An invite link, good for anyone who has it for an hour: { invite, code, expiresAt }. */
    async invite() {
      const { s, keys } = await current();
      return call(s.hub, keys, 'POST', `/t/${s.teamId}/invites`, {});
    },

    async join({ link, name }) {
      await notInTeam();
      const inv = parseInvite(link);
      if (!inv) throw new TeamError('bad-invite');
      const keys = await generateKeys();
      const out = await call(inv.hub, keys, 'POST', `/t/${inv.teamId}/join`, { code: inv.code, name: cleanName(name || await displayName()) });
      return settle({ hub: inv.hub, keys, ...out });
    },

    /** { state, team, me, members } from the hub. */
    async status() {
      const { s, keys } = await current();
      const out = await call(s.hub, keys, 'GET', `/t/${s.teamId}/me`);
      if (out.team?.name && out.team.name !== s.teamName) await writeState({ ...s, teamName: out.team.name });
      return { state: s, ...out };
    },

    /** Leaves the team on the hub, then forgets it here. `local` forgets it here even when the hub can't be reached. */
    async leave({ local = false } = {}) {
      const s = await readState();
      if (!s) throw new TeamError('no-team');
      const keys = await loadKeys(dataDir, s.keyStore);
      if (keys) {
        try { await call(s.hub, keys, 'POST', `/t/${s.teamId}/leave`, {}); } catch (e) {
          // already gone from the team on the hub: nothing left to do there
          if (!(e instanceof TeamError) || !(['not-member', 'no-team'].includes(e.code) || local)) throw e;
        }
      }
      await forget(s);
    },

    /** Opens or closes this computer's room (the relay picks it up from team.json). */
    async setRoom(mode) {
      if (!['open', 'closed'].includes(mode)) throw new TeamError('bad-mode');
      const s = await readState();
      if (!s) throw new TeamError('no-team');
      await writeState({ ...s, room: { ...(s.room || {}), mode } });
    },
    /** Stops (or starts again) sending anything to the hub: the room shows as offline. */
    async setPaused(paused) {
      const s = await readState();
      if (!s) throw new TeamError('no-team');
      await writeState({ ...s, paused: !!paused });
    },
    /** The team's settings; only admins may change them. */
    async setPolicy({ details }) {
      const { s, keys } = await current();
      return (await call(s.hub, keys, 'POST', `/t/${s.teamId}/policy`, { details: !!details })).policy;
    },

    // Admins: the team's creator is the first; admins make others admins and take members (never admins) out.
    /** Makes `member` an admin: { members, me }. */
    async promote(member) { return hubCall('POST', 'promote', { member: String(member || '') }); },
    /** Stops being an admin (not the last one): { members, me }. */
    async stepDown() { return hubCall('POST', 'stepdown', {}); },
    /** Takes `member` out of the team: { members, me }. */
    async remove(member) { return hubCall('POST', 'remove', { member: String(member || '') }); },

    // Closed rooms (step 4): knocking on someone's door, answering knocks on yours, view codes, who may look in.
    /** Asks to see `room`'s closed room. */
    async knock(room) { return hubCall('POST', 'knock', { room: String(room || '') }); },
    /** Answers a knock on this room: grant 'no' | 'hour' | 'day' | 'always'; 'day' ends at `dayEnd` (this computer's midnight). */
    async answer({ viewer, grant, dayEnd = endOfDay() }) { return hubCall('POST', 'answer', { viewer: String(viewer || ''), grant, dayEnd }); },
    async revoke(viewer) { return hubCall('POST', 'revoke', { viewer: String(viewer || '') }); },
    /** A one-time code to see this room: { code, expiresAt }. */
    async viewCode() { return hubCall('POST', 'code', {}); },
    /** Uses someone's view code: { room: { id, name }, until }. */
    async redeem(code) { return hubCall('POST', 'redeem', { code: String(code || '') }); },
    /** Who may see this room, who is knocking, and its access log. */
    async access() { return hubCall('GET', 'access'); },

    /** Becomes the member a recovery key belongs to, on this computer. */
    async restore({ recovery }) {
      await notInTeam();
      const r = parseRecovery(recovery);
      if (!r) throw new TeamError('bad-recovery');
      const keys = { publicKey: r.publicKey, privateKey: r.privateKey };
      const out = await call(r.hub, keys, 'GET', `/t/${r.teamId}/me`);
      return settle({ hub: r.hub, keys, team: out.team, me: out.me });
    },
  };
}
