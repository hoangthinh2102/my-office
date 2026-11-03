// One team's Durable Object: its SQLite storage and the rules in core.js. Only the Worker (index.js) can reach it, so
// the x-hub-* headers it reads were set by the Worker, not by whoever sent the request.
import { DurableObject } from 'cloudflare:workers';
import { TeamCore } from './core.js';

export class Team extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new TeamCore(ctx.storage.sql);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const out = await this.core.handle({
      method: request.method,
      path: url.pathname + url.search,
      body: request.method === 'GET' ? '' : await request.text(),
      headers: request.headers,
      teamId: request.headers.get('x-hub-team'),
      action: request.headers.get('x-hub-action'),
      hub: request.headers.get('x-hub-origin'),
    });
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
}
