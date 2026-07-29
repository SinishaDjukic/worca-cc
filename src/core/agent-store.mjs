// src/core/agent-store.mjs
// CRUD for USER agents: <worcaHome()>/agents/<key>.meta.json + <key>.md pairs,
// layered under the read-only built-in repo agents/ dir by the Phase 1 registry.
// Validation + persistence live here (thin-core pattern, mirrors workspaces.mjs);
// HTTP mapping is the route's.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAgentRegistry, normalizeMeta, userAgentsDir } from './agent-registry.mjs';
import { listWorkflows } from './workflows.mjs';

export { userAgentsDir }; // single source: the Phase 1 layer resolver

/** A key is a bare alphanumeric stem — can never contain "/" or "..". */
export const AGENT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function err(message, code) { return Object.assign(new Error(message), { code }); }

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
  // `existing` carries the COMPUTED origin/agentPath fields; normalizeMeta's fixed
  // return set drops them, so the spread below never persists them to the sidecar.
  const raw = { ...existing, ...(rawMeta && typeof rawMeta === 'object' ? rawMeta : {}) };
  raw.key = key;                                            // key immutable on update
  raw.agentFile = `${key}.md`;
  if (!Number.isFinite(Number(raw.order))) raw.order = existing.order;
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
  return { meta: { ...meta, origin: 'user' }, markdown: body };
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
  const refs = (await listWorkflows())
    .filter((wf) => (wf.steps || []).some((col) => (col || []).some((n) => n && n.key === key)))
    .map((wf) => wf.name || wf.id);
  if (refs.length) {
    throw err(`agent "${key}" is used by saved workflow(s): ${refs.join(', ')} — delete or edit those first`, 'REFERENCED');
  }
  const dir = requireUserDir();
  await rm(join(dir, `${key}.meta.json`), { force: true });
  await rm(join(dir, `${key}.md`), { force: true });
  return { ok: true };
}
