/**
 * Playwright e2e tests for the Project Setup Wizard (W-073).
 * Run with: cd worca-ui && npx playwright test e2e/project-setup-wizard.spec.js --workers=1
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createApp } from '../server/app.js';
import { writeProject } from '../server/project-registry.js';
import { createInbox } from '../server/webhook-inbox.js';
import { attachWsServer } from '../server/ws.js';

const GOTO_OPTS = { waitUntil: 'domcontentloaded' };

/** Start a global-mode server with one registered project named "alpha". */
async function startServerWithProject() {
  const dir = join(tmpdir(), `worca-setup-e2e-${Date.now()}`);
  const prefsDir = join(dir, 'prefs');
  const projectRoot = join(dir, 'alpha');
  mkdirSync(prefsDir, { recursive: true });
  mkdirSync(join(projectRoot, '.worca', 'runs'), { recursive: true });
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'settings.json'), '{}');
  // Mark worca as installed so the wizard's 5-step flow (no install step) runs.
  mkdirSync(join(projectRoot, '.claude', 'worca'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.claude', 'worca', 'version.json'),
    JSON.stringify({ version: '0.0.0-test' }),
  );
  writeProject(prefsDir, { name: 'alpha', path: projectRoot });

  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  const worcaDir = join(projectRoot, '.worca');
  const webhookInbox = createInbox();
  const app = createApp({
    worcaDir,
    settingsPath,
    projectRoot,
    prefsDir,
    webhookInbox,
  });
  // Replace the real graphify/CRG detection (which spawns Python and can be
  // slow) with instant stubs so the preflight step resolves immediately.
  const stubStatus = {
    detect: async () => ({ installed: false }),
    invalidate: () => {},
    getStatus: async () => ({ ok: true, detection: { installed: false } }),
  };
  app.locals.graphifyStatus = stubStatus;
  app.locals.crgStatus = stubStatus;

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
    projectRoot,
    close: () => {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
      }
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve)).finally(() =>
        rmSync(dir, { recursive: true, force: true }),
      );
    },
  };
}

async function openProjectsTab(page, ctx) {
  await page.goto(`${ctx.url}/#/settings`, GOTO_OPTS);
  await page.locator('sl-tab[panel="projects"]').click();
  await page.locator('.projects-config-table').waitFor({ state: 'visible' });
}

function dialog(page) {
  return page.locator('sl-dialog.project-setup-wizard');
}

function footerButton(page, label) {
  return dialog(page).locator('sl-button', { hasText: label });
}

test('Projects tab renders a table with a Setup action that opens the wizard', async ({
  page,
}) => {
  const ctx = await startServerWithProject();
  try {
    await openProjectsTab(page, ctx);

    const headers = await page
      .locator('.projects-config-table th')
      .allTextContents();
    expect(headers.map((h) => h.trim())).toEqual([
      'Name',
      'Path',
      'worca version',
      'Actions',
    ]);

    await page.locator('sl-tooltip[content="Project setup"] button').click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute('label', 'Project Setup');
    await expect(page.locator('.wizard-step-title')).toHaveText(
      'Your Project Environment',
    );
  } finally {
    await ctx.close();
  }
});

test('wizard walks every step and persists the base branch', async ({
  page,
}) => {
  const ctx = await startServerWithProject();
  try {
    await openProjectsTab(page, ctx);
    await page.locator('sl-tooltip[content="Project setup"] button').click();
    await expect(dialog(page)).toBeVisible();

    await footerButton(page, 'Continue').click();
    await expect(page.locator('.wizard-step-title')).toHaveText(
      'Set PR Base Branch',
    );

    await page.locator('#wizard-base-branch').evaluate((el) => {
      el.value = 'release-1.x';
      el.dispatchEvent(new Event('sl-input'));
    });
    await footerButton(page, 'Next').click();
    await expect(page.locator('.wizard-step-title')).toHaveText(
      'Enable Optional Tools',
    );

    await footerButton(page, 'Next').click();
    await expect(page.locator('.wizard-step-title')).toHaveText(
      'Set Default Template',
    );

    await footerButton(page, 'Next').click();
    await expect(page.locator('.wizard-step-title')).toHaveText("You're All Set");
    await expect(dialog(page)).toContainText('Base branch set to release-1.x');

    await footerButton(page, 'Done').click();
    await expect(dialog(page)).toHaveCount(0);

    const settings = JSON.parse(
      readFileSync(join(ctx.projectRoot, '.claude', 'settings.json'), 'utf8'),
    );
    expect(settings.worca.parallel.default_base_branch).toBe('release-1.x');
  } finally {
    await ctx.close();
  }
});

test('Skip Setup closes the wizard without writing settings', async ({
  page,
}) => {
  const ctx = await startServerWithProject();
  try {
    await openProjectsTab(page, ctx);
    await page.locator('sl-tooltip[content="Project setup"] button').click();
    await expect(dialog(page)).toBeVisible();

    await footerButton(page, 'Skip Setup').click();
    await expect(dialog(page)).toHaveCount(0);

    const settings = JSON.parse(
      readFileSync(join(ctx.projectRoot, '.claude', 'settings.json'), 'utf8'),
    );
    expect(settings.worca?.parallel?.default_base_branch).toBeUndefined();
  } finally {
    await ctx.close();
  }
});
