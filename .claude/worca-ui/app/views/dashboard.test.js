import { describe, expect, it } from 'vitest';
import { dashboardView } from './dashboard.js';

function renderToString(template) {
  if (!template) return '';
  if (typeof template === 'string') return template;
  if (!template.strings) return String(template);
  let result = '';
  template.strings.forEach((s, i) => {
    result += s;
    if (i < template.values.length) {
      const v = template.values[i];
      if (typeof v === 'string') result += v;
      else if (typeof v === 'number') result += String(v);
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v?.strings) result += renderToString(v);
    }
  });
  return result;
}

const running1 = {
  id: 'r1',
  pipeline_status: 'running',
  active: true,
  started_at: '2026-01-01T00:00:00Z',
};
const _running2 = {
  id: 'r2',
  pipeline_status: 'running',
  active: true,
  started_at: '2026-01-01T00:00:00Z',
};
const paused1 = {
  id: 'p1',
  pipeline_status: 'paused',
  active: true,
  started_at: '2026-01-01T00:00:00Z',
};
const failed1 = {
  id: 'f1',
  pipeline_status: 'failed',
  active: true,
  started_at: '2026-01-01T00:00:00Z',
};

// ─── Active runs ─────────────────────────────────────────────────────────────

describe('dashboardView - active runs', () => {
  it('shows active running run in Active Runs section', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('Active Runs');
    expect(output).toContain('run-card');
  });

  it('shows active paused run in Active Runs section', () => {
    const state = { runs: { p1: paused1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('Active Runs');
    expect(output).toContain('run-card');
  });

  it('shows all active runs regardless of status', () => {
    const state = { runs: { r1: running1, p1: paused1 } };
    const output = renderToString(dashboardView(state));
    // Both are active:true, so both appear under Active Runs
    const count = (output.match(/run-card /g) || []).length;
    expect(count).toBe(2);
  });

  it('shows resuming run in Active Runs section', () => {
    const resuming = {
      id: 'res1',
      pipeline_status: 'resuming',
      active: true,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { res1: resuming } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('Active Runs');
    expect(output).toContain('run-card');
  });

  it('shows empty state when no active runs', () => {
    const completed = {
      id: 'c1',
      pipeline_status: 'completed',
      active: false,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { c1: completed } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('No active pipelines');
  });

  it('renders failed runs in Recent Failures not Active Runs', () => {
    // failed1 has active:true so it shows in active section
    // An inactive failed run should only show in Recent Failures
    const inactiveFailed = {
      id: 'if1',
      pipeline_status: 'failed',
      active: false,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { if1: inactiveFailed } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('Recent Failures');
    expect(output).toContain('No active pipelines');
  });
});

// ─── Recent sections ─────────────────────────────────────────────────────────

describe('dashboardView - recent sections', () => {
  it('shows failed run in Recent Failures section', () => {
    const state = { runs: { f1: failed1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('Recent Failures');
    expect(output).toContain('active-group-failed');
  });
});

// ─── Sort order within groups ─────────────────────────────────────────────────

describe('dashboardView - sort order within groups', () => {
  it('renders newer running run before older running run', () => {
    const older = {
      id: 'rA',
      pipeline_status: 'running',
      active: true,
      started_at: '2026-01-01T00:00:00Z',
      work_request: { title: 'Older Running' },
    };
    const newer = {
      id: 'rB',
      pipeline_status: 'running',
      active: true,
      started_at: '2026-03-01T00:00:00Z',
      work_request: { title: 'Newer Running' },
    };
    const state = { runs: { rA: older, rB: newer } };
    const output = renderToString(dashboardView(state));
    expect(output.indexOf('Newer Running')).toBeLessThan(
      output.indexOf('Older Running'),
    );
  });

  it('renders newer paused run before older paused run', () => {
    const older = {
      id: 'pA',
      pipeline_status: 'paused',
      active: true,
      started_at: '2026-01-01T00:00:00Z',
      work_request: { title: 'Older Paused' },
    };
    const newer = {
      id: 'pB',
      pipeline_status: 'paused',
      active: true,
      started_at: '2026-03-01T00:00:00Z',
      work_request: { title: 'Newer Paused' },
    };
    const state = { runs: { pA: older, pB: newer } };
    const output = renderToString(dashboardView(state));
    expect(output.indexOf('Newer Paused')).toBeLessThan(
      output.indexOf('Older Paused'),
    );
  });

  it('renders newer failed run before older failed run', () => {
    const older = {
      id: 'fA',
      pipeline_status: 'failed',
      active: true,
      started_at: '2026-01-01T00:00:00Z',
      work_request: { title: 'Older Failed' },
    };
    const newer = {
      id: 'fB',
      pipeline_status: 'failed',
      active: true,
      started_at: '2026-03-01T00:00:00Z',
      work_request: { title: 'Newer Failed' },
    };
    const state = { runs: { fA: older, fB: newer } };
    const output = renderToString(dashboardView(state));
    expect(output.indexOf('Newer Failed')).toBeLessThan(
      output.indexOf('Older Failed'),
    );
  });
});

// ─── Quick-action buttons ─────────────────────────────────────────────────────

describe('dashboardView - quick-action buttons', () => {
  it('shows pause button on running run cards when onPause provided', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state, { onPause: () => {} }));
    expect(output).toContain('btn-quick-pause');
  });

  it('shows resume button on paused run cards when onResume provided', () => {
    const state = { runs: { p1: paused1 } };
    const output = renderToString(dashboardView(state, { onResume: () => {} }));
    expect(output).toContain('btn-quick-resume');
  });

  it('shows resume button on failed run cards when onResume provided', () => {
    const state = { runs: { f1: failed1 } };
    const output = renderToString(dashboardView(state, { onResume: () => {} }));
    expect(output).toContain('btn-quick-resume');
  });

  it('does not show pause button when onPause not provided', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('btn-quick-pause');
  });

  it('does not show resume button when onResume not provided', () => {
    const state = { runs: { p1: paused1 } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('btn-quick-resume');
  });
});

// ─── Inactive failed/paused runs ─────────────────────────────────────────────

describe('dashboardView - inactive failed/paused runs', () => {
  it('shows inactive failed run in Recent Failures section', () => {
    const inactiveFailed = {
      id: 'if1',
      pipeline_status: 'failed',
      active: false,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { if1: inactiveFailed } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('active-group-failed');
    expect(output).toContain('Recent Failures');
  });

  it('shows resume button on inactive failed run when onResume provided', () => {
    const inactiveFailed = {
      id: 'if1',
      pipeline_status: 'failed',
      active: false,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { if1: inactiveFailed } };
    const output = renderToString(dashboardView(state, { onResume: () => {} }));
    expect(output).toContain('btn-quick-resume');
  });

  it('does not show inactive paused run in active paused group', () => {
    const inactivePaused = {
      id: 'ip1',
      pipeline_status: 'paused',
      active: false,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { ip1: inactivePaused } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('active-group-paused');
  });

  it('shows inactive completed run in Recent Completed section', () => {
    const inactiveCompleted = {
      id: 'ic1',
      pipeline_status: 'completed',
      active: false,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { ic1: inactiveCompleted } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('active-group-running');
    expect(output).not.toContain('active-group-paused');
    expect(output).not.toContain('active-group-failed');
    expect(output).toContain('Recent Completed');
    expect(output).toContain('active-group-completed');
  });
});

// ─── Recent sections capping ────────────────────────────────────────────────

describe('dashboardView - recent sections capping', () => {
  function makeFailed(id, date) {
    return {
      id,
      pipeline_status: 'failed',
      active: false,
      started_at: date,
      work_request: { title: `Run ${id}` },
    };
  }
  function makeCompleted(id, date) {
    return {
      id,
      pipeline_status: 'completed',
      active: false,
      started_at: date,
      work_request: { title: `Run ${id}` },
    };
  }

  it('shows at most 3 failed runs in Recent Failures', () => {
    const runs = {};
    for (let i = 1; i <= 5; i++) {
      runs[`f${i}`] = makeFailed(`f${i}`, `2026-01-0${i}T00:00:00Z`);
    }
    const state = { runs };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('Recent Failures');
    // Most recent 3 should be present (f5, f4, f3), oldest 2 (f1, f2) should not
    expect(output).toContain('Run f5');
    expect(output).toContain('Run f4');
    expect(output).toContain('Run f3');
  });

  it('shows "View all N" link when more than 3 failed runs', () => {
    const runs = {};
    for (let i = 1; i <= 5; i++) {
      runs[`f${i}`] = makeFailed(`f${i}`, `2026-01-0${i}T00:00:00Z`);
    }
    const state = { runs };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('View all 5');
  });

  it('does not show "View all" link when 3 or fewer failed runs', () => {
    const runs = {};
    for (let i = 1; i <= 3; i++) {
      runs[`f${i}`] = makeFailed(`f${i}`, `2026-01-0${i}T00:00:00Z`);
    }
    const state = { runs };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('Recent Failures');
    expect(output).not.toContain('View all');
  });

  it('shows at most 3 completed runs in Recent Completed', () => {
    const runs = {};
    for (let i = 1; i <= 5; i++) {
      runs[`c${i}`] = makeCompleted(`c${i}`, `2026-01-0${i}T00:00:00Z`);
    }
    const state = { runs };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('Recent Completed');
    expect(output).toContain('View all 5');
  });

  it('does not show Recent Completed when no completed runs', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('Recent Completed');
  });

  it('does not show Recent Failures when no failed runs', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('Recent Failures');
  });
});

// ─── Archive button passthrough ──────────────────────────────────────────────

describe('dashboardView - archive button', () => {
  it('shows archive button on non-active failed run when onArchive provided', () => {
    const inactiveFailed = {
      id: 'af1',
      pipeline_status: 'failed',
      active: false,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { af1: inactiveFailed } };
    const output = renderToString(
      dashboardView(state, { onArchive: () => {} }),
    );
    expect(output).toContain('btn-quick-archive');
  });

  it('does not show archive button when onArchive not provided', () => {
    const inactiveFailed = {
      id: 'af2',
      pipeline_status: 'failed',
      active: false,
      started_at: '2026-01-01T00:00:00Z',
    };
    const state = { runs: { af2: inactiveFailed } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('btn-quick-archive');
  });
});
