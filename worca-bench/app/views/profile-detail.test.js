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
    expect(out).toContain('run-opt-timeout'); // per-build timeout field
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

  it("shows the profile's concurrency.worca as the Max parallel placeholder", () => {
    const withMp = renderToString(
      profileDetailView(
        { aggregate: { ...data.aggregate, max_parallel: 1 }, reps: [] },
        { onRun: () => {} },
      ),
    );
    // unquoted lit attribute binding -> `placeholder=1`
    expect(withMp).toMatch(/run-opt-parallel[\s\S]*?placeholder=1/);
    // Unspecified => generic "default".
    const noMp = renderToString(
      profileDetailView(
        { aggregate: { ...data.aggregate }, reps: [] },
        { onRun: () => {} },
      ),
    );
    expect(noMp).toMatch(/run-opt-parallel[\s\S]*?placeholder=default/);
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

  it('seeds the Graphify/CRG/Preflight run-option defaults from the profile', () => {
    const valAfter = (out, cls) =>
      out.match(new RegExp(`${cls}[\\s\\S]*?value=(\\w+)`))[1];
    const out = renderToString(
      profileDetailView(
        {
          aggregate: {
            ...data.aggregate,
            graphify: 'structural',
            code_review_graph: 'structural',
            preflight: 'off',
          },
          reps: [],
        },
        { onRun: () => {} },
      ),
    );
    expect(valAfter(out, 'run-opt-graphify')).toBe('structural');
    expect(valAfter(out, 'run-opt-crg')).toBe('structural');
    expect(valAfter(out, 'run-opt-preflight')).toBe('off');
    // Unspecified in the profile => the prior hardcoded fallbacks.
    const bare = renderToString(
      profileDetailView(
        { aggregate: { ...data.aggregate }, reps: [] },
        {
          onRun: () => {},
        },
      ),
    );
    expect(valAfter(bare, 'run-opt-graphify')).toBe('off');
    expect(valAfter(bare, 'run-opt-crg')).toBe('off');
    expect(valAfter(bare, 'run-opt-preflight')).toBe('on');
  });

  it('disables the Run button (label + title) when a run is already in progress', () => {
    const disabled = renderToString(
      profileDetailView(data, { onRun: () => {}, runDisabled: true }),
    );
    expect(disabled).toContain('Running…');
    expect(disabled).toContain('A run is already in progress');
    const enabled = renderToString(
      profileDetailView(data, { onRun: () => {} }),
    );
    expect(enabled).not.toContain('Running…');
    expect(enabled).toContain('Launch a run'); // enabled title
  });

  it('seeds the Timeout field from the profile and tooltip-wraps the label', () => {
    const withTo = renderToString(
      profileDetailView(
        { aggregate: { ...data.aggregate, timeout: 1800 }, reps: [] },
        { onRun: () => {} },
      ),
    );
    expect(withTo).toContain('run-opt-timeout');
    // unquoted lit attribute binding -> `placeholder=1800` (prefilled from profile)
    expect(withTo).toMatch(/run-opt-timeout[\s\S]*?placeholder=1800/);
    // label carries an sl-tooltip explaining the value semantics
    expect(withTo).toContain('sl-tooltip');
    expect(withTo).toContain('Timeout (s)');
    expect(withTo).toContain('0 = no limit');
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
              {
                name: 'implement',
                status: 'pending',
                beads: { done: 1, total: 3 },
                iters: 6,
              },
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
    expect(out).toContain('Coordinate'); // human label (worca-ui parity)
    expect(out).toContain('astropy__astropy-12907'); // instance shown
    expect(out).toContain('rep 1');
    expect(out).toContain('Grade'); // grading pseudo-chip, set-apart
    expect(out).toContain('stage-chip-sep'); // spacer before Grade
    expect(out).toContain('1/3'); // bead progress inside the Implement chip
    expect(out).toContain('×6'); // loop-back count
  });

  it('orders live stage chips by canonical worca order, not status.json order', () => {
    const out = renderToString(
      profileDetailView({
        aggregate: { ...data.aggregate, active: true },
        reps: [],
        active: [
          {
            kind: 'rep',
            phase: 'running',
            stage: 'plan_review',
            instance: 'x',
            rep: 1,
            // Deliberately scrambled (plan_review last, like the raw payload).
            stages: [
              { name: 'pr', status: 'pending' },
              { name: 'preflight', status: 'completed' },
              { name: 'plan_review', status: 'in_progress' },
              { name: 'plan', status: 'completed' },
            ],
          },
        ],
      }),
    );
    // Scope to the chips container so the "Running Plan Review" head label
    // doesn't confound the index comparison.
    const chips = out.slice(out.indexOf('stage-chips'));
    // Canonical order: Preflight < Plan < Plan Review < PR.
    const iPreflight = chips.indexOf('>Preflight<');
    const iPlan = chips.indexOf('>Plan<');
    const iPlanReview = chips.indexOf('>Plan Review<');
    const iPr = chips.indexOf('>PR<');
    expect(iPreflight).toBeGreaterThanOrEqual(0);
    expect(iPreflight).toBeLessThan(iPlan);
    expect(iPlan).toBeLessThan(iPlanReview);
    expect(iPlanReview).toBeLessThan(iPr);
    // The "Running <stage>" label is humanized too, never the raw key.
    expect(out).toContain('Plan Review');
    expect(out).not.toMatch(/>plan_review</); // raw key never shown
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
    expect(out).toContain('Grade');
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
