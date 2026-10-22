// test/ui-shape-slice-line.test.mjs — the slice line on a run page (D16, D22): ui/public/shape/slice-line.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceLineCopy } from '../ui/public/shape/slice-line.mjs';

test('slice line: running and done', () => {
  const info = { featureId: 'feat_1', title: 'Run tags', index: 1, total: 3, next: { index: 2, title: 'Run tags in Stats', state: 'shaping' } };
  assert.deepEqual(sliceLineCopy(info), { text: 'Part of Run tags · slice 1 of 3 →', href: '#feature/feat_1', openFeature: false });
  assert.deepEqual(sliceLineCopy(info, { done: true }), { text: 'Slice 1 of 3 · next: Run tags in Stats (planning)', href: '#feature/feat_1', openFeature: true });
  assert.equal(sliceLineCopy({ ...info, next: null }, { done: true }).text, 'Slice 1 of 3');
  assert.equal(sliceLineCopy({ ...info, featureId: 'a b' }).href, '#feature/a%20b');
  assert.equal(sliceLineCopy(null), null);
  assert.equal(sliceLineCopy({}), null);
});
