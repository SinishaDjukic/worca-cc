// test/git-info.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseShortstat, normalizeMergeable, diffShortstat, branchExists,
  findPrForBranch, commitsAhead, readPrBody, editPrBody, _testing as gitInfo,
} from '../src/core/git-info.mjs';
import { checkRows } from './helpers/rows.mjs';

test('pure parsers: parseShortstat shapes and normalizeMergeable states', async () => {
  await checkRows([
    { name: 'parseShortstat handles all four shortstat shapes', run: () => {
      assert.deepEqual(parseShortstat(' 2 files changed, 44 insertions(+), 25 deletions(-)'), { added: 44, removed: 25 });
      assert.deepEqual(parseShortstat(' 1 file changed, 5 insertions(+)'), { added: 5, removed: 0 });
      assert.deepEqual(parseShortstat(' 1 file changed, 3 deletions(-)'), { added: 0, removed: 3 });
      assert.deepEqual(parseShortstat(''), { added: 0, removed: 0 });
    } },
    { name: 'normalizeMergeable maps gh + mergeStateStatus values to 3 states', run: () => {
      assert.equal(normalizeMergeable('MERGEABLE'), 'MERGEABLE');
      assert.equal(normalizeMergeable('CLEAN'), 'MERGEABLE');
      assert.equal(normalizeMergeable('CONFLICTING'), 'CONFLICTING');
      assert.equal(normalizeMergeable('DIRTY'), 'CONFLICTING');
      assert.equal(normalizeMergeable(''), 'UNKNOWN');
      assert.equal(normalizeMergeable('anything-else'), 'UNKNOWN');
    } },
  ]);
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

test('findPrForBranch branch search: argv, normalization, OPEN > MERGED > CLOSED, null on no match/failure/bad JSON/missing args', async () => {
  await checkRows([
    { name: 'findPrForBranch returns a single MERGED PR, normalized, queried by head', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => {
        seen.push([cmd, ...args]);
        return Promise.resolve({
          ok: true,
          stdout: JSON.stringify([{ number: 9, state: 'MERGED', url: 'https://gh/x/pull/9', isDraft: false, mergeable: 'UNKNOWN' }]),
          stderr: '', code: 0,
        });
      });
      const pr = await findPrForBranch({ projectDir: '/repo', head: 'worca-cc/feat-1' });
      assert.deepEqual(pr, { state: 'MERGED', url: 'https://gh/x/pull/9', number: 9, isDraft: false, mergeable: 'UNKNOWN' });
      // Queries by head, includes merged/closed, scans up to 30 matches; the same call reads
      // whether each PR is a draft and merges cleanly (the Runs list's PR glyph).
      assert.deepEqual(seen, [[
        'gh', 'pr', 'list', '--head', 'worca-cc/feat-1',
        '--state', 'all', '--json', 'number,state,url,isDraft,mergeable', '--limit', '30',
      ]]);
      gitInfo.reset();
    } },
    { name: 'findPrForBranch reports a draft and a conflicting PR, normalized, from the same call', run: async () => {
      let rows = [];
      gitInfo.setRunner(() => Promise.resolve({ ok: true, stdout: JSON.stringify(rows), stderr: '', code: 0 }));
      rows = [{ number: 4, state: 'OPEN', url: 'https://gh/x/pull/4', isDraft: true, mergeable: 'CONFLICTING' }];
      assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'b' }),
        { state: 'OPEN', url: 'https://gh/x/pull/4', number: 4, isDraft: true, mergeable: 'CONFLICTING' });
      rows = [{ number: 5, state: 'OPEN', url: 'https://gh/x/pull/5', isDraft: false, mergeable: 'MERGEABLE' }];
      assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'b' }),
        { state: 'OPEN', url: 'https://gh/x/pull/5', number: 5, isDraft: false, mergeable: 'MERGEABLE' });
      // An older gh (or a stub) that answers without the fields: not a draft, mergeability unknown.
      rows = [{ number: 6, state: 'OPEN', url: 'https://gh/x/pull/6' }];
      assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'b' }),
        { state: 'OPEN', url: 'https://gh/x/pull/6', number: 6, isDraft: false, mergeable: 'UNKNOWN' });
      gitInfo.reset();
    } },
    { name: 'findPrForBranch normalizes lowercase state to uppercase', run: async () => {
      gitInfo.setRunner(() => Promise.resolve({
        ok: true, stdout: JSON.stringify([{ number: 2, state: 'open', url: 'u' }]), stderr: '', code: 0,
      }));
      assert.equal((await findPrForBranch({ projectDir: '/r', head: 'b' })).state, 'OPEN');
      gitInfo.reset();
    } },
    { name: 'findPrForBranch prefers OPEN, then MERGED, over a newer CLOSED PR', run: async () => {
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
        { state: 'MERGED', url: 'https://gh/x/pull/12', number: 12, isDraft: false, mergeable: 'UNKNOWN' });
      assert.equal((await findPrForBranch({ projectDir: '/r', head: 'b', includeClosed: true })).state, 'MERGED',
        'a closed PR is only ever the last resort');

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
    } },
    { name: 'findPrForBranch ignores closed-only PRs (returns null)', run: async () => {
      // Only a closed/declined PR exists -> "no active PR" -> the button should re-appear.
      gitInfo.setRunner(() => Promise.resolve({
        ok: true,
        stdout: JSON.stringify([{ number: 1, state: 'CLOSED', url: 'https://gh/x/pull/1' }]),
        stderr: '', code: 0,
      }));
      assert.equal(await findPrForBranch({ projectDir: '/r', head: 'b' }), null);
      gitInfo.reset();
    } },
    { name: 'findPrForBranch includeClosed: the newest closed PR when no open or merged one exists', run: async () => {
      // The Runs list draws a PR dropped without merging; every other caller keeps null.
      gitInfo.setRunner(() => Promise.resolve({
        ok: true,
        stdout: JSON.stringify([
          { number: 3, state: 'CLOSED', url: 'https://gh/x/pull/3', isDraft: true },   // newest
          { number: 1, state: 'CLOSED', url: 'https://gh/x/pull/1' },
        ]),
        stderr: '', code: 0,
      }));
      assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'b', includeClosed: true }),
        { state: 'CLOSED', url: 'https://gh/x/pull/3', number: 3, isDraft: true, mergeable: 'UNKNOWN' });
      assert.equal(await findPrForBranch({ projectDir: '/r', head: 'b' }), null, 'off by default');
      gitInfo.setRunner(() => Promise.resolve({ ok: false, stdout: '', stderr: 'no remote', code: 1 }));
      assert.equal(await findPrForBranch({ projectDir: '/r', head: 'b', includeClosed: true }), null, 'a failed search finds nothing');
      gitInfo.reset();
    } },
    { name: 'findPrForBranch returns null on no match, gh failure, bad JSON, or missing args', run: async () => {
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
    } },
  ]);
});

test('commitsAhead counts source..feature; null on failure', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args, opts) => { seen.push([cmd, ...args, opts.cwd]);
    return Promise.resolve({ ok: true, stdout: '3\n', stderr: '', code: 0 }); });
  assert.equal(await commitsAhead('/r/api', 'main', 'f-api'), 3);
  assert.deepEqual(seen[0], ['git', 'rev-list', '--count', 'main..f-api', '/r/api']);
  gitInfo.setRunner(() => Promise.resolve({ ok: false, stdout: '', stderr: 'bad rev', code: 128 }));
  assert.equal(await commitsAhead('/r/api', 'main', 'f-api'), null);
  assert.equal(await commitsAhead(null, 'main', 'f'), null);
  gitInfo.reset();
});

test('readPrBody / editPrBody use gh pr view --json body / gh pr edit --body', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]);
    if (args[1] === 'view') return Promise.resolve({ ok: true, stdout: 'hello\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 }); });
  assert.deepEqual(await readPrBody({ prUrl: 'https://github.com/o/r/pull/1' }), { ok: true, body: 'hello' });
  assert.deepEqual(await editPrBody({ prUrl: 'https://github.com/o/r/pull/1', body: 'new' }), { ok: true });
  assert.deepEqual(seen, [
    ['gh', 'pr', 'view', 'https://github.com/o/r/pull/1', '--json', 'body', '-q', '.body'],
    ['gh', 'pr', 'edit', 'https://github.com/o/r/pull/1', '--body', 'new'],
  ]);
  gitInfo.setRunner(() => Promise.resolve({ ok: false, stdout: '', stderr: 'HTTP 404', code: 1 }));
  assert.deepEqual(await editPrBody({ prUrl: 'https://github.com/o/r/pull/1', body: 'x' }), { ok: false, error: 'HTTP 404' });
  gitInfo.reset();
});

// ── commitFilesSince (Requirements A7: files changed since a brief's commit) ──────────────
import { commitFilesSince } from '../src/core/git-info.mjs';
import { mkdtempSync as mkTmp, rmSync as rmTmp, writeFileSync as wf } from 'node:fs';

test('commitFilesSince parses the log through the runner; bad input → null without a call; failure/timeout → null', async () => {
  const calls = [];
  gitInfo.setRunner((cmd, args, o) => { calls.push({ cmd, args, o });
    return Promise.resolve({ ok: true, stdout: '\x1e' + 'a'.repeat(40) + '\n\nsrc/a.js\nsrc/b.js\n\x1e' + 'b'.repeat(40) + '\n\nREADME.md\n', stderr: '', code: 0 }); });
  const r = await commitFilesSince('/r', 'abc1234', 'main', { max: 5, timeout: 1234 });
  assert.deepEqual(r, { commits: [{ sha: 'a'.repeat(40), files: ['src/a.js', 'src/b.js'] }, { sha: 'b'.repeat(40), files: ['README.md'] }] });
  assert.equal(calls[0].cmd, 'git');
  assert.deepEqual(calls[0].args, ['-c', 'core.quotePath=false', 'log', '--format=%x1e%H', '--name-only', '--no-renames', '-n', '5', 'abc1234..main', '--']);
  assert.equal(calls[0].o.timeout, 1234);
  assert.equal(calls[0].o.cwd, '/r');
  const n = calls.length;
  assert.equal(await commitFilesSince('/r', '--oops', 'main'), null);
  assert.equal(await commitFilesSince('/r', 'zzzzzzz', 'main'), null);
  assert.equal(await commitFilesSince('/r', 'abc1234', '-x'), null);
  assert.equal(await commitFilesSince('', 'abc1234', 'main'), null);
  assert.equal(calls.length, n, 'no git call for invalid input');
  gitInfo.setRunner(() => Promise.resolve({ ok: false, stdout: '', stderr: 'git timed out after 10 ms', code: -1 }));
  assert.equal(await commitFilesSince('/r', 'abc1234', 'main'), null);
  gitInfo.reset();
});

test('commitFilesSince on a real repository: commits since a sha with their files; a merge commit lists none', async () => {
  const dir = mkTmp(join(tmpdir(), 'worca-cfs-'));
  try {
    const g = (...a) => { const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    g('commit', '-q', '--allow-empty', '-m', 'base');
    const base = g('rev-parse', 'HEAD');
    wf(join(dir, 'a.txt'), 'a\n'); g('add', '-A'); g('commit', '-q', '-m', 'a');
    g('checkout', '-q', '-b', 'side'); wf(join(dir, 'b.txt'), 'b\n'); g('add', '-A'); g('commit', '-q', '-m', 'b');
    g('checkout', '-q', 'main'); wf(join(dir, 'c.txt'), 'c\n'); g('add', '-A'); g('commit', '-q', '-m', 'c');
    g('merge', '-q', '--no-ff', '-m', 'merge', 'side');
    const r = await commitFilesSince(dir, base, 'main');
    assert.equal(r.commits.length, 4);
    const all = r.commits.flatMap((c) => c.files).sort();
    assert.deepEqual(all, ['a.txt', 'b.txt', 'c.txt']);
    assert.deepEqual(r.commits[0].files, [], 'the merge commit (newest) lists no files');
    assert.deepEqual(await commitFilesSince(dir, g('rev-parse', 'HEAD'), 'main'), { commits: [] });
    assert.equal(await commitFilesSince(dir, 'deadbeef', 'main'), null, 'unknown sha → git fails → null');
  } finally { rmTmp(dir, { recursive: true, force: true, maxRetries: 3 }); }
});

test('commitsAhead forwards an additive timeout to the runner (none by default)', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args, o) => { seen.push(o); return Promise.resolve({ ok: true, stdout: '2\n', stderr: '', code: 0 }); });
  assert.equal(await commitsAhead('/r', 'abc1234', 'main', { timeout: 1234 }), 2);
  assert.equal(await commitsAhead('/r', 'abc1234', 'main'), 2);
  gitInfo.reset();
  assert.equal(seen[0].timeout, 1234);
  assert.ok(!seen[1].timeout, 'no timeout unless asked');
});
