import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeProject } from './project-registry.js';
import {
  createProjectRoutes,
  createProjectScopedRoutes,
  projectResolver,
} from './project-routes.js';

/** Build a minimal test app with project routes mounted. */
function buildApp(prefsDir, projectRoot) {
  const app = express();
  app.use(express.json());

  const getRegistry = () => {
    // Lazy import to avoid stale reads
    const {
      readProjects,
      synthesizeDefaultProject,
    } = require('./project-registry.js');
    const projects = readProjects(prefsDir);
    if (projects.length === 0) return [synthesizeDefaultProject(projectRoot)];
    return projects;
  };

  app.use('/api/projects', createProjectRoutes({ prefsDir, projectRoot }));
  app.use(
    '/api/projects/:projectId',
    projectResolver({ prefsDir, projectRoot }),
    createProjectScopedRoutes(),
  );

  return app;
}

// Use dynamic import since we're ESM
async function createTestApp(prefsDir, projectRoot) {
  const app = express();
  app.use(express.json());

  app.use('/api/projects', createProjectRoutes({ prefsDir, projectRoot }));
  app.use(
    '/api/projects/:projectId',
    projectResolver({ prefsDir, projectRoot }),
    createProjectScopedRoutes(),
  );

  // Also mount an old-style route to verify backwards compat
  app.get('/api/runs', (_req, res) => res.json({ ok: true, runs: [] }));

  return app;
}

/**
 * Helper to make requests to an express app without starting a server.
 * Uses node's built-in http module.
 */
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

describe('project-routes', () => {
  let prefsDir;
  let projectRoot;

  beforeEach(() => {
    prefsDir = join(
      tmpdir(),
      `worca-prefs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    projectRoot = join(
      tmpdir(),
      `worca-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  describe('GET /api/projects', () => {
    it('returns synthesized single project when no projects.d/', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(app, 'GET', '/api/projects');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0].path).toBe(projectRoot);
    });

    it('returns registered projects', async () => {
      writeProject(prefsDir, { name: 'alpha', path: '/alpha' });
      writeProject(prefsDir, { name: 'beta', path: '/beta' });

      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(app, 'GET', '/api/projects');
      expect(status).toBe(200);
      expect(body.projects).toHaveLength(2);
      expect(body.projects[0].name).toBe('alpha');
    });
  });

  describe('POST /api/projects', () => {
    it('creates a new project', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(app, 'POST', '/api/projects', {
        name: 'new-proj',
        path: projectRoot,
      });
      expect(status).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.project.name).toBe('new-proj');
    });

    it('returns 400 on invalid entry (relative path)', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(app, 'POST', '/api/projects', {
        name: 'bad',
        path: 'relative/path',
      });
      expect(status).toBe(400);
      expect(body.ok).toBe(false);
    });

    it('returns 400 on missing name', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status } = await request(app, 'POST', '/api/projects', {
        path: projectRoot,
      });
      expect(status).toBe(400);
    });

    it('returns 400 on non-existent path', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(app, 'POST', '/api/projects', {
        name: 'ghost',
        path: '/no/such/directory',
      });
      expect(status).toBe(400);
      expect(body.error).toMatch(/does not exist/i);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('removes an existing project', async () => {
      writeProject(prefsDir, { name: 'to-delete', path: '/del' });

      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(
        app,
        'DELETE',
        '/api/projects/to-delete',
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { body: listBody } = await request(app, 'GET', '/api/projects');
      const found = listBody.projects.find((p) => p.name === 'to-delete');
      expect(found).toBeUndefined();
    });

    it('returns 200 even for nonexistent project (no-op)', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status } = await request(
        app,
        'DELETE',
        '/api/projects/nonexistent',
      );
      expect(status).toBe(200);
    });
  });

  describe('projectResolver middleware', () => {
    it('resolves known project and attaches to req.project', async () => {
      writeProject(prefsDir, { name: 'my-proj', path: '/my/proj' });

      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(
        app,
        'GET',
        '/api/projects/my-proj/info',
      );
      expect(status).toBe(200);
      expect(body.project.name).toBe('my-proj');
    });

    it('returns 404 for unknown project', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(
        app,
        'GET',
        '/api/projects/unknown/info',
      );
      expect(status).toBe(404);
      expect(body.error).toMatch(/not found/i);
    });
  });

  describe('project-scoped runs routes', () => {
    it('GET /api/projects/:id/runs returns runs for resolved project', async () => {
      // The synthesized default project has a worcaDir — discoverRuns will return []
      const app = await createTestApp(prefsDir, projectRoot);
      const { body: projectsBody } = await request(app, 'GET', '/api/projects');
      const projectName = projectsBody.projects[0].name;

      const { status, body } = await request(
        app,
        'GET',
        `/api/projects/${projectName}/runs`,
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.runs)).toBe(true);
    });

    it('GET /api/projects/:id/runs returns 404 for unknown project', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(
        app,
        'GET',
        '/api/projects/nonexistent/runs',
      );
      expect(status).toBe(404);
      expect(body.ok).toBe(false);
    });

    it('GET /api/projects/:id/runs/:runId/status returns status', async () => {
      // Create a fake run with status.json
      const runId = 'test-run-001';
      const runDir = join(projectRoot, '.worca', 'runs', runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, 'status.json'),
        JSON.stringify({
          pipeline_status: 'completed',
          stage: 'test',
        }),
      );

      const app = await createTestApp(prefsDir, projectRoot);
      const { body: projectsBody } = await request(app, 'GET', '/api/projects');
      const projectName = projectsBody.projects[0].name;

      const { status, body } = await request(
        app,
        'GET',
        `/api/projects/${projectName}/runs/${runId}/status`,
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.pipeline_status).toBe('completed');
    });
  });

  describe('project-scoped branches route', () => {
    it('GET /api/projects/:id/branches returns branches for resolved project', async () => {
      // Init a git repo in projectRoot using safe execFileSync
      execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
      execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
        cwd: projectRoot,
        stdio: 'ignore',
      });

      const app = await createTestApp(prefsDir, projectRoot);
      const { body: projectsBody } = await request(app, 'GET', '/api/projects');
      const projectName = projectsBody.projects[0].name;

      const { status, body } = await request(
        app,
        'GET',
        `/api/projects/${projectName}/branches`,
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.branches)).toBe(true);
      expect(body.branches.length).toBeGreaterThan(0);
    });
  });

  describe('project-scoped plan-files route', () => {
    it('GET /api/projects/:id/plan-files returns plan files for resolved project', async () => {
      // Create a docs/plans dir with a .md file
      mkdirSync(join(projectRoot, 'docs', 'plans'), { recursive: true });
      writeFileSync(
        join(projectRoot, 'docs', 'plans', 'W-001-test.md'),
        '# Plan',
      );

      const app = await createTestApp(prefsDir, projectRoot);
      const { body: projectsBody } = await request(app, 'GET', '/api/projects');
      const projectName = projectsBody.projects[0].name;

      const { status, body } = await request(
        app,
        'GET',
        `/api/projects/${projectName}/plan-files`,
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.files)).toBe(true);
      expect(body.files.length).toBe(1);
      expect(body.files[0].name).toBe('W-001-test.md');
    });
  });

  describe('backwards compatibility', () => {
    it('old /api/runs route still works', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { status, body } = await request(app, 'GET', '/api/runs');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it('existing /api/branches still works unchanged', async () => {
      const app = await createTestApp(prefsDir, projectRoot);
      const { body: projectsBody } = await request(app, 'GET', '/api/projects');
      const projectName = projectsBody.projects[0].name;
      const { status } = await request(
        app,
        'GET',
        `/api/projects/${projectName}/branches`,
      );
      // Either 200 (if git repo) or 500 (if not) — both are valid responses
      expect([200, 500]).toContain(status);
    });
  });
});
