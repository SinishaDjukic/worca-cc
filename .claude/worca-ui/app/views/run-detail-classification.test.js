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

describe('runDetailView classification strip', () => {
  const classification = {
    category: 'infra_transient',
    retriable: true,
    remediation: 'API rate limited. Wait 60s before retry.',
    similar_to_previous: false,
  };

  function makeRunSingleIter(classificationOverride = classification) {
    return {
      stages: {
        implement: {
          status: 'error',
          iterations: [{
            number: 1,
            status: 'error',
            outcome: 'error',
            classification: classificationOverride,
          }],
        },
      },
    };
  }

  it('renders classification-strip when iter has classification field', () => {
    const run = makeRunSingleIter();
    const html = renderToString(runDetailView(run));
    expect(html).toContain('classification-strip');
  });

  it('does not render classification-strip when iter has no classification', () => {
    const run = {
      stages: {
        implement: {
          status: 'error',
          iterations: [{ number: 1, status: 'error', outcome: 'error' }],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('classification-strip');
  });

  it('renders category badge with warning variant for infra_transient', () => {
    const run = makeRunSingleIter({ category: 'infra_transient', retriable: true, remediation: 'Retry later', similar_to_previous: false });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('infra_transient');
    expect(html).toContain('variant="warning"');
  });

  it('renders category badge with danger variant for infra_permanent', () => {
    const run = makeRunSingleIter({ category: 'infra_permanent', retriable: false, remediation: 'Auth failed', similar_to_previous: false });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('infra_permanent');
    expect(html).toContain('variant="danger"');
  });

  it('renders category badge with danger variant for logic_stuck', () => {
    const run = makeRunSingleIter({ category: 'logic_stuck', retriable: false, remediation: 'Change approach', similar_to_previous: true });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('logic_stuck');
    expect(html).toContain('variant="danger"');
  });

  it('renders category badge with danger variant for env_missing', () => {
    const run = makeRunSingleIter({ category: 'env_missing', retriable: false, remediation: 'Install tool', similar_to_previous: false });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('env_missing');
    expect(html).toContain('variant="danger"');
  });

  it('renders category badge with neutral variant for unknown', () => {
    const run = makeRunSingleIter({ category: 'unknown', retriable: false, remediation: '', similar_to_previous: false });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('classification-strip');
    expect(html).toContain('unknown');
    expect(html).toContain('variant="neutral"');
  });

  it('renders retriable yes when retriable is true', () => {
    const run = makeRunSingleIter();
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Retriable');
    expect(html).toContain('>yes<');
  });

  it('renders retriable no when retriable is false', () => {
    const run = makeRunSingleIter({ category: 'infra_permanent', retriable: false, remediation: 'Fix auth', similar_to_previous: false });
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Retriable');
    expect(html).toContain('>no<');
  });

  it('renders remediation text', () => {
    const run = makeRunSingleIter();
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Remediation');
    expect(html).toContain('API rate limited. Wait 60s before retry.');
  });

  it('renders similar_to_previous no when false', () => {
    const run = makeRunSingleIter();
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Similar');
  });

  it('renders classification in multi-iteration stage', () => {
    const run = {
      stages: {
        implement: {
          status: 'error',
          iterations: [
            { number: 1, status: 'completed', outcome: 'success' },
            { number: 2, status: 'error', outcome: 'error', classification },
          ],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('classification-strip');
    expect(html).toContain('infra_transient');
  });

  it('does not render classification-strip for iteration without classification in multi-iter', () => {
    const run = {
      stages: {
        implement: {
          status: 'error',
          iterations: [
            { number: 1, status: 'completed', outcome: 'success' },
            { number: 2, status: 'error', outcome: 'error' },
          ],
        },
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('classification-strip');
  });
});
