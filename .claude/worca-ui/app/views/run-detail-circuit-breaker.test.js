import { describe, expect, it } from 'vitest';
import { runDetailView } from './run-detail.js';

function renderToString(template) {
  if (!template) return '';
  if (template.overview) return renderToString(template.overview) + renderToString(template.stages);
  if (typeof template === 'string') return template;
  if (!template.strings) return String(template);
  let result = '';
  template.strings.forEach((s, i) => {
    result += s;
    if (i < template.values.length) {
      const v = template.values[i];
      if (typeof v === 'string') result += v;
      else if (Array.isArray(v)) result += v.map(renderToString).join('');
      else if (v?.strings) result += renderToString(v);
    }
  });
  return result;
}

describe('runDetailView circuit breaker banner', () => {
  const baseRun = {
    stages: {
      implement: {
        status: 'error',
        iterations: [{ number: 1, status: 'error' }],
      },
    },
  };

  it('renders danger sl-alert when circuit_breaker.tripped is true', () => {
    const run = {
      ...baseRun,
      circuit_breaker: {
        tripped: true,
        tripped_reason: 'Immediate halt: error category is infra_permanent',
        consecutive_failures: 1,
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('circuit-breaker-banner');
    expect(html).toContain('variant="danger"');
    expect(html).toContain('Immediate halt: error category is infra_permanent');
  });

  it('renders the tripped_reason text in the danger banner', () => {
    const run = {
      ...baseRun,
      circuit_breaker: {
        tripped: true,
        tripped_reason: 'Max consecutive failures (3) reached',
        consecutive_failures: 3,
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('Max consecutive failures (3) reached');
  });

  it('renders warning indicator when consecutive_failures > 0 but not tripped', () => {
    const run = {
      ...baseRun,
      circuit_breaker: {
        tripped: false,
        consecutive_failures: 2,
      },
    };
    const settings = { circuit_breaker: { max_consecutive_failures: 3 } };
    const html = renderToString(runDetailView(run, settings));
    expect(html).toContain('circuit-breaker-banner');
    expect(html).toContain('variant="warning"');
    expect(html).toContain('2');
    expect(html).toContain('3');
  });

  it('shows count vs threshold in warning indicator', () => {
    const run = {
      ...baseRun,
      circuit_breaker: {
        tripped: false,
        consecutive_failures: 1,
      },
    };
    const settings = { circuit_breaker: { max_consecutive_failures: 5 } };
    const html = renderToString(runDetailView(run, settings));
    expect(html).toContain('circuit-breaker-banner');
    expect(html).toContain('1');
    expect(html).toContain('5');
  });

  it('uses default threshold of 3 when settings has no circuit_breaker config', () => {
    const run = {
      ...baseRun,
      circuit_breaker: {
        tripped: false,
        consecutive_failures: 2,
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).toContain('circuit-breaker-banner');
    expect(html).toContain('2');
    expect(html).toContain('3');
  });

  it('does not render circuit-breaker-banner when circuit_breaker is absent', () => {
    const html = renderToString(runDetailView(baseRun));
    expect(html).not.toContain('circuit-breaker-banner');
  });

  it('does not render circuit-breaker-banner when consecutive_failures is 0 and not tripped', () => {
    const run = {
      ...baseRun,
      circuit_breaker: {
        tripped: false,
        consecutive_failures: 0,
      },
    };
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('circuit-breaker-banner');
  });
});
