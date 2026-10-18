// run-kind.mjs — Projects, any way: how a run worked (on a git worktree, on a copy of a plain folder, or with no
// project) and the one kind chip every surface shows. The server records the mode once (`state.workMode`, mirrored
// into `state.branch.workMode`), so a run without it is an older git run. No DOM work at import.

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

export function projectKind(row) {
  const v = row && row.vcs;
  if (v === 'none') return 'folder';
  if (v === 'git') return 'git';
  return '';
}

export const KIND_LABELS = Object.freeze({ git: 'Git', folder: 'Folder', none: 'No project', ws: 'Workspace' });
export const RUN_KIND_CHIP = Object.freeze({ folder: 'folder' });

export function kindChip(doc, kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(KIND_LABELS, kind)) return null;
  const s = doc.createElement('span');
  s.className = `kind-chip kind-${kind}`;
  s.dataset.kind = kind;
  s.textContent = KIND_LABELS[kind];
  return s;
}
