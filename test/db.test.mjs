// test/db.test.mjs
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { getDb, closeDb, _resetForTests, prepare, tx, migrate as _migrateForTest, SCHEMA_VERSION } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { _migrateFromFsCallCount, _resetMigrateFromFsCallCount } from '../src/core/migrate-fs-to-db.mjs';

// Each test gets its own WORCA_HOME so the singleton DB path is fresh and
// isolated; _resetForTests() drops the cached handle so the next getDb() reopens
// against the new home. Mirrors the temp-home discipline in projects.test.mjs.
// A14: realpath() canonicalizes the temp dir so db.location() (which resolves
// symlinks on macOS) agrees with worcaHome() (which does not canonicalize).
const homes = [];
async function freshHome() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-db-')));
  homes.push(dir);
  _resetForTests();
  _resetMigrateFromFsCallCount();
  process.env.WORCA_HOME = dir;
  return dir;
}

beforeEach(async () => {
  await freshHome();
});

after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('getDb() opens a DatabaseSync at <worcaHome>/worca-cc.db', () => {
  const db = getDb();
  assert.ok(db, 'getDb() returns a handle');
  const dbPath = join(worcaHome(), 'worca-cc.db');
  assert.equal(db.location(), dbPath, 'db.location() is <worcaHome>/worca-cc.db');
  assert.ok(existsSync(dbPath), 'the db file is created on disk');
});

test('getDb() is a singleton — same handle across calls', () => {
  assert.equal(getDb(), getDb(), 'repeated getDb() returns the same instance');
});

test('closeDb() then getDb() reopens a fresh handle', () => {
  const a = getDb();
  closeDb();
  const b = getDb();
  assert.notEqual(a, b, 'a new handle is created after closeDb()');
});

test('first open sets the required pragmas', () => {
  const db = getDb();
  const jm = db.prepare('PRAGMA journal_mode').get();
  assert.equal(String(jm.journal_mode).toLowerCase(), 'wal', 'journal_mode=WAL');

  const fk = db.prepare('PRAGMA foreign_keys').get();
  assert.equal(fk.foreign_keys, 1, 'foreign_keys=ON');

  const bt = db.prepare('PRAGMA busy_timeout').get();
  assert.equal(bt.timeout, 5000, 'busy_timeout=5000ms');

  const sy = db.prepare('PRAGMA synchronous').get();
  assert.equal(sy.synchronous, 1, 'synchronous=NORMAL (1)');
});

// The full set of tables the spec's schema (§3) requires.
const EXPECTED_TABLES = [
  'projects',
  'workspaces',
  'workspace_projects',
  'workflows',
  'project_config',
  'config_workflow_nodes',
  'config_workflow_feedbacks',
  'pipelines',
  'pipeline_steps',
  'pipeline_events',
  'clarify',
  'reviews',
  'store_meta',
  'artifacts',
  'sub_agents',
  'pipeline_phases',
  'pipeline_tasks',
  'step_questions',
];

// Every index the spec mandates (pipelines fan-out indexes, append-only event
// index). Names are stable contracts other phases' EXPLAIN-tuning may rely on.
const EXPECTED_INDEXES = [
  'idx_pipelines_project_started',
  'idx_pipelines_workspace_started',
  'idx_pipelines_status',
  'idx_pipeline_events_pipeline',
  'idx_sub_agents_pipeline',
  'idx_sub_agents_step',
];

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function indexNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

test('migrate creates all 18 spec tables', () => {
  const db = getDb();
  const present = new Set(tableNames(db));
  for (const t of EXPECTED_TABLES) {
    assert.ok(present.has(t), `table "${t}" is present`);
  }
  assert.equal(EXPECTED_TABLES.length, 18, 'the spec defines exactly 18 tables (v11: +step_questions)');
});

test('migrate creates every required index', () => {
  const db = getDb();
  const present = new Set(indexNames(db));
  for (const ix of EXPECTED_INDEXES) {
    assert.ok(present.has(ix), `index "${ix}" is present`);
  }
});

test('migrate stamps user_version = SCHEMA_VERSION', () => {
  const db = getDb();
  const { user_version } = db.prepare('PRAGMA user_version').get();
  assert.equal(user_version, SCHEMA_VERSION, 'schema version is current after migrate');
});

test('migrate() reaches v11 and adds workflows.domain + liveness columns', async () => {
  await freshHome();
  const db = getDb();                                   // triggers migrate()
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const wfCols = db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name);
  assert.ok(wfCols.includes('domain'), 'workflows.domain column exists');
  const pipCols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  for (const c of ['owner_pid', 'owner_host', 'heartbeat_at']) {
    assert.ok(pipCols.includes(c), `pipelines.${c} column exists`);
  }
});

test('v8 DB upgrades in place and pre-migration rows survive', async () => {
  await freshHome();
  const db = getDb();
  db.exec("INSERT INTO workflows (id,name,version,steps,feedbacks,created_at,updated_at) " +
          "VALUES ('wf_legacy','Legacy',1,'[]','[]','1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z')");
  const row = db.prepare('SELECT domain FROM workflows WHERE id = ?').get('wf_legacy');
  assert.equal(row.domain, null);                       // stored NULL; store layer COALESCEs to 'general'
});

test('v4 adds pipeline_phases + pipeline_tasks with expected columns', () => {
  const db = getDb();
  const phaseCols = db.prepare('PRAGMA table_info(pipeline_phases)').all().map((c) => c.name);
  assert.deepEqual(phaseCols, ['pipeline_id', 'ordinal', 'status', 'started_at', 'finished_at']);
  const taskCols = db.prepare('PRAGMA table_info(pipeline_tasks)').all().map((c) => c.name);
  assert.deepEqual(taskCols, [
    'pipeline_id', 'id', 'phase_ordinal', 'task_index', 'title',
    'file_rel_path', 'node_id', 'status', 'started_at', 'finished_at',
  ]);
});

test('migrate() is idempotent — second run is a no-op, version stable', () => {
  const db = getDb();
  const before = db.prepare('PRAGMA user_version').get().user_version;
  const tablesBefore = tableNames(db).length;
  // Re-import migrate and run it again directly on the same handle.
  assert.doesNotThrow(() => _migrateForTest(db), 'second migrate() does not throw');
  const after = db.prepare('PRAGMA user_version').get().user_version;
  assert.equal(after, before, 'user_version is unchanged by a second migrate()');
  assert.equal(tableNames(db).length, tablesBefore, 'no duplicate/extra tables');
});

test('foreign keys enforce referential integrity (pipeline_steps -> pipelines)', () => {
  const db = getDb();
  // No such pipeline row -> inserting a child step must be rejected by the FK.
  const stmt = db.prepare(
    'INSERT INTO pipeline_steps (pipeline_id, key, status) VALUES (?, ?, ?)'
  );
  assert.throws(() => stmt.run('no-such-pipeline', '0:s0_0', 'start'), /FOREIGN KEY/i);
});

test('tx() commits on success', () => {
  const db = getDb();
  // store_meta has no FK, so it is a clean target for a standalone write.
  const out = tx(() => {
    db.prepare("INSERT INTO store_meta (key, kind, data) VALUES (?, ?, ?)")
      .run('k-commit', 'project', '{"name":"x"}');
    return 'done';
  });
  assert.equal(out, 'done', 'tx() returns the callback result');
  const row = db.prepare('SELECT kind FROM store_meta WHERE key = ?').get('k-commit');
  assert.equal(row.kind, 'project', 'the inserted row is committed');
});

test('tx() rolls back on throw', () => {
  const db = getDb();
  assert.throws(() => {
    tx(() => {
      db.prepare("INSERT INTO store_meta (key, kind, data) VALUES (?, ?, ?)")
        .run('k-rollback', 'project', '{}');
      throw new Error('boom');
    });
  }, /boom/, 'the original error propagates');
  const row = db.prepare('SELECT key FROM store_meta WHERE key = ?').get('k-rollback');
  assert.equal(row, undefined, 'the partial write was rolled back');
});

test('tx() is not nestable by default (single-level transaction)', () => {
  const db = getDb();
  // A nested tx() would attempt a second BEGIN; assert tx() guards against it
  // rather than corrupting the outer transaction.
  assert.throws(() => {
    tx(() => {
      tx(() => {});
    });
  }, /transaction already active|nested/i);
});

test('prepare() caches by SQL text — same statement instance', () => {
  const sql = 'SELECT key FROM store_meta WHERE key = ?';
  const a = prepare(sql);
  const b = prepare(sql);
  assert.equal(a, b, 'identical SQL returns the cached StatementSync');
});

test('prepare() returns a usable statement', () => {
  const db = getDb();
  db.prepare("INSERT INTO store_meta (key, kind, data) VALUES (?, ?, ?)")
    .run('k-prep', 'workspace', '{}');
  const row = prepare('SELECT kind FROM store_meta WHERE key = ?').get('k-prep');
  assert.equal(row.kind, 'workspace', 'the cached statement executes');
});

test('_resetForTests() clears the statement cache and closes the handle', () => {
  const sql = 'SELECT 1 AS one';
  const first = prepare(sql);
  _resetForTests();
  const second = prepare(sql);
  assert.notEqual(first, second, 'a fresh statement is prepared after reset');
});

test('getDb() calls maybeMigrateFromFs(db) once after migrate()', () => {
  // A14: ESM namespace exports are non-configurable, so mock.method() throws
  // "Cannot redefine property". Instead the Phase-1 stub increments an exported
  // module-level call counter; we assert the OBSERVABLE effect (called exactly
  // once on first open) AND that the schema was already migrated when it ran
  // (user_version === 7 proves migrate() ran before the hook).
  assert.equal(_migrateFromFsCallCount(), 0, 'counter starts at 0 before first open');
  const db = getDb();
  assert.equal(_migrateFromFsCallCount(), 1, 'hook invoked exactly once on first open');
  // The schema must already exist when the hook runs (it reads/writes rows).
  const { user_version } = db.prepare('PRAGMA user_version').get();
  assert.equal(user_version, SCHEMA_VERSION, 'migrate() ran before the hook');
  // Cached singleton: a repeat getDb() must NOT re-run the one-shot hook.
  getDb();
  assert.equal(_migrateFromFsCallCount(), 1, 'hook not re-run on cached getDb()');
});

// ── M2 — concurrent first-launch CLI+UI race (spec §8) ────────────────────────────
// Two+ processes open the brand-new DB at once; each getDb() runs _configure (the
// journal_mode=WAL header switch) + migrate() (schema + user_version). Both need a
// brief exclusive lock, and the WAL-mode switch returns SQLITE_BUSY the busy-handler
// does NOT retry, so the unfixed code crashed a loser with "database is locked" or
// "table projects already exists". We launch N real child processes sharing this test's
// WORCA_HOME, released together by a wall-clock barrier to maximize overlap, and
// require ALL to open the DB without crashing.
//
// (A single-thread call-migrate()-twice test cannot express this race: migrate() re-
// reads user_version, so a sequential second call sees the committed version and no-ops
// — green even against the bug. Genuine concurrency is required.)
test('getDb() first-launch is concurrency-safe across N processes (no lock/exists crash)', async () => {
  const dbUrl = new URL('../src/core/db.mjs', import.meta.url).href;
  const N = 12;
  // Wall-clock barrier: all children open the DB at ~startAt to maximize overlap. This
  // can only WEAKEN the race (if a child spawns late it opens an already-migrated DB and
  // passes trivially) — it can never cause a false FAILURE. 700ms is ample headroom.
  const startAt = Date.now() + 700;
  const childScript = `
    const delay = Math.max(0, Number(process.env.__M2_START_AT__) - Date.now());
    import(${JSON.stringify(dbUrl)}).then(({ getDb }) => {
      setTimeout(() => {
        try { getDb(); process.exit(0); }
        catch (err) { console.error(String((err && err.message) || err)); process.exit(1); }
      }, delay);
    }).catch((err) => { console.error(String((err && err.message) || err)); process.exit(1); });
  `;
  const kids = Array.from({ length: N }, () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', childScript], {
      env: { ...process.env, __M2_START_AT__: String(startAt) },
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => resolve({ code, err: err.trim().split('\n').filter(Boolean).pop() || '' }));
  }));
  const results = await Promise.all(kids);
  const failed = results.filter((r) => r.code !== 0);
  assert.equal(failed.length, 0,
    `all ${N} concurrent first-launch processes must open without crashing; failures: ` +
    failed.map((f) => f.err).join(' | '));

  // The shared DB is migrated exactly once: v2 stamped, exactly one projects table.
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'migrated to the current version');
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='projects'").get().n,
    1, 'exactly one projects table after the race');
});
