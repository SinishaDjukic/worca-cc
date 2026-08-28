// test/db-migrate-v24.test.mjs
// V24 = the v2 break (spec §10.2). Reversible by construction: rows are archived,
// never deleted, and a physical .pre-v24.bak is taken before the transaction.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildResidueDb } from './helpers/db-residue-v22.mjs';
import { getDb, SCHEMA_VERSION } from '../src/core/db.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';

useTempHome(after);

test('V24 archives every live v1 template row and stamps the version', () => {
  const fx = buildResidueDb();
  const db = getDb();                                   // triggers migrate() 23 → 24
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 24);
  const live = db.prepare('SELECT id FROM workflows WHERE version = 1 AND archived_at IS NULL').all();
  assert.deepEqual(live, [], 'no live v1 row survives the break');
  for (const id of fx.v1Ids) {
    const row = db.prepare('SELECT version, steps, archived_at FROM workflows WHERE id = ?').get(id);
    assert.ok(row, `${id} still exists — archived, never deleted`);
    assert.equal(row.version, 1, 'the row is NOT converted');
    assert.notEqual(row.steps, '[]', 'its v1 topology is kept verbatim');
    assert.ok(row.archived_at, `${id} archived`);
  }
  assert.ok(existsSync(`${fx.dbFile}.pre-v24.bak`), 'a physical backup was taken before the tx');
  const report = JSON.parse(db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get().data);
  assert.deepEqual([...report.archived].sort(), [...fx.v1Ids].sort());
  assert.equal(report.seeded.length, SEED_TEMPLATES.length);
});

test('the 7 seed graphs are inserted on an EXISTING DB, as v2 rows with graph JSON', () => {
  buildResidueDb();
  const db = getDb();
  for (const t of SEED_TEMPLATES) {
    const row = db.prepare('SELECT name, version, domain, origin, steps, feedbacks, graph, created_at, archived_at FROM workflows WHERE id = ?').get(t.id);
    assert.ok(row, `${t.id} inserted`);
    assert.equal(row.version, 2);
    assert.equal(row.name, t.name);
    assert.equal(row.domain, t.domain);
    assert.equal(row.origin, null);
    assert.equal(row.steps, '[]');
    assert.equal(row.feedbacks, '[]');
    assert.equal(row.created_at, t.createdAt, 'the seed keeps its authored createdAt');
    assert.equal(row.archived_at, null);
    const graph = JSON.parse(row.graph);
    assert.deepEqual(Object.keys(graph).sort(), ['nodes', 'wires']);
    assert.equal(graph.nodes.length, t.nodes.length);
    assert.equal(graph.wires.length, t.wires.length);
  }
});
