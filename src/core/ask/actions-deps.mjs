// src/core/ask/actions-deps.mjs
// The Actions dependency bundle of the Ask Worca tools (docs/actions.md "Chat"): the ONE module
// that reads a project's actions, a workspace's stacks, a run's checkout and the running services on
// the tools' behalf (tools.mjs may not import anything). Read-only, plus the card's validator:
//   • the MCP child (mcp-stdio.mjs): deps.actions.* behind get_project_actions, get_workspace_stacks,
//     get_run_checkout, list_running_actions and propose_actions_change (validate only);
//   • the parent: turn.mjs re-validates a proposal with validateActionsChange, and the cards route
//     applies a confirmed card with applyActionsChange.
// Nothing here starts, stops, checks out or discards: that stays a person's click (D4).
// Running services come from the state file the server's registry writes (registry.mjs
// readActionsState), so the classic child, which has no registry, sees the same instances.
import { basename } from 'node:path';
import { listProjects, worcaHome } from '../projects.mjs';
import { readProjectActions, writeProjectActions, readActionsMeta } from '../config.mjs';
import { readWorkspace, listWorkspaces, readWorkspaceStacks, updateWorkspaceStacks, workspaceMembers } from '../workspaces.mjs';
import { normalizeStacks, memberAliases } from '../actions/model.mjs';
import { readActionsState, actionsStateFile } from '../actions/registry.mjs';
import { membersOfRow, checkoutPathFor } from '../checkout.mjs';
import { checkoutRecordsFor, retainedWorkFor, findPipelineRowById } from '../artifacts.mjs';
import { projectKey as projectKeyOf } from '../store.mjs';
import { gitAvailable, GIT_MISSING } from '../git-available.mjs';
import { createActionsChangeValidator } from './actions-proposal.mjs';
import { redactAskText } from './redact.mjs';

const FINISHED = new Set(['done', 'stopped', 'error']);
const ACTIVE = new Set(['starting', 'running', 'ready']);

async function registeredProject(key) {
  return ((await listProjects()) || []).find((p) => p && p.key === key) || null;
}

/** The workspace stacks that start one of this project's actions. */
async function stacksUsing(key) {
  const out = [];
  for (const ws of await listWorkspaces()) {
    if (!(ws.projectPaths || []).some((p) => projectKeyOf(p) === key)) continue;
    for (const s of readWorkspaceStacks(ws.id)) {
      const ids = s.steps.filter((st) => st.member === key).map((st) => st.action);
      if (ids.length) out.push({ workspaceId: ws.id, workspaceName: ws.name, stackId: s.id, label: s.label, actions: [...new Set(ids)] });
    }
  }
  return out;
}

/** The authoritative validator, over the real config and registry (the turn's default; the child's too). */
export const validateActionsChange = createActionsChangeValidator({
  listProjects,
  readProjectActions,
  readWorkspace,
  workspaceMembers,
  readWorkspaceStacks,
  stacksUsing,
  redact: redactAskText,
});

/** The instances the server's registry last published, oldest first. */
function stateInstances() {
  return readActionsState(actionsStateFile(worcaHome()));
}

/** get_project_actions: the stored setup, actions (commands included) and built-ins of one project. */
async function projectActions(key) {
  const p = await registeredProject(key);
  if (!p) return null;
  const cfg = readProjectActions(key);
  return { projectKey: key, projectName: p.name || basename(p.path), ...cfg,
    lastSetupMs: readActionsMeta(key).lastSetupMs || null, stacksUsingIt: await stacksUsing(key) };
}

/** get_workspace_stacks: the stacks and, per member, its alias and action ids (what a step may name). */
async function workspaceStacks(id) {
  const ws = await readWorkspace(id);
  const members = ws ? await workspaceMembers(id) : null;
  if (!ws || !members) return null;
  const aliases = memberAliases(members);
  return { workspaceId: ws.id, workspaceName: ws.name, stacks: readWorkspaceStacks(id),
    members: members.map((m) => ({ projectKey: m.projectKey, name: m.name, alias: aliases[m.projectKey],
      actions: readProjectActions(m.projectKey).actions.map(({ id: aid, label, kind }) => ({ id: aid, label, kind })) })) };
}

/** Why Check out is refused for this row, or null when it is offered (checkout.mjs assertEligible's words). */
function checkoutBlocked(row) {
  if (!gitAvailable()) return GIT_MISSING.message;
  if (row.archived_at) return 'the run is archived';
  if (!FINISHED.has(row.status)) return 'Check out is available once the run has finished';
  if (retainedWorkFor(row)) return 'the run kept uncommitted work in its worktree; recover or discard it first';
  return null;
}

/** get_run_checkout: one run's checkout per member, its actions, and the instances started for it. */
function runCheckout(row) {
  const rec = checkoutRecordsFor(row);
  const { serverRunning, instances } = stateInstances();
  const members = membersOfRow(row).map((m) => {
    const cfg = readProjectActions(m.projectKey);
    const c = rec?.members.find((x) => x.projectKey === m.projectKey) || null;
    return {
      projectKey: m.projectKey, projectName: m.projectName, branch: m.br?.feature || null,
      state: !m.br?.feature ? 'no-branch' : c ? 'checked-out' : 'not-checked-out',
      worktreeDir: c ? c.worktreeDir : (m.projectDir ? checkoutPathFor(row, m) : null),
      checkout: c ? { at: c.at, policy: c.policy, setup: c.setup } : null,
      setup: cfg.setup,
      actions: cfg.actions.map(({ id, label, kind, openUrl }) => ({ id, label, kind, openUrl })),
    };
  });
  const ws = row.target === 'workspace' && row.workspace_key ? String(row.workspace_key).replace(/^workspaces\//, '') : null;
  return {
    runId: row.id, runStatus: row.status, checkoutBlocked: checkoutBlocked(row),
    members, stacks: ws ? readWorkspaceStacks(ws) : [],
    serverRunning, instances: instances.filter((s) => s.runId === row.id),
  };
}

/** list_running_actions: every service or task still going, with the run it belongs to. */
function runningActions() {
  const { serverRunning, instances } = stateInstances();
  const titles = new Map();
  return {
    serverRunning,
    instances: instances.filter((s) => ACTIVE.has(s.status)).map((s) => {
      if (!titles.has(s.runId)) titles.set(s.runId, findPipelineRowById(s.runId) || null);
      const row = titles.get(s.runId);
      return { ...s, runTitle: row?.title || null, projectKey: row && row.target !== 'workspace' ? row.project_key : null,
        workspaceId: row && row.target === 'workspace' && row.workspace_key ? String(row.workspace_key).replace(/^workspaces\//, '') : null };
    }),
  };
}

/**
 * Apply a CONFIRMED actions card (ui/server.mjs cards route, after the user's click). Each write
 * re-validates against what is stored now. Returns a result the card renders and the event turn
 * quotes; throws on failure.
 */
export async function applyActionsChange(card, io = {}) {
  const c = card.change || {};
  if (card.kind === 'project') {
    const next = (io.writeProject ?? writeProjectActions)(c.projectKey, c.config || {});
    const n = next.actions.length;
    return { ok: true, projectKey: c.projectKey, detail: `${n} action${n === 1 ? '' : 's'}${next.setup ? ' and a setup command' : ''} saved` };
  }
  if (card.kind === 'stacks') {
    const members = await (io.members ?? workspaceMembers)(c.workspaceId);
    if (!members) throw Object.assign(new Error('workspace not found'), { code: 'NOT_FOUND' });
    const memberActions = Object.fromEntries(members.map((m) => [m.projectKey, readProjectActions(m.projectKey).actions.map(({ id, kind }) => ({ id, kind }))]));
    const { stacks } = normalizeStacks({ stacks: c.stacks || [] }, { memberActions });
    const saved = await (io.writeStacks ?? updateWorkspaceStacks)(c.workspaceId, stacks);
    return { ok: true, workspaceId: c.workspaceId, detail: `${saved.length} stack${saved.length === 1 ? '' : 's'} saved` };
  }
  throw new Error(`unknown actions change kind "${card.kind}"`);
}

export function defaultActionsDeps() {
  return { actions: { projectActions, workspaceStacks, runCheckout, runningActions, validateChange: validateActionsChange } };
}
