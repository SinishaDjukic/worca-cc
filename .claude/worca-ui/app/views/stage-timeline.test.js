import { describe, it, expect } from 'vitest';
import { stageTimelineView } from './stage-timeline.js';

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
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v && v.strings) result += renderToString(v);
      // unsafeHTML directives are objects with _$litDirective$ — skip them
    }
  });
  return result;
}

describe('stage-timeline STAGE_ICON', () => {
  it('renders skipped stage with status-skipped class', () => {
    const stages = { learn: { status: 'skipped' } };
    const result = stageTimelineView(stages, {}, true);
    const html = renderToString(result);
    expect(html).toContain('status-skipped');
  });

  it('does not pulse or spin for skipped status', () => {
    const stages = { learn: { status: 'skipped' } };
    const result = stageTimelineView(stages, {}, true);
    const html = renderToString(result);
    expect(html).not.toContain('pulse');
    expect(html).not.toContain('icon-spin');
  });

  it('renders completed stage with status-completed class', () => {
    const stages = { build: { status: 'completed' } };
    const html = renderToString(stageTimelineView(stages, {}, true));
    expect(html).toContain('status-completed');
  });

  it('renders running stage with status-running class and pulse', () => {
    const stages = { build: { status: 'running' } };
    const html = renderToString(stageTimelineView(stages, {}, true));
    expect(html).toContain('status-running');
    expect(html).toContain('pulse');
  });

  it('renders in_progress stage with status-in-progress class and pulse', () => {
    const stages = { build: { status: 'in_progress' } };
    const html = renderToString(stageTimelineView(stages, {}, true));
    expect(html).toContain('status-in-progress');
    expect(html).toContain('pulse');
  });

  it('renders failed stage with status-failed class', () => {
    const stages = { build: { status: 'failed' } };
    const html = renderToString(stageTimelineView(stages, {}, true));
    expect(html).toContain('status-failed');
  });

  it('does not pulse for failed status', () => {
    const stages = { build: { status: 'failed' } };
    const html = renderToString(stageTimelineView(stages, {}, true));
    expect(html).not.toContain('pulse');
  });

  it('renders paused stage with status-paused class', () => {
    const stages = { build: { status: 'paused' } };
    const html = renderToString(stageTimelineView(stages, {}, true));
    expect(html).toContain('status-paused');
  });

  it('does not pulse for paused status', () => {
    const stages = { build: { status: 'paused' } };
    const html = renderToString(stageTimelineView(stages, {}, true));
    expect(html).not.toContain('pulse');
  });

  it('renders pending stage with status-pending class', () => {
    const stages = { build: { status: 'pending' } };
    const html = renderToString(stageTimelineView(stages, {}, true));
    expect(html).toContain('status-pending');
  });
});
