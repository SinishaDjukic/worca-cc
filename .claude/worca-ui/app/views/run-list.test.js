import { describe, it, expect } from 'vitest';
import { runListView } from './run-list.js';

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

describe('runListView - status icons via runCardView', () => {
  it('renders status-running class for active running run', () => {
    const runs = [{ id: '1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' }];
    const output = renderToString(runListView(runs, 'active', { onSelectRun: () => {} }));
    expect(output).toContain('status-running');
  });

  it('renders status-paused class for paused run in history', () => {
    const runs = [{ id: '1', pipeline_status: 'paused', active: false, started_at: '2026-01-01T00:00:00Z' }];
    const output = renderToString(runListView(runs, 'history', { onSelectRun: () => {} }));
    expect(output).toContain('status-paused');
  });

  it('renders status-completed for completed run', () => {
    const runs = [{ id: '1', pipeline_status: 'completed', active: false, started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' }];
    const output = renderToString(runListView(runs, 'history', { onSelectRun: () => {} }));
    expect(output).toContain('status-completed');
  });

  it('renders status-failed for failed run', () => {
    const runs = [{ id: '1', pipeline_status: 'failed', active: false, started_at: '2026-01-01T00:00:00Z' }];
    const output = renderToString(runListView(runs, 'history', { onSelectRun: () => {} }));
    expect(output).toContain('status-failed');
  });

  it('shows empty state for active filter when no active runs', () => {
    const output = renderToString(runListView([], 'active', { onSelectRun: () => {} }));
    expect(output).toContain('No running pipelines');
  });

  it('shows empty state for history filter when no history runs', () => {
    const output = renderToString(runListView([], 'history', { onSelectRun: () => {} }));
    expect(output).toContain('No completed runs yet');
  });
});

describe('runListView - onPause/onResume passthrough', () => {
  it('passes onPause to run card — shows btn-quick-pause for running run', () => {
    const runs = [{ id: '1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' }];
    const output = renderToString(runListView(runs, 'active', { onSelectRun: () => {}, onPause: () => {} }));
    expect(output).toContain('btn-quick-pause');
  });

  it('passes onResume to run card — shows btn-quick-resume for paused run', () => {
    const runs = [{ id: '1', pipeline_status: 'paused', active: false, started_at: '2026-01-01T00:00:00Z' }];
    const output = renderToString(runListView(runs, 'history', { onSelectRun: () => {}, onResume: () => {} }));
    expect(output).toContain('btn-quick-resume');
  });

  it('passes onResume to run card — shows btn-quick-resume for failed run', () => {
    const runs = [{ id: '1', pipeline_status: 'failed', active: false, started_at: '2026-01-01T00:00:00Z' }];
    const output = renderToString(runListView(runs, 'history', { onSelectRun: () => {}, onResume: () => {} }));
    expect(output).toContain('btn-quick-resume');
  });

  it('does not show btn-quick-pause when onPause not provided', () => {
    const runs = [{ id: '1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' }];
    const output = renderToString(runListView(runs, 'active', { onSelectRun: () => {} }));
    expect(output).not.toContain('btn-quick-pause');
  });

  it('does not show btn-quick-resume when onResume not provided', () => {
    const runs = [{ id: '1', pipeline_status: 'paused', active: false, started_at: '2026-01-01T00:00:00Z' }];
    const output = renderToString(runListView(runs, 'history', { onSelectRun: () => {} }));
    expect(output).not.toContain('btn-quick-resume');
  });
});

describe('runListView - sort order (descending start time)', () => {
  it('renders history runs newest-first', () => {
    const runs = [
      { id: '1', pipeline_status: 'completed', active: false, started_at: '2026-01-01T00:00:00Z', work_request: { title: 'Run-Old' } },
      { id: '2', pipeline_status: 'completed', active: false, started_at: '2026-03-01T00:00:00Z', work_request: { title: 'Run-New' } },
      { id: '3', pipeline_status: 'completed', active: false, started_at: '2026-02-01T00:00:00Z', work_request: { title: 'Run-Mid' } },
    ];
    const output = renderToString(runListView(runs, 'history', {}));
    const newIdx = output.indexOf('Run-New');
    const midIdx = output.indexOf('Run-Mid');
    const oldIdx = output.indexOf('Run-Old');
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });

  it('renders active runs newest-first', () => {
    const runs = [
      { id: '1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z', work_request: { title: 'Run-Old' } },
      { id: '2', pipeline_status: 'running', active: true, started_at: '2026-03-01T00:00:00Z', work_request: { title: 'Run-New' } },
    ];
    const output = renderToString(runListView(runs, 'active', {}));
    const newIdx = output.indexOf('Run-New');
    const oldIdx = output.indexOf('Run-Old');
    expect(newIdx).toBeLessThan(oldIdx);
  });
});
