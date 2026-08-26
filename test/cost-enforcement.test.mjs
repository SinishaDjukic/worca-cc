// test/cost-enforcement.test.mjs
// Cost-limit enforcement at the orchestrator boundary: every real cost event
// must land one append-only cost_ledger row, and an orchestrator with no
// pipeline attached must stay DB-free.
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
import { recordCostDelta, setCostCapOverride, recordAskCostDelta } from '../src/core/cost-budget.mjs';
import { listAllPipelines, listPipelines } from '../src/core/artifacts.mjs';

useTempHome(after);

// settings sandbox: settingsFile() resolves under HOME, not WORCA_HOME.
// WORCA_HOME (set by useTempHome / npm test) is deliberately left untouched
// so the DB stays pinned to the temp home for the whole suite.
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cost-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

const clearLedger = () => getDb().exec('DELETE FROM cost_ledger');

const makeOrch = () => createOrchestrator({ projectDir: '/tmp/proj' });

// Orchestrator + seeded DB row attached the way run() does after createPipeline.
// state.status = 'running' matters for the pause gate: pause() no-ops on any
// other status.
// NOTE: once orch.pipeline is set, _recordCost's _persist() really writes the
// seeded row via writeState — harmless in the temp-home DB (and try/caught).
async function makeOrchWithPipeline(state = { status: 'running' }) {
  const orch = makeOrch();
  const { id, dir } = await seedPipeline('/tmp/proj-a', state);
  orch.pipeline = { id, dir };
  orch.state.id = id;
  orch.state.status = 'running';
  orch.state.phase = 'plan';
  orch.state.steps = [{ key: 'plan', costUsd: 0 }];
  return { orch, id };
}

test('_recordCost appends a ledger row with the step key; $0 events do not', async () => {
  clearLedger();
  const { orch, id } = await makeOrchWithPipeline();
  orch._recordCost(0.42, 'plan');
  orch._recordCost(0, 'plan');                  // mock/$0 -> no row
  const rows = getDb().prepare('SELECT * FROM cost_ledger').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pipeline_id, id);
  assert.equal(rows[0].step_key, 'plan');
  assert.equal(rows[0].amount_usd, 0.42);
});

test('_recordCost without a pipeline id stays DB-free (no throw, no row)', () => {
  clearLedger();
  const orch = makeOrch();                      // no pipeline attached
  orch.state.phase = 'plan';
  orch.state.steps = [{ key: 'plan', costUsd: 0 }];
  orch._recordCost(0.5, 'plan');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM cost_ledger').get().n, 0);
});

test('_checkCostLimits pauses at the per-pipeline cap with pauseReason cost_pipeline', async () => {
  await setPipelineCostLimitUsd(1);
  const { orch } = await makeOrchWithPipeline({ status: 'running' });
  orch.state.totalCostUsd = 1.0;                                      // at the cap counts
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_pipeline');
  await setPipelineCostLimitUsd('');                                  // cleanup
});

test('below the cap: no pause; override set: no pipeline-cap pause', async () => {
  await setPipelineCostLimitUsd(1);
  const { orch, id } = await makeOrchWithPipeline({ status: 'running' });
  orch.state.totalCostUsd = 0.99;
  assert.doesNotThrow(() => orch._checkCostLimits());
  orch.state.totalCostUsd = 5;
  setCostCapOverride(id);
  assert.doesNotThrow(() => orch._checkCostLimits());
  await setPipelineCostLimitUsd('');
});

// resume() rehydrates state.steps from the persisted step rows but never
// restores state.totalCostUsd, so between a resume and the first cost event the
// row-level total reads $0. The gate must sum the rehydrated steps too, or an
// over-cap pipeline gets one free full step on every resume.
test('the pipeline-cap gate sums rehydrated steps, not just a stale state total', async () => {
  await setPipelineCostLimitUsd(1);
  const { orch } = await makeOrchWithPipeline({ status: 'running' });
  orch.state.totalCostUsd = 0;                       // as resume() leaves it
  orch.state.steps = [{ key: 'plan', costUsd: 0.6 }, { key: 'code', costUsd: 0.5 }];
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_pipeline');
  await setPipelineCostLimitUsd('');
});

test('total cap trips from the seeded ledger even with the override set', async () => {
  clearLedger();
  await setTotalCostLimitUsd(2);
  const { orch, id } = await makeOrchWithPipeline({ status: 'running' });
  setCostCapOverride(id);
  recordCostDelta({ pipelineId: 'other', amountUsd: 2.5, tsMs: Date.now() });
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_total');
  await setTotalCostLimitUsd('');
  clearLedger();
});

test('total cap trips from Ask Worca spend alone (count-everywhere D3)', async () => {
  clearLedger();
  getDb().exec('DELETE FROM ask_cost_ledger');
  await setTotalCostLimitUsd(2);
  const { orch } = await makeOrchWithPipeline({ status: 'running' });
  recordAskCostDelta({ threadId: 'ask_ffffffff', amountUsd: 2.5, tsMs: Date.now() });
  assert.throws(() => orch._checkCostLimits(), (e) => e.name === 'PauseError');
  assert.equal(orch.pauseReason, 'cost_total');
  await setTotalCostLimitUsd('');
  getDb().exec('DELETE FROM ask_cost_ledger');
});

test('resume point JSON carries pauseReason', async () => {
  const { orch } = await makeOrchWithPipeline({ status: 'running' });
  orch.pauseReason = 'cost_pipeline';
  const rp = orch._buildResumePoint({
    plan: { id: 'p', name: 'n', steps: [], feedbacks: [] },
    stepIndex: 0,
    stepCycle: [],
    loopState: {},
    bus: {},
  });
  assert.equal(rp.pauseReason, 'cost_pipeline');
});

test('list wire rows expose pauseReason from resume_point', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', {
    status: 'paused',
    resumePoint: { version: 1, kind: 'boundary', pauseReason: 'cost_total' },
  });
  // GET /api/history serves listAllPipelines() verbatim (ui/server.mjs:1125)
  const entries = await listAllPipelines();
  const mine = entries.find((e) => e.id === id);
  assert.equal(mine.pauseReason, 'cost_total');
});

// json_extract() THROWS on invalid JSON rather than returning NULL, so a single
// truncated resume_point (a crash mid-write) would take down History entirely.
test('a malformed resume_point does not break the list queries', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', {
    status: 'paused',
    resumePoint: { version: 1, kind: 'boundary', pauseReason: 'cost_total' },
  });
  getDb().prepare("UPDATE pipelines SET resume_point = '{\"version\": 1, tru' WHERE id = ?").run(id);
  const all = await listAllPipelines();
  const mine = all.find((e) => e.id === id);
  assert.ok(mine, 'the corrupt row still lists');
  assert.equal(mine.pauseReason, null, 'unparseable resume points read as no reason');
  const perProject = await listPipelines('/tmp/proj-a');
  assert.ok(perProject.find((e) => e.id === id), 'the per-project list survives it too');
});
