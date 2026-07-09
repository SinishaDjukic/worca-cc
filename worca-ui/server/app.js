// server/app.js

import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { dbExists, getIssue, listIssues } from './beads-reader.js';
import {
  _effectiveCrgConfig,
  createCrgStatus,
} from './code-review-graph-status.js';
import { createFleetRouter } from './fleet-routes.js';
import {
  _effectiveConfig,
  clearRepoCache,
  createGraphifyStatus,
  snapshotDir,
} from './graphify-status.js';
import { RAW_BODY } from './integrations/index.js';
import { verify } from './integrations/verify.js';
import { LaunchLock } from './launch-lock.js';
import { fleetRunsDir, workspaceRunsDir, workspacesDir } from './paths.js';
import { createPreferencesRouter } from './preferences-routes.js';
import { ProcessManager } from './process-manager.js';
import { readProjects, scanDirectory } from './project-registry.js';
import {
  createProjectRoutes,
  createProjectScopedRoutes,
  projectResolver,
} from './project-routes.js';
import { validateIntegrationsConfig } from './settings-validator.js';
import { createStatusRouter } from './status-routes.js';
import { discoverSubagents } from './subagents-discovery.js';
import { checkWorcaVersion } from './version-check.js';
import { getVersionInfo } from './versions.js';
import { createInbox } from './webhook-inbox.js';
import { createWorkspaceRouter } from './workspace-routes.js';

// Invokes `worca cleanup --<flag> <id>` as a subprocess and resolves once
// the cleanup completes. Wired into the fleet/workspace router DELETE
// ?cleanup=1 path so the UI Cleanup button actually removes the worktrees
// + manifest dir (without this, the route falls back to a no-op default).
function runWorcaCleanupSubprocess(flag, id) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'python3',
      ['-m', 'worca.cli.main', 'cleanup', flag, id],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({});
      else reject(new Error(`worca cleanup exited ${code}: ${stderr.trim()}`));
    });
  });
}

export function buildWorkspaceArgs(workspace_root, workspace_id, manifest) {
  const args = [
    '-m',
    'worca.scripts.run_workspace',
    workspace_root,
    '--workspace-id',
    workspace_id,
  ];
  if (manifest.work_request?.source) {
    args.push('--source', manifest.work_request.source);
  } else {
    args.push('--prompt', manifest.work_request?.description ?? '');
  }
  if (manifest.branch_template) {
    args.push('--branch', manifest.branch_template);
  }
  if (manifest.skip_integration) args.push('--skip-integration');
  if (manifest.skip_planning) args.push('--skip-planning');
  if (manifest.max_parallel) {
    args.push('--max-parallel', String(manifest.max_parallel));
  }
  for (const p of manifest.guide?.paths || []) {
    args.push('--guide', p);
  }
  if (manifest.workspace_plan_path) {
    args.push('--workspace-plan', manifest.workspace_plan_path);
  }
  for (const [name, path] of Object.entries(manifest.project_plans || {})) {
    args.push('--project-plan', `${name}=${path}`);
  }
  return args;
}

/**
 * Returns true when `host` resolves to a loopback bind — undefined/null are
 * treated as loopback because the production default in
 * `worca-ui/server/index.js` is `127.0.0.1`. Used by the outbound-send route
 * to refuse exposing user-addressable chat from a non-loopback bind.
 *
 * @param {string|undefined|null} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  if (host === undefined || host === null || host === '') return true;
  if (host === 'localhost' || host === '::1') return true;
  if (host === '::ffff:127.0.0.1') return true;
  if (host.startsWith('127.')) return true;
  return false;
}

export function createApp(options = {}) {
  const app = express();
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
  const {
    settingsPath,
    worcaDir,
    projectRoot,
    prefsDir,
    serverHost,
    serverPort,
  } = options;
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

  // Single LaunchLock instance shared across BOTH legacy /api and
  // /api/projects/:id mounts so the global max_concurrent_pipelines cap is
  // enforced atomically across all entry points. Without this, two routers
  // each held their own mutex and concurrent launches via /api/runs +
  // /api/projects/:id/runs could both pass the cap check and start.
  const launchLock = new LaunchLock();

  // In-process mutex for deferred PR creation — keyed by `${project}/${runId}`.
  // Handles double-click races: a second POST while the first is in-flight gets 409.
  const inFlightPrCreation = new Map();

  // Spawner for `worca pr create` — overridable via options._spawnPrCreate for tests.
  const prSpawn =
    options._spawnPrCreate ||
    ((runId, projectPath) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          'python3',
          [
            '-m',
            'worca.cli.main',
            'pr',
            'create',
            '--project',
            projectPath,
            '--',
            runId,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code === 0) resolve({ stdout, stderr });
          else
            reject(
              Object.assign(
                new Error(`worca pr create failed: ${stderr.trim()}`),
                { stderr },
              ),
            );
        });
      }));

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
              settingsPath,
            })
          : null,
      };
      next();
    },
    createProjectScopedRoutes({
      prefsDir,
      serverHost,
      serverPort,
      launchLock,
    }),
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

  // GET /api/tools — static known-tools list for autocomplete.
  const knownToolsPath = join(
    dirname(fileURLToPath(import.meta.url)),
    'known-tools.json',
  );
  const knownTools = JSON.parse(readFileSync(knownToolsPath, 'utf8'));

  app.get('/api/tools', (_req, res) => {
    res.json({ ok: true, tools: knownTools });
  });

  // GET /api/skills — try `claude --list-skills --json`, fallback to static list.
  const knownSkillsPath = join(
    dirname(fileURLToPath(import.meta.url)),
    'known-skills.json',
  );
  const knownSkills = JSON.parse(readFileSync(knownSkillsPath, 'utf8'));

  app.get('/api/skills', (_req, res) => {
    execFile(
      'claude',
      ['--list-skills', '--json'],
      { timeout: 5000 },
      (err, stdout) => {
        if (!err && stdout) {
          try {
            const parsed = JSON.parse(stdout);
            const skills = Array.isArray(parsed)
              ? parsed.map((s) => ({
                  name: typeof s === 'string' ? s : s.name,
                  group:
                    typeof s === 'string'
                      ? 'Discovered'
                      : s.group || 'Discovered',
                }))
              : knownSkills;
            return res.json({ ok: true, skills, source: 'live' });
          } catch {
            // JSON parse failed — fall through to fallback
          }
        }
        res.json({ ok: true, skills: knownSkills, source: 'fallback' });
      },
    );
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
      const subfolders = await scanDirectory(dirPath, prefsDir);
      res.json({ ok: true, subfolders });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/versions — installed + registry version info
  app.get('/api/versions', async (req, res) => {
    const force = req.query.force === '1';
    const prefsPath = prefsDir ? join(prefsDir, 'preferences.json') : null;
    // Re-check installed worca-cc version on force refresh
    if (force) {
      app.locals.worcaVersion = await checkWorcaVersion();
    }
    const worcaVersion = app.locals.worcaVersion || null;
    try {
      const data = await getVersionInfo({ prefsPath, worcaVersion, force });
      res.json(data);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/worca-cli — focused worca-cc compatibility probe.
  //
  // Returns the cached `checkWorcaVersion()` result populated at server
  // boot (see index.js). The UI uses this to gate destructive Pipelines
  // actions: when `ok` is false, the editor surfaces a banner and hides
  // the Edit / Duplicate / Set Default / Delete / Create / Import
  // buttons. Read paths (list, view, export) keep working.
  //
  // `?force=1` re-runs the probe. Without `force`, the response is
  // served from the cache and costs essentially nothing.
  app.get('/api/worca-cli', async (req, res) => {
    if (req.query.force === '1' || !app.locals.worcaVersion) {
      app.locals.worcaVersion = await checkWorcaVersion();
    }
    res.json(app.locals.worcaVersion);
  });

  // ─── Multi-project routes ──────────────────────────────────────────────
  if (prefsDir) {
    app.use('/api/preferences', createPreferencesRouter({ prefsDir }));
    app.use('/api/status', createStatusRouter({ prefsDir }));
    app.use(
      '/api/projects',
      createProjectRoutes({ prefsDir, projectRoot, serverHost, serverPort }),
    );
    app.use(
      '/api/projects/:projectId',
      projectResolver({ prefsDir, projectRoot }),
      createProjectScopedRoutes({
        prefsDir,
        serverHost,
        serverPort,
        launchLock,
      }),
    );
    app.use(
      '/api/fleet-runs',
      createFleetRouter({
        fleetRunsDir: fleetRunsDir(),
        prefsDir,
        runCleanup: (id) => runWorcaCleanupSubprocess('--fleet-id', id),
        // Spawn run_fleet.py in a detached subprocess so the route can return
        // immediately. We pass the pre-generated fleet_id so the in-flight
        // manifest path matches what the route just wrote.
        dispatchFleet: async ({ fleet_id, projects, manifest, resume }) => {
          // Resume path: the /resume route already flipped the manifest to
          // "running"; run_fleet.py --resume reads the manifest, continues
          // paused/interrupted children in place and re-dispatches
          // failed/pending ones. No --projects — the manifest is the source.
          if (resume) {
            const child = spawn(
              'python3',
              ['-m', 'worca.scripts.run_fleet', '--resume', fleet_id],
              { detached: true, stdio: 'ignore', env: { ...process.env } },
            );
            child.unref();
            return;
          }
          if (!projects || projects.length === 0) return;
          const args = [
            '-m',
            'worca.scripts.run_fleet',
            '--fleet-id',
            fleet_id,
            '--projects',
            ...projects,
          ];
          if (manifest.work_request?.source) {
            args.push('--source', manifest.work_request.source);
          } else {
            args.push('--prompt', manifest.work_request?.description ?? '');
          }
          if (manifest.head_template) {
            args.push('--head-template', manifest.head_template);
          }
          if (manifest.base_branch) {
            args.push('--base', manifest.base_branch);
          }
          if (manifest.plan?.path) {
            args.push('--plan', manifest.plan.path);
          }
          for (const p of manifest.guide?.paths || []) {
            args.push('--guide', p);
          }
          if (manifest.max_parallel) {
            args.push('--max-parallel', String(manifest.max_parallel));
          }
          if (manifest.fleet_failure_threshold != null) {
            args.push(
              '--fleet-failure-threshold',
              String(manifest.fleet_failure_threshold),
            );
          }
          const child = spawn('python3', args, {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env },
          });
          child.unref();
        },
      }),
    );

    // Workspace routers — both definitions (/api/workspaces) and runs
    // (/api/workspace-runs). The router factory exposes them as a pair.
    const workspaceRouters = createWorkspaceRouter({
      workspaceRunsDir: workspaceRunsDir(),
      workspacesDir: workspacesDir(),
      runCleanup: (id) => runWorcaCleanupSubprocess('--workspace-id', id),
      // Spawn run_workspace.py in a detached subprocess, mirroring the fleet
      // dispatcher. We pass --workspace-id so the script reuses the manifest
      // the route just wrote instead of generating a fresh ID (which would
      // orphan the manifest the UI navigated to).
      dispatchWorkspace: async ({
        workspace_id,
        workspace_root,
        manifest,
        resume,
      }) => {
        if (resume) {
          const child = spawn(
            'python3',
            [
              '-m',
              'worca.scripts.run_workspace',
              workspace_root,
              '--resume',
              workspace_id,
            ],
            { detached: true, stdio: 'ignore', env: { ...process.env } },
          );
          child.unref();
          return;
        }
        const args = buildWorkspaceArgs(workspace_root, workspace_id, manifest);
        const child = spawn('python3', args, {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
        });
        child.unref();
      },
    });
    app.use('/api/workspaces', workspaceRouters.workspaces);
    app.use('/api/workspace-runs', workspaceRouters.workspaceRuns);
  }

  // POST /api/projects/:project/runs/:runId/pr — trigger deferred PR creation.
  // The in-process mutex (inFlightPrCreation) prevents double-click races: a
  // second request while the first is still in-flight returns 409 immediately.
  // The CLI's own status.json lock covers concurrent-process races.
  app.post('/api/projects/:project/runs/:runId/pr', async (req, res) => {
    const { project, runId } = req.params;

    if (!/^[A-Za-z0-9_.-]+$/.test(runId) || runId.startsWith('-')) {
      return res.status(400).json({ error: 'invalid_run_id' });
    }

    const key = `${project}/${runId}`;

    if (inFlightPrCreation.has(key)) {
      return res.status(409).json({ error: 'pr_creation_in_progress' });
    }

    // Resolve the project path: use req.project if set by projectResolver
    // (global mode), otherwise fall back to projectRoot or cwd.
    const projectPath = req.project?.path ?? projectRoot ?? process.cwd();

    const work = (async () => {
      const { stdout } = await prSpawn(runId, projectPath);
      // Match a PR/MR URL across hosts the CLI may emit: GitHub (/pull/N),
      // GitLab (/-/merge_requests/N), Bitbucket (/pull-requests/N), and
      // Azure DevOps (/pullrequest/N). Keep it provider-agnostic so the
      // returned pr_url isn't silently dropped on non-GitHub hosts.
      const prUrlMatch = stdout.match(
        /https?:\/\/\S+?\/(?:pull|pull-requests|pullrequest|merge_requests)\/\d+/,
      );
      if (prUrlMatch) return { pr_url: prUrlMatch[0] };
      return {};
    })();

    inFlightPrCreation.set(key, work);

    try {
      const result = await work;
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      inFlightPrCreation.delete(key);
    }
  });

  // POST /api/integrations/telegram/detect — find chat IDs from recent messages.
  // If the Telegram adapter is running, temporarily pauses its poll loop so
  // getUpdates returns results instead of being consumed by the long-poller.
  app.post('/api/integrations/telegram/detect', async (req, res) => {
    let token = req.body?.token;
    if (!token) {
      try {
        const cfgRaw = readFileSync(
          join(prefsDir, 'integrations', 'config.json'),
          'utf8',
        );
        token = JSON.parse(cfgRaw).telegram?.bot_token;
      } catch {
        /* no config */
      }
    }
    if (!token) token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return res.status(400).json({ error: 'No bot token provided' });
    }

    // Pause the running adapter so getUpdates isn't consumed by the poll loop
    const integrations = app.locals.integrations;
    const adapterEntry = integrations?._getAdapter?.('telegram');
    let wasStopped = false;
    if (adapterEntry) {
      try {
        await adapterEntry.adapter.stop();
        wasStopped = true;
        // Brief delay to let the in-flight long-poll request complete
        await new Promise((r) => setTimeout(r, 200));
      } catch {
        /* ignore */
      }
    }

    try {
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const me = await meRes.json();
      const botUsername = me.ok ? me.result.username : null;

      const updRes = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?timeout=0&limit=20`,
      );
      const upd = await updRes.json();

      const chats = [];
      if (upd.ok) {
        for (const u of upd.result) {
          const msg = u.message;
          if (msg?.chat?.id) {
            const existing = chats.find((c) => c.id === msg.chat.id);
            if (!existing) {
              chats.push({
                id: msg.chat.id,
                type: msg.chat.type,
                title:
                  msg.chat.title || msg.chat.first_name || String(msg.chat.id),
              });
            }
          }
        }
      }

      res.json({ ok: true, botUsername, chats });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      // Restart the adapter if we paused it
      if (wasStopped && adapterEntry) {
        adapterEntry.adapter.start().catch(() => {});
      }
    }
  });

  // GET /api/integrations/status — adapter states, chat states, counters
  app.get('/api/integrations/status', (_req, res) => {
    const integrations = app.locals.integrations;
    if (!integrations) return res.json({ enabled: false });
    res.json(integrations.status());
  });

  // POST /api/integrations/send — fan out a NormalizedMessage to one or
  // more chat platforms through the same allowlist + rate-limiter pipeline
  // the worca event fan-out uses. Drives the worca-notify skill.
  //
  // Body shape:
  //   {
  //     platforms?: string[],         // omit → all enabled chat adapters
  //     message: NormalizedMessage,   // { title, body: MessageSegment[], severity }
  //     chat_id?: string              // override the configured chat_id
  //   }
  //
  // Returns 200 with `{ results: [{ platform, ok, error? }] }` for both
  // total-success and partial-success cases; 4xx only for malformed input.
  //
  // Auth model: the endpoint is INTENTIONALLY restricted to loopback binds
  // (127.0.0.0/8, ::1, localhost). The CSRF middleware above lets through
  // requests with no Origin header (so webhooks work); without this guard,
  // a UI server started with HOST=0.0.0.0 or --host <public-ip> would expose
  // unauthenticated send-to-user's-chat to anything that can reach the port.
  // 503 (subsystem disabled) and 403 (non-loopback bind) are terminal —
  // retrying won't help.
  app.post('/api/integrations/send', async (req, res) => {
    if (!isLoopbackHost(serverHost)) {
      return res.status(403).json({
        error:
          'send endpoint is restricted to loopback binds; ' +
          'restart the UI server on 127.0.0.1 / ::1 / localhost ' +
          'to send notifications',
      });
    }
    const integrations = app.locals.integrations;
    if (!integrations) {
      return res
        .status(503)
        .json({ error: 'integrations subsystem not initialized' });
    }
    if (integrations.status?.().enabled === false) {
      return res
        .status(503)
        .json({ error: 'integrations subsystem disabled in config' });
    }
    const { platforms, message, chat_id: chatIdOverride } = req.body ?? {};
    if (!message || typeof message !== 'object') {
      return res
        .status(400)
        .json({ error: 'message is required and must be an object' });
    }
    if (platforms !== undefined && !Array.isArray(platforms)) {
      return res.status(400).json({ error: 'platforms must be an array' });
    }
    try {
      const out = await integrations.sendOutbound({
        platforms,
        message,
        chatIdOverride,
      });
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  // GET /api/integrations/config — return saved config (secrets redacted)
  app.get('/api/integrations/config', (_req, res) => {
    const configPath = join(prefsDir, 'integrations', 'config.json');
    let cfg;
    try {
      cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      return res.json({});
    }
    res.json(cfg);
  });

  // DELETE /api/integrations/config/:adapter — remove an adapter
  // PATCH /api/integrations/config/:adapter/enabled — toggle adapter on/off
  app.patch('/api/integrations/config/:adapter/enabled', async (req, res) => {
    const { adapter } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    const adapterKeys = ['telegram', 'discord', 'slack'];
    if (!adapterKeys.includes(adapter)) {
      return res.status(400).json({ error: `Invalid adapter: ${adapter}` });
    }
    const configPath = join(prefsDir, 'integrations', 'config.json');
    let cfg;
    try {
      cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      return res.status(404).json({ error: 'No integrations config' });
    }
    if (!cfg[adapter]) {
      return res
        .status(404)
        .json({ error: `Adapter ${adapter} not configured` });
    }
    cfg[adapter].enabled = enabled;
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);

    // Hot-reload: if disabling, remove the adapter; if enabling, reload it
    if (app.locals.ensureIntegrations) app.locals.ensureIntegrations();
    if (enabled) {
      if (app.locals.integrations?.reloadAdapter) {
        await app.locals.integrations.reloadAdapter(adapter);
      }
    } else {
      if (app.locals.integrations?.removeAdapter) {
        await app.locals.integrations.removeAdapter(adapter);
      }
    }
    res.json({ ok: true, enabled });
  });

  app.delete('/api/integrations/config/:adapter', async (req, res) => {
    const { adapter } = req.params;
    const adapterKeys = ['telegram', 'discord', 'slack'];
    if (!adapterKeys.includes(adapter)) {
      return res.status(400).json({ error: `Invalid adapter: ${adapter}` });
    }
    const configDir = join(prefsDir, 'integrations');
    const configPath = join(configDir, 'config.json');
    let cfg;
    try {
      cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      return res.json({ ok: true });
    }
    delete cfg[adapter];
    const hasAdapters = adapterKeys.some((k) => cfg[k]?.enabled);
    if (!hasAdapters) cfg.enabled = false;
    try {
      writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    } catch (err) {
      return res
        .status(500)
        .json({ error: `Failed to write config: ${err.message}` });
    }
    if (app.locals.integrations?.removeAdapter) {
      await app.locals.integrations.removeAdapter(adapter);
    }
    res.json({ ok: true });
  });

  // POST /api/integrations/config — save adapter config
  const ADAPTER_SCHEMA = {
    telegram: { tokenKey: 'bot_token', idKey: 'chat_id' },
    discord: { tokenKey: 'bot_token', idKey: 'channel_id' },
    slack: { tokenKey: 'webhook_url', idKey: 'chat_id' },
  };

  app.post('/api/integrations/config', async (req, res) => {
    const { adapter, token, chatId, events } = req.body;
    if (
      !adapter ||
      !token ||
      !chatId ||
      !Array.isArray(events) ||
      events.length === 0
    ) {
      return res.status(400).json({
        error: 'Missing required fields: adapter, token, chatId, events',
      });
    }
    const schema = ADAPTER_SCHEMA[adapter];
    if (!schema) {
      return res.status(400).json({
        error: `Invalid adapter: ${adapter}. Must be one of: ${Object.keys(ADAPTER_SCHEMA).join(', ')}`,
      });
    }

    const configDir = join(prefsDir, 'integrations');
    const configPath = join(configDir, 'config.json');

    // Load existing config or start fresh
    let cfg = { schema_version: 1, enabled: true };
    try {
      const raw = readFileSync(configPath, 'utf8');
      cfg = JSON.parse(raw);
    } catch {
      /* start fresh */
    }

    // Build adapter block — store token directly in config
    const adapterBlock = { enabled: true, events };
    adapterBlock[schema.tokenKey] = token;
    adapterBlock[schema.idKey] = chatId;

    cfg[adapter] = adapterBlock;
    cfg.enabled = true;
    if (!cfg.schema_version) cfg.schema_version = 1;

    const result = validateIntegrationsConfig(cfg);
    if (!result.valid) {
      return res
        .status(400)
        .json({ error: `Validation failed: ${result.details.join('; ')}` });
    }

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    } catch (err) {
      return res
        .status(500)
        .json({ error: `Failed to write config: ${err.message}` });
    }

    // Hot-reload just this adapter (no full restart)
    if (app.locals.ensureIntegrations) app.locals.ensureIntegrations();
    if (app.locals.integrations?.reloadAdapter) {
      await app.locals.integrations.reloadAdapter(adapter);
    }

    res.json({ ok: true, path: configPath });
  });

  // ─── Graphify endpoints ──────────────────────────────────────────────
  if (!app.locals.graphifyStatus) {
    app.locals.graphifyStatus = createGraphifyStatus({});
  }

  // Resolve the graphify settings for a request. In single-project mode the
  // server's own projectRoot/settingsPath are used. In global mode there is no
  // fixed project, so the selected project is passed as ?project=<id> and we
  // resolve its root + settings.json from the registry — otherwise the endpoint
  // would be blind to every project and only ever see global settings.
  function readGraphifySettings(projectId) {
    const readJson = (p) => {
      if (!p) return {};
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch {
        return {};
      }
    };
    const globalSettingsPath = prefsDir
      ? join(prefsDir, 'settings.json')
      : settingsPath;

    let projectSettingsPath = settingsPath;
    let root = projectRoot || process.cwd();
    if (projectId && prefsDir) {
      const proj = readProjects(prefsDir).find((p) => p.name === projectId);
      if (proj) {
        projectSettingsPath =
          proj.worcaConfigPath ||
          proj.settingsPath ||
          join(proj.path, '.claude', 'settings.json');
        root = proj.path;
      }
    } else if (projectRoot) {
      const slug = basename(projectRoot)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
      const configPath = join(
        homedir(),
        '.worca',
        'projects',
        slug,
        'config.json',
      );
      projectSettingsPath = existsSync(configPath)
        ? configPath
        : settingsPath || join(projectRoot, '.claude', 'settings.json');
    }

    return {
      globalSettings: readJson(globalSettingsPath),
      projectSettings: readJson(projectSettingsPath),
      root,
    };
  }

  async function graphifyStatusPayload(projectId) {
    const { globalSettings, projectSettings, root } =
      readGraphifySettings(projectId);
    const result = await app.locals.graphifyStatus.getStatus({
      globalSettings,
      projectSettings,
      projectRoot: root,
    });
    return { ...result, building: Boolean(app.locals.graphifyBuilding) };
  }

  app.get('/api/graphify/status', async (req, res) => {
    try {
      res.json(await graphifyStatusPayload(req.query.project));
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/graphify/recheck', async (req, res) => {
    try {
      app.locals.graphifyStatus.invalidate();
      res.json(await graphifyStatusPayload(req.query.project));
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Build/refresh the current HEAD's cache snapshot (async, long-running).
  // The lock + .complete publish discipline lives in run_graphify_preflight,
  // so we drive it via a detached Python process and track a `building` flag
  // the UI polls through /api/graphify/status.
  app.post('/api/graphify/build', async (req, res) => {
    try {
      const { globalSettings, projectSettings, root } = readGraphifySettings(
        req.query.project,
      );
      const effective = _effectiveConfig(globalSettings, projectSettings);
      if (!effective.enabled) {
        return res
          .status(400)
          .json({ ok: false, error: 'Graphify is not enabled' });
      }
      const detection = await app.locals.graphifyStatus.detect();
      if (!detection.installed || !detection.compatible) {
        return res.status(400).json({
          ok: false,
          error:
            detection.error || 'Graphify is not installed or not compatible',
        });
      }
      if (app.locals.graphifyBuilding) {
        return res.json({ ok: true, status: 'building' });
      }
      // Fresh build for the current HEAD: clear its snapshot first.
      const snap = snapshotDir(root);
      if (snap) {
        try {
          rmSync(snap, { recursive: true, force: true });
        } catch {}
      }
      app.locals.graphifyBuilding = true;
      const child = spawn(
        'python3',
        [
          '-c',
          'from worca.scripts.graphify_preflight import run_graphify_preflight as r; r()',
        ],
        { cwd: root, stdio: 'ignore' },
      );
      const done = () => {
        app.locals.graphifyBuilding = false;
        app.locals.graphifyStatus.invalidate();
      };
      child.on('exit', done);
      child.on('error', done);
      res.json({ ok: true, status: 'building' });
    } catch (err) {
      app.locals.graphifyBuilding = false;
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Clear ALL cached snapshots for this project's repo.
  app.post('/api/graphify/clear', async (req, res) => {
    try {
      const { root } = readGraphifySettings(req.query.project);
      const cleared = clearRepoCache(root);
      app.locals.graphifyStatus.invalidate();
      res.json({ ok: true, cleared });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/graphify/graph.html', (req, res) => {
    const { root } = readGraphifySettings(req.query.project);
    const snap = snapshotDir(root);
    const htmlPath = snap ? join(snap, 'graphify', 'graph.html') : null;
    if (!htmlPath || !existsSync(htmlPath)) {
      return res.status(404).json({ ok: false, error: 'graph.html not found' });
    }
    res.sendFile(htmlPath);
  });

  // ─── CRG (code-review-graph) endpoints ─────────────────────────────────
  if (!app.locals.crgStatus) {
    app.locals.crgStatus = createCrgStatus({});
  }

  function readCrgSettings(projectId) {
    const readJson = (p) => {
      if (!p) return {};
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch {
        return {};
      }
    };
    const globalSettingsPath = prefsDir
      ? join(prefsDir, 'settings.json')
      : settingsPath;

    let projectSettingsPath = settingsPath;
    let root = projectRoot || process.cwd();
    if (projectId && prefsDir) {
      const proj = readProjects(prefsDir).find((p) => p.name === projectId);
      if (proj) {
        projectSettingsPath =
          proj.worcaConfigPath ||
          proj.settingsPath ||
          join(proj.path, '.claude', 'settings.json');
        root = proj.path;
      }
    } else if (projectRoot) {
      const slug = basename(projectRoot)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
      const configPath = join(
        homedir(),
        '.worca',
        'projects',
        slug,
        'config.json',
      );
      projectSettingsPath = existsSync(configPath)
        ? configPath
        : settingsPath || join(projectRoot, '.claude', 'settings.json');
    }

    return {
      globalSettings: readJson(globalSettingsPath),
      projectSettings: readJson(projectSettingsPath),
      root,
    };
  }

  async function crgStatusPayload(projectId) {
    const { globalSettings, projectSettings, root } =
      readCrgSettings(projectId);
    const result = await app.locals.crgStatus.getStatus({
      globalSettings,
      projectSettings,
      projectRoot: root,
    });
    return { ...result, building: Boolean(app.locals.crgBuilding) };
  }

  app.get('/api/crg/status', async (req, res) => {
    try {
      res.json(await crgStatusPayload(req.query.project));
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/crg/recheck', async (req, res) => {
    try {
      app.locals.crgStatus.invalidate();
      res.json(await crgStatusPayload(req.query.project));
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/crg/build', async (req, res) => {
    try {
      const { globalSettings, projectSettings, root } = readCrgSettings(
        req.query.project,
      );
      const effective = _effectiveCrgConfig(globalSettings, projectSettings);
      if (!effective.enabled) {
        return res
          .status(400)
          .json({ ok: false, error: 'Code-review-graph is not enabled' });
      }
      const detection = await app.locals.crgStatus.detect();
      if (
        !detection.installed ||
        !detection.compatible ||
        !detection.fastmcp_ok
      ) {
        return res.status(400).json({
          ok: false,
          error:
            detection.error ||
            'Code-review-graph is not installed or not compatible',
        });
      }
      if (app.locals.crgBuilding) {
        return res.json({ ok: true, status: 'building' });
      }
      const snap = snapshotDir(root);
      if (snap) {
        try {
          rmSync(snap, { recursive: true, force: true });
        } catch {}
      }
      app.locals.crgBuilding = true;
      const child = spawn(
        'python3',
        [
          '-c',
          'from worca.scripts.crg_preflight import run_crg_preflight as r; r()',
        ],
        { cwd: root, stdio: 'ignore' },
      );
      const done = () => {
        app.locals.crgBuilding = false;
        app.locals.crgStatus.invalidate();
      };
      child.on('exit', done);
      child.on('error', done);
      res.json({ ok: true, status: 'building' });
    } catch (err) {
      app.locals.crgBuilding = false;
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/crg/clear', async (req, res) => {
    try {
      const { root } = readCrgSettings(req.query.project);
      const cleared = clearRepoCache(root);
      app.locals.crgStatus.invalidate();
      res.json({ ok: true, cleared });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/crg/graph.html', (req, res) => {
    const { root } = readCrgSettings(req.query.project);
    const snap = snapshotDir(root);
    const htmlPath = snap
      ? join(snap, 'code-review-graph', 'graph.html')
      : null;
    if (!htmlPath || !existsSync(htmlPath)) {
      return res.status(404).json({ ok: false, error: 'graph.html not found' });
    }
    res.sendFile(htmlPath);
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
