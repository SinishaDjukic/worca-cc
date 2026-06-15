import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, seedRun } from './fixtures.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

// W-074 §6a: the log viewer tags each persisted line by origin stream
// (out/err), colors err lines, and offers a 3-way client-side stream filter.
function seedRunWithStreamTaggedLog(worcaDir, runId) {
  const runDir = join(worcaDir, 'runs', runId);
  seedRun(worcaDir, runId, {
    pipeline_status: 'completed',
    stage: 'implement',
    stages: {
      implement: {
        status: 'completed',
        iterations: [{ number: 1, status: 'completed' }],
      },
    },
  });
  const stageDir = join(runDir, 'logs', 'implement');
  mkdirSync(stageDir, { recursive: true });
  // Canonical <ts>\t<stream>\t<text> lines: one stdout, one stderr.
  writeFileSync(
    join(stageDir, 'iter-1.log'),
    [
      '2026-06-14T12:00:00.000+00:00\tout\tBuilding feature OUTMARKER',
      '2026-06-14T12:00:01.000+00:00\terr\tOverloaded 529 ERRMARKER',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function selectImplementStage(page) {
  // Open the collapsed "Log History" panel.
  await page.locator('.log-history-header').click();
  // Drive the stage sl-select (selecting a stage subscribes + backfills).
  await page
    .locator('.log-controls sl-select')
    .first()
    .evaluate((el) => {
      el.value = 'implement';
      el.dispatchEvent(new CustomEvent('sl-change', { bubbles: true }));
    });
  await expect(page.locator('.log-terminal .xterm-rows')).toBeVisible({
    timeout: 8000,
  });
}

test.describe('log viewer stream filter (W-074)', () => {
  test('3-way filter toggles visible lines; err line carries the gutter', async ({
    page,
  }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-stream-filter';
      seedRunWithStreamTaggedLog(ctx.worcaDir, runId);

      await page.goto(`${ctx.url}/#/history?run=${runId}`, GOTO_OPTS);
      await expect(page.locator('.run-detail .stage-panels')).toBeVisible({
        timeout: 8000,
      });

      await selectImplementStage(page);

      const rows = page.locator('.log-terminal .xterm-rows');

      // Default 'all' — both streams visible; err line shows the gutter marker.
      await expect(rows).toContainText('OUTMARKER', { timeout: 8000 });
      await expect(rows).toContainText('ERRMARKER');
      await expect(rows).toContainText('err│');

      // The segmented control is an sl-radio-group, not a 3rd dropdown.
      const filter = page.locator('.log-controls .log-stream-filter');
      await expect(filter).toHaveCount(1);
      await expect(filter.locator('sl-radio-button')).toHaveCount(3);

      // Filter to stderr only — stdout line drops out of the replay.
      await filter.locator('sl-radio-button[value="err"]').click();
      await expect(rows).toContainText('ERRMARKER', { timeout: 8000 });
      await expect(rows).not.toContainText('OUTMARKER');

      // Filter to stdout only — stderr line drops out.
      await filter.locator('sl-radio-button[value="out"]').click();
      await expect(rows).toContainText('OUTMARKER', { timeout: 8000 });
      await expect(rows).not.toContainText('ERRMARKER');

      // Back to all — both return without any refetch.
      await filter.locator('sl-radio-button[value="all"]').click();
      await expect(rows).toContainText('OUTMARKER', { timeout: 8000 });
      await expect(rows).toContainText('ERRMARKER');
    } finally {
      await ctx.close();
    }
  });
});
