/**
 * E2E tests for workspace batch add projects flow (W-039, cases 37-38).
 *
 * 37. Full workspace flow — open settings → Add Project → switch to Workspace →
 *     scan folder → select subfolders → submit → verify projects appear.
 * 38. Mode toggle preserves path — enter path in single mode → switch to
 *     workspace → path field still contains the entered value.
 *
 * Notes on Shoelace component interaction:
 * - sl-input is a web component; `.fill()` does not work. We use evaluate() to
 *   set the value property and dispatch the sl-input event.
 * - sl-radio/sl-radio-group use shadow DOM for internal rendering but the
 *   elements themselves are in the light DOM. We use evaluate() on the group to
 *   set its value and fire sl-change, matching what a user click would produce.
 * - sl-button is clickable directly via Playwright.
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { attachWsServer } from '../server/ws.js';
import { createInbox } from '../server/webhook-inbox.js';
import { writeProject } from '../server/project-registry.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

/**
 * Set a Shoelace sl-input value and dispatch the sl-input event so the
 * component's event handler fires (as if a user typed in the field).
 */
async function setSlInputValue(page, selector, value) {
  await page.locator(selector).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new CustomEvent('sl-input', { bubbles: true, composed: true }));
  }, value);
}

/**
 * Switch a Shoelace sl-radio-group to a given value and dispatch sl-change,
 * replicating what Shoelace does when the user clicks a radio button.
 */
async function setSlRadioGroupValue(page, groupSelector, value) {
  await page.locator(groupSelector).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new CustomEvent('sl-change', { bubbles: true, composed: true }));
  }, value);
}

/**
 * Start a multi-project server backed by a temporary directory.
 */
async function startWorkspaceServer() {
  const dir = join(tmpdir(), `worca-ws-e2e-${Date.now()}`);
  const prefsDir = join(dir, 'prefs');
  const projectRoot = join(dir, 'default-project');

  mkdirSync(prefsDir, { recursive: true });
  mkdirSync(join(projectRoot, '.worca', 'runs'), { recursive: true });
  mkdirSync(join(projectRoot, '.worca', 'results'), { recursive: true });
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'settings.json'), '{}');

  writeProject(prefsDir, { name: 'default-project', path: projectRoot });

  const worcaDir = join(projectRoot, '.worca');
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  const webhookInbox = createInbox();
  const app = createApp({
    worcaDir,
    settingsPath,
    projectRoot,
    prefsDir,
    webhookInbox,
  });
  const server = createServer(app);

  const { wss, broadcast, scheduleRefresh } = attachWsServer(server, {
    worcaDir,
    settingsPath,
    prefsPath: join(dir, 'preferences.json'),
    prefsDir,
    webhookInbox,
  });

  app.locals.broadcast = broadcast;
  app.locals.scheduleRefresh = scheduleRefresh;

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    dir,
    prefsDir,
    close: () => {
      for (const client of wss.clients) {
        try { client.terminate(); } catch { /* ignore */ }
      }
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve)).finally(() =>
        rmSync(dir, { recursive: true, force: true }),
      );
    },
  };
}

/**
 * Create immediate subdirectories with .git folders inside parentDir.
 * Uses mkdir instead of git init — the scan endpoint only checks for .git existence.
 */
function createWorkspaceWithGitRepos(parentDir, names) {
  mkdirSync(parentDir, { recursive: true });
  for (const name of names) {
    mkdirSync(join(parentDir, name, '.git'), { recursive: true });
  }
}

// ─── Test 37: Full workspace flow ────────────────────────────────────────────

test.describe('workspace batch add — full flow (case 37)', () => {
  let ctx;

  test.beforeAll(async () => {
    ctx = await startWorkspaceServer();
  });

  test.afterAll(async () => {
    if (ctx) await ctx.close();
  });

  test('scans workspace, selects subfolders, submits, projects appear in list', async ({ page }) => {
    const workspaceDir = join(ctx.dir, 'workspace');
    createWorkspaceWithGitRepos(workspaceDir, ['repo-alpha', 'repo-beta']);

    // Navigate to the settings view
    await page.goto(`${ctx.url}/#/settings`, GOTO_OPTS);
    await expect(page.locator('h3:has-text("Projects")')).toBeVisible({ timeout: 10000 });

    // Open Add Project dialog
    await page.locator('sl-button:has-text("Add Project")').click();
    const dialog = page.locator('sl-dialog[label="Add Project"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Switch to Workspace mode — use evaluate to set the radio-group value and
    // fire sl-change, which is what Shoelace emits when the user picks a radio.
    await setSlRadioGroupValue(page, 'sl-radio-group', 'workspace');

    // The workspace scan area should now be in the DOM
    await expect(page.locator('#workspace-scan-area')).toBeAttached({ timeout: 5000 });

    // Set the path and trigger the scan
    await setSlInputValue(page, '#add-project-path', workspaceDir);

    // Wait for the scan results — the scan fires after a 300ms debounce and
    // may complete before the spinner is even observed on a fast machine, so
    // we wait directly for the checkboxes rather than polling the spinner.
    const scanArea = page.locator('#workspace-scan-area');
    await expect(scanArea.locator('.dialog-list-row-name').filter({ hasText: 'repo-alpha' })).toBeAttached({ timeout: 15000 });
    await expect(scanArea.locator('.dialog-list-row-name').filter({ hasText: 'repo-beta' })).toBeAttached();

    // Submit button should reflect 2 pre-selected projects
    const submitBtn = page.locator('#submit-btn');
    await expect(submitBtn).toHaveText(/Add Projects \(2\)/i, { timeout: 5000 });

    // Intercept the batch POST to capture the payload without blocking it
    const batchRequests = [];
    await page.route('**/api/projects/batch', async (route) => {
      const body = await route.request().postDataJSON();
      batchRequests.push(body);
      await route.continue();
    });

    // Click submit
    await submitBtn.click();

    // Confirm the batch request was sent with both projects
    await expect.poll(() => batchRequests.length, { timeout: 10000 }).toBeGreaterThan(0);
    const submittedNames = batchRequests[0].projects.map((p) => p.name).sort();
    expect(submittedNames).toEqual(['repo-alpha', 'repo-beta']);

    // The Add Project dialog closes after successful submission
    await expect(dialog).not.toBeAttached({ timeout: 10000 });

    // Navigate back to settings and verify both projects appear in the list
    await page.goto(`${ctx.url}/#/dashboard`, GOTO_OPTS);
    await page.goto(`${ctx.url}/#/settings`, GOTO_OPTS);
    await expect(page.locator('h3:has-text("Projects")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.proj-name').filter({ hasText: 'repo-alpha' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.proj-name').filter({ hasText: 'repo-beta' })).toBeVisible({ timeout: 10000 });
  });
});

// ─── Test 38: Mode toggle preserves path ─────────────────────────────────────

test.describe('workspace batch add — mode toggle preserves path (case 38)', () => {
  let ctx;

  test.beforeAll(async () => {
    ctx = await startWorkspaceServer();
  });

  test.afterAll(async () => {
    if (ctx) await ctx.close();
  });

  test('entering path in single mode then switching to workspace keeps path value', async ({ page }) => {
    const workspaceDir = join(ctx.dir, 'toggle-test-workspace');
    mkdirSync(workspaceDir, { recursive: true });

    // Navigate to settings
    await page.goto(`${ctx.url}/#/settings`, GOTO_OPTS);
    await expect(page.locator('h3:has-text("Projects")')).toBeVisible({ timeout: 10000 });

    // Open Add Project dialog
    await page.locator('sl-button:has-text("Add Project")').click();
    const dialog = page.locator('sl-dialog[label="Add Project"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // In single mode the name field is visible
    await expect(page.locator('#add-project-name')).toBeAttached({ timeout: 5000 });

    // Enter a path while in single mode
    await setSlInputValue(page, '#add-project-path', workspaceDir);

    // Switch to workspace mode
    await setSlRadioGroupValue(page, 'sl-radio-group', 'workspace');

    // The path value must be preserved after the mode switch
    const pathValue = await page.locator('#add-project-path').evaluate((el) => el.value);
    expect(pathValue).toBe(workspaceDir);

    // The name field is replaced by the scan area in workspace mode
    await expect(page.locator('#add-project-name')).not.toBeAttached({ timeout: 5000 });
    await expect(page.locator('#workspace-scan-area')).toBeAttached({ timeout: 5000 });
  });
});
