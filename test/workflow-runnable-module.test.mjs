// What a run of a workflow uses: the pure helpers moved out of core/workflows.mjs (file-size cap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rowChanges, runnableOf, snapshotBeforeWrite } from '../src/core/workflow-tests/runnable.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import * as wf from '../src/core/workflows.mjs';

const prev = { version: 2, name: 'A', domain: 'general', graph: '{"nodes":[]}', archived_at: null };

test('rowChanges: detects name, domain, graph and un-archive; identical write is no change', () => {
  const same = { name: 'A', domain: 'general', graph: { nodes: [] } };
  assert.equal(rowChanges(prev, same), false);
  assert.equal(rowChanges(prev, { ...same, name: 'B' }), true);
  assert.equal(rowChanges(prev, { ...same, domain: 'x' }), true);
  assert.equal(rowChanges(prev, { ...same, graph: { nodes: [1] } }), true);
  assert.equal(rowChanges({ ...prev, archived_at: 'x' }, same), true);
  assert.equal(rowChanges({ ...prev, version: 1 }, same), true);
});

test('runnableOf: rejects a bad use, passes through non-graph rows, nulls', () => {
  assert.throws(() => runnableOf(null, { use: 'nope' }), { code: 'BAD_REQUEST' });
  assert.equal(runnableOf(null), null);
  const v1 = { id: 'wf_x', version: 1 };
  assert.equal(runnableOf(v1), v1);
});

test('snapshotBeforeWrite: a missing row snapshots nothing and is never asked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wfrun-'));
  process.env.WORCA_HOME = dir; _resetForTests(); getDb();
  let asked = false;
  snapshotBeforeWrite('wf_nope', () => { asked = true; return true; }, { source: 'save' });
  assert.equal(asked, false);
  _resetForTests(); delete process.env.WORCA_HOME; await rm(dir, { recursive: true, force: true });
});

test('workflows.mjs still exports runnableOf and readRunnableWorkflow', () => {
  assert.equal(wf.runnableOf, runnableOf);
  assert.equal(typeof wf.readRunnableWorkflow, 'function');
});
