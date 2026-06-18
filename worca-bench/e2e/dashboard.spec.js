import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('sidebar nav highlights the active section', async ({ page }) => {
  await page.goto(srv.url);
  // Dashboard is the home item and starts active.
  await expect(
    page.locator('.sidebar-item', { hasText: 'Dashboard' }),
  ).toHaveClass(/active/);
});

test('navigates from dashboard to leaderboard via the sidebar', async ({
  page,
}) => {
  await page.goto(srv.url);
  await page.locator('.sidebar-item', { hasText: 'Leaderboard' }).click();
  await expect(page.locator('.leaderboard-table')).toBeVisible();
  await expect(page.locator('.content-header-title')).toContainText(
    'Leaderboard',
  );
  await expect(
    page.locator('.sidebar-item', { hasText: 'Leaderboard' }),
  ).toHaveClass(/active/);
});

test('leaderboard ranks local profile runs into the table', async ({
  page,
}) => {
  await page.goto(`${srv.url}/#/leaderboard`);
  await expect(page.locator('.leaderboard-table')).toBeVisible();
  // Both seeded swe-bench-verified profiles surface as highlighted local rows…
  await expect(page.locator('.leaderboard-row--local')).toHaveCount(2);
  await expect(
    page.locator('.leaderboard-row--local', {
      hasText: 'smoke-quickfix-sonnet',
    }),
  ).toBeVisible();
  // …and the "this run" placeholder is gone once real local rows exist.
  await expect(page.getByText('worca (this run)')).toHaveCount(0);
});

test('top-level sidebar sections render no back button', async ({ page }) => {
  await page.goto(`${srv.url}/#/leaderboard`);
  await expect(page.locator('.leaderboard-table')).toBeVisible();
  await expect(page.locator('.content-header-back')).toHaveCount(0);
});

test('sub-pages render a back button that returns to the dashboard', async ({
  page,
}) => {
  await page.goto(srv.url);
  await page
    .locator('.run-card-title', { hasText: 'smoke-feature-opus' })
    .click();
  await expect(page.locator('.reps-table')).toBeVisible();
  await expect(page.locator('.content-header-back')).toBeVisible();
  await page.locator('.content-header-back').click();
  await expect(page.locator('.profile-grid')).toBeVisible();
});

test('select profiles and compare the chosen subset', async ({ page }) => {
  await page.goto(srv.url);
  const checks = page.locator('.run-card-select');
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole('button', { name: /Compare selected/ }).click();
  await expect(page.locator('.compare-table')).toBeVisible();
  // Metric column + 2 profile columns.
  await expect(page.locator('.compare-table thead th')).toHaveCount(3);
});

// NOTE: this detail-page launch test runs BEFORE the card-launch test below.
// The detail-page Run button carries a `runDisabled` guard that fires when the
// profile has a live `running` action; the stub launcher returns pid 1 (always
// alive on POSIX), so a prior launch's action never reconciles to completed and
// would leave this button disabled. Launching from here first keeps the action
// state clean; the card Run button (next test) has no such guard.
test('profile detail Run options launch reflects the reps override', async ({
  page,
}) => {
  await page.goto(srv.url);
  await page
    .locator('.run-card-title', { hasText: 'smoke-feature-opus' })
    .click();
  await expect(page.locator('.run-options')).toBeVisible();
  await page.locator('.run-opt-reps').fill('2');
  await page.locator('.run-opt-launch').click();
  const toast = page.locator('.launch-toast--success');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('2 reps');
});

test('clicking Run surfaces a launch toast with the pid', async ({ page }) => {
  await page.goto(srv.url);
  await expect(page.locator('.run-card').first()).toBeVisible();
  // The stubbed launcher returns pid 1 (see fixtures.js).
  await page
    .locator('.run-card', { hasText: 'smoke-feature-opus' })
    .getByRole('button', { name: 'Run' })
    .click();
  const toast = page.locator('.launch-toast--success');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('pid 1');
});

test('dashboard auto-refreshes when new results land', async ({ page }) => {
  // Fast poll so the test doesn't wait the default 5s tick.
  await page.goto(`${srv.url}/?poll=400`);
  await expect(page.locator('.run-card')).toHaveCount(2);
  // A new profile's result row lands on disk out-of-band (as a real run would).
  appendFileSync(
    join(srv.targetDir, 'results.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      profile: 'late-arrival',
      benchmark: 'swe-bench-verified',
      instance_id: 'inst-late',
      rep: 1,
      status: 'graded',
      resolved: true,
      score: 1.0,
      cost_usd: 0.2,
      wall_time_s: 300,
      loop_counters: { implement_test: 1 },
      completed_at: '2026-06-16T12:00:00Z',
    })}\n`,
  );
  // The background poll picks it up and the new card appears without a reload.
  await expect(
    page.locator('.run-card-title', { hasText: 'late-arrival' }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.run-card')).toHaveCount(3);
});

test('settings opens from the sidebar gear button', async ({ page }) => {
  await page.goto(srv.url);
  await page.locator('.sidebar-settings-btn').click();
  await expect(page.locator('.content-header-title')).toContainText('Settings');
  await expect(page.locator('.settings-dirs')).toBeVisible();
  // the launch dir is always shown as primary
  await expect(page.locator('.settings-dir--primary')).toBeVisible();
});

test('sidebar footer shows the backend connection indicator', async ({
  page,
}) => {
  await page.goto(srv.url);
  const conn = page.locator('.connection-indicator');
  await expect(conn).toBeVisible();
  await expect(conn).toHaveClass(/connected/, { timeout: 4000 });
  await expect(conn).toContainText('Connected');
});

test('Browse opens the folder picker and lists directories', async ({
  page,
}) => {
  await page.goto(srv.url);
  await page.locator('.sidebar-settings-btn').click();
  await page.locator('.settings-browse-btn').first().click();
  await expect(page.locator('#folder-picker-dialog')).toBeVisible();
  // The picker lists subfolders of the home dir (at least the "up" entry shows).
  await expect(page.locator('.folder-picker-path')).toBeVisible();
});

// Runs late so the server-persisted archive state doesn't perturb the
// card-count assertions in earlier tests. Restores state (un-archives) at the end.
test('archive hides a profile, the Archived filter reveals it', async ({
  page,
}) => {
  await page.goto(srv.url);
  await expect(page.locator('.profile-filter')).toBeVisible();
  const card = page.locator('.run-card', { hasText: 'smoke-feature-opus' });
  await expect(card).toBeVisible();

  // Select it and archive via the leftmost header action.
  await card.locator('.run-card-select').check();
  await page.getByRole('button', { name: /^Archive \(1\)/ }).click();

  // Gone from the default (Active) view.
  await expect(
    page.locator('.run-card', { hasText: 'smoke-feature-opus' }),
  ).toHaveCount(0);

  // The Archived pill reveals it.
  await page.locator('.filter-pill', { hasText: 'Archived' }).click();
  const archivedCard = page.locator('.run-card', {
    hasText: 'smoke-feature-opus',
  });
  await expect(archivedCard).toBeVisible();
  await expect(archivedCard).toHaveClass(/run-card--archived/);

  // Restore: un-archive so the persisted state is clean for re-runs.
  await archivedCard.locator('.run-card-select').check();
  await page.getByRole('button', { name: /^Unarchive \(1\)/ }).click();
  await expect(
    page.locator('.run-card', { hasText: 'smoke-feature-opus' }),
  ).toHaveCount(0); // gone from the Archived view now
});

test('removing a result dir requires confirmation', async ({ page }) => {
  // Seed a configured dir so a removable row exists.
  await page.request.post(`${srv.url}/api/settings/dirs`, {
    data: { dir: srv.targetDir },
  });
  await page.goto(srv.url);
  await page.locator('.sidebar-settings-btn').click();
  const removeBtn = page.locator('.settings-row-remove').first();
  await expect(removeBtn).toBeVisible();
  await removeBtn.click();
  // Confirm dialog appears; cancel leaves the row in place.
  await expect(page.locator('#global-confirm-dialog')).toBeVisible();
  await page
    .locator('#global-confirm-dialog sl-button[variant="default"]')
    .click();
  await expect(page.locator('.settings-row-remove')).toHaveCount(1);
});
