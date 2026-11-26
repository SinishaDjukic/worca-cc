// src/core/chat-source-branch-gate.mjs — "Chat runs: source branch": the ONE gate that decides which git targets of a
// chat run card have no branch while their mode is not 'current'. The proposal check (`require`), the POST /api/run
// guard and GET /api/run-defaults (through cardBranchGate) all read it, so card, proposal and server cannot disagree.
import { basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { chatSourceBranchMode } from './settings-cascade.mjs';
import { workModeForStart } from './project-kind.mjs';
import { gitAvailable } from './git-available.mjs';
import { isGitRepo as realIsGitRepo, readWorkspace, WORKSPACE_KEY_RE } from './workspaces.mjs';
import { normalizeProjectPath, getProjectByPath } from './projects.mjs';
import { projectKey } from './store.mjs';
import { DEFAULT_CHAT_SOURCE_BRANCH, SOURCE_BRANCH_TEXT } from '../shared/chat-source-branch.mjs';

const ASK = Object.freeze({ mode: DEFAULT_CHAT_SOURCE_BRANCH, source: 'default' });
const named = (value) => typeof value === 'string' && value.trim() !== '';

function withDefaults(deps = {}) {
  const gitOn = deps.gitOn || gitAvailable;
  return {
    gitOn,
    // An unregistered target (no row) reads the cascade with no project: the user value.
    modeOf: deps.modeOf || ((key) => chatSourceBranchMode(key ? { projectKey: key } : null)),
    // The Start rule: a registered Folder project, or any target while git is missing, runs as Folder.
    workModeOf: deps.workModeOf || ((t) => workModeForStart({ projectDir: t.path }, { getProjectByPath: () => t.row || null, gitAvailable: gitOn })),
    isGitRepo: deps.isGitRepo || realIsGitRepo,
  };
}
const safeMode = (d, key) => { try { return d.modeOf(key) || ASK; } catch { return ASK; } };
function isGitTarget(d, t) {
  try { return !!d.gitOn() && d.workModeOf(t) === 'git' && !!d.isGitRepo(t.path); } catch { return false; }
}

/**
 * The git targets with no card-wide branch, no own branch and a mode other than 'current'.
 * @param {Array<{key: string, name: string, path: string, row: object|null}>} targets
 * @param {{sourceBranch?: string, sourceBranchByKey?: Record<string, string>}} branches
 * @returns {Array<{key: string, name: string, mode: string, source: string}>} never throws
 */
export function branchNeeds(targets, branches, deps = {}) {
  const { sourceBranch, sourceBranchByKey } = branches && typeof branches === 'object' ? branches : {};
  if (!Array.isArray(targets) || named(sourceBranch)) return [];
  const d = withDefaults(deps);
  const byKey = sourceBranchByKey && typeof sourceBranchByKey === 'object' ? sourceBranchByKey : {};
  const out = [];
  for (const t of targets) {
    if (!t || named(byKey[t.key])) continue;
    const { mode, source } = safeMode(d, t.row ? t.key : null);
    if (mode === 'current' || !isGitTarget(d, t)) continue;
    out.push({ key: t.key, name: t.name, mode, source });
  }
  return out;
}

/** GET /api/run-defaults' `chatSourceBranch`: the first target's mode (a project) or the user layer's (a workspace). */
export function cardBranchGate(targets, deps = {}) {
  const d = withDefaults(deps);
  const list = Array.isArray(targets) ? targets : [];
  const first = list[0];
  const { mode, source } = safeMode(d, first && !first.member && first.row ? first.key : null);
  return { mode, source, needs: branchNeeds(list, {}, deps) };
}

/** POST /api/run's 400 body for branchNeeds entries: the card's hint sentence, the code and the members' keys. */
export function sourceBranchRefusal(needs, { workspace = false } = {}) {
  return { error: workspace ? SOURCE_BRANCH_TEXT.members(needs.map((n) => n.name)) : SOURCE_BRANCH_TEXT.pick,
    code: 'source-branch-required', members: needs.map((n) => n.key) };
}

const isDir = (p) => { try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; } };
const target = (path, key, extra = {}) => {
  const row = getProjectByPath(path);
  return { key: key || row?.key || projectKey(path), name: row?.name || basename(path), path, row, ...extra };
};

/** The targets of a /api/run or run-defaults body. [] for noProject, an unknown workspace or an unresolvable dir. */
export async function targetsForBody(body) {
  try {
    if (!body || typeof body !== 'object' || body.noProject === true) return [];
    if (typeof body.workspaceId === 'string' && body.workspaceId.trim()) {
      const id = body.workspaceId.trim();
      const ws = WORKSPACE_KEY_RE.test(id) ? await readWorkspace(id) : null;
      if (!ws || !Array.isArray(ws.projectPaths)) return [];
      const keys = Array.isArray(ws.projectKeys) ? ws.projectKeys : [];
      return ws.projectPaths.map((p, i) => target(p, keys[i], { member: true }));
    }
    const dir = normalizeProjectPath(body.projectDir);
    return dir && isDir(dir) ? [target(dir)] : [];
  } catch { return []; }
}
