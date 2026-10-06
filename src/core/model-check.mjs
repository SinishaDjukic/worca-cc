// Pre-flight model availability (docs/models.md "Before a run starts"). Every model a run's
// graph will spawn is checked BEFORE the first paid step, so a run whose Implement node sits on
// a signed-out provider stops at $0 instead of after Plan and Refine have spent:
//   • bridged (Copilot / OpenAI / Anthropic-key upstream): providerReadiness (sign-in, terms,
//     key, ${VAR}), then — live:true, broker off — one cached, time-boxed probe per provider;
//   • env-routed (an ANTHROPIC_BASE_URL entry): every ${VAR} and plugin secret must resolve;
//   • the default connection (a Claude id, or no model at all): `claude auth status`;
//   • an id off the catalog: blocked unless it looks like an Anthropic id.
// Only a DEFINITE answer blocks (a 401, a refused connection, a signed-out CLI, a missing key);
// an ambiguous one (a 404 from a gateway without /models, a timeout, an old CLI) only warns.
import { createHash } from 'node:crypto';
import { findBridgedEntry, providerReadiness } from './bridge/registry.mjs';
import { testProviderConnection } from './bridge/provider-ops.mjs';
import { catalogHasModel, modelEnvSource } from './config.mjs';
import { modelEnvRef, isReservedModelEnvKey, isMcpRegistryEnvKey } from './model-env.mjs';
import { providerConfig, resolveProviderSecret } from './settings.mjs';
import { brokerEnabled } from './broker-client.mjs';

/** The 409 / error `code` every surface keys on. */
export const MODEL_UNAVAILABLE_CODE = 'model-unavailable';
export const PROBE_TIMEOUT_MS = 8_000;
export const PROBE_OK_TTL_MS = 5 * 60_000;
export const PROBE_FAIL_TTL_MS = 30_000;
const BLOCKING_PROBE_KINDS = new Set(['auth', 'unreachable', 'config']);

// ── ids ──────────────────────────────────────────────────────────────────────
const CLI_ALIASES = new Set(['default', 'sonnet', 'opus', 'haiku', 'fable', 'opusplan', 'sonnet[1m]', 'opus[1m]']);
// claude-<…> with an optional cloud prefix (Bedrock `us.anthropic.`, `anthropic.`), Vertex `@date`,
// Bedrock `-v1:0` and the `[1m]` context suffix. No slash: `openrouter/anthropic/…` is a gateway id.
const ANTHROPIC_ID_RE = /^(?:(?:[a-z]{2,6}\.)?anthropic\.)?claude-[a-z0-9][a-z0-9.:@-]*(?:\[1m\])?$/i;

/** Does `id` look like a model the claude CLI itself accepts on its default connection? Pure. */
export function isAnthropicModelId(id) {
  const s = typeof id === 'string' ? id.trim() : '';
  return !!s && (CLI_ALIASES.has(s.toLowerCase()) || ANTHROPIC_ID_RE.test(s));
}

// ── what the run uses ────────────────────────────────────────────────────────
/**
 * The distinct models a v2 manifest's agent nodes spawn with — `node.model || runModel`, the
 * orchestrator's own rule (orchestrator.mjs nc.model || this.claude.model); `null` is the CLI's
 * default model. resolveGraph already folded per-role steps, team step models and template
 * defaults into node.model, so those need no separate pass. Pure.
 * @param {object} manifest buildGraphManifest output
 * @param {{runModel?:string|null, includeRunModel?:boolean, onlyNodes?:Iterable<string>|null}} [o]
 *   includeRunModel: add the run model even with no node using it (Auto before the decision)
 * @returns {{model:string|null, nodes:string[]}[]}
 */
export function collectModelUses(manifest, { runModel = null, includeRunModel = false, onlyNodes = null } = {}) {
  const fallback = typeof runModel === 'string' && runModel.trim() ? runModel.trim() : null;
  const only = onlyNodes ? new Set(onlyNodes) : null;
  const byModel = new Map();
  const add = (model, who) => {
    const k = model ? model.toLowerCase() : '';
    if (!byModel.has(k)) byModel.set(k, { model, nodes: [] });
    const u = byModel.get(k);
    if (who && !u.nodes.includes(who)) u.nodes.push(who);
  };
  const nodes = Array.isArray(manifest?.graph?.nodes) ? manifest.graph.nodes : [];
  for (const n of nodes) {
    if (!n || n.kind !== 'agent' || (only && !only.has(n.id))) continue;
    const own = typeof n.model === 'string' && n.model.trim() ? n.model.trim() : null;
    add(own || fallback, n.label || n.key || n.id);
  }
  if (includeRunModel && fallback) add(fallback, 'the run model');
  return [...byModel.values()];
}

// ── local readiness (no network) ─────────────────────────────────────────────
function safeProviderConfig(p) { try { return providerConfig(p); } catch { return {}; } }

/** ${VAR}s a model env references that worca's environment does not set (reserved keys are dropped anyway). */
function unsetEnvRefs(rawEnv, sourceEnv = process.env) {
  const out = new Set();
  for (const [k, v] of Object.entries(rawEnv || {})) {
    if (isReservedModelEnvKey(k) || isMcpRegistryEnvKey(k)) continue;
    const ref = typeof v === 'string' ? modelEnvRef(v) : null;
    if (ref && !(typeof sourceEnv[ref] === 'string' && sourceEnv[ref].trim())) out.add(ref);
  }
  return [...out];
}

function readinessFix(up, reason) {
  if (reason === 'terms') return 'acknowledge the Copilot notice in Settings › Providers';
  if (brokerEnabled()) return 'ask the credential broker\'s operator to add a credential slot for this provider';
  if (reason === 'not_signed_in') return 'sign in to Copilot in Settings › Providers (or run `worca models login copilot`)';
  const ref = modelEnvRef(String(up.apiKey || '')) || modelEnvRef(String(safeProviderConfig(up.provider).apiKey || ''));
  return ref ? `set ${ref} in worca's environment, then start again` : `add an API key for ${up.provider} in Settings › Providers`;
}

/**
 * One model's local verdict. Synchronous; never throws.
 * @param {string|null} model  null = the CLI's default model
 * @returns {{ok:boolean, connection:'provider'|'env'|'default'|'unknown', provider?:string, upstream?:object, reason?:string, message?:string, fix?:string}}
 */
export function checkModelLocal(model) {
  if (!model) return { ok: true, connection: 'default' };
  const bridged = findBridgedEntry(model);
  if (bridged) {
    const up = bridged.upstream;
    const r = providerReadiness(up);
    const base = { connection: 'provider', provider: up.provider, upstream: up };
    return r.ok ? { ok: true, ...base } : { ok: false, ...base, reason: r.reason, message: r.message, fix: readinessFix(up, r.reason) };
  }
  let src = null;
  try { src = modelEnvSource(model); } catch { src = null; }   // a policy-catalog read fault: dispatch reports it
  if (src) {
    const routed = 'ANTHROPIC_BASE_URL' in src.rawEnv;
    if (src.droppedSecrets.length && !brokerEnabled()) {
      return { ok: false, connection: routed ? 'env' : 'default', reason: 'plugin_secret',
        message: `plugin "${src.plugin}" model secret${src.droppedSecrets.length === 1 ? '' : 's'} ${src.droppedSecrets.join(', ')} ${src.droppedSecrets.length === 1 ? 'is' : 'are'} not set`,
        fix: `set it in Settings › Plugins › ${src.plugin} › Model secrets` };
    }
    const unset = unsetEnvRefs(src.rawEnv);
    if (unset.length) {
      return { ok: false, connection: routed ? 'env' : 'default', reason: 'env_unset',
        message: `${unset.map((v) => `\${${v}}`).join(', ')} ${unset.length === 1 ? 'is' : 'are'} not set in worca's environment`,
        fix: `set ${unset.join(', ')} in worca's environment, then start again` };
    }
    return { ok: true, connection: routed ? 'env' : 'default' };
  }
  if (catalogHasModel(model) || isAnthropicModelId(model)) return { ok: true, connection: 'default' };
  return { ok: false, connection: 'unknown', reason: 'unknown_model',
    message: `"${model}" is not in the model catalog and is not a Claude model id`,
    fix: 'add it in Settings › Models, or pick a catalog model for the node' };
}

// ── live probe (bridged providers, broker off) ───────────────────────────────
const _probeCache = new Map();   // providerProbeKey -> { at, ttl, promise }
/** Test seam: forget remembered probe answers. */
export function clearModelProbeCache() { _probeCache.clear(); }

/** provider | base URL (or Copilot account type) | a hash of the credential — never the credential. */
export function providerProbeKey(up) {
  const p = up.provider;
  const cfg = safeProviderConfig(p);
  const secret = p === 'copilot' ? resolveProviderSecret(cfg.githubToken)
    : (resolveProviderSecret(up.apiKey) || resolveProviderSecret(cfg.apiKey) || '');
  const fp = secret ? createHash('sha256').update(secret).digest('hex').slice(0, 12) : '-';
  return [p, p === 'copilot' ? (cfg.accountType || '') : (up.baseUrl || cfg.baseUrl || ''), fp].join('|');
}

function timeBox(p, ms) {
  let t;
  const timeout = new Promise((resolve) => {
    // Not unref'd: the caller is awaiting this answer, and the finally below clears it on settle.
    t = setTimeout(() => resolve({ ok: false, kind: 'timeout', message: `no answer within ${Math.max(1, Math.round(ms / 1000))} s` }), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/**
 * One connection probe per provider/baseUrl/credential, shared by concurrent callers and
 * remembered PROBE_OK_TTL_MS (a failure only PROBE_FAIL_TTL_MS, so a fix is seen quickly).
 * Never throws. @returns {Promise<{ok:true}|{ok:false, kind:string, message:string}>}
 */
export function probeProvider(up, { probe = testProviderConnection, now = Date.now, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const key = providerProbeKey(up);
  const hit = _probeCache.get(key);
  if (hit && now() - hit.at < hit.ttl) return hit.promise;
  const opts = up.provider === 'copilot' ? { timeoutMs } : {
    ...(up.baseUrl ? { baseUrl: up.baseUrl } : {}),
    ...(up.apiKey ? { apiKey: up.apiKey } : {}),   // a per-entry key wins, as at spawn (upstreamSettings)
    timeoutMs,
  };
  const entry = { at: now(), ttl: PROBE_OK_TTL_MS, promise: null };
  entry.promise = timeBox(Promise.resolve().then(() => probe(up.provider, opts)), timeoutMs)
    .catch((err) => ({ ok: false, kind: 'unreachable', message: err?.message || String(err) }))
    .then((r) => { if (!r || !r.ok) entry.ttl = PROBE_FAIL_TTL_MS; return r || { ok: false, kind: 'status', message: 'no answer' }; });
  _probeCache.set(key, entry);
  return entry.promise;
}

function probeFix(up, kind) {
  const where = up.provider === 'copilot' ? 'sign in to Copilot again in Settings › Providers' : 'update it in Settings › Providers';
  if (kind === 'auth') return `the ${up.provider} credential was rejected — ${where}`;
  if (kind === 'unreachable') return `start the endpoint${up.baseUrl ? ` (${up.baseUrl})` : ''} or fix its base URL in Settings › Providers`;
  if (kind === 'config') return readinessFix(up, up.provider === 'copilot' ? 'not_signed_in' : 'no_key');
  return 'check the provider in Settings › Providers (Test connection)';
}

// ── the run check ────────────────────────────────────────────────────────────
const problemOf = (u, v) => ({
  model: u.model, nodes: u.nodes, connection: v.connection,
  ...(v.provider ? { provider: v.provider } : {}), reason: v.reason, message: v.message, fix: v.fix,
});

/**
 * Check every model a manifest will spawn. Never throws.
 * @param {object} manifest
 * @param {{runModel?:string|null, includeRunModel?:boolean, onlyNodes?:Iterable<string>|null, live?:boolean,
 *   claudeAuth?:(()=>Promise<{state:string}>)|null, probe?:Function, now?:()=>number, timeoutMs?:number}} [o]
 * @returns {Promise<{ok:boolean, problems:object[], warnings:object[], checked:object[]}>}
 */
export async function checkRunModels(manifest, {
  runModel = null, includeRunModel = false, onlyNodes = null, live = true,
  claudeAuth = null, probe, now, timeoutMs,
} = {}) {
  const uses = collectModelUses(manifest, { runModel, includeRunModel, onlyNodes });
  const problems = [];
  const warnings = [];
  const checked = [];
  const onDefault = [];
  const liveJobs = [];
  for (const u of uses) {
    const v = checkModelLocal(u.model);
    checked.push({ model: u.model, nodes: u.nodes, connection: v.connection, ...(v.provider ? { provider: v.provider } : {}), ok: v.ok });
    if (!v.ok) { problems.push(problemOf(u, v)); continue; }
    if (v.connection === 'default') onDefault.push(u);
    else if (v.connection === 'provider' && live && !brokerEnabled()) liveJobs.push({ u, v });
  }
  const [auth, probes] = await Promise.all([
    onDefault.length && typeof claudeAuth === 'function' ? Promise.resolve().then(claudeAuth).catch(() => null) : null,
    Promise.all(liveJobs.map(({ u, v }) => probeProvider(v.upstream, {
      ...(probe ? { probe } : {}), ...(now ? { now } : {}), ...(timeoutMs ? { timeoutMs } : {}),
    }).then((r) => ({ u, v, r })))),
  ]);
  if (auth && auth.state === 'signed-out') {
    for (const u of onDefault) {
      problems.push(problemOf(u, { connection: 'default', reason: 'signed_out',
        message: 'Claude Code isn\'t signed in', fix: 'run `claude` in a terminal and type /login' }));
    }
  }
  for (const { u, v, r } of probes) {
    if (r.ok) continue;
    const kind = r.kind || 'status';
    const item = problemOf(u, { connection: 'provider', provider: v.provider, reason: `probe_${kind}`,
      message: `provider ${v.provider}: ${r.message}`, fix: probeFix(v.upstream, kind) });
    (BLOCKING_PROBE_KINDS.has(kind) ? problems : warnings).push(item);
  }
  return { ok: problems.length === 0, problems, warnings, checked };
}

// ── messages ─────────────────────────────────────────────────────────────────
/** One line per problem: model (provider) — used by nodes: reason. Fix: … */
export function describeModelProblems(problems) {
  return problems.map((p) => `  - ${p.model ? `"${p.model}"` : 'Claude Code\'s default model'}${p.provider ? ` (${p.provider})` : ''}`
    + ` — used by ${p.nodes.length ? p.nodes.join(', ') : 'this run'}: ${p.message}. Fix: ${p.fix}.`).join('\n');
}

/**
 * The error a failed check throws. `when`: 'start' (no row: a launch error, nothing spent),
 * 'auto' (Auto chose its workflow; nothing past the classifier spent) or 'resume'.
 * errorClass 'model_unavailable' routes the setup/shell sites to REASON.MODEL_UNAVAILABLE.
 */
export function modelUnavailableError(report, { when = 'start' } = {}) {
  const n = report.problems.length;
  const what = n === 1 ? 'a model this run uses is not available' : `${n} models this run uses are not available`;
  const list = describeModelProblems(report.problems);
  const text = when === 'start'
    ? `Preflight failed: ${what}, so the run was not started (nothing was spent):\n${list}`
    : `${what[0].toUpperCase()}${what.slice(1)}${when === 'auto' ? ' (checked once Auto chose the workflow, before its first agent step)' : ''}:\n${list}\nFix it, then resume.`;
  return Object.assign(new Error(text), { errorClass: 'model_unavailable', code: MODEL_UNAVAILABLE_CODE, problems: report.problems });
}

// ── resume: which nodes still have to run ────────────────────────────────────
/**
 * Agent node ids a resumed run may still spawn: every agent/script node without a finished
 * execution, plus everything reachable from one over the graph's wires (a loop can re-run a
 * finished node). "Finished" is status 'done' or 'skipped'; 'start', 'paused' and 'error'
 * (graph/scheduler.mjs) all re-run. null when the resume point has no snapshot (a pre-dispatch or
 * decision point): check every node. Pure.
 */
export function pendingNodeIds(manifest, snapshot) {
  const execs = Array.isArray(snapshot?.execs) ? snapshot.execs : null;
  if (!execs) return null;
  const nodes = Array.isArray(manifest?.graph?.nodes) ? manifest.graph.nodes : [];
  const finished = new Set();
  const open = new Set();
  for (const e of execs) {
    if (!e || !e.nodeId) continue;
    if (e.status === 'done' || e.status === 'skipped') finished.add(e.nodeId); else open.add(e.nodeId);
  }
  const runnable = (n) => n && (n.kind === 'agent' || n.kind === 'script');
  const pending = new Set(nodes.filter((n) => runnable(n) && (open.has(n.id) || !finished.has(n.id))).map((n) => n.id));
  const next = new Map();
  for (const w of manifest?.graph?.wires || []) {
    const f = w?.from?.node; const t = w?.to?.node;
    if (f && t) { if (!next.has(f)) next.set(f, []); next.get(f).push(t); }
  }
  const stack = [...pending];
  while (stack.length) {
    for (const t of next.get(stack.pop()) || []) if (!pending.has(t)) { pending.add(t); stack.push(t); }
  }
  return [...pending];
}

// ── the server's view: a workflow's manifest without starting a run ──────────
/**
 * The manifest a saved workflow would run with on `projectDir` — the same resolveGraph +
 * buildGraphManifest pair GraphOrchestrator._resolveTopology uses (without the defragment /
 * workspace-scan model pins, which those reserved runs set themselves). Throws on an unknown
 * workflow; Auto (`wf_auto`) has no graph before its decision — the caller skips it.
 */
export async function resolveWorkflowManifest({ projectDir, workflowId, agentsDir, isWorkspace = false }) {
  const { loadAgentRegistry } = await import('./agent-registry.mjs');
  const { loadScriptRegistry } = await import('./script-registry.mjs');
  const { resolveGraph } = await import('./workflows.mjs');
  const { buildGraphManifest } = await import('../shared/graph/manifest.mjs');
  const registry = loadAgentRegistry(agentsDir);
  const scripts = loadScriptRegistry({ agentKeys: Object.keys(registry || {}) });
  const r = await resolveGraph(projectDir, workflowId, registry, agentsDir, { isWorkspace, scripts });
  return buildGraphManifest(r.template, r.agentsByKey, { overlays: { nodes: r.nodes, wires: r.wires }, scripts: r.scriptsByKey });
}
