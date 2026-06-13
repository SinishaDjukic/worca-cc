/**
 * REST API routes for multi-project management.
 *
 * - createProjectRoutes()       → CRUD on /api/projects
 * - projectResolver()           → middleware for /api/projects/:projectId/...
 * - createProjectScopedRoutes() → sub-routes under a resolved project
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import lockfile from 'proper-lockfile';
import { actionAllowed } from '../app/utils/state-actions.js';
import { atomicWriteSync } from './atomic-write.js';
import { dbExists, getIssue, listIssues } from './beads-reader.js';
import { dispatchExternal } from './dispatch-external.js';
import { migrateDispatchGovernance } from './dispatch-migration.js';
import { ensureWebhookForUi } from './ensure-webhook.js';
import { getDefaultBranch } from './git-helpers.js';
import { extractAndStripGlobalKeys } from './global-keys.js';
import { LaunchLock } from './launch-lock.js';
import { createModelEnvRouter } from './model-env-routes.js';
import { createModelsRouter } from './models-routes.js';
import { globalSettingsPath, preferencesPath } from './paths.js';
import { readPreferences } from './preferences.js';
import { ProcessManager } from './process-manager.js';
import { countRunningPipelinesAcrossProjects } from './process-registry.js';
import {
  getMaxProjects,
  readProjects,
  removeProject,
  SLUG_RE,
  synthesizeDefaultProject,
  validateProjectEntry,
  writeProject,
} from './project-registry.js';
import {
  deepMerge,
  localPathFor,
  readEffectiveSettings,
  readLocalSettings,
  readMergedSettings,
} from './settings-merge.js';
import { readGlobalSettings, writeGlobalSettings } from './settings-reader.js';
import { validateSettingsPayload } from './settings-validator.js';
import { createTemplatesRoutes } from './templates-routes.js';
import { isVersionBehind } from './version-check.js';
import { getVersionInfo } from './versions.js';
import { discoverRuns, discoverRunsAsync } from './watcher.js';
import {
  checkWorcaInstalled,
  readProjectWorcaVersion,
  runWorcaSetup,
} from './worca-setup.js';
import {
  applySetupPatch,
  buildProjectPreflight,
} from './worca-setup-config.js';
import { createWorktreesRouter } from './worktrees-routes.js';

/** Validate a runId — must not contain path traversal characters */
const RUN_ID_RE = /^[a-zA-Z0-9_-]+$/;
function validateRunId(runId) {
  return (
    typeof runId === 'string' &&
    runId.length > 0 &&
    runId.length <= 128 &&
    RUN_ID_RE.test(runId)
  );
}

// Re-exported from run-dir-resolver so callers (including older tests) can
// continue importing from project-routes. The implementation now overlays
// worktree runs registered in <worcaDir>/multi/pipelines.d/.
import {
  findRunStatusPath,
  listPlanIterations,
  readPipelineOverlay,
  resolveRunDir,
  updatePipelineStatus,
} from './run-dir-resolver.js';
export { findRunStatusPath };

/** Validate a branch name — alphanumeric, dots, hyphens, underscores, slashes */
const BRANCH_RE = /^[\w.\-/]+$/;

/** Validate a template identifier — lowercase alphanumeric and hyphens, 1-64 chars */
const TEMPLATE_RE = /^[a-z0-9-]{1,64}$/;
function validateBranch(branch) {
  return (
    typeof branch === 'string' && branch.length <= 200 && BRANCH_RE.test(branch)
  );
}

/** Validate a plan file path — relative, no traversal */
function validatePlanFile(planFile) {
  if (typeof planFile !== 'string' || planFile.trim().length === 0)
    return false;
  const normalized = planFile.trim();
  if (normalized.startsWith('/') || normalized.includes('..')) return false;
  return true;
}

/**
 * Middleware that resolves :projectId to a project entry and attaches it to req.project.
 * Falls back to synthesized default if no projects.d/ exists.
 */
export function projectResolver({ prefsDir, projectRoot }) {
  return (req, res, next) => {
    const projectId = req.params.projectId;
    const projects = readProjects(prefsDir);

    let project;
    if (projects.length > 0) {
      project = projects.find((p) => p.name === projectId);
    } else {
      // Single-project mode — synthesize from projectRoot
      const synth = synthesizeDefaultProject(projectRoot);
      if (synth.name === projectId) {
        project = synth;
      }
    }

    if (!project) {
      return res
        .status(404)
        .json({ ok: false, error: `Project "${projectId}" not found` });
    }

    const worcaDir = project.worcaDir || join(project.path, '.worca');
    const projRoot = project.path;
    req.project = {
      name: project.name,
      path: project.path,
      worcaDir,
      settingsPath:
        project.settingsPath || join(project.path, '.claude', 'settings.json'),
      projectRoot: projRoot,
      pm: new ProcessManager({
        worcaDir,
        projectRoot: projRoot,
        settingsPath:
          project.settingsPath ||
          join(project.path, '.claude', 'settings.json'),
        prefsDir,
      }),
    };
    next();
  };
}

/**
 * Router for project CRUD: GET/POST/DELETE /api/projects[/:id]
 */
export function createProjectRoutes({
  prefsDir,
  projectRoot,
  serverHost,
  serverPort,
}) {
  const router = Router();

  // GET /api/projects — list all projects (or synthesized default)
  router.get('/', (_req, res) => {
    let projects = readProjects(prefsDir);
    if (projects.length === 0) {
      projects = [synthesizeDefaultProject(projectRoot)];
    }
    // Enrich each project with its worca-cc version
    const enriched = projects.map((p) => ({
      ...p,
      worcaVersion: readProjectWorcaVersion(p.path),
    }));
    res.json({ ok: true, projects: enriched });
  });

  // POST /api/projects — create a new project
  router.post('/', (req, res) => {
    const entry = req.body;
    const validation = validateProjectEntry(entry);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, error: validation.error });
    }
    if (!existsSync(entry.path)) {
      return res
        .status(400)
        .json({ ok: false, error: `directory does not exist: ${entry.path}` });
    }
    try {
      writeProject(prefsDir, entry);
      // Auto-configure webhook so pipeline events reach this UI server
      if (serverHost && serverPort) {
        try {
          ensureWebhookForUi(entry.path, {
            host: serverHost,
            port: serverPort,
          });
        } catch {
          /* best-effort — don't fail project creation */
        }
      }
      res.status(201).json({ ok: true, project: entry });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/projects/:id — remove a project
  router.delete('/:id', (req, res) => {
    const id = req.params.id;
    if (!SLUG_RE.test(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid project id' });
    }
    removeProject(prefsDir, id);
    res.json({ ok: true, removed: id });
  });

  // POST /api/projects/batch — register multiple projects atomically
  router.post('/batch', (req, res) => {
    const { projects: batch } = req.body || {};
    if (!Array.isArray(batch) || batch.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'projects must be a non-empty array' });
    }

    // Validate all entries first (all-or-nothing)
    const failed = [];
    for (const entry of batch) {
      const validation = validateProjectEntry(entry);
      if (!validation.valid) {
        failed.push({ name: entry?.name ?? '', error: validation.error });
        continue;
      }
      if (!existsSync(entry.path)) {
        failed.push({
          name: entry.name,
          error: `directory does not exist: ${entry.path}`,
        });
      }
    }
    if (failed.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `${failed.length} project${failed.length > 1 ? 's' : ''} failed validation`,
        failed,
      });
    }

    // Check for intra-batch duplicate names
    const batchNames = batch.map((e) => e?.name).filter(Boolean);
    if (new Set(batchNames).size < batchNames.length) {
      return res
        .status(400)
        .json({ ok: false, error: 'Duplicate names within batch' });
    }

    // Check for intra-batch duplicate paths
    const batchPaths = batch.map((e) => e?.path).filter(Boolean);
    if (new Set(batchPaths).size < batchPaths.length) {
      return res
        .status(400)
        .json({ ok: false, error: 'Duplicate paths within batch' });
    }

    // Check for duplicate paths against existing projects
    const existing = readProjects(prefsDir);
    const existingPaths = new Set(
      existing.map((p) => p.path.replace(/\/+$/, '')),
    );
    const duplicates = batch.filter((entry) =>
      existingPaths.has(entry.path.replace(/\/+$/, '')),
    );
    if (duplicates.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `${duplicates.length} project${duplicates.length > 1 ? 's' : ''} already registered`,
        failed: duplicates.map((entry) => ({
          name: entry.name,
          error: `path already registered: ${entry.path}`,
        })),
      });
    }

    // Check max projects limit
    const max = getMaxProjects(prefsDir);
    if (existing.length + batch.length > max) {
      return res.status(400).json({
        ok: false,
        error: `adding ${batch.length} project${batch.length > 1 ? 's' : ''} would exceed the limit of ${max}`,
      });
    }

    // Write all projects — roll back on partial failure
    const written = [];
    try {
      for (const entry of batch) {
        writeProject(prefsDir, entry);
        written.push(entry.name);
        if (serverHost && serverPort) {
          try {
            ensureWebhookForUi(entry.path, {
              host: serverHost,
              port: serverPort,
            });
          } catch {
            /* best-effort */
          }
        }
      }
      res.status(201).json({ ok: true, projects: batch });
    } catch (err) {
      for (const name of written) {
        try {
          removeProject(prefsDir, name);
        } catch {
          // ignore rollback errors
        }
      }
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  return router;
}

/**
 * Router for project-scoped sub-routes.
 * The projectResolver middleware must run before this to set req.project.
 * @param {{ prefsDir?: string|null, launchLock?: LaunchLock }} [options] —
 *   prefsDir enables active worca-cc version lookup for /worca-status'
 *   `outdated` flag and gates the global max_concurrent_pipelines check.
 *   launchLock should be injected by createApp so all routers share the
 *   same mutex; falls back to a per-router instance if omitted (tests).
 */
export function createProjectScopedRoutes({
  prefsDir = null,
  serverHost,
  serverPort,
  launchLock = new LaunchLock(),
} = {}) {
  const router = Router({ mergeParams: true });
  const prefsPath = prefsDir ? join(prefsDir, 'preferences.json') : null;

  // Guard: run-related, cost, and pipeline routes require worcaDir
  function requireWorcaDir(req, res, next) {
    if (!req.project?.worcaDir) {
      return res
        .status(501)
        .json({ ok: false, error: 'worcaDir not configured' });
    }
    next();
  }

  // GET /api/projects/:projectId/info — project metadata
  // Note: Plan specified /project-info but /info is preferred since
  // the route is already scoped under /api/projects/:projectId/.
  router.get('/info', (req, res) => {
    res.json({ ok: true, project: req.project });
  });

  // GET /api/projects/:projectId/runs — list runs for this project
  router.get('/runs', requireWorcaDir, async (req, res) => {
    try {
      // List/sidebar path: scan off the event loop (async) and skip
      // events.jsonl enrichment entirely — neither the run list nor the sidebar
      // render dispatch_events / graph-query counts (issue #296).
      const runs = await discoverRunsAsync(req.project.worcaDir, {
        enrich: false,
      });
      const default_branch = getDefaultBranch(req.project.projectRoot);

      const { getBeadsCounts } = req.app.locals;
      if (getBeadsCounts) {
        try {
          const counts = await getBeadsCounts(req.project.name);
          if (counts) {
            for (const run of runs) {
              const c = counts[run.id];
              if (c) {
                run.beads_done = c.done;
                run.beads_total = c.total;
              }
            }
          }
        } catch {
          /* non-fatal — runs returned without bead counts */
        }
      }

      const response = { ok: true, runs, default_branch };
      // Include settings so multi-project clients can use loop limits, etc.
      const { settingsPath } = req.project;
      if (settingsPath && existsSync(settingsPath)) {
        try {
          response.settings = readMergedSettings(settingsPath);
        } catch {
          /* non-fatal — runs still returned */
        }
      }
      res.json(response);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/projects/:projectId/branches — list git branches
  router.get('/branches', (req, res) => {
    const cwd = req.project.projectRoot;
    try {
      const out = execFileSync('git', ['branch', '--format=%(refname:short)'], {
        cwd,
        encoding: 'utf8',
        timeout: 5000,
      });
      const branches = out.trim().split('\n').filter(Boolean);
      res.json({ ok: true, branches });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/projects/:projectId/plan-files — list plan files
  router.get('/plan-files', (req, res) => {
    const root = req.project.projectRoot;
    let dirs = ['docs/plans'];
    let extensions = ['.md'];

    const { settingsPath } = req.project;
    if (settingsPath && existsSync(settingsPath)) {
      try {
        const settings = readMergedSettings(settingsPath);
        const planFiles = settings.worca?.planFiles;
        if (planFiles?.dirs && Array.isArray(planFiles.dirs))
          dirs = planFiles.dirs;
        if (planFiles?.extensions && Array.isArray(planFiles.extensions))
          extensions = planFiles.extensions;
      } catch {
        /* use defaults */
      }
    }

    const files = [];
    for (const dir of dirs) {
      const absDir = join(root, dir);
      if (!existsSync(absDir)) continue;
      try {
        const entries = readdirSync(absDir);
        for (const name of entries.sort()) {
          if (extensions.some((ext) => name.endsWith(ext))) {
            files.push({ path: join(dir, name), dir, name });
          }
        }
      } catch {
        /* skip */
      }
    }
    res.json({ ok: true, files });
  });

  // --- Model env endpoints (legacy, writes wholesale to settings.local.json) ---
  router.use('/settings/model-env', createModelEnvRouter());

  // --- Models CRUD (tier-aware: builtin/user/project + co-located pricing) ---
  router.use('/models', createModelsRouter());

  // --- Template CRUD endpoints (templates-routes.js) ---
  router.use(createTemplatesRoutes());

  // --- Project Setup Wizard endpoints (W-073) ---

  // GET /api/projects/:projectId/setup/preflight
  // Read-only diagnostics for the setup wizard: git repo, detected PR base
  // branch, graphify/CRG install state, and the project's current values for
  // the keys the wizard manages (so re-running the wizard pre-populates).
  router.get('/setup/preflight', async (req, res) => {
    try {
      const { projectRoot, settingsPath } = req.project;
      const payload = await buildProjectPreflight({
        projectRoot,
        settingsPath,
        graphifyStatus: req.app.locals.graphifyStatus || null,
        crgStatus: req.app.locals.crgStatus || null,
      });
      res.json({ ok: true, ...payload });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/setup/apply
  // Apply one wizard step's patch to this project's settings.json. Body is a
  // partial { baseBranch | graphifyEnabled | crgEnabled | template }. The
  // wizard writes step-by-step, so partial completion is preserved.
  router.post('/setup/apply', (req, res) => {
    const { settingsPath } = req.project;
    if (!settingsPath) {
      return res
        .status(501)
        .json({ ok: false, error: 'settingsPath not configured' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res
        .status(400)
        .json({ ok: false, error: 'Request body must be a JSON object' });
    }
    try {
      const worca = applySetupPatch(settingsPath, body);
      res.json({ ok: true, worca });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // --- Project-scoped settings endpoints ---

  // GET /api/projects/:projectId/settings
  router.get('/settings', (req, res) => {
    const { settingsPath } = req.project;
    if (!settingsPath || !existsSync(settingsPath)) {
      return res.json({ worca: {}, permissions: {} });
    }
    try {
      const merged = readMergedSettings(settingsPath);
      res.json({
        worca: merged.worca || {},
        permissions: merged.permissions || {},
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: { code: 'read_error', message: err.message } });
    }
  });

  // GET /api/projects/:projectId/effective-settings
  //
  // Returns the fully-layered settings the Python runtime sees: user-global
  // base → user-global .local → project base → project .local. Used by UI
  // surfaces that must mirror runtime alias resolution (e.g. the per-agent
  // model dropdown in the template editor — without this, aliases that live
  // only in user-global ~/.worca/settings.json are invisible to projects).
  router.get('/effective-settings', (req, res) => {
    const { settingsPath } = req.project;
    try {
      const merged = readEffectiveSettings(settingsPath, globalSettingsPath());
      res.json({
        worca: merged.worca || {},
        permissions: merged.permissions || {},
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: { code: 'read_error', message: err.message } });
    }
  });

  // POST /api/projects/:projectId/settings
  router.post('/settings', async (req, res) => {
    const { settingsPath } = req.project;
    if (!settingsPath) {
      return res.status(501).json({
        error: {
          code: 'not_configured',
          message: 'settingsPath not configured',
        },
      });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Request body must be a JSON object',
          details: [],
        },
      });
    }

    let existingForValidation = {};
    try {
      if (existsSync(settingsPath)) {
        existingForValidation = JSON.parse(readFileSync(settingsPath, 'utf8'));
      }
    } catch {
      existingForValidation = {};
    }

    const validation = validateSettingsPayload(body, {
      existing: existingForValidation,
    });
    if (!validation.valid) {
      return res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Invalid settings payload',
          details: validation.details,
        },
      });
    }

    try {
      let baseChanged = false;
      let base = {};
      try {
        if (existsSync(settingsPath)) {
          base = JSON.parse(readFileSync(settingsPath, 'utf8'));
        }
      } catch {
        base = {};
      }

      if (body.worca && typeof body.worca === 'object') {
        if (!base.worca || typeof base.worca !== 'object') base.worca = {};
        base.worca = deepMerge(base.worca, body.worca);

        baseChanged = true;
      }

      // STEP 1: extract misplaced global keys + inert milestone keys
      const autoMigrated = extractAndStripGlobalKeys(base);

      // STEP 1a: migrate legacy subagent_dispatch → dispatch.subagents (W-054)
      if (base.worca) migrateDispatchGovernance(base.worca);

      // STEP 2: write extracted global keys to ~/.worca/settings.json
      const globalSettingsPath = prefsDir
        ? join(prefsDir, 'settings.json')
        : null;

      if (
        globalSettingsPath &&
        Object.keys(autoMigrated.globalExtracted).length > 0
      ) {
        let release;
        try {
          release = await lockfile.lock(globalSettingsPath, {
            retries: { retries: 5, minTimeout: 50, maxTimeout: 500 },
            realpath: false,
          });
          writeGlobalSettings(globalSettingsPath, {
            worca: autoMigrated.globalExtracted,
          });
        } catch (err) {
          return res.status(500).json({
            error: {
              code: 'global_write_error',
              message:
                'Failed to migrate global keys; project settings not saved.',
              detail: err.message,
            },
          });
        } finally {
          if (release) await release();
        }
      }

      // STEP 3: atomic project write
      if (baseChanged) {
        mkdirSync(dirname(settingsPath), { recursive: true });
        atomicWriteSync(settingsPath, `${JSON.stringify(base, null, 2)}\n`);
      }

      // STEP 3a: strip shadowed worca keys from settings.local.json. Local is
      // deep-merged over base on read, so a stale `worca.<key>` copy in local
      // would resurrect after the user saves a new value. `models` is excluded
      // because its env-portion lives in local by design (see model-env-routes).
      const lp = localPathFor(settingsPath);
      let localChanged = false;
      const localForPrune = readLocalSettings(settingsPath);
      if (
        body.worca &&
        typeof body.worca === 'object' &&
        localForPrune.worca &&
        typeof localForPrune.worca === 'object'
      ) {
        for (const key of Object.keys(body.worca)) {
          if (key === 'models') continue;
          if (key in localForPrune.worca) {
            delete localForPrune.worca[key];
            localChanged = true;
          }
        }
        if (localChanged && Object.keys(localForPrune.worca).length === 0) {
          delete localForPrune.worca;
        }
      }

      if (body.permissions !== undefined) {
        localForPrune.permissions = body.permissions;
        localChanged = true;
      }

      if (localChanged) {
        mkdirSync(dirname(lp), { recursive: true });
        writeFileSync(
          lp,
          `${JSON.stringify(localForPrune, null, 2)}\n`,
          'utf8',
        );
      }

      const merged = readMergedSettings(settingsPath);
      res.json({
        worca: merged.worca || {},
        permissions: merged.permissions || {},
        autoMigrated,
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: { code: 'write_error', message: err.message } });
    }
  });

  // DELETE /api/projects/:projectId/settings/:section
  const SECTION_KEYS = {
    agents: { worca: ['agents'] },
    models: { worca: ['models'] },
    pipeline: { worca: ['stages', 'loops', 'plan_path_template', 'defaults'] },
    governance: { worca: ['governance'], top: ['permissions'] },
    pricing: { worca: ['pricing'] },
    webhooks: { worca: ['events', 'budget', 'webhooks'] },
  };

  router.delete('/settings/:section', (req, res) => {
    const { settingsPath } = req.project;
    if (!settingsPath) {
      return res.status(501).json({
        error: {
          code: 'not_configured',
          message: 'settingsPath not configured',
        },
      });
    }

    const section = req.params.section;
    const mapping = SECTION_KEYS[section];
    if (!mapping) {
      return res.status(400).json({
        error: {
          code: 'invalid_section',
          message: `Unknown section: ${section}. Valid: ${Object.keys(SECTION_KEYS).join(', ')}`,
        },
      });
    }

    try {
      // Mirror the persistence split used in POST: worca-namespace keys live
      // in settings.json; top-level keys (permissions) live in
      // settings.local.json. Reset removes from both as needed and also
      // clears any legacy worca-namespace overrides that may still exist in
      // settings.local.json from before the split.
      const lp = localPathFor(settingsPath);
      const local = readLocalSettings(settingsPath);
      let baseChanged = false;
      let base = {};
      try {
        if (existsSync(settingsPath)) {
          base = JSON.parse(readFileSync(settingsPath, 'utf8'));
        }
      } catch {
        base = {};
      }

      if (mapping.worca) {
        if (base.worca) {
          for (const key of mapping.worca) {
            if (key in base.worca) {
              delete base.worca[key];
              baseChanged = true;
            }
          }
          if (Object.keys(base.worca).length === 0) delete base.worca;
        }
        // Strip any legacy local override at the same paths.
        if (local.worca) {
          for (const key of mapping.worca) delete local.worca[key];
          if (Object.keys(local.worca).length === 0) delete local.worca;
        }
      }
      if (mapping.top) {
        for (const key of mapping.top) delete local[key];
      }

      if (baseChanged) {
        mkdirSync(dirname(settingsPath), { recursive: true });
        writeFileSync(
          settingsPath,
          `${JSON.stringify(base, null, 2)}\n`,
          'utf8',
        );
      }

      if (Object.keys(local).length === 0) {
        try {
          unlinkSync(lp);
        } catch {
          /* file may not exist */
        }
      } else {
        writeFileSync(lp, `${JSON.stringify(local, null, 2)}\n`, 'utf8');
      }

      const merged = readMergedSettings(settingsPath);
      res.json({
        worca: merged.worca || {},
        permissions: merged.permissions || {},
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: { code: 'write_error', message: err.message } });
    }
  });

  // GET /api/projects/:projectId/runs/:runId/status — run status
  router.get('/runs/:runId/status', requireWorcaDir, (req, res) => {
    const { runId } = req.params;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir, pm } = req.project;
    const statusPath = findRunStatusPath(worcaDir, runId);
    if (!statusPath) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }
    try {
      let status = JSON.parse(readFileSync(statusPath, 'utf8'));
      // Reconcile stale "running" status when no process is alive.
      // Pass runId so worktree-hosted pipelines (PID lives under
      // <worktree>/.worca/runs/<id>/pipeline.pid) are detected correctly.
      if (
        status.pipeline_status === 'running' &&
        pm &&
        !pm.getRunningPid(runId)
      ) {
        try {
          pm.reconcileStatus();
          status = JSON.parse(readFileSync(statusPath, 'utf8'));
        } catch {
          /* reconciliation is best-effort */
        }
      }
      const stage = status.stage ?? null;
      const iteration =
        stage != null ? (status.stages?.[stage]?.iteration ?? null) : null;
      res.json({
        ok: true,
        pipeline_status: status.pipeline_status ?? null,
        stage,
        iteration,
      });
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, error: `Failed to read status: ${err.message}` });
    }
  });

  // GET /api/projects/:projectId/runs/:runId/plan-iterations — list the
  // append-only numbered plan revisions (W-061). plan-001 is the original
  // input; each plan_review revision appends the next number. Returns
  // `{ ok, iterations: [{n, file}], latest }` (empty list for pre-W-061 runs).
  router.get('/runs/:runId/plan-iterations', requireWorcaDir, (req, res) => {
    const { runId } = req.params;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir } = req.project;
    const runDir = resolveRunDir(worcaDir, runId);
    const iterations = listPlanIterations(runDir);
    const latest = iterations.length
      ? iterations[iterations.length - 1].n
      : null;
    return res.json({
      ok: true,
      iterations: iterations.map((it) => ({ n: it.n, file: it.file })),
      latest,
    });
  });

  // GET /api/projects/:projectId/runs/:runId/plan — plan markdown.
  //
  // W-061: prefers the run dir's numbered plan iterations (plan-NNN.md) and
  // serves the latest by default, or a specific one via `?iteration=N`. Falls
  // back, for pre-W-061 runs, to:
  //   1. stages.plan.plan_file — set by workspace children that received a
  //      pre-built per-repo plan from the workspace planner.
  //   2. <worktree>/MASTER_PLAN.md — generated by a standalone pipeline's
  //      own PLAN stage.
  //
  // Returns 404 when nothing is readable. Replies in text/markdown so the
  // client just streams it into the dialog body.
  router.get('/runs/:runId/plan', requireWorcaDir, (req, res) => {
    const { runId } = req.params;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir } = req.project;

    // W-061: numbered plan iterations are the authoritative source.
    const runDir = resolveRunDir(worcaDir, runId);
    const iterations = listPlanIterations(runDir);
    if (iterations.length > 0) {
      let chosen;
      const wantRaw = req.query.iteration;
      if (wantRaw !== undefined) {
        const want = Number.parseInt(wantRaw, 10);
        chosen = iterations.find((it) => it.n === want);
        if (!chosen) {
          return res
            .status(404)
            .json({ ok: false, error: `Plan iteration ${wantRaw} not found` });
        }
      } else {
        chosen = iterations[iterations.length - 1]; // latest = current plan
      }
      try {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.send(readFileSync(chosen.path, 'utf8'));
        return;
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: `Failed to read plan file: ${err.message}`,
        });
      }
    }

    // Legacy fallback (pre-W-061 runs with no numbered plan files).
    const statusPath = findRunStatusPath(worcaDir, runId);
    if (!statusPath) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }
    let status;
    try {
      status = JSON.parse(readFileSync(statusPath, 'utf8'));
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: `Failed to read status: ${err.message}` });
    }
    const planFile = status?.stages?.plan?.plan_file ?? null;
    const overlay = readPipelineOverlay(worcaDir, runId);
    const worktreePath =
      typeof overlay?.worktree_path === 'string' ? overlay.worktree_path : null;
    const fallback = worktreePath ? join(worktreePath, 'MASTER_PLAN.md') : null;
    const candidates = [planFile, fallback].filter(
      (p) => typeof p === 'string' && p.length > 0,
    );
    for (const p of candidates) {
      if (existsSync(p)) {
        try {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.send(readFileSync(p, 'utf8'));
          return;
        } catch (err) {
          return res.status(500).json({
            ok: false,
            error: `Failed to read plan file: ${err.message}`,
          });
        }
      }
    }
    return res.status(404).json({
      ok: false,
      error: 'No plan file found for this run',
    });
  });

  // POST /api/projects/:projectId/runs — start a new pipeline
  router.post('/runs', requireWorcaDir, async (req, res) => {
    // Block parallel pipelines on the same project (GH #82)
    const running = req.project.pm.getRunningPid();
    if (running) {
      return res.status(409).json({
        ok: false,
        error:
          'A pipeline is already running on this project. Parallel pipelines on the same project are not yet supported.',
        code: 'already_running',
      });
    }

    const body = req.body || {};

    let {
      sourceType,
      sourceValue,
      prompt,
      planFile,
      msize,
      mloops,
      maxBeads,
      branch,
      template,
      claudeMdMode,
    } = body;
    if (body.inputType && sourceType === undefined) {
      if (body.inputType === 'prompt') {
        sourceType = 'none';
        prompt = body.inputValue;
      } else {
        sourceType = body.inputType;
        sourceValue = body.inputValue;
      }
    }

    sourceType = sourceType || 'none';

    if (!['none', 'source', 'spec'].includes(sourceType)) {
      return res.status(400).json({
        ok: false,
        error: 'sourceType must be "none", "source", or "spec"',
      });
    }

    if (sourceType !== 'none') {
      if (typeof sourceValue !== 'string' || sourceValue.trim().length === 0) {
        return res.status(400).json({
          ok: false,
          error:
            'sourceValue must be a non-empty string when sourceType is "source" or "spec"',
        });
      }
      if (sourceValue.length > 50000) {
        return res.status(400).json({
          ok: false,
          error: 'sourceValue must be 50,000 characters or less',
        });
      }
      sourceValue = sourceValue.trim();
    }

    if (prompt != null && typeof prompt === 'string' && prompt.length > 50000) {
      return res
        .status(400)
        .json({ ok: false, error: 'prompt must be 50,000 characters or less' });
    }
    if (typeof prompt === 'string') prompt = prompt.trim() || undefined;

    if (planFile !== undefined && planFile !== null) {
      if (!validatePlanFile(planFile)) {
        return res.status(400).json({
          ok: false,
          error: 'planFile must be a relative path with no ".." segments',
        });
      }
    }

    if (branch !== undefined && branch !== null) {
      if (!validateBranch(branch)) {
        return res
          .status(400)
          .json({ ok: false, error: 'Invalid branch value' });
      }
    }

    if (template !== undefined && template !== null) {
      if (typeof template !== 'string' || !TEMPLATE_RE.test(template)) {
        return res.status(400).json({
          ok: false,
          error: 'template must match ^[a-z0-9-]{1,64}$',
        });
      }
    }

    const CLAUDE_MD_MODES = new Set([
      'all',
      'project',
      'project+local',
      'none',
    ]);
    if (claudeMdMode !== undefined && claudeMdMode !== null) {
      if (
        typeof claudeMdMode !== 'string' ||
        !CLAUDE_MD_MODES.has(claudeMdMode)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'claudeMdMode must be one of: all, project, project+local, none',
        });
      }
    }

    const hasSource = sourceType !== 'none' && sourceValue;
    const hasPlan = typeof planFile === 'string' && planFile.trim().length > 0;
    const hasPrompt = typeof prompt === 'string' && prompt.length > 0;

    if (!hasSource && !hasPlan && !hasPrompt) {
      return res.status(400).json({
        ok: false,
        error: 'At least one of source, planFile, or prompt is required',
      });
    }

    const msizeVal =
      msize != null ? Math.max(1, Math.min(10, Math.round(Number(msize)))) : 1;
    const mloopsVal =
      mloops != null
        ? Math.max(1, Math.min(10, Math.round(Number(mloops))))
        : 1;
    const maxBeadsVal =
      maxBeads != null
        ? Math.max(0, Math.min(50, Math.round(Number(maxBeads))))
        : undefined;

    // Atomically check global cap and start pipeline under lock
    await launchLock.withLock(async () => {
      if (prefsDir) {
        const globalSettings = readGlobalSettings(
          join(prefsDir, 'settings.json'),
        );
        const cap =
          globalSettings.worca?.parallel?.max_concurrent_pipelines ?? 10;
        const totalRunning = countRunningPipelinesAcrossProjects(prefsDir);
        if (totalRunning >= cap) {
          res.status(409).json({
            ok: false,
            error: `Maximum concurrent pipelines reached (${cap}). Stop a running pipeline or increase the limit in global preferences.`,
            code: 'max_concurrent_exceeded',
          });
          return;
        }
      }

      try {
        const result = await req.project.pm.startPipeline({
          sourceType,
          sourceValue: hasSource ? sourceValue : undefined,
          prompt: hasPrompt ? prompt : undefined,
          msize: msizeVal,
          mloops: mloopsVal,
          maxBeads: maxBeadsVal,
          planFile: hasPlan ? planFile.trim() : undefined,
          branch: branch || undefined,
          template: template || undefined,
          claudeMdMode: claudeMdMode || undefined,
        });
        const { broadcast } = req.app.locals;
        if (broadcast) broadcast('run-started', { pid: result.pid });
        res.json({ ok: true, pid: result.pid, sourceType, prompt });
      } catch (err) {
        if (err.code === 'already_running') {
          res.status(409).json({ ok: false, error: err.message });
          return;
        }
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  });

  // POST /api/projects/:projectId/runs/:id/pause
  router.post('/runs/:id/pause', requireWorcaDir, (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    try {
      const result = req.project.pm.pausePipeline(runId);
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-paused', { runId });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/resume
  router.post('/runs/:id/resume', requireWorcaDir, async (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    try {
      // Clear archived flag so the resumed run appears on the main dashboard
      const { worcaDir } = req.project;
      const statusPath = findRunStatusPath(worcaDir, runId);
      if (statusPath) {
        const status = JSON.parse(readFileSync(statusPath, 'utf8'));
        if (status.archived) {
          delete status.archived;
          delete status.archived_at;
          writeFileSync(
            statusPath,
            `${JSON.stringify(status, null, 2)}\n`,
            'utf8',
          );
          const { broadcast } = req.app.locals;
          if (broadcast) broadcast('run-unarchived', { runId });
        }
      }
      const result = await req.project.pm.startPipeline({
        resume: true,
        runId,
      });
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-resumed', { runId, pid: result.pid });
      res.json({ ok: true, pid: result.pid, runId });
    } catch (err) {
      if (err.code === 'already_running') {
        return res.status(409).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/stop — control.json + SIGTERM + webhook
  router.post('/runs/:id/stop', requireWorcaDir, async (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir, settingsPath } = req.project;
    try {
      // Worktree runs read control.json from <worktree>/.worca/runs/<id>/.
      // Writing it to the parent project's worcaDir leaves the runner
      // unaware of the stop request — SIGTERM still works, but we lose
      // graceful-shutdown semantics.
      const overlay = readPipelineOverlay(worcaDir, runId);
      const controlDir = overlay?.worktree_path
        ? join(overlay.worktree_path, '.worca', 'runs', runId)
        : join(worcaDir, 'runs', runId);
      mkdirSync(controlDir, { recursive: true });
      writeFileSync(
        join(controlDir, 'control.json'),
        `${JSON.stringify(
          {
            action: 'stop',
            requested_at: new Date().toISOString(),
            source: 'ui',
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch {
      /* non-fatal — SIGTERM follows */
    }
    let forced = false;
    try {
      const result = await req.project.pm.stopPipelineSync(runId, {
        timeoutMs: 5000,
      });
      forced = !!result.forced;
    } catch (err) {
      if (err.code === 'not_running') {
        const statusPath = findRunStatusPath(worcaDir, runId);
        if (statusPath) {
          try {
            const st = JSON.parse(readFileSync(statusPath, 'utf8'));
            if (
              st.pipeline_status === 'paused' ||
              st.pipeline_status === 'running'
            ) {
              return res.status(409).json({
                ok: false,
                code: 'no_running_process',
                suggested_action: 'cancel',
              });
            }
          } catch {
            /* fall through to 404 */
          }
        }
        return res.status(404).json({ ok: false, error: err.message });
      }
      // For other errors, continue — process may have exited
    }

    const statusPath = findRunStatusPath(worcaDir, runId);
    const { broadcast, scheduleRefresh } = req.app.locals;
    if (broadcast) broadcast('run-stopped', { runId });
    if (scheduleRefresh) scheduleRefresh(req.project?.name);
    res.json({ ok: true, stopped: true, runId });

    // If Python exited cleanly (not forced), its finally/atexit already
    // dispatched the webhook. Only dispatch from Node when SIGKILL was needed.
    if (forced && statusPath) {
      let st;
      try {
        st = JSON.parse(readFileSync(statusPath, 'utf8'));
      } catch {
        return;
      }
      const terminalStatus = st.pipeline_status;
      if (terminalStatus === 'interrupted' || terminalStatus === 'failed') {
        const eventType =
          terminalStatus === 'interrupted'
            ? 'pipeline.run.interrupted'
            : 'pipeline.run.failed';
        const startedAt = st.started_at;
        const elapsedMs = startedAt
          ? Date.now() - new Date(startedAt).getTime()
          : 0;
        dispatchExternal({
          runDir: dirname(statusPath),
          settingsPath,
          eventType,
          payload: {
            interrupted_stage: st.stage || st.current_stage || 'unknown',
            elapsed_ms: elapsedMs,
            source: 'user_stop',
          },
        }).then((result) => {
          if (!result.ok) {
            console.error(
              `[stop] dispatchExternal failed for run ${runId}: ${result.reason}${result.stderr ? ` — ${result.stderr}` : ''}`,
            );
          }
        });
      }
    }
  });

  // POST /api/projects/:projectId/runs/:id/cancel — force-cancel a run
  router.post('/runs/:id/cancel', requireWorcaDir, async (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir, settingsPath } = req.project;
    const statusPath = findRunStatusPath(worcaDir, runId);
    if (!statusPath) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }
    try {
      let st = JSON.parse(readFileSync(statusPath, 'utf8'));
      if (
        st.pipeline_status === 'completed' ||
        st.pipeline_status === 'cancelled'
      ) {
        return res.json({ ok: true, already: st.pipeline_status });
      }
      if (!actionAllowed('cancel', st.pipeline_status)) {
        return res.status(409).json({ ok: false, code: 'action_not_allowed' });
      }

      const wasRunning = st.pipeline_status === 'running';
      if (wasRunning) {
        try {
          await req.project.pm.stopPipelineSync(runId, { timeoutMs: 5000 });
        } catch {
          // Expected: process may already be dead (not_running). Cancel proceeds to write cancelled status regardless.
        }
        // Re-read: Python's signal/atexit handler may have updated status.json
        try {
          st = JSON.parse(readFileSync(statusPath, 'utf8'));
        } catch {
          /* use pre-stop snapshot */
        }
      }

      // Python's SIGTERM handler may have already emitted pipeline.run.interrupted.
      // Only emit pipeline.run.cancelled if Python didn't already emit a terminal event.
      const pythonEmittedTerminal =
        wasRunning && st.pipeline_status === 'interrupted';

      st.pipeline_status = 'cancelled';
      st.stop_reason = 'force_cancelled';
      st.completed_at = new Date().toISOString();
      writeFileSync(statusPath, `${JSON.stringify(st, null, 2)}\n`, 'utf8');

      // Mirror into the multi-pipeline registry so global-mode views don't
      // keep reporting the run as "running". Best-effort — the registry entry
      // only exists for worktree runs.
      updatePipelineStatus(worcaDir, runId, 'cancelled');

      const { broadcast, scheduleRefresh } = req.app.locals;
      if (broadcast) broadcast('run-cancelled', { runId });
      if (scheduleRefresh) scheduleRefresh(req.project?.name);
      res.json({ ok: true, cancelled: true, runId });

      if (!pythonEmittedTerminal) {
        const startedAt = st.started_at;
        const elapsedMs = startedAt
          ? Date.now() - new Date(startedAt).getTime()
          : 0;
        dispatchExternal({
          runDir: dirname(statusPath),
          settingsPath,
          eventType: 'pipeline.run.cancelled',
          payload: {
            cancelled_stage: st.stage || st.current_stage || 'unknown',
            elapsed_ms: elapsedMs,
            source: 'user_cancel',
          },
        }).then((result) => {
          if (!result.ok) {
            console.error(
              `[cancel] dispatchExternal failed for run ${runId}: ${result.reason}${result.stderr ? ` — ${result.stderr}` : ''}`,
            );
          }
        });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/control — generic run control action
  const VALID_CONTROL_ACTIONS = new Set(['approve', 'reject']);
  router.post('/runs/:id/control', requireWorcaDir, (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { action, source } = req.body || {};
    if (!action || !VALID_CONTROL_ACTIONS.has(action)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid action. Must be one of: ${[...VALID_CONTROL_ACTIONS].join(', ')}`,
      });
    }
    const { worcaDir } = req.project;
    const statusPath = findRunStatusPath(worcaDir, runId);
    if (!statusPath) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }
    try {
      const st = JSON.parse(readFileSync(statusPath, 'utf8'));
      if (st.pipeline_status !== 'paused') {
        return res.status(409).json({
          ok: false,
          error: 'Run is not paused',
          pipeline_status: st.pipeline_status,
        });
      }
      // Worktree runs read control.json from <worktree>/.worca/runs/<id>/;
      // writing to the parent's worcaDir is invisible to the runner.
      const overlay = readPipelineOverlay(worcaDir, runId);
      const controlDir = overlay?.worktree_path
        ? join(overlay.worktree_path, '.worca', 'runs', runId)
        : join(worcaDir, 'runs', runId);
      mkdirSync(controlDir, { recursive: true });
      writeFileSync(
        join(controlDir, 'control.json'),
        `${JSON.stringify(
          {
            action,
            requested_at: new Date().toISOString(),
            source: source || 'ui',
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      res.json({ ok: true, action, runId });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/archive
  router.post('/runs/:id/archive', requireWorcaDir, (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir } = req.project;
    const statusPath = findRunStatusPath(worcaDir, runId);
    if (!statusPath) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }
    let tmpPath;
    try {
      const status = JSON.parse(readFileSync(statusPath, 'utf8'));
      if (status.pipeline_status === 'running') {
        return res
          .status(409)
          .json({ ok: false, error: 'Cannot archive a running pipeline' });
      }
      if (status.archived === true) {
        return res.json({ ok: true });
      }
      status.archived = true;
      status.archived_at = new Date().toISOString();
      tmpPath = join(
        dirname(statusPath),
        `.status.json.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
      );
      writeFileSync(
        tmpPath,
        `${JSON.stringify(status, null, 2)}
`,
        'utf8',
      );
      renameSync(tmpPath, statusPath);
      const { broadcast } = req.app.locals;
      if (broadcast)
        broadcast('run-archived', { runId, archived_at: status.archived_at });
      res.json({ ok: true });
    } catch (err) {
      if (tmpPath) {
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore cleanup failure */
        }
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/unarchive
  router.post('/runs/:id/unarchive', requireWorcaDir, (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir } = req.project;
    const statusPath = findRunStatusPath(worcaDir, runId);
    if (!statusPath) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }
    let tmpPath;
    try {
      const status = JSON.parse(readFileSync(statusPath, 'utf8'));
      if (status.archived !== true) {
        return res.json({ ok: true });
      }
      delete status.archived;
      delete status.archived_at;
      tmpPath = join(
        dirname(statusPath),
        `.status.json.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
      );
      writeFileSync(
        tmpPath,
        `${JSON.stringify(status, null, 2)}
`,
        'utf8',
      );
      renameSync(tmpPath, statusPath);
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-unarchived', { runId });
      res.json({ ok: true });
    } catch (err) {
      if (tmpPath) {
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore cleanup failure */
        }
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/delete — permanently remove a run
  router.post('/runs/:id/delete', requireWorcaDir, (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir } = req.project;
    const statusPath = findRunStatusPath(worcaDir, runId);
    if (!statusPath) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }
    try {
      const st = JSON.parse(readFileSync(statusPath, 'utf8'));
      if (!actionAllowed('delete', st.pipeline_status)) {
        return res.status(409).json({
          ok: false,
          code: 'action_not_allowed',
          error: `Cannot delete a run with status "${st.pipeline_status}" — stop or cancel it first`,
        });
      }
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: `Failed to read status: ${err.message}` });
    }
    try {
      req.project.pm.deleteRun(runId);
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-deleted', { runId });
      res.json({ ok: true, deleted: true, runId });
    } catch (err) {
      if (err.code === 'still_running') {
        return res.status(409).json({ ok: false, error: err.message });
      }
      if (err.code === 'not_found') {
        return res.status(404).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/stages/:stage/restart
  router.post(
    '/runs/:id/stages/:stage/restart',
    requireWorcaDir,
    async (req, res) => {
      const { stage } = req.params;
      try {
        const result = await req.project.pm.restartStage(req.params.id, stage);
        const { broadcast } = req.app.locals;
        if (broadcast) broadcast('stage-restarted', { stage, pid: result.pid });
        res.json({ ok: true, restarted: true, stage, pid: result.pid });
      } catch (err) {
        if (err.code === 'already_running') {
          return res.status(409).json({ ok: false, error: err.message });
        }
        if (err.code === 'stage_not_found' || err.code === 'stage_not_error') {
          return res.status(400).json({ ok: false, error: err.message });
        }
        res.status(500).json({ ok: false, error: err.message });
      }
    },
  );

  // POST /api/projects/:projectId/runs/:id/learn
  router.post('/runs/:id/learn', requireWorcaDir, (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir, projectRoot } = req.project;

    const statusPath = findRunStatusPath(worcaDir, runId);
    if (!statusPath) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }

    const running = req.project.pm.getRunningPid(runId);
    if (running) {
      return res.status(409).json({
        ok: false,
        error: `Pipeline is currently running (PID ${running.pid})`,
      });
    }

    let status;
    try {
      status = JSON.parse(readFileSync(statusPath, 'utf8'));
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: `Failed to read status: ${err.message}` });
    }

    const learnStage = status.stages?.learn;
    if (learnStage?.status === 'in_progress' && learnStage.pid) {
      try {
        process.kill(learnStage.pid, 0);
        return res
          .status(409)
          .json({ ok: false, error: 'Learning analysis is already running' });
      } catch {
        /* stale PID — allow re-run */
      }
    }

    // Worktree-hosted runs live outside the parent project. Spawn the learner
    // inside the worktree so its default --status-dir=.worca and any git
    // operations land on the right tree, mirroring run_pipeline.py resume.
    const overlay = readPipelineOverlay(worcaDir, runId);
    const cwd = overlay?.worktree_path || projectRoot || process.cwd();
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn(
      'python3',
      ['.claude/worca/scripts/run_learn.py', '--run-id', runId],
      { detached: true, stdio: 'ignore', cwd, env },
    );
    child.unref();

    const now = new Date().toISOString();
    if (!status.stages) status.stages = {};
    status.stages.learn = {
      status: 'in_progress',
      pid: child.pid,
      started_at: now,
      iterations: [
        {
          number: 1,
          status: 'in_progress',
          started_at: now,
          agent: 'learner',
          model: 'sonnet',
          trigger: 'manual',
        },
      ],
    };
    try {
      writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    } catch {
      /* non-fatal */
    }

    const { broadcast, scheduleRefresh } = req.app.locals;
    if (broadcast) broadcast('learn-started', { runId });

    const pollInterval = setInterval(() => {
      try {
        const fresh = JSON.parse(readFileSync(statusPath, 'utf8'));
        if (scheduleRefresh) scheduleRefresh();
        const ls = fresh.stages?.learn?.status;
        if (ls !== 'in_progress' && ls !== 'pending')
          clearInterval(pollInterval);
      } catch {
        clearInterval(pollInterval);
      }
    }, 3000);
    setTimeout(() => clearInterval(pollInterval), 15 * 60 * 1000);
    if (pollInterval.unref) pollInterval.unref();

    res.json({ ok: true, runId, pid: child.pid });
  });

  // NOTE: The /pipelines/:runId/{stop,pause} routes were removed in favor of
  // unifying on /runs/:id/{stop,pause,cancel,resume}. The ProcessManager now
  // overlays worktree pipelines via pipelines.d/, so the same /runs/:id/*
  // family handles both local and worktree-hosted runs.

  // NOTE: GET /templates and all template CRUD routes moved to
  // templates-routes.js (now mounted at /).

  // GET /api/projects/:projectId/worca-status — check worca installation state.
  // `outdated` is true when the project's installed worca-cc version is
  // strictly behind the active (dev-path or globally-installed) worca-cc.
  router.get('/worca-status', async (req, res) => {
    const { projectRoot } = req.project;
    const installed = checkWorcaInstalled(projectRoot);
    if (!installed) {
      return res.json({
        ok: true,
        installed: false,
        version: null,
        outdated: false,
      });
    }
    const version = readProjectWorcaVersion(projectRoot);
    let outdated = false;
    if (version != null) {
      try {
        const versionInfo = await getVersionInfo({
          prefsPath,
          worcaVersion: req.app.locals.worcaVersion || null,
        });
        outdated = isVersionBehind(version, versionInfo.activeWorcaCc);
      } catch {
        // Best-effort — if version lookup fails, treat as not outdated
        outdated = false;
      }
    }
    res.json({ ok: true, installed: true, version, outdated });
  });

  // POST /api/projects/:projectId/worca-setup — install or update worca
  router.post('/worca-setup', (req, res) => {
    const { projectRoot } = req.project;
    let source = req.body?.source;

    // Fall back to source_repo from global preferences
    if (!source) {
      try {
        const prefs = readPreferences(preferencesPath());
        source = prefs.source_repo || undefined;
      } catch {
        /* ignore — worca init will use its own resolution chain */
      }
    }

    try {
      const { pid } = runWorcaSetup(projectRoot, { source });
      // Auto-configure webhook so pipeline events reach this UI server
      if (serverHost && serverPort) {
        try {
          ensureWebhookForUi(projectRoot, {
            host: serverHost,
            port: serverPort,
          });
        } catch {
          /* best-effort */
        }
      }
      res.json({ ok: true, pid });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/projects/:projectId/costs — token & cost data
  // Reads per-iteration token_usage from each run's status.json.
  router.get('/costs', requireWorcaDir, (req, res) => {
    const { worcaDir } = req.project;
    // Costs read only per-iteration token_usage from status.json — no
    // events.jsonl enrichment needed (issue #296).
    const runs = discoverRuns(worcaDir, { enrich: false });
    const tokenData = {};

    for (const run of runs) {
      const stages = run.stages || {};
      const runEntry = {};

      for (const [stageName, stage] of Object.entries(stages)) {
        const iterations = stage.iterations || [];
        const iters = [];
        for (const iter of iterations) {
          const tu = iter.token_usage || {};
          iters.push({
            inputTokens: tu.input_tokens || 0,
            outputTokens: tu.output_tokens || 0,
            cacheReadInputTokens: tu.cache_read_input_tokens || 0,
            cacheCreationInputTokens: tu.cache_creation_input_tokens || 0,
            webSearchRequests: tu.web_search_requests || 0,
            cacheEphemeral1hTokens: tu.cache_ephemeral_1h_tokens || 0,
            cacheEphemeral5mTokens: tu.cache_ephemeral_5m_tokens || 0,
            models: tu.model ? [tu.model] : [],
          });
        }
        if (iters.length > 0) runEntry[stageName] = iters;
      }

      if (Object.keys(runEntry).length > 0) tokenData[run.id] = runEntry;
    }

    res.json({ ok: true, tokenData });
  });

  // ─── Beads (project-scoped) ─────────────────────────────────────────
  router.get('/beads/issues', requireWorcaDir, async (req, res) => {
    const beadsDbPath = join(req.project.worcaDir, '..', '.beads', 'beads.db');
    if (!dbExists(beadsDbPath)) {
      return res.json({
        ok: true,
        issues: [],
        dbExists: false,
        dbPath: beadsDbPath,
      });
    }
    try {
      const issues = await listIssues(beadsDbPath);
      res.json({ ok: true, issues, dbExists: true, dbPath: beadsDbPath });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/beads/issues/:id/start', requireWorcaDir, async (req, res) => {
    const issueId = parseInt(req.params.id, 10);
    if (!Number.isInteger(issueId) || issueId <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'Issue ID must be a positive integer' });
    }
    const beadsDbPath = join(req.project.worcaDir, '..', '.beads', 'beads.db');
    const issue = await getIssue(beadsDbPath, issueId);
    if (!issue) {
      return res
        .status(404)
        .json({ ok: false, error: `Issue ${issueId} not found` });
    }
    if (issue.status !== 'ready') {
      return res.status(409).json({
        ok: false,
        error: `Issue ${issueId} is not in 'ready' state (current: ${issue.status})`,
      });
    }
    if (issue.blocked_by.length > 0) {
      return res.status(409).json({
        ok: false,
        error: `Issue ${issueId} is blocked by issues: ${issue.blocked_by.join(', ')}`,
      });
    }
    try {
      const pm =
        req.project.pm ||
        new ProcessManager({
          worcaDir: req.project.worcaDir,
          projectRoot: req.project.projectRoot,
        });
      const prompt =
        `[Beads #${issue.id}] ${issue.title}\n\n${(issue.body || '').trim()}`.trim();
      const result = await pm.startPipeline({
        inputType: 'prompt',
        inputValue: prompt,
        msize: 1,
        mloops: 1,
      });
      res.json({ ok: true, pid: result.pid, issueId, prompt });
    } catch (err) {
      const status = (err.message || '').includes('already running')
        ? 409
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.use('/worktrees', requireWorcaDir, createWorktreesRouter());

  return router;
}
