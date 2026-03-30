import {
  existsSync,
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

const mockPausePipeline = vi
  .fn()
  .mockReturnValue({ runId: 'run-123', paused: true });
const mockStartPipeline = vi.fn().mockResolvedValue({ pid: 42000 });
const mockStopPipeline = vi.fn().mockReturnValue({ pid: 42000, stopped: true });
const mockGetRunningPid = vi.fn().mockReturnValue(null);
const mockReconcileStatus = vi.fn().mockReturnValue(false);

vi.mock('../process-manager.js', () => {
  class ProcessManager {
    constructor(opts = {}) {
      this.worcaDir = opts.worcaDir;
      this.projectRoot = opts.projectRoot;
    }
    pausePipeline(runId) { return mockPausePipeline(this.worcaDir, runId); }
    startPipeline(opts) { return mockStartPipeline(this.worcaDir, opts); }
    stopPipeline() { return mockStopPipeline(this.worcaDir); }
    getRunningPid() { return mockGetRunningPid(this.worcaDir); }
    reconcileStatus() { return mockReconcileStatus(this.worcaDir); }
    restartStage(stage, opts) { return vi.fn()(this.worcaDir, stage, opts); }
  }
  return {
    ProcessManager,
    pausePipeline: (...args) => mockPausePipeline(...args),
    startPipeline: (...args) => mockStartPipeline(...args),
    stopPipeline: (...args) => mockStopPipeline(...args),
    restartStage: vi.fn(),
    getRunningPid: (...args) => mockGetRunningPid(...args),
    reconcileStatus: (...args) => mockReconcileStatus(...args),
  };
});

const { createApp } = await import('../app.js');

function startServer(worcaDir, opts = {}) {
  const app = createApp({ worcaDir, ...opts });
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}`, app });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// ─── POST /api/runs/:id/pause ──────────────────────────────────────────────────

describe('POST /api/runs/:id/pause', () => {
  let tmpDir, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'run-controls-test-'));
    mockPausePipeline.mockClear();
    mockPausePipeline.mockReturnValue({ runId: 'run-abc', paused: true });
    ({ server, base } = await startServer(tmpDir));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 501 when worcaDir not configured', async () => {
    const { server: s2, base: b2 } = await startServer(undefined);
    try {
      const res = await fetch(`${b2}/api/runs/run-123/pause`, {
        method: 'POST',
      });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.ok).toBe(false);
    } finally {
      await stopServer(s2);
    }
  });

  it('returns 200 with ok, runId, paused', async () => {
    const res = await fetch(`${base}/api/runs/run-abc/pause`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.runId).toBe('run-abc');
    expect(data.paused).toBe(true);
  });

  it('calls pausePipeline with worcaDir and runId from URL', async () => {
    await fetch(`${base}/api/runs/run-xyz/pause`, { method: 'POST' });
    expect(mockPausePipeline).toHaveBeenCalledWith(tmpDir, 'run-xyz');
  });

  it('returns 500 when pausePipeline throws', async () => {
    mockPausePipeline.mockImplementation(() => {
      throw new Error('disk full');
    });
    const res = await fetch(`${base}/api/runs/run-abc/pause`, {
      method: 'POST',
    });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});

// ─── POST /api/runs/:id/resume ─────────────────────────────────────────────────

describe('POST /api/runs/:id/resume', () => {
  let tmpDir, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'run-controls-test-'));
    mockStartPipeline.mockClear();
    mockStartPipeline.mockResolvedValue({ pid: 42000 });
    ({ server, base } = await startServer(tmpDir));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 501 when worcaDir not configured', async () => {
    const { server: s2, base: b2 } = await startServer(undefined);
    try {
      const res = await fetch(`${b2}/api/runs/run-123/resume`, {
        method: 'POST',
      });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.ok).toBe(false);
    } finally {
      await stopServer(s2);
    }
  });

  it('returns 200 with ok, pid, runId', async () => {
    const res = await fetch(`${base}/api/runs/run-abc/resume`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pid).toBe(42000);
    expect(data.runId).toBe('run-abc');
  });

  it('calls startPipeline with resume:true and runId', async () => {
    await fetch(`${base}/api/runs/run-xyz/resume`, { method: 'POST' });
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({ resume: true, runId: 'run-xyz' }),
    );
  });

  it('returns 409 when pipeline already running', async () => {
    const err = new Error('Pipeline already running (PID 9999)');
    err.code = 'already_running';
    mockStartPipeline.mockRejectedValue(err);
    const res = await fetch(`${base}/api/runs/run-abc/resume`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('returns 500 on other startPipeline errors', async () => {
    mockStartPipeline.mockRejectedValue(new Error('spawn failed'));
    const res = await fetch(`${base}/api/runs/run-abc/resume`, {
      method: 'POST',
    });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});

// ─── POST /api/runs/:id/stop ───────────────────────────────────────────────────

describe('POST /api/runs/:id/stop', () => {
  let tmpDir, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'run-controls-test-'));
    mockStopPipeline.mockClear();
    mockStopPipeline.mockReturnValue({ pid: 42000, stopped: true });
    ({ server, base } = await startServer(tmpDir));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 501 when worcaDir not configured', async () => {
    const { server: s2, base: b2 } = await startServer(undefined);
    try {
      const res = await fetch(`${b2}/api/runs/run-123/stop`, {
        method: 'POST',
      });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.ok).toBe(false);
    } finally {
      await stopServer(s2);
    }
  });

  it('returns 200 with ok, stopped, runId, pid', async () => {
    const res = await fetch(`${base}/api/runs/run-abc/stop`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.stopped).toBe(true);
    expect(data.runId).toBe('run-abc');
    expect(data.pid).toBe(42000);
  });

  it('calls stopPipeline with worcaDir', async () => {
    await fetch(`${base}/api/runs/run-abc/stop`, { method: 'POST' });
    expect(mockStopPipeline).toHaveBeenCalledWith(tmpDir);
  });

  it('writes control.json with action=stop for the specific run', async () => {
    await fetch(`${base}/api/runs/run-abc/stop`, { method: 'POST' });
    const controlPath = join(tmpDir, 'runs', 'run-abc', 'control.json');
    expect(existsSync(controlPath)).toBe(true);
    const data = JSON.parse(readFileSync(controlPath, 'utf8'));
    expect(data.action).toBe('stop');
    expect(data.source).toBe('ui');
  });

  it('returns 404 when no running pipeline found', async () => {
    const err = new Error('No running pipeline found');
    err.code = 'not_running';
    mockStopPipeline.mockImplementation(() => {
      throw err;
    });
    const res = await fetch(`${base}/api/runs/run-abc/stop`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('returns 500 on other stopPipeline errors', async () => {
    mockStopPipeline.mockImplementation(() => {
      throw new Error('unexpected');
    });
    const res = await fetch(`${base}/api/runs/run-abc/stop`, {
      method: 'POST',
    });
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/runs/:id/status ──────────────────────────────────────────────────

describe('GET /api/runs/:id/status', () => {
  let tmpDir, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'run-controls-test-'));
    ({ server, base } = await startServer(tmpDir));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeStatus(runId, statusObj, dir = 'runs') {
    const runDir = join(tmpDir, dir, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify(statusObj, null, 2),
      'utf8',
    );
  }

  it('returns 501 when worcaDir not configured', async () => {
    const { server: s2, base: b2 } = await startServer(undefined);
    try {
      const res = await fetch(`${b2}/api/runs/run-123/status`);
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.ok).toBe(false);
    } finally {
      await stopServer(s2);
    }
  });

  it('returns 404 when run not found', async () => {
    const res = await fetch(`${base}/api/runs/nonexistent-run/status`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('returns pipeline_status, stage, iteration from runs/', async () => {
    writeStatus('run-001', {
      pipeline_status: 'running',
      stage: 'implement',
      stages: { implement: { status: 'in_progress', iteration: 3 } },
    });
    const res = await fetch(`${base}/api/runs/run-001/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pipeline_status).toBe('running');
    expect(data.stage).toBe('implement');
    expect(data.iteration).toBe(3);
  });

  it('falls back to results/ directory', async () => {
    writeStatus(
      'run-002',
      {
        pipeline_status: 'completed',
        stage: 'pr',
        stages: { pr: { status: 'completed', iteration: 1 } },
      },
      'results',
    );
    const res = await fetch(`${base}/api/runs/run-002/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pipeline_status).toBe('completed');
    expect(data.stage).toBe('pr');
    expect(data.iteration).toBe(1);
  });

  it('returns null iteration when stage has no iteration field', async () => {
    writeStatus('run-003', {
      pipeline_status: 'pending',
      stage: 'plan',
      stages: { plan: { status: 'pending' } },
    });
    const res = await fetch(`${base}/api/runs/run-003/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pipeline_status).toBe('pending');
    expect(data.iteration).toBeNull();
  });

  it('returns null iteration when stage is null', async () => {
    writeStatus('run-004', {
      pipeline_status: 'pending',
      stage: null,
      stages: {},
    });
    const res = await fetch(`${base}/api/runs/run-004/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stage).toBeNull();
    expect(data.iteration).toBeNull();
  });
});
