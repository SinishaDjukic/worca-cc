// test/tool-folder.test.mjs — the tool panel's folder reader (issue 1064): one level at a time, never out of the folder,
// never the .git folder, text with a cap, and a folder's uncommitted changes through git-info.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { listFolder, readFolderFile, openFolderFile, workingTreeChanges, cleanRel, TOOL_FOLDER_LIMITS } from '../src/core/tool-folder.mjs';

const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
function tree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worca-tool-folder-')));
  made.push(root);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://tok@example.com/r\n');
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
  writeFileSync(join(root, 'README.md'), '# hi\n');
  writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 0, 2, 3]));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'worca-tool-out-')));
  made.push(outside);
  writeFileSync(join(outside, 'secret.txt'), 'nope');
  symlinkSync(outside, join(root, 'out-link'));
  symlinkSync(join(root, 'src'), join(root, 'src-link'));
  return root;
}

test('cleanRel: a clean a/b path, and refusals for climbing, absolute, NUL and .git', () => {
  assert.equal(cleanRel(''), '');
  assert.equal(cleanRel('src//a.js'), 'src/a.js');
  assert.equal(cleanRel('./src'), 'src');
  for (const bad of ['..', 'src/../..', '/etc', 'C:/x', 'a\0b', '.git', 'src/.git/config', '.GIT/config']) {
    if (bad === '.GIT/config' && process.platform === 'linux') continue;   // case-sensitive: a real folder named .GIT is listed
    assert.throws(() => cleanRel(bad), (e) => e.code === 'BAD_PATH', bad);
  }
});

test('listFolder: folders first, .git hidden, sizes, links inside open and links out do not', async () => {
  const root = tree();
  const out = await listFolder(root, '');
  assert.equal(out.path, '');
  assert.deepEqual(out.entries.map((e) => e.name), ['src', 'bin.dat', 'out-link', 'README.md', 'src-link']);
  assert.equal(out.entries.find((e) => e.name === 'README.md').size, 5);
  assert.deepEqual(out.entries.find((e) => e.name === 'out-link'), { name: 'out-link', type: 'link', target: null });
  assert.deepEqual(out.entries.find((e) => e.name === 'src-link'), { name: 'src-link', type: 'link', target: 'dir' });
  assert.equal(out.truncated, false);
  assert.deepEqual((await listFolder(root, 'src')).entries, [{ name: 'a.js', type: 'file', size: 20 }]);
  await assert.rejects(listFolder(root, 'out-link'), (e) => e.code === 'BAD_PATH');
  await assert.rejects(listFolder(root, 'README.md'), (e) => e.code === 'NOT_A_FOLDER');
  await assert.rejects(listFolder(root, 'nope'), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(listFolder(join(root, 'gone'), ''), (e) => e.code === 'NO_FOLDER');
});

test('readFolderFile: text, binary, the cap, and the same refusals', async () => {
  const root = tree();
  assert.deepEqual(await readFolderFile(root, 'src/a.js'),
    { path: 'src/a.js', size: 20, shown: 20, truncated: false, binary: false, text: 'export const a = 1;\n' });
  const bin = await readFolderFile(root, 'bin.dat');
  assert.equal(bin.binary, true);
  assert.equal(bin.text, '');
  const big = 'x'.repeat(TOOL_FOLDER_LIMITS.maxFileBytes + 10);
  writeFileSync(join(root, 'big.txt'), big);
  const b = await readFolderFile(root, 'big.txt');
  assert.equal(b.truncated, true);
  assert.equal(b.shown, TOOL_FOLDER_LIMITS.maxFileBytes);
  assert.equal(b.text.length, TOOL_FOLDER_LIMITS.maxFileBytes);
  await assert.rejects(readFolderFile(root, 'out-link/secret.txt'), (e) => e.code === 'BAD_PATH');
  await assert.rejects(readFolderFile(root, '.git/config'), (e) => e.code === 'BAD_PATH');
  await assert.rejects(readFolderFile(root, 'src'), (e) => e.code === 'NOT_A_FILE');
  await assert.rejects(readFolderFile(root, ''), (e) => e.code === 'NOT_A_FILE');
});

test('readFolderFile: a multi-byte character cut by the cap is dropped, never half-decoded', async () => {
  const root = tree();
  writeFileSync(join(root, 'u.txt'), 'a'.repeat(TOOL_FOLDER_LIMITS.maxFileBytes - 1) + 'é');   // é = 2 bytes: one fits
  const r = await readFolderFile(root, 'u.txt');
  assert.equal(r.truncated, true);
  assert.equal(r.text, 'a'.repeat(TOOL_FOLDER_LIMITS.maxFileBytes - 1));
});

test('workingTreeChanges: tracked edits and new files against HEAD, with a patch and counts', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worca-tool-git-')));
  made.push(root);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'dev');
  writeFileSync(join(root, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(root, 'b.txt'), 'new\n');
  const out = await workingTreeChanges(root);
  assert.equal(out.untrackedCapped, false);
  assert.equal(out.results.summary.filesChanged, 1);
  assert.equal(out.results.summary.filesNew, 1);
  assert.match(out.patch, /diff --git a\/a\.txt b\/a\.txt/);
  assert.match(out.patch, /\+two/);
  assert.match(out.patch, /b\/b\.txt/);
});

test('workingTreeChanges: past the untracked cap it says so and lists only the first ones', async () => {
  const calls = [];
  const fake = {
    diffNameStatus: async () => [], diffNumstat: async () => new Map(), diffPatch: async () => '',
    untrackedFiles: async () => ['n1', 'n2', 'n3'],
    untrackedPatch: async (_d, p) => { calls.push(p); return { patch: `diff --git a/${p} b/${p}\n`, added: 1, binary: false }; },
  };
  const out = await workingTreeChanges('/x', { maxUntracked: 2, git: fake });
  assert.deepEqual(calls, ['n1', 'n2']);
  assert.equal(out.untrackedCapped, true);
  assert.equal(out.results.summary.filesNew, 2);
});

test('a link to the .git folder is never followed: listed with target null, and refused to list or read through', async () => {
  const root = tree();
  symlinkSync('.git', join(root, 'g'));
  const out = await listFolder(root, '');
  assert.deepEqual(out.entries.find((e) => e.name === 'g'), { name: 'g', type: 'link', target: null });
  await assert.rejects(listFolder(root, 'g'), { code: 'BAD_PATH' });
  await assert.rejects(readFolderFile(root, 'g/config'), { code: 'BAD_PATH' });
});

test('openFolderFile: a handle on a file inside the folder; the same refusals as readFolderFile', async () => {
  const root = tree();
  const fh = await openFolderFile(root, 'src/a.js');
  try { assert.equal((await fh.readFile('utf8')), 'export const a = 1;\n'); } finally { await fh.close(); }
  for (const bad of ['../x', '.git/config', '/etc/hosts']) await assert.rejects(openFolderFile(root, bad), { code: 'BAD_PATH' });
  await assert.rejects(openFolderFile(root, ''), { code: 'NOT_A_FILE' });
  await assert.rejects(openFolderFile(root, 'src'), { code: 'NOT_A_FILE' });
  await assert.rejects(openFolderFile(root, 'nope.txt'), { code: 'NOT_FOUND' });
  symlinkSync('.git', join(root, 'g'));
  await assert.rejects(openFolderFile(root, 'g/config'), { code: 'BAD_PATH' }, 'a link to .git under another name');
});
