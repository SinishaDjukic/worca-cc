/**
 * Tests: GET /setup/preflight + POST /setup/apply (W-073).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { createProjectRoutes, createProjectScopedRoutes, projectResolver } =
  await import('./project-routes.js');

function makeApp(prefsDir, projectRoot, locals = {}) {
  const app = express();
  app.use(express.json());
  Object.assign(app.locals, locals);
  app.use('/api/projects', createProjectRoutes({ prefsDir, projectRoot }));
  app.use(
    '/api/projects/:projectId',
    projectResolver({ prefsDir, projectRoot }),
    createProjectScopedRoutes(),
  );
  return app;
}

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

describe('GET /setup/preflight', () => {
  let prefsDir;
  let projectRoot;

  beforeEach(() => {
    prefsDir = join(
      tmpdir(),
      `worca-prefs-pf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    projectRoot = join(
      tmpdir(),
      `worca-proj-pf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(prefsDir, { recursive: true });
    mkdirSync(join(projectRoot, '.worca'), { recursive: true });
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), '{}');
  });

  afterEach(() => {
    rmSync(prefsDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  async function projectName(app) {
    const { body } = await request(app, 'GET', '/api/projects');
    return body.projects[0].name;
  }

  it('returns ok with detected fields', async () => {
    const app = makeApp(prefsDir, projectRoot);
    const name = await projectName(app);
    const { status, body } = await request(
      app,
      'GET',
      `/api/projects/${name}/setup/preflight`,
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.baseBranch).toBe('string');
    expect(body.graphifyInstalled).toBe(false);
    expect(body.crgInstalled).toBe(false);
    expect(body.worcaInstalled).toBe(false);
    expect(body.currentSettings).toBeDefined();
  });

  it('reports worcaInstalled true when .claude/worca exists', async () => {
    mkdirSync(join(projectRoot, '.claude', 'worca'), { recursive: true });
    const app = makeApp(prefsDir, projectRoot);
    const name = await projectName(app);
    const { body } = await request(
      app,
      'GET',
      `/api/projects/${name}/setup/preflight`,
    );
    expect(body.worcaInstalled).toBe(true);
  });

  it('reflects injected graphify/crg status', async () => {
    const app = makeApp(prefsDir, projectRoot, {
      graphifyStatus: { detect: async () => ({ installed: true }) },
      crgStatus: { detect: async () => ({ installed: true }) },
    });
    const name = await projectName(app);
    const { body } = await request(
      app,
      'GET',
      `/api/projects/${name}/setup/preflight`,
    );
    expect(body.graphifyInstalled).toBe(true);
    expect(body.crgInstalled).toBe(true);
  });

  it('pre-populates currentSettings from settings.json', async () => {
    writeFileSync(
      join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({
        worca: { parallel: { default_base_branch: 'master' } },
      }),
    );
    const app = makeApp(prefsDir, projectRoot);
    const name = await projectName(app);
    const { body } = await request(
      app,
      'GET',
      `/api/projects/${name}/setup/preflight`,
    );
    expect(body.currentSettings.baseBranch).toBe('master');
  });

  it('404s for an unknown project', async () => {
    const app = makeApp(prefsDir, projectRoot);
    const { status } = await request(
      app,
      'GET',
      '/api/projects/does-not-exist/setup/preflight',
    );
    expect(status).toBe(404);
  });
});

describe('POST /setup/apply', () => {
  let prefsDir;
  let projectRoot;

  beforeEach(() => {
    prefsDir = join(
      tmpdir(),
      `worca-prefs-ap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    projectRoot = join(
      tmpdir(),
      `worca-proj-ap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(prefsDir, { recursive: true });
    mkdirSync(join(projectRoot, '.worca'), { recursive: true });
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), '{}');
  });

  afterEach(() => {
    rmSync(prefsDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  async function projectName(app) {
    const { body } = await request(app, 'GET', '/api/projects');
    return body.projects[0].name;
  }

  function readSettings() {
    return JSON.parse(
      readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf8'),
    );
  }

  it('applies a base-branch patch and persists it', async () => {
    const app = makeApp(prefsDir, projectRoot);
    const name = await projectName(app);
    const { status, body } = await request(
      app,
      'POST',
      `/api/projects/${name}/setup/apply`,
      { baseBranch: 'master' },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readSettings().worca.parallel.default_base_branch).toBe('master');
  });

  it('applies a graphify-enable patch', async () => {
    const app = makeApp(prefsDir, projectRoot);
    const name = await projectName(app);
    await request(app, 'POST', `/api/projects/${name}/setup/apply`, {
      graphifyEnabled: true,
    });
    expect(readSettings().worca.graphify.enabled).toBe(true);
  });

  it('applies a template patch', async () => {
    const app = makeApp(prefsDir, projectRoot);
    const name = await projectName(app);
    await request(app, 'POST', `/api/projects/${name}/setup/apply`, {
      template: { tier: 'builtin', id: 'quick-fix' },
    });
    expect(readSettings().worca.default_template).toEqual({
      tier: 'builtin',
      id: 'quick-fix',
    });
  });

  it('rejects a non-object body', async () => {
    const app = makeApp(prefsDir, projectRoot);
    const name = await projectName(app);
    const { status } = await request(
      app,
      'POST',
      `/api/projects/${name}/setup/apply`,
      ['not', 'an', 'object'],
    );
    expect(status).toBe(400);
  });
});
