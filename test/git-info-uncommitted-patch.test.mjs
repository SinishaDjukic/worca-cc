// test/git-info-uncommitted-patch.test.mjs — Get the diff's patch builder: every uncommitted change
// (edits, deletions, untracked files) against a base, built in a TEMPORARY index so the folder's own
// index is never touched (a linked folder is the person's own clone; a checkout left mid-merge keeps
// its conflicts).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { uncommittedPatch } from '../src/core/git-info.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const repo = () => { const d = templateRepo('ucp', { branch: 'main', user: true, files: { 'a.txt': 'one\n', 'b.txt': 'bee\n' } }); created.push(d); return d; };
const outDir = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-ucp-out-')); created.push(d); return d; };
const indexState = (dir) => [git(dir, ['diff', '--cached', '--name-status']).stdout, git(dir, ['status', '--porcelain']).stdout];

test('edits, deletions and untracked files land in the patch; the real index is untouched', async () => {
  const dir = repo();
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
  await unlink(join(dir, 'b.txt'));
  await writeFile(join(dir, 'new.txt'), 'brand new\n');
  await writeFile(join(dir, 'staged.txt'), 'staged by the person\n');
  git(dir, ['add', 'staged.txt']);                       // the person's own staging must survive as is
  const before = indexState(dir);
  const out = join(await outDir(), 'u.patch');
  const r = await uncommittedPatch(dir, { base: 'refs/heads/main', outFile: out });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.file, out);
  const patch = await readFile(out, 'utf8');
  assert.match(patch, /\+two/);
  assert.match(patch, /deleted file mode[\s\S]*b\.txt|b\.txt[\s\S]*deleted file mode/);
  assert.match(patch, /new\.txt[\s\S]*\+brand new/);
  assert.match(patch, /staged\.txt/);
  assert.deepEqual(indexState(dir), before, 'neither the index nor the status changed');
  assert.equal(existsSync(`${out}.part`), false);
});

test('a clean folder yields no file', async () => {
  const dir = repo();
  const out = join(await outDir(), 'u.patch');
  assert.deepEqual(await uncommittedPatch(dir, { base: 'HEAD', outFile: out }), { ok: true, file: null, bytes: 0 });
  assert.equal(existsSync(out), false);
});

test('a checkout left mid-merge keeps its unresolved conflicts', async () => {
  const dir = repo();
  git(dir, ['switch', '-q', '-c', 'side']);
  await writeFile(join(dir, 'a.txt'), 'side\n');
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-qam', 'side']);
  git(dir, ['switch', '-q', 'main']);
  await writeFile(join(dir, 'a.txt'), 'main\n');
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-qam', 'main']);
  git(dir, ['merge', '--no-ff', '--no-commit', 'side']);   // conflicts in a.txt
  const unmerged = () => git(dir, ['diff', '--name-only', '--diff-filter=U']).stdout.trim();
  assert.equal(unmerged(), 'a.txt');
  const r = await uncommittedPatch(dir, { base: 'HEAD', outFile: join(await outDir(), 'u.patch') });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(await readFile(r.file, 'utf8'), /<<<<<<<|>>>>>>>/);
  assert.equal(unmerged(), 'a.txt', 'the conflict is still unresolved');
});

test('the folder\'s own index is the seed: a --skip-worktree file the person hides stays out of the patch', async () => {
  const dir = repo();
  git(dir, ['update-index', '--skip-worktree', 'b.txt']);
  await writeFile(join(dir, 'b.txt'), 'my local secret\n');
  await writeFile(join(dir, 'a.txt'), 'one\nchanged\n');
  const r = await uncommittedPatch(dir, { base: 'HEAD', outFile: join(await outDir(), 'u.patch') });
  assert.equal(r.ok, true, JSON.stringify(r));
  const patch = await readFile(r.file, 'utf8');
  assert.match(patch, /\+changed/);
  assert.doesNotMatch(patch, /b\.txt|my local secret/, 'seeded from the real index, so its skip-worktree bit holds');
  assert.equal(git(dir, ['ls-files', '-v', 'b.txt']).stdout.trim(), 'S b.txt', 'the person\'s index is untouched');
});

test('the patch always has a/ b/ prefixes, whatever the person\'s diff config says', async () => {
  const dir = repo();
  git(dir, ['config', 'diff.noprefix', 'true']);
  git(dir, ['config', 'diff.mnemonicPrefix', 'true']);
  await writeFile(join(dir, 'a.txt'), 'one\nthree\n');
  const r = await uncommittedPatch(dir, { base: 'HEAD', outFile: join(await outDir(), 'u.patch') });
  assert.equal(r.ok, true, JSON.stringify(r));
  const patch = await readFile(r.file, 'utf8');
  assert.match(patch, /^diff --git a\/a\.txt b\/a\.txt$/m);
  assert.match(patch, /^\+\+\+ b\/a\.txt$/m, 'git apply -p1 can use it');
});

test('a moved submodule is a Subproject commit hunk git apply can use, whatever diff.submodule says', async () => {
  const dir = repo();
  const sub = templateRepo('ucp-sm', { branch: 'main', user: true, files: { 's.txt': 's\n' } });
  created.push(sub);
  assert.equal(git(dir, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sm']).status, 0);
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'add sm']);
  await writeFile(join(dir, 'sm', 's.txt'), 's2\n');
  git(join(dir, 'sm'), ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'moved']);   // the submodule clone has no identity of its own (CI has no global one)
  git(dir, ['config', 'diff.submodule', 'log']);
  const r = await uncommittedPatch(dir, { base: 'HEAD', outFile: join(await outDir(), 'u.patch') });
  assert.equal(r.ok, true, JSON.stringify(r));
  const patch = await readFile(r.file, 'utf8');
  assert.match(patch, /^\+Subproject commit [0-9a-f]{40}$/m);
  assert.doesNotMatch(patch, /^Submodule sm /m);
});

test('missing arguments fail without throwing', async () => {
  assert.deepEqual(await uncommittedPatch('', { outFile: '/x' }), { ok: false, step: 'path', message: 'dir and outFile are required' });
});
