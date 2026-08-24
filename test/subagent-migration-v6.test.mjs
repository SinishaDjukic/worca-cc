// test/subagent-migration-v6.test.mjs  (structure copied from subagent-migration-v3.test.mjs)
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { getDb, dbPath, _resetForTests } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require('node:sqlite');
const homes = [];
beforeEach(async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-v6-')));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

// Minimal v5 seed: pipelines + sub_agents(+ui_phase) + pipeline_steps(+session_id), stamped user_version=5.
// (Only sub_agents and pipeline_steps are touched by the v5->v6 migration, so the minimal
//  seed is sufficient — migrate() runs ONLY `if (current < 6)` from a v5-stamped DB.)
const V5_SEED = `
CREATE TABLE pipelines (id TEXT PRIMARY KEY, project_key TEXT);
CREATE TABLE sub_agents (pipeline_id TEXT, id TEXT, ui_phase TEXT, PRIMARY KEY (pipeline_id,id));
CREATE TABLE pipeline_steps (pipeline_id TEXT, key TEXT, session_id TEXT, PRIMARY KEY (pipeline_id,key));
CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT, steps TEXT, feedbacks TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE config_workflow_nodes (project_key TEXT, workflow_id TEXT, node_id TEXT, model TEXT, effort TEXT, fan_out INTEGER, PRIMARY KEY (project_key,workflow_id,node_id));
INSERT INTO pipelines (id, project_key) VALUES ('p1','proj');
`;

test('opening a user_version=5 DB forward-migrates to v6 (adds skills to both agent tables)', () => {
  mkdirSync(worcaHome(), { recursive: true });
  const seed = new DatabaseSync(dbPath());
  seed.exec(V5_SEED); seed.exec('PRAGMA user_version = 5');
  const before = seed.prepare('PRAGMA table_info(sub_agents)').all().map((c) => c.name);
  assert.ok(!before.includes('skills'), 'seed lacks skills');
  seed.close();

  const db = getDb(); // production open → runs migrate()
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20, 'forward-migrated to v20');
  assert.ok(db.prepare('PRAGMA table_info(sub_agents)').all().map((c) => c.name).includes('skills'));
  assert.ok(db.prepare('PRAGMA table_info(pipeline_steps)').all().map((c) => c.name).includes('skills'));
  assert.ok(db.prepare("SELECT 1 FROM pipelines WHERE id='p1'").get(), 'pre-existing data preserved');
});
