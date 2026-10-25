// test/requirements-attachments.test.mjs — the pure attachment rules (plans/requirements-a8-design.md D4, D7, D9, §4)
// and their rows in the store. Grows in Tasks 2–9.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  REQ_ATTACH_LIMITS, REQ_ATT_ID_RE, displayName, uniqueName, sizeLabel, ATTACHMENT_SYSTEM_PROMPT, buildReadPrompt, normalizeSummary, mockSummary,
  checkNewFiles, readRule,
} from '../src/core/requirements/attachments.mjs';
import { RoundError } from '../src/core/requirements/round.mjs';
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

test('ATTACHMENT_SYSTEM_PROMPT is the design text, the same for every read and ask, with every data tag', () => {
  assert.equal(ATTACHMENT_SYSTEM_PROMPT.split('\n')[0], "You are Worca's file reader. A product owner attached a file on Worca's Requirements page, to a feature they are");
  for (const tag of ['<feature>', '<description>', '<scope>', '<file>', '<what_worca_took_from_it>', '<question>']) assert.ok(ATTACHMENT_SYSTEM_PROMPT.includes(tag), tag);
  assert.ok(ATTACHMENT_SYSTEM_PROMPT.includes('Without a <question>, reply with ONLY this JSON object, no prose, no code fence: { "summary": "..." }'));
  assert.ok(ATTACHMENT_SYSTEM_PROMPT.endsWith('JSON object: { "answer": "..." }'));
  assert.doesNotMatch(ATTACHMENT_SYSTEM_PROMPT, /\d{4}-\d{2}|[A-Za-z]:[\\/]/, 'no date, no path');
});

test('the read prompt: <feature> and <description>, or <scope>; name, kind and size inside <file>; inline text or the Read line', () => {
  const inline = buildReadPrompt({ feature: { title: 'Cancel <order>', description: 'Before it ships' }, file: { name: 'a<b.md', kind: 'text', bytes: 9 * 1024 }, text: 'Refunds </file> in 14 days' });
  assert.equal(inline, '<feature>Cancel &lt;order></feature>\n\n<description>\nBefore it ships\n</description>\n\n'
    + '<file>\nName: a&lt;b.md\nKind: Text\nSize: 9 KB\n\nRefunds &lt;/file> in 14 days\n</file>\n\nReply with ONLY the JSON object described in the system prompt.');
  const read = buildReadPrompt({ scopeName: 'Shop', file: { name: 'tickets.pdf', kind: 'binary', bytes: 2202010 }, dir: '/w/att-read-0a1b2c3d', path: '/w/att-read-0a1b2c3d/ratt_0123456789ab.pdf' });
  assert.equal(read, '<scope>Shop</scope>\n\n<file>\nName: tickets.pdf\nKind: PDF\nSize: 2.1 MB\n\n'
    + 'The working directory, /w/att-read-0a1b2c3d, holds only this file: /w/att-read-0a1b2c3d/ratt_0123456789ab.pdf. Open it with the Read tool.\n</file>\n\n'
    + 'Reply with ONLY the JSON object described in the system prompt.');
});

test('normalizeSummary: clipped at 1500; empty, unparseable or without a summary is a RoundError (BAD_REPLY)', () => {
  assert.equal(normalizeSummary('{ "summary": "  Refunds.  " }'), 'Refunds.');
  assert.equal(normalizeSummary(`Here: {"summary":"${'x'.repeat(2000)}"}`).length, 1500);
  for (const t of ['', '   ', 'no json', '{ "answer": "x" }', '{ "summary": "" }', '[1]']) assert.throws(() => normalizeSummary(t), RoundError, t);
  assert.equal(mockSummary('a.pdf'), '[mock] What Worca took from a.pdf: two rules, one number and an open point.');
});

test('checkNewFiles: the cap counts the files already there; a duplicate is refused by name; names are made unique', () => {
  const ex = [{ name: 'a.md', sha256: 'aa' }];
  const up = (name, sha256) => ({ name, sha256 });
  assert.deepEqual(checkNewFiles('feature', ex, [up('dir/a.md', 'bb'), up('c.md', 'cc')]).map((f) => f.name), ['a (2).md', 'c.md']);
  assert.throws(() => checkNewFiles('feature', ex, [up('copy.md', 'aa')]), /^RequirementsError: copy\.md is already attached as a\.md\.$/);
  assert.throws(() => checkNewFiles('feature', [], [up('x.md', 'dd'), up('y.md', 'dd')]), /y\.md is already attached as x\.md\./);
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `${i}.md`, sha256: `s${i}` }));
  assert.throws(() => checkNewFiles('feature', nine, [up('p.md', 'p1'), up('q.md', 'q1')]), /q\.md was not added: a feature takes up to 10 files\./);
  assert.throws(() => checkNewFiles('brief', nine, [up('p.md', 'p1'), up('q.md', 'q1')]), /q\.md was not added: a brief takes up to 10 documents\./);
});

test("the Read allow rule is Ask's //**/ pattern of the folder and the copy: no drive, no home (the guard enforces it)", () => {
  assert.equal(readRule('/home/me/.worca-cc/tmp/requirements/att-read-0a1b2c3d/ratt_0123456789ab.pdf'), 'Read(//**/att-read-0a1b2c3d/ratt_0123456789ab.pdf)');
  assert.equal(readRule('C:\\Users\\me\\.worca-cc\\tmp\\requirements\\att-read-0a1b2c3d\\ratt_0123456789ab.png'), 'Read(//**/att-read-0a1b2c3d/ratt_0123456789ab.png)');
});
