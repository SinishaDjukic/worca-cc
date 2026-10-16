// src/core/tag-dimensions.mjs — which tag dimensions apply (D7): the run target's team policy
// field runs.tagDimensions, else the user's Settings list, else none. Cache-only policy reads
// (discover:false): a page load never fetches git.
import { resolveProjectPolicy, resolveWorkspacePolicy } from './policy/sync.mjs';
import { fieldsForRun } from './policy/effective.mjs';
import { userTagDimensions } from './settings.mjs';
import { listProjects } from './projects.mjs';
import { normaliseDimensions, mergeDimensions } from '../shared/tag-dimensions.mjs';

export const POLICY_FIELD = 'runs.tagDimensions';

/** A resolved policy → its dimensions, or null when it does not apply or does not set the field. */
export function dimensionsFromPolicy(r, { workspaceRun = false } = {}) {
  if (!r?.ok || !r.doc) return null;
  const f = fieldsForRun(r.doc, { workspaceRun })[POLICY_FIELD];
  return f ? normaliseDimensions(f.value).dims : null;
}

/** One run target → { source: 'policy'|'settings'|null, home, dims }. Never throws. */
export async function dimensionsForTarget({ projectDir = null, workspaceId = null } = {}, io = {}) {
  const { resolveProject = resolveProjectPolicy, resolveWorkspace = resolveWorkspacePolicy, user = userTagDimensions } = io;
  let r = null;
  try {
    r = workspaceId ? await resolveWorkspace(workspaceId, { discover: false })
      : projectDir ? await resolveProject(projectDir, { discover: false }) : null;
  } catch { r = null; }
  const fromPolicy = dimensionsFromPolicy(r, { workspaceRun: !!workspaceId });
  if (fromPolicy) return { source: 'policy', home: r.home, dims: fromPolicy };
  let dims = [];
  try { dims = user(); } catch { dims = []; }
  return { source: dims.length ? 'settings' : null, home: null, dims };
}

/** Machine-wide (Statistics, Runs list, Team metrics): every project policy's list, then Settings. */
export async function allTagDimensions(io = {}) {
  const { projects = listProjects, resolveProject = resolveProjectPolicy, user = userTagDimensions } = io;
  const lists = [];
  for (const p of await projects()) {
    if (!p.exists) continue;
    try { const d = dimensionsFromPolicy(await resolveProject(p.path, { discover: false })); if (d) lists.push(d); } catch { /* local settings apply */ }
  }
  let local = [];
  try { local = user(); } catch { local = []; }
  return { dims: mergeDimensions([...lists, local]) };
}
