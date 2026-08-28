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
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  pluginDir, pluginCurrentDir, pluginDataDir, readPluginsLock, pluginsRoot, writePluginsLock,
} from '../src/core/plugins-lock.mjs';
import { writePluginConfig, createProfile } from '../src/core/plugin-config.mjs';
import { setBinding, listBindingsForScope } from '../src/core/source-bindings.mjs';
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
// `current` -> version dir link target: POSIX keeps a relative "versions/<sha7>"
// symlink; Windows uses an absolute directory junction (a plain symlink needs
// elevated privileges). Assert the target per-platform.
const curTarget = (name, sha7) =>
  process.platform === 'win32'
    ? resolve(pluginDir(name), 'versions', sha7)
    : join('versions', sha7);
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
      mkdirSync(join(opts.cwd, 'node_modules'), { recursive: true }); // runSetup scopes npm ci via cwd
      return { stdout: '', stderr: '' };
    }
    if (cmd === 'uv') return { stdout: '', stderr: '' };
    return execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });
  };
  return { calls, exec };
}

/** API-3 data (meta v2 sidecar + v2 graph template) — validatePluginDir gates
 *  both, and the install precheck refuses a plugin whose declared range admits
 *  API 3 while its data does not. */
const V2_SIDECAR = {
  metaVersion: 2, key: 'demoAgent', agentFile: 'demoAgent.md', displayName: 'Demo Agent',
  runnerType: 'producer', order: 90,
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'plan', type: 'md', filename: 'plan.md' }],
};
const V2_TEMPLATE = {
  name: 'Demo Flow', version: 2, domain: 'general',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_a', kind: 'agent', key: 'demoAgent', x: 320, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
    { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
  ],
};
/** The API-1 data this plugin used to ship — kept as an explicit override so the
 *  apiMismatch tests state exactly what is outdated. */
const V1_SIDECAR = { key: 'demoAgent', order: 90 };
const V1_TEMPLATE = { name: 'Demo Flow', steps: [[{ id: 's0', key: 'demoAgent' }]], feedbacks: [] };

const PLUGIN_FILES = (name) => ({
  'worca-cc-plugin.json': JSON.stringify({
    name, version: '0.1.0', engines: { 'worca-cc-api': '>=3 <4' },
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
  'agents/demoAgent.meta.json': JSON.stringify(V2_SIDECAR),
  'agents/demoAgent.md': '---\nname: demo-agent\ntools: Read, Bash\n---\nYou are demo.\n',
  'skills/demo-skill/SKILL.md': '# demo skill\n',
  'workflows/demo-flow.json': JSON.stringify(V2_TEMPLATE),
});

/** The file's real install path: lay a plugin tree down and dev-LINK it, which
 *  writes `current` + the lock entry. */
function installLocal(name, files = {}) {
  const dir = join(scratch, `local-${name}`);
  writeTree(dir, { ...PLUGIN_FILES(name), ...files });
  linkPlugin(name, dir);
  return dir;
}

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
  assert.equal(readlinkSync(current), curTarget(NAME, sha7), 'current -> versions/<sha7>');
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
  assert.equal(readlinkSync(pluginCurrentDir(NAME)), curTarget(NAME, sha2.slice(0, 7)));
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
  const link = readlinkSync(cur); // absolute on a Windows junction, relative on a POSIX symlink
  const target = isAbsolute(link) ? link : join(pluginDir(NAME), link);
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
  // Bindings live in the DB, not in data/: uninstall must drop them (CLI path
  // included) or a reinstall with a same-named profile silently rebinds.
  setBinding({ scopeType: 'project', scopeKey: 'proj-x', plugin: NAME, sourceId: 'demo' }, 'work');
  const r = await uninstallPlugin(NAME);
  assert.equal(r.ok, true);
  assert.equal(r.dataKept, true);
  assert.match(r.note, /kept/);
  assert.deepEqual(listBindingsForScope('project', 'proj-x'), [], 'bindings cleared with the uninstall');
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

test('doctorPlugin: a multiProfile source with an EMPTY roster is unhealthy, not green', async () => {
  // Every run of such a source is rejected ("profile is required") until a
  // profile exists — validating the implicit default bucket instead can report
  // green off migrated legacy config while nothing can actually run.
  const dir = join(scratch, 'profiled-dev');
  writeTree(dir, {
    'worca-cc-plugin.json': JSON.stringify({
      name: 'profiled-plugin', version: '0.1.0', engines: { 'worca-cc-api': '>=1 <2' },
      taskSources: [{
        id: 'src', displayName: 'Profiled', module: './connector/index.mjs', multiProfile: true,
        configSchema: [{ key: 'token', type: 'text', secret: true, required: true, label: 'Token' }],
        inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
      }],
    }),
    'connector/index.mjs': 'export default () => ({});\n',
  });
  linkPlugin('profiled-plugin', dir);

  const empty = await doctorPlugin('profiled-plugin');
  assert.equal(empty.ok, false);
  const gap = empty.checks.find((c) => c.id === 'config:src');
  assert.equal(gap.ok, false);
  assert.match(gap.detail, /no profiles yet/);

  // With a roster the check runs per profile (WORCA_MOCK cans validateConfig ok).
  createProfile('profiled-plugin', 'work', 'Work');
  const withProfile = await doctorPlugin('profiled-plugin');
  assert.ok(withProfile.checks.some((c) => c.id === 'config:src@work' && c.ok));
  assert.ok(!withProfile.checks.some((c) => c.id === 'config:src'), 'no default-bucket check for a rostered source');

  await uninstallPlugin('profiled-plugin', { purge: true });
});

test('listInstalledPlugins reports apiMismatch for v1-shaped data, and null when clean', async () => {
  // An API-1 plugin still shipping v1 data: it INSTALLS (warn path — its
  // connector works); worca just ignores the agent and the template.
  installLocal('legacy-data', {
    'worca-cc-plugin.json': JSON.stringify({
      name: 'legacy-data', version: '0.1.0', engines: { 'worca-cc-api': '>=1 <2' },
    }),
    'agents/demoAgent.meta.json': JSON.stringify(V1_SIDECAR),
    'workflows/demo-flow.json': JSON.stringify(V1_TEMPLATE),
  });
  const p = listInstalledPlugins().find((x) => x.name === 'legacy-data');
  assert.deepEqual(p.apiMismatch, {
    builtFor: 1, host: 3, agents: 1, workflows: 1,
    message: 'built for plugin API 1; this version of worca requires plugin API 3 for agents and pipeline templates \u2014 update or reinstall the plugin (1 agent(s), 1 template(s) ignored)',
  });
  assert.equal(p.broken, false, 'an outdated data contract is not a broken install');

  installLocal('clean-data');   // PLUGIN_FILES is API 3 with v2 data
  const clean = listInstalledPlugins().find((x) => x.name === 'clean-data');
  assert.equal(clean.apiMismatch, null, 'an API-3 plugin with clean data has no mismatch');
});

test('doctor reports an agents-api check, and it is NOT an install gate', async () => {
  installLocal('legacy-doctor', {
    'worca-cc-plugin.json': JSON.stringify({
      name: 'legacy-doctor', version: '0.1.0', engines: { 'worca-cc-api': '>=1 <2' },
    }),
    'agents/demoAgent.meta.json': JSON.stringify(V1_SIDECAR),
    'workflows/demo-flow.json': JSON.stringify(V1_TEMPLATE),
  });
  const report = await doctorPlugin('legacy-doctor');
  const check = report.checks.find((c) => c.id === 'agents-api');
  assert.ok(check, 'the doctor names the data contract');
  assert.equal(check.ok, false);
  assert.match(check.detail, /update or reinstall the plugin/);
  // …and a clean API-3 plugin reports it GREEN (the check is not always-red).
  installLocal('clean-doctor');
  const good = (await doctorPlugin('clean-doctor')).checks.find((c) => c.id === 'agents-api');
  assert.equal(good.ok, true);
  assert.match(good.detail, /plugin API 3/);
});

test('an outdated data contract does NOT block installPlugin (agents-api is advisory)', async () => {
  // The regression this pins: moving the agents-api check into dirChecks routes
  // it through precheck(), which THROWS on any failing check — and an API-1
  // plugin whose connector still works must keep installing (spec §9, P7.2).
  const root = join(scratch, 'origin-legacy-install');
  mkdirSync(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  writeTree(root, {
    ...PLUGIN_FILES('legacy-install'),
    'worca-cc-plugin.json': JSON.stringify({
      name: 'legacy-install', version: '0.1.0', engines: { 'worca-cc-api': '>=1 <2' },
      taskSources: [{
        id: 'demo', displayName: 'Demo', module: './connector/index.mjs',
        inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
      }],
    }),
    'agents/demoAgent.meta.json': JSON.stringify(V1_SIDECAR),
    'workflows/demo-flow.json': JSON.stringify(V1_TEMPLATE),
  });
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const { exec } = makeExec();
  await installPlugin({ repoUrl: root, name: 'legacy-install' }, { exec });
  assert.ok(readPluginsLock()['legacy-install'], 'the install completed despite the outdated data');
  const report = await doctorPlugin('legacy-install');
  assert.equal(report.checks.find((c) => c.id === 'agents-api').ok, false,
    'the doctor still reports it — advisory, not a gate');
});

test('`broken` outranks the data contract: a plugin with an unparseable manifest reports apiMismatch null', () => {
  const dir = installLocal('broken-manifest');           // links with clean API-3 data
  writeTree(dir, {                                        // …then rots on disk
    'worca-cc-plugin.json': '{ not json',
    'agents/demoAgent.meta.json': JSON.stringify(V1_SIDECAR),
    'workflows/demo-flow.json': JSON.stringify(V1_TEMPLATE),
  });
  const p = listInstalledPlugins().find((x) => x.name === 'broken-manifest');
  assert.equal(p.broken, true);
  assert.equal(p.apiMismatch, null, 'a broken install never also carries a needs-update note');
});
