import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, seedRun, writeControlFile, waitForWsMessage } from './fixtures.js';

// Use domcontentloaded to avoid hanging on external resources (Google Fonts etc.)
const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

test.describe('browser test fixtures', () => {
  test('startServer boots at a random port and serves the UI', async ({ page }) => {
    const ctx = await startServer();
    try {
      await page.goto(ctx.url, GOTO_OPTS);
      // Title starts as "worca-ui" (HTML) then JS updates it — match the static part
      await expect(page.locator('#app')).toBeAttached();
      expect(ctx.port).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  test('seedRun creates status.json visible via /api/runs', async ({ page }) => {
    const ctx = await startServer();
    try {
      const runId = '20260101-fixture001';
      seedRun(ctx.worcaDir, runId, { pipeline_status: 'running' });
      const response = await page.request.get(`${ctx.url}/api/runs`);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.runs.some((r) => r.run_id === runId)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('writeControlFile writes control.json with the given action', async () => {
    const ctx = await startServer();
    try {
      const runId = '20260101-ctrl001';
      seedRun(ctx.worcaDir, runId, {});
      writeControlFile(ctx.worcaDir, runId, 'pause');
      const ctrl = JSON.parse(
        readFileSync(join(ctx.worcaDir, 'runs', runId, 'control.json'), 'utf8'),
      );
      expect(ctrl.action).toBe('pause');
      expect(ctrl.source).toBe('test');
    } finally {
      await ctx.close();
    }
  });

  test('waitForWsMessage captures the list-runs response sent by the app on connect', async ({ page }) => {
    const ctx = await startServer();
    try {
      // Register listener before page load so we don't miss the frame
      const msgPromise = waitForWsMessage(page, 'list-runs');
      await page.goto(ctx.url, GOTO_OPTS);
      const msg = await msgPromise;
      expect(msg.type).toBe('list-runs');
      expect(msg).toHaveProperty('payload');
    } finally {
      await ctx.close();
    }
  });
});
