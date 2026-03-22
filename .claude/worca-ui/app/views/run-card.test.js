import { describe, it, expect } from 'vitest';
import { runCardView } from './run-card.js';

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
      // unsafeHTML directives / functions — skip
    }
  });
  return result;
}

describe('runCardView - status class on card', () => {
  it('adds status-running class when pipeline_status is running', () => {
    const run = { id: '1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).toContain('status-running');
  });

  it('adds status-paused class when pipeline_status is paused', () => {
    const run = { id: '1', pipeline_status: 'paused', active: false, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).toContain('status-paused');
  });

  it('adds status-completed class when pipeline_status is completed', () => {
    const run = { id: '1', pipeline_status: 'completed', active: false, started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).toContain('status-completed');
  });

  it('adds status-failed class when pipeline_status is failed', () => {
    const run = { id: '1', pipeline_status: 'failed', active: false, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).toContain('status-failed');
  });

  it('adds status-resuming class when pipeline_status is resuming', () => {
    const run = { id: '1', pipeline_status: 'resuming', active: true, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).toContain('status-resuming');
  });

  it('falls back to status-running for active run without pipeline_status', () => {
    const run = { id: '1', active: true, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).toContain('status-running');
  });

  it('falls back to status-completed for inactive run without pipeline_status', () => {
    const run = { id: '1', active: false, started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).toContain('status-completed');
  });
});

describe('runCardView - status icon tooltip', () => {
  it('shows tooltip on status icon when status_changed_at is set', () => {
    const run = {
      id: '1', pipeline_status: 'paused', active: false,
      started_at: '2026-01-01T00:00:00Z',
      status_changed_at: '2026-01-01T00:00:00Z'
    };
    const output = renderToString(runCardView(run));
    expect(output).toContain('title=');
  });

  it('shows tooltip with completed_at for completed runs', () => {
    const run = {
      id: '1', pipeline_status: 'completed', active: false,
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T01:00:00Z'
    };
    const output = renderToString(runCardView(run));
    expect(output).toContain('title=');
  });

  it('shows tooltip for running runs using started_at', () => {
    const run = {
      id: '1', pipeline_status: 'running', active: true,
      started_at: '2026-01-01T00:00:00Z'
    };
    const output = renderToString(runCardView(run));
    expect(output).toContain('title=');
  });

  it('does not show title attribute when no time reference available', () => {
    const run = { id: '1', pipeline_status: 'pending', active: false };
    const output = renderToString(runCardView(run));
    expect(output).not.toContain('title=');
  });
});

describe('runCardView - quick-action buttons', () => {
  it('shows pause button with btn-quick-pause when running and onPause provided', () => {
    const run = { id: '1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run, { onPause: () => {} }));
    expect(output).toContain('btn-quick-pause');
  });

  it('shows resume button with btn-quick-resume when paused and onResume provided', () => {
    const run = { id: '1', pipeline_status: 'paused', active: false, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run, { onResume: () => {} }));
    expect(output).toContain('btn-quick-resume');
  });

  it('shows resume button when failed and onResume provided', () => {
    const run = { id: '1', pipeline_status: 'failed', active: false, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run, { onResume: () => {} }));
    expect(output).toContain('btn-quick-resume');
  });

  it('does not show pause button when running but no onPause', () => {
    const run = { id: '1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).not.toContain('btn-quick-pause');
  });

  it('does not show pause button when paused even with onPause', () => {
    const run = { id: '1', pipeline_status: 'paused', active: false };
    const output = renderToString(runCardView(run, { onPause: () => {} }));
    expect(output).not.toContain('btn-quick-pause');
  });

  it('does not show resume button when running even with onResume', () => {
    const run = { id: '1', pipeline_status: 'running', active: true };
    const output = renderToString(runCardView(run, { onResume: () => {} }));
    expect(output).not.toContain('btn-quick-resume');
  });
});

describe('runCardView - border-left via statusClass on card div', () => {
  it('run-card div includes status class for CSS border-left targeting', () => {
    const run = { id: '1', pipeline_status: 'running', active: true, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run));
    // The class "run-card status-running" on the outer div enables border-left via CSS
    expect(output).toMatch(/class="run-card\s+status-running"/);
  });

  it('paused run card has status-paused on outer div', () => {
    const run = { id: '1', pipeline_status: 'paused', active: false, started_at: '2026-01-01T00:00:00Z' };
    const output = renderToString(runCardView(run));
    expect(output).toMatch(/class="run-card\s+status-paused"/);
  });
});
