import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
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

function waitForWsEvent(ws, type, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for WS event "${type}"`)),
      timeoutMs
    );
    function onMessage(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
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

  beforeEach(async () => {
    worcaDir = join(
      tmpdir(),
      `worca-sr-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(worcaDir, { recursive: true });

    httpServer = createServer();
    attachWsServer(httpServer, {
      worcaDir,
      settingsPath: join(worcaDir, 'settings.json'),
      prefsPath: join(worcaDir, 'prefs.json'),
    });
    await new Promise(resolve => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterEach(async () => {
    await new Promise(resolve => httpServer.close(resolve));
    rmSync(worcaDir, { recursive: true, force: true });
  });

  it('broadcasts runs-list even when readSettings throws', async () => {
    const runId = `run-${Date.now()}`;
    const runDir = join(worcaDir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(worcaDir, 'active_run'), runId);

    // Allow watchers to establish
    await new Promise(resolve => setTimeout(resolve, 200));

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Write status.json to trigger scheduleRefresh
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({ run_id: runId, stages: { plan: { status: 'running' } } })
    );

    // runs-list must be broadcast even though readSettings throws
    const msg = await waitForWsEvent(ws, 'runs-list');
    expect(msg.payload.runs).toBeDefined();

    ws.close();
  });
});
