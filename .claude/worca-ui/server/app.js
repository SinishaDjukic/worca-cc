// server/app.js
import express from 'express';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { validateSettingsPayload } from './settings-validator.js';
import { readMergedSettings, readLocalSettings, localPathFor, deepMerge } from './settings-merge.js';
import { startPipeline, stopPipeline, pausePipeline, restartStage, getRunningPid, reconcileStatus } from './process-manager.js';
import { discoverRuns } from './watcher.js';
import { listIssues, getIssue, dbExists } from './beads-reader.js';
import { createInbox } from './webhook-inbox.js';

function readFullSettings(settingsPath) {
  return readMergedSettings(settingsPath);
}

export function createApp(options = {}) {
  const app = express();
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
  const { settingsPath, worcaDir, projectRoot } = options;

  app.use(express.json());

  // Webhook inbox — shared in-memory store (also exposed for WS server)
  const webhookInbox = options.webhookInbox || createInbox();
  app.locals.webhookInbox = webhookInbox;

  // GET /api/settings — returns merged base + local config
  app.get('/api/settings', (_req, res) => {
    if (!settingsPath) return res.status(501).json({ error: { code: 'not_configured', message: 'settingsPath not configured' } });
    try {
      const merged = readMergedSettings(settingsPath);
      res.json({ worca: merged.worca || {}, permissions: merged.permissions || {} });
    } catch (err) {
      res.status(500).json({ error: { code: 'read_error', message: err.message } });
    }
  });

  // POST /api/settings — writes to settings.local.json (never modifies base)
  app.post('/api/settings', (req, res) => {
    if (!settingsPath) return res.status(501).json({ error: { code: 'not_configured', message: 'settingsPath not configured' } });

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'Request body must be a JSON object', details: [] } });
    }

    const validation = validateSettingsPayload(body);
    if (!validation.valid) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'Invalid settings payload', details: validation.details } });
    }

    try {
      const localPath = localPathFor(settingsPath);
      const local = readLocalSettings(settingsPath);

      // Merge worca sub-keys into local (replace each top-level sub-key wholesale)
      if (body.worca && typeof body.worca === 'object') {
        if (!local.worca) local.worca = {};
        for (const key of Object.keys(body.worca)) {
          local.worca[key] = body.worca[key];
        }
      }

      // Replace permissions wholesale in local
      if (body.permissions !== undefined) {
        local.permissions = body.permissions;
      }

      writeFileSync(localPath, JSON.stringify(local, null, 2) + '\n', 'utf8');

      // Return merged view so UI shows effective config
      const merged = readMergedSettings(settingsPath);
      res.json({ worca: merged.worca || {}, permissions: merged.permissions || {} });
    } catch (err) {
      res.status(500).json({ error: { code: 'write_error', message: err.message } });
    }
  });

  // DELETE /api/settings/:section — reset a section to base defaults
  const SECTION_KEYS = {
    agents: { worca: ['agents'] },
    pipeline: { worca: ['stages', 'loops', 'plan_path_template', 'defaults'] },
    governance: { worca: ['governance'], top: ['permissions'] },
    pricing: { worca: ['pricing'] },
    webhooks: { worca: ['events', 'budget', 'webhooks'] },
  };

  app.delete('/api/settings/:section', (req, res) => {
    if (!settingsPath) return res.status(501).json({ error: { code: 'not_configured', message: 'settingsPath not configured' } });

    const section = req.params.section;
    const mapping = SECTION_KEYS[section];
    if (!mapping) {
      return res.status(400).json({ error: { code: 'invalid_section', message: `Unknown section: ${section}. Valid: ${Object.keys(SECTION_KEYS).join(', ')}` } });
    }

    try {
      const localPath = localPathFor(settingsPath);
      const local = readLocalSettings(settingsPath);

      // Remove worca sub-keys for this section
      if (mapping.worca && local.worca) {
        for (const key of mapping.worca) {
          delete local.worca[key];
        }
        // Clean up empty worca object
        if (Object.keys(local.worca).length === 0) delete local.worca;
      }

      // Remove top-level keys for this section
      if (mapping.top) {
        for (const key of mapping.top) {
          delete local[key];
        }
      }

      // If local is now empty, delete the file
      if (Object.keys(local).length === 0) {
        try { unlinkSync(localPath); } catch { /* file may not exist */ }
      } else {
        writeFileSync(localPath, JSON.stringify(local, null, 2) + '\n', 'utf8');
      }

      // Return merged view (now base-only for this section)
      const merged = readMergedSettings(settingsPath);
      res.json({ worca: merged.worca || {}, permissions: merged.permissions || {} });
    } catch (err) {
      res.status(500).json({ error: { code: 'write_error', message: err.message } });
    }
  });

  // GET /api/runs
  app.get('/api/runs', (_req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    try {
      const runs = discoverRuns(worcaDir);
      res.json({ ok: true, runs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/runs — start a new pipeline
  app.post('/api/runs', async (req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });

    const body = req.body || {};

    // Backwards compat: detect old { inputType, inputValue } format
    let { sourceType, sourceValue, prompt, planFile, msize, mloops, branch } = body;
    if (body.inputType && sourceType === undefined) {
      if (body.inputType === 'prompt') {
        sourceType = 'none';
        prompt = body.inputValue;
      } else {
        sourceType = body.inputType;
        sourceValue = body.inputValue;
      }
    }

    // Default sourceType
    sourceType = sourceType || 'none';

    // Validation: sourceType must be valid
    if (!['none', 'source', 'spec'].includes(sourceType)) {
      return res.status(400).json({ ok: false, error: 'sourceType must be "none", "source", or "spec"' });
    }

    // Validation: sourceValue required when sourceType is source or spec
    if (sourceType !== 'none') {
      if (typeof sourceValue !== 'string' || sourceValue.trim().length === 0) {
        return res.status(400).json({ ok: false, error: 'sourceValue must be a non-empty string when sourceType is "source" or "spec"' });
      }
      if (sourceValue.length > 50000) {
        return res.status(400).json({ ok: false, error: 'sourceValue must be 50,000 characters or less' });
      }
      sourceValue = sourceValue.trim();
    }

    // Validation: prompt length
    if (prompt != null && typeof prompt === 'string' && prompt.length > 50000) {
      return res.status(400).json({ ok: false, error: 'prompt must be 50,000 characters or less' });
    }
    if (typeof prompt === 'string') prompt = prompt.trim() || undefined;

    // Validation: planFile
    if (planFile !== undefined && planFile !== null) {
      if (typeof planFile !== 'string' || planFile.trim().length === 0) {
        return res.status(400).json({ ok: false, error: 'planFile must be a non-empty string if provided' });
      }
    }

    const hasSource = sourceType !== 'none' && sourceValue;
    const hasPlan = typeof planFile === 'string' && planFile.trim().length > 0;
    const hasPrompt = typeof prompt === 'string' && prompt.length > 0;

    // Validation: at least one of source, planFile, or prompt required
    if (!hasSource && !hasPlan && !hasPrompt) {
      return res.status(400).json({ ok: false, error: 'At least one of source, planFile, or prompt is required' });
    }

    const msizeVal = msize != null ? Math.max(1, Math.min(10, Math.round(Number(msize)))) : 1;
    const mloopsVal = mloops != null ? Math.max(1, Math.min(10, Math.round(Number(mloops)))) : 1;

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
      if (app.locals.broadcast) {
        app.locals.broadcast('run-started', { pid: result.pid });
      }
      res.json({ ok: true, pid: result.pid, sourceType, prompt });
    } catch (err) {
      if (err.code === 'already_running') {
        return res.status(409).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/branches — list git branches
  app.get('/api/branches', (_req, res) => {
    const cwd = projectRoot || process.cwd();
    try {
      const out = execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd, encoding: 'utf8', timeout: 5000 });
      const branches = out.trim().split('\n').filter(Boolean);
      res.json({ ok: true, branches });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/plan-files — list available plan files
  app.get('/api/plan-files', (_req, res) => {
    const root = projectRoot || process.cwd();
    let dirs = ['docs/plans'];
    let extensions = ['.md'];

    if (settingsPath) {
      const settings = readFullSettings(settingsPath);
      const planFiles = settings.worca?.planFiles;
      if (planFiles?.dirs && Array.isArray(planFiles.dirs)) dirs = planFiles.dirs;
      if (planFiles?.extensions && Array.isArray(planFiles.extensions)) extensions = planFiles.extensions;
    }

    const files = [];
    for (const dir of dirs) {
      const absDir = join(root, dir);
      if (!existsSync(absDir)) continue;
      try {
        const entries = readdirSync(absDir);
        for (const name of entries.sort()) {
          if (extensions.some(ext => name.endsWith(ext))) {
            files.push({ path: join(dir, name), dir, name });
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    res.json({ ok: true, files });
  });

  // DELETE /api/runs/:id — stop a running pipeline
  app.delete('/api/runs/:id', (_req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    try {
      const result = stopPipeline(worcaDir);
      if (app.locals.broadcast) {
        app.locals.broadcast('run-stopped', { pid: result.pid });
      }
      res.json({ ok: true, stopped: true, pid: result.pid });
    } catch (err) {
      if (err.code === 'not_running') {
        return res.status(404).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/runs/:id/pause — pause a running pipeline via control file
  app.post('/api/runs/:id/pause', (req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    const runId = req.params.id;
    try {
      const result = pausePipeline(worcaDir, runId);
      if (app.locals.broadcast) {
        app.locals.broadcast('run-paused', { runId });
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/runs/:id/resume — resume a paused/failed pipeline
  app.post('/api/runs/:id/resume', async (req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    const runId = req.params.id;
    try {
      const result = await startPipeline(worcaDir, { resume: true, runId, projectRoot });
      if (app.locals.broadcast) {
        app.locals.broadcast('run-resumed', { runId, pid: result.pid });
      }
      res.json({ ok: true, pid: result.pid, runId });
    } catch (err) {
      if (err.code === 'already_running') {
        return res.status(409).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/runs/:id/stop — write control.json + SIGTERM for a specific run
  app.post('/api/runs/:id/stop', (req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    const runId = req.params.id;
    // Write control.json to signal the orchestrator gracefully before SIGTERM
    try {
      const controlDir = join(worcaDir, 'runs', runId);
      mkdirSync(controlDir, { recursive: true });
      writeFileSync(
        join(controlDir, 'control.json'),
        JSON.stringify({ action: 'stop', requested_at: new Date().toISOString(), source: 'ui' }, null, 2) + '\n',
        'utf8',
      );
    } catch { /* non-fatal — SIGTERM follows */ }
    try {
      const result = stopPipeline(worcaDir);
      if (app.locals.broadcast) {
        app.locals.broadcast('run-stopped', { runId, pid: result.pid });
      }
      res.json({ ok: true, stopped: true, runId, pid: result.pid });
    } catch (err) {
      if (err.code === 'not_running') {
        // Pipeline may be paused (no process) — update status.json directly
        const statusPath = join(worcaDir, 'runs', runId, 'status.json');
        if (existsSync(statusPath)) {
          try {
            const st = JSON.parse(readFileSync(statusPath, 'utf8'));
            if (st.pipeline_status === 'paused' || st.pipeline_status === 'running') {
              st.pipeline_status = 'failed';
              st.stop_reason = 'stopped';
              writeFileSync(statusPath, JSON.stringify(st, null, 2) + '\n', 'utf8');
              if (app.locals.broadcast) {
                app.locals.broadcast('run-stopped', { runId, pid: null });
              }
              return res.json({ ok: true, stopped: true, runId, pid: null });
            }
          } catch { /* fall through to 404 */ }
        }
        return res.status(404).json({ ok: false, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/runs/:id/status — return pipeline_status, stage, iteration from status.json
  app.get('/api/runs/:id/status', (req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    const runId = req.params.id;
    let statusPath = join(worcaDir, 'runs', runId, 'status.json');
    if (!existsSync(statusPath)) {
      statusPath = join(worcaDir, 'results', runId, 'status.json');
    }
    if (!existsSync(statusPath)) {
      return res.status(404).json({ ok: false, error: `Run "${runId}" not found` });
    }
    try {
      let status = JSON.parse(readFileSync(statusPath, 'utf8'));
      // Layer 3: reconcile stale "running" status on read
      if (status.pipeline_status === 'running' && !getRunningPid(worcaDir)) {
        try {
          reconcileStatus(worcaDir);
          status = JSON.parse(readFileSync(statusPath, 'utf8'));
        } catch { /* reconciliation is best-effort */ }
      }
      const stage = status.stage ?? null;
      const iteration = stage != null ? (status.stages?.[stage]?.iteration ?? null) : null;
      res.json({ ok: true, pipeline_status: status.pipeline_status ?? null, stage, iteration });
    } catch (err) {
      res.status(500).json({ ok: false, error: `Failed to read status: ${err.message}` });
    }
  });

  // POST /api/runs/:id/stages/:stage/restart — restart a failed stage
  app.post('/api/runs/:id/stages/:stage/restart', async (req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    const { stage } = req.params;
    try {
      const result = await restartStage(worcaDir, stage, { projectRoot });
      if (app.locals.broadcast) {
        app.locals.broadcast('stage-restarted', { stage, pid: result.pid });
      }
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

  // POST /api/runs/:id/learn — trigger learning analysis for a completed run
  app.post('/api/runs/:id/learn', (req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });

    const runId = req.params.id;
    // Check both runs/ and results/ directories
    let statusPath = join(worcaDir, 'runs', runId, 'status.json');
    if (!existsSync(statusPath)) {
      statusPath = join(worcaDir, 'results', runId, 'status.json');
    }

    if (!existsSync(statusPath)) {
      return res.status(404).json({ ok: false, error: `Run "${runId}" not found` });
    }

    const running = getRunningPid(worcaDir);
    if (running) {
      return res.status(409).json({ ok: false, error: `Pipeline is currently running (PID ${running.pid})` });
    }

    let status;
    try {
      status = JSON.parse(readFileSync(statusPath, 'utf8'));
    } catch (err) {
      return res.status(500).json({ ok: false, error: `Failed to read status: ${err.message}` });
    }

    // Concurrency guard: check if learn is already running
    const learnStage = status.stages?.learn;
    if (learnStage?.status === 'in_progress' && learnStage.pid) {
      try {
        process.kill(learnStage.pid, 0); // throws if PID dead
        return res.status(409).json({ ok: false, error: 'Learning analysis is already running' });
      } catch { /* stale PID — allow re-run */ }
    }

    const cwd = projectRoot || process.cwd();
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('python3', ['.claude/scripts/run_learn.py', '--run-id', runId], {
      detached: true,
      stdio: 'ignore',
      cwd,
      env,
    });
    child.unref();

    // Write in_progress status immediately so UI reflects it on refresh
    const now = new Date().toISOString();
    if (!status.stages) status.stages = {};
    status.stages.learn = {
      status: 'in_progress',
      pid: child.pid,
      started_at: now,
      iterations: [{
        number: 1, status: 'in_progress', started_at: now,
        agent: 'learner', model: 'sonnet', trigger: 'manual',
      }],
    };
    try {
      writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf8');
    } catch { /* non-fatal */ }

    if (app.locals.broadcast) {
      app.locals.broadcast('learn-started', { runId });
    }

    // Poll for status updates (non-active runs aren't caught by the file watcher)
    const pollInterval = setInterval(() => {
      try {
        const fresh = JSON.parse(readFileSync(statusPath, 'utf8'));
        if (app.locals.scheduleRefresh) app.locals.scheduleRefresh();
        const ls = fresh.stages?.learn?.status;
        if (ls !== 'in_progress' && ls !== 'pending') clearInterval(pollInterval);
      } catch { clearInterval(pollInterval); }
    }, 3000);
    setTimeout(() => clearInterval(pollInterval), 15 * 60 * 1000);
    if (pollInterval.unref) pollInterval.unref();

    res.json({ ok: true, runId, pid: child.pid });
  });

  // GET /api/beads/issues
  app.get('/api/beads/issues', (_req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    const beadsDbPath = join(worcaDir, '..', '.beads', 'beads.db');
    if (!dbExists(beadsDbPath)) {
      return res.json({ ok: true, issues: [], dbExists: false, dbPath: beadsDbPath });
    }
    try {
      const issues = listIssues(beadsDbPath);
      res.json({ ok: true, issues, dbExists: true, dbPath: beadsDbPath });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/beads/issues/:id/start
  app.post('/api/beads/issues/:id/start', async (req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    const issueId = parseInt(req.params.id, 10);
    if (!Number.isInteger(issueId) || issueId <= 0) {
      return res.status(400).json({ ok: false, error: 'Issue ID must be a positive integer' });
    }
    const beadsDbPath = join(worcaDir, '..', '.beads', 'beads.db');
    const issue = getIssue(beadsDbPath, issueId);
    if (!issue) {
      return res.status(404).json({ ok: false, error: `Issue ${issueId} not found` });
    }
    if (issue.status !== 'ready') {
      return res.status(409).json({ ok: false, error: `Issue ${issueId} is not in 'ready' state (current: ${issue.status})` });
    }
    if (issue.blocked_by.length > 0) {
      return res.status(409).json({ ok: false, error: `Issue ${issueId} is blocked by issues: ${issue.blocked_by.join(', ')}` });
    }
    try {
      const prompt = `[Beads #${issue.id}] ${issue.title}\n\n${(issue.body || '').trim()}`.trim();
      const result = await startPipeline(worcaDir, { inputType: 'prompt', inputValue: prompt, msize: 1, mloops: 1 });
      if (app.locals.broadcast) {
        app.locals.broadcast('run-started', { pid: result.pid });
      }
      res.json({ ok: true, pid: result.pid, issueId, prompt });
    } catch (err) {
      const status = (err.message || '').includes('already running') ? 409 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // GET /api/costs — token & cost data for all runs
  app.get('/api/costs', (_req, res) => {
    if (!worcaDir) return res.status(501).json({ ok: false, error: 'worcaDir not configured' });
    const resultsDir = join(worcaDir, 'results');
    if (!existsSync(resultsDir)) return res.json({ ok: true, tokenData: {} });

    const tokenData = {}; // { runId: { stage: [ { inputTokens, outputTokens, ... } ] } }

    for (const entry of readdirSync(resultsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const runDir = join(resultsDir, entry.name);
      const stageNames = [];
      try {
        for (const sub of readdirSync(runDir, { withFileTypes: true })) {
          if (sub.isDirectory()) stageNames.push(sub.name);
        }
      } catch { continue; }

      if (stageNames.length === 0) continue;
      tokenData[entry.name] = {};

      for (const stage of stageNames) {
        const stageDir = join(runDir, stage);
        const iters = [];
        try {
          const files = readdirSync(stageDir).filter(f => f.startsWith('iter-') && f.endsWith('.json')).sort();
          for (const file of files) {
            try {
              const data = JSON.parse(readFileSync(join(stageDir, file), 'utf8'));
              const mu = data.modelUsage || {};
              // Aggregate across all models in this iteration
              let inputTokens = 0, outputTokens = 0, cacheReadInputTokens = 0, cacheCreationInputTokens = 0;
              const models = [];
              for (const [model, usage] of Object.entries(mu)) {
                inputTokens += usage.inputTokens || 0;
                outputTokens += usage.outputTokens || 0;
                cacheReadInputTokens += usage.cacheReadInputTokens || 0;
                cacheCreationInputTokens += usage.cacheCreationInputTokens || 0;
                models.push(model);
              }
              iters.push({ inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, models });
            } catch { /* skip bad files */ }
          }
        } catch { /* skip */ }
        if (iters.length > 0) tokenData[entry.name][stage] = iters;
      }
    }

    res.json({ ok: true, tokenData });
  });

  // POST /api/webhooks/test — send a pipeline.test.ping to a webhook URL
  app.post('/api/webhooks/test', async (req, res) => {
    const { url, secret, timeout_ms } = req.body || {};

    const trimmedUrl = typeof url === 'string' ? url.trim() : '';
    if (!trimmedUrl) {
      return res.status(400).json({ ok: false, error: 'url is required' });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      return res.status(400).json({ ok: false, error: 'url is not a valid URL' });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return res.status(400).json({ ok: false, error: 'url must use http or https protocol' });
    }

    const event = {
      schema_version: '1',
      event_id: randomUUID(),
      event_type: 'pipeline.test.ping',
      timestamp: new Date().toISOString(),
      run_id: null,
      pipeline: null,
      payload: { test: true },
    };

    const body = JSON.stringify(event);
    const headers = { 'Content-Type': 'application/json' };

    if (secret && typeof secret === 'string' && secret.length > 0) {
      const hmac = createHmac('sha256', secret);
      hmac.update(body);
      headers['X-Worca-Signature'] = 'sha256=' + hmac.digest('hex');
    }

    const timeoutMs = (typeof timeout_ms === 'number' && timeout_ms > 0)
      ? Math.min(timeout_ms, 30000)
      : 10000;

    const startMs = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(trimmedUrl, { method: 'POST', headers, body, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      res.json({ ok: true, status_code: response.status, response_ms: Date.now() - startMs });
    } catch (err) {
      res.json({ ok: false, error: err.message, response_ms: Date.now() - startMs });
    }
  });

  // POST /api/webhooks/inbox — receive webhook events
  app.post('/api/webhooks/inbox', (req, res) => {
    const headers = {
      'x-worca-event': req.headers['x-worca-event'] || '',
      'x-worca-delivery': req.headers['x-worca-delivery'] || '',
      'x-worca-signature': req.headers['x-worca-signature'] || '',
      'content-type': req.headers['content-type'] || '',
    };
    const stored = webhookInbox.push({ headers, envelope: req.body || {} });
    if (app.locals.broadcast) {
      app.locals.broadcast('webhook-inbox-event', stored);
    }
    res.json({ control: { action: webhookInbox.getControlAction() } });
  });

  // GET /api/webhooks/inbox — list stored events
  app.get('/api/webhooks/inbox', (req, res) => {
    const since = req.query.since != null ? parseInt(req.query.since, 10) : undefined;
    res.json({ ok: true, events: webhookInbox.list(since), controlAction: webhookInbox.getControlAction() });
  });

  // DELETE /api/webhooks/inbox — clear all events
  app.delete('/api/webhooks/inbox', (_req, res) => {
    webhookInbox.clear();
    if (app.locals.broadcast) {
      app.locals.broadcast('webhook-inbox-cleared', {});
    }
    res.json({ ok: true });
  });

  // GET /api/webhooks/inbox/control — get current control action
  app.get('/api/webhooks/inbox/control', (_req, res) => {
    res.json({ ok: true, action: webhookInbox.getControlAction() });
  });

  // PUT /api/webhooks/inbox/control — set control action
  app.put('/api/webhooks/inbox/control', (req, res) => {
    const { action } = req.body || {};
    if (!['continue', 'pause', 'abort'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'action must be "continue", "pause", or "abort"' });
    }
    webhookInbox.setControlAction(action);
    if (app.locals.broadcast) {
      app.locals.broadcast('webhook-control-changed', { action });
    }
    res.json({ ok: true, action });
  });

  // GET /api/project-info
  app.get('/api/project-info', (_req, res) => {
    res.json({ name: projectRoot ? basename(projectRoot) : '' });
  });

  app.use(express.static(appDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile('index.html', { root: appDir });
  });
  return app;
}
