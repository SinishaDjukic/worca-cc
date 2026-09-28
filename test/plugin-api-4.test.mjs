// test/plugin-api-4.test.mjs
// Plugin API 4 (ask-forms spec §10). API 4 adds ONE thing: a plugin's agent
// `ask` block is honoured. It does NOT change the DATA contract — agent
// sidecars are still meta v2 and templates still v2 graphs, which is API 3 —
// so every comparison about that contract is pinned to WORCA_AGENT_DATA_API.
// Pure module reads + fs fixtures; no WORCA_HOME, no store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  WORCA_PLUGIN_API, WORCA_PLUGIN_APIS, WORCA_AGENT_DATA_API, WORCA_ASK_FORMS_API,
} from '../src/core/plugin-api.mjs';
import {
  apiSatisfies, negotiatedApi, declaredApi, apiMismatch, validatePluginDir, ASK_NEEDS_API_4,
} from '../src/core/plugin-manifest.mjs';

const scratch = [];
function mkPluginDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-api4-'));
  scratch.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}
process.on('exit', () => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const V2_META = (key) => JSON.stringify({
  metaVersion: 2, key, displayName: key, agentFile: `${key}.md`, runnerType: 'producer',
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
});
const V1_META = (key) => JSON.stringify({ key, agentFile: `${key}.md`, consumes: ['plan'], produces: ['review'], order: 900 });
const errs = (v) => v.problems.filter((p) => p.level === 'error').map((p) => p.message);
const warns = (v) => v.problems.filter((p) => p.level === 'warn').map((p) => p.message);

test('the host speaks APIs 1..4; 4 is current, 3 is the agent DATA contract', () => {
  assert.equal(WORCA_PLUGIN_API, 4);
  assert.deepEqual(WORCA_PLUGIN_APIS, [1, 2, 3, 4]);
  assert.equal(WORCA_AGENT_DATA_API, 3, 'meta v2 + v2 graphs arrived in API 3 and API 4 does not touch them');
  assert.equal(WORCA_ASK_FORMS_API, 4);
});

test('old ranges keep negotiating their own API; an open range now reaches 4', () => {
  assert.equal(negotiatedApi('>=1 <2'), 1);
  assert.equal(negotiatedApi('>=2 <3'), 2);
  assert.equal(negotiatedApi('>=3 <4'), 3, 'an API-3 plugin must NOT be promoted to 4');
  assert.equal(negotiatedApi('>=4 <5'), 4);
  assert.equal(negotiatedApi('>=3 <5'), 4, 'the HIGHEST member a range admits');
  assert.equal(negotiatedApi(''), 4, 'unconstrained -> newest');
  assert.equal(negotiatedApi('>=5'), null, 'beyond the host set');
  assert.equal(negotiatedApi('^4.0.0'), null, 'unsupported syntax fails CLOSED');
  assert.equal(apiSatisfies('>=4 <5'), true);
  assert.equal(apiSatisfies('>=5'), false);
  assert.equal(declaredApi('>=4 <5'), 4, 'declaredApi is still the LOWEST integer a range accepts');
});

test('apiMismatch still names the DATA contract API (3), never the host API', () => {
  const issues = { agentsV1: ['old.meta.json'], workflowsV1: ['legacy.json'], scriptsV1: [] };
  const m = apiMismatch('>=1 <2', issues);
  assert.match(m.message, /requires plugin API 3 for agents and pipeline templates/,
    'bumping the host API must not tell users their meta v2 sidecars are outdated');
  assert.equal(m.host, WORCA_PLUGIN_API, '`host` is honestly this host’s API');
  assert.equal(m.builtFor, 1);
  assert.equal(apiMismatch('>=4 <5', { agentsV1: [], workflowsV1: [], scriptsV1: [] }), null);
});

test('v1-shaped data stays a HARD error for every range that admits API 3 or better', () => {
  const files = {
    'agents/old.meta.json': V1_META('old'),
    'agents/old.md': '# old\n',
  };
  for (const range of ['>=3 <4', '>=4 <5', '>=3 <5', '']) {
    const dir = mkPluginDir({
      ...files,
      'worca-cc-plugin.json': JSON.stringify(range ? { name: 'p', engines: { 'worca-cc-api': range } } : { name: 'p' }),
    });
    assert.ok(errs(validatePluginDir(dir)).some((e) => e.includes('agents/old.meta.json')),
      `range "${range}" must report the v1 sidecar as an ERROR`);
  }
  // …and a SOFT warning below the data contract, exactly as before.
  const old = mkPluginDir({ ...files, 'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=2 <3' } }) });
  const v = validatePluginDir(old);
  assert.deepEqual(errs(v), []);
  assert.ok(warns(v).some((w) => w.includes('agents/old.meta.json')));
});

test('a clean API-4 plugin validates, and ASK_NEEDS_API_4 is one exported sentence', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=4 <5' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
  });
  const v = validatePluginDir(dir, { strict: true });
  assert.deepEqual(errs(v), []);
  assert.equal(v.ok, true);
  assert.equal(typeof ASK_NEEDS_API_4, 'string');
  assert.match(ASK_NEEDS_API_4, /plugin API 4/);
  assert.match(ASK_NEEDS_API_4, />=4 <5/, 'the sentence names the fix, like NOT_META_V2 does');
  assert.doesNotMatch(ASK_NEEDS_API_4, /worca-cc /, 'product name is "worca" in user-facing prose');
});
