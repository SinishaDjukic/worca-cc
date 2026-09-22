// test/plugin-agent-registry-ask.test.mjs
// Ask forms spec §10: a PLUGIN agent's `ask` block is honoured only when the
// plugin NEGOTIATES plugin API 4. Below that the block is stripped AT LOAD —
// one choke point — and reported through the same onDrop sink NOT_META_V2 uses,
// so the Plugins card, `worca plugin doctor` and `worca plugin list` all name it. The
// agent itself keeps loading with its ports and its generic questions.
// Fixture layout mirrors test/plugin-agent-registry.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadAgentRegistry, pluginAgentLayers } from '../src/core/agent-registry.mjs';
import { readPluginsLock, writePluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';
import { ASK_NEEDS_API_4 } from '../src/core/plugin-manifest.mjs';

useTempHome(after);

const scratch = [];
function tmp(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d; }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

/** A minimal form that passes gate 1: one display item, one required select. */
const FORM = {
  version: 1,
  title: 'Pick one',
  data: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', maxLength: 200 } } },
  answer: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['yes', 'no'] } } },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'select', field: 'verdict', label: 'Verdict' },
  ],
  example: { summary: 'Something happened.' },
};

function writeAgent(dir, key, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.md`), `# ${key}\n\nYou are the ${key} agent.\n`);
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    metaVersion: 2,
    key, displayName: key, description: 'd', color: 'amber',
    agentFile: `${key}.md`, runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
    order: 99, ...extra,
  }, null, 2));
}

/** Lay a plugin out the way plugin-store does: versions/<sha7>/agents + a REAL
 *  current -> versions/<sha7> link + a lock entry. `range` is the engines value
 *  (null writes NO manifest at all). */
function installFakePlugin(name, agents, { range = '>=4 <5' } = {}) {
  const versionDir = join(pluginDir(name), 'versions', 'abc1234');
  const agentsDir = join(versionDir, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  for (const [key, extra] of agents) writeAgent(agentsDir, key, extra);
  if (range !== null) {
    writeFileSync(join(versionDir, 'worca-cc-plugin.json'),
      JSON.stringify({ name, engines: { 'worca-cc-api': range } }));
  }
  symlinkSync(versionDir, join(pluginDir(name), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  writePluginsLock({
    ...readPluginsLock(),
    [name]: {
      repo: 'https://example.com/plugins.git', subdir: name,
      pinnedSha: 'a'.repeat(40), version: '0.1.0', enabled: true,
      installedAt: '2026-09-21T00:00:00.000Z',
    },
  });
  return versionDir;
}

function loadWith(builtin, name) {
  const drops = [];
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let reg;
  try { reg = loadAgentRegistry(builtin, { userAgentsDir: null, onDrop: (d) => drops.push(d) }); }
  finally { console.warn = orig; }
  return { reg, warned, drops: drops.filter((d) => d.origin === `plugin:${name}`) };
}

test('pluginAgentLayers carries the NEGOTIATED api beside builtFor', () => {
  installFakePlugin('api4-layers', [['layerAgent', {}]], { range: '>=3 <5' });
  const layer = pluginAgentLayers().find((l) => l.plugin === 'api4-layers');
  assert.equal(layer.api, 4, 'negotiatedApi is the HIGHEST member the range admits');
  assert.equal(layer.builtFor, 3, 'builtFor stays the LOWEST — the two are different questions');
});

test('API 4: the plugin agent keeps its ask block', () => {
  const builtin = tmp('worca-cc-ask-builtin-');
  writeAgent(builtin, 'alphaA', { order: 1 });
  installFakePlugin('forms-ok', [['formsOkAgent', { ask: { forms: { 'pick-one': FORM } } }]], { range: '>=4 <5' });
  const { reg, drops } = loadWith(builtin, 'forms-ok');
  assert.ok(reg.formsOkAgent, 'the agent loads');
  assert.deepEqual(Object.keys(reg.formsOkAgent.ask.forms), ['pick-one']);
  assert.deepEqual(drops, [], 'nothing is reported as ignored');
});

test('API 3: the ask block is STRIPPED, the agent still loads, and the drop is reported', () => {
  const builtin = tmp('worca-cc-ask-builtin-');
  writeAgent(builtin, 'alphaB', { order: 1 });
  installFakePlugin('forms-old', [['formsOldAgent', { ask: { forms: { 'pick-one': FORM } } }]], { range: '>=3 <4' });
  const { reg, warned, drops } = loadWith(builtin, 'forms-old');
  assert.ok(reg.formsOldAgent, 'the agent is NOT dropped — it keeps its ports and generic questions');
  assert.equal(reg.formsOldAgent.inputs.length, 1, 'ports are untouched');
  assert.equal(reg.formsOldAgent.inputs[0].id, 'task');
  assert.equal(reg.formsOldAgent.outputs[0].id, 'plan');
  assert.equal(reg.formsOldAgent.ask, undefined, 'P2’s prompt block can never mention a form that is not there');
  assert.deepEqual(drops, [{ origin: 'plugin:forms-old', file: 'formsOldAgent.meta.json', reason: ASK_NEEDS_API_4 }]);
  assert.ok(warned.some((w) => w.includes('plugin:forms-old/formsOldAgent.meta.json') && w.includes(ASK_NEEDS_API_4)),
    warned.join('\n'));
});

test('an API-3 plugin with NO ask block loads byte-identically and reports nothing', () => {
  const builtin = tmp('worca-cc-ask-builtin-');
  writeAgent(builtin, 'alphaC', { order: 1 });
  installFakePlugin('forms-none', [['formsNoneAgent', {}]], { range: '>=3 <4' });
  const { reg, drops } = loadWith(builtin, 'forms-none');
  assert.ok(reg.formsNoneAgent);
  assert.equal(reg.formsNoneAgent.ask, undefined);
  assert.deepEqual(drops, [], 'API-3 plugins must keep loading exactly as before');
});

test('an unreadable manifest fails CLOSED: the ask block is stripped', () => {
  const builtin = tmp('worca-cc-ask-builtin-');
  writeAgent(builtin, 'alphaD', { order: 1 });
  const versionDir = installFakePlugin('forms-broken', [['formsBrokenAgent', { ask: { forms: { 'pick-one': FORM } } }]], { range: null });
  writeFileSync(join(versionDir, 'worca-cc-plugin.json'), '{ not json');
  const { reg, drops } = loadWith(builtin, 'forms-broken');
  assert.ok(reg.formsBrokenAgent);
  assert.equal(reg.formsBrokenAgent.ask, undefined, 'an unknowable API must never honour forms');
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, ASK_NEEDS_API_4);
});

test('an UNCONSTRAINED manifest negotiates the newest API and keeps its forms', () => {
  const builtin = tmp('worca-cc-ask-builtin-');
  writeAgent(builtin, 'alphaE', { order: 1 });
  const versionDir = installFakePlugin('forms-open', [['formsOpenAgent', { ask: { forms: { 'pick-one': FORM } } }]], { range: null });
  writeFileSync(join(versionDir, 'worca-cc-plugin.json'), JSON.stringify({ name: 'forms-open' }));
  const { reg, drops } = loadWith(builtin, 'forms-open');
  assert.ok(reg.formsOpenAgent.ask, 'no engines constraint claims the current API, as it does for meta v2');
  assert.deepEqual(drops, []);
});

test('the gate is PLUGIN-only: builtin and user agents keep their forms whatever the plugin layer says', () => {
  const builtin = tmp('worca-cc-ask-builtin-');
  writeAgent(builtin, 'builtinForms', { order: 1, ask: { forms: { 'pick-one': FORM } } });
  const user = tmp('worca-cc-ask-user-');
  writeAgent(user, 'userForms', { order: 2, ask: { forms: { 'pick-one': FORM } } });
  installFakePlugin('forms-neighbour', [['neighbourAgent', { ask: { forms: { 'pick-one': FORM } } }]], { range: '>=3 <4' });
  const drops = [];
  const orig = console.warn;
  console.warn = () => {};
  let reg;
  try { reg = loadAgentRegistry(builtin, { userAgentsDir: user, onDrop: (d) => drops.push(d) }); }
  finally { console.warn = orig; }
  assert.ok(reg.builtinForms.ask, 'a built-in agent is never API-gated');
  assert.ok(reg.userForms.ask, 'a user agent is never API-gated');
  assert.equal(reg.neighbourAgent.ask, undefined);
  assert.deepEqual(drops.filter((d) => d.origin === 'builtin' || d.origin === 'user'), []);
});
