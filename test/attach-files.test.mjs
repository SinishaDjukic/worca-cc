// test/attach-files.test.mjs — the browser's attachment rules, shared by the Ask panel and the Workflows chat dock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATTACH_TEXT_EXT, ATTACH_BINARY, ATTACH_MAX_TEXT_BYTES, ATTACH_MAX_BINARY_BYTES, ATTACH_MAX_MESSAGE_BYTES, ATTACH_MAX_FILES,
  ATTACH_ACCEPT, extOf, checkAttachment, bytesToBase64, carriesFiles, pastedFiles, createPasteNamer,
} from '../ui/public/attach-files.mjs';
import { TEXT_EXTENSIONS, BINARY_EXTENSIONS, classifyExtension } from '../src/shared/artifact-kinds.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

test('the tables and caps mirror the server (artifact-kinds allowlists, ASK_LIMITS.attachment)', () => {
  assert.deepEqual([...ATTACH_TEXT_EXT], [...TEXT_EXTENSIONS]);
  assert.deepEqual(Object.keys(ATTACH_BINARY), [...BINARY_EXTENSIONS]);
  for (const [ext, mime] of Object.entries(ATTACH_BINARY)) assert.equal(classifyExtension(ext).mime, mime, ext);
  assert.equal(ATTACH_MAX_TEXT_BYTES, ASK_LIMITS.attachment.maxBytesPerFile);
  assert.equal(ATTACH_MAX_BINARY_BYTES, ASK_LIMITS.attachment.maxBytesPerBinaryFile);
  assert.equal(ATTACH_MAX_MESSAGE_BYTES, ASK_LIMITS.attachment.maxBytesPerMessage);
  assert.equal(ATTACH_MAX_FILES, ASK_LIMITS.attachment.maxFiles);
  assert.equal(ATTACH_ACCEPT, '.md,.markdown,.txt,.json,.csv,.log,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,.pdf,text/*');
  assert.equal(extOf('Spec.v2.MD'), '.md');
  assert.equal(extOf('README'), '');
});

test('checkAttachment: Ask\'s checks in Ask\'s order, with its messages; a same-name file replaces its pending one', () => {
  assert.deepEqual(checkAttachment({ name: 'Spec.MD', size: 10 }), { ok: true, name: 'Spec.MD', ext: '.md', mime: null, attKind: 'text', others: [] });
  assert.equal(checkAttachment({ name: 'shot.PNG', size: 10 }).attKind, 'image');
  assert.equal(checkAttachment({ name: 'spec.pdf', size: 10 }).attKind, 'binary');
  assert.equal(checkAttachment({ name: 'spec.pdf', size: 10 }).mime, 'application/pdf');
  assert.equal(checkAttachment({ name: 'evil.exe', size: 1 }).error, 'attachment type not allowed: evil.exe');
  assert.equal(checkAttachment({ name: 'README', size: 1 }).error, 'attachment type not allowed: README');
  assert.equal(checkAttachment({ name: 'spec.pdf', size: 1 }, { engine: 'codex' }).error, 'PDFs need a Claude chat: spec.pdf');
  assert.equal(checkAttachment({ name: 'shot.png', size: 1 }, { engine: 'codex' }).ok, true);
  assert.equal(checkAttachment({ name: 'big.md', size: 524_289 }).error, 'attachment over 524288 bytes: big.md');
  assert.equal(checkAttachment({ name: 'big.md', size: 524_288 }).ok, true);
  assert.equal(checkAttachment({ name: 'big.png', size: 33_554_433 }).error, 'attachment over 33554432 bytes: big.png');
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.md`, bytes: 1 }));
  assert.equal(checkAttachment({ name: 'f8.md', size: 1 }, { pending: eight }).error, 'at most 8 attachments per message');
  const again = checkAttachment({ name: 'f0.md', size: 1 }, { pending: eight });
  assert.equal(again.ok, true, 'the same name replaces its pending file');
  assert.deepEqual(again.others.map((p) => p.name), eight.slice(1).map((p) => p.name));
  const big = [{ name: 'a.png', bytes: 30 * 1024 * 1024 }];
  assert.equal(checkAttachment({ name: 'b.png', size: 18 * 1024 * 1024 + 1 }, { pending: big }).error, 'attachments over 50331648 bytes per message');
  assert.equal(checkAttachment({ name: 'b.png', size: 18 * 1024 * 1024 }, { pending: big }).ok, true);
});

test('bytesToBase64 matches Buffer across its 32 KB chunks', () => {
  const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
  assert.equal(bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), (s) => btoa(s)), 'iVBORw==');
});

test('carriesFiles: only drags with files; pastedFiles: a text paste carrying only rendered images stays text', () => {
  assert.equal(carriesFiles({ types: ['Files'] }), true);
  assert.equal(carriesFiles({ types: ['application/x-worca', 'text/plain'] }), false);
  assert.equal(carriesFiles(null), false);
  const png = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
  const md = new File(['# x'], 'notes.md', { type: 'text/markdown' });
  assert.deepEqual(pastedFiles({ files: [png], getData: () => '' }), [png], 'a screenshot attaches');
  assert.equal(pastedFiles({ files: [png], getData: () => 'A1\tB1' }), null, 'Excel/Word copies: the text is what was meant');
  assert.deepEqual(pastedFiles({ files: [md], getData: () => 'notes' }), [md], 'text plus a real file still attaches the file');
  assert.equal(pastedFiles({ files: [], getData: () => 'hi' }), null);
  assert.equal(pastedFiles(null), null);
});

test('createPasteNamer: generic clipboard names get unique pasted-<n> names; real names stay', () => {
  const name = createPasteNamer((parts, n, opts) => new File(parts, n, opts), () => 1000);
  const out = name([
    new File([''], 'image.png', { type: 'image/png' }), new File([''], 'image.png', { type: 'image/png' }),
    new File([''], 'spec.md', { type: 'text/markdown' }), new File([''], '', { type: 'text/csv' }), new File([''], '', { type: 'application/zip' }),
  ]);
  assert.deepEqual(out.map((f) => f.name), ['pasted-1000.png', 'pasted-1001.png', 'spec.md', 'pasted-1002.txt', 'pasted-1003']);
  assert.equal(out[0].type, 'image/png');
});

test('the Ask panel takes its attachment rules from attach-files.mjs (one copy of the tables and checks)', () => {
  const src = readFileSync(new URL('../ui/public/ask-panel.mjs', import.meta.url), 'utf8');
  assert.match(src, /\} from '\.\/attach-files\.mjs';/);
  assert.doesNotMatch(src, /ASK_ATTACH_EXT|ASK_ATTACH_BINARY|ASK_MAX_(TEXT|BINARY|MESSAGE)_BYTES|lastPasteStamp|attachRefusal/);
});
