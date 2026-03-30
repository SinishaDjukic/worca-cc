import { test, expect } from '@playwright/test';
import { startServer, seedRun, writePipelinePid } from './fixtures.js';

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
    await expect(page.locator('.content-header-actions .action-btn').first()).toBeVisible();
  }
}

// ─── Button visibility per pipeline status ────────────────────────────────────

test.describe('control buttons — visibility by pipeline status', () => {
  test('running: pause and stop visible, resume absent', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-running';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });
      await openRunDetail(page, ctx.url, runId, 'running');

      await expect(page.locator('.action-btn--amber')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();
      await expect(page.locator('.action-btn--primary')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('paused: resume and stop visible, pause absent', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-paused';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'paused' });
      await openRunDetail(page, ctx.url, runId, 'paused');

      await expect(page.locator('.action-btn--primary')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();
      await expect(page.locator('.action-btn--amber')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('failed: resume and stop visible, pause absent', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-failed';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'failed' });
      await openRunDetail(page, ctx.url, runId, 'failed');

      await expect(page.locator('.action-btn--primary')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();
      await expect(page.locator('.action-btn--amber')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });

  test('completed: no action buttons rendered', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-completed';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await openRunDetail(page, ctx.url, runId, 'completed');

      await expect(page.locator('.content-header-actions .action-btn')).not.toBeAttached();
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
      writePipelinePid(ctx.worcaDir, runId);
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
      await page.locator('.action-btn--amber').click();

      await expect.poll(() => pauseRequests.length, {}).toBeGreaterThan(0);
      expect(pauseRequests[0]).toBe('POST');
    } finally {
      await ctx.close();
    }
  });

  test('resume click sends WS resume-run message', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-resume-click';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'paused' });

      // Capture outgoing WS frames (framesent) before navigating
      const sentFrames = [];
      page.on('websocket', (ws) => {
        ws.on('framesent', ({ payload }) => {
          try {
            const msg = JSON.parse(payload);
            if (msg.type === 'resume-run') sentFrames.push(msg);
          } catch { /* ignore non-JSON */ }
        });
      });

      await openRunDetail(page, ctx.url, runId, 'paused');
      await page.locator('.action-btn--primary').click();

      await expect.poll(() => sentFrames.length, {}).toBeGreaterThan(0);
      expect(sentFrames[0].type).toBe('resume-run');
      expect(sentFrames[0].payload).toHaveProperty('runId');
    } finally {
      await ctx.close();
    }
  });

  test('stop click shows confirmation dialog', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-stop-dialog';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });

      await openRunDetail(page, ctx.url, runId, 'running');
      await page.locator('.action-btn--danger').click();

      // Shoelace sl-dialog opens (has open attribute when visible)
      await expect(page.locator('#global-confirm-dialog')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('stop confirm sends DELETE /api/runs/:id', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-stop-confirm';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });

      const stopRequests = [];
      await page.route(`**/api/runs/${runId}`, (route) => {
        if (route.request().method() === 'DELETE') {
          stopRequests.push('DELETE');
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, stopped: true, runId, pid: 99 }),
          });
        } else {
          route.continue();
        }
      });

      await openRunDetail(page, ctx.url, runId, 'running');
      await page.locator('.action-btn--danger').click();
      await expect(page.locator('#global-confirm-dialog')).toBeVisible();

      // Click the danger (Stop) button in the dialog footer
      await page.locator('#global-confirm-dialog sl-button[variant="danger"]').click();

      await expect.poll(() => stopRequests.length, {}).toBeGreaterThan(0);
      expect(stopRequests[0]).toBe('DELETE');
    } finally {
      await ctx.close();
    }
  });

  test('stop cancel does not send DELETE /api/runs/:id', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl-stop-cancel';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });

      const stopRequests = [];
      await page.route(`**/api/runs/${runId}`, (route) => {
        if (route.request().method() === 'DELETE') {
          stopRequests.push('DELETE');
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true }),
          });
        } else {
          route.continue();
        }
      });

      await openRunDetail(page, ctx.url, runId, 'running');
      await page.locator('.action-btn--danger').click();
      await expect(page.locator('#global-confirm-dialog')).toBeVisible();

      // Click Cancel (the non-danger button in the dialog footer)
      await page.locator('#global-confirm-dialog sl-button:not([variant="danger"])').click();

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
      writePipelinePid(ctx.worcaDir, runId);
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
      await page.locator('.action-btn--amber').click();

      // While request is in-flight: amber button is disabled with "Pausing..." text
      await expect(page.locator('.action-btn--amber:disabled')).toBeVisible();
      await expect(page.locator('.action-btn--amber:disabled')).toContainText('Pausing');

      // Resolve the route to clean up
      resolveRoute?.();
    } finally {
      await ctx.close();
    }
  });
});
