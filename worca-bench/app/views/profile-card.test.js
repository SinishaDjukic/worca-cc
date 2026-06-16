import { describe, expect, it } from 'vitest';
import { profileCardView } from './profile-card.js';

// Mirrors the worca-ui renderToString helper: walks the lit-html template
// tree, inlining strings/numbers/arrays/nested templates. unsafeHTML directives
// and functions are skipped (the static prefix is still captured).
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

function agg(overrides = {}) {
  return {
    name: 'smoke-feature-opus',
    src: 'srchash1',
    benchmark: 'swe-bench-verified',
    worca_ref: 'local',
    template: 'builtin:feature',
    reps: 4,
    graded: 4,
    resolved: 4,
    resolved_rate: 1.0,
    mean_cost_usd: 0.42,
    mean_wall_s: 612,
    mean_iterations: 2,
    last_run: '2026-06-16T10:00:00Z',
    ...overrides,
  };
}

describe('profileCardView', () => {
  it('applies the resolved status class when fully resolved', () => {
    const out = renderToString(profileCardView(agg()));
    expect(out).toContain('run-card');
    expect(out).toContain('status-completed');
  });

  it('uses the success badge variant for a fully-resolved profile', () => {
    const out = renderToString(profileCardView(agg()));
    expect(out).toContain('variant="success"');
  });

  it('uses the danger variant when nothing resolved', () => {
    const out = renderToString(
      profileCardView(agg({ resolved: 0, resolved_rate: 0 })),
    );
    expect(out).toContain('variant="danger"');
    expect(out).toContain('status-failed');
  });

  it('uses the warning variant for a partial resolve rate', () => {
    const out = renderToString(
      profileCardView(agg({ resolved: 2, resolved_rate: 0.5 })),
    );
    expect(out).toContain('variant="warning"');
    expect(out).toContain('status-paused');
  });

  it('uses the neutral pending variant when no reps are graded', () => {
    const out = renderToString(
      profileCardView(agg({ graded: 0, resolved: 0, resolved_rate: 0 })),
    );
    expect(out).toContain('status-pending');
  });

  it('does NOT hardcode an inline variant="success" ladder in source', async () => {
    // The card must route every badge variant through the central variant map
    // (utils/badge.js), never inline a per-status literal ladder in the view.
    const fs = await import('node:fs');
    const url = await import('node:url');
    const src = fs.readFileSync(
      url.fileURLToPath(new URL('./profile-card.js', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/variant="success"/);
    expect(src).not.toMatch(/variant="danger"/);
    expect(src).toContain('variantFor(');
  });

  it('renders the profile name and benchmark', () => {
    const out = renderToString(profileCardView(agg()));
    expect(out).toContain('smoke-feature-opus');
    expect(out).toContain('swe-bench-verified');
  });

  it('renders a compare checkbox only when selection is enabled', () => {
    expect(renderToString(profileCardView(agg()))).not.toContain(
      'run-card-select',
    );
    const out = renderToString(
      profileCardView(agg(), { onToggleSelect: () => {} }),
    );
    expect(out).toContain('run-card-select');
  });

  it('marks the card selected when its name@src key is in the selected set', () => {
    const out = renderToString(
      profileCardView(agg(), {
        selected: new Set(['smoke-feature-opus@srchash1']),
        onToggleSelect: () => {},
      }),
    );
    expect(out).toContain('run-card--selected');
  });

  it('shows the source label only when a name is duplicated (showSource)', () => {
    expect(renderToString(profileCardView(agg()))).not.toContain('Source:');
    const out = renderToString(profileCardView(agg(), { showSource: true }));
    expect(out).not.toContain('Source:'); // no source_label on the fixture
    const out2 = renderToString(
      profileCardView(agg({ source_label: 'results-b' }), { showSource: true }),
    );
    expect(out2).toContain('Source:');
    expect(out2).toContain('results-b');
  });

  it('shows a running badge with the current stage when active', () => {
    const out = renderToString(
      profileCardView(agg({ active: true, stage: 'coordinate' })),
    );
    expect(out).toContain('run-card-running');
    expect(out).toContain('running');
    expect(out).toContain('coordinate');
  });

  it('labels the grading phase distinctly', () => {
    const out = renderToString(
      profileCardView(
        agg({ active: true, phase: 'grading', stage: 'implement' }),
      ),
    );
    expect(out).toContain('grading');
    expect(out).not.toContain('running · implement');
  });

  it('labels an active canary run as canary', () => {
    const out = renderToString(
      profileCardView(
        agg({ active: true, active_kind: 'canary', stage: 'plan' }),
      ),
    );
    expect(out).toContain('canary');
  });
});
