// test/requirements-ticket.test.mjs — the tool-neutral ticket and the changes since the last export (plans/requirements-a6-design.md
// D4, D6, D8, §4). Pure: no store, no tracker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { renderTicketMarkdown, criterionLine } from '../src/core/requirements/markdown.mjs';
import {
  EXPORT_LIMITS, exportLabel, normalizeLabels, exportDate, exportTime, buildTicket, exportChanges, changeSummary, renderExportComment, ticketHash,
} from '../src/core/requirements/ticket.mjs';

const CRITERIA = [
  { id: 'R-po-1', text: 'A customer can cancel a paid order that has not shipped.' },
  { id: 'R-po-2', text: 'Cancel is refused once the order has shipped, with the reason shown.' },
  { id: 'R-po-3', text: 'A packed order that has not been picked up can still be cancelled.' },
  { id: 'R-po-4', text: 'The customer sees a confirmation with what happens next.' },
  { id: 'R-po-5', text: 'Support sees who cancelled an order and when.' },
];
const SPEC = {
  ...emptySpec(),
  goal: { text: 'Customers cancel an order themselves until it leaves the warehouse.', measure: 'a third fewer “cancel my order” support calls.' },
  actors: ['Customer', 'Support agent'],
  flow: ['The customer opens the order in their order history.', 'They choose Cancel order and confirm.',
    'The order is cancelled, the payment is refunded and the customer sees what happens next.'],
  rules: ['A refund goes back the way the order was paid.', 'Packed but not picked up still counts as not shipped.'],
  edgeCases: ['The parcel is picked up while the customer confirms: cancel is refused with the reason.'],
  outOfScope: ['Returns after delivery.'],
  criteria: CRITERIA,
  assumptions: [
    { id: 'A-1', text: 'Orders paid on account (invoices) can be cancelled the same way.', status: 'confirmed' },
    { id: 'A-2', text: 'The refund is started at once; the payment provider decides when it arrives.', status: 'confirmed' },
    { id: 'A-3', text: 'Support can cancel on the customer\'s behalf.', status: 'confirmed' },
    { id: 'A-4', text: 'Business customers need no approval.', status: 'open' },
  ],
  openQuestions: ['Do business customers need approval before cancelling?'],
};
const F = { seq: 7, id: 'FEAT-7', title: 'Cancel an order before it ships', scopeType: 'project', scopeKey: 'shop-1', description: 'd', spec: SPEC };

// Board 27's description, byte for byte (the ticket shows confirmed assumptions only; open questions are not in it).
const BOARD_27 = [
  '## Goal', '', 'Customers cancel an order themselves until it leaves the warehouse.', '', 'Measure: a third fewer “cancel my order” support calls.', '',
  '## Actors', '', 'Customer · Support agent', '',
  '## Main flow', '', '1. The customer opens the order in their order history.', '2. They choose Cancel order and confirm.',
  '3. The order is cancelled, the payment is refunded and the customer sees what happens next.', '',
  '## Business rules', '', '- A refund goes back the way the order was paid.', '- Packed but not picked up still counts as not shipped.', '',
  '## Edge cases', '', '- The parcel is picked up while the customer confirms: cancel is refused with the reason.', '',
  '## Out of scope', '', '- Returns after delivery.', '',
  '## Acceptance criteria', '', ...CRITERIA.map((c) => `- ${c.id} ${c.text}`), '',
  '## Confirmed assumptions', '', '- A-1 Orders paid on account (invoices) can be cancelled the same way.',
  '- A-2 The refund is started at once; the payment provider decides when it arrives.', '- A-3 Support can cancel on the customer\'s behalf.', '',
  '## Files the spec mentions', '', '- support-tickets.pdf', '',
  'From Worca FEAT-7 · exported 26 Oct 2026', '',
].join('\n');

test("board 27: the ticket's description, in its order, with the footer", () => {
  assert.equal(renderTicketMarkdown(F, { exportedOn: '26 Oct 2026', mentionedFiles: ['support-tickets.pdf'] }), BOARD_27);
});

test('empty sections are left out; the reason leads; criteria to a field leave the description', () => {
  const bare = { ...F, spec: { ...emptySpec(), goal: { text: 'Cancel', measure: '' } } };
  assert.equal(renderTicketMarkdown(bare, { exportedOn: '26 Oct 2026' }), '## Goal\n\nCancel\n\nFrom Worca FEAT-7 · exported 26 Oct 2026\n');
  const why = renderTicketMarkdown(F, { exportedOn: '26 Oct 2026', reason: 'The team estimates in Jira tomorrow.' });
  assert.ok(why.startsWith('Exported before Ready: The team estimates in Jira tomorrow.\n\n## Goal\n\n'));
  const noCrit = renderTicketMarkdown(F, { exportedOn: '26 Oct 2026', criteriaInDescription: false });
  assert.doesNotMatch(noCrit, /## Acceptance criteria/);
  assert.match(noCrit, /## Confirmed assumptions/);
  assert.doesNotMatch(renderTicketMarkdown(F, { exportedOn: '26 Oct 2026' }), /_None yet\._|Open questions|Do business customers|A-4/);
});

test('A8 sources stay on criteria and assumptions: "(from <name>)"', () => {
  const s = { ...SPEC, criteria: [{ id: 'R-po-5', text: 'Support sees who cancelled an order and when.', source: 'support-tickets.pdf' }],
    assumptions: [{ id: 'A-1', text: 'Invoices too.', status: 'confirmed', source: 'mail.txt' }] };
  const md = renderTicketMarkdown({ ...F, spec: s }, { exportedOn: '26 Oct 2026' });
  assert.match(md, /\n- R-po-5 Support sees who cancelled an order and when\. \(from support-tickets\.pdf\)\n/);
  assert.match(md, /\n- A-1 Invoices too\. \(from mail\.txt\)\n/);
  assert.equal(criterionLine(s.criteria[0]), 'R-po-5 Support sees who cancelled an order and when. (from support-tickets.pdf)');
});

test('buildTicket: the neutral ticket; labels normalised with the fixed one; criteria in a field as items', () => {
  const t = buildTicket(F, { project: 'SHOP', issueType: '10001', labels: ['worca'], priority: null, exportedOn: '26 Oct 2026',
    mentionedFiles: ['support-tickets.pdf'] });
  assert.deepEqual(t, { project: 'SHOP', issueType: '10001', title: 'Cancel an order before it ships', description: BOARD_27,
    labels: ['worca', 'worca-FEAT-7'], priority: null, criteria: { target: 'description' } });
  const fld = buildTicket(F, { project: 'SHOP', issueType: '10001', labels: [], priority: '3', exportedOn: '26 Oct 2026',
    criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } });
  assert.deepEqual(fld.criteria, { target: 'field', field: 'customfield_10070', items: CRITERIA.map((c) => `${c.id} ${c.text}`) });
  assert.doesNotMatch(fld.description, /## Acceptance criteria/);
  assert.deepEqual([fld.priority, fld.labels], ['3', ['worca-FEAT-7']]);
});

test('labels (D6): trimmed, spaces to "-", at most 255 characters, no duplicates or empties, at most 10 with the fixed one last', () => {
  assert.equal(exportLabel(F), 'worca-FEAT-7');
  const long = 'x'.repeat(300);
  assert.deepEqual(normalizeLabels(['  worca ', 'needs review', 'needs \t  review', 'worca', '', null, long, 'worca-FEAT-7'], 'worca-FEAT-7'),
    ['worca', 'needs-review', 'x'.repeat(EXPORT_LIMITS.label), 'worca-FEAT-7']);
  const many = Array.from({ length: 15 }, (_, i) => `l${i}`);
  const out = normalizeLabels(many, 'worca-FEAT-7');
  assert.equal(out.length, EXPORT_LIMITS.labels);
  assert.deepEqual([out[0], out[8], out[9]], ['l0', 'l8', 'worca-FEAT-7']);
  assert.deepEqual(normalizeLabels(many).length, 10, 'without a fixed label: ten');
  assert.deepEqual(normalizeLabels('nope'), []);
});

test('dates are the server\'s local date with English months, never the browser\'s locale', () => {
  const was = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Auckland';
    assert.equal(exportDate('2026-10-26T12:30:00.000Z'), '27 Oct 2026');
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(exportDate('2026-10-26T12:30:00.000Z'), '26 Oct 2026');
    assert.equal(exportDate('2026-10-26T12:30:00.000Z', { year: false }), '26 Oct');
    assert.equal(exportTime('2026-10-26T17:42:00.000Z'), '26 Oct, 10:42');
    assert.equal(exportDate(null), '');
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

// Board 28: R-po-6 added, one business rule reworded, one edge case added.
const BEFORE = { ...SPEC, rules: ['A refund goes back the way the order was paid.', 'Packed orders count as shipped.'] };
const AFTER = { ...SPEC, criteria: [...CRITERIA, { id: 'R-po-6', text: 'An order with some items shipped can cancel only the items not yet picked up.' }],
  edgeCases: [...SPEC.edgeCases, 'A partly shipped order cancels only the items not yet picked up.'] };

test('board 28: what changed since the last export, summarised and as the comment', () => {
  const changes = exportChanges(BEFORE, AFTER);
  assert.deepEqual(changeSummary(changes), [
    { line: 'Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.', id: 'R-po-6' },
    { line: 'Business rules: 1 line changed', id: null },
    { line: 'Edge cases: 1 line added', id: null },
  ]);
  assert.equal(renderExportComment({ ...F, spec: AFTER }, changes, { since: '26 Oct' }), [
    'Updated in Worca since the last export (26 Oct)', '',
    'Added R-po-6 An order with some items shipped can cancel only the items not yet picked up.', '',
    'Business rules: “Packed but not picked up still counts as not shipped.” was “Packed orders count as shipped.”', '',
    'Edge cases: added “A partly shipped order cancels only the items not yet picked up.”', '',
    'From Worca FEAT-7', '',
  ].join('\n'));
  assert.match(renderExportComment({ ...F, spec: AFTER }, changes, { since: '26 Oct', reason: 'Estimating tomorrow.' }),
    /^Updated in Worca since the last export \(26 Oct\)\n\nExported before Ready: Estimating tomorrow\.\n\nAdded R-po-6/);
});

test('D8: assumptions count when they enter or leave confirmed; open questions are ignored; goal, measure, edits and removals', () => {
  const before = { ...SPEC, goal: { text: 'Old goal', measure: '' }, flow: ['a', 'b'],
    criteria: [{ id: 'R-po-1', text: 'old one' }, { id: 'R-po-3', text: 'gone one' }],
    assumptions: [{ id: 'A-2', text: 'Two', status: 'confirmed' }, { id: 'A-4', text: 'Four', status: 'open' }], openQuestions: ['q1'] };
  const after = { ...SPEC, goal: { text: 'New goal', measure: 'fewer calls' }, flow: [],
    criteria: [{ id: 'R-po-1', text: 'new one' }],
    assumptions: [{ id: 'A-2', text: 'Two', status: 'open' }, { id: 'A-4', text: 'Four', status: 'confirmed' }], openQuestions: ['q2', 'q3'] };
  const changes = exportChanges(before, after);
  assert.deepEqual(changeSummary(changes).map((x) => x.line), [
    'Changed R-po-1 new one', 'Removed R-po-3 gone one', 'Goal: 1 line changed', 'Measure: 1 line added', 'Main flow: 2 lines removed',
    'Confirmed A-4 Four', 'A-2 is no longer confirmed',
  ]);
  const md = renderExportComment({ ...F, spec: after }, changes, { since: '26 Oct' });
  for (const line of ['Changed R-po-1: “new one” was “old one”', 'Removed R-po-3 gone one', 'Goal: “New goal” was “Old goal”', 'Measure: added “fewer calls”',
    'Main flow: removed “a”', 'Main flow: removed “b”', 'Confirmed A-4 Four', 'A-2 is no longer confirmed']) assert.ok(md.includes(`\n\n${line}\n\n`), line);
  assert.deepEqual(exportChanges(SPEC, { ...SPEC, openQuestions: [] }), [], 'open questions are not in the ticket');
  assert.equal(exportChanges(null, SPEC).filter((c) => c.kind === 'criterion').length, 5, 'no earlier spec: everything is added');
});

test('ticketHash: canonical (key order never matters), 64 hex, and any value change changes it', () => {
  const a = ticketHash({ mode: 'create', ticket: { b: [1, { d: 3, c: 2 }], a: 'x' } });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, ticketHash({ ticket: { a: 'x', b: [1, { c: 2, d: 3 }] }, mode: 'create' }));
  assert.notEqual(a, ticketHash({ mode: 'create', ticket: { a: 'y', b: [1, { c: 2, d: 3 }] } }));
});

test('A6.1 D7, D11: the ticket built for the ticket a criterion came from leaves that source out; another source stays', () => {
  const f = { id: 'FEAT-8', title: 'Partial cancel', spec: { ...emptySpec(), criteria: [{ id: 'R-po-1', text: 'Cancel unpicked items.', source: 'SHOP-124' },
    { id: 'R-po-2', text: 'Refund the share.', source: 'refund-matrix.pdf' }] } };
  assert.equal(criterionLine(f.spec.criteria[0], 'SHOP-124'), 'R-po-1 Cancel unpicked items.');
  assert.equal(criterionLine(f.spec.criteria[0]), 'R-po-1 Cancel unpicked items. (from SHOP-124)');
  const t = buildTicket(f, { project: 'SHOP', issueType: '10001', exportedOn: '28 Oct 2026', ownKey: 'SHOP-124' });
  assert.match(t.description, /- R-po-1 Cancel unpicked items\.\n- R-po-2 Refund the share\. \(from refund-matrix\.pdf\)\n/);
  const field = buildTicket(f, { project: 'SHOP', issueType: '10001', exportedOn: '28 Oct 2026', ownKey: 'SHOP-124',
    criteria: { target: 'field', field: 'customfield_10070' } });
  assert.deepEqual(field.criteria.items, ['R-po-1 Cancel unpicked items.', 'R-po-2 Refund the share. (from refund-matrix.pdf)']);
});

test('A6.1 D11: the comment after an import says "since the import"', () => {
  assert.equal(renderExportComment({ id: 'FEAT-8' }, [{ kind: 'goal', field: 'text', before: '', after: 'Cancel part' }], { since: '27 Oct', after: 'import' }),
    'Updated in Worca since the import (27 Oct)\n\nGoal: added “Cancel part”\n\nFrom Worca FEAT-8\n');
});
