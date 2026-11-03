// Team mode's relay (docs/features/team-mode.md): one WebSocket from this office to the team hub. Up goes this
// computer's room, cut down to what its mode allows (shared/team-protocol.js roomView), at most every 1.5 s and only
// when it changed; down come everyone else's rooms, kept here for the page (GET /api/team).
//
// A closed room sends only counts, unless its owner let someone in (a knock answered, a view code used): then it sends
// its people too, and the hub passes them on only to those let in (hub/src/core.js).
//
// It runs only while this computer is in a team (data/team.json) and not paused; it re-reads that file when it changes
// (my-office team room / pause / resume / leave), so those take effect without a restart.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RELAY_BATCH_MS, RELAY_BEAT_MS, eventView, roomView, signedWsUrl } from '../../shared/team-protocol.js';
import { loadKeys } from './identity.mjs';

const BACKOFF = [2_000, 5_000, 10_000, 30_000, 60_000];
const EVENTS_KEEP = 50;
const ANSWER_KEEP_MS = 10 * 60_000;   // how long the page shows "refused" / "ended" on a room you knocked on

/**
 * dataDir: the office's data folder; sessions(): the server's public session views (pub());
 * redact: masks secrets in a label; log: one line to the server log; WebSocket: the client class (Node 22's global);
 * onChange(state): what the page shows changed (at most once a second), for the server to pass on to its pages.
 */
export function createRelay({ dataDir, sessions, redact = (x) => x, log = () => {}, onChange = () => {}, WebSocket = globalThis.WebSocket, now = () => Date.now() }) {
  const STATE = path.join(dataDir, 'team.json');
  const salt = crypto.randomBytes(16);   // (a session's id here becomes another, unguessable one on the hub, new each run)
  const idOf = (id) => crypto.createHmac('sha256', salt).update(String(id)).digest('hex').replace(/[^a-z0-9]/g, '').slice(0, 12);
  let team = null, ws = null, retry = 0, retryTimer = null, batchTimer = null, beatTimer = null, stopped = true;
  let dirty = false, lastSent = '', events = [], policy = { details: false }, me = null, connected = false, why = '';
  const rooms = new Map();   // member id -> room as the hub sent it
  // closed rooms: who may see mine (grants), who is knocking on mine (knocks), rooms I knocked on (asks),
  // and the last answer about rooms I asked to see (answers: room -> { state, until, at })
  let grants = [], knocks = [];
  const asks = new Map(), answers = new Map();
  const sharing = () => grants.some((g) => g.until == null || g.until > now());
  let changeTimer = null;
  const changed = () => {
    if (changeTimer) return;
    changeTimer = setTimeout(() => { changeTimer = null; onChange(api.state()); }, 1000); changeTimer.unref?.();
  };

  const readTeam = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };
  const mode = () => (team?.room?.mode === 'open' ? 'open' : 'closed');
  const view = () => roomView(sessions(), { mode: mode(), details: policy.details, idOf, redact, share: sharing() });
  const eventsGo = () => mode() === 'open' || sharing();
  const send = (msg) => { if (ws && connected) { try { ws.send(JSON.stringify(msg)); } catch { /* closing */ } } };

  function flush(force = false) {
    if (!connected) return;
    if (dirty || force) {
      dirty = false;
      const text = JSON.stringify(view());
      if (force || text !== lastSent) { lastSent = text; send({ t: 'room', room: JSON.parse(text) }); }
    }
    if (events.length) {
      const list = events.splice(0);
      if (eventsGo()) send({ t: 'ev', list });
    }
  }

  function connect() {
    clearTimeout(retryTimer); retryTimer = null;
    if (stopped || !team || team.paused) return;
    if (typeof WebSocket !== 'function') { why = 'node'; log('team: needs Node 22 or newer (WebSocket)'); return; }
    (async () => {
      const keys = await loadKeys(dataDir, team.keyStore);
      if (!keys) { why = 'no-key'; log('team: this computer has no team key; my-office team restore, or leave --local'); return; }
      const sock = new WebSocket(await signedWsUrl(keys, team.hub, team.teamId, now()));
      ws = sock;
      sock.addEventListener('open', () => {
        if (ws !== sock) return;
        connected = true; retry = 0; why = ''; lastSent = ''; dirty = true; changed();
        log(`team: connected to ${team.hub}`);
      });
      sock.addEventListener('message', (m) => { if (ws === sock) onMessage(m.data); });
      sock.addEventListener('close', (c) => {
        if (ws !== sock) return;
        ws = null; connected = false; forgetHub(); changed();   // (what we knew is stale until the hub says hello again)
        if (c.code === 4001) { why = 'not-member'; log('team: the hub no longer knows this computer as a member'); return; }
        if (c.code === 4000) return;   // (replaced by a newer socket of ours: nothing to do)
        why = 'reconnecting';
        scheduleRetry();
      });
      sock.addEventListener('error', () => { /* a close follows */ });
    })().catch((e) => { why = 'reconnecting'; log(`team: ${e.message}`); scheduleRetry(); });
  }
  function scheduleRetry() {
    if (stopped || retryTimer || !team || team.paused) return;
    const wait = BACKOFF[Math.min(retry++, BACKOFF.length - 1)];
    retryTimer = setTimeout(connect, wait); retryTimer.unref?.();
  }
  function disconnect() {
    clearTimeout(retryTimer); retryTimer = null;
    const s = ws; ws = null; connected = false; forgetHub(); changed();
    try { s?.close(1000, 'bye'); } catch { /* closed */ }
  }

  function forgetHub() { rooms.clear(); grants = []; knocks = []; asks.clear(); }
  const listOf = (x) => (Array.isArray(x) ? x.filter((g) => g?.viewer?.id) : []);

  function onMessage(data) {
    let msg; try { msg = JSON.parse(String(data)); } catch { return; }
    changed();
    if (msg.t === 'hello') {
      me = msg.me || null; policy = { details: !!msg.policy?.details };
      rooms.clear(); for (const r of msg.rooms || []) if (r?.member?.id) rooms.set(r.member.id, r);
      grants = listOf(msg.grants); knocks = listOf(msg.knocks);
      asks.clear(); for (const a of msg.asks || []) if (a?.room) asks.set(a.room, a.at);
      flush(true);
    } else if (msg.t === 'room' && msg.room?.member?.id) rooms.set(msg.room.member.id, msg.room);
    else if (msg.t === 'gone' && msg.member) rooms.delete(msg.member);
    else if (msg.t === 'policy') { policy = { details: !!msg.policy?.details }; dirty = true; }
    else if (msg.t === 'grants') { grants = listOf(msg.list); dirty = true; }   // (sharing may start or stop)
    else if (msg.t === 'knocks') knocks = listOf(msg.list);
    else if (msg.t === 'knock' && msg.knock?.viewer?.name) log(`team: ${msg.knock.viewer.name} asks to see your room`);
    else if (msg.t === 'access' && msg.room) {
      asks.delete(msg.room);
      answers.set(msg.room, { state: String(msg.state || ''), until: msg.until ?? null, at: now() });
    }
    else if (msg.t === 'ev' && msg.member && rooms.has(msg.member)) {
      const r = rooms.get(msg.member);
      r.events = [...(r.events || []), ...(msg.list || [])].slice(-EVENTS_KEEP);
    }
  }

  // team.json changed (joined, left, room opened or closed, paused or resumed)
  function reload() {
    const next = readTeam(), prev = team;
    team = next;
    const same = prev && next && prev.hub === next.hub && prev.teamId === next.teamId && prev.publicKey === next.publicKey;
    if (!next || next.paused || !same) disconnect();
    if (next && !next.paused && !ws) { retry = 0; connect(); }
    dirty = true; changed();
  }

  const api = {
    start() {
      if (!stopped) return;
      stopped = false;
      fs.watchFile(STATE, { interval: 2000 }, reload);
      reload();
      batchTimer = setInterval(() => flush(), RELAY_BATCH_MS); batchTimer.unref?.();
      beatTimer = setInterval(() => flush(true), RELAY_BEAT_MS); beatTimer.unref?.();
    },
    stop() {
      stopped = true; fs.unwatchFile(STATE, reload);
      clearInterval(batchTimer); clearInterval(beatTimer); clearTimeout(changeTimer); disconnect();
    },
    /** Called with everything the server broadcasts to its pages. */
    notify(obj) {
      if (!team || team.paused || !obj) return;
      if (obj.k === 'sess' || obj.k === 'gone' || obj.k === 'snap') dirty = true;
      if (obj.k === 'ev' && obj.e) {
        dirty = true;
        if (eventsGo() && events.length < EVENTS_KEEP) events.push(eventView(obj.e, { details: policy.details, idOf, redact }));
      }
    },
    /** The team's setting as the hub just answered it (the hub's own 'policy' message follows a moment later). */
    setPolicy(p) { policy = { details: !!p?.details }; dirty = true; changed(); },
    /** What the hub just answered to a call about closed rooms (its own messages follow a moment later). */
    setAccess({ grants: g, knocks: k, asked } = {}) {
      if (g) { grants = listOf(g); dirty = true; }
      if (k) knocks = listOf(k);
      if (asked) { asks.set(asked, now()); answers.delete(asked); }
      changed();
    },
    /** For GET /api/team and `my-office team rooms`. */
    state() {
      return {
        inTeam: !!team, team: team ? { id: team.teamId, name: team.teamName, hub: team.hub } : null,
        me: me || (team ? { id: team.memberId, name: team.name } : null),
        room: team ? { mode: mode(), paused: !!team.paused } : null,
        connected, problem: why || null, policy, rooms: [...rooms.values()],
        grants: grants.filter((g) => g.until == null || g.until > now()), knocks,
        asks: [...asks].map(([room, at]) => ({ room, at })),
        answers: [...answers].filter(([, a]) => now() - a.at < ANSWER_KEEP_MS).map(([room, a]) => ({ room, ...a })),
      };
    },
    // (for the tests)
    flush, view, reload,
  };
  return api;
}
