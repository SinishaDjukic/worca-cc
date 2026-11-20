// test/shape-acceptance.test.mjs — Shaper requirements s3 (D7, D11, D14): the acceptance ledger's pure rules
// (src/shared/shape/acceptance.mjs): the normaliser, the ship gate, the check items and the Changes prompt block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPTANCE_MARKS, ACCEPTANCE_TEXT_MAX, normalizeAcceptance, acceptanceGate, ledgerCheck, changesRequirementsBlock }
  from '../src/shared/shape/acceptance.mjs';
import { criterionIds } from '../src/shared/review/coverage.mjs';

const AGREED = [
  { id: 'R-po-1', text: 'Export the report as CSV' },
  { id: 'R-sec-2', text: 'Sign every export' },
  { id: 'R-ux-1', text: 'Dark theme' },
  { id: 'R-ops-1', text: 'Alert on failed exports' },
];
const MARKED = [
  { id: 'R-po-1', mark: 'met' },
  { id: 'R-sec-2', mark: 'not-met', target: 'Run 5' },
  { id: 'R-ux-1', mark: 'dropped', reason: 'out of budget' },
];

test('the marks and the text cap', () => {
  assert.deepEqual(ACCEPTANCE_MARKS, ['met', 'not-met', 'dropped']);
  assert.equal(ACCEPTANCE_TEXT_MAX, 300);
});

test('normalizeAcceptance returns each of the six errors', () => {
  const err = (raw) => normalizeAcceptance(raw, AGREED).error;
  assert.equal(err({ id: 'R-po-1' }), 'entries must be a list');
  assert.equal(err([{ id: 'R-x-9', mark: 'met' }]), 'R-x-9 is not an agreed requirement');
  assert.equal(err([{ id: 'R-po-1', mark: 'met' }, { id: 'R-po-1', mark: 'met' }]), 'R-po-1 is marked twice');
  assert.equal(err([{ id: 'R-po-1', mark: 'done' }]), 'R-po-1: the mark must be met, not-met or dropped');
  assert.equal(err([{ id: 'R-po-1', mark: 'not-met' }]), 'R-po-1: not met needs where it moved');
  assert.equal(err([{ id: 'R-po-1', mark: 'dropped', reason: '' }]), 'R-po-1: dropped needs a reason');
  assert.equal(normalizeAcceptance({}, AGREED).ok, false);
});

test('normalizeAcceptance accepts a partial list in agreed order, clips text, and reads whitespace as empty', () => {
  const r = normalizeAcceptance([{ id: 'R-ux-1', mark: 'dropped', reason: ` ${'r'.repeat(400)} ` }, { id: 'R-po-1', mark: 'met', target: 'x' }], AGREED);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map((e) => e.id), ['R-po-1', 'R-ux-1']);
  assert.deepEqual(r.entries[0], { id: 'R-po-1', mark: 'met' });
  assert.equal(r.entries[1].reason.length, ACCEPTANCE_TEXT_MAX);
  assert.equal(normalizeAcceptance([{ id: 'R-sec-2', mark: 'not-met', target: '   ' }], AGREED).error, 'R-sec-2: not met needs where it moved');
  assert.equal(normalizeAcceptance([{ id: 'R-ux-1', mark: 'dropped', reason: '\n\t' }], AGREED).error, 'R-ux-1: dropped needs a reason');
  assert.deepEqual(normalizeAcceptance([], AGREED), { ok: true, entries: [] });
});

test('acceptanceGate: empty agreed is ready; a stale id is ignored', () => {
  assert.deepEqual(acceptanceGate([], [{ id: 'R-po-1', mark: 'met' }]), { ready: true, marked: 0, total: 0, missing: [] });
  assert.deepEqual(acceptanceGate(AGREED.slice(0, 1), [{ id: 'R-po-1', mark: 'met' }, { id: 'R-old-1', mark: 'met' }]),
    { ready: true, marked: 1, total: 1, missing: [] });
});

test('acceptanceGate is ready only when every id carries a valid mark', () => {
  assert.deepEqual(acceptanceGate(AGREED, MARKED), { ready: false, marked: 3, total: 4, missing: ['R-ops-1'] });
  assert.deepEqual(acceptanceGate(AGREED, undefined).missing, ['R-po-1', 'R-sec-2', 'R-ux-1', 'R-ops-1']);
  const invalid = [...MARKED.slice(0, 2), { id: 'R-ux-1', mark: 'dropped', reason: ' ' }, { id: 'R-ops-1', mark: 'not-met' }];
  assert.deepEqual(acceptanceGate(AGREED, invalid).missing, ['R-ux-1', 'R-ops-1']);
  assert.equal(acceptanceGate(AGREED, [...MARKED, { id: 'R-ops-1', mark: 'met' }]).ready, true);
});

test('ledgerCheck labels with and without the state words; each mark has its aria-label', () => {
  const c = ledgerCheck(AGREED, MARKED, ['R-ops-1']);
  assert.deepEqual(c.items.map((i) => i.label), [
    'R-po-1 · Export the report as CSV · met',
    'R-sec-2 · Sign every export · not met · moved to Run 5',
    'R-ux-1 · Dark theme · dropped · out of budget',
    'R-ops-1 · Alert on failed exports · not marked',
  ]);
  assert.deepEqual(c.items.map((i) => i.ariaLabel), ['met', 'not met', 'dropped', 'not marked']);
  assert.deepEqual(c.items.map((i) => i.state), [undefined, 'not-met', 'dropped', undefined]);
  assert.deepEqual([c.passed, c.total], [3, 4]);
  assert.equal(c.items[3].pass, false);
  assert.equal(c.items[3].detail, 'covered by the diff');
  assert.equal(c.items[0].detail, '');
  const e = ledgerCheck(AGREED, MARKED, [], { editing: true });
  assert.deepEqual(e.items.map((i) => i.label), [
    'R-po-1 · Export the report as CSV',
    'R-sec-2 · Sign every export · moved to Run 5',
    'R-ux-1 · Dark theme · out of budget',
    'R-ops-1 · Alert on failed exports',
  ]);
});

test('changesRequirementsBlock lists the agreed ids so criterionIds parses them back', () => {
  const b = changesRequirementsBlock(AGREED, MARKED);
  assert.deepEqual(criterionIds(b), AGREED.map((a) => a.id));
  assert.match(b, /^- \*\*R-po-1\*\* Export the report as CSV$/m);
  assert.match(b, /R-sec-2 not met, moved to Run 5/);
  assert.equal(changesRequirementsBlock([], []), '');
});
