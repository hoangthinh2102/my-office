// The team hub, as a Cloudflare Worker: one Durable Object per team (team.js) holds that team's records in SQLite.
//
//   POST /teams              create a team (signed by the creator's key; CREATE_TOKEN, if set, is required too)
//   POST /t/<team>/invites   a one-time invite link (the team's creator only)
//   POST /t/<team>/join      join with an invite code (signed by the newcomer's key)
//   GET  /t/<team>/me        the team, who you are, the members
//   POST /t/<team>/leave     leave the team
//   POST /t/<team>/policy    the team's settings ({ details }; the team's creator only)
//   GET  /t/<team>/ws        a member's WebSocket: its room up, everyone else's rooms down (signed in the query)
//   GET  /j/<team>.<code>    an invite link opened in a browser: how to use it
//
// Every request and answer is described in docs/features/team-mode.md.
import { isTeamId, randomId } from '../../shared/team-protocol.js';

export { Team } from './team.js';

const VERSION = '0.3.1';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const ACTIONS = new Set(['invites', 'join', 'me', 'leave', 'policy', 'ws', 'knock', 'answer', 'revoke', 'code', 'redeem', 'access']);

const hub = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return json(200, { name: 'my-office-hub', version: VERSION, protocol: 1 });

    const invite = url.pathname.match(/^\/j\/([A-Za-z0-9_-]{22})\.([A-Za-z0-9-]+)$/);
    if (invite && request.method === 'GET') {
      return new Response(`This is an invite to a My Office team.\n\nOn your computer, in the my-office folder, run:\n\n  node bin/cli.mjs team join ${url.origin}${url.pathname}\n\nIt works once, for 15 minutes.\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
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
