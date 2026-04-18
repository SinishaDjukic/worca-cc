const NO_ACTIVE_PROJECT =
  'No active project. Use `/projects` to list, `/use <name>` to select.';

/**
 * Resolve run_id when the caller omits it:
 * - exactly one active run → return its id
 * - zero active runs → return null (caller handles)
 * - multiple active runs → return disambiguation message string
 */
async function resolveRunId(restClient, projectId, args) {
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
    const list = active.map((r) => `\u2022 ${r.id ?? r.run_id}`).join('\n');
    return {
      disambig: `Multiple active runs \u2014 specify a run ID:\n${list}`,
    };
  }
  return { runId: null };
}

function fmtRunLine(run) {
  const id = run.id ?? run.run_id;
  const ps = run.pipeline_status || (run.active ? 'running' : 'unknown');
  const title = run.work_request?.title;
  const label = title
    ? title.length > 40
      ? `${title.slice(0, 40)}\u2026`
      : title
    : '';
  return label
    ? `\u2022 ${id} "${label}" \u2014 ${ps}`
    : `\u2022 ${id} \u2014 ${ps}`;
}

function fmtElapsed(startedAt, completedAt) {
  if (!startedAt) return null;
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  if (ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
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
      const resolved = await resolveRunId(restClient, project, args);
      if (resolved.disambig) return resolved.disambig;
      runId = resolved.runId;
    }
    if (!runId) return 'No active run found.';

    // Fetch full run data for title, cost, duration
    const runsResp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs`,
    );
    const allRuns =
      runsResp.data?.runs ??
      (Array.isArray(runsResp.data) ? runsResp.data : []);
    const run = allRuns.find((r) => (r.id ?? r.run_id) === runId);

    const ps = run?.pipeline_status || 'unknown';
    const title = run?.work_request?.title;
    const elapsed = fmtElapsed(run?.started_at, run?.completed_at);
    const cost = fmtCostFromStages(run?.stages);
    const stage = run?.stage;

    const parts = [`Run: ${runId}`];
    if (title) parts.push(`Title: ${title}`);
    parts.push(`Status: ${ps}`);
    if (stage) parts.push(`Stage: ${stage}`);
    if (elapsed) parts.push(`Duration: ${elapsed}`);
    if (cost) parts.push(`Cost: ${cost}`);
    return parts.join('\n');
  }

  async function runs(chatKey, args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    const limit = args[0] ? Math.max(1, parseInt(args[0], 10) || 10) : 10;
    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs`,
    );
    const all = resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
    const slice = all.slice(0, limit);
    if (slice.length === 0) return 'No runs found.';
    return slice.map((r) => fmtRunLine(r)).join('\n');
  }

  async function last(chatKey, _args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs`,
    );
    const all = resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
    if (all.length === 0) return 'No runs found.';
    const r = all[0];
    const id = r.id ?? r.run_id;
    const ps = r.pipeline_status || (r.active ? 'running' : 'unknown');
    const title = r.work_request?.title;
    const elapsed = fmtElapsed(r.started_at, r.completed_at);
    const cost = fmtCostFromStages(r.stages);

    const parts = [`Last run: ${id} \u2014 ${ps}`];
    if (title) parts.push(`Title: ${title}`);
    if (elapsed) parts.push(`Duration: ${elapsed}`);
    if (cost) parts.push(`Cost: ${cost}`);
    return parts.join('\n');
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
    const runs = filter
      ? all.filter((r) => (r.id ?? r.run_id) === filter)
      : all.slice(0, 5);
    if (runs.length === 0) return 'No runs found.';

    let grandTotal = 0;
    const lines = runs.map((r) => {
      const id = r.id ?? r.run_id;
      const usd = fmtCostFromStages(r.stages);
      let costVal = 0;
      for (const stage of Object.values(r.stages || {})) {
        for (const iter of stage.iterations || []) {
          costVal += iter.cost_usd || 0;
        }
      }
      grandTotal += costVal;
      return `\u2022 ${id}: ${usd || '$0.00'}`;
    });
    if (runs.length > 1) {
      lines.push(`Total: $${grandTotal.toFixed(2)}`);
    }
    return lines.join('\n');
  }

  async function pr(chatKey, args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    let runId = args[0] ?? null;
    if (!runId) {
      const resolved = await resolveRunId(restClient, project, args);
      if (resolved.disambig) return resolved.disambig;
      runId = resolved.runId;
    }
    if (!runId) return 'No active run found.';

    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}/status`,
    );
    if (!resp.data?.ok) return `Run "${runId}" not found (404).`;
    const { pr_url } = resp.data;
    if (!pr_url) return `No PR for run ${runId}.`;
    return `PR for ${runId}: ${pr_url}`;
  }

  return { status, runs, last, cost, pr };
}
