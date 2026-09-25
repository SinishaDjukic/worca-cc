// test/workspace-scan-models.test.mjs
// The models a Workspace scan starts with (D15–D18): the Sonnet · medium defaults, the stored
// Settings › General › Workspaces pick, and the per-scan resolution. settings.json lives under
// HOME, so HOME is sandboxed and the test runner's HOME guard lifted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORKSPACE_SCAN_DEFAULT_MODELS, GRAPH_WORKSPACE_SCAN_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import {
  workspaceScanModels, assertWorkspaceScanInput, setWorkspaceScanModels, settingsFile, SETTINGS_POST_KEYS,
} from '../src/core/settings.mjs';
import { resolveScanModels, describeScanModels } from '../src/core/workspace-scan-run.mjs';

let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-wsscan-models-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home;
  delete process.env.WORCA_HOME;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});

const CATALOG = [
  { id: 'claude-sonnet-5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'local-llm', efforts: [] },
];
const PICK = { scanModel: 'Claude-Opus-5-5', scanEffort: 'high', agentModel: 'fable', agentEffort: 'max' };

test('the defaults are Sonnet 5 · medium and sonnet · medium, and the scan node carries them', () => {
  assert.deepEqual({ ...WORKSPACE_SCAN_DEFAULT_MODELS }, { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' });
  const n = GRAPH_WORKSPACE_SCAN_WORKFLOW.nodes.find((x) => x.id === 'n_scan');
  assert.deepEqual({ ...n.config }, { model: 'claude-sonnet-5', effort: 'medium', subagentModel: 'sonnet', subagentEffort: 'medium' });
});

test('assertWorkspaceScanInput: null clears; a pick comes back in catalog casing; bad picks throw', () => {
  assert.equal(assertWorkspaceScanInput(null), null);
  assert.equal(assertWorkspaceScanInput(''), null);
  assert.deepEqual(assertWorkspaceScanInput(PICK, CATALOG), { ...PICK, scanModel: 'claude-opus-5-5' });
  assert.deepEqual(assertWorkspaceScanInput({ ...PICK, scanModel: 'local-llm', scanEffort: '' }, CATALOG),
    { ...PICK, scanModel: 'local-llm', scanEffort: null }, 'no effort = the model default');
  assert.throws(() => assertWorkspaceScanInput([]), /must be \{ scanModel/);
  assert.throws(() => assertWorkspaceScanInput({ ...PICK, agentModel: 'haiku' }), /agentModel must be one of sonnet \| opus \| fable/);
  assert.throws(() => assertWorkspaceScanInput({ ...PICK, agentEffort: 'low' }), /agentEffort must be one of/);
  assert.throws(() => assertWorkspaceScanInput({ ...PICK, scanEffort: 'turbo' }), /scanEffort must be one of/);
  assert.throws(() => assertWorkspaceScanInput({ ...PICK, scanModel: 'nope' }, CATALOG), /unknown model "nope"/);
  assert.throws(() => assertWorkspaceScanInput({ ...PICK, scanModel: 'local-llm' }, CATALOG), /does not offer effort "high"/);
});

test('set / read round trip in settings.json; null clears; the key is a POST key', async () => {
  assert.ok(SETTINGS_POST_KEYS.includes('workspaceScan'));
  assert.equal(workspaceScanModels(), null, 'unset');
  await setWorkspaceScanModels(PICK, { models: CATALOG });
  assert.deepEqual(workspaceScanModels(), { ...PICK, scanModel: 'claude-opus-5-5' });
  assert.deepEqual(JSON.parse(await readFile(settingsFile(), 'utf8')).workspaces.scan, { ...PICK, scanModel: 'claude-opus-5-5' });
  await setWorkspaceScanModels(null);
  assert.equal(workspaceScanModels(), null);
  assert.equal(JSON.parse(await readFile(settingsFile(), 'utf8')).workspaces, undefined, 'an empty block is removed');
});

test('resolveScanModels: explicit > stored > default; a stale stored pick degrades with a warning', () => {
  const stored = { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'opus', agentEffort: 'high' };
  const ex = resolveScanModels({ explicit: PICK, stored, models: CATALOG });
  assert.equal(ex.source, 'explicit');
  assert.equal(ex.agentModel, 'fable');
  const st = resolveScanModels({ explicit: undefined, stored, models: CATALOG });
  assert.equal(st.source, 'settings');
  assert.equal(st.agentModel, 'opus');
  const stale = resolveScanModels({ stored: { ...stored, scanModel: 'gone-model' }, models: CATALOG });
  assert.equal(stale.source, 'default');
  assert.equal(stale.scanModel, 'claude-sonnet-5');
  assert.match(stale.warning, /gone-model/);
  const none = resolveScanModels({ models: CATALOG });
  assert.deepEqual({ ...none }, { ...WORKSPACE_SCAN_DEFAULT_MODELS, source: 'default', warning: null });
  assert.throws(() => resolveScanModels({ explicit: { ...PICK, agentModel: 'haiku' }, models: CATALOG }), /agentModel/);
  assert.equal(describeScanModels(none), 'scan agent claude-sonnet-5 · medium, project agents sonnet · medium');
});
