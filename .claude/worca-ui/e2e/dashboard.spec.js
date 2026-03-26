// TDD: written before wiring onPause/onResume into dashboardView call in main.js.
// Quick-action button tests fail until main.js passes onPause/onResume to dashboardView.
import { test, expect } from '@playwright/test';
import { startServer, seedRun } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

// ─── Grouping by pipeline status ─────────────────────────────────────────────

test.describe('dashboard — active run groups', () => {
  test('shows empty state when no running/paused/failed runs', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-empty', {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
        work_request: { title: 'Completed run' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.dashboard')).toBeVisible();
      await expect(page.locator('.empty-state')).toBeVisible();
      await expect(page.locator('.active-group-running')).not.toBeAttached();
      await expect(page.locator('.active-group-paused')).not.toBeAttached();
      await expect(page.locator('.active-group-failed')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('shows running group for pipeline_status=running', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-running', {
        pipeline_status: 'running',
        work_request: { title: 'Running test' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-running')).toBeVisible();
      await expect(page.locator('.active-group-running .run-card.status-running')).toBeVisible();
      await expect(page.locator('.empty-state')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('shows paused group for pipeline_status=paused', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-paused', {
        pipeline_status: 'paused',
        work_request: { title: 'Paused test' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-paused')).toBeVisible();
      await expect(page.locator('.active-group-paused .run-card.status-paused')).toBeVisible();
      await expect(page.locator('.empty-state')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('shows failed group for pipeline_status=failed', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-failed', {
        pipeline_status: 'failed',
        work_request: { title: 'Failed test' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-failed')).toBeVisible();
      await expect(page.locator('.active-group-failed .run-card.status-failed')).toBeVisible();
      await expect(page.locator('.empty-state')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('running and paused groups coexist', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-multi-run', {
        pipeline_status: 'running',
        work_request: { title: 'Multi: running' },
      });
      seedRun(ctx.worcaDir, '20260101-dash-multi-pause', {
        pipeline_status: 'paused',
        work_request: { title: 'Multi: paused' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-running')).toBeVisible();
      await expect(page.locator('.active-group-paused')).toBeVisible();
      await expect(page.locator('.empty-state')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });
});

// ─── Count badges ─────────────────────────────────────────────────────────────

test.describe('dashboard — count badges', () => {
  test('running group count shows correct number for 2 runs', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-count-r1', {
        pipeline_status: 'running',
        work_request: { title: 'Running count 1' },
      });
      seedRun(ctx.worcaDir, '20260101-dash-count-r2', {
        pipeline_status: 'running',
        work_request: { title: 'Running count 2' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-running')).toBeVisible();
      const countText = await page.locator('.active-group-running .active-group-count').textContent();
      expect(countText).toContain('2 running');
    } finally {
      await ctx.close();
    }
  });

  test('paused group count shows 1 for single paused run', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-count-p1', {
        pipeline_status: 'paused',
        work_request: { title: 'Paused count single' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-paused')).toBeVisible();
      const countText = await page.locator('.active-group-paused .active-group-count').textContent();
      expect(countText).toContain('1 paused');
    } finally {
      await ctx.close();
    }
  });

  test('failed group count shows 1 for single failed run', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-count-f1', {
        pipeline_status: 'failed',
        work_request: { title: 'Failed count single' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-failed')).toBeVisible();
      const countText = await page.locator('.active-group-failed .active-group-count').textContent();
      expect(countText).toContain('1 failed');
    } finally {
      await ctx.close();
    }
  });
});

// ─── Quick-action buttons on cards ───────────────────────────────────────────

test.describe('dashboard — quick-action buttons', () => {
  test('running card shows quick-pause button', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-qpause-vis', {
        pipeline_status: 'running',
        work_request: { title: 'Quick pause visible' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-running .run-card')).toBeVisible();
      await expect(page.locator('.active-group-running .btn-quick-pause')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('paused card shows quick-resume button', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-qresume-paused', {
        pipeline_status: 'paused',
        work_request: { title: 'Quick resume paused' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-paused .run-card')).toBeVisible();
      await expect(page.locator('.active-group-paused .btn-quick-resume')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('failed card shows quick-resume button', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-qresume-failed', {
        pipeline_status: 'failed',
        work_request: { title: 'Quick resume failed' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-failed .run-card')).toBeVisible();
      await expect(page.locator('.active-group-failed .btn-quick-resume')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('running card has no resume button', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-no-resume', {
        pipeline_status: 'running',
        work_request: { title: 'No resume on running' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-running .run-card')).toBeVisible();
      await expect(page.locator('.active-group-running .btn-quick-resume')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('quick-pause click sends POST /api/runs/:id/pause', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-dash-qpause-req';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Quick pause API' },
      });

      const pauseRequests = [];
      await page.route(`**/api/runs/${runId}/pause`, (route) => {
        pauseRequests.push(route.request().method());
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, paused: true, runId }),
        });
      });

      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-running .btn-quick-pause')).toBeVisible();
      await page.locator('.active-group-running .btn-quick-pause').click();

      await expect.poll(() => pauseRequests.length, {}).toBeGreaterThan(0);
      expect(pauseRequests[0]).toBe('POST');
    } finally {
      await ctx.close();
    }
  });

  test('quick-resume click sends POST /api/runs/:id/resume', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-dash-qresume-req';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'paused',
        work_request: { title: 'Quick resume API' },
      });

      const resumeRequests = [];
      await page.route(`**/api/runs/${runId}/resume`, (route) => {
        resumeRequests.push(route.request().method());
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, pid: 99, runId }),
        });
      });

      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-paused .btn-quick-resume')).toBeVisible();
      await page.locator('.active-group-paused .btn-quick-resume').click();

      await expect.poll(() => resumeRequests.length, {}).toBeGreaterThan(0);
      expect(resumeRequests[0]).toBe('POST');
    } finally {
      await ctx.close();
    }
  });
});
