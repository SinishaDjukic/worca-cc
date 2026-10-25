// test/ask-file-tools.test.mjs — Codex chats' worca file tools (cascading-settings-design.md D13, §8 test 15):
// allowed under wt/**, att/** and the memory mount; every ASK_DENY_RULES path refused; symlinks resolved.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAskFileReader, askFileRoots, defaultFileDeps, AskFileError, ASK_FILE_LIMITS } from '../src/core/ask/file-deps.mjs';
import { createAskTools, AskToolError, MCP_CONTENT, MCP_MEDIA_MAX_BYTES } from '../src/core/ask/tools.mjs';
import { createRpcServer } from '../src/core/ask/rpc-server.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

const POSIX = process.platform === 'win32' ? { skip: 'symlinks need privileges on Windows' } : {};
const T = 'ask_00000001';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'worca-ask-files-')));
after(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, '.worca-cc');
const wt = join(home, 'ask', T, 'wt', 'w1');
const att = join(home, 'ask', T, 'att');
const mem = join(home, 'ask', 'memory', 'global', '.claude', 'rules', 'worca', 'global');
const put = (p, body = 'x\n') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); return p; };
put(join(wt, 'src', 'a.mjs'), 'one\nexport const two = 2;\nthree\n');
put(join(wt, 'src', 'b.txt'), 'two words\n');
put(join(wt, '.env'), 'TOKEN=abc\n');
put(join(wt, 'cfg', 'secrets.json'), '{"k":"v"}\n');
put(join(wt, '.worca-cc', 'store', 'x.log'), 'run log\n');
put(join(wt, '.ssh', 'id_test'), 'PRIVATE\n');           // denied through ~/.ssh/** with home = wt (below)
put(join(wt, 'bin.dat'), Buffer.from([0x50, 0x00, 0x51]));
put(join(att, 'att_00000001.txt'), 'attached text\n');
put(join(mem, 'style.md'), 'Use tabs.\n');
const outside = put(join(root, 'outside.txt'), 'outside\n');
if (process.platform !== 'win32') {
  symlinkSync(outside, join(wt, 'link-out.txt'));
  symlinkSync(join(wt, '.env'), join(wt, 'link-env.txt'));
  symlinkSync(root, join(wt, 'link-dir'));
}
const reader = createAskFileReader({ roots: askFileRoots({ home, threadId: T }), home: wt, redact: (s) => s });

test('askFileRoots: the thread worktrees, its attachments and the memory mount; an unminted id gets none', () => {
  assert.deepEqual(askFileRoots({ home, threadId: T }), [join(home, 'ask', T, 'wt'), join(home, 'ask', T, 'att'), join(home, 'ask', 'memory')]);
  assert.deepEqual(askFileRoots({ home, threadId: '../x' }), []);
});

test('read_file: numbered lines from the three roots, paged by line', () => {
  const r = reader.readFile({ path: join(wt, 'src', 'a.mjs') });
  assert.equal(r.text, '     1\tone\n     2\texport const two = 2;\n     3\tthree');
  assert.equal(r.totalLines, 3);
  assert.equal(r.nextOffset, null);
  const p = reader.readFile({ path: join(wt, 'src', 'a.mjs'), offset: 2, limit: 1 });
  assert.equal(p.text, '     2\texport const two = 2;');
  assert.equal(p.nextOffset, 3);
  assert.match(reader.readFile({ path: join(att, 'att_00000001.txt') }).text, /attached text/);
  assert.match(reader.readFile({ path: join(mem, 'style.md') }).text, /Use tabs\./);
});

test('read_file refuses: relative, missing, outside the roots, a folder, a binary file, and every denied path', () => {
  const refuse = (path, re) => assert.throws(() => reader.readFile({ path }), (e) => e instanceof AskFileError && re.test(e.message), path);
  refuse('src/a.mjs', /path must be absolute/);
  refuse(join(wt, 'nope.txt'), /does not exist/);
  refuse(outside, /outside this chat's worktrees, attachments and memory/);
  refuse(join(wt, 'src'), /is a folder/);
  refuse(join(wt, 'bin.dat'), /binary file/);
  refuse(join(wt, '.env'), /protected \(Read\(\/\/\*\*\/\.env\*\)\)/);
  refuse(join(wt, 'cfg', 'secrets.json'), /protected \(Read\(\/\/\*\*\/secrets\.json\)\)/);
  refuse(join(wt, '.worca-cc', 'store', 'x.log'), /protected/);
  refuse(join(wt, '.ssh', 'id_test'), /protected \(Read\(~\/\.ssh\/\*\*\)\)/);
});

test('read_file: only a regular file is read — a FIFO inside a root is refused, never opened', POSIX, () => {
  const fifo = join(wt, 'pipe');
  execFileSync('mkfifo', [fifo]);
  try { assert.throws(() => reader.readFile({ path: fifo }), (err) => err.name === 'AskFileError' && /not a regular file/.test(err.message)); }
  finally { rmSync(fifo, { force: true }); }
});

test('read_file: a file past the byte cap says it was cut, so the model never takes it for the whole file', () => {
  const small = createAskFileReader({ roots: askFileRoots({ home, threadId: T }), home: wt, redact: (s) => s, limits: { ...ASK_FILE_LIMITS, readMaxBytes: 8 } });
  const r = small.readFile({ path: join(wt, 'src', 'a.mjs') });
  assert.equal(r.truncated, true);
  assert.match(r.note, /first 8 bytes/);
  assert.equal(r.nextOffset, null);
  assert.equal(reader.readFile({ path: join(wt, 'src', 'a.mjs') }).truncated, undefined, 'a whole file carries no flag');
});

test('a symlink out of the roots is refused; one onto a denied file is refused', POSIX, () => {
  assert.throws(() => reader.readFile({ path: join(wt, 'link-out.txt') }), /outside this chat's worktrees/);
  assert.throws(() => reader.readFile({ path: join(wt, 'link-env.txt') }), /protected/);
});

test('grep: a regex over the worktrees by default, denied files and binaries skipped, an optional glob filter', async () => {
  const r = await reader.grep({ pattern: 'two' });
  assert.deepEqual(r.matches.map((m) => [m.path, m.line]), [[join(wt, 'src', 'a.mjs'), 2], [join(wt, 'src', 'b.txt'), 1]]);
  assert.equal((await reader.grep({ pattern: 'TOKEN' })).matches.length, 0, '.env is never searched');
  assert.deepEqual((await reader.grep({ pattern: 'two', glob: '**/*.mjs' })).matches.map((m) => m.line), [2]);
  await assert.rejects(reader.grep({ pattern: '(' }), (err) => err.name === 'AskFileError' && /invalid regular expression/.test(err.message));
  await assert.rejects(reader.grep({ pattern: 'x', path: outside }), (err) => err.name === 'AskFileError' && /outside/.test(err.message));
});

test('grep: matches pass through the redactor on the caller side', async () => {
  const loud = createAskFileReader({ roots: askFileRoots({ home, threadId: T }), home: wt, redact: (s) => s.toUpperCase() });
  assert.deepEqual((await loud.grep({ pattern: 'two', glob: '**/*.mjs' })).matches.map((m) => m.text), [(await reader.grep({ pattern: 'two', glob: '**/*.mjs' })).matches[0].text.toUpperCase()]);
});

test('grep: a catastrophically backtracking pattern is stopped at the time limit, and the caller stays responsive', async () => {
  writeFileSync(join(wt, 'src', 'redos.txt'), `${'a'.repeat(40)}!\n`);
  try {
    const slow = createAskFileReader({ roots: askFileRoots({ home, threadId: T }), home: wt, redact: (s) => s, limits: { ...ASK_FILE_LIMITS, grepTimeoutMs: 300 } });
    let ticks = 0;
    const iv = setInterval(() => { ticks += 1; }, 20);
    const t0 = Date.now();
    await assert.rejects(slow.grep({ pattern: '^(a+)+$', glob: '**/redos.txt' }), (err) => err.name === 'AskFileError' && /ran longer than/.test(err.message));
    clearInterval(iv);
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
    assert.ok(ticks >= 3, `the event loop kept turning (${ticks} ticks)`);
  } finally { rmSync(join(wt, 'src', 'redos.txt'), { force: true }); }
});

test('grep: each search worker loads only the reader and its small imports, not the Worca home\'s database or settings', () => {
  // Those modules (projects.mjs → db.mjs, store.mjs, settings.mjs) once made up about a third of a worker's start.
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"](\.[^'"]+)['"]/gm)) visit(join(dirname(file), spec));
  };
  const askDir = dirname(fileURLToPath(new URL('../src/core/ask/grep-worker.mjs', import.meta.url)));
  visit(join(askDir, 'grep-worker.mjs'));
  const rel = [...seen].map((f) => f.slice(dirname(askDir).length + 1).split('\\').join('/')).sort();
  assert.deepEqual(rel, ['ask/deny-rules.mjs', 'ask/file-reader.mjs', 'ask/grep-worker.mjs', 'ask/redact.mjs', 'chat/redact.mjs']);
});

test('grep: the turn ending stops a running search', async () => {
  writeFileSync(join(wt, 'src', 'redos2.txt'), `${'a'.repeat(40)}!\n`);
  try {
    const life = new AbortController();
    const r = createAskFileReader({ roots: askFileRoots({ home, threadId: T }), home: wt, redact: (s) => s, signal: life.signal });
    const t0 = Date.now();
    const p = r.grep({ pattern: '^(a+)+$', glob: '**/redos2.txt' });
    setTimeout(() => life.abort(), 100);
    await assert.rejects(p, (err) => err.name === 'AskFileError' && /turn ended/.test(err.message));
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  } finally { rmSync(join(wt, 'src', 'redos2.txt'), { force: true }); }
});

test('glob: paths relative to the folder; denied paths never listed; an absolute pattern refused', () => {
  const names = reader.glob({ pattern: '**/*' }).paths.map((p) => p.slice(wt.length + 1)).sort();
  assert.deepEqual(names, ['bin.dat', 'src/a.mjs', 'src/b.txt']);
  assert.throws(() => reader.glob({ pattern: '/etc/*' }), /relative to path/);
});

test('glob and grep stop after walkMaxEntries visited entries, matched or not, and say so', async () => {
  const tight = createAskFileReader({ roots: askFileRoots({ home, threadId: T }), home: wt, redact: (s) => s, limits: { ...ASK_FILE_LIMITS, walkMaxEntries: 2 } });
  assert.deepEqual(tight.glob({ pattern: '**/*.nomatch' }), { paths: [], truncated: true });
  assert.equal((await tight.grep({ pattern: 'nomatch-anywhere' })).truncated, true);
  assert.equal(reader.glob({ pattern: '**/*.nomatch' }).truncated, false, 'a whole walk under the cap is not truncated');
});

test('grep and glob never follow a symlink', POSIX, async () => {
  assert.equal(reader.glob({ pattern: '**/*' }).paths.some((p) => p.includes('link-')), false);
  assert.equal((await reader.grep({ pattern: 'outside' })).matches.length, 0);
});

test('defaultFileDeps: only a Codex chat child gets the readers', () => {
  assert.deepEqual(defaultFileDeps({ threadId: T, env: {} }), {});
  const d = defaultFileDeps({ threadId: T, env: { WORCA_ASK_ENGINE: 'codex' } });
  assert.equal(d.engine, 'codex');
  assert.equal(typeof d.files.readFile, 'function');
});

test('createAskTools: the file tools exist only with deps.files; reader errors reach the model as tool errors', async () => {
  const base = { limits: ASK_LIMITS, redact: (s) => s };
  const names = (t) => t.list().map((d) => d.name);
  assert.equal(names(createAskTools(base)).includes('read_file'), false);
  const tools = createAskTools({ ...base, engine: 'codex', files: reader });
  assert.deepEqual(names(tools).slice(-3), ['read_file', 'grep', 'glob']);
  const r = await tools.call('read_file', { path: join(wt, 'src', 'b.txt') });
  assert.match(r.text, /two words/);
  await assert.rejects(() => tools.call('read_file', { path: outside }), (e) => e instanceof AskToolError && /outside/.test(e.message));
  await assert.rejects(() => tools.call('grep', { pattern: '(' }), (e) => e instanceof AskToolError && /invalid regular expression/.test(e.message), 'the worker\'s rejection is mapped too');
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const mediaTools = (over = {}) => createAskTools({ limits: ASK_LIMITS, redact: (s) => s, engine: 'gemini', chatImages: true, chatPdfs: true, files: reader,
  mediaElsewhere: (w) => `${w}: X chats can`,
  readAttachment: (id) => (id === 'att_00000003'
    ? { name: 'doc.pdf', kind: 'binary', mime: 'application/pdf', bytes: 5, path: '/x/att.pdf' }
    : { name: 'shot.png', kind: 'image', mime: 'image/png', bytes: PNG.length, path: '/x/att.png' }),
  readAttachmentBody: (id) => (id === 'att_00000003' ? Buffer.from('%PDF-') : PNG), ...over });

test('read_attachment in a locked-down chat: an image comes back as an MCP image block of the result, never a path', async () => {
  const r = await mediaTools().call('read_attachment', { id: 'att_00000002' });
  assert.equal(r.path, undefined);
  assert.deepEqual(r[MCP_CONTENT], [{ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }]);
  assert.match(r.note, /attached to this result/);
  const codex = await mediaTools({ engine: 'codex', chatPdfs: false }).call('read_attachment', { id: 'att_00000002' });
  assert.match(codex.note, /content\[1\].*image\(\)/, 'a Codex chat is told to forward the block with image() in exec');
});

test('read_attachment in a locked-down chat: a PDF rides as an embedded resource; an engine that cannot view it gets a note', async () => {
  const r = await mediaTools().call('read_attachment', { id: 'att_00000003' });
  assert.deepEqual(r[MCP_CONTENT], [{ type: 'resource', resource: { uri: 'worca://attachment/att_00000003', mimeType: 'application/pdf', blob: Buffer.from('%PDF-').toString('base64') } }]);
  const goose = await mediaTools({ engine: 'goose', chatPdfs: false }).call('read_attachment', { id: 'att_00000003' });
  assert.equal(goose[MCP_CONTENT], undefined);
  assert.match(goose.note, /cannot view PDFs — pdfs: X chats can/);
  const off = await mediaTools({ engine: 'gemini', chatImages: false, chatPdfs: false }).call('read_attachment', { id: 'att_00000002' });
  assert.equal(off[MCP_CONTENT], undefined);
  assert.match(off.note, /cannot view images/);
});

test('read_attachment in a Copilot chat: the block rides, and the note says Copilot hands it on only to a model that can view it', async () => {
  const tools = mediaTools({ engine: 'copilot' });
  const img = await tools.call('read_attachment', { id: 'att_00000002' });
  assert.deepEqual(img[MCP_CONTENT], [{ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }]);
  assert.match(img.note, /Copilot attaches it right after this result when your model can view images: .*if it did not reach you, tell the user this model cannot view it/);
  const pdf = await tools.call('read_attachment', { id: 'att_00000003' });
  assert.equal(pdf[MCP_CONTENT][0].resource.mimeType, 'application/pdf');
  assert.match(pdf.note, /when your model can view PDFs/);
});

test('read_attachment: an image past the inline cap is described, not sent', async () => {
  const tools = mediaTools({ readAttachment: () => ({ name: 'big.png', kind: 'image', mime: 'image/png', bytes: MCP_MEDIA_MAX_BYTES + 1, path: '/x' }),
    readAttachmentBody: () => { throw new Error('never read'); } });
  const r = await tools.call('read_attachment', { id: 'att_00000002' });
  assert.equal(r[MCP_CONTENT], undefined);
  assert.match(r.note, /too large/);
});

test('read_file: an image or PDF inside the roots comes back as media; outside the roots it is refused as before', async () => {
  put(join(wt, 'docs', 'shot.png'), PNG);
  const r = await mediaTools().call('read_file', { path: join(wt, 'docs', 'shot.png') });
  assert.deepEqual(r[MCP_CONTENT], [{ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }]);
  await assert.rejects(mediaTools().call('read_file', { path: join(root, 'outside.png') }), AskToolError);
});

test('the MCP server sends a media result\'s block after its JSON text, and drops the key from the JSON', async () => {
  const lines = [];
  const srv = createRpcServer({ tools: { list: () => [{ name: 'm' }], call: async () => ({ name: 'a.png', [MCP_CONTENT]: [{ type: 'image', data: 'QQ==', mimeType: 'image/png' }] }) }, write: (l) => lines.push(JSON.parse(l)) });
  await srv.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'm', arguments: {} } }));
  assert.deepEqual(lines[0].result.content, [{ type: 'text', text: '{"name":"a.png"}' }, { type: 'image', data: 'QQ==', mimeType: 'image/png' }]);
});
