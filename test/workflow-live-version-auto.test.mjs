// test/workflow-live-version-auto.test.mjs — I2: Auto and Ask match a saved twin against what that workflow RUNS
// (readRunnableWorkflow, the version in use), and an Auto run records the version it used (D8).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

process.env.WORCA_FLAGS = 'workflowTests';
useTempHome(after);
const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
const { normalizeShape, assembleShape } = await import('../src/shared/graph/assemble.mjs');
const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
const { createVersion } = await import('../src/core/workflow-versions.mjs');
const { autoCandidates, findEquivalentWorkflow } = await import('../src/core/auto/match.mjs');
const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-wfv-auto-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  delete process.env.WORCA_FLAGS;
  await rm(sandboxHome, { recursive: true, force: true });
});

const S = (agent, extra = {}) => ({ agent, ...extra });
const TWIN = { name: 'Versioned twin', taskKind: 'prompt', stages: [S('planner'), S('reviewer')] };
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });

/** wf_twin: v1 (in use) has TWIN's topology; the draft has grown a step, so only v1 is a twin of TWIN. */
async function versionedTwin() {
  const built = assembleShape(normalizeShape(TWIN), { registry: REG(), humanInLoop: false });
  await writeGraphWorkflow({ ...built.template, id: 'wf_twin', name: 'Twin', domain: 'coding' });
  await createVersion('wf_twin');
  const draft = structuredClone(built.template);
  draft.nodes.push({ id: 'n_extra', kind: 'agent', key: 'implementer', x: 900, y: 0, config: {} });
  await writeGraphWorkflow({ ...draft, id: 'wf_twin', name: 'Twin (draft)', domain: 'coding' });
  return built;
}

let built;
before(async () => { built = await versionedTwin(); });

test('autoCandidates offers a versioned row as its version in use, not its draft', async () => {
  const twin = (await autoCandidates()).find((c) => c.id === 'wf_twin');
  assert.deepEqual([twin.versionNo, twin.name, twin.nodes.length], [1, 'Twin', built.template.nodes.length]);
  assert.equal(findEquivalentWorkflow(built.template, await autoCandidates())?.candidate.id, 'wf_twin');
});

test('an Auto run reuses the twin the version in use is, runs that version and records it (D8)', { timeout: 120000 }, async () => {
  const classify = async () => ({ shape: normalizeShape(TWIN), warnings: [], costUsd: 0.01, usage: { input_tokens: 1, output_tokens: 1 }, attempts: 1, model: null });
  const orch = createOrchestrator({ projectDir: gitDir('wfv-auto'), workflowId: 'wf_auto', prompt: 'Build the thing, carefully.', claude: { mock: true }, humanInLoop: false, classify });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const st = orch.getState();
  assert.deepEqual([st.stepper.auto.via, st.stepper.auto.workflowId], ['reused', 'wf_twin']);
  assert.deepEqual(st.stepper.workflowVersion, { no: 1 });
  assert.equal(st.stepper.template.name, 'Twin');
  assert.equal(st.stepper.graph.nodes.some((n) => n.id === 'n_extra'), false, 'the draft-only step does not run');
});
