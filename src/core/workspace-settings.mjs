// src/core/workspace-settings.mjs
// A workspace's own settings (workspaces.settings_json, v86). Today one id: `pr.open`, the workspace layer of
// "open a PR when a run finishes". Workspace runs have no project layer, so this is the only place a workspace
// can say it; `pr.slices` is a per-project setting (a workspace run is never sliced).

import { getDb, prepare, tx } from './db.mjs';
import { PR_OPEN } from '../shared/pr-auto.mjs';

export const WORKSPACE_SETTING_IDS = Object.freeze(['pr.open']);

const refuse = (status, message) => Object.assign(new Error(message), { status });
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The stored settings: `{}` when the column is NULL or invalid, null when the workspace is unknown. */
export function readWorkspaceSettings(id) {
  getDb();
  const row = prepare('SELECT settings_json FROM workspaces WHERE id = ?').get(id);
  if (!row) return null;
  try { const v = JSON.parse(row.settings_json); return isObj(v) ? v : {}; } catch { return {}; }
}

/** Apply `{ [id]: value | null }` (null clears). Every check runs before the single UPDATE. Returns the stored settings. */
export function writeWorkspaceSettings(id, patch) {
  const current = readWorkspaceSettings(id);
  if (!current) throw refuse(404, 'unknown workspace');
  if (!isObj(patch)) throw refuse(400, 'workspace settings must be an object of setting id → value (null clears it)');
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'pr.slices') throw refuse(400, 'pr.slices is set per project (workspace runs are never sliced)');
    if (!WORKSPACE_SETTING_IDS.includes(key)) throw refuse(400, `unknown workspace setting "${key}"`);
    if (value === null) { delete next[key]; continue; }
    if (!PR_OPEN.includes(value)) throw refuse(400, 'pr.open must be one of none | draft | ready');
    next[key] = value;
  }
  tx(() => {
    prepare('UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?')
      .run(Object.keys(next).length ? JSON.stringify(next) : null, new Date().toISOString(), id);
  });
  return next;
}
