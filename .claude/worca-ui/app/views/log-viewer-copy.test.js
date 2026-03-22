import { describe, it, expect } from 'vitest';
import { logViewerView } from './log-viewer.js';

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
      else if (typeof v === 'boolean') result += '';
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v && v.strings) result += renderToString(v);
    }
  });
  return result;
}

const BASE_STATE = {
  logLines: [{ stage: 'plan', line: 'Planning done' }],
  currentLogStage: 'plan',
  currentLogIteration: null,
};

const BASE_OPTS = {
  onStageFilter: () => {},
  onIterationFilter: () => {},
  onSearch: () => {},
  onToggleAutoScroll: () => {},
  autoScroll: true,
  stageIterations: {},
  runStages: { plan: {}, implement: {} },
};

describe('log-viewer copy button', () => {
  it('renders copy button with class terminal-copy-btn when stage selected', () => {
    const html = renderToString(logViewerView(BASE_STATE, BASE_OPTS));
    expect(html).toContain('terminal-copy-btn');
  });

  it('renders copy button inside log-controls section', () => {
    const html = renderToString(logViewerView(BASE_STATE, BASE_OPTS));
    const controlsStart = html.indexOf('log-controls');
    const copyBtnPos = html.indexOf('terminal-copy-btn');
    expect(controlsStart).toBeGreaterThan(-1);
    expect(copyBtnPos).toBeGreaterThan(controlsStart);
  });

  it('does not render copy button when no stage selected', () => {
    const state = { ...BASE_STATE, currentLogStage: null };
    const html = renderToString(logViewerView(state, BASE_OPTS));
    expect(html).not.toContain('terminal-copy-btn');
  });

  it('renders copy button when currentLogStage is a stage name', () => {
    const state = { ...BASE_STATE, currentLogStage: 'implement' };
    const html = renderToString(logViewerView(state, BASE_OPTS));
    expect(html).toContain('terminal-copy-btn');
  });

  it('does not render copy button when currentLogStage is wildcard', () => {
    const state = { ...BASE_STATE, currentLogStage: '*' };
    const html = renderToString(logViewerView(state, BASE_OPTS));
    expect(html).not.toContain('terminal-copy-btn');
  });
});
