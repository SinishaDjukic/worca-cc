// The step-folder naming contract (spec §2, D2): one pure function feeds allocation,
// the prompt's step-folder block, the mock markers and the post-execution scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { safeSegment, stepDirName, stepDirOf } from '../src/core/graph/executor.mjs';

test('safeSegment keeps [A-Za-z0-9_-] and turns everything else into _', () => {
  assert.equal(safeSegment('n_impl'), 'n_impl');
  assert.equal(safeSegment('p1t2'), 'p1t2');
  assert.equal(safeSegment('../x'), '___x');
  assert.equal(safeSegment('a:b c/d\\e'), 'a_b_c_d_e');
  assert.equal(safeSegment(''), '');
  assert.equal(safeSegment(42), '42');
});

test('stepDirName is <safe(node)>-c<ordinal>[-<safe(slice)>]', () => {
  assert.equal(stepDirName({ id: 'n_impl' }, 1, {}), 'n_impl-c1');
  assert.equal(stepDirName({ id: 'n_impl' }, 3, { slice: undefined }), 'n_impl-c3');
  assert.equal(stepDirName({ id: 'n_impl' }, 1, { slice: null }), 'n_impl-c1');
  assert.equal(stepDirName({ id: 'n_impl' }, 1, { slice: 'p1t2' }), 'n_impl-c1-p1t2');
  assert.equal(stepDirName({ id: 'n_impl' }, 1, { slice: '../evil id' }), 'n_impl-c1-___evil_id');
  assert.equal(stepDirName({ id: 'n:x' }, 2, null), 'n_x-c2');
  assert.equal(stepDirName({ id: 'n_x' }, undefined, {}), 'n_x-c1', 'a missing ordinal is execution 1');
});

test('stepDirOf joins <pipelineDir>/steps/<name>', () => {
  assert.equal(stepDirOf({ id: 'n_a' }, 2, { pipelineDir: '/p/run' }), join('/p/run', 'steps', 'n_a-c2'));
  assert.equal(stepDirOf({ id: 'n_a' }, 1, { pipelineDir: '/p/run', slice: 'p1t1' }), join('/p/run', 'steps', 'n_a-c1-p1t1'));
  assert.equal(stepDirOf({ id: 'n_a' }, 1, {}), join('steps', 'n_a-c1'), 'no pipelineDir ⇒ still pure, relative');
});
