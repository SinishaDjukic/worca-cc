// src/core/tag-dimensions.mjs — which tag dimensions apply (D7): the run target's team policy
// field runs.tagDimensions, else the user's Settings list, else none. Cache-only policy reads
// (discover:false): a page load never fetches git. Enforcement (runs.enforceTags or Settings ›
// Tags) and the run-start pre-fill (applyTagRules) live here too.
import { resolveProjectPolicy, resolveWorkspacePolicy } from './policy/sync.mjs';
import { fieldsForRun } from './policy/effective.mjs';
import { userTagDimensions, userEnforceTags } from './settings.mjs';
import { listProjects } from './projects.mjs';
import { readProjectDefaultTags } from './config.mjs';
import { lastUsedTags } from './run-tags-store.mjs';
import { projectKey } from './store.mjs';
import { flagEnabled } from './flags.mjs';
import { normaliseDimensions, mergeDimensions, prefillTags, tagsProblemText } from '../shared/tag-dimensions.mjs';

export const POLICY_FIELD = 'runs.tagDimensions';
export const ENFORCE_FIELD = 'runs.enforceTags';

/** A resolved policy → { dims: [...]|null, enforce: bool|null }, or null when it sets neither field. */
export function teamTagFields(r, { workspaceRun = false } = {}) {
  if (!r?.ok || !r.doc) return null;
  const f = fieldsForRun(r.doc, { workspaceRun });
  const dims = f[POLICY_FIELD] ? normaliseDimensions(f[POLICY_FIELD].value).dims : null;
  const enforce = f[ENFORCE_FIELD] ? f[ENFORCE_FIELD].value === true : null;
  return dims || enforce != null ? { dims, enforce } : null;
}

/** Kept for allTagDimensions (unchanged callers): a resolved policy → its dimensions, or null. */
export function dimensionsFromPolicy(r, opts = {}) { return teamTagFields(r, opts)?.dims ?? null; }

/** One run target → { source: 'policy'|'settings'|null, home, dims, enforce } (D6). Never throws. */
export async function dimensionsForTarget({ projectDir = null, workspaceId = null } = {}, io = {}) {
  const { resolveProject = resolveProjectPolicy, resolveWorkspace = resolveWorkspacePolicy, user = userTagDimensions, userEnforce = userEnforceTags } = io;
  let r = null;
  try {
    r = workspaceId ? await resolveWorkspace(workspaceId, { discover: false })
      : projectDir ? await resolveProject(projectDir, { discover: false }) : null;
  } catch { r = null; }
  const team = teamTagFields(r, { workspaceRun: !!workspaceId });
  if (team?.dims) return { source: 'policy', home: r.home, dims: team.dims, enforce: team.enforce === true };
  let dims = [];
  try { dims = user(); } catch { dims = []; }
  let enforce = team?.enforce ?? null;
  if (enforce == null) { try { enforce = userEnforce() === true; } catch { enforce = false; } }
  return { source: dims.length ? 'settings' : null, home: team ? r.home : null, dims, enforce };
}

/** Settings › Tags lock (D8): the first registered project whose team policy sets either field. */
export async function teamTagPolicy(io = {}) {
  const { projects = listProjects, resolveProject = resolveProjectPolicy } = io;
  for (const p of await projects()) {
    if (!p.exists) continue;
    let r = null;
    try { r = await resolveProject(p.path, { discover: false }); } catch { continue; }
    const t = teamTagFields(r);
    if (t) return { home: r.home, dims: t.dims, enforce: t.enforce };
  }
  return null;
}

/** Pre-fill sources for one target (D5): a project's default tags and this person's last tags there. */
export function prefillSources({ projectDir = null, person = null } = {}) {
  const none = { projectDefaults: [], lastUsed: [] };
  if (!projectDir) return none;
  let key;
  try { key = projectKey(projectDir); } catch { return none; }
  let projectDefaults = [];
  try { projectDefaults = readProjectDefaultTags(key); } catch { projectDefaults = []; }
  let lastUsed = [];
  if (person) { try { lastUsed = lastUsedTags(key, person); } catch { lastUsed = []; } }
  return { projectDefaults, lastUsed };
}

/**
 * The run-start gate (D9–D11, D14): with runTags on and enforcement on for this target, pre-fill the tags,
 * then report the problem left, if any. Otherwise the tags pass through untouched (enforced:false).
 */
export async function applyTagRules({ projectDir = null, workspaceId = null, tags = [], person = null } = {}, io = {}) {
  const { flagOn = () => flagEnabled('runTags'), rules = dimensionsForTarget, sources = prefillSources } = io;
  if (!flagOn()) return { tags, error: null, enforced: false };
  const { dims, enforce } = await rules({ projectDir, workspaceId }, io);
  if (!enforce || !dims.length) return { tags, error: null, enforced: false };
  const filled = prefillTags(dims, tags, sources({ projectDir, person }));
  return { tags: filled, error: tagsProblemText(dims, filled), enforced: true };
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
