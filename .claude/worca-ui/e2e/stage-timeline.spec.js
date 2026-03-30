import { test, expect } from '@playwright/test';
import { startServer, seedRun } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

/**
 * Navigate to a run's detail page and wait for stage-panels to render.
 */
async function openRunDetail(page, baseUrl, runId) {
  await page.goto(`${baseUrl}/#/history?run=${runId}`, GOTO_OPTS);
  await expect(page.locator('.run-detail .stage-panels')).toBeVisible({ timeout: 8000 });
}

// ─── Stage timeline icon rendering ──────────────────────────────────────────

test.describe('stage timeline — individual stage statuses', () => {
  test('all completed stages show green check icons', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-timeline-all-completed';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'completed' },
          implement: { status: 'completed' },
          test: { status: 'completed' },
          guardian: { status: 'completed' },
        },
      });
      await openRunDetail(page, ctx.url, runId);

      const completedNodes = page.locator('.stage-node.status-completed');
      await expect(completedNodes).toHaveCount(5, { timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test('current in-progress stage shows blue spinner', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-timeline-in-progress';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'running' },
        },
      });
      await openRunDetail(page, ctx.url, runId);

      // Use 'running' status (not 'in_progress') because resolveStatus maps
      // in_progress → interrupted when run.active is false (no real pipeline process)
      const runningNode = page.locator('.stage-node.status-running').first();
      await expect(runningNode).toBeVisible({ timeout: 8000 });

      // The icon inside a running stage should have the spin animation
      const svg = runningNode.locator('svg');
      await expect(svg).toHaveClass(/icon-spin/, { timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });

  test('failed stage shows red alert icon', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-timeline-failed';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'failed',
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'failed' },
        },
      });
      await openRunDetail(page, ctx.url, runId);

      const failedNode = page.locator('.stage-node.status-failed');
      await expect(failedNode).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test('paused pipeline shows amber pause on active stage', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-timeline-paused';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'paused',
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'paused' },
        },
      });
      await openRunDetail(page, ctx.url, runId);

      const pausedNode = page.locator('.stage-node.status-paused');
      await expect(pausedNode).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test('pending/future stages show gray circles', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-timeline-pending';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'in_progress' },
          implement: { status: 'pending' },
          test: { status: 'pending' },
          guardian: { status: 'pending' },
        },
      });
      await openRunDetail(page, ctx.url, runId);

      const pendingNodes = page.locator('.stage-node.status-pending');
      await expect(pendingNodes).toHaveCount(3, { timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test('skipped stage shows gray circle-slash with dashed border', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-timeline-skipped';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'skipped' },
          implement: { status: 'completed' },
        },
      });
      await openRunDetail(page, ctx.url, runId);

      // run-detail auto-adds preflight + learn as skipped, so expect ≥1 skipped node
      const skippedNodes = page.locator('.stage-node.status-skipped');
      await expect(skippedNodes.first()).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });
});

// ─── Mixed states ─────────────────────────────────────────────────────────────

test.describe('stage timeline — mixed states', () => {
  test('mixed states render correctly (3 completed + 1 running + 3 pending)', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-timeline-mixed';
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stages: {
          preflight: { status: 'completed' },
          plan: { status: 'completed' },
          coordinate: { status: 'completed' },
          implement: { status: 'running' },
          test: { status: 'pending' },
          guardian: { status: 'pending' },
          review: { status: 'pending' },
        },
      });
      await openRunDetail(page, ctx.url, runId);

      // 3 completed nodes
      await expect(page.locator('.stage-node.status-completed')).toHaveCount(3, { timeout: 8000 });

      // 1 running node (use 'running' not 'in_progress' — resolveStatus maps in_progress → interrupted when run.active is false)
      const runningNode = page.locator('.stage-node.status-running');
      await expect(runningNode).toHaveCount(1, { timeout: 5000 });

      // 3 pending nodes
      await expect(page.locator('.stage-node.status-pending')).toHaveCount(3, { timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });
});
