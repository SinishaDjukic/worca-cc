// src/core/policy/scope.mjs
// One scope's team policy, resolved and folded against THIS machine (team-policy design §11):
// the reader behind GET /api/policy (the Team policy page) and Ask Worca's get_team_policy /
// propose_policy_change, so the page and the chat can never disagree about what applies.

import { existsSync } from 'node:fs';
import { listProjects } from '../projects.mjs';
import { readWorkspace } from '../workspaces.mjs';
import { projectKey } from '../store.mjs';
import { resolveProjectPolicy, resolveWorkspacePolicy } from './sync.mjs';
import { effectiveRows, capSummary } from './effective.mjs';
import { localSnapshot, pluginRequirements, blockedPluginFindings, WORCA_VERSION } from './local.mjs';
import { FIELDS } from './registry.mjs';

/**
 * Resolve a `{kind:'project'|'workspace', id}` scope to its policy and the run kind it governs.
 * Throws NOT_FOUND for an unknown project or workspace; a scope WITHOUT a policy resolves with
 * `r.ok === false` (the caller decides how to say so).
 */
export async function policyForScope(scope) {
  if (scope.kind === 'project') {
    const p = (await listProjects()).find((x) => x.key === scope.id);
    if (!p) throw Object.assign(new Error(`unknown project ${scope.id}`), { code: 'NOT_FOUND' });
    const r = await resolveProjectPolicy(p.path);
    return { meta: { kind: 'project', id: p.key, name: p.name, path: p.path }, r, workspaceRun: false, projectDir: p.path };
  }
  const ws = await readWorkspace(scope.id);
  if (!ws) throw Object.assign(new Error(`unknown workspace ${scope.id}`), { code: 'NOT_FOUND' });
  const r = await resolveWorkspacePolicy(ws);
  return { meta: { kind: 'workspace', id: ws.id, name: ws.name, policyProject: ws.policyProject ?? null }, r, workspaceRun: true, projectDir: ws.policyProject ?? null };
}

/** The local machine's answer to a resolved policy: the fold, the plugin gaps, the blocked plugins. */
export function policyPayload(meta, r, { workspaceRun, projectDir }) {
  const local = localSnapshot(workspaceRun ? null : projectDir);
  const homeKey = r.homeDir ? projectKey(r.homeDir) : null;
  const homes = [{ slug: r.home, doc: r.doc }];
  return {
    scope: meta,
    policy: {
      home: r.home, homeKey, sha: r.sha, delegated: r.delegated, from: r.from, warnings: r.warnings || [], checkedAt: r.checkedAt ?? null,
      doc: r.doc, caps: capSummary(r.doc, { workspaceRun }), workspaceRun,
    },
    rows: effectiveRows({ doc: r.doc, workspaceRun, local }),
    local,
    requirements: pluginRequirements(homes),
    blockedPlugins: blockedPluginFindings(homes),
    worcaVersion: WORCA_VERSION,
    registry: FIELDS,
    // Publishing needs the home checkout on THIS machine and a document (not a marker).
    canPublish: !!r.homeDir && existsSync(r.homeDir),
  };
}
