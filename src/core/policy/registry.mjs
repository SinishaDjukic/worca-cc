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

import { domainError } from '../web-allowlist.mjs';
import { FIELD_LABELS } from '../../shared/away-mode/labels.mjs';

export const POLICY_SCHEMA = 1;
export const KINDS = Object.freeze(['default', 'soft', 'hard']);
export const ON_BREACH = Object.freeze(['pause', 'warn']);
export const TIERS = Object.freeze(['permissive', 'normal', 'secure']);
export const WINDOWS = Object.freeze(['weekly', 'monthly']);
/** Text fields on the document (title, notes, updatedBy, override reasons) are clipped here. */
export const TEXT_MAX = 200;

const GROUPS = Object.freeze({
  cost: 'Cost', ask: 'Ask Worca', guardrails: 'Guardrails', models: 'Models', plugins: 'Plugins', runs: 'Runs',
  night: 'Away mode',
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
  { key: 'cost.humanRateUsd', group: 'cost', label: 'Developer rate (USD/h)', help: 'Prices the estimated human hours behind "Saved". A developer\'s own rate wins when set.', type: 'usd', kinds: ['default'], local: 'humanRateUsdPerHour' },
  { key: 'ask.maxTurns', group: 'ask', label: 'Turn limit', help: 'Ask Worca agentic turns per chat turn.', type: 'int', min: 1, max: 500, kinds: ['default'], local: 'askMaxTurns' },
  { key: 'ask.maxBudgetUsd', group: 'ask', label: 'Per-turn cost cap (USD)', help: 'Ask Worca per-turn cap; null means no cap.', type: 'usd-or-null', min: 0.1, max: 100, kinds: ['default'], local: 'askMaxBudgetUsd' },
  // The two web fields only ever NARROW, and bind (no "go past it"): web access is opt-in per developer, and the policy
  // branch is writable by whoever can push to the repo — so a policy may switch it off or cap the hosts, never widen.
  { key: 'ask.webEnabled', group: 'ask', label: 'Web access', help: 'Off switches Ask Worca web access off for chats pinned to this project. A policy can never switch it on — each developer opts in.', type: 'bool', kinds: ['soft'], offOnly: true, local: 'askWeb.enabled' },
  { key: 'ask.webAllowedDomains', group: 'ask', label: 'Web allowlist', help: 'The most a developer may allow (example.com or *.example.com): hosts outside this list are dropped from their own Ask web allowlist. It never adds a host.', type: 'string[]', kinds: ['soft'], domains: true, local: 'askWeb.allowedDomains' },
  { key: 'guardrails.default', group: 'guardrails', label: 'Default set', help: 'What the New pipeline picker starts on. A built-in id, a user set id, or gp:<name> for a set this policy ships.', type: 'string', kinds: ['default'] },
  { key: 'guardrails.minimum', group: 'guardrails', label: 'Minimum tier', help: 'A run whose set ranks below this warns and is recorded.', type: 'enum', values: TIERS, kinds: ['soft'] },
  { key: 'models.allowed', group: 'models', label: 'Allowed models', help: 'A chosen step model outside this list warns and is recorded. Others still run.', type: 'string[]', kinds: ['soft'] },
  { key: 'models.steps', group: 'models', label: 'Step defaults', help: 'Model and effort per role, applied to roles the project has not configured.', type: 'steps', kinds: ['default'] },
  { key: 'models.hideBuiltins', group: 'models', label: 'Hide built-in models', help: 'Cosmetic; ids still resolve.', type: 'bool', kinds: ['default'], local: 'hideBuiltinModels' },
  { key: 'plugins.marketplaces', group: 'plugins', label: 'Marketplaces', help: 'Added to every teammate once; a local removal is remembered.', type: 'string[]', kinds: ['default'] },
  { key: 'plugins.required', group: 'plugins', label: 'Required plugins', help: 'Missing or below the floor: the setup checklist offers to install, with consent. Never automatic.', type: 'plugins', kinds: ['soft'] },
  // MCP registry spec §11.1. `workspaceRuns: false`: refused in the workspaceRuns block (a workspace run takes only the workspace policy's Team set).
  { key: 'mcp.required', group: 'plugins', label: 'Required MCP servers', help: 'Each developer turns them on with consent; they join the Team set. Never automatic.', type: 'mcpServers', kinds: ['soft'], workspaceRuns: false },
  // Skills registry spec §5 (F8): plugin skills only, { plugin, skill }; refused under workspaceRuns like mcp.required.
  { key: 'skills.required', group: 'plugins', label: 'Required skills', help: 'Each developer turns them on with consent; they join the Team set. Never automatic.', type: 'skills', kinds: ['soft'], workspaceRuns: false },
  { key: 'plugins.blocked', group: 'plugins', label: 'Blocked plugins', help: 'An enabled blocked plugin warns and is recorded; it is never disabled for you.', type: 'string[]', kinds: ['soft'] },
  { key: 'workflows.default', group: 'runs', label: 'Default workflow', help: 'A built-in (wf_*) or plugin (wfp_*) workflow id. Applies when the project has no active workflow.', type: 'string', kinds: ['default'] },
  { key: 'run.humanInLoop', group: 'runs', label: 'Human in the loop', help: 'Applies until the project sets its own switch.', type: 'bool', kinds: ['default'] },
  { key: 'metrics.record', group: 'runs', label: 'Record runs to team metrics', help: 'Expected on: the Projects cell hints when "Include my runs" is off.', type: 'bool', kinds: ['soft'] },
  { key: 'worca.minVersion', group: 'runs', label: 'Minimum Worca version', help: 'An older client shows a banner and logs a note.', type: 'semver', kinds: ['soft'] },
  // Away mode (src/core/night/*): `night: true` makes validateValue run the night leaf's own
  // field rules after the base-type check, so the rules live in one place. Labels: src/shared/away-mode/labels.mjs.
  { key: 'night.enabled', group: 'night', label: FIELD_LABELS.enabled.label, help: FIELD_LABELS.enabled.hint || 'On: All runs. Off: Only runs I marked.', type: 'bool', kinds: ['default'], night: true },
  { key: 'night.window', group: 'night', label: FIELD_LABELS.window.label, help: FIELD_LABELS.window.hint, type: 'string', kinds: ['default'], night: true },
  { key: 'night.timeZone', group: 'night', label: FIELD_LABELS.timeZone.label, help: FIELD_LABELS.timeZone.hint, type: 'string', kinds: ['default'], night: true },
  { key: 'night.graceMinutes', group: 'night', label: FIELD_LABELS.graceMinutes.label, help: FIELD_LABELS.graceMinutes.hint, type: 'int', min: 1, max: 1440, kinds: ['default'], night: true },
  { key: 'night.strategy', group: 'night', label: FIELD_LABELS.strategy.label, help: FIELD_LABELS.strategy.hint, type: 'enum', values: ['weights', 'analysis', 'mixed'], kinds: ['default'], night: true },
  { key: 'night.minConfidence', group: 'night', label: FIELD_LABELS.minConfidence.label, help: FIELD_LABELS.minConfidence.hint, type: 'int', min: 0, max: 100, kinds: ['default'], night: true },
  { key: 'night.minMargin', group: 'night', label: FIELD_LABELS.minMargin.label, help: FIELD_LABELS.minMargin.hint, type: 'int', min: 0, max: 100, kinds: ['default'], night: true },
  { key: 'night.criteria', group: 'night', label: FIELD_LABELS.criteria.label, help: FIELD_LABELS.criteria.hint, type: 'criteria', kinds: ['default'], night: true },
  { key: 'night.neverDecide', group: 'night', label: FIELD_LABELS.neverDecide.label, help: FIELD_LABELS.neverDecide.hint, type: 'string[]', kinds: ['default'], night: true },
  { key: 'night.spendCapUsd', group: 'night', label: FIELD_LABELS.spendCapUsd.label, help: FIELD_LABELS.spendCapUsd.hint, type: 'usd-or-null', min: 0.1, max: 10000, kinds: ['default'], night: true },
  { key: 'night.maxDecisions', group: 'night', label: FIELD_LABELS.maxDecisions.label, help: FIELD_LABELS.maxDecisions.hint, type: 'int', min: 1, max: 500, kinds: ['default'], night: true },
  { key: 'night.maxExtraCycles', group: 'night', label: FIELD_LABELS.maxExtraCycles.label, help: FIELD_LABELS.maxExtraCycles.hint, type: 'int', min: 0, max: 10, kinds: ['default'], night: true },
  { key: 'night.allowCostCapOverride', group: 'night', label: FIELD_LABELS.allowCostCapOverride.label, help: FIELD_LABELS.allowCostCapOverride.hint, type: 'bool', kinds: ['default'], night: true },
  { key: 'night.deciderModel', group: 'night', label: FIELD_LABELS.deciderModel.label, help: FIELD_LABELS.deciderModel.hint, type: 'string', kinds: ['default'], night: true },
  { key: 'night.deciderEffort', group: 'night', label: FIELD_LABELS.deciderEffort.label, help: FIELD_LABELS.deciderEffort.hint, type: 'enum', values: [...NIGHT_EFFORTS], kinds: ['default'], night: true },
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
// Zero-import leaves only: model-env for the bridged-model `upstream` validator every
// catalog layer shares (model-bridge-design.md §6.3), night/config for the night.* rules.
import { assertModelUpstream, upstreamEnvConflict, codexUpstreamProblem, CODEX_EFFORTS } from '../model-env.mjs';
import { fieldError as nightFieldError, NIGHT_EFFORTS } from '../night/config.mjs';
// The MCP definition rules (MCP registry spec §4.1, §4.3): pure, shared with manual definitions.
import { validateMcpDefinition, screenNonSecretValue, SERVER_NAME_RE } from '../mcp/definitions.mjs';
// Skill names (skills registry spec §2b-9, the Agent Skills rule; two names are reserved): a pure leaf.
import { SKILL_NAME_RE, SKILL_NAME_MAX, RESERVED_SKILL_NAMES } from '../skills-registry/ids.mjs';

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
  // No `{n,}` run over the text: V8 keeps a backtrack entry per character and throws RangeError on a run of
  // about 5.5M characters (a policy doc, a manifest, an 8 MB body). `run` = the length of the leading run.
  const run = (outside) => { const i = s.search(outside); return i < 0 ? s.length : i; };
  if (/^(sk-|xox[abp]-|ghp_|gho_|github_pat_|glpat-|AKIA)/.test(s)) return true;
  if (s.startsWith('eyJ') && run(/[^A-Za-z0-9_-]/) >= 13 && s[run(/[^A-Za-z0-9_-]/)] === '.') return true;
  if (/^(\/|\.\/|~\/|[A-Za-z]:[\\/])/.test(s)) return false;                // a path, not a token
  return s.length >= 40 && run(/[^A-Za-z0-9+/_=-]/) === s.length;          // a long opaque token
}

const MCP_VALUE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
// A policy value in a message: a JSON object whose `toString` is no function throws in String(), so show it as JSON.
const shown = (x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x));
/** One `mcp.required` entry → { entry } normalised (§4.1 shape, defaults filled), or { error }. */
function normalizeMcpEntry(e) {
  if (!isPlainObject(e)) return { error: 'must be an object' };
  const { values: rawValues, ...rest } = e;
  let entry; let fields = null;
  if (rest.plugin !== undefined) {
    if (!(typeof rest.plugin === 'string' && PLUGIN_NAME_RE.test(rest.plugin))) return { error: `plugin "${shown(rest.plugin)}" is not a valid plugin name` };
    if (!(typeof rest.server === 'string' && SERVER_NAME_RE.test(rest.server))) return { error: `server "${shown(rest.server)}" is not a valid server name` };
    entry = { plugin: rest.plugin, server: rest.server };
  } else {
    const { name, ...raw } = rest;
    const { def, errors } = validateMcpDefinition(raw, { name, source: 'policy' });
    if (!def) return { error: errors[0] };
    for (const k of ['args', 'env', 'headers']) if (def[k] && !Object.keys(def[k]).length) delete def[k];   // empty ≡ absent (consent hash)
    entry = { name, ...def };
    fields = new Map(def.fields.map((f) => [f.key, f]));
  }
  if (rawValues !== undefined) {
    if (!isPlainObject(rawValues)) return { error: 'values must be an object' };
    const values = {};
    for (const [k, v] of Object.entries(rawValues)) {
      const f = fields ? fields.get(k) : null;
      if (fields ? !f : !MCP_VALUE_KEY_RE.test(k)) return { error: `values.${k}: no such field` };
      if (f?.secret) return { error: `values.${k}: a secret field — each developer sets it` };
      const bad = typeof v === 'string' ? screenNonSecretValue(v) : 'must be a string';
      if (bad) return { error: `values.${k}: ${bad}` };
      values[k] = v;
    }
    if (Object.keys(values).length) entry.values = values;
  }
  return { entry };
}
const mcpLabel = (e, i) => (!isPlainObject(e) ? `entry ${i + 1}`
  : typeof e.plugin === 'string' ? `${e.plugin}/${shown(e.server)}` : typeof e.name === 'string' ? e.name : `entry ${i + 1}`);
/** Keep the valid `mcp.required` entries; one "<label>: <why>" per dropped entry (a bad entry never drops the field). */
function normalizeMcpRequired(list) {
  const value = []; const dropped = []; const seen = new Set();
  list.forEach((e, i) => {
    const { entry, error } = normalizeMcpEntry(e);
    const id = entry && (entry.plugin ? `plugin:${entry.plugin}/${entry.server}` : `inline:${entry.name}`);
    const why = error || (seen.has(id) ? 'listed twice' : null);
    if (why) { dropped.push(`${mcpLabel(e, i)}: ${why}`); return; }
    seen.add(id); value.push(entry);
  });
  return { value, dropped };
}
/**
 * Did this build read every `mcp.required` entry of a doc, given its normalizer warnings (MCP registry spec §11.2)?
 * An entry it dropped (a newer rule, a typo, a plugin missing from plugins.required) is still listed by the team:
 * its Team state stays and its `policy:` server does not retire.
 */
export function mcpListComplete(warnings = []) {
  // Every `mcp.required:` warning drops an entry or the field, except "hard … — treated as soft", which keeps them all.
  return !warnings.some((w) => typeof w === 'string'
    && (w === 'unknown field mcp.required' || (w.startsWith('mcp.required:') && !w.endsWith('treated as soft'))));
}

/** The plugin manifest's name rule (plugin-manifest.mjs PLUGIN_NAME_RE, ≤ 64), kept here: this module stays pure. */
const SKILL_PLUGIN_RE = /^(?=.{1,64}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** One `skills.required` entry → { entry: { plugin, skill } } (other keys dropped), or { error }. Plugin skills only (F8). */
function normalizeSkillEntry(e) {
  if (!isPlainObject(e)) return { error: 'must be an object' };
  if (e.plugin === undefined) return { error: 'an entry is { "plugin", "skill" } — plugin skills only' };
  if (!(typeof e.plugin === 'string' && SKILL_PLUGIN_RE.test(e.plugin))) return { error: `plugin "${shown(e.plugin)}" is not a valid plugin name` };
  if (!(typeof e.skill === 'string' && e.skill.length <= SKILL_NAME_MAX && SKILL_NAME_RE.test(e.skill))) return { error: `skill "${shown(e.skill)}" is not a valid skill name` };
  if (RESERVED_SKILL_NAMES.includes(e.skill)) return { error: `skill "${e.skill}" is a reserved name` };
  return { entry: { plugin: e.plugin, skill: e.skill } };
}
const skillLabel = (e, i) => (isPlainObject(e) && typeof e.plugin === 'string' ? `${e.plugin}/${shown(e.skill)}` : `entry ${i + 1}`);
/** Keep the valid `skills.required` entries; one "<label>: <why>" per dropped entry (a bad entry never drops the field). */
export function normalizeSkillsRequired(list) {
  const value = []; const dropped = [];
  list.forEach((e, i) => {
    const { entry, error } = normalizeSkillEntry(e);
    // One skill name per set (skills registry spec §3.2): the Team set holds every entry, so a name is listed once.
    const prev = entry && value.find((x) => x.skill === entry.skill);
    const why = error || (!prev ? null : prev.plugin === entry.plugin ? 'listed twice' : `a skill named ${entry.skill} is already listed (from ${prev.plugin}) — one name per Team set`);
    if (why) { dropped.push(`${skillLabel(e, i)}: ${why}`); return; }
    value.push(entry);
  });
  return { value, dropped };
}
/** Did this build read every `skills.required` entry of a doc (the mcpListComplete rule)? An entry it dropped is still
 *  listed by the team: its Team state stays. */
export function skillsListComplete(warnings = []) {
  // `fields: not an object — ignored`: the whole fields block was unreadable, so this build read no entry at all.
  return !warnings.some((w) => typeof w === 'string'
    && (w === 'unknown field skills.required' || w === 'fields: not an object — ignored'
      || (w.startsWith('skills.required:') && !w.endsWith('treated as soft'))));
}

/**
 * Validate ONE field value against its registry type. Returns null when ok, else a message.
 * Shared by the editor (before publish) and the reader (dropping bad fields with a warning).
 */
export function validateValue(meta, value) {
  const err = baseError(meta, value);
  if (err || !meta.night) return err;
  return nightFieldError(meta.key.slice('night.'.length), value);
}

function baseError(meta, value) {
  switch (meta.type) {
    case 'usd': return finiteNum(value) && value > 0 ? null : 'must be a positive number of USD';
    case 'usd-or-null':
      if (value === null) return null;
      return finiteNum(value) && value >= (meta.min ?? 0) && value <= (meta.max ?? Infinity) ? null : `must be null or a number between ${meta.min} and ${meta.max}`;
    case 'int': return Number.isInteger(value) && value >= (meta.min ?? -Infinity) && value <= (meta.max ?? Infinity) ? null : `must be an integer between ${meta.min} and ${meta.max}`;
    case 'bool':
      if (typeof value !== 'boolean') return 'must be true or false';
      return meta.offOnly && value !== false ? 'a team policy can only switch web access off — turning it on is each developer\'s own choice' : null;
    case 'enum': return meta.values.includes(value) ? null : `must be one of ${meta.values.join(' | ')}`;
    case 'string': return typeof value === 'string' && value.trim() && value.length <= TEXT_MAX ? null : 'must be a non-empty string';
    case 'semver': return typeof value === 'string' && SEMVER_RE.test(value) ? null : 'must be a version like 1.4.0';
    case 'string[]':
      if (!Array.isArray(value)) return 'must be a list';
      if (!value.every((x) => typeof x === 'string' && x.trim() && x.length <= TEXT_MAX)) return 'every entry must be a non-empty string';
      if (meta.domains) { for (const x of value) { const e = domainError(x); if (e) return e; } }
      return null;
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
    case 'criteria': return isPlainObject(value) ? null : 'must be an object of criterion → weight';
    case 'mcpServers':
      if (!Array.isArray(value)) return 'must be a list of MCP server entries';
      return normalizeMcpRequired(value).dropped[0] ?? null;
    case 'skills':
      if (!Array.isArray(value)) return 'must be a list of { plugin, skill } entries';
      return normalizeSkillsRequired(value).dropped[0] ?? null;
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
  // mcpServers, skills: a per-entry normalizer — bad entries are dropped one warning each, the rest stays.
  const perEntry = meta.type === 'mcpServers' ? normalizeMcpRequired : meta.type === 'skills' ? normalizeSkillsRequired : null;
  const mcp = perEntry && Array.isArray(raw.value) ? perEntry(raw.value) : null;
  const err = mcp ? null : validateValue(meta, raw.value);
  if (err) return { entry: null, warning: `${key}: ${err}` };
  const entry = { kind, value: mcp ? mcp.value : raw.value };
  for (const a of meta.attrs || []) {
    if (raw[a] === undefined) continue;
    if (a === 'onBreach') { if (ON_BREACH.includes(raw[a])) entry.onBreach = raw[a]; else warning ||= `${key}: onBreach must be pause | warn (ignored)`; }
    else if (a === 'requireReason') { if (typeof raw[a] === 'boolean') entry.requireReason = raw[a]; else warning ||= `${key}: requireReason must be true | false (ignored)`; }
    else if (a === 'window') { if (WINDOWS.includes(raw[a])) entry.window = raw[a]; else warning ||= `${key}: window must be weekly | monthly (ignored)`; }
  }
  return { entry, warning, dropped: (mcp?.dropped || []).map((d) => `${key}: ${d} — entry dropped`) };
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
    if (prefix === 'workspaceRuns' && fieldMeta(key)?.workspaceRuns === false) { warnings.push(`workspaceRuns.${key}: not allowed for workspace runs — dropped`); continue; }
    const { entry, warning, dropped = [] } = normalizeEntry(key, raw[key]);
    for (const w of warning ? [warning, ...dropped] : dropped) warnings.push(prefix ? `${prefix}.${w}` : w);
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
    if (m.engine !== undefined && m.engine !== 'claude' && m.engine !== 'codex') { warnings.push(`catalogs.models: ${m.id}: engine must be claude or codex — entry dropped`); continue; }
    const codex = m.engine === 'codex';
    const allowed = codex ? CODEX_EFFORTS : EFFORTS;
    const efforts = Array.isArray(m.efforts) ? m.efforts.filter((e) => allowed.includes(e)) : [];
    entry.efforts = efforts.length ? efforts : (codex ? [...CODEX_EFFORTS] : ['medium', 'high']);
    if (codex) {
      // §3.1a: codex ignores routing env. Its upstream (an OpenAI-compatible endpoint) is checked below.
      if (m.env != null) { warnings.push(`catalogs.models: ${m.id}: a codex model takes no env — entry dropped`); continue; }
      entry.engine = 'codex';
    }
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
        const codexWhy = codex ? codexUpstreamProblem(upstream) : null;
        if (codexWhy) throw new Error(codexWhy);
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
  // §11.1 cross-field rule: a plugin reference's plugin must be in the same doc's plugins.required (skills registry
  // spec §5: every `skills.required` entry is one).
  const plugins = new Set((doc.fields['plugins.required']?.value || []).map((p) => p.name));
  const mcp = doc.fields['mcp.required'];
  if (mcp) {
    mcp.value = mcp.value.filter((e) => {
      if (!e.plugin || plugins.has(e.plugin)) return true;
      warnings.push(`mcp.required: ${e.plugin}/${e.server}: plugin ${e.plugin} is not in plugins.required — entry dropped`);
      return false;
    });
  }
  const skills = doc.fields['skills.required'];
  if (skills) {
    skills.value = skills.value.filter((e) => {
      if (plugins.has(e.plugin)) return true;
      warnings.push(`skills.required: ${e.plugin}/${e.skill}: plugin ${e.plugin} is not in plugins.required — entry dropped`);
      return false;
    });
  }
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
