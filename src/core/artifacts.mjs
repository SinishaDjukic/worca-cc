// src/core/artifacts.mjs
// Filesystem layout, naming, and pipeline persistence/audit helpers.
//
// All paths returned are absolute and rooted in the EXTERNAL store at
// <worcaHome>/store/<projectKey>/ (see store.mjs) — NOT inside the project
// working tree. This keeps history machine-wide and out of git. Pipelines are
// self-describing: each run dir holds the prompt + any extra files; the audit
// timeline and machine state live in the DB (pipeline_events + the pipelines row),
// which is the authoritative store (no more pipeline.md / state.json on disk).

import { mkdir, writeFile, readFile, copyFile, readdir } from 'node:fs/promises';
import { join, basename, resolve, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { projectKey, projectStorePath, canonicalProjectRoot, workspaceStorePath } from './store.mjs';
import { listProjects } from './projects.mjs';
import { branchExists, diffShortstat, hasGh, findPrForBranch } from './git-info.mjs';
import { getDb, tx } from './db.mjs';
import { RUN_LOG_FILE } from './run-log.mjs';

// ── DB row <-> state object mapping (Phase 3) ──────────────────────────────────
// JSON columns are TEXT; (de)serialize at THIS boundary only. Reads are fail-safe:
// a null/empty/corrupt column yields the fallback, never a throw.

/** Parse a TEXT JSON column to an object/array, or `fallback` on null/empty/bad. */
function j(text, fallback = null) {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}
/** Stringify a value for a TEXT JSON column, or null when the value is null/undefined. */
function s(value) {
  return value == null ? null : JSON.stringify(value);
}

/** The 8-hex pipeline id embedded as the final "-<id>" segment of a run dir name. */
const DIR_ID_RE = /-([0-9a-f]{8})$/i;

/**
 * Read a store_meta row's JSON payload by key, or null when absent. Replaces the
 * per-project / per-workspace meta.json file read. Fail-safe: a corrupt/empty
 * payload reads as null rather than throwing.
 * @param {string} key
 * @returns {object|null}
 */
export function readStoreMeta(key) {
  const row = getDb().prepare('SELECT data FROM store_meta WHERE key = ?').get(key);
  return row ? j(row.data, null) : null;
}

/**
 * Upsert a store_meta row. `kind` is 'project' | 'workspace'; `data` is the full
 * meta object (stored as a JSON string). Replaces writing meta.json.
 * @param {string} key
 * @param {'project'|'workspace'} kind
 * @param {object} data
 */
export function writeStoreMeta(key, kind, data) {
  tx(() => {
    getDb().prepare(`
      INSERT INTO store_meta (key, kind, data) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, data = excluded.data
    `).run(key, kind, JSON.stringify(data ?? {}));
  });
}

/**
 * Delete a store_meta row (used by workspace delete in Phase 2). No-op when absent.
 * @param {string} key
 */
export function deleteStoreMeta(key) {
  tx(() => { getDb().prepare('DELETE FROM store_meta WHERE key = ?').run(key); });
}

/**
 * Index a markdown / extras path kept on the FS after the migration, so the
 * pipeline-delete (Task 3.13) can unlink the EXACT files instead of re-deriving
 * names. `kind` is e.g. prompt | workspace-description | extra | plan | review |
 * checklist | webui; `relPath` is relative to the pipeline dir for pipeline-local
 * files (prompt.md, extras/*, manual-tests-checklist.md, webui-review-cycleN.md)
 * and relative to the store root for the shared plan/review markdown (which live
 * in plans//reviews/, siblings of pipelines/). Idempotent (INSERT OR IGNORE on the
 * (pipeline_id, kind, rel_path) PK), best-effort: a logging failure never breaks a
 * run. A null/empty path is a no-op. The pipelines row must already exist (FK).
 * @param {string} pipelineId
 * @param {string} kind
 * @param {string} relPath
 */
export function recordArtifact(pipelineId, kind, relPath) {
  if (!pipelineId || !kind || !relPath) return;
  try {
    tx(() => {
      getDb().prepare(
        'INSERT OR IGNORE INTO artifacts (pipeline_id, kind, rel_path) VALUES (?, ?, ?)',
      ).run(pipelineId, kind, relPath);
    });
  } catch { /* artifact indexing is best-effort; never break a run on it */ }
}

/**
 * List a pipeline's indexed artifacts as [{ kind, relPath }]. The inverse of
 * recordArtifact: pipeline-delete (Task 3.13) reads these to unlink the EXACT FS
 * markdown/extras files instead of re-deriving names. rel_path scope is encoded by
 * the convention recordArtifact documents (dir-relative for pipeline-local files,
 * store-root-relative for the shared plan/review markdown).
 * @param {string} pipelineId
 * @returns {Promise<Array<{kind:string, relPath:string}>>}
 */
export async function listArtifacts(pipelineId) {
  return getDb().prepare('SELECT kind, rel_path FROM artifacts WHERE pipeline_id = ?')
    .all(pipelineId).map((r) => ({ kind: r.kind, relPath: r.rel_path }));
}

/**
 * Upsert the clarify row for a pipeline. Pass { questions } and/or { answers }. A
 * partial call updates only the provided column, preserving the other. JSON-encoded
 * TEXT columns. The agent writes clarify.json as transient run-dir scratch;
 * runPlannerClarify ingests it here and reads it back, so this row is the
 * AUTHORITATIVE clarify store (questions + answers). The pipelines row must exist (FK).
 * @param {string} pipelineId
 * @param {{questions?:object, answers?:object}} payload
 */
export async function writeClarify(pipelineId, { questions, answers } = {}) {
  if (!pipelineId) return;
  try {
    tx(() => {
      getDb().prepare('INSERT INTO clarify (pipeline_id) VALUES (?) ON CONFLICT(pipeline_id) DO NOTHING')
        .run(pipelineId);
      if (questions !== undefined) {
        getDb().prepare('UPDATE clarify SET questions = ? WHERE pipeline_id = ?')
          .run(s(questions), pipelineId);
      }
      if (answers !== undefined) {
        getDb().prepare('UPDATE clarify SET answers = ? WHERE pipeline_id = ?')
          .run(s(answers), pipelineId);
      }
    });
  } catch { /* defensive: keep the row write resilient under WAL contention; authoritative callers await + read back (M1), so a swallowed write is caught by tests, not a crashed run. */ }
}

/**
 * Read the clarify row as { questions, answers } (each parsed JSON or null). When no
 * row exists both are null. The authoritative clarify reader (questions ingested by
 * runPlannerClarify; answers by the orchestrator).
 * @param {string} pipelineId
 * @returns {{questions:object|null, answers:object|null}}
 */
export function readClarifyRow(pipelineId) {
  const row = getDb().prepare('SELECT questions, answers FROM clarify WHERE pipeline_id = ?').get(pipelineId);
  if (!row) return { questions: null, answers: null };
  return { questions: j(row.questions, null), answers: j(row.answers, null) };
}

/**
 * Upsert one round of a node's ask-then-resume Q&A (spec 2026-07-11). Pass
 * { questions } and/or { answers }; a partial call updates only the provided
 * column (writeClarify pattern). stepKey is the step record's stable
 * "<stepIndex>:<nodeId>[#cycle]" key; nodeId is denormalized for per-node
 * re-injection. Best-effort under WAL contention.
 * @param {string} pipelineId
 * @param {string} stepKey
 * @param {number} round 1-based round within one node run
 * @param {{agentKey?:string, nodeId?:string, questions?:object, answers?:object}} payload
 */
export async function writeStepQuestions(pipelineId, stepKey, round, { agentKey, nodeId, questions, answers } = {}) {
  if (!pipelineId || !stepKey || !Number.isFinite(Number(round))) return;
  try {
    tx(() => {
      getDb().prepare(`
        INSERT INTO step_questions (pipeline_id, step_key, round, node_id, agent_key) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(pipeline_id, step_key, round)
        DO UPDATE SET node_id = COALESCE(excluded.node_id, node_id),
                      agent_key = COALESCE(excluded.agent_key, agent_key)
      `).run(pipelineId, stepKey, Number(round), nodeId ?? null, agentKey ?? null);
      if (questions !== undefined) {
        getDb().prepare('UPDATE step_questions SET questions = ? WHERE pipeline_id = ? AND step_key = ? AND round = ?')
          .run(s(questions), pipelineId, stepKey, Number(round));
      }
      if (answers !== undefined) {
        getDb().prepare('UPDATE step_questions SET answers = ? WHERE pipeline_id = ? AND step_key = ? AND round = ?')
          .run(s(answers), pipelineId, stepKey, Number(round));
      }
    });
  } catch (err) {
    // Defensive: mirrors writeClarify — a transient lock must not crash a run.
    // Anything OTHER than lock contention (e.g. schema drift that once left
    // step_questions missing) is silent Q&A loss, so at least say so.
    const msg = err && err.message ? err.message : String(err);
    if (!/locked|busy/i.test(msg)) console.warn(`[artifacts] step_questions write dropped: ${msg}`);
  }
}

/**
 * All ask-then-resume rounds of a pipeline, unwrapped to plain arrays, in
 * chronological insert order (rowid — lexicographic step_key would mis-order
 * '10:' before '2:' on big workflows). Always returns an array.
 * @param {string} pipelineId
 * @returns {Array<{stepKey:string, round:number, nodeId:string, agentKey:string, questions:Array, answers:Array}>}
 */
export function readStepQuestions(pipelineId) {
  const rows = getDb().prepare(
    'SELECT step_key, round, node_id, agent_key, questions, answers FROM step_questions WHERE pipeline_id = ? ORDER BY rowid'
  ).all(pipelineId);
  return rows.map((r) => {
    const qWrap = j(r.questions, null);
    const aWrap = j(r.answers, null);
    return {
      stepKey: r.step_key,
      round: r.round,
      nodeId: r.node_id || '',
      agentKey: r.agent_key || '',
      questions: Array.isArray(qWrap?.questions) ? qWrap.questions : [],
      answers: Array.isArray(aWrap?.answers) ? aWrap.answers : [],
    };
  });
}

/**
 * Map a channels.allocate() review base name to the reviews-table `kind`. A2: the
 * kind is a 5-value OPEN set {refine, impl, plan, ws, webui} derived by stripping the
 * "-review-cycleN.json" suffix from the legacy filename; treat it as free text (an
 * unknown base passes through unchanged so the mapping is lossless).
 * @param {string} base e.g. 'impl-review' | 'plan-review' | 'refine-review' | 'ws-review' | 'webui-review'
 * @returns {string}
 */
const REVIEW_KIND = {
  'refine-review': 'refine', 'impl-review': 'impl', 'plan-review': 'plan',
  'ws-review': 'ws', 'webui-review': 'webui',
};
export function reviewKindOf(base) { return REVIEW_KIND[base] || base; }

/**
 * Upsert a per-cycle review verdict. `kind` ∈ refine|impl|plan|ws|webui (free text,
 * A2); `cycle` is the run cycle; `verdict` is the normalized { issues:[...], summary }
 * object protocol.readReview returns. The AUTHORITATIVE per-cycle verdict store. The
 * agent writes *-review-cycleN.json as transient scratch; the runner parses it once
 * and returns the verdict, which the orchestrator persists here (awaited). The live
 * loop gates on that returned verdict in-memory. Re-running a cycle REPLACES its
 * verdict (ON CONFLICT). The pipelines row must exist (FK).
 * @param {string} pipelineId
 * @param {string} kind
 * @param {number} cycle
 * @param {object} verdict
 */
export async function writeReview(pipelineId, kind, cycle, verdict) {
  if (!pipelineId || !kind) return;
  try {
    tx(() => {
      getDb().prepare(`
        INSERT INTO reviews (pipeline_id, kind, cycle, verdict) VALUES (?, ?, ?, ?)
        ON CONFLICT(pipeline_id, kind, cycle) DO UPDATE SET verdict = excluded.verdict
      `).run(pipelineId, kind, cycle, s(verdict));
    });
  } catch { /* defensive: keep the row write resilient under WAL contention; authoritative callers await + read back (M1), so a swallowed write is caught by tests, not a crashed run. */ }
}

/**
 * Read a single per-cycle verdict (the parsed JSON object), or null when absent.
 * @param {string} pipelineId
 * @param {string} kind
 * @param {number} cycle
 * @returns {object|null}
 */
export function readReviewRow(pipelineId, kind, cycle) {
  const row = getDb().prepare(
    'SELECT verdict FROM reviews WHERE pipeline_id = ? AND kind = ? AND cycle = ?')
    .get(pipelineId, kind, cycle);
  return row ? j(row.verdict, null) : null;
}

/**
 * Enumerate the History-side "extras" for a pipeline: the clarify Q&A and EVERY
 * per-cycle review verdict. The single-row readers (readClarifyRow/readReviewRow)
 * need a key/cycle up front; History has neither, so this lists them. clarify
 * halves are UNWRAPPED to plain arrays (the columns store {questions:[…]} /
 * {answers:[…]} — see writeClarify); a missing clarify row yields empty arrays.
 * reviews is a flat, deterministically ordered (kind, cycle) list, each entry the
 * parsed verdict spread with its {kind,cycle} so the UI can group/label without a
 * second lookup. stepQuestions is the per-step ask-then-resume Q&A rounds
 * (readStepQuestions, chronological insert order). Always returns arrays (never
 * null) so callers render unconditionally.
 * @param {string} pipelineId
 * @returns {{clarify:{questions:Array, answers:Array}, reviews:Array<{kind:string,cycle:number,issues:Array,summary:string}>, stepQuestions:Array<{stepKey:string,round:number,nodeId:string,agentKey:string,questions:Array,answers:Array}>}}
 */
export function readPipelineExtras(pipelineId) {
  const c = getDb().prepare('SELECT questions, answers FROM clarify WHERE pipeline_id = ?').get(pipelineId);
  const qWrap = c ? j(c.questions, null) : null;
  const aWrap = c ? j(c.answers, null) : null;
  const clarify = {
    questions: Array.isArray(qWrap?.questions) ? qWrap.questions : [],
    answers: Array.isArray(aWrap?.answers) ? aWrap.answers : [],
  };
  const reviews = getDb().prepare(
    'SELECT kind, cycle, verdict FROM reviews WHERE pipeline_id = ? ORDER BY kind, cycle'
  ).all(pipelineId).map((r) => {
    const v = j(r.verdict, {}) || {};
    return {
      kind: r.kind,
      cycle: r.cycle,
      issues: Array.isArray(v.issues) ? v.issues : [],
      summary: typeof v.summary === 'string' ? v.summary : '',
    };
  });
  return { clarify, reviews, stepQuestions: readStepQuestions(pipelineId) };
}

/**
 * Upsert one sub_agents row (a Task/Agent child agent of a pipeline node). Idempotent
 * on the (pipeline_id, id) PK: the spawn writes the full record; later lifecycle updates
 * (finish / telemetry) pass only the changed fields and DO NOT clobber the rest. The
 * UPDATE arm COALESCE-guards label/started_at/duration_ms/tokens/cost_usd exactly like
 * writeState guards base_name/date_prefix (a NULL excluded never overwrites a set value),
 * so a status-only finish update can never null the spawn-time label or accrued telemetry.
 * status/finished_at/node_id/step_index/cycle/step_key always take the newest non-null.
 *
 * This is the IDEMPOTENT UPSERT path, NEVER the delete-all path — sub_agents must outlive
 * writeState's pipeline_steps DELETE-all + re-INSERT (which is why the table FKs to
 * pipelines, not pipeline_steps). Best-effort under WAL contention (mirrors writeReview/
 * recordArtifact): the orchestrator's live `state.subAgents` snapshot is the reconcile
 * source of truth, so a swallowed write surfaces in tests, never as a crashed run. A
 * missing id/pipelineId is a no-op. The pipelines row must already exist (FK).
 * @param {string} pipelineId
 * @param {{id:string, label?:string, nodeId?:string, stepIndex?:number, cycle?:number,
 *          stepKey?:string, status?:string, startedAt?:string, finishedAt?:string,
 *          durationMs?:number, tokens?:number, costUsd?:number, subagentType?:string}} rec
 */
export function upsertSubAgent(pipelineId, rec) {
  if (!pipelineId || !rec || !rec.id) return;
  try {
    tx(() => {
      getDb().prepare(`
        INSERT INTO sub_agents (pipeline_id, id, step_key, node_id, step_index, cycle,
          label, status, started_at, finished_at, duration_ms, tokens, cost_usd, ui_phase, skills, subagent_type, graphify_count)
        VALUES (@pipeline_id,@id,@step_key,@node_id,@step_index,@cycle,@label,@status,
          @started_at,@finished_at,@duration_ms,@tokens,@cost_usd,@ui_phase,@skills,@subagent_type,@graphify_count)
        ON CONFLICT(pipeline_id, id) DO UPDATE SET
          status      = excluded.status,
          step_key    = COALESCE(excluded.step_key, step_key),
          node_id     = COALESCE(excluded.node_id, node_id),
          step_index  = COALESCE(excluded.step_index, step_index),
          cycle       = COALESCE(excluded.cycle, cycle),
          label       = COALESCE(excluded.label, label),
          started_at  = COALESCE(excluded.started_at, started_at),
          finished_at = COALESCE(excluded.finished_at, finished_at),
          duration_ms = COALESCE(excluded.duration_ms, duration_ms),
          tokens      = COALESCE(excluded.tokens, tokens),
          cost_usd    = COALESCE(excluded.cost_usd, cost_usd),
          ui_phase    = COALESCE(excluded.ui_phase, ui_phase),
          skills      = COALESCE(excluded.skills, skills),
          subagent_type = COALESCE(excluded.subagent_type, subagent_type),
          graphify_count = COALESCE(excluded.graphify_count, graphify_count)
      `).run({
        pipeline_id: pipelineId,
        id: rec.id,
        step_key: rec.stepKey ?? null,
        node_id: rec.nodeId ?? null,
        step_index: Number.isFinite(rec.stepIndex) ? rec.stepIndex : null,
        cycle: Number.isFinite(rec.cycle) ? rec.cycle : null,
        label: rec.label ?? null,
        status: rec.status ?? 'running',
        started_at: rec.startedAt ?? null,
        finished_at: rec.finishedAt ?? null,
        duration_ms: Number.isFinite(rec.durationMs) ? rec.durationMs : null,
        tokens: Number.isFinite(rec.tokens) ? rec.tokens : null,
        cost_usd: Number.isFinite(rec.costUsd) ? rec.costUsd : null,
        ui_phase: rec.uiPhase ?? null,
        skills: s(rec.skills),   // s() = JSON.stringify or null; growing supersets overwrite via COALESCE
        subagent_type: rec.subagentType ?? null,   // scalar TEXT: bound directly (no s() JSON wrap)
        graphify_count: Number.isFinite(rec.graphifyCount) ? rec.graphifyCount : null,  // scalar INTEGER
      });
    });
  } catch { /* best-effort: live state.subAgents is the reconcile source of truth; a swallowed write is caught by tests, not a crashed run. */ }
}

/**
 * List a pipeline's sub-agents as the shared camelCase record array, ordered by
 * (started_at, id) — the same order the UI groups/renders. Inverse of upsertSubAgent's
 * column mapping (snake_case row -> camelCase record), mirroring stepRowToStep. Always
 * returns an array (never null) so callers render unconditionally; nullable telemetry
 * columns surface as null. Wired into rowToState so it rides every detail response.
 * @param {string} pipelineId
 * @returns {Array<{id:string, label:string|null, nodeId:string|null, stepIndex:number|null,
 *   cycle:number|null, stepKey:string|null, status:string, startedAt:string|null,
 *   finishedAt:string|null, durationMs:number|null, tokens:number|null, costUsd:number|null,
 *   subagentType:string|null}>}
 */
export function listSubAgents(pipelineId) {
  if (!pipelineId) return [];
  return getDb().prepare(`
    SELECT id, label, node_id, step_index, cycle, step_key, status,
           started_at, finished_at, duration_ms, tokens, cost_usd, ui_phase, skills, subagent_type, graphify_count
    FROM sub_agents WHERE pipeline_id = ? ORDER BY started_at, id
  `).all(pipelineId).map((r) => ({
    id: r.id,
    label: r.label ?? null,
    nodeId: r.node_id ?? null,
    stepIndex: r.step_index ?? null,
    cycle: r.cycle ?? null,
    stepKey: r.step_key ?? null,
    status: r.status,
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
    durationMs: r.duration_ms ?? null,
    tokens: r.tokens ?? null,
    costUsd: r.cost_usd ?? null,
    uiPhase: r.ui_phase ?? null,
    skills: j(r.skills, []),     // NULL -> [] so the UI always has an array (no pills)
    subagentType: r.subagent_type ?? null,   // scalar TEXT: mapped directly (no j() parse)
    graphifyCount: r.graphify_count ?? null,   // scalar INTEGER: NULL -> null (no badge)
  }));
}

/**
 * Persist a run's decomposition: its ordered phases + the self-contained task files.
 * Idempotent UPSERT on the PKs (never the delete-all path), so a re-write or a later
 * status update never duplicates rows. Best-effort under WAL contention (mirrors
 * upsertSubAgent): the live decomposition is the runtime source of truth, so a
 * swallowed write surfaces in tests, not as a crashed run. The pipelines row must
 * already exist (FK). `phases` is [{ ordinal, tasks:[{ id, title, file, nodeId }] }].
 * @param {string} pipelineId
 * @param {Array<{ordinal:number, tasks:Array<{id:string,title?:string,file?:string,nodeId?:string}>}>} phases
 */
export function writeDecomposition(pipelineId, phases) {
  if (!pipelineId || !Array.isArray(phases)) return;
  try {
    tx(() => {
      const insPhase = getDb().prepare(`
        INSERT INTO pipeline_phases (pipeline_id, ordinal, status)
        VALUES (?, ?, 'pending')
        ON CONFLICT(pipeline_id, ordinal) DO NOTHING
      `);
      const insTask = getDb().prepare(`
        INSERT INTO pipeline_tasks (pipeline_id, id, phase_ordinal, task_index, title, file_rel_path, node_id, status)
        VALUES (@pipeline_id,@id,@phase_ordinal,@task_index,@title,@file_rel_path,@node_id,'pending')
        ON CONFLICT(pipeline_id, id) DO UPDATE SET
          phase_ordinal = excluded.phase_ordinal,
          task_index    = excluded.task_index,
          title         = COALESCE(excluded.title, title),
          file_rel_path = COALESCE(excluded.file_rel_path, file_rel_path),
          node_id       = COALESCE(excluded.node_id, node_id)
      `);
      for (const ph of phases) {
        if (!ph || !Number.isFinite(Number(ph.ordinal))) continue;
        insPhase.run(pipelineId, Number(ph.ordinal));
        const tasks = Array.isArray(ph.tasks) ? ph.tasks : [];
        tasks.forEach((t, i) => {
          if (!t || !t.id) return;
          insTask.run({
            pipeline_id: pipelineId,
            id: String(t.id),
            phase_ordinal: Number(ph.ordinal),
            task_index: i,
            title: t.title ?? null,
            file_rel_path: t.file ?? null,
            node_id: t.nodeId ?? null,
          });
        });
      }
    });
  } catch { /* best-effort: live decomposition is the reconcile source of truth */ }
}

/** List a pipeline's phases, ordered by ordinal. Always an array. */
export function listPhases(pipelineId) {
  if (!pipelineId) return [];
  return getDb().prepare(
    'SELECT ordinal, status, started_at, finished_at FROM pipeline_phases WHERE pipeline_id = ? ORDER BY ordinal'
  ).all(pipelineId).map((r) => ({
    ordinal: r.ordinal,
    status: r.status,
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
  }));
}

/** List a pipeline's tasks, ordered by (phase_ordinal, task_index). Always an array. */
export function listTasks(pipelineId) {
  if (!pipelineId) return [];
  return getDb().prepare(`
    SELECT id, phase_ordinal, task_index, title, file_rel_path, node_id, status, started_at, finished_at
    FROM pipeline_tasks WHERE pipeline_id = ? ORDER BY phase_ordinal, task_index
  `).all(pipelineId).map((r) => ({
    id: r.id,
    phaseOrdinal: r.phase_ordinal,
    taskIndex: r.task_index,
    title: r.title ?? null,
    fileRelPath: r.file_rel_path ?? null,
    nodeId: r.node_id ?? null,
    status: r.status,
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
  }));
}

/** Set a task's status + the matching timestamp (running -> started_at, terminal -> finished_at). Best-effort. */
export function updateTaskStatus(pipelineId, taskId, status, ts) {
  if (!pipelineId || !taskId || !status) return;
  const startedCol = status === 'running' ? ts ?? null : null;
  const finishedCol = (status === 'done' || status === 'error') ? ts ?? null : null;
  try {
    tx(() => {
      getDb().prepare(`
        UPDATE pipeline_tasks SET
          status = ?,
          started_at = COALESCE(?, started_at),
          finished_at = COALESCE(?, finished_at)
        WHERE pipeline_id = ? AND id = ?
      `).run(status, startedCol, finishedCol, pipelineId, taskId);
    });
  } catch { /* best-effort */ }
}

/** Set a phase's status + the matching timestamp. Best-effort. */
export function updatePhaseStatus(pipelineId, ordinal, status, ts) {
  if (!pipelineId || !Number.isFinite(Number(ordinal)) || !status) return;
  const startedCol = status === 'running' ? ts ?? null : null;
  const finishedCol = (status === 'done' || status === 'error') ? ts ?? null : null;
  try {
    tx(() => {
      getDb().prepare(`
        UPDATE pipeline_phases SET
          status = ?,
          started_at = COALESCE(?, started_at),
          finished_at = COALESCE(?, finished_at)
        WHERE pipeline_id = ? AND ordinal = ?
      `).run(status, startedCol, finishedCol, pipelineId, Number(ordinal));
    });
  } catch { /* best-effort */ }
}

/**
 * Convert an arbitrary string to a safe kebab-case slug.
 * - Lowercases, replaces non-alphanumerics with hyphens, collapses repeats,
 *   trims leading/trailing hyphens.
 * - Returns "untitled" for empty input.
 * @param {string} s
 * @returns {string}
 */
export function slugify(s) {
  const out = String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || 'untitled';
}

/**
 * Current date as "DD-MM-YY" using the runtime system clock.
 * @returns {string}
 */
export function today() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `${dd}-${mm}-${yy}`;
}

/**
 * Absolute artifact directory paths in the external store for `projectDir`,
 * i.e. <worcaHome>/store/<projectKey(projectDir)>/{plans,reviews,pipelines}.
 * Every reader/writer (plans, reviews, pipeline history) routes through here, so
 * redirecting this one function moves all three out of the working tree at once.
 * When `workspaceKey` is given, the root is the workspace store namespace
 * (<worcaHome>/store/workspaces/<workspaceKey>) instead of the per-project key
 * dir. Single-project callers (no second arg) are byte-identical.
 * @param {string} projectDir
 * @param {string} [workspaceKey] when set, routes to the workspace store
 * @returns {{root:string, plans:string, reviews:string, pipelines:string}}
 */
export function artifactPaths(projectDir, workspaceKey) {
  const root = workspaceKey
    ? workspaceStorePath(workspaceKey)
    : projectStorePath(projectKey(projectDir));
  return {
    root,
    plans: join(root, 'plans'),
    reviews: join(root, 'reviews'),
    pipelines: join(root, 'pipelines'),
  };
}

/**
 * Read or create the per-project meta (now a store_meta row, was meta.json).
 * Returns the meta object either way. Never throws: a failed write still returns
 * the computed meta so callers (createPipeline) get a project name without
 * re-reading. `firstSeenAt` is preserved across re-runs because an existing row
 * short-circuits. `_root` is retained for signature stability (now unused).
 */
async function ensureMeta(projectDir, _root) {
  void _root;
  const key = projectKey(projectDir);
  const existing = readStoreMeta(key);
  if (existing) return existing;                       // firstSeenAt preserved
  const canonical = canonicalProjectRoot(projectDir);
  let name = basename(canonical) || 'project';
  try {
    const projects = await listProjects();
    const hit = projects.find((pr) => {
      try { return realpathSync(pr.path) === canonical; } catch { return resolve(pr.path) === canonical; }
    });
    if (hit) name = hit.name;
  } catch { /* registry optional */ }
  const meta = { key, path: canonical, name, firstSeenAt: new Date().toISOString() };
  try { writeStoreMeta(key, 'project', meta); } catch { /* never block a run */ }
  return meta;
}

/**
 * Workspace variant of ensureMeta. Persists the §5.2 workspace meta shape
 * ({key,id,name,projectKeys,projectPaths,firstSeenAt}) to a store_meta row —
 * distinct from the project shape. Name resolution prefers the registry
 * (readWorkspace(workspaceId).name) and falls back to the primary canonical root
 * basename. Never throws, never blocks a run. `projectKeys`/`projectPaths` are
 * index-aligned and sorted by projectKey ascending.
 */
async function ensureWorkspaceMeta(primaryProjectDir, workspaceKey, opts = {}) {
  const existing = readStoreMeta(workspaceKey);
  if (existing) return existing;

  const members = Array.isArray(opts.projects) ? opts.projects.slice() : [];
  members.sort((a, b) => {
    const ka = a?.projectKey ?? '';
    const kb = b?.projectKey ?? '';
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  let name = typeof opts.workspaceName === 'string' && opts.workspaceName ? opts.workspaceName : '';
  if (!name) {
    try {
      const { readWorkspace } = await import('./workspaces.mjs');
      const ws = await readWorkspace(opts.workspaceId || workspaceKey);
      if (ws && ws.name) name = ws.name;
    } catch { /* registry optional */ }
  }
  if (!name) name = basename(canonicalProjectRoot(primaryProjectDir)) || 'workspace';

  const meta = {
    key: workspaceKey,
    id: opts.workspaceId || workspaceKey,
    name,
    projectKeys: members.map((m) => m.projectKey),
    projectPaths: members.map((m) => resolve(m.projectDir)),
    firstSeenAt: new Date().toISOString(),
  };
  try { writeStoreMeta(workspaceKey, 'workspace', meta); } catch { /* never block a run */ }
  return meta;
}

/**
 * Ensure the artifact directories (plans/reviews/pipelines) + meta.json exist.
 * When `workspaceKey` is set, routes to the workspace store and writes the
 * workspace meta shape; `opts` carries {workspaceId, workspaceName, projects}.
 * Single-project callers (no second arg) are byte-identical.
 */
export async function ensureArtifactDirs(projectDir, workspaceKey, opts = {}) {
  const p = artifactPaths(projectDir, workspaceKey);
  await mkdir(p.plans, { recursive: true });
  await mkdir(p.reviews, { recursive: true });
  await mkdir(p.pipelines, { recursive: true });
  const meta = workspaceKey
    ? await ensureWorkspaceMeta(projectDir, workspaceKey, opts)
    : await ensureMeta(projectDir, p.root);
  return { ...p, meta };
}

/**
 * Path for a plan markdown file.
 * version 1 => <DD-MM-YY-baseName>.md ; version N>1 => <...>-vN.md
 *
 * The date prefix is stamped at call time by default. Long-running pipelines
 * that cross midnight would otherwise give v1 one date and v2/v3 the next day's
 * date, breaking the shared-base linkage. The orchestrator therefore captures
 * the prefix once at run start and passes it as `datePrefix` so every -vN
 * version shares the v1 prefix.
 * @param {string} projectDir
 * @param {string} baseName already-slugified base (date is prefixed here)
 * @param {number} [version=1]
 * @param {string} [datePrefix] fixed DD-MM-YY prefix (defaults to today())
 * @param {string} [workspaceKey] when set, routes to the workspace store
 * @returns {string}
 */
export function planPath(projectDir, baseName, version = 1, datePrefix, workspaceKey) {
  const { plans } = artifactPaths(projectDir, workspaceKey);
  const v = Number(version) > 1 ? `-v${Number(version)}` : '';
  const date = datePrefix || today();
  return join(plans, `${date}-${baseName}${v}.md`);
}

/**
 * Path for an implementation review markdown file.
 * @param {string} projectDir
 * @param {string} baseName
 * @param {string} [datePrefix] fixed DD-MM-YY prefix (defaults to today())
 * @param {string} [kind='impl-review']
 * @param {string} [workspaceKey] when set, routes to the workspace store
 * @returns {string}
 */
export function reviewPath(projectDir, baseName, datePrefix, kind = 'impl-review', workspaceKey) {
  const { reviews } = artifactPaths(projectDir, workspaceKey);
  const date = datePrefix || today();
  return join(reviews, `${date}-${baseName}-${kind}.md`);
}

/** Short random id (8 hex chars) used to make pipeline dirs unique. */
function shortId() {
  return randomBytes(4).toString('hex');
}

/**
 * Freeze a workspace description into a run: take a VERBATIM snapshot of the text so
 * later registry edits never retroactively alter a started run. No length cap — the
 * description's size is bounded only by the workspace-scanner prompt. Non-strings
 * become ''.
 * @param {string} text
 * @returns {string}
 */
function freezeDescription(text) {
  return typeof text === 'string' ? text : '';
}

/**
 * Resolve a possibly-relative path against a base directory.
 */
function resolveAgainst(base, p) {
  return isAbsolute(p) ? p : resolve(base, p);
}

/**
 * Create a new pipeline directory and seed it with the prompt, extras and an audit
 * header (pipeline.md). The structured run state is INSERTed as a pipelines row
 * (Task 3.3/3.5) — there is no state.json. The prompt (and workspace-description /
 * extras) markdown is indexed in the artifacts table.
 *
 * When `opts.workspaceKey` is set the pipeline is written to the WORKSPACE store
 * (store/workspaces/<key>/), the pipelines row carries the §5.2 workspace superset
 * (collapsed into workspace_meta)
 * (target:'workspace', workspaceId/Key/Name, frozen workspaceDescription, sorted
 * projectKeys, projects[], empty checkpointRefs/branches), and a frozen
 * workspace-description.md snapshot is written into the pipeline dir. The frozen
 * description is frozen verbatim (cap-on-freeze snapshot, no length cap; the editable registry
 * copy is untouched). `projectDir` is the PRIMARY member (projects[0] after sort).
 * Absent the workspace opts the single-project path is byte-identical.
 *
 * @param {string} projectDir   single-project dir, or the workspace primary dir
 * @param {object} opts
 * @param {string} [opts.prompt]      inline prompt text
 * @param {string} [opts.promptFile]  path to a markdown file to use as the prompt
 * @param {string} [opts.promptText]  precomputed prompt body (sources.mjs seam);
 *                                    used when inline `prompt` is absent/empty
 * @param {string} [opts.sourceType]  'prompt' | 'markdown' | 'plugin' (defaults derived)
 * @param {object} [opts.sourceMeta]  { plugin, sourceId, taskId, url, title } | null
 * @param {string} [opts.guardrailsId] the run's selected guardrail set id (per-run)
 * @param {string[]} [opts.extras]    paths to extra files copied into dir/extras
 * @param {string} [opts.title]       human title (defaults to derived text)
 * @param {string} [opts.workspaceKey]   opt-in: route to the workspace store
 * @param {string} [opts.workspaceId]    == workspaceKey
 * @param {string} [opts.workspaceName]
 * @param {string} [opts.workspaceDescription]  frozen verbatim (no cap)
 * @param {Array<{projectKey,projectDir,projectName}>} [opts.projects]  sorted members
 * @returns {Promise<{id:string, dir:string, promptText:string}>}
 */
export async function createPipeline(projectDir, opts = {}) {
  const {
    prompt, promptFile, extras = [], title,
    promptText: precomputedPromptText = null, sourceType = null, sourceMeta = null,
    guardrailsId = null,
    workspaceKey = null, workspaceId = null, workspaceName = null,
    workspaceDescription = '', projects = null,
  } = opts;
  const paths = await ensureArtifactDirs(projectDir, workspaceKey || undefined, {
    workspaceId: workspaceId || workspaceKey,
    workspaceName,
    projects,
  });
  const key = projectKey(projectDir);
  const projectName = (paths.meta && paths.meta.name) || basename(resolve(projectDir));

  // Resolve the prompt text. Precedence: inline `prompt` (legacy callers) >
  // precomputed `promptText` (the sources.mjs seam) > `promptFile` read (direct
  // CLI/test callers that pass only a path — kept so pre-seam callers behave
  // byte-identically; the seam passes both promptText AND promptFile so the
  // verbatim copy below is unchanged).
  let promptText = typeof prompt === 'string' ? prompt : '';
  if (!promptText && typeof precomputedPromptText === 'string') promptText = precomputedPromptText;
  if (!promptText && promptFile) {
    try {
      promptText = await readFile(resolveAgainst(projectDir, promptFile), 'utf8');
    } catch {
      promptText = '';
    }
  }

  const resolvedTitle =
    (title && String(title).trim()) ||
    firstMeaningfulLine(promptText) ||
    'orchestration';

  const id = shortId();
  const slug = slugify(resolvedTitle).slice(0, 48) || 'pipeline';
  const dirName = `${today()}-${slug}-${id}`;
  const dir = join(paths.pipelines, dirName);
  await mkdir(dir, { recursive: true });

  // Seed the prompt. If a markdown file was provided, copy it verbatim;
  // otherwise persist the inline text. Either way prompt.md is the source.
  const promptDest = join(dir, 'prompt.md');
  if (promptFile) {
    try {
      await copyFile(resolveAgainst(projectDir, promptFile), promptDest);
    } catch {
      await writeFile(promptDest, promptText, 'utf8');
    }
  } else {
    await writeFile(promptDest, promptText, 'utf8');
  }

  // Copy optional extra files. Each successfully-copied extra is indexed in the
  // artifacts table (dir-relative "extras/<name>") AFTER writeState INSERTs the
  // pipelines row (FK) — collect them here, record below.
  const copiedExtras = [];
  if (Array.isArray(extras) && extras.length) {
    const extrasDir = join(dir, 'extras');
    await mkdir(extrasDir, { recursive: true });
    for (const ex of extras) {
      if (!ex) continue;
      const src = resolveAgainst(projectDir, ex);
      try {
        await copyFile(src, join(extrasDir, basename(src)));
        copiedExtras.push(join('extras', basename(src)));
      } catch {
        // Skip unreadable extras; never fail pipeline creation on a bad path.
      }
    }
  }

  const startedAt = new Date().toISOString();
  const state = {
    id,
    title: resolvedTitle,
    projectDir: resolve(projectDir),
    projectKey: key,
    projectName,
    status: 'created',
    phase: 'created',
    cycle: 0,
    startedAt,
    updatedAt: startedAt,
    prompt: promptText, // persisted to the pipelines.prompt column (was prompt.md only)
    artifacts: [],
    // Task-source provenance (spec §10). Derivation covers direct legacy callers;
    // the orchestrator passes sourceType explicitly through the sources.mjs seam.
    sourceType: sourceType || (sourceMeta ? 'plugin' : (promptFile ? 'markdown' : 'prompt')),
    sourceMeta: sourceMeta || null,
    // The run's selected guardrail set id (per-run model; 'permissive' for
    // unguarded runs). Creation-immutable, like sourceType: written on INSERT,
    // never touched by updates. NULL = legacy/pre-entity or non-orchestrator row.
    guardrailsId: guardrailsId || null,
  };

  // Workspace runs carry the §5.2 superset, discriminated by target:'workspace'.
  // The description is FROZEN here verbatim (no cap) so later registry edits never
  // retroactively alter a started run; branches/checkpointRefs start empty and are
  // populated by the orchestrator at worktree/checkpoint setup.
  if (workspaceKey) {
    const members = (Array.isArray(projects) ? projects.slice() : []).sort(
      (a, b) => {
        const ka = a?.projectKey ?? '';
        const kb = b?.projectKey ?? '';
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      },
    );
    const frozenDescription = freezeDescription(workspaceDescription);
    state.target = 'workspace';
    state.workspaceId = workspaceId || workspaceKey;
    state.workspaceKey = workspaceKey;
    state.workspaceName = workspaceName || (paths.meta && paths.meta.name) || '';
    state.workspaceDescription = frozenDescription;
    state.projectKeys = members.map((m) => m.projectKey);
    state.projects = members.map((m) => ({
      projectKey: m.projectKey,
      projectDir: resolve(m.projectDir),
      projectName: m.projectName ?? basename(resolve(m.projectDir)),
    }));
    state.checkpointRefs = {};
    state.branches = {};
    await writeFile(join(dir, 'workspace-description.md'), frozenDescription, 'utf8');
  }

  // Persist the run state by INSERTing the pipelines row (writeState, Task 3.3) —
  // no more state.json on disk. writeState also seeds the dir->id cache
  // (rememberDir) so appendAudit resolves this run without any call-site change
  // (A4). recordArtifact runs AFTER the row exists (FK -> pipelines).
  await writeState(dir, state);
  recordArtifact(id, 'prompt', 'prompt.md');
  if (workspaceKey) recordArtifact(id, 'workspace-description', 'workspace-description.md');
  for (const rel of copiedExtras) recordArtifact(id, 'extra', rel);

  return { id, dir, promptText };
}

function firstMeaningfulLine(text) {
  if (!text) return '';
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return t.slice(0, 80);
  }
  return '';
}

/**
 * Append a timeline entry to the pipeline's audit trail (was a markdown line in
 * pipeline.md). Now inserts a pipeline_events row {ts, text}. The pipeline id is
 * resolved from the dir: a dir->id cache fast path (seeded by createPipeline/
 * writeState), falling back to parsing the trailing 8-hex id from the dir basename
 * (createPipeline names dirs "<DD-MM-YY>-<slug>-<id>", id = 8 lowercase hex). When
 * no id can be resolved the call is a safe no-op (audit is best-effort, exactly as
 * the old appendFile could fail silently). Signature + async-ness unchanged so the
 * ~20 orchestrator call sites need no edit (A4).
 * @param {string} pipelineDir
 * @param {string} markdownLine
 * @returns {Promise<void>}
 */
export async function appendAudit(pipelineDir, markdownLine) {
  const id = resolvePipelineId(pipelineDir);
  if (!id) return;
  const ts = new Date().toISOString();
  const text = String(markdownLine ?? '').trim();
  try {
    tx(() => {
      getDb().prepare('INSERT INTO pipeline_events (pipeline_id, ts, text) VALUES (?, ?, ?)')
        .run(id, ts, text);
    });
  } catch { /* audit is best-effort; never break a run on a logging failure */ }
}

/** Resolve the 8-hex pipeline id for a run dir: cache hit, else parse the basename. */
export function resolvePipelineId(pipelineDir) {
  if (!pipelineDir) return null;
  const hit = _dirIdCache.get(resolve(pipelineDir));
  if (hit) return hit;
  const m = DIR_ID_RE.exec(basename(pipelineDir));
  return m ? m[1].toLowerCase() : null;
}

/** Absolute pipelineDir -> 8-hex id cache; the appendAudit (Task 3.4) fast path. */
const _dirIdCache = new Map();
/** Seed the dir->id cache (called by writeState and, later, createPipeline). */
function rememberDir(dir, id) { if (dir && id) _dirIdCache.set(resolve(dir), id); }

/**
 * Persist the full state object: UPSERT its pipelines row and REPLACE its
 * pipeline_steps rows, in one transaction. The id is resolved from stateObj.id.
 * `pipelineDir` is retained for signature stability + to seed the dir->id cache
 * (appendAudit fast path). Returns the object actually persisted (updatedAt
 * stamped), matching the legacy contract. node:sqlite is synchronous; the function
 * stays async so every existing `await writeState(...)` call site is unchanged.
 *
 * A11(a): the ON CONFLICT(id) DO UPDATE clause SETs ONLY the columns that
 * legitimately mutate during a run. It deliberately does NOT touch the
 * creation-immutable identity columns (project_key, prompt, target, title,
 * workspace_key, started_at, source_type, source_ref, guardrails_id) — the
 * orchestrator's this.state omits several of them (orchestrator.mjs:174-191), so
 * a blanket "SET <every column>=excluded.<column>" would null them on the first
 * post-create persist (and _persist's catch{} would hide the loss). The INSERT
 * arm still writes every column; only the UPDATE arm is curated.
 *
 * 3.5 fix: base_name/date_prefix are the one exception that must still be in the
 * UPDATE arm — createPipeline's INSERT leaves them NULL (state has neither field,
 * §0.2) and the orchestrator sets this.state.baseName/datePrefix only at
 * orchestrator.mjs:351-352, just before the first _persist(). If they were
 * EXCLUDED from UPDATE (as the literal A11a list said) they would persist as
 * permanent NULL and Task 3.7's reader + the Task 3.13 delete (keyed on
 * <datePrefix>-<base>) would fail to find the shared plans/reviews markdown. So
 * they are updated with a COALESCE guard: COALESCE(excluded.col, col) fills
 * NULL->value once and NEVER clobbers a set value back to NULL — preserving the
 * A11a anti-clobber guarantee (a NULL excluded never overwrites a set value)
 * while closing the dead-NULL bug.
 * @param {string} pipelineDir
 * @param {object} stateObj
 * @returns {Promise<object>}
 */
export async function writeState(pipelineDir, stateObj) {
  const obj = { ...stateObj, updatedAt: new Date().toISOString() };
  const id = obj.id;
  if (!id) return obj; // pre-id state (constructor default): nothing to persist yet
  rememberDir(pipelineDir, id); // dir->id cache for appendAudit
  tx(() => {
    getDb().prepare(`
      INSERT INTO pipelines (id, project_key, workspace_key, target, title, base_name,
        date_prefix, status, phase, cycle, started_at, updated_at, total_cost_usd,
        total_active_ms, prompt, branch, workspace_meta, stepper, tools, resume_point,
        source_type, source_ref, guardrails_id)
      VALUES (@id,@project_key,@workspace_key,@target,@title,@base_name,@date_prefix,
        @status,@phase,@cycle,@started_at,@updated_at,@total_cost_usd,@total_active_ms,
        @prompt,@branch,@workspace_meta,@stepper,@tools,@resume_point,
        @source_type,@source_ref,@guardrails_id)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status, phase=excluded.phase, cycle=excluded.cycle,
        updated_at=excluded.updated_at, total_cost_usd=excluded.total_cost_usd,
        total_active_ms=excluded.total_active_ms, branch=excluded.branch,
        workspace_meta=excluded.workspace_meta, stepper=excluded.stepper,
        tools=excluded.tools,
        resume_point=excluded.resume_point,
        base_name=COALESCE(excluded.base_name, base_name),
        date_prefix=COALESCE(excluded.date_prefix, date_prefix)
    `).run(toPipelineRow(obj));

    getDb().prepare('DELETE FROM pipeline_steps WHERE pipeline_id = ?').run(id);
    const ins = getDb().prepare(`
      INSERT INTO pipeline_steps (pipeline_id, key, node_id, phase, step_index, cycle,
        status, started_at, updated_at, active_ms, running_since, cost_usd, session_id, skills, graphify_count)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const st of Array.isArray(obj.steps) ? obj.steps : []) {
      ins.run(
        id, st.key, st.nodeId ?? null, st.phase ?? null,
        st.stepIndex ?? null, st.cycle ?? null, st.status ?? null,
        st.startedAt ?? null, st.updatedAt ?? null,
        Number.isFinite(st.activeMs) ? st.activeMs : 0,
        st.runningSince == null ? null : String(st.runningSince),
        Number.isFinite(st.costUsd) ? st.costUsd : 0,
        st.sessionId ?? null,
        s(st.skills),
        Number.isFinite(st.graphifyCount) ? st.graphifyCount : null,
      );
    }
  });
  return obj;
}

/**
 * Mutate ONLY the title of an existing pipeline row. writeState()'s UPSERT treats
 * title as creation-immutable, so this is the single sanctioned post-creation path.
 * Best-effort (mirrors writeReview/recordArtifact): a failure must not crash a run.
 * @param {string} pipelineId
 * @param {string} title
 */
export function updatePipelineTitle(pipelineId, title) {
  if (!pipelineId || typeof title !== 'string' || !title.trim()) return;
  try {
    tx(() => {
      getDb()
        .prepare('UPDATE pipelines SET title = @title, updated_at = @updated_at WHERE id = @id')
        .run({ id: pipelineId, title: title.trim(), updated_at: new Date().toISOString() });
    });
  } catch {
    /* best-effort: the live state event still carries the new title */
  }
}

/**
 * Persist the last observed PR facts on the pipeline row (spec §6.8).
 * Best-effort (PR facts are re-observable); NEVER touches updated_at — the
 * stats layer uses updated_at as the terminal-write proxy.
 * @param {string} pipelineId
 * @param {{ url:string, number?:number|null, state?:string }} pr
 */
export function persistPrState(pipelineId, pr) {
  if (!pipelineId || !pr || !pr.url) return;
  try {
    tx(() => {
      getDb().prepare(
        `UPDATE pipelines SET pr_url = ?, pr_number = ?, pr_state = ?, pr_checked_at = ?
         WHERE id = ?`,
      ).run(pr.url, pr.number ?? null, pr.state ?? 'OPEN', new Date().toISOString(), pipelineId);
    });
  } catch { /* best-effort */ }
}

/**
 * The status a stale (crashed/killed) run is reconciled to. Distinct from a user
 * 'stopped' and a real 'error': the owning process died before Orchestrator.run()'s
 * catch/finally could write a terminal status, so the row was frozen at 'running'.
 */
export const INTERRUPTED_STATUS = 'interrupted';

// The non-terminal statuses a run can be frozen at by a crash. 'pausing' is the
// graceful-shutdown window — a crash there is an interruption. 'paused' is NOT
// here: it is intentional and indefinite, never swept.
const RECONCILE_NON_TERMINAL = ['created', 'starting', 'running', 'pausing'];

/**
 * Staleness window (ms). A non-terminal row older than this AND not live is dead.
 * 30 min is deliberately generous: _persist() advances updated_at only on phase
 * boundaries (orchestrator.mjs:1846) and on an agent's terminal `result` event
 * (_recordCost :1888-1901) — a single long agent call can be silent for minutes.
 * A window shorter than that risks relabeling a genuinely-live run owned by a
 * CONCURRENT process (CLI+UI share one DB, db.mjs:44). The user's stuck record is
 * hours/days old, so it is swept immediately regardless. Override via env for tests/ops.
 */
const DEFAULT_STALE_RUN_MS = 30 * 60 * 1000;
function staleRunMs() {
  const n = Number(process.env.WORCA_STALE_RUN_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_RUN_MS;
}

/** Heartbeat refresh interval (ms): the running process re-stamps heartbeat_at this often. */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * Heartbeat staleness window (ms). A running/pausing row whose heartbeat_at is older than
 * this is treated as dead regardless of host — the heartbeat arm is the authoritative liveness
 * signal and handles PID reuse (a reused pid reads "alive" from probe, but heartbeat went cold
 * when the original process died). 90s ≫ the 30s interval, so two missed beats are tolerated.
 */
const DEFAULT_HEARTBEAT_STALE_MS = 90 * 1000;
function heartbeatStaleMs() {
  const n = Number(process.env.WORCA_HEARTBEAT_STALE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HEARTBEAT_STALE_MS;
}

/**
 * Default pid liveness probe. kill(pid,0) sends no signal — probes existence/permission only.
 * EPERM => the pid exists but is owned by another user (alive). ESRCH / any other error => dead.
 * Non-int / <=0 => dead. CALLER MUST gate this on owner_host === thisHost.
 * @param {number} pid
 * @returns {boolean}
 */
function defaultPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return !!e && e.code === 'EPERM'; }
}

/**
 * Stamp ownership when a process starts driving a run: owner_pid/owner_host + initial heartbeat.
 * Status-guarded so it never resurrects a terminal row. Best-effort.
 * @param {string} pipelineId
 * @param {{ pid?:number, host?:string, now?:number }} [opts]
 */
export function claimPipelineOwnership(pipelineId, { pid = process.pid, host = hostname(), now = Date.now() } = {}) {
  if (!pipelineId) return;
  try {
    tx(() => {
      getDb().prepare(`
        UPDATE pipelines SET owner_pid = ?, owner_host = ?, heartbeat_at = ?
        WHERE id = ? AND status IN ('running', 'pausing')
      `).run(pid, host, new Date(now).toISOString(), pipelineId);
    });
  } catch { /* liveness is best-effort; never crash a run */ }
}

/**
 * Lightweight heartbeat tick: refresh heartbeat_at ONLY. Status-guarded so a beat that fires
 * after a terminal write is a no-op. Returns the number of rows updated (0 or 1).
 * @param {string} pipelineId
 * @param {{ now?:number }} [opts]
 * @returns {number}
 */
export function touchHeartbeat(pipelineId, { now = Date.now() } = {}) {
  if (!pipelineId) return 0;
  try {
    return getDb().prepare(`
      UPDATE pipelines SET heartbeat_at = ?
      WHERE id = ? AND status IN ('running', 'pausing')
    `).run(new Date(now).toISOString(), pipelineId).changes;
  } catch { return 0; }
}

/**
 * Drop ownership/heartbeat (NULL all three) when a run reaches any terminal/paused status.
 * Unconditional by status (the run is over); best-effort.
 * @param {string} pipelineId
 */
export function clearPipelineOwnership(pipelineId) {
  if (!pipelineId) return;
  try {
    tx(() => {
      getDb().prepare(
        'UPDATE pipelines SET owner_pid = NULL, owner_host = NULL, heartbeat_at = NULL WHERE id = ?',
      ).run(pipelineId);
    });
  } catch { /* best-effort */ }
}

/**
 * Decide whether a non-terminal row is dead. Three arms (first match wins):
 *
 *   Arm 1 (PID, same-host dead detection):
 *     owner_host === thisHost && owner_pid set && pid NOT alive → dead immediately.
 *
 *   Arm 2 (Heartbeat — authoritative, handles PID reuse):
 *     heartbeat_at set && older than hbStaleMs → dead.
 *     Fires for ANY row (any host), including same-host rows where pid appears alive.
 *     A reused pid reads "alive" from probe but the original process's heartbeat went cold.
 *
 *   Arm 3 (Legacy time window, ownerless rows only):
 *     No heartbeat_at AND no owner_pid AND COALESCE(updated_at,started_at) < cutoff → dead.
 *     Preserves today's behavior for pre-v10 rows. NULL-timestamp ownerless rows return false.
 *
 * @param {object} row
 * @param {{ host:string, now:number, staleMs:number, hbStaleMs:number, pidAlive?:(pid:number)=>boolean }} ctx
 * @returns {boolean}
 */
export function isDeadOwner(row, { host, now, staleMs, hbStaleMs, pidAlive = defaultPidAlive }) {
  const ownedHere = row.owner_host === host && row.owner_pid != null;

  // Arm 1: dead pid on this host → dead immediately.
  if (ownedHere && !pidAlive(row.owner_pid)) return true;

  // Arm 2: heartbeat arm — authoritative, covers cross-host and same-host PID reuse.
  if (row.heartbeat_at != null) {
    const beat = Date.parse(row.heartbeat_at);
    return Number.isFinite(beat) && (now - beat) > hbStaleMs;
  }

  // Arm 3: legacy ownerless rows (both owner_pid and heartbeat_at are NULL).
  if (row.owner_pid == null) {
    const ts = Date.parse(row.updated_at || row.started_at || '');
    return Number.isFinite(ts) && ts < (now - staleMs);
  }

  // owner_pid set on another host, no heartbeat: leave for that host's sweep.
  return false;
}

/**
 * Flip stale/crashed non-terminal pipeline rows (created/starting/running/pausing) to
 * INTERRUPTED. Uses three-arm liveness detection (PID + heartbeat + legacy time). Rows in
 * `liveIds` (live in THIS process) are never touched. The status-guarded UPDATE also NULLs
 * the owner columns so a reclassified row is clean and idempotent.
 *
 * @param {{ host?:string, staleMs?:number, hbStaleMs?:number, liveIds?:string[], now?:number, pidAlive?:Function }} [opts]
 * @returns {{ reconciled:number, ids:string[] }}
 */
export function reconcileStaleRunning({
  host = hostname(), staleMs = staleRunMs(), hbStaleMs = heartbeatStaleMs(),
  liveIds = [], now = Date.now(),
  pidAlive = defaultPidAlive,
} = {}) {
  const live = new Set(liveIds.filter(Boolean));
  const placeholders = RECONCILE_NON_TERMINAL.map(() => '?').join(', ');

  // Read ALL non-terminal rows (no SQL time pre-filter: the PID arm must see fresh rows).
  // In normal operation non-terminal rows are near-zero, so this is cheap.
  const rows = getDb().prepare(`
    SELECT id, status, updated_at, started_at, owner_pid, owner_host, heartbeat_at
    FROM pipelines
    WHERE status IN (${placeholders})
  `).all(...RECONCILE_NON_TERMINAL);

  const candidates = rows
    .filter((r) => !live.has(r.id) && isDeadOwner(r, { host, now, staleMs, hbStaleMs, pidAlive }))
    .map((r) => r.id);
  if (candidates.length === 0) return { reconciled: 0, ids: [] };

  // Status-guarded UPDATE. Also NULLs owner columns so reclassified rows are clean.
  return tx(() => {
    const upd = getDb().prepare(
      `UPDATE pipelines SET status = ?, owner_pid = NULL, owner_host = NULL, heartbeat_at = NULL
       WHERE id = ? AND status IN (${placeholders})`);
    const flipped = [];
    for (const id of candidates) {
      const info = upd.run(INTERRUPTED_STATUS, id, ...RECONCILE_NON_TERMINAL);
      if (info.changes > 0) flipped.push(id);
    }
    return { reconciled: flipped.length, ids: flipped };
  });
}

/**
 * Load everything resume needs for one pipeline: the raw pipelines row, the parsed
 * resume_point, and the saved steps (camelCase via rowToState, sessionId included).
 * Returns null when the id is unknown. Pure read — no status checks here (callers
 * guard on row.status).
 */
export function readPipelineForResume(pipelineId) {
  const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(pipelineId);
  if (!row) return null;
  let resumePoint = null;
  try {
    resumePoint = row.resume_point ? JSON.parse(row.resume_point) : null;
  } catch {
    resumePoint = null;
  }
  const state = rowToState(row);
  return { row, resumePoint, steps: state?.steps || [] };
}

/**
 * Map a live state object to the named params of the pipelines UPSERT. JSON columns
 * are stringified here; the workspace superset collapses into workspace_meta.
 *
 * C1: the orchestrator's this.state carries projectDir but NOT projectKey
 * (orchestrator.mjs:174-191), and _persist() writes this.state verbatim. Reading
 * o.projectKey alone would write NULL on every post-creation persist → project_key
 * NOT NULL violation (swallowed by _persist's catch) → the run would freeze at its
 * 'created' snapshot. Derive from the always-present projectDir when the key is
 * absent. (Single-project AND workspace runs both carry projectDir = the primary
 * member dir.) projectKey is imported into artifacts.mjs from store.mjs.
 */
function toPipelineRow(o) {
  const workspaceMeta = o.target === 'workspace'
    ? s({
        workspaceId: o.workspaceId ?? null,
        workspaceName: o.workspaceName ?? null,
        workspaceDescription: o.workspaceDescription ?? '',
        projectKeys: Array.isArray(o.projectKeys) ? o.projectKeys : [],
        projects: Array.isArray(o.projects) ? o.projects : [],
        checkpointRefs: o.checkpointRefs ?? {},
        branches: o.branches ?? {},
        // §5.2 mode pin for WORKSPACE rows: workspace_meta is a fixed whitelist, so
        // without this entry every paused/interrupted detached workspace run silently
        // resumes in legacy shape. Read off the top-level state.runRootMode that
        // _setupRunRoot / resume() stamp. (Single-project rows need nothing — the pin
        // rides state.branch, already serialized verbatim below.)
        runRootMode: o.runRootMode ?? null,
      })
    : null;
  return {
    id: o.id,
    project_key: o.projectKey ?? (o.projectDir ? projectKey(o.projectDir) : null),
    workspace_key: o.workspaceKey ?? null,
    target: o.target ?? 'project',
    title: o.title ?? null,
    base_name: o.baseName ?? null,
    date_prefix: o.datePrefix ?? null,
    status: o.status ?? 'created',
    phase: o.phase ?? 'created',
    cycle: Number.isFinite(o.cycle) ? o.cycle : 0,
    started_at: o.startedAt ?? null,
    updated_at: o.updatedAt ?? null,
    total_cost_usd: Number.isFinite(o.totalCostUsd) ? o.totalCostUsd : 0,
    total_active_ms: Number.isFinite(o.totalActiveMs) ? o.totalActiveMs : 0,
    prompt: o.prompt ?? null,
    branch: s(o.branch),
    workspace_meta: workspaceMeta,
    stepper: s(o.stepper),
    tools: s(o.tools),
    resume_point: o.resumePoint == null ? null : s(o.resumePoint),
    source_type: o.sourceType ?? 'prompt',
    source_ref: s(o.sourceMeta),
    guardrails_id: o.guardrailsId ?? null,
  };
}

/**
 * The pipeline's {cost, active} totals for the history list, read from the DB row.
 * Normal runs carry NOT-NULL 0-defaulted totals, so when a total is > 0 it is used
 * verbatim and NO extra query runs. Only when a total is 0 do we fall back to the
 * per-step SUM/COUNT (the DB-native equivalent of the old pipelineTotalCost/
 * pipelineTotalActiveMs step-sum): COUNT=0 ⇒ null (genuinely no figures anywhere ⇒
 * the UI shows a blank chip), else the SUM (which may be a recorded $0 / 0ms). This
 * matches the legacy "recorded $0 shows, absent shows blank" semantics without
 * needing NULL in the NOT-NULL-DEFAULT-0 columns.
 * @param {object} row a pipelines DB row (total_cost_usd / total_active_ms)
 * @returns {{cost:number|null, active:number|null}}
 */
function totalsFor(row) {
  const agg = getDb().prepare(`
    SELECT COUNT(cost_usd) cc, SUM(cost_usd) sc, COUNT(active_ms) ca, SUM(active_ms) sa
    FROM pipeline_steps WHERE pipeline_id = ?
  `).get(row.id) || {};
  const cost = row.total_cost_usd > 0
    ? row.total_cost_usd
    : (agg.cc ? Math.round((agg.sc || 0) * 1e4) / 1e4 : null);
  const active = row.total_active_ms > 0
    ? row.total_active_ms
    : (agg.ca ? (agg.sa || 0) : null);
  return { cost, active };
}

/**
 * Build a history row from a pipelines DB row. Mirrors the legacy pipelineEntry
 * wire shape EXACTLY: { id, dir, title, status, startedAt, branch, sourceBranch,
 * survived, added, removed, totalCostUsd, totalActiveMs, mtime[, pr] }. Git/PR work
 * (branchExists / diffShortstat / findPrForBranch) is UNCHANGED — it still shells
 * out — and is fed the DB row's branch JSON instead of a parsed state.json.
 *  - `branch` (wire) = state.branch.feature; `sourceBranch` = state.branch.source.
 *  - `mtime` maps to updated_at parsed to ms (a SORT KEY only; never displayed).
 *  - `row.dir` is attached by the caller (the real on-disk run dir).
 *  - `guardrailsId` (additive, v14+): the run's selected guardrail set id
 *    ('permissive' = unguarded) or null for legacy rows.
 * @param {object} row a pipelines row (incl. row.dir set by the caller)
 * @param {string|null} repoDir git repo root for live branch facts
 * @param {object} opts { withPr? }
 */
async function rowToHistoryEntry(row, repoDir = null, opts = {}) {
  const branchObj = j(row.branch, null);
  const feature = branchObj?.feature ?? (typeof branchObj === 'string' ? branchObj : null);
  const source = branchObj?.source ?? null;
  let survived = false;
  let added = 0;
  let removed = 0;
  if (repoDir && feature) {
    survived = await branchExists(repoDir, feature);
    if (survived && source) {
      const d = await diffShortstat(repoDir, source, feature);
      added = d.added;
      removed = d.removed;
    }
  }
  const { cost, active } = totalsFor(row);
  const entry = {
    id: row.id,
    dir: row.dir,
    title: row.title ?? row.id,
    status: row.status ?? 'unknown',
    startedAt: row.started_at ?? null,
    branch: feature,
    sourceBranch: source,
    guardrailsId: row.guardrails_id ?? null,
    pauseReason: row.pause_reason ?? null,
    survived,
    added,
    removed,
    totalCostUsd: cost,
    totalActiveMs: active,
    mtime: row.updated_at ? (Date.parse(row.updated_at) || 0) : 0,
  };
  // Live PR state (opt-in; only the UI history endpoints request it). When gh is
  // unavailable we still set pr:null (the field is present whenever requested), so
  // callers can distinguish "looked, none" from "did not look".
  if (opts.withPr && repoDir && feature) {
    entry.pr = (await hasGh()) ? await findPrForBranch({ projectDir: repoDir, head: feature }) : null;
  }
  return entry;
}

/**
 * Map every run dir under `pipelinesDir` to its 8-hex id (parsed from the
 * basename). One readdir; used to attach the real on-disk `dir` to a DB-sourced
 * history row and to locate a run for detail/delete. Returns an empty Map when the
 * dir is absent. This is O(#runs in that key), not a git scan, and runs ONCE per
 * store key — not once per pipeline.
 * @param {string} pipelinesDir
 * @returns {Promise<Map<string,string>>} id (lowercase 8-hex) -> absolute run dir
 */
async function runDirIndex(pipelinesDir) {
  const map = new Map();
  let entries;
  try { entries = await readdir(pipelinesDir, { withFileTypes: true }); } catch { return map; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const m = DIR_ID_RE.exec(ent.name);
    if (m) map.set(m[1].toLowerCase(), join(pipelinesDir, ent.name));
  }
  return map;
}

/**
 * List all pipelines for a project (or workspace, when `workspaceKey` is set),
 * newest first. SELECTs from the pipelines table via the spec indexes
 * (idx_pipelines_project_started / idx_pipelines_workspace_started), replacing the
 * O(N) readdir + per-dir state.json parse. The wire shape (§0.6) is unchanged; the
 * real on-disk run dir is resolved by a single readdir per store key (runDirIndex).
 * @param {string} projectDir
 * @param {object} [opts] { withPr? }
 * @param {string} [workspaceKey] route to the workspace store + filter on it
 * @returns {Promise<Array>}
 */
export async function listPipelines(projectDir, opts = {}, workspaceKey) {
  const pipelinesDir = artifactPaths(projectDir, workspaceKey).pipelines;
  const dirById = await runDirIndex(pipelinesDir);
  const rows = getDb().prepare(`
    SELECT id, title, status, started_at, updated_at, total_cost_usd, total_active_ms, branch, guardrails_id,
           json_extract(resume_point, '$.pauseReason') AS pause_reason
    FROM pipelines
    WHERE ${workspaceKey ? 'workspace_key = ?' : 'project_key = ?'} AND archived_at IS NULL
    ORDER BY started_at DESC
  `).all(workspaceKey ? workspaceKey : projectKey(projectDir));
  const out = [];
  for (const row of rows) {
    row.dir = dirById.get(row.id) || join(pipelinesDir, row.id);
    out.push(await rowToHistoryEntry(row, projectDir, opts));
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** Every pipeline across every store key, newest-first, tagged with project. One
 *  SQL scan over pipelines replaces the store-tree walk; project/workspace names
 *  come from store_meta rows. The per-pipeline build (which still spawns git/gh)
 *  runs in parallel batches so a large store does not pay N serialized git
 *  round-trips. Wire format (§0.6) unchanged: project rows tag {projectKey,
 *  projectName, projectDir}; workspace rows tag {projectKey:"workspaces/<wk>",
 *  projectName, workspaceName, projectDir:primaryPath, target:'workspace'}. */
export async function listAllPipelines(opts = {}, { batchSize = 16 } = {}) {
  const rows = getDb().prepare(`
    SELECT id, project_key, workspace_key, target, title, status, started_at, updated_at,
           total_cost_usd, total_active_ms, branch, workspace_meta, guardrails_id,
           json_extract(resume_point, '$.pauseReason') AS pause_reason
    FROM pipelines
    WHERE archived_at IS NULL
    ORDER BY started_at DESC
  `).all();

  const metaCache = new Map(); // store key -> meta object (or null)
  const meta = (k) => {
    if (metaCache.has(k)) return metaCache.get(k);
    const m = readStoreMeta(k); metaCache.set(k, m); return m;
  };
  const dirIndexCache = new Map(); // pipelinesDir -> (id->dir) map

  // Phase 1 — cheap tagging + repoDir + pipelinesDir resolution per row (no git).
  const tasks = rows.map((row) => {
    const isWs = row.target === 'workspace' && row.workspace_key;
    const storeKey = isWs ? `workspaces/${row.workspace_key}` : row.project_key;
    const pipelinesDir = join(projectStorePath(storeKey), 'pipelines');
    let tag;
    let repoDir;
    if (isWs) {
      const m = meta(row.workspace_key);
      const primary = Array.isArray(m?.projectPaths) ? (m.projectPaths[0] ?? null) : null;
      tag = {
        projectKey: `workspaces/${row.workspace_key}`,
        projectName: m?.name ?? row.workspace_key,
        workspaceName: m?.name ?? row.workspace_key, // explicit field the History UI prefers
        projectDir: primary,
        target: 'workspace',
      };
      repoDir = primary;
    } else {
      const m = meta(row.project_key);
      tag = { projectKey: row.project_key, projectName: m?.name ?? row.project_key, projectDir: m?.path ?? null };
      repoDir = m?.path ?? null;
    }
    return { row, tag, repoDir, pipelinesDir };
  });

  // Phase 2 — build rows in parallel, capped at `batchSize` concurrent git/gh fans.
  const out = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const slice = tasks.slice(i, i + batchSize);
    const built = await Promise.all(slice.map(async (t) => {
      let idx = dirIndexCache.get(t.pipelinesDir);
      if (!idx) { idx = await runDirIndex(t.pipelinesDir); dirIndexCache.set(t.pipelinesDir, idx); }
      t.row.dir = idx.get(t.row.id) || join(t.pipelinesDir, t.row.id);
      const e = await rowToHistoryEntry(t.row, t.repoDir, opts);
      return Object.assign(e, t.tag); // same tag fields as before; tag has no `pr` key
    }));
    out.push(...built);
  }

  // Newest-first, with a deterministic tiebreaker so equal-mtime rows do not
  // reorder run-to-run now that build order is non-deterministic (parallel).
  out.sort((a, b) =>
    (b.mtime - a.mtime) ||
    (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Total number of NON-ARCHIVED pipelines across every project + workspace store
 * (all statuses). Backs the History sidebar count, so it must agree with what the
 * list reads show — archived rows are hidden there too. Cheap COUNT(*) — never
 * lists or loads rows. Sync (getDb().prepare(...).get()), matching this module's
 * idiom (it imports only getDb + tx, not a bare `prepare`).
 * @returns {number}
 */
export function countPipelines() {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM pipelines WHERE archived_at IS NULL').get();
  return row ? Number(row.n) : 0;
}

/**
 * Re-walk the skeleton and resolve live PR state per branch, pushed to `onBatch`
 * in parallel batches. v1 sends ONLY `pr` (state OPEN/MERGED or null) —
 * findPrForBranch already distinguishes merged-vs-open. We do NOT compute live
 * mergeability (no prMergeable call). `onBatch(items, isFinal)` is awaited so a
 * caller can broadcast incrementally; the FINAL call always carries isFinal=true
 * (even with no gh / no targets) so a client spinner provably clears.
 */
export async function enrichPipelinesPr(onBatch, { batchSize = 16 } = {}) {
  if (!(await hasGh())) { await onBatch([], true); return; } // no gh: one empty final batch
  const rows = await listAllPipelines();                     // skeleton (no withPr), parallelized
  const targets = rows.filter((r) => r.projectDir && r.branch);
  if (targets.length === 0) { await onBatch([], true); return; }
  for (let i = 0; i < targets.length; i += batchSize) {
    const slice = targets.slice(i, i + batchSize);
    const items = await Promise.all(slice.map(async (r) => {
      const pr = (await findPrForBranch({ projectDir: r.projectDir, head: r.branch })) || null;
      if (pr) persistPrState(r.id, pr);   // positive observations only (null never clears)
      return { projectKey: r.projectKey, id: r.id, pr };
    }));
    await onBatch(items, i + batchSize >= targets.length); // (items, isFinal)
  }
}

/**
 * Reconstruct one state.steps[] entry from a pipeline_steps row. Inverse of the
 * step INSERT in writeState. running_since is stored as TEXT (epoch-ms) and comes
 * back as a Number (null when paused); optional fields (phase/cycle/status/
 * startedAt/updatedAt) collapse to undefined when null so the shape matches what
 * the orchestrator emitted; nodeId/stepIndex are present only when set.
 */
function stepRowToStep(r) {
  const step = {
    key: r.key, phase: r.phase ?? undefined, cycle: r.cycle ?? undefined,
    status: r.status ?? undefined, startedAt: r.started_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    activeMs: r.active_ms ?? 0,
    runningSince: r.running_since == null ? null : Number(r.running_since),
    costUsd: r.cost_usd ?? 0,
    sessionId: r.session_id ?? undefined,
    skills: j(r.skills, []),
    graphifyCount: r.graphify_count ?? undefined,
  };
  if (r.node_id != null) step.nodeId = r.node_id;
  if (r.step_index != null) step.stepIndex = r.step_index;
  return step;
}

/**
 * Reconstruct the full state object (the old state.json shape the UI consumed)
 * from a pipelines row + its pipeline_steps rows. Inverse of toPipelineRow + the
 * step INSERT. projectDir is recovered from the project's store_meta row (the old
 * state carried state.projectDir; the server's PR route reads it). The workspace
 * superset is spread back onto the top level from workspace_meta.
 * @param {object|null} row
 * @returns {object|null}
 */
function rowToState(row) {
  if (!row) return null;
  const state = {
    id: row.id,
    title: row.title ?? null,
    projectKey: row.project_key ?? null,
    status: row.status ?? 'unknown',
    phase: row.phase ?? null,
    cycle: row.cycle ?? 0,
    startedAt: row.started_at ?? null,
    updatedAt: row.updated_at ?? null,
    totalCostUsd: row.total_cost_usd ?? 0,
    totalActiveMs: row.total_active_ms ?? 0,
    prompt: row.prompt ?? null,
    baseName: row.base_name ?? null,
    datePrefix: row.date_prefix ?? null,
    branch: j(row.branch, null),
    stepper: j(row.stepper, null),
    tools: j(row.tools, null),
    guardrailsId: row.guardrails_id ?? null,
    steps: getDb().prepare(`
      SELECT key, node_id, phase, step_index, cycle, status, started_at, updated_at,
             active_ms, running_since, cost_usd, session_id, skills, graphify_count
      FROM pipeline_steps WHERE pipeline_id = ? ORDER BY rowid
    `).all(row.id).map(stepRowToStep),
    subAgents: listSubAgents(row.id),
  };
  const meta = readStoreMeta(row.project_key);
  state.projectDir = meta?.path ?? null;
  // Workspace superset: spread workspace_meta back onto the top level + target.
  if (row.target === 'workspace') {
    const wm = j(row.workspace_meta, {}) || {};
    state.target = 'workspace';
    state.workspaceKey = row.workspace_key ?? null;
    state.workspaceId = wm.workspaceId ?? row.workspace_key ?? null;
    state.workspaceName = wm.workspaceName ?? null;
    state.workspaceDescription = wm.workspaceDescription ?? '';
    state.projectKeys = wm.projectKeys ?? [];
    state.projects = wm.projects ?? [];
    state.checkpointRefs = wm.checkpointRefs ?? {};
    state.branches = wm.branches ?? {};
    state.runRootMode = wm.runRootMode ?? null;   // §5.2 mode pin (absent ⇒ legacy)
    // For a workspace run, the PR/branch route reads the primary projectDir from meta.
    const wmeta = readStoreMeta(row.workspace_key);
    if (!state.projectDir) state.projectDir = Array.isArray(wmeta?.projectPaths) ? (wmeta.projectPaths[0] ?? null) : null;
  }
  return state;
}

/**
 * Rebuild the pipeline.md-format audit document from the row + pipeline_events,
 * reproducing createPipeline's header (artifacts createPipeline) + appendAudit's
 * "- `ts` text" timeline lines (A7), so a History detail view renders identically
 * to today. The header's `## Prompt` body uses the DB prompt column; the `project`
 * line uses the store_meta path.
 * @param {object} row a pipelines row
 * @returns {string}
 */
function buildAuditMarkdown(row) {
  const events = getDb().prepare(
    'SELECT ts, text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(row.id);
  const header =
    `# Pipeline: ${row.title ?? row.id}\n\n` +
    `- **id**: ${row.id}\n` +
    `- **project**: ${(readStoreMeta(row.project_key)?.path) ?? ''}\n` +
    `- **started**: ${row.started_at ?? ''}\n` +
    `- **prompt file**: prompt.md\n\n` +
    `## Prompt\n\n` +
    (row.prompt && row.prompt.trim() ? row.prompt.trim() + '\n' : '_(empty prompt)_\n') +
    `\n## Timeline\n\n`;
  const lines = events.map((e) => `- \`${e.ts}\` ${e.text}\n`).join('');
  return header + lines;
}

/**
 * Find a pipelines row by store key + (short id OR run-dir basename). Maps a store
 * key back to the WHERE column: "workspaces/<wk>" -> workspace_key=<wk>; otherwise
 * project_key=<key>. Tries a direct id hit first, then falls back to extracting the
 * trailing 8-hex from a run-dir basename like "<DD-MM-YY>-<slug>-<id>".
 * @param {string} key
 * @param {string} id
 * @returns {object|null}
 */
export function lookupPipelineRow(key, id) {
  const isWs = typeof key === 'string' && key.startsWith('workspaces/');
  const col = isWs ? 'workspace_key' : 'project_key';
  const val = isWs ? key.slice('workspaces/'.length) : key;
  let row = getDb().prepare(`SELECT * FROM pipelines WHERE ${col} = ? AND id = ?`).get(val, id);
  if (row) return row;
  const m = DIR_ID_RE.exec(String(id));
  if (m) row = getDb().prepare(`SELECT * FROM pipelines WHERE ${col} = ? AND id = ?`).get(val, m[1].toLowerCase());
  return row || null;
}

/**
 * The DB-backed lookups `sweepRunRoots` (worktree.mjs) needs, in ONE place shared by
 * both callers — `ui/server.mjs`'s boot sweep and the `worca doctor` subcommand.
 *
 * The sweep helper itself is deliberately DB-FREE (worktree.mjs is a leaf that must
 * not depend on the DB layer; git-info.mjs documents the same layering rule), so
 * every pipelines-row read is injected from here:
 *   statusOf(id)       -> the row status, or null when the row is VERIFIABLY gone
 *                         (deleted run). THROWS when the lookup itself fails.
 *   membersOf(id)      -> [{ projectKey, projectDir, worktreeDir }] from the SAME
 *                         JSON columns pipeline-delete.mjs consumes today
 *                         (workspace: state.branches x state.projects; single: the
 *                         state.branch scalar x the store_meta path). Used only when
 *                         `run.json` is missing. THROWS when the lookup fails.
 *   pipelineDirOf(id)  -> the durable artifact dir, for rescue-before-remove.
 *
 * THREE STATES, NEVER TWO. A DB *failure* must never masquerade as "no pipelines
 * row", because the row-less disposition is RECLAIM: if an unopenable sqlite file
 * (corrupt DB, ABI mismatch after a Node upgrade, bad permissions) collapsed to
 * null, the very next boot would force-remove the worktrees and rm -rf the run roots
 * of every `paused`/`interrupted` run — with the rescue triple skipped too, since
 * that only runs when a row exists. That is exactly the §8.12 catastrophe the
 * keep-set exists to prevent, reintroduced on the error path. So these callbacks
 * deliberately DO NOT catch: the throw reaches sweepRunRoots, which skips that run
 * root untouched and logs loudly.
 * @returns {{statusOf:Function, membersOf:Function, pipelineDirOf:Function}}
 */
export function runRootSweepLookups() {
  // No try/catch by design (see above): only a successful query that matched nothing
  // returns null. Any DB-level failure propagates to the caller.
  const rowById = (id) => getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(id) || null;
  return {
    statusOf: (id) => rowById(id)?.status ?? null,
    membersOf: async (id) => {
      const row = rowById(id);
      if (!row) return null;
      // rowToState issues further queries (steps, sub-agents, store meta); a failure
      // there is also a lookup failure, not "this run has no members", so it throws.
      const state = rowToState(row);
      if (!state) return null;
      if (state.target === 'workspace') {
        const branches = state.branches && typeof state.branches === 'object' ? state.branches : {};
        const dirByKey = new Map((Array.isArray(state.projects) ? state.projects : [])
          .map((p) => [p.projectKey, p.projectDir]));
        return Object.entries(branches)
          .map(([pk, br]) => ({ projectKey: pk, projectDir: dirByKey.get(pk) || null, worktreeDir: br?.worktreeDir || null }))
          .filter((m) => m.projectDir && m.worktreeDir);
      }
      const projectDir = state.projectDir || null;
      const worktreeDir = state.branch?.worktreeDir || null;
      if (!projectDir || !worktreeDir) return [];
      return [{ projectKey: row.project_key || null, projectDir, worktreeDir }];
    },
    pipelineDirOf: async (id) => {
      const row = rowById(id);
      if (!row) return null;
      // Unlike the two above, this one may degrade: it is consulted only AFTER the
      // disposition is decided, and it only names where the rescue copies go. A
      // readdir failure costs the durable copies, never a removal decision.
      try { return await runDirForRow(row); } catch { return null; }
    },
  };
}

/**
 * The DB-backed lookups `sweepLegacyWorktrees` / `sweepLegacyWorktreesAll`
 * (worktree.mjs) need, in ONE place shared by both callers — `ui/server.mjs`'s boot
 * maintenance and the `worca doctor` subcommand. The exact mirror of
 * `runRootSweepLookups` above, for the OTHER sweep (§6 Phase 7 / §8.12).
 *
 * ONE snapshot query, not a per-candidate lookup, because the legacy sweep needs two
 * things off the same three columns: the status of every candidate id (each legacy
 * worktree dir is named by its pipelineId, `worktree.mjs`), and the set of worktree
 * paths ANY row still claims — the "still referenced" skip that protects a run whose
 * path was recorded under a different id shape.
 *
 * THREE STATES, NEVER TWO — and the snapshot is what makes that trivially true here:
 * either the read succeeds, in which case an id that is missing from it is
 * VERIFIABLY row-less, or the read throws out of this factory and the caller sweeps
 * nothing at all. A DB failure can therefore never masquerade as "no pipelines row".
 * (For the legacy sweep row-less means quarantine-log, so the blast radius is smaller
 * than sweepRunRoots' reclaim — but "the DB is broken, so every worktree of every
 * registered project is unclassifiable" is a report, not a disposition.)
 *
 * Referenced paths are read from the same JSON columns pipeline-delete.mjs consumes:
 * a single-project run records `branch.worktreeDir`; a workspace run records one
 * `workspace_meta.branches[<projectKey>].worktreeDir` per member.
 * @returns {{statusOf:Function, referencedPaths:Set<string>}}
 */
export function legacySweepLookups() {
  // No try/catch by design (see above): a DB-level failure propagates to the caller.
  const rows = getDb().prepare('SELECT id, status, branch, workspace_meta FROM pipelines').all();
  const status = new Map();
  const referencedPaths = new Set();
  for (const row of rows) {
    status.set(row.id, row.status ?? null);
    const branch = j(row.branch, null);
    if (branch?.worktreeDir) referencedPaths.add(branch.worktreeDir);
    for (const br of Object.values(j(row.workspace_meta, null)?.branches || {})) {
      if (br?.worktreeDir) referencedPaths.add(br.worktreeDir);
    }
  }
  return { statusOf: (id) => (status.has(id) ? status.get(id) : null), referencedPaths };
}

/**
 * Read a single pipeline by id, returning its reconstructed state and audit
 * markdown (both rebuilt from the DB). Returns null when no pipeline with that id
 * exists (so callers can map a not-found to a 404 rather than a 500). Resolves the
 * project store key from projectDir and delegates to readPipelineByKey.
 * @param {string} projectDir
 * @param {string} id
 * @returns {Promise<{state:object|null, auditMarkdown:string}|null>}
 */
export async function readPipeline(projectDir, id) {
  return readPipelineByKey(projectKey(projectDir), id);
}

/**
 * Read a pipeline directly from a store key (project-agnostic), reconstructing
 * { state, auditMarkdown } from the DB. Matches by pipeline short-id or by run-dir
 * basename (the old readers matched both). Returns null when the key or id is
 * unknown (so the API maps it to a 404). Accepts a workspace composite key
 * "workspaces/<workspaceKey>".
 */
export async function readPipelineByKey(key, id) {
  const row = lookupPipelineRow(key, id);
  if (!row) return null;
  // Layer-1 results + (if generated) the Layer-2 overview, read from the run dir.
  // File-name literals inlined (not imported from results.mjs) to avoid a load-order
  // cycle: results.mjs imports recordArtifact/resolvePipelineId from this module.
  const dir = await runDirForRow(row);
  const results = await readJsonFile(join(dir, 'results.json'));
  const overview = await readJsonFile(join(dir, 'overview.json'));
  return {
    state: rowToState(row),
    auditMarkdown: buildAuditMarkdown(row),
    artifacts: await listArtifacts(row.id), // [{kind, relPath}] — drives the Live-logs dropdown (project + workspace)
    results,
    overview,
    ...readPipelineExtras(row.id),
  };
}

/** Local helper: read + JSON-parse a file, null on any failure. */
async function readJsonFile(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

/**
 * Read a run's persisted live-log NDJSON as text, by store key + id. Resolves the
 * on-disk run dir via runDirIndex (a Map<id, absolute run dir>), the same readdir
 * index listPipelines/listAllPipelines use. Workspace runs pass key
 * "workspaces/<workspaceKey>". Returns null when the run or file is unknown (so the
 * API maps it to a 404). Best-effort: any FS error -> null.
 * @param {string} key  project store key, or "workspaces/<workspaceKey>"
 * @param {string} id
 * @returns {Promise<string|null>}
 */
export async function readRunLogText(key, id) {
  const row = lookupPipelineRow(key, id);
  if (!row) return null;
  const isWs = typeof key === 'string' && key.startsWith('workspaces/');
  const storeRoot = isWs ? workspaceStorePath(key.slice('workspaces/'.length)) : projectStorePath(key);
  const pipelinesDir = join(storeRoot, 'pipelines');
  const dirById = await runDirIndex(pipelinesDir);
  const runDir = dirById.get(row.id) || join(pipelinesDir, row.id);
  try {
    return await readFile(join(runDir, RUN_LOG_FILE), 'utf8');
  } catch {
    return null; // no log file (older run / never bound)
  }
}

/**
 * Resolve a pipeline row's absolute on-disk run dir (mirrors readRunLogText).
 * Workspace rows (target==='workspace') live under the workspace store namespace,
 * keyed by workspace_key; project rows live under their project store namespace.
 * @returns {Promise<string>}
 */
export async function runDirForRow(row) {
  const isWs = row.target === 'workspace' || !!row.workspace_key;
  const storeRoot = isWs
    ? workspaceStorePath(row.workspace_key)
    : projectStorePath(row.project_key);
  const pipelinesDir = join(storeRoot, 'pipelines');
  const dirById = await runDirIndex(pipelinesDir);
  return dirById.get(row.id) || join(pipelinesDir, row.id);
}

/** Read a pipeline-local artifact file as text, or null if absent. */
export async function readRunArtifactText(key, id, relPath) {
  const row = lookupPipelineRow(key, id);
  if (!row) return null;
  const dir = await runDirForRow(row);
  try { return await readFile(join(dir, relPath), 'utf8'); } catch { return null; }
}

/** Read + JSON-parse a pipeline-local artifact, or null. */
export async function readRunArtifactJson(key, id, relPath) {
  const txt = await readRunArtifactText(key, id, relPath);
  if (txt == null) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

/**
 * List pipelines for a workspace from its OWN store namespace
 * (store/workspaces/<workspaceKey>/pipelines), newest-first. `primaryDir` supplies
 * live branch facts (best-effort, primary repo only). Mirrors listPipelines.
 * @param {string} workspaceKey
 * @param {string} [primaryDir]
 * @param {object} [opts]
 */
export async function listWorkspacePipelines(workspaceKey, primaryDir = null, opts = {}) {
  const pipelinesDir = join(workspaceStorePath(workspaceKey), 'pipelines');
  const dirById = await runDirIndex(pipelinesDir);
  const rows = getDb().prepare(`
    SELECT id, title, status, started_at, updated_at, total_cost_usd, total_active_ms, branch, guardrails_id,
           json_extract(resume_point, '$.pauseReason') AS pause_reason
    FROM pipelines WHERE workspace_key = ? AND archived_at IS NULL ORDER BY started_at DESC
  `).all(workspaceKey);
  const out = [];
  for (const row of rows) {
    row.dir = dirById.get(row.id) || join(pipelinesDir, row.id);
    out.push(await rowToHistoryEntry(row, primaryDir, opts));
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * Read a single workspace pipeline by id, reconstructed from the DB. Resolves the
 * composite "workspaces/<workspaceKey>" store key and delegates to
 * readPipelineByKey (which filters on workspace_key), so there is no
 * path-traversal surface (the server validates the key against WORKSPACE_ID_RE).
 * Returns null when the workspace or id is unknown.
 */
export async function readWorkspacePipeline(workspaceKey, id) {
  return readPipelineByKey(`workspaces/${workspaceKey}`, id);
}
