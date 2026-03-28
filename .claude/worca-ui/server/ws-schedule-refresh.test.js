import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

// Mock settings-reader so readSettings throws — simulating a missing / corrupt file.
// Before the fix, this exception propagates out of the shared try-catch in
// scheduleRefresh and silently aborts the broadcast('runs-list', ...) call.
vi.mock('./settings-reader.js', () => ({
  readSettings: vi.fn().mockImplementation(() => {
    throw new Error('simulated settings read failure');
  }),
}));

import { attachWsServer } from './ws.js';

function waitForWsEvent(ws, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for WS event "${type}"`)),
      timeoutMs,
    );
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

describe('scheduleRefresh – readSettings isolation', () => {
  let worcaDir;
  let httpServer;
  let port;
  let wsServer; // return value from attachWsServer

  beforeEach(async () => {
    worcaDir = join(
      tmpdir(),
      `worca-sr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(worcaDir, { recursive: true });

    httpServer = createServer();
    wsServer = attachWsServer(httpServer, {
      worcaDir,
      settingsPath: join(worcaDir, 'settings.json'),
      prefsPath: join(worcaDir, 'prefs.json'),
    });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterEach(async () => {
    httpServer.closeAllConnections?.();
    await new Promise((resolve) => httpServer.close(resolve));
    rmSync(worcaDir, { recursive: true, force: true });
  });

  it('broadcasts runs-list even when readSettings throws', async () => {
    const runId = `run-${Date.now()}`;
    const runDir = join(worcaDir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: runId,
        stages: { plan: { status: 'running' } },
      }),
    );

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Directly trigger scheduleRefresh instead of relying on fs.watch timing.
    // This test validates that scheduleRefresh handles readSettings errors
    // gracefully — it should NOT test fs.watch event delivery.
    wsServer.scheduleRefresh();

    // runs-list must be broadcast even though readSettings throws
    const msg = await waitForWsEvent(ws, 'runs-list');
    expect(msg.payload.runs).toBeDefined();

    ws.close();
  });
});
