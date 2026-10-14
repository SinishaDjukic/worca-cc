// test/shape-estimate.test.mjs — the nudge's history-only estimates (estimate.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { estimateGraph, estimateChoices, stepHistory, ESTIMATE_MIN_SAMPLES } from '../src/core/shape/estimate.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import {
  GRAPH_DEFAULT_WORKFLOW, GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW, AUTO_WORKFLOW_STUB,
} from '../src/core/graph/builtin-workflows.mjs';

const DEFAULT_AGENTS = ['clarify', 'planner', 'refiner', 'implementer', 'reviewer'];

/** Every agent gets the same samples: cost [1,2,3] (median 2), ms [60k,120k,180k] (median 120k). */
function fakeHistory(agents, { n = 3 } = {}) {
  const cost = [1, 2, 3, 4, 5].slice(0, n);
  const ms = [60_000, 120_000, 180_000, 240_000, 300_000].slice(0, n);
  return new Map(agents.map((a) => [a, { cost: [...cost], ms: [...ms] }]));
}

test('estimateGraph: sums per-agent medians over the agent nodes', () => {
  const got = estimateGraph(GRAPH_DEFAULT_WORKFLOW, fakeHistory(DEFAULT_AGENTS));
  assert.deepEqual(got, { costUsd: 10, minutes: 10, samples: 3 });
});

test('estimateGraph: even sample count takes the mean of the middle two; cost rounds to cents', () => {
  const history = new Map([['planner', { cost: [0.111, 0.222, 0.333, 0.444], ms: [1000, 2000, 3000, 4000] }]]);
  const wf = { nodes: [{ id: 'n', kind: 'agent', key: 'planner' }] };
  assert.deepEqual(estimateGraph(wf, history), { costUsd: 0.28, minutes: 1, samples: 4 });
});

test('estimateGraph: minutes is at least 1', () => {
  const history = new Map([['planner', { cost: [0, 0, 0], ms: [0, 0, 0] }]]);
  const wf = { nodes: [{ id: 'n', kind: 'agent', key: 'planner' }] };
  assert.equal(estimateGraph(wf, history).minutes, 1);
});

test('estimateGraph: samples is the smallest per-agent count', () => {
  const history = fakeHistory(DEFAULT_AGENTS, { n: 5 });
  history.set('planner', { cost: [1, 2, 3], ms: [1, 2, 3] });
  assert.equal(estimateGraph(GRAPH_DEFAULT_WORKFLOW, history).samples, 3);
});

test('estimateGraph: no number without enough history', () => {
  assert.equal(ESTIMATE_MIN_SAMPLES, 3);
  const thin = fakeHistory(DEFAULT_AGENTS);
  thin.set('reviewer', { cost: [1, 2], ms: [1, 2] });
  assert.equal(estimateGraph(GRAPH_DEFAULT_WORKFLOW, thin), null, 'one agent with 2 samples');
  const missing = fakeHistory(DEFAULT_AGENTS.filter((a) => a !== 'clarify'));
  assert.equal(estimateGraph(GRAPH_DEFAULT_WORKFLOW, missing), null, 'one agent with no history');
  assert.equal(estimateGraph(AUTO_WORKFLOW_STUB, fakeHistory(DEFAULT_AGENTS)), null, 'Auto stub has no nodes');
  assert.equal(estimateGraph(GRAPH_DEFAULT_WORKFLOW, null), null, 'no history at all');
});

test('estimateChoices: same agents -> same: true, one shared figure', () => {
  const history = fakeHistory(DEFAULT_AGENTS);
  const got = estimateChoices({ asIs: GRAPH_DEFAULT_WORKFLOW, shaped: GRAPH_SHAPE_WORKFLOW }, { history });
  assert.equal(got.same, true);
  assert.deepEqual(got.asIs, got.shaped);
  assert.deepEqual(got.asIs, { costUsd: 10, minutes: 10, samples: 3 });
});

test('estimateChoices: different agents -> same: false', () => {
  const history = fakeHistory([...DEFAULT_AGENTS, 'manualTestsChecklist', 'manualWebUiTesting']);
  const got = estimateChoices({ asIs: GRAPH_DEFAULT_WORKFLOW, shaped: GRAPH_SHAPE_UX_WORKFLOW }, { history });
  assert.equal(got.same, false);
  assert.deepEqual(got.shaped, { costUsd: 14, minutes: 14, samples: 3 });
});

test('estimateChoices: the Auto stub has no estimate and is never "same"', () => {
  const history = fakeHistory(DEFAULT_AGENTS);
  const got = estimateChoices({ asIs: AUTO_WORKFLOW_STUB, shaped: GRAPH_SHAPE_WORKFLOW }, { history });
  assert.equal(got.same, false);
  assert.equal(got.asIs, null);
  assert.deepEqual(got.shaped, { costUsd: 10, minutes: 10, samples: 3 });
});

const homes = [];
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('stepHistory: one sample per (done run, agent), loops summed, failed and old runs and scripts ignored', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-estimate-')));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  const db = getDb();
  const now = Date.parse('2026-10-14T12:00:00.000Z');
  const recent = '2026-10-10T12:00:00.000Z';
  const old = '2026-07-01T12:00:00.000Z';
  const run = db.prepare('INSERT INTO pipelines (id, project_key, status, started_at) VALUES (?, ?, ?, ?)');
  run.run('r1', 'k', 'done', recent);
  run.run('r2', 'k', 'done', recent);
  run.run('r3', 'k', 'failed', recent);
  run.run('r4', 'k', 'done', old);
  const step = db.prepare('INSERT INTO pipeline_steps (pipeline_id, key, agent_key, cost_usd, active_ms) VALUES (?, ?, ?, ?, ?)');
  step.run('r1', '0:n_plan', 'planner', 1, 1000);
  step.run('r1', '1:n_impl', 'implementer', 2, 2000);
  step.run('r1', '3:n_impl#1', 'implementer', 3, 3000);
  step.run('r1', '4:n_script', null, 9, 9000);
  step.run('r2', '0:n_plan', 'planner', 4, 4000);
  step.run('r3', '0:n_plan', 'planner', 100, 100_000);
  step.run('r4', '0:n_plan', 'planner', 200, 200_000);

  const h = stepHistory({ now });
  assert.deepEqual([...h.keys()].sort(), ['implementer', 'planner']);
  assert.deepEqual(h.get('planner').cost.sort((a, b) => a - b), [1, 4]);
  assert.deepEqual(h.get('planner').ms.sort((a, b) => a - b), [1000, 4000]);
  assert.deepEqual(h.get('implementer'), { cost: [5], ms: [5000] });
});
