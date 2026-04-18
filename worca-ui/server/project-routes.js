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
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import { dbExists, getIssue, listIssues } from './beads-reader.js';
import { ensureWebhookForUi } from './ensure-webhook.js';
import { readPreferences } from './preferences.js';
import { ProcessManager } from './process-manager.js';
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
  localPathFor,
  readLocalSettings,
  readMergedSettings,
} from './settings-merge.js';
import { validateSettingsPayload } from './settings-validator.js';
import { isVersionBehind } from './version-check.js';
import { getVersionInfo } from './versions.js';
import { discoverRuns } from './watcher.js';
import {
  checkWorcaInstalled,
  readProjectWorcaVersion,
  runWorcaSetup,
} from './worca-setup.js';

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

/**
 * Find the status.json path for a given run ID.
 * Searches: runs/{id}/status.json → results/{id}/status.json → results/{id}.json
 * Returns the first existing path, or null if none found.
 */
export function findRunStatusPath(worcaDir, runId) {
  const candidates = [
    join(worcaDir, 'runs', runId, 'status.json'),
    join(worcaDir, 'results', runId, 'status.json'),
    join(worcaDir, 'results', `${runId}.json`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

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
      pm: new ProcessManager({ worcaDir, projectRoot: projRoot }),
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
 * @param {{ prefsDir?: string|null }} [options] — prefsDir enables active
 *   worca-cc version lookup for /worca-status' `outdated` flag.
 */
export function createProjectScopedRoutes({
  prefsDir = null,
  serverHost,
  serverPort,
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
  router.get('/runs', requireWorcaDir, (req, res) => {
    try {
      const runs = discoverRuns(req.project.worcaDir);
      const response = { ok: true, runs };
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

  // POST /api/projects/:projectId/settings
  router.post('/settings', (req, res) => {
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

    const validation = validateSettingsPayload(body);
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
      const lp = localPathFor(settingsPath);
      const local = readLocalSettings(settingsPath);

      if (body.worca && typeof body.worca === 'object') {
        if (!local.worca) local.worca = {};
        for (const key of Object.keys(body.worca)) {
          local.worca[key] = body.worca[key];
        }
      }
      if (body.permissions !== undefined) {
        local.permissions = body.permissions;
      }

      writeFileSync(lp, `${JSON.stringify(local, null, 2)}\n`, 'utf8');

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

  // DELETE /api/projects/:projectId/settings/:section
  const SECTION_KEYS = {
    agents: { worca: ['agents'] },
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
      const lp = localPathFor(settingsPath);
      const local = readLocalSettings(settingsPath);

      if (mapping.worca && local.worca) {
        for (const key of mapping.worca) delete local.worca[key];
        if (Object.keys(local.worca).length === 0) delete local.worca;
      }
      if (mapping.top) {
        for (const key of mapping.top) delete local[key];
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
      // Reconcile stale "running" status when no process is alive
      if (status.pipeline_status === 'running' && pm && !pm.getRunningPid()) {
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
      branch,
      template,
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

    try {
      const result = await req.project.pm.startPipeline({
        sourceType,
        sourceValue: hasSource ? sourceValue : undefined,
        prompt: hasPrompt ? prompt : undefined,
        msize: msizeVal,
        mloops: mloopsVal,
        planFile: hasPlan ? planFile.trim() : undefined,
        branch: branch || undefined,
        template: template || undefined,
      });
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-started', { pid: result.pid });
      res.json({ ok: true, pid: result.pid, sourceType, prompt });
    } catch (err) {
      if (err.code === 'already_running') {
        return res.status(409).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/projects/:projectId/runs/:id — stop a running pipeline
  router.delete('/runs/:id', requireWorcaDir, (req, res) => {
    try {
      const result = req.project.pm.stopPipeline(req.params.id);
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-stopped', { pid: result.pid });
      res.json({ ok: true, stopped: true, pid: result.pid });
    } catch (err) {
      if (err.code === 'not_running') {
        return res.status(404).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
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

  // POST /api/projects/:projectId/runs/:id/stop — control.json + SIGTERM
  router.post('/runs/:id/stop', requireWorcaDir, (req, res) => {
    const runId = req.params.id;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir } = req.project;
    try {
      const controlDir = join(worcaDir, 'runs', runId);
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
    try {
      const result = req.project.pm.stopPipeline(runId);
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-stopped', { runId, pid: result.pid });
      res.json({ ok: true, stopped: true, runId, pid: result.pid });
    } catch (err) {
      if (err.code === 'not_running') {
        const statusPath = findRunStatusPath(req.project.worcaDir, runId);
        if (statusPath) {
          try {
            const st = JSON.parse(readFileSync(statusPath, 'utf8'));
            if (
              st.pipeline_status === 'paused' ||
              st.pipeline_status === 'running'
            ) {
              st.pipeline_status = 'cancelled';
              st.stop_reason = 'force_cancelled';
              st.completed_at = new Date().toISOString();
              writeFileSync(
                statusPath,
                `${JSON.stringify(st, null, 2)}\n`,
                'utf8',
              );
              const { broadcast } = req.app.locals;
              if (broadcast) broadcast('run-stopped', { runId, pid: null });
              return res.json({ ok: true, stopped: true, runId, pid: null });
            }
          } catch {
            /* fall through to 404 */
          }
        }
        return res.status(404).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/cancel — force-cancel a stale run
  router.post('/runs/:id/cancel', requireWorcaDir, (req, res) => {
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
      if (
        st.pipeline_status === 'completed' ||
        st.pipeline_status === 'cancelled'
      ) {
        return res.json({ ok: true, already: st.pipeline_status });
      }
      st.pipeline_status = 'cancelled';
      st.stop_reason = 'force_cancelled';
      st.completed_at = new Date().toISOString();
      writeFileSync(statusPath, `${JSON.stringify(st, null, 2)}\n`, 'utf8');
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-stopped', { runId, pid: null });
      res.json({ ok: true, cancelled: true, runId });
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

  // POST /api/projects/:projectId/runs/:id/stages/:stage/restart
  router.post(
    '/runs/:id/stages/:stage/restart',
    requireWorcaDir,
    async (req, res) => {
      const { stage } = req.params;
      try {
        const result = await req.project.pm.restartStage(stage);
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

    const running = req.project.pm.getRunningPid();
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

    const cwd = projectRoot || process.cwd();
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

  // POST /api/projects/:projectId/multi-pipeline — launch parallel pipelines
  router.post('/multi-pipeline', requireWorcaDir, (req, res) => {
    const { projectRoot } = req.project;
    const body = req.body || {};
    const { requests, baseBranch, maxParallel, cleanupPolicy, msize, mloops } =
      body;

    if (!Array.isArray(requests) || requests.length < 1) {
      return res.status(400).json({
        ok: false,
        error: 'requests array required (at least 1 item)',
      });
    }
    if (requests.length > 20) {
      return res
        .status(400)
        .json({ ok: false, error: 'Too many requests (max 20)' });
    }
    for (const r of requests) {
      if (typeof r !== 'string' || r.trim().length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Each request must be a non-empty string',
        });
      }
      if (r.length > 50000) {
        return res.status(400).json({
          ok: false,
          error: 'Each request must be 50,000 characters or less',
        });
      }
    }
    if (baseBranch !== undefined) {
      if (
        typeof baseBranch !== 'string' ||
        baseBranch.length > 200 ||
        !/^[\w.\-/]+$/.test(baseBranch)
      ) {
        return res
          .status(400)
          .json({ ok: false, error: 'Invalid baseBranch value' });
      }
    }

    const maxP = Math.max(1, Math.min(5, Math.round(Number(maxParallel) || 3)));
    const msizeVal = Math.max(1, Math.min(10, Math.round(Number(msize) || 1)));
    const mloopsVal = Math.max(
      1,
      Math.min(10, Math.round(Number(mloops) || 1)),
    );
    const cleanup = ['on-success', 'always', 'never'].includes(cleanupPolicy)
      ? cleanupPolicy
      : 'on-success';

    const args = ['.claude/worca/scripts/run_multi.py'];
    args.push('--max-parallel', String(maxP));
    args.push('--cleanup', cleanup);
    args.push('--msize', String(msizeVal));
    args.push('--mloops', String(mloopsVal));
    if (baseBranch) args.push('--base-branch', baseBranch);
    args.push('--requests', ...requests.map((r) => r.trim()));

    const env = { ...process.env };
    delete env.CLAUDECODE;

    try {
      const child = spawn('python3', args, {
        detached: true,
        stdio: 'ignore',
        cwd: projectRoot,
        env,
      });
      child.unref();

      const { broadcast } = req.app.locals;
      if (broadcast)
        broadcast('multi-pipeline-started', {
          pid: child.pid,
          count: requests.length,
        });

      res.json({ ok: true, pid: child.pid, count: requests.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/pipelines/:runId/stop — stop a parallel pipeline
  router.post('/pipelines/:runId/stop', requireWorcaDir, (req, res) => {
    const runId = req.params.runId;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir } = req.project;

    const pipelineFile = join(
      worcaDir,
      'multi',
      'pipelines.d',
      `${runId}.json`,
    );
    if (!existsSync(pipelineFile)) {
      return res
        .status(404)
        .json({ ok: false, error: `Pipeline ${runId} not found` });
    }

    let pipeline;
    try {
      pipeline = JSON.parse(readFileSync(pipelineFile, 'utf8'));
    } catch {
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to read pipeline registry' });
    }

    if (!pipeline.worktree_path) {
      return res
        .status(400)
        .json({ ok: false, error: 'Pipeline has no worktree path' });
    }

    const worktreePm = new ProcessManager({
      worcaDir: join(pipeline.worktree_path, '.worca'),
    });
    try {
      const result = worktreePm.stopPipeline(runId);
      res.json({ ok: true, stopped: true, runId, pid: result.pid });
    } catch (err) {
      if (err.code === 'not_running') {
        return res.status(404).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/pipelines/:runId/pause — pause a parallel pipeline
  router.post('/pipelines/:runId/pause', requireWorcaDir, (req, res) => {
    const runId = req.params.runId;
    if (!validateRunId(runId)) {
      return res.status(400).json({ ok: false, error: 'Invalid runId' });
    }
    const { worcaDir } = req.project;

    const pipelineFile = join(
      worcaDir,
      'multi',
      'pipelines.d',
      `${runId}.json`,
    );
    if (!existsSync(pipelineFile)) {
      return res
        .status(404)
        .json({ ok: false, error: `Pipeline ${runId} not found` });
    }

    let pipeline;
    try {
      pipeline = JSON.parse(readFileSync(pipelineFile, 'utf8'));
    } catch {
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to read pipeline registry' });
    }

    if (!pipeline.worktree_path) {
      return res
        .status(400)
        .json({ ok: false, error: 'Pipeline has no worktree path' });
    }

    const worktreePm = new ProcessManager({
      worcaDir: join(pipeline.worktree_path, '.worca'),
    });
    try {
      const result = worktreePm.pausePipeline(runId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/projects/:projectId/templates — list available pipeline templates
  router.get('/templates', (req, res) => {
    const root = req.project.projectRoot;
    const tiers = [
      { tier: 'worca', dir: join(root, '.claude', 'worca', 'templates') },
      { tier: 'project', dir: join(root, '.claude', 'templates') },
      { tier: 'user', dir: join(homedir(), '.worca', 'templates') },
    ];

    const templates = [];
    for (const { tier, dir } of tiers) {
      if (!existsSync(dir)) continue;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(dir, entry.name, 'template.json');
        if (!existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          templates.push({
            id: manifest.id || entry.name,
            name: manifest.name || entry.name,
            description: manifest.description || '',
            tier,
          });
        } catch {
          /* skip malformed manifests */
        }
      }
    }

    res.json({ ok: true, templates });
  });

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
        const prefs = readPreferences(
          join(homedir(), '.worca', 'preferences.json'),
        );
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
    const runs = discoverRuns(worcaDir);
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

  return router;
}
