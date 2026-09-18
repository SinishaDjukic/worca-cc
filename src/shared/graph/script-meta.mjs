// src/shared/graph/script-meta.mjs
// Script sidecar v2 (`scripts/<key>.meta.json`, spec §3): ONE normalizer +
// validator for the registry loader (skip + warn), the plugin validator (hard
// error), the P2 store (400) and the inspector (live hints). Pure like
// agent-meta.mjs, and it REUSES agent-meta's port readers with `noPromptFields`:
// a script port is an agent port minus `as`, `directive` and `expands` — never a
// second port grammar.
import { PORT_ID_RE } from './constants.mjs';
import { readInputs, readOutputs, readVerdict, derivePortSummary, DEFAULT_ORDER } from './agent-meta.mjs';

/** Keys share ONE namespace with agents (D16), so the shape is the agent key's. */
const SCRIPT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/;
const COLORS = new Set(['green', 'peach', 'red', 'blue', 'violet', 'amber']);
const PLATFORM_KEYS = new Set(['default', 'win32', 'darwin', 'linux']);

/** v1 runtimes (D2). `python` is P2: an unknown runtime is a sidecar error, never a run-time surprise. */
export const SCRIPT_RUNTIMES = Object.freeze(['node', 'shell']);
export const PARAM_TYPES = Object.freeze(['string', 'number', 'boolean', 'enum', 'command', 'code']);
/** The param types an import shows the user before saving (D18). */
export const CONFIRM_PARAM_TYPES = Object.freeze(['command', 'code']);
export const MAX_PARAMS = 16;
export const DEFAULT_TIMEOUT_MS = 600000;
export const MIN_TIMEOUT_MS = 1000;
/** 24 h. A timer delay above 2^31-1 ms (24.8 days) overflows and fires after ONE millisecond, so a
 *  "practically never" timeout would kill the script at once (measured, v4 T3). The cap is far below that. */
export const MAX_TIMEOUT_MS = 86400000;
/** Shell exit mapping (D8): 0 clean, 1 blocking, anything else an execution error. */
export const DEFAULT_EXIT_CODES = Object.freeze({ clean: Object.freeze([0]), blocking: Object.freeze([1]) });

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const plainBasename = (s) => typeof s === 'string' && s.trim() !== '' && !/[\\/]/.test(s) && !s.includes('..');
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

/** A per-platform value (`file`, `command`): a string, or `{ default, win32?, darwin?, linux? }`. */
export function resolvePlatformValue(value, platform) {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return null;
  return value[platform] ?? value.default ?? null;
}

function readPlatformValue(raw, field, err, check, what) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    if (!check(raw)) { err(`${field} ${what}`); return null; }
    return raw.trim();
  }
  if (!isObject(raw)) { err(`${field} must be a string or a per-platform map { default, win32?, darwin?, linux? }`); return null; }
  const out = {};
  let bad = false;
  for (const [k, v] of Object.entries(raw)) {
    if (!PLATFORM_KEYS.has(k)) { err(`${field}: unknown platform "${k}" — expected default, win32, darwin or linux`); bad = true; continue; }
    if (!check(v)) { err(`${field}.${k} ${what}`); bad = true; continue; }
    out[k] = v.trim();
  }
  if (out.default === undefined) { err(`${field}: a per-platform map needs a default entry`); bad = true; }
  return bad ? null : out;
}

/** '' when `value` fits the param's type, else the reason. Shared by the sidecar
 *  default check and by V22 (a placed card's `config.params`). */
export function paramValueError(param, value) {
  switch (param?.type) {
    case 'string': case 'command': case 'code':
      return typeof value === 'string' ? '' : `must be a string (got ${JSON.stringify(value)})`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? '' : `must be a finite number (got ${JSON.stringify(value)})`;
    case 'boolean':
      return typeof value === 'boolean' ? '' : `must be true or false (got ${JSON.stringify(value)})`;
    case 'enum':
      return typeof value === 'string' && (param.options || []).includes(value)
        ? '' : `must be one of ${(param.options || []).join(', ')} (got ${JSON.stringify(value)})`;
    default:
      return `has an unknown param type ${JSON.stringify(param?.type)}`;
  }
}

export function readParams(raw, err) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { err('params must be an array'); return []; }
  if (raw.length > MAX_PARAMS) err(`params: at most ${MAX_PARAMS} params (got ${raw.length})`);
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    if (!isObject(p)) { err('params: each param must be an object'); continue; }
    const id = typeof p.id === 'string' ? p.id.trim() : '';
    if (!PORT_ID_RE.test(id)) { err(`params: bad param id "${id}"`); continue; }
    if (seen.has(id)) { err(`params: duplicate param id "${id}"`); continue; }
    seen.add(id);
    if (!PARAM_TYPES.includes(p.type)) { err(`params.${id}: type must be one of ${PARAM_TYPES.join(', ')}`); continue; }
    const param = { id, type: p.type, required: !!p.required };
    if (nonEmpty(p.label)) param.label = p.label.trim();
    if (nonEmpty(p.description)) param.description = p.description.trim();
    if (p.type === 'enum') {
      const options = Array.isArray(p.options) ? p.options.filter(nonEmpty) : [];
      if (!options.length) err(`params.${id}: enum params need a non-empty options list of strings`);
      param.options = options;
    }
    if (p.type === 'code') {
      if (p.language !== 'js') err(`params.${id}: code params need language "js"`);
      param.language = 'js';
    }
    if (p.default !== undefined) {
      const bad = paramValueError(param, p.default);
      if (bad) err(`params.${id}: default ${bad}`);
      else param.default = p.default;
    }
    out.push(param);
  }
  return out;
}

export function readExitCodes(raw, err) {
  if (raw === undefined) return null;
  if (!isObject(raw)) { err('exitCodes must be { clean: int[], blocking: int[] }'); return null; }
  const list = (side) => {
    const v = raw[side];
    if (!Array.isArray(v) || !v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      err(`exitCodes.${side} must be a list of integers 0..255`);
      return null;
    }
    return [...new Set(v)];
  };
  const clean = list('clean');
  const blocking = list('blocking');
  if (!clean || !blocking) return null;
  const both = clean.filter((n) => blocking.includes(n));
  if (both.length) { err(`exitCodes: ${both.join(', ')} listed as both clean and blocking`); return null; }
  return { clean, blocking };
}

/** The §3 `mock` shape against a list of declared output ports. Returns error strings. */
export function mockErrors(mock, outputs) {
  if (!isObject(mock)) return ['mock must be an object { summary?, verdict?, outputs? }'];
  const errors = [];
  if (mock.summary !== undefined && typeof mock.summary !== 'string') errors.push('mock.summary must be a string');
  if (mock.verdict !== undefined && (!isObject(mock.verdict) || !Array.isArray(mock.verdict.issues))) errors.push('mock.verdict must be { issues: [...] }');
  if (mock.outputs !== undefined) {
    if (!isObject(mock.outputs)) errors.push('mock.outputs must be an object keyed by output port id');
    else {
      const byId = new Map((outputs || []).filter(Boolean).map((p) => [p.id, p]));
      for (const [id, spec] of Object.entries(mock.outputs)) {
        const port = byId.get(id);
        if (!port) errors.push(`mock.outputs.${id}: not a declared output port`);
        else if (port.type === 'void') errors.push(`mock.outputs.${id}: void ports carry no text`);
        else if (!isObject(spec) || typeof spec.text !== 'string') errors.push(`mock.outputs.${id}: must be { text: string }`);
      }
    }
  }
  return errors;
}

/** Two outputs may share one filename template only with an identical type (the agent rule). */
function sharedFilenameRule(outputs, err) {
  const typeByTemplate = new Map();
  for (const p of outputs) {
    if (!p.filename) continue;
    const prev = typeByTemplate.get(p.filename);
    if (prev === undefined) typeByTemplate.set(p.filename, p.type);
    else if (prev !== p.type) err(`outputs: filename template "${p.filename}" is shared by ports of different types`);
  }
}

/**
 * A placed node's `config.ports` for a `ports: "config"` sidecar (D14), or a
 * sidecar's `defaultPorts` — read through the SAME readers a sidecar's own ports
 * go through. The verdict is the SIDECAR's (never in config), so `hasVerdict`
 * decides whether a conditional output is legal here.
 * @returns {{ports: {inputs:Array, outputs:Array}|null, errors: string[]}}
 */
export function readConfigPorts(raw, { hasVerdict = false } = {}) {
  if (!isObject(raw)) return { ports: null, errors: ['ports config must be an object { inputs: [...], outputs: [...] }'] };
  const errors = [];
  const err = (m) => errors.push(m);
  const inputs = readInputs(raw.inputs, err, () => {}, { noPromptFields: true });
  const outputs = readOutputs(raw.outputs, hasVerdict, err, { allowEmptyOutputs: true, who: 'script' });
  sharedFilenameRule(outputs, err);
  return { ports: errors.length ? null : { inputs, outputs }, errors };
}

/** Pure validation for the plugin validator and the P2 store. Silent by design — the load path warns. */
export function validateScriptMetaV2(raw) {
  return { errors: normalizeScriptMeta(raw, { warn: () => {} }).errors };
}

/**
 * @param {object} raw parsed sidecar
 * @param {{warn?:(msg:string)=>void}} [opts]
 * @returns {{meta:object|null, errors:string[]}} meta is meaningful only when errors is empty
 */
export function normalizeScriptMeta(raw, opts = {}) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  const warn = typeof opts.warn === 'function' ? opts.warn : () => {};
  if (!isObject(raw)) return { errors: ['meta must be an object'], meta: null };

  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) err('key is required');
  else if (!SCRIPT_KEY_RE.test(key)) err(`key "${key}" is not a valid script key`);
  if (raw.metaVersion !== 2) err('sidecar requires metaVersion 2');
  const order = raw.order === undefined ? DEFAULT_ORDER : Number(raw.order);
  if (!Number.isFinite(order)) err('order must be a number');

  const runtime = SCRIPT_RUNTIMES.includes(raw.runtime) ? raw.runtime : null;
  if (!runtime) err(`runtime must be one of ${SCRIPT_RUNTIMES.join(', ')}`);

  const file = readPlatformValue(raw.file, 'file', err, plainBasename, 'must be a plain basename');
  // Worded "to run" on purpose (v3 S1): the purity guard scans RAW source — comments included — and reads the
  // module-loading keyword directly before a quote as a specifier. Keep that keyword out of every string and comment here.
  if (runtime === 'node' && !file) err('runtime "node" requires file: the program to run');
  const command = readPlatformValue(raw.command, 'command', err, nonEmpty, 'must be a non-empty string');
  if (runtime === 'node' && command) err('command is only legal on the shell runtime');

  const params = readParams(raw.params, err);
  if (runtime === 'shell' && !file && !command && !params.some((p) => p.type === 'command')) {
    err('runtime "shell" needs a command, a file, or a command-typed param');
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (raw.timeoutMs !== undefined) {
    if (!Number.isInteger(raw.timeoutMs) || raw.timeoutMs < MIN_TIMEOUT_MS) err(`timeoutMs must be an integer >= ${MIN_TIMEOUT_MS}`);
    else if (raw.timeoutMs > MAX_TIMEOUT_MS) err(`timeoutMs must be at most ${MAX_TIMEOUT_MS} (24 h)`);
    else timeoutMs = raw.timeoutMs;
  }
  const exitCodes = readExitCodes(raw.exitCodes, err);
  if (exitCodes && runtime === 'node') err('exitCodes is only legal on the shell runtime');

  const verdict = readVerdict(raw.verdict, err);
  const configPorts = raw.ports === 'config';
  if (raw.ports !== undefined && !configPorts) err('ports must be the literal "config" (or absent, with inputs/outputs declared)');
  let inputs = null;
  let outputs = null;
  let defaultPorts = null;
  if (configPorts) {
    if (raw.inputs !== undefined || raw.outputs !== undefined) err('ports: "config" and inputs/outputs are mutually exclusive');
    const dp = readConfigPorts(raw.defaultPorts, { hasVerdict: !!verdict });
    for (const e of dp.errors) err(`defaultPorts: ${e}`);
    defaultPorts = dp.ports;
  } else {
    inputs = readInputs(raw.inputs, err, warn, { noPromptFields: true });
    outputs = readOutputs(raw.outputs, !!verdict, err, { allowEmptyOutputs: true, who: 'script' });
    sharedFilenameRule(outputs, err);
  }

  let mock = null;
  if (raw.mock !== undefined && raw.mock !== null) {
    const me = mockErrors(raw.mock, configPorts ? (defaultPorts?.outputs || []) : outputs);
    for (const e of me) err(e);
    if (!me.length) mock = raw.mock;
  }

  const meta = {
    metaVersion: 2,
    key,
    displayName: nonEmpty(raw.displayName) ? raw.displayName.trim() : key,
    description: typeof raw.description === 'string' ? raw.description : '',
    color: COLORS.has(raw.color) ? raw.color : 'amber',
    icon: typeof raw.icon === 'string' ? raw.icon : '',
    domain: typeof raw.domain === 'string' && DOMAIN_RE.test(raw.domain) ? raw.domain : 'general',
    order: Number.isFinite(order) ? order : DEFAULT_ORDER,
    runtime,
    file,
    command,
    timeoutMs,
    params,
    portSummary: '',
  };
  if (exitCodes) meta.exitCodes = exitCodes;
  if (configPorts) {
    meta.ports = 'config';
    meta.defaultPorts = defaultPorts || { inputs: [], outputs: [] };
  } else {
    meta.inputs = inputs;
    meta.outputs = outputs;
  }
  meta.portSummary = derivePortSummary(configPorts ? meta.defaultPorts : meta);
  if (verdict) meta.verdict = verdict;
  if (mock) meta.mock = mock;
  if (raw.placeable !== undefined && !raw.placeable) meta.placeable = false;
  return { errors, meta };
}

/** The params a placed card runs with (spec §4.1): sidecar defaults overlaid by
 *  `node.config.params`. No project layer in v1 (D6). Pure; resolveGraph, the
 *  resume path, the import dry-run, the offline test runner and (P1b) the
 *  inspector all read it. */
export function effectiveScriptParams(meta, config) {
  const out = {};
  for (const p of Array.isArray(meta?.params) ? meta.params : []) if (p && p.default !== undefined) out[p.id] = p.default;
  const given = isObject(config?.params) ? config.params : {};
  for (const [id, v] of Object.entries(given)) if (v !== undefined) out[id] = v;
  return out;
}

/** The run-time facts of ONE placed script card — what resolveGraph puts in `nodes[id]`, what the
 *  resume path rebuilds from a manifest cell, what the offline test runner and (P1c) the bench build for
 *  a synthetic node. ONE builder, so a fresh run, a resumed run and a bench run cannot drift apart.
 *  `meta` is the registry entry (with its `scriptPath` / `commandResolved` stamps); an absent meta
 *  yields a stub the script preflight refuses. Pure. */
export function scriptNodeCtx(node, meta) {
  const cfg = isObject(node?.config) ? node.config : {};
  const m = isObject(meta) ? meta : {};
  return {
    nodeId: node?.id,
    kind: 'script',
    key: node?.key,
    authoredKey: node?.key,
    meta: m,
    runtime: m.runtime ?? null,
    file: m.scriptPath ?? null,                  // absolute, host platform (registry stamp)
    command: m.commandResolved ?? null,          // the sidecar's, host platform; a command param overrides at run time
    params: effectiveScriptParams(m, cfg),       // D6: no project layer in v1
    timeoutMs: Number.isInteger(cfg.timeoutMs) ? cfg.timeoutMs : (m.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    mock: isObject(cfg.mock) ? cfg.mock : (m.mock ?? null),
    config: { ...cfg },
    awaitAll: !!cfg.awaitAll,
    duplicateKey: false,
  };
}
