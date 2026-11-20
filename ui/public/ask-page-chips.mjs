// ui/public/ask-page-chips.mjs — Ask worca beside the page: what the page on screen gives the chat. Pure.
// pageChips: the composer's chips for a page context (app.js getPageContext), each naming the context keys it stands
// for; withoutChips: the context minus the chips the person left out; pageScopeOf: the project or workspace the page is
// ABOUT (a new dock chat starts there). Ids, keys and enum slugs in, display names from the caller (`names`).
import { whereOf } from '../../src/shared/ask-where.mjs';
import { isNoProjectKey } from '../../src/shared/no-project.mjs';

const RUN_VIEWS = new Set(['running', 'history-detail']);
const RUN_KEYS = Object.freeze(['runId', 'pipelineId', 'runPage', 'diffPath', 'view']);
const PAGE_KEYS = Object.freeze(['view', 'tmScope', 'tmRange', 'tmGroupBy', 'tmFilter', 'tpScope']);
const str = (v) => (typeof v === 'string' && v ? v : '');
/** A workspace run's diff path names its member: "a.mjs (member worca-cc-551183d0)" reads as "a.mjs". */
const fileName = (p) => p.replace(/ \(member [^)]*\)$/, '');

/**
 * The chips for one page context. `names` = `{ run?, runStatus?, project?, workspace? }`, the display names the caller
 * knows (ids are the fallback). Chat, Workflows and no view: none.
 * @returns {{ id: string, kind: 'run'|'file'|'project'|'workspace'|'page', caption: string, name: string, icon: string,
 *   leaveOut: string, keys: string[], parent?: string, status?: string }[]}
 */
export function pageChips(ctx, names = {}) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const n = names && typeof names === 'object' ? names : {};
  const where = whereOf(c);
  if (!where) return [];
  // A live run is keyed by its run id (its pipeline id lands with a later frame: a chip left out must stay out), a
  // saved run by its pipeline id.
  const run = c.view === 'running' ? str(c.runId) || str(c.pipelineId) : str(c.pipelineId) || str(c.runId);
  if (RUN_VIEWS.has(c.view) && run) {
    const id = `run:${run}`;
    const chip = { id, kind: 'run', caption: 'Run', name: str(n.run) || str(c.pipelineId) || run.slice(0, 8), icon: 'run', leaveOut: 'Leave this run out', keys: [...RUN_KEYS] };
    if (str(n.runStatus)) chip.status = n.runStatus;
    const out = [chip];
    if (str(c.diffPath)) {
      // The file's id names its run: the same path left out on one run is not left out on the next one.
      out.push({ id: `file:${run}:${c.diffPath}`, kind: 'file', caption: 'File', name: fileName(c.diffPath), icon: 'diff', leaveOut: 'Leave this file out', keys: ['diffPath'], parent: id });
    }
    return out;
  }
  if (str(c.pageProjectKey)) {
    return [{ id: `project:${c.pageProjectKey}`, kind: 'project', caption: 'Project', name: str(n.project) || c.pageProjectKey, icon: 'project', leaveOut: 'Leave this project out', keys: ['pageProjectKey', 'view'] }];
  }
  if (str(c.pageWorkspaceId)) {
    return [{ id: `workspace:${c.pageWorkspaceId}`, kind: 'workspace', caption: 'Workspace', name: str(n.workspace) || c.pageWorkspaceId, icon: 'workspace', leaveOut: 'Leave this workspace out', keys: ['pageWorkspaceId', 'view'] }];
  }
  return [{ id: `page:${c.view}`, kind: 'page', caption: 'Page', name: where.label, icon: where.icon, leaveOut: 'Leave this page out', keys: [...PAGE_KEYS] }];
}

/** A copy of `ctx` without the keys of every left-out chip and of every chip whose parent is left out. The scope's
 *  target keys (projectDir, projectKey, workspaceId, projectSource) are never a chip's: the panel's scopedContext owns them. */
export function withoutChips(ctx, chips, leftOut) {
  const out = { ...(ctx && typeof ctx === 'object' ? ctx : {}) };
  const gone = leftOut instanceof Set ? leftOut : new Set();
  for (const chip of Array.isArray(chips) ? chips : []) {
    if (!chip || !(gone.has(chip.id) || (chip.parent && gone.has(chip.parent)))) continue;
    for (const k of chip.keys || []) delete out[k];
  }
  return out;
}

/** The project or workspace the page is ABOUT — `{ pinned: true, projectKey | workspaceId, label }` — else null: a
 *  project or workspace page, a run (its workspace, its project key, else its folder), the New run page's target.
 *  Never No project, never the dropdown's fallback folder, never a row this tab does not know. */
export function pageScopeOf(ctx, projects = [], workspaces = []) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const P = Array.isArray(projects) ? projects : [];
  const W = Array.isArray(workspaces) ? workspaces : [];
  const project = (p) => (p ? { pinned: true, projectKey: p.key, label: p.name || p.key } : null);
  const workspace = (w) => (w ? { pinned: true, workspaceId: w.id, label: w.name || w.id } : null);
  const byKey = (k) => (str(k) && !isNoProjectKey(k) ? P.find((p) => p && p.key === k) : null);
  const byId = (id) => (str(id) ? W.find((w) => w && w.id === id) : null);
  if (str(c.pageProjectKey)) return project(byKey(c.pageProjectKey));
  if (str(c.pageWorkspaceId)) return workspace(byId(c.pageWorkspaceId));
  const run = RUN_VIEWS.has(c.view);
  if (!run && c.view !== 'new') return null;
  if (str(c.workspaceId)) return workspace(byId(c.workspaceId));
  if (run && str(c.projectKey)) return project(byKey(c.projectKey));
  if (str(c.projectDir) && c.projectSource !== 'fallback') return project(P.find((p) => p && p.path === c.projectDir));
  return null;
}
