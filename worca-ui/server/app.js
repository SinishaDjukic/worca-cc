// server/app.js

import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { dbExists, getIssue, listIssues } from './beads-reader.js';
import { RAW_BODY } from './integrations/index.js';
import { verify } from './integrations/verify.js';
import { ProcessManager } from './process-manager.js';
import { scanDirectory } from './project-registry.js';
import {
  createProjectRoutes,
  createProjectScopedRoutes,
  projectResolver,
} from './project-routes.js';
import { discoverSubagents } from './subagents-discovery.js';
import { getVersionInfo } from './versions.js';
import { createInbox } from './webhook-inbox.js';

export function createApp(options = {}) {
  const app = express();
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
  const { settingsPath, worcaDir, projectRoot, prefsDir } = options;
  // subagentDirs is a test-injection seam; production calls omit it and we
  // resolve from homedir() + projectRoot.
  const subagentDirs = options.subagentDirs || null;

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // ─── Security headers ──────────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // ─── CSRF Origin check ────────────────────────────────────────────────
  // Block cross-origin state-mutating requests. Webhooks from pipeline
  // processes use X-Worca-Event header to bypass (they aren't browsers).
  app.use((req, res, next) => {
    if (
      req.method === 'GET' ||
      req.method === 'HEAD' ||
      req.method === 'OPTIONS'
    ) {
      return next();
    }
    // Allow non-browser clients (webhook callbacks, curl, etc.)
    if (req.headers['x-worca-event']) return next();

    const origin = req.headers.origin;
    if (!origin) return next(); // non-browser request (curl, server-to-server)

    try {
      const parsed = new URL(origin);
      const host = parsed.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return next();
      }
    } catch {
      // malformed origin — reject
    }
    res
      .status(403)
      .json({ ok: false, error: 'Forbidden: cross-origin request' });
  });

  // Webhook inbox — shared in-memory store (also exposed for WS server)
  const webhookInbox = options.webhookInbox || createInbox();
  app.locals.webhookInbox = webhookInbox;

  // ─── Legacy single-project API ─────────────────────────────────────────
  // Mounts the shared project-scoped routes at /api with a middleware that
  // injects req.project from the closure options, so /api/runs, /api/settings,
  // etc. work identically to /api/projects/:projectId/runs, etc.
  app.use(
    '/api',
    (req, _res, next) => {
      req.project = {
        name: 'default',
        path: projectRoot || process.cwd(),
        worcaDir,
        settingsPath,
        projectRoot: projectRoot || process.cwd(),
        pm: worcaDir
          ? new ProcessManager({
              worcaDir,
              projectRoot: projectRoot || process.cwd(),
            })
          : null,
      };
      next();
    },
    createProjectScopedRoutes(),
  );

  // ─── Unique routes (not in project-scoped router) ──────────────────────

  // GET /api/subagents — list discoverable subagent types for the dispatch editor.
  // Walks ~/.claude/agents/ (user-global), ~/.claude/plugins/cache/
  // (plugin-cached), and the active project's .claude/agents/ (in single-project
  // mode). Tests inject alternate dirs via createApp({ subagentDirs: {...} }).
  app.get('/api/subagents', (_req, res) => {
    try {
      const userDir =
        subagentDirs?.userDir ?? join(homedir(), '.claude', 'agents');
      const pluginCacheDir =
        subagentDirs?.pluginCacheDir ??
        join(homedir(), '.claude', 'plugins', 'cache');
      const projectAgentsDir =
        subagentDirs?.projectAgentsDir ??
        (projectRoot ? join(projectRoot, '.claude', 'agents') : undefined);
      const subagents = discoverSubagents({
        userDir,
        pluginCacheDir,
        projectAgentsDir,
      });
      res.json({ ok: true, subagents });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/beads/issues
  app.get('/api/beads/issues', (_req, res) => {
    if (!worcaDir)
      return res
        .status(501)
        .json({ ok: false, error: 'worcaDir not configured' });
    const beadsDbPath = join(worcaDir, '..', '.beads', 'beads.db');
    if (!dbExists(beadsDbPath)) {
      return res.json({
        ok: true,
        issues: [],
        dbExists: false,
        dbPath: beadsDbPath,
      });
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
    if (!worcaDir)
      return res
        .status(501)
        .json({ ok: false, error: 'worcaDir not configured' });
    const issueId = parseInt(req.params.id, 10);
    if (!Number.isInteger(issueId) || issueId <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'Issue ID must be a positive integer' });
    }
    const beadsDbPath = join(worcaDir, '..', '.beads', 'beads.db');
    const issue = getIssue(beadsDbPath, issueId);
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
      const pm = new ProcessManager({
        worcaDir,
        projectRoot: projectRoot || process.cwd(),
      });
      const prompt =
        `[Beads #${issue.id}] ${issue.title}\n\n${(issue.body || '').trim()}`.trim();
      const result = await pm.startPipeline({
        inputType: 'prompt',
        inputValue: prompt,
        msize: 1,
        mloops: 1,
      });
      if (app.locals.broadcast) {
        app.locals.broadcast('run-started', { pid: result.pid });
      }
      res.json({ ok: true, pid: result.pid, issueId, prompt });
    } catch (err) {
      const status = (err.message || '').includes('already running')
        ? 409
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
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
      return res
        .status(400)
        .json({ ok: false, error: 'url is not a valid URL' });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return res
        .status(400)
        .json({ ok: false, error: 'url must use http or https protocol' });
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
      headers['X-Worca-Signature'] = `sha256=${hmac.digest('hex')}`;
    }

    const timeoutMs =
      typeof timeout_ms === 'number' && timeout_ms > 0
        ? Math.min(timeout_ms, 30000)
        : 10000;

    const startMs = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(trimmedUrl, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      res.json({
        ok: true,
        status_code: response.status,
        response_ms: Date.now() - startMs,
      });
    } catch (err) {
      res.json({
        ok: false,
        error: err.message,
        response_ms: Date.now() - startMs,
      });
    }
  });

  // POST /api/webhooks/inbox — receive webhook events
  app.post('/api/webhooks/inbox', (req, res) => {
    const integrations = app.locals.integrations;
    if (integrations?.strictInboxVerification) {
      const ok = verify(
        req.rawBody || Buffer.alloc(0),
        req.headers['x-worca-signature'],
        integrations.secrets || [],
      );
      if (!ok)
        return res.status(401).json({ ok: false, error: 'invalid signature' });
    }
    const headers = {
      'x-worca-event': req.headers['x-worca-event'] || '',
      'x-worca-delivery': req.headers['x-worca-delivery'] || '',
      'x-worca-signature': req.headers['x-worca-signature'] || '',
      'content-type': req.headers['content-type'] || '',
    };
    const runId = req.body?.run_id || null;
    const projectId =
      runId && app.locals.resolveRunProject
        ? app.locals.resolveRunProject(runId)
        : null;
    const stored = webhookInbox.push({
      headers,
      envelope: req.body || {},
      projectId,
    });
    if (req.rawBody) stored[RAW_BODY] = req.rawBody;
    if (app.locals.broadcast) {
      app.locals.broadcast('webhook-inbox-event', stored);
    }
    app.locals.integrations?.onEvent(stored);
    res.json({ control: { action: webhookInbox.getControlAction() } });
  });

  // GET /api/webhooks/inbox — list stored events
  app.get('/api/webhooks/inbox', (req, res) => {
    const since =
      req.query.since != null ? parseInt(req.query.since, 10) : undefined;
    const projectId = req.query.projectId || undefined;
    res.json({
      ok: true,
      events: webhookInbox.list(since, projectId),
      controlAction: webhookInbox.getControlAction(),
    });
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
    const integrations = app.locals.integrations;
    if (integrations?.strictInboxVerification) {
      const ok = verify(
        req.rawBody || Buffer.alloc(0),
        req.headers['x-worca-signature'],
        integrations.secrets || [],
      );
      if (!ok)
        return res.status(401).json({ ok: false, error: 'invalid signature' });
    }
    const { action } = req.body || {};
    if (!['continue', 'pause', 'abort'].includes(action)) {
      return res.status(400).json({
        ok: false,
        error: 'action must be "continue", "pause", or "abort"',
      });
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

  // POST /api/projects/inbox — webhook hint for immediate status refresh
  app.post('/api/projects/inbox', (req, res) => {
    const body = req.body || {};
    const projectId =
      body.project_id ||
      req.headers['x-worca-project'] ||
      (body.run_id && app.locals.resolveRunProject?.(body.run_id)) ||
      null;

    if (!projectId) {
      return res.status(400).json({
        ok: false,
        error:
          'Could not identify project. Provide project_id, X-Worca-Project header, or run_id.',
      });
    }

    const refreshed = app.locals.scheduleRefresh?.(projectId);
    if (refreshed === false) {
      console.warn(`[webhook-hint] unknown project: ${projectId}`);
    }

    res.json({ ok: true, project: projectId });
  });

  // POST /api/choose-directory — native folder picker (cross-platform)
  app.post('/api/choose-directory', (_req, res) => {
    try {
      let chosenPath;
      if (process.platform === 'darwin') {
        chosenPath = execFileSync(
          'osascript',
          [
            '-e',
            'POSIX path of (choose folder with prompt "Select project directory")',
          ],
          { encoding: 'utf8' },
        ).trim();
      } else if (process.platform === 'win32') {
        const ps = execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = "Select project directory"; if ($d.ShowDialog() -eq "OK") { $d.SelectedPath } else { exit 1 }',
          ],
          { encoding: 'utf8' },
        ).trim();
        chosenPath = ps;
      } else {
        // Linux: try zenity, then kdialog
        try {
          chosenPath = execFileSync(
            'zenity',
            [
              '--file-selection',
              '--directory',
              '--title=Select project directory',
            ],
            { encoding: 'utf8' },
          ).trim();
        } catch {
          chosenPath = execFileSync(
            'kdialog',
            [
              '--getexistingdirectory',
              '.',
              '--title',
              'Select project directory',
            ],
            { encoding: 'utf8' },
          ).trim();
        }
      }
      chosenPath = chosenPath.replace(/[\\/]+$/, '');
      if (chosenPath) {
        res.json({ ok: true, path: chosenPath });
      } else {
        res.json({ ok: false });
      }
    } catch {
      res.json({ ok: false });
    }
  });

  // POST /api/scan-directory — scan parent folder for immediate git subdirectories
  app.post('/api/scan-directory', async (req, res) => {
    const { path: dirPath } = req.body || {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ ok: false, error: 'path is required' });
    }
    if (!isAbsolute(dirPath)) {
      return res
        .status(400)
        .json({ ok: false, error: 'path must be absolute' });
    }
    if (!existsSync(dirPath)) {
      return res
        .status(400)
        .json({ ok: false, error: `directory does not exist: ${dirPath}` });
    }
    try {
      const subfolders = await scanDirectory(dirPath);
      res.json({ ok: true, subfolders });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/versions — installed + registry version info
  app.get('/api/versions', async (req, res) => {
    const force = req.query.force === '1';
    const prefsPath = prefsDir ? join(prefsDir, 'preferences.json') : null;
    const worcaVersion = app.locals.worcaVersion || null;
    try {
      const data = await getVersionInfo({ prefsPath, worcaVersion, force });
      res.json(data);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── Multi-project routes ──────────────────────────────────────────────
  if (prefsDir) {
    app.use('/api/projects', createProjectRoutes({ prefsDir, projectRoot }));
    app.use(
      '/api/projects/:projectId',
      projectResolver({ prefsDir, projectRoot }),
      createProjectScopedRoutes({ prefsDir }),
    );
  }

  // GET /api/integrations/status — adapter states, chat states, counters
  app.get('/api/integrations/status', (_req, res) => {
    const integrations = app.locals.integrations;
    if (!integrations) return res.json({ enabled: false });
    res.json(integrations.status());
  });

  // ─── Dynamic favicon ──────────────────────────────────────────────────
  // Serve mode-specific favicon before express.static so it takes precedence.
  app.get('/favicon.svg', (_req, res) => {
    const faviconFile = projectRoot
      ? 'favicon-project.svg'
      : 'favicon-global.svg';
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(faviconFile, { root: appDir });
  });

  app.use(express.static(appDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile('index.html', { root: appDir });
  });
  return app;
}
