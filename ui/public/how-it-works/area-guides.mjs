// The "How it works" registry: every area's explainer, and which area a route belongs to.
// The copy is static data in guides/*.mjs; this module merges it, freezes it, and adds the
// existing Workspaces walkthrough as-is.
import { WORK_GUIDES } from './guides/work.mjs';
import { BUILD_GUIDES } from './guides/build.mjs';
import { MANAGE_GUIDES } from './guides/manage.mjs';
import { WORKSPACE_GUIDE_STEPS } from '../workspace-guide.mjs';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const WORKSPACES_GUIDE = {
  title: 'How workspaces work',
  tour: 'workspace',
  steps: WORKSPACE_GUIDE_STEPS,
  controls: [],
};

export const AREA_GUIDES = deepFreeze({
  ...WORK_GUIDES,
  ...BUILD_GUIDES,
  ...MANAGE_GUIDES,
  workspaces: WORKSPACES_GUIDE,
});

// The Runs area owns four list-like routes; every other guide area is its own route.
const RUNS_ROUTES = new Set(['running', 'history', 'feature', 'group']);

/** The area's guide, or null when the id has none. */
export function guideFor(areaId) {
  return Object.hasOwn(AREA_GUIDES, areaId) ? AREA_GUIDES[areaId] : null;
}

/** The guide area a route name belongs to, or null (getting-started, profile, workspace-create...). */
export function areaOfRoute(name) {
  if (RUNS_ROUTES.has(name)) return 'runs';
  return Object.hasOwn(AREA_GUIDES, name) ? name : null;
}
