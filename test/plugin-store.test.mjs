// test/plugin-store.test.mjs — install/update/uninstall/enable/list/doctor/link.
// Real local git repos (offline); exec is injected: git/tar pass through to the
// real binaries, npm/uv are FAKED (create node_modules / throw) so no network
// and no real installs ever run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync,
  readlinkSync, lstatSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  pluginDir, pluginCurrentDir, pluginDataDir, readPluginsLock, pluginsRoot, writePluginsLock,
} from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import {
  installPlugin, buildInstallInventory, runSetup, updatePlugin, uninstallPlugin,
  setPluginEnabled, listInstalledPlugins, doctorPlugin, linkPlugin,
  listOrphanPluginData, purgePluginData,
} from '../src/core/plugin-store.mjs';

useTempHome(after);
// plugin-shim.mjs (Task 11) may or may not exist while this file runs. When it
// does, doctorPlugin's lazy import wires the validateConfig check through
// callSource; WORCA_MOCK=1 short-circuits that to a canned {ok:true} instead
// of spawning the demo connector (which implements no ops), keeping this suite
// deterministic either way. The shim's own tests cover the real spawn path.
process.env.WORCA_MOCK = '1';
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-store-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

async function git(cwd, ...args) {
  const { stdout } = await execFileP('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd });
  return stdout.trim();
}
function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}
/** git/tar pass through; npm is faked (mkdir node_modules) or made to throw. */
function makeExec({ npmFails = false } = {}) {
  const calls = [];
  const exec = async (cmd, args, opts = {}) => {
    calls.push([cmd, ...args]);
    if (cmd === 'npm') {
      if (npmFails) throw new Error('npm ci exploded (simulated)');
      mkdirSync(join(args[args.indexOf('--prefix') + 1], 'node_modules'), { recursive: true });
      return { stdout: '', stderr: '' };
    }
    if (cmd === 'uv') return { stdout: '', stderr: '' };
    return execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });
  };
  return { calls, exec };
}

const PLUGIN_FILES = (name) => ({
  'worca-cc-plugin.json': JSON.stringify({
    name, version: '0.1.0', engines: { 'worca-cc-api': '>=1 <2' },
    taskSources: [{
      id: 'demo', displayName: 'Demo', module: './connector/index.mjs',
      configSchema: [{ key: 'token', type: 'text', secret: true, required: true, label: 'Token' }],
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
    }],
    setup: { node: true },
  }),
  'connector/index.mjs': 'export default () => ({});\n',
  'package.json': JSON.stringify({ name, version: '0.1.0' }),
  'package-lock.json': JSON.stringify({
    name, lockfileVersion: 3,
    packages: { '': { name }, 'node_modules/left-pad': { version: '1.3.0' } },
  }),
  'agents/demoAgent.meta.json': JSON.stringify({ key: 'demoAgent', order: 90 }),
  'agents/demoAgent.md': '---\nname: demo-agent\ntools: Read, Bash\n---\nYou are demo.\n',
  'skills/demo-skill/SKILL.md': '# demo skill\n',
  'workflows/demo-flow.json': JSON.stringify({
    name: 'Demo Flow', steps: [[{ id: 's0', key: 'demoAgent' }]], feedbacks: [],
  }),
});

async function makeOriginRepo(dirName, name) {
  const root = join(scratch, dirName);
  mkdirSync(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  writeTree(root, PLUGIN_FILES(name));
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  return { root, sha: await git(root, 'rev-parse', 'HEAD') };
}

const NAME = 'demo-plugin';
let origin; // { root, sha } shared across the sequential tests below

test('installPlugin: happy path — export, setup, precheck, symlink swap, lock, inventory', async () => {
  origin = await makeOriginRepo('origin', NAME);
  const { calls, exec } = makeExec();
  const r = await installPlugin({ repoUrl: origin.root, subdir: '', name: NAME, sha: origin.sha }, { exec });
  assert.equal(r.ok, true);

  const sha7 = origin.sha.slice(0, 7);
  const current = pluginCurrentDir(NAME);
  assert.ok(lstatSync(current).isSymbolicLink());
  assert.equal(readlinkSync(current), join('versions', sha7), 'relative symlink target');
  assert.equal(existsSync(join(current, 'worca-cc-plugin.json')), true, 'current resolves');
  assert.equal(existsSync(join(current, 'node_modules')), true, 'fake npm ci ran');
  assert.ok(calls.some((c) => c[0] === 'npm' && c.includes('ci') && c.includes('--ignore-scripts') && c.includes('--omit=dev')));
  assert.equal(existsSync(`${current}.tmp`), false, 'swap left no current.tmp');

  const entry = readPluginsLock()[NAME];
  assert.equal(entry.repo, origin.root);
  assert.equal(entry.subdir, '');
  assert.equal(entry.pinnedSha, origin.sha);
  assert.equal(entry.version, '0.1.0');
  assert.equal(entry.enabled, true);
  assert.match(entry.installedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(entry.lockfileHash, /^[0-9a-f]{64}$/);

  // "Will install" inventory (spec §6.1)
  assert.deepEqual(r.inventory.agents, [{ key: 'demoAgent', tools: ['Read', 'Bash'] }]);
  assert.deepEqual(r.inventory.taskSources, [{ id: 'demo', displayName: 'Demo', secrets: ['token'] }]);
  assert.deepEqual(r.inventory.skills, ['demo-skill']);
  assert.deepEqual(r.inventory.workflows, ['demo-flow']);
  assert.equal(r.inventory.depCount, 1);
  assert.match(r.inventory.setupCommands[0], /^npm ci --prefix .*--ignore-scripts --omit=dev$/);
  await assert.rejects(() => installPlugin({ repoUrl: origin.root, subdir: '', name: NAME, sha: origin.sha }, { exec }),
    /already installed/);
});

test('setPluginEnabled toggles the lock flag; listInstalledPlugins reflects it', async () => {
  setPluginEnabled(NAME, false);
  assert.equal(readPluginsLock()[NAME].enabled, false);
  let row = listInstalledPlugins().find((p) => p.name === NAME);
  assert.equal(row.enabled, false);
  setPluginEnabled(NAME, true);
  row = listInstalledPlugins().find((p) => p.name === NAME);
  assert.deepEqual(
    { enabled: row.enabled, linked: row.linked, version: row.version, pinnedSha: row.pinnedSha },
    { enabled: true, linked: false, version: '0.1.0', pinnedSha: origin.sha },
  );
  assert.deepEqual(row.contributions, { agents: 1, taskSources: 1, chatChannels: 0, models: 0, skills: 1, workflows: 1 });
  assert.throws(() => setPluginEnabled('ghost-plugin', true), /not installed/);
});

test('updatePlugin: swap to candidate; GC keeps last 2 versions; atomic swap', async () => {
  const { exec } = makeExec();
  // commit 2
  writeFileSync(join(origin.root, 'connector/index.mjs'), 'export default () => ({ v: 2 });\n');
  await git(origin.root, 'add', '-A'); await git(origin.root, 'commit', '-qm', 'c2');
  const sha2 = await git(origin.root, 'rev-parse', 'HEAD');
  const r2 = await updatePlugin(NAME, { exec });
  assert.equal(r2.updated, true);
  assert.deepEqual(r2.commits.map((c) => c.subject), ['c2']);
  assert.equal(readlinkSync(pluginCurrentDir(NAME)), join('versions', sha2.slice(0, 7)));
  assert.equal(readPluginsLock()[NAME].pinnedSha, sha2);
  // commit 3 -> GC drops c1
  writeFileSync(join(origin.root, 'connector/index.mjs'), 'export default () => ({ v: 3 });\n');
  await git(origin.root, 'add', '-A'); await git(origin.root, 'commit', '-qm', 'c3');
  const sha3 = await git(origin.root, 'rev-parse', 'HEAD');
  await updatePlugin(NAME, { exec });
  const kept = readdirSync(join(pluginDir(NAME), 'versions')).sort();
  assert.deepEqual(kept, [sha2.slice(0, 7), sha3.slice(0, 7)].sort(), 'GC keeps current + previous only');
  assert.equal(existsSync(`${pluginCurrentDir(NAME)}.tmp`), false);
  // no candidate -> no-op
  const noop = await updatePlugin(NAME, { exec });
  assert.equal(noop.updated, false);
});

test('doctorPlugin: detects missing node_modules when setup.node; heals detection on restore', async () => {
  const cur = pluginCurrentDir(NAME);
  const target = join(pluginDir(NAME), readlinkSync(cur));
  rmSync(join(target, 'node_modules'), { recursive: true, force: true });
  const sick = await doctorPlugin(NAME);
  assert.equal(sick.ok, false);
  const dep = sick.checks.find((c) => c.id === 'node-deps');
  assert.equal(dep.ok, false);
  mkdirSync(join(target, 'node_modules'), { recursive: true });
  const well = await doctorPlugin(NAME);
  assert.equal(well.ok, true);
  for (const id of ['installed', 'current', 'manifest', 'api', 'module:demo', 'node-deps', 'lock-hash']) {
    assert.ok(well.checks.some((c) => c.id === id && c.ok), `check ${id} present+ok`);
  }
  const ghost = await doctorPlugin('ghost-plugin');
  assert.equal(ghost.ok, false);
  assert.equal(ghost.checks[0].id, 'installed');
});

test('uninstallPlugin keeps data/ by default; purge removes everything', async () => {
  writePluginConfig(NAME, [{ key: 'token', secret: true }], { token: 'keep' });
  const r = await uninstallPlugin(NAME);
  assert.equal(r.ok, true);
  assert.equal(r.dataKept, true);
  assert.match(r.note, /kept/);
  assert.equal(existsSync(join(pluginDataDir(NAME), 'secrets.json')), true, 'secrets survive uninstall');
  assert.equal(existsSync(join(pluginDir(NAME), 'versions')), false);
  assert.equal(existsSync(pluginCurrentDir(NAME)), false);
  assert.equal(readPluginsLock()[NAME], undefined);
  // reinstall (cache re-clones from the origin path), then purge
  const { exec } = makeExec();
  await installPlugin({ repoUrl: origin.root, subdir: '', name: NAME }, { exec }); // sha omitted -> HEAD
  const p = await uninstallPlugin(NAME, { purge: true });
  assert.equal(p.dataKept, false);
  assert.equal(existsSync(pluginDir(NAME)), false, 'purge removes the whole plugin dir');
  await assert.rejects(() => uninstallPlugin(NAME), /not installed/);
});

test('installPlugin: failure mid-setup leaves NO version dir, NO current, NO lock entry', async () => {
  const bad = await makeOriginRepo('origin-bad', 'bad-plugin');
  const { exec } = makeExec({ npmFails: true });
  await assert.rejects(
    () => installPlugin({ repoUrl: bad.root, subdir: '', name: 'bad-plugin', sha: bad.sha }, { exec }),
    /npm ci exploded/,
  );
  assert.equal(existsSync(pluginDir('bad-plugin')), false, 'partial versions/<sha7> cleaned, dir tidied');
  assert.equal(readPluginsLock()['bad-plugin'], undefined);
});

test('runSetup: setup.node without package-lock.json is rejected before running anything', async () => {
  const dir = join(scratch, 'nolock');
  writeTree(dir, { 'worca-cc-plugin.json': '{}' });
  const { calls, exec } = makeExec();
  await assert.rejects(
    () => runSetup(dir, { setup: { node: true, python: null } }, { exec }),
    /package-lock\.json is missing/,
  );
  assert.deepEqual(calls, [], 'no command ran');
});

test('linkPlugin: dev-mode absolute symlink + linked lock entry', async () => {
  const dev = join(scratch, 'dev-linked');
  writeTree(dev, PLUGIN_FILES('linked-plugin'));
  const r = linkPlugin('linked-plugin', dev);
  assert.equal(r.ok, true);
  const cur = pluginCurrentDir('linked-plugin');
  assert.ok(lstatSync(cur).isSymbolicLink());
  assert.ok(isAbsolute(readlinkSync(cur)));
  assert.equal(readPluginsLock()['linked-plugin'].linked, true);
  const row = listInstalledPlugins().find((p) => p.name === 'linked-plugin');
  assert.equal(row.linked, true);
  assert.equal(row.contributions.agents, 1);
  assert.throws(() => linkPlugin('wrong-name', dev), /does not match/);
});

test('buildInstallInventory works directly against any version dir', () => {
  const dir = join(scratch, 'inv');
  writeTree(dir, PLUGIN_FILES('inv-plugin'));
  const inv = buildInstallInventory(dir);
  assert.deepEqual(inv.agents, [{ key: 'demoAgent', tools: ['Read', 'Bash'] }]);
  assert.equal(inv.depCount, 1);
  assert.equal(inv.setupCommands.length, 1);
});

// --- orphan data listing + purge (spec: docs/superpowers/specs/2026-07-13-plugin-purge-ui-design.md) ---

test('listOrphanPluginData: empty root, ignores installed + dataless + bad-name dirs', () => {
  // clean slate: whatever earlier tests left, remember it to restore after
  const lockBefore = readPluginsLock();
  assert.deepEqual(
    listOrphanPluginData().filter((o) => o.name === 'ghost-a'), [],
    'no ghost-a orphan yet',
  );
  // orphan: dir + data/, NOT in lock
  mkdirSync(join(pluginDataDir('ghost-a')), { recursive: true });
  writeFileSync(join(pluginDataDir('ghost-a'), 'secrets.json'), '{"token":"x"}');
  // dataless leftover: dir but no data/ -> not an orphan
  mkdirSync(join(pluginsRoot(), 'ghost-empty'), { recursive: true });
  // invalid name -> skipped even with data/
  mkdirSync(join(pluginsRoot(), 'Bad_Name', 'data'), { recursive: true });
  // names that pass a naive lowercase check but fail the safeName gate
  // (digit-first, >64 chars) -> skipped, and the listing must not throw
  mkdirSync(join(pluginsRoot(), '9ghost', 'data'), { recursive: true });
  mkdirSync(join(pluginsRoot(), 'a'.repeat(65), 'data'), { recursive: true });
  // installed: in lock -> not an orphan even with data/
  writePluginsLock({ ...lockBefore, 'ghost-installed': { pinnedSha: 'x'.repeat(40), enabled: true } });
  mkdirSync(join(pluginDataDir('ghost-installed')), { recursive: true });

  const names = listOrphanPluginData().map((o) => o.name);
  assert.ok(names.includes('ghost-a'), 'orphan with data/ listed');
  assert.ok(!names.includes('ghost-empty'), 'dir without data/ skipped');
  assert.ok(!names.includes('Bad_Name'), 'invalid name skipped');
  assert.ok(!names.includes('9ghost'), 'digit-first name skipped without throwing');
  assert.ok(!names.includes('a'.repeat(65)), 'over-long name skipped without throwing');
  assert.ok(!names.includes('ghost-installed'), 'installed plugin skipped');
  const ghost = listOrphanPluginData().find((o) => o.name === 'ghost-a');
  assert.equal(ghost.dataDir, pluginDataDir('ghost-a'));

  writePluginsLock(lockBefore); // restore for later tests
});

test('purgePluginData: removes orphan dir; refuses installed; unknown throws', () => {
  const lockBefore = readPluginsLock();
  assert.equal(existsSync(pluginDir('ghost-a')), true, 'fixture from previous test present');
  const r = purgePluginData('ghost-a');
  assert.equal(r.ok, true);
  assert.equal(existsSync(pluginDir('ghost-a')), false, 'whole plugin dir gone');

  // still installed -> refuse with code INSTALLED
  writePluginsLock({ ...lockBefore, 'ghost-installed': { pinnedSha: 'x'.repeat(40), enabled: true } });
  assert.throws(() => purgePluginData('ghost-installed'), (e) => e.code === 'INSTALLED');
  writePluginsLock(lockBefore);

  // nothing there -> plain error
  assert.throws(() => purgePluginData('never-existed'), /nothing to purge/);

  // safeName-invalid name -> same "nothing to purge" contract, never "invalid plugin name"
  assert.throws(() => purgePluginData('9ghost'), /nothing to purge/);
});

// --- model contributions (design §9.4): inventory, uninstall guard, doctor ---

const MODELFUL_FILES = (name) => ({
  'worca-cc-plugin.json': JSON.stringify({
    name, version: '0.1.0',
    modelSecrets: [{ key: 'ds-token', label: 'DS token' }],
    models: [
      {
        id: 'ds-stable', label: 'DS Stable', efforts: ['medium', 'high'],
        env: { ANTHROPIC_BASE_URL: 'https://api.ds.example', ANTHROPIC_AUTH_TOKEN: { secret: 'ds-token' } },
      },
      { id: 'ds-plain', label: 'DS Plain' },
    ],
  }),
});

test('buildInstallInventory: models section — base URL verbatim, env keys, model secrets', () => {
  const dir = join(scratch, 'inv-models');
  writeTree(dir, MODELFUL_FILES('modelful-plugin'));
  const inv = buildInstallInventory(dir);
  assert.deepEqual(inv.models, [
    {
      id: 'ds-stable', label: 'DS Stable', efforts: ['medium', 'high'],
      envKeys: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'],
      baseUrl: 'https://api.ds.example',
    },
    { id: 'ds-plain', label: 'DS Plain', efforts: ['medium', 'high', 'xhigh', 'max'], envKeys: [], baseUrl: null },
  ]);
  assert.deepEqual(inv.modelSecrets, [{ key: 'ds-token', label: 'DS token' }]);
});

test('doctor + uninstall guard for plugin models: block-with-list, clear, then uninstall', async () => {
  const dev = join(scratch, 'dev-modelful');
  writeTree(dev, MODELFUL_FILES('modelful-plugin'));
  linkPlugin('modelful-plugin', dev);
  const row = listInstalledPlugins().find((p) => p.name === 'modelful-plugin');
  assert.equal(row.contributions.models, 2);

  // Doctor: unset model secret is a named failing check; setting it heals.
  let doc = await doctorPlugin('modelful-plugin');
  const sick = doc.checks.find((c) => c.id === 'model-secret:ds-token');
  assert.equal(sick.ok, false);
  assert.match(sick.detail, /not set/);
  writePluginConfig('modelful-plugin', [{ key: 'ds-token', secret: true }], { 'ds-token': 'sk-team' });
  doc = await doctorPlugin('modelful-plugin');
  assert.equal(doc.checks.find((c) => c.id === 'model-secret:ds-token').ok, true);

  // A pipeline node selection blocks uninstall with the references list.
  const { setNodeModel } = await import('../src/core/config.mjs');
  const proj = join(scratch, 'proj-modelful');
  mkdirSync(proj, { recursive: true });
  await setNodeModel(proj, 'wf_m', 's1_0', { model: 'ds-stable', effort: 'high' });
  await assert.rejects(() => uninstallPlugin('modelful-plugin'), (err) => {
    assert.match(err.message, /models are still selected in pipeline configuration: ds-stable \(1 selection\)/);
    assert.equal(err.code, 'REFERENCED');
    assert.equal(err.references[0].id, 'ds-stable');
    assert.equal(err.references[0].nodes.length, 1);
    return true;
  });
  assert.ok(readPluginsLock()['modelful-plugin'], 'nothing uninstalled');

  await setNodeModel(proj, 'wf_m', 's1_0', { model: '', effort: '' });
  const r = await uninstallPlugin('modelful-plugin', { purge: true });
  assert.equal(r.ok, true);
});
