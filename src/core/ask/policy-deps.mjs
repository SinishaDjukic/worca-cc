// src/core/ask/policy-deps.mjs
// The team-policy dependency bundle of the Ask Worca tools (docs/team-policy.md "Ask Worca"): the
// ONE module that touches the policy core on the tools' behalf (tools.mjs may not import anything).
// Two callers:
//   • the MCP child (mcp-stdio.mjs): deps.policy.* behind list_projects' `policy`, get_team_policy
//     and propose_policy_change (validate only — the card is the user's to apply);
//   • the parent: turn.mjs re-validates a proposal with validatePolicyChange, and the cards route
//     applies a confirmed card with applyPolicyChange.
// Domain-level like metrics-deps.mjs: homes, follows, fields and caps — never a worktree path.
import { listProjects } from '../projects.mjs';
import { readWorkspace, updateWorkspace } from '../workspaces.mjs';
import { projectKey } from '../store.mjs';
import {
  listPolicyScopes, projectPolicyStatus, enableTeamPolicy, publishPolicy, routeWorkspaceMembersPolicy, policyEvents,
} from '../policy/sync.mjs';
import { policyForScope, policyPayload } from '../policy/scope.mjs';
import { createPolicyChangeValidator, normalizeEditOps, applyEditOps } from './policy-proposal.mjs';

async function scopePolicy(scope) {
  const out = await policyForScope(scope);
  const payload = out.r && out.r.ok ? policyPayload(out.meta, out.r, { workspaceRun: out.workspaceRun, projectDir: out.projectDir }) : null;
  return { ...out, canPublish: !!payload?.canPublish, payload };
}

async function followersOf(home) {
  const s = await listPolicyScopes();
  const h = (s.homes || []).find((x) => x.slug === home);
  return h ? h.usedBy : [];
}

/** The authoritative validator, over the real readers (the turn's default; the child's too). */
export const validatePolicyChange = createPolicyChangeValidator({
  listProjects, readWorkspace, projectKeyOf: projectKey,
  projectStatus: (p) => projectPolicyStatus(p, { discover: false }),
  scopePolicy, followersOf,
});

/**
 * Apply a CONFIRMED policy card (ui/server.mjs cards route, after the user's click). Returns a
 * result the card renders and the event turn quotes; throws the core's coded error on failure.
 */
export async function applyPolicyChange(card, io = {}) {
  const enable = io.enable ?? enableTeamPolicy;
  const publish = io.publish ?? publishPolicy;
  const update = io.updateWorkspace ?? updateWorkspace;
  const route = io.route ?? routeWorkspaceMembersPolicy;
  const resolveScope = io.scopePolicy ?? scopePolicy;
  const projectPath = async (key) => {
    const p = (await (io.listProjects ?? listProjects)()).find((x) => x && x.key === key);
    if (!p) throw Object.assign(new Error(`unknown projectKey "${key}"`), { code: 'NOT_FOUND' });
    return p.path;
  };
  switch (card.kind) {
    case 'enable': {
      const r = await enable(await projectPath(card.projectKey), {
        mode: card.mode, delegateTo: card.delegateTo || null, change: card.change === true, title: card.title || '',
      });
      const action = r && r.action ? String(r.action) : 'enabled';
      const detail = action === 'joined' ? 'the branch already existed — joined it'
        : action === 'created' ? (card.mode === 'follow' ? `now follows ${card.delegateTo}` : 'branch created on origin')
          : action === 'changed' ? `now follows ${card.delegateTo}` : action;
      return { ok: true, action, detail };
    }
    case 'edit': {
      // Re-read the policy NOW and replay the ops on it: a teammate's publish since the proposal
      // is kept field by field, never overwritten by the card's snapshot.
      const scope = card.projectKey ? { kind: 'project', id: card.projectKey } : { kind: 'workspace', id: card.workspaceId };
      const { r, canPublish } = await resolveScope(scope);
      if (!r || !r.ok) throw Object.assign(new Error(r?.detail || 'this scope no longer has a team policy'), { code: 'NOT_ENABLED' });
      if (r.home !== card.home) throw Object.assign(new Error(`the policy home changed from ${card.home} to ${r.home} — ask again`), { code: 'BAD_REQUEST' });
      if (!canPublish) throw Object.assign(new Error(`the policy home ${r.home} is not checked out on this machine`), { code: 'NOT_HOME' });
      // The stored ops were validated at proposal time; re-normalise them against the fresh doc
      // (an unset whose field a teammate already removed simply drops out).
      const replay = {
        set: (card.ops?.set || []).map((s) => ({ key: s.key, value: s.entry.value, kind: s.entry.kind, forWorkspaceRuns: s.block === 'workspaceRuns', ...Object.fromEntries(['onBreach', 'requireReason', 'window'].filter((a) => s.entry[a] !== undefined).map((a) => [a, s.entry[a]])) })),
        unset: (card.ops?.unset || []).filter((u) => r.doc?.[u.block]?.[u.key]).map((u) => ({ key: u.key, forWorkspaceRuns: u.block === 'workspaceRuns' })),
        title: card.ops?.title, notes: card.ops?.notes,
      };
      const n = normalizeEditOps(replay, r.doc);
      if (n.errors) throw Object.assign(new Error(n.errors[0]), { code: 'BAD_REQUEST' });
      const next = applyEditOps(r.doc, n.ops);
      const out = await publish(r.homeDir, next, { message: card.message || null });
      const sha = out && out.sha ? String(out.sha).slice(0, 7) : null;
      const moved = card.baseSha && r.sha && card.baseSha !== r.sha ? ' (on top of a newer version a teammate published)' : '';
      return { ok: true, sha: out?.sha ?? null, unchanged: !!out?.unchanged,
        detail: out?.unchanged ? 'the branch already says this — nothing to commit' : `published ${sha || ''} to ${r.home}${moved}`.replace(/ {2,}/g, ' ') };
    }
    case 'workspace_home': {
      const ws = await update(card.workspaceId, { policyProject: card.homePath ?? null });
      try { policyEvents.emit('changed', { action: 'policy-home' }); } catch { /* a broken listener never fails the apply */ }
      return { ok: true, detail: card.homePath ? `policy home is now ${card.homeProjectName || ws?.policyProject || ''}`.trim() : 'policy home cleared' };
    }
    case 'route_members': {
      const r = await route(card.workspaceId);
      const results = Array.isArray(r?.results) ? r.results : [];
      const n = (k) => results.filter((x) => x.result === k).length;
      return { ok: true, home: r?.home ?? null, results, detail: `${n('routed')} routed · ${n('skipped')} skipped · ${n('failed')} failed` };
    }
    default:
      throw Object.assign(new Error(`unknown policy change kind "${card.kind}"`), { code: 'BAD_REQUEST' });
  }
}

/**
 * @param {{threadId?:string|null}} [o]  threadId unused today; keeps the *-deps.mjs signature uniform
 */
export function defaultPolicyDeps({ threadId = null } = {}) {   // eslint-disable-line no-unused-vars
  return {
    policy: {
      /** Every project's and workspace's policy status (the Projects cells / workspace cards read the same). */
      status: () => listPolicyScopes(),
      /**
       * One scope's policy folded against this machine (the Team policy page's payload) plus the
       * machine-level deviations. Throws NOT_FOUND for an unknown scope; no policy → {policy:null}.
       */
      async read(scope) {
        const { meta, r, payload } = await scopePolicy(scope);
        if (!r || !r.ok) return { scope: meta, policy: null, reason: r?.reason || 'not-enabled', code: r?.code || null, detail: r?.detail || null };
        return payload;
      },
      validateChange: validatePolicyChange,
    },
  };
}
