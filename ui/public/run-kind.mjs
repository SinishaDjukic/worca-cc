// run-kind.mjs — Projects, any way: how a run worked (on a git worktree, on a copy of a plain folder, or with no
// project) and the one kind chip every surface shows. The server records the mode once (`state.workMode`, mirrored
// into `state.branch.workMode`), so a run without it is an older git run. No DOM work at import.

import { NO_PROJECT_KEY, isNoProjectKey } from '../../src/shared/no-project.mjs';
export { NO_PROJECT_KEY };

const MODES = new Set(['git', 'folder', 'none']);

export function workModeOf(x) {
  if (!x || typeof x !== 'object') return 'git';
  if (MODES.has(x.workMode)) return x.workMode;
  if (x.state && typeof x.state === 'object' && MODES.has(x.state.workMode)) return x.state.workMode;
  if (x.branch && typeof x.branch === 'object' && MODES.has(x.branch.workMode)) return x.branch.workMode;
  return 'git';
}

export function isGitRun(x) { return workModeOf(x) === 'git'; }
export function isFolderRun(x) { return workModeOf(x) === 'folder'; }
export function isNoProjectRun(x) { return workModeOf(x) === 'none' || isNoProjectKey(x && x.projectKey); }

export function projectKind(row) {
  const v = row && row.vcs;
  if (v === 'none') return 'folder';
  if (v === 'git') return 'git';
  return '';
}

export const KIND_LABELS = Object.freeze({ git: 'Git', folder: 'Folder', none: 'No project', ws: 'Workspace' });
export const RUN_KIND_CHIP = Object.freeze({ folder: 'folder', none: 'none' });

export function kindChip(doc, kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(KIND_LABELS, kind)) return null;
  const s = doc.createElement('span');
  s.className = `kind-chip kind-${kind}`;
  s.dataset.kind = kind;
  s.textContent = KIND_LABELS[kind];
  return s;
}

// P5: a workspace run's Folder members, in member order — a History row's `members[]` (workMode 'folder'), else a
// state's `projects[]` (the saved detail, or a live run that kept its state frame's projects). [] for a single-project
// run, a legacy workspace row and an all-Git workspace. Pure.
export function folderMembersOf(x) {
  if (!x || typeof x !== 'object') return [];
  if (Array.isArray(x.members) && x.members.length) {
    return x.members.filter((m) => m && typeof m.memberKey === 'string' && m.memberKey && m.workMode === 'folder')
      .map((m) => ({ memberKey: m.memberKey, name: m.name || m.memberKey, projectDir: m.projectDir || '' }));
  }
  if (Array.isArray(x.projects)) {
    return x.projects.filter((p) => p && typeof p.projectKey === 'string' && p.projectKey && p.workMode === 'folder')
      .map((p) => ({ memberKey: p.projectKey, name: p.projectName || p.projectKey, projectDir: p.projectDir || '' }));
  }
  return [];
}
