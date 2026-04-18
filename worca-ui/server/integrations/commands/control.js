const NO_ACTIVE_PROJECT =
  'No active project. Use `/projects` to list, `/use <name>` to select.';

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
    return { disambig: `Multiple active runs — specify a run ID:\n${list}` };
  }
  return { runId: null };
}

async function invokeControl(restClient, projectId, runId, action) {
  const resp = await restClient.post(
    `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/${action}`,
  );
  return resp;
}

/**
 * Creates handlers for control commands: /pause /resume /stop.
 *
 * @param {{ chatContext, restClient }} deps
 * @returns {Record<string, (chatKey: string, args: string[]) => Promise<string>>}
 */
export function createControlHandlers({ chatContext, restClient }) {
  function requireProject(chatKey) {
    const { active_project } = chatContext.get(chatKey);
    return active_project ?? null;
  }

  async function makeControlHandler(chatKey, args, action, pastTense) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    const resolved = await resolveRunId(restClient, project, args);
    if (resolved.disambig) return resolved.disambig;
    const runId = resolved.runId;
    if (!runId) return 'No active run found.';

    const resp = await invokeControl(restClient, project, runId, action);
    if (!resp.data)
      return `Failed to ${action} run "${runId}" (${resp.status}).`;
    return `${pastTense} ${runId}.`;
  }

  async function pause(chatKey, args) {
    return makeControlHandler(chatKey, args, 'pause', 'Paused');
  }

  async function resume(chatKey, args) {
    return makeControlHandler(chatKey, args, 'resume', 'Resumed');
  }

  async function stop(chatKey, args) {
    return makeControlHandler(chatKey, args, 'stop', 'Stopped');
  }

  return { pause, resume, stop };
}
