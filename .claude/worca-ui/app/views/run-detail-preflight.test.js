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
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v && v.strings) result += renderToString(v);
    }
  });
  return result;
}

describe('runDetailView preflight stage', () => {
  const checks = [
    { name: 'claude_cli', status: 'pass', message: 'claude CLI 1.0.40' },
    { name: 'bd_cli', status: 'fail', message: 'bd command not found in PATH' },
    { name: 'node_available', status: 'warn', message: 'node not found (optional)' },
  ];
  const summary = '2/3 checks passed, 1 failed, 1 warning';

  function makeRun(stageOverride) {
    return {
      stages: {
        preflight: {
          status: 'completed',
          iterations: [{
            number: 1,
            status: 'completed',
            ...stageOverride,
          }],
          ...stageOverride._stageExtras,
        },
      },
    };
  }

  it('renders preflight-checks-view for preflight stage with checks', () => {
    const run = {
      stages: {
        preflight: {
          status: 'completed',
          iterations: [{
            number: 1,
            status: 'completed',
            outcome: 'success',
            output: { status: 'pass', checks, summary },
          }],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('preflight-checks-view');
    expect(html).toContain(summary);
  });

  it('renders a row for each check', () => {
    const run = {
      stages: {
        preflight: {
          status: 'completed',
          iterations: [{
            number: 1,
            status: 'completed',
            outcome: 'success',
            output: { status: 'pass', checks, summary },
          }],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('claude_cli');
    expect(html).toContain('claude CLI 1.0.40');
    expect(html).toContain('bd_cli');
    expect(html).toContain('bd command not found in PATH');
    expect(html).toContain('node_available');
    expect(html).toContain('node not found (optional)');
  });

  it('uses correct sl-badge variants for check statuses', () => {
    const run = {
      stages: {
        preflight: {
          status: 'completed',
          iterations: [{
            number: 1,
            status: 'completed',
            outcome: 'success',
            output: { status: 'pass', checks, summary },
          }],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    // pass → success, fail → danger, warn → warning
    expect(html).toContain('variant="success"');
    expect(html).toContain('variant="danger"');
    expect(html).toContain('variant="warning"');
  });

  it('shows Skipped badge when stage.skipped is true', () => {
    const run = {
      stages: {
        preflight: {
          status: 'completed',
          skipped: true,
          iterations: [{
            number: 1,
            status: 'completed',
          }],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('preflight-checks-view');
    expect(html).toContain('Skipped');
    // Should NOT render a checks table when skipped
    expect(html).not.toContain('preflight-table');
  });

  it('shows Skipped badge when iter outcome is skipped', () => {
    const run = {
      stages: {
        preflight: {
          status: 'completed',
          skipped: true,
          iterations: [{
            number: 1,
            status: 'completed',
            outcome: 'skipped',
            output: { status: 'skipped', checks: [], summary: 'preflight skipped (script not found)' },
          }],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Skipped');
    expect(html).not.toContain('preflight-table');
  });

  it('does not render preflight-checks-view for non-preflight stages', () => {
    const run = {
      stages: {
        plan: {
          status: 'completed',
          iterations: [{
            number: 1,
            status: 'completed',
            outcome: 'success',
            output: { checks, summary },
          }],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('preflight-checks-view');
  });
});
