// test/subagent-migration.test.mjs
// Layer A (DB) — forward incremental migration v1 -> v2 adds the sub_agents table.
// Seeds a REAL on-disk DB stamped user_version=1 (the v1 pipelines table — the
// v2 FK target — plus pipeline_steps, which the v5 step ALTERs), then opens it
// through the production getDb() and asserts the v2 ladder step ran: sub_agents
// + its two indexes exist and user_version is now 2.
// This is the first incremental (v1->vN) migration in the codebase.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb, _resetForTests, dbPath } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require('node:sqlite');

const homes = [];
beforeEach(async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-subagent-mig-')));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

// The exact v1 pipelines DDL (the only table sub_agents FKs to) + the v1
// pipeline_steps DDL (the v5 ladder step ALTERs it, so a faithful pre-v2 seed
// must carry it). Seeding these + user_version=1 reproduces a real pre-v2
// install for the upgrade path.
const V1_PIPELINES = `
  CREATE TABLE pipelines (
    id TEXT PRIMARY KEY, project_key TEXT NOT NULL, workspace_key TEXT,
    target TEXT NOT NULL DEFAULT 'project', title TEXT, base_name TEXT,
    date_prefix TEXT, status TEXT NOT NULL DEFAULT 'created',
    phase TEXT NOT NULL DEFAULT 'created', cycle INTEGER NOT NULL DEFAULT 0,
    started_at TEXT, updated_at TEXT, total_cost_usd REAL NOT NULL DEFAULT 0,
    total_active_ms INTEGER NOT NULL DEFAULT 0, prompt TEXT, branch TEXT,
    workspace_meta TEXT, stepper TEXT, tools TEXT
  );
  CREATE TABLE pipeline_steps (
    pipeline_id TEXT NOT NULL, key TEXT NOT NULL, node_id TEXT, phase TEXT,
    step_index INTEGER, cycle INTEGER, status TEXT, started_at TEXT,
    updated_at TEXT, active_ms INTEGER NOT NULL DEFAULT 0, running_since TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (pipeline_id, key),
    FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
  );
  CREATE TABLE workflows (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    steps TEXT NOT NULL DEFAULT '[]', feedbacks TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE config_workflow_nodes (
    project_key TEXT NOT NULL, workflow_id TEXT NOT NULL, node_id TEXT NOT NULL,
    model TEXT, effort TEXT, fan_out INTEGER,
    PRIMARY KEY (project_key, workflow_id, node_id)
  );
`;

test('opening a user_version=1 DB forward-migrates to v2 (adds sub_agents + indexes)', () => {
  // 1) Seed a real v1 DB file at <worcaHome>/worca-cc.db, stamped user_version=1.
  mkdirSync(worcaHome(), { recursive: true });
  const seed = new DatabaseSync(dbPath());
  seed.exec(V1_PIPELINES);
  seed.exec('PRAGMA user_version = 1');
  assert.equal(seed.prepare('PRAGMA user_version').get().user_version, 1, 'seeded at v1');
  assert.equal(
    seed.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='sub_agents'").get().n,
    0, 'seed DB has no sub_agents table (pre-v2)');
  seed.close();

  // 2) Open through production getDb() — migrate() must run the v2 ladder step.
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18, 'forward-migrated to v18 (the v2 step added sub_agents)');
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='sub_agents'").get().n,
    1, 'sub_agents table created by the v1->v2 migration');
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_sub_agents_%' ORDER BY name"
  ).all().map((r) => r.name);
  assert.deepEqual(idx, ['idx_sub_agents_pipeline', 'idx_sub_agents_step'], 'both sub_agents indexes created');

  // 3) The pre-existing v1 pipelines table is untouched (data-preserving migration).
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='pipelines'").get().n,
    1, 'v1 pipelines table preserved across the migration');
});
