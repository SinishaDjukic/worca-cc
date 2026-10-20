// test/record-upgrade-snapshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubSnapshot, KEEP } from '../tools/record-upgrade-snapshot.mjs';

const RAW = {
  schemaVersion: 60,
  tables: {
    pipelines: [
      { id: '18-10-26-secret-feature-ab12', project_key: 'proj-9f', workspace_key: null, target: 'project', title: 'Secret customer fix',
        status: 'done', phase: 'done', cycle: 1, started_at: '2026-10-18T09:00:00Z', updated_at: '2026-10-18T10:00:00Z',
        total_cost_usd: 1.5, total_active_ms: 1000, prompt: 'call ACME', branch: '{"feature":"secret"}', archived_at: null,
        pr_url: 'https://github.com/realorg/real/pull/12', pr_number: 12, pr_state: 'OPEN', resume_point: null,
        outcome: '{"endReached":true,"runEngine":"codex","tokens":{"n.plan":{"path":"/Users/x/store/secret-plan.md"}}}',
        some_future_column: 'secret text a later migration added' },
      { id: '18-10-26-other-cd34', project_key: 'proj-9f', target: 'project', title: 'Other', status: 'stopped',
        phase: 'build', cycle: 0, archived_at: '2026-10-18T11:00:00Z', prompt: null,
        resume_point: '{"pauseReason":"usage_limit","detail":"secret quote"}' },
    ],
    pipeline_steps: [{ pipeline_id: '18-10-26-secret-feature-ab12', key: 'plan', node_id: 'n1', phase: 'plan', status: 'done',
      exec_meta: '{"x":1}', exec_result: 'secret output' }],
    shape_features: [{ id: 'feat_aa', title: 'Secret feature', project_dir: '/Users/x/src/real', origin_pipeline_id: '18-10-26-secret-feature-ab12',
      source_branch: 'feat/secret', outline: '{"why":"secret"}', request_base: '{"prompt":"secret"}', perspectives: '[]',
      workflow_id: 'wf_shape', status: 'active', created_at: 't', updated_at: 't' }],
    shape_feature_slices: [{ feature_id: 'feat_aa', idx: 1, slice_id: 's1', title: 'Secret slice', ticket_id: null, pipeline_id: '18-10-26-secret-feature-ab12' }],
    scheduled_runs: [{ id: 'tkt-1', title: 'Secret next', project_key: 'proj-9f', project_dir: '/Users/x/src/real', run_at: 't',
      request: '{"prompt":"secret"}', status: 'fired', after_kind: 'pipeline', after_id: '18-10-26-secret-feature-ab12',
      fail_reason: 'secret failure', pipeline_id: '18-10-26-other-cd34', created_at: 't', updated_at: 't' }],
    schedules: [],
  },
};

test('scrubSnapshot: keeps every row, status, archive flag and link; maps ids consistently', () => {
  const s = scrubSnapshot(RAW);
  const [a, b] = s.tables.pipelines;
  assert.equal(s.tables.pipelines.length, 2);
  assert.deepEqual([a.status, b.status, b.archived_at], ['done', 'stopped', '2026-10-18T11:00:00Z']);
  assert.match(a.id, /^snap-\d{3}$/);
  assert.equal(s.tables.pipeline_steps[0].pipeline_id, a.id);
  assert.equal(s.tables.shape_features[0].origin_pipeline_id, a.id);
  assert.equal(s.tables.shape_feature_slices[0].pipeline_id, a.id);
  assert.equal(s.tables.scheduled_runs[0].after_id, a.id);
  assert.equal(s.tables.scheduled_runs[0].pipeline_id, b.id);
  assert.equal(a.pr_url, 'https://github.com/acme/app/pull/12');
  assert.equal(a.project_key, b.project_key, 'one project stays one project');
  assert.match(a.project_key, /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/, 'the real project-key shape (/api/history/:key/:id)');
  assert.equal(b.resume_point, '{"pauseReason":"usage_limit"}');
  assert.equal(a.outcome, '{"endReached":true,"runEngine":"codex"}', 'only what the list reads; token paths are dropped');
  assert.equal(b.outcome, null);
});

test('scrubSnapshot: only allowlisted columns survive', () => {
  const s = scrubSnapshot(RAW);
  for (const [t, rows] of Object.entries(s.tables)) {
    for (const r of rows) assert.deepEqual(Object.keys(r).filter((k) => !KEEP[t].includes(k)), [], t);
  }
});

test('scrubSnapshot: no title, prompt, free text, path, branch or original id survives', () => {
  const text = JSON.stringify(scrubSnapshot(RAW));
  for (const leak of ['Secret', 'secret', 'ACME', '/Users/x', 'realorg', '18-10-26-', 'proj-9f']) assert.ok(!text.includes(leak), leak);
});
