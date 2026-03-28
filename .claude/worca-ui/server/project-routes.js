/**
 * REST API routes for multi-project management.
 *
 * - createProjectRoutes()       → CRUD on /api/projects
 * - projectResolver()           → middleware for /api/projects/:projectId/...
 * - createProjectScopedRoutes() → sub-routes under a resolved project
 */

import { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProjects,
  removeProject,
  synthesizeDefaultProject,
  validateProjectEntry,
  writeProject,
} from './project-registry.js';
import { discoverRuns } from './watcher.js';

/**
 * Middleware that resolves :projectId to a project entry and attaches it to req.project.
 * Falls back to synthesized default if no projects.d/ exists.
 */
export function projectResolver({ prefsDir, projectRoot }) {
  return (req, res, next) => {
    const projectId = req.params.projectId;
    const projects = readProjects(prefsDir);

    let project;
    if (projects.length > 0) {
      project = projects.find((p) => p.name === projectId);
    } else {
      // Single-project mode — synthesize from projectRoot
      const synth = synthesizeDefaultProject(projectRoot);
      if (synth.name === projectId) {
        project = synth;
      }
    }

    if (!project) {
      return res.status(404).json({ ok: false, error: `Project "${projectId}" not found` });
    }

    req.project = {
      name: project.name,
      path: project.path,
      worcaDir: project.worcaDir || join(project.path, '.worca'),
      settingsPath: project.settingsPath || join(project.path, '.claude', 'settings.json'),
      projectRoot: project.path,
    };
    next();
  };
}

/**
 * Router for project CRUD: GET/POST/DELETE /api/projects[/:id]
 */
export function createProjectRoutes({ prefsDir, projectRoot }) {
  const router = Router();

  // GET /api/projects — list all projects (or synthesized default)
  router.get('/', (_req, res) => {
    const projects = readProjects(prefsDir);
    if (projects.length > 0) {
      return res.json({ ok: true, projects });
    }
    // No registered projects — synthesize from cwd
    const synth = synthesizeDefaultProject(projectRoot);
    res.json({ ok: true, projects: [synth] });
  });

  // POST /api/projects — create a new project
  router.post('/', (req, res) => {
    const entry = req.body;
    const validation = validateProjectEntry(entry);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, error: validation.error });
    }
    try {
      writeProject(prefsDir, entry);
      res.status(201).json({ ok: true, project: entry });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/projects/:id — remove a project
  router.delete('/:id', (req, res) => {
    removeProject(prefsDir, req.params.id);
    res.json({ ok: true, removed: req.params.id });
  });

  return router;
}

/**
 * Router for project-scoped sub-routes.
 * The projectResolver middleware must run before this to set req.project.
 */
export function createProjectScopedRoutes() {
  const router = Router({ mergeParams: true });

  // GET /api/projects/:projectId/info — project metadata
  router.get('/info', (req, res) => {
    res.json({ ok: true, project: req.project });
  });

  // GET /api/projects/:projectId/runs — list runs for this project
  router.get('/runs', (req, res) => {
    try {
      const runs = discoverRuns(req.project.worcaDir);
      res.json({ ok: true, runs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/projects/:projectId/runs/:runId/status — run status
  router.get('/runs/:runId/status', (req, res) => {
    const { runId } = req.params;
    const { worcaDir } = req.project;
    let statusPath = join(worcaDir, 'runs', runId, 'status.json');
    if (!existsSync(statusPath)) {
      statusPath = join(worcaDir, 'results', runId, 'status.json');
    }
    if (!existsSync(statusPath)) {
      return res.status(404).json({ ok: false, error: `Run "${runId}" not found` });
    }
    try {
      const status = JSON.parse(readFileSync(statusPath, 'utf8'));
      res.json({ ok: true, ...status });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
