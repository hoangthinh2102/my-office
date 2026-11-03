import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSkills } from '../../server/skills.mjs';

/* Settings → Skills (server/skills.mjs): personal skills from a folder (linked or copied), removing them, and the
   marketplace through a pretend `claude` command that answers like `claude plugin … --json`. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-skills-'));
  const claudeDir = path.join(root, 'claude'), dataDir = path.join(root, 'data'), mine = path.join(root, 'mine');
  const skill = (dir, name, desc = `does ${name}`) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\nBody\n`); return dir; };
  const calls = path.join(root, 'calls.txt'), bin = path.join(root, 'fake-claude');
  fs.writeFileSync(bin, `#!/bin/sh
echo "$@" >> "${calls}"
case "$2 $3" in
  "list --available") if [ -f "${root}/installed" ]; then echo '{"installed":[{"id":"git-tools@m"}],"available":[{"pluginId":"code-review@m","name":"code-review","description":"Review pull requests","marketplaceName":"m","installCount":50},{"pluginId":"paint@m","name":"paint","description":"Draw","marketplaceName":"m","installCount":5}]}'; else echo '{"installed":[],"available":[{"pluginId":"code-review@m","name":"code-review","description":"Review pull requests","marketplaceName":"m","installCount":50},{"pluginId":"git-tools@m","name":"git-tools","description":"Git helpers for review","marketplaceName":"m","installCount":900},{"pluginId":"paint@m","name":"paint","description":"Draw","marketplaceName":"m","installCount":5}]}'; fi ;;
  "list --json") echo '[{"id":"git-tools@m","version":"1.0.0","scope":"user","enabled":true,"installPath":"${root}/gt"}]' ;;
  "marketplace list") echo '[{"name":"m","source":"github","repo":"owner/m"}]' ;;
  "install nope@m") echo '{"command":"install","outcome":"failed","message":"Plugin not found","failureCode":"not_found"}' ;;
  "install "*|"uninstall "*) echo '{"outcome":"ok"}' ;;
  "marketplace add") echo '{"outcome":"ok","marketplace":"x"}' ;;
esac
`, { mode: 0o755 });
  const s = createSkills({ claudeDir, dataDir, claude: () => bin, home: root });
  return { root, claudeDir, dataDir, mine, skill, s, calls: () => fs.readFileSync(calls, 'utf8').trim().split('\n'), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('a skill from your folder is a link by default, or a copy; a folder of skills adds them all', async () => {
  const t = setup();
  try {
    const one = t.skill(path.join(t.mine, 'one'), 'review');
    t.skill(path.join(t.mine, 'many', 'a'), 'alpha'); t.skill(path.join(t.mine, 'many', 'b'), 'beta');
    fs.mkdirSync(path.join(t.mine, 'many', 'not-a-skill'));
    assert.deepEqual(await t.s.addFolder({ dir: one }), { added: ['review'], skipped: [] });
    assert.equal(fs.readlinkSync(path.join(t.claudeDir, 'skills', 'review')), one);
    const many = await t.s.addFolder({ dir: path.join(t.mine, 'many'), copy: true });
    assert.deepEqual(many.added.sort(), ['alpha', 'beta']);
    assert.equal(fs.lstatSync(path.join(t.claudeDir, 'skills', 'alpha')).isSymbolicLink(), false);
    assert.ok(fs.existsSync(path.join(t.claudeDir, 'skills', 'alpha', 'SKILL.md')));
    // ~ means home; the same name twice is refused, never overwritten
    t.skill(path.join(t.root, 'other'), 'review', 'another review');
    await assert.rejects(t.s.addFolder({ dir: '~/other' }), { code: 'exists' });
    assert.equal(fs.readlinkSync(path.join(t.claudeDir, 'skills', 'review')), one);
    const again = await t.s.addFolder({ dir: path.join(t.mine, 'many') });
    assert.deepEqual([again.added, again.skipped.map((x) => x.why)], [[], ['exists', 'exists']]);
    // what the list shows
    const list = await t.s.personal();
    assert.deepEqual(list.map((x) => [x.name, x.link, x.desc]), [['alpha', false, 'does alpha'], ['beta', false, 'does beta'], ['review', true, 'does review']]);
    assert.equal(list[2].from, one);
  } finally { t.done(); }
});

test('adding: no folder, a file, no SKILL.md, a folder already in ~/.claude/skills, a name that is not a name', async () => {
  const t = setup();
  try {
    await assert.rejects(t.s.addFolder({ dir: '' }), { code: 'no-folder' });
    await assert.rejects(t.s.addFolder({ dir: path.join(t.root, 'nope') }), { code: 'no-folder' });
    fs.mkdirSync(t.mine, { recursive: true }); fs.writeFileSync(path.join(t.mine, 'f.txt'), 'x');
    await assert.rejects(t.s.addFolder({ dir: path.join(t.mine, 'f.txt') }), { code: 'not-folder' });
    await assert.rejects(t.s.addFolder({ dir: t.mine }), { code: 'no-skill-md' });
    const inside = t.skill(path.join(t.claudeDir, 'skills', 'here'), 'here');
    await assert.rejects(t.s.addFolder({ dir: inside }), { code: 'already-here' });
    await assert.rejects(t.s.addFolder({ dir: t.skill(path.join(t.mine, 'x y'), '../../evil') }), { code: 'bad-name' });
    assert.equal(fs.existsSync(path.join(t.root, 'evil')), false);
  } finally { t.done(); }
});

test('removing: a link only goes away; a folder moves to data/skills-removed; nothing outside ~/.claude/skills', async () => {
  const t = setup();
  try {
    const src = t.skill(path.join(t.mine, 'r'), 'review');
    await t.s.addFolder({ dir: src });
    await t.s.addFolder({ dir: t.skill(path.join(t.mine, 'c'), 'copied'), copy: true });
    assert.deepEqual(await t.s.remove('review'), { name: 'review', was: 'link' });
    assert.ok(fs.existsSync(path.join(src, 'SKILL.md')));   // (your own folder stays)
    const r = await t.s.remove('copied');
    assert.equal(r.was, 'folder');
    assert.ok(r.movedTo.startsWith(path.join(t.dataDir, 'skills-removed')));
    assert.ok(fs.existsSync(path.join(r.movedTo, 'SKILL.md')));
    assert.deepEqual(await t.s.personal(), []);
    for (const bad of ['../data', 'synced', '', 'a/b', null]) await assert.rejects(t.s.remove(bad), { code: 'no-skill' });
    // a link whose folder is gone shows as broken, and can be removed
    const gone = t.skill(path.join(t.mine, 'g'), 'gone');
    await t.s.addFolder({ dir: gone }); fs.rmSync(gone, { recursive: true });
    assert.equal((await t.s.personal())[0].broken, true);
    assert.equal((await t.s.remove('gone')).was, 'link');
  } finally { t.done(); }
});

test('marketplace: search by every word, most installed first; installed ones marked; install and its errors', async () => {
  const t = setup();
  try {
    // git-tools is installed: the catalog leaves it out once it is, so it is remembered from before
    await t.s.search('');
    fs.writeFileSync(path.join(t.root, 'installed'), '');
    fs.mkdirSync(path.join(t.root, 'gt', '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(t.root, 'gt', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'git-tools', description: 'From its manifest' }));
    await t.s.install('paint@m');   // (reads the catalog again)
    const r = await t.s.search('review');
    assert.deepEqual(r.list.map((p) => [p.id, p.installed]), [['git-tools@m', true], ['code-review@m', false]]);
    assert.equal((await t.s.search('review pull')).total, 1);
    assert.equal((await t.s.search('')).list[0].id, 'git-tools@m');
    const all = await t.s.list();
    assert.deepEqual(all.plugins.map((p) => [p.id, p.market, p.desc]), [['git-tools@m', 'm', 'Git helpers for review']]);
    // a plugin never seen in the catalog: its description comes from its own manifest
    const fresh = createSkills({ claudeDir: t.claudeDir, dataDir: t.dataDir, claude: () => path.join(t.root, 'fake-claude') });
    assert.equal((await fresh.plugins())[0].desc, 'From its manifest');
    assert.deepEqual(all.markets, [{ name: 'm', source: 'owner/m' }]);
    await t.s.install('code-review@m');
    await assert.rejects(t.s.install('nope@m'), { code: 'not_found' });
    for (const bad of ['x;rm -rf /', '--yes', '', '@m', 'a@b@c']) await assert.rejects(t.s.install(bad), { code: 'bad-plugin' });
    await t.s.uninstall('git-tools@m');
    await t.s.addMarket('owner/repo');
    for (const bad of ['--flag', 'not valid', '']) await assert.rejects(t.s.addMarket(bad), { code: 'bad-market' });
    const calls = t.calls();
    assert.ok(calls.includes('plugin install code-review@m --json'));
    assert.ok(calls.includes('plugin uninstall git-tools@m --json'));
    assert.ok(calls.includes('plugin marketplace add owner/repo --json'));
    assert.equal(calls.filter((c) => c.startsWith('plugin list --available')).length, 2);   // (kept for a while, read again after each install or removal)
  } finally { t.done(); }
});

test('without the claude command: personal skills still work, the marketplace says why', async () => {
  const t = setup();
  try {
    const s = createSkills({ claudeDir: t.claudeDir, dataDir: t.dataDir, claude: () => null });
    await s.addFolder({ dir: t.skill(path.join(t.mine, 'a'), 'alpha') });
    const l = await s.list();
    assert.deepEqual([l.skills.length, l.plugins, l.problem, l.claude], [1, [], 'no-claude', false]);
    await assert.rejects(s.install('a@m'), { code: 'no-claude' });
  } finally { t.done(); }
});
