/**
 * Tests for ws.js pipeline lifecycle: pause-run handler, pipeline-paused / pipeline-resumed broadcasts.
 * TDD: these tests are written first and should initially fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import WebSocket from 'ws';

const mockPausePipeline = vi.fn().mockReturnValue({ runId: 'run-123', paused: true });
const mockStopPipeline = vi.fn().mockReturnValue({ pid: 42000, stopped: true });
const mockStartPipeline = vi.fn().mockResolvedValue({ pid: 42000 });

vi.mock('./process-manager.js', () => ({
  pausePipeline: (...args) => mockPausePipeline(...args),
  stopPipeline: (...args) => mockStopPipeline(...args),
  startPipeline: (...args) => mockStartPipeline(...args),
  restartStage: vi.fn(),
  getRunningPid: vi.fn().mockReturnValue(null),
}));

const { attachWsServer } = await import('./ws.js');

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForWsEvent(ws, type, predicate = null, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for WS event "${type}"`)),
      timeoutMs
    );
    function onMessage(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === type && (!predicate || predicate(msg))) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

// ================================================================
// pause-run WS message handler
// ================================================================

describe('pause-run WS message', () => {
  let worcaDir, httpServer, port;

  beforeEach(async () => {
    worcaDir = join(tmpdir(), `worca-pl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(worcaDir, { recursive: true });
    httpServer = createServer();
    attachWsServer(httpServer, {
      worcaDir,
      settingsPath: join(worcaDir, 'settings.json'),
      prefsPath: join(worcaDir, 'prefs.json'),
    });
    await new Promise(resolve => httpServer.listen(0, resolve));
    port = httpServer.address().port;
    mockPausePipeline.mockClear();
    mockPausePipeline.mockReturnValue({ runId: 'run-123', paused: true });
  });

  afterEach(async () => {
    httpServer.closeAllConnections?.();
    await new Promise(resolve => httpServer.close(resolve));
    rmSync(worcaDir, { recursive: true, force: true });
  });

  async function connect() {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    return ws;
  }

  it('returns ok response with paused:true when pausePipeline succeeds', async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ id: 'req-pause', type: 'pause-run', payload: { runId: 'run-abc' } }));
    const msg = await waitForWsEvent(ws, 'pause-run', null, 2000);
    expect(msg.ok).toBe(true);
    expect(msg.payload.paused).toBe(true);
    ws.close();
  });

  it('calls pausePipeline with worcaDir and runId from payload', async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ id: 'req-pause2', type: 'pause-run', payload: { runId: 'run-xyz' } }));
    await waitForWsEvent(ws, 'pause-run', null, 2000);
    expect(mockPausePipeline).toHaveBeenCalledWith(worcaDir, 'run-xyz');
    ws.close();
  });

  it('returns error when runId is missing from payload', async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ id: 'req-pause3', type: 'pause-run', payload: {} }));
    const msg = await waitForWsEvent(ws, 'pause-run', null, 2000);
    expect(msg.ok).toBe(false);
    expect(msg.error.code).toBe('bad_request');
    ws.close();
  });

  it('returns error when pausePipeline throws', async () => {
    mockPausePipeline.mockImplementation(() => { throw new Error('disk full'); });
    const ws = await connect();
    ws.send(JSON.stringify({ id: 'req-pause4', type: 'pause-run', payload: { runId: 'run-abc' } }));
    const msg = await waitForWsEvent(ws, 'pause-run', null, 2000);
    expect(msg.ok).toBe(false);
    ws.close();
  });
});

// ================================================================
// pipeline-paused / pipeline-resumed broadcasts via status.json changes
// ================================================================

describe('pipeline-paused and pipeline-resumed broadcasts', () => {
  let worcaDir, httpServer, port, runId;

  // Each test gets its own server with active_run pre-created so the initial
  // setupStatusWatcher() call watches the correct run directory.
  async function setupServer(initialStatus) {
    worcaDir = join(tmpdir(), `worca-pbc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    runId = `run-${Date.now()}`;
    const runDir = join(worcaDir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    // Write status.json and active_run BEFORE creating the server so
    // setupStatusWatcher() watches the correct run dir from the start.
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({ run_id: runId, ...initialStatus, stages: {} }, null, 2),
      'utf8'
    );
    writeFileSync(join(worcaDir, 'active_run'), runId);

    httpServer = createServer();
    attachWsServer(httpServer, {
      worcaDir,
      settingsPath: join(worcaDir, 'settings.json'),
      prefsPath: join(worcaDir, 'prefs.json'),
    });
    await new Promise(resolve => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  }

  afterEach(async () => {
    httpServer.closeAllConnections?.();
    await new Promise(resolve => httpServer.close(resolve));
    rmSync(worcaDir, { recursive: true, force: true });
  });

  async function connect() {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    return ws;
  }

  it('broadcasts pipeline-paused to run subscribers when pipeline_status changes to paused', async () => {
    await setupServer({ pipeline_status: 'running' });

    const ws = await connect();
    ws.send(JSON.stringify({ id: 'sub-1', type: 'subscribe-run', payload: { runId } }));
    await waitForWsEvent(ws, 'subscribe-run', null, 1000);
    // subscribe-run handler seeds lastPipelineStatus('running') synchronously

    // Change pipeline_status to paused
    writeFileSync(
      join(worcaDir, 'runs', runId, 'status.json'),
      JSON.stringify({ run_id: runId, pipeline_status: 'paused', stages: {} }, null, 2),
      'utf8'
    );

    const msg = await waitForWsEvent(ws, 'pipeline-paused', null, 3000);
    expect(msg.payload.runId).toBe(runId);
    ws.close();
  });

  it('broadcasts pipeline-resumed to run subscribers when pipeline_status changes from paused to running', async () => {
    await setupServer({ pipeline_status: 'paused' });

    const ws = await connect();
    ws.send(JSON.stringify({ id: 'sub-2', type: 'subscribe-run', payload: { runId } }));
    await waitForWsEvent(ws, 'subscribe-run', null, 1000);
    // subscribe-run handler seeds lastPipelineStatus('paused') synchronously

    // Change pipeline_status to running (resume)
    writeFileSync(
      join(worcaDir, 'runs', runId, 'status.json'),
      JSON.stringify({ run_id: runId, pipeline_status: 'running', stages: {} }, null, 2),
      'utf8'
    );

    const msg = await waitForWsEvent(ws, 'pipeline-resumed', null, 3000);
    expect(msg.payload.runId).toBe(runId);
    ws.close();
  });

  it('does not broadcast pipeline-paused to clients not subscribed to that run', async () => {
    await setupServer({ pipeline_status: 'running' });
    const otherRunId = `run-other-${Date.now()}`;

    const ws1 = await connect(); // subscribes to runId
    const ws2 = await connect(); // subscribes to otherRunId (not runId)

    ws1.send(JSON.stringify({ id: 'sub-a', type: 'subscribe-run', payload: { runId } }));
    ws2.send(JSON.stringify({ id: 'sub-b', type: 'subscribe-run', payload: { runId: otherRunId } }));
    await Promise.all([
      waitForWsEvent(ws1, 'subscribe-run', null, 1000),
      waitForWsEvent(ws2, 'subscribe-run', null, 1000),
    ]);
    // subscribe-run handler seeds lastPipelineStatus('running') for ws1 synchronously

    const ws2PausedEvents = [];
    ws2.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'pipeline-paused') ws2PausedEvents.push(m);
    });

    // Change pipeline_status for runId only
    writeFileSync(
      join(worcaDir, 'runs', runId, 'status.json'),
      JSON.stringify({ run_id: runId, pipeline_status: 'paused', stages: {} }, null, 2),
      'utf8'
    );

    // ws1 should receive pipeline-paused
    await waitForWsEvent(ws1, 'pipeline-paused', null, 3000);

    await waitMs(300);
    // ws2 should NOT receive pipeline-paused
    expect(ws2PausedEvents).toHaveLength(0);

    ws1.close();
    ws2.close();
  });
});
