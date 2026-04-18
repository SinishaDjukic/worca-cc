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
      disambig: `Multiple active runs — specify a run ID:\n${list}`,
    };
  }
  return { runId: null };
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

    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}/status`,
    );
    if (!resp.data?.ok) return `Run "${runId}" not found (404).`;
    const { pipeline_status, stage, iteration } = resp.data;
    const parts = [`Run: ${runId}`, `Status: ${pipeline_status}`];
    if (stage) parts.push(`Stage: ${stage}`);
    if (iteration != null) parts.push(`Iteration: ${iteration}`);
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
    return slice
      .map((r) => {
        const ps = r.pipeline_status || (r.active ? 'running' : 'unknown');
        return `\u2022 ${r.id ?? r.run_id} \u2014 ${ps}`;
      })
      .join('\n');
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
    const ps = r.pipeline_status || (r.active ? 'running' : 'unknown');
    return `Last run: ${r.id ?? r.run_id} \u2014 ${ps}`;
  }

  async function cost(chatKey, args) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    const resp = await restClient.get(
      `/api/projects/${encodeURIComponent(project)}/costs`,
    );
    const tokenData = resp.data?.tokenData ?? {};
    const filter = args[0] ?? null;

    const entries = Object.entries(tokenData).filter(
      ([id]) => !filter || id === filter,
    );
    if (entries.length === 0) return 'No cost data found.';

    return entries
      .map(([runId, stages]) => {
        let input = 0;
        let output = 0;
        for (const iters of Object.values(stages)) {
          for (const it of iters) {
            input += it.inputTokens ?? 0;
            output += it.outputTokens ?? 0;
          }
        }
        return `\u2022 ${runId}: ${input.toLocaleString()} in / ${output.toLocaleString()} out tokens`;
      })
      .join('\n');
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
