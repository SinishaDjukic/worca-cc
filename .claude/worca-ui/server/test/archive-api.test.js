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

vi.mock('../process-manager.js', () => {
  class ProcessManager {
    constructor(opts = {}) {
      this.worcaDir = opts.worcaDir;
      this.projectRoot = opts.projectRoot;
    }
    startPipeline(_opts) {
      return Promise.resolve({ pid: 12345 });
    }
    stopPipeline() {
      return vi.fn()();
    }
    pausePipeline(runId) {
      return vi.fn()(runId);
    }
    getRunningPid() {
      return null;
    }
    reconcileStatus() {
      return false;
    }
    restartStage() {
      return vi.fn()();
    }
  }
  return {
    ProcessManager,
    startPipeline: vi.fn().mockResolvedValue({ pid: 12345 }),
    stopPipeline: vi.fn(),
    restartStage: vi.fn(),
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

function writeStatus(worcaDir, runId, statusObj, dir = 'runs') {
  const runDir = join(worcaDir, dir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'status.json'),
    JSON.stringify(statusObj, null, 2),
    'utf8',
  );
}

// ─── POST /api/runs/:id/archive ──────────────────────────────────────────────

describe('POST /api/runs/:id/archive', () => {
  let tmpDir, server, base, app;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'archive-api-test-'));
    ({ server, base, app } = await startServer(tmpDir));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 501 when worcaDir not configured', async () => {
    const { server: s2, base: b2 } = await startServer(undefined);
    try {
      const res = await fetch(`${b2}/api/runs/run-123/archive`, {
        method: 'POST',
      });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.ok).toBe(false);
    } finally {
      await stopServer(s2);
    }
  });

  it('returns 400 for invalid runId', async () => {
    const res = await fetch(`${base}/api/runs/run%20with%20spaces/archive`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('Invalid runId');
  });

  it('returns 404 when run not found', async () => {
    const res = await fetch(`${base}/api/runs/nonexistent-run/archive`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('archives a run in runs/ directory', async () => {
    writeStatus(tmpDir, 'run-001', { pipeline_status: 'failed' });

    const res = await fetch(`${base}/api/runs/run-001/archive`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const status = JSON.parse(
      readFileSync(join(tmpDir, 'runs', 'run-001', 'status.json'), 'utf8'),
    );
    expect(status.archived).toBe(true);
    expect(status.archived_at).toBeDefined();
    // Verify ISO 8601 format
    expect(new Date(status.archived_at).toISOString()).toBe(status.archived_at);
    // Original fields preserved
    expect(status.pipeline_status).toBe('failed');
  });

  it('archives a run in results/ directory', async () => {
    writeStatus(tmpDir, 'run-002', { pipeline_status: 'completed' }, 'results');

    const res = await fetch(`${base}/api/runs/run-002/archive`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const status = JSON.parse(
      readFileSync(join(tmpDir, 'results', 'run-002', 'status.json'), 'utf8'),
    );
    expect(status.archived).toBe(true);
    expect(status.archived_at).toBeDefined();
  });

  it('is idempotent — re-archiving returns ok without changing archived_at', async () => {
    const earlyDate = '2026-01-01T00:00:00.000Z';
    writeStatus(tmpDir, 'run-003', {
      pipeline_status: 'failed',
      archived: true,
      archived_at: earlyDate,
    });

    const res = await fetch(`${base}/api/runs/run-003/archive`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const status = JSON.parse(
      readFileSync(join(tmpDir, 'runs', 'run-003', 'status.json'), 'utf8'),
    );
    // archived_at should NOT be updated (no-op)
    expect(status.archived_at).toBe(earlyDate);
  });

  it('broadcasts run-archived WS event', async () => {
    writeStatus(tmpDir, 'run-004', { pipeline_status: 'failed' });

    const broadcastSpy = vi.fn();
    app.locals.broadcast = broadcastSpy;

    await fetch(`${base}/api/runs/run-004/archive`, { method: 'POST' });

    expect(broadcastSpy).toHaveBeenCalledWith('run-archived', {
      runId: 'run-004',
    });
  });

  it('does not broadcast on idempotent no-op', async () => {
    writeStatus(tmpDir, 'run-005', {
      pipeline_status: 'failed',
      archived: true,
      archived_at: '2026-01-01T00:00:00.000Z',
    });

    const broadcastSpy = vi.fn();
    app.locals.broadcast = broadcastSpy;

    await fetch(`${base}/api/runs/run-005/archive`, { method: 'POST' });

    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});

// ─── POST /api/runs/:id/unarchive ────────────────────────────────────────────

describe('POST /api/runs/:id/unarchive', () => {
  let tmpDir, server, base, app;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'archive-api-test-'));
    ({ server, base, app } = await startServer(tmpDir));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 501 when worcaDir not configured', async () => {
    const { server: s2, base: b2 } = await startServer(undefined);
    try {
      const res = await fetch(`${b2}/api/runs/run-123/unarchive`, {
        method: 'POST',
      });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.ok).toBe(false);
    } finally {
      await stopServer(s2);
    }
  });

  it('returns 400 for invalid runId', async () => {
    const res = await fetch(`${base}/api/runs/run%20with%20spaces/unarchive`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('Invalid runId');
  });

  it('returns 404 when run not found', async () => {
    const res = await fetch(`${base}/api/runs/nonexistent-run/unarchive`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('unarchives a run — removes archived and archived_at fields', async () => {
    writeStatus(tmpDir, 'run-010', {
      pipeline_status: 'failed',
      archived: true,
      archived_at: '2026-01-01T00:00:00.000Z',
    });

    const res = await fetch(`${base}/api/runs/run-010/unarchive`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const status = JSON.parse(
      readFileSync(join(tmpDir, 'runs', 'run-010', 'status.json'), 'utf8'),
    );
    expect(status.archived).toBeUndefined();
    expect(status.archived_at).toBeUndefined();
    // Original fields preserved
    expect(status.pipeline_status).toBe('failed');
  });

  it('unarchives a run in results/ directory', async () => {
    writeStatus(
      tmpDir,
      'run-011',
      {
        pipeline_status: 'completed',
        archived: true,
        archived_at: '2026-01-01T00:00:00.000Z',
      },
      'results',
    );

    const res = await fetch(`${base}/api/runs/run-011/unarchive`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const status = JSON.parse(
      readFileSync(join(tmpDir, 'results', 'run-011', 'status.json'), 'utf8'),
    );
    expect(status.archived).toBeUndefined();
    expect(status.archived_at).toBeUndefined();
  });

  it('is idempotent — unarchiving a non-archived run returns ok', async () => {
    writeStatus(tmpDir, 'run-012', { pipeline_status: 'completed' });

    const res = await fetch(`${base}/api/runs/run-012/unarchive`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const status = JSON.parse(
      readFileSync(join(tmpDir, 'runs', 'run-012', 'status.json'), 'utf8'),
    );
    expect(status.archived).toBeUndefined();
  });

  it('broadcasts run-unarchived WS event', async () => {
    writeStatus(tmpDir, 'run-013', {
      pipeline_status: 'failed',
      archived: true,
      archived_at: '2026-01-01T00:00:00.000Z',
    });

    const broadcastSpy = vi.fn();
    app.locals.broadcast = broadcastSpy;

    await fetch(`${base}/api/runs/run-013/unarchive`, { method: 'POST' });

    expect(broadcastSpy).toHaveBeenCalledWith('run-unarchived', {
      runId: 'run-013',
    });
  });

  it('does not broadcast on idempotent no-op', async () => {
    writeStatus(tmpDir, 'run-014', { pipeline_status: 'completed' });

    const broadcastSpy = vi.fn();
    app.locals.broadcast = broadcastSpy;

    await fetch(`${base}/api/runs/run-014/unarchive`, { method: 'POST' });

    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});
