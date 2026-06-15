import { expect, test } from '@playwright/test';
import { seedRun, startServer } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

test.describe('run-detail API-retry signal (W-074)', () => {
  test('renders the timing-bar retry segment and the stage-header ⟳ N chip', async ({
    page,
  }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-api-retry-present';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        stage: 'implement',
        started_at: '2026-01-01T00:00:00.000+00:00',
        stages: {
          implement: {
            status: 'completed',
            agent: 'implementer',
            model: 'sonnet',
            started_at: '2026-01-01T00:00:00.000+00:00',
            completed_at: '2026-01-01T00:10:00.000+00:00',
            iterations: [
              {
                number: 1,
                status: 'completed',
                agent: 'implementer',
                model: 'sonnet',
                started_at: '2026-01-01T00:00:00.000+00:00',
                completed_at: '2026-01-01T00:10:00.000+00:00',
                duration_api_ms: 120000,
                duration_session_ms: 480000,
                api_retries: 3,
                api_retry_wait_ms: 180000,
                non_api_wait_ms: 300000,
                api_error_status: 529,
              },
            ],
          },
        },
      });

      await page.goto(`${ctx.url}/#/history?run=${runId}`, GOTO_OPTS);
      await expect(page.locator('.run-detail .stage-panels')).toBeVisible({
        timeout: 8000,
      });

      // 6d — the striped API Retry/Wait segment is always-on (no hover).
      await expect(page.locator('.timing-bar-retry').first()).toBeVisible({
        timeout: 5000,
      });

      // 6c — the collapsed stage header shows the ⟳ N chip without expanding.
      const implementPanel = page
        .locator('.stage-panel', {
          has: page.locator('.stage-panel-label', { hasText: 'IMPLEMENT' }),
        })
        .first();
      const retryChip = implementPanel
        .locator('.stage-panel-meta .iter-retry-warn')
        .first();
      await expect(retryChip).toBeVisible();
      await expect(retryChip).toContainText('3');
    } finally {
      await ctx.close();
    }
  });

  test('a zero-retry run renders no retry segment and no stage retry chip', async ({
    page,
  }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-api-retry-absent';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        stage: 'implement',
        started_at: '2026-01-01T00:00:00.000+00:00',
        stages: {
          implement: {
            status: 'completed',
            agent: 'implementer',
            model: 'sonnet',
            started_at: '2026-01-01T00:00:00.000+00:00',
            completed_at: '2026-01-01T00:10:00.000+00:00',
            iterations: [
              {
                number: 1,
                status: 'completed',
                agent: 'implementer',
                model: 'sonnet',
                started_at: '2026-01-01T00:00:00.000+00:00',
                completed_at: '2026-01-01T00:10:00.000+00:00',
                duration_api_ms: 120000,
                duration_session_ms: 480000,
              },
            ],
          },
        },
      });

      await page.goto(`${ctx.url}/#/history?run=${runId}`, GOTO_OPTS);
      await expect(page.locator('.run-detail .stage-panels')).toBeVisible({
        timeout: 8000,
      });

      await expect(page.locator('.timing-bar-retry')).toHaveCount(0);
      const implementPanel = page
        .locator('.stage-panel', {
          has: page.locator('.stage-panel-label', { hasText: 'IMPLEMENT' }),
        })
        .first();
      await expect(
        implementPanel.locator('.stage-panel-meta .iter-retry-warn'),
      ).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
