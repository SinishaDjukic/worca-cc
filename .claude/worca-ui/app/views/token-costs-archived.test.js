import { describe, expect, it } from 'vitest';
import { tokenCostsView } from './token-costs.js';

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

function makeRun(id, costUsd, archived = false) {
  return {
    id,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T01:00:00Z',
    stages: {
      plan: {
        iterations: [{ cost_usd: costUsd, number: 1 }],
      },
    },
    ...(archived
      ? { archived: true, archived_at: '2026-03-01T00:00:00Z' }
      : {}),
  };
}

describe('tokenCostsView — includes archived runs in cost totals', () => {
  it('includes archived runs in total cost', () => {
    const state = {
      runs: { r1: makeRun('r1', 1.5) },
      archivedRuns: { r2: makeRun('r2', 2.0, true) },
    };
    const output = renderToString(
      tokenCostsView(state, { tokenData: {}, onToggleRun: () => {} }),
    );
    // Total should be $3.50 (1.5 + 2.0)
    expect(output).toContain('$3.50');
  });

  it('includes archived runs in run count', () => {
    const state = {
      runs: { r1: makeRun('r1', 1.0) },
      archivedRuns: { r2: makeRun('r2', 0.5, true) },
    };
    const output = renderToString(
      tokenCostsView(state, { tokenData: {}, onToggleRun: () => {} }),
    );
    // Run count should be 2
    expect(output).toContain('2');
    expect(output).toContain('Runs');
  });

  it('shows archived runs in the run list', () => {
    const state = {
      runs: { r1: makeRun('r1', 1.0) },
      archivedRuns: { r2: makeRun('r2', 0.5, true) },
    };
    const output = renderToString(
      tokenCostsView(state, { tokenData: {}, onToggleRun: () => {} }),
    );
    // Both runs should appear in the cost-by-run list
    expect(output).toContain('$1.00');
    expect(output).toContain('$0.50');
  });

  it('works with empty archivedRuns', () => {
    const state = {
      runs: { r1: makeRun('r1', 2.0) },
      archivedRuns: {},
    };
    const output = renderToString(
      tokenCostsView(state, { tokenData: {}, onToggleRun: () => {} }),
    );
    expect(output).toContain('$2.00');
  });

  it('works with only archived runs and no active runs', () => {
    const state = {
      runs: {},
      archivedRuns: { r1: makeRun('r1', 3.0, true) },
    };
    const output = renderToString(
      tokenCostsView(state, { tokenData: {}, onToggleRun: () => {} }),
    );
    expect(output).toContain('$3.00');
  });

  it('computes correct average across both active and archived', () => {
    const state = {
      runs: { r1: makeRun('r1', 4.0) },
      archivedRuns: { r2: makeRun('r2', 2.0, true) },
    };
    const output = renderToString(
      tokenCostsView(state, { tokenData: {}, onToggleRun: () => {} }),
    );
    // Avg should be $3.00 (6.0 / 2)
    expect(output).toContain('$3.00');
  });
});
