// src/core/source-bindings.mjs
// Which PROFILE of a plugin task source a project (or workspace) pulls from.
//
// The problem this solves: one worca install drives several projects, and each
// may belong to a different tracker instance — repo A files tickets in one Jira,
// repo B in another. Making that a per-run dropdown is how you start a pipeline
// against the wrong tracker: the mistake is silent (the wrong ticket text simply
// lands in the prompt) and only visible once the run is underway. So the choice
// is made ONCE per project and remembered here.
//
// Rows are (scope_type, scope_key, plugin, source_id) -> profile. A project that
// pulls from two different sources binds each independently.
//
// Deliberately tolerant on read: an unbound scope, an uninstalled plugin and a
// profile that was since deleted all collapse to the same answer (null / the
// fallback), because every caller's next move is identical — ask the user.

import { getDb, prepare } from './db.mjs';

/** The two scopes a binding can hang off. */
const SCOPES = new Set(['project', 'workspace']);

function checkScope(scopeType) {
  if (!SCOPES.has(scopeType)) throw new Error(`invalid binding scope "${scopeType}"`);
  return scopeType;
}

const key = (o = {}) => ({
  scopeType: checkScope(o.scopeType),
  scopeKey: String(o.scopeKey || ''),
  plugin: String(o.plugin || ''),
  sourceId: String(o.sourceId || ''),
});

/**
 * The profile explicitly bound to this scope, or null. No fallback logic — use
 * resolveProfile() for that.
 * @returns {string|null}
 */
export function getBinding(ref) {
  const k = key(ref);
  if (!k.scopeKey || !k.plugin || !k.sourceId) return null;
  getDb();
  const row = prepare(
    'SELECT profile FROM source_bindings WHERE scope_type = ? AND scope_key = ? AND plugin = ? AND source_id = ?'
  ).get(k.scopeType, k.scopeKey, k.plugin, k.sourceId);
  return row ? String(row.profile) : null;
}

/** Bind (or re-bind) a scope to a profile. Returns the stored profile. */
export function setBinding(ref, profile) {
  const k = key(ref);
  const p = String(profile || '').trim();
  if (!k.scopeKey || !k.plugin || !k.sourceId) throw new Error('binding needs scopeKey, plugin and sourceId');
  if (!p) throw new Error('binding needs a profile');
  getDb();
  prepare(`
    INSERT INTO source_bindings (scope_type, scope_key, plugin, source_id, profile, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (scope_type, scope_key, plugin, source_id)
    DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at
  `).run(k.scopeType, k.scopeKey, k.plugin, k.sourceId, p, new Date().toISOString());
  return p;
}

/** Remove a binding. Silent when there was none. */
export function clearBinding(ref) {
  const k = key(ref);
  getDb();
  prepare(
    'DELETE FROM source_bindings WHERE scope_type = ? AND scope_key = ? AND plugin = ? AND source_id = ?'
  ).run(k.scopeType, k.scopeKey, k.plugin, k.sourceId);
  return { ok: true };
}

/** Every binding for one scope: [{ plugin, sourceId, profile }]. */
export function listBindingsForScope(scopeType, scopeKey) {
  getDb();
  return prepare(
    'SELECT plugin, source_id, profile FROM source_bindings WHERE scope_type = ? AND scope_key = ? ORDER BY plugin, source_id'
  ).all(checkScope(scopeType), String(scopeKey || ''))
    .map((r) => ({ plugin: r.plugin, sourceId: r.source_id, profile: r.profile }));
}

/** Drop every binding naming a profile — called when that profile is deleted, so
 *  a project never points at a profile that is gone. Plugin-wide (no sourceId):
 *  profiles and their buckets are per-PLUGIN, so deleting one dangles every
 *  source's binding to it, not just the source the delete came in through.
 *  Returns the row count. */
export function clearBindingsForProfile(plugin, profile) {
  getDb();
  const r = prepare(
    'DELETE FROM source_bindings WHERE plugin = ? AND profile = ?'
  ).run(String(plugin || ''), String(profile || ''));
  return Number(r?.changes ?? 0);
}

/** Drop every binding for a plugin — called on uninstall. */
export function clearBindingsForPlugin(plugin) {
  getDb();
  prepare('DELETE FROM source_bindings WHERE plugin = ?').run(String(plugin || ''));
  return { ok: true };
}

/**
 * The profile a run should use, with the fallbacks that make the common case
 * invisible:
 *
 *   1. an explicit binding on this scope wins;
 *   2. for a WORKSPACE with no binding of its own, the member projects' bindings
 *      decide — but only if they AGREE. Members split across two trackers is a
 *      real ambiguity, and guessing one would be the silent-wrong-tracker bug
 *      this module exists to prevent, so it stays unresolved;
 *   3. a source with exactly one profile needs no ceremony — use it;
 *   4. otherwise null: the caller must ask.
 *
 * `available` is the source's profile id list (plugin-config#listProfiles). A
 * binding naming a profile that is no longer in it is treated as absent, so
 * deleting a profile degrades to "ask" rather than to a broken run.
 *
 * @param {{scopeType:string, scopeKey:string, plugin:string, sourceId:string,
 *          memberKeys?:string[], available?:string[]}} ref
 * @returns {{profile:string|null, via:'binding'|'members'|'only'|'none'|'conflict',
 *           candidates?:string[]}}
 */
export function resolveProfile(ref = {}) {
  const available = Array.isArray(ref.available) ? ref.available.map(String) : null;
  const known = (p) => !!p && (!available || available.includes(p));

  const own = getBinding(ref);
  if (known(own)) return { profile: own, via: 'binding' };

  if (ref.scopeType === 'workspace' && Array.isArray(ref.memberKeys) && ref.memberKeys.length) {
    const found = new Set();
    for (const k of ref.memberKeys) {
      const p = getBinding({ scopeType: 'project', scopeKey: k, plugin: ref.plugin, sourceId: ref.sourceId });
      if (known(p)) found.add(p);
    }
    if (found.size === 1) return { profile: [...found][0], via: 'members' };
    if (found.size > 1) return { profile: null, via: 'conflict', candidates: [...found] };
  }

  if (available && available.length === 1) return { profile: available[0], via: 'only' };
  return { profile: null, via: 'none' };
}
