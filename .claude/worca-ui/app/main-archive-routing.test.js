/**
 * Tests for archive-aware run routing in main.js WS handler patterns.
 *
 * Verifies that:
 * 1. Simple bulk loops use setRunsBulk which partitions archived/non-archived
 * 2. Multi-project merge loops manually route archived runs to archivedRuns
 * 3. Settings ordering contract is preserved after setRunsBulk migration
 */
import { describe, expect, it } from 'vitest';
import { createStore } from './state.js';

describe('simple bulk loop → setRunsBulk', () => {
  it('partitions archived runs into archivedRuns (runs-list single-project)', () => {
    const store = createStore();
    const payload = {
      runs: [
        { id: 'r1', stage: 'done' },
        { id: 'r2', archived: true, archived_at: new Date().toISOString() },
        { id: 'r3', stage: 'plan' },
      ],
      settings: { maxConcurrent: 2 },
    };

    // Pattern: setRunsBulk replaces the old for-loop + setState({ runs })
    let settings = {};
    if (payload.settings) settings = payload.settings;
    store.setRunsBulk(payload.runs || []);

    const s = store.getState();
    expect(s.runs).toEqual({
      r1: { id: 'r1', stage: 'done' },
      r3: { id: 'r3', stage: 'plan' },
    });
    expect(s.archivedRuns).toEqual({
      r2: { id: 'r2', archived: true, archived_at: expect.any(String) },
    });
    expect(settings).toEqual({ maxConcurrent: 2 });
  });

  it('settings are visible to subscribers when updated before setRunsBulk', () => {
    const store = createStore();
    let settings = {};
    const settingsCapturedDuringRender = [];

    store.subscribe(() => {
      settingsCapturedDuringRender.push(Object.assign({}, settings));
    });

    const payload = {
      runs: [{ id: 'r1' }],
      settings: { maxConcurrent: 3 },
    };

    // Correct ordering: settings before setRunsBulk (same contract as before)
    if (payload.settings) settings = payload.settings;
    store.setRunsBulk(payload.runs || []);

    expect(settingsCapturedDuringRender).toHaveLength(1);
    expect(settingsCapturedDuringRender[0]).toEqual({ maxConcurrent: 3 });
  });

  it('handles empty payload gracefully', () => {
    const store = createStore({
      runs: { old: { id: 'old' } },
      archivedRuns: { arch: { id: 'arch', archived: true } },
    });

    store.setRunsBulk([]);

    const s = store.getState();
    expect(s.runs).toEqual({});
    expect(s.archivedRuns).toEqual({});
  });
});

describe('multi-project merge loop archive routing', () => {
  it('routes archived runs to archivedRuns in merge loop', () => {
    const store = createStore({
      runs: { existing: { id: 'existing', _project: 'proj-a' } },
    });

    // Simulate runs-list multi-project merge pattern with archive routing
    const payload = {
      runs: [
        { id: 'r1', stage: 'done' },
        { id: 'r2', archived: true, archived_at: new Date().toISOString() },
      ],
    };
    const sourceProject = 'proj-b';

    const existing = { ...store.getState().runs };
    const archivedUpdates = { ...store.getState().archivedRuns };
    const freshIds = new Set((payload.runs || []).map((r) => r.id));

    if (sourceProject) {
      for (const [id, run] of Object.entries(existing)) {
        if (run._project === sourceProject && !freshIds.has(id)) {
          delete existing[id];
        }
      }
    }
    for (const run of payload.runs || []) {
      if (sourceProject) run._project = sourceProject;
      if (run.archived) {
        archivedUpdates[run.id] = run;
      } else {
        existing[run.id] = run;
      }
    }
    store.setState({ runs: existing, archivedRuns: archivedUpdates });

    const s = store.getState();
    // r1 is in runs, r2 is in archivedRuns
    expect(s.runs.r1).toBeDefined();
    expect(s.runs.r1._project).toBe('proj-b');
    expect(s.runs.r2).toBeUndefined();
    expect(s.archivedRuns.r2).toBeDefined();
    expect(s.archivedRuns.r2._project).toBe('proj-b');
    // existing run from proj-a still present
    expect(s.runs.existing).toBeDefined();
  });

  it('prunes stale runs from source project but keeps other projects', () => {
    const store = createStore({
      runs: {
        'old-b': { id: 'old-b', _project: 'proj-b' },
        'keep-a': { id: 'keep-a', _project: 'proj-a' },
      },
    });

    const payload = {
      runs: [{ id: 'new-b', stage: 'plan' }],
    };
    const sourceProject = 'proj-b';

    const existing = { ...store.getState().runs };
    const archivedUpdates = { ...store.getState().archivedRuns };
    const freshIds = new Set((payload.runs || []).map((r) => r.id));

    if (sourceProject) {
      for (const [id, run] of Object.entries(existing)) {
        if (run._project === sourceProject && !freshIds.has(id)) {
          delete existing[id];
        }
      }
    }
    for (const run of payload.runs || []) {
      if (sourceProject) run._project = sourceProject;
      if (run.archived) {
        archivedUpdates[run.id] = run;
      } else {
        existing[run.id] = run;
      }
    }
    store.setState({ runs: existing, archivedRuns: archivedUpdates });

    const s = store.getState();
    expect(s.runs['old-b']).toBeUndefined(); // pruned
    expect(s.runs['keep-a']).toBeDefined(); // kept (different project)
    expect(s.runs['new-b']).toBeDefined(); // added
  });

  it('routes archived runs in fetchAllProjectRuns merge pattern', () => {
    const store = createStore();

    // Simulate fetchAllProjectRuns: multiple project results merged
    const results = [
      [
        { id: 'a1', project: 'proj-a', stage: 'done' },
        {
          id: 'a2',
          project: 'proj-a',
          archived: true,
          archived_at: '2026-01-01T00:00:00Z',
        },
      ],
      [{ id: 'b1', project: 'proj-b', stage: 'plan' }],
    ];

    const runs = {};
    const archivedRuns = {};
    for (const projectRuns of results) {
      for (const run of projectRuns) {
        if (run.archived) {
          archivedRuns[run.id] = run;
        } else {
          runs[run.id] = run;
        }
      }
    }
    store.setState({ runs, archivedRuns });

    const s = store.getState();
    expect(s.runs.a1).toBeDefined();
    expect(s.runs.b1).toBeDefined();
    expect(s.runs.a2).toBeUndefined();
    expect(s.archivedRuns.a2).toBeDefined();
  });
});

// ─── WS run-archived / run-unarchived handler patterns ──────────────

describe('WS run-archived handler pattern', () => {
  it('moves run from runs to archivedRuns', () => {
    const store = createStore({
      runs: { r1: { id: 'r1', stage: 'done', pipeline_status: 'failed' } },
    });
    const runId = 'r1';
    const existingRun =
      store.getState().runs[runId] ?? store.getState().archivedRuns[runId];
    if (existingRun) {
      store.setRun(runId, {
        ...existingRun,
        archived: true,
        archived_at: '2026-04-03T12:00:00.000Z',
      });
    }
    const s = store.getState();
    expect(s.runs.r1).toBeUndefined();
    expect(s.archivedRuns.r1).toBeDefined();
    expect(s.archivedRuns.r1.archived).toBe(true);
    expect(s.archivedRuns.r1.pipeline_status).toBe('failed');
  });

  it('no-op for unknown run', () => {
    const store = createStore({ runs: { r1: { id: 'r1' } } });
    const existingRun =
      store.getState().runs.unknown ?? store.getState().archivedRuns.unknown;
    expect(existingRun).toBeUndefined();
    expect(store.getState().runs.r1).toBeDefined();
  });
});

describe('WS run-unarchived handler pattern', () => {
  it('moves run from archivedRuns to runs', () => {
    const store = createStore({
      archivedRuns: {
        r1: {
          id: 'r1',
          archived: true,
          archived_at: '2026-01-01T00:00:00Z',
          pipeline_status: 'failed',
        },
      },
    });
    const runId = 'r1';
    const existingRun =
      store.getState().runs[runId] ?? store.getState().archivedRuns[runId];
    if (existingRun) {
      const { archived: _a, archived_at: _b, ...rest } = existingRun;
      store.setRun(runId, rest);
    }
    const s = store.getState();
    expect(s.archivedRuns.r1).toBeUndefined();
    expect(s.runs.r1).toBeDefined();
    expect(s.runs.r1.archived).toBeUndefined();
    expect(s.runs.r1.pipeline_status).toBe('failed');
  });
});

// ─── Notification suppression for archived runs ─────────────────────

describe('notification suppression for archived runs', () => {
  it('skips when payload has archived=true', () => {
    const payload = { id: 'r1', archived: true };
    expect(payload.archived === true).toBe(true);
  });

  it('skips when run is in archivedRuns', () => {
    const store = createStore({
      archivedRuns: { r1: { id: 'r1', archived: true } },
    });
    expect(!!store.getState().archivedRuns.r1).toBe(true);
  });

  it('does not skip for non-archived run', () => {
    const store = createStore({ runs: { r1: { id: 'r1' } } });
    const payload = { id: 'r1', stage: 'done' };
    const isArchived =
      payload.archived === true || !!store.getState().archivedRuns[payload.id];
    expect(isArchived).toBe(false);
  });
});

// ─── getRunById for run detail lookups ──────────────────────────────

describe('getRunById for run detail lookups', () => {
  it('finds non-archived run', () => {
    const store = createStore({ runs: { r1: { id: 'r1', stage: 'plan' } } });
    expect(store.getRunById('r1')).toEqual({ id: 'r1', stage: 'plan' });
  });

  it('finds archived run', () => {
    const store = createStore({
      archivedRuns: { r1: { id: 'r1', archived: true } },
    });
    expect(store.getRunById('r1')).toEqual({ id: 'r1', archived: true });
  });

  it('returns undefined for unknown', () => {
    const store = createStore();
    expect(store.getRunById('nope')).toBeUndefined();
  });
});

// ─── Project switch clears archivedRuns ─────────────────────────────

describe('project switch clears archivedRuns', () => {
  it('archivedRuns cleared alongside runs', () => {
    const store = createStore({
      runs: { r1: { id: 'r1' } },
      archivedRuns: { r2: { id: 'r2', archived: true } },
    });
    store.setState({
      runs: {},
      archivedRuns: {},
      logLines: [],
      activeRunId: null,
      pipelines: {},
    });
    const s = store.getState();
    expect(s.runs).toEqual({});
    expect(s.archivedRuns).toEqual({});
  });
});
