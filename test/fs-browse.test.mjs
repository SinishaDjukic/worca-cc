// test/fs-browse.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, parse } from 'node:path';
import { listFolders } from '../src/core/fs-browse.mjs';

let root;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'worca-cc-fsbrowse-'));
  await mkdir(join(root, 'beta'));
  await mkdir(join(root, 'Alpha'));
  await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'file.txt'), 'x');
  try { await symlink(join(root, 'beta'), join(root, 'link-to-beta'), 'dir'); } catch { /* fs without symlink perms */ }
});
after(async () => { await rm(root, { recursive: true, force: true }); });

function withHome(dir, fn) {
  const prevH = process.env.HOME, prevU = process.env.USERPROFILE;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return Promise.resolve(fn()).finally(() => {
    if (prevH === undefined) delete process.env.HOME; else process.env.HOME = prevH;
    if (prevU === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevU;
  });
}

test('lists only visible directories, case-insensitively sorted', async () => {
  const out = await listFolders(root);
  const names = out.dirs.map((d) => d.name);
  assert.ok(names.includes('Alpha') && names.includes('beta'));
  assert.ok(!names.includes('.hidden'), 'dotfolders are hidden');
  assert.ok(!names.includes('file.txt'), 'files are excluded');
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  assert.deepEqual(names, sorted);
  assert.equal(out.path, root);
  assert.equal(out.parent, dirname(root));
  for (const d of out.dirs) assert.equal(d.path, join(root, d.name));
});

test('symlinked directories are listed', async (t) => {
  const out = await listFolders(root);
  if (!out.dirs.some((d) => d.name === 'link-to-beta')) t.skip('symlink not created on this fs');
});

test('empty input lists the home directory', () => withHome(root, async () => {
  const out = await listFolders('');
  assert.equal(out.path, root);
  assert.equal(out.home, root);
}));

function withProjectsRoot(dir, fn) {
  const prev = process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_PROJECTS_ROOT = dir;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.WORCA_PROJECTS_ROOT; else process.env.WORCA_PROJECTS_ROOT = prev;
  });
}

test('empty input opens at the projects root; home stays the OS home', () => withHome(root, () =>
  withProjectsRoot(join(root, 'beta'), async () => {
    const out = await listFolders('');
    assert.equal(out.path, join(root, 'beta'));
    assert.equal(out.home, root);
  })));

test('empty input falls back to home when the projects root does not exist', () => withHome(root, () =>
  withProjectsRoot(join(root, 'no-such-dir'), async () => {
    const out = await listFolders('');
    assert.equal(out.path, root);
  })));

test('tilde input expands to home', () => withHome(root, async () => {
  const out = await listFolders('~/beta');
  assert.equal(out.path, join(root, 'beta'));
}));

test('parent is null at the filesystem root', async () => {
  const fsRoot = parse(root).root;
  const out = await listFolders(fsRoot);
  assert.equal(out.parent, null);
});

test('nonexistent and non-directory paths throw BAD_REQUEST', async () => {
  await assert.rejects(() => listFolders(join(root, 'nope')), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(() => listFolders(join(root, 'file.txt')), (e) => e.code === 'BAD_REQUEST');
});
