import { describe, expect, it, vi } from 'vitest';
import { createStore } from './state.js';

describe('state store', () => {
  it('initializes with defaults', () => {
    const store = createStore();
    const s = store.getState();
    expect(s.activeRunId).toBe(null);
    expect(s.projectName).toBe('');
    expect(s.runs).toEqual({});
    expect(s.logLines).toEqual([]);
    expect(s.preferences).toEqual({
      theme: 'light',
      sidebarCollapsed: false,
      notifications: null,
    });
  });

  it('accepts projectName initial override', () => {
    const store = createStore({ projectName: 'my-project' });
    expect(store.getState().projectName).toBe('my-project');
  });

  it('setState updates projectName and notifies subscribers', () => {
    const store = createStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setState({ projectName: 'new-project' });
    expect(store.getState().projectName).toBe('new-project');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('accepts initial overrides', () => {
    const store = createStore({
      preferences: { theme: 'dark', sidebarCollapsed: true },
    });
    expect(store.getState().preferences.theme).toBe('dark');
  });

  it('setState merges shallowly', () => {
    const store = createStore();
    store.setState({ activeRunId: 'run-1' });
    expect(store.getState().activeRunId).toBe('run-1');
    expect(store.getState().runs).toEqual({});
  });

  it('setState merges preferences deeply', () => {
    const store = createStore();
    store.setState({ preferences: { theme: 'dark' } });
    expect(store.getState().preferences.theme).toBe('dark');
    expect(store.getState().preferences.sidebarCollapsed).toBe(false);
  });

  it('notifies subscribers on change', () => {
    const store = createStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setState({ activeRunId: 'run-1' });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does not notify if state unchanged', () => {
    const store = createStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setState({ activeRunId: null });
    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribe stops notifications', () => {
    const store = createStore();
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    unsub();
    store.setState({ activeRunId: 'run-1' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('setRun adds/updates a run in the runs map', () => {
    const store = createStore();
    store.setRun('run-1', { stage: 'plan', stages: {} });
    expect(store.getState().runs['run-1'].stage).toBe('plan');
  });

  it('appendLog adds lines and caps at limit', () => {
    const store = createStore();
    for (let i = 0; i < 10; i++) {
      store.appendLog({ line: `line-${i}`, stage: 'plan' });
    }
    expect(store.getState().logLines.length).toBe(10);
  });

  it('clearLog empties logLines', () => {
    const store = createStore();
    store.appendLog({ line: 'hello', stage: 'plan' });
    store.clearLog();
    expect(store.getState().logLines).toEqual([]);
  });

  it('initializes with archivedRuns={}', () => {
    const store = createStore();
    expect(store.getState().archivedRuns).toEqual({});
  });

  it('accepts archivedRuns initial override', () => {
    const store = createStore({
      archivedRuns: { r1: { id: 'r1', archived: true } },
    });
    expect(store.getState().archivedRuns).toEqual({
      r1: { id: 'r1', archived: true },
    });
  });

  describe('setRunsBulk', () => {
    it('partitions archived and non-archived runs', () => {
      const store = createStore();
      store.setRunsBulk([
        { id: 'r1', stage: 'done' },
        { id: 'r2', archived: true, archived_at: new Date().toISOString() },
        { id: 'r3', stage: 'plan' },
      ]);
      const s = store.getState();
      expect(s.runs).toEqual({
        r1: { id: 'r1', stage: 'done' },
        r3: { id: 'r3', stage: 'plan' },
      });
      expect(s.archivedRuns).toEqual({
        r2: { id: 'r2', archived: true, archived_at: expect.any(String) },
      });
    });

    it('replaces both maps entirely', () => {
      const store = createStore({
        runs: { old: { id: 'old' } },
        archivedRuns: { oldArchived: { id: 'oldArchived', archived: true } },
      });
      store.setRunsBulk([{ id: 'new1', stage: 'test' }]);
      const s = store.getState();
      expect(s.runs).toEqual({ new1: { id: 'new1', stage: 'test' } });
      expect(s.archivedRuns).toEqual({});
    });

    it('clears both maps when given empty array', () => {
      const store = createStore({
        runs: { r1: { id: 'r1' } },
        archivedRuns: { r2: { id: 'r2', archived: true } },
      });
      store.setRunsBulk([]);
      const s = store.getState();
      expect(s.runs).toEqual({});
      expect(s.archivedRuns).toEqual({});
    });

    it('skips archived runs older than MAX_ARCHIVED_AGE_MS', () => {
      const store = createStore();
      const now = Date.now();
      const oldDate = new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
      store.setRunsBulk([
        { id: 'old', archived: true, archived_at: oldDate },
        { id: 'recent', archived: true, archived_at: recentDate },
        { id: 'active', stage: 'plan' },
      ]);
      const s = store.getState();
      expect(s.archivedRuns.old).toBeUndefined();
      expect(s.archivedRuns.recent).toBeDefined();
      expect(s.runs.active).toBeDefined();
    });

    it('includes archived runs without archived_at (no date to check)', () => {
      const store = createStore();
      store.setRunsBulk([{ id: 'nodate', archived: true }]);
      expect(store.getState().archivedRuns.nodate).toBeDefined();
    });

    it('notifies subscribers', () => {
      const store = createStore();
      const fn = vi.fn();
      store.subscribe(fn);
      store.setRunsBulk([{ id: 'r1' }]);
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe('setRun routing', () => {
    it('routes archived run to archivedRuns', () => {
      const store = createStore();
      store.setRun('r1', {
        id: 'r1',
        archived: true,
        archived_at: '2026-01-01T00:00:00Z',
      });
      expect(store.getState().archivedRuns.r1).toBeDefined();
      expect(store.getState().runs.r1).toBeUndefined();
    });

    it('routes non-archived run to runs', () => {
      const store = createStore();
      store.setRun('r1', { id: 'r1', stage: 'plan' });
      expect(store.getState().runs.r1).toBeDefined();
      expect(store.getState().archivedRuns.r1).toBeUndefined();
    });

    it('moves run from runs to archivedRuns when archived', () => {
      const store = createStore({ runs: { r1: { id: 'r1', stage: 'done' } } });
      store.setRun('r1', {
        id: 'r1',
        archived: true,
        archived_at: '2026-01-01T00:00:00Z',
      });
      expect(store.getState().runs.r1).toBeUndefined();
      expect(store.getState().archivedRuns.r1).toBeDefined();
    });

    it('moves run from archivedRuns to runs when unarchived', () => {
      const store = createStore({
        archivedRuns: { r1: { id: 'r1', archived: true } },
      });
      store.setRun('r1', { id: 'r1', stage: 'done' });
      expect(store.getState().archivedRuns.r1).toBeUndefined();
      expect(store.getState().runs.r1).toBeDefined();
    });

    it('removes from archivedRuns when present and data is not archived', () => {
      const store = createStore({
        archivedRuns: { r1: { id: 'r1', archived: true } },
        runs: {},
      });
      store.setRun('r1', { id: 'r1', stage: 'test' });
      const s = store.getState();
      expect(s.runs.r1).toEqual({ id: 'r1', stage: 'test' });
      expect(s.archivedRuns.r1).toBeUndefined();
    });
  });

  describe('getRunById', () => {
    it('returns run from runs map', () => {
      const store = createStore({ runs: { r1: { id: 'r1', stage: 'plan' } } });
      expect(store.getRunById('r1')).toEqual({ id: 'r1', stage: 'plan' });
    });

    it('falls back to archivedRuns', () => {
      const store = createStore({
        archivedRuns: { r2: { id: 'r2', archived: true } },
      });
      expect(store.getRunById('r2')).toEqual({ id: 'r2', archived: true });
    });

    it('prefers runs over archivedRuns', () => {
      const store = createStore({
        runs: { r1: { id: 'r1', stage: 'plan' } },
        archivedRuns: { r1: { id: 'r1', archived: true } },
      });
      expect(store.getRunById('r1')).toEqual({ id: 'r1', stage: 'plan' });
    });

    it('returns undefined for unknown IDs', () => {
      const store = createStore();
      expect(store.getRunById('nonexistent')).toBeUndefined();
    });
  });

  describe('setState equality check includes archivedRuns', () => {
    it('does not notify when archivedRuns unchanged', () => {
      const archivedRuns = { r1: { id: 'r1', archived: true } };
      const store = createStore({ archivedRuns });
      const fn = vi.fn();
      store.subscribe(fn);
      store.setState({ archivedRuns });
      expect(fn).not.toHaveBeenCalled();
    });

    it('notifies when archivedRuns changes', () => {
      const store = createStore();
      const fn = vi.fn();
      store.subscribe(fn);
      store.setState({ archivedRuns: { r1: { id: 'r1', archived: true } } });
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  it('initializes with currentProjectId=null and projects=[]', () => {
    const store = createStore();
    const s = store.getState();
    expect(s.currentProjectId).toBe(null);
    expect(s.projects).toEqual([]);
  });

  it('setState updates currentProjectId and notifies', () => {
    const store = createStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setState({ currentProjectId: 'proj-1' });
    expect(store.getState().currentProjectId).toBe('proj-1');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does not notify when currentProjectId unchanged', () => {
    const store = createStore({ currentProjectId: 'proj-1' });
    const fn = vi.fn();
    store.subscribe(fn);
    store.setState({ currentProjectId: 'proj-1' });
    expect(fn).not.toHaveBeenCalled();
  });
});
