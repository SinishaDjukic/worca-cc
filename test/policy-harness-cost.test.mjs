// test/policy-harness-cost.test.mjs
// The step-boundary gate with a team policy in force (run-harness._checkCostLimits, team-policy
// design §7): the tighter cap wins, a team breach pauses on the policy reason, an override or an
// acknowledgement lets it through, and warn-on-breach / unattended runs log + record instead.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { setPipelineCostLimitUsd, setTotalCostLimitUsd } from '../src/core/settings.mjs';
import { recordCostDelta, setCostCapOverride, costWindowStart } from '../src/core/cost-budget.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readPolicyState, writePolicyState, setTotalAck } from '../src/core/policy/state.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-policy-harness-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const PROJ = '/tmp/proj-policy';
const clearLedger = () => getDb().exec('DELETE FROM cost_ledger');

/** An orchestrator with a seeded row and a policy already resolved (as _resolvePolicy leaves it). */
async function orchWithPolicy(fields, { auto = false } = {}) {
  const orch = createOrchestrator({ projectDir: PROJ, auto });
  const { id, dir } = await seedPipeline(PROJ, { status: 'running' });
  orch.pipeline = { id, dir };
  orch.state.id = id; orch.state.status = 'running'; orch.state.phase = 'plan';
  orch.state.steps = [{ key: 'plan', costUsd: 0 }];
  orch.policyRun = { home: 'acme/gateway', homeDir: PROJ, sha: 'abc1234def', fields, deviations: ['model:x'], unattended: auto };
  orch._policyPersisted = false; orch._policyWarned = new Set();
  return { orch, id };
}
const soft = (value, extra = {}) => ({ kind: 'soft', declaredKind: 'soft', value, onBreach: 'pause', ...extra });

test('team soft cap tighter than local: pauses on cost_pipeline_policy and stamps the run state', async () => {
  await setPipelineCostLimitUsd(25);
  const { orch, id } = await orchWithPolicy({ 'cost.pipelineLimitUsd': soft(1) });
  orch.state.totalCostUsd = 0.5;
  assert.doesNotThrow(() => orch._checkCostLimits());
  const st0 = readPolicyState(id);
  assert.equal(st0.home, 'acme/gateway'); assert.deepEqual(st0.deviations, ['model:x']);
  orch.state.totalCostUsd = 1;
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_pipeline_policy');
  assert.match(orch.pauseDetail, /team cost cap reached \(\$1\.00 >= \$1\.00, acme\/gateway\)/);
  await setPipelineCostLimitUsd('');
});

test('local tighter than team: the plain cost_pipeline pause; the local override does not touch the team cap', async () => {
  await setPipelineCostLimitUsd(1);
  const { orch, id } = await orchWithPolicy({ 'cost.pipelineLimitUsd': soft(5) });
  orch.state.totalCostUsd = 2;
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_pipeline');
  orch._clearPauseReason(); orch.pauseRequested = false;
  setCostCapOverride(id);                       // ignore MY cap …
  orch.state.totalCostUsd = 6;                  // … but the team's still binds at $5
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_pipeline_policy');
  await setPipelineCostLimitUsd('');
});

test('the per-run team override lets the run past; a team DEFAULT cap behaves like a local cap', async () => {
  const { orch, id } = await orchWithPolicy({ 'cost.pipelineLimitUsd': soft(1) });
  writePolicyState(id, { overrides: ['pipeline'] });
  orch.state.totalCostUsd = 9;
  assert.doesNotThrow(() => orch._checkCostLimits());
  const { orch: o2 } = await orchWithPolicy({ 'cost.pipelineLimitUsd': { kind: 'default', declaredKind: 'default', value: 1 } });
  o2.state.totalCostUsd = 2;
  assert.throws(() => o2._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(o2.pauseReason, 'cost_pipeline', 'a default is the developer\'s own starting value');
});

test('onBreach warn and unattended runs: one warning line, exceeded recorded, no pause', async () => {
  const { orch, id } = await orchWithPolicy({ 'cost.pipelineLimitUsd': soft(1, { onBreach: 'warn' }) });
  orch.state.totalCostUsd = 3;
  const logs = [];
  const origLog = orch._log.bind(orch);
  orch._log = (where, level, text, meta) => { logs.push({ where, level, text }); return origLog(where, level, text, meta); };
  assert.doesNotThrow(() => orch._checkCostLimits());
  assert.doesNotThrow(() => orch._checkCostLimits());
  const warns = logs.filter((l) => l.where === 'policy' && l.level === 'warn');
  assert.equal(warns.length, 1); assert.match(warns[0].text, /the policy says warn/);
  assert.deepEqual(readPolicyState(id).exceeded, ['pipeline']);
  const { orch: a, id: aid } = await orchWithPolicy({ 'cost.pipelineLimitUsd': soft(1) }, { auto: true });
  a.state.totalCostUsd = 3;
  assert.doesNotThrow(() => a._checkCostLimits());
  const s = readPolicyState(aid);
  assert.deepEqual(s.exceeded, ['pipeline']); assert.equal(s.unattended, true);
});

test('team total cap: pauses on cost_total_policy; an acknowledgement for the window records the override', async () => {
  clearLedger();
  const { orch, id } = await orchWithPolicy({ 'cost.totalLimitUsd': soft(2) });
  recordCostDelta({ pipelineId: id, amountUsd: 2.5, tsMs: Date.now() });
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_total_policy');
  assert.match(orch.pauseDetail, /team total cap reached \(\$2\.50 >= \$2\.00 this month, acme\/gateway\)/);
  orch._clearPauseReason(); orch.pauseRequested = false;
  setTotalAck(projectKey(PROJ), 'acme/gateway', costWindowStart(new Date(), 'monthly').getTime(), { reason: 'sprint end' });
  assert.doesNotThrow(() => orch._checkCostLimits());
  const s = readPolicyState(id);
  assert.deepEqual(s.overrides, ['total']); assert.equal(s.reason, 'sprint end');
  // The LOCAL total cap is never bypassable by a team acknowledgement.
  await setTotalCostLimitUsd(1);
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_total');
  await setTotalCostLimitUsd('');
  clearLedger();
});

test('no policy on the run: byte-identical local behaviour, no policy state written', async () => {
  await setPipelineCostLimitUsd(1);
  const orch = createOrchestrator({ projectDir: PROJ });
  const { id, dir } = await seedPipeline(PROJ, { status: 'running' });
  orch.pipeline = { id, dir }; orch.state.id = id; orch.state.status = 'running'; orch.state.steps = [{ key: 'plan', costUsd: 0 }];
  orch.state.totalCostUsd = 2;
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_pipeline');
  assert.deepEqual(readPolicyState(id), {});
  await setPipelineCostLimitUsd('');
});
