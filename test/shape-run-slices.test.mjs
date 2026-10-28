// test/shape-run-slices.test.mjs — slice 4 (plan in slices): the shape request fields, the outline answer, and the
// shaping state that carries the feature and the outline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShapeRequest, validateOutlineAnswer, initialShaping } from '../src/core/shape/run.mjs';
import { DEFAULT_PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';

const sl = (id, over = {}) => ({
  id, title: `Slice ${id}`, goal: '', inScope: [], outOfScope: [], acceptance: ['returns 200 in under 1 s'],
  dependsOn: [], estimate: 'medium', ...over,
});
const OUTLINE = { why: 'three independent behaviours', slices: [sl('a'), sl('b'), sl('c')] };
const REF = { feature: 'f1', index: 2, total: 3, outline: OUTLINE };

const req = (shape, opts = {}) => resolveShapeRequest({ shape }, opts);

test('resolveShapeRequest: slices accepts auto and off, refuses anything else', () => {
  assert.equal(req({ slices: 'auto' }).shape.slices, 'auto');
  assert.equal(req({ slices: 'off' }).shape.slices, 'off');
  const r = req({ slices: 'yes' });
  assert.equal(r.ok, false);
  assert.match(r.error, /shape\.slices must be "auto" or "off"/);
});

test('resolveShapeRequest: size accepts small, medium and large, refuses anything else', () => {
  for (const size of ['small', 'medium', 'large']) assert.equal(req({ size }).shape.size, size);
  const r = req({ size: 'huge' });
  assert.equal(r.ok, false);
  assert.match(r.error, /shape\.size must be small, medium or large/);
});

test('resolveShapeRequest: slice and replaces are internal-only', () => {
  const pub = req({ slice: REF });
  assert.equal(pub.ok, false);
  assert.match(pub.error, /unknown field\(s\): slice/);
  assert.match(req({ replaces: 'f0' }).error, /unknown field\(s\): replaces/);

  const r = req({ slice: REF, replaces: 'f0' }, { internal: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.shape.slice, { feature: 'f1', index: 2, total: 3, outline: OUTLINE });
  assert.equal(r.shape.replaces, 'f0');
});

test('resolveShapeRequest: a malformed slice ref is refused', () => {
  const bad = (slice) => req({ slice }, { internal: true });
  assert.equal(bad({ ...REF, total: 2 }).ok, false);          // total != outline length
  assert.equal(bad({ ...REF, index: 0 }).ok, false);
  assert.equal(bad({ ...REF, index: 4 }).ok, false);          // beyond total
  assert.equal(bad({ ...REF, feature: '' }).ok, false);
  assert.equal(bad({ ...REF, outline: { slices: [] } }).ok, false);
  assert.equal(bad('nope').ok, false);
  assert.match(bad({ ...REF, index: 0 }).error, /shape\.slice is malformed/);
});

test('resolveShapeRequest: replaces must be a feature id', () => {
  const r = req({ replaces: '' }, { internal: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /shape\.replaces must be a feature id/);
  assert.equal(req({ replaces: 7 }, { internal: true }).ok, false);
});

test('resolveShapeRequest: the shape key set is pinned', () => {
  assert.deepEqual(req({ perspectives: ['qa'] }).shape, { perspectives: ['product', 'qa'] });
  assert.deepEqual(Object.keys(req({}).shape), ['perspectives']);
  assert.deepEqual(Object.keys(req({ slices: 'off', size: 'large' }).shape), ['perspectives', 'slices', 'size']);
});

test('validateOutlineAnswer: approve with no edits', () => {
  assert.deepEqual(validateOutlineAnswer({ decision: 'approve' }, { outline: OUTLINE }),
    { ok: true, payload: { decision: 'approve', approveEach: false } });
  assert.deepEqual(validateOutlineAnswer({ decision: 'approve', approveEach: true }, { outline: OUTLINE }),
    { ok: true, payload: { decision: 'approve', approveEach: true } });
});

test('validateOutlineAnswer: approveEach false is kept, a non-boolean is refused', () => {
  assert.deepEqual(validateOutlineAnswer({ decision: 'approve', approveEach: false }, { outline: OUTLINE }),
    { ok: true, payload: { decision: 'approve', approveEach: false } });
  const r = validateOutlineAnswer({ decision: 'approve', approveEach: 'no' }, { outline: OUTLINE });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, 'approveEach');
});

test('validateOutlineAnswer: valid edits are kept, bad edits are an error on edits', () => {
  const edits = [{ op: 'merge', id: 'a' }, { op: 'remove', id: 'c' }];
  assert.deepEqual(validateOutlineAnswer({ decision: 'approve', edits }, { outline: OUTLINE }).payload,
    { decision: 'approve', edits, approveEach: false });
  for (const bad of [[{ op: 'merge', id: 'zzz' }], [{ op: 'explode', id: 'a' }], 'merge a', [{ op: 'merge', id: 'c' }]]) {
    const r = validateOutlineAnswer({ decision: 'approve', edits: bad }, { outline: OUTLINE });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.errors[0].path, 'edits');
    assert.equal(r.errors[0].code, 'invalid');
  }
});

test('validateOutlineAnswer: flat and stop pass', () => {
  assert.deepEqual(validateOutlineAnswer({ decision: 'flat' }, { outline: OUTLINE }), { ok: true, payload: { decision: 'flat' } });
  assert.deepEqual(validateOutlineAnswer({ decision: 'stop' }, { outline: OUTLINE }), { ok: true, payload: { decision: 'stop' } });
});

test('validateOutlineAnswer: revise needs revisable, feedback, and a bounded one', () => {
  const ask = (raw, o = {}) => validateOutlineAnswer(raw, { outline: OUTLINE, ...o });
  const refused = ask({ decision: 'revise', feedback: 'merge two' });
  assert.equal(refused.ok, false);
  assert.equal(refused.errors[0].path, 'decision');

  assert.deepEqual(ask({ decision: 'revise', feedback: '  merge two  ' }, { revisable: true }),
    { ok: true, payload: { decision: 'revise', feedback: 'merge two' } });
  assert.equal(ask({ decision: 'revise', feedback: '   ' }, { revisable: true }).errors[0].code, 'required');
  assert.equal(ask({ decision: 'revise' }, { revisable: true }).errors[0].code, 'required');
  const long = ask({ decision: 'revise', feedback: 'x'.repeat(8001) }, { revisable: true });
  assert.equal(long.errors[0].code, 'too-long');
  assert.equal(long.errors[0].path, 'feedback');
});

test('validateOutlineAnswer: an unknown decision is refused', () => {
  for (const raw of [{ decision: 'maybe' }, {}, null, 'approve']) {
    const r = validateOutlineAnswer(raw, { outline: OUTLINE });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].path, 'decision');
  }
});

test('initialShaping: a slice ref gives the feature', () => {
  const s = initialShaping({ perspectives: ['qa'], slice: REF });
  assert.deepEqual(s.feature, { id: 'f1', index: 2, total: 3 });
  assert.equal('outline' in s, false);
});

test('initialShaping: a saved feature and outline are kept, as copies', () => {
  const outline = { rounds: [{ round: 1, count: 3, passed: 4, total: 5, decision: 'approve' }], decided: 'approve' };
  const saved = { feature: { id: 'f9', index: 1, total: 3 }, outline };
  const s = initialShaping(null, saved);
  assert.deepEqual(s.feature, saved.feature);
  assert.deepEqual(s.outline, outline);
  assert.notEqual(s.outline, outline);
  assert.notEqual(s.feature, saved.feature);
});

test('initialShaping: a slice ref wins over a saved feature', () => {
  const s = initialShaping({ slice: REF }, { feature: { id: 'old', index: 1, total: 2 } });
  assert.equal(s.feature.id, 'f1');
});

test('initialShaping: with neither, the four keys are exactly as before', () => {
  assert.deepEqual(initialShaping(null), { perspectives: [...DEFAULT_PERSPECTIVES], rounds: [], approved: null, savedTo: null });
  assert.deepEqual(Object.keys(initialShaping({ perspectives: ['qa'] }, {})), ['perspectives', 'rounds', 'approved', 'savedTo']);
});
