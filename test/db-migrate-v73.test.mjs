// test/db-migrate-v73.test.mjs — req_briefs and req_cost_ledger.brief_id (plans/requirements-a7-design.md §3).
// Was v59 before the merge with dev (upstream's own v59 is run tags); renumbered to v73.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const COLS = ['id', 'scope_type', 'scope_key', 'status', 'sections_json', 'edited_json', 'sources_json', 'files_json',
  'seed_json', 'model', 'cost_usd', 'error_json', 'made_by', 'made_at', 'created_by', 'created_at', 'updated_by', 'updated_at'];
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const hasIndex = (db, name) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(name).n === 1;
/** Every table, column and index the requirements lanes (v71-v73) and their neighbours own. */
function assertComplete(db) {
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'req_briefs'), COLS);
  assert.ok(cols(db, 'req_cost_ledger').includes('brief_id'), 'req_cost_ledger.brief_id');
  for (const t of ['req_features', 'req_turns', 'req_contexts', 'req_cost_ledger', 'req_starts',
    'shape_features', 'shape_feature_slices', 'shape_plans', 'shape_feature_notes', 'run_tags', 'run_tag_events']) {
    assert.ok(cols(db, t).length, `${t} exists`);
  }
  assert.ok(cols(db, 'shape_feature_slices').includes('draft_pr_url'), "Shaper's v58 column");
  for (const i of ['req_starts_pipeline', 'req_starts_feature', 'req_cost_ledger_ts', 'req_features_scope', 'req_turns_feature']) {
    assert.ok(hasIndex(db, i), `index ${i}`);
  }
}

test('fresh DB has req_briefs and the ledger column', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 73);
  assertComplete(db);
});

test('a DB stamped 72 (ledger without the column) gets both', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE req_briefs; ALTER TABLE req_cost_ledger DROP COLUMN brief_id; PRAGMA user_version = 72');
  assert.ok(!cols(db, 'req_cost_ledger').includes('brief_id'));
  migrate(db);
  assertComplete(db);
});

test('a DB at upstream 70 (no requirements tables at all) reaches the current version with every table, column and index', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_briefs; DROP TABLE req_starts; DROP TABLE req_cost_ledger; DROP TABLE req_contexts;
    DROP TABLE req_turns; DROP TABLE req_features; PRAGMA user_version = 70`);
  migrate(db);
  assertComplete(db);
});

test('a DB stamped 59 by the pre-merge numbering (all requirements tables, no Shaper or run tags) reaches the current version', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  // the old local v59 had req_* (with req_briefs and brief_id) and none of upstream's 57+
  db.exec(`DROP TABLE shape_feature_notes; DROP TABLE shape_plans; DROP TABLE shape_feature_slices; DROP TABLE shape_features;
    DROP TABLE run_tag_events; DROP TABLE run_tags; PRAGMA user_version = 59`);
  db.prepare("INSERT INTO req_briefs (scope_type, scope_key, status, created_at, updated_at) VALUES ('project', 'p', 'made', 't', 't')").run();
  db.prepare("INSERT INTO req_cost_ledger (feature_seq, amount_usd, ts, brief_id) VALUES (0, 0.5, 1, 1)").run();
  migrate(db);
  assertComplete(db);
  assert.equal(db.prepare('SELECT status FROM req_briefs').get().status, 'made', 'the brief is kept');
  assert.equal(db.prepare('SELECT brief_id FROM req_cost_ledger').get().brief_id, 1, 'its spend is kept');
});

test('a DB stamped past this version without the table is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_briefs; PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(db);
  assert.deepEqual(cols(db, 'req_briefs'), COLS);
});

test('one brief per scope', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const ins = () => db.prepare("INSERT INTO req_briefs (scope_type, scope_key, status, created_at, updated_at) VALUES ('project','p','empty','t','t')").run();
  ins();
  assert.throws(ins, /UNIQUE/);
});
