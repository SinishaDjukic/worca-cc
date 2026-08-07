// test/subagent-migration-v8.test.mjs  (structure copied from subagent-migration-v7.test.mjs)
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-v8-')));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

// Minimal v7 seed: pipelines + sub_agents(+skills,+subagent_type) + pipeline_steps(+skills),
// stamped user_version=7. The v7->v8 migration adds graphify_count to BOTH agent tables,
// so the seed carries both with their full v7 columns and the v8 ALTERs are the only delta.
const V7_SEED = `
CREATE TABLE pipelines (id TEXT PRIMARY KEY, project_key TEXT);
CREATE TABLE sub_agents (pipeline_id TEXT, id TEXT, skills TEXT, subagent_type TEXT, PRIMARY KEY (pipeline_id,id));
CREATE TABLE pipeline_steps (pipeline_id TEXT, key TEXT, skills TEXT);
CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT, steps TEXT, feedbacks TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE config_workflow_nodes (project_key TEXT, workflow_id TEXT, node_id TEXT, model TEXT, effort TEXT, fan_out INTEGER, PRIMARY KEY (project_key,workflow_id,node_id));
INSERT INTO pipelines (id, project_key) VALUES ('p1','proj');
`;

test('opening a user_version=7 DB forward-migrates to v8 (adds graphify_count to both agent tables)', () => {
  mkdirSync(worcaHome(), { recursive: true });
  const seed = new DatabaseSync(dbPath());
  seed.exec(V7_SEED); seed.exec('PRAGMA user_version = 7');
  const subBefore = seed.prepare('PRAGMA table_info(sub_agents)').all().map((c) => c.name);
  const stepBefore = seed.prepare('PRAGMA table_info(pipeline_steps)').all().map((c) => c.name);
  assert.ok(!subBefore.includes('graphify_count'), 'seed sub_agents lacks graphify_count');
  assert.ok(!stepBefore.includes('graphify_count'), 'seed pipeline_steps lacks graphify_count');
  seed.close();

  const db = getDb(); // production open → runs migrate()
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 15, 'forward-migrated to v15');
  assert.ok(db.prepare('PRAGMA table_info(sub_agents)').all().map((c) => c.name).includes('graphify_count'));
  assert.ok(db.prepare('PRAGMA table_info(pipeline_steps)').all().map((c) => c.name).includes('graphify_count'));
  assert.ok(db.prepare("SELECT 1 FROM pipelines WHERE id='p1'").get(), 'pre-existing data preserved');
});
