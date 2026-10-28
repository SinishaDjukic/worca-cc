// src/core/workflow-versions-routes.mjs — HTTP for workflow versions and history (plans/workflow-tests-plan.md
// Task 6; #721's routes for workflows). Every route is behind the workflowTests flag.
import { requireFlag } from './flags.mjs';
import { actorOf as identityActorOf } from './identity.mjs';
import { createVersion, useVersion, restoreRevision, versionsOverview } from './workflow-versions.mjs';
import { listRevisions, readRevision } from './workflow-revisions.mjs';

function send(res, err) {
  const code = err && err.code;
  const message = err && err.message ? err.message : String(err);
  if (code === 'NOT_FOUND') return res.status(404).json({ error: message });
  if (code === 'NOT_VERSIONABLE' || code === 'BAD_REQUEST') return res.status(400).json({ error: message });
  if (code === 'UNCHANGED') return res.status(409).json({ error: message, versionNo: err.versionNo });
  if (code === 'INVALID_GRAPH') return res.status(422).json({ error: message, errors: err.errors || [], warnings: err.warnings || [] });
  return res.status(500).json({ error: message });
}

/** @param {import('express').Express} app @param {{agentsDir?: string, actorOf?: (req) => string|null}} [opts] */
export function registerWorkflowVersionRoutes(app, { agentsDir, actorOf = (req) => identityActorOf(req) || null } = {}) {
  const gate = requireFlag('workflowTests');
  const base = '/api/workflows/:id';
  app.get(`${base}/versions`, gate, async (req, res) => {
    try { res.json(await versionsOverview(req.params.id)); } catch (err) { send(res, err); }
  });
  app.post(`${base}/versions`, gate, async (req, res) => {
    try {
      const body = req.body || {};
      const v = await createVersion(req.params.id, { note: typeof body.note === 'string' ? body.note : null, by: actorOf(req) });
      if (body.use === true) useVersion(req.params.id, v.versionNo);
      res.status(201).json(await versionsOverview(req.params.id));
    } catch (err) { send(res, err); }
  });
  app.post(`${base}/versions/:no/use`, gate, async (req, res) => {
    try { useVersion(req.params.id, Number(req.params.no)); res.json(await versionsOverview(req.params.id)); } catch (err) { send(res, err); }
  });
  app.get(`${base}/history`, gate, (req, res) => {
    try { res.json({ revisions: listRevisions(req.params.id) }); } catch (err) { send(res, err); }
  });
  app.get(`${base}/history/:rev`, gate, (req, res) => {
    try {
      const revision = readRevision(req.params.id, Number(req.params.rev));
      if (!revision) return res.status(404).json({ error: `no saved state ${req.params.rev}` });
      res.json({ revision });
    } catch (err) { send(res, err); }
  });
  app.post(`${base}/history/:rev/restore`, gate, async (req, res) => {
    try {
      const { workflow, warnings } = await restoreRevision(req.params.id, Number(req.params.rev), { by: actorOf(req), agentsDir });
      res.json({ workflow, warnings, overview: await versionsOverview(req.params.id) });
    } catch (err) { send(res, err); }
  });
}
