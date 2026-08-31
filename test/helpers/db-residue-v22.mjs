// test/helpers/db-residue-v22.mjs
// The user's live DB shape at the v2 break, built by CODE (never a committed .db):
// 6 v1 template rows, config_workflow_nodes already keyed n_* for all 7 seed ids
// (orphaned overlays left by the discarded branch), config_workflow_wires in the
// OLD PK column order (workflow_id, project_key, wire_id) with wf_no-clarify
// w3/w10 = 6, a COLLIDING pair of wf_default overlays (one keyed by the alias,
// one by the v1 step id — the alias must win, see Task 4), 2 paused + 1
// interrupted v1 runs carrying v1 resume points, one v2 run on the alias, and
// project_config.active_workflow_id pointing at a v1 row. Built on the REAL
// ladder, then stamped back to 23 so the next getDb() runs V24 exactly as it
// will on the user's machine.
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
const PROJECT_KEY_LIVE = 'proj-residue-live5678';   // its active workflow is a LIVE seed
const RP_V1 = (id) => JSON.stringify({ version: 1, kind: 'boundary', stepIndex: 0, stepCycle: [],
  loopState: {}, bus: null, stepModels: {}, workflowId: id, guardrailsId: null, plan: null,
  nodes: [], gate: null, pauseReason: null, toolInstruction: '', pipelineDir: '/tmp/p',
  pausedAt: '2026-08-01T00:00:00.000Z' });

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
  // them while the rows themselves were never created).
  const insNode = db.prepare(`INSERT INTO config_workflow_nodes
    (project_key,workflow_id,node_id,model,effort,fan_out) VALUES (?,?,?,?,NULL,NULL)`);
  for (const t of SEED_TEMPLATES) insNode.run(PROJECT_KEY, t.id, 'n_impl', 'claude-opus-4-8');
  // TWO collision shapes, and both are load-bearing (measured: with only the
  // first, INSERT OR REPLACE and the fold's displacement audit are never
  // exercised and both mutations stay GREEN).
  // (a) REMAP-time collision: a v1-era wf_default/s0_0 overlay that NODE_ID_MAP
  //     renames onto n_plan — the very id the alias row folds onto. The alias
  //     value (v2-era, set deliberately through the composer) must WIN.
  insNode.run(PROJECT_KEY, 'wf_default_v2', 'n_plan', 'claude-sonnet-4-8');
  insNode.run(PROJECT_KEY, 'wf_default', 's0_0', 'claude-legacy-v1');
  // (b) FOLD-time collision: already keyed n_* on BOTH sides, so the two rows
  //     collide the moment the alias folds — which is what the fold's
  //     INSERT OR REPLACE and its audit line exist for.
  insNode.run(PROJECT_KEY, 'wf_default', 'n_refine', 'claude-legacy-direct');
  insNode.run(PROJECT_KEY, 'wf_default_v2', 'n_refine', 'claude-sonnet-4-8');
  // A v1-era overlay on a row that IS a seed id, still keyed s0_0 (this one has
  // no twin, so NODE_ID_MAP renames it cleanly).
  insNode.run(PROJECT_KEY, 'wf_quick-fix', 's0_0', 'claude-haiku-4-8');
  db.exec(`INSERT INTO config_workflow_feedbacks (project_key,workflow_id,fb_id,max_cycles)
           VALUES ('${PROJECT_KEY}','wf_no-clarify','fb_0',6), ('${PROJECT_KEY}','wf_no-clarify','fb_1',6)`);
  // config_workflow_wires in the OLD PK column order — inert, because every
  // statement in the codebase names its columns.
  db.exec(`DROP TABLE IF EXISTS config_workflow_wires;
    CREATE TABLE config_workflow_wires (workflow_id TEXT NOT NULL, project_key TEXT NOT NULL,
      wire_id TEXT NOT NULL, max_cycles INTEGER NOT NULL,
      PRIMARY KEY (workflow_id, project_key, wire_id));`);
  // Two projects: one stranded on a row V24 archives, one pointing at a LIVE
  // seed. Pass 6's WHERE is vacuous without the second.
  db.exec(`INSERT INTO project_config (project_key,steps,custom_models,active_workflow_id,extra)
           VALUES ('${PROJECT_KEY}','{}','[]','wf_simple-plan','{}'),
                  ('${PROJECT_KEY_LIVE}','{}','[]','wf_quick-fix','{}')`);
  const insRun = db.prepare(`INSERT INTO pipelines (id,project_key,target,status,phase,cycle,
    started_at,updated_at,prompt,resume_point) VALUES (?,?,'project',?,'implement',1,
    '2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z','x',?)`);
  insRun.run('run-p1', PROJECT_KEY, 'paused', RP_V1('wf_simple-plan'));
  insRun.run('run-p2', PROJECT_KEY, 'paused', RP_V1('wf_full-v212'));
  insRun.run('run-i1', PROJECT_KEY, 'interrupted', RP_V1('wf_implement-only'));
  insRun.run('run-v2', PROJECT_KEY, 'paused', JSON.stringify({ version: 2, workflowId: 'wf_default_v2', snapshot: {} }));
  // A v1 point that NAMES the alias: the alias fold's json_set arm must ignore
  // it (it is swept, not remapped) — without this row that filter is vacuous.
  insRun.run('run-v1a', PROJECT_KEY, 'paused', RP_V1('wf_default_v2'));
  db.prepare("DELETE FROM store_meta WHERE key = 'migration:v24'").run();
  db.exec('PRAGMA user_version = 23');
  _resetForTests();                          // next getDb() re-migrates 23 → 24
  return { v1Ids: V1_ROWS.map(([id]) => id), projectKey: PROJECT_KEY,
    projectKeyLive: PROJECT_KEY_LIVE, dbFile,
    pausedIds: ['run-p1', 'run-p2'], interruptedId: 'run-i1', v2RunId: 'run-v2', v1AliasRunId: 'run-v1a' };
}
