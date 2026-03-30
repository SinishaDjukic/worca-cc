import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetRunningPid = vi.fn().mockReturnValue(null);

vi.mock('../process-manager.js', () => {
  class ProcessManager {
    constructor(opts = {}) {
      this.worcaDir = opts.worcaDir;
      this.projectRoot = opts.projectRoot;
    }
    startPipeline(opts) { return Promise.resolve({ pid: 12345 }); }
    stopPipeline() { return vi.fn()(); }
    pausePipeline(runId) { return vi.fn()(runId); }
    getRunningPid() { return mockGetRunningPid(this.worcaDir); }
    reconcileStatus() { return false; }
    restartStage() { return vi.fn()(); }
  }
  return {
    ProcessManager,
    startPipeline: vi.fn().mockResolvedValue({ pid: 12345 }),
    stopPipeline: vi.fn(),
    restartStage: vi.fn(),
    getRunningPid: (...args) => mockGetRunningPid(...args),
  };
});

const { createApp } = await import('../app.js');

function startServer(worcaDir, opts = {}) {
  const app = createApp({ worcaDir, ...opts });
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      resolve({ server, base, app });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function postLearn(base, runId) {
  return fetch(`${base}/api/runs/${runId}/learn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/runs/:id/learn', () => {
  let tmpDir, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'learn-api-test-'));
    mockGetRunningPid.mockReturnValue(null);
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 501 when worcaDir not configured', async () => {
    ({ server, base } = await startServer(undefined));
    const res = await postLearn(base, 'run-123');
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/worcaDir/i);
  });

  it('returns 404 when run status.json does not exist', async () => {
    ({ server, base } = await startServer(tmpDir));
    const res = await postLearn(base, 'nonexistent-run');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/not found/i);
  });

  it('returns 409 when pipeline is currently running', async () => {
    const runDir = join(tmpDir, 'runs', 'run-123');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: 'run-123',
        result: 'success',
        stages: {},
      }),
    );

    mockGetRunningPid.mockReturnValue({ pid: 99999 });

    ({ server, base } = await startServer(tmpDir));
    const res = await postLearn(base, 'run-123');
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/running/i);
  });

  it('returns 200 and spawns learn script for valid run', async () => {
    const runDir = join(tmpDir, 'runs', 'my-run');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: 'my-run',
        result: 'success',
        stages: {},
      }),
    );

    ({ server, base } = await startServer(tmpDir, { projectRoot: tmpDir }));
    const res = await postLearn(base, 'my-run');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pid).toBeDefined();
  });

  it('returns 200 for a failed run too', async () => {
    const runDir = join(tmpDir, 'runs', 'failed-run');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: 'failed-run',
        result: 'failure',
        error: 'Tests failed',
        stages: {},
      }),
    );

    ({ server, base } = await startServer(tmpDir, { projectRoot: tmpDir }));
    const res = await postLearn(base, 'failed-run');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('writes in_progress status to status.json before responding', async () => {
    const runDir = join(tmpDir, 'runs', 'status-write-run');
    mkdirSync(runDir, { recursive: true });
    const statusPath = join(runDir, 'status.json');
    writeFileSync(
      statusPath,
      JSON.stringify({
        run_id: 'status-write-run',
        result: 'success',
        stages: {},
      }),
    );

    ({ server, base } = await startServer(tmpDir, { projectRoot: tmpDir }));
    const res = await postLearn(base, 'status-write-run');
    expect(res.status).toBe(200);

    // Read back status.json to verify in_progress was written
    const updated = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(updated.stages.learn).toBeDefined();
    expect(updated.stages.learn.status).toBe('in_progress');
    expect(updated.stages.learn.pid).toBeDefined();
    expect(updated.stages.learn.started_at).toBeDefined();
    expect(updated.stages.learn.iterations).toHaveLength(1);
    expect(updated.stages.learn.iterations[0].status).toBe('in_progress');
    expect(updated.stages.learn.iterations[0].trigger).toBe('manual');
  });

  it('returns 409 when learn stage has a live in_progress PID', async () => {
    const runDir = join(tmpDir, 'runs', 'concurrent-run');
    mkdirSync(runDir, { recursive: true });
    // Use current process PID (which is alive) to simulate a running learn stage
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: 'concurrent-run',
        result: 'success',
        stages: {
          learn: {
            status: 'in_progress',
            pid: process.pid, // current process — guaranteed alive
            started_at: new Date().toISOString(),
          },
        },
      }),
    );

    ({ server, base } = await startServer(tmpDir, { projectRoot: tmpDir }));
    const res = await postLearn(base, 'concurrent-run');
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/already running/i);
  });

  it('allows re-run when learn stage has stale (dead) PID', async () => {
    const runDir = join(tmpDir, 'runs', 'stale-run');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: 'stale-run',
        result: 'success',
        stages: {
          learn: {
            status: 'in_progress',
            pid: 999999999, // very unlikely to be a real PID
            started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          },
        },
      }),
    );

    ({ server, base } = await startServer(tmpDir, { projectRoot: tmpDir }));
    const res = await postLearn(base, 'stale-run');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
