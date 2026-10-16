import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTLINE_FILE, OUTLINE_CHANGE_FILE, OUTLINE_ROUNDS_MAX, OUTLINE_EDITS_MAX, SLICE_IDS, SLICE_LABELS, FLAT_NOTE,
  normalizeOutline, checkSlices, normalizeEdits, applyOutlineEdits,
  outlineMarkdown, slicingBlock, outlineFixFeedback, outlineFixAllFeedback, outlineFeedbackBlock, sliceScopeBlock, sliceBrief, replanBrief, changelogWithFeature,
} from '../src/shared/shape/slices.mjs';
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
const failing = (outline) => checkSlices(outline).items.filter((i) => !i.pass).map((i) => i.id);
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
