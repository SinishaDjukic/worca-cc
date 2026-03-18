// server/app.js
import express from 'express';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateSettingsPayload } from './settings-validator.js';
import { startPipeline, stopPipeline, restartStage } from './process-manager.js';
import { discoverRuns } from './watcher.js';
import { listIssues, getIssue, dbExists } from './beads-reader.js';

function readFullSettings(settingsPath) {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

export function createApp(options = {}) {
  const app = express();
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
  const { settingsPath, worcaDir, projectRoot } = options;

  app.use(express.json());

  // GET /api/settings
  app.get('/api/settings', (_req, res) => {
    if (!settingsPath) return res.status(501).json({ error: { code: 'not_configured', message: 'settingsPath not configured' } });
    try {
      const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
      res.json({ worca: raw.worca || {}, permissions: raw.permissions || {} });
    } catch (err) {
      res.status(500).json({ error: { code: 'read_error', message: err.message } });
    }
  });

  // POST /api/settings
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
      const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));

      // Merge worca sub-keys (replace each top-level sub-key wholesale)
      if (body.worca && typeof body.worca === 'object') {
        if (!raw.worca) raw.worca = {};
        for (const key of Object.keys(body.worca)) {
          raw.worca[key] = body.worca[key];
        }
      }

      // Replace permissions wholesale
      if (body.permissions !== undefined) {
        raw.permissions = body.permissions;
      }

      // Never touch hooks
      writeFileSync(settingsPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
      res.json({ worca: raw.worca || {}, permissions: raw.permissions || {} });
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

  app.use(express.static(appDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile('index.html', { root: appDir });
  });
  return app;
}
