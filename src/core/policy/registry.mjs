// src/core/policy/registry.mjs
// The team-policy field registry (team-policy design §5): ONE list that drives document
// validation, the editor rows, the effective-policy table and the run-log lines. Pure —
// no I/O, no DB, importable from the browser bundle's tests as well as the core.
//
// Document shape (schema 1):
//   { schema, updatedAt, updatedBy, title, notes,
//     fields:        { '<key>': { kind, value, ...attrs } },
//     workspaceRuns: { '<key>': { kind, value, ...attrs } },   // replaces `fields` for workspace runs
//     catalogs:      { guardrailSets: [...], models: [...] } }
// A delegate marker is the same file with `delegateTo` and no fields.
//
// Kinds: 'default' (the developer's value wins when set), 'soft' (the tighter/expected value
// applies, the developer may go past it and the overshoot is recorded), 'hard' (RESERVED:
// accepted on read, downgraded to soft with a warning — a later version enforces it without a
// format change). Every field lists the kinds it accepts; the editor disables the rest.

export const POLICY_SCHEMA = 1;
export const KINDS = Object.freeze(['default', 'soft', 'hard']);
export const ON_BREACH = Object.freeze(['pause', 'warn']);
export const TIERS = Object.freeze(['permissive', 'normal', 'secure']);
export const WINDOWS = Object.freeze(['weekly', 'monthly']);
/** Text fields on the document (title, notes, updatedBy, override reasons) are clipped here. */
export const TEXT_MAX = 200;

const GROUPS = Object.freeze({
  cost: 'Cost', ask: 'Ask Worca', guardrails: 'Guardrails', models: 'Models', plugins: 'Plugins', runs: 'Runs',
});

/**
 * One row per policy key. `type` drives validation and the editor control; `kinds` is the
 * subset of KINDS the field accepts; `attrs` are the kind-specific extras a soft cap carries
 * (onBreach, requireReason) or an advisory figure needs (window); `local` names the Worca
 * setting the field governs today (informational: the effective layer reads it).
 */
export const FIELDS = Object.freeze([
  { key: 'cost.pipelineLimitUsd', group: 'cost', label: 'Per-pipeline cap (USD)', help: 'Pauses one pipeline at this estimated cost. Soft: the tighter of team and local applies; continue past it on resume.', type: 'usd', kinds: ['default', 'soft'], cap: true, attrs: ['onBreach', 'requireReason'], local: 'pipelineCostLimitUsd' },
  { key: 'cost.totalLimitUsd', group: 'cost', label: 'Total cap per period (USD)', help: 'Per developer, per reset period; pipelines and Ask Worca together.', type: 'usd', kinds: ['default', 'soft'], cap: true, attrs: ['onBreach', 'requireReason'], local: 'totalCostLimitUsd' },
  { key: 'cost.resetPeriod', group: 'cost', label: 'Reset period', help: 'The developer\'s own period wins when set.', type: 'enum', values: WINDOWS, kinds: ['default'], local: 'costLimitResetPeriod' },
  { key: 'cost.pooledBudgetUsd', group: 'cost', label: 'Pooled budget (USD)', help: 'Whole team, read from team metrics. Advisory: it never pauses a run.', type: 'usd', kinds: ['soft'], advisory: true, attrs: ['window'] },
  { key: 'ask.maxTurns', group: 'ask', label: 'Turn limit', help: 'Ask Worca agentic turns per chat turn.', type: 'int', min: 1, max: 500, kinds: ['default'], local: 'askMaxTurns' },
  { key: 'ask.maxBudgetUsd', group: 'ask', label: 'Per-turn cost cap (USD)', help: 'Ask Worca per-turn cap; null means no cap.', type: 'usd-or-null', min: 0.1, max: 100, kinds: ['default'], local: 'askMaxBudgetUsd' },
  { key: 'guardrails.default', group: 'guardrails', label: 'Default set', help: 'What the New pipeline picker starts on. A built-in id, a user set id, or gp:<name> for a set this policy ships.', type: 'string', kinds: ['default'] },
  { key: 'guardrails.minimum', group: 'guardrails', label: 'Minimum tier', help: 'A run whose set ranks below this warns and is recorded.', type: 'enum', values: TIERS, kinds: ['soft'] },
  { key: 'models.allowed', group: 'models', label: 'Allowed models', help: 'A chosen step model outside this list warns and is recorded. Others still run.', type: 'string[]', kinds: ['soft'] },
  { key: 'models.steps', group: 'models', label: 'Step defaults', help: 'Model and effort per role, applied to roles the project has not configured.', type: 'steps', kinds: ['default'] },
  { key: 'models.hideBuiltins', group: 'models', label: 'Hide built-in models', help: 'Cosmetic; ids still resolve.', type: 'bool', kinds: ['default'], local: 'hideBuiltinModels' },
  { key: 'plugins.marketplaces', group: 'plugins', label: 'Marketplaces', help: 'Added to every teammate once; a local removal is remembered.', type: 'string[]', kinds: ['default'] },
  { key: 'plugins.required', group: 'plugins', label: 'Required plugins', help: 'Missing or below the floor: the setup checklist offers to install, with consent. Never automatic.', type: 'plugins', kinds: ['soft'] },
  { key: 'plugins.blocked', group: 'plugins', label: 'Blocked plugins', help: 'An enabled blocked plugin warns and is recorded; it is never disabled for you.', type: 'string[]', kinds: ['soft'] },
  { key: 'workflows.default', group: 'runs', label: 'Default workflow', help: 'A built-in (wf_*) or plugin (wfp_*) workflow id. Applies when the project has no active workflow.', type: 'string', kinds: ['default'] },
  { key: 'run.humanInLoop', group: 'runs', label: 'Human in the loop', help: 'Applies until the project sets its own switch.', type: 'bool', kinds: ['default'] },
  { key: 'metrics.record', group: 'runs', label: 'Record runs to team metrics', help: 'Expected on: the Projects cell hints when "Include my runs" is off.', type: 'bool', kinds: ['soft'] },
  { key: 'worca.minVersion', group: 'runs', label: 'Minimum Worca version', help: 'An older client shows a banner and logs a note.', type: 'semver', kinds: ['soft'] },
]);

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

/** @returns {object|null} the registry row for a key */
export function fieldMeta(key) { return BY_KEY.get(key) || null; }
export function groupLabel(id) { return GROUPS[id] || id; }
export const GROUP_ORDER = Object.freeze(Object.keys(GROUPS));

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,199}$/;
const PLUGIN_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// The one import: the zero-import model-env leaf, for the bridged-model
// `upstream` validator every catalog layer shares (model-bridge-design.md §6.3).
import { assertModelUpstream, upstreamEnvConflict } from '../model-env.mjs';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (v, max = TEXT_MAX) => {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
};
const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A value that looks like a secret must never reach the branch (design §13). */
export function looksLikeSecret(v) {
  const s = String(v ?? '');
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(s)) return false;           // ${VAR} indirection is the sanctioned form
  if (/^(sk-|xox[abp]-|ghp_|gho_|github_pat_|glpat-|AKIA|eyJ[A-Za-z0-9_-]{10,}\.)/.test(s)) return true;
  return /^[A-Za-z0-9+/_=-]{40,}$/.test(s);                                 // a long opaque token
}

/**
 * Validate ONE field value against its registry type. Returns null when ok, else a message.
 * Shared by the editor (before publish) and the reader (dropping bad fields with a warning).
 */
export function validateValue(meta, value) {
  switch (meta.type) {
    case 'usd': return finiteNum(value) && value > 0 ? null : 'must be a positive number of USD';
    case 'usd-or-null':
      if (value === null) return null;
      return finiteNum(value) && value >= (meta.min ?? 0) && value <= (meta.max ?? Infinity) ? null : `must be null or a number between ${meta.min} and ${meta.max}`;
    case 'int': return Number.isInteger(value) && value >= (meta.min ?? -Infinity) && value <= (meta.max ?? Infinity) ? null : `must be an integer between ${meta.min} and ${meta.max}`;
    case 'bool': return typeof value === 'boolean' ? null : 'must be true or false';
    case 'enum': return meta.values.includes(value) ? null : `must be one of ${meta.values.join(' | ')}`;
    case 'string': return typeof value === 'string' && value.trim() && value.length <= TEXT_MAX ? null : 'must be a non-empty string';
    case 'semver': return typeof value === 'string' && SEMVER_RE.test(value) ? null : 'must be a version like 1.4.0';
    case 'string[]':
      if (!Array.isArray(value)) return 'must be a list';
      return value.every((x) => typeof x === 'string' && x.trim() && x.length <= TEXT_MAX) ? null : 'every entry must be a non-empty string';
    case 'steps': {
      if (!isPlainObject(value)) return 'must be an object of role → { model, effort }';
      for (const [role, sel] of Object.entries(value)) {
        if (!/^[a-z][a-z0-9-]{0,63}$/i.test(role)) return `role "${role}" is not a valid agent key`;
        if (!isPlainObject(sel)) return `role "${role}" must be { model, effort }`;
        if (sel.model != null && !(typeof sel.model === 'string' && MODEL_ID_RE.test(sel.model))) return `role "${role}": model must be a model id`;
        if (sel.effort != null && !EFFORTS.includes(sel.effort)) return `role "${role}": effort must be one of ${EFFORTS.join(' | ')}`;
      }
      return null;
    }
    case 'plugins': {
      if (!Array.isArray(value)) return 'must be a list of { name, marketplace, minVersion?, config? }';
      for (const p of value) {
        if (!isPlainObject(p)) return 'every entry must be an object';
        if (!(typeof p.name === 'string' && PLUGIN_NAME_RE.test(p.name))) return `"${p?.name}" is not a valid plugin name`;
        if (p.marketplace != null && !(typeof p.marketplace === 'string' && p.marketplace.trim())) return `${p.name}: marketplace must be a string`;
        if (p.minVersion != null && !(typeof p.minVersion === 'string' && SEMVER_RE.test(p.minVersion))) return `${p.name}: minVersion must be a version like 1.2.0`;
        if (p.config != null) {
          if (!isPlainObject(p.config)) return `${p.name}: config must be an object`;
          for (const [k, v] of Object.entries(p.config)) {
            if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return `${p.name}: config.${k} must be a string, number or boolean`;
            if (typeof v === 'string' && looksLikeSecret(v)) return `${p.name}: config.${k} looks like a secret — secrets never go on the branch`;
          }
        }
      }
      return null;
    }
    default: return 'unknown field type';
  }
}

/**
 * Normalise ONE field entry ({kind, value, ...attrs}) against its registry row.
 * @returns {{entry:object|null, warning:string|null}} entry null = drop it
 */
export function normalizeEntry(key, raw) {
  const meta = fieldMeta(key);
  if (!meta) return { entry: null, warning: `unknown field ${key}` };
  if (!isPlainObject(raw)) return { entry: null, warning: `${key}: not an object` };
  let kind = KINDS.includes(raw.kind) ? raw.kind : null;
  if (!kind) return { entry: null, warning: `${key}: kind must be one of ${KINDS.join(' | ')}` };
  let warning = null;
  if (!meta.kinds.includes(kind)) {
    // A kind the field does not accept: `hard` is the documented downgrade; anything else is
    // a hand edit the editor would never produce.
    if (kind === 'hard' && meta.kinds.includes('soft')) { warning = `${key}: hard constraints are not enforced by this version — treated as soft`; }
    else if (kind === 'hard' && meta.kinds.includes('default')) { warning = `${key}: hard constraints are not enforced by this version — treated as default`; }
    else return { entry: null, warning: `${key}: kind "${kind}" is not allowed (accepts ${meta.kinds.join(' | ')})` };
  }
  const err = validateValue(meta, raw.value);
  if (err) return { entry: null, warning: `${key}: ${err}` };
  const entry = { kind, value: raw.value };
  for (const a of meta.attrs || []) {
    if (raw[a] === undefined) continue;
    if (a === 'onBreach') { if (ON_BREACH.includes(raw[a])) entry.onBreach = raw[a]; else warning ||= `${key}: onBreach must be pause | warn (ignored)`; }
    else if (a === 'requireReason') { if (typeof raw[a] === 'boolean') entry.requireReason = raw[a]; else warning ||= `${key}: requireReason must be true | false (ignored)`; }
    else if (a === 'window') { if (WINDOWS.includes(raw[a])) entry.window = raw[a]; else warning ||= `${key}: window must be weekly | monthly (ignored)`; }
  }
  return { entry, warning };
}

/** The kind the RUNTIME applies: hard is reserved and reads as soft (or default when the field is default-only). */
export function effectiveKind(meta, kind) {
  if (kind !== 'hard') return kind;
  return meta.kinds.includes('soft') ? 'soft' : 'default';
}

function normalizeFieldMap(raw, warnings, prefix = '') {
  const out = {};
  if (raw == null) return out;
  if (!isPlainObject(raw)) { warnings.push(`${prefix || 'fields'}: not an object — ignored`); return out; }
  for (const key of Object.keys(raw)) {
    const { entry, warning } = normalizeEntry(key, raw[key]);
    if (warning) warnings.push(prefix ? `${prefix}.${warning}` : warning);
    if (entry) out[key] = entry;
  }
  return out;
}

const GUARDRAIL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function normalizeGuardrailSets(raw, warnings) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) { warnings.push('catalogs.guardrailSets: not a list — ignored'); return []; }
  const out = []; const seen = new Set();
  for (const s of raw) {
    if (!isPlainObject(s) || typeof s.id !== 'string' || !GUARDRAIL_ID_RE.test(s.id)) { warnings.push('catalogs.guardrailSets: an entry without a valid id was dropped'); continue; }
    const id = s.id.toLowerCase();
    if (seen.has(id)) { warnings.push(`catalogs.guardrailSets: duplicate id ${s.id} dropped`); continue; }
    seen.add(id);
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
    out.push({
      id: s.id, name: clip(typeof s.name === 'string' && s.name.trim() ? s.name : s.id, 80),
      honorProjectSettings: s.honorProjectSettings !== false,
      envScrub: s.envScrub === true,
      envAllowlist: list(s.envAllowlist), protectedPaths: list(s.protectedPaths), deny: list(s.deny),
    });
  }
  return out;
}

function normalizeModels(raw, warnings) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) { warnings.push('catalogs.models: not a list — ignored'); return []; }
  const out = []; const seen = new Set();
  for (const m of raw) {
    if (!isPlainObject(m) || typeof m.id !== 'string' || !MODEL_ID_RE.test(m.id)) { warnings.push('catalogs.models: an entry without a valid id was dropped'); continue; }
    const lc = m.id.toLowerCase();
    if (seen.has(lc)) { warnings.push(`catalogs.models: duplicate id ${m.id} dropped`); continue; }
    const entry = { id: m.id, label: clip(typeof m.label === 'string' && m.label.trim() ? m.label : m.id, 80) };
    const efforts = Array.isArray(m.efforts) ? m.efforts.filter((e) => EFFORTS.includes(e)) : [];
    entry.efforts = efforts.length ? efforts : ['medium', 'high'];
    if (m.env != null) {
      if (!isPlainObject(m.env)) { warnings.push(`catalogs.models: ${m.id}: env is not an object — dropped`); continue; }
      const env = {}; let bad = null;
      for (const [k, v] of Object.entries(m.env)) {
        if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(k)) { bad = `env key ${k} is not a valid variable name`; break; }
        if (/^WORCA_/.test(k)) { bad = `env key ${k} is reserved`; break; }
        if (typeof v !== 'string' || !v) { bad = `env ${k} must be a non-empty string`; break; }
        if (looksLikeSecret(v)) { bad = `env ${k} looks like a secret — use \${VAR} indirection`; break; }
        env[k] = v;
      }
      if (bad) { warnings.push(`catalogs.models: ${m.id}: ${bad} — entry dropped`); continue; }
      entry.env = env;
    }
    // A bridged model (model-bridge-design.md §6.3): a policy may ship the
    // upstream shape but never a credential — the apiKey must be a ${VAR} ref
    // and a copilot entry resolves against each developer's own sign-in.
    if (m.upstream != null) {
      let upstream;
      try {
        upstream = assertModelUpstream(m.upstream);
        if (upstream && upstream.apiKey && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(upstream.apiKey)) throw new Error('upstream.apiKey must be a ${VAR} reference');
        const clash = upstream ? upstreamEnvConflict(entry.env) : null;
        if (clash) throw new Error(`env key ${clash} is set by the bridge for an upstream entry`);
      } catch (e) {
        warnings.push(`catalogs.models: ${m.id}: ${e.message} — entry dropped`); continue;
      }
      if (upstream) entry.upstream = upstream;
    }
    seen.add(lc);
    out.push(entry);
  }
  return out;
}

/**
 * Normalise a raw document read from the branch (or posted by the editor). NEVER throws:
 * malformed pieces are dropped with a warning each (the readRemoteConfig lesson), so a hand
 * edit can never break the API. `schema` above POLICY_SCHEMA marks the whole document
 * unusable (`unknownSchema`), and the caller falls back to local settings loudly.
 * @returns {{doc:object|null, warnings:string[], unknownSchema:boolean, delegateTo:string|null}}
 */
export function normalizePolicyDoc(raw) {
  const warnings = [];
  if (!isPlainObject(raw)) return { doc: null, warnings: ['policy.json is not a JSON object'], unknownSchema: false, delegateTo: null };
  const schema = Number.isInteger(raw.schema) ? raw.schema : 1;
  if (schema > POLICY_SCHEMA) return { doc: null, warnings: [`policy.json schema ${schema} needs a newer Worca (this one reads ${POLICY_SCHEMA})`], unknownSchema: true, delegateTo: null };
  const delegateTo = typeof raw.delegateTo === 'string' && raw.delegateTo.trim() ? raw.delegateTo.trim().toLowerCase() : null;
  const doc = {
    schema,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: clip(typeof raw.updatedBy === 'string' ? raw.updatedBy : null, 120),
    title: clip(typeof raw.title === 'string' ? raw.title : '', 120) || '',
    notes: clip(typeof raw.notes === 'string' ? raw.notes : '', 2000) || '',
    fields: normalizeFieldMap(raw.fields, warnings),
    workspaceRuns: normalizeFieldMap(raw.workspaceRuns, warnings, 'workspaceRuns'),
    catalogs: {
      guardrailSets: normalizeGuardrailSets(raw.catalogs?.guardrailSets, warnings),
      models: normalizeModels(raw.catalogs?.models, warnings),
    },
  };
  if (delegateTo) doc.delegateTo = delegateTo;
  return { doc, warnings, unknownSchema: false, delegateTo };
}

/** A fresh, empty policy: what "Set up team policy → here" writes. */
export function emptyPolicyDoc({ updatedBy = null, title = '', now = new Date() } = {}) {
  return {
    schema: POLICY_SCHEMA,
    updatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    updatedBy, title: title || '', notes: '',
    fields: {}, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] },
  };
}

/** Canonical key order (registry order inside `fields`), so branch diffs stay readable. */
export function serializePolicyDoc(doc) {
  const ordered = (map) => {
    const out = {};
    for (const f of FIELDS) if (map && map[f.key]) out[f.key] = map[f.key];
    return out;
  };
  const body = {
    schema: doc.schema ?? POLICY_SCHEMA,
    updatedAt: doc.updatedAt ?? null,
    updatedBy: doc.updatedBy ?? null,
    title: doc.title ?? '',
    notes: doc.notes ?? '',
    ...(doc.delegateTo ? { delegateTo: doc.delegateTo } : {}),
    fields: ordered(doc.fields),
    workspaceRuns: ordered(doc.workspaceRuns),
    catalogs: { guardrailSets: doc.catalogs?.guardrailSets ?? [], models: doc.catalogs?.models ?? [] },
  };
  return JSON.stringify(body, null, 2) + '\n';
}

/** Rank a guardrail tier (or a set's contents) for the minimum-tier rule: permissive < normal < secure. */
export function tierRank(idOrSet) {
  if (typeof idOrSet === 'string') { const i = TIERS.indexOf(idOrSet); return i === -1 ? null : i; }
  if (!isPlainObject(idOrSet)) return null;
  const s = idOrSet.settings && isPlainObject(idOrSet.settings) ? idOrSet.settings : idOrSet;
  if (s.envScrub === true) return 2;
  if ((Array.isArray(s.deny) && s.deny.length) || (Array.isArray(s.protectedPaths) && s.protectedPaths.length)) return 1;
  return 0;
}

/** "1.4.0" >= "1.3.2" → true; prerelease tags are ignored. */
export function semverAtLeast(have, min) {
  const p = (v) => String(v || '').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const a = p(have); const b = p(min);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) > (b[i] || 0)) return true; if ((a[i] || 0) < (b[i] || 0)) return false; }
  return true;
}
