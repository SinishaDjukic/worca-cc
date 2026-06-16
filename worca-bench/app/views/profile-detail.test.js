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

  it('renders live stage chips for active runs', () => {
    const out = renderToString(
      profileDetailView({
        aggregate: { ...data.aggregate, active: true },
        reps: [],
        active: [
          {
            kind: 'rep',
            phase: 'running',
            instance: 'astropy__astropy-12907',
            rep: 1,
            started_at: '2026-06-16T10:00:00Z',
            stages: [
              { name: 'plan', status: 'completed' },
              { name: 'coordinate', status: 'in_progress' },
              { name: 'implement', status: 'pending' },
              { name: 'test', status: 'completed', skipped: true },
            ],
          },
        ],
      }),
    );
    expect(out).toContain('live-runs');
    expect(out).toContain('stage-chip--done'); // plan
    expect(out).toContain('stage-chip--active'); // coordinate
    expect(out).toContain('stage-chip--pending'); // implement
    expect(out).toContain('stage-chip--skipped'); // test
    expect(out).toContain('coordinate');
    expect(out).toContain('astropy__astropy-12907'); // instance shown
    expect(out).toContain('rep 1');
    expect(out).toContain('grade'); // grading pseudo-chip
  });

  it('labels the grading phase and marks the grade chip active', () => {
    const out = renderToString(
      profileDetailView({
        aggregate: { ...data.aggregate, active: true },
        reps: [],
        active: [
          {
            kind: 'rep',
            phase: 'grading',
            instance: 'x',
            rep: 1,
            stages: [{ name: 'implement', status: 'completed' }],
          },
        ],
      }),
    );
    expect(out).toContain('Grading');
    expect(out).toContain('grade');
  });

  it('renders no live section when there are no active runs', () => {
    const out = renderToString(profileDetailView({ ...data, active: [] }));
    expect(out).not.toContain('live-runs');
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
