import { describe, it, expect } from 'vitest';
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
      else if (v && v.strings) result += renderToString(v);
    }
  });
  return result;
}

const running1 = { id: 'r1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' };
const running2 = { id: 'r2', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' };
const paused1 = { id: 'p1', pipeline_status: 'paused', active: false, started_at: '2026-01-01T00:00:00Z' };
const failed1 = { id: 'f1', pipeline_status: 'failed', active: false, started_at: '2026-01-01T00:00:00Z' };

// ─── Grouping ────────────────────────────────────────────────────────────────

describe('dashboardView - active run grouping', () => {
  it('renders active-group-running section for running runs', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('active-group-running');
  });

  it('renders active-group-paused section for paused runs', () => {
    const state = { runs: { p1: paused1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('active-group-paused');
  });

  it('renders active-group-failed section for failed runs', () => {
    const state = { runs: { f1: failed1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('active-group-failed');
  });

  it('running group appears before paused group in output', () => {
    const state = { runs: { r1: running1, p1: paused1 } };
    const output = renderToString(dashboardView(state));
    expect(output.indexOf('active-group-running')).toBeLessThan(output.indexOf('active-group-paused'));
  });

  it('paused group appears before failed group in output', () => {
    const state = { runs: { p1: paused1, f1: failed1 } };
    const output = renderToString(dashboardView(state));
    expect(output.indexOf('active-group-paused')).toBeLessThan(output.indexOf('active-group-failed'));
  });

  it('does not render active-group-running when no running runs', () => {
    const state = { runs: { p1: paused1 } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('active-group-running');
  });

  it('does not render active-group-paused when no paused runs', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('active-group-paused');
  });

  it('does not render active-group-failed when no failed runs', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state));
    expect(output).not.toContain('active-group-failed');
  });

  it('treats resuming status as part of running group', () => {
    const resuming = { id: 'res1', pipeline_status: 'resuming', active: true, started_at: '2026-01-01T00:00:00Z' };
    const state = { runs: { res1: resuming } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('active-group-running');
  });
});

// ─── Count badges ─────────────────────────────────────────────────────────────

describe('dashboardView - count badges', () => {
  it('shows "1 running" for one running run', () => {
    const state = { runs: { r1: running1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('1 running');
  });

  it('shows "2 running" for two running runs', () => {
    const state = { runs: { r1: running1, r2: running2 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('2 running');
  });

  it('shows "1 paused" for one paused run', () => {
    const state = { runs: { p1: paused1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('1 paused');
  });

  it('shows "1 failed" for one failed run', () => {
    const state = { runs: { f1: failed1 } };
    const output = renderToString(dashboardView(state));
    expect(output).toContain('1 failed');
  });
});

// ─── Sort order within groups ─────────────────────────────────────────────────

describe('dashboardView - sort order within groups', () => {
  it('renders newer running run before older running run', () => {
    const older = { id: 'rA', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z', work_request: { title: 'Older Running' } };
    const newer = { id: 'rB', pipeline_status: 'running', active: true, started_at: '2026-03-01T00:00:00Z', work_request: { title: 'Newer Running' } };
    const state = { runs: { rA: older, rB: newer } };
    const output = renderToString(dashboardView(state));
    expect(output.indexOf('Newer Running')).toBeLessThan(output.indexOf('Older Running'));
  });

  it('renders newer paused run before older paused run', () => {
    const older = { id: 'pA', pipeline_status: 'paused', active: false, started_at: '2026-01-01T00:00:00Z', work_request: { title: 'Older Paused' } };
    const newer = { id: 'pB', pipeline_status: 'paused', active: false, started_at: '2026-03-01T00:00:00Z', work_request: { title: 'Newer Paused' } };
    const state = { runs: { pA: older, pB: newer } };
    const output = renderToString(dashboardView(state));
    expect(output.indexOf('Newer Paused')).toBeLessThan(output.indexOf('Older Paused'));
  });

  it('renders newer failed run before older failed run', () => {
    const older = { id: 'fA', pipeline_status: 'failed', active: false, started_at: '2026-01-01T00:00:00Z', work_request: { title: 'Older Failed' } };
    const newer = { id: 'fB', pipeline_status: 'failed', active: false, started_at: '2026-03-01T00:00:00Z', work_request: { title: 'Newer Failed' } };
    const state = { runs: { fA: older, fB: newer } };
    const output = renderToString(dashboardView(state));
    expect(output.indexOf('Newer Failed')).toBeLessThan(output.indexOf('Older Failed'));
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
