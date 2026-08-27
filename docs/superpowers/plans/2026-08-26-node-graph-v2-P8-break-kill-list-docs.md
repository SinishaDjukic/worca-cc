# Node-Graph v2 — P8: The break + kill list + docs Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the graph engine the ONLY engine. P8a takes the break: DB schema **V24** (physical backup → archive every v1 template row → insert the 7 seed graphs on existing DBs → re-attach overlays → remap the `wf_default_v2` alias → reset archived active workflows → sweep v1-resume-point runs), the `wf_default` default flips to the graph, `POST /api/workflows` stops accepting v1 bodies, resume refuses v1 points, and frozen v1 runs still render (a legacy chip strip). P8b then deletes the v1 engine, its painters, the `phase` shim and the retired suites, adds the `v1-remnants-removed` grep guard and updates the docs/skills.

**Architecture:** V24 is the one migration step in the ladder that rewrites data, so it takes a `VACUUM INTO '<db>.pre-v24.bak'` snapshot BEFORE the transaction opens and does every rewrite inside the ladder's single `BEGIN IMMEDIATE` (partial failure = rollback). Nothing is ever deleted: v1 rows get `archived_at` stamped, keep their `steps`/`feedbacks` JSON, and stay reachable through `GET /api/workflows?archived=1`. Every rewrite is idempotent (`INSERT OR IGNORE` / `UPDATE OR IGNORE` / archive-only-when-live), every decision is audited on `console.warn('[worca] V24: …')` and summarized in `store_meta('migration:v24')`. After the break the v1 code is dead weight; P8b removes it in dependency order (engine → modules → sidecar fields → shim → UI → CLI), each step green.

**Series position:** P8 of 8; requires P7 landed (sentinels: `WORCA_PLUGIN_API = 3` in `src/core/plugin-api.mjs`, `agentFormRender` in `ui/public/app.js`). Leaves dev green and shippable. P8a leaves the v1 engine live; P8b removes it.

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).

**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` §10.2, §11 (UNTRACKED — absent in a pipeline worktree; this plan repeats everything it needs and is self-contained).

## Global Constraints
- NEVER `git add` anything under `docs/superpowers/**`. Never `git push`. Product name in user-facing strings: "worca" (never "worca-cc").
- Commits: `worca: Node-graph v2 P8 — <task title>`. Every P8a task commits BEFORE the first P8b deletion task.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file). Baseline recorded in Task 0.
- **Reversibility is a hard rule:** rows are archived, never deleted; the backup is taken before the transaction; every audit line is quoted verbatim in this plan — do not paraphrase them.
- Message strings, ids and DDL in this plan are CONTRACTS from the spec. Do not rename.
- Anchors are `path:line` on dev @ `e6968e15`. P2–P7 have edited these files; when a line number no longer matches, locate the symbol by name (every anchor below names its symbol) and re-verify before editing.

---

### Task 0: Branch check, deps, baseline, predecessor sentinels
- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch (by hand: `git checkout -b worca-cc/node-graph-v2-p8` off dev). NEVER `git checkout dev`, never create a branch inside a pipeline run.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: predecessor sentinels — STOP if any is absent:
```bash
grep -q "WORCA_PLUGIN_API = 3" src/core/plugin-api.mjs && echo P7-api-ok
grep -q "agentFormRender" ui/public/app.js && echo P7-agents-ok
grep -q "SCHEMA_VERSION = 23" src/core/db.mjs && echo P2b-schema-ok
grep -rq "wf_default_v2" src/core/workflows.mjs && echo P4-alias-ok
ls src/core/graph/orchestrator.mjs src/core/graph/seed-templates.mjs src/core/graph/builtin-workflows.mjs src/core/run-harness.mjs src/core/engine-select.mjs
grep -q "GRAPH_DEFAULT_WORKFLOW" src/core/graph/builtin-workflows.mjs && echo P1-seeds-ok
grep -q "SEED_TEMPLATES" src/core/graph/seed-templates.mjs && grep -q "NODE_ID_MAP" src/core/graph/seed-templates.mjs && grep -q "FB_WIRE_MAP" src/core/graph/seed-templates.mjs && echo P1-maps-ok
```
- [ ] Step 4: `npm test 2>&1 | tail -5` — record the printed pass count as BASELINE; it must be green before you touch anything.
- [ ] Step 5: record the current shape of the three files V24 touches so later diffs are legible: `grep -n "SCHEMA_VERSION\|applySchemaV23\|INCREMENTAL_COLUMNS\|export function migrate" src/core/db.mjs | head -20`.

---

### Task 1: V24 fixtures — `db-residue-v22` + `db-collision` + the first (red) V24 test

**Files:** create `test/helpers/db-residue-v22.mjs`, `test/helpers/db-collision.mjs`, `test/db-migrate-v24.test.mjs`.
**Interfaces:** produces `buildResidueDb() → { v1Ids:string[], projectKey:string, pausedIds:string[], interruptedId:string, dbFile:string }` and `buildCollisionDb() → { projectKey:string, dbFile:string }` — both build the CURRENT schema through the real ladder, write the residue, then stamp `PRAGMA user_version = 23` and close the singleton so the next `getDb()` re-runs V24. Consumes `getDb`, `_resetForTests`, `dbPath` from `src/core/db.mjs`.

- [ ] Step 1: Write the residue fixture. `test/helpers/db-residue-v22.mjs`:
```js
// test/helpers/db-residue-v22.mjs
// The user's live DB shape at the v2 break, built by CODE (never a committed .db):
// 6 v1 template rows, config_workflow_nodes already keyed n_* for all 7 seed ids
// (orphaned overlays left by the discarded branch), config_workflow_wires in the
// OLD PK column order (workflow_id, project_key, wire_id) with wf_no-clarify
// w3/w10 = 6, one wf_default_v2-keyed overlay, 2 paused + 1 interrupted v1 runs
// carrying v1 resume points, and project_config.active_workflow_id pointing at a
// v1 row. Built on the REAL ladder, then stamped back to 23 so the next getDb()
// runs V24 exactly as it will on the user's machine.
import { getDb, _resetForTests, dbPath } from '../../src/core/db.mjs';
import { SEED_TEMPLATES } from '../../src/core/graph/seed-templates.mjs';

const V1_ROWS = [
  ['wf_quick-fix-v1', 'Quick Fix v1'], ['wf_quick-with-decompose-v1', 'Quick + Decompose'],
  ['wf_decompose-implement', 'Decompose Implement'], ['wf_implement-only', 'Implement Only'],
  ['wf_simple-plan', 'Simple Plan'], ['wf_full-v212', 'Full v212'],
];
const STEPS = JSON.stringify([[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }],
  [{ id: 's2_0', key: 'reviewer' }]]);
const FEEDBACKS = JSON.stringify([{ id: 'fb_0', from: 's2_0', to: 's1_0' }]);
const PROJECT_KEY = 'proj-residue-abcd1234';
const RP_V1 = (id) => JSON.stringify({ version: 1, kind: 'boundary', stepIndex: 0, stepCycle: [],
  loopState: {}, bus: null, stepModels: {}, workflowId: id, guardrailsId: null, plan: null,
  nodes: [], gate: null, pauseReason: null, toolInstruction: '', pipelineDir: '/tmp/p', pausedAt: '2026-08-01T00:00:00.000Z' });

export function buildResidueDb() {
  const db = getDb();                       // real ladder → current SCHEMA_VERSION
  const dbFile = dbPath();
  // Full reset: the helper is called once per test in a SHARED temp home, so
  // every table it writes must start empty or the fixed row ids collide.
  db.exec(`DELETE FROM workflows; DELETE FROM config_workflow_nodes;
           DELETE FROM config_workflow_feedbacks; DELETE FROM project_config;
           DELETE FROM pipeline_events; DELETE FROM pipeline_steps; DELETE FROM pipelines;`);
  const insWf = db.prepare(`INSERT INTO workflows (id,name,version,domain,steps,feedbacks,created_at,updated_at)
    VALUES (?,?,1,'coding',?,?,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z')`);
  for (const [id, name] of V1_ROWS) insWf.run(id, name, STEPS, FEEDBACKS);
  // Orphaned n_* overlays for every seed id (the discarded branch's V17 renamed
  // them while the rows themselves were never created), plus one alias-keyed row.
  const insNode = db.prepare(`INSERT INTO config_workflow_nodes
    (project_key,workflow_id,node_id,model,effort,fan_out) VALUES (?,?,?,?,NULL,NULL)`);
  for (const t of SEED_TEMPLATES) insNode.run(PROJECT_KEY, t.id, 'n_impl', 'claude-opus-4-8');
  insNode.run(PROJECT_KEY, 'wf_default_v2', 'n_plan', 'claude-sonnet-4-8');
  // The user's v1-era overlay on a row that IS a seed id, still keyed s0_0.
  insNode.run(PROJECT_KEY, 'wf_quick-fix', 's0_0', 'claude-haiku-4-8');
  db.exec(`INSERT INTO config_workflow_feedbacks (project_key,workflow_id,fb_id,max_cycles)
           VALUES ('${PROJECT_KEY}','wf_no-clarify','fb_0',6), ('${PROJECT_KEY}','wf_no-clarify','fb_1',6)`);
  // config_workflow_wires in the OLD PK column order — inert, because every
  // statement in the codebase names its columns.
  db.exec(`DROP TABLE IF EXISTS config_workflow_wires;
    CREATE TABLE config_workflow_wires (workflow_id TEXT NOT NULL, project_key TEXT NOT NULL,
      wire_id TEXT NOT NULL, max_cycles INTEGER NOT NULL,
      PRIMARY KEY (workflow_id, project_key, wire_id));`);
  db.exec(`INSERT INTO project_config (project_key,steps,custom_models,active_workflow_id,extra)
           VALUES ('${PROJECT_KEY}','{}','[]','wf_simple-plan','{}')`);
  const insRun = db.prepare(`INSERT INTO pipelines (id,project_key,target,status,phase,cycle,
    started_at,updated_at,prompt,resume_point) VALUES (?,?,'project',?,'implement',1,
    '2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z','x',?)`);
  insRun.run('run-p1', PROJECT_KEY, 'paused', RP_V1('wf_simple-plan'));
  insRun.run('run-p2', PROJECT_KEY, 'paused', RP_V1('wf_full-v212'));
  insRun.run('run-i1', PROJECT_KEY, 'interrupted', RP_V1('wf_implement-only'));
  insRun.run('run-v2', PROJECT_KEY, 'paused', JSON.stringify({ version: 2, workflowId: 'wf_default_v2', snapshot: {} }));
  db.prepare("DELETE FROM store_meta WHERE key = 'migration:v24'").run();
  db.exec('PRAGMA user_version = 23');
  _resetForTests();                          // next getDb() re-migrates 23 → 24
  return { v1Ids: V1_ROWS.map(([id]) => id), projectKey: PROJECT_KEY, dbFile,
    pausedIds: ['run-p1', 'run-p2'], interruptedId: 'run-i1', v2RunId: 'run-v2' };
}
```
- [ ] Step 2: Write the collision fixture. `test/helpers/db-collision.mjs`:
```js
// test/helpers/db-collision.mjs
// An ALREADY-ARCHIVED row squatting a seed id (`wf_quick-fix`): V24 must skip
// that seed, audit it, and leave the archived row untouched.
import { getDb, _resetForTests, dbPath } from '../../src/core/db.mjs';

export function buildCollisionDb() {
  const db = getDb();
  const dbFile = dbPath();
  db.exec('DELETE FROM workflows');
  db.exec(`INSERT INTO workflows (id,name,version,domain,steps,feedbacks,created_at,updated_at,archived_at)
    VALUES ('wf_quick-fix','Quick Fix',1,'coding','[]','[]','2026-07-01T00:00:00.000Z',
            '2026-07-01T00:00:00.000Z','2026-07-02T00:00:00.000Z')`);
  db.prepare("DELETE FROM store_meta WHERE key = 'migration:v24'").run();
  db.exec('PRAGMA user_version = 23');
  _resetForTests();
  return { dbFile };
}
```
- [ ] Step 3: Write the first failing test. `test/db-migrate-v24.test.mjs`:
```js
// test/db-migrate-v24.test.mjs
// V24 = the v2 break (spec §10.2). Reversible by construction: rows are archived,
// never deleted, and a physical .pre-v24.bak is taken before the transaction.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildResidueDb } from './helpers/db-residue-v22.mjs';
import { getDb, SCHEMA_VERSION } from '../src/core/db.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';

useTempHome(after);

test('V24 archives every live v1 template row and stamps the version', () => {
  const fx = buildResidueDb();
  const db = getDb();                                   // triggers migrate() 23 → 24
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 24);
  const live = db.prepare('SELECT id FROM workflows WHERE version = 1 AND archived_at IS NULL').all();
  assert.deepEqual(live, [], 'no live v1 row survives the break');
  for (const id of fx.v1Ids) {
    const row = db.prepare('SELECT version, steps, archived_at FROM workflows WHERE id = ?').get(id);
    assert.ok(row, `${id} still exists — archived, never deleted`);
    assert.equal(row.version, 1, 'the row is NOT converted');
    assert.notEqual(row.steps, '[]', 'its v1 topology is kept verbatim');
    assert.ok(row.archived_at, `${id} archived`);
  }
  assert.ok(existsSync(`${fx.dbFile}.pre-v24.bak`), 'a physical backup was taken before the tx');
  const report = JSON.parse(db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get().data);
  assert.deepEqual([...report.archived].sort(), [...fx.v1Ids].sort());
  assert.equal(report.seeded.length, SEED_TEMPLATES.length);
});
```
- [ ] Step 4: `node --test test/db-migrate-v24.test.mjs`
  `Expected: FAIL — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 23 !== 24` (the ladder still stops at V23; nothing archives).
- [ ] Step 5: Commit: `worca: Node-graph v2 P8 — V24 fixtures and the first break test`

---

### Task 2: V24 — backup, ladder step, archive pass, audit, report

**Files:** modify `src/core/db.mjs` (`SCHEMA_VERSION :56`, `migrate() :1031`, new `backupBeforeV24`, `applySchemaV24`, `reconcileV1Workflows`, `sweepV1Runs`, `auditV24`, `V1_RUN_RETIRED`, `mainDbFile`).
**Interfaces:** produces exported `SCHEMA_VERSION = 24`, `reconcileV1Workflows(db, {seed}) → report`, `sweepV1Runs(db = getDb()) → string[]`, `V1_RUN_RETIRED` (message constant). Consumes `SEED_TEMPLATES`, `NODE_ID_MAP`, `FB_WIRE_MAP` from `src/core/graph/seed-templates.mjs`.

- [ ] Step 1: Imports — extend the `node:fs` import at `db.mjs:20` to `import { mkdirSync, existsSync } from 'node:fs';` and add below the `maybeMigrateFromFs` import (`:23`):
```js
import { SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP } from './graph/seed-templates.mjs';
```
(`seed-templates.mjs` is pure data + `deepFreeze` — no cycle, no IO.)
- [ ] Step 2: `SCHEMA_VERSION` (`db.mjs:56`) `22` → `24` if P2b left it at 23 — set it to `export const SCHEMA_VERSION = 24;`.
- [ ] Step 3: Add the V24 machinery ABOVE `export function migrate(db)` (`db.mjs:1031`):
```js
/** Audit channel for V24 (dev convention: one console.warn per decision). */
const auditV24 = (msg) => console.warn(`[worca] V24: ${msg}`);

/** The pipeline_events line + stderr audit a swept v1 run gets. VERBATIM. */
export const V1_RUN_RETIRED = 'paused on the v1 engine before the graph rework — not resumable';

/** Absolute path of the OPEN handle's main database file ('' for :memory:). */
function mainDbFile(db) {
  try {
    const row = db.prepare('PRAGMA database_list').all().find((r) => r.name === 'main');
    return row && typeof row.file === 'string' ? row.file : '';
  } catch { return ''; }
}

/**
 * V24 is the ONLY ladder step that rewrites user data, so an existing DB is
 * snapshotted BEFORE the transaction opens (VACUUM INTO cannot run inside one).
 * Skipped for a fresh file (nothing to lose) and when the backup already exists
 * (VACUUM INTO refuses to overwrite: "output file already exists"). A throw here
 * is FATAL on purpose — no backup, no break.
 */
function backupBeforeV24(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current <= 0 || current >= 24) return;
  const file = mainDbFile(db);
  if (!file) return;
  const bak = `${file}.pre-v24.bak`;
  if (existsSync(bak)) return;
  db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
}

/** v24: the break. Runs INSIDE the ladder transaction. */
function applySchemaV24(db, { existing }) {
  repairSchemaGaps(db, schemaGaps(db));       // heal a divergent stamp first
  const report = reconcileV1Workflows(db, { seed: existing });
  report.sweptRuns = sweepV1Runs(db);
  db.prepare('INSERT OR IGNORE INTO store_meta (key, kind, data) VALUES (?, ?, ?)')
    .run('migration:v24', 'migration', JSON.stringify(report));
}

/**
 * Archive every LIVE v1 template row (D7: kept, hidden, never converted, never
 * deleted), insert the 7 seed graphs on an EXISTING DB, re-attach the static
 * overlay maps, remap the wf_default_v2 alias and reset an archived active
 * workflow. Fully idempotent: a second run changes nothing.
 * @param {DatabaseSync} db
 * @param {{seed?:boolean}} [opts] seed=true only for a DB that existed before V24
 * @returns {{at:string, archived:string[], seeded:string[], seedsSkipped:string[],
 *            overlayNodes:number, overlayWires:number, aliasRemapped:number,
 *            activeReset:string[], sweptRuns:string[]}}
 */
export function reconcileV1Workflows(db, { seed = false } = {}) {
  const report = { at: new Date().toISOString(), archived: [], seeded: [], seedsSkipped: [],
    overlayNodes: 0, overlayWires: 0, aliasRemapped: 0, activeReset: [], sweptRuns: [] };
  const cols = new Set(db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name));
  for (const need of ['version', 'steps', 'feedbacks', 'created_at', 'updated_at', 'graph', 'archived_at']) {
    if (!cols.has(need)) return report;      // minimal hand-seeded test schema: nothing to do
  }
  const now = new Date().toISOString();

  // 1) Archive — the WHERE makes it idempotent and keeps an already-archived row's stamp.
  const live = db.prepare('SELECT id, name FROM workflows WHERE version = 1 AND archived_at IS NULL').all();
  const archive = db.prepare('UPDATE workflows SET archived_at = ? WHERE id = ? AND version = 1 AND archived_at IS NULL');
  for (const row of live) {
    archive.run(now, row.id);
    report.archived.push(row.id);
    auditV24(`archived v1 workflow ${row.id} (${row.name}) — v1 templates are not runnable on the graph engine`);
  }

  // 2) Seeds — EXISTING DBs only (fresh installs keep Default only, decision D7).
  if (seed) {
    const find = db.prepare('SELECT id, archived_at FROM workflows WHERE id = ?');
    const insert = db.prepare(`INSERT OR IGNORE INTO workflows
      (id, name, version, domain, origin, steps, feedbacks, graph, created_at, updated_at, archived_at)
      VALUES (?, ?, 2, ?, NULL, '[]', '[]', ?, ?, ?, NULL)`);
    for (const t of SEED_TEMPLATES) {
      const row = find.get(t.id);
      if (row) {
        if (row.archived_at) {
          report.seedsSkipped.push(t.id);
          auditV24(`seed ${t.id} skipped — id held by an archived template`);
        }
        continue;                            // a LIVE v2 row with that id is the user's own
      }
      insert.run(t.id, t.name, t.domain, JSON.stringify({ nodes: t.nodes, wires: t.wires }), t.createdAt, now);
      report.seeded.push(t.id);
    }
  }
  return report;                             // overlay/alias/active passes land in Task 4
}
```
  Verified 2026-08-26 on node 25: `PRAGMA database_list` returns the RESOLVED path (`/private/var/…` where `dbPath()` says `/var/…` on macOS) — the backup lands next to the real file either way, and `existsSync(dbPath() + '.pre-v24.bak')` still finds it through the symlink. `VACUUM INTO` preserves `user_version` and throws `output file already exists` on a second run, which is why the `existsSync` guard comes first.
- [ ] Step 4: Add `sweepV1Runs` directly below `reconcileV1Workflows` (its call sites land in Task 5):
```js
/**
 * Retire every run that can only be resumed by the v1 engine: paused OR
 * interrupted with a resume point that is not `version: 2`. The row keeps its
 * honest status trail — status becomes 'interrupted', the resume point is
 * NULLed (so History hides Resume and removePluginWorkflows can never be
 * stranded on it) and a pipeline_events line records why. `json_valid` guards a
 * corrupt blob: it is swept too, and json_extract never throws on it.
 * Exported and callable without an argument so boot/reconcile paths can run it
 * on a DB that a divergent ladder stamped past 24.
 * @param {DatabaseSync} [db]
 * @returns {string[]} the ids swept
 */
export function sweepV1Runs(db = getDb()) {
  const rows = db.prepare(`SELECT id FROM pipelines
    WHERE status IN ('paused', 'interrupted') AND resume_point IS NOT NULL
      AND (json_valid(resume_point) = 0 OR json_extract(resume_point, '$.version') != 2)`).all();
  if (!rows.length) return [];
  const clear = db.prepare("UPDATE pipelines SET status = 'interrupted', resume_point = NULL WHERE id = ?");
  const event = db.prepare('INSERT INTO pipeline_events (pipeline_id, ts, text) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  for (const r of rows) {
    clear.run(r.id);
    event.run(r.id, now, V1_RUN_RETIRED);
    auditV24(`run ${r.id}: ${V1_RUN_RETIRED}`);
  }
  return rows.map((r) => r.id);
}
```
- [ ] Step 5: Wire the ladder. In `migrate(db)` (`db.mjs:1031`), insert `backupBeforeV24(db);` between the fast-path `return;` and `db.exec('BEGIN IMMEDIATE');`, and append the V24 step after the `if (current < 23) …` line P2b added, immediately before the `PRAGMA user_version` stamp:
```js
  // V24 rewrites data (archive + seed + sweep): snapshot the file first. Outside
  // the tx by necessity — VACUUM cannot run inside one — and fatal on throw.
  backupBeforeV24(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    …
    if (current < 24) applySchemaV24(db, { existing: current >= 1 });
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
```
- [ ] Step 6: `node --test test/db-migrate-v24.test.mjs`
  `Expected: PASS — # pass 1 / # fail 0` (the run prints `[worca] V24: archived v1 workflow …` warnings — that is the audit channel, not a failure).
- [ ] Step 7: `node --test test/db.test.mjs test/migrate-v15.test.mjs test/migrate-v20.test.mjs 2>&1 | tail -5` — the ladder still lands on `SCHEMA_VERSION` from every stamp. `EXPECTED_TABLES` (`test/db.test.mjs:74-126`) needs NO change: V24 adds no table (P2b already added `config_workflow_wires` there).
- [ ] Step 8: Version-pin sweep — `grep -rn "user_version" test | grep -v SCHEMA_VERSION` must return only comments (`ask-db-schema.test.mjs`, `diff-comments-schema.test.mjs`) plus this plan's own fixtures. No test hardcodes a schema number.
- [ ] Step 9: Commit: `worca: Node-graph v2 P8 — V24 backup, archive pass, seeds and audit report`

---

### Task 3: V24 seeds — fresh DB stays unseeded, an archived id collision is skipped

**Files:** modify `test/db-migrate-v24.test.mjs`.
**Interfaces:** consumes `buildCollisionDb`, `SEED_TEMPLATES`.

- [ ] Step 1: Append to `test/db-migrate-v24.test.mjs`:
```js
test('the 7 seed graphs are inserted on an EXISTING DB, as v2 rows with graph JSON', () => {
  buildResidueDb();
  const db = getDb();
  for (const t of SEED_TEMPLATES) {
    const row = db.prepare('SELECT name, version, domain, origin, steps, feedbacks, graph, created_at, archived_at FROM workflows WHERE id = ?').get(t.id);
    assert.ok(row, `${t.id} inserted`);
    assert.equal(row.version, 2);
    assert.equal(row.name, t.name);
    assert.equal(row.domain, t.domain);
    assert.equal(row.origin, null);
    assert.equal(row.steps, '[]');
    assert.equal(row.feedbacks, '[]');
    assert.equal(row.created_at, t.createdAt, 'the seed keeps its authored createdAt');
    assert.equal(row.archived_at, null);
    const graph = JSON.parse(row.graph);
    assert.deepEqual(Object.keys(graph).sort(), ['nodes', 'wires']);
    assert.equal(graph.nodes.length, t.nodes.length);
    assert.equal(graph.wires.length, t.wires.length);
  }
});
```
- [ ] Step 2: The fresh-install case needs a pristine home, and `useTempHome` is per-FILE, so it gets its own file. Create `test/db-migrate-v24-fresh.test.mjs`:
```js
// test/db-migrate-v24-fresh.test.mjs
// D7: fresh installs keep Default only — the 7 seeds are inserted ONLY on a DB
// that existed before the break. A fresh file has nothing to back up either.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, dbPath, SCHEMA_VERSION } from '../src/core/db.mjs';

useTempHome(after);

test('a FRESH DB lands on V24 unseeded, with no backup file', () => {
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM workflows').get().n, 0, 'no seeds on a fresh install');
  assert.equal(existsSync(`${dbPath()}.pre-v24.bak`), false, 'nothing to back up');
  const meta = db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get();
  assert.deepEqual(JSON.parse(meta.data).seeded, [], 'the report records an unseeded install');
});
```
- [ ] Step 3: The collision case also needs its own home. Create `test/db-migrate-v24-collision.test.mjs`:
```js
// test/db-migrate-v24-collision.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildCollisionDb } from './helpers/db-collision.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

test('a seed id held by an ARCHIVED row is skipped and audited', () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try { buildCollisionDb(); getDb(); } finally { console.warn = realWarn; }
  const db = getDb();
  const row = db.prepare('SELECT version, archived_at FROM workflows WHERE id = ?').get('wf_quick-fix');
  assert.equal(row.version, 1, 'the archived squatter is untouched');
  assert.ok(row.archived_at);
  assert.ok(warnings.includes('[worca] V24: seed wf_quick-fix skipped — id held by an archived template'),
    `expected the skip audit line, got: ${JSON.stringify(warnings)}`);
  const report = JSON.parse(db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get().data);
  assert.deepEqual(report.seedsSkipped, ['wf_quick-fix']);
  assert.equal(report.seeded.includes('wf_quick-fix'), false);
  assert.equal(report.seeded.length, 6, 'the other six seeds still land');
});
```
- [ ] Step 4: `node --test test/db-migrate-v24.test.mjs test/db-migrate-v24-fresh.test.mjs test/db-migrate-v24-collision.test.mjs`
  `Expected: PASS — # pass 5 / # fail 0`
- [ ] Step 5: Mutation audit — temporarily change the seed loop's `if (row.archived_at)` to `if (false)` and re-run: the collision test must FAIL on the missing audit line. Revert.
- [ ] Step 6: Commit: `worca: Node-graph v2 P8 — V24 seed insertion, fresh-install and collision cases`

---

### Task 4: V24 overlays — static node/wire maps, alias remap, archived-active reset

**Files:** modify `src/core/db.mjs` (`reconcileV1Workflows`), `test/db-migrate-v24.test.mjs`.
**Interfaces:** consumes `NODE_ID_MAP` (7 seed ids + `wf_default`: `s_clarify/s0_0/s1_0/s2_0/s3_0 → n_clarify/n_plan/n_refine/n_impl/n_review`) and `FB_WIRE_MAP` (e.g. `wf_no-clarify: {fb_0:'w3', fb_1:'w10'}`, `wf_default: {fb_refine:'w5', fb_review:'w9'}`) from `src/core/graph/seed-templates.mjs`.

- [ ] Step 1: Write the failing test — append to `test/db-migrate-v24.test.mjs`:
```js
test('overlays re-attach: node ids remap, feedback budgets copy to wires, the alias folds into wf_default', () => {
  const fx = buildResidueDb();
  const db = getDb();
  const nodeRows = db.prepare('SELECT workflow_id, node_id, model FROM config_workflow_nodes ORDER BY workflow_id, node_id').all();
  // the seven orphaned n_impl overlays now address REAL rows
  for (const t of SEED_TEMPLATES) {
    assert.ok(nodeRows.some((r) => r.workflow_id === t.id && r.node_id === 'n_impl'),
      `${t.id} keeps its n_impl overlay`);
    assert.ok(db.prepare('SELECT 1 FROM workflows WHERE id = ?').get(t.id), `${t.id} row exists`);
  }
  // the v1-era s0_0 overlay on the wf_quick-fix id is rewritten by NODE_ID_MAP
  assert.ok(nodeRows.some((r) => r.workflow_id === 'wf_quick-fix' && r.node_id === 'n_plan' && r.model === 'claude-haiku-4-8'),
    's0_0 → n_plan (NODE_ID_MAP)');
  assert.equal(nodeRows.some((r) => r.node_id === 's0_0'), false, 'no v1 step id survives');
  // FB_WIRE_MAP copies wf_no-clarify fb_0/fb_1 = 6 onto w3/w10
  // node:sqlite returns NULL-PROTOTYPE rows — deepEqual (strict) compares
  // prototypes, so map every row through an object literal before asserting.
  const wires = db.prepare('SELECT wire_id, max_cycles FROM config_workflow_wires WHERE workflow_id = ? ORDER BY wire_id')
    .all('wf_no-clarify').map((r) => ({ wire_id: r.wire_id, max_cycles: r.max_cycles }));
  assert.deepEqual(wires, [{ wire_id: 'w10', max_cycles: 6 }, { wire_id: 'w3', max_cycles: 6 }]);
  const fbs = db.prepare('SELECT count(*) AS n FROM config_workflow_feedbacks').get().n;
  assert.equal(fbs, 2, 'the source rows are COPIED, never deleted');
  // the wf_default_v2 alias folds into wf_default everywhere
  assert.equal(db.prepare("SELECT count(*) AS n FROM config_workflow_nodes WHERE workflow_id = 'wf_default_v2'").get().n, 0);
  assert.ok(nodeRows.some((r) => r.workflow_id === 'wf_default' && r.node_id === 'n_plan'), 'alias overlay landed on wf_default');
  const rp = JSON.parse(db.prepare('SELECT resume_point FROM pipelines WHERE id = ?').get(fx.v2RunId).resume_point);
  assert.equal(rp.workflowId, 'wf_default', 'a v2 resume point on the alias is remapped');
  // an active workflow that was archived falls back to the graph default
  assert.equal(db.prepare('SELECT active_workflow_id FROM project_config WHERE project_key = ?').get(fx.projectKey).active_workflow_id, 'wf_default');
});
```
  `Expected: FAIL — AssertionError: s0_0 → n_plan (NODE_ID_MAP)` (no overlay pass exists yet).
- [ ] Step 2: Implement — replace `return report;` at the end of `reconcileV1Workflows` with:
```js
  // 3) Static overlay maps (idempotent; UPDATE OR IGNORE drops a rename that
  //    would collide with an overlay the user already has on the new id).
  const remapNode = db.prepare(
    'UPDATE OR IGNORE config_workflow_nodes SET node_id = ? WHERE workflow_id = ? AND node_id = ?');
  for (const [wfId, map] of Object.entries(NODE_ID_MAP)) {
    for (const [oldId, newId] of Object.entries(map)) {
      report.overlayNodes += remapNode.run(newId, wfId, oldId).changes;
    }
  }
  // config_workflow_feedbacks rows are COPIED (never moved) onto their wire ids:
  // the table stays vestigial but readable, so the migration is reversible.
  const copyWire = db.prepare(`INSERT OR IGNORE INTO config_workflow_wires
      (project_key, workflow_id, wire_id, max_cycles)
    SELECT project_key, workflow_id, ?, max_cycles
      FROM config_workflow_feedbacks WHERE workflow_id = ? AND fb_id = ?`);
  for (const [wfId, map] of Object.entries(FB_WIRE_MAP)) {
    for (const [fbId, wireId] of Object.entries(map)) {
      report.overlayWires += copyWire.run(wireId, wfId, fbId).changes;
    }
  }

  // 4) The coexistence alias dies here: everything keyed wf_default_v2 becomes wf_default.
  const ALIAS = 'wf_default_v2';
  const DEFAULT_ID = 'wf_default';
  for (const sql of [
    'UPDATE OR IGNORE config_workflow_nodes SET workflow_id = ? WHERE workflow_id = ?',
    'UPDATE OR IGNORE config_workflow_wires SET workflow_id = ? WHERE workflow_id = ?',
    'UPDATE OR IGNORE project_config SET active_workflow_id = ? WHERE active_workflow_id = ?',
  ]) report.aliasRemapped += db.prepare(sql).run(DEFAULT_ID, ALIAS).changes;
  report.aliasRemapped += db.prepare(`UPDATE pipelines
      SET resume_point = json_set(resume_point, '$.workflowId', ?)
    WHERE resume_point IS NOT NULL AND json_valid(resume_point)
      AND json_extract(resume_point, '$.version') = 2
      AND json_extract(resume_point, '$.workflowId') = ?`).run(DEFAULT_ID, ALIAS).changes;
  if (report.aliasRemapped) {
    auditV24(`remapped ${report.aliasRemapped} row(s) from the wf_default_v2 alias to wf_default`);
  }

  // 5) An active workflow that just got archived is not runnable — fall back.
  const stranded = db.prepare(`SELECT project_key, active_workflow_id FROM project_config
    WHERE active_workflow_id IN (SELECT id FROM workflows WHERE archived_at IS NOT NULL)`).all();
  if (stranded.length) {
    const reset = db.prepare(`UPDATE project_config SET active_workflow_id = ? WHERE project_key = ?`);
    for (const r of stranded) {
      reset.run(DEFAULT_ID, r.project_key);
      report.activeReset.push(r.project_key);
      auditV24(`project ${r.project_key}: active pipeline ${r.active_workflow_id} was archived — reset to wf_default`);
    }
  }
  return report;
```
- [ ] Step 3: `node --test test/db-migrate-v24.test.mjs`
  `Expected: PASS — # pass 3 / # fail 0`
- [ ] Step 4: Mutation audit — delete the `FB_WIRE_MAP` loop and re-run: the wires assertion must fail with `Expected values to be deeply equal: [] !== [ { wire_id: 'w10', … } ]`. Revert.
- [ ] Step 5: Commit: `worca: Node-graph v2 P8 — V24 overlay remap, alias fold and active-workflow reset`

---

### Task 5: Sweep v1 runs at boot and refuse a v1 resume

**Files:** modify `ui/server.mjs` (`bootMaintenance :4830`, `resumeRun :1497-1510`), `src/cli/worca-cc.mjs` (`cmdDoctor :583`, `cmdResume :737`, the resume checks `:745-752`), `test/db-migrate-v24.test.mjs`, `test/server-boot-sweeps.test.mjs`.
**Interfaces:** consumes `sweepV1Runs`, `V1_RUN_RETIRED` from `src/core/db.mjs`; produces the refusal `ResumeError(409, { code: 'ENGINE_RETIRED', error: V1_RUN_RETIRED })`.

- [ ] Step 1: Write the failing tests — append to `test/db-migrate-v24.test.mjs`:
```js
test('v1 resume points are swept: status interrupted, resume_point NULL, event logged', () => {
  const fx = buildResidueDb();
  const db = getDb();
  for (const id of [...fx.pausedIds, fx.interruptedId]) {
    const row = db.prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(id);
    assert.equal(row.status, 'interrupted', `${id} is no longer resumable`);
    assert.equal(row.resume_point, null);
    const ev = db.prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id DESC LIMIT 1').get(id);
    assert.equal(ev.text, 'paused on the v1 engine before the graph rework — not resumable');
  }
  const v2 = db.prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(fx.v2RunId);
  assert.equal(v2.status, 'paused', 'a v2 resume point is untouched');
  assert.ok(v2.resume_point);
  const report = JSON.parse(db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get().data);
  assert.deepEqual([...report.sweptRuns].sort(), [...fx.pausedIds, fx.interruptedId].sort());
});

test('sweepV1Runs also runs on a DIVERGENTLY-stamped DB (boot path)', () => {
  buildResidueDb();
  const db = getDb();                                   // V24 already swept
  db.prepare("UPDATE pipelines SET status = 'paused', resume_point = ? WHERE id = 'run-p1'")
    .run(JSON.stringify({ version: 1, kind: 'boundary' }));
  assert.deepEqual(sweepV1Runs(db), ['run-p1']);
  assert.equal(db.prepare("SELECT status FROM pipelines WHERE id = 'run-p1'").get().status, 'interrupted');
  assert.deepEqual(sweepV1Runs(db), [], 'idempotent: a second sweep finds nothing');
});
```
  (add `sweepV1Runs` to the `src/core/db.mjs` import in that file.)
  `Expected: FAIL — AssertionError: 'paused' !== 'interrupted'` for the first case if Task 2's sweep is not wired into `applySchemaV24`; otherwise the second case fails on `sweepV1Runs is not a function` until it is exported.
- [ ] Step 2: Boot sweep. In `ui/server.mjs` `bootMaintenance()` (`:4830`), directly after the `reconcileStaleRunning` try/catch block, add:
```js
  // A DB stamped past 24 by a divergent ladder can still hold v1 resume points
  // (crash-reconciled runs keep theirs). One idempotent sweep per boot.
  try {
    const swept = sweepV1Runs();
    summary.sweptV1 = swept.length;
    if (swept.length) console.log(`[worca-ui] retired ${swept.length} run(s) paused on the v1 engine`);
  } catch (err) {
    console.error(`[worca-ui] v1-run sweep failed: ${err && err.message ? err.message : err}`);
  }
```
  and add `sweptV1: 0` to the `summary` object literal on the first line of `bootMaintenance`, plus `sweepV1Runs` to the `src/core/db.mjs` import at the top of `ui/server.mjs`.
- [ ] Step 3: CLI reconcile sites. In `src/cli/worca-cc.mjs`, `cmdDoctor` (`:583`) and `cmdResume` (`:737`) both call `reconcileStaleRunning({ liveIds: [] })`; after each, add:
```js
    const { sweepV1Runs } = await import('../core/db.mjs');
    const swept = sweepV1Runs();
    if (swept.length) out(`retired ${swept.length} run(s) paused on the v1 engine`);
```
  (in `cmdResume` use `process.stdout.write(...)` — that function has no `out` in scope only if P6b removed it; check with `grep -n "^function out" src/cli/worca-cc.mjs`, it is module-level, so `out(...)` is fine in both.)
- [ ] Step 4: Resume refusals. In `ui/server.mjs` `resumeRun` (`:1497-1510`), after the `if (!saved.resumePoint) …` line and before the archived check, insert:
```js
  if (saved.resumePoint.version !== 2) {
    throw new ResumeError(409, { code: 'ENGINE_RETIRED', error: V1_RUN_RETIRED });
  }
```
  and import `V1_RUN_RETIRED` from `src/core/db.mjs`. In `src/cli/worca-cc.mjs` `cmdResume`, after the `if (!saved.resumePoint) { … }` block (`:750-753`):
```js
  if (saved.resumePoint.version !== 2) {
    const { V1_RUN_RETIRED } = await import('../core/db.mjs');
    process.stderr.write(`worca resume: ${V1_RUN_RETIRED}\n`);
    return 2;
  }
```
- [ ] Step 5: Add the API-level test to `test/server-boot-sweeps.test.mjs` (it already imports `bootMaintenance`):
```js
test('bootMaintenance retires runs left paused on the v1 engine', async () => {
  const { id } = await seedPipeline('/tmp/proj-v1-sweep', { status: 'paused' });
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?')
    .run(JSON.stringify({ version: 1, kind: 'boundary' }), id);
  const summary = await bootMaintenance({ log: () => {} });
  assert.equal(summary.sweptV1, 1);
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.status, 'interrupted');
  assert.equal(row.resume_point, null);
});
```
- [ ] Step 6: `node --test test/db-migrate-v24.test.mjs test/server-boot-sweeps.test.mjs test/server-pause-resume.test.mjs`
  `Expected: PASS` (if `server-pause-resume` seeds a v1 resume point anywhere, update that fixture to `version: 2` — the graph engine is the only resumable engine now).
- [ ] Step 7: Commit: `worca: Node-graph v2 P8 — sweep v1 runs at boot and refuse v1 resumes`

---

### Task 6: Idempotency, the post-fs-import archive, and the moved migration tests

**Files:** modify `src/core/db.mjs` (`getDb :69`, new `reconcileAfterFsImport`), `test/db-migrate-v24.test.mjs`, `test/migrate-fs-to-db.test.mjs:198-215`, `test/upgrade-integration.test.mjs:188-197`.
**Interfaces:** produces `reconcileAfterFsImport(db)` (module-private).

- [ ] Step 1: Write the failing idempotency test — append to `test/db-migrate-v24.test.mjs`:
```js
// The snapshot V24 must reproduce byte-for-byte on a second run.
function snapshot(db) {
  return JSON.stringify({
    workflows: db.prepare('SELECT id, name, version, domain, origin, steps, feedbacks, graph, created_at, updated_at, archived_at FROM workflows ORDER BY id').all(),
    nodes: db.prepare('SELECT * FROM config_workflow_nodes ORDER BY project_key, workflow_id, node_id').all(),
    wires: db.prepare('SELECT project_key, workflow_id, wire_id, max_cycles FROM config_workflow_wires ORDER BY project_key, workflow_id, wire_id').all(),
    feedbacks: db.prepare('SELECT * FROM config_workflow_feedbacks ORDER BY project_key, workflow_id, fb_id').all(),
    config: db.prepare('SELECT project_key, active_workflow_id FROM project_config ORDER BY project_key').all(),
    runs: db.prepare('SELECT id, status, resume_point FROM pipelines ORDER BY id').all(),
    meta: db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").all(),
  });
}

test('V24 is idempotent: re-running it leaves a byte-identical snapshot', () => {
  buildResidueDb();
  const first = snapshot(getDb());
  const db = getDb();
  db.exec('PRAGMA user_version = 23');          // force the ladder to replay V24
  _resetForTests();
  const second = snapshot(getDb());
  assert.equal(second, first, 'the second V24 pass changed nothing');
});
```
  (add `_resetForTests` to the db import.)
  `Expected: FAIL — AssertionError: the second V24 pass changed nothing` ONLY if a pass is non-idempotent; a correct Task 2–4 implementation makes this PASS immediately. Prove the test bites: temporarily drop `AND archived_at IS NULL` from the archive SELECT+UPDATE — the snapshot then differs on `archived_at`, and the test fails. Revert.
- [ ] Step 2: Close the fs-import hole. `maybeMigrateFromFs` runs AFTER `migrate()` (`db.mjs:70`), so legacy `~/.worca-cc/workflows/*.json` land as LIVE v1 rows once the break has already happened. Add below `reconcileSchema` in `db.mjs`:
```js
/**
 * The fs→db import runs after migrate(), so v1 templates it brings in miss the
 * V24 archive pass. Cheap probe first (the table is tiny and usually empty of
 * live v1 rows), then one idempotent reconcile in its own transaction. No
 * seeding on this path — the seeds, if any, landed during the ladder.
 */
function reconcileAfterFsImport(db) {
  const hit = db.prepare('SELECT 1 AS n FROM workflows WHERE version = 1 AND archived_at IS NULL LIMIT 1').get();
  if (!hit) return;
  db.exec('BEGIN IMMEDIATE');
  try { reconcileV1Workflows(db, { seed: false }); db.exec('COMMIT'); }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}
```
  and call it in `getDb()` right after `maybeMigrateFromFs(db);` (`db.mjs:70`):
```js
  maybeMigrateFromFs(db);      // one-shot fs→db import (other phase; self-guarded)
  reconcileAfterFsImport(db);  // V24: archive v1 templates that import just created
```
- [ ] Step 3: Fix the two migration suites the break moves.
  `test/migrate-fs-to-db.test.mjs:198-215` — the imported `wf_quick-fix` row is archived and its overlays are remapped by `NODE_ID_MAP` (`s0_0 → n_plan`, `s1_0 → n_impl`), which also flips the `ORDER BY node_id` order. Replace that block with:
```js
  // workflows: the fs import runs AFTER migrate(), so the V24 reconcile fires at
  // the end of the import — the v1 row lands archived (kept, never deleted) and
  // its overlays are remapped onto the seed graph's node ids.
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get('wf_quick-fix');
  assert.equal(wf.name, 'Quick Fix');
  assert.deepEqual(JSON.parse(wf.steps)[0], [{ id: 's0_0', key: 'planner' }]);
  assert.ok(wf.archived_at, 'v1 template archived by the v2 upgrade');

  // project_config + normalized rows + extra
  const cfg = db.prepare('SELECT * FROM project_config WHERE project_key = ?').get(fx.keyA);
  assert.equal(cfg.active_workflow_id, 'wf_default', 'an archived active workflow falls back to the graph default');
  assert.deepEqual(JSON.parse(cfg.steps).planner, { model: 'claude-opus-4-8', effort: 'max' });
  assert.deepEqual(JSON.parse(cfg.custom_models), [{ id: 'my-model', label: 'My Model' }]);
  assert.deepEqual(JSON.parse(cfg.extra), { webUiTesting: { enabled: true } });
  const nodeRows = db.prepare(
    'SELECT * FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? ORDER BY node_id'
  ).all(fx.keyA, 'wf_quick-fix');
  assert.equal(nodeRows.length, 2);
  assert.equal(nodeRows[0].node_id, 'n_impl');            // s1_0 → n_impl
  assert.equal(nodeRows[0].fan_out, 0, 's1_0 fanOut:false → 0');
  assert.equal(nodeRows[1].node_id, 'n_plan');            // s0_0 → n_plan
  assert.equal(nodeRows[1].fan_out, null, 's0_0 had no fanOut → NULL');
```
  `test/upgrade-integration.test.mjs:188-197` — `listWorkflows()` filters archived rows, so ask for them explicitly:
```js
test('listWorkflows() returns the migrated user workflow template, archived by the v2 upgrade', async () => {
  assert.equal((await listWorkflows()).some((w) => w.id === 'wf_quickfix'), false, 'archived rows are not listed');
  const list = await listWorkflows({ includeArchived: true });
  const wf = list.find((w) => w.id === 'wf_quickfix');
  assert.ok(wf, 'wf_quickfix imported');
  assert.equal(wf.name, 'Quick Fix');
  assert.equal(wf.steps.length, 2, 'two-stage topology preserved');
  assert.equal(wf.feedbacks.length, 1, 'feedback edge preserved');
  assert.ok(wf.archivedAt, 'kept, hidden, never deleted');
});
```
- [ ] Step 4: `node --test test/migrate-fs-to-db.test.mjs test/upgrade-integration.test.mjs test/db-migrate-v24.test.mjs`
  `Expected: PASS`
- [ ] Step 5: Commit: `worca: Node-graph v2 P8 — V24 idempotency, fs-import archive, moved migration tests`

---

### Task 7: `wf_default` becomes the graph — constant flip, alias removal, dispatch default

**Files:** modify `src/core/workflows.mjs` (`DEFAULT_WORKFLOW :91`, `readWorkflow :277`, `listWorkflows :286`, `resolveWorkflow :371`), `src/core/graph/builtin-workflows.mjs`, `ui/server.mjs` (`:95` import, `/api/run` default `:1060`, `GET /api/workflows :3116`), `src/core/ask/catalog.mjs:9,46`, `src/cli/worca-cc.mjs:213`, tests `workflows.test.mjs`, `workflows-db.test.mjs`, `workflow-node-defaults.test.mjs`, `ask-catalog.test.mjs`, `dispatcher.test.mjs`, `workflow-validator.test.mjs`.
**Interfaces:** produces `GRAPH_DEFAULT_WORKFLOW` (re-exported from `src/core/workflows.mjs`) and `LEGACY_DEFAULT_WORKFLOW` (the v1 literal, consumed ONLY by the two v1 suites P8b retires). The name `DEFAULT_WORKFLOW` disappears.

- [ ] Step 1: `GRAPH_DEFAULT_WORKFLOW` must carry the timestamps `GET /api/workflows` consumers render. In `src/core/graph/builtin-workflows.mjs`, add to the frozen object (after `domain: 'coding',`):
```js
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
```
  (skip if P1's copy already has them — `grep -n createdAt src/core/graph/builtin-workflows.mjs`.)
- [ ] Step 2: Write the failing test — append to `test/workflows.test.mjs` and DELETE the two v1 default tests it replaces (`'DEFAULT_WORKFLOW is the Plan->Refine->Implement->Review topology'` at `:44` and `'DEFAULT_WORKFLOW feedbacks reproduce …'` at `:87`):
```js
test('wf_default IS the graph default; the v1 alias is gone', async () => {
  await freshHome();
  const tpl = await readWorkflow('wf_default');
  assert.equal(tpl.version, 2);
  assert.equal(tpl.id, 'wf_default');
  assert.equal(tpl.name, 'Default');
  assert.equal(tpl.nodes.length, 7);
  assert.equal(tpl.wires.length, 10);
  assert.equal(tpl.steps, undefined, 'no v1 topology on the default any more');
  assert.equal(await readWorkflow('wf_default_v2'), null, 'the coexistence alias is retired');
  assert.equal(GRAPH_DEFAULT_WORKFLOW.id, 'wf_default');
});
```
  (import `GRAPH_DEFAULT_WORKFLOW` instead of `DEFAULT_WORKFLOW` at the top of the file.)
  `Expected: FAIL — AssertionError: Expected values to be strictly equal: 1 !== 2`
- [ ] Step 3: Implement in `src/core/workflows.mjs`:
  - Add at the imports: `import { GRAPH_DEFAULT_WORKFLOW } from './graph/builtin-workflows.mjs';` and `export { GRAPH_DEFAULT_WORKFLOW };`
  - Rename the v1 constant `export const DEFAULT_WORKFLOW = Object.freeze({…})` (`:91`) to `export const LEGACY_DEFAULT_WORKFLOW = Object.freeze({…})`, keeping the body byte-identical, and prepend the comment:
```js
/** The RETIRED v1 default topology. Nothing in production reads it after the v2
 *  break; it survives only as the input fixture of the two v1 engine suites that
 *  P8b retires with the engine. Never served by readWorkflow. */
```
  - `readWorkflow` (`:277`) becomes (keeping P2b's `includeArchived` option):
```js
export async function readWorkflow(id, { includeArchived = false } = {}) {
  if (id === GRAPH_DEFAULT_WORKFLOW.id) return GRAPH_DEFAULT_WORKFLOW;
  return readRaw(id, { includeArchived });
}
```
  - `listWorkflows` (`:286`): the `r.id !== DEFAULT_WORKFLOW.id` filter becomes `r.id !== GRAPH_DEFAULT_WORKFLOW.id`.
  - `resolveWorkflow` (`:371`): its legacy-per-role line `workflowId === DEFAULT_WORKFLOW.id` becomes `workflowId === LEGACY_DEFAULT_WORKFLOW.id`. (The function already throws `template is a graph — runs on the graph engine` for v2 rows, so this branch is now unreachable in production; it stays until P8b deletes the function.)
  - `grep -rn "wf_default_v2" src ui` — remove EVERY remaining occurrence (P4's alias arm in `readWorkflow`, the "Default (graph)" row in `GET /api/workflows`, any `readRaw` guard, `writeGraphWorkflow`'s reserved-id list keeps `wf_default_v2` in the ban list: an id nobody can mint stays banned).
- [ ] Step 4: Consumers:
  - `ui/server.mjs:95` import: `DEFAULT_WORKFLOW` → `GRAPH_DEFAULT_WORKFLOW`.
  - `GET /api/workflows` (`:3116-3120`): `res.json({ workflows: [GRAPH_DEFAULT_WORKFLOW, ...(await listWorkflows())] });` — and delete the alias row P4 appended.
  - `src/core/ask/catalog.mjs:9,46`: import + default parameter → `GRAPH_DEFAULT_WORKFLOW` (the `defaultWorkflow` DI name stays; `shapeWorkflow` already derives `steps`/`feedbacks` from a v2 template).
  - `POST /api/run` (`ui/server.mjs:1060`): the `'wf_default'` literal default is unchanged — it now resolves to the graph. Confirm `assertRunnableWorkflow` (P2b) is what the route calls.
  - `src/cli/worca-cc.mjs:213` HELP: `--workflow <id>          Saved pipeline id to run (default: wf_default — the built-in graph)`.
- [ ] Step 5: Re-point the other importers of the old name:
  - `test/workflows-db.test.mjs`, `test/workflow-node-defaults.test.mjs`, `test/ask-catalog.test.mjs` → `GRAPH_DEFAULT_WORKFLOW` (assertions that read `.steps`/`.feedbacks` of the default move to `.nodes`/`.wires`; `workflow-node-defaults` keeps `sanitizeNodeDefaults` coverage unchanged).
  - `test/dispatcher.test.mjs`, `test/workflow-validator.test.mjs` → `LEGACY_DEFAULT_WORKFLOW` (both files die in P8b).
  - `grep -rn "DEFAULT_WORKFLOW" src ui test | grep -v "GRAPH_DEFAULT_WORKFLOW\|LEGACY_DEFAULT_WORKFLOW"` must come back empty.
- [ ] Step 6: `npm test 2>&1 | tail -5`
  `Expected: green at BASELINE + the V24 tests` (any failure here is a consumer still expecting a v1 default — fix it, do not weaken the assertion).
- [ ] Step 7: Commit: `worca: Node-graph v2 P8 — wf_default becomes the graph default, alias retired`

---

### Task 8: `POST /api/workflows` refuses v1 bodies; the legacy per-role layer is verified

**Files:** modify `ui/server.mjs` (`POST /api/workflows :3136`), `test/api-workflows.test.mjs`; verify `resolveGraph` in `src/core/workflows.mjs`.
**Interfaces:** produces the 400 body `{ error: 'v1 pipeline templates are no longer accepted — save a graph (version 2)' }` (planner default wording, spec is silent on the exact string).

- [ ] Step 1: Write the failing test — append to `test/api-workflows.test.mjs` (reuse that file's app/agent helpers):
```js
test('POST /api/workflows rejects a v1 body with 400 and never writes a row', async () => {
  const res = await post('/api/workflows', { name: 'Legacy', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'v1 pipeline templates are no longer accepted — save a graph (version 2)');
  const list = await get('/api/workflows');
  assert.equal(list.body.workflows.some((w) => w.name === 'Legacy'), false);
});
```
  `Expected: FAIL — AssertionError: Expected values to be strictly equal: 201 !== 400`
- [ ] Step 2: Implement — in `POST /api/workflows` (`ui/server.mjs:3136`), P4 left a `body.version === 2` branch and a v1 arm. Delete the v1 arm entirely (the `nodeDefaultsError` loop over `tpl.steps`, `validateWorkflow`, `writeWorkflow`) and make the route:
```js
app.post('/api/workflows', async (req, res) => {
  const body = req.body || {};
  // The v1 pipeline format is retired: only graphs are accepted (spec §10.2).
  if (body.version !== 2) {
    return badRequest(res, 'v1 pipeline templates are no longer accepted — save a graph (version 2)');
  }
  … the P4 v2 branch, unchanged (validateGraph → 422 with issues → writeGraphWorkflow) …
});
```
  Delete the now-unused `validateWorkflow` import at `ui/server.mjs:98` ONLY if nothing else in the file calls it (`grep -n validateWorkflow ui/server.mjs`) — P8b deletes the module.
- [ ] Step 3: Verify the legacy per-role layer survived into `resolveGraph` (P2b's job; the wf_default-only `project_config.steps[key]` layer between `config_workflow_nodes` and `node.config`):
```bash
grep -n "stepsCfg\|readConfig" src/core/workflows.mjs | sed -n '1,20p'
```
  It must show `resolveGraph` reading `(await readConfig(projectDir)).steps` under a `workflowId === GRAPH_DEFAULT_WORKFLOW.id` guard and applying `legacy.model/effort/fanOut/askQuestions` per agent node keyed by `node.key`. If it is ABSENT, add it now inside `resolveGraph`'s per-node resolution, mirroring `resolveWorkflow:379-431`:
```js
  const stepsCfg = workflowId === GRAPH_DEFAULT_WORKFLOW.id ? (await readConfig(projectDir)).steps : {};
  …
  const legacy = stepsCfg[node.key] || {};
  model:  firstDefined(sel.model,  legacy.model,  cfg.model),
  effort: firstDefined(sel.effort, legacy.effort, (sel.model || legacy.model) ? undefined : cfg.effort),
  fanOut: !!firstDefined(sel.fanOut, legacy.fanOut, cfg.fanOut, meta.fanOut, false),
```
  and pin it with a test in `test/workflows-db.test.mjs`:
```js
test('legacy per-role config still reaches the graph default (wf_default only)', async () => {
  const dir = await freshProject();
  await setStep(dir, 'planner', { model: 'claude-opus-4-8', effort: 'high' });
  const plan = await resolveGraph(dir, 'wf_default', REG);
  const planner = plan.manifest.graph.nodes.find((n) => n.key === 'planner');
  assert.equal(planner.model, 'claude-opus-4-8');
  assert.equal(planner.effort, 'high');
});
```
- [ ] Step 4: `git rm test/api-workflows-warnings.test.mjs` — its whole subject is the soft `validateWorkflow` warning body of a v1 POST, which now 400s before any validation runs. (Do it HERE, not in P8b: the suite goes red the moment the rejection lands, and every P8a task must leave the suite green.)
- [ ] Step 5: `node --test test/api-workflows.test.mjs test/workflows-db.test.mjs`
  `Expected: PASS`
- [ ] Step 6: Commit: `worca: Node-graph v2 P8 — POST /api/workflows rejects v1 bodies`

---

### Task 9: Frozen v1 runs — legacy chip strip + Resume hidden without a resume point

**Files:** modify `ui/public/app.js` (`paintGraphFor`/`paintRunGraph` branch from P6a, `setupHdActions :11415`), `ui/public/style.css`, `src/core/artifacts.mjs` (`rowToState :1662`), `test/ui-history-detail.test.mjs`.
**Interfaces:** produces `paintLegacyStrip(host, manifest, decor)` in `app.js` and `state.resumable: boolean` from `rowToState`.

- [ ] Step 1: Write the failing tests — append to `test/ui-history-detail.test.mjs`:
```js
test('a frozen v1 run renders a legacy chip strip, never the v2 graph', async () => {
  const V1_STEPPER = { version: 1, steps: [
    { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
    { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Planner', color: 'violet', sub: '', cycles: false, model: '', effort: '' }] },
    { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
  ], feedbacks: [] };
  const ctx = await bootDetail({
    detail: { ...DETAIL, state: { ...DETAIL.state, stepper: V1_STEPPER,
      steps: [{ key: 'plan', phase: 'plan', cycle: 1, status: 'done', activeMs: 120000, costUsd: 0.4 }] } },
  });
  await openDetail(ctx);
  const strip = ctx.window.document.querySelector('#hist-detail .run-strip');
  assert.ok(strip, 'the v1 strip painted');
  assert.equal(ctx.window.document.querySelector('#hist-detail .gv-world'), null, 'no v2 graph for a v1 manifest');
  const chip = strip.querySelector('.rchip');
  assert.ok(chip.classList.contains('is-done'), 'status tint from the step row');
  assert.equal(chip.textContent, 'Planner · 2m · $0.40');
});

test('Resume is hidden for a paused run whose resume point was retired', async () => {
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'paused' }],
    detail: { ...DETAIL, state: { ...DETAIL.state, status: 'interrupted', resumable: false } },
  });
  await openDetail(ctx);
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, true);
});
```
  `Expected: FAIL — AssertionError: the v1 strip painted` (`strip` is null).
- [ ] Step 2: Implement the strip. In `ui/public/app.js`, at P6a's single branch point (`grep -n "version === 2" ui/public/app.js` — the `paintGraphFor(host, stepper, decor)` helper), the non-v2 arm calls `paintLegacyStrip` instead of the v1 painters. Add the function next to it (adapted from `old:ui/public/app.js:765-800` + `old:ui/public/graph/run-decor.mjs:361-383`; the changes vs the borrowed code: the chip rows are computed inline from the v1 manifest cells instead of importing `legacyChipRows`/`manifestNodes`, and the duration/cost formatters are the ones already in `app.js`):
```js
// ── The legacy (v1) renderer ────────────────────────────────────────────────
// Frozen v1 runs only. This is the ONE place in the client allowed to read the
// v1 phase vocabulary: `pipeline_steps.node_id` is nullable, so the oldest rows
// identify a step by `phase` alone — and the node ids of a v1 manifest ARE its
// phases (or its nodes carry `uiPhase`). No v2 run can reach it: paintGraphFor
// forks on `stepper.version === 2`, and a v2 manifest carries no uiPhase.
function legacyChipRows(manifest, steps) {
  const nodes = [];
  for (const cell of Array.isArray(manifest?.steps) ? manifest.steps : []) {
    for (const n of Array.isArray(cell?.nodes) ? cell.nodes : []) nodes.push(n);
  }
  const byPhase = new Map();
  for (const n of nodes) {
    for (const p of [n.uiPhase, n.id]) if (p != null && !byPhase.has(p)) byPhase.set(p, n.id);
  }
  const acc = new Map();
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s) continue;
    const nodeId = s.nodeId != null ? s.nodeId : byPhase.get(s.phase);
    if (nodeId == null) continue;
    const cur = acc.get(nodeId) || { ms: 0, cost: 0, status: 'pending' };
    cur.ms += Number(s.activeMs) || 0;
    cur.cost += Number(s.costUsd) || 0;
    cur.status = s.status === 'start' ? 'active' : (s.status || 'pending');
    acc.set(nodeId, cur);
  }
  return nodes.map((n) => {
    const hit = acc.get(n.id);
    const label = n.label || n.id;
    const parts = hit ? [label, fmtDur(hit.ms), hit.cost > 0 ? fmtUsd(hit.cost) : null] : [label];
    return { id: n.id, color: n.color || '', status: hit ? hit.status : 'pending',
      text: parts.filter(Boolean).join(' · ') };
  });
}

function paintLegacyStrip(host, manifest, decor) {
  const strip = document.createElement('div');
  strip.className = 'run-strip';
  for (const chip of legacyChipRows(manifest, decor && decor.steps)) {
    const el = document.createElement('span');
    el.className = `rchip is-${chip.status}`;
    el.dataset.id = chip.id;
    if (chip.color) el.style.setProperty('--c', COMPOSER_COLORS[chip.color] || '#ccc');
    el.textContent = chip.text;
    strip.appendChild(el);
  }
  host.replaceChildren(strip);
}
```
  Verify the three helpers it leans on exist in `app.js` with these exact names (`grep -n "function fmtDur\|function fmtUsd\|COMPOSER_COLORS" ui/public/app.js`); if a formatter is named differently, use the existing name — `fmtDur(120000) === '2m'` and `fmtUsd(0.4) === '$0.40'` are what the test pins.
- [ ] Step 3: CSS — append to `ui/public/style.css` right after the run-graph block:
```css
/* Legacy (v1) run strip — frozen runs only; no wires, no executions footer. */
.run-strip{display:flex;flex-wrap:wrap;gap:8px;padding:14px 16px;}
.run-strip .rchip{--c:var(--line-2);font-size:11.5px;font-weight:600;color:var(--ink-2);
  background:var(--field);border:1px solid var(--line);border-left:3px solid var(--c);
  border-radius:8px;padding:5px 10px;white-space:nowrap;}
.run-strip .rchip.is-pending{opacity:.5;}
.run-strip .rchip.is-done{color:var(--green-ink);}
.run-strip .rchip.is-active{color:var(--c);}
.run-strip .rchip.is-paused{color:var(--amber-ink);}
.run-strip .rchip.is-error,.run-strip .rchip.is-stopped{color:var(--red-ink);}
```
- [ ] Step 4: Resume gating. In `src/core/artifacts.mjs` `rowToState` (`:1662`), add after `guardrailsId:`:
```js
    // A retired v1 resume point was NULLed by the v2 upgrade: the run stays in
    // History with an honest status, but it can never be resumed again.
    resumable: row.resume_point != null,
```
  In `ui/public/app.js` `setupHdActions` (`:11415`) change the guard to:
```js
  // Resume: paused + interrupted only (D3), and only while a resume point exists
  // (v1 points were retired by the v2 upgrade). A LIVE snapshot has no
  // `resumable` field, so `!== false` keeps the live path untouched.
  if (HD_RESUMABLE.has(status) && st.resumable !== false) {
```
- [ ] Step 5: `node --test test/ui-history-detail.test.mjs test/artifacts-*.test.mjs`
  `Expected: PASS`
- [ ] Step 6: Mutation audit — flip the guard back to `HD_RESUMABLE.has(status)` and re-run: the second new test must fail (`false !== true`). Revert.
- [ ] Step 7: Commit: `worca: Node-graph v2 P8 — legacy v1 chip strip and resume gating`

---

### Task 10 (P8a final): Full suite, live-DB rehearsal on a COPY, commit

**Files:** none (verification only).

- [ ] Step 1: `npm test 2>&1 | tail -5`
  `Expected: BASELINE + 12 new tests, 0 failures` (Task 1–6 add 8 in `db-migrate-v24*.test.mjs`, Task 5 adds 1 in `server-boot-sweeps`, Task 7 adds 1 in `workflows`, Task 8 adds 2 in `api-workflows`/`workflows-db`, Task 9 adds 2 in `ui-history-detail`, minus the 2 v1-default tests Task 7 deletes).
- [ ] Step 2: **Rehearse V24 on a COPY of the real DB — never the live file.**
```bash
T=$(mktemp -d) && mkdir -p "$T/.worca-cc" && cp ~/.worca-cc/worca-cc.db "$T/.worca-cc/worca-cc.db"
WORCA_HOME="$T" node -e "
  const { getDb } = await import('./src/core/db.mjs');
  const db = getDb();
  const r = JSON.parse(db.prepare(\"SELECT data FROM store_meta WHERE key='migration:v24'\").get().data);
  console.log('archived', r.archived.length, r.archived);
  console.log('seeded', r.seeded.length, 'skipped', r.seedsSkipped);
  console.log('overlays', r.overlayNodes, r.overlayWires, 'alias', r.aliasRemapped);
  console.log('activeReset', r.activeReset, 'swept', r.sweptRuns);
  console.log('active now', db.prepare('SELECT project_key, active_workflow_id FROM project_config').all());
" --input-type=module
ls -la "$T/.worca-cc/worca-cc.db.pre-v24.bak"
```
  Expected on the user's DB: **6 archived** (`wf_quick-fix-v1`, `wf_quick-with-decompose-v1`, `wf_decompose-implement`, `wf_implement-only`, `wf_simple-plan`, `wf_full-v212`), **7 seeded**, 0 skipped, the orphaned `n_*` overlays and the `wf_no-clarify` w3/w10 = 6 wire rows now addressing real rows, **active workflow → `wf_default`**, **2 paused + any interrupted v1 runs swept**, and the `.pre-v24.bak` file present. Re-run the same command a second time: the report is unchanged and no new backup is written.
- [ ] Step 3: `rm -rf "$T"`. NEVER point `WORCA_HOME` at the real home during this rehearsal.
- [ ] Step 4: Commit (nothing to add if Tasks 1–9 committed cleanly): `git status --short` must show no `docs/superpowers/**` entry and no stray file.

### — split point: P8b starts here —

P8a is complete, green and shippable: the graph engine owns `wf_default`, every v1 row is archived, and the v1 engine still runs nothing (no template can reach it). P8b removes the dead code. A half may be executed as its own pipeline run.

---

### Task 11 (P8b entry): Branch, deps, P8a sentinel, baseline

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — the pipeline's branch (by hand: continue on `worca-cc/node-graph-v2-p8`). Never `git checkout dev`.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: P8a sentinels — STOP if any fails:
```bash
grep -q "SCHEMA_VERSION = 24" src/core/db.mjs && echo v24-ok
grep -q "reconcileV1Workflows" src/core/db.mjs && grep -q "sweepV1Runs" src/core/db.mjs && echo break-ok
grep -q "GRAPH_DEFAULT_WORKFLOW" src/core/workflows.mjs && echo default-ok
! grep -rq "wf_default_v2" ui/server.mjs && echo alias-gone
grep -q "paintLegacyStrip" ui/public/app.js && echo strip-ok
```
- [ ] Step 4: `npm test 2>&1 | tail -5` — record as BASELINE-B (the P8a total).
- [ ] Step 5: Inventory the kill surface so each later task can prove it shrank:
```bash
wc -l src/core/orchestrator.mjs src/core/graph/orchestrator.mjs src/core/phases.mjs \
      src/core/channels.mjs src/core/runners.mjs src/core/workflow-validator.mjs ui/public/app.js
grep -rn "from '.*orchestrator.mjs'" src ui test | wc -l
```

---

### Task 12: The v1 engine dies; `graph/orchestrator.mjs` becomes `orchestrator.mjs`

**Files:** delete the v1 `Orchestrator` class from `src/core/orchestrator.mjs`; `git mv src/core/graph/orchestrator.mjs src/core/orchestrator.mjs`; modify `src/core/engine-select.mjs`, every importer.
**Interfaces:** produces `createOrchestrator(opts)` (the graph factory, renamed from `createGraphOrchestrator`) and `class GraphOrchestrator extends RunHarness` exported from `src/core/orchestrator.mjs`; `selectEngine`/`createOrchestratorFor` collapse to the `ENGINE_RETIRED` refusal.

- [ ] Step 1: Delete, from `src/core/orchestrator.mjs` (dev anchors; locate by symbol): `FANOUT_ELIGIBLE :139`, `decomposedTaskNode :190`, `_dispatch :1961`, `_buildResumePoint :2141`, `_runStep :2176`, `_persistDecomposition :2228`, `_runDecomposedImplement :2249`, `_runDecomposedTask :2349`, `_runClarifyNode :2704`, `_bindNodeIo :2726`, `_publishNodeIo :2787`, `_loopFired :2807`, `_reviewOf :2819`, `_gate :2894`, `_phaseCtx :2903`, `_stepKeyFor :2944`, the v1 SHARED-shape twins `_preflightAgentKeys :1923`, `_logStepFailure :2390`, `_runNode :2403`, `_runNodeAttempts :2437`, `_runOnce :2467`, `_primeQuestions :2489`, `_questionsPath :2502`, `_questionsLoop :2517`, `_pauseForLimit :2572`, `_nodeCtx :2971`, `_nodeStep :3027`, `_onAgentEvent :3074` + the sub-agent reducers `:3231-3412`, `_recordCost :3796` — **every one of these has a v2 twin inside `src/core/graph/orchestrator.mjs`; the graph file is the survivor.** Then delete the file's remaining v1 imports (`runners.mjs`, `channels.mjs`, `workflow-validator.mjs`, the nine `run*` builders).
- [ ] Step 2: `git rm src/core/orchestrator.mjs && git mv src/core/graph/orchestrator.mjs src/core/orchestrator.mjs`. Inside it: `createGraphOrchestrator` → `createOrchestrator` (keep the class name `GraphOrchestrator`); fix its own relative imports (`../run-harness.mjs` → `./run-harness.mjs`, `./scheduler.mjs` → `./graph/scheduler.mjs`, `../../shared/graph/…` → `../shared/graph/…`).
- [ ] Step 3: `src/core/engine-select.mjs` collapses to:
```js
// src/core/engine-select.mjs
// One engine remains. The only decision left is refusing a run/resume that was
// pinned to the retired v1 engine.
import { createOrchestrator } from './orchestrator.mjs';
import { V1_RUN_RETIRED } from './db.mjs';

export class EngineRetiredError extends Error {
  constructor() { super(V1_RUN_RETIRED); this.code = 'ENGINE_RETIRED'; this.status = 409; }
}

/** @throws {EngineRetiredError} when the resume point is not a graph point. */
export function createOrchestratorFor(opts = {}) {
  const rpVersion = opts?.resume?.resumePoint?.version;
  if (rpVersion !== undefined && rpVersion !== 2) throw new EngineRetiredError();
  return createOrchestrator(opts);
}
```
- [ ] Step 4: `grep -rln "graph/orchestrator.mjs\|createGraphOrchestrator\|selectEngine" src ui test scripts` — update every hit (imports move up one directory; the factory name changes). Record the count; it must reach 0.
- [ ] Step 5: `npm test 2>&1 | tail -20`. Failures fall in two buckets: (a) a suite importing a deleted v1 symbol → it is on the retire list (Task 19) — note it, do not patch it; (b) a suite importing the moved module → fix the path now.
- [ ] Step 6: Commit: `worca: Node-graph v2 P8 — delete the v1 orchestrator, promote the graph engine`

---

### Task 13: `channels.mjs`, `runners.mjs`, `workflow-validator.mjs` and the bespoke prompt builders

**Files:** delete `src/core/channels.mjs`, `src/core/runners.mjs`, `src/core/workflow-validator.mjs`; modify `src/core/phases.mjs`, `src/core/agent-registry.mjs:14,32,79,124`, `src/core/plugin-workflows.mjs:14`, `ui/server.mjs:98,115,3886-3905,3941`; delete `test/channels*.test.mjs` (5), `test/runners.test.mjs`, `test/runners-generic.test.mjs`, `test/runner-decomposer.test.mjs`, `test/workspace-runners.test.mjs`, `test/workspace-channel.test.mjs`, `test/workflow-validator.test.mjs`; modify `test/entry-prompt-seed.test.mjs`.
**Interfaces:** `phases.mjs` becomes the prompt library. **Survivors** (exported): `effectiveAllowedTools :47`, `ctxFanOut :70`, `fanOutDirective :122`, `workspaceContextBlock :159`, `workspaceFanOutDirective :183`, `buildSystemPrompt :293`, `resolveAgentBody :314`, `RESUME_HEADER :331`, `questionsPromptBlock :349`, `workspaceWriteTargetsFor :391`, `_runOptsForTests :446`, `taskHeader :449`, `workspaceDiffInstruction :548`, `buildClarifyPrompt :563`, `implementerBody :788`, `genericIoBlock :1149`, `renderAnswers :1270`, `runWorkspaceScan :992` (the off-pipeline scanner, driven by `workspace-scan.mjs:310` — NOT a pipeline node), plus P3's exports `siblingsBlock`, `mockMarkers`, `diffInstruction`, `runOpts :397`, `READ_WRITE_TOOLS`, `IMPLEMENTER_TOOLS` (the v2 executor imports all six — `grep -n "from '../phases.mjs'" src/core/graph/executor.mjs` is the authority; whatever it names survives), and the two helpers re-homed in Step 1. **Deleted**: `runClarify :607`, `runPlannerPlan :637`, `runRefiner :674`, `runDecomposer :712`, `runImplementer :822`, `runReviewer :852`, `runPlanReviewer :901`, `runWorkspaceReviewer :944`, `runManualTestsChecklist :1063`, `runManualWebUiTesting :1108`, `runGenericProducer :1192`, `runGenericVerifier :1225`, `FALLBACK_PROMPTS :240`.

- [ ] Step 1: Re-home the two prompt-artifact helpers BEFORE deleting `channels.mjs`: move `renderAttachmentsBlock` (`channels.mjs:279`) and `renderPromptArtifact` (`:294`) verbatim into `src/core/phases.mjs` (export both), and delete `phases.mjs:20`'s `import { renderAttachmentsBlock } from './channels.mjs';`. `renderPromptArtifact` is used by the graph orchestrator's Task-card document (`src/core/graph/orchestrator.mjs` imports it from `../channels.mjs` since P4 — A6 of the cross-plan pass) and by the dying v1 entry-prompt seed — `grep -rn "renderPromptArtifact" src ui` and re-point every surviving importer at `phases.mjs`.
- [ ] Step 2: Delete the 12 `run*` builders + `FALLBACK_PROMPTS` from `phases.mjs`, then delete any module-private helper left with zero references — check each of `readDecomposition :745`, `siblingsBlock :762`, `mockMarkers :321`, `joinPipeline :1264`, `workspaceProjectsBlock :514`, `runOpts :397` with `grep -n "<name>" src/core/phases.mjs` and keep the ones P3's executor imports.
- [ ] Step 3: `git rm src/core/channels.mjs src/core/runners.mjs src/core/workflow-validator.mjs`.
- [ ] Step 4: Fix the orphaned importers:
  - `src/core/agent-registry.mjs`: delete `:14` `import { CHANNEL_IDS as CHANNEL_ID_LIST } …`, `:32` `const CHANNEL_IDS = new Set(...)` and the two v1 arms that read it (`:79` the `consumes/produces` channel-id filter, `:124` the channel-vs-custom branch). These belong to the v1 sidecar vocabulary retired in Task 15 — delete them here and finish that file there.
  - `src/core/plugin-workflows.mjs:14`: drop the `validateWorkflow` import; the v1 template path is already dead (P7 imports only v2 templates) — `grep -n validateWorkflow src/core/plugin-workflows.mjs` must return nothing after the edit.
  - `ui/server.mjs`: drop the `validateWorkflow` import (`:98`) and the `CHANNEL_IDS` import (`:115`); delete `collectChannelIds` (`:3886-3905`) and the `channels:` fallback at `:3941` if P7 left them.
- [ ] Step 5: Delete the suites that test only deleted code: `test/channels.test.mjs`, `test/channels-clarify.test.mjs`, `test/channels-custom.test.mjs`, `test/channels-decomposition.test.mjs`, `test/channels-workspace.test.mjs`, `test/workspace-channel.test.mjs`, `test/runners.test.mjs`, `test/runners-generic.test.mjs`, `test/runner-decomposer.test.mjs`, `test/workspace-runners.test.mjs`, `test/workflow-validator.test.mjs` (`test/api-workflows-warnings.test.mjs` already went in P8a Task 8).
- [ ] Step 6: `test/entry-prompt-seed.test.mjs` keeps the two prompt-artifact cases and loses the `entrySeedChannels` ones: change its import to `import { renderPromptArtifact, renderAttachmentsBlock } from '../src/core/phases.mjs';` and delete every `entrySeedChannels` test (`:20-41`).
- [ ] Step 7: The five `phases-*` suites test SURVIVORS (`resolveAgentBody`/`buildSystemPrompt`, `implementerBody`, `taskHeader`/`buildClarifyPrompt`, `questionsPromptBlock`, the workspace blocks) — keep all five. Run them: `node --test test/phases-agent-body.test.mjs test/phases-implementer-task.test.mjs test/phases-prompt.test.mjs test/phases-questions.test.mjs test/phases-workspace.test.mjs`. `Expected: PASS`. If one fails ONLY because it imports a deleted builder, retire that file and say so in the commit body.
- [ ] Step 8: `npm test 2>&1 | tail -20` — remaining failures must all be files on Task 19's retire list.
- [ ] Step 9: Commit: `worca: Node-graph v2 P8 — delete channels, runners, workflow-validator and the bespoke builders`

---

### Task 14: v1 topology helpers leave `workflows.mjs` and `agent-registry.mjs`

**Files:** modify `src/core/workflows.mjs` (`LEGACY_DEFAULT_WORKFLOW`, `resolveWorkflow :371`, `UI_PHASE :385`, `buildStepperManifest :468`, `rewriteStepperForDecomposition :518`), `src/core/agent-registry.mjs` (`DEFAULT_SPEC :50`, `LEGACY_LABELS :101`, `registryToSteps :415`), `src/core/config.mjs:17,29`.

- [ ] Step 1: Delete from `src/core/workflows.mjs`: `LEGACY_DEFAULT_WORKFLOW` (Task 7 kept it only for the two suites Task 19 retires), `resolveWorkflow` (whole function, incl. its inline `UI_PHASE` map — `uiPhase` moved into P4's manifest builder), `buildStepperManifest`, `rewriteStepperForDecomposition`. `grep -rn "resolveWorkflow\|buildStepperManifest\|rewriteStepperForDecomposition\|LEGACY_DEFAULT_WORKFLOW" src ui test` must reach 0 outside the retired suites.
- [ ] Step 2: `src/core/agent-registry.mjs`: `DEFAULT_SPEC :50` and `LEGACY_LABELS :101` describe the v1 fixed pipeline's ordering/labels; `registryToSteps :415` builds the v1 per-role config rows from them. `registryToSteps` has ONE production consumer — `src/core/config.mjs:29` `agentSteps()`, which feeds `GET /api/config`'s legacy per-role editor. That editor is still live (the wf_default legacy layer survives, P8a Task 8 Step 3), so **`registryToSteps`, `DEFAULT_SPEC` and `LEGACY_LABELS` STAY**; delete only the fields of `DEFAULT_SPEC` that no longer exist on meta v2 (`consumes`, `produces`, `connectsTo`, `uiPhase`, `loopSource` — see Task 15) and the `spec.uiPhase` merge at `:210`.
- [ ] Step 3: `node --test test/agent-registry*.test.mjs test/config*.test.mjs 2>&1 | tail -5`. `Expected: PASS` (a failure naming `uiPhase` belongs to Task 15).
- [ ] Step 4: Commit: `worca: Node-graph v2 P8 — retire the v1 topology helpers`

---

### Task 15: v1 fields leave the 11 builtin sidecars and `normalizeMeta`

**Files:** modify `agents/*.meta.json` (11 files), `src/core/agent-registry.mjs` (`DEFAULT_SPEC :50-64`, `channelList`/`normalizeConnectsTo` `:70-130`, `normalizeMeta :212-240`), `test/agent-registry*.test.mjs`.
**Interfaces:** after this task a normalized meta carries NO `consumes`, `optionalConsumes`, `produces`, `connectsTo`, `loopSource`, `uiPhase`. Ports (`inputs`/`outputs`, `metaVersion: 2`) added in P2a are the only wiring vocabulary.

- [ ] Step 1: Per-file JSON deletions — remove these keys and nothing else:

| file | delete |
|---|---|
| `clarify.meta.json` | `consumes`, `produces`, `connectsTo`, `loopSource` |
| `decomposer.meta.json` | `consumes`, `optionalConsumes`, `produces`, `connectsTo`, `loopSource` |
| `implementer.meta.json` | `consumes`, `optionalConsumes`, `produces`, `connectsTo`, `loopSource` |
| `manualTestsChecklist.meta.json` | `consumes`, `produces`, `connectsTo`, `loopSource` |
| `manualWebUiTesting.meta.json` | `consumes`, `produces`, `connectsTo`, `loopSource` |
| `planReviewer.meta.json` | `consumes`, `produces`, `connectsTo`, `loopSource` |
| `planner.meta.json` | `consumes`, `optionalConsumes`, `produces`, `connectsTo`, `loopSource` |
| `refiner.meta.json` | `consumes`, `produces`, `connectsTo`, `loopSource` |
| `reviewer.meta.json` | `consumes`, `produces`, `connectsTo`, `loopSource` |
| `workspaceReviewer.meta.json` | `consumes`, `produces`, `connectsTo`, `loopSource` |
| `workspaceScanner.meta.json` | `consumes`, `produces`, `connectsTo`, `loopSource` |

  Verify: `grep -l "consumes\|produces\|connectsTo\|loopSource" agents/*.meta.json` returns nothing; `node -e "for (const f of require('fs').readdirSync('agents').filter(x=>x.endsWith('.meta.json'))) { const m = require('./agents/'+f); if (m.metaVersion !== 2 || !m.inputs || !m.outputs) throw new Error(f); } console.log('11 v2 sidecars ok')"`.
- [ ] Step 2: `src/core/agent-registry.mjs` — delete the `consumes/optionalConsumes/produces/connectsTo` entries from `DEFAULT_SPEC :50-64` (the object keeps `order`, `color`, `runnerType` and whatever else P2a/P7 left), delete `channelList`, `normalizeConnectsTo`, `rtFallbackConsumes` and the six fields from `normalizeMeta`'s return (`:212-216, :228, :233-236, :240`). `CHANNEL_IDS` is already gone (Task 13).
- [ ] Step 3: Update the registry suites: any assertion on `consumes/produces/connectsTo/loopSource/uiPhase` of a builtin is deleted; the port assertions P2a added stay. `grep -rn "connectsTo\|loopSource" test | grep -v v1-remnants` must reach 0 (`connects-to.test.mjs` was retired in P5b — if it still exists, `git rm` it here).
- [ ] Step 4: `node --test test/agent-registry*.test.mjs test/graph-*.test.mjs 2>&1 | tail -5`. `Expected: PASS` — the seed drift guard (P2a) proves the 8 shipping graphs still validate 0 errors / 0 warnings against the trimmed sidecars.
- [ ] Step 5: Commit: `worca: Node-graph v2 P8 — drop the v1 wiring fields from the builtin sidecars`

---

### Task 16: The `phase` shim dies; bookends become `exec` rows

**Files:** modify `src/core/run-harness.mjs` (`_bookend`), `src/core/orchestrator.mjs` (shim emitter, `state.phase/cycle`), `ui/server.mjs` (`EVENT_NAMES :251`, `wireRun ≈:541`), `ui/public/graph/run-decor.mjs`, `src/cli/render.mjs`; delete `test/graph-phase-shim.test.mjs`.
**Interfaces:** consumes `BOOKEND_EXECUTION_IDS` (frozen array `['x:preflight:1', 'x:done:1']`) from `src/shared/graph/constants.mjs` (P1) — already imported by `run-decor.mjs` and `src/cli/render.mjs` since P6, which already exclude those rows from progress/execution counts and render nothing for them; `phase` leaves `EVENT_NAMES`; `state.phase`/`state.cycle` are no longer written (the `pipelines.phase/cycle` COLUMNS stay, unread — `toPipelineRow` keeps writing whatever the state carries, which is now nothing).

- [ ] Step 1: Write the failing test — append to `test/orchestrator-graph.test.mjs`:
```js
test('bookends are exec rows and no phase event is emitted', async () => {
  const events = [];
  const orch = createOrchestrator({ /* the file's existing mock opts */ });
  for (const name of ['exec', 'phase']) orch.on(name, (p) => events.push({ name, ...p }));
  await orch.run(/* the file's existing run args */);
  assert.equal(events.some((e) => e.name === 'phase'), false, 'the shim is gone');
  const pre = events.find((e) => e.executionId === 'x:preflight:1');
  const done = events.find((e) => e.executionId === 'x:done:1');
  assert.deepEqual([pre.nodeId, pre.kind, pre.ordinal, pre.agentKey], ['preflight', 'cycle', 1, null]);
  assert.deepEqual(pre.trigger, { wireIds: [], freshPorts: [] });
  assert.ok(done, 'the done bookend is an exec row too');
  const state = orch.getState();
  assert.equal(state.phase, undefined);
  assert.equal(state.cycle, undefined);
  assert.ok(state.steps.some((s) => s.key === 'x:preflight:1'), 'the ledger keeps the bookend row');
});
```
  `Expected: FAIL — AssertionError: the shim is gone`
- [ ] Step 2: `src/core/run-harness.mjs` — `_bookend(name, status)` becomes:
```js
  /** Preflight/Done are ledger rows like any other execution: keyed x:<name>:1,
   *  agentKey null, excluded from progress and execution counts by the readers. */
  _bookend(name, status) {
    const executionId = `x:${name}:1`;
    // _recordStep keys on `cycle ? phase#cycle : phase`, so pass cycle 0 to get
    // the executionId VERBATIM as the ledger key, then stamp the exec columns.
    this._recordStep(executionId, 0, status, name);
    const row = this.state.steps.find((s) => s.key === executionId);
    if (row) Object.assign(row, { phase: null, cycle: 1, kind: 'cycle', ordinal: 1, agentKey: null });
    this.state.updatedAt = new Date().toISOString();
    this._emit('exec', { nodeId: name, executionId, kind: 'cycle', ordinal: 1, status,
      agentKey: null, trigger: { wireIds: [], freshPorts: [] } });
    this._emit('state', this.getState());
    this._persist().catch(() => {});
  }
```
  and delete the `this.state.phase = …` / `this.state.cycle = …` writes plus the `_emit('phase', …)` line from whatever P1 left of `_phase`.
- [ ] Step 3: `src/core/orchestrator.mjs` — delete the derived-`phase` emitter (the block that maps an `exec` to `{phase: uiPhase, cycle: ordinal, status}`), the `state.phase/cycle` mirroring, and the shim `steps`/`feedbacks` cells from the manifest builder ONLY if nothing reads them (`grep -rn "stepper.steps\|manifest.steps" ui/public src | grep -v paintLegacyStrip` — the legacy strip reads `manifest.steps` of PERSISTED v1 manifests, never of a freshly built v2 one, so the derived cells go).
- [ ] Step 4: `ui/server.mjs` — `EVENT_NAMES :251` loses `'phase'` (final list: `['log','question','artifact','state','done','error','subagent','stepskills','stepgraphify','title','exec','token']`), and the `if (name === 'phase') { entry.status = 'running'; }` arm in `wireRun` (`≈:556`) is deleted (P4 added the `exec` twin).
- [ ] Step 5: Bookends must not inflate the UI — VERIFY, do not add: `grep -n "BOOKEND_EXECUTION_IDS" src/shared/graph/constants.mjs ui/public/graph/run-decor.mjs src/cli/render.mjs` prints the P1 export plus one import and one use in each consumer (P6 shipped them). Run `node --test test/ui-run-decor.test.mjs test/cli-exec-render.test.mjs` with a ledger carrying the two bookend rows: progress/executions exclude them and `formatExecLine` returns `''`. If a consumer lacks the filter, add exactly this (P6's contract):
```js
/** Ledger rows the engine writes for the run's own bookends. They are real
 *  executions in the ledger (cost/clock attribution) but they are NOT graph
 *  nodes: never counted in progress, never listed in an executions footer. */
export const BOOKEND_EXECUTION_IDS = new Set(['x:preflight:1', 'x:done:1']);
```
  and filter at the top of `decorFromState`: `const rows = steps.filter((s) => !BOOKEND_EXECUTION_IDS.includes(s.executionId || s.key));` (an ARRAY — `.includes`, never `.has`) — every later use reads `rows`. In `src/cli/render.mjs`, `formatExecLine` returns `null` for a bookend executionId (the caller already skips null lines), and the summary's execution count uses the same filter.
- [ ] Step 6: `git rm test/graph-phase-shim.test.mjs`.
- [ ] Step 7: `node --test test/orchestrator-graph.test.mjs test/ui-run-decor.test.mjs test/cli-exec-render.test.mjs test/api-events.test.mjs 2>&1 | tail -5`. `Expected: PASS`.
- [ ] Step 8: Commit: `worca: Node-graph v2 P8 — delete the phase shim, bookends become exec rows`

---

### Task 17: The v1 painters leave `app.js` and `style.css`

**Files:** modify `ui/public/app.js` (dev anchors — locate by symbol, P5/P6 shifted them: `normalizePhase :842`, `CLIENT_DEFAULT_STEPPER :860`, `manifestFor :876`, `locateInManifest :894`, `advanceRun :927`, the v1 column renderer `:1019-1215`, `buildRunGraph :1071`, history painters `histNodeCycle :10606` / `histReachedCell :10654`, `phaseKey` switches `:4261/:13953/:14000`, `runStatusOf :14149`, the frontier scan `:14252-14310`), `ui/public/style.css:1258-1381`.

- [ ] Step 1: Delete, in this order (each deletion's callers were replaced by P6's v2 renderer — `grep -n "<symbol>" ui/public/app.js` must show only the definition before you cut it):
  `normalizePhase`, `CLIENT_DEFAULT_STEPPER` (and `manifestFor`'s fallback to it — `manifestFor` returns `stepper` or `null` now), `locateInManifest`, `advanceRun` and its `case 'phase':` dispatch arm, the v1 column renderer block, `buildRunGraph`, `histNodeCycle`, `histReachedCell`, every `phaseKey` switch, `runStatusOf`, the frontier scan (`maxCellIdx`, the "active node = the frontier node" block, `stepStatusByKey`'s v1 arm).
  KEEP: `paintLegacyStrip` + `legacyChipRows` (P8a Task 9) — they are the only client code allowed to read the v1 vocabulary, and they read a PERSISTED manifest, never live events.
- [ ] Step 2: `ui/public/style.css:1258-1381` — delete the v1 column rules (`.run-flow .col`, `.run-flow .strip`, `.run-flow .node…`, `.run-flow .node .nrun`, `.run-flow .node.run-node`, `.run-flow .wires path.wire-dim`) and RE-HOME the shared decor by de-scoping it out of `.run-flow` (P6 hosts the v2 graph in `.run-flow-wrap` on the Running list card but in `.rd-graph`/`.hd-graph` on the detail pages, so a `.run-flow`-scoped rule would silently stop applying there). Keep, unscoped, in a block headed `/* Run-graph shared decor (v2 renderer + the frozen-v1 strip) */`: `@keyframes nodeGlow`, `@keyframes nodeGlowAmber`, `@keyframes sqPulse`, `@keyframes wireFlow`, `.nstat` (+ `.nstat svg`, `.nstat.done|.paused|.stopped`), `.fan` (+ `.fan .sq`, `.sq.on`, `.fl`), and the `@media (prefers-reduced-motion: reduce)` block re-written against the surviving selectors. `.run-flow-wrap`/`.run-flow` themselves STAY (P6's Running-card host).
- [ ] Step 3: Re-run every UI suite: `node --test test/ui-*.test.mjs 2>&1 | tail -20`. Failures naming a deleted painter belong to Task 19's retire list; failures in a P5/P6 suite are real regressions — fix them.
- [ ] Step 4: `grep -c "uiPhase" ui/public/app.js` — the only hits allowed are inside `legacyChipRows`.
- [ ] Step 5: Commit: `worca: Node-graph v2 P8 — delete the v1 run painters and re-home the shared CSS`

---

### Task 18: CLI, ask-follow and chat router stop reading `phase`

**Files:** modify `src/cli/worca-cc.mjs` (`phaseLabel :245`, `statusMark :252`), `src/core/ask/follow.mjs:60`, `src/core/chat/command-router.mjs:184`.

- [ ] Step 1: `grep -n "phaseLabel\|statusMark" src/cli/worca-cc.mjs` — P6b replaced their call sites with `src/cli/render.mjs`; delete both functions (and `COLORS`-only helpers left unused).
- [ ] Step 2: `src/core/ask/follow.mjs` — replace the `phase:` handler (`:60-62`) with:
```js
    exec: guard((p) => {
      // The graph engine has no linear phase: report the agent that just started.
      if (p.status !== 'start') return;
      updateStatus({ phase: p.agentKey || p.nodeId || null, status: 'running' });
    }),
```
- [ ] Step 3: `src/core/chat/command-router.mjs:184` — replace the `**Phase:**` segment with the active-node view:
```js
        const ledger = (state.steps || []).filter((s) => !String(s.key || '').startsWith('x:'));
        const doneSteps = ledger.filter((s) => s.status === 'done').length;
        const nodes = state.stepper?.graph?.nodes || [];
        const active = (state.active || [])
          .map((a) => nodes.find((n) => n.id === a.nodeId)?.label || a.nodeId);
        const activeLabel = active.length === 0 ? '—'
          : (active.length === 1 ? active[0] : `${active.length} agents running`);
        lines.push(`   **Executions:** ${doneSteps}/${ledger.length} done · **Active:** ${activeLabel}`);
```
- [ ] Step 4: `node --test test/ask-follow*.test.mjs test/chat-*.test.mjs test/cli-*.test.mjs 2>&1 | tail -5`. `Expected: PASS` (update the two suites' expected strings to the new copy; assert on `**Active:**`, never on `**Phase:**`).
- [ ] Step 5: Commit: `worca: Node-graph v2 P8 — CLI, ask-follow and chat router read exec/active`

---

### Task 19: `v1-remnants-removed` guard, retired suites, one harness factory

**Files:** create `test/v1-remnants-removed.test.mjs`; delete the retired suites; modify the parametrized harness suites.

- [ ] Step 1: Retire (verify each exists first with `ls test/<name>`; some are already gone from P5/P6/P7 — that is fine, skip those): `dispatcher.test.mjs`, `orchestrator-decompose.test.mjs`, `stepper-rewrite.test.mjs`, `ui-stepper.test.mjs`, `ui-run-graph.test.mjs`, `ui-run-graph-paint.test.mjs`, `ui-hello-stepper-seed.test.mjs`, `ui-server-stepper-seed.test.mjs`, `ui-run-flow-css.test.mjs`, `ui-phase-label.test.mjs`, `connects-to.test.mjs` (`channels*`, `runners*`, `workflow-validator`, `workspace-*` went in Task 13; `graph-phase-shim` in Task 16).
- [ ] Step 2: Collapse the dual-engine parametrization. `grep -rln "createOrchestratorFor\|both factories\|for (const factory" test` — in each hit (`orchestrator-heartbeat`, `-partial-diff`, `-pause`, `-resume`, `-session-capture`, `-guardrails`, `saved-pipeline-parity`) drop the v1 arm and keep ONE factory, `createOrchestrator` from `src/core/orchestrator.mjs`. `saved-pipeline-parity.test.mjs` loses its reason to exist (there is no second engine to compare against): `git rm` it and its v1 fixtures `test/fixtures/workflows-v1/`.
- [ ] Step 3: Write the guard. `test/v1-remnants-removed.test.mjs`:
```js
// test/v1-remnants-removed.test.mjs
// The v2 break's tripwire: the v1 engine's vocabulary must never reappear in
// shipping code. Each pattern below killed a concrete thing (spec §11); the
// allowlist names the ONE sanctioned reader of each survivor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'ui'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor']);

function files() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      if (SKIP_DIRS.has(e)) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(mjs|js|json|css|html)$/.test(e)) out.push(p);
    }
  };
  for (const r of ROOTS) walk(r);
  return out;
}

// [pattern, why, allowlist of paths that may still match]
const BANNED = [
  [/\bbuildStepperManifest\b/, 'the v1 stepper manifest builder', []],
  [/\brewriteStepperForDecomposition\b/, 'the decomposition manifest rewrite', []],
  [/\bCLIENT_DEFAULT_STEPPER\b|\bnormalizePhase\b|\blocateInManifest\b|\badvanceRun\b/, 'the v1 client stepper', []],
  [/\bconnectsTo\b|\bloopSource\b|\boptionalConsumes\b/, 'v1 sidecar wiring fields', []],
  [/\bconsumes\b/, 'the v1 channel vocabulary', []],
  [/\bwf_default_v2\b/, 'the coexistence alias', ['src/core/workflows.mjs']],
  [/_emit\(\s*['"]phase['"]/, 'the phase event', []],
  [/['"]phase['"]\s*,/, 'phase in EVENT_NAMES', ['src/core/artifacts.mjs', 'src/core/db.mjs']],
  [/INSERT INTO workflows[\s\S]{0,200}feedbacks/, 'a v1 template write', ['src/core/db.mjs', 'src/core/migrate-fs-to-db.mjs']],
  [/\bwriteWorkflow\b/, 'the v1 template writer outside workflows.mjs', ['src/core/workflows.mjs']],
  [/\brunners\.mjs\b|\bchannels\.mjs\b|\bworkflow-validator\.mjs\b/, 'a deleted module', []],
];

test('no v1 engine remnant survives in src/ or ui/', () => {
  const hits = [];
  for (const f of files()) {
    const text = readFileSync(f, 'utf8');
    for (const [re, why, allow] of BANNED) {
      if (allow.includes(f)) continue;
      if (re.test(text)) hits.push(`${f}: ${why} (${re})`);
    }
  }
  assert.deepEqual(hits, [], `v1 remnants found:\n${hits.join('\n')}`);
});

// Agent keys are DATA, never control flow: the engine is generic (spec §1).
const AGENT_KEYS = ['planner', 'refiner', 'implementer', 'reviewer', 'decomposer',
  'clarify', 'planReviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'workspaceReviewer'];
const KEY_ALLOW = new Set([
  'src/core/agent-registry.mjs',   // DEFAULT_SPEC: per-builtin display order/colour (data)
  'src/core/claude-runner.mjs',    // MOCK_WRITER_ROLES: the offline mock's role table
  'src/core/graph/seed-templates.mjs',
  'src/core/graph/builtin-workflows.mjs',
]);

test('no agent-key literal drives engine or UI control flow', () => {
  const hits = [];
  for (const f of files()) {
    if (KEY_ALLOW.has(f) || !/^src\/core\/(graph|orchestrator|run-harness)|^ui\/public\/graph/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const k of AGENT_KEYS) {
      if (new RegExp(`['"\`]${k}['"\`]`).test(text)) hits.push(`${f}: hardcodes agent key "${k}"`);
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});
```
- [ ] Step 4: Run it: `node --test test/v1-remnants-removed.test.mjs`. Every reported hit is either a real remnant (delete it) or a sanctioned survivor (add the exact path to that pattern's allowlist WITH a comment saying why — never widen a regex).
- [ ] Step 5: `npm test 2>&1 | tail -5`. `Expected: green`.
- [ ] Step 6: Commit: `worca: Node-graph v2 P8 — v1-remnants guard, retired suites, one orchestrator factory`

---

### Task 20: Docs and skills

**Files:** modify `skills/worca/SKILL.md`, `.claude/skills/orchestrate/SKILL.md`, `.claude/skills/creating-worca-cc-plugins/SKILL.md`, `README.md`, `docs/screenshots.md`.

- [ ] Step 1: `skills/worca/SKILL.md` (anchors on dev; the file is short — locate by the quoted text):
  - `:3` description: `Run the node-graph multi-agent orchestrator over a software task in the current project. Triggers on "/worca", "/worca <prompt>", "/worca --ui", and on requests to orchestrate, run the orchestration pipeline, or drive plan/refine/implement/review for a task.`
  - `:8`: replace `**Preflight -> Plan -> Refine (loop) -> Implement -> Review (loop) -> Done**` with `the selected pipeline template (default \`wf_default\`: Plan → Refine ↺ → Implement → Review ↺ → End)`.
  - `:22`: `The CLI streams phase changes and live agent logs` → `The CLI streams every agent execution (start/done, cycle, cost) and live agent logs`.
  - `:28`: DELETE the `--max-refine <N>` / `--max-review <N>` line (those flags never existed on dev; cycle caps are per-wire and live in the template/overlays).
  - Add to the flag list, after `--title`: `- \`--workflow <id>\` — run a saved pipeline instead of the built-in default (\`wf_default\`).`
  - `:42`: `step tracker` → `live pipeline graph`.
- [ ] Step 2: `.claude/skills/orchestrate/SKILL.md` — insert immediately after the frontmatter (after line 4's closing `---`, before `# Orchestrate (native)`), VERBATIM:
```markdown
> **Frozen (2026-08-26).** This skill is a prose clone of the v1 fixed pipeline (Plan → Refine → Implement → Review). worca now runs node-graph pipelines (typed ports, wires, loop budgets, AND/OR/Combine/End cards); this document is deliberately NOT updated and may drift from the engine. For the real engine use /worca. Follow-up: rewrite or retire.
```
- [ ] Step 3: `.claude/skills/creating-worca-cc-plugins/SKILL.md` (P7 may have landed some of these — apply what is missing):
  - agents row (`:13`): `| \`agents/<key>.md\` + \`<key>.meta.json\` | pipeline agents (meta v2 sidecar: typed input/output ports) | No — prompt text fed to \`claude -p\` |`
  - workflows row (`:15`): `| \`workflows/*.json\` | pipeline templates (v2 graph JSON — one Task node, one End node) | No — validated into DB rows |`
  - `:51`: `">=1 <2"` → `">=3 <4"`, and append to that cell: `Host APIs are a SET ([1, 2, 3]); the highest version your range admits is negotiated. API 3 adds meta v2 sidecars and v2 graph templates.`
  - `:91` heading: `## Connector contract (unchanged through API 3)`
  - `:110`: `\`ctx\` = \`{ apiVersion, profile, config, state: {get, set}, log }\` — \`apiVersion\` is the negotiated highest version your range admits.`
  - `:136-137` pitfalls table, two new rows: `| A v1 sidecar (\`consumes\`/\`produces\`/\`connectsTo\`) | Ignored at load with a Plugins-view note — port it to \`metaVersion: 2\` |` and `| A v1 \`steps\` workflow template | Ignored at load with a Plugins-view note — rewrite it as a graph (\`version: 2\`) |`
  - New section before the pitfalls, `## Agents & templates (API 3)`: the sidecar mini-schema (`metaVersion: 2`, `inputs:[{id,type,required?,loop?,expands?,as?,directive?}]`, `outputs:[{id,type,when?,filename?,store?,artifactKind?}]`, `runnerType`, `verdict`, `placeable`) and the scaffold graph JSON (`n_task → n_helper → n_end`) `worca plugin init` writes.
- [ ] Step 4: `README.md:83-91` — replace the Workflow Composer bullet with:
```markdown
- **Compose your own pipeline** — drag agents onto a canvas and wire their typed
  ports: each card declares what it consumes and produces, a wire only connects
  compatible ports, and a wire that closes a cycle becomes a loop with its own
  cycle cap (a reviewer keeps sending work back until it passes or the budget
  runs out). Flow cards — **Task** (the run's request), **End** (the result),
  **AND**, **OR**, **Combine** — express joins, choices and merges without any
  code. Saved pipelines appear in the New Pipeline picker.
```
  and at `:71` add `typed ports` to the agent bullet: `Each agent is a markdown prompt plus a metadata sidecar declaring its typed input/output ports — new agents drop in without engine changes.`
- [ ] Step 5: `docs/screenshots.md:58` — caption `| \`composer.png\` | Pipeline Composer, default graph | — |`, and add a line under the table: `> \`composer.png\` predates the node-graph composer — re-shoot it before the next release.` (Screenshots are re-shot by hand; this plan bans launching servers/browsers.)
- [ ] Step 6: `grep -rn "worca-cc" skills/worca/SKILL.md README.md | grep -v "src/cli/worca-cc.mjs\|WORCA_REPO\|worca-cc.db"` — no user-facing prose may call the product "worca-cc".
- [ ] Step 7: Commit: `worca: Node-graph v2 P8 — docs and skills for the graph engine`

---

### Task 21 (P8b final): Full suite, smoke, handoff

- [ ] Step 1: `npm test 2>&1 | tail -5`
  `Expected: BASELINE-B + 2 new tests − <the retired suites' cases>, 0 failures.` P8b ADDS 2 tests (`v1-remnants-removed`) and 1 (`orchestrator-graph` bookends), and REMOVES every case in the ~20 retired files plus the shim/parity suites — the total DROPS. Record the exact printed number as the new baseline for dev and put it in the commit body; do not "fix" a lower total.
- [ ] Step 2: Smoke (needs a throwaway git repo — `sandbox/` is gitignored and absent in a fresh worktree):
```bash
mkdir -p sandbox && git -C sandbox init -q -b main && git -C sandbox commit -q --allow-empty -m init
npm run smoke
```
  `Expected:` a mock run of the graph `wf_default` that prints exec lines (`▶ Planner`, `✓ Planner …`), ends with `Pipeline complete.` + a `Result:` line, and exits 0. No `phase` line, no `preflight`/`done` chip.
- [ ] Step 3: `git status --short` — no `docs/superpowers/**` file is staged or committed. `git log --oneline -20` shows the P8a commits before every P8b deletion commit.
- [ ] Step 4: Final review sweep:
```bash
node --test test/v1-remnants-removed.test.mjs
grep -rn "engine-select" src ui | head      # only the ENGINE_RETIRED refusal remains
ls src/core/orchestrator.mjs && ! ls src/core/graph/orchestrator.mjs 2>/dev/null && echo moved-ok
```
- [ ] Step 5: Handoff line for the executor's final report: **P8 complete — plan `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P8-break-kill-list-docs.md`; the node-graph v2 series (P1–P8) is done: one engine, one composer, one monitor, `SCHEMA_VERSION = 24`, `.pre-v24.bak` taken on every upgraded DB.** Report the new suite total and the V24 rehearsal numbers from Task 10.

## Clarifications (Q&A)
- **D1** — How does the series land? → **New plan + new implementation on dev; 8 plans, each green and shippable; P8 written as halves a/b with an explicit split point (user decision 2026-08-26).**
- **D7** — What happens to existing v1 template rows? → **ALL of them are ARCHIVED (`archived_at` stamped, row + `steps`/`feedbacks` kept, never listed, never runnable), never converted and never deleted; the 7 seed graphs are INSERTED on existing DBs only, fresh installs keep Default only (user decision 2026-08-26).**
- **D8a** — Paused v1 runs at the break? → **Swept to `interrupted` with `resume_point = NULL`, a `pipeline_events` line and a stderr audit, after a DB backup (user decision 2026-08-26).**
- **D8b** — What served the v2 default during coexistence? → **The `wf_default_v2` alias; V24 remaps every alias-keyed overlay, active-workflow pointer and v2 resume point to `wf_default` and the alias is deleted (user decision 2026-08-26).**
- **B1** — Backup file name and failure mode? → **`<db path>.pre-v24.bak` via `VACUUM INTO`, taken before `BEGIN` on existing DBs only, skipped when present, FATAL on throw (spec §10.2).**
- **B2** — Where does `db.mjs` learn its own file path? → **`PRAGMA database_list` → the `main` row's `file` (empty for `:memory:`, which skips the backup) — `dbPath()` is not used because `migrate(db)` is handed a handle, not a home (planner default).**
- **B3** — Report shape in `store_meta('migration:v24')`? → **`{at, archived[], seeded[], seedsSkipped[], overlayNodes, overlayWires, aliasRemapped, activeReset[], sweptRuns[]}`, written with `INSERT OR IGNORE` under kind `'migration'` (planner default; the spec fixes only the key and that it is a JSON report).**
- **B4** — Sweep predicate for a malformed resume point? → **`json_valid(resume_point) = 0 OR json_extract(...,'$.version') != 2` — the spec's `!= 2` plus a `json_valid` guard so a corrupt blob is swept instead of throwing inside the migration transaction (planner default).**
- **B5** — Do legacy fs-imported templates get archived? → **Yes: `maybeMigrateFromFs` runs after `migrate()`, so `getDb()` calls `reconcileAfterFsImport(db)` (archive-only, no seeding) right after it (agent adjudication adj-e §2).**
- **B6** — Fate of the v1 `DEFAULT_WORKFLOW` constant? → **Renamed `LEGACY_DEFAULT_WORKFLOW` in P8a (its only readers are the two v1 suites), deleted in P8b; `GRAPH_DEFAULT_WORKFLOW` is what `readWorkflow('wf_default')` and `GET /api/workflows` serve (planner default over adj-a §5's "kept for audit").**
- **B7** — v1 `POST /api/workflows` rejection body? → **400 `{ error: 'v1 pipeline templates are no longer accepted — save a graph (version 2)' }` (planner default; the spec fixes only "rejects v1").**
- **B8** — Is `writeWorkflow` (the v1 writer) deleted? → **No — it is not on the spec's §11 kill list and four suites still call it; P8a removes its last production caller and the `v1-remnants-removed` guard pins that no `src/`/`ui/` file outside `workflows.mjs` references it (planner default).**
- **B9** — Where does `paintLegacyStrip` live? → **In `ui/public/app.js` next to P6's `paintGraphFor` branch, with a self-contained `legacyChipRows` (adapted from `old:ui/public/app.js:765-800` + `old:run-decor.mjs:361`), and it is the ONE sanctioned reader of the v1 `phase → uiPhase` vocabulary (spec §8).**
- **B10** (amended by the cross-plan pass 2026-08-27: the survivor set also carries `runOpts`, `READ_WRITE_TOOLS`, `IMPLEMENTER_TOOLS` — P3's executor imports them — and `renderPromptArtifact`'s surviving importer is `src/core/graph/orchestrator.mjs`) — What survives in `phases.mjs`? → **The prompt library: `effectiveAllowedTools, ctxFanOut, fanOutDirective, workspaceContextBlock, workspaceFanOutDirective, buildSystemPrompt, resolveAgentBody, RESUME_HEADER, questionsPromptBlock, workspaceWriteTargetsFor, taskHeader, workspaceDiffInstruction, buildClarifyPrompt, implementerBody, genericIoBlock, renderAnswers, runWorkspaceScan` + P3's `siblingsBlock/mockMarkers/diffInstruction` + the re-homed `renderPromptArtifact/renderAttachmentsBlock`; the 12 `run*` builders and `FALLBACK_PROMPTS` die (spec §11 + §5.4).**
- **B11** (amended by the cross-plan pass 2026-08-27: `BOOKEND_EXECUTION_IDS` is P1's export in `src/shared/graph/constants.mjs`, consumed by P6's `run-decor.mjs` + `render.mjs` from the start — this plan verifies, it does not add) — How do bookends reach the CLI and the decor? → **As ordinary `exec` rows with `executionId` `x:preflight:1` / `x:done:1`, `agentKey: null`; `run-decor.mjs` exports `BOOKEND_EXECUTION_IDS` and filters them out of progress/executions, and `src/cli/render.mjs#formatExecLine` returns null for them (spec §5.7; the ids are the spec's, the export name is a planner default).**
- **B12** — Where do the shared graph keyframes and `.nstat`/`.fan` rules live after the v1 CSS block dies? → **De-scoped out of `.run-flow` into a `/* Run-graph shared decor */` block so they apply on the Running card AND on `.rd-graph`/`.hd-graph` (planner default; spec §8 only says "re-homed").**
- **B13** — `registryToSteps` / `DEFAULT_SPEC` / `LEGACY_LABELS`? → **Kept: `config.mjs#agentSteps` still feeds the legacy per-role editor that `resolveGraph` honours for `wf_default`; only their v1 wiring FIELDS (`consumes/produces/connectsTo/optionalConsumes/uiPhase`) are deleted (planner default over spec §11's blanket "v1 arms").**

## Known issues (Session A, 2026-08-27 — resolve during this plan's refinement, before execution)

Findings recorded while refining P1/P2 and adjudicating the cross-plan contracts. The refinement reports live (untracked) in `docs/superpowers/plans/2026-08-26-node-graph-v2-reports/`; `xplan-manifest.md` §A is the canonical contract sheet, §D the residual list.

- none recorded beyond the cross-plan manifest (see `2026-08-26-node-graph-v2-reports/xplan-manifest.md` §C/§D for this plan).
