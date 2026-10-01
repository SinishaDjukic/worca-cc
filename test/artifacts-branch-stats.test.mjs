// test/artifacts-branch-stats.test.mjs
// Phase 3.6 — rowToHistoryEntry computes survived + sourceBranch + added/removed
// from the row's branch JSON via the SAME (unchanged) git helpers. Fixtures seed
// DB rows via the production writers (seedPipeline -> createPipeline + writeState)
// + store_meta instead of state.json + meta.json. seedPipeline mints the id; look
// up by the RETURNED id (A15(3)).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let home, prevHome, repo;
let pp1Id; // minted id of the surviving-branch pipeline (test 1), reused by test 3

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-bs-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests(); // open the DB under this temp home
  // A real repo whose feature branch adds one line over main.
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-repo-'));
  const g = (a) => spawnSync('git', a, { cwd: repo });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(repo, 'f.txt'), 'a\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
  g(['checkout', '-q', '-b', 'worca-cc/feat-1']);
  await writeFile(join(repo, 'f.txt'), 'a\nb\n'); g(['add', '-A']); g(['commit', '-qm', 'add b']);
});

after(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

test('rowToHistoryEntry adds survived + sourceBranch + added/removed for a live branch', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  // Seed a pipeline row whose branch points at the repo's feature branch.
  const { id } = await seedPipeline(repo, {
    title: 'Feat', status: 'stopped', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-1', branchKept: true },
  });
  pp1Id = id; // reused by the machine-wide test below
  const rows = await listPipelines(repo);
  const row = rows.find((r) => r.id === id);
  assert.equal(row.branch, 'worca-cc/feat-1');
  assert.equal(row.sourceBranch, 'main');
  assert.equal(row.survived, true);
  assert.equal(row.added, 1);
  assert.equal(row.removed, 0);
});

test('rowToHistoryEntry reports survived=false when the branch is gone', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  const { id } = await seedPipeline(repo, {
    title: 'Gone', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/deleted', branchKept: true },
  });
  const row = (await listPipelines(repo)).find((r) => r.id === id);
  assert.equal(row.survived, false);
  assert.equal(row.added, 0);
  assert.equal(row.removed, 0);
});

test('listAllPipelines threads store_meta.path so survived/added are computed machine-wide', async () => {
  const { listAllPipelines, writeStoreMeta } = await import('../src/core/artifacts.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const key = projectKey(repo);
  // Pin the repo's store_meta path to the literal `repo` (createPipeline's ensureMeta
  // wrote a realpath'd path) so listAllPipelines hands meta.path into rowToHistoryEntry
  // as the git repo root AND row.projectDir === repo holds.
  writeStoreMeta(key, 'project', { key, name: 'Repo', path: repo });

  const rows = await listAllPipelines();
  const row = rows.find((r) => r.id === pp1Id);
  assert.ok(row, 'the surviving-branch pipeline is present in machine-wide history');
  assert.equal(row.projectDir, repo);
  assert.equal(row.survived, true);
  assert.equal(row.added, 1);
  assert.equal(row.removed, 0);
});

test('lite skips git enrichment on a row that would otherwise be enriched', async () => {
  // These fixtures are the only ones where enrichment is REAL (a live git repo whose
  // feature branch exists), so this is where `lite` can be proven to skip it.
  const { listAllPipelines } = await import('../src/core/artifacts.mjs');
  const full = await listAllPipelines();
  assert.equal(full.find((r) => r.id === pp1Id).survived, true, 'fixture sanity: enrichment is real here');
  const lite = await listAllPipelines({ lite: true });
  const r = lite.find((x) => x.id === pp1Id);
  assert.equal(r.survived, false);
  assert.equal(r.added, 0);
});

// A finished run's results.json summary is the frozen truth: once the feature branch
// is merged into source the three-dot diff is empty, yet the row keeps the run's counts.
test('a run dir with results.json reports its frozen summary counts after the branch merged', async () => {
  const { listPipelines, listAllPipelines, writeStoreMeta } = await import('../src/core/artifacts.mjs');
  const { diffShortstat } = await import('../src/core/git-info.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const merged = await mkdtemp(join(tmpdir(), 'worca-cc-merged-'));
  try {
    const g = (a) => spawnSync('git', a, { cwd: merged });
    g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    await writeFile(join(merged, 'f.txt'), 'a\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
    g(['checkout', '-q', '-b', 'worca-cc/feat-m']);
    await writeFile(join(merged, 'f.txt'), 'b\nc\n'); g(['add', '-A']); g(['commit', '-qm', 'rewrite']);
    g(['checkout', '-q', 'main']); g(['merge', '-q', '--no-ff', '-m', 'merge feat-m', 'worca-cc/feat-m']);
    assert.deepEqual(await diffShortstat(merged, 'main', 'worca-cc/feat-m'), { added: 0, removed: 0 },
      'fixture sanity: the live three-dot diff of a merged branch is empty');

    const { id, dir } = await seedPipeline(merged, {
      title: 'Merged', status: 'done', startedAt: '2026-06-03T00:00:00Z',
      branch: { source: 'main', feature: 'worca-cc/feat-m', branchKept: true },
    });
    await writeFile(join(dir, 'results.json'), JSON.stringify({
      summary: { filesNew: 0, filesChanged: 1, filesDeleted: 0, linesAdded: 7, linesRemoved: 3, blockingIssues: 0, nitpicks: 0 },
    }));

    const row = (await listPipelines(merged)).find((r) => r.id === id);
    assert.equal(row.survived, true, 'survived stays the live "branch exists" fact');
    assert.equal(row.added, 7);
    assert.equal(row.removed, 3);
    assert.equal(row.diffFrozen, true);

    const key = projectKey(merged);
    writeStoreMeta(key, 'project', { key, name: 'Merged', path: merged });
    const all = (await listAllPipelines()).find((r) => r.id === id);
    assert.equal(all.added, 7);
    assert.equal(all.removed, 3);
    assert.equal(all.diffFrozen, true);
  } finally {
    await rm(merged, { recursive: true, force: true });
  }
});

test('frozen counts survive a deleted branch; a bad or non-numeric results.json falls back to live', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  const gone = await seedPipeline(repo, {
    title: 'Gone frozen', status: 'done', startedAt: '2026-06-04T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/deleted-frozen', branchKept: false },
  });
  await writeFile(join(gone.dir, 'results.json'), JSON.stringify({ summary: { linesAdded: 4, linesRemoved: 9 } }));
  const bad = await seedPipeline(repo, {
    title: 'Bad json', status: 'done', startedAt: '2026-06-04T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-1', branchKept: true },
  });
  await writeFile(join(bad.dir, 'results.json'), '{ not json');
  const odd = await seedPipeline(repo, {
    title: 'No numbers', status: 'done', startedAt: '2026-06-04T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-1', branchKept: true },
  });
  await writeFile(join(odd.dir, 'results.json'), JSON.stringify({ summary: { linesAdded: '4', linesRemoved: null } }));

  const rows = await listPipelines(repo);
  const g = rows.find((r) => r.id === gone.id);
  assert.equal(g.survived, false);
  assert.equal(g.added, 4);
  assert.equal(g.removed, 9);
  assert.equal(g.diffFrozen, true);
  for (const { id } of [bad, odd]) {
    const r = rows.find((x) => x.id === id);
    assert.equal(r.diffFrozen, false, 'no usable summary -> not frozen');
    assert.equal(r.survived, true);
    assert.equal(r.added, 1, 'live diffShortstat fallback');
    assert.equal(r.removed, 0);
  }
  const live = rows.find((r) => r.id === pp1Id);
  assert.equal(live.diffFrozen, false, 'a run dir without results.json is not frozen');

  // `lite` callers read only DB fields, so they skip the per-run file read too.
  const { listAllPipelines } = await import('../src/core/artifacts.mjs');
  const lite = (await listAllPipelines({ lite: true })).find((r) => r.id === gone.id);
  assert.equal(lite.added, 0);
  assert.equal(lite.diffFrozen, false);
});

test('history rows carry the review count and the files changed from results.json', async () => {
  const { listPipelines, listAllPipelines } = await import('../src/core/artifacts.mjs');
  const seed = (title) => seedPipeline(repo, {
    title, status: 'done', startedAt: '2026-06-05T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-1', branchKept: true },
  });
  const reviewed = await seed('Reviewed');
  await writeFile(join(reviewed.dir, 'results.json'), JSON.stringify({
    summary: { filesNew: 1, filesChanged: 2, filesDeleted: 0, linesAdded: 5, linesRemoved: 1 },
    keyThingsToCheck: [{ title: 'a' }, { title: 'b' }],
  }));
  const members = await seed('Per project');
  await writeFile(join(members.dir, 'results.json'), JSON.stringify({
    summary: { filesNew: 0, filesChanged: 0, filesDeleted: 0 },
    perProject: { a: { keyThingsToCheck: [{}] }, b: { keyThingsToCheck: [{}, {}] } },
  }));
  const bare = await seed('No list');
  await writeFile(join(bare.dir, 'results.json'), JSON.stringify({ summary: { filesNew: 0, filesChanged: 4, filesDeleted: 1 } }));
  const pending = await seed('No results yet');     // no results.json at all

  const rows = await listPipelines(repo);
  const r = rows.find((x) => x.id === reviewed.id);
  assert.equal(r.checks, 2);
  assert.equal(r.files, 3);
  assert.deepEqual([r.added, r.removed], [5, 1], 'the frozen line counts still come from the same read');
  const m = rows.find((x) => x.id === members.id);
  assert.equal(m.checks, 3, 'a workspace-shaped result sums its members, as hdChecks does');
  assert.equal(m.files, 0);
  const b = rows.find((x) => x.id === bare.id);
  assert.equal(b.checks, 0, 'a results file without the list counts 0 (the glance says Ready to ship)');
  assert.equal(b.files, 5, 'new + changed + deleted, the glance headline’s own sum (rdFilesChanged)');
  const p = rows.find((x) => x.id === pending.id);
  assert.equal(p.checks, null, 'no results.json: unknown, not zero');
  assert.equal(p.files, null);
  const lite = (await listAllPipelines({ lite: true })).find((x) => x.id === reviewed.id);
  assert.equal(lite.checks, null, 'lite callers skip the file read');
  assert.equal(lite.files, null);
});

// #527 §4.5: a REMOTE-started run (startRef set) branched from origin/<base> while the local
// <base> had diverged. source...feature would count the remote's commits as the run's own;
// the recorded start (baseSha) is the real merge base. Without startRef: today's count.
test('a remote-started run diffs from its recorded baseSha; without startRef it keeps source...feature', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  const r2 = await mkdtemp(join(tmpdir(), 'worca-cc-rs-'));
  try {
    const g = (a) => spawnSync('git', a, { cwd: r2, encoding: 'utf8' });
    g(['init', '-q', '-b', 'dev']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    await writeFile(join(r2, 'f.txt'), 'a\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
    // The remote's tip: three upstream lines the local dev never got.
    g(['checkout', '-q', '-b', 'upstream-tip']);
    await writeFile(join(r2, 'u.txt'), 'u1\nu2\nu3\n'); g(['add', '-A']); g(['commit', '-qm', 'upstream']);
    const start = g(['rev-parse', 'HEAD']).stdout.trim();
    // The run's feature branch off that start: one line of its own.
    g(['checkout', '-q', '-b', 'worca-cc/remote-start']);
    await writeFile(join(r2, 'mine.txt'), 'm\n'); g(['add', '-A']); g(['commit', '-qm', 'mine']);
    // Local dev diverges with its own commit.
    g(['checkout', '-q', 'dev']);
    await writeFile(join(r2, 'local.txt'), 'l\n'); g(['add', '-A']); g(['commit', '-qm', 'local']);

    const withStart = await seedPipeline(r2, {
      title: 'Remote start', status: 'stopped', startedAt: '2026-09-30T00:00:00Z',
      branch: { source: 'dev', feature: 'worca-cc/remote-start', baseSha: start, startRef: start, branchKept: true },
    });
    const noStart = await seedPipeline(r2, {
      title: 'Plain', status: 'stopped', startedAt: '2026-09-30T00:00:00Z',
      branch: { source: 'dev', feature: 'worca-cc/remote-start', baseSha: start, branchKept: true },
    });
    const rows = await listPipelines(r2);
    const a = rows.find((r) => r.id === withStart.id);
    assert.equal(a.added, 1, 'only the feature\'s own line');
    assert.equal(a.removed, 0);
    const b = rows.find((r) => r.id === noStart.id);
    assert.equal(b.added, 4, 'no startRef → today\'s dev...feature count (upstream lines included)');
  } finally {
    await rm(r2, { recursive: true, force: true });
  }
});

test('rowToHistoryEntry: a same-branch run carries sameAsSource + mergeBack; other runs keep their shape', async () => {
  const { listPipelines } = await import('../src/core/artifacts.mjs');
  const same = await seedPipeline(repo, { title: 'Same', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-1', sameAsSource: true,
      mergeBack: { merged: false, kind: 'dirty', reason: 'main is checked out in /x with 1 uncommitted change(s)', at: 't' } } });
  const plain = await seedPipeline(repo, { title: 'Plain', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-1' } });
  const rows = await listPipelines(repo);
  const s = rows.find((r) => r.id === same.id);
  assert.equal(s.sameAsSource, true);
  assert.equal(s.mergeBack.merged, false);
  assert.deepEqual(s.mergeBack.members.map((m) => [m.source, m.branch, m.merged, m.kind]), [['main', 'worca-cc/feat-1', false, 'dirty']]);
  const p = rows.find((r) => r.id === plain.id);
  assert.equal('sameAsSource' in p, false);
  assert.equal('mergeBack' in p, false);
});
