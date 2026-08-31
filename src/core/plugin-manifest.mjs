// src/core/plugin-manifest.mjs
// Parse + validate `worca-cc-plugin.json` (plugin spec §4.1) and whole plugin
// dirs (§6.6 `worca plugin validate [--strict]`). Pure: fs reads only, no
// writes, no DB, no worcaHome — callers pass absolute dirs.

import { readFileSync, readdirSync, readlinkSync, existsSync } from 'node:fs';
import { join, resolve, dirname, sep, isAbsolute } from 'node:path';
import { WORCA_PLUGIN_API, WORCA_PLUGIN_APIS } from './plugin-api.mjs';
import { EFFORTS, isReservedModelEnvKey, assertModelCost } from './model-env.mjs';
import { validateMetaV2, normalizeAgentMeta, indexByKey } from '../shared/graph/agent-meta.mjs';
import { portsFnFor } from '../shared/graph/ports.mjs';
import { validateGraph } from '../shared/graph/validate.mjs';

/** Plugin names are kebab-case, machine-unique, dir-name safe (spec §4.1). */
export const PLUGIN_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Private copy of agent-registry.mjs:175 AGENT_KEY_RE (module-private there;
 *  agent-store.mjs:15 duplicates it the same way). */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const FIELD_TYPES = new Set(['text', 'select']);
const INPUT_TYPES = new Set(['text', 'select', 'remote-select', 'task-browser']);
const KNOWN_TOP = new Set(['name', 'version', 'description', 'author', 'homepage', 'license', 'engines', 'taskSources', 'chatChannels', 'setup', 'models', 'modelSecrets']);
const KNOWN_SOURCE = new Set(['id', 'displayName', 'module', 'configSchema', 'inputs', 'multiProfile']);
const KNOWN_CHANNEL = new Set(['id', 'displayName', 'platform', 'module', 'ingress', 'capabilities', 'configSchema']);
const CHANNEL_INGRESS = new Set(['connect', 'webhook']);
const KNOWN_FIELD = new Set(['key', 'type', 'label', 'secret', 'required', 'default', 'help', 'options']);
const KNOWN_INPUT = new Set(['key', 'type', 'label', 'default', 'optionsFrom', 'options']);
const KNOWN_MODEL = new Set(['id', 'label', 'efforts', 'env', 'cost']);
const KNOWN_MODEL_SECRET = new Set(['key', 'label']);
/** A manifest env value that defers to the plugin's secrets store (design §9.1). */
const isSecretRef = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.secret === 'string' && Object.keys(v).length === 1;

/**
 * Tiny '>=N <M' / '>=N' / exact 'N' range check against the integer host APIs.
 * NO npm semver dep (repo rule: runtime deps are express+ws only). Clauses are
 * whitespace-separated and AND-ed; minor/patch digits are tolerated but ignored
 * (the API version is an integer). The host advertises an API SET
 * (WORCA_PLUGIN_APIS) — the range is satisfied if ANY member satisfies all
 * clauses, so old ">=1 <2" manifests keep installing after an API bump.
 * Unset/blank -> true (no constraint); any unparseable token -> false (fail
 * CLOSED: an unintelligible constraint must not install). A number `apis` arg
 * is accepted for back-compat with callers/tests that pass a single API.
 */
export function apiSatisfies(range, apis = WORCA_PLUGIN_APIS) {
  return negotiatedApi(range, apis) !== null;
}

/**
 * Highest host API satisfying `range`, or null. Drives the apiVersion handed
 * to plugin children: an API-1 connector keeps receiving 1 after a host bump.
 */
export function negotiatedApi(range, apis = WORCA_PLUGIN_APIS) {
  const list = typeof apis === 'number' ? [apis] : apis;
  const spec = typeof range === 'string' ? range.trim() : '';
  const clauses = [];
  if (spec) {
    for (const tok of spec.split(/\s+/)) {
      const m = /^(>=|<=|>|<|=)?(\d+)(?:\.\d+){0,2}$/.exec(tok);
      if (!m) return null; // fail closed
      clauses.push({ op: m[1] || '=', n: Number(m[2]) });
    }
  }
  let best = null;
  for (const api of list) {
    const ok = clauses.every(({ op, n }) => (
      op === '>=' ? api >= n : op === '<=' ? api <= n
        : op === '>' ? api > n : op === '<' ? api < n : api === n));
    if (ok && (best === null || api > best)) best = api;
  }
  return best;
}

/** The ONE per-file sentence for each half of the data contract. `validatePluginDir`
 *  prefixes `agents/<f>: ` / `workflows/<f>: `; `agent-registry.scanLayer` prefixes the
 *  layer and appends ` — ignored`; `plugin-workflows` uses NOT_GRAPH_V2 verbatim as a
 *  skip reason. Exported so those three sites can never drift apart — never re-word
 *  either string in a second place. */
export const NOT_META_V2 = 'not a meta v2 sidecar (declare "metaVersion": 2 with typed inputs/outputs) — plugin API 3 no longer reads channel sidecars';
export const NOT_GRAPH_V2 = 'not a version-2 graph template (nodes/wires) — port the "steps" pipeline';

/** The host API a range was BUILT FOR: the lowest integer it accepts. ">=1 <2"
 *  and "1" both answer 1; an unconstrained range answers 0; null when nothing
 *  satisfies it (an unparseable range fails closed in apiSatisfies too).
 *  @param {string} range  @returns {number|null} */
export function declaredApi(range) {
  for (let n = 0; n <= 99; n += 1) if (apiSatisfies(range, n)) return n;
  return null;
}

/** Which files in a plugin dir are still on the API-2 data contract: sidecars
 *  without metaVersion 2, templates without version 2. Pure fs read; an absent
 *  or unreadable dir/file contributes nothing (validatePluginDir reports those
 *  separately as parse errors). Basenames only — the caller prefixes them.
 *  @param {string} absDir
 *  @returns {{agentsV1: string[], workflowsV1: string[]}} */
export function dataContractIssues(absDir) {
  const agentsV1 = [];
  const workflowsV1 = [];
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const agentsDir = join(absDir, 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter((x) => x.endsWith('.meta.json')).sort()) {
      const raw = read(join(agentsDir, f));
      if (raw && Number(raw.metaVersion) !== 2) agentsV1.push(f);
    }
  }
  const wfDir = join(absDir, 'workflows');
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.json')).sort()) {
      const raw = read(join(wfDir, f));
      if (raw && Number(raw.version) !== 2) workflowsV1.push(f);
    }
  }
  return { agentsV1, workflowsV1 };
}

/**
 * The Plugins-view / doctor payload for a plugin whose DATA is still on the old
 * contract, or null when it has nothing the host would ignore. The bump is
 * gated by CONTENT, not by the range: a connector-only plugin declaring
 * ">=1 <2" ships no agents and no templates, so it is never "incompatible" —
 * it simply keeps negotiating API 1.
 * @param {string} range   engines['worca-cc-api']
 * @param {{agentsV1: string[], workflowsV1: string[]}} issues
 * @returns {{builtFor: number|null, host: number, agents: number, workflows: number, message: string}|null}
 */
export function apiMismatch(range, issues) {
  const agents = (issues && issues.agentsV1 ? issues.agentsV1 : []).length;
  const workflows = (issues && issues.workflowsV1 ? issues.workflowsV1 : []).length;
  if (!agents && !workflows) return null;
  // declaredApi('') is 0 (an unconstrained range accepts everything); report that
  // as null so the message reads "built for an older version", never "API 0".
  const mismatch = { builtFor: declaredApi(range) || null, host: WORCA_PLUGIN_API, agents, workflows };
  mismatch.message = apiMismatchMessage(mismatch);
  return mismatch;
}

/**
 * THE per-plugin sentence (spec §9 wording, "worca" is the product name) —
 * rendered verbatim by the Plugins view (`p.apiMismatch.message`), the doctor's
 * `agents-api` check and `worca plugin list`. An API-outdated plugin is NOT
 * corrupt: it installed fine and its connector or chat channel still works —
 * worca simply ignores the agents and pipeline templates it ships.
 */
export function apiMismatchMessage(mismatch) {
  if (!mismatch) return '';
  const { builtFor, agents, workflows } = mismatch;
  return `built for plugin API ${builtFor ?? 'an older version'}; this version of worca requires `
    + `plugin API ${WORCA_PLUGIN_API} for agents and pipeline templates — update or reinstall the plugin `
    + `(${agents} agent(s), ${workflows} template(s) ignored)`;
}

const str = (v, d = '') => (typeof v === 'string' ? v.trim() : d);

function normOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => (typeof o === 'string'
    ? { value: o, label: o }
    : o && typeof o === 'object' && typeof o.value === 'string'
      ? { value: o.value, label: str(o.label) || o.value }
      : null)).filter(Boolean);
}

function collectUnknown(obj, known, where, warnings) {
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) warnings.push(`${where}: unknown field "${k}" ignored`);
  }
}

/** Shared configSchema field normalizer — identical semantics for taskSources
 *  and chatChannels, so plugin-config.mjs (secrets, $env, defaults) needs no
 *  per-contribution knowledge. Appends to errors/warnings, returns the list. */
function normConfigSchema(rawList, at, errors, warnings) {
  const configSchema = [];
  (Array.isArray(rawList) ? rawList : []).forEach((f, j) => {
    const fat = `${at}.configSchema[${j}]`;
    if (!f || typeof f !== 'object') { errors.push(`${fat} must be an object`); return; }
    collectUnknown(f, KNOWN_FIELD, fat, warnings);
    const key = str(f.key);
    if (!KEY_RE.test(key)) { errors.push(`${fat}: "key" must be an identifier, got "${key}"`); return; }
    const type = str(f.type) || 'text';
    if (!FIELD_TYPES.has(type)) { errors.push(`${fat} ("${key}"): type must be text|select, got "${type}"`); return; }
    const options = normOptions(f.options);
    if (type === 'select' && !options.length) errors.push(`${fat} ("${key}"): select fields need "options"`);
    configSchema.push({
      key, type, label: str(f.label) || key,
      secret: f.secret === true, required: f.required === true,
      default: f.default ?? null, help: str(f.help) || null, options,
    });
  });
  return configSchema;
}

function badModulePath(mod) {
  if (!mod) return 'is required';
  if (isAbsolute(mod) || /\\/.test(mod)) return 'must be a relative ./ path';
  if (!mod.startsWith('./')) return 'must start with "./"';
  if (mod.split('/').includes('..')) return 'must not contain ".."';
  return null;
}

/**
 * `agentFile` is a PATH, not a label: agent-registry.mjs stamps
 * `agentPath = join(<layer>/agents, meta.agentFile)` and workflows.mjs reads
 * THAT file as the agent's system prompt AND for its `tools:` frontmatter. So
 * it is gated exactly like `module` — relative, no "..", and it must still
 * resolve inside the agents dir. Absent/empty is legal (the agent then has no
 * prompt file). Returns a reason clause or null, like badModulePath.
 */
function badAgentFile(agentFile, agentsDir) {
  if (agentFile === undefined || agentFile === null || agentFile === '') return null;
  if (typeof agentFile !== 'string') return 'must be a string';
  const af = agentFile.trim();                       // the normalizer trims: judge the string the runtime will use
  if (!af) return null;
  if (isAbsolute(af) || /\\/.test(af)) return 'must be a relative path inside agents/';
  if (af.split('/').includes('..')) return 'must not contain ".."';
  const root = resolve(agentsDir);
  if (!resolve(root, af).startsWith(root + sep)) return 'must be a relative path inside agents/';
  // A contained agentFile must also EXIST: consent and the runtime both read it,
  // so a name with no file behind it says one thing at consent time ("none
  // declared") and another at run time (workflows.loadAgentFile used to fall
  // back into the BUILT-IN agents dir for the same basename).
  if (!existsSync(join(root, af))) return `${af} not found in agents/`;
  return null;
}

/**
 * Normalize a parsed worca-cc-plugin.json (spec §4.1). Only `name` is required.
 * Unknown fields are ignored and collected as warnings (validatePluginDir
 * promotes them to errors under --strict).
 * @returns {{ok:true, manifest:object, warnings:string[]}|{ok:false, errors:string[]}}
 */
export function normalizeManifest(raw, { dir = '' } = {}) {
  const where = dir ? `${dir}/worca-cc-plugin.json` : 'worca-cc-plugin.json';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [`${where}: manifest must be a JSON object`] };
  }
  const errors = [];
  const warnings = [];
  collectUnknown(raw, KNOWN_TOP, where, warnings);

  const name = str(raw.name);
  if (!name) errors.push(`${where}: "name" is required`);
  else if (!PLUGIN_NAME_RE.test(name) || name.length > 64) {
    errors.push(`${where}: "name" must be kebab-case (e.g. "github-source"), got "${name}"`);
  }

  const version = str(raw.version) || null; // absent -> null: pinned SHA is the version (§4.1)

  const enginesRaw = raw.engines && typeof raw.engines === 'object' ? raw.engines : {};
  const worcaApi = str(enginesRaw['worca-cc-api']) || null;
  if (worcaApi && !apiSatisfies(worcaApi)) {
    errors.push(`${where}: engines.worca-cc-api "${worcaApi}" is not satisfied by host plugin APIs [${WORCA_PLUGIN_APIS.join(', ')}]`);
  }

  const setupRaw = raw.setup && typeof raw.setup === 'object' ? raw.setup : {};
  if (setupRaw.python != null && setupRaw.python !== 'pyproject') {
    errors.push(`${where}: setup.python must be "pyproject" (got ${JSON.stringify(setupRaw.python)})`);
  }
  const setup = { node: setupRaw.node === true, python: setupRaw.python === 'pyproject' ? 'pyproject' : null };

  const sourcesRaw = raw.taskSources ?? [];
  const taskSources = [];
  if (!Array.isArray(sourcesRaw)) {
    errors.push(`${where}: "taskSources" must be an array`);
  } else {
    sourcesRaw.forEach((s, i) => {
      const at = `${where}: taskSources[${i}]`;
      if (!s || typeof s !== 'object') { errors.push(`${at} must be an object`); return; }
      collectUnknown(s, KNOWN_SOURCE, at, warnings);
      const id = str(s.id);
      if (!SOURCE_ID_RE.test(id)) errors.push(`${at}: "id" must be kebab-case, got "${id}"`);
      const module = str(s.module);
      const modErr = badModulePath(module);
      if (modErr) errors.push(`${at} ("${id}"): "module" ${modErr}`);

      const configSchema = normConfigSchema(s.configSchema, at, errors, warnings);

      const inputs = [];
      (Array.isArray(s.inputs) ? s.inputs : []).forEach((inp, j) => {
        const iat = `${at}.inputs[${j}]`;
        if (!inp || typeof inp !== 'object') { errors.push(`${iat} must be an object`); return; }
        collectUnknown(inp, KNOWN_INPUT, iat, warnings);
        const key = str(inp.key);
        if (!KEY_RE.test(key)) { errors.push(`${iat}: "key" must be an identifier, got "${key}"`); return; }
        const type = str(inp.type) || 'text';
        if (!INPUT_TYPES.has(type)) {
          errors.push(`${iat} ("${key}"): type must be text|select|remote-select|task-browser, got "${type}"`);
          return;
        }
        const optionsFrom = str(inp.optionsFrom) || null;
        if (type === 'remote-select' && !optionsFrom) {
          errors.push(`${iat} ("${key}"): remote-select needs "optionsFrom" (a connector op name)`);
        }
        if (optionsFrom && !KEY_RE.test(optionsFrom)) errors.push(`${iat} ("${key}"): "optionsFrom" must be an identifier`);
        const options = normOptions(inp.options);
        if (type === 'select' && !options.length) errors.push(`${iat} ("${key}"): select inputs need "options"`);
        inputs.push({ key, type, label: str(inp.label) || key, default: inp.default ?? null, optionsFrom, options });
      });

      const browsers = inputs.filter((x) => x.type === 'task-browser').length;
      if (browsers !== 1) {
        errors.push(`${at} ("${id}"): must declare exactly ONE input of type "task-browser" (found ${browsers}) — it is what produces the task (spec §7.4)`);
      }
      // multiProfile: the source can hold several independent configurations
      // (two Jira servers, two GitHub orgs), each bound to a project/workspace.
      // Opt-in, because it changes the settings UI from one form to a roster —
      // a single-instance source should not pay that.
      taskSources.push({
        id, displayName: str(s.displayName) || id, module, configSchema, inputs,
        multiProfile: s.multiProfile === true,
      });
    });
  }
  const ids = taskSources.map((s) => s.id);
  for (const dup of new Set(ids.filter((v, i) => v && ids.indexOf(v) !== i))) {
    errors.push(`${where}: duplicate taskSources id "${dup}"`);
  }

  // chatChannels (API 2): persistent channel workers. Same configSchema field
  // semantics as taskSources; deliberately NO task-browser/inputs machinery.
  const channelsRaw = raw.chatChannels ?? [];
  const chatChannels = [];
  if (!Array.isArray(channelsRaw)) {
    errors.push(`${where}: "chatChannels" must be an array`);
  } else {
    channelsRaw.forEach((c, i) => {
      const at = `${where}: chatChannels[${i}]`;
      if (!c || typeof c !== 'object') { errors.push(`${at} must be an object`); return; }
      collectUnknown(c, KNOWN_CHANNEL, at, warnings);
      const id = str(c.id);
      if (!SOURCE_ID_RE.test(id)) errors.push(`${at}: "id" must be kebab-case, got "${id}"`);
      const platform = str(c.platform).toLowerCase();
      if (!platform || !SOURCE_ID_RE.test(platform)) {
        errors.push(`${at} ("${id}"): "platform" must be a non-empty kebab-case hint (e.g. "telegram")`);
      }
      const module = str(c.module);
      const modErr = badModulePath(module);
      if (modErr) errors.push(`${at} ("${id}"): "module" ${modErr}`);
      const ingress = str(c.ingress) || 'connect';
      if (!CHANNEL_INGRESS.has(ingress)) {
        errors.push(`${at} ("${id}"): "ingress" must be connect|webhook, got "${ingress}"`);
      }
      const capsRaw = c.capabilities && typeof c.capabilities === 'object' ? c.capabilities : {};
      const capabilities = {
        inbound: capsRaw.inbound !== false,
        outbound: capsRaw.outbound !== false,
      };
      if (!capabilities.inbound && !capabilities.outbound) {
        errors.push(`${at} ("${id}"): capabilities cannot disable both inbound and outbound`);
      }
      const configSchema = normConfigSchema(c.configSchema, at, errors, warnings);
      chatChannels.push({ id, displayName: str(c.displayName) || id, platform, module, ingress, capabilities, configSchema });
    });
  }
  const chIds = chatChannels.map((c) => c.id);
  for (const dup of new Set(chIds.filter((v, i) => v && chIds.indexOf(v) !== i))) {
    errors.push(`${where}: duplicate chatChannels id "${dup}"`);
  }
  // models + modelSecrets (design §9.1). Manifest-only contribution: no files
  // to check, so ALL validation lives here. Write-time env rules mirror the
  // global-catalog setters (settings.mjs assertEnvPairs): reserved keys are a
  // hard error — the spawn-time prepareModelEnv drop stays as the second gate.
  const secretsRaw = raw.modelSecrets ?? [];
  const modelSecrets = [];
  if (!Array.isArray(secretsRaw)) {
    errors.push(`${where}: "modelSecrets" must be an array`);
  } else {
    secretsRaw.forEach((f, i) => {
      const at = `${where}: modelSecrets[${i}]`;
      if (!f || typeof f !== 'object') { errors.push(`${at} must be an object`); return; }
      collectUnknown(f, KNOWN_MODEL_SECRET, at, warnings);
      const key = str(f.key);
      if (!KEY_RE.test(key)) { errors.push(`${at}: "key" must be an identifier, got "${key}"`); return; }
      modelSecrets.push({ key, label: str(f.label) || key });
    });
    const skeys = modelSecrets.map((f) => f.key);
    for (const dup of new Set(skeys.filter((v, i) => skeys.indexOf(v) !== i))) {
      errors.push(`${where}: duplicate modelSecrets key "${dup}"`);
    }
  }
  const secretKeys = new Set(modelSecrets.map((f) => f.key));

  const modelsRaw = raw.models ?? [];
  const models = [];
  if (!Array.isArray(modelsRaw)) {
    errors.push(`${where}: "models" must be an array`);
  } else {
    modelsRaw.forEach((m, i) => {
      const at = `${where}: models[${i}]`;
      if (!m || typeof m !== 'object') { errors.push(`${at} must be an object`); return; }
      collectUnknown(m, KNOWN_MODEL, at, warnings);
      const id = str(m.id);
      if (!id) { errors.push(`${at}: "id" is required`); return; }
      const efforts = [];
      if (m.efforts !== undefined) {
        if (!Array.isArray(m.efforts)) { errors.push(`${at} ("${id}"): "efforts" must be an array`); return; }
        for (const e of m.efforts) {
          if (!EFFORTS.includes(e)) { errors.push(`${at} ("${id}"): unknown effort ${JSON.stringify(e)} — must be one of ${EFFORTS.join(' | ')}`); return; }
        }
        efforts.push(...EFFORTS.filter((e) => m.efforts.includes(e))); // canonical order, deduped
      }
      const env = {};
      const envRaw = m.env && typeof m.env === 'object' && !Array.isArray(m.env) ? m.env : {};
      if (m.env !== undefined && (typeof m.env !== 'object' || Array.isArray(m.env))) {
        errors.push(`${at} ("${id}"): "env" must be an object`);
        return;
      }
      for (const [k, v] of Object.entries(envRaw)) {
        // Reserved keys degrade, never reject: a published manifest is a
        // third-party artifact its user cannot edit, and the spawn-time filter
        // (model-env.mjs prepareModelEnv) drops these defensively anyway — so a
        // host that grows the reserved list (e.g. CLAUDE_CODE_SUBAGENT_MODEL)
        // must not retroactively brick installed/marketplace plugins. The
        // user's own catalog (settings.mjs) still hard-rejects: that author CAN fix it.
        if (isReservedModelEnvKey(k)) { warnings.push(`${at} ("${id}"): env key ${JSON.stringify(k)} is reserved — ignored`); continue; }
        if (isSecretRef(v)) {
          if (!secretKeys.has(v.secret)) { errors.push(`${at} ("${id}"): env ${k} references undeclared modelSecrets key ${JSON.stringify(v.secret)}`); continue; }
          env[k] = { secret: v.secret };
        } else if (typeof v === 'string' && v) {
          env[k] = v;
        } else {
          errors.push(`${at} ("${id}"): env value for ${JSON.stringify(k)} must be a non-empty string or {"secret": "<key>"}`);
        }
      }
      // A plugin that ships a model routed at its OWN endpoint is exactly the
      // case that needs a price pinned (the CLI would price it by NAME), so a
      // manifest may carry `cost` — same shape, same validator as a global
      // catalog entry (model-env.mjs). A user's global entry for the same id
      // still wins, as it does for label/efforts/env (§9.3).
      let cost;
      try {
        cost = assertModelCost(m.cost);
      } catch (e) {
        errors.push(`${at} ("${id}"): ${e.message}`);
        return;
      }
      models.push({
        id, label: str(m.label) || id,
        efforts: efforts.length ? efforts : [...EFFORTS],
        ...(Object.keys(env).length ? { env } : {}),
        ...(cost ? { cost } : {}),
      });
    });
    const mids = models.map((m) => m.id.toLowerCase());
    for (const dup of new Set(mids.filter((v, i) => mids.indexOf(v) !== i))) {
      errors.push(`${where}: duplicate models id "${dup}" (ids are case-insensitive)`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    manifest: {
      name, version,
      description: str(raw.description), author: str(raw.author),
      homepage: str(raw.homepage), license: str(raw.license),
      engines: { worcaApi }, setup, taskSources, chatChannels, models, modelSecrets,
    },
  };
}

/**
 * Depth-first scan for symlinks whose target resolves OUTSIDE `root`.
 * Returns root-relative link paths. Does not follow symlinked dirs (no loops).
 * Used here for validate, and by plugin-repo.mjs exportVersion (which deletes
 * them — git archive preserves symlinks, spec §4.3/§6.1).
 */
export function findEscapingSymlinks(root) {
  const rootAbs = resolve(root);
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) {
        let target;
        try { target = readlinkSync(p); } catch { continue; }
        const abs = isAbsolute(target) ? resolve(target) : resolve(dirname(p), target);
        if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) out.push(p.slice(rootAbs.length + 1));
      } else if (e.isDirectory()) {
        walk(p);
      }
    }
  };
  walk(rootAbs);
  return out;
}

/**
 * Validate a plugin DIRECTORY (spec §6.6): manifest parse/normalize, module
 * files exist, agents md/meta pairing + key regex, workflows reference only
 * the plugin's own agent keys, skills have SKILL.md, escaping symlinks.
 * strict: unknown-field warnings become errors.
 * @returns {{ok:boolean, manifest:object|null, problems:Array<{level:'error'|'warn', message:string}>}}
 */
export function validatePluginDir(absDir, { strict = false } = {}) {
  const problems = [];
  const push = (level, message) => problems.push({ level, message });

  let manifest = null;
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(join(absDir, 'worca-cc-plugin.json'), 'utf8'));
  } catch (err) {
    push('error', `worca-cc-plugin.json: ${err.code === 'ENOENT' ? 'missing' : `invalid JSON (${err.message})`}`);
  }
  if (raw !== null) {
    const res = normalizeManifest(raw, { dir: absDir });
    if (!res.ok) for (const e of res.errors) push('error', e);
    else {
      manifest = res.manifest;
      for (const w of res.warnings) push(strict ? 'error' : 'warn', w);
    }
  }

  if (manifest) {
    for (const s of manifest.taskSources) {
      if (!existsSync(join(absDir, s.module))) push('error', `taskSources "${s.id}": module ${s.module} not found`);
    }
    for (const c of manifest.chatChannels) {
      if (!existsSync(join(absDir, c.module))) push('error', `chatChannels "${c.id}": module ${c.module} not found`);
    }
  }

  // agents/: <key>.md + <key>.meta.json pairs, existing dual-file format (§4.2).
  // API 3: the sidecar must pass the SAME meta v2 gate the agent-store save path
  // applies, every failed rule named. ALL capability fields are open to plugins
  // (verdict, sideEffect, mockRole, workspace*, placeable, …) — the gate is the
  // schema, not an allow-list.
  const agentKeys = new Set();
  // Keys whose sidecar EXISTS but was rejected by a gate below. They are not
  // shipped (no ports), yet they are not foreign either — the workflows block
  // owes a template that references one a single accurate cause rather than
  // "this plugin does not ship it" or the derived V4/V5/V20/V21 cascade.
  const ungatedKeys = new Set();
  const ownMetas = [];
  // A range that admits the CURRENT API (or no engines at all) claims to be an
  // API-3 plugin, so v1-shaped data is a hard error; --strict promotes it for
  // everyone else, because that flag is the plugin AUTHOR's gate. A manifest
  // that did not PARSE fails SOFT: its declared API is unknowable, and the JSON
  // error above is already the only actionable line.
  const hardData = raw !== null
    && (strict || negotiatedApi(raw && raw.engines ? raw.engines['worca-cc-api'] : '') === WORCA_PLUGIN_API);
  const dataLevel = hardData ? 'error' : 'warn';
  const agentsDir = join(absDir, 'agents');
  if (existsSync(agentsDir)) {
    const files = readdirSync(agentsDir);
    for (const f of files.filter((x) => x.endsWith('.meta.json'))) {
      const stem = f.slice(0, -'.meta.json'.length);
      let meta = null;
      try { meta = JSON.parse(readFileSync(join(agentsDir, f), 'utf8')); }
      catch { push('error', `agents/${f}: invalid JSON`); continue; }
      const key = typeof meta?.key === 'string' ? meta.key : '';
      if (!KEY_RE.test(key)) { push('error', `agents/${f}: "${key}" must be a valid agent key (letters/digits/_-)`); continue; }
      if (key !== stem) push('error', `agents/${f}: key "${key}" must match the filename stem "${stem}"`);
      if (!files.includes(`${stem}.md`)) push('error', `agents/${f}: missing sibling ${stem}.md`);
      // Path traversal is never softened by dataLevel: an escaping agentFile is
      // a security defect in a v1 sidecar exactly as in a v2 one, and it is
      // checked BEFORE the meta gate so exactly one cause is reported.
      const afErr = badAgentFile(meta.agentFile, agentsDir);
      if (afErr) { push('error', `agents/${f}: "agentFile" ${afErr}`); ungatedKeys.add(key); continue; }
      if (Number(meta.metaVersion) !== 2) { push(dataLevel, `agents/${f}: ${NOT_META_V2}`); ungatedKeys.add(key); continue; }
      const { errors } = validateMetaV2(meta);
      for (const e of errors) push('error', `agents/${f}: ${e}`);
      if (errors.length) { ungatedKeys.add(key); continue; }
      // BELOW every gate: a rejected sidecar ships no ports, so counting its key
      // as shipped is what let a ports-less node reach validateGraph.
      agentKeys.add(key);
      ownMetas.push(normalizeAgentMeta(meta).meta);
    }
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      const stem = f.slice(0, -3);
      if (!files.includes(`${stem}.meta.json`)) {
        push('warn', `agents/${f}: no ${stem}.meta.json sidecar — the registry will ignore it`);
      }
    }
  }

  // skills/<name>/SKILL.md required (rides the existing injection mechanism, §9.2)
  const skillsDir = join(absDir, 'skills');
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
      if (d.isDirectory() && !existsSync(join(skillsDir, d.name, 'SKILL.md'))) {
        push('error', `skills/${d.name}: missing SKILL.md`);
      }
    }
  }

  // workflows/*.json are v2 GRAPHS (API 3), validated by the SAME shared
  // validator the composer and POST /api/workflows use, over a ports function
  // built from this plugin's OWN sidecars plus the engine's flow-card ports.
  // The isolation rule stays: a template may reference only keys this plugin
  // ships, so a host rename or a deleted user agent can never break it.
  const wfDir = join(absDir, 'workflows');
  if (existsSync(wfDir)) {
    const portsFn = portsFnFor(indexByKey(ownMetas));
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.json'))) {
      let tpl = null;
      try { tpl = JSON.parse(readFileSync(join(wfDir, f), 'utf8')); }
      catch { push('error', `workflows/${f}: invalid JSON`); continue; }
      if (Number(tpl?.version) !== 2) { push(dataLevel, `workflows/${f}: ${NOT_GRAPH_V2}`); continue; }
      const nodes = Array.isArray(tpl.nodes) ? tpl.nodes : [];
      const keys = nodes.filter((n) => n && n.kind === 'agent').map((n) => n.key).filter(Boolean);
      let unresolved = false;
      for (const k of new Set(keys)) {
        if (agentKeys.has(k)) continue;
        if (ungatedKeys.has(k)) {
          // The sidecar is this plugin's, it just did not pass. Report at the
          // DATA level so an API-1 plugin keeps installing (spec §9) instead of
          // being refused for a template that is fine.
          push(dataLevel, `workflows/${f}: references agent key "${k}" whose sidecar is not a valid meta v2 sidecar`);
        } else {
          push('error', `workflows/${f}: references agent key "${k}" which this plugin does not ship`);
        }
        unresolved = true;
      }
      // An unresolved key has no ports, so every wire touching it would also
      // fire V4/V5 — one clear cause beats five derived ones.
      if (unresolved) continue;
      const { errors, warnings } = validateGraph(
        { ...tpl, nodes, wires: Array.isArray(tpl.wires) ? tpl.wires : [] }, portsFn,
      );
      for (const e of errors) push('error', `workflows/${f}: ${e.code}: ${e.message}`);
      for (const w of warnings) push('warn', `workflows/${f}: ${w.code}: ${w.message}`);
    }
  }

  for (const rel of findEscapingSymlinks(absDir)) push('error', `symlink escapes the plugin dir: ${rel}`);

  return { ok: manifest !== null && !problems.some((p) => p.level === 'error'), manifest, problems };
}
