// test/workflow-usage.test.mjs — the figures Stillhet's Workflows shows (slice 7 D13): per workflow, its tasks, merged
// share and running count, and per node the average cost and minutes, read from the pipelines and their steps.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { workflowUsage } from '../src/core/workflow-usage.mjs';

useTempHome(after, 'worca-wf-usage-');

const T = '2026-11-14T10:00:00.000Z';
function row(id, { wf, status = 'done', pr = null, stepper } = {}) {
  getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at, stepper, pr_url, pr_state)
    VALUES (?, 'p', 'project', ?, ?, 'done', 1, ?, ?, ?, ?, ?)`)
    .run(id, id, status, T, T, stepper ?? JSON.stringify({ template: { id: wf, name: wf } }), pr ? `https://x/pr/${id}` : null, pr);
}
function step(pid, nodeId, cost, ms) {
  getDb().prepare(`INSERT INTO pipeline_steps (pipeline_id, key, node_id, phase, step_index, cycle, status, active_ms, cost_usd)
    VALUES (?, ?, ?, 'x', 0, 1, 'done', ?, ?)`).run(pid, `0:${nodeId}`, nodeId, ms, cost);
}

test('an empty store has no usage', () => {
  assert.deepEqual(workflowUsage(getDb()), {});
});

test('two runs of wf_full, one merged: tasks, merged share, running and per-node averages; a broken stepper is skipped', () => {
  row('p1', { wf: 'wf_full', pr: 'MERGED' });
  row('p2', { wf: 'wf_full', pr: 'OPEN' });
  row('p3', { wf: 'wf_default', status: 'running' });
  row('p4', { stepper: '{not json' });
  step('p1', 'n_plan', 0.3, 120000); step('p2', 'n_plan', 0.1, 60000);
  step('p1', 'n_impl', 1.006, 600000);
  const u = workflowUsage(getDb());
  assert.deepEqual(Object.keys(u).sort(), ['wf_default', 'wf_full']);
  assert.equal(u.wf_full.tasks, 2);
  assert.equal(u.wf_full.merged, 50);
  assert.equal(u.wf_full.running, 0);
  assert.deepEqual(u.wf_full.nodes.n_plan, { costUsd: 0.2, minutes: 1.5 });
  assert.deepEqual(u.wf_full.nodes.n_impl, { costUsd: 1.01, minutes: 10 });
  assert.deepEqual(u.wf_default, { tasks: 1, merged: null, running: 1, nodes: {} });
});

test('a database without the pipelines table answers {} and never throws', () => {
  const fake = { prepare: () => { throw new Error('no such column: pr_state'); } };
  assert.deepEqual(workflowUsage(fake), {});
});
