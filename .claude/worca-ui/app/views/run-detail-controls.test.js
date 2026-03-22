import { describe, it, expect } from 'vitest';
import { runDetailView } from './run-detail.js';

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

const baseRun = { id: 'run-123', stages: {} };

// ─── Pause button ─────────────────────────────────────────────────────────────

describe('runDetailView - pause button', () => {
  it('shows pause button when pipeline_status is running', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('run-controls');
    expect(html).toContain('btn-pause');
  });

  it('pause button has warning variant and outline', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run));
    // The static template strings for the pause sl-button include variant and outline
    expect(html).toContain('btn-pause');
    expect(html).toMatch(/btn-pause[\s\S]{0,200}variant="warning"/);
    expect(html).toMatch(/btn-pause[\s\S]{0,200}outline/);
  });

  it('does not show pause button when pipeline_status is paused', () => {
    const run = { ...baseRun, pipeline_status: 'paused' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('btn-pause');
  });

  it('does not show pause button when pipeline_status is failed', () => {
    const run = { ...baseRun, pipeline_status: 'failed' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('btn-pause');
  });

  it('does not show pause button when pipeline_status is completed', () => {
    const run = { ...baseRun, pipeline_status: 'completed' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('btn-pause');
  });
});

// ─── Resume button ────────────────────────────────────────────────────────────

describe('runDetailView - resume button', () => {
  it('shows resume button when pipeline_status is paused', () => {
    const run = { ...baseRun, pipeline_status: 'paused' };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('run-controls');
    expect(html).toContain('btn-resume');
  });

  it('shows resume button when pipeline_status is failed', () => {
    const run = { ...baseRun, pipeline_status: 'failed' };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('btn-resume');
  });

  it('resume button has success variant', () => {
    const run = { ...baseRun, pipeline_status: 'paused' };
    const html = renderToString(runDetailView(run));
    expect(html).toMatch(/btn-resume[\s\S]{0,200}variant="success"/);
  });

  it('does not show resume button when pipeline_status is running', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('btn-resume');
  });

  it('does not show resume button when pipeline_status is completed', () => {
    const run = { ...baseRun, pipeline_status: 'completed' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('btn-resume');
  });
});

// ─── Stop button ──────────────────────────────────────────────────────────────

describe('runDetailView - stop button', () => {
  it('shows stop button when pipeline_status is running', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('btn-stop');
  });

  it('shows stop button when pipeline_status is paused', () => {
    const run = { ...baseRun, pipeline_status: 'paused' };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('btn-stop');
  });

  it('stop button has danger variant and outline', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run));
    expect(html).toMatch(/btn-stop[\s\S]{0,200}variant="danger"/);
    expect(html).toMatch(/btn-stop[\s\S]{0,200}outline/);
  });

  it('does not show stop button when pipeline_status is completed', () => {
    const run = { ...baseRun, pipeline_status: 'completed' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('btn-stop');
  });

  it('does not show stop button when pipeline_status is failed', () => {
    const run = { ...baseRun, pipeline_status: 'failed' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('btn-stop');
  });
});

// ─── No controls when status is neutral ──────────────────────────────────────

describe('runDetailView - no controls for terminal/neutral statuses', () => {
  it('does not render run-controls div when pipeline_status is completed', () => {
    const run = { ...baseRun, pipeline_status: 'completed' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('run-controls');
  });

  it('does not render run-controls div when pipeline_status is pending', () => {
    const run = { ...baseRun, pipeline_status: 'pending' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('run-controls');
  });

  it('does not render run-controls div when pipeline_status is absent', () => {
    const run = { ...baseRun };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('run-controls');
  });
});

// ─── Stop dialog ──────────────────────────────────────────────────────────────

describe('runDetailView - stop confirmation dialog', () => {
  it('includes sl-dialog when stop button is visible', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('sl-dialog');
    expect(html).toContain('run-controls-stop-dialog');
  });

  it('includes sl-dialog when status is paused', () => {
    const run = { ...baseRun, pipeline_status: 'paused' };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('run-controls-stop-dialog');
  });

  it('does not include stop dialog when status is completed', () => {
    const run = { ...baseRun, pipeline_status: 'completed' };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('run-controls-stop-dialog');
  });
});

// ─── Loading / pending state ──────────────────────────────────────────────────

describe('runDetailView - control buttons pending state', () => {
  it('adds control-pending-pause class to pause button when controlPending is pause', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run, {}, { controlPending: 'pause' }));
    expect(html).toContain('control-pending-pause');
  });

  it('does not add control-pending-pause class when controlPending is null', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run, {}, { controlPending: null }));
    expect(html).not.toContain('control-pending-pause');
  });

  it('adds control-pending-resume class to resume button when controlPending is resume', () => {
    const run = { ...baseRun, pipeline_status: 'paused' };
    const html = renderToString(runDetailView(run, {}, { controlPending: 'resume' }));
    expect(html).toContain('control-pending-resume');
  });

  it('adds control-pending-stop class to stop button when controlPending is stop', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run, {}, { controlPending: 'stop' }));
    expect(html).toContain('control-pending-stop');
  });

  it('does not add control-pending-stop class when controlPending is null', () => {
    const run = { ...baseRun, pipeline_status: 'running' };
    const html = renderToString(runDetailView(run, {}));
    expect(html).not.toContain('control-pending-stop');
  });
});
