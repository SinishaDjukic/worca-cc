// src/core/requirements/target.mjs
// A requirements scope's target (a registered project or an existing workspace). A leaf module: routes.mjs and attach.mjs
// both import it, so attach.mjs never has to import routes.mjs.
import { listProjects } from '../projects.mjs';
import { workspaceTarget } from '../ask/workflow-deps.mjs';
import { RequirementsError, SCOPE_TYPES } from './spec.mjs';

export async function checkTarget(scopeType, scopeKey) {
  if (!SCOPE_TYPES.includes(scopeType)) throw new RequirementsError('BAD_REQUEST', 'scopeType must be "project" or "workspace"');
  if (typeof scopeKey !== 'string' || !scopeKey.trim()) throw new RequirementsError('BAD_REQUEST', 'scopeKey is required');
  if (scopeType === 'project') {
    const p = (await listProjects()).find((x) => x.key === scopeKey);
    if (!p) throw new RequirementsError('BAD_REQUEST', 'unknown project');
    // A registered project whose folder is gone still passes here (create, context); readiness says so.
    return p.exists
      ? { name: p.name, path: p.path, exists: true, ok: true, label: `Project ${p.name} is registered` }
      : { name: p.name, path: p.path, exists: false, ok: false, hint: `the folder of project ${p.name} is missing` };
  }
  const ws = await workspaceTarget(scopeKey);
  if (!ws) throw new RequirementsError('BAD_REQUEST', 'unknown workspace');
  return { name: ws.name, ok: true, label: `Workspace ${ws.name} exists` };
}

/** The feature target for readiness: never throws; an unknown target is `{ ok: false, hint }`. Shared by routes.mjs (the
 *  views) and attach.mjs (Ready now), so both read readiness against the same target. */
export async function readinessTarget(scopeType, scopeKey) {
  try { return await checkTarget(scopeType, scopeKey); } catch {
    return { ok: false, hint: scopeType === 'workspace' ? 'the workspace no longer exists' : 'the project is not registered' };
  }
}
