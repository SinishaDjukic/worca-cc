import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTLINE_FILE, OUTLINE_CHANGE_FILE, OUTLINE_ROUNDS_MAX, OUTLINE_EDITS_MAX, SLICE_IDS, SLICE_LABELS, FLAT_NOTE,
  normalizeOutline, checkSlices, normalizeEdits, applyOutlineEdits,
  outlineMarkdown, slicingBlock, outlineFixFeedback, outlineFixAllFeedback, outlineFeedbackBlock, sliceScopeBlock, sliceBrief, replanBrief, keepConfirmed, changelogWithFeature,
  settleLeftOut, sliceRequirementIds,
  SMALL_RUN_IDS, SMALL_RUN_LABELS, RUN_REQUIREMENTS_MAX, SMALL_RUNS_MAX, BUILDS_ON_MAX, SMALL_RUNS_OUTLINE_CAP,
} from '../src/shared/shape/slices.mjs';
// A namespace read, so a missing new export (careRunCount) fails only its own test.
import * as SLICES from '../src/shared/shape/slices.mjs';
import { createHash } from 'node:crypto';
import { criterionIds, criteriaList, criteriaExamples } from '../src/shared/review/coverage.mjs';
import { checkShape, isTestable } from '../src/shared/shape/shape.mjs';
import { wellShapedPlan } from './helpers/shape-plan.mjs';

const slice = (id, o = {}) => ({
  id, title: `Slice ${id}`, goal: `Make ${id} work for people`, inScope: ['a'], outOfScope: ['b'],
  acceptance: ['GET /api/x returns 200'], dependsOn: [], estimate: 'medium', ...o,
});
const goodOutline = (o = {}) => ({
  why: 'The change is large and cuts across three subsystems.',
  slices: [slice('s1'), slice('s2', { dependsOn: ['s1'] })],
  ...o,
});
const many = (n, o = {}) => goodOutline({ slices: Array.from({ length: n }, (_, i) => slice(`s${i + 1}`)), ...o });
const failing = (outline, opts) => checkSlices(outline, opts).items.filter((i) => !i.pass).map((i) => i.id);
const on = (care) => ({ smallRuns: true, ...(care ? { care } : {}) });
/** One small slice per entry, sI owning counts[i] distinct ids; the agreed list is exactly the owned ids. */
const perRun = (counts) => {
  let k = 0;
  const agreed = [];
  const slices = counts.map((c, i) => {
    const requirements = Array.from({ length: c }, () => `R-po-${++k}`);
    agreed.push(...requirements.map((id) => ({ id, text: `text of ${id}` })));
    return slice(`s${i + 1}`, { estimate: 'small', requirements });
  });
  return goodOutline({ slices, agreed, leftOut: [] });
};
const runs = (n, k) => perRun(Array(n).fill(k));
const withSlice0 = (o) => goodOutline({ slices: [slice('s1', o), slice('s2', { dependsOn: ['s1'] })] });

test('constants', () => {
  assert.equal(OUTLINE_FILE, 'slices.json');
  assert.equal(OUTLINE_ROUNDS_MAX, 3);
  assert.equal(OUTLINE_EDITS_MAX, 20);
  assert.deepEqual(SLICE_IDS, ['count', 'acceptance', 'notLayered', 'notTiny', 'order']);
  assert.deepEqual(Object.keys(SLICE_LABELS), SLICE_IDS);
});

test('normalizeOutline: the spec example passes', () => {
  const raw = {
    why: 'Three subsystems change.',
    slices: [
      { id: 's1', title: 'Ask for a chart in Chat', goal: 'People can ask.', inScope: ['Chat'], outOfScope: ['Export'], acceptance: ['The chat shows a chart'], dependsOn: [], estimate: 'medium' },
      { id: 's2', title: 'Export charts', goal: 'People can export.', inScope: ['Export'], outOfScope: [], acceptance: ['A PNG file is written'], dependsOn: ['s1'], estimate: 'small' },
    ],
  };
  const r = normalizeOutline(raw);
  assert.equal(r.ok, true);
  assert.equal(r.outline.why, 'Three subsystems change.');
  assert.deepEqual(r.outline.slices.map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(r.outline.slices[1].dependsOn, ['s1']);
  assert.equal(r.outline.slices[1].estimate, 'small');
});

test('normalizeOutline: untitled slices are dropped, duplicate ids made unique', () => {
  const r = normalizeOutline({ slices: [{ id: 's1', title: 'A' }, { id: 's1', title: 'B' }, { id: 'x', title: '  ' }, null, 'no', { title: 'C' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.outline.slices.map((s) => s.id), ['s1', 's1-2', 's3']);
  assert.deepEqual(r.outline.slices.map((s) => s.title), ['A', 'B', 'C']);
});

test('normalizeOutline: lists are trimmed and capped, a bad estimate is null', () => {
  const r = normalizeOutline({ slices: [{
    title: 'A', acceptance: ['  one  ', '', 5, ...Array.from({ length: 20 }, (_, i) => `c${i}`)],
    estimate: 'huge', dependsOn: 'nope',
  }] });
  const s = r.outline.slices[0];
  assert.equal(s.acceptance.length, 12);
  assert.equal(s.acceptance[0], 'one');
  assert.equal(s.estimate, null);
  assert.deepEqual(s.dependsOn, []);
  assert.equal(r.outline.why, '');
});

test('normalizeOutline: caps the slice count at 12', () => {
  const r = normalizeOutline({ slices: Array.from({ length: 20 }, (_, i) => ({ title: `T${i}` })) });
  assert.equal(r.outline.slices.length, 12);
});

test('normalizeOutline: no slices array or no titled slice is not ok', () => {
  for (const raw of [null, undefined, [], 'x', {}, { slices: 'a' }]) assert.equal(normalizeOutline(raw).ok, false);
  const r = normalizeOutline({ slices: [{ title: '' }, {}] });
  assert.equal(r.ok, false);
  assert.match(r.error, /no slice with a title/);
});

test('checkSlices: the good outline passes 5 of 5, in the checkShape result shape', () => {
  const r = checkSlices(goodOutline());
  assert.equal(r.ok, true);
  assert.equal(r.passed, 5);
  assert.equal(r.total, 5);
  assert.deepEqual(r.items.map((i) => i.id), SLICE_IDS);
  assert.ok(r.items.every((i) => i.waivable === true && i.detail === '' && i.label === SLICE_LABELS[i.id]));
});

test('checkSlices: count', () => {
  assert.deepEqual(failing(many(1)), ['count']);
  assert.match(checkSlices(many(1)).items[0].detail, /Don't slice/);
  for (const n of [2, 3, 4, 5]) assert.deepEqual(failing(many(n, { why: '' })), []);
  assert.deepEqual(failing(many(6, { why: '' })), ['count']);
  assert.deepEqual(failing(many(6, { why: 'Three words only' })), ['count']);
  assert.deepEqual(failing(many(6, { why: 'Four words are enough' })), []);
  assert.deepEqual(failing(many(8, { why: 'Four words are enough' })), []);
  assert.deepEqual(failing(many(9, { why: 'Four words are enough' })), ['count']);
  assert.match(checkSlices(many(9, { why: 'Four words are enough' })).items[0].detail, /never more than 8/);
  assert.match(checkSlices(many(6, { why: '' })).items[0].detail, /need a reason/);
});

test('checkSlices: acceptance', () => {
  assert.deepEqual(failing(withSlice0({ acceptance: [] })), ['acceptance']);
  assert.deepEqual(failing(withSlice0({ acceptance: Array.from({ length: 7 }, (_, i) => `GET /api/x${i} returns 200`) })), ['acceptance']);
  assert.deepEqual(failing(withSlice0({ acceptance: Array.from({ length: 6 }, (_, i) => `GET /api/x${i} returns 200`) })), []);
  assert.deepEqual(failing(withSlice0({ acceptance: ['works properly'] })), ['acceptance']);
  assert.match(checkSlices(withSlice0({ acceptance: ['works properly'] })).items[1].detail, /"works properly" has no measurable condition/);
  assert.deepEqual(failing(withSlice0({ acceptance: ['GET /api/x returns 200'] })), []);
});

test('checkSlices: notLayered', () => {
  for (const title of ['backend', 'The API', 'UI', 'tests', 'docs']) assert.deepEqual(failing(withSlice0({ title })), ['notLayered'], title);
  assert.deepEqual(failing(withSlice0({ goal: 'The UI.' })), ['notLayered']);
  assert.deepEqual(failing(withSlice0({ title: 'Ask for a chart in Chat' })), []);
});

test('checkSlices: notTiny', () => {
  const small = (id, o) => slice(id, { estimate: 'small', ...o });
  const r = checkSlices(goodOutline({ slices: [small('s1'), small('s2')] }));
  assert.deepEqual(r.items.filter((i) => !i.pass).map((i) => i.id), ['notTiny']);
  assert.match(r.items[3].detail, /Slices 1 and 2/);
  assert.deepEqual(failing(goodOutline({ slices: [small('s1'), slice('s2'), small('s3')] })), []);
});

test('checkSlices: order', () => {
  const two = (a, b) => goodOutline({ slices: [slice('s1', a), slice('s2', b)] });
  assert.deepEqual(failing(two({ dependsOn: ['s2'] }, {})), ['order']);
  assert.deepEqual(failing(two({ dependsOn: ['s1'] }, {})), ['order']);
  const unknown = checkSlices(two({}, { dependsOn: ['zzz'] }));
  assert.deepEqual(unknown.items.filter((i) => !i.pass).map((i) => i.id), ['order']);
  assert.match(unknown.items[4].detail, /not in the outline/);
  assert.deepEqual(failing(two({}, { dependsOn: ['s1'] })), []);
});

test('normalizeEdits', () => {
  assert.deepEqual(normalizeEdits(undefined), { ok: true, edits: [] });
  assert.deepEqual(normalizeEdits(null), { ok: true, edits: [] });
  assert.deepEqual(normalizeEdits([{ op: 'merge', id: 's1', extra: 1 }, { op: 'remove', id: 's2' }]), { ok: true, edits: [{ op: 'merge', id: 's1' }, { op: 'remove', id: 's2' }] });
  assert.equal(normalizeEdits('x').ok, false);
  assert.equal(normalizeEdits([{ op: 'split', id: 's1' }]).ok, false);
  assert.equal(normalizeEdits([{ op: 'merge' }]).ok, false);
  assert.equal(normalizeEdits([null]).ok, false);
  assert.equal(normalizeEdits(Array.from({ length: 20 }, () => ({ op: 'remove', id: 's1' }))).ok, true);
  assert.equal(normalizeEdits(Array.from({ length: 21 }, () => ({ op: 'remove', id: 's1' }))).ok, false);
});

const three = () => ({
  why: 'Because.',
  slices: [
    slice('s1', { title: 'A', goal: 'Goal A.', acceptance: ['a returns 1'], estimate: 'small' }),
    slice('s2', { title: 'B', goal: 'Goal B.', acceptance: ['a returns 1', 'b returns 2'], estimate: 'large', dependsOn: ['s1'] }),
    slice('s3', { title: 'C', dependsOn: ['s2', 's1'] }),
  ],
});

test('applyOutlineEdits: merge', () => {
  const r = applyOutlineEdits(three(), [{ op: 'merge', id: 's1' }]);
  assert.equal(r.ok, true);
  assert.deepEqual([r.merges, r.removals], [1, 0]);
  const [m, c] = r.outline.slices;
  assert.equal(m.id, 's1');
  assert.equal(m.title, 'A + B');
  assert.equal(m.goal, 'Goal A. Goal B.');
  assert.deepEqual(m.acceptance, ['a returns 1', 'b returns 2']);
  assert.equal(m.estimate, 'large');
  assert.deepEqual(m.dependsOn, []);
  assert.deepEqual(c.dependsOn, ['s1']);
  assert.equal(r.outline.why, 'Because.');
});

test('applyOutlineEdits: small + small is medium, and the input is not mutated', () => {
  const o = three();
  o.slices[1].estimate = 'small';
  const before = JSON.stringify(o);
  const r = applyOutlineEdits(o, [{ op: 'merge', id: 's1' }]);
  assert.equal(r.outline.slices[0].estimate, 'medium');
  assert.equal(JSON.stringify(o), before);
});

test('applyOutlineEdits: remove drops the slice and its id from dependsOn', () => {
  const r = applyOutlineEdits(three(), [{ op: 'remove', id: 's2' }]);
  assert.deepEqual(r.outline.slices.map((s) => s.id), ['s1', 's3']);
  assert.deepEqual(r.outline.slices[1].dependsOn, ['s1']);
  assert.deepEqual([r.merges, r.removals], [0, 1]);
});

test('applyOutlineEdits: failures', () => {
  assert.equal(applyOutlineEdits(three(), [{ op: 'merge', id: 's3' }]).ok, false);
  assert.match(applyOutlineEdits(three(), [{ op: 'merge', id: 's3' }]).error, /nothing after it/);
  assert.equal(applyOutlineEdits(goodOutline({ slices: [slice('s1')] }), [{ op: 'remove', id: 's1' }]).ok, false);
  assert.match(applyOutlineEdits(three(), [{ op: 'remove', id: 'nope' }]).error, /no slice "nope"/);
  assert.deepEqual(applyOutlineEdits(three()).outline.slices.length, 3);
});

test('slicingBlock: the file, every rule, large only when judged large', () => {
  const b = slicingBlock({ file: '/p/slices.json' });
  assert.ok(b.startsWith('## Plan in slices'));
  assert.ok(b.includes('/p/slices.json'));
  assert.ok(!/plan this in slices/i.test(b));
  assert.ok(!b.includes('This task was judged large.'));
  for (const rule of ['Slice only where', 'Slice by behaviour', 'Prefer 2–3 slices', 'No slice that only adds', '1–6 acceptance checks', '"dependsOn" names only earlier slices']) {
    assert.ok(b.includes(rule), rule);
  }
  assert.ok(slicingBlock({ file: 'f', size: 'large' }).includes('This task was judged large.'));
  assert.ok(!slicingBlock({ file: 'f', size: 'medium' }).includes('This task was judged large.'));
});

test('sliceScopeBlock marks the slice and switches the sentence for the refiner', () => {
  const o = goodOutline();
  const plan = sliceScopeBlock({ index: 1, total: 2, outline: o });
  assert.ok(plan.includes('## This is slice 1 of 2'));
  assert.ok(plan.includes('**Slice s1** ← this slice'));
  assert.ok(!plan.includes('**Slice s2** ← this slice'));
  assert.ok(plan.includes('Write the plan for slice 1 only ("Slice s1")'));
  const ref = sliceScopeBlock({ index: 2, total: 2, outline: o, refiner: true });
  assert.ok(ref.includes('Judge the plan for slice 2 only ("Slice s2")'));
  assert.ok(!ref.includes('Write the plan for slice'));
  const earlier = sliceScopeBlock({ index: 2, total: 2, outline: o, earlier: [{ index: 1, title: 'Slice s1', summary: 'ok', files: ['src/a.mjs'], more: 2 }] });
  assert.ok(earlier.includes('- Slice 1, Slice s1: ok\n  Files: `src/a.mjs` (+2 more)'));
});

test('sliceScopeBlock: outlineChangeFile tells the Planner (never the refiner) when to write it; absent = byte-identical', () => {
  const o = goodOutline();
  const base = sliceScopeBlock({ index: 2, total: 2, outline: o });
  assert.equal(sliceScopeBlock({ index: 2, total: 2, outline: o, outlineChangeFile: null }), base);
  const plan = sliceScopeBlock({ index: 2, total: 2, outline: o, outlineChangeFile: '/p/outline-change.md' });
  assert.ok(plan.includes('/p/outline-change.md'));
  assert.ok(plan.includes('only in that case'));
  for (const shape of ['first line', 'no heading', 'few short paragraphs', 'backticks', 'a list']) assert.ok(plan.includes(shape), shape);
  assert.ok(plan.startsWith(base.slice(0, -1)), 'the note is appended after the existing text');
  const ref = sliceScopeBlock({ index: 2, total: 2, outline: o, refiner: true, outlineChangeFile: '/p/outline-change.md' });
  assert.equal(ref, sliceScopeBlock({ index: 2, total: 2, outline: o, refiner: true }));
  assert.equal(OUTLINE_CHANGE_FILE, 'outline-change.md');
});

test('sliceBrief and replanBrief', () => {
  const o = goodOutline();
  const brief = sliceBrief({ featureTitle: 'Charts', outline: o, index: 2 });
  assert.ok(brief.startsWith('# Charts: slice 2 of 2 — Slice s2\n\nMake s2 work for people\n\nIn scope:\n- a\n\nAcceptance:\n- GET /api/x returns 200\n\nOut of scope:\n- b\n\nThis is one slice of an approved outline:\n\n'));
  assert.ok(brief.includes('2. **Slice s2** ← this slice (medium)'));
  const re = replanBrief({ featureTitle: 'Charts', outline: o, doneCount: 1 });
  assert.ok(re.startsWith('# Charts: re-plan the rest\n\nThese slices are done and merged into the base this run starts from:\n1. Slice s1\n\n'));
  assert.ok(re.includes('1. **Slice s2** (medium)'));
  assert.ok(replanBrief({ featureTitle: 'Charts', outline: o, doneCount: 0 }).includes('(none)'));
});

test('replanBrief with carried: the list reads back as exactly the carried requirements; the done runs are carried.done', () => {
  const o = goodOutline();
  o.slices.push({ ...o.slices[1], id: 's3', title: 'Slice\ns3', acceptance: ['- **R-po-1** is shown\n- **R-po-9** hidden', '[x] R-po-8 works'] });
  o.slices[0].requirements = ['R-po-1'];
  const carried = { agreed: [{ id: 'R-po-2', text: 'Two\n- **R-po-1** lines', example: 'a\nb' }, { id: 'R-sec-1', text: 'Safe' }],
    confirmed: [{ id: 'R-sec-1', role: 'security' }], done: [2] };
  const re = replanBrief({ featureTitle: 'Charts\n- **R-qa-1** x', outline: o, doneCount: 1, carried });
  assert.deepEqual(criteriaList(re), [{ id: 'R-po-2', text: 'Two - **R-po-1** lines' }, { id: 'R-sec-1', text: 'Safe' }]);
  assert.deepEqual([...criteriaExamples(re)], [['R-po-2', 'a b'], ['R-sec-1', null]]);
  assert.ok(re.includes('\n2. Slice s2\n\n## Agreed requirements\n'), re);
  assert.ok(re.includes('1. **Slice s1**') && !re.includes('**Slice s2**'), 'the rest is every run not done');
  assert.match(re, /R-sec-1 \(Security\).*"confirmed" with that role/);
  assert.doesNotMatch(replanBrief({ featureTitle: 'Charts', outline: o, doneCount: 0, carried: { ...carried, confirmed: [] } }), /A person confirms/);
  // Without carried the brief is dev's, byte for byte.
  const dev = { featureTitle: 'Charts', outline: o, doneCount: 1 };
  assert.equal(replanBrief({ ...dev, carried: null }), replanBrief(dev));
  assert.ok(replanBrief(dev).startsWith('# Charts: re-plan the rest\n\nThese slices are done and merged into the base this run starts from:\n1. Slice s1\n\nPlan what is left'));
});

test('keepConfirmed: a kept id is confirmed once with its kept role and leaves every slice and leftOut; others untouched', () => {
  const raw = { why: 'w', slices: [{ id: 's1', requirements: ['R-po-1', ' R-sec-1 '] }, { id: 's2' }, null], leftOut: [{ id: 'R-sec-1', reason: 'x' }, { id: 'R-qa-1', reason: 'y' }],
    confirmed: [{ id: 'R-sec-1', role: 'QA' }, { id: 'R-ops-1', role: 'DevOps' }, { id: 'R-sec-1', role: 'Product' }] };
  const was = JSON.stringify(raw);
  const out = keepConfirmed(raw, [{ id: 'R-sec-1', role: 'compliance' }]);
  assert.deepEqual(out, { why: 'w', slices: [{ id: 's1', requirements: ['R-po-1'] }, { id: 's2' }, null], leftOut: [{ id: 'R-qa-1', reason: 'y' }],
    confirmed: [{ id: 'R-ops-1', role: 'DevOps' }, { id: 'R-sec-1', role: 'Compliance' }] });
  assert.equal(JSON.stringify(raw), was, 'pure');
  assert.deepEqual(keepConfirmed({ slices: [] }, [{ id: 'R-sec-1', role: 'qa' }]).confirmed, [{ id: 'R-sec-1', role: 'QA' }]);
  for (const bad of [null, 'x', [], {}, { error: 'e' }, { slices: 'no' }]) assert.equal(keepConfirmed(bad, [{ id: 'R-sec-1', role: 'qa' }]), bad);
  assert.equal(keepConfirmed(raw, []), raw);
  assert.equal(keepConfirmed(raw, undefined), raw);
});

test('outlineMarkdown', () => {
  const md = outlineMarkdown(goodOutline());
  assert.ok(md.includes('1. **Slice s1** (medium)\n   Goal: Make s1 work for people\n   Acceptance:\n  - GET /api/x returns 200\n   Out of scope:\n  - b'));
});

test('outline feedback text', () => {
  const t = outlineFixFeedback({ label: SLICE_LABELS.order, detail: 's1 depends on s2' });
  assert.ok(t.includes(SLICE_LABELS.order));
  assert.ok(t.includes('s1 depends on s2'));
  assert.ok(t.includes('Rewrite the outline'));
  assert.ok(!outlineFixFeedback({ label: 'X' }).includes(': .'));
  const fb = outlineFeedbackBlock('  Merge the first two.  ');
  assert.ok(fb.startsWith('## Changes asked for the outline'));
  assert.ok(fb.includes('Merge the first two.\n\n'));
  assert.ok(fb.includes('The outline you wrote is still in the outline file. Edit it to address these changes, keep what they do not touch, and STOP again; do not write the plan yet.'));
  assert.ok(!fb.includes('Rewrite the outline file'));
  assert.ok(!FLAT_NOTE.includes('The person chose'));
  assert.ok(FLAT_NOTE.startsWith('## Do not slice'));
});

test('isTestable agrees with checkShape\'s testable on the existing fixture', () => {
  const r = checkShape(wellShapedPlan({ failing: 'testable' }), { perspectives: ['product', 'architect', 'qa'], size: 'medium' });
  const item = r.items.find((i) => i.id === 'testable');
  assert.equal(item.pass, false);
  const text = item.detail.match(/^"(.*)" has no measurable condition$/)[1];
  assert.equal(isTestable(text), false);
  assert.equal(isTestable('GET /api/x returns 200'), true);
  assert.equal(isTestable('it works properly'), false);
  assert.equal(isTestable('it works properly and returns 200'), true);
  assert.equal(isTestable(undefined), true);
});

test('changelogWithFeature (D25): one entry per feature at the top of ## Unreleased', () => {
  const T = { title: 'T', slices: [{ title: 'A', summary: 'x. More detail here.' }] };
  assert.equal(changelogWithFeature('', T), '# Changelog\n\n## Unreleased\n\n### T\n\n- A: x.\n');
  assert.equal(changelogWithFeature('# Changelog\n\n## 1.0.0\n\n- old\n', T),
    '# Changelog\n\n## Unreleased\n\n### T\n\n- A: x.\n\n## 1.0.0\n\n- old\n');
  assert.equal(changelogWithFeature('# Changelog\n\n## Unreleased\n\n### Older\n\n- B\n', T),
    '# Changelog\n\n## Unreleased\n\n### T\n\n- A: x.\n\n### Older\n\n- B\n');
  const once = changelogWithFeature('', T);
  assert.equal(changelogWithFeature(once, T), once, 'retry safety: the same feature again changes nothing');
  const older = '# Changelog\n\n## Unreleased\n\n## 1.0.0\n\n### T\n\n- old\n';
  assert.notEqual(changelogWithFeature(older, T), older, 'the same title under an older release does not count');
  assert.equal(changelogWithFeature('# Changelog', T), '# Changelog\n\n## Unreleased\n\n### T\n\n- A: x.\n', 'one heading, not two');
  assert.equal(changelogWithFeature('', { title: 'T', slices: [{ title: 'A', summary: '' }, { title: 'B' }] }),
    '# Changelog\n\n## Unreleased\n\n### T\n\n- A\n- B\n');
});

test('outlineFixAllFeedback: one failure reads as outlineFixFeedback; several are listed, naming the outline', () => {
  const a = { label: SLICE_LABELS.order, detail: 's1 depends on s2', pass: false };
  const b = { label: SLICE_LABELS.notTiny, detail: '', pass: false };
  const ok = { label: SLICE_LABELS.count, pass: true };
  assert.equal(outlineFixAllFeedback([ok, a]), outlineFixFeedback(a));
  const t = outlineFixAllFeedback([a, ok, b]);
  assert.match(t, /^The outline check fails 2 checks:\n/);
  assert.ok(t.includes(`- "${SLICE_LABELS.order}": s1 depends on s2\n`));
  assert.ok(t.includes(`- "${SLICE_LABELS.notTiny}"\n`));
  assert.match(t, /Rewrite the outline so these checks pass\.$/);
  assert.doesNotMatch(t, /Fix the plan/);
});

// Slice 2 of the requirements feature: the outline carries the agreed R-ids.
const AGREED = ['R-po-1', 'R-po-2', 'R-ux-1', 'R-qa-1', 'R-ops-1'].map((id) => ({ id, text: `text of ${id}` }));
const reqOutline = (a, b, o = {}) => goodOutline({ slices: [slice('s1', { requirements: a }), slice('s2', { dependsOn: ['s1'], requirements: b })], ...o });
const placed = (o) => [...o.slices.flatMap((s) => s.requirements), ...o.leftOut.map((e) => e.id)];
const onceEach = (o) => assert.deepEqual([...placed(o)].sort(), AGREED.map((a) => a.id).sort(), JSON.stringify(o));

test('normalizeOutline with agreed: lists ids per slice, unknown ids dropped, the first slice wins a duplicate', () => {
  const r = normalizeOutline(reqOutline(['R-po-1', 'R-x-9', 'R-po-1', 'R-ux-1'], ['R-ux-1', 'R-po-2', 'R-qa-1']),
    { agreed: [...AGREED, { id: 'bad', text: 'x' }, { id: 'R-po-1', text: 'dup' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.outline.slices.map((s) => s.requirements), [['R-po-1', 'R-ux-1'], ['R-po-2', 'R-qa-1']]);
  assert.deepEqual(r.outline.agreed, AGREED);
  assert.deepEqual(r.outline.leftOut, [{ id: 'R-ops-1', reason: '' }]);
});

test('an unplaced id lands in leftOut with an empty reason', () => {
  const r = normalizeOutline({ ...reqOutline(['R-po-1'], ['R-po-2']), leftOut: [{ id: 'R-qa-1', reason: '  Moved to a later feature ' }] }, { agreed: AGREED });
  assert.deepEqual(r.outline.leftOut, [{ id: 'R-qa-1', reason: 'Moved to a later feature' }, { id: 'R-ux-1', reason: '' }, { id: 'R-ops-1', reason: '' }]);
  onceEach(r.outline);
  assert.equal(normalizeOutline({ ...reqOutline([], []), leftOut: [{ id: 'R-qa-1', reason: 'x'.repeat(300) }] }, { agreed: AGREED }).outline.leftOut[0].reason.length, 200);
});

test('exactly once after merge/remove edits', () => {
  const three = normalizeOutline(goodOutline({ slices: [slice('s1', { requirements: ['R-po-1'] }), slice('s2', { requirements: ['R-po-2', 'R-ux-1'] }),
    slice('s3', { requirements: ['R-qa-1'] })] }), { agreed: AGREED }).outline;
  const seqs = {
    'merge 1+2 then 1+2 again (chain)': [{ op: 'merge', id: 's1' }, { op: 'merge', id: 's1' }],
    'remove 2 then merge 1+2': [{ op: 'remove', id: 's2' }, { op: 'merge', id: 's1' }],
    'remove down to one slice': [{ op: 'remove', id: 's3' }, { op: 'remove', id: 's2' }],
  };
  for (const [name, edits] of Object.entries(seqs)) {
    const r = applyOutlineEdits(three, edits);
    assert.equal(r.ok, true, name);
    onceEach(r.outline);
    onceEach(settleLeftOut(r.outline));
  }
  const chain = applyOutlineEdits(three, seqs['merge 1+2 then 1+2 again (chain)']).outline;
  assert.deepEqual(chain.slices[0].requirements, ['R-po-1', 'R-po-2', 'R-ux-1', 'R-qa-1']);
  const removed = applyOutlineEdits(three, [{ op: 'remove', id: 's2' }]).outline;
  assert.deepEqual(removed.leftOut.slice(-2), [{ id: 'R-po-2', reason: 'Removed from the outline' }, { id: 'R-ux-1', reason: 'Removed from the outline' }]);
  const bad = applyOutlineEdits(three, [{ op: 'merge', id: 's3' }]);
  assert.equal(bad.ok, false);
  onceEach(three);
  const raw = { ...reqOutline(['R-po-1'], ['R-po-2']), leftOut: [{ id: 'R-qa-1', reason: 'a' }, { id: 'R-qa-1', reason: 'b' }, { id: 'R-z-1', reason: 'c' }, { id: 'R-po-1', reason: 'd' }] };
  const n = normalizeOutline(raw, { agreed: AGREED }).outline;
  assert.deepEqual(n.leftOut, [{ id: 'R-qa-1', reason: 'a' }, { id: 'R-ux-1', reason: '' }, { id: 'R-ops-1', reason: '' }]);
  onceEach(n);
});

test('settleLeftOut fills empty reasons', () => {
  const o = normalizeOutline(reqOutline(['R-po-1'], []), { agreed: AGREED }).outline;
  const s = settleLeftOut(o);
  assert.ok(s.leftOut.every((e) => e.reason));
  assert.equal(s.leftOut.find((e) => e.id === 'R-ops-1').reason, 'Not placed in a slice when the outline was approved');
  const plain = goodOutline();
  assert.equal(settleLeftOut(plain), plain);
});

test('checkSlices adds the requirements row only with agreed, ✕ with `R-ops-1 is in no slice`', () => {
  const o = normalizeOutline(reqOutline(['R-po-1', 'R-po-2', 'R-ux-1'], ['R-qa-1']), { agreed: AGREED }).outline;
  const c = checkSlices(o);
  assert.equal(c.total, 6);
  const row = c.items.at(-1);
  assert.deepEqual([row.id, row.label, row.pass, row.detail], ['requirements', 'Every agreed requirement is in one slice or left out with a reason', false, 'R-ops-1 is in no slice']);
  assert.equal(checkSlices(settleLeftOut(o)).items.at(-1).pass, true);
  assert.equal(checkSlices(goodOutline()).total, 5);
});

test('no agreed list: today\'s output, no new keys', () => {
  const raw = reqOutline(['R-po-1'], ['R-po-2']);
  const r = normalizeOutline(raw);
  assert.deepEqual(Object.keys(r.outline), ['why', 'slices']);
  assert.equal('requirements' in r.outline.slices[0], false);
  assert.deepEqual(normalizeOutline(raw, { agreed: [] }), r);
  assert.equal(outlineMarkdown(r.outline).includes('Satisfies'), false);
  assert.equal(sliceBrief({ featureTitle: 'C', outline: r.outline, index: 2 }).includes('Satisfies'), false);
  assert.equal(slicingBlock({ file: '/x' }), slicingBlock({ file: '/x', requirements: false }));
  assert.deepEqual(applyOutlineEdits(r.outline, [{ op: 'remove', id: 's2' }]).outline, { why: r.outline.why, slices: [r.outline.slices[0]] });
});

test('C2: brief of a marked feature carries Example lines, and the Lean tests-first line', () => {
  const agreed = AGREED.map((a) => (a.id === 'R-po-2' ? { ...a, example: `  Ana has 3 runs; Export gives 3 rows.  ${'x'.repeat(400)}` } : a));
  const o = normalizeOutline(reqOutline(['R-po-1'], ['R-po-2', 'R-ux-1', 'R-qa-1', 'R-ops-1']), { agreed }).outline;
  const ex = o.agreed.find((a) => a.id === 'R-po-2').example;
  assert.ok(ex.startsWith('Ana has 3 runs; Export gives 3 rows.'), 'trimmed');
  assert.equal(ex.length, 300, 'capped like text');
  assert.equal('example' in o.agreed.find((a) => a.id === 'R-ux-1'), false, 'no example, no key');
  const brief = sliceBrief({ featureTitle: 'Charts', outline: o, index: 2 });
  assert.ok(brief.includes(`Satisfies: R-po-2, R-ux-1, R-qa-1, R-ops-1\n- **R-po-2** text of R-po-2\n  Example: ${ex}\n- **R-ux-1** text of R-ux-1\n`), brief);
  assert.deepEqual(criterionIds(brief), ['R-po-2', 'R-ux-1', 'R-qa-1', 'R-ops-1']);
  assert.ok(!brief.includes('Write the tests for these examples first'));
  const lean = sliceBrief({ featureTitle: 'Charts', outline: o, index: 2, testsFirst: true });
  assert.ok(lean.includes('- **R-ops-1** text of R-ops-1\nWrite the tests for these examples first, then the code.\n\n'), lean);
  // A slice whose ids have no example gets no tests-first line, even under Lean.
  assert.ok(!sliceBrief({ featureTitle: 'Charts', outline: o, index: 1, testsFirst: true }).includes('Write the tests for these examples first'));
  // An example's line breaks collapse, so it stays one indented line under its criterion.
  const multi = normalizeOutline(reqOutline(['R-po-1'], ['R-po-2', 'R-ux-1', 'R-qa-1', 'R-ops-1']),
    { agreed: AGREED.map((a) => (a.id === 'R-po-2' ? { ...a, example: 'Ana exports.\n# Not a heading\n  3 rows.' } : a)) }).outline;
  assert.equal(multi.agreed.find((a) => a.id === 'R-po-2').example, 'Ana exports. # Not a heading 3 rows.');
});

test('C2: an agreed list without examples renders byte-identical', () => {
  const o = normalizeOutline(reqOutline(['R-po-1'], ['R-po-2', 'R-ux-1', 'R-qa-1', 'R-ops-1']), { agreed: AGREED }).outline;
  assert.deepEqual(o.agreed, AGREED);
  const brief = sliceBrief({ featureTitle: 'Charts', outline: o, index: 2 });
  assert.ok(brief.includes('Satisfies: R-po-2, R-ux-1, R-qa-1, R-ops-1\n- **R-po-2** text of R-po-2\n- **R-ux-1** text of R-ux-1\n- **R-qa-1** text of R-qa-1\n- **R-ops-1** text of R-ops-1\n\n'), brief);
});

test('sliceBrief lists `Satisfies:` and only its slice\'s criterion lines (`criteriaList` returns 4 ids)', () => {
  const o = normalizeOutline(reqOutline(['R-po-1'], ['R-po-2', 'R-ux-1', 'R-qa-1', 'R-ops-1']), { agreed: AGREED }).outline;
  const brief = sliceBrief({ featureTitle: 'Charts', outline: o, index: 2 });
  assert.ok(brief.includes('Acceptance:\n- GET /api/x returns 200\n\nSatisfies: R-po-2, R-ux-1, R-qa-1, R-ops-1\n- **R-po-2** text of R-po-2\n'), brief);
  assert.deepEqual(criterionIds(brief), ['R-po-2', 'R-ux-1', 'R-qa-1', 'R-ops-1']);
  assert.ok(outlineMarkdown(o).includes('   Satisfies: R-po-1\n'));
  assert.deepEqual(sliceRequirementIds({ index: 2, outline: o }), ['R-po-2', 'R-ux-1', 'R-qa-1', 'R-ops-1']);
  assert.deepEqual(sliceRequirementIds({ index: 1, outline: goodOutline() }), []);
});

test('normalizeOutline(raw) keeps raw.agreed (ticket re-normalise)', () => {
  const o = settleLeftOut(normalizeOutline(reqOutline(['R-po-1', 'R-po-2'], ['R-ux-1', 'R-qa-1']), { agreed: AGREED }).outline);
  assert.deepEqual(normalizeOutline(JSON.parse(JSON.stringify(o))).outline, o);
});

test('agreed is capped at 64 entries and 300-char texts', () => {
  const big = Array.from({ length: 70 }, (_, i) => ({ id: `R-po-${i + 1}`, text: 'y'.repeat(400) }));
  const o = normalizeOutline(goodOutline(), { agreed: big }).outline;
  assert.equal(o.agreed.length, 64);
  assert.equal(o.agreed[0].text.length, 300);
  assert.equal(o.leftOut.length, 64);
});

// A3 The split rules: the small-runs rule set, chosen by the caller's `smallRuns` option.
test('smallRuns: constants and labels', () => {
  assert.equal(SMALL_RUNS_MAX, 20);
  assert.equal(BUILDS_ON_MAX, 12);
  assert.equal(SMALL_RUNS_OUTLINE_CAP, 24);
  assert.deepEqual(RUN_REQUIREMENTS_MAX, { lean: 3, balanced: 3, thorough: 2 });
  assert.deepEqual(SMALL_RUN_IDS, ['runs', 'acceptance', 'notLayered', 'buildsOnEarlier', 'buildsOnMax', 'requirementsPerRun', 'ownership', 'coverage', 'confirmRole']);
  assert.deepEqual(Object.keys(SMALL_RUN_LABELS), SMALL_RUN_IDS);
  assert.equal(SMALL_RUN_LABELS.acceptance, SLICE_LABELS.acceptance);
  assert.equal(SMALL_RUN_LABELS.notLayered, SLICE_LABELS.notLayered);
  assert.equal(SMALL_RUN_LABELS.runs, 'Two to 20 slices');
  for (const v of [RUN_REQUIREMENTS_MAX, SMALL_RUN_IDS, SMALL_RUN_LABELS]) assert.ok(Object.isFrozen(v));
});

test('smallRuns: 20 runs pass, 21 and 1 rejected by runs', () => {
  const twenty = checkSlices(runs(20, 1), on());
  assert.equal(twenty.ok, true);
  assert.deepEqual(twenty.items.map((i) => i.id), SMALL_RUN_IDS);
  const r21 = normalizeOutline(runs(21, 1), on());
  assert.equal(r21.outline.slices.length, 21);
  assert.deepEqual(failing(r21.outline, on()), ['runs']);
  assert.match(checkSlices(r21.outline, on()).items[0].detail, /21 slices: never more than 20/);
  assert.deepEqual(failing(runs(1, 1), on()), ['runs']);
  assert.match(checkSlices(runs(1, 1), on()).items[0].detail, /Don't slice/);
});

test('smallRuns: a 9-run split passes without a why', () => {
  const o = runs(9, 1);
  o.why = '';
  assert.equal(checkSlices(o, on()).ok, true);
  assert.deepEqual(failing(o), ['count', 'notTiny']);
  assert.deepEqual(failing(many(9, { why: '' }), on()), [], 'no agreed list');
  assert.deepEqual(failing(many(9, { why: '' })), ['count']);
});

test('smallRuns: requirements per run by Care', () => {
  const caps = { lean: 3, balanced: 3, bogus: 3, thorough: 2 };
  for (const [care, cap] of Object.entries(caps)) {
    for (const k of [0, 1, 2, 3, 4]) {
      const r = checkSlices(perRun([k, 1]), on(care));
      if (k >= 1 && k <= cap) { assert.equal(r.ok, true, `${care} ${k}`); continue; }
      assert.deepEqual(r.items.filter((i) => !i.pass).map((i) => i.id), ['requirementsPerRun'], `${care} ${k}`);
      const { detail } = r.items.find((i) => i.id === 'requirementsPerRun');
      assert.match(detail, /^s1 /, `${care} ${k}`);
    }
  }
  assert.equal(checkSlices(perRun([4, 1]), on()).items.find((i) => i.id === 'requirementsPerRun').detail, 's1 owns 4 requirements (1 to 3 under Balanced)');
  assert.equal(checkSlices(perRun([3, 1]), on('thorough')).items.find((i) => i.id === 'requirementsPerRun').detail, 's1 owns 3 requirements (1 to 2 under Thorough)');
  assert.equal(checkSlices(perRun([0, 1]), on()).items.find((i) => i.id === 'requirementsPerRun').detail, 's1 owns no requirement');
});

test('smallRuns: no agreed list, no requirement rows', () => {
  const ids = checkSlices(many(3), on()).items.map((i) => i.id);
  assert.deepEqual(ids, ['runs', 'acceptance', 'notLayered', 'buildsOnEarlier', 'buildsOnMax']);
});

test('smallRuns: an id owned by two runs fails ownership', () => {
  const o = perRun([1, 1]);
  o.slices[1].requirements = ['R-po-2', 'R-po-1'];
  assert.deepEqual(failing(o, on()), ['ownership']);
  assert.equal(checkSlices(o, on()).items.find((i) => i.id === 'ownership').detail, 'R-po-1 is owned by s1 and s2');
  const both = { ...perRun([1, 1]), confirmed: [{ id: 'R-po-1', role: 'Security' }] };
  assert.deepEqual(failing(both, on()), ['ownership']);
  assert.match(checkSlices(both, on()).items.find((i) => i.id === 'ownership').detail, /^R-po-1 is owned by s1 and confirmed by Security$/);
});

test('smallRuns: an uncovered id fails coverage', () => {
  const o = perRun([1, 1]);
  o.agreed.push({ id: 'R-ops-1', text: 'ops' });
  assert.deepEqual(failing(o, on()), ['coverage']);
  assert.equal(checkSlices(o, on()).items.find((i) => i.id === 'coverage').detail, 'R-ops-1 is not owned by a slice or confirmed by a person');
  o.leftOut = [{ id: 'R-ops-1', reason: 'Moved to a later feature' }];
  assert.deepEqual(failing(o, on()), ['coverage']);
});

test("smallRuns: role 'Legal' fails confirmRole; 'Compliance' passes", () => {
  const o = perRun([1, 1]);
  o.agreed.push({ id: 'R-ops-1', text: 'ops' });
  const legal = { ...o, confirmed: [{ id: 'R-ops-1', role: 'Legal' }] };
  assert.deepEqual(failing(legal, on()), ['confirmRole']);
  assert.equal(checkSlices(legal, on()).items.find((i) => i.id === 'confirmRole').detail,
    'R-ops-1: "Legal" cannot confirm a requirement. Pick Product, Engineering, Design, DevOps, Security, Compliance or QA.');
  assert.equal(checkSlices({ ...o, confirmed: [{ id: 'R-ops-1', role: ' compliance ' }] }, on()).ok, true);
  assert.equal(checkSlices({ ...o, confirmed: [{ id: 'R-ops-1', role: 'Compliance' }] }, on()).ok, true);
});

test('smallRuns B4: ownership, coverage and confirmRole list one failure per failing id; every wrong role is named', () => {
  const o = perRun([1, 1, 1]);
  o.slices[1].requirements = ['R-po-2', 'R-po-1'];
  o.slices[2].requirements = ['R-po-3', 'R-po-1', 'R-po-2'];
  o.agreed.push({ id: 'R-ops-1', text: 'ops' }, { id: 'R-ops-2', text: 'ops 2' }, { id: 'R-sec-1', text: 's' }, { id: 'R-sec-2', text: 's2' });
  o.confirmed = [{ id: 'R-sec-1', role: 'Legal' }, { id: 'R-sec-2', role: 'Board' }];
  const item = (id) => checkSlices(o, on()).items.find((i) => i.id === id);
  assert.deepEqual(item('ownership').failures, [
    { id: 'R-po-1', text: 'R-po-1 is owned by s1, s2 and s3' }, { id: 'R-po-2', text: 'R-po-2 is owned by s2 and s3' }]);
  assert.equal(item('ownership').detail, 'R-po-1 is owned by s1, s2 and s3; R-po-2 is owned by s2 and s3');
  assert.deepEqual(item('coverage').failures.map((f) => f.id), ['R-ops-1', 'R-ops-2']);
  assert.equal(item('coverage').failures[0].text, 'R-ops-1 is not owned by a slice or confirmed by a person');
  assert.deepEqual(item('confirmRole').failures.map((f) => f.id), ['R-sec-1', 'R-sec-2']);
  assert.match(item('confirmRole').failures[1].text, /^R-sec-2: "Board" cannot confirm a requirement\./);
  assert.equal(item('confirmRole').detail, item('confirmRole').failures.map((f) => f.text).join('; '));
  const ok = checkSlices(perRun([1, 1]), on()).items;
  for (const id of ['ownership', 'coverage', 'confirmRole']) assert.deepEqual(ok.find((i) => i.id === id).failures, [], id);
  assert.ok(checkSlices(perRun([1, 1])).items.every((i) => !('failures' in i)), 'dev items unchanged');
});

test('smallRuns B4: the confirm edit only with the option; it replaces the role of a confirmed id', () => {
  const edit = { op: 'confirm', id: 'R-ops-1', role: 'Security' };
  assert.equal(normalizeEdits([edit]).ok, false);
  assert.deepEqual(normalizeEdits([edit, { op: 'merge', id: 's1', x: 1 }], { confirm: true }),
    { ok: true, edits: [edit, { op: 'merge', id: 's1' }] });
  assert.equal(normalizeEdits([{ op: 'confirm', id: 'R-ops-1' }], { confirm: true }).ok, false);
  const o = { ...perRun([1, 1]), confirmed: [{ id: 'R-ops-1', role: 'Legal' }] };
  o.agreed.push({ id: 'R-ops-1', text: 'ops' });
  const r = applyOutlineEdits(o, [edit]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.outline.confirmed, [{ id: 'R-ops-1', role: 'Security' }]);
  assert.deepEqual(o.confirmed, [{ id: 'R-ops-1', role: 'Legal' }], 'input not mutated');
  assert.equal(checkSlices(r.outline, on()).ok, true);
  assert.equal(applyOutlineEdits(o, [{ ...edit, id: 'R-po-1' }]).ok, false, 'agreed but not confirmed');
  assert.equal(applyOutlineEdits(o, [{ ...edit, id: 'R-zz-9' }]).ok, false, 'not agreed');
  assert.equal(applyOutlineEdits(o, [{ ...edit, role: 'Legal' }]).ok, false, 'not a role');
});

test('smallRuns: a self and a forward builds-on each fail buildsOnEarlier', () => {
  const self = perRun([1, 1]);
  self.slices[1].dependsOn = ['s2'];
  assert.deepEqual(failing(self, on()), ['buildsOnEarlier']);
  assert.equal(checkSlices(self, on()).items.find((i) => i.id === 'buildsOnEarlier').detail, 's2 builds on s2, which is not an earlier slice');
  const fwd = perRun([1, 1]);
  fwd.slices[0].dependsOn = ['s2'];
  assert.deepEqual(failing(fwd, on()), ['buildsOnEarlier']);
  const unknown = perRun([1, 1]);
  unknown.slices[1].dependsOn = ['x'];
  assert.deepEqual(failing(unknown, on()), ['buildsOnEarlier']);
  assert.equal(checkSlices(unknown, on()).items.find((i) => i.id === 'buildsOnEarlier').detail, 's2 builds on "x", which is not in the outline');
});

test('smallRuns: 13 builds-on entries fail buildsOnMax; 12 pass', () => {
  const o = runs(14, 1);
  o.slices[13].dependsOn = Array.from({ length: 13 }, (_, i) => `s${i + 1}`);
  assert.deepEqual(failing(o, on()), ['buildsOnMax']);
  assert.equal(checkSlices(o, on()).items.find((i) => i.id === 'buildsOnMax').detail, 's14 builds on 13 slices (at most 12)');
  const ok = runs(13, 1);
  ok.slices[12].dependsOn = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
  assert.equal(checkSlices(ok, on()).ok, true);
});

test('smallRuns: every failing item\'s label is SMALL_RUN_LABELS[id]', () => {
  const bad = perRun([4, 1]);
  bad.slices[0].title = 'The API';
  bad.slices[0].acceptance = [];
  bad.slices[1].dependsOn = ['s2'];
  bad.slices[1].requirements.push('R-po-1');
  bad.agreed.push({ id: 'R-ops-1', text: '' }, { id: 'R-sec-1', text: '' });
  bad.confirmed = [{ id: 'R-sec-1', role: 'Legal' }];
  const items = checkSlices(bad, on()).items;
  assert.deepEqual(items.filter((i) => !i.pass).map((i) => i.id), ['acceptance', 'notLayered', 'buildsOnEarlier', 'requirementsPerRun', 'ownership', 'coverage', 'confirmRole']);
  for (const i of items) assert.equal(i.label, SMALL_RUN_LABELS[i.id], i.id);
});

test('smallRuns: ownership, coverage and confirmRole are not waivable, failing or passing; every other row and dev\'s are', () => {
  const fixed = new Set(['ownership', 'coverage', 'confirmRole']);
  const bad = perRun([4, 1]);
  bad.slices[1].requirements.push('R-po-1');
  bad.agreed.push({ id: 'R-ops-1', text: '' }, { id: 'R-sec-1', text: '' });
  bad.confirmed = [{ id: 'R-sec-1', role: 'Legal' }];
  const good = perRun([1, 1]);
  for (const o of [bad, good]) {
    const items = checkSlices(o, on()).items;
    assert.deepEqual(items.filter((i) => fixed.has(i.id)).map((i) => [i.id, i.pass === (o === good)]),
      [['ownership', true], ['coverage', true], ['confirmRole', true]]);
    for (const i of items) assert.equal(i.waivable, !fixed.has(i.id), i.id);
    for (const i of checkSlices(o).items) assert.equal(i.waivable, true, `dev ${i.id}`);
  }
});

test('normalizeOutline smallRuns: keeps 21 slices, 13 dependsOn, a duplicate owner and confirmed; off keeps 12, 12, first wins, no confirmed', () => {
  const raw = runs(21, 1);
  raw.slices[2].dependsOn = Array.from({ length: 13 }, (_, i) => `a${i + 1}`);
  raw.slices[1].requirements = ['R-po-2', 'R-po-1', 'R-po-2'];
  raw.confirmed = [{ id: 'R-po-3', role: `  Legal${' '.repeat(3)}` }, { id: 'R-po-3', role: 'QA' }, { id: 'R-zz-1', role: 'QA' }, { id: 'R-po-4', role: 'x'.repeat(80) }];
  const r = normalizeOutline(raw, on());
  assert.equal(r.outline.slices.length, 21);
  assert.equal(r.outline.slices[2].dependsOn.length, 13);
  assert.deepEqual(r.outline.slices[1].requirements, ['R-po-2', 'R-po-1']);
  assert.deepEqual(r.outline.confirmed, [{ id: 'R-po-3', role: 'Legal' }, { id: 'R-po-4', role: 'x'.repeat(60) }]);
  assert.deepEqual(r.outline.leftOut, []);
  assert.deepEqual(Object.keys(r.outline), ['why', 'slices', 'agreed', 'leftOut', 'confirmed']);
  const off = normalizeOutline(raw);
  assert.equal(off.outline.slices.length, 12);
  assert.equal(off.outline.slices[2].dependsOn.length, 12);
  assert.deepEqual(off.outline.slices[1].requirements, ['R-po-2']);
  assert.equal('confirmed' in off.outline, false);
  assert.equal(normalizeOutline(runs(30, 1), on()).outline.slices.length, 24);
});

test('normalizeOutline smallRuns: leftOut lists only ids neither owned nor confirmed, raw entries first', () => {
  const raw = perRun([1, 1]);
  raw.agreed.push({ id: 'R-ops-1', text: '' }, { id: 'R-sec-1', text: '' }, { id: 'R-qa-1', text: '' });
  raw.leftOut = [{ id: 'R-qa-1', reason: ' later ' }, { id: 'R-po-1', reason: 'owned' }, { id: 'R-sec-1', reason: 'confirmed' }, { id: 'R-qa-1', reason: 'dup' }];
  raw.confirmed = [{ id: 'R-sec-1', role: 'Security' }];
  const o = normalizeOutline(raw, on()).outline;
  assert.deepEqual(o.leftOut, [{ id: 'R-qa-1', reason: 'later' }, { id: 'R-ops-1', reason: '' }]);
});

test('off is dev for every fixture', () => {
  const norm = (raw) => normalizeOutline(raw, { agreed: AGREED }).outline;
  const fixtures = [
    goodOutline(), three(), ...[1, 2, 5, 6, 8, 9, 13].map((n) => many(n)), many(6, { why: '' }),
    withSlice0({ acceptance: [] }), withSlice0({ title: 'The API' }), withSlice0({ dependsOn: ['s2'] }),
    goodOutline({ slices: [slice('s1', { estimate: 'small' }), slice('s2', { estimate: 'small' })] }),
    norm(reqOutline(['R-po-1', 'R-po-2', 'R-ux-1'], ['R-qa-1'])), settleLeftOut(norm(reqOutline(['R-po-1'], []))),
    runs(9, 1), perRun([4, 1]), { ...perRun([1, 1]), confirmed: [{ id: 'R-po-1', role: 'Legal' }] }, {},
  ];
  for (const o of fixtures) {
    const dev = checkSlices(o);
    assert.deepEqual(checkSlices(o, {}), dev);
    assert.deepEqual(checkSlices(o, { smallRuns: false }), dev);
    assert.ok(dev.items.every((i) => SLICE_IDS.includes(i.id) || i.id === 'requirements'));
  }
});

test('smallRuns off or omitted is dev', () => {
  const r = checkSlices(many(9));
  assert.deepEqual(failing(many(9)), ['count']);
  assert.equal(r.items[0].detail, '9 slices: never more than 8');
  assert.equal(normalizeOutline(many(13)).outline.slices.length, 12);
  assert.equal(normalizeOutline(many(13), { smallRuns: false }).outline.slices.length, 12);
  assert.ok(slicingBlock({ file: 'f' }).includes('never more than 8'));
  assert.equal(slicingBlock({ file: 'f' }), slicingBlock({ file: 'f', smallRuns: false }));
});

test('slicingBlock off is pinned to the checkpoint', () => {
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  assert.equal(sha(slicingBlock({ file: 'f' })), 'd5c9ed1613c9dfefba4dfcc497572aede66677a4968e82428de2b93ee2981dbc');
  assert.equal(sha(slicingBlock({ file: 'f', requirements: true })), '036f023bc3504b5a48ded50c9990efd2bb786663431565567a71043807be62ba');
});

test('stored confirmed is dropped off', () => {
  const raw = { ...perRun([1, 1]), confirmed: [{ id: 'R-po-1', role: 'QA' }] };
  assert.equal('confirmed' in normalizeOutline(raw).outline, false);
  assert.equal('confirmed' in normalizeOutline(perRun([1, 1]), on()).outline, false);
  assert.equal('confirmed' in normalizeOutline({ ...raw, confirmed: [{ id: 'R-zz-9', role: 'QA' }] }, on()).outline, false);
  assert.equal('confirmed' in normalizeOutline(many(3, { confirmed: [{ id: 'R-po-1', role: 'QA' }] }), on()).outline, false, 'no agreed list');
});

test('slicingBlock smallRuns: at most 20, 1 to 2 under thorough, the confirmed key with requirements; no "never more than 8"', () => {
  const dev = slicingBlock({ file: 'f' });
  const b = slicingBlock({ file: 'f', smallRuns: true });
  assert.ok(b.includes('- Prefer small slices: at most 20; each owns 1 to 3 agreed requirements.\n'));
  assert.ok(b.includes('- "dependsOn" names only earlier slices, at most 12.\n'));
  assert.ok(!b.includes('never more than 8'));
  assert.ok(!b.includes('"confirmed"'));
  assert.ok(slicingBlock({ file: 'f', smallRuns: true, care: 'thorough' }).includes('each owns 1 to 2 agreed requirements'));
  // every other line is dev's
  const changed = (x) => x.split('\n').filter((l) => !dev.split('\n').includes(l));
  assert.deepEqual(changed(b), ['- Prefer small slices: at most 20; each owns 1 to 3 agreed requirements.', '- "dependsOn" names only earlier slices, at most 12.']);
  const req = slicingBlock({ file: 'f', requirements: true, smallRuns: true });
  assert.ok(req.includes('"confirmed": [{"id": "R-sec-1", "role": "Security"}]'));
  assert.ok(req.includes('put every R-id in exactly one slice, or in confirmed with one of: Product, Engineering, Design, DevOps, Security, Compliance or QA.\n'));
});

// Ask screens slice 9: the one formula for a feature's number of runs, shared by careEstimates and the Start card.
test('careRunCount: ceil over the per-run cap; null without a positive integer count', () => {
  for (const [requirements, care, want] of [
    [16, 'thorough', 8], [16, 'balanced', 6], [16, 'lean', 6], [20, 'thorough', 10], [3, 'balanced', 1], [3, 'thorough', 2],
  ]) {
    assert.equal(SLICES.careRunCount(requirements, care), want, `${requirements} at ${care}`);
  }
  for (const requirements of [null, undefined, 0, -2, 2.5, '16']) {
    for (const care of ['lean', 'balanced', 'thorough']) {
      assert.equal(SLICES.careRunCount(requirements, care), null, `${JSON.stringify(requirements)} at ${care}`);
    }
  }
  // An unknown position uses the balanced cap.
  assert.equal(SLICES.careRunCount(16, 'nonsense'), 6);
  assert.equal(SLICES.careRunCount(16, undefined), 6);
});
