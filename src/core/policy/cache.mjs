// src/core/policy/cache.mjs
// Synchronous reads of the team-policy DISCOVERY CACHE (project_config.extra.teamPolicy) for the
// modules that apply default-kind fields where they already read settings: config.mjs (default
// workflow, human in the loop, step models, the model catalog and its routing env),
// guardrail-store.mjs (policy guardrail sets), ask/limits.mjs (Ask Worca limits).
//
// Deliberately a LEAF: it imports only db.mjs, store.mjs and the pure registry/effective pair,
// never config.mjs or policy/sync.mjs, so config.mjs can import it without a cycle. It never
// touches git: the cache is written by policy/sync.mjs discovery (server start + hourly, or
// `worca policy pull`), and a project with no cache simply has no team defaults.

import { prepare, getDb } from '../db.mjs';
import { projectKey } from '../store.mjs';
import { normalizePolicyDoc } from './registry.mjs';
import { fieldsForRun } from './effective.mjs';

const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; } catch { return null; } };

/** Every cached, carrying policy on this machine: [{ slug, sha, doc, key }]. Never throws. */
export function cachedPolicyHomes() {
  try {
    getDb();
    const rows = prepare("SELECT project_key, extra FROM project_config WHERE extra LIKE '%teamPolicy%'").all();
    const out = []; const seen = new Set();
    for (const r of rows) {
      const tp = parse(r.extra)?.teamPolicy;
      if (!tp || !tp.present || !tp.docKnown || tp.delegateTo || tp.unknownSchema || !tp.doc || !tp.slug) continue;
      const slug = String(tp.slug).toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      // Re-normalise: the cache was written by this or an older build; the reader is the contract.
      const doc = normalizePolicyDoc(tp.doc).doc;
      if (doc) out.push({ slug, sha: tp.headSha ?? null, doc, key: r.project_key });
    }
    return out;
  } catch { return []; }
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
    return doc ? { home: String(tp.slug || '').toLowerCase(), sha: tp.headSha ?? null, doc } : null;
  }
  const want = String(tp.delegateTo).toLowerCase();
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
