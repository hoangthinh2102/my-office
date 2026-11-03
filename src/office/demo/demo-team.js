// Demo mode's team (team mode's building, ui/team.js): nine pretend teammates on three floors, some rooms open, some
// closed (Vy has let you into hers for a while), one person offline, someone knocking on your door, and work going on
// in the rooms you can see. Everything here is made up.
import { state } from '../core/state.js';
import { rand } from '../core/env.js';
import { onTeam, setDemoRoom } from '../ui/team.js';
import { setDemoAccess } from '../ui/team-access.js';

const PEOPLE = [
  ['Lan', 'open', [['Dev', 'shop-api', 'work', 'edit'], ['Reviewer', 'shop-api', 'rest', ''], ['QA', 'shop-web', 'wait', 'ask']]],
  ['Minh', 'closed', [['Dev', 'payments', 'work', 'bash'], ['Dev', 'payments', 'work', 'read']]],
  ['Huy', 'open', [['Dev', 'mobile-app', 'work', 'bash']]],
  ['Thảo', 'open', [['QA', 'cms', 'work', 'test'], ['Dev', 'cms', 'rest', '']]],
  ['Quân', 'offline', []],
  ['Vy', 'shared', [['Dev', 'analytics', 'work', 'edit'], ['QA', 'analytics', 'rest', '']]],
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
    const sees = mode === 'open' || mode === 'shared';
    return { member: { id: `demo-m${i}`, name }, online: mode !== 'offline', mode: mode === 'open' ? 'open' : 'closed', counts: counts(people), ...(sees ? { people, events: [] } : {}), ...(mode === 'shared' ? { access: { until: t0 + 42 * 60e3 } } : {}), at: t0 };
  });
  const byName = (n) => rooms.find((r) => r.member.name === n).member;
  const t = {
    inTeam: true, team: { id: 'demo', name: 'Demo Studio', hub: '' }, me: { id: 'demo-me', name: 'You', owner: true }, room: { mode: 'closed', paused: false }, connected: true, problem: null, policy: { details: false }, rooms,
    grants: [{ viewer: byName('Lan'), until: null, since: t0 - 86400e3 }], knocks: [{ viewer: byName('Huy'), at: t0 - 40e3 }], asks: [], answers: [],
  };
  const log = [{ at: t0 - 40e3, viewer: byName('Huy'), action: 'knock', detail: '' }, { at: t0 - 86400e3, viewer: byName('Lan'), action: 'grant', detail: 'always' }];
  const show = (extra = {}) => { onTeam({ ...t }); return { ok: true, team: { ...t }, ...extra }; };
  // what the server would answer (ui/team-access.js), on the pretend team
  setDemoAccess((action, b) => {
    const now = Date.now(), who = rooms.find((r) => r.member.id === (b.viewer || b.room))?.member;
    if (action === 'access') return { ok: true, grants: t.grants, knocks: t.knocks, log };
    if (action === 'answer') {
      t.knocks = t.knocks.filter((k) => k.viewer.id !== b.viewer);
      if (b.grant !== 'no') t.grants = [...t.grants.filter((g) => g.viewer.id !== b.viewer), { viewer: who, until: b.grant === 'always' ? null : now + 3600e3, since: now }];
      log.unshift({ at: now, viewer: who, action: b.grant === 'no' ? 'deny' : 'grant', detail: b.grant === 'no' ? '' : b.grant });
      return show();
    }
    if (action === 'revoke') { t.grants = t.grants.filter((g) => g.viewer.id !== b.viewer); log.unshift({ at: now, viewer: who, action: 'revoke', detail: '' }); return show(); }
    if (action === 'code') { log.unshift({ at: now, viewer: null, action: 'code', detail: '' }); return { ok: true, code: 'DEMO-CODE-42'.replace(/-/g, '').slice(0, 10), expiresAt: now + 600e3 }; }
    if (action === 'redeem') return { ok: false, code: 'code-unknown' };
    if (action === 'knock') {   // (Minh answers a little later: yes for an hour)
      t.asks = [...t.asks, { room: b.room, at: now }];
      setTimeout(() => {
        const r = rooms.find((x) => x.member.id === b.room); if (!r) return;
        t.asks = t.asks.filter((a) => a.room !== b.room);
        t.answers = [...t.answers.filter((a) => a.room !== b.room), { room: b.room, state: 'granted', until: Date.now() + 3600e3, at: Date.now() }];
        const ppl = PEOPLE.find(([n]) => n === r.member.name)[2];
        r.people = ppl.map(([role, project, status, act], k) => ({ id: `${r.member.id}p${k}`, status, project, role, subs: 0, act, since: Date.now() - (k + 1) * 6e5, at: Date.now() }));
        r.events = []; r.access = { until: Date.now() + 3600e3 };
        onTeam({ ...t });
      }, 2500);
      return show();
    }
    return { ok: false, code: 'bad-request' };
  });
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
