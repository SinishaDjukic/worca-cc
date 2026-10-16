// src/core/ask/chat-action-deps.mjs
// worca Chat P2: the MCP child's half of the act-then-undo tools (tools.mjs imports nothing): the settings registry
// WITHOUT writers (list_settings, change_setting's self-check), the readers resume_run and propose_pull_request check
// a run against, and the registry readers ui/server.mjs reuses for its writable copy. Every write happens in the
// parent (action-deps.mjs), never here.
import { readSettings } from '../settings.mjs';
import { resolveSetting, assertProjectSettingsPatch, settingIds, settingEntry } from '../settings-cascade.mjs';
import { agentSteps, listModels, assertSlotModels } from '../config.mjs';
import { listProjects } from '../projects.mjs';
import { readPrState } from '../artifacts.mjs';
import { budgetStatus, readCostCapOverride } from '../cost-budget.mjs';
import { DIRECTION_MAX_CHARS } from '../directions.mjs';
import { WORKSPACE_SCAN_DEFAULT_MODELS } from '../graph/builtin-workflows.mjs';
import { createSettingsRegistry } from './settings-registry.mjs';

/** The settings registry's readers over the real stores (the child and ui/server.mjs share them). */
export function defaultSettingsRegistryDeps() {
  return {
    readSettings,
    roles: () => agentSteps().map(({ key, label }) => ({ key, label })),
    listModels: (dir) => listModels(dir || ''),
    assertSlotModels,
    resolveSetting,
    assertProjectSettingsPatch,
    // A user-only id (the chat engine and models, the workspace scan models) has no project layer: never offered there.
    projectSettingIds: (roles) => settingIds({ roles }).filter((id) => !(settingEntry(id) || {}).userOnly),
    projects: () => listProjects(),
    scanDefaults: WORKSPACE_SCAN_DEFAULT_MODELS,
  };
}

/** What stops a resume before it starts (resumeRun's cost gates), worded for the model with what to do — or null.
 *  The total cost limit refuses every resume (no click gets past it); the run's own limit needs the user's Resume click.
 *  The team gates, a moved base and the engine refusal need the live server: the parent's notice covers them. */
export function resumeBlocker(row, { budget = () => budgetStatus(), override = readCostCapOverride } = {}) {
  let b = null;
  try { b = budget(); } catch { return null; }
  if (b && b.blocked) return 'the total cost limit is reached — no Resume gets past it until the user raises or clears it in Settings';
  const cap = b ? b.pipelineLimitUsd : null;
  const spent = Number((row && row.total_cost_usd) || 0);
  if (cap != null && spent >= cap && !override(row.id)) return `the run reached its cost limit ($${Number(cap).toFixed(2)}) — ask the user to press Resume on the run card to confirm`;
  return null;
}

export function defaultChatActionDeps() {
  return { chatActions: {
    settings: createSettingsRegistry(defaultSettingsRegistryDeps()),
    prState: (id) => readPrState(id),
    resumeBlocker: (row) => resumeBlocker(row),
    directionMaxChars: DIRECTION_MAX_CHARS,
  } };
}
