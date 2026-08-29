// src/core/agent-store.mjs
// CRUD for USER agents: <worcaHome()>/agents/<key>.meta.json + <key>.md pairs,
// layered under the read-only built-in repo agents/ dir by the Phase 1 registry.
// Validation + persistence live here (thin-core pattern, mirrors workspaces.mjs);
// HTTP mapping is the route's.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAgentRegistry, normalizeMeta, userAgentsDir } from './agent-registry.mjs';
import { listWorkflows } from './workflows.mjs';
import { validateMetaV2 } from '../shared/graph/agent-meta.mjs';
import { AWAIT_PORT } from '../shared/graph/constants.mjs';   // the synthesized gate port is wirable

export { userAgentsDir }; // single source: the Phase 1 layer resolver

/** A key is a bare alphanumeric stem — can never contain "/" or "..". */
export const AGENT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function err(message, code) { return Object.assign(new Error(message), { code }); }

/** The v2 capabilities whose ABSENCE is their off state in a sidecar. A complete
 *  v2 PUT is a REPLACE of this surface — otherwise `{...existing, ...raw}` turns
 *  every one of them into a one-way switch and `placeable:false` /
 *  `scope:'workspace-only'` can never be undone from the editor. Everything else
 *  (including the v1 wiring the registry still derives, which P8 owns) MERGES. */
const V2_CLEARABLE = ['verdict', 'sideEffect', 'mockRole', 'wantsRequest', 'workspaceFanOut',
  'workspaceStrategy', 'workspaceVariantOf', 'placeable', 'scope', 'domain', 'icon',
  'promptHints', 'requiresSkills'];

/** The writable user layer dir. userAgentsDir() returns null only when the home
 *  cannot be resolved (no WORCA_HOME under node:test) — surface that as a 400. */
function requireUserDir() {
  const dir = userAgentsDir();
  if (!dir) throw err('cannot resolve the user agents directory (WORCA_HOME unset?)', 'BAD_REQUEST');
  return dir;
}

/** lower-camel key from a display name: "API Docs Writer" -> "apiDocsWriter". */
export function keyFromName(name) {
  const words = String(name || '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
  if (!words.length) return '';
  return words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

/** Merged layered registry as an ordered array. origin ('builtin'|'user') and the
 *  layer-correct absolute agentPath are stamped by the Phase 1 registry; built-ins
 *  win key collisions there; the result is already sorted by .order. */
export async function listAgents() {
  return Object.values(loadAgentRegistry());
}

/** Full read: { meta (with origin), markdown } or null. */
export async function readAgent(key) {
  if (!AGENT_KEY_RE.test(String(key || ''))) return null;
  const meta = loadAgentRegistry()[key];
  if (!meta) return null;
  let markdown = '';
  if (meta.agentPath) {
    try { markdown = await readFile(meta.agentPath, 'utf8'); } catch { markdown = ''; }
  }
  return { meta, markdown };
}

/** Create a user agent. key = meta.key || keyFromName(displayName). */
export async function createAgent({ meta: rawMeta, markdown } = {}) {
  const raw = rawMeta && typeof rawMeta === 'object' ? { ...rawMeta } : {};
  const key = (typeof raw.key === 'string' && raw.key.trim()) || keyFromName(raw.displayName);
  if (!AGENT_KEY_RE.test(key)) throw err('agent key must be alphanumeric (letters, digits, - or _)', 'BAD_REQUEST');
  if (typeof markdown !== 'string' || !markdown.trim()) throw err('markdown body is required', 'BAD_REQUEST');
  raw.key = key;
  raw.agentFile = `${key}.md`;                              // store-owned sibling file
  if (!Number.isFinite(Number(raw.order))) raw.order = 99;  // sort after built-ins by default
  // The v2 gate runs BEFORE normalizeMeta: normalizeMeta is lossy by design
  // (fixed key set, silent coercions, and it returns null rather than a reason),
  // so a broken sidecar would otherwise be "fixed" into something the user never
  // wrote — or rejected with "invalid agent metadata". Every failed rule is named.
  const issues = validateMetaV2(raw).errors;
  if (issues.length) throw err(issues.join('; '), 'BAD_REQUEST');
  const meta = normalizeMeta(raw);
  if (!meta) throw err('invalid agent metadata', 'BAD_REQUEST');
  const existing = loadAgentRegistry()[key];
  if (existing && existing.origin === 'builtin') {
    throw err(`"${key}" is a built-in agent — duplicate it under a new name instead`, 'BUILTIN');
  }
  if (existing) throw err(`a user agent "${key}" already exists`, 'DUPLICATE');
  const dir = requireUserDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.md`), markdown, 'utf8');
  await writeFile(join(dir, `${key}.meta.json`), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return { meta: { ...meta, origin: 'user' }, markdown };
}

/** Per-port fields the workspace-variant signature deliberately EXCLUDES
 *  (workflows.mjs portSignature): a variant may render and store differently, it
 *  may not fire differently. These survive a propagation; everything else on the
 *  port comes from the base. */
const VARIANT_OWN_PORT_FIELDS = ['label', 'description', 'as', 'directive', 'filename', 'store', 'artifactKind'];

/** One side of a variant's ports, rebuilt from the base's: the base decides the
 *  set, the order and every scheduling field; the variant keeps its own rendering.
 *  @param {object[]} basePorts @param {object[]} variantPorts */
function mergeVariantPorts(basePorts, variantPorts) {
  const mine = new Map((Array.isArray(variantPorts) ? variantPorts : []).map((p) => [p.id, p]));
  return (Array.isArray(basePorts) ? basePorts : []).map((bp) => {
    const own = mine.get(bp.id);
    const out = { ...bp };
    if (!own) return out;
    for (const f of VARIANT_OWN_PORT_FIELDS) if (own[f] !== undefined) out[f] = own[f];
    // A void port carries neither, whatever the variant used to say.
    if (out.type === 'void') { delete out.filename; delete out.store; delete out.artifactKind; }
    return out;
  });
}

/**
 * Re-point every USER workspace variant of `key` at the base's new port signature.
 * A variant is BY DEFINITION the same ports with a different workspace strategy, so
 * a base port edit that is not propagated makes resolveGraph refuse every workspace
 * run ("workspace variant X does not match the port signature of Y") at a moment
 * disconnected from the edit. Non-user variants (builtin/plugin) cannot be written
 * — they are reported instead. Never throws: a variant that will not validate after
 * the merge is left untouched and reported.
 * @param {string} key the edited base key
 * @param {object} baseMeta the base's NEW normalized meta
 * @param {string} dir the writable user layer
 * @returns {Promise<{updated:string[], warnings:string[]}>}
 */
async function propagateToVariants(key, baseMeta, dir) {
  const updated = [];
  const warnings = [];
  for (const variant of Object.values(loadAgentRegistry())) {
    if (!variant || variant.workspaceVariantOf !== key) continue;
    if (variant.origin !== 'user') {
      warnings.push(`workspace variant "${variant.key}" (${variant.origin}) still declares the old ports `
        + '— workspace runs using it will be refused until it is updated');
      continue;
    }
    const raw = {
      ...variant,
      inputs: mergeVariantPorts(baseMeta.inputs, variant.inputs),
      outputs: mergeVariantPorts(baseMeta.outputs, variant.outputs),
    };
    // Boolean(verdict) IS part of the signature; its filename is not. Copying the
    // base's verdict into a variant that had none also copies the base's filename
    // TEMPLATE, so the variant writes its verdict there — correct for the
    // `{base}`-tokenised names every shipped verifier uses; a hardcoded one would
    // need re-pointing by hand.
    if (baseMeta.verdict && !variant.verdict) raw.verdict = { ...baseMeta.verdict };
    if (!baseMeta.verdict) delete raw.verdict;
    if (variant.descriptionDerived) raw.description = '';   // never persist a derived blurb (agent-store.mjs:114)
    delete raw.origin; delete raw.agentPath; delete raw.descriptionDerived;
    const issues = validateMetaV2(raw).errors;
    const merged = issues.length ? null : normalizeMeta(raw);
    if (!merged) {
      warnings.push(`workspace variant "${variant.key}" could not adopt the new ports `
        + `(${issues.join('; ') || 'invalid agent metadata'}) — re-point it by hand`);
      continue;
    }
    await writeFile(join(dir, `${variant.key}.meta.json`), JSON.stringify(merged, null, 2) + '\n', 'utf8');
    updated.push(variant.key);
  }
  return { updated: updated.sort(), warnings };
}

/**
 * Saved-template wires that the NEW port set of `key` no longer satisfies:
 * `["<workflow name> (<nodeId>.<portId>)", …]`. A port rename/removal is NOT
 * refused here — no saved template can reference the new port before it exists,
 * so a 409 would make renaming impossible. The RUN refuses instead
 * (assertRunnableWorkflow -> INVALID_GRAPH); this list is the editor's heads-up.
 * `await` is the engine-synthesized gate input and is always wirable.
 * @param {object[]} workflows every saved template (archived included)
 * @param {string} key the edited agent key
 * @param {object} meta the NEW normalized meta
 * @returns {string[]}
 */
function stalePortRefs(workflows, key, meta) {
  const outs = new Set((meta.outputs || []).map((p) => p.id));
  const ins = new Set([...(meta.inputs || []).map((p) => p.id), AWAIT_PORT.id]);
  const hits = [];
  for (const wf of workflows) {
    const mine = new Set((wf.nodes || [])
      .filter((n) => n && n.kind === 'agent' && n.key === key).map((n) => n.id));
    if (!mine.size) continue;
    const label = wf.name || wf.id;
    for (const w of wf.wires || []) {
      if (mine.has(w?.from?.node) && !outs.has(w.from.port)) hits.push(`${label} (${w.from.node}.${w.from.port})`);
      if (mine.has(w?.to?.node) && !ins.has(w.to.port)) hits.push(`${label} (${w.to.node}.${w.to.port})`);
    }
  }
  return hits;
}

/** Update a USER agent (meta and/or markdown). Built-ins -> BUILTIN (409). */
export async function updateAgent(key, { meta: rawMeta, markdown } = {}) {
  if (!AGENT_KEY_RE.test(String(key || ''))) throw err(`agent not found: ${key}`, 'NOT_FOUND');
  const existing = loadAgentRegistry()[key];
  if (existing && existing.origin === 'builtin') {
    throw err(`"${key}" is a built-in agent — duplicate it instead of editing`, 'BUILTIN');
  }
  const origin = String(existing?.origin || '');
  if (origin.startsWith('plugin:')) {
    throw Object.assign(
      new Error(`agent "${key}" is managed by plugin "${origin.slice('plugin:'.length)}" — disable or uninstall the plugin instead`),
      { code: 'PLUGIN' },
    );
  }
  if (!existing) throw err(`agent not found: ${key}`, 'NOT_FOUND');
  // `existing` carries the COMPUTED origin/agentPath/descriptionDerived fields;
  // normalizeMeta's fixed return set drops them, so the spread below never
  // persists them to the sidecar. `description` is the exception: it DOES have a
  // slot, so a description resolved from the .md frontmatter has to be dropped
  // explicitly — otherwise any later save (even one that never touches the
  // field) freezes the fallback into the sidecar and it stops tracking the .md.
  const base = { ...existing };
  if (base.descriptionDerived) base.description = '';
  if (Number(rawMeta?.metaVersion) === 2) for (const k of V2_CLEARABLE) delete base[k];
  const raw = { ...base, ...(rawMeta && typeof rawMeta === 'object' ? rawMeta : {}) };
  raw.key = key;                                            // key immutable on update
  raw.agentFile = `${key}.md`;
  if (!Number.isFinite(Number(raw.order))) raw.order = existing.order;
  // The same gate the create path applies: every failed rule named, nothing written.
  const updIssues = validateMetaV2(raw).errors;
  if (updIssues.length) throw err(updIssues.join('; '), 'BAD_REQUEST');
  const meta = normalizeMeta(raw);
  if (!meta) throw err('invalid agent metadata', 'BAD_REQUEST');
  const dir = requireUserDir();
  if (typeof markdown === 'string') {
    if (!markdown.trim()) throw err('markdown body cannot be empty', 'BAD_REQUEST');
    await writeFile(join(dir, `${key}.md`), markdown, 'utf8');
  }
  await writeFile(join(dir, `${key}.meta.json`), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  const body = typeof markdown === 'string'
    ? markdown
    : await readFile(join(dir, `${key}.md`), 'utf8').catch(() => '');
  // Always present, possibly empty: the Agents view reads both unconditionally.
  const stale = stalePortRefs(await listWorkflows({ includeArchived: true }), key, meta);
  const warnings = stale.length ? [`saved pipelines reference a removed port: ${stale.join(', ')}`] : [];
  const variants = await propagateToVariants(key, meta, dir);
  warnings.push(...variants.warnings);
  return { meta: { ...meta, origin: 'user' }, markdown: body, warnings, updatedVariants: variants.updated };
}

/** Delete a USER agent; REFERENCED (409) while a saved workflow uses the key. */
export async function deleteAgent(key) {
  if (!AGENT_KEY_RE.test(String(key || ''))) throw err(`agent not found: ${key}`, 'NOT_FOUND');
  const existing = loadAgentRegistry()[key];
  if (existing && existing.origin === 'builtin') {
    // "duplicate it" must appear here: the API test pins /duplicate it/i on DELETE.
    throw err(`"${key}" is a built-in agent and cannot be deleted — duplicate it under a new name instead`, 'BUILTIN');
  }
  const origin = String(existing?.origin || '');
  if (origin.startsWith('plugin:')) {
    throw Object.assign(
      new Error(`agent "${key}" is managed by plugin "${origin.slice('plugin:'.length)}" — disable or uninstall the plugin instead`),
      { code: 'PLUGIN' },
    );
  }
  if (!existing) throw err(`agent not found: ${key}`, 'NOT_FOUND');
  const refs = (await listWorkflows({ includeArchived: true }))
    // v1 rows are still live until the engine cut-over; v2 rows carry a key only
    // on kind:'agent' nodes (a task/end/and/or/combine card never does).
    .filter((wf) => (wf.steps || []).some((col) => (col || []).some((n) => n && n.key === key))
      || (wf.nodes || []).some((n) => n && n.kind === 'agent' && n.key === key))
    .map((wf) => wf.name || wf.id);
  if (refs.length) {
    throw err(`agent "${key}" is used by saved workflow(s): ${refs.join(', ')} `
      + '— delete or edit those first (archived rows count)', 'REFERENCED');
  }
  // A workspace variant substitutes for its target agent by KEY: deleting the
  // target would leave the variant pointing at nothing, and the substitution
  // would silently stop happening on workspace runs.
  const variants = Object.values(loadAgentRegistry())
    .filter((m) => m && m.workspaceVariantOf === key)
    .map((m) => m.key);
  if (variants.length) {
    throw err(`agent "${key}" is the workspace variant target of: ${variants.join(', ')} `
      + '— delete or re-point those first', 'REFERENCED');
  }
  const dir = requireUserDir();
  await rm(join(dir, `${key}.meta.json`), { force: true });
  await rm(join(dir, `${key}.md`), { force: true });
  return { ok: true };
}
