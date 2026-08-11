// src/core/db.mjs
// Singleton SQLite database for all of Worca CC's structured state. Uses the
// built-in, SYNCHRONOUS node:sqlite (DatabaseSync) — matching the existing
// synchronous worcaHome()/getWorcaRoot() resolution, so no async refactor is
// needed anywhere. The DB lives at <worcaHome>/worca-cc.db (WAL), resolved fresh
// on first open via projects.mjs#worcaHome() (WORCA_HOME env > settings.json
// root > OS home), exactly like every other module's data path.
//
// node:sqlite is loaded LAZILY (synchronous createRequire, like preflight-node.mjs)
// inside databaseSyncCtor() rather than via a top-level `import`. A top-level import
// is linked when the whole static ESM graph links — BEFORE any entry-point statement
// runs — so node:sqlite's one-time ExperimentalWarning would fire before the entry
// points (src/cli/worca-cc.mjs, ui/server.mjs) install their `process.on('warning')`
// filter, leaking the warning on flagless direct-bin runs. Deferring the load to the
// first getDb() (which only happens at runtime, after the filter is installed) lets
// the filter suppress it. createRequire keeps the load SYNCHRONOUS — `await import`
// would make getDb() async and break the synchronous data layer.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { worcaHome } from './projects.mjs';
import { maybeMigrateFromFs } from './migrate-fs-to-db.mjs';
import { SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP } from './graph/seed-templates.mjs';

const _require = createRequire(import.meta.url);
let _DatabaseSync; // cached node:sqlite DatabaseSync ctor (lazy-loaded once)

/**
 * Lazily and SYNCHRONOUSLY resolve the node:sqlite DatabaseSync constructor. The
 * load is deferred out of module-link time (see header) so the entry points can
 * install their ExperimentalWarning filter first; node:sqlite is a builtin so
 * createRequire resolves it synchronously even from this ESM module.
 * @returns {typeof import('node:sqlite').DatabaseSync}
 */
function databaseSyncCtor() {
  if (!_DatabaseSync) ({ DatabaseSync: _DatabaseSync } = _require('node:sqlite'));
  return _DatabaseSync;
}

let _db = null; // the singleton handle, or null when closed/never-opened
let _txDepth = 0; // guards against re-entrant tx(): node:sqlite has no nested BEGIN
let _stmtCache = new Map(); // sql text -> cached StatementSync (per open handle)

/** WAL busy-timeout: wait up to 5s for a competing writer (CLI + UI). */
const BUSY_TIMEOUT_MS = 5000;

/** First-launch open retries (spec §8): a competing process can make the journal_mode=
 *  WAL switch or the schema migration return SQLITE_BUSY that the busy-handler will not
 *  itself retry. Bounded retry with a short synchronous backoff covers it. */
const OPEN_RETRY_LIMIT = 100;
const OPEN_BACKOFF_MS = 15;

/** Latest schema version. Bump + append a new migration step when the DDL grows. */
const SCHEMA_VERSION = 18;

/** Absolute path to the database file: <worcaHome>/worca-cc.db. */
export function dbPath() {
  return join(worcaHome(), 'worca-cc.db');
}

/**
 * Open (lazily) and return the singleton DatabaseSync. First open creates
 * <worcaHome> if needed and opens the file. (Pragmas + migrate + fs→db hook are
 * layered on in later tasks of this phase.)
 * @returns {DatabaseSync}
 */
export function getDb() {
  if (_db) return _db;
  const home = worcaHome();
  mkdirSync(home, { recursive: true }); // chicken/egg: ensure the dir before open
  const db = _openConfiguredMigrated();  // open + pragmas + migrate, retried on BUSY
  maybeMigrateFromFs(db);    // one-shot fs→db import (other phase; self-guarded)
  _db = db;                  // publish only after the DB is fully ready
  return _db;
}

/**
 * Open the DB file, apply pragmas, and migrate — retrying the whole sequence on a
 * transient SQLITE_BUSY / "database is locked". First launch can race a second process
 * (CLI + UI, spec §8): the journal_mode=WAL header switch and the schema migration each
 * need a brief exclusive lock, and the WAL-mode switch in particular returns BUSY that
 * the busy-handler does NOT retry. A bounded synchronous retry makes concurrent first
 * launch deterministic. node:sqlite is sync, so the backoff blocks this thread inline.
 */
function _openConfiguredMigrated() {
  for (let attempt = 0; ; attempt++) {
    let db = null;
    try {
      db = new (databaseSyncCtor())(dbPath());
      _configure(db);
      migrate(db);
      return db;
    } catch (err) {
      try { if (db) db.close(); } catch { /* ignore close error during recovery */ }
      if (_isBusyError(err) && attempt < OPEN_RETRY_LIMIT) { _sleepMs(OPEN_BACKOFF_MS); continue; }
      throw err;
    }
  }
}

/**
 * True when err is a transient SQLite lock/busy that retrying can clear. Prefers the
 * structured errcode (5 = SQLITE_BUSY, 6 = SQLITE_LOCKED) and falls back to the message
 * so a lock is still caught on any node:sqlite build that doesn't populate errcode. A
 * false positive only costs a bounded retry that still re-throws the original error.
 */
function _isBusyError(err) {
  if (err && (err.errcode === 5 || err.errcode === 6)) return true;
  const msg = err && err.message ? err.message : String(err);
  return /locked|busy/i.test(msg);
}

/** Synchronous sleep (node:sqlite is sync; we must block this thread, not yield it). */
function _sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Apply the connection pragmas exactly once on open. journal_mode=WAL is durable
 * (sticks to the file); foreign_keys/busy_timeout/synchronous are per-connection
 * and must be re-applied every open. Done via exec() in one batch.
 */
function _configure(db) {
  // busy_timeout is set FIRST so the busy-handler is armed before the first contended
  // operation. NOTE: this only REDUCES (does not eliminate) the journal_mode=WAL switch
  // race — SQLite does not run the busy-handler for the WAL-mode switch, so a colliding
  // first-launch process can still get "database is locked" here. The actual backstop is
  // the open-retry loop in _openConfiguredMigrated(); do NOT remove it on the assumption
  // that pragma ordering alone suffices.
  db.exec(`
    PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);
}

/**
 * The FULL, FINAL v1 schema (SQLITE-MIGRATION-SPEC §3). Applied in one transaction
 * by migrate(). All "JSON" columns are TEXT holding a JSON string (SQLite has no
 * JSON type); the owning service modules (de)serialize at their API boundary.
 * COLLATE NOCASE is applied where the spec requires case-insensitive uniqueness
 * (projects.name, workspaces.name), matching the existing duplicate checks.
 */
const SCHEMA_V1 = `
-- projects: the named project registry (was projects.json: [{name,path}]).
-- key is the stable projectKey (store.mjs). name is case-insensitively unique.
CREATE TABLE projects (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL COLLATE NOCASE,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_projects_name ON projects (name COLLATE NOCASE);

-- workspaces: named sets of 2+ projects (was workspaces.json header fields).
-- id is the frozen workspaceKey (wks-<slug>-<sha1[:8]>). name is CI-unique.
CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_workspaces_name ON workspaces (name COLLATE NOCASE);

-- workspace_projects: the ordered projectPaths[] of a workspace (was the array).
-- ordinal preserves the PERSISTED member order; (workspace_id, ordinal) is the PK.
-- project_key holds the ABSOLUTE member PATH (ordinal-ordered), NOT a key (A1);
-- the real projectKey is recomputed on read via store.projectKey(path) (one-way
-- hash). projectKeys/exists are derived on read (not stored), per
-- workspaces.mjs#annotate.
CREATE TABLE workspace_projects (
  workspace_id TEXT NOT NULL,
  project_key  TEXT NOT NULL,
  ordinal      INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, ordinal),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);

-- workflows: user workflow templates (was workflows/<id>.json). DEFAULT_WORKFLOW
-- stays built-in (not a row). steps/feedbacks are JSON (topology arrays).
CREATE TABLE workflows (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  steps      TEXT NOT NULL DEFAULT '[]',  -- JSON: [[ {id,key} ]]
  feedbacks  TEXT NOT NULL DEFAULT '[]',  -- JSON: [ {id,from,to} ]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- project_config: per-project model/effort selection (was <projectDir>/.worca-cc/
-- config.json). steps/custom_models are JSON (the legacy {steps,customModels}
-- view). active_workflow_id remembers the last New-Pipeline choice. extra is JSON
-- preserving unknown top-level keys (e.g. webUiTesting).
CREATE TABLE project_config (
  project_key        TEXT PRIMARY KEY,
  steps              TEXT NOT NULL DEFAULT '{}',  -- JSON: { role: {model?,effort?,fanOut?} }
  custom_models      TEXT NOT NULL DEFAULT '[]',  -- JSON: [ {id,label} ]
  active_workflow_id TEXT,
  extra              TEXT NOT NULL DEFAULT '{}'   -- JSON: unknown top-level keys
);

-- config_workflow_nodes: normalized per-node overrides (was config.json
-- workflows[wf].nodes[nodeId] = {model?,effort?,fanOut?}). One row per node.
CREATE TABLE config_workflow_nodes (
  project_key TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  model       TEXT,
  effort      TEXT,
  fan_out     INTEGER,  -- nullable boolean (0/1); NULL = inherit
  PRIMARY KEY (project_key, workflow_id, node_id)
);

-- config_workflow_feedbacks: normalized feedback cycle counts (was config.json
-- workflows[wf].feedbacks[fbId] = {maxCycles}). max_cycles is an integer >= 1.
CREATE TABLE config_workflow_feedbacks (
  project_key TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  fb_id       TEXT NOT NULL,
  max_cycles  INTEGER NOT NULL,
  PRIMARY KEY (project_key, workflow_id, fb_id)
);

-- pipelines: one run = one row (was state.json, scalar fields). workspace_key is
-- the composite "workspaces/<key>" tag for workspace runs (NULL for single-project).
-- target is 'project' | 'workspace'. date_prefix/base_name link plan/review md
-- files (pipeline-delete.mjs#deriveNames). branch/workspace_meta/stepper/tools are
-- JSON (objects/manifests). prompt is the resolved prompt body.
CREATE TABLE pipelines (
  id              TEXT PRIMARY KEY,
  project_key     TEXT NOT NULL,
  workspace_key   TEXT,
  target          TEXT NOT NULL DEFAULT 'project',
  title           TEXT,
  base_name       TEXT,
  date_prefix     TEXT,
  status          TEXT NOT NULL DEFAULT 'created',
  phase           TEXT NOT NULL DEFAULT 'created',
  cycle           INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT,
  updated_at      TEXT,
  total_cost_usd  REAL NOT NULL DEFAULT 0,
  total_active_ms INTEGER NOT NULL DEFAULT 0,
  prompt          TEXT,
  branch          TEXT,  -- JSON: { source, feature, worktreeDir, reusedExisting, ... }
  workspace_meta  TEXT,  -- JSON: { workspaceId, workspaceName, projectKeys, projects[], checkpointRefs, branches, workspaceDescription }
  stepper         TEXT,  -- JSON: buildGraphManifest() snapshot (v2 run manifest)
  tools           TEXT   -- JSON: detectTools()/resolved tool descriptor
  -- resume_point TEXT (added v5): JSON dispatch position of a paused run (NULL otherwise)
  -- outcome TEXT (added v18): JSON { endReached, result, warnings } — the run's
  --   Amendment-f outcome, which History renders as the End result card + banner
);
CREATE INDEX idx_pipelines_project_started   ON pipelines (project_key, started_at);
CREATE INDEX idx_pipelines_workspace_started ON pipelines (workspace_key, started_at);
CREATE INDEX idx_pipelines_status            ON pipelines (status);

-- pipeline_steps: one row per state.steps[] entry (orchestrator _execStep/
-- _recordStep). key is the stable step key "<stepIndex>:<nodeId>[#cycle]".
-- running_since is the resume timestamp (null when paused); active_ms accumulates.
CREATE TABLE pipeline_steps (
  pipeline_id   TEXT NOT NULL,
  key           TEXT NOT NULL,
  node_id       TEXT,
  phase         TEXT,
  step_index    INTEGER,
  cycle         INTEGER,
  status        TEXT,
  started_at    TEXT,
  updated_at    TEXT,
  active_ms     INTEGER NOT NULL DEFAULT 0,
  running_since TEXT,
  cost_usd      REAL NOT NULL DEFAULT 0,
  -- session_id TEXT (added v5): Claude Code session id from the stream-json init event
  -- exec_result / exec_trigger TEXT (added v18): JSON — the execution's bound End
  --   payload and its firing trigger, so a frozen run's ledger keeps its result
  --   card anchor and its "cycle 2 · fix" row labels
  PRIMARY KEY (pipeline_id, key),
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);

-- pipeline_events: append-only audit trail (was pipeline.md timeline lines, one
-- "- \`<ISO ts>\` <text>" per appendAudit call). id AUTOINCREMENT preserves order.
CREATE TABLE pipeline_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id TEXT NOT NULL,
  ts          TEXT NOT NULL,
  text        TEXT NOT NULL,
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);
CREATE INDEX idx_pipeline_events_pipeline ON pipeline_events (pipeline_id, id);

-- clarify: one row per pipeline (was clarify.json + clarify-answers.json).
-- questions/answers are JSON ({questions:[...]} / {answers:[...]} payloads).
CREATE TABLE clarify (
  pipeline_id TEXT PRIMARY KEY,
  questions   TEXT,  -- JSON: { questions: [ {id,question,options[2..4],allowFreeText} ] }
  answers     TEXT,  -- JSON: { answers: [ {id,question,choice} ] }
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);

-- reviews: per-cycle review verdicts (was *-review-cycleN.json). kind is one of
-- refine|impl|plan|ws|webui (5-value open set, A2); verdict is JSON {issues:[...],summary}.
CREATE TABLE reviews (
  pipeline_id TEXT NOT NULL,
  kind        TEXT NOT NULL,
  cycle       INTEGER NOT NULL,
  verdict     TEXT,  -- JSON: { issues:[{severity,title,detail,location}], summary }
  PRIMARY KEY (pipeline_id, kind, cycle),
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);

-- store_meta: per-project / per-workspace meta.json (artifacts.mjs ensureMeta/
-- ensureWorkspaceMeta). key is the store key; kind is 'project' | 'workspace';
-- data is the full meta JSON ({key,path,name,firstSeenAt} or the workspace shape).
CREATE TABLE store_meta (
  key  TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT NOT NULL  -- JSON: the meta.json object
);

-- artifacts: NEW index of the FS markdown + extras paths kept on disk after the
-- migration. kind is e.g. plan|review|manual-checklist|webui-review|extra; rel_path
-- is relative to the pipeline/store dir. Replaces baseName-derivation in
-- pipeline-delete.mjs with an exact lookup.
CREATE TABLE artifacts (
  pipeline_id TEXT NOT NULL,
  kind        TEXT NOT NULL,
  rel_path    TEXT NOT NULL,
  PRIMARY KEY (pipeline_id, kind, rel_path),
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);
`;

/**
 * Incremental v1 -> v2 migration (sub-agent indicators feature). Adds the sub_agents
 * table: one row per Task/Agent child agent a pipeline node spawned, persisted so the
 * History UI reconstructs the live "sub-agents" view. Applied by migrate()'s stepwise
 * ladder only when the open DB is below v2 — it NEVER re-runs SCHEMA_V1.
 *
 * FK is to pipelines(id) ONLY (NOT pipeline_steps): writeState() does a DELETE-all +
 * re-INSERT of pipeline_steps on every persist, so a FK to pipeline_steps would
 * cascade-wipe these rows on the next state write. step_key is therefore a plain
 * column (the "<stepIndex>:<nodeId>[#cycle]" key) used for grouping, not a foreign key.
 * Writes are idempotent UPSERTs (upsertSubAgent), never the delete-all path.
 */
const SCHEMA_V2 = `
-- sub_agents: one row per Task/Agent child agent a node spawned (canonical key is the
-- spawning tool_use id). PK (pipeline_id, id); FK to pipelines ONLY (ON DELETE CASCADE).
-- status ∈ running|finished|error|stopped. duration_ms/tokens/cost_usd are nullable
-- telemetry (populated only by the feature-detected hook-events path). step_key is a
-- plain grouping column (NO FK — survives writeState's pipeline_steps delete-all).
CREATE TABLE sub_agents (
  pipeline_id  TEXT NOT NULL,
  id           TEXT NOT NULL,
  step_key     TEXT,
  node_id      TEXT,
  step_index   INTEGER,
  cycle        INTEGER,
  label        TEXT,
  status       TEXT NOT NULL DEFAULT 'running',
  started_at   TEXT,
  finished_at  TEXT,
  duration_ms  INTEGER,
  tokens       INTEGER,
  cost_usd     REAL,
  PRIMARY KEY (pipeline_id, id),
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);
CREATE INDEX idx_sub_agents_pipeline ON sub_agents (pipeline_id);
CREATE INDEX idx_sub_agents_step     ON sub_agents (pipeline_id, step_key);
`;

/**
 * Incremental v2 -> v3 migration. Adds sub_agents.ui_phase: the node's UI phase
 * (plan|refine|implement|review), stamped at spawn. Lets the live/history views
 * resolve a sub-agent to its graph node + dropdown label by uiPhase as a FALLBACK
 * when the run's real (s0_0-keyed) stepper manifest has not arrived yet. Nullable;
 * legacy rows derive their phase from node_id via the manifest at render time.
 */
const SCHEMA_V3 = `ALTER TABLE sub_agents ADD COLUMN ui_phase TEXT;`;

/**
 * Incremental v3 -> v4 migration (Decomposer feature). Adds two tables recording a
 * run's decomposition: pipeline_phases (ordered phases) and pipeline_tasks (the
 * self-contained task files, each linked to its dynamically-created implementer
 * node via node_id). Both FK to pipelines ONLY (ON DELETE CASCADE) and are written
 * via idempotent UPSERTs — NEVER the writeState delete-all path — so task/phase
 * status survives the pipeline_steps refresh, exactly like sub_agents.
 */
const SCHEMA_V4 = `
CREATE TABLE pipeline_phases (
  pipeline_id TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|error
  started_at  TEXT,
  finished_at TEXT,
  PRIMARY KEY (pipeline_id, ordinal),
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);

CREATE TABLE pipeline_tasks (
  pipeline_id   TEXT NOT NULL,
  id            TEXT NOT NULL,
  phase_ordinal INTEGER NOT NULL,
  task_index    INTEGER NOT NULL,
  title         TEXT,
  file_rel_path TEXT,
  node_id       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|error
  started_at    TEXT,
  finished_at   TEXT,
  PRIMARY KEY (pipeline_id, id),
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);
CREATE INDEX idx_pipeline_tasks_pipeline ON pipeline_tasks (pipeline_id);
`;

/**
 * Incremental v4 -> v5 migration (Pause/Resume feature). resume_point holds the
 * serialized dispatch position of a paused run (null otherwise); session_id is the
 * Claude Code session captured from the stream-json init event, recorded eagerly so
 * even a crashed run leaves a resumable trail.
 */
const SCHEMA_V5 = `
ALTER TABLE pipelines ADD COLUMN resume_point TEXT;
ALTER TABLE pipeline_steps ADD COLUMN session_id TEXT;
`;

/**
 * Incremental v5 -> v6 migration (Skills-used indicator). Adds a nullable JSON
 * `skills` column to BOTH agent tables: sub_agents (per sub-agent) and
 * pipeline_steps (per main step agent). Each holds JSON.stringify of a deduped
 * string[] of kind-tagged labels; legacy rows stay NULL and render as no pills.
 * pipeline_steps is delete-all-rewritten on every persist, so its skills live on
 * the live state.steps[] record — like cost_usd.
 *
 * The labels are OPAQUE strings to this layer, which is why §7's per-tool
 * granularity needed no migration: three-part "mcp:<server>:<tool>" tags, the
 * legacy two-part "mcp:<server>" rows written before it, "skill:<slug>", and the
 * §7.1 "overflow:<n>" cap sentinel all coexist inside this one column.
 */
const SCHEMA_V6 = `
ALTER TABLE sub_agents ADD COLUMN skills TEXT;
ALTER TABLE pipeline_steps ADD COLUMN skills TEXT;
`;

/**
 * Incremental v6 -> v7 migration (Sub-agent type pill). Adds a nullable
 * `subagent_type` column to sub_agents holding the raw Task/Agent subagent_type
 * (e.g. 'general-purpose', 'Explore', 'worca-cc-planner'). Legacy rows stay NULL
 * and render with no type pill — exactly like the v6 skills column.
 */
const SCHEMA_V7 = `
ALTER TABLE sub_agents ADD COLUMN subagent_type TEXT;
`;

/**
 * Incremental v7 -> v8 migration (graphify-usage counter). Adds a nullable INTEGER
 * `graphify_count` to BOTH agent tables — pipeline_steps (per MAIN agent) and
 * sub_agents (per sub-agent) — holding how many times that agent invoked the
 * graphify CLI via Bash. Legacy rows stay NULL and render no count, exactly like
 * the v6 skills / v7 subagent_type columns.
 */
const SCHEMA_V8 = `
ALTER TABLE sub_agents ADD COLUMN graphify_count INTEGER;
ALTER TABLE pipeline_steps ADD COLUMN graphify_count INTEGER;
`;

/**
 * Incremental v8 -> v9 migration (domain tag for workflows). Adds a nullable TEXT
 * `domain` to the workflows table so the picker can group/filter by domain
 * (coding, marketing, financing, …). Legacy rows stay NULL and read back as
 * 'general' via the store layer's COALESCE — organizational only, no enforcement.
 */
const SCHEMA_V9 = `
ALTER TABLE workflows ADD COLUMN domain TEXT;
`;

/**
 * Incremental v9 -> v10 migration (crash-recovery liveness). Adds three nullable
 * columns to pipelines so the startup sweep can tell a crashed run from a live one
 * by owner identity + heartbeat, not just row age:
 *   owner_pid    INTEGER  — process.pid of the process currently driving the run
 *   owner_host   TEXT     — os.hostname() of that process (pid is only meaningful per host)
 *   heartbeat_at TEXT     — ISO ts refreshed every ~30s while running/pausing
 * All NULL on legacy rows → treated as "unknown owner": swept only by the existing
 * time arm, never PID-probed.
 */
const SCHEMA_V10 = `
ALTER TABLE pipelines ADD COLUMN owner_pid    INTEGER;
ALTER TABLE pipelines ADD COLUMN owner_host   TEXT;
ALTER TABLE pipelines ADD COLUMN heartbeat_at TEXT;
`;

/**
 * Incremental v10 -> v11 migration (per-agent user questions, spec 2026-07-11).
 * ask_questions: nullable boolean per-node override (NULL = inherit the
 * manifest default). step_questions: one row per (pipeline, step, round) of the
 * ask-then-resume gate — mirrors the clarify table, keyed by the step record's
 * stable "<stepIndex>:<nodeId>[#cycle]" key plus the round number. node_id is
 * denormalized so prior answers can be re-injected per node without parsing
 * step_key.
 */
const STEP_QUESTIONS_DDL = `
CREATE TABLE IF NOT EXISTS step_questions (
  pipeline_id TEXT NOT NULL,
  step_key    TEXT NOT NULL,
  round       INTEGER NOT NULL,
  node_id     TEXT,
  agent_key   TEXT,
  questions   TEXT,  -- JSON: { questions: [ {id,question,options[2..4],allowFreeText} ] }
  answers     TEXT,  -- JSON: { answers: [ {id,question,choice} ] }
  PRIMARY KEY (pipeline_id, step_key, round),
  FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE
);
`;

const GUARDRAIL_SETS_DDL = `
CREATE TABLE IF NOT EXISTS guardrail_sets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  settings   TEXT NOT NULL DEFAULT '{}',  -- JSON: the 5-key guardrails shape (sanitizeGuardrails on read)
  origin     TEXT,                        -- 'plugin:<name>' provenance; NULL = user-created; built-ins are never rows
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** v15: append-only spend ledger. NO foreign key on pipeline_id: spend is a
 *  permanent financial fact and must survive any row surgery. */
const COST_LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS cost_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id TEXT NOT NULL,
  step_key    TEXT,
  amount_usd  REAL NOT NULL,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_ts ON cost_ledger (ts);
`;

/** v17: per-WIRE loop budgets, the graph engine's replacement for
 *  config_workflow_feedbacks (which becomes unread legacy). Keyed by v2 wire id;
 *  no foreign key, exactly like the feedbacks table it succeeds — a template can
 *  be re-seeded or deleted without dropping a project's overlays on the floor. */
const CONFIG_WORKFLOW_WIRES_DDL = `
CREATE TABLE IF NOT EXISTS config_workflow_wires (
  workflow_id TEXT,
  project_key TEXT,
  wire_id     TEXT,
  max_cycles  INTEGER,
  PRIMARY KEY (workflow_id, project_key, wire_id)
);
`;

const SCHEMA_V11 = `
ALTER TABLE config_workflow_nodes ADD COLUMN ask_questions INTEGER;
${STEP_QUESTIONS_DDL}
`;

/**
 * Every column ever added by an incremental ALTER step, per table. The version
 * ladder alone cannot be trusted for these: one shared ~/.worca-cc DB serves every
 * checkout, and a DIVERGENT ladder can stamp user_version past a step this build
 * needs (it happened twice: branch ai-enablement-onboarding minted its own v11 as
 * a data-only workflow seed and stamped a clean-v10 DB to 11, so this branch's
 * v11 DDL was skipped forever → "no such column: ask_questions"; earlier the same
 * collision class produced "no column named domain"). schemaGaps() diffs this map
 * against the live schema so the gap can be healed regardless of the stamp.
 */
const INCREMENTAL_COLUMNS = {
  pipelines:              { resume_point: 'TEXT', owner_pid: 'INTEGER', owner_host: 'TEXT', heartbeat_at: 'TEXT',
                            source_type: "TEXT DEFAULT 'prompt'", source_ref: 'TEXT', guardrails_id: 'TEXT',
                            archived_at: 'TEXT', cost_cap_override: 'INTEGER NOT NULL DEFAULT 0',
                            pr_url: 'TEXT', pr_number: 'INTEGER', pr_state: 'TEXT', pr_checked_at: 'TEXT',
                            outcome: 'TEXT' },
  pipeline_steps:         { session_id: 'TEXT', skills: 'TEXT', graphify_count: 'INTEGER',
                            execution_id: 'TEXT', exec_result: 'TEXT', exec_trigger: 'TEXT' },
  sub_agents:             { ui_phase: 'TEXT', skills: 'TEXT', subagent_type: 'TEXT', graphify_count: 'INTEGER' },
  workflows:              { domain: 'TEXT', origin: 'TEXT', graph: 'TEXT' },
  config_workflow_nodes:  { ask_questions: 'INTEGER' },
};

/**
 * Return [{table, col, type}] for every INCREMENTAL_COLUMNS entry absent from the
 * live schema, plus `stepQuestionsTable`/`guardrailSetsTable`/`costLedgerTable`/
 * `workflowWiresTable: true` flags when those IF-NOT-EXISTS tables are missing
 * (safe to reassert on any stamped DB). A new flag needs FOUR coordinated edits:
 * its DDL const, the probe here, the repairSchemaGaps arm, and reconcileSchema's
 * clean check — miss the last and the fast path never heals it.
 * Cheap and read-only: one PRAGMA table_info per known table + one sqlite_master
 * probe each, no writes. A table absent from INCREMENTAL_COLUMNS' map (table_info
 * returns []) is skipped — creating base tables is the version ladder's job.
 */
function schemaGaps(db) {
  const missing = [];
  for (const [table, cols] of Object.entries(INCREMENTAL_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    if (have.size === 0) continue; // base table absent entirely — not our repair
    for (const [col, type] of Object.entries(cols)) {
      if (!have.has(col)) missing.push({ table, col, type });
    }
  }
  const hasStepQuestions = db.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='step_questions'"
  ).get().n > 0;
  const hasGuardrailSets = db.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='guardrail_sets'"
  ).get().n > 0;
  const hasCostLedger = db.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='cost_ledger'"
  ).get().n > 0;
  const hasWorkflowWires = db.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='config_workflow_wires'"
  ).get().n > 0;
  return {
    columns: missing,
    stepQuestionsTable: !hasStepQuestions,
    guardrailSetsTable: !hasGuardrailSets,
    costLedgerTable: !hasCostLedger,
    workflowWiresTable: !hasWorkflowWires,
  };
}

/** Apply the gap repairs with NO transaction control of its own — the caller owns
 *  the transaction (the ladder tx in migrate(), or reconcileSchema's own lock). */
function repairSchemaGaps(db, gaps) {
  for (const { table, col, type } of gaps.columns) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  if (gaps.stepQuestionsTable) db.exec(STEP_QUESTIONS_DDL);
  if (gaps.guardrailSetsTable) db.exec(GUARDRAIL_SETS_DDL);
  if (gaps.costLedgerTable) db.exec(COST_LEDGER_DDL);
  if (gaps.workflowWiresTable) db.exec(CONFIG_WORKFLOW_WIRES_DDL);
}

/**
 * Version-independent self-heal for a DB whose user_version is already >=
 * SCHEMA_VERSION (so the version ladder no-ops) but is missing an incremental
 * column/table because a divergent ladder stamped it (see INCREMENTAL_COLUMNS).
 * Reads first and returns WITHOUT taking a lock when nothing is missing — the
 * common every-open case, so a healthy DB sees no contention. When repairs are
 * needed it takes the write lock (BEGIN IMMEDIATE) and RE-CHECKS under the lock,
 * so a colliding process that already repaired is a no-op, not a duplicate-column
 * error.
 * @param {DatabaseSync} db
 */
function reconcileSchema(db) {
  const gaps = schemaGaps(db);
  if (gaps.columns.length === 0 && !gaps.stepQuestionsTable && !gaps.guardrailSetsTable
      && !gaps.costLedgerTable && !gaps.workflowWiresTable) return; // clean — no lock
  db.exec('BEGIN IMMEDIATE');
  try {
    repairSchemaGaps(db, schemaGaps(db)); // re-probe under the lock: race-safe
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Incremental v11 -> v12 REPAIR migration for the collision documented on
 * INCREMENTAL_COLUMNS: DBs stamped 11 by the ai-enablement-onboarding branch's
 * data-only ladder carry a clean v10 schema, so this re-applies the v11 DDL
 * conditionally and corrects the stamp. No-op on a correct v11 DB and on the
 * fresh path (where SCHEMA_V11 just ran in the same transaction). Future
 * collisions of the same class are caught version-independently by
 * reconcileSchema() on migrate()'s fast path.
 */
function applySchemaV12(db) {
  repairSchemaGaps(db, schemaGaps(db));
}

/**
 * Incremental v12 -> v13 migration (plugin task-sources, spec 2026-07-12 §10):
 *   pipelines.source_type TEXT DEFAULT 'prompt'  -- 'prompt' | 'markdown' | 'plugin'
 *   pipelines.source_ref  TEXT                   -- JSON {plugin,sourceId,taskId,url,title}; NULL unless plugin
 *   workflows.origin      TEXT                   -- 'plugin:<name>' provenance; NULL = user-created
 * Implemented as a CONDITIONAL repair (same shape as applySchemaV12), NOT a plain
 * DDL string: the three columns live in INCREMENTAL_COLUMNS (hard rule above), so
 * on any ladder pass from <12 applySchemaV12's version-independent heal has ALREADY
 * added them — an unconditional ALTER here would then throw "duplicate column" on
 * every fresh DB. repairSchemaGaps re-probes under the ladder's transaction and
 * adds only what is missing, which also self-heals divergent cross-branch stamps.
 */
function applySchemaV13(db) {
  repairSchemaGaps(db, schemaGaps(db));
}

/**
 * Incremental v13 -> v14 migration (guardrails-entity spec 2026-08-02, per-run model):
 *   guardrail_sets table            -- named guardrail sets (built-ins are virtual, never rows)
 *   pipelines.guardrails_id TEXT    -- the run's selected set id; NULL = legacy/pre-entity row
 * A CONDITIONAL repair like applySchemaV12/13, NOT plain DDL: the column lives in
 * INCREMENTAL_COLUMNS and the table in the schemaGaps flags, so earlier heals on a
 * ladder pass from <12 have ALREADY added them — an unconditional ALTER/CREATE
 * would throw "duplicate column"/"table already exists" on every fresh DB.
 */
function applySchemaV14(db) {
  repairSchemaGaps(db, schemaGaps(db));
}

/**
 * v14 -> v15 (cost limits + archive + PR persistence, spec 2026-08-07):
 *   cost_ledger table; pipelines archived_at / cost_cap_override / pr_url /
 *   pr_number / pr_state / pr_checked_at. CONDITIONAL repair like v12-v14 —
 *   the columns live in INCREMENTAL_COLUMNS and the table in the schemaGaps
 *   flags, so earlier self-heals may already have applied them.
 */
function applySchemaV15(db) {
  repairSchemaGaps(db, schemaGaps(db));
}

/**
 * v15 -> v16 (spend-ledger backfill): v15 created cost_ledger EMPTY and only the
 * live orchestrator writes it, so every pre-upgrade run reads $0 in windowed
 * spend (stats week/month, sidebar budget) while History shows its
 * pipelines.total_cost_usd. Insert ONE synthetic row per costed pipeline that
 * has NO ledger rows at all (a live-recorded run's total again would double-
 * count), amount = the same fallback-aware figure the all-time sums use (row
 * total, else step sum), ts = the run's start (cohort semantics — the money
 * lands in the same week/month bucket as the run), step_key NULL. Pipelines
 * with no parseable timestamp are skipped — they still count in the all-time
 * totals via the pipelines fallback. Gap-repair first, v12-v15 style: a
 * divergent stamp can sit at 15 without the table.
 */
function applySchemaV16(db) {
  repairSchemaGaps(db, schemaGaps(db));
  // A hand-built or divergent DB (minimal test seeds) can reach this step
  // without the cost columns the base DDL has always carried — such a DB never
  // stored a cost, so there is nothing to backfill.
  const has = (table, col) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('pipelines', 'total_cost_usd') || !has('pipeline_steps', 'cost_usd')) return;
  const rows = db.prepare(`
    SELECT p.id,
      CASE WHEN p.total_cost_usd > 0 THEN p.total_cost_usd ELSE COALESCE(s.sc, 0) END AS cost,
      COALESCE(p.started_at, p.updated_at) AS ts_iso
    FROM pipelines p
    LEFT JOIN (SELECT pipeline_id, SUM(cost_usd) sc
               FROM pipeline_steps GROUP BY pipeline_id) s ON s.pipeline_id = p.id
    WHERE NOT EXISTS (SELECT 1 FROM cost_ledger cl WHERE cl.pipeline_id = p.id)
  `).all();
  const ins = db.prepare(
    'INSERT INTO cost_ledger (pipeline_id, step_key, amount_usd, ts) VALUES (?, NULL, ?, ?)');
  for (const r of rows) {
    const ts = Date.parse(r.ts_iso ?? '');
    if (!(r.cost > 0) || !Number.isFinite(ts)) continue;
    ins.run(r.id, r.cost, ts);
  }
}

/** V17's audit trail. The ladder is otherwise silent, but v17 REWRITES and DELETES
 *  user-owned rows, so every mutation names itself. stderr, not stdout: stdout is
 *  the UI's channel. Logging must never be able to break a migration. */
function auditV17(msg) {
  try { console.warn(`[worca] V17: ${msg}`); } catch { /* never let logging itself throw */ }
}

/** Flow cards a loop wire can terminate on instead of its real receiver. */
const V17_VALVE_KINDS = new Set(['and', 'or', 'combine']);

/**
 * The agent node a v2 wire ultimately feeds. The double-loop seeds fan their two
 * blocking wires into an OR valve whose single out-wire carries the payload on to
 * `implementer.fix`, so a v1 feedback's `to` step names the valve's DOWNSTREAM
 * target, never the valve. Null when the chain is ambiguous (a valve with zero or
 * several out-wires) or implausibly deep — the caller then falls back to the map.
 */
function v17WireTarget(graph, kindById, wire) {
  let node = wire.to.node;
  for (let hop = 0; V17_VALVE_KINDS.has(kindById.get(node)); hop++) {
    if (hop > 4) return null;
    const outs = graph.wires.filter((w) => w.from.node === node);
    if (outs.length !== 1) return null;
    node = outs[0].to.node;
  }
  return node;
}

/**
 * Resolve one v1 feedback to its v2 wire id DYNAMICALLY: map its from/to STEP ids
 * through NODE_ID_MAP, then pick the template's UNIQUE maxCycles-bearing wire whose
 * source node and valve-followed target match that pair (a self-loop when the two
 * coincide). Null when nothing matches uniquely. This is what makes the migration
 * self-correcting: the live fb ORDER is only partially observable, but the (from,to)
 * pair a user's overlay rides on is not — so FB_WIRE_MAP is the pinned expectation
 * and this is the authority.
 */
function v17ResolveWireId(graph, nodeMap, fb) {
  const from = nodeMap[fb?.from];
  const to = nodeMap[fb?.to];
  if (!from || !to) return null;
  const kindById = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const hits = graph.wires.filter((w) => w.config?.maxCycles != null
    && w.from.node === from && v17WireTarget(graph, kindById, w) === to);
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * v16 -> v17 (node-graph engine swap, spec §8). Gap-repair first, v12-v16 style —
 * `workflows.graph` / `pipeline_steps.execution_id` live in INCREMENTAL_COLUMNS and
 * `config_workflow_wires` in the schemaGaps flags, so a divergent stamp can sit at
 * 16 with any subset of them already present. Then the DATA work, in order:
 *
 *  1. RE-SEED: every saved template still at version 1 becomes a version-2 row whose
 *     `graph` column is the FULL FLAT template ({id,name,version,domain,createdAt,
 *     nodes,wires}), so the column parses straight back into a validateGraph-ready
 *     object; the row's own id/name/domain columns stay authoritative on read.
 *     `created_at` and `origin` are preserved. Ids ABSENT from the DB are skipped —
 *     only 5 of the 7 exist in the reference DB, and v17 is not a seeder.
 *  2. OVERLAY migration: config_workflow_nodes.node_id rewrites, then the per-loop
 *     budgets move from config_workflow_feedbacks into config_workflow_wires keyed
 *     by the RESOLVED wire id. Both cover the 7 templates AND the wf_default builtin.
 *     Unmapped node rows stay orphaned (resolveGraph ignores unknown node ids) and
 *     config_workflow_feedbacks becomes unread legacy rather than being dropped.
 *  3. DELETE the remaining version-1 rows — after the re-seed those are only the
 *     un-migratable leftovers (e.g. `wfp_*` plugin imports), one audit line each.
 *
 * The feedback topology is SNAPSHOT before step 1 because the re-seed blanks the
 * `feedbacks` column the resolver reads its (from,to) step ids from.
 */
function applySchemaV17(db) {
  repairSchemaGaps(db, schemaGaps(db));
  const hasTable = (name) => db.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(name).n > 0;
  const wfCols = new Set(db.prepare('PRAGMA table_info(workflows)').all().map((c) => c.name));
  // A hand-built or divergent DB (minimal test seeds, v12/v13-era shapes) can reach
  // this step with a workflows table that never carried the v1 topology columns.
  // Such a DB has no saved templates to re-seed, so both row rewrites sit this out.
  const canReseed = ['version', 'graph', 'steps', 'feedbacks', 'updated_at']
    .every((c) => wfCols.has(c));

  const v1Feedbacks = new Map();
  if (canReseed) {
    for (const r of db.prepare('SELECT id, feedbacks FROM workflows WHERE version = 1').all()) {
      try { v1Feedbacks.set(r.id, JSON.parse(r.feedbacks ?? '[]')); } catch { v1Feedbacks.set(r.id, []); }
    }
    const now = new Date().toISOString();
    const reseed = db.prepare(`UPDATE workflows SET version = 2, graph = ?, steps = '[]',
      feedbacks = '[]', updated_at = ? WHERE id = ? AND version = 1`);
    for (const t of SEED_TEMPLATES) {
      if (reseed.run(JSON.stringify(t), now, t.id).changes > 0) {
        auditV17(`re-seeded saved workflow ${t.id} ("${t.name}") as a v2 graph`);
      }
    }
  }

  if (hasTable('config_workflow_nodes')) {
    const rename = db.prepare(
      'UPDATE config_workflow_nodes SET node_id = ? WHERE workflow_id = ? AND node_id = ?');
    for (const [workflowId, map] of Object.entries(NODE_ID_MAP)) {
      for (const [oldId, newId] of Object.entries(map)) rename.run(newId, workflowId, oldId);
    }
  }

  if (hasTable('config_workflow_feedbacks') && hasTable('config_workflow_wires')) {
    const graphs = new Map(SEED_TEMPLATES.map((t) => [t.id, t]));
    const move = db.prepare(`INSERT OR REPLACE INTO config_workflow_wires
      (workflow_id, project_key, wire_id, max_cycles)
      SELECT workflow_id, project_key, ?, max_cycles
      FROM config_workflow_feedbacks WHERE workflow_id = ? AND fb_id = ?`);
    for (const [workflowId, map] of Object.entries(FB_WIRE_MAP)) {
      const graph = graphs.get(workflowId);
      const nodeMap = NODE_ID_MAP[workflowId] ?? {};
      const fbs = v1Feedbacks.get(workflowId);
      for (const [fbId, pinned] of Object.entries(map)) {
        // No row to read the topology from (wf_default is a builtin, and a template
        // the user never saved has no feedbacks): the pinned id IS the answer.
        const fb = Array.isArray(fbs) ? fbs.find((f) => f?.id === fbId) : null;
        const resolved = graph && fb ? v17ResolveWireId(graph, nodeMap, fb) : null;
        let wireId = pinned;
        if (resolved && resolved !== pinned) {
          wireId = resolved; // the resolver wins — the (from,to) pair is the ground truth
          auditV17(`${workflowId}.${fbId} resolves to wire ${resolved} but FB_WIRE_MAP pins ${pinned} — using ${resolved}`);
        } else if (!resolved && fb) {
          auditV17(`${workflowId}.${fbId} (${fb.from} -> ${fb.to}) matched no unique loop wire — using pinned ${pinned}`);
        }
        move.run(wireId, workflowId, fbId);
      }
    }
  }

  if (canReseed) {
    const doomed = db.prepare('SELECT id, name FROM workflows WHERE version = 1').all();
    if (doomed.length > 0) {
      db.exec('DELETE FROM workflows WHERE version = 1');
      for (const r of doomed) auditV17(`deleted un-migratable v1 workflow ${r.id} ("${r.name}")`);
    }
  }

  sweepV1PausedRuns(db);
}

/** The reason stamped on a v1-paused run the graph engine cannot re-enter. */
export const V17_PAUSE_SWEEP_REASON = 'paused before the graph engine rework — not resumable';

/**
 * The startup sweep of runs that paused on the v1 dispatcher. Their resume point
 * describes a step-array position (`version: 1`) the graph engine has no way to
 * re-enter, and `paused` is the ONE status the liveness reconciler never touches —
 * so without this they would sit "resumable" forever and fail at the click.
 * Marking them `interrupted` keeps them visible, deletable and honest, and stamps
 * the reason into the point itself so resume()'s refusal can explain it.
 *
 * Runs inside the V17 ladder step AND again from the UI's boot maintenance
 * (ui/server.mjs), because the ladder fires only for a DB stamped below 17 — a
 * tree whose DB was migrated by another checkout would otherwise never be swept.
 * Idempotent: a v2 point is skipped, and a swept row is no longer `paused`.
 *
 * @param {import('node:sqlite').DatabaseSync} db  an open handle (the migration's
 *        own, mid-transaction; or getDb()'s singleton at boot)
 * @returns {number} how many rows were flipped to `interrupted`
 */
export function sweepV1PausedRuns(db) {
  // A divergent/minimal seed can reach v17 with a pipelines table that never
  // carried `status` or `resume_point` — it has no paused v1 run to sweep either.
  const cols = new Set(db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name));
  if (!cols.has('resume_point') || !cols.has('status')) return 0;
  const rows = db.prepare(
    "SELECT id, resume_point FROM pipelines WHERE status = 'paused' AND resume_point IS NOT NULL").all();
  const mark = db.prepare(
    "UPDATE pipelines SET status = 'interrupted', resume_point = ? WHERE id = ?");
  let swept = 0;
  for (const r of rows) {
    let rp;
    try { rp = JSON.parse(r.resume_point); } catch { rp = null; }
    if (rp && Number(rp.version) === 2) continue;          // already a graph point
    const stamped = { ...(rp && typeof rp === 'object' ? rp : {}), pauseReason: V17_PAUSE_SWEEP_REASON };
    mark.run(JSON.stringify(stamped), r.id);
    auditV17(`run ${r.id}: ${V17_PAUSE_SWEEP_REASON} — marked interrupted`);
    swept += 1;
  }
  return swept;
}

/**
 * v17 -> v18 (Amendment f run outcome): pipelines.outcome holds the run's
 * `{ endReached, result, warnings }` and pipeline_steps.exec_result /
 * exec_trigger hold the per-execution End payload and trigger. Without them the
 * End result card, the quiescence banner and the `cycle 2 · fix` row labels are
 * live-only and vanish from History on reload. A CONDITIONAL repair like
 * v12-v16 — the three columns live in INCREMENTAL_COLUMNS, so a ladder pass
 * from <12 has already added them and an unconditional ALTER would throw
 * "duplicate column". Pre-upgrade rows read back as the pre-Amendment-f
 * defaults (endReached false, no result, no warnings), which is exactly what a
 * v1 run was.
 */
function applySchemaV18(db) {
  repairSchemaGaps(db, schemaGaps(db));
}

/**
 * Idempotent, versioned, CONCURRENCY-SAFE schema migration. Fast-path no-op when
 * PRAGMA user_version already == SCHEMA_VERSION. Otherwise it takes the write lock
 * (BEGIN IMMEDIATE) BEFORE re-reading user_version, so two first-launch migrators cannot
 * both pass the gate and double-apply SCHEMA_V1; the loser waits on busy_timeout, re-
 * checks under the lock, and no-ops. The pending DDL + the user_version stamp commit in
 * one transaction. (The WAL-mode switch itself is made race-safe by getDb's open retry,
 * since the busy-handler does not retry that pragma.) node:sqlite is sync, so this runs
 * inline on the calling thread.
 *
 * NOTE: PRAGMA user_version cannot be parameterized, so the version is inlined as a
 * literal integer (SCHEMA_VERSION is module-controlled, never user input).
 * @param {DatabaseSync} db
 */
export function migrate(db) {
  // Fast path: an already-migrated DB needs no version ladder. It is NOT a full
  // no-op — a DB stamped to this version by a DIVERGENT ladder (second checkout,
  // renumbered step) can still be missing an incremental column/table, so
  // reconcile before returning (lock-free when healthy).
  if (db.prepare('PRAGMA user_version').get().user_version >= SCHEMA_VERSION) {
    reconcileSchema(db);
    return;
  }

  // First launch may have a competing migrator. BEGIN IMMEDIATE takes the write lock
  // up front (a deferred BEGIN would not lock until the first write, letting two
  // migrators both pass the gate and double-apply SCHEMA_V1 → "table projects already
  // exists"). Under the lock we re-read user_version and no-op if the winner stamped it.
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('PRAGMA user_version').get().user_version; // re-check under lock
    if (current >= SCHEMA_VERSION) { db.exec('COMMIT'); reconcileSchema(db); return; }
    if (current < 1) db.exec(SCHEMA_V1);
    if (current < 2) db.exec(SCHEMA_V2);
    if (current < 3) db.exec(SCHEMA_V3);
    if (current < 4) db.exec(SCHEMA_V4);
    if (current < 5) db.exec(SCHEMA_V5);
    if (current < 6) db.exec(SCHEMA_V6);
    if (current < 7) db.exec(SCHEMA_V7);
    if (current < 8) db.exec(SCHEMA_V8);
    if (current < 9) db.exec(SCHEMA_V9);
    if (current < 10) db.exec(SCHEMA_V10);
    if (current < 11) db.exec(SCHEMA_V11);
    if (current < 12) applySchemaV12(db);
    if (current < 13) applySchemaV13(db);
    if (current < 14) applySchemaV14(db);
    if (current < 15) applySchemaV15(db);
    if (current < 16) applySchemaV16(db);
    if (current < 17) applySchemaV17(db);
    if (current < 18) applySchemaV18(db);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Close the singleton handle (no-op when already closed). */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
  _stmtCache = new Map();
  _txDepth = 0;
}

/**
 * Run `fn` inside a single SQLite transaction on the singleton handle. Commits
 * when `fn` returns, rolls back if it throws (re-throwing the original error).
 * Returns whatever `fn` returns. node:sqlite is synchronous, so `fn` must be
 * synchronous too — do all DB work inside it and return a value.
 *
 * Not re-entrant: SQLite has no nested BEGIN, so a tx() inside a tx() throws
 * rather than silently joining (or corrupting) the outer transaction. Compose by
 * passing data between calls, not by nesting.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function tx(fn) {
  if (_txDepth > 0) throw new Error('tx(): a transaction is already active (nested tx is not supported)');
  const db = getDb();
  db.exec('BEGIN');
  _txDepth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    _txDepth = 0;
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } finally { _txDepth = 0; }
    throw err;
  }
}

/**
 * Prepare (and cache) a StatementSync by exact SQL text. Re-preparing the same
 * SQL returns the cached statement — node:sqlite statements are reusable across
 * runs (bind fresh params each .run()/.get()/.all()). The cache is keyed to the
 * current handle and cleared by closeDb()/_resetForTests().
 * @param {string} sql
 * @returns {import('node:sqlite').StatementSync}
 */
export function prepare(sql) {
  const hit = _stmtCache.get(sql);
  if (hit) return hit;
  const stmt = getDb().prepare(sql);
  _stmtCache.set(sql, stmt);
  return stmt;
}

/**
 * TEST-ONLY: drop the cached handle, prepared-statement cache, and transaction
 * guard so the next getDb() reopens against the current WORCA_HOME. Lets each
 * test run on a pristine DB at its own home.
 */
export function _resetForTests() {
  closeDb();
}
