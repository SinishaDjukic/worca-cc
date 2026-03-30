import { test, expect } from '@playwright/test';
import { startServer, seedRun } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

// Run card border colors (subset — only statuses with explicit CSS rule)
const CARD_BORDER_COLORS = {
  running:   'rgb(59, 130, 246)',
  paused:    'rgb(245, 158, 11)',
  failed:    'rgb(239, 68, 68)',
  completed: 'rgb(34, 197, 94)',
  resuming:  'rgb(59, 130, 246)',
  pending:   'rgb(148, 163, 184)',  // --status-pending: #94a3b8
};

test.describe('run card — colored left border', () => {
  for (const [status, expectedColor] of Object.entries(CARD_BORDER_COLORS)) {
    test(`${status} card has ${expectedColor} left border`, async ({ page }) => {
      const ctx = await startServer();
      try {
        const runId = `20260101-card-${status}`;
        seedRun(ctx.worcaDir, runId, {
          pipeline_status: status,
          work_request: { title: `Card test – ${status}` },
        });

        await page.goto(ctx.url, GOTO_OPTS);

        // Navigate to History (all non-active runs appear there)
        const historyNav = page.locator('.sidebar-item').filter({ hasText: 'History' });
        await expect(historyNav).toBeVisible({ timeout: 5000 });
        await historyNav.click();

        // Wait for the run card with the correct status class
        const card = page.locator(`.run-card.status-${status}`).first();
        await expect(card).toBeVisible({ timeout: 8000 });

        // Verify the computed border-left-color matches the expected status color
        const borderColor = await card.evaluate(
          (el) => getComputedStyle(el).borderLeftColor,
        );
        expect(borderColor).toBe(expectedColor);
      } finally {
        await ctx.close();
      }
    });
  }
});
