import { describe, expect, it } from 'vitest';
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
      else if (v?.strings) result += renderToString(v);
    }
  });
  return result;
}

const BASE_STATE = {
  logLines: [
    { stage: 'implement', line: 'building', stream: 'out' },
    { stage: 'implement', line: 'Overloaded, retrying', stream: 'err' },
  ],
  currentLogStage: 'implement',
  currentLogIteration: null,
};

const BASE_OPTS = {
  onStageFilter: () => {},
  onIterationFilter: () => {},
  onStreamFilter: () => {},
  onSearch: () => {},
  onToggleAutoScroll: () => {},
  autoScroll: true,
  streamFilter: 'all',
  stageIterations: {},
  runStages: { plan: {}, implement: {} },
};

describe('log-viewer stream filter control', () => {
  it('renders a segmented sl-radio-group, not a 3rd sl-select', () => {
    const html = renderToString(logViewerView(BASE_STATE, BASE_OPTS));
    expect(html).toContain('log-stream-filter');
    expect(html).toContain('sl-radio-group');
    expect(html).toContain('sl-radio-button');
  });

  it('offers all / out / error options', () => {
    const html = renderToString(logViewerView(BASE_STATE, BASE_OPTS));
    expect(html).toContain('value="all"');
    expect(html).toContain('value="out"');
    expect(html).toContain('value="err"');
    expect(html).toContain('Out');
    expect(html).toContain('Error');
  });

  it('places the stream filter after search (and before the Auto button)', () => {
    const state = {
      ...BASE_STATE,
      currentLogIteration: 2,
    };
    const opts = { ...BASE_OPTS, stageIterations: { implement: 2 } };
    const html = renderToString(logViewerView(state, opts));
    const streamPos = html.indexOf('log-stream-filter');
    const searchPos = html.indexOf('log-search');
    expect(searchPos).toBeGreaterThan(-1);
    expect(streamPos).toBeGreaterThan(searchPos);
  });

  it('renders without an explicit streamFilter (defaults work)', () => {
    const opts = { ...BASE_OPTS };
    opts.streamFilter = undefined;
    const html = renderToString(logViewerView(BASE_STATE, opts));
    expect(html).toContain('log-stream-filter');
  });
});
