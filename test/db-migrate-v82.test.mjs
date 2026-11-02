// test/db-migrate-v82.test.mjs — v82 (#711): the Git event automations tables, with the workspace rule scope and a
// workspace fix's member PRs. A v81 DB gains them and keeps its rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const TABLES = ['automation_rules', 'automation_events', 'automation_cursors', 'automation_deliveries'];
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test('a fresh DB has the automations tables with scope, workspace_id, prs and started_at', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  assert.ok(SCHEMA_VERSION >= 82);
  for (const t of TABLES) assert.ok(tables(db).includes(t), t);
  assert.ok(cols(db, 'automation_rules').includes('scope') && cols(db, 'automation_rules').includes('workspace_id'));
  assert.ok(cols(db, 'automation_events').includes('prs') && cols(db, 'automation_events').includes('started_at'));
});

test('a v81 DB gains the automations tables and keeps its rows', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec(TABLES.map((t) => `DROP TABLE ${t};`).join(' ') + ' PRAGMA user_version = 81');
  db.prepare("INSERT INTO store_meta (key, kind, data) VALUES ('k', 'setting', '1')").run();
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const t of TABLES) assert.ok(tables(db).includes(t), t);
  assert.equal(db.prepare("SELECT data FROM store_meta WHERE key = 'k'").get().data, '1');
  const at = '2026-10-31T10:00:00.000Z';
  db.prepare(`INSERT INTO automation_rules (id, project_key, project_dir, event, action, enabled_at, created_at, updated_at)
    VALUES ('aut_1', 'proj-1', '/repo', 'issue.opened', 'fix', ?, ?, ?)`).run(at, at, at);
  assert.deepEqual({ ...db.prepare('SELECT scope, workspace_id FROM automation_rules').get() }, { scope: 'project', workspace_id: null });
});
