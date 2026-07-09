import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeProject } from '../project-registry.js';
import {
  createProjectRoutes,
  createProjectScopedRoutes,
  projectResolver,
} from '../project-routes.js';
import { clearCache } from '../versions.js';

const ACTIVE_WORCA_CC = '0.6.0';

async function createTestApp(prefsDir, projectRoot) {
  const app = express();
  app.use(express.json());
  // Provide a known installed worca-cc version so getVersionInfo() resolves
  // activeWorcaCc deterministically (no dev-path, no network fallback).
  app.locals.worcaVersion = { installed: ACTIVE_WORCA_CC };
  app.use('/api/projects', createProjectRoutes({ prefsDir, projectRoot }));
  app.use(
    '/api/projects/:projectId',
    projectResolver({ prefsDir, projectRoot }),
    createProjectScopedRoutes({ prefsDir }),
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

describe('GET /api/projects/:id/worca-status — version + outdated extension', () => {
  let prefsDir;
  let projectRoot;
  let originalFetch;

  beforeEach(() => {
    // Prevent getVersionInfo from making real npm/pypi calls, but pass through
    // localhost requests (the test uses fetch to hit its own express server).
    // Promise.allSettled swallows rejects so a stub that throws is fine.
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      const s = typeof url === 'string' ? url : url?.url || '';
      if (
        s.startsWith('http://127.0.0.1') ||
        s.startsWith('http://localhost')
      ) {
        return originalFetch(url, init);
      }
      return Promise.reject(new Error('network disabled'));
    });

    clearCache();
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
    globalThis.fetch = originalFetch;
    clearCache();
    rmSync(prefsDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // Case 14: installed with version file — version matches active (not outdated)
  it('returns version and outdated:false when version.json matches active worca-cc', async () => {
    mkdirSync(join(projectRoot, '.claude', 'worca'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'worca', 'version.json'),
      JSON.stringify({ version: ACTIVE_WORCA_CC }),
    );

    writeProject(prefsDir, { name: 'my-proj', path: projectRoot });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.installed).toBe(true);
    expect(body.version).toBe(ACTIVE_WORCA_CC);
    expect(body.outdated).toBe(false);
  });

  // Case 15: installed without version file — version is null, outdated:false
  it('returns version:null and outdated:false when no version file is present', async () => {
    mkdirSync(join(projectRoot, '.claude', 'worca'), { recursive: true });
    // No version.json or __init__.py written

    writeProject(prefsDir, { name: 'my-proj', path: projectRoot });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.installed).toBe(true);
    expect(body.version).toBeNull();
    expect(body.outdated).toBe(false);
  });

  // Case 16: not installed — installed:false, version:null, outdated:false
  it('returns installed:false with null version and outdated:false when worca not installed', async () => {
    // No .claude/worca directory created
    writeProject(prefsDir, { name: 'my-proj', path: projectRoot });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.installed).toBe(false);
    expect(body.version).toBeNull();
    expect(body.outdated).toBe(false);
  });

  // Case 17: installed with version strictly behind active — outdated:true
  it('returns outdated:true when installed version is strictly behind active worca-cc', async () => {
    mkdirSync(join(projectRoot, '.claude', 'worca'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'worca', 'version.json'),
      JSON.stringify({ version: '0.1.0' }),
    );

    writeProject(prefsDir, { name: 'my-proj', path: projectRoot });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.installed).toBe(true);
    expect(body.version).toBe('0.1.0');
    expect(body.outdated).toBe(true);
  });

  // Home-dir layout: worcaConfigPath + worcaPkgVersion → installed + hash-stripped version
  it('returns installed:true and hash-stripped version for home-dir layout', async () => {
    const configDir = join(prefsDir, 'projects', 'my-proj');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), '{}');

    writeProject(prefsDir, {
      name: 'my-proj',
      path: projectRoot,
      worcaConfigPath: join(configDir, 'config.json'),
      worcaPkgVersion: '0.6.0-33ad2a9',
    });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.installed).toBe(true);
    expect(body.version).toBe(ACTIVE_WORCA_CC);
    expect(body.outdated).toBe(false);
  });

  // Home-dir layout: worcaConfigPath only (no worcaPkgVersion)
  it('returns installed:true and version:null for home-dir layout without worcaPkgVersion', async () => {
    const configDir = join(prefsDir, 'projects', 'my-proj');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), '{}');

    writeProject(prefsDir, {
      name: 'my-proj',
      path: projectRoot,
      worcaConfigPath: join(configDir, 'config.json'),
    });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.installed).toBe(true);
    expect(body.version).toBeNull();
    expect(body.outdated).toBe(false);
  });

  // No legacy dir + no worcaConfigPath → not installed
  it('returns installed:false when no legacy dir and no worcaConfigPath', async () => {
    writeProject(prefsDir, { name: 'my-proj', path: projectRoot });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.installed).toBe(false);
    expect(body.version).toBeNull();
    expect(body.outdated).toBe(false);
  });

  // Hash stripping preserves RC suffix
  it('strips git hash but preserves RC suffix in version', async () => {
    const configDir = join(prefsDir, 'projects', 'my-proj');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), '{}');

    writeProject(prefsDir, {
      name: 'my-proj',
      path: projectRoot,
      worcaConfigPath: join(configDir, 'config.json'),
      worcaPkgVersion: '0.7.0rc3-abcdef1',
    });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.version).toBe('0.7.0rc3');
    expect(body.outdated).toBe(false);
  });

  // RC vs stable: "0.6.0rc3" is behind "0.6.0"
  it('returns outdated:true when installed is an RC of the current stable', async () => {
    mkdirSync(join(projectRoot, '.claude', 'worca'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'worca', 'version.json'),
      JSON.stringify({ version: '0.6.0rc3' }),
    );

    writeProject(prefsDir, { name: 'my-proj', path: projectRoot });
    const app = await createTestApp(prefsDir, projectRoot);
    const { status, body } = await request(
      app,
      'GET',
      '/api/projects/my-proj/worca-status',
    );

    expect(status).toBe(200);
    expect(body.version).toBe('0.6.0rc3');
    expect(body.outdated).toBe(true);
  });
});
