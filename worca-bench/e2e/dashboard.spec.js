import { expect, test } from '@playwright/test';
import { startServer } from './fixtures.js';

let srv;

test.beforeAll(async () => {
  srv = await startServer();
});

test.afterAll(async () => {
  await srv?.close();
});

test('dashboard renders profile cards', async ({ page }) => {
  await page.goto(srv.url);
  await expect(page.locator('.run-card').first()).toBeVisible();
  const cards = page.locator('.run-card');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('.run-card-title').first()).toContainText(
    'smoke-feature-opus',
  );
});

test('profile card shows a resolved-rate badge', async ({ page }) => {
  await page.goto(srv.url);
  await expect(page.locator('.run-card').first()).toBeVisible();
  await expect(
    page.locator('.run-card-stage-badge', { hasText: 'Resolved' }).first(),
  ).toBeVisible();
});

test('navigating to a profile shows the detail reps table', async ({
  page,
}) => {
  await page.goto(srv.url);
  await page
    .locator('.run-card-title', { hasText: 'smoke-feature-opus' })
    .click();
  await expect(page.locator('.reps-table')).toBeVisible();
  await expect(page.locator('.reps-table tbody tr')).toHaveCount(2);
});

test('compare view renders a side-by-side table', async ({ page }) => {
  await page.goto(
    `${srv.url}/#/compare?profiles=smoke-feature-opus,smoke-quickfix-sonnet`,
  );
  await expect(page.locator('.compare-table')).toBeVisible();
  await expect(page.locator('.compare-table th')).toContainText([
    'Metric',
    'smoke-feature-opus',
    'smoke-quickfix-sonnet',
  ]);
});

test('navigates from dashboard to leaderboard', async ({ page }) => {
  await page.goto(srv.url);
  await page.locator('.nav-link', { hasText: 'Leaderboard' }).click();
  await expect(page.locator('.leaderboard-table')).toBeVisible();
  await expect(page.locator('h1')).toContainText('Leaderboard');
});
