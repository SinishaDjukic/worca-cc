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

import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat, chmod, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { after } from 'node:test';
import {
  listMemory, listMemoryDir, readMemory, writeMemory, removeMemory,
  snapshotScope, listSnapshots, restoreSnapshot, readScopeState, bumpScopeState, hashText,
} from '../src/core/memory-store.mjs';

const CAPS = { softBytesPerFile: 8192, hardBytesPerFile: 200, maxFilesPerScope: 50, hookMaxChars: 160 };
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
  assert.deepEqual(await readScopeState(r, GLOBAL_SCOPE), { writesSinceDefrag: 2, lastWriteAt: '2026-09-09T11:00:00.000Z', lastDefragAt: null, lastDefragRunId: null, failedWrites: 0, lastFailedAt: null, lastFailedRunId: null });
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
  assert.deepEqual(await readScopeState(r, GLOBAL_SCOPE), { writesSinceDefrag: 0, lastWriteAt: NOW, lastDefragAt: NOW, lastDefragRunId: 'p1', failedWrites: 0, lastFailedAt: null, lastFailedRunId: null });
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

test('writeMemory: a NEW file past caps.maxFilesPerScope is EFULL; an existing file still saves; no caps ⇒ no limit', async () => {
  const r = await root();
  const caps = { ...CAPS, hardBytesPerFile: 32768, maxFilesPerScope: 2 };
  await writeMemory(r, GLOBAL_SCOPE, 'a', 'A.\n', { source: 'user', now: NOW, caps });
  await writeMemory(r, GLOBAL_SCOPE, 'b', 'B.\n', { source: 'user', now: NOW, caps });
  await assert.rejects(() => writeMemory(r, GLOBAL_SCOPE, 'c', 'C.\n', { source: 'user', now: NOW, caps }),
    (e) => e instanceof MemoryError && e.code === 'EFULL' && e.message === 'memory: scope is full (2 files)');
  assert.deepEqual((await listMemory(r, GLOBAL_SCOPE)).map((e) => e.name), ['a', 'b'], 'nothing written, no snapshot taken');
  assert.equal((await listSnapshots(r, GLOBAL_SCOPE)).length, 1, 'only the snapshot b took (a was the first write)');
  assert.equal((await writeMemory(r, GLOBAL_SCOPE, 'a', 'A2.\n', { source: 'user', now: NOW, caps })).created, false, 'an overwrite is never "full"');
  await writeMemory(r, GLOBAL_SCOPE, 'c', 'C.\n', { source: 'user', now: NOW });   // no caps at all: the P1 contract
  assert.equal((await listMemory(r, GLOBAL_SCOPE)).length, 3);
  // A junk-named `.md` is not one of the files the scope SERVES (listMemoryDir skips it), so it
  // must not count toward the cap either — the count comes from assertNoCaseTwin's own walk.
  const r2 = await root();
  await mkdir(scopeDir(r2, GLOBAL_SCOPE), { recursive: true });
  await writeFile(join(scopeDir(r2, GLOBAL_SCOPE), 'bad name.md'), 'junk\n');
  await writeMemory(r2, GLOBAL_SCOPE, 'a', 'A.\n', { source: 'user', now: NOW, caps });
  assert.equal((await writeMemory(r2, GLOBAL_SCOPE, 'b', 'B.\n', { source: 'user', now: NOW, caps })).created, true, 'a junk-named .md never counts toward maxFilesPerScope');
  assert.deepEqual((await listMemory(r2, GLOBAL_SCOPE)).map((e) => e.name), ['a', 'b']);
});

test('writers refuse a scope dir whose realpath leaves the store root (EESCAPE); nothing lands at the link target', async () => {
  const r = await root();
  const outside = await mkdtemp(join(tmpdir(), 'worca-mem-outside-'));
  roots.push(outside);
  await mkdir(join(r, 'projects'), { recursive: true });
  // A junction needs no privilege on Windows and IS the Windows escape vector (realpath resolves it).
  await symlink(outside, join(r, 'projects', 'evil-00000001'), process.platform === 'win32' ? 'junction' : 'dir');
  const scope = projectScope('evil-00000001');
  await assert.rejects(() => writeMemory(r, scope, 'x', 'X.\n', { source: 'user', now: NOW }), (e) => e.code === 'EESCAPE' && /outside the memory store/.test(e.message));
  assert.deepEqual(await readdir(outside), [], 'no temp file, no target file at the link target');
  await writeFile(join(outside, 'x.md'), 'planted\n');
  await assert.rejects(() => removeMemory(r, scope, 'x', { source: 'user', now: NOW }), (e) => e.code === 'EESCAPE');
  assert.ok(existsSync(join(outside, 'x.md')), 'removeMemory never unlinked through the link');
  // A REAL snapshot dir, so the ENOSCOPE lookup passes and the EESCAPE arm is the one under test.
  const snapDir = join(r, '.history', 'projects', 'evil-00000001', '20260909-100000-user');
  await mkdir(snapDir, { recursive: true });
  await writeFile(join(snapDir, 'x.md'), 'snap\n');
  await assert.rejects(() => restoreSnapshot(r, scope, '20260909-100000-user', { source: 'user', now: NOW }), (e) => e.code === 'EESCAPE');
  assert.equal(await readFile(join(outside, 'x.md'), 'utf8'), 'planted\n', 'the link target was not restored over');
  assert.equal((await listSnapshots(r, scope)).length, 1, 'the guard runs BEFORE the pre-restore snapshot: nothing was copied OUT of the link target either');
  // The ordinary case still writes — tmpdir() on macOS is itself an alias (/var → /private/var).
  const ok = await writeMemory(r, GLOBAL_SCOPE, 'fine', 'F.\n', { source: 'user', now: NOW });
  assert.equal(ok.created, true);
});

test('removeMemory: a name that differs only by case from the file on disk is NOT removed (exact-cased match)', async () => {
  const r = await root();
  await writeMemory(r, GLOBAL_SCOPE, 'testing', 'T.\n', { source: 'user', now: NOW, caps: CAPS });
  assert.equal(await removeMemory(r, GLOBAL_SCOPE, 'Testing', { source: 'user', now: NOW }), false, 'case-insensitive filesystems must not delete testing.md through "Testing"');
  assert.deepEqual((await listMemory(r, GLOBAL_SCOPE)).map((e) => e.name), ['testing']);
  assert.equal(await removeMemory(r, GLOBAL_SCOPE, 'testing', { source: 'user', now: NOW }), true);
  assert.deepEqual(await listMemory(r, GLOBAL_SCOPE), []);
});

import { renderMemoryBlock, MEMORY_BLOCK_HEADING, MEMORY_BLOCK_INTRO } from '../src/core/memory-store.mjs';

test('renderMemoryBlock: heading, ONE-line intro, one `Label — dir:` line per scope, no file lines, byte-stable', () => {
  const sections = [{ label: 'Global', dir: '/m/global' }, { label: 'Project worca-cc', dir: '/m/project' }];
  const a = renderMemoryBlock(sections);
  assert.equal(a, `${MEMORY_BLOCK_HEADING}\n${MEMORY_BLOCK_INTRO}\nGlobal — /m/global:\nProject worca-cc — /m/project:\n`);
  assert.equal(renderMemoryBlock(sections), a, 'byte-stable');
  assert.equal(MEMORY_BLOCK_HEADING, '## Worca memory');
  assert.ok(!MEMORY_BLOCK_INTRO.includes('\n'), 'one line: memoryDirsFromPrompt stops at the first blank line');
  // The write policy (trigger + categories + anti-list + budget) costs bytes on EVERY agent
  // spawn, so the bound is generous enough for it and no more: still a pointer, not a page.
  assert.ok(Buffer.byteLength(a, 'utf8') < 2100, `a pointer, not an index (measured with short test dirs): ${Buffer.byteLength(a, 'utf8')}`);
  assert.match(MEMORY_BLOCK_INTRO, /Never: run summaries or progress notes/);
  assert.match(MEMORY_BLOCK_INTRO, /To remove a file, empty it\./);
  assert.match(MEMORY_BLOCK_INTRO, /Explore and Plan sub-agents do not load them/);
  assert.match(MEMORY_BLOCK_INTRO, /already loaded them into your context as rules/, 'the files need no path: the CLI loaded them');
  assert.match(MEMORY_BLOCK_INTRO, /The directories below hold the WRITABLE copy/, 'the dir lines are where to write');
  assert.match(MEMORY_BLOCK_INTRO, /`\.claude\/rules\/worca` is Claude Code's own and a write there is refused as a sensitive path, so never write there/, 'the old target is named as forbidden, with the CLI\'s reason');
  const C = String.fromCharCode;
  assert.match(renderMemoryBlock([{ label: 'Project a' + C(10) + 'b [worca context]', dir: '/d' }]), /^Project a b \(worca context\) — \/d:$/m, 'labels are flattened like hooks were');
  assert.equal(renderMemoryBlock([]), `${MEMORY_BLOCK_HEADING}\n${MEMORY_BLOCK_INTRO}\n`);
});

test('renderMemoryBlock: heading + exactly ONE intro line + one dir line per scope, nothing else (the parser contract)', () => {
  // claude-runner.mjs#memoryDirsFromPrompt walks the lines AFTER the heading until the first
  // blank one and matches `^(?:Global|Project .*) — (.+):$`. An intro that grew a second line —
  // or a policy line that looks like a scope line — would silently break the defragment mount.
  const sections = [{ label: 'Global', dir: '/m/global' }, { label: 'Project worca-cc', dir: '/m/project' }];
  const lines = renderMemoryBlock(sections).split('\n');
  assert.equal(lines.at(-1), '', 'one trailing newline');
  const body = lines.slice(0, -1);
  assert.equal(body.length, 2 + sections.length, `heading + 1 intro line + ${sections.length} dir lines: ${body.length}`);
  assert.equal(body[0], MEMORY_BLOCK_HEADING);
  assert.equal(body[1], MEMORY_BLOCK_INTRO);
  assert.ok(body.every((l) => l.trim()), 'no blank line inside the block: a blank line ends it for the parser');
  const SCOPE_LINE = /^(?:Global|Project .*) — (.+):$/;
  assert.deepEqual(body.slice(2).map((l) => SCOPE_LINE.exec(l)?.[1]), ['/m/global', '/m/project']);
  assert.equal(SCOPE_LINE.test(MEMORY_BLOCK_INTRO), false, 'the intro must never read as a scope line');
});

test('MEMORY_BLOCK_INTRO: a write TRIGGER, the worth-a-file categories, the anti-list and the budget', () => {
  const intro = MEMORY_BLOCK_INTRO;
  // The trigger is what makes memory fire on SOME runs and not all — without it the block is a
  // pure discretion clause and agents write nothing.
  assert.match(intro, /write a file into the directories below only when/, 'the imperative keeps its locative: the file goes in the dirs named below, never in the rules copy');
  assert.match(intro, /cost you a cycle/);
  assert.match(intro, /would have cost the next agent one/);
  assert.match(intro, /contradicted what you assumed/);
  assert.match(intro, /still be true next month/);
  for (const category of [/a trap/, /verification recipe/, /invariant/, /settled user decision/, /defect class/]) {
    assert.match(intro, category, `worth-a-file category ${category}`);
  }
  for (const banned of [/run summaries or progress notes/, /one-off task facts/, /CLAUDE\.md/, /machine paths or secrets/, /unverified guesses/]) {
    assert.match(intro, banned, `anti-list entry ${banned}`);
  }
  assert.match(intro, /at most 1–2 files per run/);
  assert.match(intro, /prefer EDITING an existing file/);
  assert.match(intro, /under ~8 ?KB/);
  assert.match(intro, /`paths`/, 'the budget tells the agent when to scope a rule to files');
});
