import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb, _resetForTests } from '../src/core/db.mjs';
import {
  writeDecomposition, listPhases, listTasks, updateTaskStatus, updatePhaseStatus,
} from '../src/core/artifacts.mjs';

let home;
beforeEach(async () => {
  _resetForTests();
  home = await mkdtemp(join(tmpdir(), 'worca-cc-decomp-'));
  process.env.WORCA_HOME = home;
  // A pipeline row must exist (FK target).
  getDb().prepare(
    "INSERT INTO pipelines (id, project_key, started_at) VALUES ('p1','proj-1', '2026-06-09')"
  ).run();
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  if (home) await rm(home, { recursive: true, force: true });
});

const PHASES = [
  { ordinal: 1, tasks: [
    { id: 'p1t1', title: 'Slice A', file: 'tasks/p1-t1-slice-a.md', nodeId: 's_impl_p1_t1' },
    { id: 'p1t2', title: 'Slice B', file: 'tasks/p1-t2-slice-b.md', nodeId: 's_impl_p1_t2' },
  ] },
  { ordinal: 2, tasks: [
    { id: 'p2t1', title: 'Slice C', file: 'tasks/p2-t1-slice-c.md', nodeId: 's_impl_p2_t1' },
  ] },
];

test('writeDecomposition persists phases + tasks; list* reads them back ordered', () => {
  writeDecomposition('p1', PHASES);
  assert.deepEqual(listPhases('p1').map((p) => p.ordinal), [1, 2]);
  const tasks = listTasks('p1');
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks[0], {
    id: 'p1t1', phaseOrdinal: 1, taskIndex: 0, title: 'Slice A',
    fileRelPath: 'tasks/p1-t1-slice-a.md', nodeId: 's_impl_p1_t1',
    status: 'pending', startedAt: null, finishedAt: null,
  });
});

test('writeDecomposition is idempotent (re-write does not duplicate)', () => {
  writeDecomposition('p1', PHASES);
  writeDecomposition('p1', PHASES);
  assert.equal(listPhases('p1').length, 2);
  assert.equal(listTasks('p1').length, 3);
});

test('updateTaskStatus / updatePhaseStatus set status + timestamps', () => {
  writeDecomposition('p1', PHASES);
  updateTaskStatus('p1', 'p1t1', 'running', '2026-06-09T00:00:00.000Z');
  updateTaskStatus('p1', 'p1t1', 'done', '2026-06-09T00:01:00.000Z');
  const t = listTasks('p1').find((x) => x.id === 'p1t1');
  assert.equal(t.status, 'done');
  assert.equal(t.startedAt, '2026-06-09T00:00:00.000Z');
  assert.equal(t.finishedAt, '2026-06-09T00:01:00.000Z');
  updatePhaseStatus('p1', 1, 'done', '2026-06-09T00:02:00.000Z');
  assert.equal(listPhases('p1').find((p) => p.ordinal === 1).status, 'done');
});
