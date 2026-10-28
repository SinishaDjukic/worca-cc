// test/requirements-ticket-import.test.mjs — what Worca takes from a ticket (plans/requirements-a61-design.md D5–D9, D14, §4). Pure:
// no store, no tracker. Server-local dates: the fixtures use midday UTC so the day is the same in every zone the suite runs in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../src/core/requirements/spec.mjs';
import {
  IMPORT_LIMITS, splitCriteria, clipDescription, redactCounted, commentsFileName, descriptionFileName, commentsMarkdown, importReason,
  importThreadLine, processTicket, pickDefaults, CAP_FILES, CAP_BYTES,
} from '../src/core/requirements/ticket-import.mjs';
import { classifyExtension } from '../src/core/ask/attachment-kind.mjs';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const MB = 1024 * 1024;

test('splitCriteria: a heading, a bold line or a line ending in ":" naming the criteria, then its list; the rest stays', () => {
  const md = 'Customers cannot cancel the rest.\n\n## Acceptance criteria\n\n- A customer can cancel unpicked items.\n- Shipped items stay.\n\n## Notes\n\nMore.';
  assert.deepEqual(splitCriteria(md), { description: 'Customers cannot cancel the rest.\n\n## Notes\n\nMore.',
    items: ['A customer can cancel unpicked items.', 'Shipped items stay.'], heading: 'Acceptance criteria' });
  assert.deepEqual(splitCriteria('Intro.\n**Acceptance Criteria**\n1. One\n2) Two\n\nAfter.').items, ['One', 'Two']);
  assert.deepEqual(splitCriteria('Intro.\n\nAC:\n* [ ] One\n* [x] Two').items, ['One', 'Two'], 'checkboxes and "AC:"');
  assert.deepEqual(splitCriteria('Intro.\n\nAcceptance criterion:\nThe refund covers the cancelled items.\nAnd their shipping share.\n\nTail.'),
    { description: 'Intro.\n\nTail.', items: ['The refund covers the cancelled items.', 'And their shipping share.'], heading: 'Acceptance criterion' },
    'without a list: the lines up to the next blank line');
  assert.deepEqual(splitCriteria('Intro.\n\n- a list item\n- not criteria').items, [], 'no heading, no section');
  assert.equal(splitCriteria('Note: these are acceptance criteria\n- x').heading, null, 'a line that only mentions them');
});

test('splitCriteria: two sections, the first wins; at most 30 items of at most 500 characters', () => {
  const md = '## Acceptance criteria\n- First\n\n## AC\n- Second';
  assert.deepEqual(splitCriteria(md), { description: '## AC\n- Second', items: ['First'], heading: 'Acceptance criteria' });
  const long = `## Acceptance criteria\n${Array.from({ length: 40 }, (_, i) => `- Item ${i} ${'y'.repeat(600)}`).join('\n')}`;
  const r = splitCriteria(long);
  assert.equal(r.items.length, LIMITS.items);
  assert.ok(r.items.every((x) => x.length <= LIMITS.item));
});

test('clipDescription: up to the last paragraph break before 20,000 characters', () => {
  const para = `${'a'.repeat(9000)}\n\n`;
  const text = `${para}${para}${'b'.repeat(5000)}`;
  const r = clipDescription(text);
  assert.equal(r.clipped, true);
  assert.equal(r.text, `${'a'.repeat(9000)}\n\n${'a'.repeat(9000)}`);
  assert.deepEqual(clipDescription('short'), { text: 'short', clipped: false });
  assert.equal(clipDescription('c'.repeat(25000)).text.length, LIMITS.description, 'no break at all: cut at the limit');
});

test('redactCounted: a GitHub token and a PEM block are hidden and counted', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
  const r = redactCounted(`token ${TOKEN} and\n${pem}`);
  assert.equal(r.hidden, 2);
  assert.ok(!r.text.includes(TOKEN) && !r.text.includes('MIIabc'));
  assert.deepEqual(redactCounted('nothing here'), { text: 'nothing here', hidden: 0 });
  assert.equal(redactCounted('already ghp_<redacted>').hidden, 0, 'a marker that was there is not counted');
});

test('commentsMarkdown: one file in the ticket order, author and date, the body as Markdown; the file names', () => {
  const md = commentsMarkdown('SHOP-124', [
    { author: 'Ann Example', created: '2026-10-21T12:00:00.000Z', body: 'Warehouse confirms items are picked per parcel.' },
    { author: 'Bo Example', created: '2026-10-22T12:00:00.000Z', body: 'Partial refunds work on cards.\n\n- PayPal too' },
  ]);
  assert.equal(md, '# Comments on SHOP-124\n\n**Ann Example** · 21 Oct 2026\nWarehouse confirms items are picked per parcel.\n\n'
    + '**Bo Example** · 22 Oct 2026\nPartial refunds work on cards.\n\n- PayPal too\n');
  assert.equal(commentsFileName('SHOP-124'), 'SHOP-124 comments.md');
  assert.equal(descriptionFileName('SHOP-124'), 'SHOP-124 description.md');
});

test("importReason (D9): Office, any other type and size, said for a file not added yet; a file A8 takes has none", () => {
  const r = (name, bytes = 10) => importReason(name, classifyExtension(name.slice(name.lastIndexOf('.'))), bytes);
  assert.equal(r('refund-matrix.xlsx'), 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.');
  assert.equal(r('clip.mov'), 'Not offered: Worca reads text, images and PDF.');
  assert.equal(r('scan.pdf', 31 * MB), 'Not offered: it is over 25 MB.');
  assert.equal(r('slip.png', 860160), null);
});

test('importThreadLine (D14): criteria and comments; no criteria; no comments file', () => {
  assert.equal(importThreadLine({ tracker: 'Jira', key: 'SHOP-124', criteria: ['R-po-1', 'R-po-2', 'R-po-3'], comments: 5 }),
    'The product owner started this feature from Jira ticket SHOP-124. Its acceptance criteria are R-po-1 to R-po-3; its comments are in “SHOP-124 comments.md”.');
  assert.equal(importThreadLine({ tracker: 'Jira', key: 'SHOP-131', criteria: [], comments: 2 }),
    'The product owner started this feature from Jira ticket SHOP-131. It had no acceptance criteria; its comments are in “SHOP-131 comments.md”.');
  assert.equal(importThreadLine({ tracker: 'Jira', key: 'SHOP-9', criteria: ['R-po-1'], comments: 0 }),
    'The product owner started this feature from Jira ticket SHOP-9. Its acceptance criterion is R-po-1.');
});

const RAW = () => ({
  key: 'SHOP-124', url: 'https://acme.test/browse/SHOP-124', title: '  Partial cancel\nfor multi-item orders ',
  description: `When an order has several items, customers cannot cancel the rest.\n\n(image: packing-slip.png)\n\n## Acceptance criteria\n\n- Unpicked items can be cancelled.\n- Shipped items stay.\n- The refund covers only the cancelled items, ${TOKEN}.`,
  criteria: null,
  comments: [
    { id: '1', author: 'Ann Example', authorKind: 'person', created: '2026-10-21T12:00:00.000Z', body: 'Picked per parcel.' },
    { id: '2', author: 'Jira Automation', authorKind: 'app', created: '2026-10-23T12:00:00.000Z', body: 'Status changed to In progress.' },
    { id: '3', author: 'Bo Example', authorKind: 'person', created: '2026-10-25T12:00:00.000Z', body: `Sandbox token ${TOKEN}` },
  ],
  commentsTotal: 7, restrictedComments: 1,
  attachments: [
    { id: '10041', name: 'packing-slip.png', mime: 'image/png', bytes: 860160 },
    { id: '10044', name: 'refund-matrix.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: 98304 },
    { id: '10045', name: 'dir/pick-route-scan.pdf', mime: 'application/pdf', bytes: 31 * MB },
  ],
  meta: { project: 'SHOP', projectName: 'Shop web', type: { id: '10001', name: 'Story' }, status: 'In progress', priority: { id: '3', name: 'Medium' } },
  fingerprint: 'fp-1',
});

test('processTicket: title on one line; the criteria section out of the description; redaction counted; comments and attachments as offered', () => {
  const p = processTicket(RAW(), { tracker: 'Jira' });
  assert.equal(p.title, 'Partial cancel for multi-item orders');
  assert.equal(p.description, 'When an order has several items, customers cannot cancel the rest.\n\n(image: packing-slip.png)');
  assert.deepEqual(p.criteria, { from: 'section', name: 'Acceptance criteria', field: null,
    items: ['Unpicked items can be cancelled.', 'Shipped items stay.', 'The refund covers only the cancelled items, ghp_<redacted>.'] });
  assert.equal(p.redacted, 2, 'one in a criterion, one in a comment');
  assert.deepEqual(p.comments.map((c) => [c.id, c.author, c.authorKind, c.when]),
    [['1', 'Ann Example', 'person', '21 Oct'], ['2', 'Jira Automation', 'app', '23 Oct'], ['3', 'Bo Example', 'person', '25 Oct']]);
  assert.equal(p.comments[2].body, 'Sandbox token ghp_<redacted>');
  assert.deepEqual([p.commentsTotal, p.restrictedComments, p.olderComments], [7, 1, 3]);
  assert.deepEqual(p.attachments.map((a) => [a.name, a.kind, a.refused]), [
    ['packing-slip.png', 'image', null],
    ['refund-matrix.xlsx', null, 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.'],
    ['pick-route-scan.pdf', 'binary', 'Not offered: it is over 25 MB.']]);
  assert.deepEqual([p.descriptionFile, p.clipped, p.fingerprint, p.meta.type.name], [null, false, 'fp-1', 'Story']);
});

test('processTicket: criteria from a field leave the description whole; a long description goes along as a file; comments clipped and capped', () => {
  const raw = { ...RAW(), criteria: { field: { id: 'customfield_10070', name: 'Acceptance Criteria' }, items: ['From the field.'] },
    description: `${'p'.repeat(15000)}\n\n${'q'.repeat(9000)}`,
    comments: Array.from({ length: 60 }, (_, i) => ({ id: String(i), author: 'Cy Example', authorKind: 'person', created: '2026-10-20T12:00:00.000Z',
      body: 'z'.repeat(5000) })) };
  const p = processTicket(raw, { tracker: 'Jira' });
  assert.deepEqual([p.criteria.from, p.criteria.name, p.criteria.field.id, p.criteria.items], ['field', 'Acceptance Criteria', 'customfield_10070', ['From the field.']]);
  assert.equal(p.clipped, true);
  assert.equal(p.description, 'p'.repeat(15000));
  assert.deepEqual([p.descriptionFile.name, p.descriptionFile.text.length], ['SHOP-124 description.md', 24002]);
  assert.equal(p.comments.length, IMPORT_LIMITS.comments, 'the newest 50');
  assert.equal(p.comments[0].id, '10', 'oldest first, the ten oldest left out');
  assert.ok(p.comments.every((c) => c.body.length === IMPORT_LIMITS.commentChars));
});

test('pickDefaults (D5, D9): every criterion, every comment by a person; attachments in order within 10 files and 100 MB, counting the form', () => {
  const p = pickDefaults(processTicket(RAW(), { tracker: 'Jira' }), { count: 0, bytes: 0 });
  assert.deepEqual(p.criteria.picked, [true, true, true]);
  assert.deepEqual(p.comments.map((c) => c.picked), [true, false, true]);
  assert.deepEqual(p.attachments.map((a) => [a.picked, a.capped]), [[true, null], [false, null], [false, null]], 'refused ones are never ticked');
  const full = pickDefaults(processTicket(RAW(), { tracker: 'Jira' }), { count: 9, bytes: 0 });
  assert.deepEqual([full.attachments[0].picked, full.attachments[0].capped], [false, 'files'], 'the comments file and nine on the form: no room');
  const heavy = pickDefaults(processTicket(RAW(), { tracker: 'Jira' }), { count: 1, bytes: 99.5 * MB });
  assert.deepEqual([heavy.attachments[0].picked, heavy.attachments[0].capped], [false, 'bytes']);
  assert.equal(CAP_FILES, 'A feature takes up to 10 files; 10 are picked.');
  assert.equal(CAP_BYTES, "Picked files are at 100 MB, a new feature's limit. Add more on the feature page.");
});
