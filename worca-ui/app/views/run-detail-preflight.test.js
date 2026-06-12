// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { runDetailView } from './run-detail.js';

function renderToString(template) {
  if (!template) return '';
  if (template.overview)
    return renderToString(template.overview) + renderToString(template.stages);
  if (typeof template === 'string') return template;
  if (template._$litDirective$ && template.values)
    return template.values[0] || '';
  if (!template.strings) return String(template);
  let result = '';
  template.strings.forEach((s, i) => {
    result += s;
    if (i < template.values.length) {
      const v = template.values[i];
      if (typeof v === 'string') result += v;
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v?.strings) result += renderToString(v);
      else if (v?._$litDirective$ && v?.values) result += v.values[0] || '';
    }
  });
  return result;
}

describe('runDetailView preflight stage', () => {
  const checks = [
    { name: 'claude_cli', status: 'pass', message: 'claude CLI 1.0.40' },
    { name: 'bd_cli', status: 'fail', message: 'bd command not found in PATH' },
    {
      name: 'node_available',
      status: 'warn',
      message: 'node not found (optional)',
    },
  ];
  const summary = '2/3 checks passed, 1 failed, 1 warning';

  function _makeRun(stageOverride) {
    return {
      stages: {
        preflight: {
          status: 'completed',
          iterations: [
            {
              number: 1,
              status: 'completed',
              ...stageOverride,
            },
          ],
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
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: { status: 'pass', checks, summary },
            },
          ],
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
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: { status: 'pass', checks, summary },
            },
          ],
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
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: { status: 'pass', checks, summary },
            },
          ],
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
          iterations: [
            {
              number: 1,
              status: 'completed',
            },
          ],
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
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'skipped',
              output: {
                status: 'skipped',
                checks: [],
                summary: 'preflight skipped (script not found)',
              },
            },
          ],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Skipped');
    expect(html).not.toContain('preflight-table');
  });

  it('renders preflight summary as markdown HTML', () => {
    const run = {
      stages: {
        preflight: {
          status: 'completed',
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: {
                status: 'pass',
                checks: [],
                summary: '**All checks** passed',
              },
            },
          ],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('<strong>All checks</strong>');
  });

  it('renders preflight check messages as markdown HTML', () => {
    const run = {
      stages: {
        preflight: {
          status: 'completed',
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: {
                status: 'pass',
                checks: [
                  {
                    name: 'test_check',
                    status: 'pass',
                    message: 'Found `claude` CLI version **1.0**',
                  },
                ],
                summary: '',
              },
            },
          ],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('<strong>1.0</strong>');
    expect(html).toContain('<code>claude</code>');
  });

  it('does not render preflight-checks-view for non-preflight stages', () => {
    const run = {
      stages: {
        plan: {
          status: 'completed',
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: { checks, summary },
            },
          ],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('preflight-checks-view');
  });

  it('renders the summary as a labeled "Status:" meta row (not the old muted style)', () => {
    const run = _makeRun({
      outcome: 'success',
      output: { status: 'pass', checks: [], summary },
      _stageExtras: {},
    });
    const html = renderToString(runDetailView(run));
    // New: "Status:" meta-label in an iteration-tags row, value carries meta-value.
    expect(html).toContain('preflight-status-row');
    expect(html).toContain('Status:');
    expect(html).toContain('meta-value');
    expect(html).toContain(summary);
    // Old muted markdown-only style is gone.
    expect(html).not.toContain('preflight-summary');
  });

  // Helper: wrap top-level run fields around a minimal completed preflight stage.
  function _runWith(fields) {
    return {
      ...fields,
      stages: {
        preflight: {
          status: 'completed',
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: { status: 'pass', checks: [], summary },
            },
          ],
        },
      },
    };
  }

  it('shows Size/Loop multiplier pills only when explicitly set', () => {
    const html = renderToString(
      runDetailView(
        _runWith({
          size_multiplier: 3,
          loop_multiplier: 2,
          max_beads_effective: 12,
          max_beads_source: 'explicit',
        }),
      ),
    );
    expect(html).toContain('preflight-params-row');
    expect(html).toContain('Size Multiplier:');
    expect(html).toContain('Loop Multiplier:');
    expect(html).toContain('Max Beads:');
    expect(html).toContain('preflight-param-badge');
  });

  it('still renders the params row (Max Beads always shown) with Size/Loop omitted at defaults', () => {
    const html = renderToString(
      runDetailView(
        _runWith({
          // size/loop default to 1 → omitted; Max Beads is always present.
          size_multiplier: 1,
          loop_multiplier: 1,
          max_beads_effective: 0,
          max_beads_source: 'template',
        }),
      ),
    );
    expect(html).toContain('preflight-params-row');
    expect(html).toContain('Max Beads:');
    // Size/Loop are still gated on > 1.
    expect(html).not.toContain('Size Multiplier:');
    expect(html).not.toContain('Loop Multiplier:');
  });

  // --- Max Beads resolution: three branches + (Auto)/source-omitted ---

  it('branch 1: new fields → effective value pill + source pill', () => {
    const html = renderToString(
      runDetailView(
        _runWith({ max_beads_effective: 1, max_beads_source: 'template' }),
      ),
    );
    expect(html).toContain('Max Beads:');
    expect(html).toContain('>1<'); // value pill text
    expect(html).toContain('preflight-param-source-badge');
    expect(html).toContain('template'); // source pill text
  });

  it('branch 1: explicit source renders "explicit" pill', () => {
    const html = renderToString(
      runDetailView(
        _runWith({ max_beads_effective: 4, max_beads_source: 'explicit' }),
      ),
    );
    expect(html).toContain('>4<');
    expect(html).toContain('preflight-param-source-badge');
    expect(html).toContain('explicit');
  });

  it('branch 2 (legacy): max_beads_override only → value + "explicit" source', () => {
    const html = renderToString(
      runDetailView(_runWith({ max_beads_override: 7 })),
    );
    expect(html).toContain('Max Beads:');
    expect(html).toContain('>7<');
    expect(html).toContain('preflight-param-source-badge');
    expect(html).toContain('explicit');
  });

  it('branch 3 (legacy auto): neither field → "0 (Auto)" and NO source pill', () => {
    const html = renderToString(runDetailView(_runWith({})));
    expect(html).toContain('Max Beads:');
    expect(html).toContain('0 (Auto)');
    // Source is unknown for legacy auto runs → source pill omitted.
    expect(html).not.toContain('preflight-param-source-badge');
  });

  it('renders "0 (Auto)" for an effective cap of 0 (with known source)', () => {
    const html = renderToString(
      runDetailView(
        _runWith({ max_beads_effective: 0, max_beads_source: 'template' }),
      ),
    );
    expect(html).toContain('0 (Auto)');
    expect(html).toContain('preflight-param-source-badge');
    expect(html).toContain('template');
  });
});

describe('preflight flow fingerprint row (W-070)', () => {
  const FP = 'ddf975025ca4431f558718e62d26773ce59c49f1f1fd1602b18a3f27c8e0e615';

  function _runWithFingerprint(fingerprint) {
    const run = {
      stages: {
        preflight: {
          status: 'completed',
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: {
                status: 'pass',
                checks: [{ name: 'claude_cli', status: 'pass', message: 'ok' }],
                summary: '1/1 checks passed, 0 failed, 0 warnings',
              },
            },
          ],
        },
      },
    };
    if (fingerprint) run.flow_fingerprint = fingerprint;
    return run;
  }

  it('renders the fingerprint label and full value when present', () => {
    const html = renderToString(runDetailView(_runWithFingerprint(FP)));
    expect(html).toContain('Flow fingerprint:');
    expect(html).toContain(FP);
    expect(html).toContain('preflight-flow-fingerprint');
  });

  it('omits the row entirely when flow_fingerprint is absent (legacy runs)', () => {
    const html = renderToString(runDetailView(_runWithFingerprint(null)));
    expect(html).not.toContain('Flow fingerprint:');
    expect(html).not.toContain('preflight-flow-fingerprint');
  });
});

describe('multi-iteration preflight parity', () => {
  // A resumed run re-runs preflight → 2+ iterations. Each iter tab must show
  // its own full results (status summary + checks table), and the run-level
  // meta rows (params, fingerprint) render once at stage level.
  const FP = 'ddf975025ca4431f558718e62d26773ce59c49f1f1fd1602b18a3f27c8e0e615';

  function _multiIterRun() {
    return {
      flow_fingerprint: FP,
      stages: {
        preflight: {
          status: 'completed',
          iterations: [
            {
              number: 1,
              status: 'completed',
              outcome: 'success',
              output: {
                status: 'pass',
                checks: [
                  { name: 'claude_cli', status: 'pass', message: 'iter1 ok' },
                ],
                summary: '10/10 checks passed, 0 failed, 0 warnings',
              },
            },
            {
              number: 2,
              status: 'completed',
              outcome: 'success',
              output: {
                status: 'pass',
                checks: [
                  { name: 'claude_cli', status: 'pass', message: 'iter2 ok' },
                ],
                summary: '9/10 checks passed, 0 failed, 1 warning',
              },
            },
          ],
        },
      },
    };
  }

  it('renders each iteration summary and checks inside its tab', () => {
    const html = renderToString(runDetailView(_multiIterRun()));
    expect(html).toContain('10/10 checks passed, 0 failed, 0 warnings');
    expect(html).toContain('9/10 checks passed, 0 failed, 1 warning');
    expect(html).toContain('iter1 ok');
    expect(html).toContain('iter2 ok');
    // Both panels carry the full table.
    expect(html.split('preflight-table').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('renders run-level meta (fingerprint) exactly once at stage level', () => {
    const html = renderToString(runDetailView(_multiIterRun()));
    expect(html.split('Flow fingerprint:').length - 1).toBe(1);
    expect(html).toContain(FP);
  });
});
