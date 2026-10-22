import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { showFiles, parseShownPath, credentialReason, showFileKindFor, imageSize, kindOf, revealTargetOf, REVEAL_GONE } from '../src/core/ask/show-files.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from([0, 0, 2, 128, 0, 0, 1, 224]), Buffer.alloc(16)]);
const L = ASK_LIMITS.showFiles;

function fixture({ withPinned = false, limits = L } = {}) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'sf-')));
  const [out, wt, proj, run, member, outside, attDir] = ['out', 'wt', 'proj', 'run', 'member', 'outside', 'att'].map((d) => join(top, d));
  for (const d of [out, wt, proj, run, member, outside, attDir]) mkdirSync(d, { recursive: true });
  const stored = [];
  const deps = {
    platform: process.platform, limits, redact: (s) => s.replace(/sk-ant-\w+/g, 'sk-ant-<redacted>'),
    outDir: () => out, worktreesDir: () => wt, pinnedProjectDir: async () => (withPinned ? proj : null),
    projectDir: async (k) => (k === 'p1' ? proj : null),
    runDirsOf: async () => [{ dir: run }, { dir: member, projectKey: 'app' }],
    artifactFileOf: async (row, rel) => {
      if (rel === 'boom.png') throw new Error('index unreadable');
      return rel.startsWith('missing') ? null : { file: join(run, rel), base: run };
    },
    listAttachments: () => stored,
    getAttachment: (id) => stored.find((a) => a.id === id) || null,
    attachmentPath: (id) => (stored.some((a) => a.id === id) && existsSync(join(attDir, id)) ? join(attDir, id) : null),
    addAttachment: (b) => {
      const id = `att_${String(stored.length).padStart(8, '0')}`;
      const body = b.data ?? Buffer.from(b.text);
      writeFileSync(join(attDir, id), body);
      const a = { id, messageId: null, name: b.name, kind: b.kind, mime: b.mime, bytes: body.length, text: b.text, sourcePath: b.sourcePath ?? null, sourceOrigin: b.sourceOrigin ?? null, hasSource: !!b.sourcePath };
      stored.push(a);
      return a;
    },
  };
  const rowFor = async (id) => { if (id !== 'r1') throw new Error('show_files: run not found'); return { id }; };
  return { top, out, wt, proj, run, member, outside, deps, rowFor, stored };
}

test('show_files: $WORCA_ASK_OUT screenshots snapshot as images with their size; the card item never carries a path', async () => {
  const f = fixture();
  writeFileSync(join(f.out, 'home.png'), PNG);
  const r = await showFiles({ files: [{ path: '$WORCA_ASK_OUT/home.png' }], rowFor: f.rowFor }, f.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, [{ attId: 'att_00000000', name: 'home.png', kind: 'image', mime: 'image/png', bytes: PNG.length, width: 640, height: 480, source: true }]);
  assert.equal(JSON.stringify(r).includes(f.top), false, 'no absolute path leaks into the result');
  assert.equal(f.stored[0].sourcePath, join(f.out, 'home.png'), 'the copy remembers its real original, server-side');
});

test('show_files refusals: outside every root, symlink escape, credential names and folders, unknown run, bad shape', async () => {
  const f = fixture();
  writeFileSync(join(f.outside, 'x.png'), PNG);
  symlinkSync(join(f.outside, 'x.png'), join(f.out, 'link.png'));
  writeFileSync(join(f.proj, '.env.local'), 'TOKEN=1');
  mkdirSync(join(f.proj, '.ssh')); writeFileSync(join(f.proj, '.ssh', 'notes.txt'), 'x');
  writeFileSync(join(f.out, 'ok.txt'), 'fine');
  const r = await showFiles({ rowFor: f.rowFor, files: [
    { path: join(f.outside, 'x.png') },
    { path: '$WORCA_ASK_OUT/link.png' },
    { path: '.env.local', projectKey: 'p1' },
    { path: '.ssh/notes.txt', projectKey: 'p1' },
    { path: 'a.png', runId: 'nope' },
    { path: 'ok.txt', projectKey: 'nope' },
    { path: '../ok.txt' },
    { path: '\\\\host\\share\\x.png' },
    { path: '"$WORCA_ASK_OUT/ok.txt"' },
  ] }, f.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((i) => i.name), ['ok.txt'], 'the quoted spelling is unwrapped');
  const reasons = r.refused.map((x) => x.reason).join('\n');
  for (const want of [/not found inside/, /credential files are never shown/, /inside \.ssh\//, /run not found/, /project not found/, /\.\./, /UNC/]) assert.match(reasons, want);
});

test('show_files: the deepest root holding a file decides its credential check (a project registered at the home folder)', async () => {
  const f = fixture();
  const out2 = join(f.top, '.worca-cc', 'ask', 'out');
  mkdirSync(out2, { recursive: true });
  writeFileSync(join(out2, 'a.png'), PNG);
  writeFileSync(join(f.top, '.worca-cc', 'settings.json'), '{}');
  const deps = { ...f.deps, outDir: () => out2, projectDir: async (k) => (k === 'home' ? f.top : null) };
  const r = await showFiles({ rowFor: f.rowFor, files: [
    { path: join(out2, 'a.png'), projectKey: 'home' },
    { path: join(f.top, '.worca-cc', 'settings.json'), projectKey: 'home' },
  ] }, deps);
  assert.deepEqual(r.items.map((i) => i.name), ['a.png'], 'inside the out folder: judged below the out folder');
  assert.match(r.refused[0].reason, /inside \.worca-cc\//, 'only the project root holds it: still refused');
});

test('show_files guards: out-only roots, a folder, an empty file, a per-kind binary cap; the bare name IS found in the worktrees', async () => {
  const f = fixture();
  writeFileSync(join(f.wt, 'only-in-wt.png'), PNG);
  mkdirSync(join(f.out, 'dir.png'));
  writeFileSync(join(f.out, 'empty.txt'), '');
  writeFileSync(join(f.out, 'huge.png'), Buffer.concat([PNG, Buffer.alloc(25 * 1024 * 1024)]));
  const r = await showFiles({ rowFor: f.rowFor, files: [
    { path: '$WORCA_ASK_OUT/only-in-wt.png' },
    { path: '$WORCA_ASK_OUT/dir.png' },
    { path: '$WORCA_ASK_OUT/empty.txt' },
    { path: '$WORCA_ASK_OUT/huge.png' },
    { path: 'only-in-wt.png' },
  ] }, f.deps);
  assert.deepEqual(r.items.map((i) => i.name), ['only-in-wt.png']);
  const why = r.refused.map((x) => `${x.source} -> ${x.reason}`).join('\n');
  assert.match(why, /\$WORCA_ASK_OUT\/only-in-wt\.png -> not found inside/, '$WORCA_ASK_OUT never resolves against the worktrees');
  assert.match(why, /dir\.png -> not a regular file/);
  assert.match(why, /empty\.txt -> the file is empty/);
  assert.match(why, /huge\.png -> image files over 25 MiB/);
});

test('show_files caps: text, card, thread; nothing shown -> ok:false with errors', async () => {
  const f = fixture();
  writeFileSync(join(f.out, 'big.txt'), 'a'.repeat(L.textBytes + 1));
  const r = await showFiles({ files: [{ path: '$WORCA_ASK_OUT/big.txt' }], rowFor: f.rowFor }, f.deps);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /text files over 1 MiB/);

  const c = fixture({ limits: { ...L, cardBytes: PNG.length * 2 } });
  for (const n of ['a', 'b', 'c']) writeFileSync(join(c.out, `${n}.png`), PNG);
  const rc = await showFiles({ files: ['a', 'b', 'c'].map((n) => ({ path: `$WORCA_ASK_OUT/${n}.png` })), rowFor: c.rowFor }, c.deps);
  assert.deepEqual(rc.items.map((i) => i.name), ['a.png', 'b.png']);
  assert.match(rc.refused[0].reason, /the card would pass/);

  f.stored.push({ id: 'att_ffffffff', bytes: L.threadBytes });
  writeFileSync(join(f.out, 'a.png'), PNG);
  const r2 = await showFiles({ files: [{ path: '$WORCA_ASK_OUT/a.png' }], rowFor: f.rowFor }, f.deps);
  assert.match(r2.errors[0], /this chat's files would pass/);
});

test('show_files: text kinds are redacted at snapshot time; html stays source text; markdown front matter is not a diff', async () => {
  const f = fixture();
  writeFileSync(join(f.out, 'r.md'), '---\ntitle: x\n---\nkey sk-ant-abcdefghijklmnopqrstu\n');
  writeFileSync(join(f.out, 'p.html'), '<!doctype html><script>alert(1)</script>');
  const r = await showFiles({ files: [{ path: '$WORCA_ASK_OUT/r.md' }, { path: '$WORCA_ASK_OUT/p.html' }], rowFor: f.rowFor }, f.deps);
  assert.deepEqual(r.items.map((i) => [i.name, i.kind, i.mime]), [['r.md', 'markdown', 'text/markdown'], ['p.html', 'html', 'text/html']]);
  assert.match(f.stored[0].text, /sk-ant-<redacted>/);
  assert.equal(f.stored[1].kind, 'text', 'html is stored as a text attachment (served text/plain + nosniff)');
});

test('show_files run artifacts: contained in the base they were found under; a run folder path resolves through runId', async () => {
  const f = fixture();
  writeFileSync(join(f.run, 'shot.png'), PNG);
  writeFileSync(join(f.outside, 'x.png'), PNG);
  symlinkSync(join(f.outside, 'x.png'), join(f.run, 'escape.png'));
  const r = await showFiles({ rowFor: f.rowFor,
    runArtifacts: [{ runId: 'r1', relPath: 'shot.png' }, { runId: 'r1', relPath: 'missing.png' }, { runId: 'r1', relPath: 'escape.png' }, { runId: 'r1', relPath: 'boom.png' }],
    files: [{ path: 'shot.png', runId: 'r1' }] }, f.deps);
  assert.deepEqual(r.items.map((i) => i.name), ['shot.png'], 'the same real file is shown once');
  const reasons = r.refused.map((x) => x.reason);
  assert.equal(reasons.filter((x) => /artifact not found/.test(x)).length, 2, 'missing, and a lookup that threw');
  assert.ok(reasons.some((x) => /resolves outside its run folder/.test(x)));
});

test('show_files origin: a file under a run member\'s checkout keeps runId, projectKey and its relative path; a project file keeps projectKey; the out folder and run store none', async () => {
  const f = fixture();
  mkdirSync(join(f.member, 'out', 'shots'), { recursive: true });
  writeFileSync(join(f.member, 'out', 'shots', 'home.png'), PNG);
  writeFileSync(join(f.proj, 'notes.md'), '# n');
  writeFileSync(join(f.run, 'log.txt'), 'log');
  writeFileSync(join(f.out, 'o.txt'), 'o');
  const r = await showFiles({ rowFor: f.rowFor, files: [
    { path: 'out/shots/home.png', runId: 'r1' },
    { path: 'notes.md', projectKey: 'p1' },
    { path: 'log.txt', runId: 'r1' },
    { path: '$WORCA_ASK_OUT/o.txt' },
  ] }, f.deps);
  assert.equal(r.items.length, 4);
  assert.deepEqual(f.stored.map((a) => a.sourceOrigin), [
    { runId: 'r1', projectKey: 'app', rel: 'out/shots/home.png' },
    { runId: null, projectKey: 'p1', rel: 'notes.md' },
    null,
    null,
  ]);
  assert.equal(JSON.stringify(r).includes('out/shots'), false, 'the relative path never reaches the card');
  assert.ok(r.items.every((i) => i.source === true), 'the card keeps only the flag');
});

test('revealTargetOf: the original while it is there, else the same relative path inside the project; both gone or an old row: SOURCE_GONE text', async () => {
  const f = fixture();
  const projectDir = async (k) => (k === 'app' ? f.proj : null);
  const opts = { projectDir, platform: process.platform };
  mkdirSync(join(f.member, 'out'), { recursive: true });
  mkdirSync(join(f.proj, 'out'), { recursive: true });
  writeFileSync(join(f.member, 'out', 'a.png'), PNG);
  writeFileSync(join(f.proj, 'out', 'a.png'), PNG);
  const src = { path: join(f.member, 'out', 'a.png'), origin: { runId: 'r1', projectKey: 'app', rel: 'out/a.png' } };
  assert.deepEqual(await revealTargetOf(src, opts), { file: src.path }, 'the original wins while it exists');
  rmSync(f.member, { recursive: true });
  assert.deepEqual(await revealTargetOf(src, opts), { file: join(f.proj, 'out', 'a.png') }, 'the run folder is gone: the project copy');
  rmSync(join(f.proj, 'out', 'a.png'));
  assert.deepEqual(await revealTargetOf(src, opts), { error: REVEAL_GONE.run }, 'both gone');
  assert.match(REVEAL_GONE.run, /run's folder was cleaned up.*Download still has the copy/);
  assert.deepEqual(await revealTargetOf({ ...src, origin: { ...src.origin, projectKey: 'gone' } }, opts), { error: REVEAL_GONE.run }, 'an unregistered project');
  assert.deepEqual(await revealTargetOf({ path: src.path, origin: null }, opts), { error: REVEAL_GONE.moved }, 'an older row: today\'s text');
  assert.equal(REVEAL_GONE.moved, 'The original file is gone: it was moved or deleted after it was shown.');
  assert.deepEqual(await revealTargetOf({ path: src.path, origin: { runId: null, projectKey: 'app', rel: 'out/a.png' } }, opts), { error: REVEAL_GONE.moved },
    'a project file gone from the project: today\'s text');
  mkdirSync(join(f.proj, 'dir.png'));
  assert.deepEqual(await revealTargetOf({ ...src, origin: { ...src.origin, rel: 'dir.png' } }, opts), { error: REVEAL_GONE.run }, 'a folder is not a file');
});

test('revealTargetOf guard: the fallback never leaves the project folder (.., absolute, a symlink out)', async () => {
  const f = fixture();
  const opts = { projectDir: async () => f.proj, platform: process.platform };
  writeFileSync(join(f.outside, 'x.png'), PNG);
  symlinkSync(join(f.outside, 'x.png'), join(f.proj, 'link.png'));
  const gone = join(f.member, 'nope.png');
  for (const rel of ['../outside/x.png', 'a/../../outside/x.png', join(f.outside, 'x.png'), 'link.png', 'C:/outside/x.png', '']) {
    assert.deepEqual(await revealTargetOf({ path: gone, origin: { runId: 'r1', projectKey: 'app', rel } }, opts), { error: REVEAL_GONE.run }, rel);
  }
});

test("show_files attachmentIds: this chat's attachment is shown without a new copy, re-sniffed from its body; junk refused", async () => {
  const f = fixture();
  const md = f.deps.addAttachment({ name: 'notes.md', kind: 'text', mime: null, text: '# Notes' });
  const bin = f.deps.addAttachment({ name: 'blob.bin', kind: 'binary', mime: 'application/octet-stream', data: Buffer.from([0, 1, 2, 3]) });
  const r = await showFiles({ attachmentIds: [md.id, md.id, bin.id, 'att_99999999'], rowFor: f.rowFor }, f.deps);
  assert.deepEqual(r.items.map((i) => [i.attId, i.kind, i.mime]), [[md.id, 'markdown', 'text/markdown']], 'a row with no mime gets the table label');
  assert.equal(f.stored.length, 2, 'no snapshot was added');
  assert.equal(r.items[0].source, undefined, 'an upload has no original folder to show');
  assert.deepEqual(r.refused.map((x) => x.reason), ['this file type cannot be shown', 'attachment not found in this chat']);
});

test('parseShownPath: platform shapes', () => {
  assert.deepEqual(parseShownPath('$WORCA_ASK_OUT/a.png'), { rel: 'a.png', outOnly: true });
  assert.deepEqual(parseShownPath('${WORCA_ASK_OUT}/s/a.png'), { rel: 's/a.png', outOnly: true });
  assert.deepEqual(parseShownPath("'$WORCA_ASK_OUT/a b.png'"), { rel: 'a b.png', outOnly: true });
  assert.deepEqual(parseShownPath('C:\\w\\a.png', 'win32'), { abs: 'C:\\w\\a.png' });
  assert.match(parseShownPath('/x/a.png', 'win32').error, /absolute/);
  assert.match(parseShownPath('/x/../a.png', 'linux').error, /\.\./);
  assert.match(parseShownPath('//host/a.png', 'linux').error, /UNC/);
  assert.match(parseShownPath(`a${String.fromCharCode(7)}.png`).error, /control/);
});

test('credentialReason / showFileKindFor / imageSize / kindOf', () => {
  for (const p of ['.env', 'a/.env.production', 'k/server.PEM', 'id_ed25519', 'x/.git/config', '.aws/credentials', '.config/gh/hosts.yml', 'a/secrets/t.txt']) assert.ok(credentialReason(p), p);
  for (const p of ['shots/home.png', 'report.md', 'environment.md', 'keys.md']) assert.equal(credentialReason(p), null, p);
  assert.equal(showFileKindFor('text/x-diff', 'notes.md').kind, 'markdown');
  assert.equal(showFileKindFor('application/json', 'a.json').kind, 'json');
  assert.equal(showFileKindFor('application/zip', 'a.zip'), null);
  assert.deepEqual(imageSize(PNG, 'image/png'), { width: 640, height: 480 });
  assert.equal(imageSize(Buffer.from('xx'), 'image/jpeg'), null);
  assert.equal(kindOf(Buffer.from('<html><body>x</body></html>'), 'p.html', L).entry.kind, 'html');
  assert.equal(kindOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg', L).entry.kind, 'svg');
  assert.match(kindOf(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(L.textBytes)}</svg>`), 'a.svg', L).error, /SVG files over 1 MiB/);
});

test('imageSize: gif, jpeg (APP0 before SOF0, progressive SOF2), webp VP8X / VP8 / VP8L; truncated headers give null', () => {
  const le16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const le24 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
  const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const be16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const riff = (chunk, body) => Buffer.concat([Buffer.from('RIFF'), le32(4 + 8 + body.length), Buffer.from('WEBP'), Buffer.from(chunk, 'latin1'), le32(body.length), body]);

  const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), le16(300), le16(170), Buffer.from([0x80, 0, 0])]);
  assert.deepEqual(imageSize(GIF, 'image/gif'), { width: 300, height: 170 });

  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), be16(16), Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  const sof = (m) => Buffer.concat([Buffer.from([0xff, m]), be16(17), Buffer.from([8]), be16(170), be16(300), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof(0xc0), Buffer.from([0xff, 0xd9])]);
  assert.deepEqual(imageSize(JPEG, 'image/jpeg'), { width: 300, height: 170 });
  const PJPEG = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.from([0xff, 0xff]), sof(0xc2), Buffer.from([0xff, 0xd9])]);
  assert.deepEqual(imageSize(PJPEG, 'image/jpeg'), { width: 300, height: 170 }, 'a fill byte, then progressive SOF2');
  assert.equal(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), app0]), 'image/jpeg'), null, 'no SOF: no size');

  const VP8X = riff('VP8X', Buffer.concat([Buffer.from([0x10, 0, 0, 0]), le24(299), le24(169)]));
  assert.deepEqual(imageSize(VP8X, 'image/webp'), { width: 300, height: 170 });
  const VP8 = riff('VP8 ', Buffer.concat([Buffer.from([0x70, 0xfb, 0x06, 0x9d, 0x01, 0x2a]), le16(300), le16(170), Buffer.alloc(4)]));
  assert.deepEqual(imageSize(VP8, 'image/webp'), { width: 300, height: 170 });
  const VP8L = riff('VP8L', Buffer.concat([Buffer.from([0x2f]), le32((16383 - 1) | ((3 - 1) << 14)), Buffer.alloc(8)]));
  assert.deepEqual(imageSize(VP8L, 'image/webp'), { width: 16383, height: 3 });
  const VP8L2 = riff('VP8L', Buffer.concat([Buffer.from([0x2f]), le32((300 - 1) | ((16383 - 1) << 14)), Buffer.alloc(8)]));
  assert.deepEqual(imageSize(VP8L2, 'image/webp'), { width: 300, height: 16383 });
  assert.equal(imageSize(GIF.subarray(0, 8), 'image/gif'), null);
  assert.equal(imageSize(VP8X.subarray(0, 20), 'image/webp'), null);
});
