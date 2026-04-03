import { describe, expect, it, vi } from 'vitest';
import { createArchiveActions } from './archive-actions.js';

function makeStore(runs = {}, archivedRuns = {}) {
  const state = { runs: { ...runs }, archivedRuns: { ...archivedRuns } };
  return {
    getState: () => state,
    getRunById: (id) => state.runs[id] ?? state.archivedRuns[id],
    setRun: vi.fn((id, data) => {
      if (data.archived) {
        delete state.runs[id];
        state.archivedRuns[id] = data;
      } else {
        delete state.archivedRuns[id];
        state.runs[id] = data;
      }
    }),
  };
}

function makeDeps(overrides = {}) {
  const store =
    overrides.store ||
    makeStore({ 'run-1': { id: 'run-1', pipeline_status: 'completed' } });
  return {
    showConfirm: vi.fn(),
    showActionError: vi.fn(),
    projectUrl: (path) => `/api/projects/p1${path}`,
    store,
    rerender: vi.fn(),
    fetchFn: vi.fn(),
    ...overrides,
  };
}

function mockFetchOk(data = { ok: true }) {
  return vi.fn().mockResolvedValue({ json: () => Promise.resolve(data) });
}

function mockFetchReject(msg = 'Network error') {
  return vi.fn().mockRejectedValue(new Error(msg));
}

// ─── archiveRun ───────────────────────────────────────────────────────

describe('archiveRun', () => {
  it('calls showConfirm with correct options', () => {
    const deps = makeDeps();
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-123');

    expect(deps.showConfirm).toHaveBeenCalledOnce();
    const [opts, rerenderArg] = deps.showConfirm.mock.calls[0];
    expect(opts.label).toBe('Archive Pipeline Run');
    expect(opts.message).toContain('hidden from the dashboard');
    expect(opts.confirmLabel).toBe('Archive');
    expect(opts.confirmVariant).toBe('danger');
    expect(typeof opts.onConfirm).toBe('function');
    expect(rerenderArg).toBe(deps.rerender);
  });

  it('onConfirm calls fetch with correct archive endpoint', async () => {
    const deps = makeDeps({ fetchFn: mockFetchOk() });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-456');

    const onConfirm = deps.showConfirm.mock.calls[0][0].onConfirm;
    await onConfirm();

    expect(deps.fetchFn).toHaveBeenCalledWith(
      '/api/projects/p1/runs/run-456/archive',
      { method: 'POST' },
    );
  });

  it('onConfirm updates store on success', async () => {
    const store = makeStore({
      'run-1': { id: 'run-1', pipeline_status: 'completed' },
    });
    const deps = makeDeps({ fetchFn: mockFetchOk(), store });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');
    await deps.showConfirm.mock.calls[0][0].onConfirm();

    expect(store.setRun).toHaveBeenCalledOnce();
    const [id, data] = store.setRun.mock.calls[0];
    expect(id).toBe('run-1');
    expect(data.archived).toBe(true);
    expect(data.archived_at).toBeDefined();
    expect(deps.showActionError).not.toHaveBeenCalled();
  });

  it('onConfirm shows error and does not update store when response has ok:false', async () => {
    const store = makeStore({ 'run-1': { id: 'run-1' } });
    const deps = makeDeps({
      fetchFn: mockFetchOk({ ok: false, error: 'Run locked' }),
      store,
    });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');
    await deps.showConfirm.mock.calls[0][0].onConfirm();

    expect(deps.showActionError).toHaveBeenCalledWith('Run locked');
    expect(store.setRun).not.toHaveBeenCalled();
  });

  it('onConfirm shows fallback error when response has ok:false without message', async () => {
    const deps = makeDeps({
      fetchFn: mockFetchOk({ ok: false }),
    });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');
    await deps.showConfirm.mock.calls[0][0].onConfirm();

    expect(deps.showActionError).toHaveBeenCalledWith('Failed to archive run');
  });

  it('onConfirm shows error on fetch exception', async () => {
    const store = makeStore({ 'run-1': { id: 'run-1' } });
    const deps = makeDeps({
      fetchFn: mockFetchReject('Connection refused'),
      store,
    });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');
    await deps.showConfirm.mock.calls[0][0].onConfirm();

    expect(deps.showActionError).toHaveBeenCalledWith('Connection refused');
    expect(store.setRun).not.toHaveBeenCalled();
  });

  it('onConfirm shows fallback error on exception without message', async () => {
    const deps = makeDeps({
      fetchFn: vi.fn().mockRejectedValue(null),
    });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');
    await deps.showConfirm.mock.calls[0][0].onConfirm();

    expect(deps.showActionError).toHaveBeenCalledWith('Failed to archive run');
  });

  it('does not call fetch before confirmation', () => {
    const deps = makeDeps({ fetchFn: mockFetchOk() });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');

    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});

// ─── unarchiveRun ─────────────────────────────────────────────────────

describe('unarchiveRun', () => {
  it('calls fetch with correct unarchive endpoint', async () => {
    const deps = makeDeps({ fetchFn: mockFetchOk() });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-789');

    expect(deps.fetchFn).toHaveBeenCalledWith(
      '/api/projects/p1/runs/run-789/unarchive',
      { method: 'POST' },
    );
  });

  it('does NOT show confirmation dialog', async () => {
    const deps = makeDeps({ fetchFn: mockFetchOk() });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(deps.showConfirm).not.toHaveBeenCalled();
  });

  it('updates store on success', async () => {
    const store = makeStore(
      {},
      {
        'run-1': {
          id: 'run-1',
          archived: true,
          archived_at: '2024-01-01',
          pipeline_status: 'completed',
        },
      },
    );
    const deps = makeDeps({ fetchFn: mockFetchOk(), store });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(store.setRun).toHaveBeenCalledOnce();
    const [id, data] = store.setRun.mock.calls[0];
    expect(id).toBe('run-1');
    expect(data.archived).toBeUndefined();
    expect(data.archived_at).toBeUndefined();
    expect(data.pipeline_status).toBe('completed');
    expect(deps.showActionError).not.toHaveBeenCalled();
  });

  it('shows error and does not update store when response has ok:false', async () => {
    const store = makeStore({}, { 'run-1': { id: 'run-1', archived: true } });
    const deps = makeDeps({
      fetchFn: mockFetchOk({ ok: false, error: 'Not found' }),
      store,
    });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(deps.showActionError).toHaveBeenCalledWith('Not found');
    expect(store.setRun).not.toHaveBeenCalled();
  });

  it('shows fallback error when response has ok:false without message', async () => {
    const deps = makeDeps({
      fetchFn: mockFetchOk({ ok: false }),
    });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(deps.showActionError).toHaveBeenCalledWith(
      'Failed to unarchive run',
    );
  });

  it('shows error on fetch exception', async () => {
    const store = makeStore({}, { 'run-1': { id: 'run-1', archived: true } });
    const deps = makeDeps({ fetchFn: mockFetchReject('Timeout'), store });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(deps.showActionError).toHaveBeenCalledWith('Timeout');
    expect(store.setRun).not.toHaveBeenCalled();
  });

  it('shows fallback error on exception without message', async () => {
    const deps = makeDeps({
      fetchFn: vi.fn().mockRejectedValue(undefined),
    });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(deps.showActionError).toHaveBeenCalledWith(
      'Failed to unarchive run',
    );
  });
});
