// test/effort-intents.test.mjs — per-step effort intents (light | standard | deep), mapped per model family and clamped
// to the model's own efforts; filled by resolveGraph only at run start (fillIntents), only for an unset effort.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { nearestEffort } from '../src/shared/connections.mjs';
import {
  EFFORT_INTENTS, DEFAULT_INTENT, STEP_INTENTS, STEP_INTENT_NAMES, INTENT_EFFORTS, stepIntent, intentEffort, intentEffortFor,
} from '../src/core/effort-intents.mjs';
import { EFFORTS } from '../src/core/model-env.mjs';
import { PREDEFINED_MODELS, COPILOT_BUILTIN_MODELS, setNodeModel } from '../src/core/config.mjs';

const claudeRow = (id) => PREDEFINED_MODELS.find((m) => m.id === id);
const copilotRow = (id) => COPILOT_BUILTIN_MODELS.find((m) => m.id === id);
// A family's built-in Claude id and its catalog efforts (fable-5-2 has no catalog row yet: effortsOf falls back to EFFORTS).
const FAMILY_IDS = {
  'fable-5-2': 'claude-fable-5-2', 'opus-5-5': 'claude-opus-5-5', 'sonnet-5-5': 'claude-sonnet-5-5',
  'opus-4-8': 'claude-opus-4-8', 'haiku-5-5': 'claude-haiku-5-5',
};
const COPILOT_IDS = {
  'opus-5-5': 'copilot/claude-opus-5.5', 'sonnet-5-5': 'copilot/claude-sonnet-5.5', 'opus-4-8': 'copilot/claude-opus-4.8',
  'haiku-5-5': 'copilot/claude-haiku-5.5',
};
const claudeList = (family) => claudeRow(FAMILY_IDS[family])?.efforts || EFFORTS;

// ---- nearestEffort (the rule effortOn already applied, extracted) ----

test('nearestEffort: listed as is, else the nearest on the rank scale, a tie to the earlier entry', () => {
  assert.equal(nearestEffort('high', ['medium', 'high']), 'high');
  assert.equal(nearestEffort('medium', ['high', 'max']), 'high');
  assert.equal(nearestEffort('high', ['medium', 'xhigh']), 'medium', 'a tie keeps the earlier entry');
  assert.equal(nearestEffort('low', EFFORTS), 'medium');
  assert.equal(nearestEffort('xhigh', ['low', 'medium', 'high']), 'high');
  assert.equal(nearestEffort('none', ['minimal', 'low']), 'minimal');
});

test('nearestEffort: an empty or non-array list, a falsy or off-scale effort give null', () => {
  assert.equal(nearestEffort('high', []), null);
  assert.equal(nearestEffort('high', null), null);
  assert.equal(nearestEffort('high', 'high'), null);
  assert.equal(nearestEffort('', EFFORTS), null);
  assert.equal(nearestEffort(undefined, EFFORTS), null);
  assert.equal(nearestEffort('ultra', EFFORTS), null);
});

// ---- the tables ----

test('the vocabulary and the default', () => {
  assert.deepEqual([...EFFORT_INTENTS], ['light', 'standard', 'deep']);
  assert.ok(Object.isFrozen(EFFORT_INTENTS) && Object.isFrozen(STEP_INTENTS) && Object.isFrozen(INTENT_EFFORTS) && Object.isFrozen(STEP_INTENT_NAMES));
  assert.equal(DEFAULT_INTENT, 'standard');
});

const TABLE = {
  'fable-5-2': { light: 'low', standard: 'medium', deep: 'high' },
  'opus-5-5': { light: 'low', standard: 'medium', deep: 'high' },
  'sonnet-5-5': { light: 'low', standard: 'medium', deep: 'high' },
  'opus-4-8': { light: 'medium', standard: 'high', deep: 'xhigh' },
  'haiku-5-5': { light: 'low', standard: 'medium', deep: 'high' },
};
for (const [family, row] of Object.entries(TABLE)) {
  for (const intent of ['light', 'standard', 'deep']) {
    const runs = intent === 'light' ? 'medium' : row[intent];
    const name = row[intent] === runs ? `${family} × ${intent} → ${row[intent]}` : `${family} × ${intent} → ${row[intent]} (runs ${runs})`;
    test(name, () => {
      assert.equal(INTENT_EFFORTS[family][intent], row[intent], 'the request\'s table value');
      assert.equal(intentEffort({ intent, model: FAMILY_IDS[family], engine: 'claude', efforts: claudeList(family) }), runs, 'clamped on the Claude list');
    });
  }
}

test('only the five named families are mapped', () => {
  assert.deepEqual(Object.keys(INTENT_EFFORTS).sort(), Object.keys(TABLE).sort());
});

test('clamp: haiku-5-5 light low → medium', () => {
  assert.equal(intentEffort({ intent: 'light', model: 'claude-haiku-5-5', engine: 'claude', efforts: EFFORTS }), 'medium');
});

test('clamp: copilot/claude-opus-4.8 deep xhigh → high', () => {
  const efforts = copilotRow('copilot/claude-opus-4.8').efforts;
  assert.equal(intentEffort({ intent: 'deep', model: 'copilot/claude-opus-4.8', engine: 'copilot', efforts }), 'high');
  assert.equal(intentEffort({ intent: 'light', model: 'copilot/claude-opus-5.5', engine: 'copilot', efforts: copilotRow('copilot/claude-opus-5.5').efforts }), 'low', 'Copilot lists low');
});

test('clamp: a list above the mapped value, and an empty list', () => {
  assert.equal(intentEffort({ intent: 'standard', model: 'claude-opus-5-5', engine: 'claude', efforts: ['high', 'max'] }), 'high');
  assert.equal(intentEffort({ intent: 'standard', model: 'claude-opus-5-5', engine: 'claude', efforts: [] }), null);
  assert.equal(intentEffort({ intent: 'standard', model: 'claude-opus-5-5', engine: 'claude', efforts: undefined }), null);
});

test('[1m] and dated ids map to their family', () => {
  assert.equal(intentEffort({ intent: 'deep', model: 'claude-opus-4-8[1m]', engine: 'claude', efforts: claudeRow('claude-opus-4-8[1m]').efforts }), 'xhigh');
  assert.equal(intentEffort({ intent: 'deep', model: 'claude-opus-4-8-20260101', engine: 'claude', efforts: EFFORTS }), 'xhigh');
});

test('no family, no effort', () => {
  for (const model of ['gpt-5.5', 'claude-x-9', '', null, undefined, 'opus', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-fable-5-1']) {
    assert.equal(intentEffort({ intent: 'deep', model, engine: 'claude', efforts: EFFORTS }), null, String(model));
  }
  assert.equal(intentEffort({ intent: 'deep', model: 'copilot/gpt-5.5', engine: 'copilot', efforts: ['low', 'medium', 'high'] }), null);
  assert.equal(intentEffort({ intent: 'deep', model: 'claude-opus-5-5', engine: 'codex', efforts: ['low', 'medium', 'high'] }), null, 'claude-opus-5-5 on Codex');
  assert.equal(intentEffort({ intent: 'bogus', model: 'claude-opus-5-5', engine: 'claude', efforts: EFFORTS }), null, 'an unknown intent');
  assert.equal(intentEffort({ intent: 'constructor', model: 'claude-opus-5-5', engine: 'claude', efforts: EFFORTS }), null);
  assert.equal(intentEffort(), null, 'never throws');
});

test('sweep: every filled effort is one the model lists (Claude and Copilot rows)', () => {
  for (const family of Object.keys(TABLE)) {
    for (const intent of EFFORT_INTENTS) {
      const list = claudeList(family);
      const got = intentEffort({ intent, model: FAMILY_IDS[family], engine: 'claude', efforts: list });
      assert.ok(list.includes(got), `${family} ${intent} claude → ${got}`);
      if (COPILOT_IDS[family]) {
        const cl = copilotRow(COPILOT_IDS[family]).efforts;
        const c = intentEffort({ intent, model: COPILOT_IDS[family], engine: 'copilot', efforts: cl });
        assert.ok(cl.includes(c), `${family} ${intent} copilot → ${c}`);
      }
    }
  }
});

test('stepIntent: by agent key, else the default', () => {
  assert.equal(stepIntent('planner'), 'deep');
  assert.equal(stepIntent('implementer'), 'standard');
  assert.equal(stepIntent('decomposer'), 'light');
  assert.equal(stepIntent('clarify'), 'standard');
  assert.equal(stepIntent('myPluginAgent'), 'standard');
  assert.equal(stepIntent('constructor'), 'standard', 'an inherited name is never a row');
  assert.equal(stepIntent(undefined), 'standard');
});

test('stepIntent: a plugin step by its display name (the plugin bug steps)', () => {
  assert.equal(stepIntent('bugRootCause', { name: 'Bug Root Cause' }), 'deep');
  assert.equal(stepIntent('bugReportAnalysis', { name: ' bug report analysis ' }), 'light');
  assert.equal(stepIntent('bugTriageReport', { name: 'Bug Triage Report' }), 'light');
  assert.equal(stepIntent('bugFix', { name: 'Bug Fix' }), 'standard');
  assert.equal(stepIntent('planner', { name: 'Bug Triage Report' }), 'deep', 'the key wins');
  assert.equal(stepIntent('x', { name: 'constructor' }), 'standard');
  assert.equal(stepIntent('x', { name: 42 }), 'standard', 'a non-string name is empty');
});

test('every built-in agent key has an intent', () => {
  const keys = readdirSync(new URL('../agents/', import.meta.url)).filter((f) => f.endsWith('.meta.json'))
    .map((f) => JSON.parse(readFileSync(new URL(`../agents/${f}`, import.meta.url), 'utf8')).key).sort();
  assert.equal(keys.length, 35);
  assert.deepEqual(Object.keys(STEP_INTENTS).sort(), keys);
  for (const v of Object.values(STEP_INTENTS)) assert.ok(EFFORT_INTENTS.includes(v));
});

test('intentEffortFor: the step\'s intent on its model; efforts may be a lazy function read only for a mapped family', async () => {
  assert.equal(await intentEffortFor({ agentKey: 'planner', model: 'claude-opus-4-8', engine: 'claude', efforts: EFFORTS }), 'xhigh');
  assert.equal(await intentEffortFor({ agentKey: 'bugRootCause', name: 'Bug Root Cause', model: 'claude-opus-4-8', engine: 'claude', efforts: EFFORTS }), 'xhigh');
  assert.equal(await intentEffortFor({ agentKey: 'implementer', model: 'claude-opus-4-8', engine: 'claude', efforts: async () => EFFORTS }), 'high');
  let reads = 0;
  const lazy = async () => { reads += 1; return EFFORTS; };
  assert.equal(await intentEffortFor({ agentKey: 'planner', model: 'claude-opus-4-7', engine: 'claude', efforts: lazy }), null);
  assert.equal(await intentEffortFor({ agentKey: 'planner', model: 'gpt-5.5', engine: 'codex', efforts: lazy }), null);
  assert.equal(reads, 0, 'no catalog read for an unmapped model');
});

// ---- the resolveGraph fill, the run-start gate, the argv ----

let sandboxHome;
const prevEnv = {};
const dirs = [];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-ei-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
useTempHome(after);
process.env.WORCA_HOST_GUARD = '0';

const { resolveGraph } = await import('../src/core/workflows.mjs');
const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');
const { createOrchestrator, resolvedFromManifest } = await import('../src/core/orchestrator.mjs');
const { buildGraphManifest } = await import('../src/shared/graph/manifest.mjs');
const { buildClaudeArgs } = await import('../src/core/claude-runner.mjs');
const { buildCopilotArgs } = await import('../src/core/engines/copilot.mjs');
const { buildCodexArgs } = await import('../src/core/engines/codex.mjs');
const { completeSnapshot } = await import('../src/core/run-presets-check.mjs');

const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const repo = () => {
  const d = mkdtempSync(join(tmpdir(), 'worca-cc-ei-'));
  dirs.push(d);
  const g = (a) => spawnSync('git', a, { cwd: d });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(d, 'README.md'), '# hi\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
  return d;
};
const TPL_PLAN = { id: 'n_plan', kind: 'agent', key: 'planner', config: {} };
/** The argv a Plan step spawns on a run started with `claude` (+ overlay): _resolveTopology (the gate) → _execCtx. */
async function planArgv({ projectDir = repo(), claude = { mock: true }, overlay } = {}) {
  const orch = createOrchestrator({ projectDir, workflowId: 'wf_default', prompt: 'x', claude, ...(overlay ? { overlay } : {}) });
  await orch._resolveTopology(REG());
  orch.pipeline = { id: 'p1', dir: projectDir, promptText: 'x' };
  const nc = orch.resolved.nodeCtx.n_plan;
  const ctx = orch._execCtx(TPL_PLAN, nc, { executionId: 'x:n_plan:1', ordinal: 1 });
  return { argv: buildClaudeArgs({ prompt: 'x', ...ctx.claudeOpts }), nc, orch };
}
const effortIn = (argv) => { const i = argv.indexOf('--effort'); return i < 0 ? null : argv[i + 1]; };

test('resolveGraph fills only with fillIntents: n_plan on claude-opus-4-8 → xhigh', async () => {
  const projectDir = repo();
  const on = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { engine: 'claude', runModel: 'claude-opus-4-8', fillIntents: true });
  assert.equal(on.nodes.n_plan.effort, 'xhigh');
  assert.equal(on.nodes.n_impl.effort, 'high', 'implementer: standard on Opus 4.8');
  const off = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { engine: 'claude', runModel: 'claude-opus-4-8' });
  assert.equal(off.nodes.n_plan.effort, undefined, 'no gate, no fill (previews, snapshots, exports)');
});

test('Plan on claude-opus-4-8 with no stored effort spawns --effort xhigh', async () => {
  const { argv } = await planArgv({ claude: { mock: true, model: 'claude-opus-4-8' } });
  assert.equal(effortIn(argv), 'xhigh');
});

test('a stored effort medium wins: --effort medium', async () => {
  const projectDir = repo();
  await setNodeModel(projectDir, 'wf_default', 'n_plan', { model: 'claude-opus-4-8', effort: 'medium' });
  const { argv } = await planArgv({ projectDir, claude: { mock: true } });
  assert.equal(effortIn(argv), 'medium');
});

test('gpt-5.5 / claude-x-9 / empty model: no --effort in argv', async () => {
  for (const model of ['claude-x-9', 'claude-opus-4-7']) {
    const { argv } = await planArgv({ overlay: { nodes: { n_plan: { model } } } });
    assert.equal(effortIn(argv), null, model);
  }
  const { argv } = await planArgv({ claude: { mock: true } });
  assert.equal(effortIn(argv), null, 'no model at all: the CLI default');
});

test('codex + gpt-5.5: no fill, no model_reasoning_effort', async () => {
  const orch = createOrchestrator({ projectDir: repo(), workflowId: 'wf_default', prompt: 'x', claude: { mock: true, engine: 'codex', model: 'gpt-5.5' } });
  await orch._resolveTopology(REG());
  const effort = orch.resolved.nodeCtx.n_plan.effort;
  assert.equal(effort, undefined);
  assert.equal(buildCodexArgs({ model: 'gpt-5.5', effort }).some((a) => String(a).includes('model_reasoning_effort')), false);
});

test('copilot claude-*: reasoning effort from the intent', async () => {
  const projectDir = repo();
  const r = await resolveGraph(projectDir, 'wf_default', REG(), undefined, { engine: 'copilot', fillIntents: true,
    overlay: { nodes: { n_plan: { model: 'copilot/claude-opus-4.8', effort: '' }, n_impl: { model: 'copilot/gpt-5.5', effort: '' } } } });
  assert.equal(r.nodes.n_plan.model, 'copilot/claude-opus-4.8');
  assert.equal(r.nodes.n_plan.effort, 'high', 'deep xhigh clamped to the Copilot row');
  const args = buildCopilotArgs({ sessionId: 'S', model: r.nodes.n_plan.model, effort: r.nodes.n_plan.effort });
  const i = args.indexOf('--reasoning-effort');
  assert.deepEqual(args.slice(i, i + 2), ['--reasoning-effort', 'high']);
  assert.equal(r.nodes.n_impl.model, 'copilot/gpt-5.5');
  assert.equal(r.nodes.n_impl.effort, undefined);
  assert.equal(buildCopilotArgs({ sessionId: 'S', model: 'copilot/gpt-5.5', effort: r.nodes.n_impl.effort }).includes('--reasoning-effort'), false);
});

test('run-setup snapshot keeps an empty effort (no fillIntents)', async () => {
  const projectDir = repo();
  await setNodeModel(projectDir, 'wf_default', 'n_plan', { model: 'claude-opus-4-8' });
  const snap = completeSnapshot({ workflowId: 'wf_default' }, await resolveGraph(projectDir, 'wf_default', REG(), undefined, { engine: 'claude' }));
  assert.deepEqual({ model: snap.overlay.nodes.n_plan.model, effort: snap.overlay.nodes.n_plan.effort }, { model: 'claude-opus-4-8', effort: '' });
});

test('defragment pair with no effort: no fill', async () => {
  const t = await createOrchestrator({ projectDir: repo(), workflowId: 'wf_memory_defrag', memoryScope: 'project',
    claude: { mock: true, model: 'claude-opus-4-8' } })._resolveTopology(REG());
  const cell = t.manifest.graph.nodes.find((n) => n.id === 'n_defrag');
  assert.equal(cell.model, 'claude-opus-4-8', 'the pinned pair');
  assert.equal(cell.effort, '');
});

test('resume keeps the filled effort', async () => {
  const reg = REG();
  const r = await resolveGraph(repo(), 'wf_default', reg, undefined, { engine: 'claude', runModel: 'claude-opus-4-8', fillIntents: true });
  const manifest = buildGraphManifest(r.template, r.agentsByKey, { overlays: { nodes: r.nodes, wires: r.wires } });
  assert.equal(resolvedFromManifest(manifest, reg).nodes.n_plan.effort, 'xhigh');
});
