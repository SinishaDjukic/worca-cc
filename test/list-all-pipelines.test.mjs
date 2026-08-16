// test/list-all-pipelines.test.mjs
// Phase 3.6 — listAllPipelines SELECTs from the pipelines table; project/workspace
// names come from store_meta rows. Fixtures now seed DB rows via the production
// writers (seedPipeline / seedWorkspacePipeline -> createPipeline + writeState) +
// store_meta (writeStoreMeta), not state.json + meta.json files. The wire shape is
// identical to the legacy walk. Keys are content-derived (createPipeline mints id +
// projectKey hashes the dir), so the assertions use the RETURNED id/key (A15(3)),
// not the legacy literal labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAllPipelines, writeStoreMeta, deleteStoreMeta } from '../src/core/artifacts.mjs';
import { _resetForTests, prepare } from '../src/core/db.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

// Seed a single-project pipeline under a throwaway dir; pin its store_meta name (so
// the projectName assertion is deterministic). When `name` is null this is the
// ORPHAN case — createPipeline's ensureMeta always writes a meta row, so DELETE it
// to reproduce a pipeline whose project has no meta name (projectName then falls
// back to the content-derived key in listAllPipelines). Returns { pid, key }.
async function seed(name, title) {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-all-proj-'));
  const { id: pid, key } = await seedPipeline(proj, {
    title, status: 'done', startedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
  });
  if (name != null) writeStoreMeta(key, 'project', { key, path: proj, name });
  else deleteStoreMeta(key); // orphan: no meta -> name falls back to the key
  return { pid, key };
}

test('listAllPipelines merges every store key, tags project, sorts newest-first', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-all-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const a = await seed('Alpha', 'Alpha run');
    await seed('Beta', 'Beta run');
    const o = await seed(null, 'Orphan run'); // no name -> falls back to the key
    const all = await listAllPipelines();
    assert.equal(all.length, 3);
    const byId = Object.fromEntries(all.map((p) => [p.id, p]));
    assert.equal(byId[a.pid].projectName, 'Alpha');
    assert.equal(byId[a.pid].projectKey, a.key);
    assert.equal(byId[o.pid].projectName, o.key, 'orphan (no meta name) falls back to the key');
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('listAllPipelines descends workspaces/ and tags the row with a composite key + target', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-allws-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const a = await seed('Alpha', 'Alpha run');
    // Workspace pipeline: seedWorkspacePipeline routes through createPipeline's
    // workspace path (writes the ws store_meta + workspace superset). Pin the ws
    // store_meta so name + primary projectPaths[0] are deterministic.
    const wkey = 'wks-demo-9f3a1c20';
    const primary = await mkdtemp(join(tmpdir(), 'worca-cc-all-wsprim-'));
    const projects = [{ projectKey: 'm1-00000001', projectDir: '/abs/one', projectName: 'm1' }];
    const { id: w1 } = await seedWorkspacePipeline(primary, wkey, {
      title: 'WS run', status: 'done', workspaceName: 'Demo WS',
      startedAt: '2026-06-02T00:00:00Z', updatedAt: '2026-06-02T00:00:00Z',
    }, projects);
    writeStoreMeta(wkey, 'workspace', {
      key: wkey, id: wkey, name: 'Demo WS', projectKeys: ['m1-00000001'], projectPaths: ['/abs/one', '/abs/two'],
    });
    const all = await listAllPipelines();
    assert.equal(all.length, 2, 'project row + workspace row, NOT a bogus "workspaces" key row');
    const ws = all.find((p) => p.id === w1);
    assert.ok(ws, 'workspace pipeline discovered by the machine-wide walker');
    assert.equal(ws.projectKey, `workspaces/${wkey}`, 'literal store-relative composite key');
    assert.equal(ws.target, 'workspace');
    assert.equal(ws.projectName, 'Demo WS', 'name from the workspace meta');
    assert.equal(ws.workspaceName, 'Demo WS', 'explicit workspaceName the History UI prefers');
    assert.equal(ws.projectDir, '/abs/one', 'primary projectPaths[0]');
    // The single-project row keeps target undefined (or non-workspace).
    const proj = all.find((p) => p.id === a.pid);
    assert.notEqual(proj.target, 'workspace');
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('listAllPipelines returns [] when the store is absent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-all-empty-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try { assert.deepEqual(await listAllPipelines(), []); }
  finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('listAllPipelines limit: bounded rows, ordered by recency of update', async () => {
  // Chat history asks for a handful of the newest runs, so the LIMIT lives in SQL
  // (no point building rows nobody reads). It must select the SAME top-n the callers
  // see after the mtime sort — hence the ORDER BY keys on COALESCE(updated_at, started_at).
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-all-limit-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const a = await seed('Alpha', 'Alpha run');
    const b = await seed('Beta', 'Beta run');
    const c = await seed('Gamma', 'Gamma run');
    // seed() stamps IDENTICAL timestamps (and writeState re-stamps updated_at to "now"),
    // so pin explicit DISTINCT times — equal stamps would make which rows survive the
    // LIMIT tie-order-dependent. A is the OLDEST-started but the NEWEST-updated row: a
    // LIMIT keyed on started_at would drop it, the mtime order the callers see keeps it.
    const stamp = prepare('UPDATE pipelines SET started_at = ?, updated_at = ? WHERE id = ?');
    stamp.run('2026-06-01T00:00:00Z', '2026-06-09T00:00:00Z', a.pid);
    stamp.run('2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z', b.pid);
    stamp.run('2026-06-08T00:00:00Z', '2026-06-08T00:00:00Z', c.pid);
    const rows = await listAllPipelines({ limit: 2, lite: true });
    assert.equal(rows.length, 2, 'SQL LIMIT bounds how many rows are built');
    assert.equal(rows[0].id, a.pid,
      'SQL LIMIT must agree with the mtime (updated_at) sort the callers see — LIMIT on started_at would drop this row');
    assert.equal(rows[1].id, c.pid, 'next-newest by updated_at');
    assert.equal((await listAllPipelines()).length, 3, 'no limit -> every row, as before');
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('listAllPipelines orders equal-mtime rows deterministically by (projectKey,id)', async () => {
  // The build runs in parallel batches, so equal-mtime rows must not reorder
  // run-to-run. The sort tiebreaker keys on (projectKey, id). Seeding both rows
  // with the SAME updatedAt makes mtime tie so only the tiebreaker decides. Keys are
  // content-derived now, so compute the EXPECTED order from the actual returned keys
  // (sorted) rather than hardcoding alpha<zeta.
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-all-det-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try {
    const one = await seed('Zeta', 'Zeta run');
    const two = await seed('Alpha', 'Alpha run');
    // writeState re-stamps updated_at to "now", so the two seeds get DISTINCT mtimes
    // (the production list sorts by mtime first). Pin both rows to the SAME updated_at
    // so mtime ties and ONLY the (projectKey asc, id asc) tiebreaker decides — the
    // DB-native equivalent of the legacy utimes() trick, matching this test's intent.
    prepare('UPDATE pipelines SET updated_at = ? WHERE id IN (?, ?)')
      .run('2026-06-01T00:00:00Z', one.pid, two.pid);
    const order1 = (await listAllPipelines()).map((p) => `${p.projectKey}/${p.id}`);
    const order2 = (await listAllPipelines()).map((p) => `${p.projectKey}/${p.id}`);
    assert.deepEqual(order1, order2, 'stable across repeated calls');
    // Same updatedAt => mtime ties => the (projectKey asc, id asc) tiebreaker decides.
    // Mirror that exact comparator over the seeded rows to derive the expected order.
    const expected = [one, two]
      .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : (x.pid < y.pid ? -1 : 1)))
      .map((r) => `${r.key}/${r.pid}`);
    assert.deepEqual(order1, expected, 'projectKey asc then id asc when mtimes tie');
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
