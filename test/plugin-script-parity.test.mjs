// test/plugin-script-parity.test.mjs
// Plugin parity for scripts (scripts-workbench §8.1), the four facts P1c's own
// suites do not reach: a PLUGIN script's detail page (P1c pins a built-in), the
// bench running a plugin-layer script, Duplicate carrying the SHIPPED cases, and
// a user's own cases for a plugin key living in the W18 overlay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { useTempHome } from './helpers/temp-home.mjs';
import { readPluginsLock, writePluginsLock, pluginDir, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { readScript, duplicateScript, writeCases } from '../src/core/script-store.mjs';
import { runBenchOnce } from '../src/core/script-bench.mjs';
import { renderScriptDetail, originLabel } from '../ui/public/scripts-view.mjs';
import { join } from 'node:path';

useTempHome(after);
const doc = new JSDOM('<!doctype html><body></body>').window.document;

/** An installed plugin shipping ONE script with two scratch cases, laid out the
 *  way plugin-store does it: versions/<sha7> + a real current link + a lock row. */
function installScriptPlugin(name, key) {
  const versionDir = join(pluginDir(name), 'versions', 'abc1234');
  const scripts = join(versionDir, 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, `${key}.mjs`), [
    'export default async function ({ params, ctx }) {',
    "  return { outputs: { out: { value: '# ' + params.word + '\\n' } }, summary: 'from ' + params.word };",
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(scripts, `${key}.meta.json`), JSON.stringify({
    metaVersion: 2, key, displayName: 'Plugin Probe', description: 'ships with a plugin',
    runtime: 'node', file: `${key}.mjs`, order: 40,
    params: [{ id: 'word', type: 'string', default: 'plugin' }],
    inputs: [], outputs: [{ id: 'out', type: 'md', when: 'always', filename: `${key}-cycle{cycle}.md` }],
  }, null, 2) + '\n');
  writeFileSync(join(scripts, `${key}.tests.json`), JSON.stringify({ version: 1, cases: [
    { id: 'shipped_a', name: 'shipped a', cwd: { kind: 'scratch' }, inputs: {}, expect: { verdict: 'clean', fired: ['out'] } },
    { id: 'shipped_b', name: 'shipped b', cwd: { kind: 'scratch' }, inputs: {} },
  ] }, null, 2) + '\n');
  // 'junction' on Windows (a plain/dir symlink needs elevated privileges there).
  symlinkSync(versionDir, join(pluginDir(name), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  writePluginsLock({
    ...readPluginsLock(),
    [name]: {
      repo: 'https://example.com/p.git', subdir: name, pinnedSha: 'a'.repeat(40),
      version: '0.1.0', enabled: true, installedAt: '2026-07-12T00:00:00.000Z',
    },
  });
}

// ONCE for the file: every test shares one WORCA_HOME, and a second symlinkSync of
// the same `current` link is EEXIST.
before(() => installScriptPlugin('tools', 'pluginProbe'));

test('a plugin script reads with the plugin origin and its SHIPPED cases', async () => {
  const data = await readScript('pluginProbe');
  assert.equal(data.meta.origin, 'plugin:tools');
  assert.equal(data.meta.scriptPath, join(pluginCurrentDir('tools'), 'scripts', 'pluginProbe.mjs'),
    'the path resolves THROUGH current/, never a versions/ path');
  assert.deepEqual(data.cases.map((c) => c.id), ['shipped_a', 'shipped_b']);
  assert.deepEqual(data.userCases, []);
});

test('the detail page of a plugin script is read-only, badged with the PLUGIN name, and still offers Duplicate', async () => {
  const data = await readScript('pluginProbe');
  const root = renderScriptDetail(data, { doc, tab: 'overview', readOnly: true, highlight: async (t) => t, runtimes: {} });
  assert.equal(originLabel('plugin:tools'), 'tools');
  assert.equal(root.querySelector('.script-origin').textContent, 'tools');
  assert.equal(root.querySelector('.script-save'), null, 'a plugin script is never saved in place');
  assert.equal(root.querySelector('.script-delete'), null, 'and never deleted from here');
  assert.ok(root.querySelector('.script-duplicate'), 'Duplicate is the way out (spec §13)');
  assert.ok(root.querySelector('.script-path'), 'the resolved path is shown in mono with Copy');
  // Form controls are `disabled`; the code editor's <textarea> is `readOnly` instead
  // (code-editor.mjs — a disabled textarea cannot be selected or copied from).
  for (const el of root.querySelectorAll('[data-field]')) {
    if (el.type === 'hidden') continue;       // the off-screen half's mirror: no user can type in it
    assert.equal(el.disabled || el.readOnly, true, `${el.dataset.field} must not be editable on a plugin script`);
  }
  assert.equal(root.querySelector('.code-editor').classList.contains('ro'), true);
  (root._editors || []).forEach((e) => e.destroy());
});

test('the bench runs a plugin-layer script exactly like a user one', async () => {
  const result = await runBenchOnce({ key: 'pluginProbe', params: { word: 'bench' }, inputs: {}, cwd: { kind: 'scratch' } }, {});
  assert.equal(result.status, 'clean', JSON.stringify(result.error || {}));
  assert.equal(result.summary, 'from bench');
  assert.deepEqual(result.fired, ['out']);
});

test('Duplicate copies a plugin script INCLUDING its shipped cases; a user case for the plugin key is the W18 overlay', async () => {
  await duplicateScript('pluginProbe', 'myProbe', 'ui');
  const copy = await readScript('myProbe');
  assert.equal(copy.meta.origin, 'user');
  assert.deepEqual(copy.cases.map((c) => c.id), ['shipped_a', 'shipped_b'], 'the shipped cases travel with the copy');

  await writeCases('pluginProbe', [{ id: 'mine', name: 'mine', cwd: { kind: 'scratch' }, inputs: {} }]);
  const overlaid = await readScript('pluginProbe');
  assert.deepEqual(overlaid.cases.map((c) => c.id), ['shipped_a', 'shipped_b'], 'the shipped set is untouched');
  assert.deepEqual(overlaid.userCases.map((c) => c.id), ['mine'], 'the user set is the W18 overlay');
  assert.equal(overlaid.meta.origin, 'plugin:tools', 'an overlay never turns a plugin script into a user script');
});
