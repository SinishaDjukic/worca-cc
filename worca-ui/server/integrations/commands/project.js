import { statusEmoji } from './global.js';

const NO_ACTIVE_PROJECT =
  'No active project. Use `/projects` to list, `/use <name>` to select.';

/**
 * Resolve run_id when the caller omits it:
 * - exactly one active run -> return its id
 * - zero active runs -> return null (caller handles)
 * - multiple active runs -> return disambiguation message string
 */
async function resolveRunId(restClient, projectId, args, command) {
  if (args[0]) return { runId: args[0] };
  const resp = await restClient.get(
    `/api/projects/${encodeURIComponent(projectId)}/runs`,
  );
  const runs = resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
  const active = runs.filter((r) => {
    const ps = r.pipeline_status || (r.active ? 'running' : null);
    return ps === 'running' || ps === 'paused' || ps === 'resuming';
  });
  if (active.length === 1) return { runId: active[0].id ?? active[0].run_id };
  if (active.length > 1) {
    const lines = active.map((r) => {
      const id = r.id ?? r.run_id;
      const ps = r.pipeline_status || (r.active ? 'running' : 'unknown');
      const title = r.work_request?.title;
      const parts = [`${statusEmoji(ps)} Run: ${id}`];
      if (title) parts.push(`   Title: ${title}`);
      return parts.join('\n');
    });
    const cmd = command || 'status';
    return {
      disambig: `Multiple active runs \u2014 specify a run ID:\n\n${lines.join('\n')}\n\nUsage: /${cmd} <run_id>`,
    };
  }
  return { runId: null };
}

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'interrupted',
  'stopped',
  'cancelled',
]);

function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

/**
 * Compute run duration. Uses run-level started_at → completed_at when available.
 * For terminal runs missing completed_at, falls back to stage iteration timestamps
 * (first started_at → last completed_at). For running pipelines, shows live elapsed.
 */
function fmtElapsedFromRun(run) {
  const startedAt = run.started_at;
  if (!startedAt) return null;

  const completedAt = run.completed_at;
  if (completedAt) {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    return ms >= 0 ? fmtMs(ms) : null;
  }

  const ps = run.pipeline_status || (run.active ? 'running' : 'unknown');
  if (TERMINAL_STATUSES.has(ps)) {
    // Derive from stage iterations: find the latest completed_at across all iterations
    let lastEnd = null;
    for (const stage of Object.values(run.stages || {})) {
      for (const iter of stage.iterations || []) {
        if (iter.completed_at) {
          const t = new Date(iter.completed_at).getTime();
          if (!lastEnd || t > lastEnd) lastEnd = t;
        }
      }
    }
    if (lastEnd) {
      const ms = lastEnd - new Date(startedAt).getTime();
      return ms >= 0 ? fmtMs(ms) : null;
    }
    return null;
  }

  // Running — show live elapsed
  const ms = Date.now() - new Date(startedAt).getTime();
  return ms >= 0 ? fmtMs(ms) : null;
}

function fmtCostFromStages(stages) {
  let totalCost = 0;
  for (const stage of Object.values(stages || {})) {
    for (const iter of stage.iterations || []) {
      totalCost += iter.cost_usd || 0;
    }
  }
  return totalCost > 0 ? `$${totalCost.toFixed(2)}` : null;
}

function rawCostFromStages(stages) {
  let totalCost = 0;
  for (const stage of Object.values(stages || {})) {
    for (const iter of stage.iterations || []) {
      totalCost += iter.cost_usd || 0;
    }
  }
  return totalCost;
}

function fmtStatusBlock(run) {
  const id = run.id ?? run.run_id;
  const ps = run.pipeline_status || (run.active ? 'running' : 'unknown');
  const title = run.work_request?.title;
  const elapsed = fmtElapsedFromRun(run);
  const cost = fmtCostFromStages(run.stages);
  const stage = run.stage;
  const iteration = run.iteration ?? run.stages?.[stage]?.iterations?.length;

  const parts = [`${statusEmoji(ps)} Run: ${id}`];
  if (title) parts.push(`   Title: ${title}`);
  parts.push(`   Status: ${ps}`);
  if (stage) {
    const iterPart = iteration ? ` (iteration ${iteration})` : '';
    parts.push(`   Stage: ${stage}${iterPart}`);
  }
  if (elapsed) parts.push(`   Duration: ${elapsed}`);
  if (cost) parts.push(`   Cost: ${cost}`);
  if (ps === 'completed' && run.pr_url) parts.push(`   PR: ${run.pr_url}`);
  return parts.join('\n');
}

/**
 * Creates handlers for project-scoped commands.
 *
 * @param {{ chatContext, restClient }} deps
 * @returns {Record<string, (chatKey: string, args: string[]) => Promise<string>>}
 */
export function createProjectHandlers({ chatContext, restClient }) {
  function requireProject(chatKey) {
    const { active_project } = chatContext.get(chatKey);
    return active_project ?? null;
  }

  async function status(chatKey, args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    let runId = args[0] ?? null;
    if (!runId) {
      const resolved = await resolveRunId(restClient, project, args, 'status');
      if (resolved.disambig) return resolved.disambig;
      runId = resolved.runId;
    }
    if (!runId)
      return 'No active run found.\nUse /runs to see recent runs, or specify a run ID: /status <run_id>';

    // Fetch full run data for title, cost, duration
    const runsResp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs`,
    );
    const allRuns =
      runsResp.data?.runs ??
      (Array.isArray(runsResp.data) ? runsResp.data : []);
    const run = allRuns.find((r) => (r.id ?? r.run_id) === runId);

    if (!run) {
      return `${statusEmoji('unknown')} Run: ${runId}\n   Status: unknown`;
    }

    return fmtStatusBlock(run);
  }

  async function runs(chatKey, args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    const limit = args[0]
      ? Math.max(1, Number.parseInt(args[0], 10) || 10)
      : 10;
    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs`,
    );
    const all = resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
    const slice = all.slice(0, limit);
    if (slice.length === 0) return `No runs found for ${project}.`;

    const lines = slice.map((r) => {
      const id = r.id ?? r.run_id;
      const ps = r.pipeline_status || (r.active ? 'running' : 'unknown');
      const title = r.work_request?.title;
      const parts = [`${statusEmoji(ps)} Run: ${id}`];
      if (title) parts.push(`   Title: ${title}`);
      parts.push(`   Status: ${ps}`);
      return parts.join('\n');
    });
    return `Recent runs (${project}):\n\n${lines.join('\n')}`;
  }

  async function last(chatKey, _args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs`,
    );
    const all = resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
    if (all.length === 0) return `No runs found for ${project}.`;

    return fmtStatusBlock(all[0]);
  }

  async function cost(chatKey, args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    // Use runs data for cost (has stages with iterations)
    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs`,
    );
    const all = resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
    const filter = args[0] ?? null;
    const filtered = filter
      ? all.filter((r) => (r.id ?? r.run_id) === filter)
      : all.slice(0, 5);
    if (filtered.length === 0) return `No runs found for ${project}.`;

    let grandTotal = 0;
    const lines = filtered.map((r) => {
      const id = r.id ?? r.run_id;
      const ps = r.pipeline_status || (r.active ? 'running' : 'unknown');
      const title = r.work_request?.title;
      const costVal = rawCostFromStages(r.stages);
      grandTotal += costVal;
      const parts = [`${statusEmoji(ps)} Run: ${id}`];
      if (title) parts.push(`   Title: ${title}`);
      parts.push(`   Cost: $${costVal.toFixed(2)}`);
      return parts.join('\n');
    });

    const header = `Cost summary (${project}):\n\n`;
    if (filtered.length > 1) {
      lines.push(`\nTotal: $${grandTotal.toFixed(2)}`);
    }
    return header + lines.join('\n');
  }

  async function pr(chatKey, args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    let runId = args[0] ?? null;
    if (!runId) {
      const resolved = await resolveRunId(restClient, project, args, 'pr');
      if (resolved.disambig) return resolved.disambig;
      runId = resolved.runId;
    }
    if (!runId) return 'No active run found.';

    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}/status`,
    );
    if (!resp.data?.ok) return `Run "${runId}" not found (404).`;
    const { pr_url } = resp.data;
    if (!pr_url) return `Run: ${runId}\nNo PR created yet.`;
    return `\u{1F517} Run: ${runId}\n   PR: ${pr_url}`;
  }

  async function error(chatKey, args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    let runId = args[0] ?? null;
    if (!runId) {
      // Find the most recent failed run
      const resp = await restClient.get(
        `/api/projects/${encodeURIComponent(project)}/runs`,
      );
      const all =
        resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
      const failed = all.find(
        (r) =>
          r.pipeline_status === 'failed' || r.pipeline_status === 'interrupted',
      );
      runId = failed ? (failed.id ?? failed.run_id) : null;
    }
    if (!runId)
      return 'No failed run found.\nUse /error <run_id> to check a specific run.';

    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs`,
    );
    const all = resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
    const run = all.find((r) => (r.id ?? r.run_id) === runId);
    if (!run) return `Run "${runId}" not found.`;

    const ps = run.pipeline_status || 'unknown';
    const title = run.work_request?.title;
    const stopReason = run.stop_reason;

    // Find the failed stage and its error
    let failedStage = null;
    let failedIter = null;
    let errorMsg = null;
    for (const [sname, sdata] of Object.entries(run.stages || {})) {
      for (const iter of sdata.iterations || []) {
        if (iter.error || iter.status === 'error') {
          failedStage = sname;
          failedIter = iter.number;
          errorMsg = iter.error;
          break;
        }
      }
      if (errorMsg) break;
    }

    const parts = [`${statusEmoji(ps)} Run: ${runId}`];
    if (title) parts.push(`   Title: ${title}`);
    if (stopReason) parts.push(`   Stop reason: ${stopReason}`);
    if (failedStage) {
      const iterLabel = failedIter ? ` (iteration ${failedIter})` : '';
      parts.push(`   Failed stage: ${failedStage}${iterLabel}`);
    }
    if (errorMsg) {
      const truncated =
        errorMsg.length > 300 ? `${errorMsg.slice(0, 300)}\u2026` : errorMsg;
      parts.push(`   Error: ${truncated}`);
    }
    if (!stopReason && !errorMsg) {
      parts.push('   No error details available.');
    }
    return parts.join('\n');
  }

  return { status, runs, last, cost, pr, error };
}
