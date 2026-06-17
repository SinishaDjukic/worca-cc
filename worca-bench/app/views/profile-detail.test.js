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

  it('renders Run options (reps + max instances + engine toggles) when onRun is provided', () => {
    const out = renderToString(profileDetailView(data, { onRun: () => {} }));
    expect(out).toContain('run-options');
    expect(out).toContain('run-opt-reps');
    expect(out).toContain('run-opt-instances');
    expect(out).toContain('run-opt-parallel'); // max parallel
    expect(out).toContain('run-opt-canary'); // canary toggle (on by default)
    expect(out).toContain('run-opt-graphify'); // graphify toggle
    expect(out).toContain('run-opt-crg'); // code-review-graph toggle
    expect(out).toContain('run-opt-preflight'); // preflight toggle (on by default)
    expect(out).toContain('run-opt-claudemd'); // CLAUDE.md dropdown
    expect(out).toContain('project+local'); // a CLAUDE.md option
    expect(out).toContain('run-opt-grader'); // grader dropdown
    expect(out).toContain('run-options-title'); // card-style header
    expect(out).toContain('run-options-row'); // controls row wrapper
    // reps input is seeded with the profile's default as a placeholder
    // (unquoted lit attribute binding -> `placeholder=4`)
    expect(out).toContain('placeholder=4');
    expect(out).toContain('placeholder="all"');
  });

  it('offers every grader backend in the grader dropdown (SWE-bench)', () => {
    const out = renderToString(profileDetailView(data, { onRun: () => {} }));
    expect(out).toContain('Local (Docker)');
    expect(out).toContain('SWE-bench Cloud (sb-cli)');
    expect(out).toContain('Modal (serverless x86)');
    expect(out).toContain('Stub (no grade)');
  });

  it('drops the sb-cli grader option for commit0 profiles', () => {
    const c0 = {
      aggregate: { ...data.aggregate, benchmark: 'commit0' },
      reps: [],
    };
    const out = renderToString(profileDetailView(c0, { onRun: () => {} }));
    // commit0 grades via `commit0 test` on local Docker or Modal — no hosted backend.
    expect(out).toContain('Local (Docker)');
    expect(out).toContain('Modal (serverless x86)');
    expect(out).toContain('Stub (no grade)');
    expect(out).not.toContain('SWE-bench Cloud (sb-cli)');
  });

  it('shows the Notes button only when onNotes is provided', () => {
    const withNotes = renderToString(
      profileDetailView(data, { onRun: () => {}, onNotes: () => {} }),
    );
    expect(withNotes).toContain('run-opt-notes');
    const without = renderToString(
      profileDetailView(data, { onRun: () => {} }),
    );
    expect(without).not.toContain('run-opt-notes');
  });

  it('defaults the Canary toggle to Off when the profile sets canary:false', () => {
    // The first `value=` after the canary radio-group's class is its default.
    const canaryVal = (out) =>
      out.match(/run-opt-canary[\s\S]*?value=(\w+)/)[1];
    const off = renderToString(
      profileDetailView(
        { aggregate: { ...data.aggregate, canary: false }, reps: [] },
        { onRun: () => {} },
      ),
    );
    expect(canaryVal(off)).toBe('off');
    // Unspecified (or true) => On.
    const on = renderToString(
      profileDetailView(
        { aggregate: { ...data.aggregate }, reps: [] },
        { onRun: () => {} },
      ),
    );
    expect(canaryVal(on)).toBe('on');
  });

  it('shows the fine-grained test count beside the score for Commit0 reps', () => {
    const withCount = {
      aggregate: { ...data.aggregate, benchmark: 'commit0' },
      reps: [
        {
          instance_id: 'wcwidth',
          rep: 1,
          status: 'graded',
          resolved: true,
          score: 1,
          tests_passed: 38,
          tests_total: 38,
          grade_mode: 'modal',
        },
      ],
    };
    const out = renderToString(profileDetailView(withCount, {}));
    expect(out).toContain('reps-testcount');
    expect(out).toContain('38/38');
  });

  it('shows score alone when no test counts are present', () => {
    const noCount = {
      aggregate: data.aggregate,
      reps: [
        {
          instance_id: 'astropy__astropy-12907',
          rep: 1,
          status: 'graded',
          score: 1,
        },
      ],
    };
    const out = renderToString(profileDetailView(noCount, {}));
    expect(out).not.toContain('reps-testcount');
  });

  it('renders a per-row regrade button when onRegrade is provided', () => {
    const withRep = {
      aggregate: data.aggregate,
      reps: [
        { instance_id: 'astropy__astropy-12907', rep: 1, status: 'error' },
      ],
    };
    const out = renderToString(
      profileDetailView(withRep, { onRegrade: () => {} }),
    );
    expect(out).toContain('<th>Action</th>');
    expect(out).toContain('reps-regrade-btn');
    expect(out).toContain('sl-tooltip');
  });

  it('omits the regrade button when no onRegrade handler is given', () => {
    const withRep = {
      aggregate: data.aggregate,
      reps: [
        { instance_id: 'astropy__astropy-12907', rep: 1, status: 'error' },
      ],
    };
    const out = renderToString(profileDetailView(withRep, {}));
    expect(out).toContain('<th>Action</th>'); // column header always present
    expect(out).not.toContain('reps-regrade-btn');
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

  it('shows per-rep engine metadata columns + the Duration header', () => {
    const out = renderToString(
      profileDetailView({
        aggregate: data.aggregate,
        reps: [
          {
            instance_id: 'astropy__astropy-1',
            rep: 1,
            status: 'graded',
            score: 1,
            cost_usd: 0.4,
            wall_time_s: 200,
            loop_counters: {},
            graphify: 'full',
            code_review_graph: 'structural',
          },
        ],
      }),
    );
    expect(out).toContain('Duration'); // renamed from Wall
    expect(out).not.toContain('<th>Wall</th>');
    expect(out).toContain('Graphify');
    expect(out).toContain('CRG');
    expect(out).toContain('full'); // graphify value
    expect(out).toContain('structural'); // crg value
  });

  it('renders the regrade progress block while a sweep is active', () => {
    const out = renderToString(
      profileDetailView({
        aggregate: data.aggregate,
        reps: [
          { instance_id: 'astropy__astropy-14539', rep: 1, status: 'error' },
        ],
        regrade: {
          active: true,
          mode: 'modal',
          total: 20,
          done: 7,
          current: 'astropy__astropy-14539',
          counts: { graded: 7, resolved: 4, error: 0 },
          started_at: '2026-06-17T06:00:00Z',
        },
      }),
    );
    expect(out).toContain('regrade-progress');
    expect(out).toContain('Regrading 7/20 via modal');
    expect(out).toContain('astropy__astropy-14539');
    expect(out).toContain('4 resolved');
    expect(out).toContain('reps-row--grading'); // the in-flight row is highlighted
  });

  it('omits the regrade progress block when no sweep is active', () => {
    const out = renderToString(
      profileDetailView({
        aggregate: data.aggregate,
        reps: [],
        regrade: { active: false, status: 'done' },
      }),
    );
    expect(out).not.toContain('regrade-progress');
  });

  it('wraps the status badge in a tooltip carrying grade provenance', () => {
    const out = renderToString(
      profileDetailView({
        aggregate: data.aggregate,
        reps: [
          {
            instance_id: 'astropy__astropy-12907',
            rep: 1,
            status: 'graded',
            resolved: true,
            score: 1,
            grade_mode: 'modal',
            regraded_at: '2026-06-17T06:12:00Z',
            report_path: '/logs/run/report.json',
          },
        ],
      }),
    );
    // The status cell is now tooltip-wrapped with a one-line provenance string.
    expect(out).toContain('resolved via modal');
    expect(out).toContain('score 1');
    expect(out).toContain('regraded 2026-06-17 06:12 UTC');
    expect(out).toContain('report: /logs/run/report.json');
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
