// src/core/run-presets-store.mjs — run presets (docs/run-presets.md): named New run setups.
// Reads never throw on a bad row (corrupt JSON reads as {}); writes throw Error with code
// BAD_PRESET (400), DUPLICATE (409), NOT_FOUND (404) or NO_RUN_SETUP (409). `owner` is the identity on a shared
// deployment (askViewer) or null on a local install, where every preset is visible.
import { randomBytes } from 'node:crypto';
import { getDb, tx } from './db.mjs';
import { setupFromBody, checkPresetName, PRESET_LIMITS, PRESET_SCOPES } from '../shared/run-presets.mjs';

const ID_RE = /^rp_[0-9a-f]{12}$/;
const fail = (code, message) => Object.assign(new Error(message), { code });

function rowToPreset(r) {
  let setup = {};
  try { setup = JSON.parse(r.setup); } catch { setup = {}; }
  return {
    id: r.id, name: r.name, scope: { kind: r.scope_kind, ref: r.scope_ref || null },
    setup, createdBy: r.created_by || null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function ownerClause(owner) { return owner == null ? { sql: '', args: [] } : { sql: ' AND created_by = ?', args: [owner] }; }

function cleanScope(scope) {
  const kind = scope && PRESET_SCOPES.includes(scope.kind) ? scope.kind : 'global';
  const ref = kind === 'global' ? null : (typeof scope.ref === 'string' && scope.ref.trim() ? scope.ref.trim() : null);
  if (kind !== 'global' && !ref) throw fail('BAD_PRESET', `a ${kind} preset needs a ${kind}`);
  return { kind, ref };
}

function cleanSetup(setup, scope) {
  const s = setupFromBody(setup || {}, { scope: scope.kind });
  const json = JSON.stringify(s);
  if (Buffer.byteLength(json) > PRESET_LIMITS.setupBytes) throw fail('BAD_PRESET', `setup too large (max ${PRESET_LIMITS.setupBytes} bytes)`);
  return json;
}

export function listPresets({ owner = null } = {}) {
  const o = ownerClause(owner);
  return getDb().prepare(`SELECT * FROM run_presets WHERE 1=1${o.sql} ORDER BY name COLLATE NOCASE`).all(...o.args).map(rowToPreset);
}

export function readPreset(id, { owner = null } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const o = ownerClause(owner);
  const r = getDb().prepare(`SELECT * FROM run_presets WHERE id = ?${o.sql}`).get(id, ...o.args);
  return r ? rowToPreset(r) : null;
}

export function createPreset({ name, scope, setup }, { owner = null, now = new Date() } = {}) {
  const bad = checkPresetName(name);
  if (bad) throw fail('BAD_PRESET', bad);
  const sc = cleanScope(scope);
  const json = cleanSetup(setup, sc);
  const id = `rp_${randomBytes(6).toString('hex')}`;
  const ts = now.toISOString();
  try {
    getDb().prepare('INSERT INTO run_presets (id, name, scope_kind, scope_ref, setup, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, name.trim(), sc.kind, sc.ref, json, owner, ts, ts);
  } catch (e) {
    if (/UNIQUE/.test(String(e.message))) throw fail('DUPLICATE', 'a preset with this name already exists');
    throw e;
  }
  return readPreset(id);
}

export function updatePreset(id, patch, { owner = null, now = new Date() } = {}) {
  tx(() => {
    const cur = readPreset(id, { owner });
    if (!cur) throw fail('NOT_FOUND', 'preset not found');
    const name = patch.name === undefined ? cur.name : patch.name;
    const bad = checkPresetName(name);
    if (bad) throw fail('BAD_PRESET', bad);
    const sc = patch.scope === undefined ? cur.scope : cleanScope(patch.scope);
    const json = cleanSetup(patch.setup === undefined ? cur.setup : patch.setup, sc);
    try {
      getDb().prepare('UPDATE run_presets SET name = ?, scope_kind = ?, scope_ref = ?, setup = ?, updated_at = ? WHERE id = ?')
        .run(name.trim(), sc.kind, sc.ref, json, now.toISOString(), id);
    } catch (e) {
      if (/UNIQUE/.test(String(e.message))) throw fail('DUPLICATE', 'a preset with this name already exists');
      throw e;
    }
  });
  return readPreset(id);
}

export function duplicatePreset(id, { name, owner = null, now = new Date() } = {}) {
  const cur = readPreset(id, { owner });
  if (!cur) throw fail('NOT_FOUND', 'preset not found');
  const taken = new Set(listPresets({ owner }).map((p) => p.name.toLowerCase()));
  let next = name && name.trim() ? name.trim() : `${cur.name} (copy)`;
  for (let i = 2; !name && taken.has(next.toLowerCase()); i++) next = `${cur.name} (copy ${i})`;
  return createPreset({ name: next, scope: cur.scope, setup: cur.setup }, { owner, now });
}

export function deletePreset(id, { owner = null } = {}) {
  const o = ownerClause(owner);
  return getDb().prepare(`DELETE FROM run_presets WHERE id = ?${o.sql}`).run(id, ...o.args).changes > 0;
}

// Pipeline ids are worca-minted (dated slug + short hex); anything else is not a run.
const PIPELINE_ID_RE = /^[A-Za-z0-9._-]{1,160}$/;

/**
 * The setup a run kept at start (pipelines.run_setup, v62). undefined when there is no such run; `setup: null` for a
 * run started before v62, by the CLI, or a scan (and for a corrupt value). `target` is the run's own project/workspace.
 */
export function readRunSetup(pipelineId) {
  if (typeof pipelineId !== 'string' || !PIPELINE_ID_RE.test(pipelineId) || pipelineId.includes('..')) return undefined;
  const r = getDb().prepare('SELECT run_setup, project_key, workspace_key, target FROM pipelines WHERE id = ?').get(pipelineId);
  if (!r) return undefined;
  let setup = null;
  if (typeof r.run_setup === 'string' && r.run_setup) {
    try { const v = JSON.parse(r.run_setup); setup = v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { setup = null; }
  }
  const target = r.target === 'workspace' && r.workspace_key ? { kind: 'workspace', ref: r.workspace_key } : { kind: 'project', ref: r.project_key };
  return { setup, target };
}

/** Save setup as preset (a run's page): the run's stored setup, as is, through createPreset's rules. */
export function createPresetFromRun(pipelineId, { name, scope } = {}, opts = {}) {
  const run = readRunSetup(pipelineId);
  if (run === undefined) throw fail('NOT_FOUND', 'run not found');
  if (!run.setup) throw fail('NO_RUN_SETUP', 'This run started before Worca kept run setups, so there is nothing to save');
  return createPreset({ name, scope, setup: run.setup }, opts);
}
