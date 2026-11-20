// src/shared/how-it-works/areas.mjs
// The "How it works" area ids and the seen rule, shared by the server
// (validation) and the UI (marks). Pure: no I/O, no imports.

export const GUIDE_AREA_IDS = Object.freeze([
  'chat', 'design', 'runs', 'new', 'schedules', 'stats', 'team-metrics', 'workflows',
  'requirements', 'marketplace', 'connectors', 'models', 'projects',
  'workspaces', 'team-policy', 'settings',
]);

const AREA_ID_SET = new Set(GUIDE_AREA_IDS);

export function isGuideAreaId(id) {
  return typeof id === 'string' && AREA_ID_SET.has(id);
}

// null when prefs are unknown; the legacy workspaceGuideSeen flag still counts
// for the workspaces area.
export function isGuideSeen(prefs, areaId) {
  if (!isGuideAreaId(areaId)) throw new Error(`unknown how-it-works area "${areaId}"`);
  if (prefs == null) return null;
  if (prefs.guidesSeen?.[areaId] === true) return true;
  return areaId === 'workspaces' && prefs.workspaceGuideSeen === true;
}
