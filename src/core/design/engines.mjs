// src/core/design/engines.mjs
// What each engine can do in Design (P8, SPEC section 1, C-3): the one table, kept honest against each adapter's own
// capabilities by test/design-engines.test.mjs, and the gate every design meets before it exists, at start and at
// Continue. An engine that cannot be held to "no Bash" (`allowedTools` false), reports no cost or cannot hold the deny
// rules needs a person's consent (L8.1, L8.4); Goose and any unknown engine are refused (L23). Consent comes only from
// a person pressing `Allow unguarded`: a design stores its engine at creation, and a stored engine is the consent
// (L8.2). Consent never lifts the broker, a bridged model that is not ready or a missing OpenCode model (L8.31).
// Import cycle (spawn-options → engines → build): `DESIGN_ENGINES` is read inside functions only.

import { brokerEngineRefusal } from '../broker-client.mjs';
import { bridgedModelInfo } from '../config.mjs';
import { getEngine, selectRunEngine } from '../engines/index.mjs';
import { OPENCODE_DEFAULT_MODEL_OPT_IN } from '../engines/opencode.mjs';
import { designWebOn } from '../settings.mjs';
import { resolveRunEngine } from '../settings-cascade.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { DesignRefusal } from './build.mjs';
import { resolveDesignModel } from './spawn-options.mjs';

/**
 * One row per engine. `gate`: `open` builds, `consent` needs a person's `Allow unguarded`, `refused` never builds.
 * `live`: where draws come from (`toolInput` streamed, `toolEnd` once a tool call ends, `watch` the disk). `cost`:
 * `exact`, `priced` (from tokens), `reported` by the engine, or `unknown` (never `$0`). `confine`: what holds writes
 * to the folder (`hook`, `sandbox`, `cwd`, the engine's `rules`, `none`). `readsOutsideCwd`: whether its agents can
 * read the picked project beside the design.
 */
export const DESIGN_ENGINES = Object.freeze({
  claude: Object.freeze({ gate: 'open', live: 'toolInput', cost: 'exact', confine: 'hook', readsOutsideCwd: true }),
  mock: Object.freeze({ gate: 'open', live: 'toolInput', cost: 'exact', confine: 'hook', readsOutsideCwd: true }),
  codex: Object.freeze({ gate: 'consent', live: 'watch', cost: 'reported', confine: 'sandbox', readsOutsideCwd: true }),
  copilot: Object.freeze({ gate: 'consent', live: 'watch', cost: 'unknown', confine: 'cwd', readsOutsideCwd: false }),
  cursor: Object.freeze({ gate: 'consent', live: 'watch', cost: 'unknown', confine: 'rules', readsOutsideCwd: true }),
  gemini: Object.freeze({ gate: 'consent', live: 'watch', cost: 'unknown', confine: 'rules', readsOutsideCwd: false }),
  goose: Object.freeze({ gate: 'refused', live: 'watch', cost: 'reported', confine: 'none', readsOutsideCwd: false }),
  opencode: Object.freeze({ gate: 'consent', live: 'watch', cost: 'reported', confine: 'rules', readsOutsideCwd: false }),
  qwen: Object.freeze({ gate: 'consent', live: 'watch', cost: 'unknown', confine: 'rules', readsOutsideCwd: false }),
});

/** Any engine the table does not name. */
const UNKNOWN_ROW = Object.freeze({ gate: 'refused', live: 'watch', cost: 'unknown', confine: 'none', readsOutsideCwd: false });
/** Claude on a model the bridge serves: tool calls arrive whole, and the cost is priced from tokens. */
const BRIDGED_ROW = Object.freeze({ gate: 'open', live: 'toolEnd', cost: 'priced', confine: 'hook', readsOutsideCwd: true, bridged: true });
/** Engines whose own hook holds every deny rule: the rules reason is skipped for them, as the run gate skips Claude. */
const HOOKED = new Set(['claude', 'mock']);

const GOOSE_REFUSAL = 'Goose cannot be held to one folder or kept from running commands, so Design does not run on it.';
const OPENCODE_NO_MODEL = 'OpenCode needs a model set in Settings before Design can run on it.';
const unknownRefusal = (engine) => `${engineLabel(engine)} has not been checked for Design, so it does not run here.`;
const sandboxReason = (label) => `${label} cannot be kept from running shell commands. Its sandbox holds writes to the folder, but its agents can read anything on this machine.`;
const shellReason = (label) => `${label} cannot be kept from running shell commands, so its agents can read and change files outside this design.`;
const toolsReason = (label, web) => `${label} runs with its shell${web ? '' : ' and web tools'} off here, but cannot be limited to the tools Design allows.`;
const costReason = (label) => `${label} reports no cost, so worca's spend limits cannot stop it.`;
const rulesReason = (label, list) => `${label} cannot fully hold these rules: ${list.join(', ')}.`;
const projectNote = (label) => `${label} cannot read the picked project.`;

const messageOf = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

/** `envFlag`'s reading of one variable, over `env` instead of `process.env` (`opencode.mjs`'s opt-in). */
function flagOn(env, name) {
  const v = env?.[name];
  return !!v && v !== '0' && String(v).toLowerCase() !== 'false';
}

/**
 * The table row for `engine`: Claude on a model the bridge serves gets the bridged row, a name the table does not
 * hold the refused one.
 * @param {string} engine
 * @param {{ models?: string[], bridged?: (modelId: string) => object|null }} [opts]
 * @returns {{ gate: string, live: string, cost: string, confine: string, readsOutsideCwd: boolean, bridged?: true }}
 */
export function designEngineRow(engine, { models = [], bridged = bridgedModelInfo } = {}) {
  if (typeof engine !== 'string' || !Object.hasOwn(DESIGN_ENGINES, engine)) return UNKNOWN_ROW;
  if (engine === 'claude' && models.some((m) => bridged(m))) return BRIDGED_ROW;
  return DESIGN_ENGINES[engine];
}

/** The adapter's deny rules it cannot hold, or holds only in part, as `RunHarness._engineUnenforced`/`_enginePartial`. */
function looseRules(adapter, rules) {
  if (adapter.capabilities?.permissionRules === false) return [];
  return [...new Set([...(adapter.unenforcedRules?.(rules) ?? []), ...(adapter.partialRules?.(rules) ?? [])])];
}

/**
 * Whether a Design build may run on `engine`. Synchronous, so `registry.start` stays free of `await` up to
 * `DesignBuild.create`. A refusal no consent lifts is `engine-refused`; reasons a person may accept are
 * `engine-gated`, and `allowed` (a person's `Allow unguarded`, or a stored engine) lets those through.
 * @param {{ engine: string, models?: string[], rules?: { deny?: string[] }|null, allowed?: boolean, project?: boolean,
 *   design?: { models?: object|null }|null,
 *   adapterOf?: (engine: string) => object, broker?: (engine: string, env: object) => string|null,
 *   bridged?: (modelId: string) => object|null, modelFor?: (role: 'lead'|'builder') => string|null, env?: object,
 *   web?: boolean }} opts `web`: the lead's web access (Settings › Design), which the tools reason then leaves out
 * @returns {{ ok: true, row: object, notes: string[] }
 *   | { ok: false, overridable: boolean, code: 'engine-gated'|'engine-refused', error: string, reasons: string[],
 *     notes: string[], row: object }}
 */
export function designEngineGate({
  engine, models = [], rules = null, allowed = false, project = false, adapterOf = getEngine,
  design = null, broker = brokerEngineRefusal, bridged = bridgedModelInfo,
  modelFor = (role) => resolveDesignModel(role, { engine, design }).model,
  env = process.env, web = designWebOn(),
} = {}) {
  let row = designEngineRow(engine, { models, bridged });
  let adapter = null;
  try { adapter = adapterOf(engine); } catch { row = UNKNOWN_ROW; }
  const refuse = (error) => ({ ok: false, overridable: false, code: 'engine-refused', error, reasons: [error], notes: [], row });
  if (row.gate === 'refused' || !adapter) return refuse(engine === 'goose' && adapter ? GOOSE_REFUSAL : unknownRefusal(engine));
  const brokered = broker(engine, env);
  if (brokered) return refuse(brokered);
  for (const m of models) {
    const info = bridged(m);
    if (info?.ready === false) return refuse(info.message || `${m} cannot be reached yet.`);
  }
  if (engine === 'opencode' && !flagOn(env, OPENCODE_DEFAULT_MODEL_OPT_IN) && (!modelFor('lead') || !modelFor('builder'))) {
    return refuse(OPENCODE_NO_MODEL);
  }
  const label = engineLabel(engine);
  const caps = adapter.capabilities ?? {};
  const reasons = [];
  if (caps.allowedTools === false) {
    const bash = { deny: ['Bash'] };
    const shellHeld = !looseRules(adapter, bash).includes('Bash');
    if (row.confine === 'sandbox') reasons.push(sandboxReason(label));
    else reasons.push(shellHeld ? toolsReason(label, web === true) : shellReason(label));
  }
  if (caps.cost === false) reasons.push(costReason(label));
  if (!HOOKED.has(engine)) {
    const loose = looseRules(adapter, rules);
    if (loose.length) reasons.push(rulesReason(label, loose));
  }
  const notes = project && !row.readsOutsideCwd ? [projectNote(label)] : [];
  if (!reasons.length || allowed) return { ok: true, row, notes };
  return { ok: false, overridable: true, code: 'engine-gated', error: reasons[0], reasons, notes, row };
}

/**
 * The engine a new design builds on: `explicit` when named, else the run-engine setting (project, then user), else
 * Claude. A name worca does not run (`mock` included: it is the offline stand-in, never chosen) is a 400.
 * @param {{ explicit?: string|null, projectKey?: string|null }} [opts]
 * @returns {string}
 * @throws {DesignRefusal}
 */
export function resolveDesignEngine({ explicit = null, projectKey = null } = {}) {
  try {
    return selectRunEngine(resolveRunEngine({ explicit, projectKey }).engine);
  } catch (err) {
    throw new DesignRefusal(400, messageOf(err));
  }
}

/**
 * The engine `design` builds on: its stored one as it is (`mock` included), else the resolved one, not stored yet
 * (a row made before P8 re-enters the gate).
 * @param {{ engine?: string|null, projectKey?: string|null }|null} design
 * @returns {{ engine: string, stored: boolean }}
 */
export function designEngineFor(design) {
  const stored = design?.engine;
  if (typeof stored === 'string' && stored.trim()) return { engine: stored, stored: true };
  return { engine: resolveDesignEngine({ projectKey: design?.projectKey ?? null }), stored: false };
}
