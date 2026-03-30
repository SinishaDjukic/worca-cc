import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, seedRun, writePipelinePid } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

/**
 * Update a run's status.json and trigger a WebSocket broadcast by writing
 * worcaDir/active_run. The activeRunWatcher fires on any write to that file.
 */
function triggerStatusUpdate(worcaDir, runId, statusOverrides) {
  seedRun(worcaDir, runId, statusOverrides);
  writeFileSync(join(worcaDir, 'active_run'), runId + '\n', 'utf8');
}

/**
 * Navigate to a run's detail page and wait for stage-panels to render.
 */
async function openRunDetail(page, baseUrl, runId, pipelineStatus) {
  await page.goto(`${baseUrl}/#/history?run=${runId}`, GOTO_OPTS);
  await expect(page.locator('.run-detail .stage-panels')).toBeVisible();
  if (['running', 'paused', 'failed'].includes(pipelineStatus)) {
    await expect(page.locator('.content-header-actions .action-btn').first()).toBeVisible();
  }
}

// ─── Pause then resume flow ──────────────────────────────────────────────────

test.describe('run lifecycle — pause then resume', () => {
  test('seed running → pause → verify paused badge + resume → verify running', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-lifecycle-pause-resume';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Lifecycle: pause then resume' },
      });
      await openRunDetail(page, ctx.url, runId, 'running');

      // Verify running state: pause button (amber) visible, resume (primary) absent
      await expect(page.locator('.action-btn--amber')).toBeVisible();
      await expect(page.locator('.action-btn--primary')).not.toBeAttached();

      // Transition to paused
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'paused',
        work_request: { title: 'Lifecycle: pause then resume' },
      });

      // Verify paused state: resume (primary) visible, pause (amber) absent
      await expect(page.locator('.action-btn--primary')).toBeVisible();
      await expect(page.locator('.action-btn--amber')).not.toBeAttached();

      // Transition back to running
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Lifecycle: pause then resume' },
      });

      // Verify running state restored
      await expect(page.locator('.action-btn--amber')).toBeVisible();
      await expect(page.locator('.action-btn--primary')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });
});

// ─── Stop then resume flow ──────────────────────────────────────────────────

test.describe('run lifecycle — stop then resume', () => {
  test('seed running → stop → verify failed badge → resume → verify running', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-lifecycle-stop-resume';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Lifecycle: stop then resume' },
      });
      await openRunDetail(page, ctx.url, runId, 'running');

      // Verify running state
      await expect(page.locator('.action-btn--amber')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();

      // Transition to failed (simulates stop completing)
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'failed',
        work_request: { title: 'Lifecycle: stop then resume' },
      });

      // Verify failed state: resume (primary) and stop (danger) visible, pause (amber) absent
      await expect(page.locator('.action-btn--primary')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();
      await expect(page.locator('.action-btn--amber')).not.toBeAttached();

      // Transition back to running (resume)
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Lifecycle: stop then resume' },
      });

      // Verify running state restored
      await expect(page.locator('.action-btn--amber')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();
      await expect(page.locator('.action-btn--primary')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });
});

// ─── Full lifecycle with stage mutations ─────────────────────────────────────

test.describe('run lifecycle — full pipeline progression', () => {
  test('running through stages → completed → no controls', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-lifecycle-full';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stage: 'plan',
        work_request: { title: 'Full lifecycle test' },
        stages: { plan: { status: 'in_progress' } },
      });
      await openRunDetail(page, ctx.url, runId, 'running');

      // Controls visible in running state
      await expect(page.locator('.content-header-actions .action-btn').first()).toBeVisible();

      // Stage 1: PLAN completes → COORDINATE starts
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stage: 'coordinate',
        work_request: { title: 'Full lifecycle test' },
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'in_progress' },
        },
      });
      await expect(page.locator('.stage-node.status-completed')).toHaveCount(1);

      // Stage 2: COORDINATE completes → IMPLEMENT starts
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stage: 'implement',
        work_request: { title: 'Full lifecycle test' },
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'completed' },
          implement: { status: 'in_progress' },
        },
      });
      await expect(page.locator('.stage-node.status-completed')).toHaveCount(2);

      // Pipeline completes
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
        work_request: { title: 'Full lifecycle test' },
        stages: {
          plan: { status: 'completed' },
          coordinate: { status: 'completed' },
          implement: { status: 'completed' },
        },
      });

      // Controls section removed for completed runs
      await expect(page.locator('.content-header-actions .action-btn')).toHaveCount(0);
      // All stages completed
      await expect(page.locator('.stage-node.status-completed')).toHaveCount(3);
    } finally {
      await ctx.close();
    }
  });
});

// ─── Multiple runs with different states ─────────────────────────────────────

test.describe('run lifecycle — multiple runs on dashboard', () => {
  test('3 runs (running, paused, completed) show correct icons and groups', async ({ page }) => {
    const ctx = await startServer();
    try {
      writePipelinePid(ctx.worcaDir, '20260101-multi-running');
      // Seed 3 runs with different states
      seedRun(ctx.worcaDir, '20260101-multi-running', {
        pipeline_status: 'running',
        work_request: { title: 'Multi: running' },
      });
      writePipelinePid(ctx.worcaDir, '20260101-multi-paused');
      seedRun(ctx.worcaDir, '20260101-multi-paused', {
        pipeline_status: 'paused',
        work_request: { title: 'Multi: paused' },
      });
      seedRun(ctx.worcaDir, '20260101-multi-completed', {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
        work_request: { title: 'Multi: completed' },
      });

      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);

      // Active group has both running and paused cards
      await expect(page.locator('.active-group .run-card.status-running')).toBeVisible();
      await expect(page.locator('.active-group .run-card.status-paused')).toBeVisible();

      // Completed runs should not appear in the active group (exclude the completed section which also has .active-group)
      await expect(page.locator('.active-group:not(.active-group-completed) .run-card.status-completed')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });
});
