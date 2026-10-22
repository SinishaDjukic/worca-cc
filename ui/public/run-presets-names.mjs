// ui/public/run-presets-names.mjs — how a run preset's setup is named on screen (docs/run-presets.md): the
// workflow's name and the engine's label, never their ids. The one source for Settings › Presets, New run's
// picker, the Chat home chips and the Save dialog. Pure: callers pass the workflow names they hold.
import { ENGINES } from '../../src/shared/engine-switch.mjs';

export const AUTO_WORKFLOW_LABEL = 'Auto workflow';
export const WORKFLOW_REMOVED_LABEL = 'Workflow removed';
export const UNKNOWN_ENGINE_LABEL = 'Unknown engine';
const BUILTIN_WORKFLOW_NAMES = Object.freeze({ wf_default: 'Default' });   // the picker's own fallback (app.js loadWorkflowsInto)

/** GET /api/workflows rows → { id: name }, or null when the list is not known (a failed fetch). */
export function workflowNamesFrom(list) {
  if (!Array.isArray(list)) return null;
  const names = {};
  for (const w of list) if (w && w.id) names[w.id] = String(w.name || '').trim() || 'Untitled workflow';
  return names;
}

/**
 * { text, removed } for a preset's workflow. wf_auto is the client-side Auto choice (never listed); an id the list
 * no longer holds is removed. With no list (null) a non-built-in id names nothing: null, never a false "removed".
 */
export function presetWorkflowName(workflowId, names) {
  const id = workflowId || 'wf_default';
  if (id === 'wf_auto') return { text: AUTO_WORKFLOW_LABEL, removed: false };
  if (names && Object.hasOwn(names, id)) return { text: names[id], removed: false };
  if (Object.hasOwn(BUILTIN_WORKFLOW_NAMES, id)) return { text: BUILTIN_WORKFLOW_NAMES[id], removed: false };
  return names ? { text: WORKFLOW_REMOVED_LABEL, removed: true } : null;
}

/** The engine's catalog label ("Claude", "Codex"…); an id outside the catalog is never shown. */
export function presetEngineName(engine) {
  const e = engine || 'claude';
  return Object.hasOwn(ENGINES, e) ? ENGINES[e].label : UNKNOWN_ENGINE_LABEL;
}

/** { workflow, engine, text }: text is "Auto workflow · Codex", or just the engine while the workflow names nothing. */
export function presetSetupSummary(setup, names) {
  const workflow = presetWorkflowName(setup && setup.workflowId, names);
  const engine = presetEngineName(setup && setup.engine);
  return { workflow, engine, text: workflow ? `${workflow.text} · ${engine}` : engine };
}

/** New run's Save dialog note: what the preset keeps, its workflow and engine named. */
export function presetSavedNote(setup, names, { projectDefault = false } = {}) {
  const { workflow, engine } = presetSetupSummary(setup, names);
  const wf = workflow ? `${workflow.text}${projectDefault ? " (this project's default)" : ''} · ` : '';
  return `Saved: ${wf}${engine}, guardrails, agents, loops, branches, Away mark, opt-outs. Never saved: title, prompt, Markdown, extra files, new branch name.`;
}
