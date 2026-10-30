import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPerf, overtimeMin } from '../../server/perf.mjs';
import { cleanSchedule, createCompany, DEFAULT_SCHEDULE } from '../../server/company.mjs';

const sched = { ...DEFAULT_SCHEDULE };
const at = (day, hh, mm) => new Date(`${day}T${hh}:${mm}:00`).getTime();
// 2026-10-28 was a Wednesday, 2026-10-31 a Saturday
const WED = '2026-10-28', SAT = '2026-10-31';

test('overtime counts only the minutes outside office hours', () => {
  assert.equal(overtimeMin(at(WED, '09', '00'), at(WED, '10', '00'), sched), 0);
  assert.equal(overtimeMin(at(WED, '17', '30'), at(WED, '19', '00'), sched), 60);
  assert.equal(overtimeMin(at(WED, '07', '30'), at(WED, '09', '00'), sched), 60);
  assert.equal(overtimeMin(at(SAT, '10', '00'), at(SAT, '11', '30'), sched), 90);   // a day off: all of it
  assert.equal(overtimeMin(at(WED, '23', '00'), at('2026-10-29', '01', '00'), sched), 120);   // across midnight
});

test('a schedule out of order falls back to the default, keeping the days', () => {
  const s = cleanSchedule({ start: '09:00', end: '08:00', days: [1, 3] });
  assert.equal(s.start, DEFAULT_SCHEDULE.start);
  assert.deepEqual(s.days, [1, 3]);
  const ok = cleanSchedule({ arrive: '07:30', breakfast: '07:30', start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5, 6] });
  assert.equal(ok.start, '08:00'); assert.equal(ok.end, '17:00'); assert.equal(ok.days.length, 6);
  assert.equal(cleanSchedule({ start: 'nine' }).start, DEFAULT_SCHEDULE.start);
});

test('a job costs the usage it added, and the board scores people against the team', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-perf-'));
  const perf = createPerf({ dataDir: dir, schedule: () => sched });
  const a = { key: 'pa', sid: 'aaaa-1111', name: 'alice', cwd: '/w/shop' }, b = { key: 'pb', sid: 'bbbb-2222', name: 'bob', cwd: '/w/shop' };
  const ua = { in: 1000, cr: 800, out: 50, cost: 1, model: 'claude-opus-5-5' };   // usage before the job: not counted
  perf.begin(a, { prompt: 'add cart', usage: ua });
  perf.tool(a, { edit: true }); perf.tool(a, { failed: true });
  const ra = perf.finish(a, { usage: { in: 21000, cr: 15800, out: 2050, cost: 1.5, model: 'claude-opus-5-5' }, ok: true });
  assert.equal(ra.tokIn, 5000); assert.equal(ra.cacheRead, 15000); assert.equal(ra.out, 2000); assert.equal(ra.cost, 0.5);
  assert.equal(ra.tools, 2); assert.equal(ra.fails, 1); assert.equal(ra.edits, 1);
  for (let i = 0; i < 2; i++) {
    perf.begin(b, { prompt: `fix ${i}`, usage: { in: 0, cr: 0, out: 0, cost: i * 2 } });
    perf.finish(b, { usage: { in: 100, cr: 0, out: 10, cost: i * 2 + 2 }, ok: i === 0, why: i ? 'interrupted' : '' });
  }
  assert.equal(perf.finish(a, { usage: ua, ok: true }), null);   // no job open: nothing written
  await new Promise((r) => setTimeout(r, 50));
  const board = await perf.board(1);
  assert.equal(board.total.jobs, 3);
  const alice = board.people.find((p) => p.name === 'alice'), bob = board.people.find((p) => p.name === 'bob');
  assert.equal(alice.jobs, 1); assert.equal(bob.jobs, 2); assert.equal(bob.done, 1);
  assert.ok(alice.score > bob.score, 'cheaper, finished jobs score higher');
  assert.equal(board.projects[0].name, 'shop');
  assert.equal(board.recent[0].why, 'interrupted');
});

test('the company rules and a role become the session context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-co-'));
  const co = createCompany({ dataDir: dir, claudeDir: dir });
  assert.equal(co.rulesContext(), '');
  co.set({ name: 'Gamota', rules: 'Commit messages in Vietnamese.' });
  assert.match(co.rulesContext(), /Company rules \(from the director of Gamota/);
  assert.match(co.rulesContext(), /Commit messages in Vietnamese\./);
  assert.ok(co.setRole('1234abcd-0000', { title: 'Reviewer', brief: 'Reads, never edits' }));
  assert.match(co.rulesContext(co.roleOf('1234abcd-0000')), /# Your role in the company\nReviewer — Reads, never edits/);
  assert.equal(co.rulesContext(co.roleOf('1234abcd-0000'), { rules: false }).includes('Company rules'), false);
  assert.equal(co.setRole('../etc', { title: 'x' }), false);
  co.set({ rulesOn: false });
  assert.equal(co.rulesContext(), '');
});
