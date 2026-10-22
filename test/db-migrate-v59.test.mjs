import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test('v59 adds run_tags and run_tag_events to a v56 DB (57-58 belong to Shaper)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE run_tag_events; DROP TABLE run_tags; PRAGMA user_version = 56');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 59);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);   // a later bump touches no test file (db.mjs)
  assert.deepEqual(cols(db, 'run_tags'), ['pipeline_id', 'key', 'value']);
  assert.deepEqual(cols(db, 'run_tag_events'), ['id', 'pipeline_id', 'ts', 'actor', 'before_tags', 'after_tags']);
});

test('run_tags holds one value per key per run', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("INSERT INTO pipelines (id, project_key) VALUES ('aaaaaaaa', 'p-12345678')");
  db.exec("INSERT INTO run_tags VALUES ('aaaaaaaa', 'client', 'acme')");
  assert.throws(() => db.exec("INSERT INTO run_tags VALUES ('aaaaaaaa', 'client', 'globex')"), /UNIQUE|PRIMARY/);
});
