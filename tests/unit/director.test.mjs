import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPerf, kindOf } from '../../server/perf.mjs';
import { createCompany, DEFAULT_SCHEDULE, permArgs, PERMS } from '../../server/company.mjs';
import { parseAsk, answerText } from '../../server/asks.mjs';
import { createAgentSupport } from '../../server/agent-support.mjs';

const GUID = '27fbb8ff-6be1-4899-b8b6-af6d75d44ab8', GUID2 = '11111111-2222-4333-8444-555555555555';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('a prompt says what kind of job it is', () => {
  assert.equal(kindOf('/do-task https://applink.larksuite.com/x?guid=abc'), 'task');
  assert.equal(kindOf('/agent-support:fix-mr feat/x'), 'rework');
  assert.equal(kindOf('/daily-tasks resume'), 'daily');
  assert.equal(kindOf('sửa giúp lỗi build'), 'chat');
});

test('permission profiles: auto by default like your own sessions; dev works alone but never force-pushes, a reviewer only reads', () => {
  assert.deepEqual(permArgs('auto').slice(0, 2), ['--permission-mode', 'auto']);
  assert.ok(!permArgs('auto').includes('--allowedTools'), 'auto mode decides by itself');
  assert.ok(permArgs('auto').includes('Bash(git push --force:*)'));
  assert.deepEqual(permArgs(undefined), permArgs('auto'));
  assert.deepEqual(permArgs('nonsense'), permArgs('auto'));
  assert.deepEqual(permArgs('ask'), ['--permission-mode', 'default']);
  const dev = permArgs('dev');
  assert.deepEqual(dev.slice(0, 2), ['--permission-mode', 'auto']);
  assert.ok(dev.includes('Bash(npm:*)') && dev.includes('Edit'));
  assert.ok(dev.indexOf('Bash(git push --force:*)') > dev.indexOf('--disallowedTools'));
  const rev = permArgs('reviewer');
  assert.ok(rev.indexOf('Edit') > rev.indexOf('--disallowedTools'), 'Edit is denied');
  assert.ok(!rev.slice(0, rev.indexOf('--disallowedTools')).includes('Edit'), 'Edit is not allowed');
  assert.deepEqual(Object.keys(PERMS), ['auto', 'ask', 'dev', 'qa', 'reviewer']);
});

test('a role keeps its permission profile and hand-over; budgets and the morning run are cleaned', () => {
  const co = createCompany({ dataDir: tmp('office-co2-'), claudeDir: tmp('office-cl-') });
  assert.ok(co.setRole('aaaa1111-bbbb', { title: 'Dev', perm: 'dev', next: 'cccc2222-dddd' }));
  assert.deepEqual(co.roleOf('aaaa1111-bbbb'), { title: 'Dev', brief: '', perm: 'dev', next: 'cccc2222-dddd' });
  co.setRole('aaaa1111-bbbb', { title: 'Dev', perm: 'root', next: 'aaaa1111-bbbb' });   // unknown profile, handing over to itself
  assert.equal(co.roleOf('aaaa1111-bbbb').perm, 'auto'); assert.equal(co.roleOf('aaaa1111-bbbb').next, '');
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

test('a reply that stops for the director: markers, options a skill writes itself, and plain answers', () => {
  let r = parseAsk('Phase 1 done: 3 files read.\n\nPlan: change the API first.\n[[office:approve]]');
  assert.deepEqual(r.ask, { kind: 'approve' }); assert.ok(!r.text.includes('[[office'));
  r = parseAsk('Two ways:\n[[office:choose| Keep the old table | **Migrate** now |]]');
  assert.deepEqual(r.ask, { kind: 'choose', options: ['Keep the old table', 'Migrate now'], multi: false });
  assert.equal(parseAsk('x [[office:choose-many|a|b|c]]').ask.multi, true);
  assert.deepEqual(parseAsk('x [[office:choose|only one]]').ask, { kind: 'approve' });
  // no marker: a numbered list right above the question
  r = parseAsk('Tìm thấy 2 hướng.\n\n1. Sửa ở BE\n2. Sửa ở FE\n\nBạn muốn chọn hướng nào?');
  assert.deepEqual(r.ask, { kind: 'choose', options: ['Sửa ở BE', 'Sửa ở FE'], multi: false });
  r = parseAsk('Which one?\nA) keep\nB) drop\nC) **rename**');
  assert.deepEqual(r.ask.options, ['keep', 'drop', 'rename']);
  assert.deepEqual(parseAsk('Đã review xong, không có lỗi. Duyệt để mình push và tạo MR nhé?').ask, { kind: 'approve' });
  assert.deepEqual(parseAsk('Should I attach the docs and post this?').ask, { kind: 'approve' });
  assert.equal(parseAsk('Xong rồi. Đã push nhánh feat/x và tạo MR !12.').ask, null);
  assert.equal(parseAsk('Why did it fail? Because the token expired.\n\nFixed it, tests pass.\nCommitted.\nPushed.\nMR updated.\nLark commented.\nPipeline green.\nDone.').ask, null);
  assert.equal(parseAsk('```js\nif (a?) {}\n```\nDone.').ask, null);
});

test("the director's answer, in words the agent reads", () => {
  const t = (k, v = {}) => `${k}${Object.keys(v).length ? JSON.stringify(v) : ''}`;
  const ask = { kind: 'choose', options: ['A', 'B', 'C'], multi: true };
  assert.equal(answerText(ask, { ok: true, pick: [0, 2] }, t), 'director.ask.choseMsg{"chosen":"A + C"}');
  assert.equal(answerText({ kind: 'approve' }, { ok: true, note: 'nhớ chạy test' }, t), 'director.ask.goMsg\n\ndirector.ask.noteFrom{"note":"nhớ chạy test"}');
  assert.equal(answerText({ kind: 'approve' }, { ok: false, note: 'đổi tên hàm' }, t), 'director.ask.reviseMsg{"note":"đổi tên hàm"}');
});

test('recent conversations: folder, title (rename first), newest first, only real conversations', async () => {
  const { createRecent } = await import('../../server/recent.mjs');
  const cl = tmp('office-claude-'), work = fs.mkdtempSync(path.join(os.homedir(), '.office-test-work-')), proj = path.join(cl, 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  const line = (o) => JSON.stringify(o) + '\n';
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  fs.writeFileSync(path.join(proj, `${a}.jsonl`), line({ type: 'user', cwd: work, message: { content: '<command-name>/x</command-name>' } }) + line({ type: 'user', cwd: work, message: { content: 'sửa lỗi đăng nhập' } }));
  fs.writeFileSync(path.join(proj, `${b}.jsonl`), line({ type: 'user', cwd: work, message: { content: 'hi' } }) + line({ type: 'ai-title', aiTitle: 'Generated' }) + line({ type: 'custom-title', customTitle: 'Renamed' }));
  fs.writeFileSync(path.join(proj, 'agent-x.jsonl'), line({ type: 'user', cwd: work, message: { content: 'sub' } }));
  fs.writeFileSync(path.join(proj, '33333333-3333-4333-8333-333333333333.jsonl'), line({ type: 'user', cwd: '/nope/gone', message: { content: 'old' } }));
  const t = Date.now() / 1000; fs.utimesSync(path.join(proj, `${a}.jsonl`), t - 60, t - 60);
  const r = createRecent({ claudeDir: cl });
  const l = await r.list();
  assert.deepEqual(l.map((x) => [x.sid, x.title, x.cwd]), [[b, 'Renamed', work], [a, 'sửa lỗi đăng nhập', work]]);
  assert.equal(r.get(a).transcript, path.join(proj, `${a}.jsonl`));
  assert.equal(r.get('nope'), null);
  // a branch of a conversation copies its messages: same first message id, so they are known to be one person
  const br = '55555555-5555-4555-8555-555555555555';
  fs.writeFileSync(path.join(proj, `${a}.jsonl`), line({ type: 'user', uuid: 'm-1', cwd: work, message: { content: 'sửa lỗi đăng nhập' } }));
  fs.writeFileSync(path.join(proj, `${br}.jsonl`), line({ type: 'user', uuid: 'm-1', cwd: work, message: { content: 'sửa lỗi đăng nhập' } }) + line({ type: 'user', uuid: 'm-2', cwd: work, message: { content: 'tiếp' } }));
  const l2 = await createRecent({ claudeDir: cl }).list();
  assert.equal(l2.find((x) => x.sid === br).first, l2.find((x) => x.sid === a).first);
  assert.notEqual(l2.find((x) => x.sid === b).first, 'm-1');
  // a conversation in a temporary folder is left out
  const scratch = tmp('office-scratch-'), c = '44444444-4444-4444-8444-444444444444';
  fs.writeFileSync(path.join(proj, `${c}.jsonl`), line({ type: 'user', cwd: scratch, message: { content: 'scratch' } }));
  assert.equal((await createRecent({ claudeDir: cl }).list()).some((x) => x.sid === c), false);
  fs.rmSync(work, { recursive: true, force: true });
});
