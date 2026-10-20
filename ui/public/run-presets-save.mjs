// ui/public/run-presets-save.mjs — Save setup as preset on a run's page (docs/run-presets.md): the dialog's scope
// options for the run's own target, the request body (the server fixes the scope ref from the run row) and error text.
export const RUN_PRESET_SAVED_NOTE = 'Saved from this run: workflow, engine, guardrails, every agent and loop, branches, Away mark, opt-outs, cost tags. Never saved: title, prompt, Markdown, extra files, new branch name.';
const NO_SETUP_TEXT = 'This run started before Worca kept run setups, so there is nothing to save';

/** The run's own target first (the dialog's default, so branch names are kept), then Any project. */
export function runPresetScopeOptions(run, names = {}) {
  const any = { value: 'global', text: 'Any project' };
  if (!run) return [any];
  if (run.target === 'workspace' && run.workspaceId) {
    return [{ value: 'workspace', text: `Only workspace ${names[`workspace:${run.workspaceId}`] || run.workspaceName || run.workspaceId}` }, any];
  }
  if (run.projectKey) return [{ value: 'project', text: `Only ${names[`project:${run.projectKey}`] || run.projectName || run.projectKey}` }, any];
  return [any];
}

export function runPresetRequest(name, scopeKind) {
  return { name: String(name || '').trim(), scope: { kind: scopeKind === 'project' || scopeKind === 'workspace' ? scopeKind : 'global' } };
}

export function runPresetErrorText(status, data) {
  if (data && data.code === 'no-run-setup') return NO_SETUP_TEXT;
  if (status === 409) return 'A preset with this name already exists';
  return (data && data.error) || `HTTP ${status}`;
}
