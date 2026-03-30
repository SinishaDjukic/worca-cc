/**
 * E2E test: multi-project API endpoints.
 *
 * Verifies that:
 *   1. The projects API lists registered projects
 *   2. Project-scoped runs are isolated
 *   3. Project info endpoint works
 *   4. Run status endpoint works within project scope
 *   5. Unknown project returns 404
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
import { seedRun } from './fixtures.js';

/** Start a multi-project server with prefsDir and two registered projects. */
async function startMultiProjectServer() {
  const dir = join(tmpdir(), `worca-mp-e2e-${Date.now()}`);
  const prefsDir = join(dir, 'prefs');
  const projectRootA = join(dir, 'proj-a');
  const projectRootB = join(dir, 'proj-b');

  mkdirSync(prefsDir, { recursive: true });
  for (const root of [projectRootA, projectRootB]) {
    mkdirSync(join(root, '.worca', 'runs'), { recursive: true });
    mkdirSync(join(root, '.worca', 'results'), { recursive: true });
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), '{}');
  }

  writeProject(prefsDir, { name: 'alpha', path: projectRootA });
  writeProject(prefsDir, { name: 'beta', path: projectRootB });

  const settingsPath = join(projectRootA, '.claude', 'settings.json');
  const worcaDir = join(projectRootA, '.worca');
  const webhookInbox = createInbox();
  const app = createApp({
    worcaDir,
    settingsPath,
    projectRoot: projectRootA,
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
    worcaDirA: join(projectRootA, '.worca'),
    worcaDirB: join(projectRootB, '.worca'),
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

test.describe('multi-project', () => {
  let ctx;

  test.beforeAll(async () => {
    ctx = await startMultiProjectServer();
  });

  test.afterAll(async () => {
    if (ctx) await ctx.close();
  });

  test('lists registered projects via API', async ({ page }) => {
    const res = await page.request.get(`${ctx.url}/api/projects`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.projects).toHaveLength(2);
    const names = body.projects.map((p) => p.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });

  test('project-scoped runs are isolated', async ({ page }) => {
    seedRun(ctx.worcaDirA, 'run-in-alpha', { pipeline_status: 'completed', stage: 'test' });

    const runsA = await (await page.request.get(`${ctx.url}/api/projects/alpha/runs`)).json();
    expect(runsA.ok).toBe(true);
    expect(runsA.runs.some((r) => r.id === 'run-in-alpha')).toBe(true);

    const runsB = await (await page.request.get(`${ctx.url}/api/projects/beta/runs`)).json();
    expect(runsB.ok).toBe(true);
    expect(runsB.runs.some((r) => r.id === 'run-in-alpha')).toBe(false);
  });

  test('project info endpoint returns resolved project', async ({ page }) => {
    const infoRes = await page.request.get(`${ctx.url}/api/projects/alpha/info`);
    const body = await infoRes.json();
    expect(body.ok).toBe(true);
    expect(body.project.name).toBe('alpha');
    expect(body.project.worcaDir).toBeTruthy();
  });

  test('run status endpoint works within project scope', async ({ page }) => {
    seedRun(ctx.worcaDirB, 'status-run-beta', {
      pipeline_status: 'completed',
      stage: 'guardian',
      stages: { guardian: { status: 'completed', iteration: 1 } },
    });

    const statusRes = await page.request.get(
      `${ctx.url}/api/projects/beta/runs/status-run-beta/status`,
    );
    const body = await statusRes.json();
    expect(body.ok).toBe(true);
    expect(body.pipeline_status).toBe('completed');
    expect(body.stage).toBe('guardian');

    // Same run should NOT be found in alpha
    const notFound = await page.request.get(
      `${ctx.url}/api/projects/alpha/runs/status-run-beta/status`,
    );
    expect(notFound.status()).toBe(404);
  });

  test('unknown project returns 404', async ({ page }) => {
    const res = await page.request.get(`${ctx.url}/api/projects/nonexistent/info`);
    expect(res.status()).toBe(404);
  });
});
