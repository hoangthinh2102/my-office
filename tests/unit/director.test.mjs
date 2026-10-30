import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPerf, kindOf } from '../../server/perf.mjs';
import { createCompany, DEFAULT_SCHEDULE, permArgs, PERMS } from '../../server/company.mjs';
import { createAgentSupport } from '../../server/agent-support.mjs';

const GUID = '27fbb8ff-6be1-4899-b8b6-af6d75d44ab8', GUID2 = '11111111-2222-4333-8444-555555555555';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('a prompt says what kind of job it is', () => {
  assert.equal(kindOf('/do-task https://applink.larksuite.com/x?guid=abc'), 'task');
  assert.equal(kindOf('/agent-support:fix-mr feat/x'), 'rework');
  assert.equal(kindOf('/daily-tasks resume'), 'daily');
  assert.equal(kindOf('sửa giúp lỗi build'), 'chat');
});

test('permission profiles: dev works alone but never force-pushes, a reviewer only reads', () => {
  const dev = permArgs('dev');
  assert.deepEqual(dev.slice(0, 2), ['--permission-mode', 'acceptEdits']);
  assert.ok(dev.includes('Bash(npm:*)') && dev.includes('Edit'));
  assert.ok(dev.indexOf('Bash(git push --force:*)') > dev.indexOf('--disallowedTools'));
  const rev = permArgs('reviewer');
  assert.ok(rev.indexOf('Edit') > rev.indexOf('--disallowedTools'), 'Edit is denied');
  assert.ok(!rev.slice(0, rev.indexOf('--disallowedTools')).includes('Edit'), 'Edit is not allowed');
  assert.deepEqual(permArgs('ask'), []);
  assert.deepEqual(permArgs('nonsense'), []);
  assert.deepEqual(Object.keys(PERMS), ['ask', 'dev', 'qa', 'reviewer']);
});

test('a role keeps its permission profile and hand-over; budgets and the morning run are cleaned', () => {
  const co = createCompany({ dataDir: tmp('office-co2-'), claudeDir: tmp('office-cl-') });
  assert.ok(co.setRole('aaaa1111-bbbb', { title: 'Dev', perm: 'dev', next: 'cccc2222-dddd' }));
  assert.deepEqual(co.roleOf('aaaa1111-bbbb'), { title: 'Dev', brief: '', perm: 'dev', next: 'cccc2222-dddd' });
  co.setRole('aaaa1111-bbbb', { title: 'Dev', perm: 'root', next: 'aaaa1111-bbbb' });   // unknown profile, handing over to itself
  assert.equal(co.roleOf('aaaa1111-bbbb').perm, 'ask'); assert.equal(co.roleOf('aaaa1111-bbbb').next, '');
  co.set({ budget: { personDay: '250000.7', projectDay: -5, stop: 1 }, auto: { on: true, at: '25:00', prompt: '  ', perm: 'reviewer' } });
  assert.deepEqual(co.get().budget, { personDay: 250001, projectDay: 0, stop: true });
  assert.equal(co.get().auto.at, ''); assert.equal(co.get().auto.prompt, '/daily-tasks'); assert.equal(co.get().auto.perm, 'reviewer');
  co.autoRan('2026-10-30'); assert.equal(co.get().auto.last, '2026-10-30');
});

function fakeAgentSupport() {
  const home = tmp('office-home-'), base = path.join(home, '.agent-support'), gamota = path.join(home, 'work');
  for (const d of ['be', 'api']) fs.mkdirSync(path.join(gamota, d), { recursive: true });
  fs.mkdirSync(path.join(home, 'olap'), { recursive: true });
  fs.mkdirSync(path.join(base, 'state'), { recursive: true });
  fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify({ workspace_roots: [gamota, home], repo_paths: { be: path.join(gamota, 'be'), api: path.join(gamota, 'api'), olap: path.join(home, 'olap'), gone: '/nope/x' } }));
  fs.writeFileSync(path.join(base, 'state', `${GUID}.json`), JSON.stringify({ guid: GUID, status: 'DONE', summary: 'BE Update data', url: 'https://applink.larksuite.com/client/todo/detail?guid=x', mrs: "['https://git.example.com/a/-/merge_requests/3']", dev_pipeline: 'success', updated_at: '2026-10-29T11:39:28+07:00' }));
  const now = Date.now(), iso = (t) => new Date(t).toISOString();
  fs.writeFileSync(path.join(base, 'actions.jsonl'), [
    { ts: iso(now - 3600e3), tool: 'gitlab', action: 'mr_create', mr: 'https://git.example.com/old/-/merge_requests/1' },
    { ts: iso(now - 1000), tool: 'gitlab', action: 'mr_create', mr: 'https://git.example.com/a/-/merge_requests/3', task: GUID2 },
    { ts: iso(now - 500), tool: 'lark', action: 'comment', task: GUID2 },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n{"cut');
  return { home, gamota };
}

test('agent-support: the workspace, a task in a prompt, what the skills did meanwhile', async () => {
  const { home, gamota } = fakeAgentSupport();
  const as = createAgentSupport({ home });
  const ws = as.workspace();
  assert.equal(ws.root, gamota, 'the root that holds most repos, not the home folder');
  assert.deepEqual(ws.repos.map((r) => r.name), ['be', 'api', 'olap']);
  assert.equal(as.taskInPrompt(`/do-task https://applink.larksuite.com/client/todo/detail?guid=${GUID.toUpperCase()}`), GUID);
  assert.equal(as.taskInPrompt('no task here'), null);
  const info = await as.taskInfo(GUID);
  assert.equal(info.summary, 'BE Update data'); assert.equal(info.status, 'DONE'); assert.deepEqual(info.mrs, ['https://git.example.com/a/-/merge_requests/3']);
  assert.equal(await as.taskInfo('../etc/passwd'), null);
  const d = await as.during(Date.now() - 60e3, Date.now());
  assert.deepEqual(d.mrs, ['https://git.example.com/a/-/merge_requests/3']);
  assert.ok(d.tasks.includes(GUID2));
  assert.equal(createAgentSupport({ home: tmp('office-empty-') }).workspace(), null);
});

test('the board scores what was delivered, ties jobs to Lark tasks and counts rework', async () => {
  const { home } = fakeAgentSupport();
  const as = createAgentSupport({ home });
  const perf = createPerf({ dataDir: tmp('office-perf2-'), schedule: () => ({ ...DEFAULT_SCHEDULE }), taskOf: as.taskInPrompt, taskInfo: as.taskInfo });
  const dev = { key: 'k1', sid: 'aaaa-1', name: 'dev', cwd: '/w/be' }, slow = { key: 'k2', sid: 'bbbb-2', name: 'slow', cwd: '/w/be' };
  // dev: one task, a commit and an MR; then review sends it back once
  perf.begin(dev, { prompt: `/do-task ${GUID}`, usage: { in: 0, cr: 0, out: 0, cost: 0 } });
  perf.note(dev, 'commit'); perf.tool(dev, { edit: true });
  const r1 = perf.finish(dev, { usage: { in: 1000, cr: 0, out: 100, cost: 1 }, ok: true, extra: { tasks: [], mrs: ['https://git.example.com/a/-/merge_requests/3'] } });
  assert.deepEqual(r1.tasks, [GUID]); assert.equal(r1.kind, 'task'); assert.equal(r1.commits, 1); assert.equal(r1.mrs.length, 1);
  perf.begin(dev, { prompt: `/fix-mr ${GUID}`, usage: { in: 1000, cr: 0, out: 100, cost: 1 } });
  perf.note(dev, 'push');
  perf.finish(dev, { usage: { in: 1500, cr: 0, out: 150, cost: 1.5 }, ok: true });
  // slow: two jobs that edit but deliver nothing, CI red once
  for (let i = 0; i < 2; i++) {
    perf.begin(slow, { prompt: 'sửa lỗi build', usage: { in: 0, cr: 0, out: 0, cost: i * 3 } });
    perf.tool(slow, { edit: true }); perf.note(slow, 'cired');
    perf.finish(slow, { usage: { in: 5000, cr: 0, out: 500, cost: i * 3 + 3 }, ok: true });
  }
  const t = perf.today();
  assert.equal(t.bySid.get('aaaa-1'), 1650); assert.equal(t.byProject.get('be'), 1650 + 11000);
  await new Promise((r) => setTimeout(r, 50));
  const b = await perf.board(1);
  const pd = b.people.find((p) => p.name === 'dev'), ps = b.people.find((p) => p.name === 'slow');
  assert.equal(pd.delivered, 2); assert.equal(pd.rework, 1); assert.equal(ps.delivered, 0); assert.equal(ps.ciRed, 2);
  assert.ok(pd.score > ps.score, `${pd.score} > ${ps.score}`);
  assert.equal(pd.parts.ci, 0); assert.equal(ps.parts.ci, -4);
  const task = b.tasks.find((x) => x.guid === GUID);
  assert.equal(task.jobs, 2); assert.equal(task.rework, 1); assert.equal(task.summary, 'BE Update data'); assert.equal(task.status, 'DONE');
  assert.equal(b.total.delivered, 2); assert.equal(b.total.mrs, 1);
  // a job still running counts towards the budget as it goes
  perf.begin(dev, { prompt: 'x', usage: { in: 1500, cr: 0, out: 150, cost: 1.5 } });
  assert.equal(perf.live(dev, { in: 2500, cr: 200, out: 250 }), 800 + 100);
});
