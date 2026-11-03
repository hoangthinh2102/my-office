// The team hub, as a Cloudflare Worker: one Durable Object per team (team.js) holds that team's records in SQLite.
//
//   POST /teams              create a team (signed by the creator's key; CREATE_TOKEN, if set, is required too)
//   POST /t/<team>/invites   an invite link: anyone with it can join for an hour (admins only)
//   POST /t/<team>/join      join with an invite code (signed by the newcomer's key)
//   GET  /t/<team>/me        the team, who you are, the members
//   POST /t/<team>/leave     leave the team (not the last admin while others remain)
//   POST /t/<team>/promote   make a member an admin ({ member }; admins only)
//   POST /t/<team>/stepdown  stop being an admin (yourself only; not the last one)
//   POST /t/<team>/remove    take a member out of the team ({ member }; admins only, never another admin)
//   POST /t/<team>/policy    the team's settings ({ details }; admins only)
//   GET  /t/<team>/ws        a member's WebSocket: its room up, everyone else's rooms down (signed in the query)
//   GET  /j/<team>.<code>    an invite link opened in a browser: the team's name and how to join (hub/src/invite-page.js)
//
// Every request and answer is described in docs/features/team-mode.md.
import { isTeamId, randomId } from '../../shared/team-protocol.js';
import { invitePage } from './invite-page.js';

export { Team } from './team.js';

const VERSION = '0.4.1';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const ACTIONS = new Set(['invites', 'join', 'me', 'leave', 'policy', 'ws', 'knock', 'answer', 'revoke', 'code', 'redeem', 'access', 'promote', 'stepdown', 'remove']);

const hub = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return json(200, { name: 'my-office-hub', version: VERSION, protocol: 1 });

    const invite = url.pathname.match(/^\/j\/([A-Za-z0-9_-]{22})\.([A-Za-z0-9-]+)$/);
    if (invite && request.method === 'GET') {
      // the team's name and whether the link has run out, from its Durable Object (nothing is written for a team that doesn't exist)
      let team = null, expired = false;
      try { ({ name: team = null, expired = false } = await (await forward(env, invite[1], 'name', new Request(request.url), url)).json()); } catch { /* the page works without it */ }
      const html = invitePage({ link: `${url.origin}${url.pathname}`, team: team || null, expired: expired === true, accept: request.headers.get('accept-language'), asked: url.searchParams.get('lang'), setupUrl: env.SETUP_URL || undefined });
      return new Response(html, { status: expired === true ? 410 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
    }

    if (url.pathname === '/teams' && request.method === 'POST') {
      if (env.CREATE_TOKEN && request.headers.get('x-create-token') !== env.CREATE_TOKEN) return json(403, { error: 'create-token' });
      return forward(env, randomId(16), 'create', request, url);
    }

    const m = url.pathname.match(/^\/t\/([^/]+)\/([a-z]+)$/);
    if (m && isTeamId(m[1]) && ACTIONS.has(m[2])) return forward(env, m[1], m[2], request, url);
    return json(404, { error: 'not-found' });
  },
};
export default hub;

// the team's Durable Object gets the request as it was signed (same URL), plus which team and action the Worker saw
function forward(env, teamId, action, request, url) {
  const headers = new Headers(request.headers);
  headers.set('x-hub-team', teamId); headers.set('x-hub-action', action); headers.set('x-hub-origin', url.origin);
  return env.TEAM.get(env.TEAM.idFromName(teamId)).fetch(new Request(request.url, { method: request.method, headers, body: request.body }));
}
