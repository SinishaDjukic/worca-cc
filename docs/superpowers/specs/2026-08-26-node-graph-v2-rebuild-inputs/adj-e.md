# Agent E — Persistence, migration V23, seeds & overlays (adjudication, 2026-08-26)
Empirical basis: dev read-only + scratch copy of the user's live ~/.worca-cc/worca-cc.db (schema 22) + throwaway scripts …/scratchpad/agent-e/{verify-seeds.mjs, verify-v23.mjs} (all assertions pass).

## 0. How the "7 saved templates" exist — NOT code-seeded
Grep hits only test fixtures (test/migrate-fs-to-db.test.mjs:80 'wf_quick-fix', test/upgrade-integration.test.mjs:89 'wf_quickfix', name 'Quick Fix' in workflows*.test.mjs/api-workflows.test.mjs/ui-composer.test.mjs). Only built-in is DEFAULT_WORKFLOW (workflows.mjs:91); writeWorkflow mints wf_${slugify(name)} (:242) → the 7 were this user's own composer saves, first as ~/.worca-cc/workflows/*.json, imported by migrate-fs-to-db.mjs:520. Old branch V17 comment: "only 5 of the 7 exist in the reference DB, and v17 is not a seeder".
LIVE DB TODAY: 0 of the 7 exist. workflows holds 6 v1 rows: wf_quick-fix-v1, wf_quick-with-decompose-v1, wf_decompose-implement, wf_implement-only, wf_simple-plan (active), wf_full-v212 (2026-08-26, fingerprints EXACTLY to wf_full's v1 shape). DB carries old-branch V17/V18 residue: workflows.graph column, config_workflow_wires (rows wf_no-clarify w3/w10 = 6; PK order (workflow_id, project_key, wire_id)), pipeline_steps.execution_id/exec_result/exec_trigger, pipelines.outcome, config_workflow_nodes rows for all 7 seed ids ALREADY keyed n_* (orphaned overlays). Consequences: (a) id-based "re-seed in place" is a no-op here — V23 must INSERT; (b) divergent-stamp case — every DDL must be IF-NOT-EXISTS/gap-heal (INCREMENTAL_COLUMNS/INCREMENTAL_TABLES machinery); (c) id collisions are REAL for other users (anyone naming a template "Full" owns wf_full) → id-match must be fingerprint-guarded.

## 1. Storage — workflows.graph TEXT
```sql
ALTER TABLE workflows ADD COLUMN graph TEXT;        -- JSON {nodes, wires, canvas?}; NULL on v1 rows
ALTER TABLE workflows ADD COLUMN archived_at TEXT;  -- ISO; NULL = live
CREATE TABLE IF NOT EXISTS config_workflow_wires (
  project_key TEXT NOT NULL, workflow_id TEXT NOT NULL, wire_id TEXT NOT NULL,
  max_cycles INTEGER NOT NULL, PRIMARY KEY (project_key, workflow_id, wire_id));
```
graph stores ONLY {nodes, wires, canvas?} (id/name/domain live in row columns). Converted rows KEEP steps/feedbacks JSON (reversible). INCREMENTAL_COLUMNS.workflows += { graph:'TEXT', archived_at:'TEXT' }, pipeline_steps += { execution_id:'TEXT' } (+ engine plan's), INCREMENTAL_TABLES.config_workflow_wires = DDL.
rowToTpl (workflows.mjs:206): base {id,name,version,domain,origin,createdAt,updatedAt,archivedAt}; version===2 → +{nodes, wires, canvas?} from graph; else +{steps, feedbacks}. writeWorkflow(tpl) dispatches on Array.isArray(tpl.nodes) → v2 UPSERT (version=2, graph=?, steps='[]', feedbacks='[]', archived_at=NULL — saving over an archived slug id un-archives). listWorkflows({includeArchived=false}) → WHERE archived_at IS NULL; readWorkflow(id,{includeArchived=false}) → null when archived. deleteWorkflow unchanged (deletes archived rows too). removePluginWorkflows unchanged.

## 2. V23 migration (cut-over plan)
applySchemaV23(db) in the ladder; reconcileV1Workflows(db) exported + idempotent so maybeMigrateFromFs calls it after its inserts (fs import runs AFTER migrate, db.mjs:70). Seeds inserted only on an EXISTING DB (current >= 1); fresh DBs stay Default-only.
```
migrate(db):
  if user_version >= 23 → reconcileSchema; return
  if 0 < user_version < 23 and !exists(<db>.pre-v23.bak): db.exec("VACUUM INTO '<db>.pre-v23.bak'")   // BEFORE BEGIN; fatal on throw
  BEGIN IMMEDIATE … if current < 23: applySchemaV23(db, {existing: current >= 1}) … PRAGMA user_version=23; COMMIT
applySchemaV23(db, {existing}):
  repairSchemaGaps(db, schemaGaps(db))                       // graph, archived_at, wires table, execution_id — heals residue
  report = reconcileV1Workflows(db, {seed: existing})
  report.sweptRuns = sweepV1PausedRuns(db)
  INSERT OR IGNORE store_meta('migration:v23','migration', JSON report)
reconcileV1Workflows(db, {seed}):
  guard: workflows has version/steps/feedbacks/created_at/updated_at/graph/archived_at, else return
  for row in SELECT … WHERE version=1 AND archived_at IS NULL:
    shape = origin LIKE 'plugin:%' ? null : SHAPES.get(fingerprint(steps, feedbacks))
    if !shape: UPDATE archived_at=now; audit("archived v1 workflow <id> — no v2 re-expression"); continue
    nodes = shape.seed.nodes with steps[i][0].defaults merged into config of stageNodeIds[i]   // 88851499 defaults → node.config
    UPDATE version=2, graph={nodes,wires}, updated_at=now WHERE id AND version=1            // id/name/created_at/origin/steps kept
    for i: UPDATE OR IGNORE config_workflow_nodes SET node_id=stageNodeIds[i] WHERE workflow_id=row.id AND node_id=steps[i][0].id
    for fb: wid = resolveWireId(seed, stageNode(fb.from), stageNode(fb.to))   // unique maxCycles wire, valve-followed through and/or/combine
            wid ? INSERT OR IGNORE config_workflow_wires SELECT project_key,workflow_id,wid,max_cycles FROM config_workflow_feedbacks WHERE workflow_id,fb_id
                : audit("… matched no unique loop wire — overlay not migrated")
  if seed: for t in SEED_TEMPLATES: row exists? (archived → audit "seed skipped — id held by archived template") : INSERT OR IGNORE (version 2, graph, created_at=t.createdAt, updated_at=now, origin NULL)
  static maps (idempotent): NODE_ID_MAP[*] → UPDATE OR IGNORE node_id; FB_WIRE_MAP[*] → INSERT OR IGNORE wires   // 7 seed ids + wf_default (s_clarify/s0_0.. → n_*)
  project_config.active_workflow_id → archived row: SET 'wf_default' + audit
sweepV1PausedRuns(db): status='paused' AND resume_point.version != 2 → status='interrupted', resume_point=NULL,
  INSERT pipeline_events(id, now, 'paused on the v1 engine before the graph rework — not resumable') + stderr audit
```
Decisions:
- Fingerprint = single-node stages' keys joined '>' + sorted (fromIdx->toIdx) pairs; id-independent. 7 shapes pairwise distinct; wf_default's shape equals wf_clarify-implement (excluded from the match table). Fingerprint-CONVERSION of any v1 row matching one of the 7 shapes = scoped extension of decision #8 (8-entry lookup, not a converter). Rescues user's wf_full-v212 (→ Full graph) and active wf_simple-plan (→ Quick Fix graph, overlays s0_0/s1_0/s2_0 → n_plan/n_impl/n_review preserved); id collisions safe: a row named "Full" with different topology is ARCHIVED, seed for that id skipped with audit. MAIN LOOP MAY VETO.
- wfp_* rows: always archived (never converted) — SHA-only snapshot; re-import of v2 template with same id un-archives via UPSERT.
- Archive column = archived_at TEXT (matches pipelines.archived_at). Refusals: readWorkflow default null; POST /api/run (server.mjs:1062), worca --workflow, ask/proposal.mjs:105 answer `workflow "X" was archived by the v2 upgrade (v1 template, not runnable) — pick a v2 pipeline or rebuild it in the Composer`; GET /api/workflows/:id 404 with that message; GET /api/workflows?archived=1 lists archived (optional composer "Archived (N)" footer with delete).
- Overlay resolver: dynamic (from,to) over the seed graph (valve-following and/or/combine, max 4 hops) is the authority; FB_WIRE_MAP = pinned expectation asserted equal in a test (verified equal for all 8) + fallback where no row topology exists. "wf_clarify-implement swapped fb order" claim MOOT (swapped-order fixture resolved w9=4, w5=5 correctly).
- project_config.steps legacy per-role overlay: NOT migrated. Keep wf_default-only path (resolveWorkflow:380) addressed by agent KEY onto GRAPH_DEFAULT_WORKFLOW's one-node-per-key agents.
- node.defaults (88851499) → node.config during conversion; setWorkflowNodeDefaults becomes graph.nodes[].config rewrite (4 tunables).
- Paused v1 runs: swept at V23 (after cut-over no v1 template runnable; v1 resume re-resolves the template row); also from bootMaintenance (ui/server.mjs:4830) and CLI reconcile sites (worca-cc.mjs:583,737) for divergently-stamped DBs. resume_point NULLed (removePluginWorkflows reference guard plugin-workflows.mjs:123-129 can't be stranded); reason in pipeline_events; run-monitor hides Resume when resume_point null. Resume paths refuse rp.version !== 2 (server :1501, CLI :749).
- Audit: auditV23 = m => console.warn('[worca] V23: ' + m) + store_meta('migration:v23') JSON report (UI one-time notice "N pipelines archived by the v2 upgrade") + pipeline_events lines.
- Backup: VACUUM INTO '<db>.pre-v23.bak' outside the tx, existing DBs only, skipped if present, fatal on failure (verified under node:sqlite).
- Idempotency: convert only version=1 AND archived_at IS NULL; INSERT OR IGNORE seeds/wires/store_meta; UPDATE OR IGNORE renames; sweep only paused. Verified: second run = byte-identical snapshot.
Dry-run on live-DB copy: 4 rows archived, wf_simple-plan + wf_full-v212 converted, 7 seeds inserted (orphaned n_* overlays re-attach; wf_no-clarify wires w3/w10=6 preserved), active untouched, 2 paused v1 runs swept, errored run untouched, backup valid. Synthetic fixture: id-collision archived + seed skipped, plugin row archived despite matching shape, parallel-stage row archived, wf_default s_clarify/s2_0 → n_clarify/n_impl, fb_refine/fb_review → w5=2/w9=4, archived-active reset, minimal workflows(id,name) seed no-ops, fresh DB unseeded.

## 3. Seeds carry-over — NO MISMATCH
The 7 *.v2.json files are byte-identical to old:src/core/graph/seed-templates.mjs constants; overlay-maps.json equals NODE_ID_MAP/FB_WIRE_MAP. All 8 graphs satisfy Amendment f: pin counts 11/17, 9/13, 9/14, 10/15, 5/6, 7/10, 6/8, 7/10; one Task + one End; End fed from webui.pass else reviewer.pass; reviewer.pass → check.await where checklist exists; no start ports; V7 single-wire; OR valve only on wf_full/wf_provided-plan/wf_full-no-decompose with two maxCycles:3 in-wires + config-less out → n_impl.fix.
Home: src/core/graph/builtin-workflows.mjs (deepFreeze, GRAPH_DEFAULT_WORKFLOW) + src/core/graph/seed-templates.mjs (SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP), copied verbatim; tests import shipping constants. LAND EARLY: pure constants + graph-seed-templates.test.mjs (structural checks, fingerprint uniqueness, resolver == FB_WIRE_MAP); zero-errors/zero-warnings validateGraph drift guard when validator lands.

## 4. Version-pin sweep — ZERO literal pins
grep returns only two COMMENTS (ask-db-schema.test.mjs:80, diff-comments-schema.test.mjs:72). SCHEMA_VERSION exported; 21 files use it symbolically. Behavioral fallout at V23: tests stamping 15–21 on MINIMAL seeds now run V23 → column guard no-op (verified); db.test.mjs:74-126 EXPECTED_TABLES presence-only + length 18 → add config_workflow_wires, bump to 19; no test asserts exact workflows column list. Move in cut-over plan: migrate-fs-to-db.test.mjs:198-215 (wf_quick-fix fixture IS Quick Fix shape → converted; node_id 's0_0' assertion dies), upgrade-integration.test.mjs:188-197 (wf_quickfix → archived), workflows.test.mjs:47 (DEFAULT_WORKFLOW.version === 1); workflows*.test.mjs:85/115/360 (saved.version === 1) survive until kill-list.

## 5. Overlay API after cut-over
- GET /api/config: config.workflows[wfId] = { nodes:{[nodeId]:{model,effort,fanOut,askQuestions}}, wires:{[wireId]:{maxCycles}} } (feedbacks → wires); config.steps legacy, steps: agentSteps(), models, efforts unchanged.
- PATCH /api/config: body {projectDir, workflowId, nodes?, wires?:{[wireId]:{maxCycles}}, activeWorkflowId?} → setNodeModel (unchanged), setWireCycles(projectDir, workflowId, wireId, maxCycles); a feedbacks key → 400. resolveRunConfig returns {nodes, wires}.
- POST /api/config (setStep): unchanged. DELETE /api/config/workflow: resetWorkflowConfig deletes nodes + wires (+ legacy steps for wf_default); config_workflow_feedbacks vestigial.
- PATCH /api/workflows/:id/defaults: same body/response; writes graph.nodes[].config (4 tunables on agent nodes; wf_default refused); workflowNodeDefaults(tpl) picks those keys per agent node.
- GET /api/workflows → [GRAPH_DEFAULT_WORKFLOW, ...listWorkflows()] (+?archived=1); POST /api/workflows accepts {name, domain, nodes, wires, canvas?} via validateGraph (v1 steps accepted until kill-list); DELETE unchanged.
- Precedence per agent node in resolveGraph: config_workflow_nodes → legacy project_config.steps[key] (wf_default only) → template node.config → sidecar → hard default (effort never inherits across a model change, workflows.mjs:427). Per loop wire: config_workflow_wires → wire.config.maxCycles → 3.

## Flags
(1) fingerprint conversion = extension of decision #8 — veto if unwanted; (2) seeding on existing DBs only (fresh installs unchanged) — say if fresh installs should also get the 7; (3) "Full" and "Full v212" will coexist as duplicates on the user's DB.
