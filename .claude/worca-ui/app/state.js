/**
 * Reactive state store for worca-ui.
 */

const LOG_CAP = 5000;

export function createStore(initial = {}) {
  let state = {
    activeRunId: initial.activeRunId ?? null,
    runs: initial.runs ?? {},
    logLines: initial.logLines ?? [],
    preferences: {
      theme: initial.preferences?.theme ?? 'light',
      sidebarCollapsed: initial.preferences?.sidebarCollapsed ?? false,
      notifications: initial.preferences?.notifications ?? null
    }
  };

  const subs = new Set();

  function emit() {
    for (const fn of Array.from(subs)) {
      try { fn(state); } catch { /* ignore */ }
    }
  }

  return {
    getState() { return state; },

    setState(patch) {
      const next = {
        ...state,
        ...patch,
        preferences: { ...state.preferences, ...(patch.preferences || {}) }
      };
      if (
        next.activeRunId === state.activeRunId &&
        next.runs === state.runs &&
        next.logLines === state.logLines &&
        next.preferences.theme === state.preferences.theme &&
        next.preferences.sidebarCollapsed === state.preferences.sidebarCollapsed &&
        next.preferences.notifications === state.preferences.notifications
      ) return;
      state = next;
      emit();
    },

    setRun(runId, data) {
      const runs = { ...state.runs, [runId]: data };
      state = { ...state, runs };
      emit();
    },

    appendLog(entry) {
      const logLines = [...state.logLines, entry];
      if (logLines.length > LOG_CAP) logLines.splice(0, logLines.length - LOG_CAP);
      state = { ...state, logLines };
      emit();
    },

    clearLog() {
      state = { ...state, logLines: [] };
      emit();
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}
