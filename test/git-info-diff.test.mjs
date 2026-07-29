// test/git-info-diff.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { diffNameStatus, diffNumstat, diffPatch } from '../src/core/git-info.mjs';

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
