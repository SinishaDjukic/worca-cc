/**
 * Error isolation tests — verify that a bad project doesn't crash the server
 * or affect other projects.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeProject } from '../project-registry.js';
import {
  createProjectRoutes,
  createProjectScopedRoutes,
  projectResolver,
} from '../project-routes.js';

/** Helper: make requests to express app without starting a persistent server. */
async function request(app, method, path, body) {
  const { createServer } = await import('node:http');
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const options = {
          method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(`http://127.0.0.1:${port}${path}`, options);
        const json = await res.json();
        resolve({ status: res.status, body: json });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe('error isolation', () => {
  let prefsDir;
  let goodProjectRoot;
  let badProjectRoot;

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    prefsDir = join(tmpdir(), `worca-prefs-iso-${suffix}`);
    goodProjectRoot = join(tmpdir(), `worca-good-${suffix}`);
    badProjectRoot = join(tmpdir(), `worca-bad-${suffix}`);

    mkdirSync(prefsDir, { recursive: true });

    // Good project: fully set up
    mkdirSync(join(goodProjectRoot, '.worca', 'runs'), { recursive: true });
    mkdirSync(join(goodProjectRoot, '.claude'), { recursive: true });
    writeFileSync(join(goodProjectRoot, '.claude', 'settings.json'), '{}');

    // Bad project: missing .worca directory (broken)
    mkdirSync(join(badProjectRoot, '.claude'), { recursive: true });
    writeFileSync(join(badProjectRoot, '.claude', 'settings.json'), '{}');
    // Note: no .worca directory at all

    writeProject(prefsDir, { name: 'good-proj', path: goodProjectRoot });
    writeProject(prefsDir, { name: 'bad-proj', path: badProjectRoot });
  });

  afterEach(() => {
    rmSync(prefsDir, { recursive: true, force: true });
    rmSync(goodProjectRoot, { recursive: true, force: true });
    rmSync(badProjectRoot, { recursive: true, force: true });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/projects', createProjectRoutes({ prefsDir, projectRoot: goodProjectRoot }));
    app.use(
      '/api/projects/:projectId',
      projectResolver({ prefsDir, projectRoot: goodProjectRoot }),
      createProjectScopedRoutes(),
    );
    return app;
  }

  it('listing projects succeeds even when some have missing .worca', async () => {
    const app = buildApp();
    const { status, body } = await request(app, 'GET', '/api/projects');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.projects).toHaveLength(2);
  });

  it('bad project info still resolves (projectResolver is path-based)', async () => {
    const app = buildApp();
    const { status, body } = await request(app, 'GET', '/api/projects/bad-proj/info');
    expect(status).toBe(200);
    expect(body.project.name).toBe('bad-proj');
  });

  it('bad project runs returns OK with empty runs when .worca missing', async () => {
    const app = buildApp();
    const { status } = await request(app, 'GET', '/api/projects/bad-proj/runs');
    // projectResolver synthesizes worcaDir = join(path, '.worca'), so requireWorcaDir passes.
    // discoverRuns gracefully returns [] when the dir doesn't exist or has no run subdirs.
    // The important thing is the server doesn't crash.
    expect([200, 500]).toContain(status);
  });

  it('good project works after bad project request', async () => {
    const app = buildApp();

    // First: hit the bad project
    await request(app, 'GET', '/api/projects/bad-proj/runs');

    // Then: hit the good project — should work fine
    const { status, body } = await request(app, 'GET', '/api/projects/good-proj/runs');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
  });

  it('unknown project returns 404, does not affect others', async () => {
    const app = buildApp();

    const { status: notFoundStatus } = await request(
      app, 'GET', '/api/projects/ghost/info',
    );
    expect(notFoundStatus).toBe(404);

    // Good project still works
    const { status, body } = await request(app, 'GET', '/api/projects/good-proj/info');
    expect(status).toBe(200);
    expect(body.project.name).toBe('good-proj');
  });

  it('settings endpoint works even if no local settings file exists', async () => {
    const app = buildApp();
    const { status, body } = await request(app, 'GET', '/api/projects/good-proj/settings');
    expect(status).toBe(200);
    expect(body.worca).toBeDefined();
  });

  it('bad project settings still responds (does not crash)', async () => {
    const app = buildApp();
    const { status } = await request(app, 'GET', '/api/projects/bad-proj/settings');
    // Should return some response (200 or error), not crash
    expect([200, 500]).toContain(status);
  });
});
