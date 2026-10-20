// test/project-kind.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeVcs, normalizeWorkMode, detectVcs, vcsAtUpgrade, effectiveWorkMode, workModeForStart,
  workModeOfRow, samePath, folderFiles, FOLDER_FILES, displayPath } from '../src/core/project-kind.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), `worca-kind-${p}-`)); dirs.push(d); return d; };

test('normalizers: NULL vcs is git, unknown work mode is git; folder file names', () => {
  assert.equal(normalizeVcs('none'), 'none');
  for (const v of ['git', null, undefined, '', 'svn']) assert.equal(normalizeVcs(v), 'git');
  for (const v of ['git', 'folder', 'none']) assert.equal(normalizeWorkMode(v), v);
  for (const v of [null, undefined, 'x']) assert.equal(normalizeWorkMode(v), 'git');
  assert.deepEqual(FOLDER_FILES, { manifest: 'folder-manifest.json', changes: 'changes.json', patch: 'changes.patch' });
  assert.deepEqual(folderFiles('/p'), { dir: '/p', manifest: join('/p', 'folder-manifest.json'), changes: join('/p', 'changes.json'),
    patch: join('/p', 'changes.patch'), skipped: join('/p', 'skipped') });
});

test('detectVcs (add time) and vcsAtUpgrade (V69, U12) are stat-only', () => {
  const plain = tmp('plain'); const repo = tmp('repo'); mkdirSync(join(repo, '.git'));
  const wt = tmp('wt'); writeFileSync(join(wt, '.git'), 'gitdir: /elsewhere\n');
  assert.deepEqual([detectVcs(plain), detectVcs(repo), detectVcs(wt), detectVcs(join(plain, 'missing'))], ['none', 'git', 'git', 'none']);
  assert.deepEqual([vcsAtUpgrade(plain), vcsAtUpgrade(repo), vcsAtUpgrade(join(plain, 'missing'))], ['none', 'git', 'git']);
});

test('effectiveWorkMode (U3) and workModeForStart (L4)', () => {
  assert.deepEqual([effectiveWorkMode('git', true), effectiveWorkMode('git', false), effectiveWorkMode('none', true), effectiveWorkMode(null, true)],
    ['git', 'folder', 'folder', 'git']);
  const row = { key: 'site-00000001', name: 'site', path: '/p', vcs: 'none' };
  const byPath = (d) => (d === '/p' ? row : null);
  assert.equal(workModeForStart({ projectDir: '/p' }, { getProjectByPath: byPath, gitAvailable: true }), 'folder');
  assert.equal(workModeForStart({ projectDir: '/q' }, { getProjectByPath: byPath, gitAvailable: true }), 'git');
  assert.equal(workModeForStart({ projectDir: '/q' }, { getProjectByPath: byPath, gitAvailable: () => false }), 'folder');
  assert.equal(workModeForStart({ projectDir: '/p' }, { getProjectByPath: () => ({ ...row, vcs: 'git' }), gitAvailable: false }), 'folder');
});

test('workModeOfRow: branch / workspace_meta; junk and missing read as git', () => {
  assert.equal(workModeOfRow(null), 'git');
  assert.equal(workModeOfRow({ target: 'project', branch: JSON.stringify({ source: 'main' }) }), 'git');
  assert.equal(workModeOfRow({ target: 'project', branch: JSON.stringify({ workMode: 'folder' }) }), 'folder');
  assert.equal(workModeOfRow({ target: 'workspace', workspace_meta: JSON.stringify({ workMode: 'none' }) }), 'none');
  assert.equal(workModeOfRow({ target: 'project', branch: '{bad' }), 'git');
});

test('samePath folds case on darwin and win32 only; displayPath is ~/… under home on POSIX, absolute on Windows', () => {
  assert.equal(samePath('/A/b', '/a/B', 'darwin'), true);
  assert.equal(samePath('/A/b', '/a/B', 'win32'), true);
  assert.equal(samePath('/A/b', '/a/B', 'linux'), false);
  assert.equal(displayPath('/Users/ada/Documents/Tax', { home: '/Users/ada', platform: 'darwin' }), '~/Documents/Tax');
  assert.equal(displayPath('/home/ada', { home: '/home/ada', platform: 'linux' }), '~');
  assert.equal(displayPath('/srv/site', { home: '/home/ada', platform: 'linux' }), '/srv/site');
  assert.equal(displayPath('/home/adam/x', { home: '/home/ada', platform: 'linux' }), '/home/adam/x');
  assert.equal(displayPath('C:\\Users\\ada\\site', { home: 'C:\\Users\\ada', platform: 'win32' }), 'C:\\Users\\ada\\site');
});
