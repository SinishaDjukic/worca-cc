// src/shared/plugin-access.mjs — which changes in a plugin update ask a person for NEW access (Marketplace redesign,
// CONTRACT §1.5). One table for the update preview (`access`), the Installed rows' `latest` hint and the update review
// sheet. Pure ESM for node and the browser (served from /src/shared/): no imports, no IO. Removals are never access.

/** The order every list is returned in: the red kinds (secrets, model env) first. */
export const ACCESS_KINDS = ['secret', 'channelSecret', 'modelSecret', 'modelEnv', 'setup', 'taskSource', 'chatChannel', 'agent', 'model', 'mcp', 'skill'];
const RED = new Set(['secret', 'channelSecret', 'modelSecret', 'modelEnv']);

const list = (v) => (Array.isArray(v) ? v : []);
const change = (kind, id) => ({ kind, id, red: RED.has(kind) });

/** AccessChange[] for an update preview's manifestDelta (plugin-repo.mjs assembleManifestDelta). */
export function accessChanges(manifestDelta) {
  const d = manifestDelta && typeof manifestDelta === 'object' ? manifestDelta : {};
  return [
    ...list(d.newSecrets).map((k) => change('secret', k)),
    ...list(d.newChannelSecrets).map((k) => change('channelSecret', k)),
    ...list(d.newModelSecrets).map((k) => change('modelSecret', k)),
    ...list(d.envChangedModels).map((m) => change('modelEnv', m)),
    ...(d.setupChanged === true ? [change('setup', null)] : []),
    ...list(d.newTaskSources).map((s) => change('taskSource', s)),
    ...list(d.newChatChannels).map((s) => change('chatChannel', s)),
    ...list(d.newAgents).map((a) => change('agent', a)),
    ...list(d.newModels).map((m) => change('model', m)),
    ...[...list(d.newMcpServers), ...list(d.changedMcpServers)].map((s) => change('mcp', s)),
    ...[...list(d.newSkills), ...list(d.changedSkills)].map((s) => change('skill', s)),
  ];
}

/** Secret keys `'<id>.<key>'` of a task-source / chat-channel inventory list. */
const secretKeys = (rows) => list(rows).flatMap((r) => list(r?.secrets).map((k) => `${r.id}.${k}`));
const ids = (rows, key = 'id') => list(rows).map((r) => r?.[key]);
const modelKey = (m) => String(m?.id).toLowerCase();
const modelEnv = (m) => JSON.stringify([[...list(m?.envKeys)].sort(), m?.baseUrl ?? null]);

/** AccessChange[] a snapshot inventory (`to`, marketplaces.json) adds over the installed one (`from`), both in
 *  buildInstallInventory's shape. A key `to` lacks (a snapshot synced by an older worca) adds nothing. */
export function inventoryAccessChanges(fromInventory, toInventory) {
  const from = fromInventory && typeof fromInventory === 'object' ? fromInventory : {};
  const to = toInventory && typeof toInventory === 'object' ? toInventory : {};
  const out = [];
  const added = (kind, before, after) => {
    const had = new Set(before);
    for (const id of after) if (!had.has(id)) out.push(change(kind, id));
  };
  added('secret', secretKeys(from.taskSources), secretKeys(to.taskSources));
  added('channelSecret', secretKeys(from.chatChannels), secretKeys(to.chatChannels));
  added('modelSecret', ids(from.modelSecrets, 'key'), ids(to.modelSecrets, 'key'));
  const installedModels = new Map(list(from.models).map((m) => [modelKey(m), m]));
  for (const m of list(to.models)) {
    const had = installedModels.get(modelKey(m));
    if (had && modelEnv(had) !== modelEnv(m)) out.push(change('modelEnv', m.id));
  }
  if (Array.isArray(to.setupCommands) && JSON.stringify(list(from.setupCommands)) !== JSON.stringify(to.setupCommands)) {
    out.push(change('setup', null));
  }
  added('taskSource', ids(from.taskSources), ids(to.taskSources));
  added('chatChannel', ids(from.chatChannels), ids(to.chatChannels));
  added('agent', ids(from.agents, 'key'), ids(to.agents, 'key'));
  for (const m of list(to.models)) if (!installedModels.has(modelKey(m))) out.push(change('model', m.id));
  const installedMcp = new Map(list(from.mcpServers).map((s) => [s?.name, JSON.stringify(s)]));
  for (const s of list(to.mcpServers)) if (installedMcp.get(s?.name) !== JSON.stringify(s)) out.push(change('mcp', s?.name));
  added('skill', list(from.skills), list(to.skills));
  return ACCESS_KINDS.flatMap((k) => out.filter((r) => r.kind === k));
}

export function needsReview(changes) {
  return Array.isArray(changes) && changes.length > 0;
}

// git-free/github.mjs githubRepoOf's URL forms (no shorthand), copied: this module may not import from src/core.
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const URL_RES = [
  /^https?:\/\/(?:[^@/:\s]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^ssh:\/\/git@(?:ssh\.)?github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^git:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
];
const SHA_RE = /^[0-9a-f]{7,64}$/i;

/** `https://github.com/<o>/<r>/tree/<sha>[/<subdir>]` for a GitHub repository URL at a commit sha, else null. */
export function githubWebUrl(repoUrl, sha, subdir = '') {
  if (!SHA_RE.test(String(sha ?? ''))) return null;
  const s = String(repoUrl ?? '').trim();
  for (const re of URL_RES) {
    const m = re.exec(s);
    if (!m) continue;
    const [, owner, repo] = m;
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null;
    const path = String(subdir || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `https://github.com/${owner}/${repo}/tree/${sha}${path ? `/${path}` : ''}`;
  }
  return null;
}
