// test/helpers/db-seed.mjs
// DB-aware seeding for tests that previously wrote store/<key>/pipelines/<id>/state.json
// by hand. After the node:sqlite migration the readers (listPipelines, listAllPipelines,
// readPipelineByKey, deletePipeline, the /api/history|runs endpoints) read the DB, not the
// FS — so seeds must go through the SAME service writers production uses. _resetForTests()
// is the caller's responsibility (it owns WORCA_HOME); these helpers only write rows.
//
// A6(2)/A15(3): seedPipeline / seedWorkspacePipeline route through the PRODUCTION writers
// (createPipeline + writeState) so a fixture's row shape can NEVER drift from the schema —
// the row is whatever the orchestrator itself would persist.
//
// ── A15(3) id contract (PINNED — the prior canonical comment was wrong) ──────────────────
// createPipeline mints its OWN short 8-hex id and INSERTs the pipelines row under THAT id.
// writeState(dir, {...state, id}) then UPSERTs keyed on `obj.id` — and that id IS
// createPipeline's MINTED id (we pass it through verbatim; `state.id`, if any, is dropped).
// writeState's ON CONFLICT(id) clause updates only the run-mutable columns, so this second
// write fills in status/phase/cycle/cost/active/branch/steps/etc. WITHOUT clobbering the
// creation-immutable identity columns (project_key/title/prompt/started_at) createPipeline
// owns. CONSEQUENCE FOR CALLERS: the persisted id is the RETURNED id — callers MUST use the
// `{ id }` these helpers return for every later lookup/assertion; they must NOT hardcode an
// id or read it from the `state` they passed. `state.id` is vestigial; drop it from seeds.

import { createPipeline, writeState } from '../../src/core/artifacts.mjs';
import { projectKey } from '../../src/core/store.mjs';
import { getDb, tx } from '../../src/core/db.mjs';

/**
 * Seed one finished single-project pipeline through the production writers. Returns
 * { id, dir, key } where `id` is createPipeline's MINTED short id (NOT any `state.id`
 * the caller passed) and `key` is projectKey(projectDir). `state` is merged over the
 * createPipeline defaults and persisted via writeState, so steps[]/totalCostUsd/
 * totalActiveMs/branch all land in pipelines + pipeline_steps exactly as the
 * orchestrator would write them.
 *
 * @param {string} projectDir  a real or throwaway dir (only its projectKey is used)
 * @param {object} [state]     fields to persist (title/status/steps/branch/…); any `id`
 *                             is ignored — the minted id is authoritative.
 * @returns {Promise<{id:string, dir:string, key:string}>}
 */
export async function seedPipeline(projectDir, state = {}) {
  const key = projectKey(projectDir);
  const { id, dir } = await createPipeline(projectDir, {
    prompt: state.prompt || 'seed',
    title: state.title || state.id || 'seed',
  });
  // Persist the full row keyed on createPipeline's MINTED id (A15(3)). writeState
  // UPSERTs on obj.id and only touches the run-mutable columns, so passing `id` here
  // is correct AND it never clobbers the identity columns createPipeline INSERTed.
  // Carry projectKey so toPipelineRow binds the NOT-NULL project_key on the INSERT
  // arm of the UPSERT (it matches createPipeline's key, so ON CONFLICT(id) fires).
  await writeState(dir, { projectKey: key, ...state, id });
  return { id, dir, key };
}

/**
 * Seed one finished WORKSPACE pipeline through the production writers, under the
 * workspace store namespace. createPipeline's workspace path writes the store_meta
 * row + the §5.2 workspace superset (collapsed into workspace_meta); writeState then
 * persists the run-mutable columns + steps. Returns { id, dir } with the MINTED id.
 *
 * @param {string} primaryDir    the primary member dir (projects[0])
 * @param {string} workspaceKey   wks-…
 * @param {object} [state]        merged + persisted (title/status/steps/branch/…); `id`
 *                                is ignored — the minted id is authoritative.
 * @param {Array<{projectKey,projectDir,projectName}>} [projects]  member set
 * @returns {Promise<{id:string, dir:string}>}
 */
export async function seedWorkspacePipeline(primaryDir, workspaceKey, state = {}, projects) {
  const primaryKey = projectKey(primaryDir);
  const { id, dir } = await createPipeline(primaryDir, {
    prompt: state.prompt || 'seed',
    title: state.title || state.id || 'seed',
    workspaceKey,
    workspaceId: workspaceKey,
    workspaceName: state.workspaceName || 'WS',
    projects,
  });
  // project_key is NOT NULL; createPipeline stamps it = primary member's key. Carry
  // it (and the ws discriminators) so writeState's INSERT arm binds it and the row's
  // workspace superset round-trips through workspace_meta.
  await writeState(dir, { projectKey: primaryKey, ...state, id, workspaceKey, target: 'workspace' });
  return { id, dir };
}

// ── seedPipelineRow — narrow raw-INSERT, RETAINED for the delete/clarify fixtures ────────
// NOT for history/list/read seeds (those use seedPipeline above). The three callers
// test/pipeline-delete.test.mjs, test/delete-pipeline-api.test.mjs and the clarify-DB block
// in test/clarify.test.mjs need a pipelines row keyed on a CALLER-CHOSEN id that pairs with
// a HAND-BUILT on-disk run dir / shared plan-review markdown / artifacts index (then assert
// those EXACT paths are unlinked, or write the clarify row for that exact id). seedPipeline's
// minted-id + today()-dated dir contract is fundamentally incompatible with that pattern
// (it would orphan the hand-built fixture). Those three are Phase-3-owned delete/clarify
// tests, out of the Phase-6 seed-helper re-point scope (A6(3): no double-edit of already
// migrated tests), so they keep this direct insert. The column list is verified to match
// writeState/toPipelineRow as of Phase 3 — keep it in sync if the row shape changes.
export function seedPipelineRow(row) {
  const {
    id, projectKey = 'proj-00000001', workspaceKey = null, target = 'project',
    title = null, baseName = null, datePrefix = null, status = 'done', phase = 'done',
    cycle = 0, startedAt = null, updatedAt = startedAt, totalCostUsd = 0, totalActiveMs = 0,
    prompt = null, branch = null, workspaceMeta = null, stepper = null, tools = null,
    ownerPid = null, ownerHost = null, heartbeatAt = null, // v10 liveness
    steps = [],
  } = row;
  tx(() => {
    getDb().prepare(`
      INSERT INTO pipelines (id, project_key, workspace_key, target, title, base_name,
        date_prefix, status, phase, cycle, started_at, updated_at, total_cost_usd,
        total_active_ms, prompt, branch, workspace_meta, stepper, tools,
        owner_pid, owner_host, heartbeat_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, projectKey, workspaceKey, target, title, baseName, datePrefix, status, phase,
      cycle, startedAt, updatedAt, totalCostUsd, totalActiveMs, prompt,
      branch == null ? null : JSON.stringify(branch),
      workspaceMeta == null ? null : JSON.stringify(workspaceMeta),
      stepper == null ? null : JSON.stringify(stepper),
      tools == null ? null : JSON.stringify(tools),
      ownerPid, ownerHost, heartbeatAt,
    );
    const ins = getDb().prepare(`
      INSERT INTO pipeline_steps (pipeline_id, key, node_id, phase, step_index, cycle,
        status, started_at, updated_at, active_ms, running_since, cost_usd)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const st of steps) {
      ins.run(id, st.key, st.nodeId ?? null, st.phase ?? null, st.stepIndex ?? null,
        st.cycle ?? null, st.status ?? null, st.startedAt ?? null, st.updatedAt ?? null,
        st.activeMs ?? 0, st.runningSince ?? null, st.costUsd ?? 0);
    }
  });
}
