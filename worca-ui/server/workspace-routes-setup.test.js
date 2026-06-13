/**
 * Tests: workspace setup wizard endpoints (W-073).
 *   GET  /api/workspaces/:name/setup/preflight
 *   POST /api/workspaces/:name/setup/apply
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceRouter } from './workspace-routes.js';

function createTestServer(opts = {}, locals = {}) {
  const app = express();
  app.use(express.json());
  Object.assign(app.locals, locals);
  const router = createWorkspaceRouter(opts);
  app.use('/api/workspaces', router.workspaces);
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe('Workspace setup endpoints', () => {
  let tmpDir;
  let workspacesDir;
  let wsRoot;
  let server;
  let base;

  function registerWorkspace() {
    mkdirSync(workspacesDir, { recursive: true });
    writeFileSync(
      join(workspacesDir, 'my-workspace.json'),
      JSON.stringify({ name: 'my-workspace', path: wsRoot }),
    );
    writeFileSync(
      join(wsRoot, 'workspace.json'),
      JSON.stringify({
        name: 'my-workspace',
        projects: [
          { name: 'api', path: 'api', depends_on: [] },
          { name: 'web', path: 'web', depends_on: ['api'] },
        ],
      }),
    );
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-setup-test-'));
    workspacesDir = join(tmpDir, 'workspaces.d');
    wsRoot = join(tmpDir, 'workspace-root');
    mkdirSync(join(wsRoot, 'api', '.claude'), { recursive: true });
    mkdirSync(join(wsRoot, 'web', '.claude'), { recursive: true });
    writeFileSync(join(wsRoot, 'api', '.claude', 'settings.json'), '{}');
    writeFileSync(join(wsRoot, 'web', '.claude', 'settings.json'), '{}');
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preflight aggregates per-child diagnostics', async () => {
    registerWorkspace();
    ({ server, base } = await createTestServer(
      { workspacesDir },
      { graphifyStatus: { detect: async () => ({ installed: true }) } },
    ));
    const res = await fetch(
      `${base}/api/workspaces/my-workspace/setup/preflight`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.isWorkspace).toBe(true);
    expect(body.projectCount).toBe(2);
    expect(body.graphifyInstalled).toBe(true);
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0].name).toBe('api');
    expect(Array.isArray(body.templates)).toBe(true);
  });

  it('preflight 404s for an unknown workspace', async () => {
    ({ server, base } = await createTestServer({ workspacesDir }));
    const res = await fetch(`${base}/api/workspaces/nope/setup/preflight`);
    expect(res.status).toBe(404);
  });

  it('apply writes the patch to every child settings.json', async () => {
    registerWorkspace();
    ({ server, base } = await createTestServer({ workspacesDir }));
    const res = await fetch(`${base}/api/workspaces/my-workspace/setup/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseBranch: 'master' }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.applied).toEqual(['api', 'web']);

    for (const child of ['api', 'web']) {
      const settings = JSON.parse(
        readFileSync(join(wsRoot, child, '.claude', 'settings.json'), 'utf8'),
      );
      expect(settings.worca.parallel.default_base_branch).toBe('master');
    }
  });

  it('apply 404s for an unknown workspace', async () => {
    ({ server, base } = await createTestServer({ workspacesDir }));
    const res = await fetch(`${base}/api/workspaces/nope/setup/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseBranch: 'main' }),
    });
    expect(res.status).toBe(404);
  });
});
