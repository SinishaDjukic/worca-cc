// test/subagent-migration-v7.test.mjs  (structure copied from subagent-migration-v6.test.mjs)
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-v7-')));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

// Minimal v6 seed: pipelines + sub_agents(+skills) + pipeline_steps(+skills),
// stamped user_version=6. migrate() runs the v7 step (subagent_type on sub_agents)
// AND the v8 step (graphify_count on BOTH agent tables) from this v6-stamped DB, so
// the seed must carry pipeline_steps too — a real v6 DB has it (from v1, +skills at
// v6). Both tables carry their full v6 columns so the later ALTERs are the only delta.
const V6_SEED = `
CREATE TABLE pipelines (id TEXT PRIMARY KEY, project_key TEXT);
CREATE TABLE sub_agents (pipeline_id TEXT, id TEXT, skills TEXT, PRIMARY KEY (pipeline_id,id));
CREATE TABLE pipeline_steps (pipeline_id TEXT, key TEXT, skills TEXT, PRIMARY KEY (pipeline_id,key));
CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT, steps TEXT, feedbacks TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE config_workflow_nodes (project_key TEXT, workflow_id TEXT, node_id TEXT, model TEXT, effort TEXT, fan_out INTEGER, PRIMARY KEY (project_key,workflow_id,node_id));
INSERT INTO pipelines (id, project_key) VALUES ('p1','proj');
`;

test('opening a user_version=6 DB forward-migrates to v7 (adds subagent_type to sub_agents)', () => {
  mkdirSync(worcaHome(), { recursive: true });
  const seed = new DatabaseSync(dbPath());
  seed.exec(V6_SEED); seed.exec('PRAGMA user_version = 6');
  const before = seed.prepare('PRAGMA table_info(sub_agents)').all().map((c) => c.name);
  assert.ok(!before.includes('subagent_type'), 'seed lacks subagent_type');
  seed.close();

  const db = getDb(); // production open → runs migrate()
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14, 'forward-migrated to v14');
  assert.ok(db.prepare('PRAGMA table_info(sub_agents)').all().map((c) => c.name).includes('subagent_type'));
  assert.ok(db.prepare("SELECT 1 FROM pipelines WHERE id='p1'").get(), 'pre-existing data preserved');
});
