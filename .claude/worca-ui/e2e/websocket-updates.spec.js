import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, seedRun, writePipelinePid } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

/**
 * Update a run's status.json and trigger a WebSocket broadcast by writing
 * worcaDir/active_run. The activeRunWatcher (in ws.js) fires on any write to
 * that file, which calls scheduleRefresh() → reads the updated status.json →
 * broadcasts run-snapshot (to subscribers) + runs-list (to all clients).
 */
function triggerStatusUpdate(worcaDir, runId, statusOverrides) {
  seedRun(worcaDir, runId, statusOverrides);
  // activeRunWatcher watches worcaDir; any write here fires scheduleRefresh
  writeFileSync(join(worcaDir, 'active_run'), runId + '\n', 'utf8');
}

/**
 * Navigate to a run's detail page and wait for stage-panels to render.
 * For statuses that show controls, also waits for action buttons.
 */
async function openRunDetail(page, baseUrl, runId, pipelineStatus) {
  await page.goto(`${baseUrl}/#/history?run=${runId}`, GOTO_OPTS);
  await expect(page.locator('.run-detail .stage-panels')).toBeVisible();
  if (['running', 'paused', 'failed'].includes(pipelineStatus)) {
    await expect(page.locator('.content-header-actions .action-btn').first()).toBeVisible();
  }
}

// ─── Status badge / control buttons without reload ───────────────────────────

test.describe('WebSocket live updates — control button transitions', () => {
  test('pipeline-paused: pause button disappears, resume appears', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-running-to-paused';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });
      await openRunDetail(page, ctx.url, runId, 'running');

      await expect(page.locator('.action-btn--amber')).toBeVisible();
      await expect(page.locator('.action-btn--primary')).not.toBeAttached();

      triggerStatusUpdate(ctx.worcaDir, runId, { pipeline_status: 'paused' });

      await expect(page.locator('.action-btn--amber')).not.toBeAttached();
      await expect(page.locator('.action-btn--primary')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('pipeline-resumed: resume button disappears, pause appears', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-paused-to-running';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'paused' });
      await openRunDetail(page, ctx.url, runId, 'paused');

      await expect(page.locator('.action-btn--primary')).toBeVisible();
      await expect(page.locator('.action-btn--amber')).not.toBeAttached();

      triggerStatusUpdate(ctx.worcaDir, runId, { pipeline_status: 'running' });

      await expect(page.locator('.action-btn--primary')).not.toBeAttached();
      await expect(page.locator('.action-btn--amber')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('pipeline-completed: action buttons removed', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-running-to-completed';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });
      await openRunDetail(page, ctx.url, runId, 'running');

      await expect(page.locator('.content-header-actions .action-btn').first()).toBeVisible();

      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
      });

      await expect(page.locator('.content-header-actions .action-btn')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('pipeline-failed: pause disappears, resume and stop appear', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-running-to-failed';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });
      await openRunDetail(page, ctx.url, runId, 'running');

      await expect(page.locator('.action-btn--amber')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();

      triggerStatusUpdate(ctx.worcaDir, runId, { pipeline_status: 'failed' });

      await expect(page.locator('.action-btn--primary')).toBeVisible();
      await expect(page.locator('.action-btn--danger')).toBeVisible();
      await expect(page.locator('.action-btn--amber')).not.toBeAttached();
    } finally {
      await ctx.close();
    }
  });
});

// ─── Stage timeline live updates ──────────────────────────────────────────────

test.describe('WebSocket live updates — stage timeline', () => {
  test('stage node transitions from pending to completed without reload', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-timeline-pending';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stages: { plan: { status: 'pending' }, coordinate: { status: 'pending' } },
      });
      await openRunDetail(page, ctx.url, runId, 'running');

      // Initial: at least one stage is pending
      await expect(page.locator('.stage-node.status-pending').first()).toBeVisible();
      await expect(page.locator('.stage-node.status-completed')).not.toBeAttached();

      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stages: { plan: { status: 'completed' }, coordinate: { status: 'pending' } },
      });

      // Plan node transitions to completed without reload
      await expect(page.locator('.stage-node.status-completed')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('multiple stage updates propagate in sequence', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-timeline-seq';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stages: { plan: { status: 'pending' }, coordinate: { status: 'pending' } },
      });
      await openRunDetail(page, ctx.url, runId, 'running');

      // First transition: plan completes
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stages: { plan: { status: 'completed' }, coordinate: { status: 'pending' } },
      });
      await expect(page.locator('.stage-node.status-completed')).toBeVisible();

      // Second transition: coordinate completes too
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
        stages: { plan: { status: 'completed' }, coordinate: { status: 'completed' } },
      });
      // Both plan and coordinate should now be status-completed
      await expect(page.locator('.stage-node.status-completed')).toHaveCount(2);
    } finally {
      await ctx.close();
    }
  });

  test('paused pipeline shows paused stage icon on active stage', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-timeline-pause-icon';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        stages: { plan: { status: 'completed' }, coordinate: { status: 'pending' } },
      });
      await openRunDetail(page, ctx.url, runId, 'running');

      // Transition to paused while coordinate is in a non-running state
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'paused',
        stages: { plan: { status: 'completed' }, coordinate: { status: 'paused' } },
      });

      // A paused stage node should appear
      await expect(page.locator('.stage-node.status-paused')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

// ─── Dashboard live status updates ───────────────────────────────────────────

test.describe('WebSocket live updates — dashboard status changes', () => {
  test('run card status updates from running to paused on dashboard', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-dash-run-to-pause';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Status change: running to paused' },
      });

      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card.status-running')).toBeVisible();

      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'paused',
        work_request: { title: 'Status change: running to paused' },
      });

      await expect(page.locator('.run-card.status-paused')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('run card status updates from paused to running on dashboard', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-dash-pause-to-run';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'paused',
        work_request: { title: 'Status change: paused to running' },
      });

      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card.status-paused')).toBeVisible();

      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Status change: paused to running' },
      });

      await expect(page.locator('.run-card.status-running')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('run moves to failed section on pipeline-failed', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-dash-run-to-fail';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Status change: running to failed' },
      });

      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      await expect(page.locator('.active-group .run-card.status-running')).toBeVisible();

      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'failed',
        work_request: { title: 'Status change: running to failed' },
      });

      await expect(page.locator('.active-group-failed .run-card.status-failed')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('dashboard stats update when run state changes', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ws-dash-stats';
      writePipelinePid(ctx.worcaDir, runId);
      seedRun(ctx.worcaDir, runId, {
        pipeline_status: 'running',
        work_request: { title: 'Stats update test' },
      });

      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);

      // Dashboard renders (stats are present)
      await expect(page.locator('.dashboard-stats')).toBeVisible();
      // Running card is visible
      await expect(page.locator('.active-group .run-card.status-running')).toBeVisible();

      // Pipeline completes
      triggerStatusUpdate(ctx.worcaDir, runId, {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
        work_request: { title: 'Stats update test' },
      });

      // Active group disappears (no running/paused runs), empty state appears
      await expect(page.locator('.empty-state')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
