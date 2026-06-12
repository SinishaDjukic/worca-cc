import { expect, test } from '@playwright/test';
import { startServer } from './fixtures.js';

/**
 * W-061 in-app help — opt-in toggle pattern.
 *
 * The "Docs" tab on the right edge + the `?` keyboard shortcut both flip
 * `body.help-mode-active`, which reveals every `.help-badge` that
 * `helpFor()` rendered into the page. Badges are real anchor links to
 * `docs.worca.dev/<slug>/`, opening in a new tab.
 *
 * Per CLAUDE.md: run this spec with `--workers=1` to avoid the parallel
 * worker contamination Playwright still hits in this repo.
 */

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

test.describe('help-mode toggle — edge tab + hotkey + reveal', () => {
  test('edge tab is mounted on bootstrap, before any user interaction', async ({
    page,
  }) => {
    const ctx = await startServer();
    try {
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      const tab = page.locator('.help-edge-tab');
      await expect(tab).toBeVisible();
      // Reads "Docs" — distinguishes from chat-widget side tabs.
      await expect(tab.locator('.help-edge-tab__label')).toHaveText('Docs');
      // aria-pressed reflects the current help-mode state.
      await expect(tab).toHaveAttribute('aria-pressed', 'false');
    } finally {
      await ctx.close();
    }
  });

  test('badges are hidden until help mode activates, then revealed', async ({
    page,
  }) => {
    const ctx = await startServer();
    try {
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      // The sidebar Running item carries helpFor('monitoring') — the badge
      // element exists in the DOM but starts hidden via `display: none`.
      // (The dashboard's root-level badge was removed in favor of the
      // content-header / sidebar placements — 2026-06 sweep.)
      const badge = page.locator('.sidebar-item .help-badge').first();
      await expect(badge).toBeAttached();
      await expect(badge).toBeHidden();

      // Click the edge tab to flip help mode on.
      await page.locator('.help-edge-tab').click();
      await expect(page.locator('body.help-mode-active')).toBeVisible();
      await expect(page.locator('.help-edge-tab')).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      // Now the badge becomes visible.
      await expect(badge).toBeVisible();
      // And it carries a real href into the canonical docs URL.
      await expect(badge).toHaveAttribute(
        'href',
        /https:\/\/docs\.worca\.dev\/running-pipelines\/monitoring-a-run\//,
      );
      // Anchor opens in a new tab safely.
      await expect(badge).toHaveAttribute('target', '_blank');
      await expect(badge).toHaveAttribute('rel', /noopener/);
    } finally {
      await ctx.close();
    }
  });

  test('`?` hotkey toggles help mode when typed outside a text input', async ({
    page,
  }) => {
    const ctx = await startServer();
    try {
      await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
      // Move focus to <body> so the keystroke isn't swallowed by any
      // form control the page auto-focused on load.
      await page.locator('body').click({ position: { x: 5, y: 5 } });

      await page.keyboard.press('Shift+Slash'); // produces "?"
      await expect(page.locator('body.help-mode-active')).toBeVisible();

      // Escape closes it.
      await page.keyboard.press('Escape');
      await expect(page.locator('body.help-mode-active')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('Settings tabs each sprout a badge in help mode', async ({ page }) => {
    const ctx = await startServer();
    try {
      await page.goto(`${ctx.url}/#/settings`, GOTO_OPTS);
      // Activate help mode.
      await page.locator('.help-edge-tab').click();
      await expect(page.locator('body.help-mode-active')).toBeVisible();

      // The "Integrations" tab in the global settings panel carries
      // helpFor('chat') → integrations/chat-integrations.
      const tabBadge = page
        .locator('sl-tab[panel="integrations"] .help-badge')
        .first();
      await expect(tabBadge).toBeVisible();
      await expect(tabBadge).toHaveAttribute(
        'href',
        /https:\/\/docs\.worca\.dev\/integrations\/chat-integrations\//,
      );
    } finally {
      await ctx.close();
    }
  });
});
