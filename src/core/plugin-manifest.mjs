// src/core/plugin-manifest.mjs
// Parse + validate `worca-cc-plugin.json` (plugin spec §4.1) and whole plugin
// dirs (§6.6 `worca plugin validate [--strict]`). Pure: fs reads only, no
// writes, no DB, no worcaHome — callers pass absolute dirs.
//
// `validateMetaV2` is the ONE sidecar gate (agent-store's save path uses the
// same function): a plugin agent is held to exactly the rules a user agent is,
// so nothing installs that the registry would then silently skip at load. It is
// a pure function over a parsed object — importing it keeps this module's
// no-writes/no-DB contract intact.

import { readFileSync, readdirSync, readlinkSync, existsSync } from 'node:fs';
import { join, resolve, dirname, sep, isAbsolute } from 'node:path';
import { WORCA_PLUGIN_API } from './plugin-api.mjs';
import { validateMetaV2 } from './agent-registry.mjs';

/** Plugin names are kebab-case, machine-unique, dir-name safe (spec §4.1). */
export const PLUGIN_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Private copy of agent-registry.mjs:175 AGENT_KEY_RE (module-private there;
 *  agent-store.mjs:15 duplicates it the same way). */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const FIELD_TYPES = new Set(['text', 'select']);
const INPUT_TYPES = new Set(['text', 'select', 'remote-select', 'task-browser']);
const KNOWN_TOP = new Set(['name', 'version', 'description', 'author', 'homepage', 'license', 'engines', 'taskSources', 'setup']);
const KNOWN_SOURCE = new Set(['id', 'displayName', 'module', 'configSchema', 'inputs']);
const KNOWN_FIELD = new Set(['key', 'type', 'label', 'secret', 'required', 'default', 'help', 'options']);
const KNOWN_INPUT = new Set(['key', 'type', 'label', 'default', 'optionsFrom', 'options']);

/**
 * Tiny '>=N <M' / '>=N' / exact 'N' range check against the integer host API.
 * NO npm semver dep (repo rule: runtime deps are express+ws only). Clauses are
 * whitespace-separated and AND-ed; minor/patch digits are tolerated but ignored
 * (the API version is an integer). Unset/blank -> true (no constraint); any
 * unparseable token -> false (fail CLOSED: an unintelligible constraint must
 * not install).
 */
export function apiSatisfies(range, api = WORCA_PLUGIN_API) {
  const spec = typeof range === 'string' ? range.trim() : '';
  if (!spec) return true;
  for (const tok of spec.split(/\s+/)) {
    const m = /^(>=|<=|>|<|=)?(\d+)(?:\.\d+){0,2}$/.exec(tok);
    if (!m) return false;
    const op = m[1] || '=';
    const n = Number(m[2]);
    const ok = op === '>=' ? api >= n : op === '<=' ? api <= n
      : op === '>' ? api > n : op === '<' ? api < n : api === n;
    if (!ok) return false;
  }
  return true;
}

/** The host API the range was BUILT FOR: the lowest integer it accepts. ">=1 <2"
 *  and "1" both answer 1. Probing beats parsing — apiSatisfies is the only
 *  authority on what a range means, and this way the two can never disagree.
 *  null when nothing satisfies it (an unparseable range fails closed there too).
 *  @param {string} range
 *  @returns {number|null} */
export function declaredApi(range) {
  for (let n = 0; n <= 99; n += 1) if (apiSatisfies(range, n)) return n;
  return null;
}

/**
 * The Plugins-view api-mismatch payload (spec §5) for a manifest's engines
 * range, or null when the host satisfies it. An API-incompatible plugin is not
 * corrupt: its manifest simply stops normalizing, so it drops out of the
 * registry while its files stay on disk. The card needs to say which API it was
 * built for, not just that something is wrong.
 * @param {string} range  engines['worca-cc-api']
 * @param {number} [api]
 * @returns {{builtFor: number|null, host: number}|null}
 */
export function apiMismatch(range, api = WORCA_PLUGIN_API) {
  if (apiSatisfies(range, api)) return null;
  return { builtFor: declaredApi(range), host: api };
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

function badModulePath(mod) {
  if (!mod) return 'is required';
  if (isAbsolute(mod) || /\\/.test(mod)) return 'must be a relative ./ path';
  if (!mod.startsWith('./')) return 'must start with "./"';
  if (mod.split('/').includes('..')) return 'must not contain ".."';
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
    errors.push(`${where}: engines.worca-cc-api "${worcaApi}" is not satisfied by host plugin API ${WORCA_PLUGIN_API}`);
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

      const configSchema = [];
      (Array.isArray(s.configSchema) ? s.configSchema : []).forEach((f, j) => {
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
      taskSources.push({ id, displayName: str(s.displayName) || id, module, configSchema, inputs });
    });
  }
  const ids = taskSources.map((s) => s.id);
  for (const dup of new Set(ids.filter((v, i) => v && ids.indexOf(v) !== i))) {
    errors.push(`${where}: duplicate taskSources id "${dup}"`);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    manifest: {
      name, version,
      description: str(raw.description), author: str(raw.author),
      homepage: str(raw.homepage), license: str(raw.license),
      engines: { worcaApi }, setup, taskSources,
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
  }

  // agents/: <key>.md + <key>.meta.json pairs, existing dual-file format (§4.2)
  const agentKeys = new Set();
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
      // API 2: the sidecar must pass the SAME meta v2 gate the agent-store save
      // path applies, every failed rule named. ALL capability fields are open to
      // plugins (verdict, sideEffect, mockRole, workspace*, placeable, …) — the
      // gate is the schema, not an allow-list. A v1 sidecar fails here on
      // `metaVersion 2` instead of installing and being skipped at registry load.
      for (const e of validateMetaV2(meta).errors) push('error', `agents/${f}: ${e}`);
      agentKeys.add(key);
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

  // workflows/*.json are v2 GRAPHS (API 2) and may reference ONLY the plugin's
  // own agent keys (§9.3). The isolation rule is DELIBERATE and stays: a plugin
  // template that wired in a builtin or user agent would break the moment the
  // host renamed one or the user deleted theirs, and the plugin could not ship a
  // fix. Full graph validation (V1-V21) belongs to the importer, which has a
  // live registry to resolve ports against; here only the shape the isolation
  // walk needs is checked.
  const wfDir = join(absDir, 'workflows');
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.json'))) {
      let tpl = null;
      try { tpl = JSON.parse(readFileSync(join(wfDir, f), 'utf8')); }
      catch { push('error', `workflows/${f}: invalid JSON`); continue; }
      if (Number(tpl?.version) !== 2) {
        push('error', `workflows/${f}: must be a version-2 graph template (worca-cc-api ${WORCA_PLUGIN_API}); "steps" templates are no longer read`);
        continue;
      }
      if (!Array.isArray(tpl.nodes)) { push('error', `workflows/${f}: "nodes" must be an array`); continue; }
      const keys = tpl.nodes.filter((n) => n && n.kind === 'agent').map((n) => n.key).filter(Boolean);
      for (const k of new Set(keys)) {
        if (!agentKeys.has(k)) push('error', `workflows/${f}: references agent key "${k}" which this plugin does not ship`);
      }
    }
  }

  for (const rel of findEscapingSymlinks(absDir)) push('error', `symlink escapes the plugin dir: ${rel}`);

  return { ok: manifest !== null && !problems.some((p) => p.level === 'error'), manifest, problems };
}
