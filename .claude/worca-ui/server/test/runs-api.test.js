import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStartPipeline = vi.fn().mockResolvedValue({ pid: 12345 });

vi.mock('../process-manager.js', () => {
  class ProcessManager {
    constructor(opts = {}) {
      this.worcaDir = opts.worcaDir;
      this.projectRoot = opts.projectRoot;
    }
    startPipeline(opts) { return mockStartPipeline(this.worcaDir, opts); }
    stopPipeline() { return vi.fn()(); }
    pausePipeline(runId) { return vi.fn()(runId); }
    getRunningPid() { return null; }
    reconcileStatus() { return false; }
    restartStage() { return vi.fn()(); }
  }
  return {
    ProcessManager,
    startPipeline: mockStartPipeline,
    stopPipeline: vi.fn(),
    restartStage: vi.fn(),
  };
});

const { createApp } = await import('../app.js');

function startServer(worcaDir) {
  const app = createApp({ worcaDir });
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      resolve({ server, base });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function postRun(base, body) {
  return fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/runs - new format', () => {
  let tmpDir, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'runs-api-test-'));
    mockStartPipeline.mockClear();
    mockStartPipeline.mockResolvedValue({ pid: 12345 });
    ({ server, base } = await startServer(tmpDir));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Acceptance: valid payloads ---

  it('accepts sourceType=source with sourceValue', async () => {
    const res = await postRun(base, {
      sourceType: 'source',
      sourceValue: 'gh:issue:42',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.pid).toBe(12345);
  });

  it('accepts sourceType=spec with sourceValue', async () => {
    const res = await postRun(base, {
      sourceType: 'spec',
      sourceValue: 'docs/spec.md',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('accepts sourceType=none with prompt', async () => {
    const res = await postRun(base, {
      sourceType: 'none',
      prompt: 'Add user auth',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('accepts prompt-only (no sourceType field)', async () => {
    const res = await postRun(base, { prompt: 'Add user auth' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('accepts planFile only', async () => {
    const res = await postRun(base, { planFile: 'docs/plans/my-plan.md' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('accepts source + prompt together', async () => {
    const res = await postRun(base, {
      sourceType: 'source',
      sourceValue: 'gh:issue:42',
      prompt: 'focus on auth',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('accepts planFile + prompt together', async () => {
    const res = await postRun(base, {
      planFile: 'docs/plans/my-plan.md',
      prompt: 'focus on auth',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // --- Rejection: invalid payloads ---

  it('rejects when no source, planFile, or prompt provided', async () => {
    const res = await postRun(base, { sourceType: 'none' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/at least one/i);
  });

  it('rejects empty body', async () => {
    const res = await postRun(base, {});
    expect(res.status).toBe(400);
  });

  it('rejects sourceType=source with missing sourceValue', async () => {
    const res = await postRun(base, { sourceType: 'source' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/sourceValue/i);
  });

  it('rejects sourceType=source with empty sourceValue', async () => {
    const res = await postRun(base, {
      sourceType: 'source',
      sourceValue: '  ',
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid sourceType', async () => {
    const res = await postRun(base, {
      sourceType: 'invalid',
      sourceValue: 'test',
    });
    expect(res.status).toBe(400);
  });

  it('rejects prompt longer than 50000 chars', async () => {
    const res = await postRun(base, { prompt: 'x'.repeat(50001) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/50,000/);
  });

  it('rejects sourceValue longer than 50000 chars', async () => {
    const res = await postRun(base, {
      sourceType: 'source',
      sourceValue: 'x'.repeat(50001),
    });
    expect(res.status).toBe(400);
  });

  it('rejects empty-string planFile', async () => {
    const res = await postRun(base, { planFile: '' });
    expect(res.status).toBe(400);
  });

  // --- Clamping ---

  it('clamps msize and mloops to valid range', async () => {
    await postRun(base, { prompt: 'test', msize: 20, mloops: -5 });
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({ msize: 10, mloops: 1 }),
    );
  });

  // --- Arguments passed to startPipeline ---

  it('passes new-format fields to startPipeline', async () => {
    await postRun(base, {
      sourceType: 'source',
      sourceValue: 'gh:issue:42',
      prompt: 'focus on auth',
      planFile: 'docs/plans/my-plan.md',
    });
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        sourceType: 'source',
        sourceValue: 'gh:issue:42',
        prompt: 'focus on auth',
        planFile: 'docs/plans/my-plan.md',
      }),
    );
  });

  it('does not pass sourceValue when sourceType is none', async () => {
    await postRun(base, { prompt: 'test' });
    const opts = mockStartPipeline.mock.calls[0][1];
    expect(opts.sourceValue).toBeUndefined();
  });

  it('trims prompt and sourceValue', async () => {
    await postRun(base, {
      sourceType: 'source',
      sourceValue: '  gh:issue:42  ',
      prompt: '  focus on auth  ',
    });
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        sourceValue: 'gh:issue:42',
        prompt: 'focus on auth',
      }),
    );
  });
});

describe('POST /api/runs - backwards compatibility', () => {
  let tmpDir, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'runs-api-test-'));
    mockStartPipeline.mockClear();
    mockStartPipeline.mockResolvedValue({ pid: 12345 });
    ({ server, base } = await startServer(tmpDir));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('normalizes old inputType=prompt to sourceType=none + prompt', async () => {
    const res = await postRun(base, {
      inputType: 'prompt',
      inputValue: 'Add user auth',
    });
    expect(res.status).toBe(200);
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        sourceType: 'none',
        prompt: 'Add user auth',
      }),
    );
  });

  it('normalizes old inputType=source to sourceType=source + sourceValue', async () => {
    const res = await postRun(base, {
      inputType: 'source',
      inputValue: 'gh:issue:42',
    });
    expect(res.status).toBe(200);
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        sourceType: 'source',
        sourceValue: 'gh:issue:42',
      }),
    );
  });

  it('normalizes old inputType=spec to sourceType=spec + sourceValue', async () => {
    const res = await postRun(base, {
      inputType: 'spec',
      inputValue: 'docs/spec.md',
    });
    expect(res.status).toBe(200);
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        sourceType: 'spec',
        sourceValue: 'docs/spec.md',
      }),
    );
  });

  it('preserves planFile from old format', async () => {
    const res = await postRun(base, {
      inputType: 'prompt',
      inputValue: 'test',
      planFile: 'docs/plans/p.md',
    });
    expect(res.status).toBe(200);
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({ planFile: 'docs/plans/p.md' }),
    );
  });

  it('preserves msize/mloops from old format', async () => {
    await postRun(base, {
      inputType: 'prompt',
      inputValue: 'test',
      msize: 3,
      mloops: 2,
    });
    expect(mockStartPipeline).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({ msize: 3, mloops: 2 }),
    );
  });
});
