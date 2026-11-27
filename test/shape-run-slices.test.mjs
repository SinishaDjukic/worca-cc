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

// Small runs B4 (D12, D13, D14, D15): the Split's approve gate.
const rsl = (id, requirements) => sl(id, { requirements });
const AGREED4 = ['R-po-1', 'R-po-2', 'R-qa-1', 'R-sec-1'].map((id) => ({ id, text: id }));
const PASSING = { why: 'w', slices: [rsl('a', ['R-po-1', 'R-po-2']), rsl('b', ['R-qa-1'])], agreed: AGREED4, leftOut: [],
  confirmed: [{ id: 'R-sec-1', role: 'Security' }] };
const BROKEN = {
  ownership: { ...PASSING, slices: [rsl('a', ['R-po-1', 'R-po-2']), rsl('b', ['R-qa-1', 'R-po-2'])] },
  coverage: { ...PASSING, slices: [rsl('a', ['R-po-1', 'R-po-2']), rsl('b', ['R-po-1'])].map((s, i) => (i ? { ...s, requirements: ['R-po-2'] } : { ...s, requirements: ['R-po-1'] })) },
  confirmRole: { ...PASSING, confirmed: [{ id: 'R-sec-1', role: 'Legal' }] },
};
const RULES = (care) => ({ smallRuns: true, care });

test('validateOutlineAnswer B4: each Care × rule refuses an approve with split-not-approvable, naming the rule and ids', () => {
  for (const care of ['lean', 'balanced', 'thorough']) {
    for (const [rule, outline] of Object.entries(BROKEN)) {
      const r = validateOutlineAnswer({ decision: 'approve' }, { outline, rules: RULES(care), revisable: true });
      assert.equal(r.ok, false, `${care} ${rule}`);
      assert.equal(r.errors[0].code, 'split-not-approvable', `${care} ${rule}`);
      assert.equal(r.errors[0].path, 'decision');
      assert.match(r.errors[0].message, new RegExp(`^The split cannot be approved: .*${rule} R-`), `${care} ${rule}`);
      assert.match(r.errors[0].message, /Ask for changes\.$/);
    }
  }
  const msg = validateOutlineAnswer({ decision: 'approve' }, { outline: { ...BROKEN.ownership, slices: [rsl('a', ['R-po-1']), rsl('b', ['R-po-1'])] }, rules: RULES('balanced') });
  assert.equal(msg.errors[0].message, 'The split cannot be approved: ownership R-po-1; coverage R-po-2, R-qa-1. Ask for changes.');
});

test('validateOutlineAnswer B4: a passing outline approves with approveEach false; a confirm fixes confirmRole; a stranding remove is refused', () => {
  assert.deepEqual(validateOutlineAnswer({ decision: 'approve', approveEach: true }, { outline: PASSING, rules: RULES('balanced') }),
    { ok: true, payload: { decision: 'approve', approveEach: false } });
  const confirm = [{ op: 'confirm', id: 'R-sec-1', role: 'Security' }];
  assert.deepEqual(validateOutlineAnswer({ decision: 'approve', edits: confirm }, { outline: BROKEN.confirmRole, rules: RULES('lean') }),
    { ok: true, payload: { decision: 'approve', edits: confirm, approveEach: false } });
  assert.equal(validateOutlineAnswer({ decision: 'approve', edits: confirm }, { outline: BROKEN.confirmRole }).ok, false, 'no confirm without small runs');
  const remove = validateOutlineAnswer({ decision: 'approve', edits: [{ op: 'remove', id: 'b' }] }, { outline: PASSING, rules: RULES('balanced') });
  assert.equal(remove.errors[0].code, 'split-not-approvable');
  assert.match(remove.errors[0].message, /coverage R-qa-1/);
  const unconfirmed = validateOutlineAnswer({ decision: 'approve', edits: [{ op: 'confirm', id: 'R-qa-1', role: 'QA' }] }, { outline: PASSING, rules: RULES('balanced') });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.errors[0].path, 'edits');
});

test('validateOutlineAnswer B4: approve with a forged passing check is still refused (the gate runs on the server\'s outline)', () => {
  const r = validateOutlineAnswer({ decision: 'approve', check: { ok: true, items: [] } }, { outline: BROKEN.coverage, rules: RULES('balanced') });
  assert.equal(r.errors[0].code, 'split-not-approvable');
});

test('validateOutlineAnswer B4: openObjections is only "kept", only with open objections', () => {
  const opts = (open) => ({ outline: PASSING, rules: RULES('balanced'), open });
  assert.deepEqual(validateOutlineAnswer({ decision: 'approve', openObjections: 'kept' }, opts(2)),
    { ok: true, payload: { decision: 'approve', approveEach: false, openObjections: 'kept' } });
  assert.equal(validateOutlineAnswer({ decision: 'approve', openObjections: 'kept' }, opts(0)).errors[0].path, 'openObjections');
  assert.equal(validateOutlineAnswer({ decision: 'approve', openObjections: 'dropped' }, opts(2)).errors[0].path, 'openObjections');
  assert.equal(validateOutlineAnswer({ decision: 'approve', openObjections: 'kept' }, { outline: OUTLINE }).ok, false, 'dev never takes it');
});

test('validateOutlineAnswer B4: dev rules (no `rules`) are unchanged: a broken split still approves', () => {
  assert.deepEqual(validateOutlineAnswer({ decision: 'approve' }, { outline: BROKEN.coverage }),
    { ok: true, payload: { decision: 'approve', approveEach: false } });
});

// ---- Small runs C5 (D15): the Verifier's request ----
const VERIFY = { featureId: 'feat_1', round: 1, fixCycles: 2, extra: 0, owned: ['R-po-1', 'R-po-2'], head: { index: 4, pipelineId: 'p4' } };

test('resolveShapeRequest C5: an internal shape.verify on wf_shape_verify returns {shape:{verify}, workflowId}', () => {
  const r = resolveShapeRequest({ shape: { verify: VERIFY }, workflowId: 'wf_shape_verify' }, { internal: true });
  assert.deepEqual(r, { ok: true, shape: { verify: VERIFY }, workflowId: 'wf_shape_verify' });
});

test('resolveShapeRequest C5: verify is internal-only, needs wf_shape_verify and a well-formed record', () => {
  assert.match(resolveShapeRequest({ shape: { verify: VERIFY }, workflowId: 'wf_shape_verify' }).error, /unknown field\(s\): verify/);
  assert.equal(resolveShapeRequest({ shape: { verify: VERIFY }, workflowId: 'wf_shape' }, { internal: true }).ok, false);
  assert.equal(resolveShapeRequest({ shape: { verify: VERIFY } }, { internal: true }).ok, false);
  assert.equal(resolveShapeRequest({ shape: { verify: { ...VERIFY, round: 0 } }, workflowId: 'wf_shape_verify' }, { internal: true }).ok, false);
  assert.equal(resolveShapeRequest({ shape: { verify: { ...VERIFY, owned: 'R-po-1' } }, workflowId: 'wf_shape_verify' }, { internal: true }).ok, false);
  assert.equal(resolveShapeRequest({ workflowId: 'wf_shape_verify' }, { internal: true }).ok, false, 'never a plain run');
});

test('resolveShapeRequest C5: a Verifier ticket keeps its requirement texts and the gaps already shipped', () => {
  const verify = { ...VERIFY, round: 2, texts: { 'R-po-1': 'People export', 'R-po-2': 'People pin' },
    shipped: [{ id: 'R-po-2', reason: 'covered by a later feature' }] };
  const r = resolveShapeRequest({ shape: { verify }, workflowId: 'wf_shape_verify' }, { internal: true });
  assert.deepEqual(r, { ok: true, shape: { verify }, workflowId: 'wf_shape_verify' });
});

