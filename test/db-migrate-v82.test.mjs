// test/db-migrate-v82.test.mjs — v82 (core protection layer, part 2): pipelines.provider, pipeline_steps.provider and
// pipeline_steps.cost_known. INCREMENTAL_COLUMNS entries added by the hoisted repairSchemaGaps (a comment rung only),
// and their round trip through writeState / rowToState / the History list.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';
import { writeState, readPipelineStateById, listPipelines, listAllPipelines, ensureArtifactDirs } from '../src/core/artifacts.mjs';
import { projectKey } from '../src/core/store.mjs';

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all();

test('fresh DB is at v82 or later with provider and cost_known', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 82);
  assert.ok(cols(db, 'pipelines').some((c) => c.name === 'provider'));
  const steps = cols(db, 'pipeline_steps');
  assert.ok(steps.some((c) => c.name === 'provider'));
  const known = steps.find((c) => c.name === 'cost_known');
  assert.equal(known.notnull, 1);
  assert.equal(known.dflt_value, '1');
  // A chat turn's unknown cost is recorded the same way (pricing.mjs): never $0.
  const askKnown = cols(db, 'ask_messages').find((c) => c.name === 'cost_known');
  assert.equal(askKnown.notnull, 1);
  assert.equal(askKnown.dflt_value, '1');
});

test('a v81 DB gains the columns, an old step reads provider null and cost_known 1, and it reaches the current version', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE pipeline_steps DROP COLUMN cost_known; ALTER TABLE pipeline_steps DROP COLUMN provider; ALTER TABLE pipelines DROP COLUMN provider; ALTER TABLE ask_messages DROP COLUMN cost_known; PRAGMA user_version = 81');
  db.exec(`INSERT INTO pipelines (id, project_key, status) VALUES ('aaaa1111', 'proj-1', 'done')`);
  db.exec(`INSERT INTO pipeline_steps (pipeline_id, key, status) VALUES ('aaaa1111', 'plan', 'done')`);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const row = db.prepare("SELECT provider, cost_known FROM pipeline_steps WHERE pipeline_id = 'aaaa1111'").get();
  assert.deepEqual({ ...row }, { provider: null, cost_known: 1 });
  assert.equal(db.prepare("SELECT provider FROM pipelines WHERE id = 'aaaa1111'").get().provider, null);
  assert.ok(cols(db, 'ask_messages').some((c) => c.name === 'cost_known'), 'ask_messages gains cost_known too');
});

// ── round trips (a throwaway WORCA_HOME per test) ──
const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-v82-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

const state = (over = {}) => ({
  id: 'bbbb2222', title: 'Demo', projectDir: '/p', projectKey: 'proj-00000001', status: 'running', phase: 'plan', cycle: 1,
  startedAt: '2026-10-24T00:00:00Z', totalCostUsd: 0.1, totalActiveMs: 10, prompt: 'x',
  steps: [{ key: 'plan', phase: 'plan', cycle: 1, status: 'done', costUsd: 0.1, activeMs: 10, runningSince: null }],
  ...over,
});

test('a step\'s provider, unknown cost and token tally survive writeState and come back on read', async () => {
  await writeState('/d-bbbb2222', state({ steps: [
    { key: 'plan', phase: 'plan', cycle: 1, status: 'done', costUsd: 0, activeMs: 1, runningSince: null,
      provider: 'copilot', costKnown: false, usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } },
    { key: 'implement#1', phase: 'implement', cycle: 1, status: 'done', costUsd: 0.1, activeMs: 1, runningSince: null },
  ] }));
  const [a, b] = readPipelineStateById('bbbb2222').steps;
  assert.equal(a.provider, 'copilot');
  assert.equal(a.costKnown, false);
  assert.deepEqual(a.usage, { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 });
  assert.equal('provider' in b, false, 'only set keys: a step without one reads the same as it was written');
  assert.equal('costKnown' in b, false);
});

test('the run\'s provider is upserted, kept by a later write without one, and listed in History', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-v82-proj-'));
  homes.push(proj);
  await ensureArtifactDirs(proj);
  const key = projectKey(proj);
  await writeState('/d-cccc3333', state({ id: 'cccc3333', projectDir: proj, projectKey: key, provider: null }));
  await writeState('/d-cccc3333', state({ id: 'cccc3333', projectDir: proj, projectKey: key, provider: 'openai' }));
  assert.equal(readPipelineStateById('cccc3333').provider, 'openai');
  await writeState('/d-cccc3333', state({ id: 'cccc3333', projectDir: proj, projectKey: key, provider: null,
    steps: [{ key: 'plan', phase: 'plan', cycle: 1, status: 'done', costUsd: 0, activeMs: 1, runningSince: null, costKnown: false }] }));
  assert.equal(readPipelineStateById('cccc3333').provider, 'openai', 'a write without a provider keeps it');
  const entry = (await listPipelines(proj, { lite: true })).find((e) => e.id === 'cccc3333');
  assert.equal(entry.provider, 'openai');
  assert.equal(entry.costKnown, false, 'a step with an unknown cost marks the History row');
});

test('the cross-project History list (chat, History) marks a run with an unknown step cost too', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-v82-proj-'));
  homes.push(proj);
  await ensureArtifactDirs(proj);
  const key = projectKey(proj);
  await writeState('/d-dddd4444', state({ id: 'dddd4444', projectDir: proj, projectKey: key,
    steps: [{ key: 'plan', phase: 'plan', cycle: 1, status: 'done', costUsd: 0, activeMs: 1, runningSince: null, costKnown: false }] }));
  await writeState('/d-eeee5555', state({ id: 'eeee5555', projectDir: proj, projectKey: key }));
  const all = await listAllPipelines({ lite: true });
  assert.equal(all.find((e) => e.id === 'dddd4444').costKnown, false);
  assert.equal('costKnown' in all.find((e) => e.id === 'eeee5555'), false, 'a fully priced run carries no key');
});
