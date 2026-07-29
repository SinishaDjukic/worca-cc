// test/subagent-migration-v3.test.mjs
// Layer A (DB) — forward incremental migration v2 -> v3 adds sub_agents.ui_phase.
// Seeds a REAL on-disk v2 DB (pipelines + pipeline_steps + sub_agents,
// user_version=2), opens it through the production getDb(), and asserts the v3
// ladder step ran.
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-subagent-mig-v3-')));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

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
const V2_SUB_AGENTS = `
  CREATE TABLE sub_agents (
    pipeline_id TEXT NOT NULL, id TEXT NOT NULL, step_key TEXT, node_id TEXT,
    step_index INTEGER, cycle INTEGER, label TEXT,
    status TEXT NOT NULL DEFAULT 'running', started_at TEXT, finished_at TEXT,
    duration_ms INTEGER, tokens INTEGER, cost_usd REAL,
    PRIMARY KEY (pipeline_id, id),
    FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
  );
  CREATE INDEX idx_sub_agents_pipeline ON sub_agents (pipeline_id);
  CREATE INDEX idx_sub_agents_step ON sub_agents (pipeline_id, step_key);
`;

test('opening a user_version=2 DB forward-migrates to v3 (adds sub_agents.ui_phase)', () => {
  mkdirSync(worcaHome(), { recursive: true });
  const seed = new DatabaseSync(dbPath());
  seed.exec(V1_PIPELINES);
  seed.exec(V2_SUB_AGENTS);
  seed.exec('PRAGMA user_version = 2');
  const before = seed.prepare('PRAGMA table_info(sub_agents)').all().map((c) => c.name);
  assert.ok(!before.includes('ui_phase'), 'seed (v2) has no ui_phase column');
  seed.close();

  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13, 'forward-migrated to v13');
  const cols = db.prepare('PRAGMA table_info(sub_agents)').all().map((c) => c.name);
  assert.ok(cols.includes('ui_phase'), 'ui_phase column added by v2->v3 migration');
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='sub_agents'").get().n,
    1, 'sub_agents table preserved across the migration');
});
