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
