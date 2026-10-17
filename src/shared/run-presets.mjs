// src/shared/run-presets.mjs — what a run preset keeps of a POST /api/run body (docs/run-presets.md).
// A preset is the run's CHOICES, never its task: title, prompt, Markdown, source, extra files and the
// new-branch name are not in the whitelist, and neither are per-start consents (allowUnguardedEngine,
// pastTeamCap, policyReason, syncPolicy, syncOnDiverged) or schedule fields.

export const PRESET_SETUP_KEYS = Object.freeze([
  'workflowId', 'engine', 'guardrailsId', 'mcpOptOut', 'mock', 'nightMode', 'humanInLoop',
  'sourceBranch', 'sourceBranchByKey', 'sameAsSource', 'syncBeforeStart', 'tags', 'overlay',
]);
export const PRESET_LIMITS = Object.freeze({ nameMax: 80, setupBytes: 32 * 1024 });
export const PRESET_SCOPES = Object.freeze(['global', 'project', 'workspace']);
const BRANCH_KEYS = ['sourceBranch', 'sourceBranchByKey'];

/** The preset setup a run body carries: whitelisted keys only, `undefined` dropped, and branch names dropped for a global preset. */
export function setupFromBody(body, { scope = 'global' } = {}) {
  const out = {};
  for (const k of PRESET_SETUP_KEYS) {
    if (!body || body[k] === undefined) continue;
    if (scope === 'global' && BRANCH_KEYS.includes(k)) continue;
    out[k] = structuredClone(body[k]);
  }
  return out;
}

/** The run body a setup starts: the setup's keys over the task and target the form supplies. */
export function bodyFromSetup(setup, task) {
  return { ...structuredClone(setup || {}), ...task };
}

/** '' when the name is fine, else the message. */
export function checkPresetName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'name is required';
  if (name.trim().length > PRESET_LIMITS.nameMax) return `name too long (max ${PRESET_LIMITS.nameMax} characters)`;
  if (/[\u0000-\u001f]/.test(name)) return 'name must not contain control characters';
  return '';
}

/** A node's human label for messages: "Planner" for key planner, the node's config.label when it has one. */
export function nodeLabel(node) {
  const own = node && node.config && typeof node.config.label === 'string' && node.config.label.trim();
  if (own) return own;
  const key = node && typeof node.key === 'string' && node.key ? node.key : String(node?.id || 'agent');
  return key.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
