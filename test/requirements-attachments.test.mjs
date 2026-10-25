// test/requirements-attachments.test.mjs — the pure attachment rules (plans/requirements-a8-design.md D4, D7, D9, §4)
// and their rows in the store. Grows in Tasks 2–9.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { REQ_ATTACH_LIMITS, REQ_ATT_ID_RE, displayName, uniqueName, sizeLabel } from '../src/core/requirements/attachments.mjs';
import {
  mintAttachmentId, insertAttachment, getAttachment, listAttachments, updateAttachment, addAttachmentCost, deleteAttachmentRow,
  deleteOwnerAttachments, listReadingAttachments, recentReadCosts, createFeature, createStart, listStarts, beginBrief,
  saveBriefResult, deleteBrief, getBriefById, recentBriefCosts,
} from '../src/core/requirements/store.mjs';
import { recordRequirementsCostDelta } from '../src/core/cost-budget.mjs';
import { prepare } from '../src/core/db.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

useTempHome(after, 'worca-req-att-');

test("the limits are the design's; the inline budget is Ask's", () => {
  const MB = 1024 * 1024;
  assert.deepEqual(REQ_ATTACH_LIMITS, { files: 10, fileBytes: 25 * MB, requestBytes: 100 * MB, summary: 1500, answer: 600,
    question: 200, asks: 20, history: 10, entry: 3000, inlineBytes: 24 * 1024, name: 200 });
  assert.equal(REQ_ATTACH_LIMITS.inlineBytes, ASK_LIMITS.inlineAttachmentsMaxBytes);
  assert.ok(Object.isFrozen(REQ_ATTACH_LIMITS));
});

test('display names: the last segment of either separator, no control characters, at most 200; never a path', () => {
  assert.equal(displayName('../../etc/passwd'), 'passwd');
  assert.equal(displayName('C:\\Users\\me\\notes.md'), 'notes.md');
  assert.equal(displayName('a\u0000b\u001f\u007f.txt'), 'ab.txt');
  assert.equal(displayName(`${'x'.repeat(300)}.md`).length, 200);
  for (const v of ['', '..', '.', '/', null, 7]) assert.equal(displayName(v), v === 7 ? '7' : 'file', String(v));
  assert.equal(displayName('invoice\u202Efdp.md'), 'invoicefdp.md', 'no bidi control');
  assert.equal(displayName('\ud800.md'), '\ufffd.md', 'a lone surrogate is made well formed');
});

test('unique names within an owner: " (2)", " (3)" before the extension, ignoring case, at most 200', () => {
  assert.equal(uniqueName('a.pdf', []), 'a.pdf');
  assert.equal(uniqueName('a.pdf', ['A.PDF']), 'a (2).pdf');
  assert.equal(uniqueName('a.pdf', ['a.pdf', 'a (2).pdf']), 'a (3).pdf');
  assert.equal(uniqueName('notes', ['notes']), 'notes (2)');
  const long = `${'x'.repeat(196)}.pdf`;
  const u = uniqueName(long, [long]);
  assert.ok(u.length <= 200 && u.endsWith(' (2).pdf'), u);
});

test('sizes read as B, KB and MB', () => {
  assert.equal(sizeLabel(640), '640 B');
  assert.equal(sizeLabel(9 * 1024), '9 KB');
  assert.equal(sizeLabel(Math.round(2.1 * 1024 * 1024)), '2.1 MB');
});

const feature = () => createFeature({ scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', description: 'Before it ships' });
let n = 0;
const row = (over = {}) => ({ id: mintAttachmentId(), ownerType: 'feature', ownerId: 1, name: 'a.md', kind: 'text', mime: 'text/markdown',
  bytes: 5, sha256: `${(n += 1)}`.padStart(64, '0'), ...over });

test('rows: the store mints the id; JSON and booleans round-trip; upload order; reading rows', () => {
  const f = feature();
  const a = insertAttachment(row({ ownerId: f.seq }), { by: 'po' });
  assert.match(a.id, REQ_ATT_ID_RE);
  assert.deepEqual([a.status, a.summary, a.summaryEdited, a.asks, a.history, a.sendWithRun, a.costUsd, a.readCostUsd, a.error, a.createdBy],
    ['reading', '', false, [], [], false, 0, null, null, 'po']);
  const b = insertAttachment(row({ ownerId: f.seq, name: 'b.png', kind: 'image', mime: 'image/png' }));
  assert.deepEqual(listAttachments('feature', f.seq).map((x) => x.name), ['a.md', 'b.png']);
  const u = updateAttachment(a.id, { status: 'done', summary: 'S', summaryEdited: true, asks: [{ question: 'Q', answer: 'A' }],
    history: [{ summary: 'old' }], sendWithRun: true, error: { code: 'X' }, readCostUsd: 0.12, readModel: 'm', readAt: 't' }, { by: 'po' });
  assert.deepEqual([u.status, u.summary, u.summaryEdited, u.asks[0].answer, u.history[0].summary, u.sendWithRun, u.error.code, u.readCostUsd, u.readModel],
    ['done', 'S', true, 'A', 'old', true, 'X', 0.12, 'm']);
  assert.equal(updateAttachment(a.id, { error: null }).error, null);
  addAttachmentCost(a.id, 0.05);
  addAttachmentCost(a.id, -1);
  assert.equal(getAttachment(a.id).costUsd, 0.05);
  assert.throws(() => updateAttachment(a.id, { ownerId: 9 }), /unknown field/);
  assert.throws(() => updateAttachment(a.id, { status: 'lost' }), /unknown status/);
  assert.ok(listReadingAttachments().some((x) => x.id === b.id));
  assert.ok(!listReadingAttachments().some((x) => x.id === a.id));
});

test('an id the store did not mint is refused before anything is written', () => {
  for (const id of ['../x', 'ratt_ABCDEF012345', 'ratt_0123', 'ask_0123456789ab']) {
    assert.throws(() => insertAttachment(row({ id })), /never minted/, id);
  }
});

test('one content per owner (the index); another owner may hold the same bytes', () => {
  const r = row();
  insertAttachment(r);
  assert.throws(() => insertAttachment({ ...r, id: mintAttachmentId() }), /UNIQUE/);
  assert.ok(insertAttachment({ ...r, id: mintAttachmentId(), ownerId: 99 }));
});

test("delete one row; delete an owner's rows, returned for their bodies", () => {
  const a = insertAttachment(row({ ownerId: 50 }));
  const b = insertAttachment(row({ ownerId: 50 }));
  assert.equal(deleteAttachmentRow(a.id), true);
  assert.equal(deleteAttachmentRow(a.id), false);
  assert.deepEqual(deleteOwnerAttachments('feature', 50).map((x) => x.id), [b.id]);
  assert.deepEqual(listAttachments('feature', 50), []);
});

test('recent read costs per kind, newest finished first', () => {
  const ids = [0.1, 0.3, 0.2].map((c, i) => {
    const a = insertAttachment(row({ ownerId: 60, kind: 'binary', mime: 'application/pdf' }));
    updateAttachment(a.id, { status: 'done', readCostUsd: c, readAt: `2026-10-0${i + 1}T00:00:00Z` });
    return a.id;
  });
  assert.equal(ids.length, 3);
  assert.deepEqual(recentReadCosts('binary', 2), [0.2, 0.3]);
  assert.deepEqual(recentReadCosts('image'), []);
});

test('the ledger: a file carries attachment_id under its feature or its brief; the brief estimate reads looks only', () => {
  const b = beginBrief('project', 'shop-led');
  saveBriefResult(b.id, { sections: { product: 'P', users: [], terms: [], areas: [] } });
  recordRequirementsCostDelta({ briefId: b.id, amountUsd: 0.4, model: 'm' });
  recordRequirementsCostDelta({ briefId: b.id, attachmentId: 'ratt_000000000001', amountUsd: 0.1, model: 'm' });
  recordRequirementsCostDelta({ featureSeq: 7, attachmentId: 'ratt_000000000002', amountUsd: 0.2, model: 'm' });
  const rows = prepare('SELECT feature_seq, brief_id, attachment_id FROM req_cost_ledger WHERE attachment_id IS NOT NULL ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [Number(r.feature_seq), r.brief_id == null ? null : Number(r.brief_id), r.attachment_id]),
    [[0, b.id, 'ratt_000000000001'], [7, null, 'ratt_000000000002']]);
  assert.deepEqual(recentBriefCosts(10), [0.4]);
  assert.equal(getBriefById(b.id).scopeKey, 'shop-led');
  assert.equal(getBriefById(999999), null);
});

test('starts record their files; a start without files has []', () => {
  const f = feature();
  createStart({ featureSeq: f.seq, version: 1, runId: `run-${f.seq}-1`, spec: {}, title: 't', ready: true });
  createStart({ featureSeq: f.seq, version: 2, runId: `run-${f.seq}-2`, spec: {}, title: 't', ready: true,
    files: [{ id: 'ratt_000000000003', name: 'a.md', sha256: 'x', from: 'feature' }] });
  assert.deepEqual(listStarts(f.seq).map((s) => s.files), [[{ id: 'ratt_000000000003', name: 'a.md', sha256: 'x', from: 'feature' }], []]);
});

test("deleting a brief deletes its documents' rows with it", () => {
  const b = beginBrief('project', 'shop-del');
  const d = insertAttachment(row({ ownerType: 'brief', ownerId: b.id }));
  assert.equal(deleteBrief('project', 'shop-del'), true);
  assert.equal(getAttachment(d.id), null);
  assert.equal(deleteBrief('project', 'shop-del'), false);
});
