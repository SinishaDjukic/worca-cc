// src/shared/graph/agent-meta.mjs
// Agent metadata v2: ONE normalizer + validator for the registry loader (skip +
// warn), the agent store (hard 400), the Agents-view port editor (live hints)
// and agent-gen's read-back check. Pure — shared code cannot import
// claude-runner.mjs, so the mock-role vocabulary is INJECTED.
import { PORT_TYPES, MAX_PORTS_PER_SIDE, PORT_ID_RE } from './constants.mjs';

const AGENT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
// PORT_ID_RE is P1's, NOT a local copy: spec §3 puts it in constants.mjs
// precisely so the store's 400, P1's seed guard and the composer's editor hint
// can never disagree. It is the STRICT lowerCamel form `/^[a-z][A-Za-z0-9]{0,31}$/`
// — no `_`, no `-` (see the Q&A; `in_1` and `in-1` are INVALID port ids).
/** The engine synthesizes a type-agnostic `await` gate on every agent node, so
 *  the id is RESERVED on BOTH sides and no sidecar may declare it. */
const RESERVED_PORT_ID = 'await';
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/;
const COLORS = new Set(['green', 'peach', 'red', 'blue', 'violet', 'amber']);
const RUNNER_TYPES = new Set(['producer', 'verifier', 'clarifier']);
const INPUT_AS = new Set(['file', 'answers', 'fix-review', 'worktree']);
/** The port type each non-default `as` renderer requires. `file` is the default
 *  and is materialized on NON-VOID inputs only, which makes `worktree` the only
 *  `as` a void input takes. */
const AS_REQUIRES_TYPE = { answers: 'json', 'fix-review': 'md', worktree: 'void' };
const OUTPUT_WHEN = new Set(['always', 'blocking', 'clean']);
const OUTPUT_STORES = new Set(['run', 'project']);
const WORKSPACE_STRATEGIES = new Set(['explore', 'task', 'review']);
const FILENAME_TOKENS = new Set(['cycle', 'vsuffix', 'base']);
/** Sort key a sidecar that omits `order` gets. Exported so the registry loader
 *  (agent-registry.mjs normalizeMeta) backfills the SAME value this normalizer
 *  does — a sidecar validateMetaV2 certifies must never vanish from the registry. */
export const DEFAULT_ORDER = 999;
const TYPES = [...PORT_TYPES].filter((t) => t !== 'any');   // `any` is engine-only, never declarable

/** `{key: meta}` from a registry LIST (the /api/agents payload shape). */
export function indexByKey(list) {
  const out = {};
  for (const m of Array.isArray(list) ? list : []) {
    if (m && typeof m === 'object' && typeof m.key === 'string' && m.key) out[m.key] = m;
  }
  return out;
}

/** The palette one-liner and the generic system-prompt fallback: the NON-VOID
 *  ids per side; an all-void side falls back to its declared ids so the sentence
 *  never degenerates to "produces .". */
export function derivePortSummary(meta) {
  const ids = (ports) => {
    const list = Array.isArray(ports) ? ports.filter(Boolean) : [];
    const nonVoid = list.filter((p) => p.type !== 'void');
    return (nonVoid.length ? nonVoid : list).map((p) => p.id);
  };
  const reads = ids(meta?.inputs);
  const writes = ids(meta?.outputs);
  if (!writes.length) return reads.length ? `Reads ${reads.join(', ')}.` : '';
  if (!reads.length) return `Produces ${writes.join(', ')}.`;
  return `Reads ${reads.join(', ')}; produces ${writes.join(', ')}.`;
}

/** Pure validation for the store's 400 path. Silent by design — the load path warns. */
export function validateMetaV2(raw, opts = {}) {
  return { errors: normalizeAgentMeta(raw, { ...opts, warn: () => {} }).errors };
}

/**
 * @param {object} raw parsed sidecar
 * @param {{mockWriterRoles?:Set<string>, warn?:(msg:string)=>void}} [opts]
 * @returns {{meta:object|null, errors:string[]}} meta is meaningful only when errors is empty
 */
export function normalizeAgentMeta(raw, opts = {}) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  const warn = typeof opts.warn === 'function' ? opts.warn : () => {};
  if (!raw || typeof raw !== 'object') return { errors: ['meta must be an object'], meta: null };

  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) err('key is required');
  else if (!AGENT_KEY_RE.test(key)) err(`key "${key}" is not a valid agent key`);
  if (raw.metaVersion !== 2) err('sidecar requires metaVersion 2');
  if (!RUNNER_TYPES.has(raw.runnerType)) err(`runnerType must be one of ${[...RUNNER_TYPES].join(', ')}`);
  const runnerType = RUNNER_TYPES.has(raw.runnerType) ? raw.runnerType : 'producer';

  const order = raw.order === undefined ? DEFAULT_ORDER : Number(raw.order);
  if (!Number.isFinite(order)) err('order must be a number');

  // agentFile is a PATH: the registry joins it onto the layer's agents dir and
  // reads it as the agent's system prompt AND for its `tools:` frontmatter, so
  // it takes the SAME basename rule as verdict.filename / outputs[].filename.
  // A non-<key>.md basename stays legal — every built-in uses worca-cc-<role>.md.
  const agentFile = typeof raw.agentFile === 'string' && raw.agentFile.trim() ? raw.agentFile.trim() : null;
  if (agentFile && (/[\\/]/.test(agentFile) || agentFile.includes('..'))) {
    err(`agentFile "${agentFile}" must be a plain basename`);
  }

  const verdict = readVerdict(raw.verdict, err);
  if (runnerType === 'verifier' && !verdict) err('runnerType "verifier" requires verdict: { filename }');

  const inputs = readInputs(raw.inputs, err, warn);
  const outputs = readOutputs(raw.outputs, !!verdict, err);
  if (runnerType === 'clarifier' && !outputs.some((p) => p.type === 'json')) {
    err('runnerType "clarifier" requires at least one json output port');
  }
  // Two outputs may share one filename template only with an identical type (the
  // refiner's clean/blocking plan arms); allocation then yields ONE path.
  const typeByTemplate = new Map();
  for (const p of outputs) {
    if (!p.filename) continue;
    const prev = typeByTemplate.get(p.filename);
    if (prev === undefined) typeByTemplate.set(p.filename, p.type);
    else if (prev !== p.type) err(`outputs: filename template "${p.filename}" is shared by ports of different types`);
  }

  // Scope coercion mirrors color: anything but the explicit 'workspace-only'
  // marker is a normal project agent, so a typo fails safe to a VISIBLE agent.
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
  // An unknown mockRole is a WARNING, never a 400: the field is dropped and the
  // generic mock-role fallback chain applies.
  let mockRole = null;
  if (raw.mockRole !== undefined) {
    const role = typeof raw.mockRole === 'string' ? raw.mockRole.trim() : '';
    const vocab = opts.mockWriterRoles instanceof Set ? opts.mockWriterRoles : null;
    if (!vocab || vocab.has(role)) mockRole = role || null;
    else warn(`[agent-registry] ${key || '<unkeyed>'}.mockRole: unknown mock role "${role}"; ignored (the generic mock chain applies)`);
  }

  const asksQuestions = !!raw.asksQuestions;
  const meta = {
    metaVersion: 2,
    key,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : key,
    description: typeof raw.description === 'string' ? raw.description : '',
    color: COLORS.has(raw.color) ? raw.color : 'amber',
    icon: typeof raw.icon === 'string' ? raw.icon : '',
    agentFile,
    runnerType,
    scope,
    domain: typeof raw.domain === 'string' && DOMAIN_RE.test(raw.domain) ? raw.domain : 'general',
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
    portSummary: '',
  };
  meta.portSummary = derivePortSummary(meta);
  // Capability defaults are applied at READ time, never written into the entry:
  // an absent field means "the default", so a v2 entry stays diffable against
  // the sidecar that produced it.
  if (verdict) meta.verdict = verdict;
  if (raw.sideEffect === 'code') meta.sideEffect = 'code';
  if (mockRole) meta.mockRole = mockRole;
  if (raw.wantsRequest) meta.wantsRequest = true;
  if (raw.workspaceFanOut) meta.workspaceFanOut = true;
  if (WORKSPACE_STRATEGIES.has(raw.workspaceStrategy)) meta.workspaceStrategy = raw.workspaceStrategy;
  if (workspaceVariantOf) meta.workspaceVariantOf = workspaceVariantOf;
  if (raw.placeable !== undefined && !raw.placeable) meta.placeable = false;
  return { errors, meta };
}

function readVerdict(raw, err) {
  if (raw === undefined) return null;
  const filename = raw && typeof raw === 'object' && typeof raw.filename === 'string' ? raw.filename.trim() : '';
  if (!filename) { err('verdict must be an object with a filename'); return null; }
  if (/[\\/]/.test(filename) || filename.includes('..')) {
    err(`verdict filename "${filename}" must be a plain basename`);
    return null;
  }
  return { filename };
}

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
  if (!TYPES.includes(raw.type)) { err(`${side}.${id}: type must be one of ${TYPES.join(', ')}`); return null; }
  const port = { id, type: raw.type };
  if (typeof raw.label === 'string' && raw.label.trim()) port.label = raw.label.trim();
  if (typeof raw.description === 'string' && raw.description.trim()) port.description = raw.description.trim();
  if (raw.type === 'void' && (raw.filename !== undefined || raw.store !== undefined)) {
    err(`${side}.${id}: void ports carry no filename or store`);
  }
  return port;
}

function readInputs(raw, err, warn) {
  if (!Array.isArray(raw)) { err('inputs must be an array'); return []; }
  if (raw.length > MAX_PORTS_PER_SIDE) err(`inputs: at most ${MAX_PORTS_PER_SIDE} ports per side (got ${raw.length})`);
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const port = readPortHead(p, 'inputs', seen, err);
    if (!port) continue;
    // A loop receiver is excused from the first-execution barrier, so `loop` and
    // `required` can never both hold. Coerced rather than rejected — but it is
    // authoring intent quietly overruled, hence the warning.
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
    } else if (port.type !== 'void') port.as = 'file';
    if (typeof p.directive === 'string' && p.directive.trim()) port.directive = p.directive;
    out.push(port);
  }
  return out;
}

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
      if (when !== 'always' && !hasVerdict) {
        err(`outputs.${port.id}: when "${when}" requires the agent to declare verdict: { filename }`);
      }
      port.when = when;
    }
    if (port.type !== 'void') {
      const filename = typeof p.filename === 'string' ? p.filename.trim() : '';
      const tokens = [...filename.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((t) => !FILENAME_TOKENS.has(t));
      if (!filename) err(`outputs.${port.id}: ${port.type} outputs require a filename template`);
      else if (/[\\/]/.test(filename) || filename.includes('..')) {
        err(`outputs.${port.id}: filename "${filename}" must be a plain basename`);
      } else if (tokens.length) {
        err(`outputs.${port.id}: filename "${filename}" uses unknown token(s) ${tokens.map((t) => `{${t}}`).join(', ')}`);
      } else port.filename = filename;
      const store = p.store === undefined ? 'run' : p.store;
      if (!OUTPUT_STORES.has(store)) err(`outputs.${port.id}: store must be one of ${[...OUTPUT_STORES].join(', ')}`);
      else port.store = store;
      port.artifactKind = typeof p.artifactKind === 'string' && p.artifactKind.trim() ? p.artifactKind.trim() : port.id;
    }
    out.push(port);
  }
  return out;
}
