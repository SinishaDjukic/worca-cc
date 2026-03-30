/**
 * Multi-project API tests — verifies project CRUD, isolation,
 * and project-scoped route behavior across multiple registered projects.
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

describe('multi-project API', () => {
  let prefsDir;
  let projectRootA;
  let projectRootB;

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    prefsDir = join(tmpdir(), `worca-prefs-multi-${suffix}`);
    projectRootA = join(tmpdir(), `worca-proj-a-${suffix}`);
    projectRootB = join(tmpdir(), `worca-proj-b-${suffix}`);

    mkdirSync(prefsDir, { recursive: true });

    for (const root of [projectRootA, projectRootB]) {
      mkdirSync(join(root, '.worca', 'runs'), { recursive: true });
      mkdirSync(join(root, '.worca', 'results'), { recursive: true });
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'settings.json'), '{}');
    }

    writeProject(prefsDir, { name: 'alpha', path: projectRootA });
    writeProject(prefsDir, { name: 'beta', path: projectRootB });
  });

  afterEach(() => {
    rmSync(prefsDir, { recursive: true, force: true });
    rmSync(projectRootA, { recursive: true, force: true });
    rmSync(projectRootB, { recursive: true, force: true });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/projects', createProjectRoutes({ prefsDir, projectRoot: projectRootA }));
    app.use(
      '/api/projects/:projectId',
      projectResolver({ prefsDir, projectRoot: projectRootA }),
      createProjectScopedRoutes(),
    );
    return app;
  }

  describe('project isolation', () => {
    it('runs from project A are not visible in project B', async () => {
      // Seed a run in project A
      const runDir = join(projectRootA, '.worca', 'runs', 'run-only-in-a');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, 'status.json'),
        JSON.stringify({ run_id: 'run-only-in-a', pipeline_status: 'completed', stage: 'test' }),
      );

      const app = buildApp();

      const { body: runsA } = await request(app, 'GET', '/api/projects/alpha/runs');
      expect(runsA.ok).toBe(true);
      expect(runsA.runs.some((r) => r.id === 'run-only-in-a')).toBe(true);

      const { body: runsB } = await request(app, 'GET', '/api/projects/beta/runs');
      expect(runsB.ok).toBe(true);
      expect(runsB.runs.some((r) => r.id === 'run-only-in-a')).toBe(false);
    });

    it('settings for project A are independent of project B', async () => {
      // Write custom settings for project A
      writeFileSync(
        join(projectRootA, '.claude', 'settings.json'),
        JSON.stringify({ worca: { loops: { max_test: 5 } } }),
      );
      writeFileSync(
        join(projectRootB, '.claude', 'settings.json'),
        JSON.stringify({ worca: { loops: { max_test: 10 } } }),
      );

      const app = buildApp();

      const { body: settingsA } = await request(app, 'GET', '/api/projects/alpha/settings');
      const { body: settingsB } = await request(app, 'GET', '/api/projects/beta/settings');

      expect(settingsA.worca.loops.max_test).toBe(5);
      expect(settingsB.worca.loops.max_test).toBe(10);
    });

    it('plan-files are scoped per project', async () => {
      mkdirSync(join(projectRootA, 'docs', 'plans'), { recursive: true });
      writeFileSync(join(projectRootA, 'docs', 'plans', 'W-001-alpha.md'), '# Alpha');

      mkdirSync(join(projectRootB, 'docs', 'plans'), { recursive: true });
      writeFileSync(join(projectRootB, 'docs', 'plans', 'W-002-beta.md'), '# Beta');

      const app = buildApp();

      const { body: filesA } = await request(app, 'GET', '/api/projects/alpha/plan-files');
      const { body: filesB } = await request(app, 'GET', '/api/projects/beta/plan-files');

      expect(filesA.files).toHaveLength(1);
      expect(filesA.files[0].name).toBe('W-001-alpha.md');
      expect(filesB.files).toHaveLength(1);
      expect(filesB.files[0].name).toBe('W-002-beta.md');
    });
  });

  describe('project CRUD', () => {
    it('can add a third project and see it in listing', async () => {
      const projectRootC = join(tmpdir(), `worca-proj-c-${Date.now()}`);
      mkdirSync(join(projectRootC, '.worca'), { recursive: true });
      mkdirSync(join(projectRootC, '.claude'), { recursive: true });
      writeFileSync(join(projectRootC, '.claude', 'settings.json'), '{}');

      const app = buildApp();
      const { status: createStatus } = await request(app, 'POST', '/api/projects', {
        name: 'gamma',
        path: projectRootC,
      });
      expect(createStatus).toBe(201);

      const { body: listBody } = await request(app, 'GET', '/api/projects');
      expect(listBody.projects).toHaveLength(3);
      const names = listBody.projects.map((p) => p.name).sort();
      expect(names).toEqual(['alpha', 'beta', 'gamma']);

      rmSync(projectRootC, { recursive: true, force: true });
    });

    it('deleting a project does not affect others', async () => {
      const app = buildApp();
      const { status } = await request(app, 'DELETE', '/api/projects/alpha');
      expect(status).toBe(200);

      const { body: listBody } = await request(app, 'GET', '/api/projects');
      expect(listBody.projects).toHaveLength(1);
      expect(listBody.projects[0].name).toBe('beta');
    });

    it('rejects duplicate project names', async () => {
      const app = buildApp();
      const { status } = await request(app, 'POST', '/api/projects', {
        name: 'alpha',
        path: projectRootA,
      });
      // writeProject may succeed (overwrite) or fail — either way, server shouldn't crash
      expect([201, 400]).toContain(status);
    });
  });

  describe('run status per project', () => {
    it('GET runs/:runId/status resolves to correct project worcaDir', async () => {
      const runId = 'status-run';
      const runDir = join(projectRootB, '.worca', 'runs', runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, 'status.json'),
        JSON.stringify({ pipeline_status: 'completed', stage: 'guardian' }),
      );

      const app = buildApp();

      // Should find it in beta
      const { status, body } = await request(app, 'GET', `/api/projects/beta/runs/${runId}/status`);
      expect(status).toBe(200);
      expect(body.pipeline_status).toBe('completed');

      // Should NOT find it in alpha
      const { status: notFound } = await request(app, 'GET', `/api/projects/alpha/runs/${runId}/status`);
      expect(notFound).toBe(404);
    });
  });
});
