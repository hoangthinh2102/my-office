// One team's Durable Object: its SQLite storage, the rules in core.js, and the members' WebSockets. Only the Worker
// (index.js) can reach it, so the x-hub-* headers it reads were set by the Worker, not by whoever sent the request.
//
// The sockets use the hibernation API: between messages the object may be evicted from memory while the sockets stay
// open, which costs nothing. Anything kept only in memory (core.live) is rebuilt from SQLite when it wakes.
import { DurableObject } from 'cloudflare:workers';
import { HubError, TeamCore } from './core.js';

const OPEN = 1;   // WebSocket.OPEN
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const whose = (ws) => { try { return ws.deserializeAttachment()?.m || null; } catch { return null; } };

export class Team extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new TeamCore(ctx.storage.sql);
  }

  async fetch(request) {
    const url = new URL(request.url), action = request.headers.get('x-hub-action');
    if (action === 'ws') return this.connect(request, url);
    const out = await this.core.handle({
      method: request.method,
      path: url.pathname + url.search,
      body: request.method === 'GET' ? '' : await request.text(),
      headers: request.headers,
      teamId: request.headers.get('x-hub-team'),
      action,
      hub: request.headers.get('x-hub-origin'),
    });
    if (out.left) this.drop(out.left);
    if (out.policy) this.sendAll({ t: 'policy', policy: out.policy });
    return json(out.status, out.body);
  }

  /* ---------- sockets ---------- */
  async connect(request, url) {
    if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return json(426, { error: 'websocket' });
    let m;
    try { m = await this.core.authWs({ method: 'GET', path: url.pathname + url.search }); } catch (e) {
      if (e instanceof HubError) return json(e.status, { error: e.code });
      throw e;
    }
    const [client, server] = Object.values(new WebSocketPair());
    const old = this.ctx.getWebSockets(m.id);   // (one socket per member: a new one replaces the old)
    this.ctx.acceptWebSocket(server, [m.id]);
    server.serializeAttachment({ m: m.id });
    for (const o of old) { try { o.close(4000, 'replaced'); } catch { /* already closed */ } }
    server.send(JSON.stringify(this.core.hello(m.id, (id) => this.online(id))));
    if (!old.some((o) => o.readyState === OPEN)) this.sendAll(this.core.presenceOut(m.id, true), m.id);
    return new Response(null, { status: 101, webSocket: client });
  }
  online(id, except = null) { return this.ctx.getWebSockets(id).some((ws) => ws !== except && ws.readyState === OPEN); }
  sendAll(msg, except = null) {
    if (!msg) return;
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (whose(ws) === except || ws.readyState !== OPEN) continue;
      try { ws.send(text); } catch { /* closing */ }
    }
  }
  // someone left the team: their sockets close (4001: the office stops trying to reconnect) and the others drop the room
  drop(memberId) {
    for (const ws of this.ctx.getWebSockets(memberId)) { try { ws.close(4001, 'not-member'); } catch { /* closed */ } }
    this.sendAll({ t: 'gone', member: memberId }, memberId);
  }

  async webSocketMessage(ws, message) {
    const m = whose(ws);
    if (!m || typeof message !== 'string') return;
    for (const out of this.core.ingest(m, message)) this.sendAll(out, m);
  }
  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    this.gone(ws);
  }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const m = whose(ws);
    if (m && !this.online(m, ws)) this.sendAll(this.core.presenceOut(m, false), m);
  }
}
