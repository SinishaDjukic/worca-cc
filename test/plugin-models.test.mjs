// test/plugin-models.test.mjs — plugin model contributions (design §9.2–§9.4):
// manifest reading, cross-plugin dedupe, secret flattening, catalog
// composition precedence, resolveModelEnv/modelHasBaseUrlRouting extension,
// and the uninstall-guard refs. Sandboxes HOME (settings.json) and WORCA_HOME
// (plugins + DB) and opts into the catalog guard, mirroring api-models.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { readPluginsLock, writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import {
  allPluginModels, listPluginModels, modelSecretsSchema, pluginModelSecretStatus,
  flattenPluginModelEnv,
} from '../src/core/plugin-models.mjs';
import {
  listModels, resolveModelEnv, modelHasBaseUrlRouting, referencedPluginModels,
  setNodeModel,
} from '../src/core/config.mjs';
import { addGlobalModel, removeGlobalModel } from '../src/core/settings.mjs';

let homeDir, worcaHomeDir, proj;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};

/** Fixture-install: current/ as a real dir with a manifest + a lock entry. */
function installFixture(name, manifest, { enabled = true } = {}) {
  const cur = pluginCurrentDir(name);
  mkdirSync(cur, { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({ name, ...manifest }));
  writePluginsLock({
    ...readPluginsLock(),
    [name]: { repo: 'https://example.com/r', subdir: '', pinnedSha: 'x'.repeat(40), version: '1', enabled },
  });
}

const DS_MANIFEST = {
  modelSecrets: [{ key: 'ds-token', label: 'DS token' }],
  models: [
    {
      id: 'ds-stable', label: 'DS Stable', efforts: ['medium', 'high'],
      env: {
        ANTHROPIC_BASE_URL: 'https://api.ds.example',
        X_REF: '${MY_DS_VAR}',
        ANTHROPIC_AUTH_TOKEN: { secret: 'ds-token' },
      },
    },
    { id: 'ds-fast', label: 'DS Fast' },
  ],
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-pm-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-pm-whome-'));
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-pm-proj-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir;
  process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME sandboxed above
  _resetForTests();
  installFixture('discretestack-models', DS_MANIFEST);
});
after(async () => {
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all([homeDir, worcaHomeDir, proj].map((d) => rm(d, { recursive: true, force: true })));
});

test('allPluginModels: enabled plugins only, manifest order, secrets listed', () => {
  const all = allPluginModels();
  assert.equal(all.length, 2);
  assert.equal(all[0].plugin, 'discretestack-models');
  assert.equal(all[0].id, 'ds-stable');
  assert.deepEqual(all[0].efforts, ['medium', 'high']);
  assert.deepEqual(all[0].secrets, ['ds-token']);
  assert.deepEqual(all[1].secrets, []);
  assert.deepEqual(all[1].efforts, ['medium', 'high', 'xhigh', 'max']);
});

test('disabled plugin contributes nothing; re-enable restores', () => {
  const lock = readPluginsLock();
  writePluginsLock({ ...lock, 'discretestack-models': { ...lock['discretestack-models'], enabled: false } });
  assert.deepEqual(allPluginModels(), []);
  writePluginsLock(lock);
  assert.equal(allPluginModels().length, 2);
});

test('listPluginModels: cross-plugin id collision — alphabetical plugin wins, loser dropped', () => {
  installFixture('zz-other', { models: [{ id: 'DS-Stable', label: 'Other Stable' }, { id: 'zz-own', label: 'ZZ' }] });
  const list = listPluginModels();
  const stable = list.filter((m) => m.id.toLowerCase() === 'ds-stable');
  assert.equal(stable.length, 1);
  assert.equal(stable[0].plugin, 'discretestack-models', 'alphabetical winner');
  assert.ok(list.some((m) => m.id === 'zz-own'), 'non-colliding entry of the loser survives');
});

test('modelSecretsSchema + status; flattenPluginModelEnv resolves/drops secrets', () => {
  const schema = modelSecretsSchema('discretestack-models');
  assert.equal(schema.length, 1);
  assert.equal(schema[0].secret, true);
  assert.deepEqual(pluginModelSecretStatus('discretestack-models'), [{ key: 'ds-token', label: 'DS token', set: false }]);

  const [stable] = allPluginModels();
  let flat = flattenPluginModelEnv(stable);
  assert.equal(flat.env.ANTHROPIC_BASE_URL, 'https://api.ds.example');
  assert.equal(flat.env.X_REF, '${MY_DS_VAR}', 'ref text passes through untouched');
  assert.equal(flat.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.match(flat.droppedSecrets[0], /ANTHROPIC_AUTH_TOKEN \(secret "ds-token"\)/);

  writePluginConfig('discretestack-models', schema, { 'ds-token': 'sk-team-1234' });
  assert.deepEqual(pluginModelSecretStatus('discretestack-models'), [{ key: 'ds-token', label: 'DS token', set: true }]);
  flat = flattenPluginModelEnv(stable);
  assert.equal(flat.env.ANTHROPIC_AUTH_TOKEN, 'sk-team-1234');
  assert.deepEqual(flat.droppedSecrets, []);
});

test('catalog composition: custom "plugin" + plugin name; global shadows plugin; plugin shadows predefined', async () => {
  const models = await listModels('');
  const stable = models.find((m) => m.id === 'ds-stable');
  assert.equal(stable.custom, 'plugin');
  assert.equal(stable.plugin, 'discretestack-models');
  assert.equal(stable.hasEnv, true);
  assert.equal(models.find((m) => m.id === 'ds-fast').hasEnv, false);

  // A user global entry with the same id wins (case-insensitively).
  await addGlobalModel({ id: 'DS-STABLE', label: 'My Stable', env: { OTHER: 'x' } });
  const shadowed = (await listModels('')).find((m) => m.id.toLowerCase() === 'ds-stable');
  assert.equal(shadowed.custom, 'global');
  assert.equal(shadowed.label, 'My Stable');
  await removeGlobalModel('DS-STABLE');

  // A plugin entry with a predefined id shadows the built-in, keeping its casing.
  installFixture('shadow-plug', { models: [{ id: 'CLAUDE-OPUS-5', label: 'Opus via proxy', env: { ANTHROPIC_BASE_URL: 'https://p.example' } }] });
  const opus = (await listModels('')).find((m) => m.id.toLowerCase() === 'claude-opus-5');
  assert.equal(opus.id, 'claude-opus-5', 'predefined casing kept');
  assert.equal(opus.custom, 'plugin');
  assert.equal(opus.label, 'Opus via proxy');
  const lock = readPluginsLock();
  delete lock['shadow-plug'];
  writePluginsLock(lock);
});

test('resolveModelEnv: plugin entry with secrets + refs; user global entry wins outright', async () => {
  process.env.MY_DS_VAR = 'expanded-ref';
  try {
    const env = resolveModelEnv('DS-Stable');
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.ds.example');
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-team-1234');
    assert.equal(env.X_REF, 'expanded-ref', 'ref expanded at the resolution point');
  } finally {
    delete process.env.MY_DS_VAR;
  }

  // A global shadow WITHOUT env means: no routing (the user's copy wins entirely).
  await addGlobalModel({ id: 'ds-stable', label: 'Mine' });
  assert.equal(resolveModelEnv('ds-stable'), undefined);
  await removeGlobalModel('ds-stable');

  assert.equal(resolveModelEnv('ds-fast'), undefined, 'plugin model without env');
  assert.equal(resolveModelEnv('nope'), undefined);
});

test('modelHasBaseUrlRouting covers plugin entries (global still first)', async () => {
  assert.equal(modelHasBaseUrlRouting('ds-stable'), true);
  assert.equal(modelHasBaseUrlRouting('ds-fast'), false);
  await addGlobalModel({ id: 'ds-stable', label: 'Mine' }); // shadow without base URL
  assert.equal(modelHasBaseUrlRouting('ds-stable'), false);
  await removeGlobalModel('ds-stable');
});

test('referencedPluginModels: refs block; global-shadow and other-plugin carve-outs', async () => {
  assert.deepEqual(referencedPluginModels('discretestack-models'), []);
  await setNodeModel(proj, 'wf_x', 's1_0', { model: 'ds-stable', effort: 'high' });

  // Carve-out: while BOTH plugins ship the id, uninstalling either leaves the
  // other resolving it — neither blocks (zz-other is still installed here).
  assert.deepEqual(referencedPluginModels('discretestack-models'), []);
  assert.deepEqual(referencedPluginModels('zz-other'), []);

  const lock = readPluginsLock();
  const { 'zz-other': zz, ...rest } = lock;
  writePluginsLock(rest);
  let refs = referencedPluginModels('discretestack-models');
  assert.equal(refs.length, 1, 'sole provider now blocks');
  assert.equal(refs[0].id, 'ds-stable');
  assert.equal(refs[0].nodes.length, 1);
  assert.equal(refs[0].nodes[0].nodeId, 's1_0');
  assert.deepEqual(refs[0].steps, []);

  // Carve-out: a user global entry shadows the id — refs keep resolving.
  await addGlobalModel({ id: 'ds-stable', label: 'Mine' });
  assert.deepEqual(referencedPluginModels('discretestack-models'), []);
  await removeGlobalModel('ds-stable');

  await setNodeModel(proj, 'wf_x', 's1_0', { model: '', effort: '' });
  assert.deepEqual(referencedPluginModels('discretestack-models'), [], 'cleared selection unblocks');
  writePluginsLock({ ...readPluginsLock(), 'zz-other': zz });
});
