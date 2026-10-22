// src/shared/exec-env.mjs
// Which runs a SAVED remote default (E2B or any registered backend) applies to (plans/e2b-execution-design.md §12).
// One rule for the server's run-start cascade (settings-cascade.mjs resolveRunExecEnv, through exec-env/policy.mjs)
// and the New run dialog (ui/public/app.js), so the dialog shows the environment the run really gets.

/** Why a saved remote default does not apply to a run (a workspace run, an engine other than Claude, a Folder
 *  project or a run without a project: the generic remote layer moves one git worktree in and runs claude only), or
 *  null when it does. An explicit per-run pick is not judged here: the start refuses it. A backend's own extra
 *  reasons are its `refusesDefault` (server side). `workMode` is the run's: 'git' (default), 'folder' or 'none'. */
export function remoteRefusesDefault({ engine = null, workspace = false, workMode = 'git' } = {}) {
  if (workspace) return 'a workspace run';
  if (workMode === 'folder') return 'a Folder project';
  if (workMode === 'none') return 'a run without a project';
  if (engine && engine !== 'claude') return `the ${engine} engine`;
  return null;
}
