import { test, expect } from '@playwright/test';
import { startServer, seedRun } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

test.describe('sidebar — history badge count', () => {
  test('seeded completed run shows in History badge', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-side-done', {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
        work_request: { title: 'Done run' },
      });

      await page.goto(ctx.url, GOTO_OPTS);

      const historyItem = page.locator('.sidebar-item').filter({ hasText: 'History' });
      await expect(historyItem).toBeVisible({ timeout: 5000 });
      const badge = historyItem.locator('sl-badge');
      await expect(badge).toBeVisible({ timeout: 5000 });
      await expect(badge).toHaveText('1');
    } finally {
      await ctx.close();
    }
  });

  test('multiple seeded runs show correct History count', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-side-1', {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
        work_request: { title: 'Run 1' },
      });
      seedRun(ctx.worcaDir, '20260101-side-2', {
        pipeline_status: 'failed',
        work_request: { title: 'Run 2' },
      });
      seedRun(ctx.worcaDir, '20260101-side-3', {
        pipeline_status: 'paused',
        work_request: { title: 'Run 3' },
      });

      await page.goto(ctx.url, GOTO_OPTS);

      const historyItem = page.locator('.sidebar-item').filter({ hasText: 'History' });
      await expect(historyItem).toBeVisible({ timeout: 5000 });
      const badge = historyItem.locator('sl-badge');
      await expect(badge).toBeVisible({ timeout: 5000 });
      await expect(badge).toHaveText('3');
    } finally {
      await ctx.close();
    }
  });

  test('no badge when zero runs', async ({ page }) => {
    const ctx = await startServer();
    try {
      await page.goto(ctx.url, GOTO_OPTS);

      // Running section should have no badge with zero runs
      const runningItem = page.locator('.sidebar-item').filter({ hasText: 'Running' });
      await expect(runningItem).toBeVisible({ timeout: 5000 });
      const badge = runningItem.locator('sl-badge');
      await expect(badge).toHaveCount(0);

      // History section should also have no badge
      const historyItem = page.locator('.sidebar-item').filter({ hasText: 'History' });
      const histBadge = historyItem.locator('sl-badge');
      await expect(histBadge).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('sidebar — navigation', () => {
  test('clicking Running navigates to active view', async ({ page }) => {
    const ctx = await startServer();
    try {
      await page.goto(ctx.url, GOTO_OPTS);

      const runningItem = page.locator('.sidebar-item').filter({ hasText: 'Running' });
      await expect(runningItem).toBeVisible({ timeout: 5000 });
      await runningItem.click();

      // Should show the Running Pipelines heading
      await expect(page.locator('h1')).toContainText('Running Pipelines', { timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });

  test('clicking History navigates to history view', async ({ page }) => {
    const ctx = await startServer();
    try {
      seedRun(ctx.worcaDir, '20260101-side-nav', {
        pipeline_status: 'completed',
        completed_at: new Date().toISOString(),
        work_request: { title: 'Nav test' },
      });

      await page.goto(ctx.url, GOTO_OPTS);

      const historyItem = page.locator('.sidebar-item').filter({ hasText: 'History' });
      await expect(historyItem).toBeVisible({ timeout: 5000 });
      await historyItem.click();

      // Should show a run card
      await expect(page.locator('.run-card')).toBeVisible({ timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });
});
