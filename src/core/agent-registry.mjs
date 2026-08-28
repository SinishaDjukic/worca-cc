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
import { fileURLToPath } from 'node:url';
import { worcaHome } from './projects.mjs'; // user agent layer root (read fresh per call)
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // plugin layer roots (Task 2)
import { declaredApi, NOT_META_V2 } from './plugin-manifest.mjs'; // plugin API declared by a layer's manifest
import { normalizeAgentMeta } from '../shared/graph/agent-meta.mjs'; // meta v2 (one source: registry + store + UI)
import { MOCK_WRITER_ROLES } from './claude-runner.mjs';             // mockRole vocabulary (no cycle: claude-runner imports no registry)

/**
 * Default location of the agent metadata sidecars, relative to this module.
 * Single source for every module that needs the built-in agents dir
 * (workflows.mjs, orchestrator.mjs). MUST go through fileURLToPath: `new URL(...)
 * .pathname` is a URL path, not a filesystem path — on Windows it yields
 * `/C:/…/agents/` (ENOENT) and on every platform it leaves spaces as `%20`, so
 * the built-in layer silently scanned as EMPTY: /api/agents returned nothing,
 * saved workflows painted "Could not load this workflow", and setStep rejected
 * every model change with `unknown step` (the New Pipeline picker reverted).
 */
export const DEFAULT_AGENTS_DIR = fileURLToPath(new URL('../../agents/', import.meta.url));

const COLORS = new Set(['green', 'peach', 'red', 'blue', 'violet', 'amber']);
const RUNNER_TYPES = new Set(['producer', 'verifier', 'clarifier']);

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
 * Built-in channel/governance spec per agent key. Used when a sidecar omits the
 * fields, so the six shipped agents behave byte-identically to today's _nodeIo
 * switch and every saved pipeline stays connectsTo-legal.
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
function channelList(raw, key, field) {
  if (!Array.isArray(raw)) return undefined;
  const out = [];
  for (const s of raw) {
    const id = String(s || '').trim();
    if (!id) continue;
    if (CUSTOM_CHANNEL_ID_RE.test(id)) out.push(id);
    else console.warn(`[agent-registry] ${key}.${field}: malformed channel id "${id}" ignored`);
  }
  return out;
}

/** Normalize connectsTo: '*' | string[] of agent keys. Anything else => fallback.
 * A raw value of '*' is treated as "unset" so DEFAULT_SPEC can override it. */
function normalizeConnectsTo(raw, fallback) {
  if (Array.isArray(raw)) {
    const out = raw.map((s) => String(s || '').trim()).filter(Boolean);
    return out.length ? out : (fallback ?? '*');
  }
  // raw === '*' or anything else: use the fallback (spec array or '*')
  return fallback ?? '*';
}

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

/** Coerce one parsed sidecar into a normalized AgentMeta, or null if unusable. */
export function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;
  if (!AGENT_KEY_RE.test(key)) {
    console.warn(`[agent-registry] sidecar key "${key}" is not a valid agent key; skipped`);
    return null;
  }
  const order = Number(raw.order);
  if (!Number.isFinite(order)) return null;
  const color = COLORS.has(raw.color) ? raw.color : 'amber';
  const runnerType = RUNNER_TYPES.has(raw.runnerType) ? raw.runnerType : 'producer';
  // §6.6 scope coercion (fail-safe, mirrors color): anything but the explicit
  // 'workspace-only' marker is a normal 'project'-scope agent, so a typo fails
  // safe to a VISIBLE project agent (surfaced by the palette test) rather than a
  // silently-hidden one.
  const scope = raw.scope === 'workspace-only' ? 'workspace-only' : 'project';
  // Per-agent user questions (spec 2026-07-11): capability + lock + default.
  // Coherence is forced HERE (single source of truth): an agent that cannot ask
  // can be neither locked nor default-on, so UI/agent-gen never validate this.
  const asksQuestions = !!raw.asksQuestions;
  const spec = DEFAULT_SPEC[key] || {};
  const rtFallbackConsumes = runnerType === 'verifier' ? ['code'] : ['userPrompt'];
  const consumes = channelList(raw.consumes, key, 'consumes') || spec.consumes || rtFallbackConsumes;
  const produces = channelList(raw.produces, key, 'produces') || spec.produces || (runnerType === 'verifier' ? ['review'] : []);
  const optionalConsumes = channelList(raw.optionalConsumes, key, 'optionalConsumes') || spec.optionalConsumes || [];
  const connectsTo = normalizeConnectsTo(raw.connectsTo, spec.connectsTo || '*');
  const base = {
    key,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName.trim()
      : key,
    description: typeof raw.description === 'string' ? raw.description : '',
    color,
    icon: typeof raw.icon === 'string' ? raw.icon : '',
    agentFile: typeof raw.agentFile === 'string' && raw.agentFile.trim() ? raw.agentFile.trim() : null,
    runnerType,
    scope,
    domain: normalizeDomain(raw.domain),   // always set; fail-safe VISIBLE default 'general'
    loopSource: !!raw.loopSource,
    fanOut: !!raw.fanOut,
    asksQuestions,
    questionsLocked: asksQuestions && !!raw.questionsLocked,
    questionsDefault: asksQuestions && !!raw.questionsDefault,
    consumes,
    optionalConsumes,
    produces,
    connectsTo,
    order,
    // ── schema v2 (all optional; absent => safe defaults; origin/agentPath are
    //    stamped by scanLayer as COMPUTED fields, never read from the sidecar) ──
    uiPhase: typeof raw.uiPhase === 'string' && raw.uiPhase.trim() ? raw.uiPhase.trim() : null,
    promptHints: typeof raw.promptHints === 'string' ? raw.promptHints : '',
    version: typeof raw.version === 'string' || typeof raw.version === 'number' ? String(raw.version) : '1',
    channelDefs: normalizeChannelDefs(raw.channelDefs, key),
    requiresSkills: Array.isArray(raw.requiresSkills)
      ? raw.requiresSkills.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
      : [],
  };
  // ── meta v2 merge (dual shape, P2a..P8) ────────────────────────────────────
  // A v2 sidecar KEEPS every v1 field and GAINS typed ports + capabilities, so
  // both engines read the same file during coexistence. normalizeMeta returns a
  // FIXED key set and agent-store round-trips {...existing, ...raw} through it,
  // so a v2 sidecar that only "passed unknown keys through" would lose its ports
  // on the next save. Invalid v2 => warn and SKIP THE WHOLE SIDECAR: half-loading
  // an agent whose ports are wrong is worse than not loading it.
  if (raw.metaVersion !== 2) return base;
  const { meta, errors } = normalizeAgentMeta(raw, {
    mockWriterRoles: MOCK_WRITER_ROLES,
    warn: (msg) => console.warn(msg),
  });
  if (errors.length) {
    console.warn(`[agent-registry] sidecar "${key}" declares metaVersion 2 but is invalid; skipped: ${errors.join('; ')}`);
    return null;
  }
  const merged = {
    ...base,
    metaVersion: 2,
    inputs: meta.inputs,
    outputs: meta.outputs,
    portSummary: meta.portSummary,
  };
  for (const field of ['verdict', 'sideEffect', 'mockRole', 'wantsRequest', 'workspaceFanOut',
    'workspaceStrategy', 'workspaceVariantOf', 'placeable']) {
    if (field in meta) merged[field] = meta[field];
  }
  return merged;
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
 * @returns {Array<{plugin: string, dir: string, builtFor: number|null}>}
 */
export function pluginAgentLayers() {
  try {
    const lock = readPluginsLock();
    return Object.keys(lock)
      .sort()
      .filter((name) => lock[name] && lock[name].enabled !== false)
      .map((name) => {
        const dir = pluginCurrentDir(name);
        let builtFor = null;
        try {
          const raw = JSON.parse(readFileSync(join(dir, 'worca-cc-plugin.json'), 'utf8'));
          // `|| null`: declaredApi('') is 0 (an unconstrained range accepts
          // everything), and "built for plugin API 0" is not English. apiMismatch
          // guards the same case the same way.
          builtFor = declaredApi(raw?.engines?.['worca-cc-api'] ?? '') || null;
        } catch { builtFor = null; } // unreadable manifest: the message degrades, the skip does not
        return { plugin: name, dir: join(dir, 'agents'), builtFor };
      })
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
 * indicator is detected, never stored. Any read/parse failure returns '' so
 * scanLayer never throws because of the fallback.
 */
function frontmatterDescription(mdPath) {
  let text;
  try { text = readFileSync(mdPath, 'utf8'); } catch { return ''; }
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
function scanLayer(dir, origin, { requireMetaV2 = false, builtFor = null } = {}) {
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
    // API 3 (plugin layers only): a sidecar that is not meta v2 has no typed
    // ports, so it can be neither placed on a canvas nor resolved by the graph
    // engine. Ignore it with a line that names the fix — reusing the SAME
    // clause validate-time prints, so the two can never drift. Builtin/user
    // layers keep the v1 path until the engine cut-over.
    if (requireMetaV2 && Number(parsed?.metaVersion) !== 2) {
      const builtForText = builtFor == null ? 'an older plugin API' : `plugin API ${builtFor}`;
      console.warn(`[agent-registry] ${origin}/${f}: built for ${builtForText} — ${NOT_META_V2} — ignored`);
      continue;
    }
    const meta = normalizeMeta(parsed);
    if (!meta) continue;
    meta.origin = origin;                                              // computed, never stored
    meta.agentPath = meta.agentFile ? join(dir, meta.agentFile) : null; // layer-correct abs path
    // Description fallback (spec 2026-08-09): empty sidecar description →
    // the .md frontmatter description. Only costs a file read when empty.
    // descriptionDerived marks the RESOLVED description as computed too: unlike
    // origin/agentPath, `description` has a slot in normalizeMeta, so without
    // this flag every write path would bake the fallback into the sidecar and
    // the blurb would stop tracking the .md (and could never be cleared).
    if (!meta.description && meta.agentPath) {
      meta.description = frontmatterDescription(meta.agentPath);
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
    for (const { plugin, dir, builtFor } of pluginAgentLayers()) {
      for (const m of scanLayer(dir, `plugin:${plugin}`, { requireMetaV2: true, builtFor })) {
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
