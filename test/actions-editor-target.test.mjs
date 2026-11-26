// test/actions-editor-target.test.mjs — the path guard of the Diff tab's open-in-editor route
// (src/core/actions/editor-target.mjs): shape, the protected-path floor, and realpath containment,
// with real temp folders and symlinks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEditorFile } from '../src/core/actions/editor-target.mjs';

let base; let repo; let outside;
before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'worca-editor-target-')));
  repo = join(base, 'repo');
  outside = join(base, 'repo-other');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(repo, 'src', 'a.mjs'), 'x\n');
  writeFileSync(join(outside, 'secret.txt'), 'y\n');
  symlinkSync(join(outside, 'secret.txt'), join(repo, 'src', 'escape.txt'));
  symlinkSync(join(repo, 'src', 'a.mjs'), join(repo, 'inside-link.mjs'));
  symlinkSync(outside, join(repo, 'outdir'));
});
after(() => rmSync(base, { recursive: true, force: true }));

const refused = async (rel, code, opts) => {
  await assert.rejects(resolveEditorFile(repo, rel, opts), (e) => { assert.equal(e.code, code, `${rel}: ${e.message}`); return true; });
};

test('a file inside the folder resolves to its lexical path under the folder', async () => {
  assert.deepEqual(await resolveEditorFile(repo, 'src/a.mjs'), { abs: join(repo, 'src', 'a.mjs') });
  assert.deepEqual(await resolveEditorFile(repo, 'src/a.mjs', { platform: 'darwin' }), { abs: join(repo, 'src', 'a.mjs') });
  assert.deepEqual(await resolveEditorFile(repo, 'inside-link.mjs', { platform: 'linux' }), { abs: join(repo, 'inside-link.mjs') },
    'a symlink that stays inside the folder is fine');
});

test('shape: .., absolute and a drive letter are BAD_PATH; % only on win32', async () => {
  await refused('../repo-other/secret.txt', 'BAD_PATH');
  await refused('/etc/passwd', 'BAD_PATH');
  await refused('C:/x.mjs', 'BAD_PATH');
  await refused('src/%PATH%.mjs', 'BAD_PATH', { platform: 'win32' });
  await refused('src/%PATH%.mjs', 'FILE_NOT_FOUND', { platform: 'linux' });
  await assert.rejects(resolveEditorFile(repo, '../x'), /is not a path inside the run's folder/);
});

test('floor: credential-shaped paths are PROTECTED_PATH before any disk read', async () => {
  await refused('.env', 'PROTECTED_PATH');
  await refused('config/secrets/x', 'PROTECTED_PATH');
  await assert.rejects(resolveEditorFile(repo, '.env'), /Worca does not open credential files/);
});

test('containment: a symlink out of the folder is BAD_PATH (also a prefix-sharing sibling, folded or not)', async () => {
  await refused('src/escape.txt', 'BAD_PATH');
  await refused('outdir/secret.txt', 'BAD_PATH', { platform: 'darwin' });
  await refused('outdir/secret.txt', 'BAD_PATH', { platform: 'linux' });
  await assert.rejects(resolveEditorFile(repo, 'src/escape.txt'), /leads outside the run's folder/);
});

test('a missing file or a directory is FILE_NOT_FOUND', async () => {
  await refused('src/gone.mjs', 'FILE_NOT_FOUND');
  await refused('src', 'FILE_NOT_FOUND');
  await assert.rejects(resolveEditorFile(repo, 'src/gone.mjs'), /is not in the run's folder/);
});
