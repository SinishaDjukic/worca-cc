import { statusEmoji } from './global.js';

const NO_ACTIVE_PROJECT =
  'No active project. Use `/projects` to list, `/use <name>` to select.';

function matchRunIdPattern(pattern, runs, command) {
  if (!pattern) return null;
  const isWildcard = pattern.startsWith('*');
  const suffix = isWildcard ? pattern.slice(1) : null;
  if (!isWildcard) return { runId: pattern };
  if (!suffix) return null;
  const matches = runs.filter((r) => (r.id ?? r.run_id ?? '').endsWith(suffix));
  if (matches.length === 1)
    return { runId: matches[0].id ?? matches[0].run_id };
  if (matches.length > 1) {
    const lines = matches.map((r) => {
      const id = r.id ?? r.run_id;
      const ps = r.pipeline_status || (r.active ? 'running' : 'unknown');
      const title = r.work_request?.title;
      const parts = [`${statusEmoji(ps)} **Run:** \`${id}\``];
      if (title) parts.push(`   **Title:** ${title}`);
      return parts.join('\n');
    });
    return {
      disambig: `Multiple runs match \`*${suffix}\`:\n\n${lines.join('\n')}\n\nUsage: /${command} <run_id>`,
    };
  }
  return { runId: pattern };
}

async function resolveRunId(restClient, projectId, args, command) {
  const resp = await restClient.get(
    `/api/projects/${encodeURIComponent(projectId)}/runs`,
  );
  const runs = resp.data?.runs ?? (Array.isArray(resp.data) ? resp.data : []);
  if (args[0]) {
    const matched = matchRunIdPattern(args[0], runs, command);
    if (matched) return matched;
  }
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
      const parts = [`${statusEmoji(ps)} **Run:** \`${id}\``];
      if (title) parts.push(`   **Title:** ${title}`);
      return parts.join('\n');
    });
    return {
      disambig: `Multiple active runs \u2014 specify a run ID:\n\n${lines.join('\n')}\n\nUsage: /${command} <run_id>`,
    };
  }
  return { runId: null };
}

async function invokeControl(restClient, projectId, runId, action) {
  const resp = await restClient.post(
    `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/${action}`,
  );
  return resp;
}

const ACTION_EMOJI = {
  pause: '\u{1F7E1}',
  resume: '\u{1F7E2}',
  stop: '\u{1F534}',
};

const ACTION_PAST = {
  pause: 'Paused',
  resume: 'Resumed',
  stop: 'Stopped',
};

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

  async function makeControlHandler(chatKey, args, action) {
    const project = requireProject(chatKey);
    if (!project) return NO_ACTIVE_PROJECT;

    const resolved = await resolveRunId(restClient, project, args, action);
    if (resolved.disambig) return resolved.disambig;
    const runId = resolved.runId;
    if (!runId) return 'No active run found.\nUse /runs to see recent runs.';

    const resp = await invokeControl(restClient, project, runId, action);
    if (!resp.data)
      return `Failed to ${action} run "${runId}" (${resp.status}).`;
    return `${ACTION_EMOJI[action]} ${ACTION_PAST[action]} run: \`${runId}\``;
  }

  async function pause(chatKey, args) {
    return makeControlHandler(chatKey, args, 'pause');
  }

  async function resume(chatKey, args) {
    return makeControlHandler(chatKey, args, 'resume');
  }

  async function stop(chatKey, args) {
    return makeControlHandler(chatKey, args, 'stop');
  }

  return { pause, resume, stop };
}
