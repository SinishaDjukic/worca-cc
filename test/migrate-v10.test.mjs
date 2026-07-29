// test/migrate-v10.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate } from '../src/core/db.mjs';

useTempHome(after);

test('v10 adds nullable owner_pid/owner_host/heartbeat_at; user_version becomes 13', () => {
  const db = getDb(); // getDb() opens + migrates to SCHEMA_VERSION (11)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13);
  const cols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  for (const c of ['owner_pid', 'owner_host', 'heartbeat_at']) assert.ok(cols.includes(c), c);
});

test('incremental v9->v10 migration: migrate() adds columns on a v9 DB and stamps 12', () => {
  const db = new DatabaseSync(':memory:');
  // Apply V1 schema — a minimal pipelines table (just enough for ALTER TABLE to work)
  db.exec(`
    CREATE TABLE pipelines (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL DEFAULT '',
      workspace_key TEXT,
      target TEXT NOT NULL DEFAULT 'project',
      title TEXT,
      base_name TEXT,
      date_prefix TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      phase TEXT NOT NULL DEFAULT 'created',
      cycle INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      updated_at TEXT,
      total_cost_usd REAL NOT NULL DEFAULT 0,
      total_active_ms INTEGER NOT NULL DEFAULT 0,
      prompt TEXT,
      branch TEXT,
      workspace_meta TEXT,
      stepper TEXT,
      tools TEXT,
      resume_point TEXT,
      domain TEXT
    );
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, domain TEXT);
    CREATE TABLE IF NOT EXISTS config_workflow_nodes (project_key TEXT, workflow_id TEXT, node_id TEXT, model TEXT, effort TEXT, fan_out INTEGER, PRIMARY KEY (project_key,workflow_id,node_id));
    PRAGMA user_version = 9;
  `);
  // Insert a seed row — its new columns should come back as NULL
  db.prepare(`INSERT INTO pipelines (id, project_key) VALUES ('seed1', 'k1')`).run();

  // Now run the incremental migration
  migrate(db);

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13);
  const cols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  for (const c of ['owner_pid', 'owner_host', 'heartbeat_at']) assert.ok(cols.includes(c), c);
  const row = db.prepare('SELECT owner_pid, owner_host, heartbeat_at FROM pipelines WHERE id = ?').get('seed1');
  assert.equal(row.owner_pid, null);
  assert.equal(row.owner_host, null);
  assert.equal(row.heartbeat_at, null);
});
