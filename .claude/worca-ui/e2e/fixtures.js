/**
 * Playwright browser test fixtures for worca-ui.
 * Provides helpers for spinning up an isolated server instance,
 * seeding run state, and intercepting WebSocket messages.
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';
import { attachWsServer } from '../server/ws.js';
import { createInbox } from '../server/webhook-inbox.js';

/**
 * Start an isolated worca-ui server on a random port backed by a temp directory.
 *
 * @returns {Promise<{
 *   url: string,
 *   wsUrl: string,
 *   port: number,
 *   worcaDir: string,
 *   dir: string,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startServer() {
  const dir = join(tmpdir(), `worca-browser-${Date.now()}`);
  const worcaDir = join(dir, '.worca');
  mkdirSync(join(worcaDir, 'runs'), { recursive: true });
  mkdirSync(join(worcaDir, 'results'), { recursive: true });

  const settingsPath = join(dir, 'settings.json');
  const webhookInbox = createInbox();
  const app = createApp({ worcaDir, settingsPath, projectRoot: dir, webhookInbox });
  const server = createServer(app);

  const { wss, broadcast, scheduleRefresh } = attachWsServer(server, {
    worcaDir,
    settingsPath,
    prefsPath: join(dir, 'preferences.json'),
    webhookInbox,
  });

  app.locals.broadcast = broadcast;
  app.locals.scheduleRefresh = scheduleRefresh;

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    port,
    worcaDir,
    dir,
    close: () => {
      // Terminate all WebSocket clients (ws lib takes over sockets from the HTTP server
      // so closeAllConnections() doesn't reach them)
      for (const client of wss.clients) {
        try { client.terminate(); } catch { /* ignore */ }
      }
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve)).finally(() =>
        rmSync(dir, { recursive: true, force: true }),
      );
    },
  };
}

/**
 * Write a status.json for a run so that /api/runs includes it.
 *
 * @param {string} worcaDir - path to the .worca directory
 * @param {string} runId
 * @param {object} [statusOverrides] - fields merged on top of the default status
 * @returns {object} the written status object
 */
export function seedRun(worcaDir, runId, statusOverrides = {}) {
  const runDir = join(worcaDir, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const status = {
    run_id: runId,
    started_at: new Date().toISOString(),
    pipeline_status: 'running',
    stage: 'plan',
    work_request: { title: 'Test run' },
    stages: { plan: { status: 'in_progress' } },
    ...statusOverrides,
  };
  writeFileSync(join(runDir, 'status.json'), JSON.stringify(status, null, 2) + '\n', 'utf8');
  return status;
}

/**
 * Write a control.json for a run (simulates pause/stop/resume from UI or CLI).
 *
 * @param {string} worcaDir
 * @param {string} runId
 * @param {'pause'|'resume'|'stop'} action
 */
export function writeControlFile(worcaDir, runId, action) {
  const runDir = join(worcaDir, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'control.json'),
    JSON.stringify(
      { action, requested_at: new Date().toISOString(), source: 'test' },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

/**
 * Write pipeline.pid + active_run so that discoverRuns() sets `active: true`
 * for the specified run. Uses the current test process PID (which is alive).
 *
 * discoverRuns() only marks a run as active when:
 *  1. It's found via the `active_run` pointer (not the directory scan), AND
 *  2. pipeline.pid contains a live PID, AND
 *  3. The run is not terminal (no completed_at, stages not all done)
 *
 * @param {string} worcaDir
 * @param {string} [activeRunId] - run ID to write to active_run
 */
export function writePipelinePid(worcaDir, activeRunId) {
  writeFileSync(join(worcaDir, 'pipeline.pid'), String(process.pid), 'utf8');
  if (activeRunId) {
    writeFileSync(join(worcaDir, 'active_run'), activeRunId, 'utf8');
  }
}

/**
 * Wait for a WebSocket message of the given type to arrive on the page.
 * Must be called before the page action that triggers the message.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} eventType - the `type` field of the WS message to wait for
 * @param {number} [timeout=10000]
 * @returns {Promise<object>} the parsed message
 */
export function waitForWsMessage(page, eventType, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for WS message type: ${eventType}`));
    }, timeout);

    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        try {
          const msg = JSON.parse(payload);
          if (msg.type === eventType) {
            clearTimeout(timer);
            resolve(msg);
          }
        } catch {
          /* ignore non-JSON frames */
        }
      });
    });
  });
}
