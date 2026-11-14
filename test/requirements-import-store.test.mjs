// test/requirements-import-store.test.mjs — A6.1's storage (plans/requirements-a61-design.md §3, D7, D10–D13): a feature created
// with criteria, the link's origin, the feature already linked to a ticket, a file row still to be downloaded.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { LIMITS } from '../src/core/requirements/spec.mjs';
import {
  createFeature, updateFeature, saveExportLink, getExportLink, linkByTicket, insertAttachment, getAttachment, updateAttachment,
  listDownloadingAttachments, mintAttachmentId,
} from '../src/core/requirements/store.mjs';

useTempHome(after, 'worca-req-import-store-');
const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const link = (seq, key, over = {}) => saveExportLink(seq, { ...CONN, trackerProject: 'SHOP', key, url: `https://acme.test/browse/${key}`,
  createdAt: '2026-10-27T09:12:00.000Z', exportedAt: '2026-10-27T09:12:00.000Z', ...over });

test('createFeature with criteria (D7): R-po-1… in order, edited, with their source; empties and repeats left out; criteria_seq is their count', () => {
  const f = createFeature({ ...SCOPE, title: 'Partial cancel', description: 'Some items only', criteria: [
    { text: ' A customer can cancel the items not picked up. ', source: 'SHOP-124' }, { text: '   ', source: 'SHOP-124' },
    { text: 'Shipped items stay on the order.', source: 'SHOP-124' }, { text: 'shipped items stay on the order.', source: 'SHOP-124' }] });
  assert.deepEqual(f.spec.criteria, [
    { id: 'R-po-1', text: 'A customer can cancel the items not picked up.', edited: true, source: 'SHOP-124' },
    { id: 'R-po-2', text: 'Shipped items stay on the order.', edited: true, source: 'SHOP-124' }]);
  assert.equal(f.criteriaSeq, 2);
  const plain = createFeature({ ...SCOPE, title: 'Plain', description: 'No ticket' });
  assert.deepEqual([plain.spec.criteria, plain.criteriaSeq], [[], 0]);
});

test('createFeature: at most 30 criteria, each at most 500 characters', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ text: `Criterion ${i + 1} ${'x'.repeat(600)}`, source: 'SHOP-9' }));
  const f = createFeature({ ...SCOPE, title: 'Many', description: 'Lots', criteria: many });
  assert.equal(f.spec.criteria.length, LIMITS.items);
  assert.ok(f.spec.criteria.every((c) => c.text.length <= LIMITS.item));
  assert.equal(f.criteriaSeq, LIMITS.items);
});

test("a link's origin (D11, D13): 'export' unless the save says 'import'; a save that passes the link on keeps it", () => {
  const f = createFeature({ ...SCOPE, title: 'Imported', description: 'From a ticket' });
  assert.equal(link(f.seq, 'SHOP-124', { origin: 'import' }).origin, 'import');
  const cur = getExportLink(f.seq);
  assert.equal(saveExportLink(f.seq, { ...cur, exportedAt: '2026-10-28T10:00:00.000Z' }).origin, 'import', 'runExport passes { ...link }');
  assert.equal(link(f.seq, 'SHOP-200').origin, 'export', 'a new ticket is an ordinary export link');
  const g = createFeature({ ...SCOPE, title: 'Exported', description: 'Plain' });
  assert.equal(link(g.seq, 'SHOP-300').origin, 'export');
  assert.equal(link(g.seq, 'SHOP-300', { origin: 'nonsense' }).origin, 'export');
});

test('linkByTicket (D12): the feature linked to that ticket on that connection, archived ones too; another profile or key is no match', () => {
  const f = createFeature({ ...SCOPE, title: 'Cancel an order before it ships', description: 'x' });
  link(f.seq, 'SHOP-123');
  updateFeature(f.seq, { status: 'archived' });
  const want = { seq: f.seq, id: f.id, title: 'Cancel an order before it ships' };
  assert.deepEqual(linkByTicket({ ...CONN, key: 'SHOP-123' }), want);
  assert.deepEqual(linkByTicket({ ...CONN, key: 'shop-123' }), want, 'keys compare without case');
  assert.equal(linkByTicket({ ...CONN, profile: 'beta', key: 'SHOP-123' }), null);
  assert.equal(linkByTicket({ ...CONN, key: 'SHOP-999' }), null);
  const g = createFeature({ ...SCOPE, title: 'Single profile', description: 'x' });
  saveExportLink(g.seq, { plugin: 'mock-source', sourceId: 'main', profile: null, trackerProject: 'M', key: 'M-1' });
  assert.equal(linkByTicket({ plugin: 'mock-source', sourceId: 'main', key: 'M-1' }).seq, g.seq, 'no profile matches no profile');
});

test('a file still to be downloaded (D10, D13): status downloading, where from in fetch, a pending hash; an uploaded file has none', () => {
  const f = createFeature({ ...SCOPE, title: 'Files', description: 'x' });
  const id = mintAttachmentId();
  const fetch = { ...CONN, tracker: 'Jira', key: 'SHOP-124', id: '10041', name: 'packing-slip.png', bytes: 860160 };
  const row = insertAttachment({ id, ownerType: 'feature', ownerId: f.seq, name: 'packing-slip.png', kind: 'image', mime: 'image/png', bytes: 860160,
    sha256: `pending:${id}`, status: 'downloading', fetch });
  assert.deepEqual([row.status, row.sha256, row.fetch], ['downloading', `pending:${id}`, fetch]);
  const id2 = mintAttachmentId();
  insertAttachment({ id: id2, ownerType: 'feature', ownerId: f.seq, name: 'flow.pdf', kind: 'binary', mime: 'application/pdf', bytes: 10,
    sha256: `pending:${id2}`, status: 'downloading', fetch: { ...fetch, id: '10042', name: 'flow.pdf' } });
  assert.deepEqual(listDownloadingAttachments().map((r) => r.id), [id, id2]);
  assert.equal(updateAttachment(id, { status: 'reading', sha256: 'a'.repeat(64) }).status, 'reading');
  assert.deepEqual(listDownloadingAttachments().map((r) => r.id), [id2]);
  assert.deepEqual(getAttachment(id).fetch, fetch, 'the row keeps where it came from');
  const up = mintAttachmentId();
  assert.equal(insertAttachment({ id: up, ownerType: 'feature', ownerId: f.seq, name: 'notes.md', kind: 'text', mime: 'text/markdown', bytes: 3,
    sha256: 'b'.repeat(64) }).fetch, null);
  assert.throws(() => insertAttachment({ id: mintAttachmentId(), ownerType: 'feature', ownerId: f.seq, name: 'x.md', kind: 'text', mime: 'text/plain',
    bytes: 1, sha256: 'c', status: 'fetching' }), /unknown status/);
});
