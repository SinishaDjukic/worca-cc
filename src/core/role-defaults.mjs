// src/core/role-defaults.mjs — Worca's own model per role (#1450): what an empty role runs on Claude Code and Codex
// instead of the tool's own default (which may be a premium model nobody chose). Pure: no settings, no catalog I/O,
// no spawn code — the Codex defaults derive from the CODEX_PRICES built-ins by price tier (model-tiers.mjs).
import { CODEX_PRICES, CODEX_DEFAULT_MODEL } from './list-prices.mjs';
import { modelFacts } from './model-tiers.mjs';
import { MODEL_ROLES, ROLE_LABELS } from '../shared/model-roles.mjs';
import { engineLabel } from '../shared/engine-switch.mjs';

/** The harnesses whose empty roles resolve to a Worca default; every other harness picks its own model. */
export const ROLE_DEFAULT_HARNESSES = Object.freeze(['claude', 'codex']);

/** Claude Code's defaults: no effort (the step's own effort or the CLI's default effort applies). */
export const CLAUDE_ROLE_DEFAULTS = Object.freeze({
  deep: Object.freeze({ model: 'claude-opus-5-5' }),
  everyday: Object.freeze({ model: 'claude-sonnet-5-5' }),
  quick: Object.freeze({ model: 'claude-haiku-5-5' }),
});

const cheapest = (facts, { prefer } = {}) => [...facts].sort((a, b) => {
  const d = a.price.output - b.price.output;
  if (d) return d;
  if (prefer && (a.id === prefer) !== (b.id === prefer)) return a.id === prefer ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
})[0];

/** Codex's defaults by tier over the built-in ids: Deep the cheapest top-tier model, Everyday the cheapest strong-tier
 *  one (a price tie goes to `prefer`, codex's own default, else id order), Quick the cheapest non-free model with tool
 *  calls. Never premium. A tier with no model leaves its role out. */
function derive(ids, prefer) {
  const facts = modelFacts((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id).map((id) => ({ id })))
    .filter((f) => f.price && f.price.output !== null && f.tier && f.tier !== 'premium');
  const out = {};
  const deep = cheapest(facts.filter((f) => f.tier === 'top'));
  const everyday = cheapest(facts.filter((f) => f.tier === 'strong'), { prefer });
  const quick = cheapest(facts.filter((f) => !f.free && f.toolCalls));
  if (deep) out.deep = Object.freeze({ model: deep.id });
  if (everyday) out.everyday = Object.freeze({ model: everyday.id });
  if (quick) out.quick = Object.freeze({ model: quick.id });
  return Object.freeze(out);
}
let codexMemo = null;
export function deriveCodexRoleDefaults(ids, { prefer = CODEX_DEFAULT_MODEL } = {}) {
  if (ids === undefined && prefer === CODEX_DEFAULT_MODEL) return (codexMemo ??= derive(Object.keys(CODEX_PRICES), prefer));
  return derive(ids === undefined ? Object.keys(CODEX_PRICES) : ids, prefer);
}

const defaultsOf = (engine) => (engine === 'claude' ? CLAUDE_ROLE_DEFAULTS : engine === 'codex' ? deriveCodexRoleDefaults() : null);

/** Worca's default for `role` on `engine`, or null: an engine that picks its own model, an unknown role, or Claude
 *  Code signed out (a Claude id cannot run there; the tool-decides warning shows instead). */
export function roleDefaultFor(engine, role, { claudeAuth = 'unknown' } = {}) {
  if (!ROLE_DEFAULT_HARNESSES.includes(engine) || !MODEL_ROLES.includes(role)) return null;
  if (engine === 'claude' && claudeAuth === 'signed-out') return null;
  const hit = defaultsOf(engine)?.[role];
  return hit ? { model: hit.model, effort: undefined, role, source: 'worca-default' } : null;
}

/** GET /api/settings `roleDefaults`: { claude: { deep: { model }, … }, codex: { … } }. */
export function roleDefaultsPayload() {
  const out = {};
  for (const engine of ROLE_DEFAULT_HARNESSES) {
    out[engine] = {};
    for (const [role, pick] of Object.entries(defaultsOf(engine))) out[engine][role] = { model: pick.model };
  }
  return out;
}

const stepName = (nc) => nc?.meta?.displayName || nc?.authoredKey || nc?.key || nc?.nodeId || 'A step';
const roleLabel = (nc, roleOfNode) => {
  const role = typeof roleOfNode === 'function' ? roleOfNode(nc) : nc?.role;
  return ROLE_LABELS[role] || 'Everyday tasks';
};

/**
 * Run-start lines about steps no one gave a model (fix 2/3): the tool-decides warning on an engine Worca cannot know
 * the model of (or Claude Code signed out), and one line per step on a Worca default or under "Let Claude Code decide".
 * `nodes`: resolveGraph nodes (agent nodes carry model / modelSource). `labelOf(id)`: a model's display label.
 * `roleOf(nc)`: the node's role key.
 */
export function noModelLines(engine, nodes, { claudeAuth = 'unknown', labelOf = (id) => id, roleOf: roleOfNode } = {}) {
  const agents = Object.values(nodes || {}).filter((nc) => nc && nc.kind === 'agent');
  const out = [];
  const toolDecides = !ROLE_DEFAULT_HARNESSES.includes(engine) || (engine === 'claude' && claudeAuth === 'signed-out');
  if (toolDecides) {
    const empty = agents.filter((nc) => !nc.model);
    if (empty.length) {
      const n = empty.length;
      out.push(`${n} ${n === 1 ? 'step has' : 'steps have'} no model: ${engineLabel(engine)} decides which model runs (Worca can't know it or its price).`);
    }
    return out;
  }
  for (const nc of agents) {
    const role = roleLabel(nc, roleOfNode);
    if (nc.modelSource === 'cli-decides') out.push(`${stepName(nc)}: ${engineLabel(engine)} decides the model (your ${role} role).`);
    else if (nc.modelSource === 'worca-default' && nc.model) out.push(`${stepName(nc)} runs on ${labelOf(nc.model)} (Worca's default for ${role}).`);
  }
  return out;
}
