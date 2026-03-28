/**
 * Tests for log subscription runId filtering in broadcastToLogSubscribers.
 *
 * These tests verify that log-line messages are only sent to clients
 * subscribed to the matching run, preventing cross-run bleed.
 */

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachWsServer } from '../ws.js';

function makeTmpDir() {
  const d = join(
    tmpdir(),
    `worca-ws-log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(d, { recursive: true });
  return d;
}

function setupWorcaDir(tmpDir, runId) {
  const runDir = join(tmpDir, 'runs', runId);
  mkdirSync(join(runDir, 'logs'), { recursive: true });
  writeFileSync(join(tmpDir, 'active_run'), runId, 'utf8');
  writeFileSync(
    join(runDir, 'status.json'),
    `${JSON.stringify(
      {
        pipeline_status: 'running',
        stage: 'plan',
        run_id: runId,
        stages: { plan: { status: 'in_progress' } },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return runDir;
}

function startServer(worcaDir) {
  return new Promise((resolve) => {
    const server = createServer();
    const { wss } = attachWsServer(server, {
      worcaDir,
      projectRoot: worcaDir,
      beadsDbPath: join(worcaDir, 'beads.db'),
      settingsPath: join(worcaDir, 'settings.json'),
      prefsPath: join(worcaDir, 'prefs.json'),
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, wss, port });
    });
  });
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendReq(ws, type, payload = {}) {
  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ws.send(JSON.stringify({ id, type, payload }));
  return id;
}

/**
 * Wait for a log-line WS message. Resolves immediately on first match.
 */
function waitForLogLine(ws, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('Timed out waiting for log-line'));
    }, timeoutMs);
    function handler(data) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'log-line') {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch {
        /* ignore */
      }
    }
    ws.on('message', handler);
  });
}

/**
 * Collect all messages over a fixed window. Used for negative tests
 * (asserting that no log-line messages arrive).
 */
function collectMessages(ws, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const msgs = [];
    const handler = (data) => {
      try {
        msgs.push(JSON.parse(data.toString()));
      } catch {
        /* ignore */
      }
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(msgs);
    }, timeoutMs);
  });
}

describe('log subscription runId filtering', () => {
  let tmpDir, server, wss, port;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    setupWorcaDir(tmpDir, 'run-A');
    ({ server, wss, port } = await startServer(tmpDir));
  });

  afterEach(async () => {
    await new Promise((resolve) => {
      for (const client of wss.clients) client.terminate();
      server.close(resolve);
    });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    'sends log-line to client subscribed to same run',
    async () => {
      const ws = await connectWs(port);

      // Create log file first so watcher can be set up
      const logDir = join(tmpDir, 'runs', 'run-A', 'logs', 'plan');
      mkdirSync(logDir, { recursive: true });
      writeFileSync(join(logDir, 'iter-1.log'), 'initial line\n', 'utf8');

      sendReq(ws, 'subscribe-log', { stage: 'plan', runId: 'run-A' });
      await new Promise((r) => setTimeout(r, 500));

      // Start listening BEFORE writing so we don't miss the event
      const logLinePromise = waitForLogLine(ws, 10000);
      appendFileSync(
        join(logDir, 'iter-1.log'),
        'new line from run-A\n',
        'utf8',
      );

      const msg = await logLinePromise;
      expect(msg.payload.line).toContain('new line from run-A');
      ws.close();
    },
    15000,
  );

  it(
    'skips log-line for client subscribed to different run',
    async () => {
      const ws = await connectWs(port);

      // Create log file
      const logDir = join(tmpDir, 'runs', 'run-A', 'logs', 'plan');
      mkdirSync(logDir, { recursive: true });
      writeFileSync(join(logDir, 'iter-1.log'), 'initial\n', 'utf8');

      // ws2 subscribes to run-A (creates file watchers)
      const ws2 = await connectWs(port);
      sendReq(ws2, 'subscribe-log', { stage: 'plan', runId: 'run-A' });
      await new Promise((r) => setTimeout(r, 500));

      // ws subscribes to run-B (different run)
      sendReq(ws, 'subscribe-log', { stage: 'plan', runId: 'run-B' });
      await new Promise((r) => setTimeout(r, 200));

      const collecting = collectMessages(ws, 2000);
      appendFileSync(
        join(logDir, 'iter-1.log'),
        'line for run-A only\n',
        'utf8',
      );
      const msgs = await collecting;

      const logLines = msgs.filter((m) => m.type === 'log-line');
      expect(logLines.length).toBe(0);
      ws.close();
      ws2.close();
    },
    10000,
  );

  it(
    'sends log-line when logRunId is null (no run filter)',
    async () => {
      const ws = await connectWs(port);

      const logDir = join(tmpDir, 'runs', 'run-A', 'logs', 'plan');
      mkdirSync(logDir, { recursive: true });
      writeFileSync(join(logDir, 'iter-1.log'), 'initial\n', 'utf8');

      // Subscribe without runId — should receive all log-lines
      sendReq(ws, 'subscribe-log', { stage: 'plan' });
      await new Promise((r) => setTimeout(r, 500));

      // Start listening BEFORE writing so we don't miss the event
      const logLinePromise = waitForLogLine(ws, 10000);
      appendFileSync(
        join(logDir, 'iter-1.log'),
        'line for any subscriber\n',
        'utf8',
      );

      const msg = await logLinePromise;
      expect(msg.payload.line).toContain('line for any subscriber');
      ws.close();
    },
    15000,
  );

  it(
    'unsubscribe clears logRunId — no log-lines received',
    async () => {
      const ws = await connectWs(port);

      const logDir = join(tmpDir, 'runs', 'run-A', 'logs', 'plan');
      mkdirSync(logDir, { recursive: true });
      writeFileSync(join(logDir, 'iter-1.log'), 'initial\n', 'utf8');

      sendReq(ws, 'subscribe-log', { stage: 'plan', runId: 'run-A' });
      await new Promise((r) => setTimeout(r, 300));

      sendReq(ws, 'unsubscribe-log');
      await new Promise((r) => setTimeout(r, 200));

      const collecting = collectMessages(ws, 2000);
      appendFileSync(
        join(logDir, 'iter-1.log'),
        'should not receive\n',
        'utf8',
      );
      const msgs = await collecting;

      const logLines = msgs.filter((m) => m.type === 'log-line');
      expect(logLines.length).toBe(0);
      ws.close();
    },
    10000,
  );
});
