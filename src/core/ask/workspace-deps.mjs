// src/core/ask/workspace-deps.mjs
// The workspace-registry dependency bundle of the Ask Worca tools: the ONE module that touches the
// registry on the tools' behalf (tools.mjs may not import anything). Two callers:
//   • the MCP child (mcp-stdio.mjs): deps.workspaceChanges.validateChange behind
//     propose_workspace_change (validate only — the card is the user's to apply);
//   • the parent: turn.mjs re-validates a proposal with validateWorkspaceChange, and the cards route
//     applies a confirmed card with applyWorkspaceChange (behind its live-run guard).
// A workspace made from a card is created by workspace-scan-run.mjs createWorkspaceWithHomes, the
// same call POST /api/workspaces makes, so it picks its metrics / policy homes the same way.
import { basename } from 'node:path';
import { listProjects } from '../projects.mjs';
import {
  readWorkspace, updateWorkspace, addWorkspaceMembers, removeWorkspaceMember,
  checkNewWorkspace, planMembersAdd, planMemberRemove, planWorkspaceRename, removeImpactFor,
} from '../workspaces.mjs';
import { projectKey } from '../store.mjs';
import { getDb } from '../db.mjs';
import { listSchedules, getSchedule, listTickets, getTicket } from '../scheduler.mjs';
import { workspaceMetricsStatus } from '../metrics/sync.mjs';
import { workspacePolicyStatus } from '../policy/sync.mjs';
import { createWorkspaceWithHomes } from '../workspace-scan-run.mjs';
import { isWorkspaceScanWorkflow } from '../graph/builtin-workflows.mjs';
import { createWorkspaceChangeValidator } from './workspace-proposal.mjs';

/** A run that owns the workspace, by its pipeline row (any process: CLI, another UI) — any run
 *  that has not settled, or a PAUSED Workspace scan (it resumes into the workspace; the server's
 *  ownsWorkspaceTarget): 'run', or 'scan' when every such run is a Workspace scan (its stepper
 *  names the template). */
function liveRun(workspaceId) {
  const rows = getDb().prepare(
    "SELECT status, json_extract(CASE WHEN json_valid(stepper) THEN stepper END, '$.template.id') AS wf FROM pipelines WHERE workspace_key = ? AND archived_at IS NULL AND status IN ('created', 'starting', 'running', 'pausing', 'paused')",
  ).all(workspaceId).filter((r) => r.status !== 'paused' || isWorkspaceScanWorkflow(r.wf));
  if (!rows.length) return null;
  return rows.every((r) => isWorkspaceScanWorkflow(r.wf)) ? 'scan' : 'run';
}

/** The workspace's open schedules and one-off scheduled runs, with the per-member bits of their stored request. */
function scheduled(workspaceId) {
  const bits = (request) => ({
    sourceBranchByKey: request && request.sourceBranchByKey && typeof request.sourceBranchByKey === 'object' ? request.sourceBranchByKey : null,
  });
  const series = listSchedules({ workspaceId, includeEnded: false })
    .map((s) => ({ kind: 'schedule', id: s.id, title: s.title, sourceFromPrevious: false, ...bits(getSchedule(s.id, { withRequest: true })?.request) }));
  const once = listTickets({ workspaceId, oneShotOnly: true })
    .map((t) => ({ kind: 'ticket', id: t.id, title: t.title, sourceFromPrevious: !!t.sourceFromPrevious, ...bits(getTicket(t.id, { withRequest: true })?.request) }));
  return [...series, ...once];
}

/** Each member of the NEW set against the workspace's metrics / policy home (the workspace cards' own status). */
async function homeStatus(ws, next) {
  const hypo = { ...ws, projectPaths: next };
  const out = { metrics: null, policy: null };
  if (ws.metricsProject) {
    const st = await workspaceMetricsStatus(hypo);
    out.metrics = { home: st.home?.slug || basename(ws.metricsProject),
      members: st.members.map((m) => ({ path: m.path, ok: m.state === 'home' || m.state === 'routed' })) };
  }
  if (ws.policyProject) {
    const st = await workspacePolicyStatus(hypo);
    out.policy = { home: st.home?.slug || basename(ws.policyProject),
      members: st.members.map((m) => ({ path: m.path, ok: ['home', 'follows-home', 'is-home'].includes(m.state) })) };
  }
  return out;
}

/** The authoritative validator, over the real registry (the turn's default; the child's too). */
export const validateWorkspaceChange = createWorkspaceChangeValidator({
  listProjects,
  readWorkspace,
  projectKeyOf: projectKey,
  plan: { create: checkNewWorkspace, add: planMembersAdd, remove: planMemberRemove, rename: planWorkspaceRename },
  liveRun: async (id) => liveRun(id),
  scheduled: async (id) => scheduled(id),
  homeStatus,
  removeImpact: async (id, path, opts) => removeImpactFor(id, path, opts),
});

/**
 * Apply a CONFIRMED workspace card (ui/server.mjs cards route, after the user's click and its
 * live-run guard). The registry re-validates every write. Returns a result the card renders and
 * the event turn quotes (plus clearedHomes for the route's change events); throws on failure.
 */
export async function applyWorkspaceChange(card, io = {}) {
  const c = card.change || {};
  const size = (ws) => `${ws.name} has ${ws.projectPaths.length} members`;
  switch (card.kind) {
    case 'create': {
      const { workspace } = await (io.create ?? createWorkspaceWithHomes)({ name: c.name, projectPaths: c.projectPaths });
      return { ok: true, workspaceId: workspace.id, clearedHomes: [], detail: `${workspace.name} created with ${workspace.projectPaths.length} members` };
    }
    case 'add_members': {
      const ws = await (io.add ?? addWorkspaceMembers)(c.workspaceId, c.projectPaths);
      return { ok: true, workspaceId: ws.id, clearedHomes: [], detail: size(ws) };
    }
    case 'remove_member': {
      const before = await (io.read ?? readWorkspace)(c.workspaceId);
      const ws = await (io.remove ?? removeWorkspaceMember)(c.workspaceId, c.projectPath);
      const clearedHomes = [
        ...(before?.metricsProject && !ws.metricsProject ? ['metrics'] : []),
        ...(before?.policyProject && !ws.policyProject ? ['policy'] : []),
      ];
      return { ok: true, workspaceId: ws.id, clearedHomes,
        detail: `${size(ws)}${clearedHomes.length ? ` · ${clearedHomes.join(' and ')} home cleared` : ''}` };
    }
    case 'rename': {
      const ws = await (io.update ?? updateWorkspace)(c.workspaceId, { name: c.name });
      return { ok: true, workspaceId: ws.id, clearedHomes: [], detail: `renamed to ${ws.name}` };
    }
    default:
      throw new Error(`unknown workspace change kind "${card.kind}"`);
  }
}

export function defaultWorkspaceDeps() {
  return { workspaceChanges: { validateChange: validateWorkspaceChange } };
}
