// test/ask-files.test.mjs
// Spec §7: preview files are SNAPSHOTTED at ask time and served by (runId, askId,
// index) — never by path. This pins the three things that stand between an agent
// string and a byte the host serves: the path SHAPE rules (platform-independent,
// so Windows semantics are testable here), CONTAINMENT (realpath, case-fold,
// symlink escape) and the magic-byte SNIFF + allowlist. No WORCA_HOME needed:
// the module touches no store and no DB.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  ASK_FILE_MIMES, sniffMime, refusePathShape, mimeMatchesAccept, isInside,
  snapshotAskFiles, readAskFileEntry,
} from '../src/core/ask-files.mjs';

const dirs = [];
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-askfiles-')); dirs.push(d); return d; }
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0, 0])]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n', 'latin1');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'utf8');
const HTML = Buffer.from('<!doctype html><html><script>alert(1)</script></html>', 'utf8');

test('sniffMime: magic bytes decide, the extension never does', () => {
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal(sniffMime(GIF), 'image/gif');
  assert.equal(sniffMime(PDF), 'application/pdf');
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])), 'image/jpeg');
  assert.equal(sniffMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
});

test('sniffMime: the TEXT probes (E9) — svg, json, diff, plain; MARKUP is refused', () => {
  assert.equal(sniffMime(SVG), 'image/svg+xml');
  assert.equal(sniffMime(Buffer.from('<?xml version="1.0"?><svg/>', 'utf8')), 'image/svg+xml');
  assert.equal(sniffMime(Buffer.from('{"a":1}', 'utf8')), 'application/json');
  assert.equal(sniffMime(Buffer.from('diff --git a/x b/x\n--- a/x\n+++ b/x\n', 'utf8')), 'text/x-diff');
  assert.equal(sniffMime(Buffer.from('# Title\n\nsome prose\n', 'utf8')), 'text/plain');
  assert.equal(sniffMime(HTML), null, 'scriptable markup is REFUSED (§7 "Refused" row)');
  assert.equal(sniffMime(Buffer.from('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"/>', 'utf8')), null,
    'an XML prolog is not a licence: xhtml is markup, not an image');
  assert.equal(sniffMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), 'video/webm', 'EBML magic');
  assert.equal(sniffMime(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])), null, 'binary with no known magic');
});

test('sniffMime: SVG is decided by the ROOT element, through any prelude (F23)', () => {
  const svg = 'image/svg+xml';
  assert.equal(sniffMime(Buffer.from('<!-- Generator: Adobe Illustrator -->\n<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8')), svg,
    'a comment before the root is how most exporters open a file');
  assert.equal(sniffMime(Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
    + '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n <!ENTITY ns_flows "http://ns.adobe.com/Flows/1.0/">\n]>\n<svg/>', 'utf8')), svg,
    'a prolog, a DOCTYPE with an internal subset, then the root');
  assert.equal(sniffMime(Buffer.from('<?xml version="1.0"?>\n<!-- x -->\n<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>', 'utf8')), svg,
    'a prefixed root is still svg');
  assert.equal(sniffMime(Buffer.from('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><svg/></body></html>', 'utf8')), null,
    'an XHTML document that merely CONTAINS an svg is markup — §7 refuses xhtml, whatever prolog it wears');
  assert.equal(sniffMime(Buffer.from('<!DOCTYPE html><svg/>', 'utf8')), null, 'an html DOCTYPE names the document, whatever follows');
  assert.equal(sniffMime(Buffer.from('<!-- open --><html/>', 'utf8')), null, 'a comment is not a licence either');
  assert.equal(sniffMime(Buffer.from('<?xml version="1.0"?>', 'utf8')), null, 'a prolog with no root is unrecognized');
  assert.equal(sniffMime(Buffer.from('42', 'utf8')), 'text/plain', 'a body shorter than any magic number is still text');
  assert.equal(sniffMime(Buffer.alloc(0)), null, 'an empty body is unrecognized');
  assert.equal(sniffMime(Buffer.from('  \n', 'utf8')), null, 'so is a blank one');
});

test('ASK_FILE_MIMES: every §7 trust class is represented and every entry has an extension', () => {
  const classes = new Set(Object.values(ASK_FILE_MIMES).map((v) => v.trust));
  assert.deepEqual([...classes].sort(), ['inert', 'inline', 'media', 'text', 'viewer']);
  assert.equal(ASK_FILE_MIMES['image/svg+xml'].trust, 'inert');
  assert.equal(ASK_FILE_MIMES['application/pdf'].trust, 'viewer');
  assert.equal(ASK_FILE_MIMES['video/mp4'].trust, 'media');
  assert.equal(ASK_FILE_MIMES['text/html'], undefined, 'html is not on the allowlist at all');
  for (const [mime, v] of Object.entries(ASK_FILE_MIMES)) {
    assert.match(v.ext, /^\.[a-z0-9]{1,5}$/, mime);
  }
});

test('refusePathShape: WINDOWS semantics, enforced on EVERY platform (E10)', () => {
  assert.equal(refusePathShape('mockups/a.png'), null);
  assert.equal(refusePathShape('mockups\\a.png'), null, 'a backslash separator is accepted and normalized');
  for (const bad of [
    '', '   ',
    '/etc/passwd', 'C:\\Windows\\win.ini', 'C:mockups/a.png', '\\\\server\\share\\a.png',
    '../outside.png', 'a/../../outside.png',
    'CON', 'con.png', 'nul/a.png', 'a/AUX.txt', 'COM1', 'lpt9.png',
    'a<b.png', 'a>b.png', 'a|b.png', 'a"b.png', 'a?b.png', 'a*b.png', 'a:b.png',
    'trailing./a.png', 'trailing /a.png', 'a.png ', 'a.png.',
    `nul${String.fromCharCode(0)}byte.png`,
  ]) {
    assert.ok(refusePathShape(bad), `expected "${bad}" to be refused`);
    assert.equal(typeof refusePathShape(bad), 'string');
  }
});

test('mimeMatchesAccept: globs, exacts, and text/plain standing in for any text/* (E9)', () => {
  assert.equal(mimeMatchesAccept('image/png', ['image/*']), true);
  assert.equal(mimeMatchesAccept('image/png', ['application/pdf']), false);
  assert.equal(mimeMatchesAccept('application/pdf', ['image/*', 'application/pdf']), true);
  assert.equal(mimeMatchesAccept('text/plain', ['text/markdown']), true, 'markdown is not separately sniffable');
  assert.equal(mimeMatchesAccept('text/plain', ['image/*']), false);
  assert.equal(mimeMatchesAccept('image/png', []), true, 'no accept declared => anything on the allowlist');
  assert.equal(mimeMatchesAccept('image/png', ['*/*']), true);
});

test('snapshotAskFiles: copies, hashes, names by INDEX and writes a manifest', async () => {
  const work = await tmp();
  const pipe = await tmp();
  await mkdir(join(work, 'mockups'), { recursive: true });
  await writeFile(join(work, 'mockups', 'a.png'), PNG);
  await writeFile(join(pipe, 'notes.md'), '# hello\n', 'utf8');
  const dest = join(pipe, 'ask-files', 'ask1');
  const { files, errors } = await snapshotAskFiles({
    refs: [
      { path: 'data.images[0].file', rel: 'mockups/a.png', accept: ['image/*'] },
      { path: 'data.notes', rel: 'notes.md', accept: [] },
    ],
    roots: [work, pipe],
    destDir: dest,
  });
  assert.deepEqual(errors, []);
  assert.equal(files.length, 2);
  assert.deepEqual(files[0], {
    index: 0, rel: 'mockups/a.png', name: 'a.png', mime: 'image/png',
    bytes: PNG.length, sha256: files[0].sha256, stored: '0.png',
  });
  assert.match(files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(files[1].stored, '1.txt');
  assert.equal(files[1].mime, 'text/plain', 'a .md body sniffs as text/plain (E9)');
  assert.deepEqual(await readFile(join(dest, '0.png')), PNG);
  const manifest = JSON.parse(await readFile(join(dest, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.files, files);
});

test('snapshotAskFiles: OUTSIDE the roots, a SYMLINK escape, and a directory are all refused', async () => {
  const work = await tmp();
  const outside = await tmp();
  const pipe = await tmp();
  await writeFile(join(outside, 'secret.png'), PNG);
  await mkdir(join(work, 'sub'), { recursive: true });
  await symlink(join(outside, 'secret.png'), join(work, 'escape.png')).catch(() => null);
  const run = (rel) => snapshotAskFiles({
    refs: [{ path: 'data.f', rel, accept: [] }], roots: [work, pipe], destDir: join(pipe, 'ask-files', 'a'),
  });
  const away = await run('nope.png');
  assert.equal(away.files.length, 0);
  assert.equal(away.errors[0].code, 'file-path');
  assert.equal(away.errors[0].path, 'data.f');
  const esc = await run('escape.png');
  assert.equal(esc.files.length, 0, 'realpath resolves the symlink OUT of the root, so it is refused');
  assert.equal(esc.errors[0].code, 'file-path');
  const dir = await run('sub');
  assert.equal(dir.files.length, 0);
  assert.match(dir.errors[0].message, /regular file/);
});

test('isInside: the case-FOLD is platform-injected — win32/darwin fold, linux does not (E10)', () => {
  // macOS realpath() preserves the case it is handed, so a fixture cannot prove
  // this on one host; the pure function can.
  // Fixture paths are joined with the host's separator: isInside compares against
  // `sep`, so a literal '/' fixture would fail on a Windows host (F27).
  const P = (...parts) => parts.join(sep);
  assert.equal(isInside(P('', 'Work', 'Tree'), P('', 'work', 'tree', 'a.png'), { fold: true }), true);
  assert.equal(isInside(P('', 'Work', 'Tree'), P('', 'work', 'tree', 'a.png'), { fold: false }), false);
  assert.equal(isInside(P('', 'work', 'tree'), P('', 'work', 'tree'), { fold: false }), true, 'the root itself is inside');
  assert.equal(isInside(P('', 'work', 'tree'), P('', 'work', 'treehouse', 'a.png'), { fold: false }), false, 'a sibling that merely shares the prefix is NOT inside');
  assert.equal(isInside(P('', 'work', 'tree'), P('', 'work', 'tree', '..', 'a.png'), { fold: false }), true, 'callers pass REALPATHS; this never normalizes');
});

test('snapshotAskFiles: an exact-case root contains its file on every platform', async () => {
  const work = await tmp();
  await writeFile(join(work, 'a.png'), PNG);
  const pipe = await tmp();
  const args = { refs: [{ path: 'data.f', rel: 'a.png', accept: [] }], destDir: join(pipe, 'ask-files', 'a') };
  for (const platform of ['linux', 'darwin', 'win32']) {
    const out = await snapshotAskFiles({ ...args, roots: [work], platform });
    assert.equal(out.errors.length, 0, platform);
  }
});

test('snapshotAskFiles: a refused mime, and a mime the field does not accept', async () => {
  const work = await tmp();
  const pipe = await tmp();
  await writeFile(join(work, 'evil.png'), HTML);      // claims .png, IS html
  await writeFile(join(work, 'doc.pdf'), PDF);
  const bad = await snapshotAskFiles({
    refs: [{ path: 'data.f', rel: 'evil.png', accept: ['image/*'] }],
    roots: [work], destDir: join(pipe, 'ask-files', 'a'),
  });
  assert.equal(bad.errors[0].code, 'type');
  assert.match(bad.errors[0].message, /display/);
  const wrong = await snapshotAskFiles({
    refs: [{ path: 'data.f', rel: 'doc.pdf', accept: ['image/*'] }],
    roots: [work], destDir: join(pipe, 'ask-files', 'b'),
  });
  assert.equal(wrong.errors[0].code, 'type');
  assert.match(wrong.errors[0].message, /application\/pdf/);
});

test('snapshotAskFiles: the caps — per file, per ask, and the file COUNT', async () => {
  const work = await tmp();
  const pipe = await tmp();
  await writeFile(join(work, 'a.png'), PNG);
  const many = Array.from({ length: 25 }, () => ({ path: 'data.f', rel: 'a.png', accept: [] }));
  const over = await snapshotAskFiles({ refs: many, roots: [work], destDir: join(pipe, 'ask-files', 'a') });
  assert.equal(over.files.length, 0);
  assert.equal(over.errors[0].code, 'too-many');
  assert.match(over.errors[0].message, /24/);
  // A 26 MB body trips the per-file cap without ever being read into memory.
  const big = join(work, 'big.png');
  await writeFile(big, Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]));
  const huge = await snapshotAskFiles({
    refs: [{ path: 'data.f', rel: 'big.png', accept: [] }], roots: [work], destDir: join(pipe, 'ask-files', 'b'),
  });
  assert.equal(huge.errors[0].code, 'too-big');
});

test('readAskFileEntry: the route reader — index only, no path input, unknown => null', async () => {
  const work = await tmp();
  const pipe = await tmp();
  await writeFile(join(work, 'a.png'), PNG);
  const dest = join(pipe, 'ask-files', 'ask1');
  await snapshotAskFiles({ refs: [{ path: 'data.f', rel: 'a.png', accept: [] }], roots: [work], destDir: dest });
  const hit = await readAskFileEntry(dest, 0);
  assert.equal(hit.stored, '0.png');
  assert.equal(hit.mime, 'image/png');
  assert.equal(await readAskFileEntry(dest, 1), null);
  assert.equal(await readAskFileEntry(join(pipe, 'ask-files', 'nope'), 0), null);
  // A tampered manifest can never name a path: the basename is re-validated.
  await writeFile(join(dest, 'manifest.json'),
    JSON.stringify({ version: 1, files: [{ index: 0, stored: `..${sep}..${sep}etc${sep}passwd`, mime: 'image/png' }] }), 'utf8');
  assert.equal(await readAskFileEntry(dest, 0), null, 'stored must match ^\\d{1,2}\\.[a-z0-9]{1,5}$');
});

test('refusePathShape: a CONTROL character anywhere is refused, and the reason never carries it raw', () => {
  for (const bad of ['a\tb.png', 'a\nb.png', 'a.png\r', `a${String.fromCharCode(127)}b.png`, `nul${String.fromCharCode(0)}byte.png`]) {
    const why = refusePathShape(bad);
    assert.equal(typeof why, 'string', JSON.stringify(bad));
    assert.doesNotMatch(why, /[\t\n\r]/, 'the audit line the reason lands on must stay one line');
  }
});

test('sniffMime: ISO-BMFF — only MP4-family brands are video/mp4; HEIC, QuickTime and M4A are refused', () => {
  const bmff = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, 'latin1'), Buffer.alloc(8)]);
  for (const ok of ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']) assert.equal(sniffMime(bmff(ok)), 'video/mp4', ok);
  for (const no of ['heic', 'heix', 'mif1', 'qt  ', 'M4A ', '3gp4', 'zzzz']) assert.equal(sniffMime(bmff(no)), null, no);
  assert.equal(sniffMime(bmff('avif')), 'image/avif');
});

test('snapshotAskFiles: a BACKSLASH-separated rel resolves on every platform (the segments are joined natively)', async () => {
  const work = await tmp();
  const pipe = await tmp();
  await mkdir(join(work, 'mockups'), { recursive: true });
  await writeFile(join(work, 'mockups', 'a.png'), PNG);
  const { files, errors } = await snapshotAskFiles({
    refs: [{ path: 'data.f', rel: 'mockups\\a.png', accept: ['image/*'] }], roots: [work], destDir: join(pipe, 'ask-files', 'a'),
  });
  assert.deepEqual(errors, []);
  assert.equal(files[0].rel, 'mockups\\a.png', 'the agent\'s own string is what the envelope carries');
  assert.equal(files[0].name, 'a.png');
  assert.equal(files[0].stored, '0.png');
});

test('sniffMime: a comment or prolog before PROSE is text, not markup — a markdown file may open with an HTML comment (F24)', async () => {
  assert.equal(sniffMime(Buffer.from('<!-- markdownlint-disable -->\n# Notes\n\nprose\n', 'utf8')), 'text/plain');
  assert.equal(sniffMime(Buffer.from('<!-- a -->\n<!-- b -->\nplain\n', 'utf8')), 'text/plain', 'any number of comments');
  assert.equal(sniffMime(Buffer.from('<!-- a -->\n<p>markup</p>', 'utf8')), null, 'an element after the prelude is still markup');
  assert.equal(sniffMime(Buffer.from('<!-- a -->\n<?php echo 1; ?>', 'utf8')), null, 'a non-element after the prelude is not prose');
  assert.equal(sniffMime(Buffer.from('<!-- only a comment -->', 'utf8')), null, 'a prelude with nothing after it is unrecognized');
  assert.equal(sniffMime(Buffer.from('<3 this design\n', 'utf8')), null, 'a bare "<" that opens no element is not classified either way');
  // The on-disk path: the head-only binary pass must not pre-empt the full-body text probe.
  const work = await tmp();
  const pipe = await tmp();
  await writeFile(join(work, 'NOTES.md'), '<!-- generated -->\n# Title\n\nbody\n', 'utf8');
  const { files, errors } = await snapshotAskFiles({
    refs: [{ path: 'data.notes', rel: 'NOTES.md', accept: ['text/*'] }], roots: [work], destDir: join(pipe, 'ask-files', 'a'),
  });
  assert.deepEqual(errors, []);
  assert.equal(files[0].mime, 'text/plain');
  assert.equal(files[0].stored, '0.txt');
});

test('snapshotAskFiles: a body with no signature over 1 MiB is refused by SIZE, naming the cap — not as an unknown type (F28)', async () => {
  const work = await tmp();
  const pipe = await tmp();
  await writeFile(join(work, 'big.md'), 'a'.repeat(1024 * 1024 + 1), 'utf8');
  const { files, errors } = await snapshotAskFiles({
    refs: [{ path: 'data.notes', rel: 'big.md', accept: ['text/*'] }], roots: [work], destDir: join(pipe, 'ask-files', 'a'),
  });
  assert.equal(files.length, 0);
  assert.equal(errors[0].code, 'too-big');
  assert.equal(errors[0].path, 'data.notes');
  assert.match(errors[0].message, /1048576/, 'the cap is named');
  assert.match(errors[0].message, /1048577 bytes/, 'so is the size');
  assert.doesNotMatch(errors[0].message, /not a file type/, 'the agent must learn it is the SIZE, so it can pick a smaller file');
});

test('sniffMime: MPEG audio needs a Layer III frame sync — a UTF-16 BOM or an FF-FF run is not an mp3 (F25)', () => {
  for (const ok of [[0xff, 0xfb, 0x90], [0xff, 0xf3, 0x90], [0xff, 0xe3, 0x90], [0xff, 0xfa, 0x90]]) {
    assert.equal(sniffMime(Buffer.from([...ok, 0, 0, 0, 0, 0])), 'audio/mpeg', ok.map((b) => b.toString(16)).join(' '));
  }
  assert.equal(sniffMime(Buffer.from('ID3', 'latin1')), 'audio/mpeg', 'an ID3v2 tag still is');
  assert.equal(sniffMime(Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00, 0x0a, 0x00])), null,
    'a UTF-16LE BOM is neither text worca reads (not UTF-8) nor audio — it was labelled audio/mpeg by the bare sync');
  assert.equal(sniffMime(Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0])), null, 'an FF run has no layer bits');
  assert.equal(sniffMime(Buffer.from([0xff, 0xfe, 0x90, 0, 0, 0, 0, 0])), null, 'Layer I is not a type worca plays');
  assert.equal(sniffMime(Buffer.from([0xff, 0xfb, 0xf0, 0, 0, 0, 0, 0])), null, 'bitrate index 1111 is invalid');
  assert.equal(sniffMime(Buffer.from([0xff, 0xfb, 0x9c, 0, 0, 0, 0, 0])), null, 'sampling-rate index 11 is reserved');
});
