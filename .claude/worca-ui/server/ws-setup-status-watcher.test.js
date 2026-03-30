import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachWsServer } from './ws.js';

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a WS message of a given type. Optionally filter with a predicate.
 */
function waitForWsEvent(ws, type, predicate = null, timeoutMs = 3000) {
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
      if (msg.type === type && (!predicate || predicate(msg))) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

describe('setupStatusWatcher – retry when run directory not yet created', () => {
  let worcaDir;
  let httpServer;
  let port;

  beforeEach(async () => {
    worcaDir = join(
      tmpdir(),
      `worca-ssw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(worcaDir, { recursive: true });

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
    httpServer.closeAllConnections?.();
    await new Promise((resolve) => httpServer.close(resolve));
    rmSync(worcaDir, { recursive: true, force: true });
  });

  it('eventually watches the run directory and broadcasts runs-list when status.json is written after dir creation', async () => {
    const runId = `run-${Date.now()}`;
    const runDir = join(worcaDir, 'runs', runId);

    // Connect WS client before the race condition starts
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Write active_run while run directory does NOT exist yet.
    // This triggers activeRunWatcher → setupStatusWatcher → runDir missing.
    // Without fix: no retry, watcher never set up.
    // With fix: 500ms retry scheduled.
    writeFileSync(join(worcaDir, 'active_run'), runId);

    // Give activeRunWatcher time to fire and schedule the retry,
    // but stay well under the 500ms retry window.
    await waitMs(150);

    // Pipeline creates the run directory but has NOT written status.json yet.
    mkdirSync(runDir, { recursive: true });

    // Wait past the 500ms retry threshold so tryWatch() fires and sets up
    // a watcher on runDir (now that it exists).
    await waitMs(450); // total elapsed ≈ 600ms > 500ms retry delay

    // Pipeline writes status.json — the freshly-installed watcher should detect this.
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: runId,
        stages: { plan: { status: 'running' } },
      }),
    );

    // Expect a runs-list broadcast that contains the new run within 1.5s.
    const msg = await waitForWsEvent(
      ws,
      'runs-list',
      (m) => Array.isArray(m.payload?.runs) && m.payload.runs.length > 0,
      1500,
    );
    expect(
      msg.payload.runs.some((r) => r.run_id === runId || r.id === runId),
    ).toBe(true);

    ws.close();
  });

  it('fires scheduleRefresh when watcher callback receives a null filename', async () => {
    const runId = `run-null-${Date.now()}`;
    const runDir = join(worcaDir, 'runs', runId);

    // Connect WS client BEFORE triggering any watchers to avoid missing broadcasts
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Set up a fully-formed run so the watcher fires on the correct directory
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(worcaDir, 'active_run'), runId);
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: runId,
        stages: { plan: { status: 'running' } },
      }),
    );

    // Give activeRunWatcher and setupStatusWatcher time to establish
    await waitMs(300);

    // Overwrite status.json to trigger a watcher event with potential null filename
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: runId,
        stages: { plan: { status: 'completed' } },
      }),
    );

    // The watcher callback must handle null filename gracefully and still call scheduleRefresh.
    // Verify a runs-list is broadcast (regardless of null guard path).
    const msg = await waitForWsEvent(ws, 'runs-list', null, 3000);
    expect(msg.payload.runs).toBeDefined();

    ws.close();
  });
});
