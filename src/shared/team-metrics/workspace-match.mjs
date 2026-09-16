// src/shared/team-metrics/workspace-match.mjs
// Does a workspace run record belong to workspace `ws`? Records written since
// `target.workspaceId` exists match on the stable id; older records (and hand-written
// ones) carry only the display name, so they fall back to a case-insensitive name
// match. Matching on the name alone orphaned a workspace's whole history on rename and
// pooled two same-named workspaces of different teammates.
export function matchesWorkspace(target, ws) {
  if (!target || target.kind !== 'workspace' || !ws) return false;
  const id = typeof target.workspaceId === 'string' && target.workspaceId ? target.workspaceId : null;
  if (id && typeof ws.id === 'string' && ws.id) return id === ws.id;
  const name = typeof ws.name === 'string' ? ws.name.toLowerCase() : '';
  return !!name && String(target.workspace || '').toLowerCase() === name;
}
