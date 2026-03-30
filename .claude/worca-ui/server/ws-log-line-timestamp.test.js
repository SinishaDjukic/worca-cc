import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachWsServer } from './ws.js';

function waitForWsEvent(ws, type, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for WS event "${type}"`));
    }, timeoutMs);
    function onMessage(data) {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

describe('log-line events include server-side timestamp', () => {
  let worcaDir;
  let httpServer;
  let port;

  beforeEach(async () => {
    worcaDir = join(
      tmpdir(),
      `worca-ts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const runId = 'test-run';
    const runDir = join(worcaDir, 'runs', runId);
    const logsDir = join(runDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(worcaDir, 'active_run'), runId);
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({ run_id: runId, stages: {} }),
    );
    writeFileSync(join(logsDir, 'orchestrator.log'), '');

    httpServer = createServer();
    attachWsServer(httpServer, {
      worcaDir,
      settingsPath: join(worcaDir, 'settings.json'),
      prefsPath: join(worcaDir, 'prefs.json'),
    });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    rmSync(worcaDir, { recursive: true, force: true });
  });

  it(
    'log-line payload contains an ISO 8601 timestamp',
    async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      ws.send(
        JSON.stringify({
          id: 'sub-1',
          type: 'subscribe-log',
          payload: { stage: null },
        }),
      );
      await waitForWsEvent(ws, 'subscribe-log');

      // Give fs.watch time to initialize
      await new Promise((r) => setTimeout(r, 500));

      // Start listening BEFORE writing so we don't miss the event
      const logLinePromise = waitForWsEvent(ws, 'log-line', 10000);

      const logsDir = join(worcaDir, 'runs', 'test-run', 'logs');
      appendFileSync(join(logsDir, 'orchestrator.log'), 'hello from test\n');

      const msg = await logLinePromise;
      expect(msg.payload).toBeDefined();
      expect(msg.payload.line).toBe('hello from test');
      expect(msg.payload.timestamp).toBeDefined();
      expect(typeof msg.payload.timestamp).toBe('string');
      const parsed = new Date(msg.payload.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
      expect(Math.abs(Date.now() - parsed.getTime())).toBeLessThan(5000);

      ws.close();
    },
    15000,
  );
});
