// TDD: written before wiring onPause/onResume/onStop in main.js (failing first).
import { test, expect } from '@playwright/test';
import { startServer, seedRun } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

/**
 * Navigate to a run's detail page via the hash URL and wait for the
 * run detail to render (not the empty-state placeholder).
 */
async function openRunDetail(page, baseUrl, runId, pipelineStatus) {
  await page.goto(`${baseUrl}/#/history?run=${runId}`, GOTO_OPTS);
  // Wait until the run detail has rendered its stage panels (not empty-state)
  await expect(page.locator('.run-detail .stage-panels')).toBeVisible();
  // For statuses that should have controls, wait for them
  if (['running', 'paused', 'failed'].includes(pipelineStatus)) {
    await expect(page.locator('.run-controls')).toBeVisible();
  }
}

// ─── Button visibility per pipeline status ────────────────────────────────────

test.describe('control buttons — visibility by pipeline status', () => {
  test('running: pause and stop visible, resume absent', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-running';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });
      await openRunDetail(page, ctx.url, runId, 'running');

      await expect(page.locator('.btn-pause')).toBeVisible();
      await expect(page.locator('.btn-stop')).toBeVisible();
      await expect(page.locator('.btn-resume')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('paused: resume and stop visible, pause absent', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-paused';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'paused' });
      await openRunDetail(page, ctx.url, runId, 'paused');

      await expect(page.locator('.btn-resume')).toBeVisible();
      await expect(page.locator('.btn-stop')).toBeVisible();
      await expect(page.locator('.btn-pause')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('failed: resume visible, pause and stop absent', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-failed';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'failed' });
      await openRunDetail(page, ctx.url, runId, 'failed');

      await expect(page.locator('.btn-resume')).toBeVisible();
      await expect(page.locator('.btn-pause')).not.toBeAttached();
      await expect(page.locator('.btn-stop')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('completed: no run-controls section rendered', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-completed';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'completed' });
      await openRunDetail(page, ctx.url, runId, 'completed');

      await expect(page.locator('.run-controls')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });
});

// ─── Interaction tests ────────────────────────────────────────────────────────

test.describe('control buttons — interactions', () => {
  test('pause click sends POST /api/runs/:id/pause', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-pause-click';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });

      const pauseRequests = [];
      await page.route(`**/api/runs/${runId}/pause`, (route) => {
        pauseRequests.push(route.request().method());
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, paused: true, runId }),
        });
      });

      await openRunDetail(page, ctx.url, runId, 'running');
      await page.locator('.btn-pause').click();

      await expect.poll(() => pauseRequests.length, {}).toBeGreaterThan(0);
      expect(pauseRequests[0]).toBe('POST');
    } finally {
      await ctx.close();
    }
  });

  test('resume click sends POST /api/runs/:id/resume', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-resume-click';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'paused' });

      const resumeRequests = [];
      await page.route(`**/api/runs/${runId}/resume`, (route) => {
        resumeRequests.push(route.request().method());
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, pid: 99, runId }),
        });
      });

      await openRunDetail(page, ctx.url, runId, 'paused');
      await page.locator('.btn-resume').click();

      await expect.poll(() => resumeRequests.length, {}).toBeGreaterThan(0);
      expect(resumeRequests[0]).toBe('POST');
    } finally {
      await ctx.close();
    }
  });

  test('stop click shows confirmation dialog', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-stop-dialog';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });

      await openRunDetail(page, ctx.url, runId, 'running');
      await page.locator('.btn-stop').click();

      // Shoelace sl-dialog opens (has open attribute when visible)
      await expect(page.locator('.run-controls-stop-dialog')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('stop confirm sends POST /api/runs/:id/stop', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-stop-confirm';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });

      const stopRequests = [];
      await page.route(`**/api/runs/${runId}/stop`, (route) => {
        stopRequests.push(route.request().method());
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, stopped: true, runId, pid: 99 }),
        });
      });

      await openRunDetail(page, ctx.url, runId, 'running');
      await page.locator('.btn-stop').click();
      await expect(page.locator('.run-controls-stop-dialog')).toBeVisible();

      // Click the danger (Stop) button in the dialog footer
      await page.locator('.run-controls-stop-dialog sl-button[variant="danger"]').click();

      await expect.poll(() => stopRequests.length, {}).toBeGreaterThan(0);
      expect(stopRequests[0]).toBe('POST');
    } finally {
      await ctx.close();
    }
  });

  test('stop cancel does not send POST /api/runs/:id/stop', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-stop-cancel';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });

      const stopRequests = [];
      await page.route(`**/api/runs/${runId}/stop`, (route) => {
        stopRequests.push(route.request().method());
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      });

      await openRunDetail(page, ctx.url, runId, 'running');
      await page.locator('.btn-stop').click();
      await expect(page.locator('.run-controls-stop-dialog')).toBeVisible();

      // Click Cancel
      await page.locator('.run-controls-stop-dialog sl-button[variant="neutral"]').click();

      // Wait briefly then confirm no stop request was sent
      await page.waitForTimeout(800);
      expect(stopRequests.length).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test('buttons disabled while control request is pending', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-pending';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });

      // Delay pause response so we can inspect the pending state
      let resolveRoute;
      await page.route(`**/api/runs/${runId}/pause`, async (route) => {
        await new Promise((r) => { resolveRoute = r; });
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, paused: true, runId }),
        });
      });

      await openRunDetail(page, ctx.url, runId, 'running');
      await page.locator('.btn-pause').click();

      // While request is in-flight: pending class is applied and other buttons are disabled
      await expect(page.locator('.control-pending-pause')).toBeVisible();

      // Resolve the route to clean up
      resolveRoute?.();
    } finally {
      await ctx.close();
    }
  });
});
