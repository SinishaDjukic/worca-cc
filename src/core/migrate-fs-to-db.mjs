// src/core/migrate-fs-to-db.mjs
// One-time importer: legacy JSON (the pre-SQLite filesystem state) -> the SQLite DB.
//
// Called once by db.mjs#getDb() after migrate(db) stamps the schema, before the
// singleton handle is published. SYNCHRONOUS (it runs inside the sync open
// sequence): all FS access is node:fs sync; all inserts run in ONE transaction on
// the passed `db`. Self-guarded + idempotent: a no-op unless the DB has no migrated
// data AND legacy JSON is present. Crash-safe: COMMIT first, then archive consumed
// JSON into <worcaHome>/backup-<ts>/ (mirroring the relative layout); an
// interrupted archive is harmless because the row-count guard makes a re-run a
// no-op. Markdown agent outputs + extras/ are NEVER moved (FS keeps them; spec §4/§5).
//
// DECOUPLED from the service layer: it does NOT call config/projects/workspaces/
// artifacts write paths (those become SQL in Phases 2/3 and would re-enter getDb()).
// It writes direct prepared INSERTs against the FINAL v1 DDL and uses ONLY pure
// path/key helpers (worcaHome, projectKey, store paths) that never touch the DB.

import {
  existsSync, readFileSync, readdirSync, statSync,
  mkdirSync, renameSync, cpSync, unlinkSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

import { worcaHome } from './projects.mjs';
import {
  projectKey, storeRoot, workspacesStoreRoot,
} from './store.mjs';

// ── tiny fail-safe IO helpers ────────────────────────────────────────────────────

/** Parse a JSON file; missing/corrupt -> undefined (never throws). */
function readJsonSafe(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}
/** Read a text file; missing -> undefined (never throws). */
function readTextSafe(file) {
  try { return readFileSync(file, 'utf8'); } catch { return undefined; }
}
/** List a directory's dirents; missing -> [] (never throws). */
function readDirSafe(dir) {
  try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}
/** True when the path is an existing directory (never throws). */
function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

/** Coerce to a JSON TEXT column value: stringify when present, else null. */
function jsonCol(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}
/** Nullable boolean -> 1/0/null for an INTEGER column. */
function boolCol(v) { return typeof v === 'boolean' ? (v ? 1 : 0) : null; }

const nowIso = () => new Date().toISOString();

// ── the per-project config path (INLINED to stay fully decoupled from config.mjs) ──
function projectConfigFile(projectDir) {
  return join(resolve(projectDir), '.worca-cc', 'config.json');
}

// ── the set of pipeline-dir JSON/md files we CONSUME (move to backup) ───────────────
// pipeline.md is consumed (fully captured as pipeline_events). prompt.md stays
// (kept markdown; its body is also copied into pipelines.prompt). Everything else
// that is markdown stays on disk.
const REVIEW_FILE_RE = /^(refine|impl|plan|ws|webui)-review-cycle(\d+)\.json$/;

// A14: ESM namespace exports are non-configurable, so the Phase-1 hook-call test
// (db.test.mjs) cannot mock.method() this function. It instead asserts an
// OBSERVABLE effect — this module-level call counter — to prove getDb() invokes the
// hook exactly once, after migrate(), on first open (and not on a cached re-open).
// The real importer keeps the increment: it is harmless (a single bump at the top of
// every call, before any early return) and preserves that frozen Phase-1 contract.
let _callCount = 0;

// M3: one-time completion latch. The old guard (projects>0 OR pipelines>0) was a
// row-count PROXY: a DB with projects but zero finished pipelines read as "done",
// so a legacy pipeline JSON reappearing under store/ would be skipped forever; and
// legacyPresent() can never go false (store/ keeps markdown). Instead we stamp a
// sentinel store_meta row INSIDE the import tx and gate re-runs on it. store_meta
// has no CHECK on `kind`, and every reader looks it up by an exact key (never scans
// the table), so this reserved key is invisible to the service layer.
const MIGRATION_MARKER_KEY = '__fs_migration__';

// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Migrate legacy JSON state into the DB on first run. Self-guarded + idempotent.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {void}
 */
export function maybeMigrateFromFs(db) {
  _callCount += 1;                         // A14: observable hook-fired effect (see above)
  const home = worcaHome();
  if (!legacyPresent(home)) return;        // nothing on disk to import
  if (alreadyMigrated(db)) return;         // DB already holds migrated data

  const plan = collectLegacy(home);        // pure reads -> in-memory rows + consumed-file list
  if (!plan.hasRows) return;               // corrupt-only tree: leave JSON, no-op

  db.exec('BEGIN');
  try {
    insertAll(db, plan);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore secondary */ }
    throw err;                             // DB left empty -> safe to retry on next open
  }

  // Commit succeeded -> the DB is authoritative. Archive consumed JSON best-effort;
  // an interrupted archive is harmless (the row-count guard no-ops the re-run).
  archive(home, plan.consumed);
}

/** Legacy data is "present" when ANY consumable source exists on disk. */
function legacyPresent(home) {
  return (
    existsSync(join(home, 'projects.json')) ||
    existsSync(join(home, 'workspaces.json')) ||
    isDir(join(home, 'workflows')) ||
    isDir(join(home, 'store'))
  );
}

/**
 * SELF-GUARD (M3): the fs->db import already completed when the one-time marker row
 * exists. This is a real latch (stamped in the same tx as the import), NOT the old
 * row-count proxy — so a legacy JSON file reappearing after a partial-looking DB
 * (e.g. projects>0 but pipelines==0) is still imported until the marker is present.
 */
function alreadyMigrated(db) {
  return db.prepare('SELECT 1 FROM store_meta WHERE key = ?').get(MIGRATION_MARKER_KEY) !== undefined;
}

// ── collection (pure reads) ────────────────────────────────────────────────────────

/**
 * Read the whole legacy tree into a plan: arrays of row tuples per table + the list
 * of consumed files to archive. No DB access here. Never throws (fail-safe skips).
 */
function collectLegacy(home) {
  const plan = {
    // m14: each workspaces entry is { row:[...], members:[[id,path,ordinal],...] }
    // so insertAll can emit a workspace's member rows ONLY when its parent
    // `workspaces` row actually inserted (changes===1). A hand-edited registry with
    // two CI-name-colliding entries (distinct ids) makes `INSERT OR IGNORE` drop the
    // 2nd `workspaces` row; emitting its `workspace_projects` children unconditionally
    // would then FK-fail (parent absent) and — since INSERT OR IGNORE does NOT swallow
    // a FOREIGN KEY violation — throw, rolling the WHOLE import back and re-attempting
    // it on every getDb() open (an infinite re-migrate loop). Carrying members with
    // their parent lets us gate them on the parent insert.
    projects: [], workspaces: [], workflows: [],
    projectConfig: [], configNodes: [], configFeedbacks: [],
    storeMeta: [], pipelines: [], pipelineSteps: [], pipelineEvents: [],
    clarify: [], reviews: [], artifacts: [],
    consumed: [],          // { src, rel } where rel is relative to `home` (or special)
    hasRows: false,
  };
  const ts = nowIso();

  // 1) projects.json
  const projectsFile = join(home, 'projects.json');
  const registry = readJsonSafe(projectsFile);
  const registryEntries = Array.isArray(registry)
    ? registry.filter((e) => e && typeof e.name === 'string' && typeof e.path === 'string')
    : [];
  const seenProjectKeys = new Set();
  for (const e of registryEntries) {
    const key = projectKey(e.path);
    if (seenProjectKeys.has(key)) continue;
    seenProjectKeys.add(key);
    plan.projects.push([key, e.name, e.path, ts]);
  }
  if (Array.isArray(registry)) plan.consumed.push({ src: projectsFile, rel: 'projects.json' });

  // 2) workspaces.json
  const workspacesFile = join(home, 'workspaces.json');
  const wsRegistry = readJsonSafe(workspacesFile);
  if (Array.isArray(wsRegistry)) {
    for (const w of wsRegistry) {
      if (!isValidWorkspace(w)) continue;
      // A1: workspace_projects.project_key stores the ABSOLUTE member PATH
      // (ordinal-ordered); the real projectKey is recomputed on read via
      // store.projectKey(path) in workspaces.mjs#annotate (a projectKey is a
      // one-way hash, so the path could not be recovered from it).
      // m14: members ride WITH their parent so insertAll only emits them when the
      // parent `workspaces` row inserts (changes===1) — never as FK-orphans.
      const members = w.projectPaths.map((p, i) => [w.id, p, i]);
      plan.workspaces.push({
        row: [
          w.id, w.name, typeof w.description === 'string' ? w.description : '',
          (typeof w.createdAt === 'string' && w.createdAt) || ts,
          (typeof w.updatedAt === 'string' && w.updatedAt) || ts,
        ],
        members,
      });
    }
    plan.consumed.push({ src: workspacesFile, rel: 'workspaces.json' });
  }

  // 3) workflows/*.json
  const wfDir = join(home, 'workflows');
  for (const ent of readDirSafe(wfDir)) {
    if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
    const file = join(wfDir, ent.name);
    const wf = readJsonSafe(file);
    if (!wf || typeof wf !== 'object' || !Array.isArray(wf.steps)) continue;
    const id = (typeof wf.id === 'string' && wf.id) || ent.name.slice(0, -'.json'.length);
    if (id === 'wf_default') { // built-in; never a row, but still archive a stray file
      plan.consumed.push({ src: file, rel: join('workflows', ent.name) });
      continue;
    }
    plan.workflows.push([
      id, (typeof wf.name === 'string' && wf.name) || 'Untitled',
      Number(wf.version) || 1, JSON.stringify(wf.steps),
      JSON.stringify(Array.isArray(wf.feedbacks) ? wf.feedbacks : []),
      (typeof wf.createdAt === 'string' && wf.createdAt) || ts,
      (typeof wf.updatedAt === 'string' && wf.updatedAt) || ts,
    ]);
    plan.consumed.push({ src: file, rel: join('workflows', ent.name) });
  }

  // 4) per-project .worca-cc/config.json (only for registered, still-present dirs)
  for (const e of registryEntries) {
    const dir = e.path;
    if (!isDir(dir)) continue;                 // SKIP projects whose dir is gone
    const file = projectConfigFile(dir);
    const cfg = readJsonSafe(file);
    if (!cfg || typeof cfg !== 'object') continue;
    const key = projectKey(dir);
    collectProjectConfig(plan, key, cfg);
    // config.json lives OUTSIDE home -> namespaced archive path under project-config/<key>/
    plan.consumed.push({ src: file, rel: null, dest: join('project-config', key, 'config.json') });
  }

  // 5) store tree
  collectStore(plan, home);

  plan.hasRows =
    plan.projects.length || plan.workspaces.length || plan.workflows.length ||
    plan.projectConfig.length || plan.storeMeta.length || plan.pipelines.length;
  return plan;
}

function isValidWorkspace(e) {
  return e && typeof e === 'object' && typeof e.id === 'string' &&
    typeof e.name === 'string' && Array.isArray(e.projectPaths) &&
    e.projectPaths.length >= 2 && e.projectPaths.every((p) => typeof p === 'string');
}

/** Decompose a per-project config into project_config + normalized node/feedback rows. */
function collectProjectConfig(plan, key, cfg) {
  const steps = cfg.steps && typeof cfg.steps === 'object' ? cfg.steps : {};
  const customModels = Array.isArray(cfg.customModels) ? cfg.customModels : [];
  const activeWorkflowId =
    typeof cfg.activeWorkflowId === 'string' && cfg.activeWorkflowId.trim()
      ? cfg.activeWorkflowId.trim() : null;
  // extra = every top-level key except the four modeled ones.
  const extra = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'steps' || k === 'customModels' || k === 'activeWorkflowId' || k === 'workflows') continue;
    extra[k] = v;
  }
  plan.projectConfig.push([
    key, JSON.stringify(steps), JSON.stringify(customModels), activeWorkflowId,
    JSON.stringify(extra),
  ]);

  const workflows = cfg.workflows && typeof cfg.workflows === 'object' ? cfg.workflows : {};
  for (const [wfId, wf] of Object.entries(workflows)) {
    if (!wf || typeof wf !== 'object') continue;
    const nodes = wf.nodes && typeof wf.nodes === 'object' ? wf.nodes : {};
    for (const [nodeId, sel] of Object.entries(nodes)) {
      if (!sel || typeof sel !== 'object') continue;
      plan.configNodes.push([
        key, wfId, nodeId,
        typeof sel.model === 'string' ? sel.model : null,
        typeof sel.effort === 'string' ? sel.effort : null,
        boolCol(sel.fanOut),
      ]);
    }
    const feedbacks = wf.feedbacks && typeof wf.feedbacks === 'object' ? wf.feedbacks : {};
    for (const [fbId, fb] of Object.entries(feedbacks)) {
      if (!fb || typeof fb !== 'object') continue;
      const maxCycles = Math.max(1, Math.floor(Number(fb.maxCycles) || 0) || 1);
      plan.configFeedbacks.push([key, wfId, fbId, maxCycles]);
    }
  }
}

/** Walk store/<key>/ (project keys) and store/workspaces/<wkey>/ (workspace keys). */
function collectStore(plan, home) {
  const root = storeRoot();
  for (const ent of readDirSafe(root)) {
    if (!ent.isDirectory()) continue;
    if (ent.name === 'workspaces') {
      const wsRoot = workspacesStoreRoot();
      for (const w of readDirSafe(wsRoot)) {
        if (!w.isDirectory()) continue;
        collectKeyDir(plan, home, join(wsRoot, w.name), w.name, 'workspace');
      }
      continue;
    }
    collectKeyDir(plan, home, join(root, ent.name), ent.name, 'project');
  }
}

/**
 * Import one key dir (project or workspace): meta.json -> store_meta, each
 * pipelines/<runId>/ -> a pipeline + children, shared plans/reviews -> artifacts.
 * @param {string} dirName  the store key dir name (bare workspace key for workspaces)
 * @param {'project'|'workspace'} kind
 */
function collectKeyDir(plan, home, keyDir, dirName, kind) {
  // meta.json -> store_meta (key = meta.key when present, else the dir name)
  const metaFile = join(keyDir, 'meta.json');
  const meta = readJsonSafe(metaFile);
  if (meta && typeof meta === 'object') {
    const metaKey = typeof meta.key === 'string' && meta.key ? meta.key : dirName;
    plan.storeMeta.push([metaKey, kind, JSON.stringify(meta)]);
    plan.consumed.push({ src: metaFile, rel: relFromHome(home, metaFile) });
  }

  // pipelines/<runId>/
  const pipelinesDir = join(keyDir, 'pipelines');
  const runEntries = readDirSafe(pipelinesDir).filter((e) => e.isDirectory());
  // remember each run's (id, datePrefix, baseCandidates) to attribute shared md later.
  const runIndex = [];
  for (const run of runEntries) {
    const runDir = join(pipelinesDir, run.name);
    const idAndBases = collectPipeline(plan, home, runDir, run.name, dirName, kind, meta);
    if (idAndBases) runIndex.push(idAndBases);
  }

  // shared plans/*.md + reviews/*.md -> artifacts (attributed by datePrefix+base).
  collectSharedMarkdown(plan, keyDir, runIndex);
}

/**
 * Import one pipeline dir. Returns { id, datePrefix, bases:Set } for shared-md
 * attribution, or null when state.json is unreadable (skip the whole pipeline).
 */
function collectPipeline(plan, home, runDir, runName, dirName, kind, keyMeta) {
  const state = readJsonSafe(join(runDir, 'state.json'));
  if (!state || typeof state !== 'object') return null; // corrupt -> skip this pipeline

  const id = (typeof state.id === 'string' && state.id) || runName;

  // project_key
  let projectKeyVal;
  if (kind === 'workspace') {
    projectKeyVal =
      (Array.isArray(state.projectKeys) && state.projectKeys[0]) ||
      (keyMeta && Array.isArray(keyMeta.projectKeys) && keyMeta.projectKeys[0]) || '';
  } else {
    projectKeyVal =
      (keyMeta && typeof keyMeta.key === 'string' && keyMeta.key) ||
      (typeof state.projectDir === 'string' ? projectKey(state.projectDir) : '') ||
      dirName;
  }
  // workspace_key: composite tag for workspace runs, null for project runs.
  const workspaceKeyVal = kind === 'workspace' ? `workspaces/${dirName}` : null;

  const prompt = readTextSafe(join(runDir, 'prompt.md')) ?? null;

  const workspaceMeta = state.target === 'workspace'
    ? pruneUndefined({
        workspaceId: state.workspaceId, workspaceKey: state.workspaceKey,
        workspaceName: state.workspaceName, workspaceDescription: state.workspaceDescription,
        projectKeys: state.projectKeys, projects: state.projects,
        checkpointRefs: state.checkpointRefs, branches: state.branches,
      })
    : null;

  plan.pipelines.push([
    id, projectKeyVal, workspaceKeyVal,
    typeof state.target === 'string' ? state.target : 'project',
    state.title ?? null, state.baseName ?? null, state.datePrefix ?? null,
    state.status || 'created', state.phase || 'created', Number(state.cycle) || 0,
    state.startedAt ?? null, state.updatedAt ?? null,
    Number(state.totalCostUsd) || 0, Number(state.totalActiveMs) || 0,
    prompt,
    jsonCol(state.branch), jsonCol(workspaceMeta), jsonCol(state.stepper), jsonCol(state.tools),
  ]);
  plan.consumed.push({ src: join(runDir, 'state.json'), rel: relFromHome(home, join(runDir, 'state.json')) });

  // steps
  const seenStepKeys = new Set();
  for (const s of Array.isArray(state.steps) ? state.steps : []) {
    if (!s || typeof s !== 'object' || typeof s.key !== 'string' || !s.key) continue;
    if (seenStepKeys.has(s.key)) continue;
    seenStepKeys.add(s.key);
    plan.pipelineSteps.push([
      id, s.key, s.nodeId ?? null, s.phase ?? null,
      Number.isInteger(s.stepIndex) ? s.stepIndex : null,
      Number.isFinite(s.cycle) ? s.cycle : null,
      s.status ?? null, s.startedAt ?? null, s.updatedAt ?? null,
      Number(s.activeMs) || 0,
      s.runningSince == null ? null : String(s.runningSince),
      Number(s.costUsd) || 0,
    ]);
  }

  // pipeline.md -> events
  const md = readTextSafe(join(runDir, 'pipeline.md'));
  if (md !== undefined) {
    for (const ev of parseTimeline(md)) plan.pipelineEvents.push([id, ev.ts, ev.text]);
    plan.consumed.push({ src: join(runDir, 'pipeline.md'), rel: relFromHome(home, join(runDir, 'pipeline.md')) });
  }

  // clarify + clarify-answers -> one clarify row
  const clarify = readJsonSafe(join(runDir, 'clarify.json'));
  const answers = readJsonSafe(join(runDir, 'clarify-answers.json'));
  if (clarify !== undefined || answers !== undefined) {
    plan.clarify.push([id, jsonCol(clarify), jsonCol(answers)]);
    if (clarify !== undefined) plan.consumed.push({ src: join(runDir, 'clarify.json'), rel: relFromHome(home, join(runDir, 'clarify.json')) });
    if (answers !== undefined) plan.consumed.push({ src: join(runDir, 'clarify-answers.json'), rel: relFromHome(home, join(runDir, 'clarify-answers.json')) });
  }

  // *-review-cycleN.json -> reviews; markdown artifacts inside the run dir -> artifacts
  for (const ent of readDirSafe(runDir)) {
    if (!ent.isFile()) continue;
    const m = REVIEW_FILE_RE.exec(ent.name);
    if (m) {
      const body = readJsonSafe(join(runDir, ent.name));
      plan.reviews.push([id, m[1], Number(m[2]), jsonCol(body)]);
      plan.consumed.push({ src: join(runDir, ent.name), rel: relFromHome(home, join(runDir, ent.name)) });
      continue;
    }
    if (ent.name === 'manual-tests-checklist.md') {
      plan.artifacts.push([id, 'manual-checklist', ent.name]);
    } else if (/^webui-review-cycle\d+\.md$/.test(ent.name)) {
      plan.artifacts.push([id, 'webui-review', ent.name]);
    } else if (ent.name === 'workspace-description.md') {
      plan.artifacts.push([id, 'workspace-description', ent.name]);
    } else if (ent.name.endsWith('.md') && ent.name !== 'pipeline.md' && ent.name !== 'prompt.md') {
      plan.artifacts.push([id, 'extra-md', ent.name]);
    }
  }
  // extras/<file> -> artifacts (kept on disk, never moved)
  for (const ex of readDirSafe(join(runDir, 'extras'))) {
    if (ex.isFile()) plan.artifacts.push([id, 'extra', join('extras', ex.name)]);
  }

  return { id, datePrefix: state.datePrefix ?? null, bases: baseCandidates(state, runName) };
}

/** Candidate base names for shared-md linkage (mirrors pipeline-delete.mjs#deriveNames). */
function baseCandidates(state, runName) {
  const bases = new Set();
  if (state && state.baseName) bases.add(String(state.baseName));
  // dir slug: drop the "DD-MM-YY-" prefix and the trailing "-<id>".
  const m = /^(\d{2}-\d{2}-\d{2})-(.+)$/.exec(runName);
  if (m && state && state.id) {
    const inner = m[2];
    const suffix = `-${String(state.id)}`;
    if (inner.endsWith(suffix)) bases.add(inner.slice(0, -suffix.length));
  }
  return bases;
}

/** Attribute plans/*.md + reviews/*.md to a pipeline in this key by datePrefix+base. */
function collectSharedMarkdown(plan, keyDir, runIndex) {
  const PLAN_RE = /^(\d{2}-\d{2}-\d{2})-(.+?)(?:-v\d+)?\.md$/;
  const REVIEW_RE = /^(\d{2}-\d{2}-\d{2})-(.+?)-(impl-review|plan-review|ws-review)\.md$/;
  const matchRun = (datePrefix, base) =>
    runIndex.find((r) => r.datePrefix === datePrefix && r.bases.has(base));

  for (const ent of readDirSafe(join(keyDir, 'plans'))) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    const m = PLAN_RE.exec(ent.name);
    if (!m) continue;
    const run = matchRun(m[1], m[2]);
    if (run) plan.artifacts.push([run.id, 'plan', join('plans', ent.name)]);
  }
  for (const ent of readDirSafe(join(keyDir, 'reviews'))) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    const m = REVIEW_RE.exec(ent.name);
    if (!m) continue;
    const run = matchRun(m[1], m[2]);
    if (run) plan.artifacts.push([run.id, 'review', join('reviews', ent.name)]);
  }
}

/**
 * Parse the `## Timeline` section of a pipeline.md into { ts, text } events. ONLY
 * lines after the first "## Timeline" header that match the strict ISO-ts pattern
 * are events. When there is NO "## Timeline" header we return [] rather than scanning
 * the whole file: a prompt body can legitimately contain "- `<ISO ts>` ..." lines,
 * and treating those as events would fabricate spurious pipeline_events rows.
 */
function parseTimeline(md) {
  const lines = md.split(/\r?\n/);
  const header = lines.findIndex((l) => l.trim() === '## Timeline');
  if (header === -1) return [];               // no Timeline section -> no events
  const RE = /^- `(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)` (.*)$/;
  const out = [];
  for (let i = header + 1; i < lines.length; i++) {
    const m = RE.exec(lines[i]);
    if (m) out.push({ ts: m[1], text: m[2] });
  }
  return out;
}

/** Drop undefined-valued keys so JSON.stringify omits them (keeps the column compact). */
function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/** Path of `file` relative to `home` (for mirroring into backup-<ts>/). */
function relFromHome(home, file) { return relative(home, file); }

// ── insertion (one transaction) ────────────────────────────────────────────────────

function insertAll(db, plan) {
  const ins = {
    project: db.prepare('INSERT OR IGNORE INTO projects (key,name,path,created_at) VALUES (?,?,?,?)'),
    workspace: db.prepare('INSERT OR IGNORE INTO workspaces (id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)'),
    wsProj: db.prepare('INSERT OR IGNORE INTO workspace_projects (workspace_id,project_key,ordinal) VALUES (?,?,?)'),
    workflow: db.prepare('INSERT OR IGNORE INTO workflows (id,name,version,steps,feedbacks,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'),
    projectConfig: db.prepare('INSERT OR IGNORE INTO project_config (project_key,steps,custom_models,active_workflow_id,extra) VALUES (?,?,?,?,?)'),
    configNode: db.prepare('INSERT OR IGNORE INTO config_workflow_nodes (project_key,workflow_id,node_id,model,effort,fan_out) VALUES (?,?,?,?,?,?)'),
    configFb: db.prepare('INSERT OR IGNORE INTO config_workflow_feedbacks (project_key,workflow_id,fb_id,max_cycles) VALUES (?,?,?,?)'),
    storeMeta: db.prepare('INSERT OR IGNORE INTO store_meta (key,kind,data) VALUES (?,?,?)'),
    pipeline: db.prepare(`INSERT OR IGNORE INTO pipelines
      (id,project_key,workspace_key,target,title,base_name,date_prefix,status,phase,cycle,
       started_at,updated_at,total_cost_usd,total_active_ms,prompt,branch,workspace_meta,stepper,tools)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    step: db.prepare(`INSERT OR IGNORE INTO pipeline_steps
      (pipeline_id,key,node_id,phase,step_index,cycle,status,started_at,updated_at,active_ms,running_since,cost_usd)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    event: db.prepare('INSERT INTO pipeline_events (pipeline_id,ts,text) VALUES (?,?,?)'),
    clarify: db.prepare('INSERT OR IGNORE INTO clarify (pipeline_id,questions,answers) VALUES (?,?,?)'),
    review: db.prepare('INSERT OR IGNORE INTO reviews (pipeline_id,kind,cycle,verdict) VALUES (?,?,?,?)'),
    artifact: db.prepare('INSERT OR IGNORE INTO artifacts (pipeline_id,kind,rel_path) VALUES (?,?,?)'),
    marker: db.prepare('INSERT OR REPLACE INTO store_meta (key,kind,data) VALUES (?,?,?)'),
  };
  for (const r of plan.projects) ins.project.run(...r);
  // m14: emit a workspace's member rows ONLY when its parent `workspaces` row
  // actually inserted (changes===1). When `INSERT OR IGNORE` drops the row (a
  // CI-name or id collision → changes===0), skipping its members avoids the FK
  // violation that `INSERT OR IGNORE` does NOT swallow (it throws), which would
  // otherwise roll the whole import back and re-trigger it on every open.
  for (const w of plan.workspaces) {
    const inserted = ins.workspace.run(...w.row).changes === 1;
    if (!inserted) continue;
    for (const m of w.members) ins.wsProj.run(...m);
  }
  for (const r of plan.workflows) ins.workflow.run(...r);
  for (const r of plan.projectConfig) ins.projectConfig.run(...r);
  for (const r of plan.configNodes) ins.configNode.run(...r);
  for (const r of plan.configFeedbacks) ins.configFb.run(...r);
  for (const r of plan.storeMeta) ins.storeMeta.run(...r);
  for (const r of plan.pipelines) ins.pipeline.run(...r);
  for (const r of plan.pipelineSteps) ins.step.run(...r);
  for (const r of plan.pipelineEvents) ins.event.run(...r);
  for (const r of plan.clarify) ins.clarify.run(...r);
  for (const r of plan.reviews) ins.review.run(...r);
  for (const r of plan.artifacts) ins.artifact.run(...r);
  // M3: stamp the one-time completion marker LAST, in this same tx (committed by the
  // caller's COMMIT). INSERT OR REPLACE so a marker-less pre-marker DB re-stamps clean.
  ins.marker.run(MIGRATION_MARKER_KEY, '_meta', JSON.stringify({ migrated: true, at: nowIso() }));
}

// ── archive (after commit; best-effort) ──────────────────────────────────────────

/**
 * Move every consumed file into <home>/backup-<ts>/ mirroring the relative layout.
 * Files outside `home` (per-project config.json) carry an explicit `dest` rel path
 * (namespaced by projectKey). Best-effort: a per-file failure is swallowed (the DB
 * is already authoritative; a stuck file must not crash app open).
 */
function archive(home, consumed) {
  if (!consumed.length) return;
  const ts = nowIso().replace(/[:.]/g, '-');
  const backupRoot = join(home, `backup-${ts}`);
  for (const item of consumed) {
    const rel = item.dest || item.rel;
    if (!rel) continue;
    const dest = join(backupRoot, rel);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      try {
        renameSync(item.src, dest);
      } catch (e) {
        if (e && e.code === 'EXDEV') {       // cross-device (per-project config): copy+unlink
          cpSync(item.src, dest);
          unlinkSync(item.src);
        } else {
          throw e;
        }
      }
    } catch (err) {
      // Best-effort: the DB is already authoritative, so a stuck file must NOT crash
      // app open. But LOG it (M-min3) so a leftover un-archived legacy file in the
      // live tree is diagnosable instead of vanishing silently.
      try { console.warn(`worca: fs->db archive failed for ${item.src} -> ${dest}: ${err && err.message ? err.message : err}`); } catch { /* never let logging itself crash open */ }
    }
  }
}

// ── TEST-ONLY observability (A14; consumed by db.test.mjs's hook-call test) ─────────

/** TEST-ONLY: how many times maybeMigrateFromFs() has been called. */
export function _migrateFromFsCallCount() {
  return _callCount;
}

/** TEST-ONLY: reset the call counter so each test observes a fresh open. */
export function _resetMigrateFromFsCallCount() {
  _callCount = 0;
}
