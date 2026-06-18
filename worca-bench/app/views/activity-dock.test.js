import { describe, expect, it } from 'vitest';
import { activityDock } from './activity-dock.js';

// renderToString helper shared with the other worca-bench view tests.
function renderToString(template) {
  if (template == null) return '';
  if (typeof template === 'symbol') return ''; // lit `nothing`
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

const RUN = {
  id: 'run-demo-1-1',
  type: 'run',
  profile: 'demo',
  status: 'running',
  started_at: '2026-06-18T10:00:00Z',
  progress: { unit: 'instances', done: 3, total: 9, errors: 1 },
};
const DONE = {
  id: 'regrade-demo-2-2',
  type: 'regrade',
  profile: 'demo',
  status: 'completed',
  started_at: '2026-06-18T09:00:00Z',
  ended_at: '2026-06-18T09:05:00Z',
  progress: { unit: 'regraded', done: 20, total: 20, errors: 0 },
};

describe('activityDock', () => {
  it('renders nothing when there are no actions', () => {
    expect(renderToString(activityDock([]))).toBe('');
  });

  it('shows a summary bar with running/done counts', () => {
    const out = renderToString(activityDock([RUN, DONE], { collapsed: true }));
    expect(out).toContain('activity-dock');
    expect(out).toContain('is-collapsed');
    expect(out).toContain('Activity');
    expect(out).toContain('1 running');
    expect(out).toContain('1 done');
    // collapsed => no table
    expect(out).not.toContain('activity-table');
  });

  it('renders the table with rows when expanded', () => {
    const out = renderToString(activityDock([RUN, DONE], { collapsed: false }));
    expect(out).toContain('is-expanded');
    expect(out).toContain('activity-table');
    expect(out).toContain('Run');
    expect(out).toContain('Regrade');
    expect(out).toContain('demo');
    expect(out).toContain('3/9 inst'); // run progress
    expect(out).toContain('1 err');
    expect(out).toContain('20/20 regraded'); // regrade progress
  });

  it('offers a Stop button only for running actions', () => {
    const running = renderToString(activityDock([RUN], { collapsed: false }));
    expect(running).toContain('act-btn--stop');
    expect(running).not.toContain('act-btn--dismiss'); // running has no dismiss
    const done = renderToString(activityDock([DONE], { collapsed: false }));
    expect(done).not.toContain('act-btn--stop');
    expect(done).toContain('act-btn--dismiss'); // terminal can be dismissed
  });

  it('hides dismissed actions (and the dock when all are dismissed)', () => {
    const dismissed = new Set([DONE.id]);
    const out = renderToString(
      activityDock([DONE], { collapsed: false, dismissed }),
    );
    expect(out).toBe('');
    // a still-visible action keeps the dock
    const mixed = renderToString(
      activityDock([RUN, DONE], { collapsed: false, dismissed }),
    );
    expect(mixed).toContain('activity-table');
    expect(mixed).toContain('3/9 inst'); // the surviving RUN row is present
  });

  it('marks a running action with the active status class + dot', () => {
    const out = renderToString(activityDock([RUN], { collapsed: false }));
    expect(out).toContain('act-status--running');
    expect(out).toContain('act-dot');
  });
});
