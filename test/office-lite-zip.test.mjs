// test/office-lite-zip.test.mjs — the simplified Office preview's capped reading (ui/public/artifacts/office-zip.mjs) and its
// XML helpers (office-xml.mjs): every cap is checked from the central directory before anything inflates (I1), and every
// entry is counted while it inflates, against its declared size and the remaining budget (I2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { fetchCapped, scanZip, openCappedZip, OfficeLiteError } from '../ui/public/artifacts/office-zip.mjs';
import {
  assertNoDtd, parseXml, kids, kid, descendants, attr, relsOf, resolvePart, odfText, sniffImageType,
} from '../ui/public/artifacts/office-xml.mjs';
import { OFFICE_LITE_LIMITS } from '../src/shared/artifact-kinds.mjs';
import { fixture, manyEntries, patchZip, respond } from './helpers/office-lite-fixtures.mjs';

const JSZip = createRequire(import.meta.url)('jszip');
const { DOMParser } = new JSDOM('').window;
const L = OFFICE_LITE_LIMITS;
const code = (c) => (e) => e instanceof OfficeLiteError && e.code === c;

/** A JSZip whose loadAsync calls are counted (I1: nothing inflates before scanZip passes). */
function spyZip() {
  const spy = { loads: 0 };
  spy.JSZip = Object.assign(function SpyZip() { return new JSZip(); }, { loadAsync: (...a) => { spy.loads += 1; return JSZip.loadAsync(...a); } });
  return spy;
}
async function zipOf(files, opts = {}) {
  const z = new JSZip();
  for (const [n, d] of Object.entries(files)) z.file(n, d, { createFolders: false });
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', ...opts });
}
/** Offset of the first central-directory header (for raw field patches). */
function centralAt(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) return { v, eocd: i, cd: v.getUint32(i + 16, true) };
  throw new Error('no eocd');
}

test('T-Z1 fetchCapped: Content-Length past the cap refuses before any read; a stream past it is cancelled; 404 is NOT_FOUND', async () => {
  const bytes = new Uint8Array(300);
  const big = respond(bytes);
  await assert.rejects(fetchCapped(async () => big, '/f', { maxBytes: 200 }), code('TOO_LARGE'));
  assert.equal(big.stats.reads, 0, 'refused from the header, nothing read');
  const quiet = respond(bytes, { contentLength: false, chunk: 64 });
  await assert.rejects(fetchCapped(async () => quiet, '/f', { maxBytes: 200 }), code('TOO_LARGE'));
  assert.equal(quiet.stats.cancelled, true, 'the reader is cancelled once past the cap');
  assert.ok(quiet.stats.reads <= 4, 'it stops reading at the cap');
  const liar = respond(bytes, { contentLength: 10, chunk: 64 });
  await assert.rejects(fetchCapped(async () => liar, '/f', { maxBytes: 200 }), code('TOO_LARGE'), 'a lying header is caught by the counter');
  await assert.rejects(fetchCapped(async () => respond(bytes, { status: 404 }), '/f', { maxBytes: 200 }), code('NOT_FOUND'));
  await assert.rejects(fetchCapped(async () => respond(bytes, { status: 500 }), '/f', { maxBytes: 200 }), (e) => e.code === 'UNREADABLE' && e.detail === 500);
  await assert.rejects(fetchCapped(async () => respond(bytes, { stream: false, contentLength: false }), '/f', { maxBytes: 200 }), code('TOO_LARGE'));
  const okBytes = await fetchCapped(async () => respond(bytes, { chunk: 64 }), '/f', { maxBytes: 300 });
  assert.equal(okBytes.length, 300);
  const plain = await fetchCapped(async () => respond(bytes, { stream: false }), '/f', { maxBytes: 300 });
  assert.equal(plain.length, 300);
  const urls = [];
  await fetchCapped(async (u) => { urls.push(u); return respond(bytes); }, '/the/url', { maxBytes: 300 });
  assert.deepEqual(urls, ['/the/url']);
});

test('T-Z2 scanZip: bytes past maxBytes are TOO_LARGE', async () => {
  const bytes = await zipOf({ 'a.xml': '<a/>' });
  assert.throws(() => scanZip(bytes, { ...L, maxBytes: bytes.length - 1 }), code('TOO_LARGE'));
  assert.equal(scanZip(bytes, { ...L, maxBytes: bytes.length }).entries.size, 1);
});

test('T-Z3 entry count: the end record\'s count is checked before the walk, and the walk counts too when the record lies low', async () => {
  const spy = spyZip();
  await assert.rejects(openCappedZip(spy.JSZip, await manyEntries(5001), L), code('TOO_MANY'));
  assert.equal(spy.loads, 0, 'JSZip never saw it');
  const four = await manyEntries(4);
  // A record claiming 5,001 entries over a 4-entry directory: refused from the record, never walked off the end.
  assert.throws(() => scanZip(patchZip(four, { eocdCount: 5001 }), L), code('TOO_MANY'));
  assert.throws(() => scanZip(patchZip(four, { eocdCount: 2 }), { ...L, maxEntries: 3 }), code('TOO_MANY'));
  assert.equal(scanZip(four, { ...L, maxEntries: 4 }).entries.size, 4);
});

test('T-Z4 bomb.xlsx: the declared sizes sum past 200 MB → EXPANDS, before JSZip loads anything', async () => {
  const spy = spyZip();
  await assert.rejects(openCappedZip(spy.JSZip, fixture('bomb.xlsx'), L), code('EXPANDS'));
  assert.equal(spy.loads, 0);
  const one = await zipOf({ 'a.xml': '<a/>' });
  assert.throws(() => scanZip(patchZip(one, { sizes: { 'a.xml': 300 * 1024 * 1024 } }), L), code('EXPANDS'), 'one entry alone past the cap');
});

test('T-Z5 liar.xlsx: an entry that inflates past its declared 1 KB is stopped at the limit while inflating', async () => {
  const zip = await openCappedZip(JSZip, fixture('liar.xlsx'), { ...L, maxTotal: 100 * 1024 * 1024 });
  assert.equal(zip.size('xl/worksheets/sheet1.xml'), 1024);
  await assert.rejects(zip.bytes('xl/worksheets/sheet1.xml'), (e) => e.code === 'EXPANDS' && e.detail <= 1024);
  assert.match(await zip.text('xl/workbook.xml'), /<sheet /, 'the honest parts still read');
});

test('T-Z6 the shared budget: a name JSZip normalises keeps its declared size, and every read spends the one budget', async () => {
  const body = 'z'.repeat(64 * 1024);
  const odd = patchZip(await zipOf({ 'a/../x.xml': body }), { sizes: { 'a/../x.xml': 4096 } });
  const zip = await openCappedZip(JSZip, odd, { ...L, maxTotal: 8 * 1024 });
  assert.equal(zip.size('x.xml'), 4096, 'the declared size is found through unsafeOriginalName');
  await assert.rejects(zip.bytes('x.xml'), code('EXPANDS'));
  const tight = await openCappedZip(JSZip, await zipOf({ 'x.xml': body }), L);
  tight.budget.left = 8 * 1024;
  await assert.rejects(tight.bytes('x.xml'), code('EXPANDS'), 'the budget caps an entry below its declared size');
  const again = await openCappedZip(JSZip, await zipOf({ 'a.xml': 'a'.repeat(5000) }), { ...L, maxTotal: 8000 });
  assert.equal((await again.bytes('a.xml')).length, 5000);
  assert.equal(again.budget.left, 3000, 'a read spends its real byte count');
  await assert.rejects(again.bytes('a.xml'), code('EXPANDS'), 'a second read of the same part has 3,000 left');
  const two = await openCappedZip(JSZip, await zipOf({ 'a.xml': 'a', 'b.xml': 'b' }), L);
  await assert.rejects(two.bytes('missing.xml'), code('UNREADABLE'));
  assert.equal(two.size('missing.xml'), 0);
  assert.deepEqual(two.names().sort(), ['a.xml', 'b.xml']);
  assert.equal(two.has('a.xml'), true);
  assert.equal(two.has('nope'), false);
});

test('T-Z7 ZIP64 markers, encryption, unknown methods, truncation and a missing end record are UNREADABLE', async () => {
  const base = await zipOf({ 'a.xml': '<a/>' });
  assert.throws(() => scanZip(patchZip(base, { sizes: { 'a.xml': 0xffffffff } }), L), code('UNREADABLE'), 'ZIP64 size marker');
  const z64 = new Uint8Array(base); const e64 = centralAt(z64); e64.v.setUint32(e64.eocd + 16, 0xffffffff, true);
  assert.throws(() => scanZip(z64, L), code('UNREADABLE'), 'ZIP64 offset marker');
  const enc = new Uint8Array(base); const ee = centralAt(enc); ee.v.setUint16(ee.cd + 8, ee.v.getUint16(ee.cd + 8, true) | 1, true);
  assert.throws(() => scanZip(enc, L), code('UNREADABLE'), 'encrypted');
  const meth = new Uint8Array(base); const em = centralAt(meth); em.v.setUint16(em.cd + 10, 12, true);
  assert.throws(() => scanZip(meth, L), code('UNREADABLE'), 'bzip2');
  assert.throws(() => scanZip(base.subarray(0, base.length - 5), L), code('UNREADABLE'), 'truncated end record');
  assert.throws(() => scanZip(base.subarray(40), L), code('UNREADABLE'), 'offsets point outside the bytes');
  assert.throws(() => scanZip(new Uint8Array(500).fill(7), L), code('UNREADABLE'), 'not a zip');
  await assert.rejects(openCappedZip(JSZip, new Uint8Array(500).fill(7), L), code('UNREADABLE'));
});

test('T-Z8 parseXml: a DOCTYPE or ENTITY (any case) and malformed XML are UNREADABLE; elements match by localName', () => {
  for (const t of ['<!DOCTYPE a><a/>', '<!doctype a><a/>', '<a><!ENTITY x "y"></a>', '<?xml version="1.0"?><!entity x "y"><a/>']) {
    assert.throws(() => parseXml(t, DOMParser), code('UNREADABLE'), t);
    assert.throws(() => assertNoDtd(t), code('UNREADABLE'), t);
  }
  assert.throws(() => parseXml('<a><b></a>', DOMParser), code('UNREADABLE'));
  const doc = parseXml('<w:r xmlns:w="urn:a" xmlns:x="urn:b"><w:t x:space="p">one</w:t><t>two</t><w:g><w:t>three</w:t></w:g></w:r>', DOMParser);
  const root = doc.documentElement;
  assert.deepEqual(kids(root, 't').map((e) => e.textContent), ['one', 'two']);
  assert.equal(kid(root, 'g').localName, 'g');
  assert.equal(kid(root, 'none'), null);
  assert.deepEqual(descendants(root, 't').map((e) => e.textContent), ['one', 'two', 'three']);
  assert.equal(attr(kid(root, 't'), 'space'), 'p');
  assert.equal(attr(root, 'space'), null);
});

test('T-Z9 restore(): a STORE-only archive with the same names and bytes; an XML part with a DTD is UNREADABLE', async () => {
  const src = fixture('memo.docx');
  const zip = await openCappedZip(JSZip, src, L);
  const { bytes, xmlTexts } = await zip.restore();
  const scan = scanZip(bytes, L);
  assert.ok([...scan.entries.values()].every((e) => e.method === 0), 'nothing left to inflate');
  const again = await openCappedZip(JSZip, bytes, L);
  assert.deepEqual(again.names().sort(), zip.names().sort());
  const orig = await openCappedZip(JSZip, src, L);
  for (const n of orig.names()) assert.deepEqual(await again.bytes(n), await orig.bytes(n), n);
  assert.match(xmlTexts.get('word/document.xml'), /Quarterly memo/);
  assert.ok(xmlTexts.has('word/_rels/document.xml.rels'));
  assert.ok(!xmlTexts.has('word/media/image1.png'));
  await assert.rejects((await openCappedZip(JSZip, fixture('dtd.xlsx'), L)).restore(), code('UNREADABLE'));
});

test('office-xml helpers: rels, part paths, ODF text, image sniffing', async () => {
  const zip = await openCappedZip(JSZip, fixture('memo.docx'), L);
  const rels = await relsOf(zip, 'word/document.xml', DOMParser);
  assert.deepEqual(rels.get('rIdImg'), { target: 'media/image1.png', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', external: false });
  assert.equal(rels.get('rIdLink').external, true);
  assert.equal((await relsOf(zip, 'word/none.xml', DOMParser)).size, 0);
  assert.equal(resolvePart('word/document.xml', 'media/a.png'), 'word/media/a.png');
  assert.equal(resolvePart('ppt/slides/slide1.xml', '../media/a.png'), 'ppt/media/a.png');
  assert.equal(resolvePart('ppt/slides/slide1.xml', '/docProps/t.jpeg'), 'docProps/t.jpeg');
  assert.equal(resolvePart('_rels/.rels', 'docProps/t.jpeg'), 'docProps/t.jpeg');
  assert.equal(resolvePart('', 'xl/workbook.xml'), 'xl/workbook.xml');
  const odf = parseXml('<text:p xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:office="urn:o" xmlns:draw="urn:d">a<text:s text:c="3"/>b<text:s/>c<text:tab/>d<text:line-break/>e'
    + '<text:note><text:note-body>NOTE</text:note-body></text:note><office:annotation>ANN</office:annotation><text:tracked-changes>TC</text:tracked-changes><draw:frame>FR</draw:frame><text:span>!</text:span></text:p>', DOMParser);
  assert.equal(odfText(odf.documentElement), 'a   b c\td\ne!');
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageType(new TextEncoder().encode('GIF89a..')), 'image/gif');
  assert.equal(sniffImageType(new TextEncoder().encode('GIF87a..')), 'image/gif');
  assert.equal(sniffImageType(new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a])), null, 'WMF');
  assert.equal(sniffImageType(new Uint8Array([1, 0, 0, 0])), null, 'EMF');
  assert.equal(sniffImageType(new Uint8Array(0)), null);
});

/** `real` with a decoy central directory in front: bytes before the archive put a 1-entry directory at the raw offset the
 *  end record names, and the end record's counts say 1, while JSZip (which shifts every offset by the prepended bytes)
 *  reads the real directory. */
function decoyed(real) {
  const { v, eocd, cd } = centralAt(real);
  const cdSize = v.getUint32(eocd + 12, true);
  const pre = new Uint8Array(cd + cdSize);
  const pv = new DataView(pre.buffer);
  pv.setUint32(cd, 0x02014b50, true);
  pv.setUint32(cd + 20, 1, true);
  pv.setUint32(cd + 24, 1, true);
  pv.setUint16(cd + 28, 5, true);
  pv.setUint16(cd + 30, cdSize - 51, true);
  pre.set(new TextEncoder().encode('a.xml'), cd + 46);
  const out = new Uint8Array(pre.length + real.length);
  out.set(pre);
  out.set(real, pre.length);
  const ov = new DataView(out.buffer);
  ov.setUint16(pre.length + eocd + 8, 1, true);
  ov.setUint16(pre.length + eocd + 10, 1, true);
  return out;
}

test('T-Z10 scanZip and JSZip read the same directory: prepended bytes, a decoy directory, split-disk fields and a name JSZip reads differently are UNREADABLE', async () => {
  const real = await manyEntries(12);
  const decoy = decoyed(real);
  const lim = { ...L, maxEntries: 10 };
  assert.throws(() => scanZip(decoy, lim), code('UNREADABLE'), 'the directory must end where the end record starts');
  const spy = spyZip();
  await assert.rejects(openCappedZip(spy.JSZip, decoy, lim), code('UNREADABLE'));
  assert.equal(spy.loads, 0);
  // JSZip alone, given the decoy, reads all 12 entries: what the check above keeps away from the caps.
  assert.equal(Object.keys((await JSZip.loadAsync(decoy)).files).length, 12);
  for (const at of [4, 6]) {
    const disk = new Uint8Array(real); const e = centralAt(disk); e.v.setUint16(e.eocd + at, 1, true);
    assert.throws(() => scanZip(disk, L), code('UNREADABLE'), `disk field eocd+${at}`);
    const ff = new Uint8Array(real); const f = centralAt(ff); f.v.setUint16(f.eocd + at, 0xffff, true);
    assert.throws(() => scanZip(ff, L), code('UNREADABLE'), `ZIP64 disk marker eocd+${at}`);
  }
  // Two raw names JSZip resolves to one: JSZip keeps one file, the directory has two.
  await assert.rejects(openCappedZip(JSZip, await zipOf({ 'x.xml': 'a', 'a/../x.xml': 'b' }), L), code('UNREADABLE'));
  // A Unicode Path extra field (0x7075): JSZip names the entry from it, the raw name is another one.
  const upath = await zipOf({ 'é.xml': 'a' }, { encodeFileName: () => new TextEncoder().encode('x.xml') });
  assert.deepEqual([...scanZip(upath, L).entries.keys()], ['x.xml']);
  assert.deepEqual(Object.keys((await JSZip.loadAsync(upath)).files), ['é.xml']);
  await assert.rejects(openCappedZip(JSZip, upath, L), code('UNREADABLE'));
  assert.equal(scanZip(real, L).count, 12);
});

test('T-Z11 the end record\'s ZIP64 count markers alone (eocd+8 / eocd+10 = 0xFFFF) are UNREADABLE', async () => {
  const base = await zipOf({ 'a.xml': '<a/>' });
  const big = { ...L, maxEntries: 70000 };
  for (const at of [8, 10]) {
    const z = new Uint8Array(base); const e = centralAt(z); e.v.setUint16(e.eocd + at, 0xffff, true);
    assert.throws(() => scanZip(z, big), code('UNREADABLE'), `eocd+${at}`);
  }
});

test('T-Z12 a multi-MB liar stops inflating once refused: no more data after the refusal', async () => {
  // Incompressible bytes, so the entry spans hundreds of compressed chunks (JSZip inflates one chunk synchronously;
  // pause() stops the chunks after it).
  const name = 'xl/worksheets/sheet1.xml';
  const noise = new Uint8Array(4 * 1024 * 1024);
  for (let i = 0, x = 1; i < noise.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; noise[i] = x >>> 24; }
  const liar = patchZip(await zipOf({ [name]: noise }), { sizes: { [name]: 1024 } });
  const seen = { chunks: 0, bytes: 0 };
  const Counted = Object.assign(function C() { return new JSZip(); }, {
    loadAsync: async (b) => {
      const z = await JSZip.loadAsync(b);
      for (const f of Object.values(z.files)) {
        const orig = f.internalStream.bind(f);
        f.internalStream = (t) => {
          const st = orig(t);
          const on = st.on.bind(st);
          st.on = (ev, fn) => on(ev, ev === 'data' ? (c) => { seen.chunks += 1; seen.bytes += c.length; fn(c); } : fn);
          return st;
        };
      }
      return z;
    },
  });
  const zip = await openCappedZip(Counted, liar, L);
  await assert.rejects(zip.bytes(name), code('EXPANDS'));
  const atRefusal = seen.chunks;
  await new Promise((r) => { setTimeout(r, 300); });
  assert.ok(seen.chunks - atRefusal <= 1, `${seen.chunks - atRefusal} chunks after the refusal`);
  assert.ok(seen.bytes < 1024 * 1024, `${seen.bytes} bytes inflated in all`);
});

test('T-Z13 a deflated entry whose compressed bytes are garbage is UNREADABLE, and the read settles', async () => {
  const name = 'a.xml';
  const bytes = await zipOf({ [name]: `<a>${'x'.repeat(5000)}</a>` });
  const lh = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = 30 + lh.getUint16(26, true) + lh.getUint16(28, true);   // the first local header, its name and extra field
  for (let i = data + 2; i < data + 12; i++) bytes[i] = 0xff;
  const zip = await openCappedZip(JSZip, bytes, L);
  let settled = null;
  zip.text(name).then(() => { settled = 'resolved'; }, (e) => { settled = e; });
  await new Promise((r) => { setTimeout(r, 200); });
  assert.ok(settled instanceof OfficeLiteError, `the read settled with an OfficeLiteError, got ${settled}`);
  assert.equal(settled.code, 'UNREADABLE');
});
