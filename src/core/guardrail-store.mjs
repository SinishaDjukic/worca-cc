// src/core/guardrail-store.mjs
// Global named guardrail-set store (table: guardrail_sets, SCHEMA_V14). The three
// built-ins — Permissive / Normal / Strict (wire ids permissive/normal/secure; the
// "Strict" label is display-only) — are VIRTUAL: derived from GUARDRAIL_PRESETS at
// read time, never persisted, undeletable, prepended by the server (the
// DEFAULT_WORKFLOW contract). User sets are rows; `settings` is the JSON 5-key
// blob, sanitized on read. Reads never throw: missing/unsafe-id => null/[];
// corrupt settings JSON degrades to the empty policy (the row stays a set).
// deleteGuardrailSet throws ReferencedError while any pipeline resume point pins
// the set (guardrails are selected PER RUN — resume_point.guardrailsId is the only
// reference kind; the historical pipelines.guardrails_id column never blocks).
import { getDb, prepare, tx } from './db.mjs';
import { slugify } from './artifacts.mjs';
import { GUARDRAIL_PRESETS, GUARDRAIL_LEVELS, sanitizeGuardrails } from './guardrails.mjs';
// Shared delete-guard error class (uninstall/delete blocked by live references).
// Reusing it is safe: plugin-workflows imports only db/artifacts/agent-registry/
// workflow-validator/plugins-lock (plugin-workflows.mjs:8-15) — a leaf subtree
// with no cycle back into this module. Its ctor is (message, references); the
// store stamps code:'REFERENCED' at the throw site, and the server ALSO matches
// structurally (err.name === 'ReferencedError' || err.code === 'REFERENCED').
import { ReferencedError } from './plugin-workflows.mjs';

export { ReferencedError };

const EPOCH = '1970-01-01T00:00:00.000Z';

// Wire id -> display name. `secure` renders as "Strict" (display-only rename).
const BUILTIN_META = Object.freeze({ permissive: 'Permissive', normal: 'Normal', secure: 'Strict' });

export const BUILTIN_GUARDRAIL_SET_IDS = Object.freeze(Object.keys(BUILTIN_META));

export function isBuiltinGuardrailSetId(id) {
  return Object.prototype.hasOwnProperty.call(BUILTIN_META, id);
}

/** One virtual built-in, with FRESH settings copies (the frozen preset table never leaks). */
function builtinSet(id) {
  return {
    id,
    name: BUILTIN_META[id],
    origin: 'builtin',
    settings: sanitizeGuardrails(GUARDRAIL_PRESETS[id]),
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

/** All three virtual built-ins, list order Permissive -> Normal -> Strict. Sync: a pure code-table derivation. */
export function listBuiltinGuardrailSets() {
  return BUILTIN_GUARDRAIL_SET_IDS.map(builtinSet);
}

/** A set id is a stem; reject anything that could escape (same rule as workflows). */
const SAFE_SET_ID = /^[A-Za-z0-9_-]+$/;
function isSafeSetId(id) { return typeof id === 'string' && SAFE_SET_ID.test(id); }

/** Map a guardrail_sets row to the set shape. Corrupt settings JSON degrades to the empty policy. */
function rowToSet(r) {
  let settings;
  try { settings = sanitizeGuardrails(JSON.parse(r.settings)); } catch { settings = sanitizeGuardrails(undefined); }
  return { id: r.id, name: r.name, origin: r.origin || null, settings, createdAt: r.created_at, updatedAt: r.updated_at };
}

/** Read one stored row. Unsafe id / missing => null. */
function readRaw(id) {
  if (!isSafeSetId(id)) return null; // SECURITY: reject path-traversal / unsafe ids
  getDb();
  const r = prepare(
    'SELECT id, name, settings, origin, created_at, updated_at FROM guardrail_sets WHERE id = ?'
  ).get(id);
  return r ? rowToSet(r) : null;
}

/**
 * Read a set by id. Built-in ids resolve virtually (readGuardrailSet('secure')
 * returns the Strict built-in); otherwise the stored row, or null.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function readGuardrailSet(id) {
  if (isBuiltinGuardrailSetId(id)) return builtinSet(id);
  return readRaw(id);
}

/**
 * List USER sets (NOT the built-ins — callers prepend listBuiltinGuardrailSets()),
 * newest first by createdAt. Empty store => []. Never throws.
 * @returns {Promise<object[]>}
 */
export async function listGuardrailSets() {
  getDb();
  const rows = prepare(
    'SELECT id, name, settings, origin, created_at, updated_at FROM guardrail_sets ORDER BY created_at DESC, id'
  ).all();
  return rows.filter((r) => !isBuiltinGuardrailSetId(r.id)).map(rowToSet);
}

/**
 * Persist a set. Mints gr_<slug> from the name when id is missing; sanitizes the
 * settings blob; preserves created_at on re-save; upsert OMITS origin (a user
 * re-save of a plugin row keeps its provenance; user rows stay NULL). Reserved
 * ids (the GUARDRAIL_LEVELS words: the three built-ins + 'custom') and unsafe
 * explicit ids return null — built-ins are code, not rows.
 * @param {object} set { id?, name, settings, createdAt? }
 * @returns {Promise<object|null>}
 */
export async function writeGuardrailSet(set) {
  const now = new Date().toISOString();
  const name = (set && typeof set.name === 'string' && set.name.trim()) || 'Untitled';
  const id = (set && typeof set.id === 'string' && set.id.trim()) || `gr_${slugify(name)}`;
  if (!isSafeSetId(id) || GUARDRAIL_LEVELS.includes(id)) return null; // reserved: builtin ids + 'custom'
  const settings = sanitizeGuardrails(set?.settings);

  getDb();
  // Preserve the original createdAt (and report provenance) if this id already exists.
  const existing = prepare('SELECT created_at, origin FROM guardrail_sets WHERE id = ?').get(id);
  const createdAt =
    (set && typeof set.createdAt === 'string' && set.createdAt) ||
    (existing && existing.created_at) ||
    now;

  const stored = { id, name, origin: (existing && existing.origin) || null, settings, createdAt, updatedAt: now };
  tx(() => {
    prepare(`
      INSERT INTO guardrail_sets (id, name, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, settings = excluded.settings, updated_at = excluded.updated_at
    `).run(id, name, JSON.stringify(settings), createdAt, now);
  });
  return stored;
}

/**
 * SYNC reference scan: pipeline resume points whose rp.guardrailsId pins this id
 * (Phase 2 writes the field; done/stopped runs null their resume point, so only
 * recoverable runs pin — errored rows retain theirs and legitimately block, the
 * plugin-workflows scope). The historical pipelines.guardrails_id COLUMN is
 * deliberately NOT scanned: it records finished runs, and history never blocks.
 * ARCHIVED rows are excluded for the same reason they are excluded from every
 * list read: History's Archive soft-deletes (archived_at stamped, resume_point
 * left in place), and an archived run is invisible, unresumable and un-re-
 * archivable — so a kept pin would be permanent with no UI escape hatch. The
 * hard DELETE this replaced released it.
 * Raw prepare() reads only, so it is callable from inside deleteGuardrailSet's
 * tx (tx() non-reentrancy bars nested tx() CALLS, not reads).
 */
function scanReferences(id) {
  const referencedBy = [];
  for (const p of prepare(
    'SELECT id, resume_point FROM pipelines WHERE resume_point IS NOT NULL AND archived_at IS NULL',
  ).all()) {
    try {
      const rp = JSON.parse(p.resume_point);
      if (rp && rp.guardrailsId === id) referencedBy.push(`pipeline ${p.id}`);
    } catch { /* corrupt resume point: not a reference */ }
  }
  return referencedBy.length ? [{ id, referencedBy }] : [];
}

/**
 * Who still pins this set (the async API wrapper around scanReferences).
 * @param {string} id
 * @returns {Promise<Array<{id: string, referencedBy: string[]}>>}
 */
export async function guardrailSetReferences(id) {
  getDb();
  return scanReferences(id);
}

/**
 * Delete a saved set. Refuses built-ins and unsafe ids (false); throws
 * ReferencedError (with the structured referencing list) while any resume-point
 * pin exists — nothing deleted; false when no row exists; true on removal.
 * The reference scan runs INSIDE the same tx as the DELETE (raw prepare()
 * reads — tx() non-reentrancy bars nested tx() calls, not reads), so a pin
 * written between scan and DELETE can never slip through and dangle. House
 * precedent (plugin-workflows removePluginWorkflows) scans outside its tx; we
 * deviate deliberately: a stranded workflow ref merely falls back to the
 * default topology, a stranded guardrail pin silently downgrades a paused
 * run's selected SECURITY policy to Permissive at resume.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteGuardrailSet(id) {
  if (isBuiltinGuardrailSetId(id)) return false; // built-ins are undeletable
  if (!isSafeSetId(id)) return false;            // SECURITY: reject unsafe ids
  getDb();
  let changed = 0;
  tx(() => {
    const references = scanReferences(id);
    if (references.length) {
      const lines = references.map((r) => `  - ${r.id} (referenced by ${r.referencedBy.join(', ')})`);
      const err = new ReferencedError(
        `cannot delete guardrail set "${id}" — still referenced:\n${lines.join('\n')}`,
        references,
      );
      err.code = 'REFERENCED'; // structural server match (the 409 mapping)
      throw err; // tx() rolls back (nothing written) and rethrows
    }
    changed = prepare('DELETE FROM guardrail_sets WHERE id = ?').run(id).changes;
  });
  return changed > 0;
}
