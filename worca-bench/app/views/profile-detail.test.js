import { describe, expect, it } from 'vitest';
import { profileDetailView } from './profile-detail.js';

// Same renderToString helper used across the worca-bench view tests.
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

const data = {
  aggregate: {
    name: 'demo',
    benchmark: 'swe-bench-verified',
    reps: 4,
    resolved_rate: 0.5,
    mean_cost_usd: 0.4,
    mean_wall_s: 600,
    mean_iterations: 2,
  },
  reps: [],
};

describe('profileDetailView', () => {
  it('omits the Run options block when no onRun handler is given', () => {
    expect(renderToString(profileDetailView(data))).not.toContain(
      'run-options',
    );
  });

  it('renders Run options (reps + max instances) when onRun is provided', () => {
    const out = renderToString(profileDetailView(data, { onRun: () => {} }));
    expect(out).toContain('run-options');
    expect(out).toContain('run-opt-reps');
    expect(out).toContain('run-opt-instances');
    // reps input is seeded with the profile's default as a placeholder
    // (unquoted lit attribute binding -> `placeholder=4`)
    expect(out).toContain('placeholder=4');
    expect(out).toContain('placeholder="all"');
  });

  it('renders a Configuration block with worca/template/benchmark/grade', () => {
    const out = renderToString(
      profileDetailView({
        aggregate: {
          ...data.aggregate,
          worca_version: '0.58.0',
          worca_ref: 'local@abc',
          template: 'builtin:quick-fix',
          grade_mode: 'local-docker',
        },
        reps: [],
      }),
    );
    expect(out).toContain('config-meta');
    expect(out).toContain('Configuration');
    expect(out).toContain('0.58.0 (local@abc)');
    expect(out).toContain('builtin:quick-fix');
    expect(out).toContain('local-docker');
  });
});
