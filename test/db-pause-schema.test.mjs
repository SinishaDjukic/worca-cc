// test/db-pause-schema.test.mjs
// Migration v5: pipelines.resume_point + pipeline_steps.session_id columns, and
// writeState round-trips both (and clears resume_point when state carries none).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { writeState } from '../src/core/artifacts.mjs';

useTempHome(after);

function cols(table) {
  return getDb().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

test('v5 adds resume_point and session_id columns', () => {
  assert.ok(cols('pipelines').includes('resume_point'), 'pipelines.resume_point exists');
  assert.ok(cols('pipeline_steps').includes('session_id'), 'pipeline_steps.session_id exists');
  const v = getDb().prepare('PRAGMA user_version').get().user_version;
  assert.equal(v, 14);
});

test('writeState persists resumePoint and per-step sessionId', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-pause-'));
  const rp = { version: 1, kind: 'node', stepIndex: 2, pausedAt: '2026-06-09T00:00:00Z' };
  await writeState(dir, {
    id: 'pl_test1', projectKey: 'proj-1', status: 'paused', phase: 'implement', cycle: 1,
    resumePoint: rp,
    steps: [{ key: '2:n_impl', nodeId: 'n_impl', phase: 'implementer', stepIndex: 2, cycle: 1,
              status: 'paused', startedAt: 't', updatedAt: 't', activeMs: 5, runningSince: null,
              costUsd: 0, sessionId: 'sess-abc' }],
  });
  const row = getDb().prepare('SELECT resume_point FROM pipelines WHERE id = ?').get('pl_test1');
  assert.deepEqual(JSON.parse(row.resume_point), rp);
  const step = getDb().prepare('SELECT session_id FROM pipeline_steps WHERE pipeline_id = ?').get('pl_test1');
  assert.equal(step.session_id, 'sess-abc');
});

test('writeState clears resume_point when state carries none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-pause2-'));
  await writeState(dir, { id: 'pl_test2', projectKey: 'proj-1', status: 'paused', phase: 'x', cycle: 0,
    resumePoint: { version: 1, kind: 'boundary', stepIndex: 0 }, steps: [] });
  await writeState(dir, { id: 'pl_test2', projectKey: 'proj-1', status: 'running', phase: 'x', cycle: 0, steps: [] });
  const row = getDb().prepare('SELECT resume_point FROM pipelines WHERE id = ?').get('pl_test2');
  assert.equal(row.resume_point, null);
});
