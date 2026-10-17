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

/** The POST /api/run body a preset start sends — New run after a pick, `worca run --preset`, a fired schedule:
 *  the setup's keys, the task and target over them, and the presetId the server checks (409 preset-broken). */
export function presetRunBody(preset, task) {
  return { ...bodyFromSetup(preset.setup, task), presetId: preset.id };
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The setup keys a start set to something other than the preset's own value (a field changed on the form, a choice
 *  an Ask card made). A schedule keeps these as chosen; every other key follows the preset at fire time. */
export function overriddenKeys(body, setup) {
  return PRESET_SETUP_KEYS.filter((k) => body && body[k] !== undefined && !sameValue(body[k], setup ? setup[k] : undefined));
}

/** A fired ticket that follows a preset (D4): the stored request's task, the preset's CURRENT setup. Every setup key
 *  of the stored copy is dropped first, so a pick removed from the preset is removed from the run — except the keys
 *  in `keep`, the ones the start overrode (overriddenKeys), which stay as the person or the card chose them. An Any
 *  project preset stores no branch names, so the request's own stay. */
export function bodyFollowingPreset(request, preset, { keep = [] } = {}) {
  const keepBranches = !preset.scope || preset.scope.kind === 'global';
  const task = {};
  for (const [k, v] of Object.entries(request || {})) {
    if (PRESET_SETUP_KEYS.includes(k) && !keep.includes(k) && !(keepBranches && BRANCH_KEYS.includes(k))) continue;
    task[k] = v;
  }
  return presetRunBody(preset, task);
}

/** Two run overlays: `top`'s per-node picks over `base`'s, loop budgets merged. */
export function overlayOver(base, top) {
  const nodes = { ...(base?.nodes || {}) };
  for (const [id, pick] of Object.entries(top?.nodes || {})) nodes[id] = { ...(nodes[id] || {}), ...pick };
  const wires = { ...(base?.wires || {}), ...(top?.wires || {}) };
  return { ...(Object.keys(nodes).length ? { nodes: structuredClone(nodes) } : {}), ...(Object.keys(wires).length ? { wires: structuredClone(wires) } : {}) };
}

const CARD_ONLY_KEYS = ['humanInLoop', 'nightMode', 'mcpOptOut', 'syncBeforeStart', 'mock'];
// The card already shows and sends these per node (card.nodes → its agent lane), so the preset's copy must never
// sit under the lane: the lane sends only picks that differ from the project, and with "Save as project defaults"
// it sends none, so a preset copy would silently undo a pick the person reset or saved on the card.
const CARD_NODE_KEYS = ['model', 'effort', 'subagentModel'];
/** Start on an Ask card proposed from a preset (D11): presetId, the keys the card has no control for, and the
 *  preset's loop budgets and per-node fanOut/askQuestions under the card's own overlay — only while the card still
 *  runs the preset's workflow. The preset's model/effort/subagentModel are never added (the card's lane owns them).
 *  On another workflow the card's own overlay (already built for that workflow) goes out untouched. */
export function applyPresetStart(body, cardPreset) {
  const s = cardPreset.setup || {};
  body.presetId = cardPreset.id;
  for (const k of CARD_ONLY_KEYS) if (s[k] !== undefined) body[k] = structuredClone(s[k]);
  if (body.workflowId === cardPreset.workflowId && s.overlay) {
    const hidden = {};
    for (const [id, pick] of Object.entries(s.overlay.nodes || {})) {
      const rest = Object.fromEntries(Object.entries(pick || {}).filter(([k]) => !CARD_NODE_KEYS.includes(k)));
      if (Object.keys(rest).length) hidden[id] = rest;
    }
    const merged = overlayOver({ ...(Object.keys(hidden).length ? { nodes: hidden } : {}), ...(s.overlay.wires ? { wires: s.overlay.wires } : {}) }, body.overlay);
    if (Object.keys(merged).length) body.overlay = merged;
  }
  return body;
}
