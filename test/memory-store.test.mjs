import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  GLOBAL_SCOPE, projectScope, scopeKey, scopeDir, isValidMemoryName, flattenLine,
  parseMemoryFile, renderMemoryFile, repairMemoryFile, HOOK_MAX_CHARS, MemoryError,
} from '../src/core/memory-store.mjs';

const C = String.fromCharCode;

test('scopes: keys and dirs', () => {
  assert.equal(scopeKey(GLOBAL_SCOPE), 'global');
  assert.equal(scopeKey(projectScope('worca-cc-1a2b3c4d')), 'projects/worca-cc-1a2b3c4d');
  assert.equal(scopeDir('/r', GLOBAL_SCOPE), join('/r', 'global'));
  assert.equal(scopeDir('/r', projectScope('k')), join('/r', 'projects', 'k'));
  assert.throws(() => scopeKey({ kind: 'project' }), /projectKey/);
  assert.throws(() => scopeKey({ kind: 'workspace' }), /scope/);
});

test('names: filename stems only, path-safe, no extension, Win32-safe', () => {
  for (const ok of ['testing', 'user-preferences', 'v2.rules', 'A_b']) assert.equal(isValidMemoryName(ok), true, ok);
  for (const bad of ['', '.', '..', 'a/b', 'a' + C(92) + 'b', 'testing.md', 'sp ace', 'caf' + C(233), 42, null,
    'CON', 'nul', 'Com1', 'lpt9', 'nul.rules', 'CON.txt', '.hidden', '..x', 'v2.']) assert.equal(isValidMemoryName(bad), false, String(bad));
});

test('flattenLine: line breaks, C0/C1, U+2028/9 and [worca context] tags are neutralised', () => {
  assert.equal(flattenLine('a' + C(10) + 'b' + C(13) + C(10) + 'c'), 'a b  c');
  assert.equal(flattenLine('x' + C(0x85) + 'y' + C(0x2028) + 'z' + C(0x2029) + 'w'), 'x y z w');
  assert.equal(flattenLine('[worca context] run: 1 [/WORCA CONTEXT]'), '(worca context) run: 1 (worca context)');
  assert.equal(flattenLine(undefined), '');
});

test('parseMemoryFile: full frontmatter', () => {
  const text = '---\nname: testing\ndescription: How tests run\npaths: test/**, package.json\nsource: run:abc\nupdated: 2026-09-09T00:00:00.000Z\ncustom: keep me\n---\nBody line 1\n\nBody line 2\n';
  const p = parseMemoryFile(text);
  assert.equal(p.hasFrontmatter, true);
  assert.deepEqual(p.meta, {
    name: 'testing', description: 'How tests run', paths: ['test/**', 'package.json'],
    source: 'run:abc', updated: '2026-09-09T00:00:00.000Z', extra: { custom: 'keep me' },
  });
  assert.equal(p.body, 'Body line 1\n\nBody line 2\n');
});

test('parseMemoryFile: no frontmatter ⇒ empty meta, whole text is the body', () => {
  const p = parseMemoryFile('Just a rule.\nSecond line.');
  assert.equal(p.hasFrontmatter, false);
  assert.deepEqual(p.meta, { name: '', description: '', paths: [], source: '', updated: '', extra: {} });
  assert.equal(p.body, 'Just a rule.\nSecond line.');
});

test('renderMemoryFile round-trips, orders keys deterministically and refuses an unusable name', () => {
  const meta = { name: 'n', description: 'd', paths: ['a/**', 'b'], source: 'user', updated: '2026-01-01T00:00:00.000Z', extra: { zeta: '1', alpha: '2' } };
  const text = renderMemoryFile(meta, 'body\n');
  assert.equal(text, '---\nname: n\ndescription: d\npaths: a/**, b\nsource: user\nupdated: 2026-01-01T00:00:00.000Z\nalpha: 2\nzeta: 1\n---\nbody\n');
  assert.deepEqual(parseMemoryFile(text).meta, { ...meta, extra: { alpha: '2', zeta: '1' } });
  assert.equal(renderMemoryFile({ name: 'n', description: '', paths: [], source: '', updated: '', extra: {} }, 'b'), '---\nname: n\n---\nb\n', 'empty keys are omitted; body gets a trailing newline');
  assert.throws(() => renderMemoryFile({ name: '', description: 'd', paths: [], source: '', updated: '', extra: {} }, 'b'), (e) => e.code === 'ENAME');
  assert.equal(renderMemoryFile({ name: 'n', description: '', paths: [], source: '', updated: '', extra: { 'bad key': '1', ok_key: '2' } }, 'b'), '---\nname: n\nok_key: 2\n---\nb\n', 'an unrenderable extra key is dropped');
});

test('repairMemoryFile: adds a fence, fixes the name, derives the hook, stamps source/updated', () => {
  const now = '2026-09-09T10:00:00.000Z';
  const r = repairMemoryFile('  \nAlways run npm ci first.\nMore.', { name: 'setup', source: 'run:p1', now });
  assert.equal(r.changed, true);
  assert.deepEqual(r.meta, { name: 'setup', description: 'Always run npm ci first.', paths: [], source: 'run:p1', updated: now, extra: {} });
  assert.equal(r.text, `---\nname: setup\ndescription: Always run npm ci first.\nsource: run:p1\nupdated: ${now}\n---\n  \nAlways run npm ci first.\nMore.\n`);
  const long = 'x'.repeat(HOOK_MAX_CHARS + 20);
  const r2 = repairMemoryFile(`---\nname: other\ndescription: ${long}\npaths: src/**\n---\nb\n`, { name: 'setup', source: 'ask:t1', now });
  assert.equal(r2.meta.name, 'setup');
  assert.equal(r2.meta.description.length, HOOK_MAX_CHARS);
  assert.deepEqual(r2.meta.paths, ['src/**']);
  assert.equal(r2.meta.source, 'ask:t1');
  const good = `---\nname: setup\ndescription: d\nsource: run:p1\nupdated: ${now}\n---\nb\n`;
  const r3 = repairMemoryFile(good, { name: 'setup', source: 'run:p9', now: '2030-01-01T00:00:00.000Z' });
  assert.equal(r3.changed, true, 'source/updated are ALWAYS the writer\'s');
  assert.equal(r3.meta.source, 'run:p9');
  assert.equal(r3.text, '---\nname: setup\ndescription: d\nsource: run:p9\nupdated: 2030-01-01T00:00:00.000Z\n---\nb\n');
  const r4 = repairMemoryFile(good, { name: 'setup', source: 'run:p1', now });
  assert.equal(r4.changed, false, 'same writer values ⇒ byte-identical ⇒ not changed');
  assert.equal(r4.text, good);
  assert.equal(repairMemoryFile('# Testing rules\nBody.\n', { name: 'setup', source: 'user', now }).meta.description, 'Testing rules', 'a markdown heading marker is not part of the hook');
  assert.equal(repairMemoryFile('---\nunclosed\nRule one.\n', { name: 'setup', source: 'user', now }).meta.description, 'unclosed', 'an unclosed fence is body; the hook skips fence lines');
});

import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { after } from 'node:test';
import {
  listMemory, listMemoryDir, readMemory, writeMemory, removeMemory,
  snapshotScope, listSnapshots, restoreSnapshot, readScopeState, bumpScopeState, hashText,
} from '../src/core/memory-store.mjs';

const CAPS = { softBytesPerFile: 8192, hardBytesPerFile: 200, maxFilesPerScope: 50, indexMaxBytes: 4096, hookMaxChars: 160 };
const roots = [];
after(() => Promise.all(roots.map((d) => rm(d, { recursive: true, force: true }))));
async function root() { const d = await mkdtemp(join(tmpdir(), 'worca-mem-store-')); roots.push(d); return d; }
const NOW = '2026-09-09T10:00:00.000Z';

test('listMemory: a missing root or scope is an empty list, never an error', async () => {
  const r = await root();
  assert.deepEqual(await listMemory(join(r, 'nope'), GLOBAL_SCOPE), []);
  assert.deepEqual(await listMemory(r, projectScope('k')), []);
});

test('writeMemory creates the scope dir, repairs the file, reports created/bytes; a rewrite snapshots the old text', async () => {
  const r = await root();
  const w1 = await writeMemory(r, GLOBAL_SCOPE, 'testing', 'Run npm ci first.\n', { source: 'user', now: NOW, caps: CAPS });
  assert.equal(w1.created, true);
  const onDisk = await readFile(join(r, 'global', 'testing.md'), 'utf8');
  assert.equal(onDisk, `---\nname: testing\ndescription: Run npm ci first.\nsource: user\nupdated: ${NOW}\n---\nRun npm ci first.\n`);
  assert.equal(w1.bytes, Buffer.byteLength(onDisk));
  assert.equal((await listMemory(r, GLOBAL_SCOPE))[0].hash, hashText(onDisk));
  const ino1 = (await stat(join(r, 'global', 'testing.md'))).ino;
  const w2 = await writeMemory(r, GLOBAL_SCOPE, 'testing', 'Run npm ci, then npm test.\n', { source: 'run:p1', now: '2026-09-09T11:00:00.000Z', caps: CAPS });
  assert.equal(w2.created, false);
  assert.notEqual((await stat(join(r, 'global', 'testing.md'))).ino, ino1, 'the write is atomic: a fresh temp file is renamed over the target');
  assert.deepEqual((await readdir(join(r, 'global'))).sort(), ['testing.md'], 'no .tmp- litter beside the target');
  const snaps = await listSnapshots(r, GLOBAL_SCOPE);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].id, '20260909-110000-run-p1');
  assert.equal(await readFile(join(snaps[0].dir, 'testing.md'), 'utf8'), onDisk, 'the snapshot holds the PREVIOUS text');
  assert.deepEqual(await readScopeState(r, GLOBAL_SCOPE), { writesSinceDefrag: 2, lastWriteAt: '2026-09-09T11:00:00.000Z', lastDefragAt: null, lastDefragRunId: null });
});

test('writeMemory: invalid name, case collision and hard cap are MemoryErrors with codes', async () => {
  const r = await root();
  await writeMemory(r, GLOBAL_SCOPE, 'testing', 'x', { source: 'user', now: NOW, caps: CAPS });
  await assert.rejects(() => writeMemory(r, GLOBAL_SCOPE, 'Testing', 'y', { source: 'user', now: NOW, caps: CAPS }), (e) => e instanceof MemoryError && e.code === 'ECASE');
  await assert.rejects(() => writeMemory(r, GLOBAL_SCOPE, 'bad/name', 'y', { source: 'user', now: NOW, caps: CAPS }), (e) => e.code === 'ENAME');
  await assert.rejects(() => writeMemory(r, GLOBAL_SCOPE, 'big', 'z'.repeat(CAPS.hardBytesPerFile + 1), { source: 'user', now: NOW, caps: CAPS }), (e) => e.code === 'ETOOBIG');
  assert.equal(existsSync(join(r, 'global', 'big.md')), false, 'nothing is written on rejection');
});

test('readMemory / removeMemory', async () => {
  const r = await root();
  assert.equal(await readMemory(r, GLOBAL_SCOPE, 'missing'), null);
  await writeMemory(r, projectScope('k'), 'conv', '---\nname: conv\ndescription: d\n---\nbody\n', { source: 'user', now: NOW, caps: CAPS });
  const got = await readMemory(r, projectScope('k'), 'conv');
  assert.equal(got.meta.description, 'd');
  assert.equal(got.body, 'body\n');
  assert.equal(await removeMemory(r, projectScope('k'), 'conv', { source: 'ask:t1', now: '2026-09-09T12:00:00.000Z' }), true);
  assert.equal(await readMemory(r, projectScope('k'), 'conv'), null);
  assert.equal(await removeMemory(r, projectScope('k'), 'conv', { source: 'ask:t1', now: NOW }), false);
  const snaps = await listSnapshots(r, projectScope('k'));
  assert.deepEqual(snaps.map((s) => s.id), ['20260909-120000-ask-t1']);
  assert.deepEqual(snaps[0].files, ['conv.md']);
});

test('snapshots: ring keeps the newest `keep`, same-second labels get a zero-padded suffix, restore replaces the scope', async () => {
  const r = await root();
  await writeMemory(r, GLOBAL_SCOPE, 'a', 'A1', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(r, GLOBAL_SCOPE, 'b', 'B1', { source: 'user', now: NOW, caps: CAPS });
  for (let i = 0; i < 3; i++) await snapshotScope(r, GLOBAL_SCOPE, { source: 'user', now: NOW, keep: 2 });
  const ids = (await listSnapshots(r, GLOBAL_SCOPE)).map((s) => s.id);
  assert.deepEqual(ids, ['20260909-100000-user-03', '20260909-100000-user-04'], 'the ring keeps the NEWEST two; suffixes climb past the highest existing one and are zero-padded');
  const snapId = ids[ids.length - 1];
  await writeMemory(r, GLOBAL_SCOPE, 'a', 'A2', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(r, GLOBAL_SCOPE, 'c', 'C1', { source: 'user', now: NOW, caps: CAPS });
  await restoreSnapshot(r, GLOBAL_SCOPE, snapId, { source: 'user', now: '2026-09-09T13:00:00.000Z' });
  assert.deepEqual((await listMemory(r, GLOBAL_SCOPE)).map((e) => e.name), ['a', 'b'], 'c (absent in the snapshot) is gone');
  assert.match((await readMemory(r, GLOBAL_SCOPE, 'a')).body, /A1/);
  assert.ok((await listSnapshots(r, GLOBAL_SCOPE)).some((s) => s.id === '20260909-130000-user'), 'restore snapshots first');
  await assert.rejects(() => restoreSnapshot(r, GLOBAL_SCOPE, '../../etc', { source: 'user', now: NOW }), (e) => e.code === 'ENAME');
});

test('listMemoryDir: only valid *.md stems; junk is skipped and reported; a fence-less file still gets a hook', async () => {
  const r = await root();
  const dir = join(r, 'global');
  await mkdir(join(dir, 'sub'), { recursive: true });
  await writeFile(join(dir, 'ok.md'), '---\nname: ok\ndescription: fine\n---\nb\n');
  await writeFile(join(dir, 'bad name.md'), 'x');
  await writeFile(join(dir, 'notes.txt'), 'x');
  await writeFile(join(dir, '.hidden.md'), 'x');
  await writeFile(join(dir, 'raw.md'), 'Just a rule.\nMore.\n');
  const reported = [];
  const list = await listMemoryDir(dir, { onError: (p, err) => reported.push({ p, code: err.code }) });
  assert.deepEqual(list.map((e) => e.name), ['ok', 'raw']);
  assert.deepEqual(reported.map((x) => x.code).sort(), ['ENAME', 'ENAME'], 'bad name.md and .hidden.md are both reported');
  assert.equal(list[0].hasFrontmatter, true);
  assert.equal(list[1].hasFrontmatter, false);
  assert.equal(list[1].description, 'Just a rule.', 'no fence ⇒ hook from the first body line');
});

test('bumpScopeState: defrag stamps reset the write counter', async () => {
  const r = await root();
  await bumpScopeState(r, GLOBAL_SCOPE, { writesSinceDefrag: 3, lastWriteAt: NOW });
  await bumpScopeState(r, GLOBAL_SCOPE, { writesSinceDefrag: 0, lastDefragAt: NOW, lastDefragRunId: 'p1' });
  assert.deepEqual(await readScopeState(r, GLOBAL_SCOPE), { writesSinceDefrag: 0, lastWriteAt: NOW, lastDefragAt: NOW, lastDefragRunId: 'p1' });
});

import { renderMemoryIndex, MEMORY_INDEX_HEADING, MEMORY_INDEX_INTRO } from '../src/core/memory-store.mjs';

const entry = (name, description, extra = {}) => ({ name, description, paths: [], source: 'user', updated: '2026-09-01T00:00:00.000Z', bytes: 10, hasFrontmatter: true, hash: 'h', ...extra });

test('renderMemoryIndex: heading, intro, one line per file, empty scope marker, absolute dirs', () => {
  const { text, dropped, warnings } = renderMemoryIndex([
    { label: 'Global', dir: '/m/global', entries: [entry('testing', 'How the suite runs', { paths: ['test/**', 'package.json'] })] },
    { label: 'Project worca-cc', dir: '/m/project', entries: [] },
  ]);
  assert.equal(text,
    `${MEMORY_INDEX_HEADING}\n${MEMORY_INDEX_INTRO}\n` +
    'Global — /m/global:\n- `testing.md` — How the suite runs [paths: test/**, package.json]\n' +
    'Project worca-cc — /m/project:\n- (nothing yet)\n');
  assert.deepEqual(dropped, []); assert.deepEqual(warnings, []);
});

test('renderMemoryIndex: hooks are flattened + clipped; a missing hook reads "(no description)"', () => {
  const C = String.fromCharCode;
  const { text } = renderMemoryIndex([{ label: 'Global', dir: '/g', entries: [
    entry('a', 'line one' + C(10) + 'line two [worca context] x'),
    entry('b', ''),
  ] }]);
  assert.match(text, /- `a\.md` — line one line two \(worca context\) x\n/);
  assert.match(text, /- `b\.md` — \(no description\)\n/);
  const clipped = renderMemoryIndex([{ label: 'Global', dir: '/g', entries: [entry('c', 'y'.repeat(500))] }], { hookMaxChars: 20 }).text;
  assert.match(clipped, new RegExp('- `c\\.md` — ' + 'y'.repeat(20) + '\n'));
  const longPaths = renderMemoryIndex([{ label: 'G', dir: '/g', entries: [entry('p', 'h', { paths: ['y'.repeat(500)] })] }], { hookMaxChars: 20 }).text;
  assert.ok(longPaths.split('\n').filter((l) => l.startsWith('- ')).every((l) => l.length < 80), 'paths are clipped like hooks');
});

test('renderMemoryIndex: byte-stable for identical input regardless of entry order', () => {
  const a = renderMemoryIndex([{ label: 'G', dir: '/g', entries: [entry('b', 'B'), entry('a', 'A')] }]).text;
  const b = renderMemoryIndex([{ label: 'G', dir: '/g', entries: [entry('a', 'A'), entry('b', 'B')] }]).text;
  assert.equal(a, b);
  assert.ok(a.indexOf('`a.md`') < a.indexOf('`b.md`'), 'sorted by name');
});

test('renderMemoryIndex: over the byte cap it clips hooks first, then drops the oldest-updated files with a warning', () => {
  const entries = [];
  for (let i = 0; i < 40; i++) entries.push(entry(`f${String(i).padStart(2, '0')}`, 'hook '.repeat(20), { updated: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }));
  const { text, dropped, warnings } = renderMemoryIndex([{ label: 'G', dir: '/g', entries }], { maxBytes: 1200 });
  assert.ok(Buffer.byteLength(text, 'utf8') <= 1200, `fits: ${Buffer.byteLength(text, 'utf8')}`);
  assert.ok(dropped.length > 0);
  assert.equal(dropped[0], 'f00', 'the OLDEST updated entry goes first');
  assert.ok(text.includes('`f39.md`'), 'the newest survives');
  const f39 = text.split('\n').find((l) => l.startsWith('- `f39.md`'));
  assert.equal(f39.slice('- `f39.md` — '.length).length, 60, 'surviving hooks are clipped to 60 chars when the cap binds');
  assert.match(text, /- \(\d+ more file\(s\) not listed\)\n/, 'the agent is told files are hidden');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /memory index: dropped \d+ file\(s\) to fit 1200 bytes: f00/);
});

test('snapshotScope / restoreSnapshot: junk-named files are skipped, never a reason to fail the scope', async () => {
  const r = await root();
  await writeMemory(r, GLOBAL_SCOPE, 'ok', 'Fine.\n', { source: 'user', now: NOW, caps: CAPS });
  await writeFile(join(r, 'global', 'my notes.md'), 'Dropped in by hand.\n');
  const id = await snapshotScope(r, GLOBAL_SCOPE, { source: 'user', now: NOW });
  const snaps = await listSnapshots(r, GLOBAL_SCOPE);
  assert.deepEqual(snaps.map((s) => s.id), [id]);
  assert.deepEqual(snaps[0].files, ['ok.md'], 'junk is not a memory file: not snapshotted');
  await writeMemory(r, GLOBAL_SCOPE, 'later', 'Later.\n', { source: 'user', now: NOW, caps: CAPS });
  await restoreSnapshot(r, GLOBAL_SCOPE, id, { source: 'user', now: NOW });
  assert.deepEqual((await listMemory(r, GLOBAL_SCOPE)).map((e) => e.name), ['ok'], 'later is gone');
  assert.equal(existsSync(join(r, 'global', 'my notes.md')), true, 'the junk file is left alone');
});

test('snapshotScope: a REAL read error still fails the snapshot', {
  skip: process.platform === 'win32' ? 'chmod 000 does not deny reads on Windows'
    : process.getuid?.() === 0 ? 'root reads through a 000 file' : false,
}, async () => {
  const r = await root();
  await writeMemory(r, GLOBAL_SCOPE, 'ok', 'Fine.\n', { source: 'user', now: NOW, caps: CAPS });
  const locked = join(r, 'global', 'locked.md');
  await writeFile(locked, '---\nname: locked\ndescription: d\n---\nb\n');
  await chmod(locked, 0o000);
  try {
    await assert.rejects(() => snapshotScope(r, GLOBAL_SCOPE, { source: 'user', now: NOW }), (e) => e.code === 'EACCES');
  } finally { await chmod(locked, 0o644); }
});
