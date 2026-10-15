// test/run-overlay-policy-record.test.mjs — the team policy's allowed models are "soft: warn AND record": a per-run overlay
// pick (manifest.runOverlay — the Ask run card) outside `models.allowed` reaches the run's off-policy record
// (run-harness.mjs _resolvePolicy → policyRun.deviations → the run log's "off-policy:" line and team metrics).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after);
let sandboxHome;
const prevEnv = {};
before(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'worca-ovlpol-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(() => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  rmSync(sandboxHome, { recursive: true, force: true });
});
const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });

test('an overlay pick outside the team\'s allowed models is recorded as off-policy by the run', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-ovlpol-proj-'));
  try {
    writeTeamPolicyPrefs(projectKey(projectDir), {
      present: true, hasOrigin: true, docKnown: true, slug: 'acme', headSha: 'abc1234', delegateTo: null, unknownSchema: false,
      warnings: [], checkedAt: new Date().toISOString(),
      doc: { schema: 1, fields: { 'models.allowed': { kind: 'soft', value: ['claude-opus-5-5'] } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } },
    });
    const overlay = { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: '' } } };
    const orch = createOrchestrator({ projectDir, workflowId: 'wf_default', claude: { mock: true }, overlay });
    const t = await orch._resolveTopology(REG);
    orch.state.stepper = t.manifest;                       // run(): set before _resolvePolicy (and restored on resume)
    orch.stepModels = { planner: { model: 'claude-opus-5-5' } };   // the role slots: all on-policy
    await orch._resolvePolicy();
    assert.ok(orch.policyRun, 'the seeded policy applies');
    assert.ok(orch.policyRun.deviations.includes('model:claude-haiku-4-5'),
      `the overlay's off-policy pick is recorded (got ${JSON.stringify(orch.policyRun.deviations)})`);
    // An overlay naming only fan-out records nothing new.
    const fanOnly = createOrchestrator({ projectDir, workflowId: 'wf_default', claude: { mock: true }, overlay: { nodes: { n_plan: { fanOut: true } } } });
    fanOnly.state.stepper = (await fanOnly._resolveTopology(REG)).manifest;
    fanOnly.stepModels = { planner: { model: 'claude-opus-5-5' } };
    await fanOnly._resolvePolicy();
    assert.deepEqual(fanOnly.policyRun.deviations, []);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
