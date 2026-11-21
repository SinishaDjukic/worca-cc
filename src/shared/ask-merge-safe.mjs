// src/shared/ask-merge-safe.mjs
// Which Ask turns may be stopped and asked again with more words (a voice merge, docs/speech.md), and
// which may be hidden when a merged message replaces them. One rule for the voice controller and the
// server's re-check before it marks a turn superseded. Pure: no I/O, no module state.

// Ask tools that change nothing (src/core/ask/tools.mjs has no per-tool flag): a turn that ran
// only these may be stopped and asked again. Anything else (a write, a proposal or draft tool,
// another server's tool) makes the next words a separate message.
export const READ_ONLY_ASK_TOOLS = Object.freeze([
  'list_projects', 'list_branches', 'list_workflows', 'list_runs', 'list_people', 'get_run', 'get_run_diff',
  'list_run_artifacts', 'read_run_artifact', 'get_run_progress', 'list_diff_comments', 'read_attachment', 'list_worktrees',
  'get_team_metrics', 'list_team_metrics_runs', 'get_team_policy', 'get_away_mode',
  'list_memory', 'read_memory', 'list_schedules', 'get_schedule', 'list_schedule_activity', 'preview_schedule',
  'list_task_sources', 'find_tasks', 'get_task', 'list_presets',
  'list_scripts', 'get_script', 'get_canvas', 'get_agent', 'get_workflow',
  'list_models', 'get_providers', 'list_copilot_models', 'list_endpoint_models',
  'get_network_proxy', 'get_project_actions', 'get_workspace_stacks', 'get_run_checkout', 'list_running_actions',
  'list_settings', 'list_blocks',
  'web_search', 'web_fetch', 'read_file', 'grep', 'glob',
]);
const READ_ONLY_SET = new Set(READ_ONLY_ASK_TOOLS);
const READ_ONLY_CLI_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/** May a turn holding this block be stopped and asked again with more words? Fails closed. */
export function mergeSafeBlock(block) {
  if (!block) return true;
  if (block.kind === 'agent') return false;        // a sub-agent holds the same grant: it can write
  if (block.kind !== 'tool') return true;
  const name = String(block.name || '');
  if (READ_ONLY_CLI_TOOLS.has(name)) return true;
  return READ_ONLY_SET.has(name.startsWith('mcp__worca__') ? name.slice('mcp__worca__'.length) : name);
}

/**
 * May a stored reply block be hidden by a merged message? A card (a proposal waiting for the person) never;
 * otherwise the merge rule. Missing blocks fail closed.
 */
export function supersedeSafeBlock(block) {
  return !!block && block.kind !== 'card' && mergeSafeBlock(block);
}
