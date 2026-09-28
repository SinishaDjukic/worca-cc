// test/policy-gate.test.mjs
// The run-entry team-cap gates (src/core/policy/gate.mjs): soft everywhere — an acknowledgement
// once per window, an override per run, a required reason, warn-on-breach and unattended runs.
// The policy comes from the discovery CACHE (writeTeamPolicyPrefs), so no git is involved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getDb } from '../src/core/db.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { setPipelineCostLimitUsd, setTotalCostLimitUsd } from '../src/core/settings.mjs';
import { recordCostDelta, costWindowStart } from '../src/core/cost-budget.mjs';
import { teamCapsForTarget, checkTeamTotalGate, checkTeamPipelineGate } from '../src/core/policy/gate.mjs';
import { readPolicyState, readTotalAck } from '../src/core/policy/state.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-policy-gate-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

let proj;
const cachePolicy = (fields, extra = {}) => writeTeamPolicyPrefs(projectKey(proj), {
  present: true, hasOrigin: true, docKnown: true, slug: 'acme/gateway', headSha: 'abc1234def', delegateTo: null, unknownSchema: false, warnings: [],
  checkedAt: new Date().toISOString(), doc: { schema: 1, fields, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } }, ...extra,
});
const clearLedger = () => getDb().exec('DELETE FROM cost_ledger');

before(async () => {
  proj = await mkdtemp(join(tmpdir(), 'worca-policy-gate-proj-'));
  await addProject({ name: 'gateway', path: proj });
});

test('no policy: the fold is the local settings and nothing blocks', async () => {
  await setPipelineCostLimitUsd(5);
  const caps = await teamCapsForTarget({ projectDir: proj });
  assert.equal(caps.policy, null); assert.equal(caps.pipeline.cap, 5); assert.equal(caps.pipeline.binding, 'local');
  assert.equal((await checkTeamTotalGate({ projectDir: proj })).blocked, false);
  await setPipelineCostLimitUsd('');
});

test('total cap: blocked once, acknowledged per window, then free; a reason can be required', async () => {
  clearLedger();
  cachePolicy({ 'cost.totalLimitUsd': { kind: 'soft', value: 2, onBreach: 'pause', requireReason: true } });
  const { id } = await seedPipeline(proj, { title: 'spent', status: 'done' });
  recordCostDelta({ pipelineId: id, amountUsd: 2.5, tsMs: Date.now() });
  let g = await checkTeamTotalGate({ projectDir: proj });
  assert.equal(g.blocked, true); assert.equal(g.code, 'team_total'); assert.equal(g.policy.home, 'acme/gateway'); assert.equal(g.policy.requireReason, true);
  assert.match(g.error, /team total cap reached \(\$2\.50 >= \$2\.00 this month, acme\/gateway\)/);
  g = await checkTeamTotalGate({ projectDir: proj }, { pastTeamCap: true });
  assert.equal(g.blocked, true); assert.equal(g.code, 'reason_required');
  g = await checkTeamTotalGate({ projectDir: proj }, { pastTeamCap: true, reason: 'hotfix, agreed' });
  assert.equal(g.blocked, false); assert.equal(g.ack.reason, 'hotfix, agreed');
  assert.ok(readTotalAck(projectKey(proj), 'acme/gateway', costWindowStart(new Date(), 'monthly').getTime()));
  g = await checkTeamTotalGate({ projectDir: proj });
  assert.equal(g.blocked, false); assert.equal(g.acked, true);
  clearLedger();
});

test('total cap: onBreach warn and unattended runs never block; a tighter LOCAL total is not a team gate', async () => {
  clearLedger();
  const { id } = await seedPipeline(proj, { title: 'spent2', status: 'done' });
  recordCostDelta({ pipelineId: id, amountUsd: 9, tsMs: Date.now() });
  cachePolicy({ 'cost.totalLimitUsd': { kind: 'soft', value: 3, onBreach: 'warn' } }, { acks: {} });
  let g = await checkTeamTotalGate({ projectDir: proj });
  assert.equal(g.blocked, false); assert.equal(g.warned, true);
  cachePolicy({ 'cost.totalLimitUsd': { kind: 'soft', value: 3 } }, { acks: {} });
  g = await checkTeamTotalGate({ projectDir: proj }, { unattended: true });
  assert.equal(g.blocked, false); assert.equal(g.warned, true);
  await setTotalCostLimitUsd(1);                   // local 1 < team 3: the binding cap is local → not a team gate
  g = await checkTeamTotalGate({ projectDir: proj });
  assert.equal(g.blocked, false); assert.equal(g.caps.total.binding, 'local');
  await setTotalCostLimitUsd('');
  clearLedger();
});

test('pipeline cap at resume: blocked, then overridden with the reason persisted on the run', async () => {
  cachePolicy({ 'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause' } }, { acks: {} });
  const { id } = await seedPipeline(proj, { title: 'paused', status: 'paused' });
  const caps = await teamCapsForTarget({ projectDir: proj });
  assert.equal(caps.pipeline.binding, 'team'); assert.equal(caps.pipeline.cap, 10);
  assert.equal(checkTeamPipelineGate(caps, { pipelineId: id, spentSoFar: 4 }).blocked, false);
  let g = checkTeamPipelineGate(caps, { pipelineId: id, spentSoFar: 12 });
  assert.equal(g.blocked, true); assert.equal(g.code, 'team_pipeline'); assert.match(g.error, /team cost cap reached \(\$12\.00 >= \$10\.00, acme\/gateway\)/);
  g = checkTeamPipelineGate(caps, { pipelineId: id, spentSoFar: 12, pastTeamCap: true, reason: 'demo' });
  assert.equal(g.blocked, false); assert.equal(g.overridden, true);
  const st = readPolicyState(id);
  assert.deepEqual(st.overrides, ['pipeline']); assert.equal(st.reason, 'demo'); assert.equal(st.home, 'acme/gateway'); assert.equal(st.sha, 'abc1234def');
  g = checkTeamPipelineGate(caps, { pipelineId: id, spentSoFar: 50 });
  assert.equal(g.blocked, false, 'the override persists on the run');
  // A default-kind team cap is the developer's own cap: never a team gate.
  cachePolicy({ 'cost.pipelineLimitUsd': { kind: 'default', value: 1 } }, { acks: {} });
  const d = await teamCapsForTarget({ projectDir: proj });
  assert.equal(d.pipeline.binding, 'team-default');
  assert.equal(checkTeamPipelineGate(d, { pipelineId: id, spentSoFar: 50 }).blocked, false);
});

test('the reset period: a team default applies when the developer has not stored one', async () => {
  cachePolicy({ 'cost.resetPeriod': { kind: 'default', value: 'weekly' } }, { acks: {} });
  assert.equal((await teamCapsForTarget({ projectDir: proj })).period, 'weekly');
});
