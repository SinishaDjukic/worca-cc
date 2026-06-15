import { describe, expect, it } from 'vitest';
import { runDetailView } from './run-detail.js';

function renderToString(template) {
  if (!template) return '';
  if (template.overview)
    return renderToString(template.overview) + renderToString(template.stages);
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

function makePreflightRun(provenance) {
  const run = {
    stages: {
      preflight: {
        status: 'completed',
        iterations: [
          {
            number: 1,
            status: 'completed',
            outcome: 'success',
            output: { checks: [], summary: 'ok' },
          },
        ],
      },
    },
  };
  if (provenance !== undefined) run.provenance = provenance;
  return run;
}

describe('_preflightProvenanceRow', () => {
  it('git case renders version + repo@sha + branch pills; dirty pill with warning variant', () => {
    const run = makePreflightRun({
      worca_version: '0.57.0',
      runtime_source: {
        source: 'git',
        repo: 'worca-cc',
        commit: 'ba1795b8abcdef01',
        branch: 'main',
        dirty: true,
      },
    });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Runtime:');
    expect(html).toContain('worca 0.57.0');
    expect(html).toContain('worca-cc@ba1795b8');
    expect(html).toContain('main');
    expect(html).toContain('dirty');
    expect(html).toContain('variant="warning"');
  });

  it('pip case renders version + pip pill only', () => {
    const run = makePreflightRun({
      worca_version: '0.55.0',
      runtime_source: { source: 'pip' },
    });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Runtime:');
    expect(html).toContain('worca 0.55.0');
    // pip pill rendered as badge text
    expect(html).toMatch(/>pip</);
    expect(html).not.toContain('dirty');
    expect(html).not.toContain('variant="warning"');
  });

  it('degraded case (runtime_source null) renders version pill only', () => {
    const run = makePreflightRun({
      worca_version: '0.50.0',
      runtime_source: null,
    });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Runtime:');
    expect(html).toContain('worca 0.50.0');
    // no pip badge
    expect(html).not.toMatch(/>pip</);
    expect(html).not.toContain('dirty');
  });

  it('row is absent when run has no provenance', () => {
    const run = makePreflightRun(undefined);
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('Runtime:');
  });
});
