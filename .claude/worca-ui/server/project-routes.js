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
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import {
  getRunningPid,
  pausePipeline,
  restartStage,
  startPipeline,
  stopPipeline,
} from './process-manager.js';
import {
  readProjects,
  removeProject,
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
import { discoverRuns } from './watcher.js';

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

    req.project = {
      name: project.name,
      path: project.path,
      worcaDir: project.worcaDir || join(project.path, '.worca'),
      settingsPath:
        project.settingsPath || join(project.path, '.claude', 'settings.json'),
      projectRoot: project.path,
    };
    next();
  };
}

/**
 * Router for project CRUD: GET/POST/DELETE /api/projects[/:id]
 */
export function createProjectRoutes({ prefsDir, projectRoot }) {
  const router = Router();

  // GET /api/projects — list all projects (or synthesized default)
  router.get('/', (_req, res) => {
    const projects = readProjects(prefsDir);
    if (projects.length > 0) {
      return res.json({ ok: true, projects });
    }
    // No registered projects — synthesize from cwd
    const synth = synthesizeDefaultProject(projectRoot);
    res.json({ ok: true, projects: [synth] });
  });

  // POST /api/projects — create a new project
  router.post('/', (req, res) => {
    const entry = req.body;
    const validation = validateProjectEntry(entry);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, error: validation.error });
    }
    try {
      writeProject(prefsDir, entry);
      res.status(201).json({ ok: true, project: entry });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/projects/:id — remove a project
  router.delete('/:id', (req, res) => {
    removeProject(prefsDir, req.params.id);
    res.json({ ok: true, removed: req.params.id });
  });

  return router;
}

/**
 * Router for project-scoped sub-routes.
 * The projectResolver middleware must run before this to set req.project.
 */
export function createProjectScopedRoutes() {
  const router = Router({ mergeParams: true });

  // GET /api/projects/:projectId/info — project metadata
  router.get('/info', (req, res) => {
    res.json({ ok: true, project: req.project });
  });

  // GET /api/projects/:projectId/runs — list runs for this project
  router.get('/runs', (req, res) => {
    try {
      const runs = discoverRuns(req.project.worcaDir);
      res.json({ ok: true, runs });
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
  router.get('/runs/:runId/status', (req, res) => {
    const { runId } = req.params;
    const { worcaDir } = req.project;
    let statusPath = join(worcaDir, 'runs', runId, 'status.json');
    if (!existsSync(statusPath)) {
      statusPath = join(worcaDir, 'results', runId, 'status.json');
    }
    if (!existsSync(statusPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }
    try {
      const status = JSON.parse(readFileSync(statusPath, 'utf8'));
      res.json({ ok: true, ...status });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs — start a new pipeline
  router.post('/runs', async (req, res) => {
    const { worcaDir, projectRoot } = req.project;
    const body = req.body || {};

    let { sourceType, sourceValue, prompt, planFile, msize, mloops, branch } =
      body;
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
      if (typeof planFile !== 'string' || planFile.trim().length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'planFile must be a non-empty string if provided',
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
      const result = await startPipeline(worcaDir, {
        sourceType,
        sourceValue: hasSource ? sourceValue : undefined,
        prompt: hasPrompt ? prompt : undefined,
        msize: msizeVal,
        mloops: mloopsVal,
        planFile: hasPlan ? planFile.trim() : undefined,
        branch: branch || undefined,
        projectRoot,
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
  router.delete('/runs/:id', (req, res) => {
    const { worcaDir } = req.project;
    try {
      const result = stopPipeline(worcaDir);
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
  router.post('/runs/:id/pause', (req, res) => {
    const { worcaDir } = req.project;
    const runId = req.params.id;
    try {
      const result = pausePipeline(worcaDir, runId);
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-paused', { runId });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/projects/:projectId/runs/:id/resume
  router.post('/runs/:id/resume', async (req, res) => {
    const { worcaDir, projectRoot } = req.project;
    const runId = req.params.id;
    try {
      const result = await startPipeline(worcaDir, {
        resume: true,
        runId,
        projectRoot,
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
  router.post('/runs/:id/stop', (req, res) => {
    const { worcaDir } = req.project;
    const runId = req.params.id;
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
      const result = stopPipeline(worcaDir);
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast('run-stopped', { runId, pid: result.pid });
      res.json({ ok: true, stopped: true, runId, pid: result.pid });
    } catch (err) {
      if (err.code === 'not_running') {
        const statusPath = join(worcaDir, 'runs', runId, 'status.json');
        if (existsSync(statusPath)) {
          try {
            const st = JSON.parse(readFileSync(statusPath, 'utf8'));
            if (
              st.pipeline_status === 'paused' ||
              st.pipeline_status === 'running'
            ) {
              st.pipeline_status = 'failed';
              st.stop_reason = 'stopped';
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

  // POST /api/projects/:projectId/runs/:id/stages/:stage/restart
  router.post('/runs/:id/stages/:stage/restart', async (req, res) => {
    const { worcaDir, projectRoot } = req.project;
    const { stage } = req.params;
    try {
      const result = await restartStage(worcaDir, stage, { projectRoot });
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
  });

  // POST /api/projects/:projectId/runs/:id/learn
  router.post('/runs/:id/learn', (req, res) => {
    const { worcaDir, projectRoot } = req.project;
    const runId = req.params.id;

    let statusPath = join(worcaDir, 'runs', runId, 'status.json');
    if (!existsSync(statusPath)) {
      statusPath = join(worcaDir, 'results', runId, 'status.json');
    }
    if (!existsSync(statusPath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Run "${runId}" not found` });
    }

    const running = getRunningPid(worcaDir);
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
      ['.claude/scripts/run_learn.py', '--run-id', runId],
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

  // GET /api/projects/:projectId/costs — token & cost data
  router.get('/costs', (req, res) => {
    const { worcaDir } = req.project;
    const resultsDir = join(worcaDir, 'results');
    if (!existsSync(resultsDir)) return res.json({ ok: true, tokenData: {} });

    const tokenData = {};

    for (const entry of readdirSync(resultsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const runDir = join(resultsDir, entry.name);
      const stageNames = [];
      try {
        for (const sub of readdirSync(runDir, { withFileTypes: true })) {
          if (sub.isDirectory()) stageNames.push(sub.name);
        }
      } catch {
        continue;
      }

      if (stageNames.length === 0) continue;
      tokenData[entry.name] = {};

      for (const stage of stageNames) {
        const stageDir = join(runDir, stage);
        const iters = [];
        try {
          const files = readdirSync(stageDir)
            .filter((f) => f.startsWith('iter-') && f.endsWith('.json'))
            .sort();
          for (const file of files) {
            try {
              const data = JSON.parse(
                readFileSync(join(stageDir, file), 'utf8'),
              );
              const mu = data.modelUsage || {};
              let inputTokens = 0,
                outputTokens = 0,
                cacheReadInputTokens = 0,
                cacheCreationInputTokens = 0;
              const models = [];
              for (const [model, usage] of Object.entries(mu)) {
                inputTokens += usage.inputTokens || 0;
                outputTokens += usage.outputTokens || 0;
                cacheReadInputTokens += usage.cacheReadInputTokens || 0;
                cacheCreationInputTokens += usage.cacheCreationInputTokens || 0;
                models.push(model);
              }
              iters.push({
                inputTokens,
                outputTokens,
                cacheReadInputTokens,
                cacheCreationInputTokens,
                models,
              });
            } catch {
              /* skip bad files */
            }
          }
        } catch {
          /* skip */
        }
        if (iters.length > 0) tokenData[entry.name][stage] = iters;
      }
    }

    res.json({ ok: true, tokenData });
  });

  return router;
}
