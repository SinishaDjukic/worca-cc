// test/git-info-diff.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { diffNameStatus, diffNumstat, diffPatch } from '../src/core/git-info.mjs';
import { splitUnifiedDiff } from '../src/core/ask/tools.mjs';

let repo;
const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });

before(async () => {
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-diff-'));
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  await writeFile(join(repo, 'keep.txt'), 'one\n');
  await writeFile(join(repo, 'gone.txt'), 'bye\n');
  git(['add', '-A']); git(['commit', '-qm', 'base']);
  // mutate working tree
  await writeFile(join(repo, 'keep.txt'), 'one\ntwo\n');   // modify
  await writeFile(join(repo, 'new.txt'), 'fresh\n');        // add
  await rm(join(repo, 'gone.txt'));                          // delete
  git(['add', '-A', '-N']);                                 // intent-to-add new file
});

after(async () => { await rm(repo, { recursive: true, force: true }); });

test('diffNameStatus buckets A/M/D against working tree', async () => {
  const rows = await diffNameStatus(repo, 'HEAD');
  const byPath = Object.fromEntries(rows.map((r) => [r.path, r.status]));
  assert.equal(byPath['new.txt'], 'A');
  assert.equal(byPath['keep.txt'], 'M');
  assert.equal(byPath['gone.txt'], 'D');
});

test('diffNumstat returns per-file counts', async () => {
  const m = await diffNumstat(repo, 'HEAD');
  assert.equal(m.get('keep.txt').added, 1);
  assert.equal(m.get('keep.txt').removed, 0);
  assert.equal(m.get('new.txt').binary, false);
});

test('diffPatch returns a unified diff string', async () => {
  const p = await diffPatch(repo, 'HEAD');
  assert.match(p, /\+two/);
  assert.match(p, /new\.txt/);
});

test('ALL THREE helpers keep non-ASCII paths literal (core.quotePath=false)', async () => {
  // its own repo: this one must not disturb the shared fixture's index
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-quote-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    g(['init', '-q']);
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    await writeFile(join(dir, 'a.txt'), 'one\n');
    g(['add', '-A']); g(['commit', '-qm', 'base']);
    await writeFile(join(dir, 'clé.pem'), 'SECRET=hunter2\n');
    g(['add', '-A', '-N']);
    const p = await diffPatch(dir, 'HEAD');
    // git's default C-quotes the header to `diff --git "a/cl\303\251.pem" ...`, which every
    // `diff --git a/X b/X` parser downstream (the ask tools, the History diff view) then misses.
    assert.match(p, /^diff --git a\/clé\.pem b\/clé\.pem$/m);
    assert.doesNotMatch(p, /\\303\\251/);
    // …and the two row parsers have to agree with it: results.json listing
    // `"cl\303\251.pem"` while the patch says `clé.pem` is the same path twice.
    assert.deepEqual((await diffNameStatus(dir, 'HEAD')).map((r) => r.path), ['clé.pem']);
    assert.ok((await diffNumstat(dir, 'HEAD')).has('clé.pem'), 'numstat is keyed by the literal path');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The a/ … b/ prefixes are not a git constant: diff.noprefix, diff.mnemonicPrefix
// (c/ … w/), diff.srcPrefix/dstPrefix and diff.external all change or remove them,
// and they come from the user's own ~/.gitconfig, so they apply to every worca
// worktree. Every `diff --git a/X b/X` parser downstream then reads no header at
// all: the file's body is swallowed by the previous section and bypasses the
// protected-path filter, so a credential file reaches the model whole.
// color.diff/color.ui=always is the same class of setting: it wraps every header in
// SGR escapes (`\x1b[1mdiff --git …`), so the parser yields one path:null section
// (get_run_diff then fails closed but silently empty) and the persisted patch is
// unreadable by ui/public/diff-view.mjs.
test('diffPatch pins a/ … b/ against every prefix-changing git setting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-prefix-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    g(['init', '-q']);
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    await writeFile(join(dir, 'a.txt'), 'one\n');
    g(['add', '-A']); g(['commit', '-qm', 'base']);
    await mkdir(join(dir, 'secrets'), { recursive: true });
    await writeFile(join(dir, 'secrets/db.json'), 'DB_PASSWORD=hunter2\n');
    await writeFile(join(dir, 'server.pem'), 'PRIVATE KEY\n');
    g(['add', '-A', '-N']);
    for (const [key, value] of [
      ['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true'],
      ['diff.srcPrefix', 'x/'], ['diff.dstPrefix', 'y/'], ['diff.external', 'echo'],
      ['color.diff', 'always'], ['color.ui', 'always'],
    ]) {
      g(['config', key, value]);
      const p = await diffPatch(dir, 'HEAD');
      const headers = p.split('\n').filter((l) => l.startsWith('diff --git '));
      // diff.external replaces the patch wholesale and emits no `diff --git` at all
      assert.equal(headers.length, 2, `${key}=${value}: both new files still get a header`);
      for (const h of headers) assert.match(h, /^diff --git a\/\S+ b\/\S+$/, `${key}=${value}: ${h}`);
      assert.match(p, /^diff --git a\/secrets\/db\.json b\/secrets\/db\.json$/m, `${key}=${value}`);
      assert.doesNotMatch(p, /\x1b\[/, `${key}=${value}: no SGR escapes anywhere in the patch`);
      g(['config', '--unset', key]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// `diff.submodule=diff` is the same class of user setting, one level down: git
// spawns an INNER `git diff` inside the submodule and propagates NONE of the outer
// pins into it — not `--no-ext-diff`, not `-M`, not `-c core.quotePath=false`. With
// `diff.external` in the user's ~/.gitconfig (the documented difftastic/delta setup)
// or GIT_EXTERNAL_DIFF in the server's env, the inner patch therefore carries no
// `diff --git` header at all, so splitUnifiedDiff appends it to the last section
// sorted before the submodule path: a credential file inside the submodule ships
// under that harmless file's name and inflates its counts.
test('diffPatch pins --submodule=short: an external diff tool cannot smuggle a submodule file into the previous section', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worca-cc-sub-'));
  const prevExt = process.env.GIT_EXTERNAL_DIFF;
  try {
    const sub = join(root, 'subsrc');
    await mkdir(sub, { recursive: true });
    const gs = (args) => spawnSync('git', args, { cwd: sub, encoding: 'utf8' });
    gs(['init', '-q']);
    gs(['config', 'user.email', 't@t']); gs(['config', 'user.name', 't']);
    await writeFile(join(sub, '.env'), 'A=1\n');
    gs(['add', '-A']); gs(['commit', '-qm', 'base']);

    const dir = join(root, 'main');
    await mkdir(dir, { recursive: true });
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    g(['init', '-q']);
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    await writeFile(join(dir, 'aaa.txt'), 'a\n');
    g(['add', '-A']); g(['commit', '-qm', 'base']);
    g(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sub']);
    g(['commit', '-qm', 'add sub']);
    const base = g(['rev-parse', 'HEAD']).stdout.trim();
    await writeFile(join(dir, 'aaa.txt'), 'a\ntop changed\n');
    const gi = (args) => spawnSync('git', args, { cwd: join(dir, 'sub'), encoding: 'utf8' });
    await writeFile(join(dir, 'sub', '.env'), 'A=SK-LIVE-REALSECRET-0001\n');
    gi(['add', '-A']); gi(['commit', '-qm', 'secret']);

    // an external diff tool that prints the two file bodies: the shape every such
    // tool has, and the one git gives no `diff --git` line of its own
    const tool = join(root, 'ext.sh');
    await writeFile(tool, '#!/bin/sh\necho "--- $2"\necho "+++ $5"\necho "@@ -1 +1 @@"\nsed "s/^/-/" "$2"\nsed "s/^/+/" "$5"\n');
    await chmod(tool, 0o755);
    g(['config', 'diff.submodule', 'diff']);

    for (const via of ['config', 'env']) {
      if (via === 'config') g(['config', 'diff.external', tool]);
      else { g(['config', '--unset', 'diff.external']); process.env.GIT_EXTERNAL_DIFF = tool; }
      const p = await diffPatch(dir, base);
      assert.deepEqual(splitUnifiedDiff(p).map((s) => s.path), ['aaa.txt', 'sub'],
        `${via}: the submodule is a section of its own, under its own path`);
      assert.doesNotMatch(p, /SK-LIVE-REALSECRET-0001/, `${via}: the submodule's .env body never reaches the patch`);
      assert.match(p, /^\+Subproject commit [0-9a-f]{40}$/m, `${via}: only the recorded commit does`);
      // …and the row parsers name the same file the patch does
      assert.deepEqual((await diffNameStatus(dir, base)).map((r) => r.path), ['aaa.txt', 'sub'], `${via}: name-status agrees`);
    }
  } finally {
    if (prevExt === undefined) delete process.env.GIT_EXTERNAL_DIFF;
    else process.env.GIT_EXTERNAL_DIFF = prevExt;
    await rm(root, { recursive: true, force: true });
  }
});

// `diff.renameLimit` is a user setting too, and below it git skips exhaustive
// rename detection: a rename+edit OUT of a credential file then arrives as a
// delete plus an ADD under the new, harmless name, whose `+` lines are the
// credential file's retained content. get_run_diff's old-path check can only fire
// on a pairing git actually made, so the pairing has to be ours to pin: `-l0` is
// unlimited (git falls back to its own ceiling only when the option is absent).
test('diffPatch pins -l0: diff.renameLimit cannot un-pair a rename out of a credential file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-rename-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    g(['init', '-q']);
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    const keys = Array.from({ length: 20 }, (_, i) => `KEY${i}=value${i}\n`);
    await writeFile(join(dir, '.env'), keys.join(''));
    g(['add', '-A']); g(['commit', '-qm', 'base']);
    g(['mv', '.env', 'env.sample']);
    await writeFile(join(dir, 'env.sample'), [...keys.slice(0, 19), 'KEY19=SK-LIVE-REALSECRET-0002\n'].join(''));
    // rename detection is exhaustive only while the file count stays under the
    // limit, so the leak needs one more added file than the limit allows
    await writeFile(join(dir, 'p1.txt'), 'p\n');
    await writeFile(join(dir, 'p2.txt'), 'q\n');
    g(['add', '-A']);
    g(['config', 'diff.renameLimit', '1']);
    const p = await diffPatch(dir, 'HEAD');
    assert.match(p, /^rename from \.env$/m, 'the rename is still detected under a hostile renameLimit');
    assert.equal(splitUnifiedDiff(p).find((s) => s.path === 'env.sample')?.oldPath, '.env',
      'so the section still carries the protected OLD path get_run_diff filters on');
    assert.doesNotMatch(p, /^diff --git a\/env\.sample b\/env\.sample$/m, 'the new name is not an independent add');
    // …and the row parsers pair it too, so results.json and the patch agree
    assert.deepEqual((await diffNameStatus(dir, 'HEAD')).find((r) => r.path === 'env.sample'),
      { status: 'R', from: '.env', path: 'env.sample' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('helpers are safe on bad refs', async () => {
  assert.deepEqual(await diffNameStatus(repo, 'nope'), []);
  assert.deepEqual([...(await diffNumstat(repo, 'nope')).keys()], []);
  assert.equal(await diffPatch(repo, 'nope'), '');
});

// ── Phase 1 (§8.8): the optional trailing `pathspecs` parameter ───────────────
// The three helpers gain an optional pathspec array appended AFTER the bare '--',
// so _buildResults can pass the same exclusion set _commitWork uses. Exclude-only
// pathspecs are valid git; no-arg callers are byte-identical (asserted above by the
// three tests that pass nothing and still see every path).

test('an :(exclude) pathspec filters a path out of ALL THREE diff helpers', async () => {
  const ex = [':(exclude)new.txt'];
  const rows = await diffNameStatus(repo, 'HEAD', undefined, ex);
  const paths = rows.map((r) => r.path);
  assert.ok(!paths.includes('new.txt'), `new.txt excluded from name-status: ${paths.join(',')}`);
  assert.ok(paths.includes('keep.txt'), 'the other paths still show');

  const m = await diffNumstat(repo, 'HEAD', undefined, ex);
  assert.equal(m.get('new.txt'), undefined, 'new.txt excluded from numstat');
  assert.ok(m.get('keep.txt'), 'the other paths still show');

  const p = await diffPatch(repo, 'HEAD', undefined, ex);
  assert.doesNotMatch(p, /new\.txt/, 'new.txt excluded from the patch');
  assert.match(p, /keep\.txt/, 'the other paths still show');
});

test('multiple :(exclude) pathspecs compose (the injected-path set is an array)', async () => {
  const ex = [':(exclude)new.txt', ':(exclude)gone.txt'];
  const paths = (await diffNameStatus(repo, 'HEAD', undefined, ex)).map((r) => r.path);
  assert.deepEqual(paths, ['keep.txt']);
  assert.doesNotMatch(await diffPatch(repo, 'HEAD', undefined, ex), /gone\.txt|new\.txt/);
});

test('an EMPTY pathspecs array is a no-op (legacy argv byte-identity)', async () => {
  const withArg = await diffNameStatus(repo, 'HEAD', undefined, []);
  const without = await diffNameStatus(repo, 'HEAD');
  assert.deepEqual(withArg, without);
  assert.equal(await diffPatch(repo, 'HEAD', undefined, []), await diffPatch(repo, 'HEAD'));
  assert.deepEqual([...(await diffNumstat(repo, 'HEAD', undefined, [])).keys()],
    [...(await diffNumstat(repo, 'HEAD')).keys()]);
});

// Review of PR #376: `-M -l0` (unlimited rename detection) had no spawn bound and
// the three diff helpers run on the Stop/error terminal path — a huge diff could
// hang a stop on git. Every diff helper now passes DIFF_TIMEOUT_MS, and the
// default runner honours it.
test('diff helpers pass a timeout to the runner; the default runner kills a hung command', async () => {
  const gi = await import('../src/core/git-info.mjs');
  const seam = gi._testing || gi;
  const seen = [];
  seam.setRunner(async (cmd, args, opts) => { seen.push({ cmd, args, opts }); return { ok: true, stdout: '', stderr: '', code: 0 }; });
  try {
    await gi.diffNameStatus('/tmp/x', 'base');
    await gi.diffNumstat('/tmp/x', 'base');
    await gi.diffPatch('/tmp/x', 'base');
    assert.equal(seen.length, 3);
    for (const s of seen) assert.equal(s.opts.timeout, gi.DIFF_TIMEOUT_MS, `${s.args.join(' ')} is bounded`);
  } finally {
    seam.setRunner(null);
  }
  const t0 = Date.now();
  const r = await seam.defaultRun(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { cwd: process.cwd(), timeout: 150 });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /timed out/);
  assert.ok(Date.now() - t0 < 5000, 'the hung child was killed, not awaited');
});
