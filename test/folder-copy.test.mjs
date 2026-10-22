// test/folder-copy.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync, symlinkSync,
  readlinkSync, rmSync, utimesSync, renameSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { copyFolder, checkFolderSize, folderCopyLimits, sizeLabel, scanChanges, buildChangesPatch,
  writeChangesFiles, readChangesFile, readFolderManifest, folderCopyRoot, openRegular } from '../src/core/folder-copy.mjs';
import { folderFiles } from '../src/core/project-kind.mjs';
import { withFlipper } from './helpers/folder-flipper.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), `worca-fcopy-${p}-`)); dirs.push(d); return d; };
const posix = process.platform !== 'win32';

test('copyFolder copies files and folders, leaves out .git (any depth), .worca-cc and the worca home, and writes a sha1 manifest', async () => {
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  writeFileSync(join(src, 'hello.txt'), 'hello\n');
  mkdirSync(join(src, 'docs', 'deep'), { recursive: true }); writeFileSync(join(src, 'docs', 'deep', 'x.md'), 'x\n');
  mkdirSync(join(src, '.git')); writeFileSync(join(src, '.git', 'HEAD'), 'ref\n');
  mkdirSync(join(src, 'vendor', 'lib'), { recursive: true });
  writeFileSync(join(src, 'vendor', 'lib', '.git'), 'gitdir: x\n'); writeFileSync(join(src, 'vendor', 'lib', 'a.js'), 'a\n');
  mkdirSync(join(src, '.worca-cc')); writeFileSync(join(src, '.worca-cc', 'config.json'), '{}');
  mkdirSync(join(src, 'data', 'wh'), { recursive: true }); writeFileSync(join(src, 'data', 'wh', 'worca-cc.db'), 'db');
  const r = await copyFolder(src, dest, { home: join(src, 'data', 'wh') });
  assert.deepEqual(Object.keys(r.manifest.files).sort(), ['docs/deep/x.md', 'hello.txt', 'vendor/lib/a.js']);
  assert.deepEqual([r.files, r.bytes, r.manifest.version, r.manifest.root], [3, 10, 1, src]);
  assert.equal(r.manifest.files['hello.txt'].sha1, 'f572d396fae9206628714fb2ce00f72e94f2258f');
  assert.equal(r.manifest.files['hello.txt'].size, 6);
  assert.equal(readFileSync(join(dest, 'hello.txt'), 'utf8'), 'hello\n');
  for (const gone of ['.git', 'vendor/lib/.git', '.worca-cc', 'data/wh']) assert.equal(existsSync(join(dest, ...gone.split('/'))), false, gone);
  assert.equal(Math.trunc(statSync(join(dest, 'hello.txt')).mtimeMs), Math.trunc(statSync(join(src, 'hello.txt')).mtimeMs));
});

test('POSIX: exec bits survive, links stay links, an absolute link into the folder points into the copy', { skip: !posix }, async () => {
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  writeFileSync(join(src, 'run.sh'), '#!/bin/sh\n'); chmodSync(join(src, 'run.sh'), 0o755);
  writeFileSync(join(src, 't.txt'), 't\n'); symlinkSync('t.txt', join(src, 'rel-link')); symlinkSync(join(src, 't.txt'), join(src, 'abs-link'));
  const r = await copyFolder(src, dest);
  assert.equal(statSync(join(dest, 'run.sh')).mode & 0o777, 0o755);
  assert.equal(r.manifest.files['run.sh'].mode, 0o755);
  assert.equal(readlinkSync(join(dest, 'rel-link')), 't.txt');
  assert.equal(readlinkSync(join(dest, 'abs-link')), join(dest, 't.txt'));
  assert.equal(r.manifest.files['abs-link'].link, join(src, 't.txt'));
  assert.equal(r.manifest.files['abs-link'].copyLink, join(dest, 't.txt'));
  assert.deepEqual((await scanChanges(dest, r.manifest)).files, [], 'untouched links are not changes');
});

test('the size guard counts the whole folder and names the size and the limit', async () => {
  const src = join(tmp('size'), 'site'); mkdirSync(src);
  for (const n of ['a', 'b', 'c']) writeFileSync(join(src, n), 'x\n');
  assert.deepEqual(await checkFolderSize(src, { limits: { files: 2, bytes: 1_000_000_000 } }),
    { error: 'site has 3 files. The limit is 2.', code: 'FOLDER_TOO_BIG', files: 3, bytes: 6, limit: { files: 2, bytes: 1_000_000_000 }, limitBytes: 1_000_000_000, over: 'files' });
  assert.deepEqual(await checkFolderSize(src, { limits: { files: 50_000, bytes: 5 }, name: 'Tax papers' }),
    { error: 'Tax papers is 6 B. The limit is 5 B.', code: 'FOLDER_TOO_BIG', files: 3, bytes: 6, limit: { files: 50_000, bytes: 5 }, limitBytes: 5, over: 'bytes' });
  assert.equal(await checkFolderSize(src), null);
  await assert.rejects(copyFolder(src, join(tmp('c'), 'copy'), { limits: { files: 2, bytes: 1e9 } }), { code: 'FOLDER_TOO_BIG' });
  const home = tmp('home'); mkdirSync(join(home, 'runs', 'abcd1234', 'repos', 'k'), { recursive: true }); mkdirSync(join(home, 'store', 'k'), { recursive: true });
  const ownFolder = { error: "This folder is worca's own data folder.", code: 'FOLDER_IS_WORCA_HOME' };
  for (const root of [home, join(home, 'runs', 'abcd1234', 'repos', 'k'), join(home, 'store', 'k')]) assert.deepEqual(await checkFolderSize(root, { home }), ownFolder, root);
  await assert.rejects(copyFolder(home, join(tmp('c'), 'copy'), { home }), { code: 'FOLDER_IS_WORCA_HOME' });
  assert.deepEqual(folderCopyLimits({ WORCA_FOLDER_MAX_FILES: '7' }), { files: 7, bytes: 1_000_000_000 });
  assert.deepEqual(folderCopyLimits({ WORCA_FOLDER_MAX_FILES: 'x', WORCA_FOLDER_MAX_BYTES: '-1' }), { files: 50_000, bytes: 1_000_000_000 });
  assert.deepEqual([sizeLabel(5), sizeLabel(2_345_678), sizeLabel(340_000_000), sizeLabel(1_000_000_000)], ['5 B', '2.3 MB', '340 MB', '1 GB']);
});

async function pair(files) {
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  for (const [p, body] of Object.entries(files)) writeFileSync(join(src, p), body);
  const { manifest } = await copyFolder(src, dest);
  return { src, dest, manifest };
}

test('scanChanges: added / modified / deleted, sorted; touched-but-equal, excluded and .git paths are not changes', async () => {
  const { dest, manifest } = await pair({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
  writeFileSync(join(dest, 'a.txt'), 'A\n'); utimesSync(join(dest, 'a.txt'), 1, 1);   // same size as the copy: move its mtime off the fast path
  rmSync(join(dest, 'b.txt')); writeFileSync(join(dest, 'new.txt'), 'new\n');
  utimesSync(join(dest, 'c.txt'), new Date(), new Date());
  mkdirSync(join(dest, '.claude', 'rules', 'worca'), { recursive: true }); writeFileSync(join(dest, '.claude', 'rules', 'worca', 'm.md'), 'm\n');
  mkdirSync(join(dest, '.git')); writeFileSync(join(dest, '.git', 'HEAD'), 'x');
  const r = await scanChanges(dest, manifest, { exclude: ['.claude/rules/worca'] });
  assert.deepEqual(r.files, [
    { path: 'a.txt', change: 'modified', size: 2 }, { path: 'b.txt', change: 'deleted', size: 2 }, { path: 'new.txt', change: 'added', size: 4 }]);
  assert.deepEqual(r.counts, { added: 1, modified: 1, deleted: 1 });
});

test('POSIX: an exec-bit flip alone is a modification', { skip: !posix }, async () => {
  const { dest, manifest } = await pair({ 's.sh': 'echo\n' });
  chmodSync(join(dest, 's.sh'), 0o755);
  assert.deepEqual((await scanChanges(dest, manifest)).files, [{ path: 's.sh', change: 'modified', size: 5 }]);
});

test('buildChangesPatch: git-style sections the diff view reads, binary files named, numstat counted; the changes file round-trips', async () => {
  const { src, dest, manifest } = await pair({ 'one.txt': 'one\ntwo\n', 'gone.txt': 'gone\n' });
  writeFileSync(join(dest, 'one.txt'), 'one\nTWO\n'); utimesSync(join(dest, 'one.txt'), 1, 1);   // same size: off the fast path
  rmSync(join(dest, 'gone.txt'));
  writeFileSync(join(dest, 'new.txt'), 'x\n'); writeFileSync(join(dest, 'bin.dat'), Buffer.from([0, 1, 2]));
  const { files, counts } = await scanChanges(dest, manifest);
  const { patch, numstat, truncated } = await buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files });
  assert.equal(truncated, false);
  assert.equal(patch, [
    'diff --git a/bin.dat b/bin.dat', 'new file mode 100644', 'Binary files /dev/null and b/bin.dat differ',
    'diff --git a/gone.txt b/gone.txt', 'deleted file mode 100644', '--- a/gone.txt', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-gone',
    'diff --git a/new.txt b/new.txt', 'new file mode 100644', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1,1 @@', '+x',
    'diff --git a/one.txt b/one.txt', '--- a/one.txt', '+++ b/one.txt', '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', ''].join('\n'));
  assert.deepEqual(numstat.get('one.txt'), { added: 1, removed: 1, binary: false });
  assert.deepEqual(numstat.get('bin.dat'), { added: 0, removed: 0, binary: true });
  const ff = folderFiles(tmp('pipe'));
  await writeChangesFiles(ff, { version: 1, root: src, state: 'pending', files, counts, patchTruncated: false }, patch);
  assert.deepEqual(await readChangesFile(ff.changes), { version: 1, root: src, state: 'pending', files, counts, patchTruncated: false });
  assert.equal(readFileSync(ff.patch, 'utf8'), patch);
  assert.equal(await readChangesFile(join(tmp('none'), 'changes.json')), null);
});

test('buildChangesPatch: past PATCH_MAX_EDIT_LENGTH edits a file is one whole-file hunk (jsdiff stays bounded)', async () => {
  const text = (f) => Array.from({ length: 4500 }, (_, i) => f(i)).join('\n') + '\n';
  const before = text((i) => `row ${i}`); const after = text((i) => (i % 2 ? `ROW ${i}` : `row ${i}`));   // 4,500 edits
  const { src, dest, manifest } = await pair({ 'big.csv': before });
  writeFileSync(join(dest, 'big.csv'), after); utimesSync(join(dest, 'big.csv'), 1, 1);   // same size as the copy: off the fast path
  const { files } = await scanChanges(dest, manifest);
  const { patch, numstat } = await buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files });
  assert.deepEqual(numstat.get('big.csv'), { added: 4500, removed: 4500, binary: false });
  assert.equal(patch, ['diff --git a/big.csv b/big.csv', '--- a/big.csv', '+++ b/big.csv', '@@ -1,4500 +1,4500 @@',
    ...before.trimEnd().split('\n').map((l) => `-${l}`), ...after.trimEnd().split('\n').map((l) => `+${l}`), ''].join('\n'));
});

test('buildChangesPatch: a file jsdiff cannot finish within PATCH_DIFF_TIMEOUT_MS is one whole-file hunk too (repeating lines, under the edit cap)', async () => {
  const before = Array.from({ length: 400_000 }, (_, i) => (i % 2 ? 'a' : 'b'));
  const after = before.slice();
  for (let i = 0; i < 1999; i++) { const j = (i * 200_003) % after.length; after[j] = after[j] === 'a' ? 'b' : 'a'; }   // ~4,000 edits: jsdiff alone takes ~3 s
  const { src, dest, manifest } = await pair({ 'rep.txt': before.join('\n') + '\n' });
  writeFileSync(join(dest, 'rep.txt'), after.join('\n') + '\n'); utimesSync(join(dest, 'rep.txt'), 1, 1);   // same size: off the fast path
  const { files } = await scanChanges(dest, manifest);
  const { numstat } = await buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files });
  assert.deepEqual(numstat.get('rep.txt'), { added: 400_000, removed: 400_000, binary: false });
});

test('scanChanges measures the worca home from the real folder: an agent file at its path in the copy is not a change', async () => {
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  writeFileSync(join(src, 'a.txt'), 'a\n'); mkdirSync(join(src, 'wh', '.worca-cc'), { recursive: true });
  const prev = process.env.WORCA_HOME; process.env.WORCA_HOME = join(src, 'wh');   // worcaHome() = <WORCA_HOME>/.worca-cc, inside the folder
  try {
    const { manifest } = await copyFolder(src, dest);
    mkdirSync(join(dest, 'wh', '.worca-cc'), { recursive: true }); writeFileSync(join(dest, 'wh', '.worca-cc', 'x.txt'), 'x\n');
    // the real folder comes from the caller (the run's record), never from the agent-writable manifest's `root`
    assert.deepEqual((await scanChanges(dest, { ...manifest, root: tmp('forged') }, { realRoot: src })).files, []);
  } finally { if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev; }
});

test('POSIX: a copy file whose hash read fails is listed as modified, never a throw (an agent\'s chmod 000)', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { dest, manifest } = await pair({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  chmodSync(join(dest, 'a.txt'), 0o000);
  try {
    assert.deepEqual((await scanChanges(dest, manifest)).files.map((f) => `${f.change} ${f.path}`), ['modified a.txt']);
  } finally { chmodSync(join(dest, 'a.txt'), 0o644); }
});

test('POSIX: the files of a folder the agent made unreadable in the copy are listed as modified, never deleted', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  mkdirSync(join(src, 'keep')); writeFileSync(join(src, 'keep', 'k1.txt'), 'k1\n'); writeFileSync(join(src, 'keep', 'k2.txt'), 'k2\n');
  writeFileSync(join(src, 'top.txt'), 't\n');
  const { manifest } = await copyFolder(src, dest);
  chmodSync(join(dest, 'keep'), 0o000);                              // the walk cannot read it: the copy's version is unknown
  try {
    assert.deepEqual((await scanChanges(dest, manifest)).files.map((f) => `${f.change} ${f.path}`), ['modified keep/k1.txt', 'modified keep/k2.txt']);
  } finally { chmodSync(join(dest, 'keep'), 0o755); }
});

// v7: a FIFO the user put at a deleted path, a file the user cannot read, a folder the agent renamed in case and made unreadable.
test('POSIX: a FIFO the user put in the folder at a path the run deleted never blocks the scan or the patch', { skip: process.platform === 'win32' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { openSync, closeSync, constants: fsc } = await import('node:fs');
  const { src, dest, manifest } = await pair({ 'gone.txt': 'g\n' });
  rmSync(join(dest, 'gone.txt')); rmSync(join(src, 'gone.txt')); execFileSync('mkfifo', [join(src, 'gone.txt')]);
  try {
    const scanAndPatch = scanChanges(dest, manifest).then(async (sc) => { await buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files: sc.files }); return sc; });
    const r = await Promise.race([scanAndPatch, new Promise((res) => setTimeout(() => res({ files: 'blocked' }), 3000))]);
    assert.deepEqual(r.files, [{ path: 'gone.txt', change: 'deleted', size: 2 }]);
  } finally { try { closeSync(openSync(join(src, 'gone.txt'), fsc.O_WRONLY | fsc.O_NONBLOCK)); } catch { /* no opener was blocked */ } }
});

test('POSIX: a file the user cannot read is left out of the copy with the unreadable warning, never a failed copy', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  writeFileSync(join(src, 'ok.txt'), 'ok\n'); writeFileSync(join(src, 'secret.key'), 'k\n'); chmodSync(join(src, 'secret.key'), 0o000);
  const warns = [];
  try {
    const r = await copyFolder(src, dest, { onWarn: (w) => warns.push(w) });
    assert.deepEqual([Object.keys(r.manifest.files), r.files, existsSync(join(dest, 'secret.key')), warns],
      [['ok.txt'], 1, false, ['left 1 unreadable item(s) out of the copy: secret.key']]);
  } finally { chmodSync(join(src, 'secret.key'), 0o644); }
});

test('case-insensitive volumes: a folder the agent renamed in case and made unreadable lists its files as modified, never deleted', { skip: process.platform !== 'darwin' || process.getuid?.() === 0 }, async () => {
  const { renameSync } = await import('node:fs');
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  mkdirSync(join(src, 'docs')); writeFileSync(join(src, 'docs', 'a.md'), 'a\n');
  const { manifest } = await copyFolder(src, dest);
  renameSync(join(dest, 'docs'), join(dest, 'Docs')); chmodSync(join(dest, 'Docs'), 0o000);
  try {
    assert.deepEqual((await scanChanges(dest, manifest)).files.map((f) => `${f.change} ${f.path}`), ['modified docs/a.md']);
  } finally { chmodSync(join(dest, 'Docs'), 0o755); }
});

// v8: an entry removed from the folder between the walk and its copy (an editor's swap file, an Office lock file).
test('POSIX: a file, a link or a folder removed from the folder while the copy runs is left out, never a failed copy', { skip: !posix }, async () => {
  const { createRequire, syncBuiltinESMExports } = await import('node:module');
  const fspCjs = createRequire(import.meta.url)('node:fs/promises');
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  writeFileSync(join(src, 'a.txt'), 'a\n'); writeFileSync(join(src, '.a.txt.swp'), 'swap'); symlinkSync('a.txt', join(src, 'gone-link'));
  mkdirSync(join(src, '.~tmp')); writeFileSync(join(src, '.~tmp', 'x'), 'x');
  const { open: origOpen, readlink: origLink, readdir: origDir } = fspCjs;
  // Linux opens a folder before listing it, through its parent's handle (`/proc/self/fd/<fd>/.~tmp`): remove it there too
  const dropTmp = (p) => { if (String(p).endsWith(`${sep}.~tmp`)) rmSync(join(src, '.~tmp'), { recursive: true, force: true }); };
  fspCjs.readdir = async (p, o) => { dropTmp(p); return origDir(p, o); };
  fspCjs.open = async (p, ...rest) => { dropTmp(p); if (String(p) === join(src, '.a.txt.swp')) rmSync(p, { force: true }); return origOpen(p, ...rest); };
  fspCjs.readlink = async (p, o) => { if (String(p).endsWith(`${sep}gone-link`)) rmSync(join(src, 'gone-link'), { force: true }); return origLink(p, o); };
  syncBuiltinESMExports();
  try {
    const r = await copyFolder(src, dest);
    assert.deepEqual([Object.keys(r.manifest.files), r.files, existsSync(join(dest, '.a.txt.swp'))], [['a.txt'], 1, false]);
  } finally { fspCjs.open = origOpen; fspCjs.readlink = origLink; fspCjs.readdir = origDir; syncBuiltinESMExports(); }
});

test('the binary sniff opens only a regular file: a deleted file over 1 MB is binary only while its real file is there', async () => {
  const { src, dest, manifest } = await pair({ 'gone.txt': 'x'.repeat(1_000_001), 'kept.txt': 'y'.repeat(1_000_001) });
  rmSync(join(dest, 'gone.txt')); rmSync(join(src, 'gone.txt')); rmSync(join(dest, 'kept.txt'));
  assert.deepEqual((await scanChanges(dest, { ...manifest, root: tmp('forged') }, { realRoot: src })).files, [
    { path: 'gone.txt', change: 'deleted', size: 1_000_001 }, { path: 'kept.txt', change: 'deleted', size: 1_000_001, binary: true }]);
});

test('win32 arm: a directory link is written resolved in the copy, never into the real folder', { skip: !posix }, async () => {
  const src = tmp('src'); const out = tmp('out'); const dest = join(tmp('dst'), 'copy');
  mkdirSync(join(src, 'd')); mkdirSync(join(out, 'x')); mkdirSync(join(out, 'y'));
  symlinkSync('d', join(src, 'rel-dir')); symlinkSync(`${out}/x/../y`, join(src, 'out-dir'));
  const r = await copyFolder(src, dest, { platform: 'win32' });
  assert.deepEqual([r.manifest.files['rel-dir'].copyLink, r.manifest.files['out-dir'].copyLink], [join(dest, 'd'), join(out, 'y')]);
  assert.equal(readlinkSync(join(dest, 'rel-dir')), join(dest, 'd'));
  assert.deepEqual((await scanChanges(dest, r.manifest, { platform: 'win32' })).files, []);
});

// Hosted isolation: the pipeline dir is writable by the agent's uid, so folder-manifest.json and changes.json are agent input.
test('readFolderManifest refuses a whole manifest naming a path that leaves the folder, and a manifest that is not a regular file', async () => {
  const { manifest } = await pair({ 'a.txt': 'a\n' });
  const mfPath = join(tmp('pipe'), 'folder-manifest.json');
  const write = (m) => writeFileSync(mfPath, JSON.stringify(m) + '\n');
  write(manifest);
  assert.deepEqual(await readFolderManifest(mfPath), manifest);
  const entry = manifest.files['a.txt'];
  for (const key of ['/etc/passwd', '../out/x.txt', 'a/../../x', './a.txt', 'a//b', 'a/', '', 'a\0b']) {
    write({ ...manifest, files: { ...manifest.files, [key]: entry } });
    assert.equal(await readFolderManifest(mfPath), null, JSON.stringify(key));
  }
  write({ ...manifest, files: { 'a.txt': null } });
  assert.equal(await readFolderManifest(mfPath), null, 'an entry that is not an object');
  write({ ...manifest, files: { 'a\\b.txt': entry } });
  assert.notEqual(await readFolderManifest(mfPath), null, 'a POSIX name may hold a backslash');
  assert.equal(await readFolderManifest(mfPath, { platform: 'win32' }), null, 'on win32 a backslash is a separator');
  if (posix) {
    const elsewhere = join(tmp('out'), 'm.json'); writeFileSync(elsewhere, JSON.stringify(manifest));
    rmSync(mfPath); symlinkSync(elsewhere, mfPath);
    assert.equal(await readFolderManifest(mfPath), null, 'a link at the manifest path is never followed');
  }
});

test('POSIX: readChangesFile never follows a link at changes.json, nor blocks on a FIFO there', { skip: !posix }, async () => {
  const { execFileSync } = await import('node:child_process');
  const ff = folderFiles(tmp('pipe'));
  const elsewhere = join(tmp('out'), 'secret.json'); writeFileSync(elsewhere, JSON.stringify({ state: 'pending', secret: 'CANARY' }));
  symlinkSync(elsewhere, ff.changes);
  assert.equal(await readChangesFile(ff.changes), null);
  rmSync(ff.changes); execFileSync('mkfifo', [ff.changes]);
  const r = await Promise.race([readChangesFile(ff.changes), new Promise((res) => setTimeout(() => res('blocked'), 3000))]);
  assert.equal(r, null);
});

test('POSIX: a side of the patch is never read through a link in a parent folder (a forged key under a folder link, a copy folder swapped for a link)', { skip: !posix }, async () => {
  const out = tmp('out'); writeFileSync(join(out, 'secret.txt'), 'CANARY\n'); writeFileSync(join(out, 'secret.bin'), Buffer.from('CANARY\0'));
  const { src, dest, manifest } = await pair({ 'a.txt': 'a\n' });
  symlinkSync(out, join(src, 'lnk'));                                // a link the user keeps in the folder
  const forged = { ...manifest, files: { ...manifest.files, 'lnk/secret.txt': manifest.files['a.txt'], 'lnk/secret.bin': manifest.files['a.txt'] } };
  const scan = await scanChanges(dest, forged, { realRoot: src });
  assert.deepEqual(scan.files, [{ path: 'lnk/secret.bin', change: 'deleted', size: 2 }, { path: 'lnk/secret.txt', change: 'deleted', size: 2 }],
    'the deleted-path sniff reads nothing through the link');
  const old = await buildChangesPatch({ realRoot: src, copyDir: dest, manifest: forged, files: scan.files });
  assert.doesNotMatch(old.patch, /CANARY/);
  mkdirSync(join(dest, 'd')); writeFileSync(join(dest, 'd', 'secret.txt'), 'mine\n');
  const listed = (await scanChanges(dest, manifest, { realRoot: src })).files;
  rmSync(join(dest, 'd'), { recursive: true }); symlinkSync(out, join(dest, 'd'));   // swapped after the scan
  const now = await buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files: listed });
  assert.doesNotMatch(now.patch, /CANARY/);
});

test('POSIX: folderCopyRoot answers the copy\'s realpath only for a real folder at <home>/runs/<id>/repos/<key> — a link at repos/<key>, repos/ or runs/<id> is refused', { skip: !posix }, async () => {
  const home = tmp('home'); const out = tmp('out');
  const copyOf = (id, key = 'proj-1234abcd') => join(home, 'runs', id, 'repos', key);
  const opts = (id, key = 'proj-1234abcd') => ({ pipelineId: id, key, home });
  mkdirSync(copyOf('aaaa1111'), { recursive: true });
  assert.equal(await folderCopyRoot(copyOf('aaaa1111'), opts('aaaa1111')), realpathSync(copyOf('aaaa1111')));
  assert.equal(await folderCopyRoot(copyOf('aaaa1111'), opts('bbbb2222')), null, 'another run\'s id');
  assert.equal(await folderCopyRoot(copyOf('aaaa1111'), opts('aaaa1111', 'other-1234abcd')), null, 'another member\'s key');
  assert.equal(await folderCopyRoot(join(home, 'runs', 'aaaa1111', 'repos', 'gone'), opts('aaaa1111', 'gone')), null, 'missing');
  // a link at repos/<key>: the agent renamed its cwd away and linked a server-only folder in its place
  mkdirSync(join(home, 'runs', 'cccc3333', 'repos'), { recursive: true });
  symlinkSync(out, copyOf('cccc3333'));
  assert.equal(await folderCopyRoot(copyOf('cccc3333'), opts('cccc3333')), null, 'a link at repos/<key>');
  // a link at repos/ and at runs/<id>: the copy path's last component is a real folder, its realpath is elsewhere
  mkdirSync(join(out, 'r', 'proj-1234abcd'), { recursive: true });
  mkdirSync(join(home, 'runs', 'dddd4444'), { recursive: true });
  symlinkSync(join(out, 'r'), join(home, 'runs', 'dddd4444', 'repos'));
  assert.equal(await folderCopyRoot(copyOf('dddd4444'), opts('dddd4444')), null, 'a link at repos/');
  mkdirSync(join(out, 'run', 'repos', 'proj-1234abcd'), { recursive: true });
  symlinkSync(join(out, 'run'), join(home, 'runs', 'eeee5555'));
  assert.equal(await folderCopyRoot(copyOf('eeee5555'), opts('eeee5555')), null, 'a link at runs/<id>');
  // a file at the copy's path
  mkdirSync(join(home, 'runs', 'ffff6666', 'repos'), { recursive: true }); writeFileSync(copyOf('ffff6666'), 'x\n');
  assert.equal(await folderCopyRoot(copyOf('ffff6666'), opts('ffff6666')), null, 'a file');
});

// Hosted isolation: a process the agent left behind can swap a FILE for a link between its lstat and its read. Runs
// `swap(path)` once, right after the first lstat of a path a key names returns (`before`: right before it runs). A key is
// a path, or a predicate for a walk's lstat (Linux lstats through the folder's handle, `/proc/self/fd/<fd>/<name>`). The
// modules' named imports follow syncBuiltinESMExports.
async function afterFirstLstat(swaps, fn, { before = false } = {}) {
  const { createRequire, syncBuiltinESMExports } = await import('node:module');
  const fspCjs = createRequire(import.meta.url)('node:fs/promises');
  const orig = fspCjs.lstat; const left = [...swaps];
  const take = (p) => {
    const i = left.findIndex(([k]) => (typeof k === 'function' ? k(p) : k === p));
    return i < 0 ? null : left.splice(i, 1)[0][1];
  };
  fspCjs.lstat = async (...a) => {
    const p = String(a[0]);
    const swap = take(p);
    if (swap && before) swap(p);
    const st = await orig(...a);
    if (swap && !before) swap(p);
    return st;
  };
  syncBuiltinESMExports();
  try { return await fn(); } finally { fspCjs.lstat = orig; syncBuiltinESMExports(); }
}
const toLink = (target) => (p) => { renameSync(p, `${p}-moved`); symlinkSync(target, p); };

test('POSIX: a file swapped for a link right after its lstat is never read by name: no side of the patch holds the link target', { skip: !posix }, async () => {
  const out = tmp('out'); writeFileSync(join(out, 'secret.txt'), 'CANARY-SECRET\n');
  const { src, dest, manifest } = await pair({ 'mod.txt': 'old\n', 'gone.txt': 'g\n' });
  writeFileSync(join(dest, 'mod.txt'), 'newer\n'); writeFileSync(join(dest, 'add.txt'), 'added\n');   // a size change: off the fast path
  writeFileSync(join(src, 'gone.txt'), 'theirs\n'); rmSync(join(dest, 'gone.txt'));
  const { files } = await scanChanges(dest, manifest, { realRoot: src });
  assert.deepEqual(files.map((f) => `${f.change} ${f.path}`), ['added add.txt', 'deleted gone.txt', 'modified mod.txt']);
  const secret = join(out, 'secret.txt');
  const { patch } = await afterFirstLstat([[join(dest, 'add.txt'), toLink(secret)], [join(dest, 'mod.txt'), toLink(secret)], [join(src, 'gone.txt'), toLink(secret)]],
    () => buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files, copyRoot: realpathSync(dest) }));
  assert.ok(existsSync(join(dest, 'add.txt-moved')) && existsSync(join(src, 'gone.txt-moved')), 'the swaps ran inside the build');
  assert.doesNotMatch(patch, /CANARY-SECRET/);
});

test('POSIX: a folder above a file swapped for a link right after the file\'s lstat: the opened file is not the lstat\'s (dev + ino), never read', { skip: !posix }, async () => {
  const out = tmp('out'); writeFileSync(join(out, 'a.txt'), 'CANARY-SECRET\n');
  const { src, dest, manifest } = await pair({ 'top.txt': 't\n' });
  mkdirSync(join(dest, 'd')); writeFileSync(join(dest, 'd', 'a.txt'), 'mine\n');
  const { files } = await scanChanges(dest, manifest, { realRoot: src });
  const { patch } = await afterFirstLstat([[join(dest, 'd', 'a.txt'), () => toLink(out)(join(dest, 'd'))]],
    () => buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files, copyRoot: realpathSync(dest) }));
  assert.ok(existsSync(join(dest, 'd-moved')), 'the swap ran inside the build');
  assert.doesNotMatch(patch, /CANARY-SECRET/);
});

test('POSIX: a folder file swapped for a link between the walk and its copy is never copied through the link', { skip: !posix }, async () => {
  const out = tmp('out'); writeFileSync(join(out, 'secret.txt'), 'CANARY-SECRET\n');
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  writeFileSync(join(src, 'a.txt'), 'a\n'); writeFileSync(join(src, 'b.txt'), 'b\n');
  const warns = [];
  const r = await afterFirstLstat([[(p) => p.endsWith(`${sep}b.txt`), () => toLink(join(out, 'secret.txt'))(join(src, 'b.txt'))]],
    () => copyFolder(src, dest, { onWarn: (w) => warns.push(w) }));
  assert.ok(existsSync(join(src, 'b.txt-moved')), 'the swap ran inside the copy');
  assert.equal(readFileSync(join(dest, 'a.txt'), 'utf8'), 'a\n');
  assert.ok(!existsSync(join(dest, 'b.txt')) || !readFileSync(join(dest, 'b.txt'), 'utf8').includes('CANARY'), 'the copy never holds the link target');
  assert.ok(!JSON.stringify(r.manifest).includes(createHash('sha1').update('CANARY-SECRET\n').digest('hex')), 'nor does the manifest hash it');
  assert.deepEqual(Object.keys(r.manifest.files), ['a.txt']);
  assert.deepEqual(warns, ['left 1 unreadable item(s) out of the copy: b.txt']);
});

test('POSIX: a copy swapped for a link is never scanned, and the patch keeps the copy side inside the checked root', { skip: !posix }, async () => {
  const out = tmp('out'); writeFileSync(join(out, 'a.txt'), 'CANARY\n'); writeFileSync(join(out, 'secret.txt'), 'CANARY\n');
  const { src, dest, manifest } = await pair({ 'a.txt': 'a\n' });
  writeFileSync(join(dest, 'a.txt'), 'mine\n');
  const copyRoot = realpathSync(dest);
  const listed = (await scanChanges(dest, manifest, { realRoot: src })).files;
  renameSync(dest, `${dest}-moved`); symlinkSync(out, dest);
  await assert.rejects(scanChanges(dest, manifest, { realRoot: src }), { code: 'COPY_IS_LINK' });
  const { patch } = await buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files: listed, copyRoot });
  assert.doesNotMatch(patch, /CANARY/);
});

// M3 (hosted isolation): a FOLDER above a changed file swapped for a link, exactly while the file is lstat'ed and opened
// (helpers/folder-flipper.mjs). The lstat and the open both resolve through the link, so only the descriptor's real path
// (Linux /proc/self/fd; a stand-in elsewhere) tells the outside file.
test('POSIX, M3: a folder above a changed file, a link exactly while the file is lstat\'ed and opened, never reaches the patch — copy side or real side — and every other side reads as before', { skip: !posix }, async () => {
  const out = tmp('out'); writeFileSync(join(out, 'a.txt'), 'CANARY-SECRET\n'); writeFileSync(join(out, 'm.txt'), 'CANARY-SECRET\n');
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  mkdirSync(join(src, 'd')); writeFileSync(join(src, 'd', 'm.txt'), 'old m\n'); writeFileSync(join(src, 'top.txt'), 'old\n');
  const { manifest } = await copyFolder(src, dest);
  writeFileSync(join(dest, 'top.txt'), 'newer\n'); writeFileSync(join(dest, 'd', 'm.txt'), 'newer m\n'); writeFileSync(join(dest, 'd', 'a.txt'), 'mine\n');
  const { files } = await scanChanges(dest, manifest, { realRoot: src });
  assert.deepEqual(files.map((f) => `${f.change} ${f.path}`), ['added d/a.txt', 'modified d/m.txt', 'modified top.txt']);
  const build = () => buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files, copyRoot: realpathSync(dest) });
  const top = ['diff --git a/top.txt b/top.txt', '--- a/top.txt', '+++ b/top.txt', '@@ -1,1 +1,1 @@', '-old', '+newer', ''].join('\n');
  const copySide = await withFlipper({ folder: join(dest, 'd'), target: out, paths: [join(dest, 'd', 'a.txt')] }, build);
  assert.ok(copySide.flips > 0, 'the flipper ran inside the build');
  assert.doesNotMatch(copySide.result.patch, /CANARY/);
  assert.ok(copySide.result.patch.endsWith(top), 'both sides of top.txt read inside their roots');
  assert.match(copySide.result.patch, /\n-old m\n\+newer m\n/, 'd/m.txt reads both sides');
  const realSide = await withFlipper({ folder: join(src, 'd'), target: out, paths: [join(src, 'd', 'm.txt')] }, build);
  assert.ok(realSide.flips > 0, 'the flipper ran inside the build');
  assert.doesNotMatch(realSide.result.patch, /CANARY/);
  assert.ok(realSide.result.patch.endsWith(top), 'both sides of top.txt read inside their roots');
  assert.match(realSide.result.patch, /\n\+mine\n/, 'd/a.txt reads');
});

test('POSIX, M3: a folder of the user\'s folder, a link exactly while one of its files is lstat\'ed and opened, is never copied through: the file is left out with the unreadable warning', { skip: !posix }, async () => {
  const out = tmp('out'); writeFileSync(join(out, 'b.txt'), 'CANARY-SECRET\n');
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  writeFileSync(join(src, 'a.txt'), 'a\n'); mkdirSync(join(src, 'd')); writeFileSync(join(src, 'd', 'b.txt'), 'b\n');
  const warns = [];
  const { result: r, flips } = await withFlipper({ folder: join(src, 'd'), target: out, paths: [join(src, 'd', 'b.txt')] },
    () => copyFolder(src, dest, { onWarn: (w) => warns.push(w) }));
  assert.ok(flips > 0, 'the flipper ran inside the copy');
  assert.deepEqual(Object.keys(r.manifest.files), ['a.txt']);
  assert.deepEqual([readFileSync(join(dest, 'a.txt'), 'utf8'), existsSync(join(dest, 'd', 'b.txt'))], ['a\n', false]);
  assert.ok(!JSON.stringify(r.manifest).includes(createHash('sha1').update('CANARY-SECRET\n').digest('hex')), 'nor does the manifest hash it');
  assert.deepEqual(warns, ['left 1 unreadable item(s) out of the copy: d/b.txt']);
});

test('POSIX, M3: with every open checked inside its root, the scan still hashes a touched file and sniffs both sides as before; an open naming no root is refused', { skip: !posix }, async () => {
  const src = tmp('src'); const dest = join(tmp('dst'), 'copy');
  writeFileSync(join(src, 'same.txt'), 'same\n'); writeFileSync(join(src, 'gone.bin'), Buffer.from([1, 0, 2]));
  const { manifest } = await copyFolder(src, dest);
  utimesSync(join(dest, 'same.txt'), 1, 1);                          // touched only: off the fast path, the hash decides
  rmSync(join(dest, 'gone.bin')); writeFileSync(join(dest, 'new.bin'), Buffer.from([0, 1]));
  const { result } = await withFlipper({}, () => scanChanges(dest, manifest, { realRoot: src }));
  assert.deepEqual(result.files, [{ path: 'gone.bin', change: 'deleted', size: 3, binary: true }, { path: 'new.bin', change: 'added', size: 2, binary: true }]);
  const file = join(dest, 'same.txt'); const st = statSync(file);
  const { result: opened } = await withFlipper({}, async () => {
    const [fh, none] = [await openRegular(file, st, { root: realpathSync(dest) }), await openRegular(file, st)];
    await fh?.close(); await none?.close();
    return [!!fh, !!none];
  });
  assert.deepEqual(opened, [true, false], 'inside its root it opens; with no root it fails closed');
});

test('POSIX, M3: a folder missing at the patch\'s folder check is not inside (fails closed): a link that appears there before the lstat is never read', { skip: !posix }, async () => {
  const out = tmp('out'); writeFileSync(join(out, 'a.txt'), 'CANARY-SECRET\n');
  // realpath'd folders: on macOS a tmpdir path (/var/…) is /private/var/… by realpath, which hides a resolve() fallback
  const src = realpathSync(tmp('src')); const dest = join(realpathSync(tmp('dst')), 'copy');
  writeFileSync(join(src, 'top.txt'), 't\n');
  const { manifest } = await copyFolder(src, dest);
  mkdirSync(join(dest, 'd')); writeFileSync(join(dest, 'd', 'a.txt'), 'mine\n');
  const { files } = await scanChanges(dest, manifest, { realRoot: src });
  renameSync(join(dest, 'd'), join(dest, 'd-away'));                 // the gap of a non-atomic swap
  const { patch } = await afterFirstLstat([[join(dest, 'd', 'a.txt'), () => symlinkSync(out, join(dest, 'd'))]],
    () => buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files, copyRoot: realpathSync(dest) }), { before: true });
  assert.equal(patch, 'diff --git a/d/a.txt b/d/a.txt\nnew file mode 100644\n');
});

test('Linux, M3: the scan lists a folder through its own checked handle — swapped for a link after its open, or after its lstat, no name of the link target is listed', { skip: process.platform !== 'linux' }, async () => {
  const { createRequire, syncBuiltinESMExports } = await import('node:module');
  const fspCjs = createRequire(import.meta.url)('node:fs/promises');
  const out = tmp('out'); for (let i = 0; i < 3; i++) writeFileSync(join(out, `server-only-${i}.key`), 'CANARY-SECRET\n');
  for (const phase of ['readdir', 'lstat']) {
    const { src, dest, manifest } = await pair({ 'top.txt': 't\n' });
    mkdirSync(join(dest, 'd')); writeFileSync(join(dest, 'd', 'mine.txt'), 'mine\n');
    const dReal = realpathSync(join(dest, 'd'));
    let swapped = false;
    const swapD = () => { swapped = true; renameSync(join(dest, 'd'), join(dest, 'd-real')); symlinkSync(out, join(dest, 'd')); };
    const viaFd = (p) => p.startsWith('/proc/self/fd/');
    const orig = fspCjs[phase];
    fspCjs[phase] = async (p, ...rest) => {
      const s = String(p);
      if (!swapped && phase === 'readdir' && viaFd(s) && readlinkSync(s) === dReal) swapD();   // after the open, before the listing
      const r = await orig(p, ...rest);
      if (!swapped && phase === 'lstat' && viaFd(s) && s.endsWith('/d')) swapD();            // after the lstat, before the open
      return r;
    };
    syncBuiltinESMExports();
    let scan;
    try { scan = await scanChanges(dest, manifest, { realRoot: src }); } finally { fspCjs[phase] = orig; syncBuiltinESMExports(); }
    assert.ok(swapped, `${phase}: the swap ran inside the scan`);
    assert.doesNotMatch(JSON.stringify(scan.files), /server-only/, phase);
    if (phase === 'readdir') assert.deepEqual(scan.files.map((f) => `${f.change} ${f.path}`), ['added d/mine.txt'], 'the folder the handle holds');
  }
});

test('Linux, M3: a link under a folder that is a link exactly while it is read hands the patch none of the outside link\'s target (read through its folder\'s checked handle)', { skip: process.platform !== 'linux' }, async () => {
  const out = tmp('out'); symlinkSync('CANARY-TARGET', join(out, 'l'));
  const { src, dest, manifest } = await pair({ 'top.txt': 't\n' });
  mkdirSync(join(dest, 'd')); symlinkSync('mine-target', join(dest, 'd', 'l'));
  const { files } = await scanChanges(dest, manifest, { realRoot: src });
  assert.deepEqual(files.map((f) => `${f.change} ${f.path}`), ['added d/l']);
  const { result, flips } = await withFlipper({ folder: join(dest, 'd'), target: out, paths: [join(dest, 'd', 'l'), join(dest, 'd')] },
    () => buildChangesPatch({ realRoot: src, copyDir: dest, manifest, files, copyRoot: realpathSync(dest) }));
  assert.ok(flips > 0, 'the flipper ran inside the build');
  assert.doesNotMatch(result.patch, /CANARY/);
});
