import { test, expect } from '@playwright/test';
import { startServer, seedRun, writePipelinePid } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

// ─── Dashboard active runs ──────────────────────────────────────────────────
// The dashboard renders a single .active-group for all active runs (running,
// paused, resuming). Failed and completed runs appear in separate sections
// (.active-group-failed, .active-group-completed). There is no per-status
// sub-grouping within the active section.

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
    } finally {
      await ctx.close();
    }
  });

  test('shows active group for pipeline_status=running', async ({ page }) => {
    const ctx = await startServer();
    try {
      writePipelinePid(ctx.worcaDir, '20260101-dash-running');
      seedRun(ctx.worcaDir, '20260101-dash-running', {
        pipeline_status: 'running',
        work_request: { title: 'Running test' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card.status-running')).toBeVisible();
      await expect(page.locator('.empty-state')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('shows active group for pipeline_status=paused', async ({ page }) => {
    const ctx = await startServer();
    try {
      writePipelinePid(ctx.worcaDir, '20260101-dash-paused');
      seedRun(ctx.worcaDir, '20260101-dash-paused', {
        pipeline_status: 'paused',
        work_request: { title: 'Paused test' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card.status-paused')).toBeVisible();
      await expect(page.locator('.empty-state')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('shows failed section for pipeline_status=failed', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-dash-failed', {
        pipeline_status: 'failed',
        work_request: { title: 'Failed test' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group-failed .run-card.status-failed')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('running and paused runs coexist in active group', async ({ page }) => {
    const ctx = await startServer();
    try {
      writePipelinePid(ctx.worcaDir, '20260101-dash-multi-run');
      seedRun(ctx.worcaDir, '20260101-dash-multi-run', {
        pipeline_status: 'running',
        work_request: { title: 'Multi: running' },
      });
      writePipelinePid(ctx.worcaDir, '20260101-dash-multi-pause');
      seedRun(ctx.worcaDir, '20260101-dash-multi-pause', {
        pipeline_status: 'paused',
        work_request: { title: 'Multi: paused' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card.status-running')).toBeVisible();
      await expect(page.locator('.active-group .run-card.status-paused')).toBeVisible();
      await expect(page.locator('.empty-state')).not.toBeAttached();
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
      writePipelinePid(ctx.worcaDir, '20260101-dash-qpause-vis');
      seedRun(ctx.worcaDir, '20260101-dash-qpause-vis', {
        pipeline_status: 'running',
        work_request: { title: 'Quick pause visible' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card')).toBeVisible();
      await expect(page.locator('.active-group .btn-quick-pause')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('paused card shows quick-resume button', async ({ page }) => {
    const ctx = await startServer();
    try {
      writePipelinePid(ctx.worcaDir, '20260101-dash-qresume-paused');
      seedRun(ctx.worcaDir, '20260101-dash-qresume-paused', {
        pipeline_status: 'paused',
        work_request: { title: 'Quick resume paused' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card')).toBeVisible();
      await expect(page.locator('.active-group .btn-quick-resume')).toBeVisible();
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
      writePipelinePid(ctx.worcaDir, '20260101-dash-no-resume');
      seedRun(ctx.worcaDir, '20260101-dash-no-resume', {
        pipeline_status: 'running',
        work_request: { title: 'No resume on running' },
      });
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card')).toBeVisible();
      await expect(page.locator('.active-group .btn-quick-resume')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('quick-pause click sends POST /api/runs/:id/pause', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-dash-qpause-req';
      writePipelinePid(ctx.worcaDir, runId);
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
      await expect(page.locator('.active-group .btn-quick-pause')).toBeVisible();
      await page.locator('.active-group .btn-quick-pause').click();

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
      writePipelinePid(ctx.worcaDir, runId);
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
      await expect(page.locator('.active-group .btn-quick-resume')).toBeVisible();
      await page.locator('.active-group .btn-quick-resume').click();

      await expect.poll(() => resumeRequests.length, {}).toBeGreaterThan(0);
      expect(resumeRequests[0]).toBe('POST');
    } finally {
      await ctx.close();
    }
  });
});
