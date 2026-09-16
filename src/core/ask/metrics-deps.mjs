// src/core/ask/metrics-deps.mjs
// The team-metrics dependency bundle of the Ask Worca tools (docs/team-metrics.md "Ask Worca"):
// the ONE module that touches the metrics core on the tools' behalf. tools.mjs may not import
// anything, so every reader, the validator and the two writers live here. Two callers:
//   • the MCP child (mcp-stdio.mjs): deps.metrics.* behind get_team_metrics, list_team_metrics_runs,
//     push_team_metrics and propose_metrics_change (validate only — the card is the user's to apply);
//   • the parent: turn.mjs re-validates a proposal with validateMetricsChange, and the cards route
//     applies a confirmed card with applyMetricsChange.
// Gnostic about the domain (scopes, ranges, homes, routing), agnostic about the mechanics: nothing
// here names a slug directory, an outbox or a worktree to the model.
import { listProjects } from '../projects.mjs';
import { readWorkspace, updateWorkspace } from '../workspaces.mjs';
import { readTeamMetricsPrefs } from '../config.mjs';
import { projectKey } from '../store.mjs';
import { findPipelineRowById } from '../artifacts.mjs';
import { listScopes, readScope } from '../metrics/read.mjs';
import { aggregate, resolveRange, GROUP_BYS, FILTER_DIMS, RANGES } from '../../shared/team-metrics/aggregate.mjs';
import {
  enableTeamMetrics, setRecordMyRuns, routeWorkspaceMembers, flushSlug, flushProject, flushAll, metricsEvents,
} from '../metrics/sync.mjs';
import { createMetricsChangeValidator } from './metrics-proposal.mjs';

export { RANGES, GROUP_BYS, FILTER_DIMS };

/** The authoritative validator, over the real readers (the turn's default; the child's too). */
export const validateMetricsChange = createMetricsChangeValidator({
  listProjects, readWorkspace, readPrefs: readTeamMetricsPrefs, projectKeyOf: projectKey,
});

/** Only the filter dims the page knows, string values only. */
function cleanFilter(filter) {
  const out = {};
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return out;
  for (const dim of FILTER_DIMS) {
    const v = filter[dim];
    if (typeof v === 'string' && v) out[dim] = v.slice(0, 200);
  }
  return out;
}

/**
 * Apply a CONFIRMED metrics card (ui/server.mjs cards route, after the user's click). Returns a
 * result the card renders and the event turn quotes; throws the core's coded error on failure.
 * @param {object} card  the card block's `card` (metrics-proposal.mjs shape)
 */
export async function applyMetricsChange(card, io = {}) {
  const enable = io.enable ?? enableTeamMetrics;
  const setRecord = io.setRecord ?? setRecordMyRuns;
  const update = io.updateWorkspace ?? updateWorkspace;
  const route = io.route ?? routeWorkspaceMembers;
  const projectPath = async (key) => {
    const p = (await (io.listProjects ?? listProjects)()).find((x) => x && x.key === key);
    if (!p) throw Object.assign(new Error(`unknown projectKey "${key}"`), { code: 'NOT_FOUND' });
    return p.path;
  };
  switch (card.kind) {
    case 'enable': {
      const r = await enable(await projectPath(card.projectKey), {
        mode: card.mode, attribution: card.attribution || 'git-user', delegateTo: card.delegateTo || null, change: card.change === true,
      });
      const action = r && r.action ? String(r.action) : 'enabled';
      return { ok: true, action, detail: action === 'joined' ? 'the branch already existed — joined it' : action === 'created' ? 'branch created on origin' : action };
    }
    case 'record':
      setRecord(await projectPath(card.projectKey), card.record === true);
      return { ok: true, detail: `"Include my runs" is now ${card.record ? 'on' : 'off'}` };
    case 'workspace_home': {
      const ws = await update(card.workspaceId, { metricsProject: card.homePath ?? null });
      try { metricsEvents.emit('changed', { action: 'metrics-home' }); } catch { /* a broken listener never fails the apply */ }
      return { ok: true, detail: card.homePath ? `metrics home is now ${card.homeProjectName || ws?.metricsProject || ''}`.trim() : 'metrics home cleared' };
    }
    case 'route_members': {
      const r = await route(card.workspaceId);
      const results = Array.isArray(r?.results) ? r.results : [];
      const n = (k) => results.filter((x) => x.result === k).length;
      return { ok: true, home: r?.home ?? null, results, detail: `${n('routed')} routed · ${n('skipped')} skipped · ${n('failed')} failed` };
    }
    default:
      throw Object.assign(new Error(`unknown metrics change kind "${card.kind}"`), { code: 'BAD_REQUEST' });
  }
}

/**
 * @param {{threadId?:string|null}} [o]  threadId unused today; keeps the *-deps.mjs signature uniform
 */
export function defaultMetricsDeps({ threadId = null } = {}) {   // eslint-disable-line no-unused-vars
  return {
    metrics: {
      ranges: RANGES, groupBys: GROUP_BYS, filterDims: FILTER_DIMS,
      /** Every project's and workspace's metrics status (the Projects cells / workspace cards read the same). */
      status: () => listScopes(),
      /**
       * One scope's records + the page's aggregate. Throws the core's coded errors (NOT_FOUND,
       * NOT_ENABLED, DELEGATE_INVALID) and a RangeError for a bad range/groupBy — the tool maps them.
       */
      async read(scope, { range = 'this-month', from = null, to = null, groupBy = 'workflow', filter = {}, refresh = false } = {}) {
        resolveRange(range, { from, to });                     // RangeError before any git
        if (!GROUP_BYS.includes(groupBy)) throw new RangeError(`unknown groupBy "${groupBy}" (expected ${GROUP_BYS.join(' | ')})`);
        const read = await readScope(scope, { refresh: refresh === true });
        const agg = aggregate(read.records, { range, from, to, groupBy, filter: cleanFilter(filter) });
        return { read, agg };
      },
      /** Is this run on THIS machine (get_run / get_run_diff can open it)? */
      isLocalRun: (id) => { try { return !!findPipelineRowById(id); } catch { return false; } },
      validateChange: validateMetricsChange,
      /** "Push now" for a scope, or every outbox on this machine. */
      async flush({ scope = null, all = false } = {}) {
        if (all) return flushAll();
        if (scope && scope.kind === 'project') {
          const p = (await listProjects()).find((x) => x.key === scope.id);
          if (!p) throw Object.assign(new Error(`unknown project ${scope.id}`), { code: 'NOT_FOUND' });
          return [await flushProject(p.path)];
        }
        if (scope && scope.kind === 'workspace') {
          const sinks = (await readScope(scope)).sinks;
          const results = [];
          for (const slug of sinks) results.push(await flushSlug(slug));
          return results;
        }
        throw Object.assign(new Error('a project, a workspace or all:true is required'), { code: 'BAD_REQUEST' });
      },
    },
  };
}
