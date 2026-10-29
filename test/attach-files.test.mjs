// test/attach-files.test.mjs — the browser's attachment rules, shared by the Ask panel and the Workflows chat dock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATTACH_TEXT_EXT, ATTACH_BINARY, ATTACH_MAX_TEXT_BYTES, ATTACH_MAX_BINARY_BYTES, ATTACH_MAX_MESSAGE_BYTES, ATTACH_MAX_FILES,
  ATTACH_ACCEPT, extOf, checkAttachment, bytesToBase64, carriesFiles, pastedFiles, createPasteNamer,
  REQ_ATTACH, reqLimits, reqTypeMessage,
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
  assert.equal(ATTACH_ACCEPT, '.md,.markdown,.txt,.json,.csv,.log,.html,.htm,.xml,.png,.jpg,.jpeg,.gif,.webp,.pdf,text/*');
  assert.equal(extOf('Spec.v2.MD'), '.md');
  assert.equal(extOf('README'), '');
});

test('checkAttachment: Ask\'s checks in Ask\'s order, with its messages; a same-name file replaces its pending one', () => {
  assert.deepEqual(checkAttachment({ name: 'Spec.MD', size: 10 }), { ok: true, name: 'Spec.MD', ext: '.md', mime: null, attKind: 'text', others: [] });
  assert.equal(checkAttachment({ name: 'shot.PNG', size: 10 }).attKind, 'image');
  assert.equal(checkAttachment({ name: 'spec.pdf', size: 10 }).attKind, 'binary');
  assert.equal(checkAttachment({ name: 'feed.XML', size: 10 }).attKind, 'text');
  assert.equal(checkAttachment({ name: 'spec.pdf', size: 10 }).mime, 'application/pdf');
  assert.equal(checkAttachment({ name: 'evil.exe', size: 1 }).error, 'attachment type not allowed: evil.exe');
  assert.equal(checkAttachment({ name: 'README', size: 1 }).error, 'attachment type not allowed: README');
  assert.equal(checkAttachment({ name: 'spec.pdf', size: 1 }, { engine: 'codex' }).error, 'a Codex chat cannot view PDFs (Claude, Copilot, Gemini CLI, OpenCode or Qwen Code chats can): spec.pdf');
  assert.equal(checkAttachment({ name: 'shot.png', size: 1 }, { engine: 'codex' }).ok, true);
  assert.equal(checkAttachment({ name: 'big.md', size: 100 * 1024 * 1024 + 1 }).error, 'attachment over 104857600 bytes: big.md');
  assert.equal(checkAttachment({ name: 'big.md', size: 100 * 1024 * 1024 }).ok, true);
  assert.equal(checkAttachment({ name: 'big.png', size: 104_857_601 }).error, 'attachment over 104857600 bytes: big.png');
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.md`, bytes: 1 }));
  assert.equal(checkAttachment({ name: 'f8.md', size: 1 }, { pending: eight }).error, 'at most 8 attachments per message');
  const again = checkAttachment({ name: 'f0.md', size: 1 }, { pending: eight });
  assert.equal(again.ok, true, 'the same name replaces its pending file');
  assert.deepEqual(again.others.map((p) => p.name), eight.slice(1).map((p) => p.name));
  const big = [{ name: 'a.png', bytes: 60 * 1024 * 1024 }];
  assert.equal(checkAttachment({ name: 'b.png', size: 40 * 1024 * 1024 + 1 }, { pending: big }).error, 'attachments over 104857600 bytes per message');
  assert.equal(checkAttachment({ name: 'b.png', size: 40 * 1024 * 1024 }, { pending: big }).ok, true);
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
test("A8: the Requirements page's limits and messages through `limits` and `typeMessage`; Ask's defaults unchanged", () => {
  const MB = 1024 * 1024;
  const req = { limits: reqLimits(), typeMessage: reqTypeMessage };
  assert.deepEqual(checkAttachment({ name: 'big.pdf', size: 25 * MB + 1 }, req), { ok: false, error: 'big.pdf was not added: it is over 25 MB.' });
  assert.equal(checkAttachment({ name: 'plan.docx', size: 1 }, req).error, 'plan.docx was not added: Worca reads text, images and PDF. Save it as PDF to attach it here.');
  assert.equal(checkAttachment({ name: 'a.zip', size: 1 }, req).error, 'a.zip was not added: Worca reads text, images and PDF.');
  const ten = Array.from({ length: 10 }, (_, i) => ({ name: `${i}.md`, bytes: 1 }));
  assert.equal(checkAttachment({ name: 'x.md', size: 1 }, { ...req, pending: ten }).error, 'x.md was not added: a feature takes up to 10 files.');
  assert.equal(checkAttachment({ name: 'x.md', size: 1 }, { ...req, limits: reqLimits({ owner: 'brief' }), pending: ten }).error, 'x.md was not added: a brief takes up to 10 documents.');
  assert.equal(checkAttachment({ name: '0.md', size: 1 }, { ...req, pending: ten }).ok, false, 'the feature page counts a same name too: the server names it "0 (2).md"');
  const ninety = [{ name: 'a.pdf', bytes: 90 * MB }];
  assert.equal(checkAttachment({ name: 'b.pdf', size: 20 * MB }, { ...req, limits: reqLimits({ create: true }), pending: ninety }).error,
    "b.pdf was not added: a new feature's files can be up to 100 MB in all; add more on the feature page.");
  assert.equal(checkAttachment({ name: 'b.pdf', size: 20 * MB }, { ...req, pending: ninety }).ok, true, 'the feature page splits a larger pick into requests');
  assert.deepEqual([REQ_ATTACH.maxFiles, REQ_ATTACH.maxBytes, REQ_ATTACH.maxRequestBytes, REQ_ATTACH.accept], [10, 25 * MB, 100 * MB, ATTACH_ACCEPT]);
  assert.equal(checkAttachment({ name: 'a.exe', size: 1 }).error, 'attachment type not allowed: a.exe');
  assert.equal(checkAttachment({ name: 'a.md', size: ATTACH_MAX_TEXT_BYTES + 1 }).error, `attachment over ${ATTACH_MAX_TEXT_BYTES} bytes: a.md`);
});
