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
