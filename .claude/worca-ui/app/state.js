/**
 * Reactive state store for worca-ui.
 *
 * Note: The W-032 plan specified a separate `state-accessors.js` module (Task 1.6)
 * for safe accessor functions with fallback to the old flat shape. The accessor
 * logic was folded directly into this module since the store API (getState,
 * setState, setRun, appendLog, clearLog) already provides a clean boundary and
 * a separate file added indirection without benefit.
 */

const LOG_CAP = 5000;
export const MAX_ARCHIVED_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Returns true if an archived run's archived_at is older than MAX_ARCHIVED_AGE_MS. */
export function isArchivedRunExpired(run, now) {
  if (!run.archived_at) return false;
  return (
    (now || Date.now()) - new Date(run.archived_at).getTime() >
    MAX_ARCHIVED_AGE_MS
  );
}

export function createStore(initial = {}) {
  let state = {
    activeRunId: initial.activeRunId ?? null,
    projectName: initial.projectName ?? '',
    currentProjectId: initial.currentProjectId ?? null,
    projects: initial.projects ?? [],
    runs: initial.runs ?? {},
    archivedRuns: initial.archivedRuns ?? {},
    pipelines: initial.pipelines ?? {},
    logLines: initial.logLines ?? [],
    preferences: {
      theme: initial.preferences?.theme ?? 'light',
      sidebarCollapsed: initial.preferences?.sidebarCollapsed ?? false,
      notifications: initial.preferences?.notifications ?? null,
    },
    beads: initial.beads ?? { issues: [], dbExists: false, loading: false },
    webhookInbox: initial.webhookInbox ?? {
      events: [],
      controlAction: 'continue',
    },
    addProjectDialogOpen: initial.addProjectDialogOpen ?? false,
  };

  const subs = new Set();

  function emit() {
    for (const fn of Array.from(subs)) {
      try {
        fn(state);
      } catch {
        /* ignore */
      }
    }
  }

  return {
    getState() {
      return state;
    },

    setState(patch) {
      const next = {
        ...state,
        ...patch,
        preferences: { ...state.preferences, ...(patch.preferences || {}) },
      };
      if (
        next.activeRunId === state.activeRunId &&
        next.projectName === state.projectName &&
        next.currentProjectId === state.currentProjectId &&
        next.projects === state.projects &&
        next.runs === state.runs &&
        next.archivedRuns === state.archivedRuns &&
        next.pipelines === state.pipelines &&
        next.logLines === state.logLines &&
        next.preferences.theme === state.preferences.theme &&
        next.preferences.sidebarCollapsed ===
          state.preferences.sidebarCollapsed &&
        next.preferences.notifications === state.preferences.notifications &&
        next.beads === state.beads &&
        next.webhookInbox === state.webhookInbox &&
        next.addProjectDialogOpen === state.addProjectDialogOpen
      )
        return;
      state = next;
      emit();
    },

    setRun(runId, data) {
      if (data.archived === true) {
        const archivedRuns = { ...state.archivedRuns, [runId]: data };
        if (runId in state.runs) {
          const runs = { ...state.runs };
          delete runs[runId];
          state = { ...state, runs, archivedRuns };
        } else {
          state = { ...state, archivedRuns };
        }
      } else {
        const runs = { ...state.runs, [runId]: data };
        if (runId in state.archivedRuns) {
          const archivedRuns = { ...state.archivedRuns };
          delete archivedRuns[runId];
          state = { ...state, runs, archivedRuns };
        } else {
          state = { ...state, runs };
        }
      }
      emit();
    },

    setRunsBulk(runArray) {
      const runs = {};
      const archivedRuns = {};
      const now = Date.now();
      for (const run of runArray) {
        if (run.archived === true) {
          if (isArchivedRunExpired(run, now)) continue;
          archivedRuns[run.id] = run;
        } else {
          runs[run.id] = run;
        }
      }
      state = { ...state, runs, archivedRuns };
      emit();
    },

    /** Centralized ID lookup across both runs and archivedRuns. */
    getRunById(id) {
      return state.runs[id] ?? state.archivedRuns[id];
    },
    appendLog(entry) {
      const logLines = [...state.logLines, entry];
      if (logLines.length > LOG_CAP)
        logLines.splice(0, logLines.length - LOG_CAP);
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
    },
  };
}
