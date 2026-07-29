// test/git-info.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseShortstat, normalizeMergeable, diffShortstat, branchExists,
  findPrForBranch, _testing as gitInfo,
} from '../src/core/git-info.mjs';

test('parseShortstat handles all four shortstat shapes', () => {
  assert.deepEqual(parseShortstat(' 2 files changed, 44 insertions(+), 25 deletions(-)'), { added: 44, removed: 25 });
  assert.deepEqual(parseShortstat(' 1 file changed, 5 insertions(+)'), { added: 5, removed: 0 });
  assert.deepEqual(parseShortstat(' 1 file changed, 3 deletions(-)'), { added: 0, removed: 3 });
  assert.deepEqual(parseShortstat(''), { added: 0, removed: 0 });
});

test('normalizeMergeable maps gh + mergeStateStatus values to 3 states', () => {
  assert.equal(normalizeMergeable('MERGEABLE'), 'MERGEABLE');
  assert.equal(normalizeMergeable('CLEAN'), 'MERGEABLE');
  assert.equal(normalizeMergeable('CONFLICTING'), 'CONFLICTING');
  assert.equal(normalizeMergeable('DIRTY'), 'CONFLICTING');
  assert.equal(normalizeMergeable(''), 'UNKNOWN');
  assert.equal(normalizeMergeable('anything-else'), 'UNKNOWN');
});

test('branchExists + diffShortstat against a real throwaway repo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gi-'));
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'a.txt'), 'one\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
  g(['checkout', '-q', '-b', 'feature/x']);
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n'); g(['add', '-A']); g(['commit', '-qm', 'add line']);

  assert.equal(await branchExists(dir, 'feature/x'), true);
  assert.equal(await branchExists(dir, 'no-such-branch'), false);
  assert.equal(await branchExists('/path/does/not/exist', 'feature/x'), false);

  const d = await diffShortstat(dir, 'main', 'feature/x');
  assert.equal(d.added, 1);
  assert.equal(d.removed, 0);
  await rm(dir, { recursive: true, force: true });
});

test('findPrForBranch returns a single MERGED PR, normalized, queried by head', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    return Promise.resolve({
      ok: true,
      stdout: JSON.stringify([{ number: 9, state: 'MERGED', url: 'https://gh/x/pull/9' }]),
      stderr: '', code: 0,
    });
  });
  const pr = await findPrForBranch({ projectDir: '/repo', head: 'worca-cc/feat-1' });
  assert.deepEqual(pr, { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9 });
  // Queries by head, includes merged/closed, scans up to 30 matches.
  assert.deepEqual(seen[0], [
    'gh', 'pr', 'list', '--head', 'worca-cc/feat-1',
    '--state', 'all', '--json', 'number,state,url', '--limit', '30',
  ]);
  gitInfo.reset();
});

test('findPrForBranch normalizes lowercase state to uppercase', async () => {
  gitInfo.setRunner(() => Promise.resolve({
    ok: true, stdout: JSON.stringify([{ number: 2, state: 'open', url: 'u' }]), stderr: '', code: 0,
  }));
  assert.equal((await findPrForBranch({ projectDir: '/r', head: 'b' })).state, 'OPEN');
  gitInfo.reset();
});

test('findPrForBranch prefers OPEN, then MERGED, over a newer CLOSED PR', async () => {
  // A newer CLOSED PR must NOT mask an older MERGED one (requirement is "open or merged").
  gitInfo.setRunner(() => Promise.resolve({
    ok: true,
    stdout: JSON.stringify([
      { number: 30, state: 'CLOSED', url: 'https://gh/x/pull/30' }, // newest
      { number: 12, state: 'MERGED', url: 'https://gh/x/pull/12' },
    ]),
    stderr: '', code: 0,
  }));
  assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'b' }),
    { state: 'MERGED', url: 'https://gh/x/pull/12', number: 12 });

  gitInfo.setRunner(() => Promise.resolve({
    ok: true,
    stdout: JSON.stringify([
      { number: 13, state: 'MERGED', url: 'https://gh/x/pull/13' },
      { number: 14, state: 'OPEN', url: 'https://gh/x/pull/14' },
    ]),
    stderr: '', code: 0,
  }));
  assert.equal((await findPrForBranch({ projectDir: '/r', head: 'b' })).state, 'OPEN');
  gitInfo.reset();
});

test('findPrForBranch ignores closed-only PRs (returns null)', async () => {
  // Only a closed/declined PR exists -> "no active PR" -> the button should re-appear.
  gitInfo.setRunner(() => Promise.resolve({
    ok: true,
    stdout: JSON.stringify([{ number: 1, state: 'CLOSED', url: 'https://gh/x/pull/1' }]),
    stderr: '', code: 0,
  }));
  assert.equal(await findPrForBranch({ projectDir: '/r', head: 'b' }), null);
  gitInfo.reset();
});

test('findPrForBranch returns null on no match, gh failure, bad JSON, or missing args', async () => {
  gitInfo.setRunner(() => Promise.resolve({ ok: true, stdout: '[]', stderr: '', code: 0 }));
  assert.equal(await findPrForBranch({ projectDir: '/r', head: 'b' }), null);

  gitInfo.setRunner(() => Promise.resolve({ ok: false, stdout: '', stderr: 'no remote', code: 1 }));
  assert.equal(await findPrForBranch({ projectDir: '/r', head: 'b' }), null);

  gitInfo.setRunner(() => Promise.resolve({ ok: true, stdout: 'not json', stderr: '', code: 0 }));
  assert.equal(await findPrForBranch({ projectDir: '/r', head: 'b' }), null);

  // Empty stdout is treated as "[]" (no PR), not an error.
  gitInfo.setRunner(() => Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 }));
  assert.equal(await findPrForBranch({ projectDir: '/r', head: 'b' }), null);

  assert.equal(await findPrForBranch({ projectDir: '', head: 'b' }), null);
  assert.equal(await findPrForBranch({ projectDir: '/r', head: '' }), null);
  gitInfo.reset();
});
