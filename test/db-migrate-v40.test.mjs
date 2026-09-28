// test/db-migrate-v40.test.mjs
// v40: workspaces.map_json + map_overrides_json + description_origin (workspace map). The
// fresh-DB path, the self-heal path (stamped past current, columns missing) and the ladder
// path (stamped v39, columns missing). Modelled on test/db-migrate-v30.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const V40 = ['map_json', 'map_overrides_json', 'description_origin'];
const cols = (db) => db.prepare('PRAGMA table_info(workspaces)').all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

/** Rebuild workspaces WITHOUT the v40 columns (every older column kept), keep its rows, stamp `v`. */
function dropV40(db, v) {
  db.exec(`CREATE TABLE workspaces_old AS
             SELECT id, name, description, metrics_project, policy_project, created_at, updated_at FROM workspaces;
           DROP TABLE workspaces; ALTER TABLE workspaces_old RENAME TO workspaces;
           PRAGMA user_version = ${v};`);
}

test('v40 adds the three nullable workspace-map columns on a fresh DB', () => {
  assert.ok(SCHEMA_VERSION >= 40);
  const db = new DatabaseSync(':memory:');
  migrate(db);
  for (const c of V40) assert.ok(cols(db).includes(c), c);
  assert.equal(version(db), SCHEMA_VERSION);
  db.close();
});

test('a v39-stamped DB without the columns is healed by the ladder in ONE migrate, rows kept, NULLs', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare("INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES ('wks-a-00000000', 'A', 'kept', 't', 't')").run();
  dropV40(db, 39);
  for (const c of V40) assert.ok(!cols(db).includes(c), `precondition: ${c} dropped`);
  migrate(db);
  for (const c of V40) assert.ok(cols(db).includes(c), c);
  assert.equal(version(db), SCHEMA_VERSION);
  const row = db.prepare('SELECT description, map_json, map_overrides_json, description_origin FROM workspaces').get();
  assert.deepEqual({ ...row }, { description: 'kept', map_json: null, map_overrides_json: null, description_origin: null });
  db.close();
});

test('self-heal: stamped past current (a divergent ladder), columns missing, is ALTERed and not re-stamped', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  dropV40(db, SCHEMA_VERSION + 1);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION + 1);
  for (const c of V40) assert.ok(cols(db).includes(c), c);
  db.close();
});
