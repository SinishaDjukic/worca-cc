// src/core/agent-registry.mjs
// Data-driven agent registry. Scans agents/*.meta.json into an in-memory map
// keyed by agent key, sorted by `.order`. This replaces what used to be hardcoded
// across AGENT_FILES (orchestrator.mjs) and AGENT_STEPS (config.mjs): adding an
// agent is now "drop agents/<key>.md + agents/<key>.meta.json", no core edit.
//
// Read synchronously so it can back a synchronous AGENT_STEPS constant in
// config.mjs. Tolerant: a malformed sidecar, or one missing `key`, is skipped
// rather than throwing (mirrors the tolerant readers elsewhere); an ABSENT
// `order` is backfilled to DEFAULT_ORDER, matching normalizeAgentMeta.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worcaHome } from './projects.mjs'; // user agent layer root (read fresh per call)
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs'; // plugin layer roots (Task 2)
import { declaredApi, negotiatedApi, NOT_META_V2, ASK_NEEDS_API_4 } from './plugin-manifest.mjs'; // plugin API declared/negotiated by a layer's manifest
import { WORCA_ASK_FORMS_API } from './plugin-api.mjs';
import { normalizeAgentMeta, DEFAULT_ORDER } from '../shared/graph/agent-meta.mjs'; // meta v2 (one source: registry + store + UI)
import { MOCK_WRITER_ROLES } from './claude-runner.mjs';             // mockRole vocabulary (no cycle: claude-runner imports no registry)
import { readFrontmatterSync } from './frontmatter.mjs';

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

/** Coerce one parsed sidecar into a normalized AgentMeta, or null if unusable.
 *  `warn` is INJECTABLE (defaults to console.warn) so scanLayer can capture the
 *  reason a sidecar was dropped and hand it to a diagnostics sink — the reason
 *  is authored here and must never be re-derived by a second reader. */
export function normalizeMeta(raw, { warn = console.warn, onDropForm = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;
  if (!AGENT_KEY_RE.test(key)) {
    warn(`[agent-registry] sidecar key "${key}" is not a valid agent key; skipped`);
    return null;
  }
  // `order` is OPTIONAL: agent-meta.mjs's normalizer backfills DEFAULT_ORDER and
  // validateMetaV2 reports zero errors for a sidecar that omits it, so dropping
  // it here made the plugin validator certify an agent this loader then silently
  // discarded — every node referencing it failed V4 with `unknown agent "<key>"`.
  // The two normalizers must agree. A PRESENT but non-numeric order is still a
  // skip (normalizeAgentMeta errors on it), but a loud one, like the key branch.
  const order = raw.order === undefined ? DEFAULT_ORDER : Number(raw.order);
  if (!Number.isFinite(order)) {
    warn(`[agent-registry] sidecar "${key}" has a non-numeric order ${JSON.stringify(raw.order)}; skipped`);
    return null;
  }
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
    fanOut: !!raw.fanOut,
    asksQuestions,
    questionsLocked: asksQuestions && !!raw.questionsLocked,
    questionsDefault: asksQuestions && !!raw.questionsDefault,
    order,
    // ── schema v2 (all optional; absent => safe defaults; origin/agentPath are
    //    stamped by scanLayer as COMPUTED fields, never read from the sidecar) ──
    promptHints: typeof raw.promptHints === 'string' ? raw.promptHints : '',
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
    warn: (msg) => warn(msg),
    onDropForm,                  // §3: a dropped FORM must not look like a dropped SIDECAR
  });
  if (errors.length) {
    warn(`[agent-registry] sidecar "${key}" declares metaVersion 2 but is invalid; skipped: ${errors.join('; ')}`);
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
    'workspaceStrategy', 'workspaceVariantOf', 'placeable', 'ask']) {
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
 * current/<subdir> dir, in lexicographic plugin-name order — the deterministic
 * collision winner among plugins. Shared by the agent registry (`agents`) and the
 * script registry (`scripts`). An entry is skipped when disabled
 * (enabled === false in the lock) or broken (existsSync follows the current/
 * symlink, so a missing or dangling symlink — and a version dir without
 * <subdir>/ — drops out). Wrapped in try/catch like userAgentsDir(): with no
 * resolvable worca-cc home (bare node:test runner) or an unreadable lock this
 * returns [] and registry loads never throw.
 * @param {'agents'|'scripts'} subdir
 * @returns {Array<{plugin: string, dir: string, builtFor: number|null, api: number|null}>}
 */
export function pluginLayers(subdir) {
  try {
    const lock = readPluginsLock();
    return Object.keys(lock)
      .sort()
      .filter((name) => lock[name] && lock[name].enabled !== false)
      .map((name) => {
        const dir = pluginCurrentDir(name);
        let builtFor = null;
        let api = null;
        try {
          const raw = JSON.parse(readFileSync(join(dir, 'worca-cc-plugin.json'), 'utf8'));
          const range = raw?.engines?.['worca-cc-api'] ?? '';
          // `|| null`: declaredApi('') is 0 (an unconstrained range accepts
          // everything), and "built for plugin API 0" is not English. apiMismatch
          // guards the same case the same way.
          builtFor = declaredApi(range) || null;
          // builtFor is the LOWEST integer the range accepts (what the plugin was
          // written against); `api` is the HIGHEST host API it admits — what the
          // plugin actually NEGOTIATES, and therefore what decides which host
          // features it gets. `null` when the manifest is missing or unreadable:
          // every feature gate below must fail CLOSED on it.
          api = negotiatedApi(range);
        } catch { builtFor = null; api = null; } // unreadable manifest: the message degrades, the skip does not
        return { plugin: name, dir: join(dir, subdir), builtFor, api };
      })
      .filter(({ dir }) => existsSync(dir));
  } catch {
    return []; // no home / unreadable lock => no plugin layer (fails safe)
  }
}

export function pluginAgentLayers() { return pluginLayers('agents'); }

/**
 * Scan one layer dir for `*.meta.json` and normalize each through
 * `normalize(parsed, { warn })` (null = skip). Stamps the COMPUTED `origin`.
 * ONE reader for "a directory of sidecars", two normalizers (agents, scripts).
 * `tag` prefixes the warnings (`[agent-registry]` / `[script-registry]`).
 * @returns {Array<{meta: object, file: string}>}
 */
export function scanMetaLayer(dir, origin, { normalize, tag, requireMetaV2 = false, builtFor = null, onDrop = null }) {
  // Every skip below is a CONTRIBUTION THE USER CANNOT SEE unless someone
  // reports it: console.warn reaches a server log, not the Plugins card, the
  // install receipt or the doctor. onDrop is that reporting channel — optional,
  // so the hot registry path pays nothing when nobody is listening. A drop means
  // "this file, or a declared PART of it, was ignored": scanLayer's API-4 gate
  // reports a stripped `ask` block through the same channel, and the reason
  // string is what tells the two apart.
  const drop = (file, reason) => { if (onDrop) onDrop({ origin, file, reason }); };
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return []; // missing layer dir => empty layer (fails safe)
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.meta.json')) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      drop(f, 'unreadable JSON');
      continue; // skip unreadable / malformed sidecars
    }
    // API 3 (plugin layers only): a sidecar that is not meta v2 has no typed
    // ports, so it can be neither placed on a canvas nor resolved by the graph
    // engine. Ignore it with a line that names the fix — reusing the SAME
    // clause validate-time prints, so the two can never drift. Builtin/user
    // layers keep the v1 path until the engine cut-over.
    if (requireMetaV2 && Number(parsed?.metaVersion) !== 2) {
      const builtForText = builtFor == null ? 'an older plugin API' : `plugin API ${builtFor}`;
      console.warn(`[${tag}] ${origin}/${f}: built for ${builtForText} — ${NOT_META_V2} — ignored`);
      drop(f, `built for ${builtForText} — ${NOT_META_V2}`);
      continue;
    }
    // Capture the normalizer's own reason rather than re-deriving one: the LAST
    // warning it emits is the fatal one (non-fatal coercion warnings precede it).
    let why = '';
    const prefix = `[${tag}] `;
    const meta = normalize(parsed, {
      warn: (m) => { why = String(m).startsWith(prefix) ? String(m).slice(prefix.length) : String(m); console.warn(m); },
      // A form that fails gate 1 drops the FORM, not the sidecar, so it reports
      // straight to the diagnostics sink instead of through `why` (which names
      // the reason an agent vanished). The script normalizer ignores the opt.
      onDropForm: ({ message }) => drop(f, message),
    });
    if (!meta) { drop(f, why || 'invalid sidecar'); continue; }
    meta.origin = origin;                                              // computed, never stored
    out.push({ meta, file: f });
  }
  return out;
}

/** Scan one agent layer dir for *.meta.json; stamps the COMPUTED origin/agentPath/
 *  descriptionDerived fields (none of which normalizeMeta returns, so none can
 *  be persisted back into a sidecar). */
function scanLayer(dir, origin, { requireMetaV2 = false, builtFor = null, onDrop = null, askApi = null } = {}) {
  const drop = (file, reason) => { if (onDrop) onDrop({ origin, file, reason }); };
  const metas = [];
  for (const { meta, file: f } of scanMetaLayer(dir, origin, { normalize: normalizeMeta, tag: 'agent-registry', requireMetaV2, builtFor, onDrop })) {
    // agentFile is a PATH read as the agent's system prompt AND for its
    // `tools:` frontmatter, so the loader refuses to stamp an agentPath outside
    // the layer it is scanning. Belt-and-braces behind validatePluginDir, which
    // never sees a live-edited linked dir or a hand-written user sidecar.
    if (meta.agentFile
      && (isAbsolute(meta.agentFile) || !resolve(dir, meta.agentFile).startsWith(resolve(dir) + sep))) {
      console.warn(`[agent-registry] ${origin}/${f}: agentFile "${meta.agentFile}" resolves outside the agents dir — ignored`);
      drop(f, `agentFile "${meta.agentFile}" resolves outside the agents dir`);
      continue;
    }

    // API 4 (plugin layers only — `requireMetaV2` is the same plugin-layer
    // marker the meta v2 gate above rides): an agent's `ask` block is honoured
    // only when the plugin NEGOTIATES plugin API 4. Below that it is stripped
    // HERE, at the single choke point, so the prompt block, the ask-time gate,
    // the Agents view and History all see an agent that simply has no forms and
    // the agent falls back to generic questions on its own (ask-forms spec §10).
    // Number(null) is 0, so an unknowable API fails CLOSED. The sidecar itself
    // is NOT dropped: its ports are fine and its agent stays usable.
    if (requireMetaV2 && meta.ask && !(Number(askApi) >= WORCA_ASK_FORMS_API)) {
      console.warn(`[agent-registry] ${origin}/${f}: ${ASK_NEEDS_API_4}`);
      drop(f, ASK_NEEDS_API_4);
      delete meta.ask;
    }
    meta.agentPath = meta.agentFile ? join(dir, meta.agentFile) : null; // layer-correct abs path
    // The agent .md's frontmatter (name/description/tools/model), read from the
    // file HEAD only (frontmatter.mjs) — COMPUTED like origin/agentPath, never
    // stored (normalizeMeta's fixed key set drops it on every write path). The
    // Auto classifier reads it (auto-workflow P1); the chat catalog can too.
    meta.frontmatter = meta.agentPath ? readFrontmatterSync(meta.agentPath) : null;
    // Description fallback (spec 2026-08-09): empty sidecar description →
    // the .md frontmatter description. descriptionDerived marks the RESOLVED
    // description as computed too, so no write path bakes the fallback into
    // the sidecar and the blurb keeps tracking the .md.
    if (!meta.description && meta.frontmatter?.description) {
      meta.description = meta.frontmatter.description;
      meta.descriptionDerived = true;                                    // computed, never stored
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
  // opts.onDrop({origin, file, reason}) — every sidecar this load IGNORED, so a
  // caller (plugin-store's card/receipt/doctor) can show what did not load.
  const onDrop = typeof opts.onDrop === 'function' ? opts.onDrop : null;
  const builtins = scanLayer(agentsDir, 'builtin', { onDrop });
  const builtinKeys = new Set(builtins.map((m) => m.key));
  const userDir = opts.userAgentsDir === undefined ? userAgentsDir() : opts.userAgentsDir;
  const users = [];
  if (userDir) {
    for (const m of scanLayer(userDir, 'user', { onDrop })) {
      if (builtinKeys.has(m.key)) {
        console.warn(
          `[agent-registry] user agent "${m.key}" shadows a built-in and was skipped (built-ins are immutable)`,
        );
        // The sidecar filename is `<key>.meta.json` on every write path (the
        // agent store writes it, and validatePluginDir requires key === stem).
        if (onDrop) onDrop({ origin: 'user', file: `${m.key}.meta.json`, reason: 'shadows a built-in agent' });
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
    for (const { plugin, dir, builtFor, api } of pluginAgentLayers()) {
      for (const m of scanLayer(dir, `plugin:${plugin}`, { requireMetaV2: true, builtFor, askApi: api, onDrop })) {
        if (taken.has(m.key)) {
          console.warn(
            `[agent-registry] plugin agent "${m.key}" (plugin "${plugin}") collides with an existing agent and was skipped`,
          );
          if (onDrop) onDrop({ origin: `plugin:${plugin}`, file: `${m.key}.meta.json`, reason: 'collides with an existing agent' });
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
