import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiWatcher } from './multi-watcher.js';

function tmpDir() {
  const d = join(tmpdir(), `mw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeDeps(overrides = {}) {
  return {
    broadcaster: { broadcast: vi.fn() },
    getSubs: vi.fn(() => ({})),
    wss: { clients: new Set() },
    settingsPath: '/fake/settings.json',
    projectRoot: '/fake/project',
    webhookInbox: { events: [] },
    ...overrides,
  };
}

function writePipeline(worcaDir, runId, entry) {
  const dir = join(worcaDir, 'multi', 'pipelines.d');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${runId}.json`), JSON.stringify({ run_id: runId, ...entry }));
}

describe('MultiWatcher', () => {
  let worcaDir;

  beforeEach(() => {
    worcaDir = tmpDir();
  });

  afterEach(() => {
    rmSync(worcaDir, { recursive: true, force: true });
  });

  it('constructor initializes properties', () => {
    const deps = makeDeps();
    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    expect(mw.projectId).toBe('proj-1');
    expect(mw.worcaDir).toBe(worcaDir);
    expect(mw.pipelines.size).toBe(0);
  });

  it('listPipelines returns empty when no pipelines exist', async () => {
    const deps = makeDeps();
    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    // Don't start (no dir to watch) — just check initial state
    expect(mw.listPipelines()).toEqual([]);
  });

  it('_syncPipelines picks up pipeline files and broadcasts', async () => {
    const deps = makeDeps();
    writePipeline(worcaDir, 'run-a', { status: 'running', stage: 'plan', title: 'Alpha' });
    writePipeline(worcaDir, 'run-b', { status: 'completed', stage: 'test', title: 'Beta' });

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines();

    expect(mw.pipelines.size).toBe(2);
    expect(mw.listPipelines()).toHaveLength(2);

    const broadcasts = deps.broadcaster.broadcast.mock.calls;
    expect(broadcasts.length).toBe(2);
    expect(broadcasts[0][0]).toBe('pipeline-status-changed');
    const runIds = broadcasts.map((c) => c[1].runId).sort();
    expect(runIds).toEqual(['run-a', 'run-b']);
  });

  it('_syncPipelines detects status changes and re-broadcasts', async () => {
    const deps = makeDeps();
    writePipeline(worcaDir, 'run-a', { status: 'running', stage: 'plan' });

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines();
    expect(deps.broadcaster.broadcast).toHaveBeenCalledTimes(1);

    // Update status
    writePipeline(worcaDir, 'run-a', { status: 'completed', stage: 'test' });
    await mw._syncPipelines();
    expect(deps.broadcaster.broadcast).toHaveBeenCalledTimes(2);

    const lastCall = deps.broadcaster.broadcast.mock.calls[1];
    expect(lastCall[1].status).toBe('completed');
    expect(lastCall[1].stage).toBe('test');
  });

  it('_syncPipelines does not re-broadcast when nothing changes', async () => {
    const deps = makeDeps();
    writePipeline(worcaDir, 'run-a', { status: 'running', stage: 'plan' });

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines();
    expect(deps.broadcaster.broadcast).toHaveBeenCalledTimes(1);

    // Same data — no broadcast
    await mw._syncPipelines();
    expect(deps.broadcaster.broadcast).toHaveBeenCalledTimes(1);
  });

  it('_syncPipelines removes deleted pipelines and broadcasts removal', async () => {
    const deps = makeDeps();
    writePipeline(worcaDir, 'run-a', { status: 'running', stage: 'plan' });

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines();
    expect(mw.pipelines.size).toBe(1);

    // Delete the pipeline file
    rmSync(join(worcaDir, 'multi', 'pipelines.d', 'run-a.json'));
    await mw._syncPipelines();

    expect(mw.pipelines.size).toBe(0);
    const lastCall = deps.broadcaster.broadcast.mock.calls.at(-1);
    expect(lastCall[1].status).toBe('removed');
    expect(lastCall[1].runId).toBe('run-a');
  });

  it('_syncPipelines skips files without run_id', async () => {
    const deps = makeDeps();
    const dir = join(worcaDir, 'multi', 'pipelines.d');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ status: 'running' }));

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines();
    expect(mw.pipelines.size).toBe(0);
  });

  it('_syncPipelines handles malformed JSON gracefully', async () => {
    const deps = makeDeps();
    const dir = join(worcaDir, 'multi', 'pipelines.d');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'corrupt.json'), 'not-json{{{');

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines(); // Should not throw
    expect(mw.pipelines.size).toBe(0);
  });

  it('_syncPipelines handles empty pipelines.d directory', async () => {
    const deps = makeDeps();
    mkdirSync(join(worcaDir, 'multi', 'pipelines.d'), { recursive: true });

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines();
    expect(mw.pipelines.size).toBe(0);
    expect(deps.broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it('_syncPipelines handles nonexistent directory gracefully', async () => {
    const deps = makeDeps();
    // Don't create pipelines.d — it shouldn't exist
    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines(); // Should not throw
    expect(mw.pipelines.size).toBe(0);
  });

  it('getPipelineWatcherSet returns null for unknown pipeline', () => {
    const deps = makeDeps();
    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    expect(mw.getPipelineWatcherSet('nonexistent')).toBeNull();
  });

  it('promotePipeline and demotePipeline are no-ops for unknown pipelines', () => {
    const deps = makeDeps();
    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    // These should not throw
    mw.promotePipeline('nonexistent');
    mw.demotePipeline('nonexistent');
  });

  it('_broadcastPipelineStatus includes all expected fields', async () => {
    const deps = makeDeps();
    writePipeline(worcaDir, 'run-x', {
      status: 'running',
      stage: 'implement',
      title: 'My Pipeline',
      worktree_path: '/tmp/wt',
      started_at: '2024-01-01T00:00:00Z',
      pid: 12345,
    });

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines();

    const call = deps.broadcaster.broadcast.mock.calls[0];
    expect(call[0]).toBe('pipeline-status-changed');
    expect(call[1]).toMatchObject({
      project: 'proj-1',
      runId: 'run-x',
      status: 'running',
      stage: 'implement',
      title: 'My Pipeline',
      worktree_path: '/tmp/wt',
      started_at: '2024-01-01T00:00:00Z',
      pid: 12345,
    });
  });

  it('destroy is idempotent', async () => {
    const deps = makeDeps();
    writePipeline(worcaDir, 'run-a', { status: 'running', stage: 'plan' });

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    await mw._syncPipelines();

    mw.destroy();
    mw.destroy(); // second call should be no-op
    expect(mw.pipelines.size).toBe(0);
  });

  it('destroy clears debounce timer', () => {
    const deps = makeDeps();
    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    // Simulate a pending debounce timer
    mw._debounceTimer = setTimeout(() => {}, 999999);
    mw.destroy();
    expect(mw._debounceTimer).toBeNull();
  });

  it('start() calls _syncPipelines on init', async () => {
    const deps = makeDeps();
    writePipeline(worcaDir, 'run-a', { status: 'running', stage: 'plan' });

    const mw = new MultiWatcher('proj-1', worcaDir, deps);
    mw.start();

    // _syncPipelines is async; wait a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(mw.pipelines.size).toBe(1);
    mw.destroy();
  });
});
