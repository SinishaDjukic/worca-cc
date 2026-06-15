import { describe, expect, it } from 'vitest';
import { formatDuration } from '../utils/duration.js';
import { _pipelineTimingBar, runDetailView } from './run-detail.js';

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

// ---------------------------------------------------------------------------
// 6d — pipeline timing bar: API Retry/Wait segment + toolsMs correction
// ---------------------------------------------------------------------------

describe('_pipelineTimingBar — API Retry/Wait segment (6d)', () => {
  it('renders a striped retry segment when api_retry_wait_ms > 0', () => {
    const iters = [
      {
        duration_api_ms: 2000,
        duration_session_ms: 10000,
        api_retry_wait_ms: 3000,
      },
    ];
    const html = renderToString(_pipelineTimingBar(iters, 10000));
    expect(html).toContain('timing-bar-retry');
    expect(html).toContain('API Retry/Wait');
  });

  it('carves retry time out of tools (toolsMs reduced, not absorbed)', () => {
    // session=10000, thinking=2000, retry=3000 → tools = 5000 (was 8000 pre-fix).
    const withRetry = renderToString(
      _pipelineTimingBar(
        [
          {
            duration_api_ms: 2000,
            duration_session_ms: 10000,
            api_retry_wait_ms: 3000,
          },
        ],
        10000,
      ),
    );
    expect(withRetry).toContain(`${formatDuration(5000)} (50%)`); // Tools legend
    expect(withRetry).toContain(`${formatDuration(3000)} (30%)`); // Retry legend
    // Without the fix, Tools would show 8000ms — assert that is NOT present.
    expect(withRetry).not.toContain(`${formatDuration(8000)} (80%)`);
  });

  it('renders byte-identically to a no-retry run when api_retry_wait_ms is 0', () => {
    const iters = [
      {
        duration_api_ms: 2000,
        duration_session_ms: 10000,
        api_retry_wait_ms: 0,
      },
    ];
    const noField = [{ duration_api_ms: 2000, duration_session_ms: 10000 }];
    const withZero = renderToString(_pipelineTimingBar(iters, 10000));
    const without = renderToString(_pipelineTimingBar(noField, 10000));
    expect(withZero).toBe(without);
    expect(withZero).not.toContain('timing-bar-retry');
    expect(withZero).not.toContain('API Retry/Wait');
    // Tools absorbs the full non-thinking session span (8000ms) when no retries.
    expect(withZero).toContain(`${formatDuration(8000)} (80%)`);
  });
});

// ---------------------------------------------------------------------------
// 6b — per-iteration retry chip + Wait: row
// ---------------------------------------------------------------------------

function makeRun(iterOverrides) {
  const iter = {
    number: 1,
    status: 'completed',
    outcome: 'success',
    started_at: '2026-06-15T00:00:00.000+00:00',
    completed_at: '2026-06-15T00:10:00.000+00:00', // 600000ms wall
    duration_api_ms: 120000,
    ...iterOverrides,
  };
  return { stages: { implement: { status: 'completed', iterations: [iter] } } };
}

describe('runDetailView — iteration retry chip + Wait row (6b)', () => {
  it('renders the ⟳ retry chip and Wait: row when the iteration throttled', () => {
    const html = renderToString(
      runDetailView(
        makeRun({
          api_retries: 3,
          non_api_wait_ms: 300000,
          api_error_status: 529,
        }),
      ),
    );
    expect(html).toContain('iter-retry-warn');
    expect(html).toContain('3 retries');
    // The 6b Wait row (distinct from the always-on 6c "API Retry/Wait:" tooltip).
    expect(html).toContain('>Wait:</span>');
    expect(html).toContain(formatDuration(300000)); // 5m 0s
    // % of wall = 300000/600000 = 50%
    expect(html).toContain('(50%)');
    // api_error_status surfaced in the Wait tooltip.
    expect(html).toContain('last API status 529');
  });

  it('uses singular "retry" for a single retry', () => {
    const html = renderToString(
      runDetailView(makeRun({ api_retries: 1, non_api_wait_ms: 1000 })),
    );
    expect(html).toContain('1 retry');
    expect(html).not.toContain('1 retries');
  });

  it('omits the chip and Wait row entirely on a clean iteration', () => {
    const html = renderToString(runDetailView(makeRun({})));
    expect(html).not.toContain('iter-retry-warn');
    // The per-iteration Wait row is gone; the always-on 6c Duration-tooltip
    // "API Retry/Wait:" breakdown line is unrelated and may still appear.
    expect(html).not.toContain('>Wait:</span>');
  });
});

// ---------------------------------------------------------------------------
// 6c — collapsed stage-header ⟳ N chip + Duration tooltip breakdown
// ---------------------------------------------------------------------------

function makeMultiIterRun(iters) {
  return { stages: { implement: { status: 'completed', iterations: iters } } };
}

describe('runDetailView — stage-header retry chip + Duration tooltip (6c)', () => {
  it('aggregates ⟳ N across iterations and renders the Duration breakdown', () => {
    const base = {
      status: 'completed',
      outcome: 'success',
      started_at: '2026-06-15T00:00:00.000+00:00',
      completed_at: '2026-06-15T00:10:00.000+00:00', // 600000ms each
      duration_api_ms: 120000,
    };
    const run = makeMultiIterRun([
      { ...base, number: 1, api_retries: 2, api_retry_wait_ms: 90000 },
      { ...base, number: 2, api_retries: 1, api_retry_wait_ms: 30000 },
    ]);
    const html = renderToString(runDetailView(run));
    // stageRetries = 3 aggregate chip.
    expect(html).toContain('iter-retry-warn');
    // Duration tooltip breakdown lines.
    expect(html).toContain('Thinking (API):');
    expect(html).toContain('Tools:');
    expect(html).toContain('API Retry/Wait:');
    // stageRetryWaitMs = 90000 + 30000 = 120000.
    expect(html).toContain(formatDuration(120000));
    // stageMs = 1200000, stageApiMs = 240000, stageRetryWaitMs = 120000
    // → stageToolsMs = 840000.
    expect(html).toContain(formatDuration(840000));
    expect(html).toContain('⟳ 3 retries');
  });

  it('omits the stage retry chip when no iteration throttled', () => {
    const base = {
      status: 'completed',
      outcome: 'success',
      started_at: '2026-06-15T00:00:00.000+00:00',
      completed_at: '2026-06-15T00:10:00.000+00:00',
      duration_api_ms: 120000,
    };
    const run = makeMultiIterRun([
      { ...base, number: 1 },
      { ...base, number: 2 },
    ]);
    const html = renderToString(runDetailView(run));
    expect(html).not.toContain('iter-retry-warn');
    expect(html).not.toContain('⟳');
  });
});
