// test/plugin-skills-lifecycle.test.mjs — what a plugin update or uninstall does to the skills it ships (skills
// registry spec §5 "Updates are never automatic", §6 board 11): the skill delta, the update preview's lines, the
// memberships an update or an uninstall removes. Offline: fixture dirs and a real local git repo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { put } from './helpers/mcp-store-fixtures.mjs';
import { readMcpStore } from '../src/core/mcp/store.mjs';
import { skillDelta, skillUpdateLines, skillFootprint, removePluginSkills, mcpUpdatePreview, applyMcpUpdate } from '../src/core/mcp/plugin-lifecycle.mjs';

useTempHome(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-skill-life-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const IS_WINDOWS = process.platform === 'win32';
const md = (name, body = '') => `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n${body}`;
/** A plugin version dir: { '<skill>/<rel>': text }; a rel ending in `*` is written executable (the star dropped). */
function versionDir(label, files) {
  const root = join(scratch, label);
  for (const [rel, text] of Object.entries(files)) {
    const exec = rel.endsWith('*');
    const p = join(root, 'skills', exec ? rel.slice(0, -1) : rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    if (exec && !IS_WINDOWS) chmodSync(p, 0o755);
  }
  mkdirSync(root, { recursive: true });
  return root;
}
const ID = (n) => `skill:plugin:acme/${n}`;
const TEAM_ID = 'team-acme-platform-9333';

test('skillDelta: names new, removed and changed skills (content, file set, exec bit); counts the scripts a change adds', () => {
  const pin = versionDir('pin', {
    'same/SKILL.md': md('same'), 'gone/SKILL.md': md('gone'), 'edited/SKILL.md': md('edited', 'v1'),
    'grows/SKILL.md': md('grows'), 'grows/scripts/a.sh*': '#!/bin/sh\n', 'nofile/README.md': 'not a skill',
    ...(IS_WINDOWS ? {} : { 'flips/SKILL.md': md('flips'), 'flips/run.sh': '#!/bin/sh\n' }),
  });
  const cand = versionDir('cand', {
    'same/SKILL.md': md('same'), 'fresh/SKILL.md': md('fresh'), 'edited/SKILL.md': md('edited', 'v2'),
    'grows/SKILL.md': md('grows'), 'grows/scripts/a.sh*': '#!/bin/sh\n', 'grows/scripts/b.sh*': '#!/bin/sh\n', 'grows/scripts/c.py*': 'print(1)\n',
    'nofile/SKILL.md': md('nofile'), 'Not_A_Skill/SKILL.md': md('x'), 'synced/SKILL.md': md('synced'),
    ...(IS_WINDOWS ? {} : { 'flips/SKILL.md': md('flips'), 'flips/run.sh*': '#!/bin/sh\n' }),
  });
  const d = skillDelta(pin, cand);
  assert.deepEqual(d.newSkills, ['fresh', 'nofile'], 'a folder without SKILL.md, or whose name is no skill name (a reserved one too), is no skill');
  assert.deepEqual(d.removedSkills, ['gone']);
  assert.deepEqual(d.changedSkills, IS_WINDOWS ? ['edited', 'grows'] : ['edited', 'flips', 'grows']);
  assert.equal(d.addedScripts.grows, 2, 'two new files under scripts/, both executable: scripts by any reading');
  assert.equal(Object.hasOwn(d.addedScripts, 'edited'), false, 'a change that adds no script carries no count');
  assert.deepEqual(skillDelta(pin, pin), { newSkills: [], removedSkills: [], changedSkills: [], addedScripts: {} });
  const empty = mkdtempSync(join(scratch, 'none-'));
  assert.deepEqual(skillDelta(empty, pin).newSkills, IS_WINDOWS ? ['edited', 'gone', 'grows', 'same'] : ['edited', 'flips', 'gone', 'grows', 'same'], 'no skills/ folder reads as none');
  const notDir = mkdtempSync(join(scratch, 'file-'));
  writeFileSync(join(notDir, 'skills'), 'a file, not a folder');
  assert.deepEqual(skillDelta(notDir, empty), { newSkills: [], removedSkills: [], changedSkills: [], addedScripts: {} }, 'a skills file reads as none');
  // A `.claude-plugin/` folder records no file (the hash is unchanged), yet the catalog lists the skill as invalid.
  const loads = versionDir('loads', { 'held/SKILL.md': md('held') });
  const refused = versionDir('refused', { 'held/SKILL.md': md('held'), 'held/.claude-plugin/plugin.json': '{}\n' });
  assert.deepEqual(skillDelta(loads, refused).changedSkills, ['held'], 'a held skill that stops loading is a changed skill');
  assert.deepEqual(skillDelta(refused, loads).changedSkills, ['held'], 'and one that loads again');
});

const member = (skill, enabled = true) => ({ skill, enabled });
function seedStore() {
  put('sets', {
    sets: {
      general: { name: 'General', members: [], skills: [member(ID('gone'))] },
      billing: { name: 'Billing', slug: 'billing', members: [], skills: [member(ID('gone')), member(ID('edited')), member('skill:plugin:acme-tools/other')] },
      shop: { name: 'Shop', slug: 'shop', members: [], skills: [member(ID('edited'), false), member('skill:library:gone')] },
    },
    teams: { 'acme/platform': { id: TEAM_ID, slug: 'team-platfor', name: 'Team · acme/platform', members: {},
      skills: { [ID('grows')]: { enabled: true, consent: 'h' } } } },
  });
}

test('skillFootprint: the ids and the set names (user and Team) holding a membership', async () => {
  seedStore();
  const snap = await readMcpStore();
  assert.deepEqual(skillFootprint(snap, (id) => id.startsWith('skill:plugin:acme/')), {
    ids: [ID('edited'), ID('gone'), ID('grows')], sets: ['Billing', 'General', 'Shop', 'Team · acme/platform'] });
  assert.deepEqual(skillFootprint(snap, (id) => id === ID('nope')), { ids: [], sets: [] });
});

test('update lines, in order new → removed → changed: red only where a set holds the skill', async () => {
  seedStore();
  const delta = { newSkills: ['fresh'], removedSkills: ['gone', 'unused'], changedSkills: ['edited', 'grows', 'idle'], addedScripts: { grows: 2, idle: 1 } };
  assert.deepEqual(skillUpdateLines('acme', delta, await readMcpStore()), [
    { red: false, text: 'new skill: fresh' },
    { red: true, text: 'SKILL REMOVED: gone — leaves Billing, General' },
    { red: false, text: 'removed skill: unused' },
    { red: true, text: 'SKILL CHANGED: edited — in Billing, Shop' },
    { red: true, text: 'SKILL CHANGED: grows — in Team · acme/platform (+2 scripts)' },
    { red: false, text: 'changed skill: idle (+1 script)' },
  ]);
  assert.deepEqual(skillUpdateLines('acme', { newSkills: [], removedSkills: [], changedSkills: ['constructor'], addedScripts: {} }, await readMcpStore()),
    [{ red: false, text: 'changed skill: constructor' }], 'a skill named like an Object.prototype key reads no count (Object.hasOwn)');
});

test('preview and apply: the MCP part keeps its shape; dirs add the skill delta and lines; apply removes the skills the preview names', async () => {
  seedStore();
  const pin = versionDir('pin2', { 'gone/SKILL.md': md('gone'), 'edited/SKILL.md': md('edited', 'v1') });
  const cand = versionDir('cand2', { 'edited/SKILL.md': md('edited', 'v2'), 'fresh/SKILL.md': md('fresh') });
  const bare = await mcpUpdatePreview('acme', {}, {});
  assert.deepEqual(bare, { newMcpServers: [], removedMcpServers: [], changedMcpServers: [], mcpLines: [], newSkills: [], removedSkills: [], changedSkills: [], skillLines: [] });
  const p = await mcpUpdatePreview('acme', {}, {}, { pinDir: pin, candDir: cand });
  assert.deepEqual([p.newSkills, p.removedSkills, p.changedSkills], [['fresh'], ['gone'], ['edited']]);
  assert.deepEqual(p.skillLines.map((l) => l.text), ['new skill: fresh', 'SKILL REMOVED: gone — leaves Billing, General', 'SKILL CHANGED: edited — in Billing, Shop']);
  await applyMcpUpdate('acme', {}, {});
  assert.equal((await readMcpStore()).sets.general.skills.length, 1, 'no removed skills named: no skill change');
  await applyMcpUpdate('acme', {}, {}, { removedSkills: p.removedSkills });
  const s = await readMcpStore();
  assert.deepEqual(s.sets.general.skills ?? [], []);
  assert.deepEqual(s.sets.billing.skills.map((m) => m.skill), [ID('edited'), 'skill:plugin:acme-tools/other'], 'a changed skill stays; another plugin\'s skill stays');
  assert.deepEqual(s.sets.shop.skills.map((m) => m.skill), [ID('edited'), 'skill:library:gone']);
});

test('removePluginSkills: every skill:plugin:<name>/ membership and Team state — never another plugin\'s or a library skill', async () => {
  seedStore();
  await removePluginSkills('acme');
  const s = await readMcpStore();
  assert.deepEqual(s.sets.general.skills ?? [], []);
  assert.deepEqual(s.sets.billing.skills.map((m) => m.skill), ['skill:plugin:acme-tools/other']);
  assert.deepEqual(s.sets.shop.skills.map((m) => m.skill), ['skill:library:gone']);
  assert.deepEqual(Object.keys(s.teams['acme/platform'].skills ?? {}), []);
});

// ---- the real lifecycle: install → update preview → apply → uninstall (Task 6) -------------------
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFileSync, readlinkSync, existsSync } from 'node:fs';
import { writeMcpPlugin } from './helpers/mcp-plugin-fixture.mjs';
import { file } from './helpers/mcp-store-fixtures.mjs';
import { fetchCandidate } from '../src/core/plugin-repo.mjs';
import { installPlugin, updatePlugin, uninstallPlugin } from '../src/core/plugin-store.mjs';
import { readPluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';

const run = promisify(execFile);
const repo = join(scratch, 'repo');
const git = (...a) => run('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
/** One commit of the acme plugin shipping exactly `skills` ({ '<skill>/<rel>': text }; `*` = executable). */
async function commitAcme(skills, sub = '') {
  const root = join(repo, sub);
  rmSync(join(root, 'skills'), { recursive: true, force: true });
  writeMcpPlugin(root, { name: 'acme', mcpServers: {} });
  for (const [rel, text] of Object.entries(skills)) {
    const exec = rel.endsWith('*');
    const p = join(root, 'skills', exec ? rel.slice(0, -1) : rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    if (exec && !IS_WINDOWS) chmodSync(p, 0o755);
  }
  await git('add', '-A');
  await git('commit', '-qm', 'c');
  return (await git('rev-parse', 'HEAD')).stdout.trim();
}
const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));

test('update preview names the skill delta with set-aware red lines; applying removes the dropped skill, keeps the changed one', async () => {
  await run('git', ['init', '-q', '-b', 'main', repo]);
  const sha = await commitAcme({ 'gone/SKILL.md': md('gone'), 'edited/SKILL.md': md('edited', 'v1'), 'grows/SKILL.md': md('grows'),
    'grows/scripts/a.sh*': '#!/bin/sh\n', 'same/SKILL.md': md('same') });
  await installPlugin({ repoUrl: repo, subdir: '', name: 'acme', sha });
  seedStore();
  await commitAcme({ 'edited/SKILL.md': md('edited', 'v2'), 'grows/SKILL.md': md('grows'), 'grows/scripts/a.sh*': '#!/bin/sh\n',
    'grows/scripts/b.sh*': '#!/bin/sh\n', 'same/SKILL.md': md('same'), 'fresh/SKILL.md': md('fresh') });
  const { manifestDelta: d } = await fetchCandidate('acme');
  assert.deepEqual([d.newSkills, d.removedSkills, d.changedSkills], [['fresh'], ['gone'], ['edited', 'grows']]);
  assert.deepEqual(d.skillLines, [
    { red: false, text: 'new skill: fresh' },
    { red: true, text: 'SKILL REMOVED: gone — leaves Billing, General' },
    { red: true, text: 'SKILL CHANGED: edited — in Billing, Shop' },
    { red: true, text: 'SKILL CHANGED: grows — in Team · acme/platform (+1 script)' },
  ]);
  const out = (await run(process.execPath, [CLI, 'plugin', 'update', 'acme', '--yes'], { cwd: scratch, env: { ...process.env, WORCA_MOCK: '1' } })).stdout;
  assert.ok(d.skillLines.every((l) => out.includes(`\n  ${l.text}\n`)), `the CLI update consent prints the skill lines:\n${out}`);
  const s = await readMcpStore();
  assert.deepEqual(s.sets.general.skills ?? [], [], 'a dropped skill leaves every set');
  assert.deepEqual(s.sets.billing.skills.map((m) => m.skill), [ID('edited'), 'skill:plugin:acme-tools/other']);
  assert.deepEqual(Object.keys(s.teams['acme/platform'].skills ?? {}), [ID('grows')], 'a changed skill keeps its Team state: no re-consent');
});

test('an up-to-date plugin previews no skill delta; a candidate with no skills/ folder removes them all', async () => {
  const { manifestDelta: none } = await fetchCandidate('acme');
  assert.deepEqual([none.newSkills, none.removedSkills, none.changedSkills, none.skillLines], [[], [], [], []], 'up to date: the empty delta');
  rmSync(join(repo, 'skills'), { recursive: true, force: true });
  await git('add', '-A'); await git('commit', '-qm', 'no skills');
  const { manifestDelta: d } = await fetchCandidate('acme');
  assert.deepEqual(d.removedSkills, ['edited', 'fresh', 'grows', 'same']);
  assert.deepEqual(d.newSkills, []);
});

test('a plugin in a repo subdir: the preview reads that subdir\'s skills/ only', async () => {
  const repo2 = join(scratch, 'repo2');
  const git2 = (...a) => run('git', ['-C', repo2, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
  await run('git', ['init', '-q', '-b', 'main', repo2]);
  writeMcpPlugin(join(repo2, 'plugins', 'deep'), { name: 'deep', mcpServers: {}, files: { 'skills/one/SKILL.md': md('one') } });
  writeMcpPlugin(join(repo2, 'plugins', 'other'), { name: 'other', mcpServers: {}, files: { 'skills/elsewhere/SKILL.md': md('elsewhere') } });
  writeFileSync(join(repo2, 'skills-at-root.md'), 'not a plugin skill\n');
  await git2('add', '-A'); await git2('commit', '-qm', 'c1');
  const sha = (await git2('rev-parse', 'HEAD')).stdout.trim();
  await installPlugin({ repoUrl: repo2, subdir: 'plugins/deep', name: 'deep', sha });
  writeMcpPlugin(join(repo2, 'plugins', 'deep'), { name: 'deep', mcpServers: {}, files: { 'skills/two/SKILL.md': md('two') } });
  writeMcpPlugin(join(repo2, 'plugins', 'other'), { name: 'other', mcpServers: {}, files: { 'skills/more/SKILL.md': md('more') } });
  await git2('add', '-A'); await git2('commit', '-qm', 'c2');
  const { manifestDelta: d } = await fetchCandidate('deep');
  assert.deepEqual([d.newSkills, d.removedSkills, d.changedSkills], [['two'], [], []]);
});

test('the preview drops a symlink that escapes the export: a SKILL.md pointing outside is no skill', { skip: IS_WINDOWS }, async () => {
  const repo3 = join(scratch, 'repo3');
  const git3 = (...a) => run('git', ['-C', repo3, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
  await run('git', ['init', '-q', '-b', 'main', repo3]);
  writeMcpPlugin(repo3, { name: 'linky', mcpServers: {}, files: { 'skills/fine/SKILL.md': md('fine') } });
  await git3('add', '-A'); await git3('commit', '-qm', 'c1');
  await installPlugin({ repoUrl: repo3, subdir: '', name: 'linky', sha: (await git3('rev-parse', 'HEAD')).stdout.trim() });
  const outside = join(scratch, 'outside.md');
  writeFileSync(outside, md('evil'));
  mkdirSync(join(repo3, 'skills', 'evil'), { recursive: true });
  symlinkSync(outside, join(repo3, 'skills', 'evil', 'SKILL.md'));
  await git3('add', '-A'); await git3('commit', '-qm', 'c2');
  const { manifestDelta: d } = await fetchCandidate('linky');
  assert.deepEqual(d.newSkills, [], 'the escaping link is removed before the delta reads the tree');
});

test('the preview follows a skills/ folder linked inside the plugin, as the update does', { skip: IS_WINDOWS }, async () => {
  const repo4 = join(scratch, 'repo4');
  const git4 = (...a) => run('git', ['-C', repo4, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
  await run('git', ['init', '-q', '-b', 'main', repo4]);
  writeMcpPlugin(repo4, { name: 'shared-skills', mcpServers: {}, files: { 'shared/foo/SKILL.md': md('foo'), 'shared/keep/SKILL.md': md('keep') } });
  symlinkSync('shared', join(repo4, 'skills'));
  await git4('add', '-A'); await git4('commit', '-qm', 'c1');
  await installPlugin({ repoUrl: repo4, subdir: '', name: 'shared-skills', sha: (await git4('rev-parse', 'HEAD')).stdout.trim() });
  rmSync(join(repo4, 'shared', 'foo'), { recursive: true });
  await git4('add', '-A'); await git4('commit', '-qm', 'c2');
  const { manifestDelta: d } = await fetchCandidate('shared-skills');
  assert.deepEqual([d.newSkills, d.removedSkills], [[], ['foo']], 'what updatePlugin removes, the preview names');
});

test('a damaged registry file refuses an update that removes skills, before anything changes', async () => {
  const pinned = readPluginsLock().acme.pinnedSha;
  const current = readlinkSync(pluginCurrentDir('acme'));
  const damaged = `${readFileSync(file('sets'), 'utf8').trimEnd().slice(0, -1)}, }`;   // a trailing comma
  writeFileSync(file('sets'), damaged);
  await assert.rejects(() => updatePlugin('acme'), /mcp\/sets\.json is damaged/);
  assert.equal(readPluginsLock().acme.pinnedSha, pinned, 'still on the pinned version');
  assert.equal(readlinkSync(pluginCurrentDir('acme')), current, 'current still points at it');
  rmSync(file('sets'));
});

test('GET /api/plugins names the sets holding each plugin\'s skills; uninstall removes every one of them', async () => {
  seedStore();
  const { app } = await import('../ui/server.mjs');
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const rows = (await (await fetch(`http://127.0.0.1:${srv.address().port}/api/plugins`)).json()).plugins;
    const acme = rows.find((p) => p.name === 'acme');
    assert.deepEqual(acme.skillSets, ['Billing', 'General', 'Shop', 'Team · acme/platform']);
    assert.deepEqual(acme.mcpSets, []);
  } finally { await new Promise((r) => srv.close(r)); }
  await uninstallPlugin('acme');
  const s = await readMcpStore();
  assert.deepEqual(s.sets.general.skills ?? [], []);
  assert.deepEqual(s.sets.billing.skills.map((m) => m.skill), ['skill:plugin:acme-tools/other'], 'another plugin\'s skills stay');
  assert.deepEqual(s.sets.shop.skills.map((m) => m.skill), ['skill:library:gone']);
  assert.deepEqual(Object.keys(s.teams['acme/platform'].skills ?? {}), [], 'its Team state goes too');
});

test('the apply removes exactly what the preview names, also after a rollback re-pointed current at an older version', { skip: IS_WINDOWS }, async () => {
  const repo5 = join(scratch, 'repo5');
  const git5 = (...a) => run('git', ['-C', repo5, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
  const head5 = async () => (await git5('rev-parse', 'HEAD')).stdout.trim();
  await run('git', ['init', '-q', '-b', 'main', repo5]);
  writeMcpPlugin(repo5, { name: 'rolled', mcpServers: {}, files: { 'skills/gone/SKILL.md': md('gone'), 'skills/keep/SKILL.md': md('keep') } });
  await git5('add', '-A'); await git5('commit', '-qm', 'a');
  const a = await head5();
  await installPlugin({ repoUrl: repo5, subdir: '', name: 'rolled', sha: a });
  writeFileSync(join(repo5, 'NOTES.md'), 'b\n');
  await git5('add', '-A'); await git5('commit', '-qm', 'b');
  await updatePlugin('rolled');
  // The rollback updatePlugin documents: re-point `current` at the previous version (the lock still pins b).
  const cur = pluginCurrentDir('rolled');
  rmSync(cur);
  symlinkSync(join('versions', a.slice(0, 7)), cur);
  rmSync(join(repo5, 'skills', 'gone'), { recursive: true });
  await git5('add', '-A'); await git5('commit', '-qm', 'c');
  put('sets', { sets: { general: { name: 'General', members: [], skills: [member('skill:plugin:rolled/gone'), member('skill:plugin:rolled/keep')] } }, teams: {} });
  const { manifestDelta: d } = await fetchCandidate('rolled');
  assert.deepEqual(d.skillLines, [{ red: true, text: 'SKILL REMOVED: gone — leaves General' }]);
  await updatePlugin('rolled');
  assert.deepEqual((await readMcpStore()).sets.general.skills.map((m) => m.skill), ['skill:plugin:rolled/keep'], 'the skill the preview named left General');
});

// macOS and Windows file systems ignore case: the catalog reads a plugin's `Skills/` as `skills/`, so the preview must too.
const caseProbe = mkdtempSync(join(scratch, 'case-'));
mkdirSync(join(caseProbe, 'skills'));
const CASE_INSENSITIVE = existsSync(join(caseProbe, 'SKILLS'));

test('a plugin that ships Skills/ (another case): the preview names what the catalog loads, and the apply removes it', { skip: !CASE_INSENSITIVE && 'a case-sensitive file system: neither the catalog nor the preview reads Skills/' }, async () => {
  const repo6 = join(scratch, 'repo6');
  const git6 = (...a) => run('git', ['-C', repo6, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
  await run('git', ['init', '-q', '-b', 'main', repo6]);
  writeMcpPlugin(repo6, { name: 'casey', mcpServers: {}, files: { 'Skills/deploy/SKILL.md': md('deploy'), 'Skills/gone/SKILL.md': md('gone') } });
  await git6('add', '-A'); await git6('commit', '-qm', 'a');
  await installPlugin({ repoUrl: repo6, subdir: '', name: 'casey', sha: (await git6('rev-parse', 'HEAD')).stdout.trim() });
  put('sets', { sets: { general: { name: 'General', members: [], skills: [member('skill:plugin:casey/deploy'), member('skill:plugin:casey/gone')] } }, teams: {} });
  rmSync(join(repo6, 'Skills', 'gone'), { recursive: true });
  writeFileSync(join(repo6, 'Skills', 'deploy', 'notes.md'), 'v2\n');
  await git6('add', '-A'); await git6('commit', '-qm', 'b');
  const { manifestDelta: d } = await fetchCandidate('casey');
  assert.deepEqual(d.skillLines, [
    { red: true, text: 'SKILL REMOVED: gone — leaves General' },
    { red: true, text: 'SKILL CHANGED: deploy — in General' },
  ]);
  await updatePlugin('casey');
  assert.deepEqual((await readMcpStore()).sets.general.skills.map((m) => m.skill), ['skill:plugin:casey/deploy'], 'the removed skill left General');
});

// ---- the Plugins view: update preview lines and the uninstall confirm (Task 7) -------------------
import { JSDOM } from 'jsdom';
import { renderUpdatePreview } from '../ui/public/plugins-view.mjs';
import { removeChanges } from '../ui/public/marketplace/installed-model.mjs';
import { renderRemoveDialog } from '../ui/public/marketplace/remove-view.mjs';

test('Plugins view: skill lines join the review lines (red ones in the secret style); Remove carries the sets its skills leave', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const preview = { pinnedSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), commits: [{ sha: 'b'.repeat(40), subject: 'skills' }], diffstat: '',
    manifestDelta: { mcpLines: [{ red: false, text: 'new MCP server: linear' }], skillLines: [
      { red: false, text: 'new skill: fresh' },
      { red: true, text: 'SKILL REMOVED: gone — leaves Billing, General' },
      { red: true, text: 'SKILL CHANGED: grows — in Team · acme/platform (+1 script)' },
    ] } };
  const el = renderUpdatePreview({ preview }, { doc });
  assert.deepEqual([...el.querySelectorAll('.pl-manifest-delta > div')].map((n) => [n.className, n.textContent]), [
    ['pl-delta', 'new MCP server: linear'],
    ['pl-delta', 'new skill: fresh'],
    ['pl-delta-secret', 'SKILL REMOVED: gone — leaves Billing, General'],
    ['pl-delta-secret', 'SKILL CHANGED: grows — in Team · acme/platform (+1 script)'],
  ]);
  assert.ok(el.querySelector('.pl-confirm-update'), 'never automatic: Apply is a click');
  const { body } = renderRemoveDialog(doc, { name: 'acme', iconKind: 'skills', goesAway: [],
    changes: removeChanges({ name: 'acme', contributions: {}, mcpSets: [], skillSets: ['Billing', 'Team · acme/platform'] }, { skills: ['deploy'] }) });
  assert.deepEqual([...body.querySelectorAll('.mk-changes > li')].map((li) => [li.querySelector('.badge').textContent, li.querySelector('.mk-meta').textContent]),
    [['Billing', 'loses the deploy skill'], ['Team · acme/platform', 'loses the deploy skill']], 'the Remove dialog names the skill sets (board 11)');
  assert.deepEqual(removeChanges({ name: 'x', contributions: {} }, null), []);
});
