// Demo mode's team (team mode's building, ui/team.js): nine pretend teammates on three floors, some rooms open, some
// closed, one person offline, and work going on in the open rooms. Everything here is made up.
import { state } from '../core/state.js';
import { rand } from '../core/env.js';
import { onTeam, setDemoRoom } from '../ui/team.js';

const PEOPLE = [
  ['Lan', 'open', [['Dev', 'shop-api', 'work', 'edit'], ['Reviewer', 'shop-api', 'rest', ''], ['QA', 'shop-web', 'wait', 'ask']]],
  ['Minh', 'closed', [['Dev', 'payments', 'work', 'bash'], ['Dev', 'payments', 'work', 'read']]],
  ['Huy', 'open', [['Dev', 'mobile-app', 'work', 'bash']]],
  ['Thảo', 'open', [['QA', 'cms', 'work', 'test'], ['Dev', 'cms', 'rest', '']]],
  ['Quân', 'offline', []],
  ['Vy', 'closed', [['Dev', 'analytics', 'rest', '']]],
  ['Nam', 'open', [['Dev', 'chat-bot', 'work', 'grep'], ['Dev', 'chat-bot', 'work', 'web'], ['Reviewer', 'chat-bot', 'work', 'read'], ['QA', 'chat-bot', 'rest', '']]],
  ['Hà', 'open', [['Dev', 'docs-site', 'work', 'write']]],
  ['Tú', 'closed', [['Dev', 'infra', 'work', 'bash'], ['Dev', 'infra', 'wait', 'ask']]],
];
const ACTS = ['read', 'edit', 'bash', 'grep', 'test', 'web', 'write', 'commit', 'push'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const counts = (people) => ({ work: people.filter((p) => p.status === 'work').length, wait: people.filter((p) => p.status === 'wait').length, rest: people.filter((p) => p.status === 'rest').length });

export function startDemoTeam(t0 = Date.now()) {
  const rooms = PEOPLE.map(([name, mode, ppl], i) => {
    const people = ppl.map(([role, project, status, act], k) => ({ id: `demo${i}p${k}`, status, project, role, subs: k === 0 && i % 3 === 0 ? 2 : 0, act, since: t0 - (k + 1) * 7 * 60e3, at: t0 - k * 60e3 }));
    return { member: { id: `demo-m${i}`, name }, online: mode !== 'offline', mode: mode === 'open' ? 'open' : 'closed', counts: counts(people), ...(mode === 'open' ? { people, events: [] } : {}), at: t0 };
  });
  const t = { inTeam: true, team: { id: 'demo', name: 'Demo Studio', hub: '' }, me: { id: 'demo-me', name: 'You', owner: true }, room: { mode: 'closed', paused: false }, connected: true, problem: null, policy: { details: false }, rooms };
  setDemoRoom((mode) => {
    if (typeof mode === 'object') t.policy = { details: !!mode.details };   // the team's setting (you made the team)
    else t.room = mode === 'paused' ? { ...t.room, paused: true } : { mode, paused: false };
    onTeam({ ...t });
  });
  onTeam(t);
  // now and then someone in an open room starts on something else
  setInterval(() => {
    if (state.team !== t && state.team?.team?.id !== 'demo') return;
    const r = pick(rooms.filter((x) => x.people?.length)), p = pick(r.people);
    if (p.status === 'rest' && Math.random() < 0.7) return;
    p.status = Math.random() < 0.85 ? 'work' : 'wait'; p.act = p.status === 'wait' ? 'ask' : pick(ACTS); p.at = Date.now();
    r.counts = counts(r.people);
    r.events = [...r.events, { p: p.id, type: p.act, ts: Date.now() }].slice(-20);
    onTeam({ ...t });
  }, rand(4000, 6000));
}
