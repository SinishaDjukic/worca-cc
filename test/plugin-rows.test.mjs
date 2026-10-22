// test/plugin-rows.test.mjs — the Installed rows' new fields (CONTRACT §1.1): description, ref, manifest notes, latest.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { writePluginsLock, readPluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { listInstalledPlugins, installedInventory } from '../src/core/plugin-store.mjs';
import { pluginLatest, isNewerVersion } from '../src/core/plugin-latest.mjs';

useTempHome(after);
const PIN = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const SRC = { id: 'gh', module: './index.mjs', configSchema: [{ key: 'token', secret: true }], inputs: [{ key: 'task', type: 'task-browser' }] };
function installFixture(name, manifest, lock = {}) {
  mkdirSync(pluginCurrentDir(name), { recursive: true });
  writeFileSync(join(pluginCurrentDir(name), 'worca-cc-plugin.json'), JSON.stringify({ name, ...manifest }));
  writePluginsLock({ ...readPluginsLock(), [name]: { repo: 'https://github.com/acme/tools', subdir: `plugins/${name}`, pinnedSha: PIN,
    version: manifest.version ?? PIN.slice(0, 7), enabled: true, installedAt: '2026-10-20T00:00:00.000Z', ...lock } });
}

test('rows carry description, ref and the installed manifest\'s notes, worded like the snapshot\'s (no host path)', () => {
  installFixture('noted-plugin', { version: '0.1.0', description: 'Tools for acme', icon: 'x',
    models: [{ id: 'nm', env: { ANTHROPIC_MODEL: 'nm', CLAUDE_CODE_SUBAGENT_MODEL: 'nm' } }] }, { ref: 'dev' });
  installFixture('bare-plugin', { version: '0.1.0' });
  installFixture('root-plugin', { version: '0.1.0', icon: 'x' }, { subdir: '' });
  installFixture('broken-plugin', { version: '0.1.0', icon: 'x', taskSources: [{ id: 'bad' }] });
  const rows = Object.fromEntries(listInstalledPlugins().map((r) => [r.name, r]));
  assert.deepEqual([rows['noted-plugin'].description, rows['noted-plugin'].ref], ['Tools for acme', 'dev']);
  assert.deepEqual(rows['noted-plugin'].notes, [
    'plugins/noted-plugin/worca-cc-plugin.json: unknown field "icon" ignored',
    'plugins/noted-plugin/worca-cc-plugin.json: models[0] ("nm"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored',
  ]);
  assert.deepEqual(rows['root-plugin'].notes, ['./worca-cc-plugin.json: unknown field "icon" ignored'], 'a plugin at the repo root: discovery\'s "<subdir|.>"');
  const b = rows['bare-plugin'];
  assert.deepEqual([b.description, b.ref, b.notes, b.latest], [null, null, [], null]);
  assert.deepEqual([rows['broken-plugin'].notes, rows['broken-plugin'].setup], [[], { ok: true, missing: [], noProfiles: [] }],
    'a manifest that does not normalize: no notes, nothing to set up');
});

test('latest: only a higher version, on the branch the lock follows, from the marketplace that installed it', async () => {
  const installed = { taskSources: [{ id: 'gh', secrets: ['token'] }] };
  const snap = (version, inventory = { taskSources: [{ id: 'gh', secrets: ['token', 'webhookSecret'] }] }) => ({ name: 'gh-plugin', version, inventory });
  const mkts = {
    'mkt-a': { id: 'mkt-a', name: 'Acme tools', lastSync: { sha: NEXT, at: 'x' }, plugins: [snap('0.3.0')] },
    'mkt-dev': { id: 'mkt-dev', ref: 'dev', lastSync: { sha: NEXT, at: 'x' }, plugins: [snap('0.3.0', {})] },
    'mkt-old': { id: 'mkt-old', lastSync: { sha: NEXT, at: 'x' }, plugins: [snap('0.1.9')] },
    'mkt-never': { id: 'mkt-never', lastSync: null, plugins: [snap('0.3.0')] },
    'mkt-blank': { id: 'mkt-blank', lastSync: { sha: '', at: 'x' }, plugins: [snap('0.3.0')] },
    'mkt-other': { id: 'mkt-other', lastSync: { sha: NEXT, at: 'x' }, plugins: [{ name: 'someone-else', version: '9.0.0', inventory: {} }] },
  };
  const entry = (over) => ({ repo: 'https://github.com/acme/tools', pinnedSha: PIN, version: '0.2.0', marketplace: 'mkt-a', ...over });
  const latest = (over) => pluginLatest('gh-plugin', entry(over), installed, mkts);
  await checkRows([
    { name: 'a newer snapshot version: version, sha, marketplace id and the access it would add', run: () => {
      assert.deepEqual(latest({}), { version: '0.3.0', sha: NEXT, marketplace: 'mkt-a', access: [{ kind: 'secret', id: 'gh.webhookSecret', red: true }] });
    } },
    { name: 'the same branch is required: a lock on the default branch never compares to a dev snapshot, and back', run: () => {
      assert.equal(latest({ ref: 'dev' }), null);
      assert.equal(latest({ marketplace: 'mkt-dev' }), null);
      assert.deepEqual(latest({ marketplace: 'mkt-dev', ref: 'dev' }), { version: '0.3.0', sha: NEXT, marketplace: 'mkt-dev', access: [] });
    } },
    { name: 'never: same or older version, version-less (sha7) lock, linked, unsynced, unknown marketplace, plugin not listed', run: () => {
      assert.equal(latest({ version: '0.3.0' }), null);
      assert.equal(latest({ marketplace: 'mkt-old' }), null);
      assert.equal(latest({ version: PIN.slice(0, 7) }), null);
      assert.equal(latest({ pinnedSha: '0'.repeat(40), version: '0'.repeat(7) }), null, 'a sha7 that reads as a number is still no version');
      assert.equal(latest({ linked: true }), null);
      assert.equal(latest({ marketplace: 'mkt-never' }), null);
      assert.equal(latest({ marketplace: 'mkt-blank' }), null, 'a blank snapshot sha is unsynced');
      assert.deepEqual(latest({ ref: null }), latest({}), 'ref: null and no ref are the same default branch');
      assert.equal(latest({ marketplace: 'gone' }), null);
      assert.equal(latest({ marketplace: 'mkt-other' }), null);
      assert.equal(latest({ marketplace: null }), null);
      assert.equal(pluginLatest('gh-plugin', entry({}), installed, null), null);
      assert.equal(pluginLatest('gh-plugin', entry({ marketplace: 'mkt-inh' }), installed, Object.assign(Object.create({ 'mkt-inh': mkts['mkt-a'] }), mkts)), null, 'own keys only');
      assert.deepEqual(pluginLatest('gh-plugin', entry({}), null, mkts).access, [], 'an unreadable installed inventory claims no access');
    } },
    { name: 'isNewerVersion: numeric order, a release above its own prerelease, prereleases never among themselves, a sha never', run: () => {
      assert.deepEqual([['0.10.0', '0.9.0'], ['0.3', '0.2.9'], ['0.2.0', '0.2.0'], ['1.0.0-rc1', '1.0.0'], ['7f3e2a1', '0.1.0'], [null, '0.1.0'],
        ['1.0.0', '1.0.0-beta.1'], ['1.0.0-rc.2', '1.0.0-rc.1'], ['1.0.0+b2', '1.0.0'], ['1.0.1-rc1', '1.0.0']]
        .map(([a, b]) => isNewerVersion(a, b)), [true, true, false, false, false, false, true, false, false, true]);
    } },
  ]);
});

test('listInstalledPlugins({ marketplaces }) fills latest; installedInventory writes the plugin dir as <plugin-dir>', () => {
  installFixture('gh-plugin', { version: '0.2.0', taskSources: [SRC], setup: { node: true } }, { marketplace: 'mkt-a' });
  const mkts = { 'mkt-a': { id: 'mkt-a', lastSync: { sha: NEXT, at: 'x' }, plugins: [{ name: 'gh-plugin', version: '0.3.0',
    inventory: { taskSources: [{ id: 'gh', secrets: ['token'] }], setupCommands: ['npm ci --prefix <plugin-dir> --ignore-scripts --omit=dev'] } }] } };
  const row = listInstalledPlugins({ marketplaces: mkts }).find((p) => p.name === 'gh-plugin');
  assert.deepEqual(row.latest, { version: '0.3.0', sha: NEXT, marketplace: 'mkt-a', access: [] });
  assert.deepEqual(installedInventory('gh-plugin').setupCommands, ['npm ci --prefix <plugin-dir> --ignore-scripts --omit=dev']);
});
