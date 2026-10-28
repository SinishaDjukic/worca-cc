// src/core/policy/effective.mjs
// What applies where (team-policy design §6): fold a policy document and the developer's
// own settings into the value a run (or a page) will use, field by field. Pure — the
// snapshot of local settings comes from policy/local.mjs, the document from policy/sync.mjs.

import { FIELDS, effectiveKind, tierRank, semverAtLeast } from './registry.mjs';
import { capDomainList } from '../web-allowlist.mjs';
import { normaliseDimensions, missingRequired } from '../../shared/tag-dimensions.mjs';
import { ROLE_LABELS } from '../../shared/model-roles.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';

/**
 * The team entries that apply to ONE run kind: `workspaceRuns` replaces `fields` for
 * workspace runs, key by key, and `hard` reads as soft (registry.effectiveKind).
 * @returns {Record<string, {kind:string, declaredKind:string, value:*, fromWorkspaceRuns:boolean, onBreach?:string, requireReason?:boolean, window?:string}>}
 */
export function fieldsForRun(doc, { workspaceRun = false } = {}) {
  const out = {};
  if (!doc) return out;
  for (const f of FIELDS) {
    const ws = workspaceRun ? doc.workspaceRuns?.[f.key] : null;
    const e = ws || doc.fields?.[f.key] || null;
    if (!e) continue;
    out[f.key] = { ...e, kind: effectiveKind(f, e.kind), declaredKind: e.kind, fromWorkspaceRuns: !!ws };
  }
  return out;
}

/**
 * The cap a gate enforces. `local` is the developer's stored cap (null = none); `team` the
 * entry from fieldsForRun (null = the policy says nothing).
 *   default: local wins when set, else the team value starts the developer off
 *   soft:    the tighter of the two; ties go to local (no "team" pause for an equal number)
 * @returns {{cap:number|null, binding:'local'|'team'|'team-default'|null, team:object|null}}
 */
export function effectiveCap({ local = null, team = null } = {}) {
  if (!team) return { cap: local ?? null, binding: local == null ? null : 'local', team: null };
  if (team.kind === 'default') {
    return local != null ? { cap: local, binding: 'local', team } : { cap: team.value, binding: 'team-default', team };
  }
  if (local == null || team.value < local) return { cap: team.value, binding: 'team', team };
  return { cap: local, binding: 'local', team };
}

/** A default-kind scalar: the developer's stored value wins when SET, else the team's. */
export function effectiveDefault({ local = null, team = null } = {}) {
  if (local && local.set) return { value: local.value, source: 'local' };
  if (team) return { value: team.value, source: 'team-default' };
  return { value: local ? local.value : null, source: local ? 'default' : 'none' };
}

/** Ask web access on/off: only the developer switches it on; a team value can only switch it off. */
export function effectiveWebEnabled({ local = null, team = null } = {}) {
  if (team && team.value === false) return false;
  return !!(local && local.value === true);
}
/** The Ask web allowlist: the developer's own list, capped by the team's when the policy sets one. */
export function capWebDomains(local, team) { return capDomainList(local, Array.isArray(team) ? team : null); }

const fmtUsd = (n) => `$${Number(n).toFixed(2)}`;
// Built-in guardrail ids render as their display names everywhere (`secure` shows as "Strict",
// the guardrail-store.mjs BUILTIN_META rule); a policy set reads "gp:<id>".
const GUARDRAIL_NAMES = { permissive: 'Permissive', normal: 'Normal', secure: 'Strict' };
// One `mcp.required` entry: "github (stdio: npx -y …)", "dd (http: https://…/{site})", "sentry (acme-tools)".
const mcpPart = (p) => (typeof p === 'string' ? p : `${p.prefix || ''}{${p.field}}${p.suffix || ''}`);
const mcpLine = (e) => (e.plugin ? `${e.server} (${e.plugin})`
  : `${e.name} (${e.type}: ${e.type === 'stdio' ? [e.command, ...(e.args || []).map(mcpPart)].join(' ') : [].concat(e.url).map(mcpPart).join('')})`);
/** A field value as the page shows it ("$25.00", "Strict", "on", "a, b"). */
export function fmtValue(meta, v) {
  if (v == null) return '—';
  if (meta.key === 'guardrails.default' || meta.key === 'guardrails.minimum') return GUARDRAIL_NAMES[v] || String(v);
  switch (meta.type) {
    case 'usd': case 'usd-or-null': return fmtUsd(v);
    case 'bool': return v ? 'on' : 'off';
    case 'string[]': return v.length ? v.join(', ') : '(none)';
    case 'plugins': return v.length ? v.map((p) => `${p.name}${p.minVersion ? ` ≥ ${p.minVersion}` : ''}`).join(', ') : '(none)';
    case 'mcpServers': return v.length ? v.map(mcpLine).join(', ') : '(none)';
    case 'skills': return v.length ? v.map((e) => `${e.skill} (${e.plugin})`).join(', ') : '(none)';
    case 'steps': return Object.entries(v).map(([r, s]) => `${r} ${s.model || '·'}${s.effort ? ` / ${s.effort}` : ''}`).join(' · ') || '(none)';
    case 'roles': return Object.entries(v).flatMap(([hn, rs]) => Object.entries(rs || {}).map(([r, s]) =>
      `${engineLabel(hn)} ${ROLE_LABELS[r] || r} ${s.model}${s.effort ? ` / ${s.effort}` : ''}`)).join(' · ') || '(none)';
    case 'record': return Object.entries(v).map(([k, x]) => `${k} ${Array.isArray(x) ? x.join(', ') : x === true ? 'on' : x === false ? 'off' : x}`).join(' · ') || '(none)';
    case 'criteria': return Object.entries(v).map(([k, w]) => `${k} ${w}`).join(' · ') || '(defaults)';
    case 'tagDimensions': return v.length ? v.map((d) => `${d.label} (${d.key})${d.required ? ' required' : ''}`).join(', ') : '(none)';
    default: return String(v);
  }
}

/**
 * Rows for the effective-policy table (design board 4) and the CLI `policy show`.
 * `local` is the policy/local.mjs snapshot: { [key]: { value, set } }.
 * @returns {Array<{key,group,label,help,team:object|null,local:object|null,effective:{value,display,source},note:string|null,shown:boolean}>}
 */
export function effectiveRows({ doc = null, workspaceRun = false, local = {} } = {}) {
  const team = fieldsForRun(doc, { workspaceRun });
  const rows = [];
  for (const meta of FIELDS) {
    const t = team[meta.key] || null;
    const l = local[meta.key] || null;
    let effective; let note = null;
    if (meta.key === 'ask.webEnabled') {
      const v = effectiveWebEnabled({ local: l, team: t });
      effective = { value: v, display: fmtValue(meta, v), source: t && t.value === false ? 'team' : 'local' };
    } else if (meta.key === 'ask.webAllowedDomains') {
      const v = capWebDomains(l?.value, t?.value);
      effective = { value: v, display: fmtValue(meta, v), source: t ? 'team' : 'local' };
      const dropped = (Array.isArray(l?.value) ? l.value.length : 0) - v.length;
      if (t && dropped > 0) note = `${dropped} of yours ${dropped === 1 ? 'is' : 'are'} outside the team list`;
    } else if (meta.cap) {
      const r = effectiveCap({ local: l?.set ? l.value : null, team: t });
      effective = { value: r.cap, display: fmtValue(meta, r.cap), source: r.binding || 'none' };
      if (r.binding === 'team' && l?.set && l.value > t.value) note = `yours (${fmtUsd(l.value)}) is looser; the team cap applies`;
      if (r.binding === 'local' && t?.kind === 'soft' && l?.set && l.value <= t.value) note = 'yours is tighter';
    } else if (meta.advisory) {
      effective = t ? { value: t.value, display: `${fmtUsd(t.value)} / ${t.window || 'monthly'}`, source: 'advisory' } : { value: null, display: '—', source: 'none' };
    } else if (t && t.kind === 'soft') {
      // An expectation: the run proceeds either way, deviations warn and are recorded.
      effective = { value: t.value, display: fmtValue(meta, t.value), source: 'team' };
      if (meta.key === 'metrics.record' && l && l.set && l.value === false && t.value === true) note = 'your "Include my runs" is off; the team expects recording';
      if ((meta.key === 'mcp.required' || meta.key === 'skills.required') && l && t.value.length > l.value.length) note = `${t.value.length - l.value.length} missing`;
    } else {
      const r = effectiveDefault({ local: l, team: t });
      effective = { value: r.value, display: fmtValue(meta, r.value), source: r.source };
    }
    rows.push({
      key: meta.key, group: meta.group, label: meta.label, help: meta.help, type: meta.type,
      team: t ? { ...t, display: fmtValue(meta, t.value) } : null,
      local: l ? { ...l, display: l.set ? fmtValue(meta, l.value) : '—' } : null,
      effective, note, shown: !!t,
    });
  }
  return rows;
}

/**
 * Off-policy findings for a run (design §8, §10). Codes are what the metrics record stores;
 * `text` is the run-log / New pipeline line. Nothing here blocks anything.
 * @param {object} fields  fieldsForRun() result
 * @param {object} ctx     { guardrailsId, guardrailSet, stepModels:[{role,model}], installed:{name:{version,enabled}},
 *                           worcaVersion, metricsRecord:boolean|null }
 * @returns {Array<{code:string, text:string, level:'warn'|'info'}>}
 */
export function deviationsFor(fields, ctx = {}) {
  const out = [];
  const min = fields['guardrails.minimum'];
  if (min && ctx.guardrailsId) {
    const have = ctx.guardrailSet ? tierRank(ctx.guardrailSet) : tierRank(ctx.guardrailsId);
    const want = tierRank(min.value);
    if (have != null && want != null && have < want) {
      const name = (id) => GUARDRAIL_NAMES[id] || id;
      out.push({ code: `guardrails:${ctx.guardrailsId}<${min.value}`, level: 'warn', text: `Guardrails ${name(ctx.guardrailsId)} rank below the team minimum (${name(min.value)}). The run proceeds and is recorded as off-policy.` });
    }
  }
  const allowed = fields['models.allowed'];
  if (allowed && Array.isArray(ctx.stepModels)) {
    const ok = new Set(allowed.value.map((m) => m.toLowerCase()));
    const seen = new Set();
    for (const s of ctx.stepModels) {
      const id = typeof s?.model === 'string' ? s.model.trim() : '';
      if (!id || seen.has(id.toLowerCase()) || ok.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase());
      out.push({ code: `model:${id}`, level: 'warn', text: `${s.role ? `The ${s.role}'s model ` : 'Model '}${id} is not in the allowed list (${allowed.value.join(', ')}). The run proceeds and is recorded as off-policy.` });
    }
  }
  const required = fields['plugins.required'];
  if (required && ctx.installed) {
    for (const p of required.value) {
      const have = ctx.installed[p.name];
      if (!have) out.push({ code: `plugin-missing:${p.name}`, level: 'warn', text: `Required plugin ${p.name} is not installed.` });
      else if (have.enabled === false) out.push({ code: `plugin-disabled:${p.name}`, level: 'warn', text: `Required plugin ${p.name} is disabled.` });
      else if (p.minVersion && have.version && !semverAtLeast(have.version, p.minVersion)) out.push({ code: `plugin-outdated:${p.name}`, level: 'warn', text: `Required plugin ${p.name} is ${have.version}; the team expects at least ${p.minVersion}.` });
    }
  }
  const blocked = fields['plugins.blocked'];
  if (blocked && ctx.installed) {
    for (const name of blocked.value) {
      const have = ctx.installed[name];
      if (have && have.enabled !== false) out.push({ code: `plugin-blocked:${name}`, level: 'warn', text: `Plugin ${name} is enabled but blocked by the team policy.` });
    }
  }
  const minVer = fields['worca.minVersion'];
  if (minVer && ctx.worcaVersion && !semverAtLeast(ctx.worcaVersion, minVer.value)) {
    out.push({ code: `worca-version:${ctx.worcaVersion}<${minVer.value}`, level: 'warn', text: `Your Worca is ${ctx.worcaVersion}; this policy expects at least ${minVer.value}. Some fields may not apply.` });
  }
  const rec = fields['metrics.record'];
  if (rec && rec.value === true && ctx.metricsRecord === false) {
    out.push({ code: 'metrics-off', level: 'info', text: 'Your "Include my runs" is off; the team expects runs to be recorded.' });
  }
  const tagDims = fields['runs.tagDimensions'];
  if (tagDims && Array.isArray(ctx.tags)) {
    for (const d of missingRequired(normaliseDimensions(tagDims.value).dims, ctx.tags)) {
      out.push({ code: `tag-missing:${d.key}`, level: 'warn', text: `${d.label} (${d.key}) is a required tag and was not set. The run proceeds and is recorded as off-policy.` });
    }
  }
  return out;
}

/**
 * MCP registry off-policy findings (MCP registry design §11.4): one per `mcp.required` entry
 * that does not start in this run, read off its membership of the Team set in `resolved` (the
 * resolver result for the run's target). `describe(skip)` words a problem skip's reason (the
 * caller passes the resolver's skipReasonText). Pure; never blocking.
 * @returns {Array<{code:string, level:'warn', text:string}>}
 */
export function mcpDeviations(fields, resolved, describe = (s) => s.reason) {
  const required = Array.isArray(fields?.['mcp.required']?.value) ? fields['mcp.required'].value : [];
  const team = (resolved?.sets || []).find((s) => s.group === 'team');
  const out = [];
  for (const e of required) {
    const label = e.plugin ? `${e.plugin}/${e.server}` : e.name;
    const hit = (m) => !!team && m.setId === team.id
      && (e.plugin ? m.serverId === `plugin:${e.plugin}/${e.server}` : m.serverId.startsWith('policy:') && m.serverId.endsWith(`/${e.name}`));
    if ((resolved?.copies || []).some(hit)) continue;
    const skip = (resolved?.skipped || []).find(hit);
    const d = (code, text) => out.push({ code: `${code}:${label}`, level: 'warn', text });
    if (!skip) d('mcp-missing', `Required MCP server ${label} is not installed.`);
    else if (skip.reason === 'off' || skip.reason === 'needs-consent') d('mcp-off', `Required MCP server ${label} is off.`);
    else if (skip.reason === 'opted-out') d('mcp-opted-out', `Required MCP server ${label} is opted out of this run.`);
    else d('mcp-skipped', `Required MCP server ${label} is skipped in this run (${describe(skip)}).`);
  }
  return out;
}

/**
 * Skills registry off-policy findings (spec §2b-13, §5): one per `skills.required` entry that does not mount from the
 * Team set in `resolved` (resolveSkillSets' result for the run's target: `mounted[].id`, `skipped[].skillId`).
 * `describe(skip)` words a problem skip (the caller passes skillSkipReasonText). Pure; never blocking.
 * @returns {Array<{code:string, level:'warn', text:string}>}
 */
export function skillDeviations(fields, resolved, describe = (s) => s.reason) {
  const required = Array.isArray(fields?.['skills.required']?.value) ? fields['skills.required'].value : [];
  const team = (resolved?.sets || []).find((s) => s.group === 'team');
  const out = [];
  for (const e of required) {
    const label = `${e.plugin}/${e.skill}`;
    const id = `skill:plugin:${label}`;
    if ((resolved?.mounted || []).some((m) => !!team && m.setId === team.id && m.id === id)) continue;
    const skip = (resolved?.skipped || []).find((m) => !!team && m.setId === team.id && m.skillId === id);
    const d = (code, text) => out.push({ code: `${code}:${label}`, level: 'warn', text });
    if (!skip || skip.reason === 'missing-skill') d('skill-missing', `Required skill ${label} is not installed.`);
    else if (skip.reason === 'off' || skip.reason === 'needs-consent') d('skill-off', `Required skill ${label} is off.`);
    else if (skip.reason === 'opted-out') d('skill-opted-out', `Required skill ${label} is opted out of this run.`);
    else d('skill-skipped', `Required skill ${label} is skipped in this run (${describe(skip)}).`);
  }
  return out;
}

/** The three-number summary the Projects cell, the Settings readout and the CLI print. */
export function capSummary(doc, { workspaceRun = false } = {}) {
  const f = fieldsForRun(doc, { workspaceRun });
  const pick = (k) => (f[k] ? { kind: f[k].kind, value: f[k].value, onBreach: f[k].onBreach || 'pause', requireReason: !!f[k].requireReason } : null);
  return {
    pipeline: pick('cost.pipelineLimitUsd'),
    total: pick('cost.totalLimitUsd'),
    resetPeriod: f['cost.resetPeriod'] ? f['cost.resetPeriod'].value : null,
    pooled: f['cost.pooledBudgetUsd'] ? { value: f['cost.pooledBudgetUsd'].value, window: f['cost.pooledBudgetUsd'].window || 'monthly' } : null,
  };
}

/** How many entries a document sets, for "14 fields" copy. */
export function fieldCount(doc) {
  return doc ? Object.keys(doc.fields || {}).length + Object.keys(doc.workspaceRuns || {}).length : 0;
}
