// Attachment typing for Ask Worca binary attachments (#398): the extension
// allowlists, extension -> {kind, mime} classification, magic-number sniffing
// and the on-disk extension a stored body gets. Pure module, no home needed.
// Every fixture byte is spelled as an escape or a byte array: raw control/non-
// UTF-8 bytes inside a string literal make git treat the file as binary (an
// unreviewable diff) and are mangled by the ESM loader's UTF-8 decode anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXT_EXTENSIONS, BINARY_EXTENSIONS, classifyExtension, sniffMime, extensionForAttachment,
} from '../src/core/ask/attachment-kind.mjs';
import { checkRows } from './helpers/rows.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = Buffer.from('GIF89a\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
// `%PDF-1.7` then the conventional binary-marker comment line (four bytes > 0x7f)
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from('\n')]);

test('the two allowlists carry the spec extensions and stay disjoint', () => {
  assert.deepEqual([...TEXT_EXTENSIONS], ['.md', '.markdown', '.txt', '.json', '.csv', '.log', '.html', '.htm']);
  assert.deepEqual([...BINARY_EXTENSIONS], ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);
  for (const e of TEXT_EXTENSIONS) assert.ok(!BINARY_EXTENSIONS.includes(e), `${e} in one list only`);
});

test('classifyExtension: text kinds (HTML as text), image kinds, pdf as binary, case-insensitive, unknown → null', async () => {
  await checkRows([
    { name: 'classifyExtension: text kinds, image kinds, pdf as binary, case-insensitive, unknown -> null', run: () => {
      assert.deepEqual(classifyExtension('.md'), { kind: 'text', mime: 'text/markdown' });
      assert.deepEqual(classifyExtension('.json'), { kind: 'text', mime: 'application/json' });
      assert.deepEqual(classifyExtension('.png'), { kind: 'image', mime: 'image/png' });
      assert.deepEqual(classifyExtension('.jpg'), { kind: 'image', mime: 'image/jpeg' });
      assert.deepEqual(classifyExtension('.jpeg'), { kind: 'image', mime: 'image/jpeg' });
      assert.deepEqual(classifyExtension('.webp'), { kind: 'image', mime: 'image/webp' });
      assert.deepEqual(classifyExtension('.PDF'), { kind: 'binary', mime: 'application/pdf' });
      assert.equal(classifyExtension('.svg'), null, 'scriptable markup is deliberately not allowed');
      assert.equal(classifyExtension('.exe'), null);
      assert.equal(classifyExtension(''), null);
      assert.equal(classifyExtension(undefined), null);
    } },
    { name: 'classifyExtension: HTML is a TEXT kind (stored as .txt, served as text/plain), case-insensitive', run: () => {
      assert.deepEqual(classifyExtension('.html'), { kind: 'text', mime: 'text/html' });
      assert.deepEqual(classifyExtension('.htm'), { kind: 'text', mime: 'text/html' });
      assert.deepEqual(classifyExtension('.HTML'), { kind: 'text', mime: 'text/html' });
      assert.equal(extensionForAttachment('text', 'text/html'), '.txt', 'the body lands as <id>.txt like every text kind');
      assert.equal(classifyExtension('.xhtml'), null, 'only .html and .htm');
    } },
  ]);
});

test('sniffMime: recognises each accepted magic number and nothing else', () => {
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal(sniffMime(JPEG), 'image/jpeg');
  assert.equal(sniffMime(GIF), 'image/gif');
  assert.equal(sniffMime(WEBP), 'image/webp');
  assert.equal(sniffMime(PDF), 'application/pdf');
  assert.equal(sniffMime(Buffer.from('just some text pretending to be a png')), null);
  assert.equal(sniffMime(Buffer.from('RIFFxxxxWAVE')), null, 'a RIFF that is not WEBP');
  assert.equal(sniffMime(Buffer.from([0x89, 0x50])), null, 'too short to claim png');
  assert.equal(sniffMime(Buffer.alloc(0)), null);
  assert.equal(sniffMime('not a buffer'), null);
});

test('sniffMime edge cases: a JPEG needs SOI plus a real marker; a PDF header may follow a BOM or ≤1024 bytes of preamble', async () => {
  await checkRows([
    { name: 'sniffMime: a JPEG needs SOI plus a real first marker, not a bare FF D8 FF stub', run: () => {
      assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff])), null, '3-byte stub');
      assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])), null, 'FF00 is a stuffed byte, not a marker');
      assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0x43])), 'image/jpeg', 'DQT-first (no APPn) JPEG');
      assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0])), 'image/jpeg', 'EXIF JPEG');
    } },
    { name: 'sniffMime: the PDF header may follow a BOM or up to 1024 bytes of preamble (ISO 32000-1 7.5.2)', run: () => {
      const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), PDF]);
      assert.equal(sniffMime(bom), 'application/pdf', 'UTF-8 BOM before the header');
      const junk = Buffer.concat([Buffer.alloc(1024, 0x20), PDF]);
      assert.equal(sniffMime(junk), 'application/pdf', 'exactly 1024 bytes of preamble is still a PDF');
      const tooFar = Buffer.concat([Buffer.alloc(1025, 0x20), PDF]);
      assert.equal(sniffMime(tooFar), null, 'past the window it is not a PDF');
      assert.equal(sniffMime(Buffer.from('%PDF')), null, 'the version dash is part of the header');
    } },
  ]);
});

test('extensionForAttachment: text -> .txt, sniffed mime -> its extension, unknown binary -> .bin', () => {
  assert.equal(extensionForAttachment('text', 'text/markdown'), '.txt');
  assert.equal(extensionForAttachment(undefined, null), '.txt', 'pre-v27 rows have no kind');
  assert.equal(extensionForAttachment('image', 'image/png'), '.png');
  assert.equal(extensionForAttachment('image', 'image/jpeg'), '.jpg', 'first table match wins');
  assert.equal(extensionForAttachment('image', 'image/gif'), '.gif');
  assert.equal(extensionForAttachment('image', 'image/webp'), '.webp');
  assert.equal(extensionForAttachment('binary', 'application/pdf'), '.pdf');
  assert.equal(extensionForAttachment('binary', 'application/x-unknown'), '.bin');
});

test('extensionForAttachment: show_files snapshot mimes get their own extension; uploads still refuse them', () => {
  assert.equal(extensionForAttachment('image', 'image/svg+xml'), '.svg');
  assert.equal(extensionForAttachment('binary', 'video/mp4'), '.mp4');
  assert.equal(extensionForAttachment('binary', 'application/x-thing'), '.bin');
  assert.equal(classifyExtension('.svg'), null, 'the upload allow-list is unchanged');
  assert.equal(classifyExtension('.mp4'), null);
});
