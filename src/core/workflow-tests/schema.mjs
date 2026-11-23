// src/core/workflow-tests/schema.mjs — the workflow-tests DDL (v102–v105), moved out of db.mjs (plans/workflow-tests-part4-plan.md
// P4-Q13: db.mjs is over its size cap). Pure strings, no imports: db.mjs imports this module, never the other way round.

// v102 (plans/workflow-tests-plan.md, #721 workflow part): every save keeps the state it replaced (version_no NULL,
// the last 50 per workflow) and Save version keeps a numbered state (never pruned). Append-only and FK-free like
// ask_cost_ledger, so history outlives a deleted workflows row. `graph` = {nodes, wires, canvas?, codeGraph?}.
export const WORKFLOW_REVISIONS_DDL = `
CREATE TABLE IF NOT EXISTS workflow_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  version_no  INTEGER,
  note        TEXT,
  name        TEXT NOT NULL,
  domain      TEXT,
  graph       TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  parts       TEXT NOT NULL DEFAULT '[]',
  source      TEXT NOT NULL,
  made_by     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_revisions_wf ON workflow_revisions (workflow_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_revisions_version ON workflow_revisions (workflow_id, version_no) WHERE version_no IS NOT NULL;`;

// v103 (plans/workflow-tests-part2-plan.md D31): workflow tests. Examples (+ their files as BLOBs), test runs, tries and
// the tries a run shows (its own and the ones it reused). FK-free like workflow_revisions: a deleted workflow keeps its
// examples, and they come back with a workflow saved again under the same id.
export const WORKFLOW_TESTS_DDL = `
CREATE TABLE IF NOT EXISTS wf_test_examples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  request       TEXT NOT NULL DEFAULT '',
  answers       TEXT NOT NULL DEFAULT '[]',
  otherwise     TEXT NOT NULL DEFAULT 'pick',
  basics        TEXT NOT NULL DEFAULT '{}',
  checks        TEXT NOT NULL DEFAULT '[]',
  tries         INTEGER NOT NULL DEFAULT 3,
  note          TEXT,
  from_pipeline TEXT,
  from_use      TEXT,
  from_verdict  TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_test_examples_wf ON wf_test_examples (workflow_id, id);
CREATE TABLE IF NOT EXISTS wf_test_example_files (
  example_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  data       BLOB NOT NULL,
  sha256     TEXT NOT NULL,
  size       INTEGER NOT NULL,
  PRIMARY KEY (example_id, name)
);
CREATE TABLE IF NOT EXISTS wf_test_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'compare',
  a_use       TEXT,
  b_use       TEXT NOT NULL,
  a_fp        TEXT,
  b_fp        TEXT NOT NULL,
  example_ids TEXT NOT NULL DEFAULT '[]',
  tries       INTEGER NOT NULL,
  quick       TEXT,
  cap_usd     REAL,
  connectors  TEXT NOT NULL DEFAULT 'pretend',
  status      TEXT NOT NULL,
  stop_reason TEXT,
  stop_detail TEXT,
  started_by  TEXT,
  created_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_test_runs_wf ON wf_test_runs (workflow_id, id);
CREATE TABLE IF NOT EXISTS wf_test_tries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  example_id  INTEGER NOT NULL,
  use_ref     TEXT NOT NULL,
  fp          TEXT NOT NULL,
  example_fp  TEXT NOT NULL,
  try_no      INTEGER NOT NULL,
  mock        INTEGER NOT NULL DEFAULT 0,
  connectors  TEXT NOT NULL DEFAULT 'pretend',
  status      TEXT NOT NULL,
  run_key     TEXT,
  pipeline_id TEXT,
  verdict     TEXT,
  cost_usd    REAL NOT NULL DEFAULT 0,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_test_tries_reuse ON wf_test_tries (workflow_id, example_id, use_ref, fp, example_fp);
CREATE INDEX IF NOT EXISTS idx_wf_test_tries_run ON wf_test_tries (run_id);
CREATE TABLE IF NOT EXISTS wf_test_run_tries (
  run_id INTEGER NOT NULL,
  try_id INTEGER NOT NULL,
  side   TEXT NOT NULL,
  PRIMARY KEY (run_id, try_id)
);`;

// v104 (plans/workflow-tests-part3a-plan.md D41, D53): an example's project and pinned start point. FK-free like the v78
// tables. `changes` = the person's uncommitted changes at save time, as a binary patch (NULL = none); `start_commit` = the
// commit tries start from (start_sha itself, or Worca's commit of start_sha + changes in its copy of the project).
// `project_name` = the project's name when the start was pinned: shown when the project is no longer registered, never the
// key (3a Task 8 review). Added after the rung (then v81) was first cut, so INCREMENTAL_COLUMNS repairs a table made without it.
export const WORKFLOW_TEST_PROJECTS_DDL = `
CREATE TABLE IF NOT EXISTS wf_test_example_projects (
  example_id     INTEGER PRIMARY KEY,
  project_key    TEXT NOT NULL,
  start_sha      TEXT NOT NULL,
  start_ref      TEXT,
  start_at       TEXT NOT NULL,
  start_commit   TEXT NOT NULL,
  changes        BLOB,
  changes_sha256 TEXT,
  setup_cmd      TEXT,
  updated_at     TEXT NOT NULL,
  project_name   TEXT
);`;

// v105 (plans/workflow-tests-part4-plan.md D86–D106): your criteria, checked by Worca. FK-free like v103: store.deleteExample
// deletes an example's judgements, answers, rounds and liked result; the ledger stays (spend never goes back).
// wf_test_judgements: one row per model answer (a try's criterion, a Check the checker card and its repeats, a pair).
//   purpose 'try' | 'real' | 'planted' | 'again' | 'padded' | 'pair'; met 1 | 0 | NULL (not counted); winner (pairs) a | b | tie | unsure.
// wf_test_judge_answers: the person's Agree / Disagree (agree 1 | 0), one per person (by_key '' = no identity) and answer.
// wf_test_checker_rounds: status 'making' | 'ready' | 'failed' | 'done'; source = JSON { kind, tryId?, pipelineId?, label }.
// wf_test_liked: kind 'text' | 'changes'. wf_test_judge_ledger: every paid Part 4 call (D92), counted in the spending limit.
export const WORKFLOW_TEST_CRITERIA_DDL = `
CREATE TABLE IF NOT EXISTS wf_test_judgements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  TEXT NOT NULL,
  example_id   INTEGER NOT NULL,
  criterion_id TEXT,
  criterion_fp TEXT NOT NULL,
  model        TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  try_id       INTEGER,
  other_try_id INTEGER,
  round_id     INTEGER,
  card         INTEGER,
  variant      TEXT,
  subject      TEXT,
  met          INTEGER,
  winner       TEXT,
  reason       TEXT,
  proof        TEXT,
  proof_found  INTEGER,
  error        TEXT,
  cost_usd     REAL NOT NULL DEFAULT 0,
  ms           INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_test_judgements_try ON wf_test_judgements (try_id, criterion_fp, model);
CREATE INDEX IF NOT EXISTS idx_wf_test_judgements_key ON wf_test_judgements (workflow_id, criterion_fp, model);
CREATE INDEX IF NOT EXISTS idx_wf_test_judgements_round ON wf_test_judgements (round_id);
CREATE TABLE IF NOT EXISTS wf_test_judge_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  judgement_id INTEGER NOT NULL,
  by_key       TEXT NOT NULL DEFAULT '',
  agree        INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (judgement_id, by_key)
);
CREATE TABLE IF NOT EXISTS wf_test_checker_rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  TEXT NOT NULL,
  example_id   INTEGER NOT NULL,
  criterion_id TEXT NOT NULL,
  criterion_fp TEXT NOT NULL,
  model        TEXT NOT NULL,
  source       TEXT NOT NULL,
  status       TEXT NOT NULL,
  detail       TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_test_checker_rounds_key ON wf_test_checker_rounds (workflow_id, criterion_fp, model);
CREATE TABLE IF NOT EXISTS wf_test_liked (
  example_id    INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  data          BLOB NOT NULL,
  sha256        TEXT NOT NULL,
  size          INTEGER NOT NULL,
  from_pipeline TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wf_test_judge_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  example_id  INTEGER,
  test_run_id INTEGER,
  round_id    INTEGER,
  purpose     TEXT NOT NULL,
  model       TEXT,
  engine      TEXT,
  amount_usd  REAL NOT NULL,
  cost_kind   TEXT,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_test_judge_ledger_ts ON wf_test_judge_ledger (ts);
CREATE INDEX IF NOT EXISTS idx_wf_test_judge_ledger_run ON wf_test_judge_ledger (test_run_id);`;

/** Every workflow-tests table and the DDL that makes it (db.mjs INCREMENTAL_TABLES: reconcile-safe on any stamp). */
export const WORKFLOW_TEST_TABLES = Object.freeze({
  workflow_revisions: WORKFLOW_REVISIONS_DDL,      // v102 (Part 1, #721)
  wf_test_examples: WORKFLOW_TESTS_DDL,            // v103 (Part 2)
  wf_test_example_files: WORKFLOW_TESTS_DDL,
  wf_test_runs: WORKFLOW_TESTS_DDL,
  wf_test_tries: WORKFLOW_TESTS_DDL,
  wf_test_run_tries: WORKFLOW_TESTS_DDL,
  wf_test_example_projects: WORKFLOW_TEST_PROJECTS_DDL,   // v104 (3a)
  wf_test_judgements: WORKFLOW_TEST_CRITERIA_DDL,  // v105 (Part 4)
  wf_test_judge_answers: WORKFLOW_TEST_CRITERIA_DDL,
  wf_test_checker_rounds: WORKFLOW_TEST_CRITERIA_DDL,
  wf_test_liked: WORKFLOW_TEST_CRITERIA_DDL,
  wf_test_judge_ledger: WORKFLOW_TEST_CRITERIA_DDL,
});

/** v105: the example's criteria (JSON list, D86) and checking model (JSON { model }, D87), for db.mjs INCREMENTAL_COLUMNS. Fix round 3
 *  (final review M7): wf_test_judgements.test_run_id, the test that wrote a row (NULL = no test: Check the checker, an older row);
 *  no rung of its own: v105 is not released, so the v105 rung's repair adds it to a new table and reconcileSchema to a DB already at 105. */
export const WORKFLOW_TEST_CRITERIA_COLUMNS = Object.freeze({
  wf_test_examples: Object.freeze({ criteria: "TEXT NOT NULL DEFAULT '[]'", judge: 'TEXT' }),
  wf_test_judgements: Object.freeze({ test_run_id: 'INTEGER' }),
});
