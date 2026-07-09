/**
 * Workspace REST endpoints (W-047 §10.10).
 *
 * Two routers: `workspaces` for workspace definitions (workspace.json)
 * and `workspaceRuns` for workspace run lifecycle (manifests, plans, guides).
 *
 * Pointer files live at ~/.worca/workspace-runs/<workspace_id>.json.
 * Workspace definitions live at <workspace_root>/workspace.json.
 * Manifests live at <workspace_root>/.worca/workspace-runs/<ws_id>/workspace-manifest.json.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { Router } from 'express';
import { WORKSPACE_TERMINAL } from '../app/utils/status-constants.js';
import {
  worcaHome,
  workspaceRunsDir as resolveWorkspaceRunsDir,
  workspacesDir as resolveWorkspacesDir,
} from './paths.js';
import { slugify } from './project-registry.js';
import { listTemplatesFlat } from './templates-routes.js';
import {
  applySetupPatch,
  buildProjectPreflight,
} from './worca-setup-config.js';

const GUIDE_CAP_BYTES_DEFAULT = 64 * 1024;
const PROJECT_PLAN_CAP_BYTES = 256 * 1024;
const WORKSPACE_PLAN_CAP_BYTES = 256 * 1024;

const WS_ID_RE = /^ws_\d{12}_[0-9a-f]{1,32}$/;

const ACTIVE_STATUSES = new Set([
  'planning',
  'running',
  'integration_testing',
  'blocked',
]);

const RESUMABLE_STATUSES = new Set([
  'halted',
  'failed',
  'integration_failed',
  'paused',
]);

const PLAN_EDITABLE_STATUSES = new Set(['planning', 'halted', 'failed']);

// ─── helpers ───────────────────────────────────────────────────────────────

function validateWsId(id) {
  return typeof id === 'string' && WS_ID_RE.test(id);
}

function readPointer(wsRunsDir, wsId) {
  const p = join(wsRunsDir, `${wsId}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readManifest(wsRunsDir, wsId) {
  const pointer = readPointer(wsRunsDir, wsId);
  if (!pointer?.workspace_root) return null;
  const manifestPath = join(
    pointer.workspace_root,
    '.worca',
    'workspace-runs',
    wsId,
    'workspace-manifest.json',
  );
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function runDir(manifest) {
  return join(
    manifest.workspace_root,
    '.worca',
    'workspace-runs',
    manifest.workspace_id,
  );
}

function saveManifest(manifest) {
  const dir = runDir(manifest);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'workspace-manifest.json');
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    renameSync(tmp, p);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

function listPointers(wsRunsDir) {
  if (!existsSync(wsRunsDir)) return [];
  const out = [];
  for (const file of readdirSync(wsRunsDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const p = JSON.parse(readFileSync(join(wsRunsDir, file), 'utf8'));
      if (p?.workspace_id) out.push(p);
    } catch {
      // skip
    }
  }
  return out;
}

function listWorkspaceRegistrations(workspacesDir) {
  if (!existsSync(workspacesDir)) return [];
  const out = [];
  for (const file of readdirSync(workspacesDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const entry = JSON.parse(readFileSync(join(workspacesDir, file), 'utf8'));
      if (entry?.name) out.push(entry);
    } catch {
      // skip
    }
  }
  return out;
}

function readWorkspaceJson(wsRoot) {
  const p = join(wsRoot, 'workspace.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function detectCycle(projects) {
  const inDegree = {};
  const dependents = {};
  for (const r of projects) {
    inDegree[r.name] = 0;
    dependents[r.name] = [];
  }
  for (const r of projects) {
    for (const dep of r.depends_on || []) {
      if (!(dep in inDegree)) return `unknown dependency '${dep}'`;
      inDegree[r.name]++;
      dependents[dep].push(r.name);
    }
  }
  const queue = Object.keys(inDegree).filter((n) => inDegree[n] === 0);
  let processed = 0;
  const next = [...queue];
  while (next.length > 0) {
    const name = next.shift();
    processed++;
    for (const dep of dependents[name]) {
      inDegree[dep]--;
      if (inDegree[dep] === 0) next.push(dep);
    }
  }
  if (processed !== projects.length) {
    const remaining = Object.keys(inDegree)
      .filter((n) => inDegree[n] > 0)
      .sort();
    return `dependency cycle detected among projects: ${remaining.join(', ')}`;
  }
  return null;
}

function computeTiers(projects) {
  const inDegree = {};
  const dependents = {};
  for (const r of projects) {
    inDegree[r.name] = 0;
    dependents[r.name] = [];
  }
  for (const r of projects) {
    for (const dep of r.depends_on || []) {
      inDegree[r.name]++;
      dependents[dep].push(r.name);
    }
  }
  const tiers = [];
  let queue = Object.keys(inDegree)
    .filter((n) => inDegree[n] === 0)
    .sort();
  while (queue.length > 0) {
    tiers.push([...queue]);
    const nextQueue = [];
    for (const name of queue) {
      for (const dep of dependents[name]) {
        inDegree[dep]--;
        if (inDegree[dep] === 0) nextQueue.push(dep);
      }
    }
    queue = nextQueue.sort();
  }
  return tiers;
}

function generateWorkspaceId() {
  const now = new Date();
  const ts = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
  ].join('');
  const rand = Math.random().toString(16).slice(2, 10).padStart(8, '0');
  return { workspace_id: `ws_${ts}_${rand}`, workspace_id_short: rand };
}

function sanitizeFilename(raw) {
  const name = basename(raw || 'guide')
    .replace(/[/\\]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_');
  return name || 'guide';
}

function scanForProjects(parentPath) {
  const projects = [];
  let entries;
  try {
    entries = readdirSync(parentPath);
  } catch {
    return projects;
  }
  for (const entry of entries) {
    const full = join(parentPath, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(full, '.git'))) {
      projects.push({
        name: entry,
        path: entry,
        role_hint: null,
      });
    }
  }
  return projects;
}

function enrichChildStatus(child) {
  if (!child.run_id) return child;
  // pipelines.d lives in the project root, NOT inside the worktree.
  // Prefer `project_path` (set by DagExecutor on every child entry);
  // fall back to deriving the project root from `worktree_path` for older
  // manifests that didn't carry it. The worktree path is structured as
  // `<project_root>/.worktrees/pipeline-<run_id>`, so the project root is
  // two parent segments up.
  let projectRoot = child.project_path;
  if (!projectRoot && child.worktree_path) {
    const idx = child.worktree_path.lastIndexOf('/.worktrees/');
    if (idx > 0) projectRoot = child.worktree_path.slice(0, idx);
  }
  if (!projectRoot) return child;
  const regPath = join(
    projectRoot,
    '.worca',
    'multi',
    'pipelines.d',
    `${child.run_id}.json`,
  );
  if (!existsSync(regPath)) return child;
  try {
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    return { ...child, status: reg.status ?? child.status };
  } catch {
    return child;
  }
}

// Read a child run's status.json. The `.worca/multi/pipelines.d/<id>.json`
// file is a lightweight pointer with `status / pid / branch / worktree_path`
// — it does NOT contain stages. The actual per-stage costs and PR fields
// live in `<worktree>/.worca/runs/<run_id>/status.json`.
function _readChildStatus(child) {
  if (!child.run_id || !child.worktree_path) return null;
  const statusPath = join(
    child.worktree_path,
    '.worca',
    'runs',
    child.run_id,
    'status.json',
  );
  if (!existsSync(statusPath)) return null;
  try {
    return JSON.parse(readFileSync(statusPath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── workspace status derivation ────────────────────────────────────────
// Mirrors fleet-routes.js deriveFleetStatus / effectiveFleetStatus /
// reconcileFleetStatus. The workspace orchestrator only writes status at
// a handful of fixed points (DagExecutor finishing, integration test
// finishing). If anything happens to child states between those writes —
// a child re-launches, a sibling pipeline lands late, the orchestrator
// process dies after marking COMPLETED — the stored manifest goes stale
// and the badge lies. Re-derive on every GET, persist on change, treat
// sticky states as already-decided.
//
// The workspace state machine has more phases than fleet:
//   - `planning` and `integration_testing` are orchestrator-driven phases
//     that should NOT be overridden by child polling (the children's
//     statuses don't change during these phases, but the orchestrator's
//     phase semantics do)
//   - `integration_failed` is sticky like `failed` — children all done,
//     integration test was the failure
// Only `running` reconciles against live children, same as fleet's
// `running` / `resuming`.

const _CHILD_RUNNING_STATES = new Set(['running', 'resuming', 'paused']);
const _CHILD_FAILURE_STATES = new Set([
  'failed',
  'setup_failed',
  'unrecoverable',
]);
const _CHILD_TERMINAL_STATES = new Set([
  'completed',
  'interrupted',
  'cancelled',
  'blocked',
  ..._CHILD_FAILURE_STATES,
]);

// Statuses we never re-derive. Only orchestrator-phase markers
// (planning / integration_testing) and operator/circuit-breaker decisions
// (halted / paused / integration_failed / blocked) are sticky — the
// workspace can't re-derive its way out of those without an explicit
// Resume / Re-run.
//
// `running`, `completed`, and `failed` are NOT sticky. The orchestrator
// uses run_worktree.py as a fire-and-forget launcher, so it can write
// `completed` long before the actual pipeline finishes; re-deriving from
// the live registry on every read is the only way to keep the badge
// honest. (Fleet leaves completed/failed sticky because fleet runs
// terminate atomically; workspace is a coordination layer over
// independently-running pipelines and needs the looser semantics.)
const _STICKY_WORKSPACE_STATES = new Set([
  'planning',
  'integration_testing',
  'integration_failed',
  'halted',
  'paused',
  'blocked',
]);

/**
 * Pure derivation of workspace status from a flat list of child statuses.
 * Used only when the manifest's current status is `running` — every other
 * state is sticky.
 *
 * @param {string[]} childStatuses
 * @returns {string} 'running' | 'completed' | 'failed'
 */
export function deriveWorkspaceStatus(childStatuses) {
  if (!childStatuses.length) return 'running';
  const total = childStatuses.length;
  const runningCount = childStatuses.filter((s) =>
    _CHILD_RUNNING_STATES.has(s),
  ).length;
  const completedCount = childStatuses.filter((s) => s === 'completed').length;
  const failedCount = childStatuses.filter((s) =>
    _CHILD_FAILURE_STATES.has(s),
  ).length;
  const terminalCount = childStatuses.filter((s) =>
    _CHILD_TERMINAL_STATES.has(s),
  ).length;

  // Any child still in flight → workspace is still running.
  if (runningCount > 0) return 'running';

  // All dispatched children are terminal.
  if (terminalCount === total) {
    // `failed` wins over `completed` even if just one child failed —
    // matches fleet behaviour and the orchestrator's own DAG executor
    // logic (any child failure in any tier flips the workspace to
    // failed).
    if (failedCount > 0 || completedCount < total) return 'failed';
    return 'completed';
  }

  // Pending / untracked children not yet dispatched.
  return 'running';
}

/**
 * Combine stored manifest status with live child statuses to get the
 * value the API should report. Sticky states pass through unchanged.
 * Persists nothing — see reconcileWorkspaceStatus for the write variant.
 *
 * @param {object} manifest
 * @param {string[]} childStatuses
 * @returns {{ status: string, halt_reason: string|null }}
 */
export function effectiveWorkspaceStatus(manifest, childStatuses) {
  const current = manifest.status ?? 'running';
  if (_STICKY_WORKSPACE_STATES.has(current)) {
    return { status: current, halt_reason: manifest.halt_reason ?? null };
  }
  // current is running / completed / failed — re-derive against live
  // child statuses. If the orchestrator wrote `completed` based on the
  // fire-and-forget launcher exit but the actual pipelines are still
  // running, this flips the badge back to `running` to match reality.
  return {
    status: deriveWorkspaceStatus(childStatuses),
    halt_reason: manifest.halt_reason ?? null,
  };
}

/**
 * Reconcile manifest.status against live child statuses and persist when
 * the derived value differs from what's stored. Returns the effective
 * status so callers can fold it into their response.
 *
 * @param {object} manifest
 * @returns {{ status: string, halt_reason: string|null }}
 */
function reconcileWorkspaceStatus(manifest) {
  const childStatuses = (manifest.children ?? [])
    .map((c) => enrichChildStatus(c).status)
    .filter(Boolean);
  const current = manifest.status ?? 'running';
  const { status, halt_reason } = effectiveWorkspaceStatus(
    manifest,
    childStatuses,
  );
  const storedHalt = manifest.halt_reason ?? null;
  if (status !== current || halt_reason !== storedHalt) {
    manifest.status = status;
    if (halt_reason != null) {
      manifest.halt_reason = halt_reason;
    } else if (status !== 'halted') {
      manifest.halt_reason = null;
    }
    manifest.updated_at = new Date().toISOString();
    try {
      saveManifest(manifest);
    } catch {
      // Best-effort persistence — the derived value is still returned,
      // and the next read re-derives it anyway.
    }
  }
  return { status, halt_reason };
}

function aggregateCost(manifest) {
  let cost = 0;
  for (const child of manifest.children ?? []) {
    const st = _readChildStatus(child);
    if (!st) continue;
    for (const stage of Object.values(st.stages ?? {})) {
      for (const iter of stage.iterations ?? []) {
        cost += iter.cost_usd ?? 0;
      }
    }
  }
  return cost;
}

// Synthesize a workspace `finished_at` when the manifest is in a terminal
// state but no explicit field was written. We use the maximum
// `updated_at` across the child status.json files — closest available
// real timestamp for "when this workspace stopped progressing". Returns
// null if no children have status files yet (rare for terminal states).
function _synthesizeFinishedAt(manifest) {
  if (manifest.finished_at) return manifest.finished_at;
  if (!WORKSPACE_TERMINAL.has(manifest.status)) return null;
  let latest = null;
  for (const child of manifest.children ?? []) {
    const st = _readChildStatus(child);
    // child status.json carries `completed_at` for the run's wall-end
    // timestamp; `updated_at` is from a different shape and isn't set on
    // these files. Take the maximum across children.
    const ts = st?.completed_at || st?.updated_at;
    if (!ts) continue;
    if (!latest || ts > latest) latest = ts;
  }
  return latest;
}

// ─── multipart parser ──────────────────────────────────────────────────────

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(body, contentType) {
  const m = /boundary=([^\s;,]+)/.exec(contentType);
  if (!m) return null;
  const boundary = m[1].replace(/^["']|["']$/g, '');
  const delim = Buffer.from(`\r\n--${boundary}`);
  const parts = [];
  const openStr = `--${boundary}\r\n`;
  let pos = body.indexOf(openStr);
  if (pos === -1) return parts;
  pos += openStr.length;

  while (pos < body.length) {
    const end = body.indexOf(delim, pos);
    if (end === -1) break;
    const partBuf = body.slice(pos, end);
    const hdrEnd = partBuf.indexOf('\r\n\r\n');
    if (hdrEnd !== -1) {
      const headerStr = partBuf.slice(0, hdrEnd).toString('utf8');
      const content = partBuf.slice(hdrEnd + 4);
      const headers = {};
      for (const line of headerStr.split('\r\n')) {
        const ci = line.indexOf(':');
        if (ci !== -1) {
          headers[line.slice(0, ci).toLowerCase().trim()] = line
            .slice(ci + 1)
            .trim();
        }
      }
      const cd = headers['content-disposition'] ?? '';
      const nm = /\bname="([^"]+)"/.exec(cd);
      const fn = /\bfilename="([^"]+)"/.exec(cd);
      parts.push({
        name: nm?.[1] ?? null,
        filename: fn?.[1] ?? null,
        content,
      });
    }
    pos = end + delim.length;
    const after = body.slice(pos, pos + 2).toString();
    if (after === '--') break;
    pos += 2;
  }
  return parts;
}

// ─── plan strategy resolution ─────────────────────────────────────────────

/**
 * Map a plan_mode to the manifest fields it implies and validate
 * mode-specific preconditions.
 *
 * @param {string} plan_mode - 'master' | 'existing' | 'per-repo' | 'independent'
 * @param {string|null} workspace_plan_path
 * @param {Object|null} project_plans - { projectName: filePath, ... }
 * @param {Object} ws - parsed workspace.json (needs ws.projects)
 * @returns {{ ok: true, fields: object } | { ok: false, status: number, error: string }}
 */
export function _resolvePlanStrategy(
  plan_mode,
  workspace_plan_path,
  project_plans,
  ws,
) {
  const mode = plan_mode || 'master';
  const projectNames = new Set((ws.projects ?? []).map((p) => p.name));

  if (mode === 'existing') {
    if (!workspace_plan_path) {
      return {
        ok: false,
        status: 400,
        error:
          'existing mode requires a workspace plan (upload or server-side path)',
      };
    }
    return {
      ok: true,
      fields: {
        plan_mode: 'existing',
        workspace_plan_path,
        project_plans: null,
        skip_planning: false,
      },
    };
  }

  if (mode === 'per-repo') {
    const plans = project_plans ?? {};
    const planKeys = Object.keys(plans);
    if (planKeys.length === 0) {
      return {
        ok: false,
        status: 400,
        error: 'per-repo mode requires at least one project plan',
      };
    }
    const unknown = planKeys.filter((name) => !projectNames.has(name));
    if (unknown.length > 0) {
      return {
        ok: false,
        status: 422,
        error: `Unknown project(s) in per-repo plans: ${unknown.join(', ')}`,
      };
    }
    return {
      ok: true,
      fields: {
        plan_mode: 'per-repo',
        workspace_plan_path: null,
        project_plans: plans,
        skip_planning: false,
      },
    };
  }

  if (mode === 'independent') {
    return {
      ok: true,
      fields: {
        plan_mode: 'independent',
        workspace_plan_path: null,
        project_plans: null,
        skip_planning: true,
      },
    };
  }

  // master (default) — ignore any stray plan inputs. master mode always runs
  // the master planner; the Python CLI infers its mode from which flags are
  // present, so passing --workspace-plan/--project-plan through here would
  // silently run the job as existing/per-repo while the manifest (and badge)
  // still claimed "master". Null them out to keep declared mode and actual
  // behavior in lockstep.
  return {
    ok: true,
    fields: {
      plan_mode: 'master',
      workspace_plan_path: null,
      project_plans: null,
      skip_planning: false,
    },
  };
}

// ─── default injectables ──────────────────────────────────────────────────

function defaultValidateBaseBranch(repoPath, branch) {
  try {
    const out = execFileSync(
      'git',
      ['-C', repoPath, 'branch', '--list', branch],
      { encoding: 'utf8' },
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function defaultValidateGhAuth(_workspace) {
  return Promise.resolve([]);
}

function defaultHaltWorkspace(_wsId) {
  return true;
}

function defaultRunCleanup(_wsId) {
  return {};
}

function defaultRunIntegrationTest(_manifest) {
  return Promise.resolve({
    status: 'passed',
    exit_code: 0,
    log_path: null,
  });
}

// ─── router factory ────────────────────────────────────────────────────────

export function createWorkspaceRouter({
  workspaceRunsDir: workspaceRunsDirArg,
  workspacesDir: workspacesDirArg,
  dispatchWorkspace = null,
  haltWorkspace = defaultHaltWorkspace,
  runCleanup = defaultRunCleanup,
  validateBaseBranch = defaultValidateBaseBranch,
  validateGhAuth = defaultValidateGhAuth,
  runIntegrationTest = defaultRunIntegrationTest,
  guideCapBytes = GUIDE_CAP_BYTES_DEFAULT,
} = {}) {
  // Lazy resolution honors $WORCA_HOME (issue #162).
  const workspaceRunsDir = resolveWorkspaceRunsDir(workspaceRunsDirArg);
  const workspacesDir = resolveWorkspacesDir(workspacesDirArg);

  const workspaces = Router();
  const workspaceRuns = Router();

  // ════════════════════════════════════════════════════════════════════════
  // workspaces router — mounted at /api/workspaces
  // ════════════════════════════════════════════════════════════════════════

  // ── POST /api/workspaces/scan ─────────────────────────────────────────
  workspaces.post('/scan', (req, res) => {
    const { parent_path } = req.body ?? {};
    if (!parent_path || typeof parent_path !== 'string') {
      return res
        .status(400)
        .json({ ok: false, error: 'parent_path is required' });
    }
    if (!existsSync(parent_path)) {
      return res
        .status(400)
        .json({ ok: false, error: `Path does not exist: ${parent_path}` });
    }
    try {
      const projects = scanForProjects(parent_path);
      res.json({ ok: true, projects });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/workspaces ──────────────────────────────────────────────
  workspaces.post('/', (req, res) => {
    const { name, parent_path, projects, integration_test, umbrella_repo } =
      req.body ?? {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }
    if (!parent_path || typeof parent_path !== 'string') {
      return res
        .status(400)
        .json({ ok: false, error: 'parent_path is required' });
    }
    if (!Array.isArray(projects) || projects.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'projects must be a non-empty array' });
    }

    const cycleErr = detectCycle(projects);
    if (cycleErr) {
      return res.status(422).json({ ok: false, error: cycleErr });
    }

    const wsJson = { name, projects };
    if (integration_test) wsJson.integration_test = integration_test;
    if (umbrella_repo) wsJson.umbrella_repo = umbrella_repo;

    try {
      writeFileSync(
        join(parent_path, 'workspace.json'),
        `${JSON.stringify(wsJson, null, 2)}\n`,
        'utf8',
      );

      mkdirSync(workspacesDir, { recursive: true });
      const safeName = sanitizeFilename(name);
      writeFileSync(
        join(workspacesDir, `${safeName}.json`),
        `${JSON.stringify({ name, path: parent_path }, null, 2)}\n`,
        'utf8',
      );

      res.status(201).json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/workspaces ───────────────────────────────────────────────
  workspaces.get('/', (_req, res) => {
    try {
      const registrations = listWorkspaceRegistrations(workspacesDir);
      const result = registrations.map((reg) => {
        const ws = readWorkspaceJson(reg.path);
        return {
          name: reg.name,
          path: reg.path,
          projects: ws?.projects ?? [],
          integration_test: ws?.integration_test ?? null,
          umbrella_repo: ws?.umbrella_repo ?? null,
        };
      });
      res.json({ ok: true, workspaces: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/workspaces/:name ─────────────────────────────────────────
  workspaces.get('/:name', (req, res) => {
    const name = sanitizeFilename(req.params.name);
    const regPath = join(workspacesDir, `${name}.json`);
    if (!existsSync(regPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace "${name}" not found` });
    }

    try {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const ws = readWorkspaceJson(reg.path);
      if (!ws) {
        return res.status(404).json({
          ok: false,
          error: `workspace.json not found at ${reg.path}`,
        });
      }
      // Include parent path so the edit view can scan the directory for
      // currently-unselected repos and offer them as additions. Without
      // this the form can only remove repos, not add new ones.
      res.json({ ok: true, workspace: ws, path: reg.path });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/workspaces/:name/setup/preflight (W-073) ─────────────────
  // Aggregate setup preflight across every child project of the workspace.
  // Graphify/CRG are host-global tools, so their install state is reported
  // once; base branch and current settings are reported per child.
  workspaces.get('/:name/setup/preflight', async (req, res) => {
    const name = sanitizeFilename(req.params.name);
    const regPath = join(workspacesDir, `${name}.json`);
    if (!existsSync(regPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace "${name}" not found` });
    }
    try {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const ws = readWorkspaceJson(reg.path);
      if (!ws) {
        return res.status(404).json({
          ok: false,
          error: `workspace.json not found at ${reg.path}`,
        });
      }
      const graphifyStatus = req.app.locals.graphifyStatus || null;
      const crgStatus = req.app.locals.crgStatus || null;
      const projects = [];
      for (const p of ws.projects ?? []) {
        const projectRoot = join(reg.path, p.path);
        const settingsPath = join(projectRoot, '.claude', 'settings.json');
        const worcaConfigPath = join(
          worcaHome(), 'projects', slugify(basename(projectRoot)), 'config.json',
        );
        const pf = await buildProjectPreflight({
          projectRoot,
          settingsPath,
          worcaConfigPath,
          graphifyStatus,
          crgStatus,
        });
        projects.push({ name: p.name, path: p.path, ...pf });
      }
      // Host-global tool install state — read once from the first child (all
      // children share the same host), defaulting to false for empty workspaces.
      const graphifyInstalled = projects.some((p) => p.graphifyInstalled);
      const crgInstalled = projects.some((p) => p.crgInstalled);
      // Only globally-accessible templates (builtin + user) are offered at the
      // workspace level — project-tier templates are per-project. Builtin
      // templates resolve from a child's runtime copy, so list from the first
      // child root and drop any project-tier entries.
      let templates = [];
      const firstChildRoot =
        (ws.projects ?? []).length > 0
          ? join(reg.path, ws.projects[0].path)
          : null;
      if (firstChildRoot) {
        try {
          templates = listTemplatesFlat(firstChildRoot).filter(
            (t) => t.tier !== 'project',
          );
        } catch {
          templates = [];
        }
      }
      res.json({
        ok: true,
        isWorkspace: true,
        projectCount: projects.length,
        graphifyInstalled,
        crgInstalled,
        projects,
        templates,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/workspaces/:name/setup/apply (W-073) ────────────────────
  // Apply one wizard step's patch to every child project's settings.json.
  workspaces.post('/:name/setup/apply', (req, res) => {
    const name = sanitizeFilename(req.params.name);
    const regPath = join(workspacesDir, `${name}.json`);
    if (!existsSync(regPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace "${name}" not found` });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res
        .status(400)
        .json({ ok: false, error: 'Request body must be a JSON object' });
    }
    try {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const ws = readWorkspaceJson(reg.path);
      if (!ws) {
        return res.status(404).json({
          ok: false,
          error: `workspace.json not found at ${reg.path}`,
        });
      }
      const applied = [];
      for (const p of ws.projects ?? []) {
        const settingsPath = join(reg.path, p.path, '.claude', 'settings.json');
        applySetupPatch(settingsPath, body);
        applied.push(p.name);
      }
      res.json({ ok: true, applied });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── PUT /api/workspaces/:name ─────────────────────────────────────────
  workspaces.put('/:name', (req, res) => {
    const name = sanitizeFilename(req.params.name);
    const regPath = join(workspacesDir, `${name}.json`);
    if (!existsSync(regPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace "${name}" not found` });
    }

    let reg;
    try {
      reg = JSON.parse(readFileSync(regPath, 'utf8'));
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }

    const pointers = listPointers(workspaceRunsDir);
    const hasActiveRuns = pointers.some((p) => {
      if (p.workspace_root !== reg.path) return false;
      const m = readManifest(workspaceRunsDir, p.workspace_id);
      return m && ACTIVE_STATUSES.has(m.status);
    });

    if (hasActiveRuns) {
      return res.status(409).json({
        ok: false,
        error:
          'Cannot edit workspace while active runs exist. Halt or wait for completion.',
      });
    }

    const updated = req.body ?? {};
    const projects = updated.projects ?? [];
    const cycleErr = detectCycle(projects);
    if (cycleErr) {
      return res.status(422).json({ ok: false, error: cycleErr });
    }

    try {
      writeFileSync(
        join(reg.path, 'workspace.json'),
        `${JSON.stringify(updated, null, 2)}\n`,
        'utf8',
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── DELETE /api/workspaces/:name ──────────────────────────────────────
  workspaces.delete('/:name', (req, res) => {
    const name = sanitizeFilename(req.params.name);
    const regPath = join(workspacesDir, `${name}.json`);
    if (!existsSync(regPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace "${name}" not found` });
    }

    let reg;
    try {
      reg = JSON.parse(readFileSync(regPath, 'utf8'));
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }

    // Refuse deletion while any non-terminal run still references the
    // workspace root — deleting the topology mid-flight would orphan the
    // children and leave the manifest pointing at a missing workspace.json.
    const pointers = listPointers(workspaceRunsDir);
    const activeRuns = pointers.filter((p) => {
      if (p.workspace_root !== reg.path) return false;
      const m = readManifest(workspaceRunsDir, p.workspace_id);
      return m && ACTIVE_STATUSES.has(m.status);
    });

    if (activeRuns.length > 0) {
      return res.status(409).json({
        ok: false,
        error: `Cannot delete workspace while ${activeRuns.length} active run(s) reference it. Halt them first.`,
      });
    }

    // Remove both the registration and the topology file in the parent.
    // Caller (UI) confirmed this is destructive before reaching here.
    try {
      unlinkSync(regPath);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: `Failed to remove registration: ${err.message}`,
      });
    }

    const wsJsonPath = join(reg.path, 'workspace.json');
    if (existsSync(wsJsonPath)) {
      try {
        unlinkSync(wsJsonPath);
      } catch (err) {
        // Registration already gone — surface the partial failure but don't
        // pretend success; user may want to clean up the leftover file.
        return res.status(500).json({
          ok: false,
          error: `Registration removed, but failed to delete ${wsJsonPath}: ${err.message}`,
        });
      }
    }

    res.json({ ok: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // workspaceRuns router — mounted at /api/workspace-runs
  // ════════════════════════════════════════════════════════════════════════

  // ── POST /api/workspace-runs/validate-gh-auth ─────────────────────────
  workspaceRuns.post('/validate-gh-auth', async (req, res) => {
    const { workspace_name } = req.body ?? {};
    if (!workspace_name || typeof workspace_name !== 'string') {
      return res
        .status(400)
        .json({ ok: false, error: 'workspace_name is required' });
    }

    const safeWsName = sanitizeFilename(workspace_name);
    const regPath = join(workspacesDir, `${safeWsName}.json`);
    if (!existsSync(regPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace "${workspace_name}" not found` });
    }

    try {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const ws = readWorkspaceJson(reg.path);
      const missing_orgs = await validateGhAuth(ws);
      res.json({ ok: missing_orgs.length === 0, missing_orgs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/workspace-runs/validate-base ────────────────────────────
  workspaceRuns.post('/validate-base', async (req, res) => {
    const { workspace_name, base_branch } = req.body ?? {};
    if (!workspace_name || typeof workspace_name !== 'string') {
      return res
        .status(400)
        .json({ ok: false, error: 'workspace_name is required' });
    }
    if (!base_branch || typeof base_branch !== 'string') {
      return res
        .status(400)
        .json({ ok: false, error: 'base_branch is required' });
    }

    const safeWsName = sanitizeFilename(workspace_name);
    const regPath = join(workspacesDir, `${safeWsName}.json`);
    if (!existsSync(regPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace "${workspace_name}" not found` });
    }

    try {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const ws = readWorkspaceJson(reg.path);
      if (!ws) {
        return res.status(404).json({
          ok: false,
          error: `workspace.json not found at ${reg.path}`,
        });
      }

      const missing_in = [];
      for (const project of ws.projects) {
        const projectPath = join(reg.path, project.path);
        const exists = await validateBaseBranch(projectPath, base_branch);
        if (!exists) missing_in.push(project.name);
      }
      res.json({ ok: missing_in.length === 0, missing_in });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/workspace-runs ──────────────────────────────────────────
  workspaceRuns.post('/', async (req, res) => {
    try {
      const contentType = req.headers['content-type'] ?? '';
      const isMultipart = contentType.includes('multipart/form-data');

      let fields = {};
      const guideFiles = [];
      let workspacePlanFileData = null;
      const projectPlanFiles = {};

      if (isMultipart) {
        const rawBody = await readRawBody(req);
        const parts = parseMultipart(rawBody, contentType);
        if (!parts) {
          return res
            .status(400)
            .json({ ok: false, error: 'Failed to parse multipart body' });
        }
        for (const part of parts) {
          if (part.name === 'workspace_plan_file' && part.filename != null) {
            workspacePlanFileData = {
              filename: part.filename,
              content: part.content,
            };
          } else if (
            part.name?.startsWith('project_plan_') &&
            part.filename != null
          ) {
            const projectName = part.name.slice('project_plan_'.length);
            projectPlanFiles[projectName] = {
              filename: part.filename,
              content: part.content,
            };
          } else if (part.filename != null) {
            guideFiles.push({ filename: part.filename, content: part.content });
          } else if (part.name) {
            fields[part.name] = part.content.toString('utf8');
          }
        }
      } else {
        fields = req.body ?? {};
      }

      const {
        workspace_name,
        prompt,
        source,
        plan_mode,
        branch_template,
        max_parallel = 5,
      } = fields;

      if (!workspace_name) {
        return res
          .status(400)
          .json({ ok: false, error: 'workspace_name is required' });
      }
      if (!prompt && !source) {
        return res
          .status(400)
          .json({ ok: false, error: 'prompt or source is required' });
      }

      const safeWsName = sanitizeFilename(workspace_name);
      const regPath = join(workspacesDir, `${safeWsName}.json`);
      if (!existsSync(regPath)) {
        return res.status(404).json({
          ok: false,
          error: `Workspace "${workspace_name}" not found`,
        });
      }

      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const wsRoot = reg.path;
      const ws = readWorkspaceJson(wsRoot);
      if (!ws) {
        return res.status(404).json({
          ok: false,
          error: `workspace.json not found at ${wsRoot}`,
        });
      }

      const cycleErr = detectCycle(ws.projects);
      if (cycleErr) {
        return res.status(422).json({ ok: false, error: cycleErr });
      }

      const { workspace_id, workspace_id_short } = generateWorkspaceId();
      const wsRunDir = join(wsRoot, '.worca', 'workspace-runs', workspace_id);
      mkdirSync(wsRunDir, { recursive: true });

      mkdirSync(workspaceRunsDir, { recursive: true });
      writeFileSync(
        join(workspaceRunsDir, `${workspace_id}.json`),
        `${JSON.stringify({ workspace_root: wsRoot, workspace_id }, null, 2)}\n`,
      );

      let guideEntry = null;
      if (guideFiles.length > 0) {
        const totalBytes = guideFiles.reduce((s, f) => s + f.content.length, 0);
        if (totalBytes > guideCapBytes) {
          return res.status(400).json({
            ok: false,
            error: `Guide files exceed size cap of ${guideCapBytes} bytes`,
          });
        }
        const guidesDir = join(wsRunDir, 'guides');
        mkdirSync(guidesDir, { recursive: true });
        const paths = [];
        const filenames = [];
        const usedNames = new Set();
        for (const { filename, content } of guideFiles) {
          let safe = sanitizeFilename(filename);
          if (usedNames.has(safe)) {
            const dot = safe.lastIndexOf('.');
            const nameBase = dot !== -1 ? safe.slice(0, dot) : safe;
            const ext = dot !== -1 ? safe.slice(dot) : '';
            let counter = 1;
            while (usedNames.has(`${nameBase}-${counter}${ext}`)) counter++;
            safe = `${nameBase}-${counter}${ext}`;
          }
          usedNames.add(safe);
          writeFileSync(join(guidesDir, safe), content);
          paths.push(join(guidesDir, safe));
          filenames.push(safe);
        }
        guideEntry = { paths, bytes: totalBytes, filenames, uploaded: true };
      }

      // ── workspace plan file upload / server-side path ──────────────
      let workspacePlanPath = null;
      if (workspacePlanFileData) {
        if (workspacePlanFileData.content.length > WORKSPACE_PLAN_CAP_BYTES) {
          return res.status(400).json({
            ok: false,
            error: 'Workspace plan exceeds 256 KB limit',
          });
        }
        workspacePlanPath = join(wsRunDir, 'workspace-plan.json');
        writeFileSync(workspacePlanPath, workspacePlanFileData.content);
      } else if (fields.workspace_plan) {
        if (!existsSync(fields.workspace_plan)) {
          return res.status(400).json({
            ok: false,
            error: `workspace_plan path not found: ${fields.workspace_plan}`,
          });
        }
        workspacePlanPath = fields.workspace_plan;
      }

      // ── per-project plan file uploads ──────────────────────────────
      const projectPlans = {};
      for (const [name, file] of Object.entries(projectPlanFiles)) {
        if (file.content.length > PROJECT_PLAN_CAP_BYTES) {
          return res.status(400).json({
            ok: false,
            error: `Project plan for "${name}" exceeds 256 KB limit`,
          });
        }
        const safeName = sanitizeFilename(name);
        const plansDir = join(wsRunDir, 'plans');
        mkdirSync(plansDir, { recursive: true });
        const planPath = join(plansDir, `${safeName}.md`);
        writeFileSync(planPath, file.content);
        projectPlans[name] = planPath;
      }

      // ── resolve plan strategy + validate ──────────────────────────
      const planResult = _resolvePlanStrategy(
        plan_mode,
        workspacePlanPath,
        Object.keys(projectPlans).length > 0 ? projectPlans : null,
        ws,
      );
      if (!planResult.ok) {
        return res
          .status(planResult.status)
          .json({ ok: false, error: planResult.error });
      }

      const tiers = computeTiers(ws.projects);
      const dagTiers = tiers.map((projects, i) => ({
        tier: i,
        projects,
        status: 'pending',
      }));

      const manifest = {
        workspace_id,
        workspace_id_short,
        workspace_name: ws.name,
        workspace_root: wsRoot,
        created_at: new Date().toISOString(),
        work_request: {
          title: (prompt || source || '').slice(0, 80),
          description: prompt ?? '',
          source: source ?? null,
        },
        guide: guideEntry,
        ...planResult.fields,
        branch_template: branch_template ?? 'workspace/{slug}/{project}',
        max_parallel: Number(max_parallel) || 5,
        skip_integration: false,
        status: 'planning',
        halt_reason: null,
        dag: { tiers: dagTiers },
        children: [],
        integration_test: {
          status: 'pending',
          exit_code: null,
          log_path: null,
        },
      };

      saveManifest(manifest);

      if (dispatchWorkspace) {
        try {
          await dispatchWorkspace({
            workspace_id,
            workspace_root: wsRoot,
            manifest,
          });
        } catch (err) {
          manifest.status = 'failed';
          saveManifest(manifest);
          return res
            .status(500)
            .json({ ok: false, error: `Dispatch failed: ${err.message}` });
        }
      }

      res.status(201).json({ ok: true, workspace_id });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/workspace-runs ───────────────────────────────────────────
  //
  // Returns a list of workspace summaries. The payload includes a compact
  // `children` array (one slim record per dispatched child) so the card
  // can render `projectBadgesView` without a separate detail fetch per
  // workspace — mirrors fleet-routes.js.
  workspaceRuns.get('/', (_req, res) => {
    try {
      const pointers = listPointers(workspaceRunsDir);
      const runs = [];
      for (const pointer of pointers) {
        const m = readManifest(workspaceRunsDir, pointer.workspace_id);
        if (!m) continue;
        // Reconcile against live child statuses so the badge reflects
        // what's actually happening instead of the orchestrator's last
        // write. Sticky states (planning / integration_testing /
        // halted / paused / integration_failed) pass through unchanged.
        const { status, halt_reason } = reconcileWorkspaceStatus(m);
        // Slim child records for projectBadgesView. Pass project, project_path
        // (used by fleet-card's _shortRepoName fallback), and the live status
        // (reconcile already enriched it onto manifest.children via the
        // mutation inside reconcileWorkspaceStatus → enrichChildStatus).
        const children = (m.children ?? []).map((c) => {
          const enriched = enrichChildStatus(c);
          return {
            project: enriched.project,
            project_path: enriched.project_path,
            run_id: enriched.run_id,
            status: enriched.status,
            tier: enriched.tier,
          };
        });
        runs.push({
          workspace_id: m.workspace_id,
          workspace_name: m.workspace_name,
          workspace_root: m.workspace_root,
          status,
          halt_reason,
          work_request: m.work_request,
          created_at: m.created_at,
          finished_at: _synthesizeFinishedAt(m),
          dag: m.dag,
          children,
          children_count: children.length,
        });
      }
      res.json({ ok: true, workspace_runs: runs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/workspace-runs/:id ───────────────────────────────────────
  workspaceRuns.get('/:id', (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }
    // Reconcile status against live child statuses before responding so
    // detail-view consumers see the same effective status as the list.
    // reconcileWorkspaceStatus mutates manifest.status / halt_reason in
    // place and persists when changed.
    reconcileWorkspaceStatus(manifest);
    const children = (manifest.children ?? []).map(enrichChildStatus);
    const cost_usd = aggregateCost(manifest);
    // Synthesize finished_at for terminal manifests so the UI can compute
    // a stable duration. Older runs (pre-this-fix) and any run whose
    // status was set to terminal without updating the manifest field will
    // get a value derived from the child status.json updated_at maxima.
    const finished_at = _synthesizeFinishedAt(manifest);
    res.json({
      ok: true,
      manifest: { ...manifest, children, finished_at },
      cost_usd,
    });
  });

  // ── DELETE /api/workspace-runs/:id ────────────────────────────────────
  workspaceRuns.delete('/:id', async (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    const { cleanup, force } = req.query;
    const status = manifest.status;
    const isResumable = RESUMABLE_STATUSES.has(status);

    if (cleanup === '1' && isResumable && force !== '1') {
      return res.status(412).json({
        ok: false,
        error:
          'Workspace is in a resumable state. Pass ?force=1 to confirm cleanup.',
        current_status: status,
      });
    }

    if (cleanup !== '1' && isResumable) {
      return res.json({ ok: true, already_halted: true });
    }

    haltWorkspace(id);

    if (cleanup === '1') {
      try {
        const cleanResult = (await runCleanup(id)) ?? {};
        return res.json({ ok: true, ...cleanResult });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: `Cleanup failed: ${err.message}` });
      }
    }

    res.json({ ok: true });
  });

  // ── POST /api/workspace-runs/:id/resume ───────────────────────────────
  workspaceRuns.post('/:id/resume', async (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    if (manifest.status === 'running' || manifest.status === 'planning') {
      return res
        .status(409)
        .json({ ok: false, error: 'Workspace is already running' });
    }

    if (dispatchWorkspace) {
      try {
        await dispatchWorkspace({
          workspace_id: id,
          workspace_root: manifest.workspace_root,
          manifest,
          resume: true,
        });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: `Resume failed: ${err.message}` });
      }
    }

    manifest.status = 'running';
    manifest.halt_reason = null;
    saveManifest(manifest);

    res.json({ ok: true });
  });

  // ── POST /api/workspace-runs/:id/relaunch ─────────────────────────────
  workspaceRuns.post('/:id/relaunch', async (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    const overrides = req.body ?? {};
    const { workspace_id: newId, workspace_id_short: newShort } =
      generateWorkspaceId();

    const newManifest = {
      ...manifest,
      workspace_id: newId,
      workspace_id_short: newShort,
      created_at: new Date().toISOString(),
      status: 'planning',
      halt_reason: null,
      children: [],
      work_request: {
        ...manifest.work_request,
        ...(overrides.prompt
          ? {
              description: overrides.prompt,
              title: overrides.prompt.slice(0, 80),
            }
          : {}),
      },
      integration_test: {
        status: 'pending',
        exit_code: null,
        log_path: null,
      },
    };

    if (newManifest.dag?.tiers) {
      newManifest.dag.tiers = newManifest.dag.tiers.map((t) => ({
        ...t,
        status: 'pending',
      }));
    }

    mkdirSync(workspaceRunsDir, { recursive: true });
    writeFileSync(
      join(workspaceRunsDir, `${newId}.json`),
      `${JSON.stringify({ workspace_root: manifest.workspace_root, workspace_id: newId }, null, 2)}\n`,
    );

    const newRunDir = join(
      manifest.workspace_root,
      '.worca',
      'workspace-runs',
      newId,
    );
    mkdirSync(newRunDir, { recursive: true });
    saveManifest(newManifest);

    if (dispatchWorkspace) {
      try {
        await dispatchWorkspace({
          workspace_id: newId,
          workspace_root: manifest.workspace_root,
          manifest: newManifest,
        });
      } catch (err) {
        newManifest.status = 'failed';
        saveManifest(newManifest);
        return res
          .status(500)
          .json({ ok: false, error: `Relaunch failed: ${err.message}` });
      }
    }

    res.status(201).json({ ok: true, new_workspace_id: newId });
  });

  // ── POST /api/workspace-runs/:id/re-run-integration ───────────────────
  workspaceRuns.post('/:id/re-run-integration', async (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    try {
      const result = await runIntegrationTest(manifest);
      manifest.integration_test = result;
      if (result.status === 'passed') {
        manifest.status = 'completed';
      } else {
        manifest.status = 'integration_failed';
      }
      saveManifest(manifest);
      res.json({ ok: true, integration_test: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/workspace-runs/:id/plan ──────────────────────────────────
  workspaceRuns.get('/:id/plan', (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    const dir = runDir(manifest);
    const wantsJson = (req.headers.accept ?? '').includes('application/json');

    if (wantsJson) {
      const jsonPath = join(dir, 'workspace-plan.json');
      if (!existsSync(jsonPath)) {
        return res
          .status(404)
          .json({ ok: false, error: 'No plan found for this workspace run' });
      }
      try {
        const plan = JSON.parse(readFileSync(jsonPath, 'utf8'));
        res.json(plan);
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    } else {
      const mdPath = join(dir, 'workspace-plan.md');
      if (!existsSync(mdPath)) {
        return res
          .status(404)
          .json({ ok: false, error: 'No plan found for this workspace run' });
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.send(readFileSync(mdPath, 'utf8'));
    }
  });

  // ── PUT /api/workspace-runs/:id/plan ──────────────────────────────────
  workspaceRuns.put('/:id/plan', (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    if (!PLAN_EDITABLE_STATUSES.has(manifest.status)) {
      return res.status(409).json({
        ok: false,
        error: `Cannot edit plan in "${manifest.status}" state`,
        current_status: manifest.status,
      });
    }

    const { plan_json } = req.body ?? {};
    if (!plan_json || typeof plan_json !== 'object') {
      return res
        .status(400)
        .json({ ok: false, error: 'plan_json is required' });
    }

    try {
      const dir = runDir(manifest);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'workspace-plan.json'),
        `${JSON.stringify(plan_json, null, 2)}\n`,
        'utf8',
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/workspace-runs/:id/guide ─────────────────────────────────
  workspaceRuns.get('/:id/guide', (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    const guide = manifest.guide;
    if (!guide?.paths?.length) {
      return res
        .status(404)
        .json({ ok: false, error: 'No guide attached to this workspace run' });
    }

    const chunks = [];
    for (const guidePath of guide.paths) {
      try {
        chunks.push(readFileSync(guidePath, 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EACCES') {
          return res.status(404).json({
            ok: false,
            error: 'guide_not_retrievable',
            hint: 'Guide was supplied via CLI from a path the UI server cannot read.',
          });
        }
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(chunks.join('\n\n---\n\n'));
  });

  // ── GET /api/workspace-runs/:id/integration-log ───────────────────────
  workspaceRuns.get('/:id/integration-log', (req, res) => {
    const { id } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    const logPath = manifest.integration_test?.log_path;
    if (!logPath || !existsSync(logPath)) {
      return res
        .status(404)
        .json({ ok: false, error: 'No integration test log available' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(readFileSync(logPath, 'utf8'));
  });

  // ── GET /api/workspace-runs/:id/context/:project ─────────────────────────
  workspaceRuns.get('/:id/context/:project', (req, res) => {
    const { id, project } = req.params;
    if (!validateWsId(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid workspace ID' });
    }
    const manifest = readManifest(workspaceRunsDir, id);
    if (!manifest) {
      return res
        .status(404)
        .json({ ok: false, error: `Workspace run "${id}" not found` });
    }

    const safeProject = basename(project);
    const contextPath = join(
      runDir(manifest),
      'context',
      `${safeProject}-diff.md`,
    );
    if (!existsSync(contextPath)) {
      return res.status(404).json({
        ok: false,
        error: `No context artifact found for project "${safeProject}"`,
      });
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(readFileSync(contextPath, 'utf8'));
  });

  return { workspaces, workspaceRuns };
}
