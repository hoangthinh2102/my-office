import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeys, inviteFromSearch, makeInviteCode, randomId, signRequest } from '../../shared/team-protocol.js';
import { invitePage, pickLang } from '../../hub/src/invite-page.js';
import { TeamCore } from '../../hub/src/core.js';

/* Joining without the command line: the hub's invite page, ?join= on the office page, the team's name for the page. */
const LINK = `https://hub.test/j/AbCdEfGhIjKlMnOpQrStUv.${makeInviteCode()}`;

test('the invite page: the team, both ways in, and nothing unescaped', () => {
  const html = invitePage({ link: LINK, team: 'Gam<ota>"', accept: 'vi-VN,vi;q=0.9' });
  assert.ok(html.includes('Gam&lt;ota&gt;&quot;'));
  assert.ok(!html.includes('Gam<ota>'));
  assert.ok(html.includes(`http://localhost:4310/?join=${encodeURIComponent(LINK)}`));
  assert.ok(html.includes(`bash -s -- --lang vi --join &#39;${LINK}&#39;`));   // (shown escaped; the copy button copies the text)
  assert.ok(html.includes('<html lang="vi">'));
  assert.ok(invitePage({ link: LINK, team: null, accept: 'en-US' }).includes('a My Office team'));
  assert.ok(invitePage({ link: LINK, team: 'T', accept: 'en', setupUrl: 'https://x.test/s.sh' }).includes('curl -fsSL https://x.test/s.sh | bash -s -- --lang en'));
});

test('the invite page tells an office installed long ago to use the install line (it updates, then joins)', () => {
  for (const [lang, note, title] of [['vi', 'Cài từ trước tháng 11/2026', 'hoặc cần cập nhật'], ['en', 'Installed before November 2026', 'or needs updating']]) {
    const html = invitePage({ link: LINK, team: 'T', accept: lang });
    const at = html.indexOf(note);
    assert.ok(at > html.indexOf('localhost:4310/?join='), `${lang}: under the open button`);
    assert.ok(at < html.indexOf('curl -fsSL'), `${lang}: before the install line`);
    assert.ok(html.includes(title), `${lang}: the install part says it updates too`);
  }
  assert.ok(!invitePage({ link: LINK, team: 'T', expired: true, accept: 'en' }).includes('Installed before'));   // (no way in: nothing to update for)
});

test('an expired invite page says so, with no way in', () => {
  const vi = invitePage({ link: LINK, team: 'Gam<ota>', expired: true, accept: 'vi' });
  assert.ok(vi.includes('Link mời đã hết hạn'));
  assert.ok(vi.includes('“Gam&lt;ota&gt;”'));
  assert.ok(vi.includes('Xin admin'));
  for (const gone of ['localhost:4310', 'curl ', 'team join', '<script', 'id="cp"']) assert.ok(!vi.includes(gone), gone);
  const en = invitePage({ link: LINK, team: null, expired: true, accept: 'en' });
  assert.ok(en.includes('This invite link has expired'));
  assert.ok(!en.includes('null'));
  assert.ok(invitePage({ link: LINK, team: 'T', accept: 'vi' }).includes('localhost:4310'));   // (not expired: the normal page)
});

test('the invite page\'s language: ?lang=, else what the browser lists first, else Vietnamese', () => {
  assert.equal(pickLang('en-US,en;q=0.9,vi;q=0.8'), 'en');
  assert.equal(pickLang('vi-VN,vi;q=0.9,en;q=0.8'), 'vi');
  assert.equal(pickLang('fr-FR'), 'vi');
  assert.equal(pickLang(''), 'vi');
  assert.equal(pickLang('en-US', 'vi'), 'vi');
  assert.equal(pickLang('vi', 'en'), 'en');
  assert.equal(pickLang('vi', 'xx'), 'vi');
});

test('?join= on the office page: only an invite link is taken', () => {
  assert.equal(inviteFromSearch(`?join=${encodeURIComponent(LINK)}`), LINK);
  assert.equal(inviteFromSearch('?join=https%3A%2F%2Fevil.test%2Fnot-an-invite'), null);
  assert.equal(inviteFromSearch('?join=javascript%3Aalert(1)'), null);
  assert.equal(inviteFromSearch('?layout=hq'), null);
  assert.equal(inviteFromSearch(''), null);
});

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node without node:sqlite: skipped */ }
test('the team\'s name for the invite page; a team that doesn\'t exist gets nothing written', { skip: !DatabaseSync && 'needs node:sqlite' }, async () => {
  const db = new DatabaseSync(':memory:');
  const sql = { exec: (q, ...b) => { const rows = db.prepare(q).all(...b); return { toArray: () => rows }; } };
  const clock = { t: 1_800_000_000_000 }, teamId = randomId(16), core = new TeamCore(sql, { now: () => clock.t });
  const name = () => core.handle({ method: 'GET', path: `/t/${teamId}/name`, body: '', headers: new Headers(), teamId, action: 'name', hub: 'https://hub.test' });
  assert.deepEqual((await name()).body, { name: null, expired: false });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n, 0);
  const keys = await generateKeys(), body = JSON.stringify({ team: 'Gamota', name: 'An' });
  await core.handle({ method: 'POST', path: '/teams', body, headers: await signRequest(keys, { method: 'POST', path: '/teams', body, now: clock.t }), teamId, action: 'create', hub: 'https://hub.test' });
  assert.deepEqual((await name()).body, { name: 'Gamota', expired: false });
});
