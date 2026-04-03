import { describe, expect, it, vi } from 'vitest';
import { createArchiveActions } from './archive-actions.js';

function makeDeps(overrides = {}) {
  return {
    showConfirm: vi.fn(),
    showActionError: vi.fn(),
    projectUrl: (path) => `/api/projects/p1${path}`,
    fetchAndUpdateRuns: vi.fn().mockResolvedValue(undefined),
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

  it('onConfirm calls fetchAndUpdateRuns on success', async () => {
    const deps = makeDeps({ fetchFn: mockFetchOk() });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');
    await deps.showConfirm.mock.calls[0][0].onConfirm();

    expect(deps.fetchAndUpdateRuns).toHaveBeenCalledOnce();
    expect(deps.showActionError).not.toHaveBeenCalled();
  });

  it('onConfirm shows error when response has ok:false', async () => {
    const deps = makeDeps({
      fetchFn: mockFetchOk({ ok: false, error: 'Run locked' }),
    });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');
    await deps.showConfirm.mock.calls[0][0].onConfirm();

    expect(deps.showActionError).toHaveBeenCalledWith('Run locked');
    expect(deps.fetchAndUpdateRuns).toHaveBeenCalledOnce();
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
    const deps = makeDeps({ fetchFn: mockFetchReject('Connection refused') });
    const { archiveRun } = createArchiveActions(deps);

    archiveRun('run-1');
    await deps.showConfirm.mock.calls[0][0].onConfirm();

    expect(deps.showActionError).toHaveBeenCalledWith('Connection refused');
    expect(deps.fetchAndUpdateRuns).not.toHaveBeenCalled();
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

  it('calls fetchAndUpdateRuns on success', async () => {
    const deps = makeDeps({ fetchFn: mockFetchOk() });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(deps.fetchAndUpdateRuns).toHaveBeenCalledOnce();
    expect(deps.showActionError).not.toHaveBeenCalled();
  });

  it('shows error when response has ok:false', async () => {
    const deps = makeDeps({
      fetchFn: mockFetchOk({ ok: false, error: 'Not found' }),
    });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(deps.showActionError).toHaveBeenCalledWith('Not found');
    expect(deps.fetchAndUpdateRuns).toHaveBeenCalledOnce();
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
    const deps = makeDeps({ fetchFn: mockFetchReject('Timeout') });
    const { unarchiveRun } = createArchiveActions(deps);

    await unarchiveRun('run-1');

    expect(deps.showActionError).toHaveBeenCalledWith('Timeout');
    expect(deps.fetchAndUpdateRuns).not.toHaveBeenCalled();
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
