// src/core/agent-registry.mjs
// Data-driven agent registry. Scans agents/*.meta.json into an in-memory map
// keyed by agent key, sorted by `.order`. This replaces what used to be hardcoded
// across AGENT_FILES (orchestrator.mjs) and AGENT_STEPS (config.mjs): adding an
// agent is now "drop agents/<key>.md + agents/<key>.meta.json", no core edit.
//
// Read synchronously so it can back a synchronous AGENT_STEPS constant in
// config.mjs. Tolerant: a malformed sidecar, or one missing `key`/`order`, is
// skipped rather than throwing (mirrors the tolerant readers elsewhere).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNEL_IDS as CHANNEL_ID_LIST } from './channels.mjs'; // single source (m2)
import { worcaHome } from './projects.mjs'; // user agent layer root (read fresh per call)
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // plugin layer roots (Task 2)
import { MOCK_WRITER_ROLES } from './claude-runner.mjs'; // closed mockRole vocabulary (§5 ⟨d⟩)

/** Default location of the agent metadata sidecars, relative to this module. */
const DEFAULT_AGENTS_DIR = new URL('../../agents/', import.meta.url).pathname;

const COLORS = new Set(['green', 'peach', 'red', 'blue', 'violet', 'amber']);
const RUNNER_TYPES = new Set(['producer', 'verifier', 'clarifier']);
const CHANNEL_IDS = new Set(CHANNEL_ID_LIST);

/** Organizational-only domain tag (coding, marketing, financing, …): lowercase
 *  kebab, ≤32 chars. 'shared' is a recognized sentinel that passes this regex and
 *  is stored verbatim; the palette injects it into every section. */
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Coerce a raw domain to a valid tag; absent/malformed fails safe to the VISIBLE
 *  'general' default. Does NOT trim (meta-file input is authored). */
function normalizeDomain(raw) {
  return typeof raw === 'string' && DOMAIN_RE.test(raw) ? raw : 'general';
}

/**
 * Built-in channel/governance spec per agent key. RETAINED, currently unread:
 * meta v2 derives the v1 channel view from the sidecar's own ports (see the
 * v1-compat shim below), so nothing consults this table any more. It is deleted
 * together with the shim when the v1 engine goes away; keeping it until then
 * makes that one removal, not two.
 */
const DEFAULT_SPEC = {
  clarify:              { consumes: ['userPrompt'],                       produces: ['clarify'],         connectsTo: ['planner'] },
  planner:              { consumes: ['userPrompt', 'clarify', 'review'],  optionalConsumes: ['clarify', 'review'], produces: ['plan'], connectsTo: ['refiner', 'implementer', 'planReviewer', 'decomposer'] },
  refiner:              { consumes: ['plan'],              produces: ['plan', 'review'],  connectsTo: ['implementer', 'refiner', 'decomposer'] },
  decomposer:           { consumes: ['plan'],              produces: ['decomposition'],   connectsTo: ['implementer'] },
  implementer:          { consumes: ['plan', 'review'],    optionalConsumes: ['review'],  produces: ['code'], connectsTo: ['reviewer', 'manualTestsChecklist'] },
  reviewer:             { consumes: ['plan', 'code'],      produces: ['review'],          connectsTo: ['implementer', 'manualTestsChecklist'] },
  manualTestsChecklist: { consumes: ['plan', 'code'],      produces: ['checklist'],       connectsTo: ['manualWebUiTesting'] },
  manualWebUiTesting:   { consumes: ['checklist', 'code'], produces: ['review'],          connectsTo: ['implementer'] },
  planReviewer:         { consumes: ['plan'],              produces: ['review'],          connectsTo: ['planner', 'implementer', 'decomposer'] },
  // Workspace agents (scope:'workspace-only', §6.2). The scanner is off-pipeline
  // (connectsTo:[] -> non-composable); the reviewer slots into the code->review->
  // implementer loop exactly like `reviewer`.
  workspaceScanner:     { consumes: ['userPrompt'],        produces: ['workspace'],       connectsTo: [] },
  workspaceReviewer:    { consumes: ['plan', 'code'],      produces: ['review'],          connectsTo: ['implementer'] },
};

/** Channel ids: built-ins or any well-formed CUSTOM id (open vocabulary, m1-v2).
 *  Only a malformed id is warned on and dropped — a typo of a built-in becomes a
 *  custom channel. Consumed ids are surfaced by the validator's reachability
 *  warning; a typo'd pre-seeded id in `produces` has no warning net — the
 *  artifact simply lands on the typo'd channel. */
const CUSTOM_CHANNEL_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Legacy short labels for the original four roles, so the derived AGENT_STEPS is
 * byte-identical to the hardcoded one the UI/orchestrator have always used. New
 * agents fall back to their `displayName`.
 */
const LEGACY_LABELS = {
  planner: 'Plan',
  refiner: 'Refine',
  implementer: 'Implement',
  reviewer: 'Review',
};

const CHANNEL_DEF_KINDS = new Set(['md', 'json']);

/** Normalize a sidecar's channelDefs: well-formed custom ids only, kind md|json
 *  (default md), filename a plain basename (default <id>.<ext>); built-in channel
 *  ids cannot be redefined. */
function normalizeChannelDefs(raw, key) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const id = typeof d.id === 'string' ? d.id.trim() : '';
    if (!CUSTOM_CHANNEL_ID_RE.test(id)) {
      if (id) console.warn(`[agent-registry] ${key}.channelDefs: bad channel id "${id}" ignored`);
      continue;
    }
    if (CHANNEL_IDS.has(id)) {
      console.warn(`[agent-registry] ${key}.channelDefs: "${id}" is a built-in channel and cannot be redefined`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const kind = CHANNEL_DEF_KINDS.has(d.kind) ? d.kind : 'md';
    const fnRaw = typeof d.filename === 'string' ? d.filename.trim() : '';
    // basename only: a def must never escape the pipeline dir
    const pathSafe = fnRaw && !/[\\/]/.test(fnRaw) && !fnRaw.includes('..');
    if (fnRaw && !pathSafe) {
      console.warn(`[agent-registry] ${key}.channelDefs: filename "${fnRaw}" is not a plain basename; using "${id}.${kind}"`);
    }
    const filename = pathSafe ? fnRaw : `${id}.${kind}`;
    out.push({ id, kind, filename });
  }
  return out;
}

/**
 * Registry-level channel definition collection: merge every agent's channelDefs
 * into { [channelId]: {id, kind, filename} }. Registry order (sorted by .order)
 * makes "first definition wins" deterministic; conflicts warn.
 * @param {Record<string, object>} registry
 */
export function collectChannelDefs(registry) {
  const defs = {};
  for (const m of Object.values(registry || {})) {
    for (const d of m.channelDefs || []) {
      if (Object.hasOwn(defs, d.id)) {
        if (defs[d.id].kind !== d.kind || defs[d.id].filename !== d.filename) {
          console.warn(`[agent-registry] channel "${d.id}" redefined by "${m.key}"; first definition wins`);
        }
        continue;
      }
      defs[d.id] = { ...d };
    }
  }
  return defs;
}

/**
 * Ordered unique domain list for UI section headers. Registry is already sorted
 * by .order (loadAgentRegistry sorts at line 260), so first-seen order is stable.
 * 'general' is pinned LAST (fail-safe bucket renders last); 'shared' is EXCLUDED —
 * it is injected into every section, never a header of its own. 'general' is always
 * present so the fail-safe bucket is reachable.
 * @param {Record<string, object>} registry
 */
export function collectDomains(registry) {
  const seen = [];
  for (const meta of Object.values(registry || {})) {
    const d = meta && meta.domain;
    if (!d || d === 'shared' || d === 'general' || seen.includes(d)) continue;
    seen.push(d);
  }
  seen.push('general');   // always present, always last
  return seen;
}

/** Agent keys become filename stems (review basenames, config keys); keep them
 *  identifier-shaped so a key can never escape a directory. */
const AGENT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

// ── Sidecar meta v2 (spec §5 + Amendments d/f) ───────────────────────────────
// A v2 sidecar declares TYPED PORTS plus capability flags, so the engine can be
// driven entirely by data: nothing downstream keys behaviour on an agent key.

/** Port ids: lowercase-initial identifier, ≤32 chars, unique per side. */
const PORT_ID_RE = /^[a-z][A-Za-z0-9_-]{0,31}$/;
/** ⟨f⟩ Every agent node gets one engine-synthesized, type-agnostic gate input
 *  named `await`, so the id is RESERVED on BOTH sides and no sidecar may
 *  declare it. Synthesis lives in the graph ports layer — never here. */
const RESERVED_PORT_ID = 'await';
/** Closed type set: `any` exists only on synthesized/engine ports, never in meta. */
const PORT_TYPES = new Set(['md', 'json', 'void']);
/** ⟨d⟩ Per-input renderer for the generated "## Ports (this run)" prompt block. */
const INPUT_AS = new Set(['file', 'answers', 'fix-review', 'worktree']);
/** The port type each non-default `as` renderer requires. `file` is the default
 *  renderer and is materialized on NON-VOID inputs only (a void input carries no
 *  payload to render), which makes `worktree` the only `as` a void input takes. */
const AS_REQUIRES_TYPE = { answers: 'json', 'fix-review': 'md', worktree: 'void' };
const OUTPUT_WHEN = new Set(['always', 'blocking', 'clean']);
const OUTPUT_STORES = new Set(['run', 'project']);
const WORKSPACE_STRATEGIES = new Set(['explore', 'task', 'review']);
/** The only tokens an output filename template may interpolate. */
const FILENAME_TOKENS = new Set(['cycle', 'vsuffix', 'base']);
const MAX_PORTS_PER_SIDE = 8;
/** `order` is UI-sort only in v2, so it is optional and lands agents last. */
const DEFAULT_ORDER = 999;

/** `verdict: { filename }` or null when absent/malformed (the caller reports). */
function readVerdict(raw, err) {
  if (raw === undefined) return null;
  const filename = raw && typeof raw === 'object' && typeof raw.filename === 'string' ? raw.filename.trim() : '';
  if (!filename) { err('verdict must be an object with a filename'); return null; }
  if (/[\\/]/.test(filename) || filename.includes('..')) { err(`verdict filename "${filename}" must be a plain basename`); return null; }
  return { filename };
}

/** Shared per-port head: id (validated, unique, non-reserved) + closed type. */
function readPortHead(raw, side, seen, err) {
  if (!raw || typeof raw !== 'object') { err(`${side}: each port must be an object`); return null; }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (id === RESERVED_PORT_ID) {
    err(`${side}: port id "${RESERVED_PORT_ID}" is reserved — the engine synthesizes the await gate port on every agent node`);
    return null;
  }
  if (!PORT_ID_RE.test(id)) { err(`${side}: bad port id "${id}"`); return null; }
  if (seen.has(id)) { err(`${side}: duplicate port id "${id}"`); return null; }
  seen.add(id);
  if (!PORT_TYPES.has(raw.type)) { err(`${side}.${id}: type must be one of ${[...PORT_TYPES].join(', ')}`); return null; }
  const port = { id, type: raw.type };
  if (typeof raw.label === 'string' && raw.label.trim()) port.label = raw.label.trim();
  if (typeof raw.description === 'string' && raw.description.trim()) port.description = raw.description.trim();
  if (raw.type === 'void' && (raw.filename !== undefined || raw.store !== undefined)) {
    err(`${side}.${id}: void ports carry no filename or store`);
  }
  return port;
}

/** Normalize + validate the input side, materializing `required` and (non-void
 *  only) the `as` renderer. */
function readInputs(raw, err, warn) {
  if (!Array.isArray(raw)) { err('inputs must be an array'); return []; }
  if (raw.length > MAX_PORTS_PER_SIDE) err(`inputs: at most ${MAX_PORTS_PER_SIDE} ports per side (got ${raw.length})`);
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const port = readPortHead(p, 'inputs', seen, err);
    if (!port) continue;
    // A loop receiver is excused from the first-execution barrier, so `loop` and
    // `required` can never both hold. The pair is coerced rather than rejected
    // (§5), but it is authoring intent quietly overruled — hence the warning.
    const loop = !!p.loop;
    let required = p.required === undefined ? true : !!p.required;
    if (loop && required) {
      warn(`[agent-registry] inputs.${port.id}: loop:true forces required:false (a loop receiver is never a barrier)`);
      required = false;
    }
    port.required = required;
    if (loop) port.loop = true;
    if (p.expands) {
      if (port.type !== 'json') err(`inputs.${port.id}: expands is only legal on json inputs`);
      else port.expands = true;
    }
    if (p.as !== undefined) {
      const need = Object.hasOwn(AS_REQUIRES_TYPE, p.as) ? AS_REQUIRES_TYPE[p.as] : null;
      if (!INPUT_AS.has(p.as)) err(`inputs.${port.id}: as must be one of ${[...INPUT_AS].join(', ')}`);
      else if (need ? port.type !== need : port.type === 'void') {
        err(`inputs.${port.id}: as "${p.as}" requires a ${need || 'non-void'} port (got ${port.type})`);
      } else port.as = p.as;
    } else if (port.type !== 'void') {
      port.as = 'file';
    }
    if (typeof p.directive === 'string' && p.directive.trim()) port.directive = p.directive;
    out.push(port);
  }
  return out;
}

/** Normalize + validate the output side, materializing `when` and (non-void
 *  only) `store` + `artifactKind`. */
function readOutputs(raw, hasVerdict, err) {
  if (!Array.isArray(raw)) { err('outputs must be an array'); return []; }
  if (raw.length === 0) err('at least one output port is required');
  if (raw.length > MAX_PORTS_PER_SIDE) err(`outputs: at most ${MAX_PORTS_PER_SIDE} ports per side (got ${raw.length})`);
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const port = readPortHead(p, 'outputs', seen, err);
    if (!port) continue;
    const when = p.when === undefined ? 'always' : p.when;
    if (!OUTPUT_WHEN.has(when)) err(`outputs.${port.id}: when must be one of ${[...OUTPUT_WHEN].join(', ')}`);
    else {
      // A conditional route needs a verdict to branch on (§2).
      if (when !== 'always' && !hasVerdict) {
        err(`outputs.${port.id}: when "${when}" requires the agent to declare verdict: { filename }`);
      }
      port.when = when;
    }
    if (port.type !== 'void') {
      const filename = typeof p.filename === 'string' ? p.filename.trim() : '';
      const tokens = [...filename.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((t) => !FILENAME_TOKENS.has(t));
      if (!filename) err(`outputs.${port.id}: ${port.type} outputs require a filename template`);
      else if (/[\\/]/.test(filename) || filename.includes('..')) err(`outputs.${port.id}: filename "${filename}" must be a plain basename`);
      else if (tokens.length) err(`outputs.${port.id}: filename "${filename}" uses unknown token(s) ${tokens.map((t) => `{${t}}`).join(', ')}`);
      else port.filename = filename;
      const store = p.store === undefined ? 'run' : p.store;
      if (!OUTPUT_STORES.has(store)) err(`outputs.${port.id}: store must be one of ${[...OUTPUT_STORES].join(', ')}`);
      else port.store = store;
      port.artifactKind = typeof p.artifactKind === 'string' && p.artifactKind.trim() ? p.artifactKind.trim() : port.id;
    }
    out.push(port);
  }
  return out;
}

/**
 * Derived one-liner for the palette and the generic system-prompt fallback.
 * Spec §5 words it as the NON-VOID ids per side; a side whose ports are all void
 * (the implementer's `done`) falls back to its declared ids so the sentence
 * never degenerates to "produces .".
 */
function derivePortSummary(inputs, outputs) {
  const ids = (ports) => {
    const nonVoid = ports.filter((p) => p.type !== 'void');
    return (nonVoid.length ? nonVoid : ports).map((p) => p.id);
  };
  const reads = ids(inputs);
  const writes = ids(outputs);
  if (!writes.length) return reads.length ? `Reads ${reads.join(', ')}.` : '';
  if (!reads.length) return `Produces ${writes.join(', ')}.`;
  return `Reads ${reads.join(', ')}; produces ${writes.join(', ')}.`;
}

// ── v1-compat shim (TEMPORARY) ───────────────────────────────────────────────
// The live v1 engine still binds artifacts by CHANNEL NAME (workflows.mjs,
// channels.mjs, workflow-validator.mjs, orchestrator.mjs), so a v2 entry also
// carries the derived v1 view. The port-id -> channel tables below are the one
// sanctioned piece of key-mapped code outside data files; they die with the
// shim (and with DEFAULT_SPEC) when the engine swaps over.

const V1_INPUT_CHANNEL = {
  answers: 'clarify', fix: 'review', revise: 'review', review: 'review',
  done: 'code', checklist: 'checklist', plan: 'plan', workspace: 'workspace',
};
const V1_OUTPUT_CHANNEL = {
  ...V1_INPUT_CHANNEL,
  // The refiner's `revise` output writes the PLAN file (artifactKind 'plan'), so
  // on the output side it is the plan channel — which is also what makes the
  // refiner's two outputs dedupe to a single `produces: ['plan']`.
  revise: 'plan',
  // The decomposer's `tasks` output is v1's `decomposition` channel.
  tasks: 'decomposition',
};

/** v1 channel for one port, or null when the port has no channel at all. An
 *  unmapped NON-void port keeps its own id (v1's channel vocabulary is open, so
 *  custom ports stay custom channels); an unmapped void port carries no payload
 *  and is dropped. */
function v1Channel(port, table) {
  if (port.id === 'task') return port.type === 'json' ? 'decomposition' : 'userPrompt';
  if (Object.hasOwn(table, port.id)) return table[port.id];
  return port.type === 'void' ? null : port.id;
}

/** The v1 stepper phase per built-in key (mirrors workflows.mjs's CONV-4 map).
 *  A custom agent has no v1 phase and falls back to its key downstream. */
const V1_UI_PHASE = {
  clarify: 'clarify', planner: 'plan', refiner: 'refine', decomposer: 'decompose',
  implementer: 'implement', reviewer: 'review', planReviewer: 'plan-review',
  manualTestsChecklist: 'manual-checklist', manualWebUiTesting: 'manual-web',
  workspaceReviewer: 'review',   // shares the single-project review stepper bucket
};

/** Derive the v1 channel view (consumes/optionalConsumes/produces/connectsTo/
 *  channelDefs/uiPhase) the running engine reads, from the v2 ports. */
function v1CompatShim(meta) {
  const consumes = [];
  const optionalConsumes = [];
  for (const p of meta.inputs) {
    const ch = v1Channel(p, V1_INPUT_CHANNEL);
    if (!ch) continue;
    const bucket = p.required && p.type !== 'void' ? consumes : optionalConsumes;
    if (!bucket.includes(ch)) bucket.push(ch);
  }
  const produces = [];
  for (const p of meta.outputs) {
    if (p.type === 'void') continue;               // void outputs are pure signals
    const ch = v1Channel(p, V1_OUTPUT_CHANNEL);
    if (ch && !produces.includes(ch)) produces.push(ch);
  }
  // v1 modelled the staged worktree as the `code` channel; v2 models it as the
  // agent-level sideEffect, so the shim maps it back (implementer -> ['code']).
  if (meta.sideEffect === 'code' && !produces.includes('code')) produces.push('code');
  // Only CUSTOM channels need a definition; built-ins already have one, and
  // deriving is not authoring, so they are filtered before the (warning) check.
  const defs = meta.outputs
    .filter((p) => p.type !== 'void')
    .map((p) => ({ id: v1Channel(p, V1_OUTPUT_CHANNEL), kind: p.type, filename: p.filename }))
    .filter((d) => d.id && !CHANNEL_IDS.has(d.id));
  return {
    consumes,
    optionalConsumes,
    produces,
    connectsTo: '*',
    channelDefs: normalizeChannelDefs(defs, meta.key),
    uiPhase: Object.hasOwn(V1_UI_PHASE, meta.key) ? V1_UI_PHASE[meta.key] : null,
  };
}

/**
 * Read one parsed sidecar into `{errors, meta}`. `meta` is only meaningful when
 * `errors` is empty. `warn` receives the non-fatal coercions (a `loop` input
 * forced optional, an unknown mockRole dropped) so the pure validator can stay
 * silent while the registry loader stays loud.
 */
function readMetaV2(raw, warn) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!raw || typeof raw !== 'object') return { errors: ['meta must be an object'], meta: null };

  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) err('key is required');
  else if (!AGENT_KEY_RE.test(key)) err(`key "${key}" is not a valid agent key`);
  if (raw.metaVersion !== 2) err('sidecar requires metaVersion 2');
  if (!RUNNER_TYPES.has(raw.runnerType)) err(`runnerType must be one of ${[...RUNNER_TYPES].join(', ')}`);
  const runnerType = RUNNER_TYPES.has(raw.runnerType) ? raw.runnerType : 'producer';

  const order = raw.order === undefined ? DEFAULT_ORDER : Number(raw.order);
  if (!Number.isFinite(order)) err('order must be a number');

  const verdict = readVerdict(raw.verdict, err);
  if (runnerType === 'verifier' && !verdict) err('runnerType "verifier" requires verdict: { filename }');

  const inputs = readInputs(raw.inputs, err, warn);
  const outputs = readOutputs(raw.outputs, !!verdict, err);
  if (runnerType === 'clarifier' && !outputs.some((p) => p.type === 'json')) {
    err('runnerType "clarifier" requires at least one json output port');
  }
  // Two outputs may share one filename template only with identical type (the
  // refiner's clean/blocking plan arms); allocation then yields one path.
  const typeByTemplate = new Map();
  for (const p of outputs) {
    if (!p.filename) continue;
    const prev = typeByTemplate.get(p.filename);
    if (prev === undefined) typeByTemplate.set(p.filename, p.type);
    else if (prev !== p.type) err(`outputs: filename template "${p.filename}" is shared by ports of different types`);
  }

  // §6.6 scope coercion (fail-safe, mirrors color): anything but the explicit
  // 'workspace-only' marker is a normal 'project'-scope agent, so a typo fails
  // safe to a VISIBLE project agent rather than a silently-hidden one.
  const scope = raw.scope === 'workspace-only' ? 'workspace-only' : 'project';
  if (raw.sideEffect !== undefined && raw.sideEffect !== 'code') err('sideEffect must be "code" when present');
  if (raw.workspaceStrategy !== undefined && !WORKSPACE_STRATEGIES.has(raw.workspaceStrategy)) {
    err(`workspaceStrategy must be one of ${[...WORKSPACE_STRATEGIES].join(', ')}`);
  }
  let workspaceVariantOf = null;
  if (raw.workspaceVariantOf !== undefined) {
    const target = typeof raw.workspaceVariantOf === 'string' ? raw.workspaceVariantOf.trim() : '';
    if (!AGENT_KEY_RE.test(target)) err('workspaceVariantOf must be an agent key');
    else if (target === key) err('workspaceVariantOf must not reference the agent itself');
    else if (scope !== 'workspace-only') err('workspaceVariantOf requires scope "workspace-only"');
    else workspaceVariantOf = target;
  }
  // ⟨d⟩ An unknown mockRole is a WARNING, never a 400: the field is dropped and
  // the generic mock-role fallback chain applies.
  let mockRole = null;
  if (raw.mockRole !== undefined) {
    const role = typeof raw.mockRole === 'string' ? raw.mockRole.trim() : '';
    if (MOCK_WRITER_ROLES.has(role)) mockRole = role;
    else warn(`[agent-registry] ${key || '<unkeyed>'}.mockRole: unknown mock role "${role}"; ignored (the generic mock chain applies)`);
  }

  // Per-agent user questions (spec 2026-07-11): capability + lock + default.
  // Coherence is forced HERE (single source of truth): an agent that cannot ask
  // can be neither locked nor default-on, so UI/agent-gen never validate this.
  const asksQuestions = !!raw.asksQuestions;
  const meta = {
    metaVersion: 2,
    key,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName.trim()
      : key,
    description: typeof raw.description === 'string' ? raw.description : '',
    color: COLORS.has(raw.color) ? raw.color : 'amber',
    icon: typeof raw.icon === 'string' ? raw.icon : '',
    agentFile: typeof raw.agentFile === 'string' && raw.agentFile.trim() ? raw.agentFile.trim() : null,
    runnerType,
    scope,
    domain: normalizeDomain(raw.domain),   // always set; fail-safe VISIBLE default 'general'
    fanOut: !!raw.fanOut,
    asksQuestions,
    questionsLocked: asksQuestions && !!raw.questionsLocked,
    questionsDefault: asksQuestions && !!raw.questionsDefault,
    order: Number.isFinite(order) ? order : DEFAULT_ORDER,
    promptHints: typeof raw.promptHints === 'string' ? raw.promptHints : '',
    requiresSkills: Array.isArray(raw.requiresSkills)
      ? raw.requiresSkills.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
      : [],
    inputs,
    outputs,
    portSummary: derivePortSummary(inputs, outputs),
  };
  // ⟨d⟩ Capability defaults are applied at READ time, never written into the
  // entry: an absent field means "the default", so a v2 entry stays diffable
  // against the sidecar that produced it.
  if (verdict) meta.verdict = verdict;
  if (raw.sideEffect === 'code') meta.sideEffect = 'code';
  if (mockRole) meta.mockRole = mockRole;
  if (raw.wantsRequest) meta.wantsRequest = true;
  if (raw.workspaceFanOut) meta.workspaceFanOut = true;
  if (WORKSPACE_STRATEGIES.has(raw.workspaceStrategy)) meta.workspaceStrategy = raw.workspaceStrategy;
  if (workspaceVariantOf) meta.workspaceVariantOf = workspaceVariantOf;
  if (raw.placeable !== undefined && !raw.placeable) meta.placeable = false;
  Object.assign(meta, v1CompatShim(meta));
  return { errors, meta };
}

/**
 * Pure meta v2 validation for the agent-store save path: every broken rule as a
 * human-readable line, so a 400 can name exactly what to fix. Silent by design —
 * the load path is what warns.
 * @param {object} meta parsed sidecar
 * @returns {{errors: string[]}}
 */
export function validateMetaV2(meta) {
  return { errors: readMetaV2(meta, () => {}).errors };
}

/**
 * Coerce one parsed sidecar into a normalized AgentMeta, or null if unusable.
 * A v1 sidecar (no `metaVersion: 2`) is SKIPPED with a loud, actionable warning
 * rather than half-loaded — the registry never bricks, and the fix is named.
 */
export function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = raw && typeof raw.key === 'string' && raw.key.trim() ? raw.key.trim() : '<unkeyed>';
  if (raw.metaVersion !== 2) {
    console.warn(
      `[agent-registry] sidecar "${label}" requires metaVersion 2 and was skipped; ` +
      'port it to the v2 port schema (inputs/outputs) — v1 channel fields are no longer read',
    );
    return null;
  }
  const { errors, meta } = readMetaV2(raw, console.warn);
  if (errors.length) {
    console.warn(`[agent-registry] sidecar "${label}" is not valid meta v2 and was skipped: ${errors.join('; ')}`);
    return null;
  }
  return meta;
}

/**
 * Directory of USER agents: <worcaHome()>/agents (~/.worca-cc/agents). Resolved
 * fresh on every call (mirrors worcaHome's read-fresh contract). Returns null
 * when the home cannot be resolved (e.g. under the node:test runner with no
 * WORCA_HOME — projects.mjs throws there to protect the real store), so module
 * import and registry loads never throw.
 */
export function userAgentsDir() {
  try { return join(worcaHome(), 'agents'); } catch { return null; }
}

/**
 * Third registry layer (spec §9.1): every ENABLED installed plugin's
 * current/agents dir, in lexicographic plugin-name order — the deterministic
 * collision winner among plugins. An entry is skipped when disabled
 * (enabled === false in the lock) or broken (existsSync follows the current/
 * symlink, so a missing or dangling symlink — and a version dir without
 * agents/ — drops out). Wrapped in try/catch like userAgentsDir(): with no
 * resolvable worca-cc home (bare node:test runner) or an unreadable lock this
 * returns [] and registry loads never throw.
 * @returns {Array<{plugin: string, dir: string}>}
 */
export function pluginAgentLayers() {
  try {
    const lock = readPluginsLock();
    return Object.keys(lock)
      .sort()
      .filter((name) => lock[name] && lock[name].enabled !== false)
      .map((name) => ({ plugin: name, dir: join(pluginCurrentDir(name), 'agents') }))
      .filter(({ dir }) => existsSync(dir));
  } catch {
    return []; // no home / unreadable lock => no plugin layer (fails safe)
  }
}

/**
 * Fallback palette blurb: the agent .md's YAML frontmatter `description:` line,
 * stored VERBATIM (clarify 2026-08-09: the UI clamps, the bubble wants the full
 * text — never truncate here). Single-line values only (plain or quoted);
 * folded/multi-line scalars are out of scope by design (spec 2026-08-09; every
 * shipped .md uses a single-line scalar) and degrade to '' — the block-scalar
 * indicator is detected, never stored. Any parse failure returns '' so
 * scanLayer never throws because of the fallback.
 * @param {string} text the agent .md body (already read by scanLayer)
 */
function frontmatterDescription(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return '';
  const line = fm[1].match(/^description:[ \t]*(.+)$/m);
  if (!line) return '';
  let v = line[1].trim();
  // Folded/literal block scalars ('>', '>-', '|', '|+', …): the captured value
  // is just the indicator, not the text — degrade to '' rather than store junk.
  if (/^[>|][+-]?$/.test(v)) return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

/** Scan one layer dir for *.meta.json; stamps the COMPUTED origin/agentPath/
 *  descriptionDerived fields (none of which normalizeMeta returns, so none can
 *  be persisted back into a sidecar). */
function scanLayer(dir, origin) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return []; // missing layer dir => empty layer (fails safe)
  }
  const metas = [];
  for (const f of files) {
    if (!f.endsWith('.meta.json')) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue; // skip unreadable / malformed sidecars
    }
    const meta = normalizeMeta(parsed);
    if (!meta) continue;
    meta.origin = origin;                                              // computed, never stored
    meta.agentPath = meta.agentFile ? join(dir, meta.agentFile) : null; // layer-correct abs path
    // ⟨d⟩ The per-role prompt fallbacks die with the v1 engine, so a sidecar that
    // NAMES an agentFile whose body is missing or blank has no prompt to run and
    // is skipped rather than loaded half-alive. A sidecar with no agentFile at
    // all stays legal — those are palette-only entries with nothing to read.
    let body = '';
    if (meta.agentPath) {
      try { body = readFileSync(meta.agentPath, 'utf8'); } catch { body = ''; }
      if (!body.trim()) {
        console.warn(`[agent-registry] agent "${meta.key}": agentFile "${meta.agentFile}" is missing or empty; skipped`);
        continue;
      }
    }
    // Description fallback (spec 2026-08-09): empty sidecar description →
    // the .md frontmatter description.
    // descriptionDerived marks the RESOLVED description as computed too: unlike
    // origin/agentPath, `description` has a slot in normalizeMeta, so without
    // this flag every write path would bake the fallback into the sidecar and
    // the blurb would stop tracking the .md (and could never be cleared).
    if (!meta.description && body) {
      meta.description = frontmatterDescription(body);
      if (meta.description) meta.descriptionDerived = true;             // computed, never stored
    }
    metas.push(meta);
  }
  return metas;
}

/**
 * Scan the built-in layer (`agentsDir`) AND the user layer (~/.worca-cc/agents) and
 * build the merged registry. Built-ins are IMMUTABLE: a user sidecar whose key
 * collides with a built-in is skipped with a warning. Re-scans both layers on
 * every call (no module-level cache), so the registry is always reloadable.
 * @param {string} [agentsDir]   built-in layer (repo agents/)
 * @param {{userAgentsDir?: string|null}} [opts]  user layer override; null disables
 * @returns {Record<string, object>} agent key -> AgentMeta, sorted by `.order`
 */
export function loadAgentRegistry(agentsDir = DEFAULT_AGENTS_DIR, opts = {}) {
  const builtins = scanLayer(agentsDir, 'builtin');
  const builtinKeys = new Set(builtins.map((m) => m.key));
  const userDir = opts.userAgentsDir === undefined ? userAgentsDir() : opts.userAgentsDir;
  const users = [];
  if (userDir) {
    for (const m of scanLayer(userDir, 'user')) {
      if (builtinKeys.has(m.key)) {
        console.warn(
          `[agent-registry] user agent "${m.key}" shadows a built-in and was skipped (built-ins are immutable)`,
        );
        continue;
      }
      users.push(m);
    }
  }
  // Plugin layer (spec §9.1): builtin > user > plugin; among plugins the
  // lexicographic name order of pluginAgentLayers() decides. Same skip-on-
  // collision + warning contract as the user layer above. scanLayer stamps the
  // COMPUTED origin ('plugin:<name>') and agentPath (through current/, so a
  // version swap retargets every path atomically). opts.includePlugins=false is
  // the escape hatch for callers that must not see plugins (default true).
  // Zero plugins installed => pluginAgentLayers() === [] => byte-identical merge.
  const plugins = [];
  if (opts.includePlugins !== false) {
    const taken = new Set([...builtinKeys, ...users.map((m) => m.key)]);
    for (const { plugin, dir } of pluginAgentLayers()) {
      for (const m of scanLayer(dir, `plugin:${plugin}`)) {
        if (taken.has(m.key)) {
          console.warn(
            `[agent-registry] plugin agent "${m.key}" (plugin "${plugin}") collides with an existing agent and was skipped`,
          );
          continue;
        }
        taken.add(m.key);
        plugins.push(m);
      }
    }
  }
  const metas = [...builtins, ...users, ...plugins].sort((a, b) => a.order - b.order); // stable sort
  const registry = {};
  for (const m of metas) registry[m.key] = m;
  return registry;
}

/**
 * Derive the legacy `[{key,label}]` step list from a registry (replacement source
 * for the hardcoded AGENT_STEPS). The original four roles keep their short legacy
 * labels; any additional agent uses its `displayName`.
 *
 * §6.6/C9: `scope:'workspace-only'` agents are EXCLUDED — they are not part of the
 * single-project UI stepper / per-step config keyspace that AGENT_STEPS drives, so
 * this returns the 9 built-in project-scope steps plus any user-layer project
 * agents (without the exclusion the two workspace sidecars would add 2 more).
 * @param {Record<string, object>} registry
 * @returns {Array<{key:string,label:string,fanOut:boolean,asksQuestions:boolean,questionsLocked:boolean,questionsDefault:boolean}>}
 */
export function registryToSteps(registry) {
  return Object.values(registry || {})
    .filter((m) => m.scope !== 'workspace-only')
    .sort((a, b) => a.order - b.order)
    .map((m) => ({
      key: m.key,
      label: LEGACY_LABELS[m.key] || m.displayName,
      fanOut: !!m.fanOut,
      asksQuestions: !!m.asksQuestions,
      questionsLocked: !!m.questionsLocked,
      questionsDefault: !!m.questionsDefault,
    }));
}
