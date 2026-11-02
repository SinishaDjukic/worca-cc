// src/core/ask/proposal-preset.mjs — propose_run's presetId (docs/run-presets.md "Chat", #712 slice 3).
// The preset's picks fill what the model did not pass; the validator then checks the merged input like any proposal,
// so a gone guardrail set, workflow or model is named by the usual errors. "As is" (D9): a preset that runs on
// Permissive — or names no guardrails, which a start reads as the install default (Permissive on an install from
// before v71, defaultGuardrailSetId), so it is refused too — never
// becomes a card unless the model names guardrailsId itself.

export const PRESET_PROPOSAL_ERRORS = Object.freeze({
  off: 'presetId cannot be read here — presets are not available to this validator',
  type: 'presetId must be a preset id (rp_…) from list_presets',
  unknown: (id) => `preset ${String(id).slice(0, 40)} not found — list_presets shows the ids`,
  permissive: (name) => `Preset "${name}" uses the Permissive guardrail set, which a proposed run cannot use — pass guardrailsId "normal" or a stricter set`,
  pinned: (name, scope) => `Preset "${name}" is pinned to ${scope.kind} ${scope.ref} — propose it for that ${scope.kind}`,
});

const FILL_KEYS = ['workflowId', 'engine', 'guardrailsId', 'tags', 'sameAsSource', 'sourceBranch', 'sourceBranchByKey'];
const CARD_SETUP_KEYS = ['humanInLoop', 'nightMode', 'mcpOptOut', 'syncBeforeStart', 'mock'];
const given = (v) => v !== undefined && v !== null && v !== '';

/** @returns {{ input: object, errors: string[], cardPreset: object }} */
export function presetProposalInput(preset, inp) {
  const s = preset.setup || {};
  const errors = [];
  const input = { ...inp };
  delete input.presetId;
  const scope = preset.scope || { kind: 'global', ref: null };
  // Trimmed, as the validator's str() reads them: ' demo-00000001 ' is that project.
  const pk = String(inp.projectKey ?? '').trim();
  const ws = String(inp.workspaceId ?? '').trim();
  if (scope.kind !== 'global' && !pk && !ws) {
    input[scope.kind === 'project' ? 'projectKey' : 'workspaceId'] = scope.ref;
  } else if (scope.kind === 'project' ? pk !== scope.ref : scope.kind === 'workspace' && ws !== scope.ref) {
    errors.push(PRESET_PROPOSAL_ERRORS.pinned(preset.name, scope));
  }
  if (!given(inp.guardrailsId) && (s.guardrailsId || 'permissive') === 'permissive') errors.push(PRESET_PROPOSAL_ERRORS.permissive(preset.name));
  for (const k of FILL_KEYS) if (!given(inp[k]) && s[k] !== undefined) input[k] = structuredClone(s[k]);
  const presetWf = s.workflowId || 'wf_default';
  const sameWf = (input.workflowId || 'wf_default') === presetWf;
  if (sameWf && !given(inp.nodes) && s.overlay?.nodes) {
    input.nodes = {};
    for (const [id, pick] of Object.entries(s.overlay.nodes)) {
      const n = {};
      for (const k of ['model', 'effort', 'subagentModel']) if (typeof pick?.[k] === 'string' && pick[k]) n[k] = pick[k];
      // A preset snapshot names a model for every node that has one (completeSnapshot). A pick without a model
      // (effort or subagentModel only) is left off the card: signed out, requireModel would refuse it. Its
      // fanOut/askQuestions still reach the run through card.preset.setup.overlay.
      if (n.model) input.nodes[id] = n;
    }
  }
  const setup = {};
  for (const k of CARD_SETUP_KEYS) if (s[k] !== undefined) setup[k] = structuredClone(s[k]);
  if (sameWf && s.overlay) setup.overlay = structuredClone(s.overlay);
  return { input, errors, cardPreset: { id: preset.id, name: preset.name, workflowId: presetWf, setup } };
}
