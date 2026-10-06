// src/core/policy/cache.mjs
// Synchronous reads of the team-policy DISCOVERY CACHE (project_config.extra.teamPolicy) for the
// modules that apply default-kind fields where they already read settings: config.mjs (default
// workflow, human in the loop, step models, the model catalog and its routing env),
// guardrail-store.mjs (policy guardrail sets), ask/limits.mjs (Ask Worca limits).
//
// Deliberately a LEAF: it imports only db.mjs, store.mjs and the pure registry/effective pair and
// shared/team-metrics/slug.mjs, never config.mjs or policy/sync.mjs, so config.mjs can import it without a cycle. It never
// touches git: the cache is written by policy/sync.mjs discovery (server start + hourly, or
// `worca policy pull`), and a project with no cache simply has no team defaults.

import { prepare, getDb } from '../db.mjs';
import { projectKey } from '../store.mjs';
import { normalizePolicyDoc } from './registry.mjs';
import { fieldsForRun } from './effective.mjs';
import { canonicalMetricsSlug } from '../../shared/team-metrics/slug.mjs';

const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; } catch { return null; } };

/**
 * The one cache row that stands for each carrying home: a registered project's row first (a row an older Worca left
 * behind for a removed project never shadows the live one), then the newest discovery. `doc` is null when this build
 * cannot read the policy (a newer schema, a branch file that is not JSON). MCP registry spec §11.2, §11.3.
 */
function homeRows() {
  getDb();
  const rows = prepare(`SELECT pc.project_key, pc.extra, p.key IS NOT NULL AS registered FROM project_config pc
    LEFT JOIN projects p ON p.key = pc.project_key WHERE pc.extra LIKE '%teamPolicy%'`).all();
  const found = [];
  for (const r of rows) {
    const tp = parse(r.extra)?.teamPolicy;
    if (!tp || !tp.present || !tp.docKnown || tp.delegateTo || !tp.slug) continue;
    // Canonical: a home cached under an older Azure spelling and today's is one home (M3).
    found.push({ r, tp, slug: canonicalMetricsSlug(String(tp.slug).toLowerCase()), at: typeof tp.checkedAt === 'string' ? tp.checkedAt : '' });
  }
  found.sort((a, b) => (Number(b.r.registered) - Number(a.r.registered)) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const out = new Map();
  for (const { r, tp, slug } of found) {
    if (out.has(slug)) continue;
    // Re-normalise: the cache was written by this or an older build; the reader is the contract.
    const norm = tp.unknownSchema || !tp.doc ? null : normalizePolicyDoc(tp.doc);
    // `warnings`: what the discovering read and this re-read dropped. An `mcp.required` entry this build cannot read
    // is still listed (MCP registry spec §11.2; registry.mjs mcpListComplete).
    const warnings = [...(Array.isArray(tp.warnings) ? tp.warnings : []), ...(norm ? norm.warnings : [])].filter((w) => typeof w === 'string');
    out.set(slug, { slug, sha: tp.headSha ?? null, doc: norm?.doc ?? null, key: r.project_key, warnings });
  }
  return [...out.values()];
}

/** Every cached, carrying policy on this machine that this build reads: [{ slug, sha, doc, key, warnings }]. Never throws. */
export function cachedPolicyHomes() {
  try { return homeRows().filter((h) => h.doc); } catch { return []; }
}

/** The homes a cached row carries whose policy this build cannot read: their Team state stays and their `policy:`
 *  servers do not retire (MCP registry spec §11.2) — they are not "no longer required". Never throws. */
export function unreadablePolicyHomes() {
  try { return new Set(homeRows().filter((h) => !h.doc).map((h) => h.slug)); } catch { return new Set(); }
}

/**
 * The policy that governs `projectDir` from the cache alone: its own, or the cached home it
 * follows. null when there is none (no branch, not discovered yet, a dangling marker).
 * @returns {{home:string, sha:string|null, doc:object}|null}
 */
export function cachedPolicyFor(projectDir) {
  if (!projectDir) return null;
  let key;
  try { key = projectKey(projectDir); } catch { return null; }
  return cachedPolicyForKey(key);
}

/** Same as cachedPolicyFor, by project key (Ask Worca's pinned scope carries only the key). */
export function cachedPolicyForKey(key) {
  if (!key || typeof key !== 'string') return null;
  let tp;
  try {
    getDb();
    const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
    tp = row ? parse(row.extra)?.teamPolicy : null;
  } catch { return null; }
  if (!tp || !tp.present || !tp.docKnown || tp.unknownSchema) return null;
  if (!tp.delegateTo) {
    const doc = tp.doc ? normalizePolicyDoc(tp.doc).doc : null;
    return doc ? { home: canonicalMetricsSlug(String(tp.slug || '').toLowerCase()), sha: tp.headSha ?? null, doc } : null;
  }
  // A marker committed by older code may name the home's older Azure spelling; both sides are canonical here.
  const want = canonicalMetricsSlug(String(tp.delegateTo).toLowerCase());
  const home = cachedPolicyHomes().find((h) => h.slug === want);
  return home ? { home: home.slug, sha: home.sha, doc: home.doc } : null;
}

/** The team entries that apply to project runs of `projectDir`, from the cache: {} when none. */
export function cachedFieldsFor(projectDir) {
  const p = cachedPolicyFor(projectDir);
  return p ? fieldsForRun(p.doc) : {};
}

/** A single default-kind team value for `projectDir` (or undefined). Soft entries are not defaults. */
export function teamDefault(projectDir, key) {
  const e = cachedFieldsFor(projectDir)[key];
  return e && e.kind === 'default' ? e.value : undefined;
}

/**
 * The union of the model catalogs every cached home ships, first home wins on an id collision.
 * Each entry carries `home` for the policy badge.
 */
export function policyCatalogModels() {
  const out = []; const seen = new Set();
  for (const h of cachedPolicyHomes()) {
    for (const m of h.doc.catalogs?.models || []) {
      const lc = m.id.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      out.push({ ...m, home: h.slug });
    }
  }
  return out;
}

/** The union of the guardrail sets every cached home ships, as virtual `gp:<id>` sets. */
export function policyGuardrailSets() {
  const out = []; const seen = new Set();
  for (const h of cachedPolicyHomes()) {
    for (const s of h.doc.catalogs?.guardrailSets || []) {
      const id = `gp:${s.id}`;
      if (seen.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase());
      out.push({
        id, name: s.name, origin: `policy:${h.slug}`,
        settings: { honorProjectSettings: s.honorProjectSettings !== false, envScrub: s.envScrub === true,
          envAllowlist: [...s.envAllowlist], protectedPaths: [...s.protectedPaths], deny: [...s.deny] },
        createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z',
      });
    }
  }
  return out;
}
