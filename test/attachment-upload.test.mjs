// test/attachment-upload.test.mjs — the shared upload validation (plans/requirements-a8-design.md D7, D10): Ask's rules and
// messages by default (its route tests stay green), the Requirements page's limits and messages through reqUploadOptions.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { validateAttachmentUploads } from '../src/core/attachment-upload.mjs';
import { reqUploadOptions, officeRefusal } from '../src/core/requirements/attachments.mjs';

const b64 = (x) => Buffer.from(x).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\nhello\n');
const ASK = { maxFiles: 8, maxBytesPerFile: 1000, maxBytesPerBinaryFile: 1000, maxBytesTotal: 1500 };
const up = (name, data) => ({ name, dataBase64: b64(data) });
const no = (list, o = ASK) => { const r = validateAttachmentUploads(list, o); assert.equal(r.ok, false, JSON.stringify(r)); return [r.status, r.error]; };

test("every allowed type passes with Ask's kinds, the body and a sha256 of the uploaded bytes", () => {
  const r = validateAttachmentUploads([up('a.md', '# hi'), up('b.csv', 'x,y'), up('c.png', PNG), up('d.pdf', PDF), up('e.HTML', '<p>')], ASK);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => [f.name, f.kind, f.mime, f.bytes]), [['a.md', 'text', 'text/markdown', 4], ['b.csv', 'text', 'text/csv', 3],
    ['c.png', 'image', 'image/png', 12], ['d.pdf', 'binary', 'application/pdf', PDF.length], ['e.HTML', 'text', 'text/html', 3]]);
  assert.equal(r.files[0].text, '# hi');
  assert.ok(r.files.every((f) => Buffer.isBuffer(f.data)));
  assert.equal(r.files[2].sha256, createHash('sha256').update(PNG).digest('hex'));
});

test("Ask's refusals and messages, byte for byte", () => {
  assert.deepEqual(no('x'), [400, 'attachments must be an array']);
  assert.deepEqual(no(Array.from({ length: 9 }, (_, i) => up(`${i}.md`, 'x'))), [400, 'at most 8 attachments per message']);
  assert.deepEqual(no([up('a.exe', 'x')]), [400, 'attachment type not allowed: a.exe']);
  assert.deepEqual(no([{ dataBase64: b64('x') }]), [400, 'attachment type not allowed: (unnamed)']);
  assert.deepEqual(no([{ name: 'a.md', dataBase64: '' }]), [400, 'attachment is empty or not valid base64: a.md']);
  assert.deepEqual(no([up('a.md', 'x'.repeat(1001))]), [413, 'attachment over 1000 bytes: a.md']);
  assert.deepEqual(no([up('a.png', PDF)]), [400, 'attachment content does not match its extension: a.png']);
  assert.deepEqual(no([up('a.md', Buffer.from([0xff, 0xfe, 0x41]))]), [400, 'attachment is not valid UTF-8: a.md']);
  assert.deepEqual(no([up('a.md', 'a\u0000b')]), [400, 'attachment contains NUL bytes: a.md']);
  assert.deepEqual(no([up('a.md', 'x'.repeat(800)), up('b.md', 'y'.repeat(800))]), [413, 'attachments over 1500 bytes per message']);
  const codex = { ...ASK, refuse: (cls, name) => (cls.mime === 'application/pdf' ? `PDFs need a Claude chat: ${name}` : null) };
  assert.deepEqual(no([up('a.pdf', PDF)], codex), [400, 'PDFs need a Claude chat: a.pdf']);
});

test("a file's own refusal comes before the total, in Ask's order", () => {
  assert.deepEqual(no([up('a.md', 'x'.repeat(800)), up('b.md', 'y'.repeat(800)), up('c.exe', 'z')]), [400, 'attachment type not allowed: c.exe']);
});

test('the Requirements page: types, Office, 25 MB, 10 files and the New feature total (D7)', () => {
  const MB = 1024 * 1024;
  const feat = reqUploadOptions({ owner: 'feature' });
  assert.deepEqual([feat.maxFiles, feat.maxBytesPerFile, feat.maxBytesPerBinaryFile, feat.maxBytesTotal], [10, 25 * MB, 25 * MB, 100 * MB]);
  for (const ext of ['.docx', '.xlsx', '.pptx']) {
    assert.deepEqual(no([up(`plan${ext}`, 'x')], feat), [400, `plan${ext} was not added: Worca reads text, images and PDF. Save it as PDF to attach it here.`]);
  }
  assert.deepEqual(no([up('a.zip', 'x')], feat), [400, 'a.zip was not added: Worca reads text, images and PDF.']);
  assert.deepEqual(no([{ name: 'call.pdf', dataBase64: Buffer.concat([PDF, Buffer.alloc(25 * MB)]).toString('base64') }], feat),
    [413, 'call.pdf was not added: it is over 25 MB.']);
  const eleven = Array.from({ length: 11 }, (_, i) => up(`n${i}.md`, 'x'));
  assert.deepEqual(no(eleven, feat), [400, 'n10.md was not added: a feature takes up to 10 files.']);
  assert.deepEqual(no(eleven, reqUploadOptions({ owner: 'brief' })), [400, 'n10.md was not added: a brief takes up to 10 documents.']);
  assert.deepEqual(no(null, feat), [400, 'attachments must be a list of files']);
  const create = { ...reqUploadOptions({ owner: 'feature', create: true }), maxBytesTotal: 10 };   // the cap's wording, on a small cap
  assert.deepEqual(no([up('a.md', 'x'.repeat(6)), up('b.md', 'y'.repeat(6))], create),
    [413, "b.md was not added: a new feature's files can be up to 100 MB in all; add more on the feature page."]);
  const page = { ...feat, maxBytesTotal: 10 };
  assert.deepEqual(no([up('a.md', 'x'.repeat(6)), up('b.md', 'y'.repeat(6))], page), [413, 'b.md was not added: add up to 100 MB at a time.']);
  assert.equal(officeRefusal('../x/plan.docx', '.docx'), 'plan.docx was not added: Worca reads text, images and PDF. Save it as PDF to attach it here.');
});
// Counts createHash calls made by the module under test: the CommonJS crypto is patched and the builtin's ESM named
// exports re-synced, so the module's live `createHash` binding goes through the spy.
function hashCalls(fn) {
  const crypto = createRequire(import.meta.url)('node:crypto');
  const spy = mock.method(crypto, 'createHash');
  syncBuiltinESMExports();
  try { fn(); return spy.mock.callCount(); } finally { spy.mock.restore(); syncBuiltinESMExports(); }
}

test('hash: false (Ask) makes no hash at all; the default hashes each accepted file once', () => {
  const list = [up('a.md', '# hi'), up('c.png', PNG), up('d.pdf', PDF)];
  let r;
  assert.equal(hashCalls(() => { r = validateAttachmentUploads(list, { ...ASK, hash: false }); }), 0);
  assert.equal(r.ok, true);
  assert.ok(r.files.every((f) => !('sha256' in f)), 'no sha256 field');
  assert.equal(hashCalls(() => { r = validateAttachmentUploads(list, ASK); }), 3);
  assert.ok(r.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
});

test('a refused file is never hashed: the hash comes after every check', () => {
  for (const bad of [up('a.png', PDF), up('a.md', Buffer.from([0xff, 0xfe, 0x41])), up('a.md', 'a\u0000b'), up('a.md', 'x'.repeat(1001)),
    { name: 'a.md', dataBase64: '' }, up('a.exe', 'x')]) {
    let r;
    assert.equal(hashCalls(() => { r = validateAttachmentUploads([bad], ASK); }), 0, bad.name);
    assert.equal(r.ok, false);
  }
  // the first file passed its checks (hashed), the second is refused (not hashed)
  assert.equal(hashCalls(() => validateAttachmentUploads([up('a.md', 'ok'), up('b.png', PDF)], ASK)), 1);
});

test('the Requirements messages for an upload without a usable name read "A file was not added"', () => {
  const feat = reqUploadOptions({ owner: 'feature' });
  const tooMany = [...Array.from({ length: 10 }, (_, i) => up(`n${i}.md`, 'x')), 'not an object'];
  assert.deepEqual(no(tooMany, feat), [400, 'A file was not added: a feature takes up to 10 files.']);
  assert.deepEqual(no([...tooMany.slice(0, 10), null], reqUploadOptions({ owner: 'brief' })), [400, 'A file was not added: a brief takes up to 10 documents.']);
  assert.deepEqual(no([{ dataBase64: b64('x') }], feat), [400, 'A file was not added: Worca reads text, images and PDF.']);
  assert.equal(officeRefusal('', ''), 'A file was not added: Worca reads text, images and PDF.');
});
