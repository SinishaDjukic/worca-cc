// src/shared/exec-env.mjs
// Which runs a SAVED remote default (E2B or any registered backend) applies to (plans/e2b-execution-design.md §12).
// One rule for the server's run-start cascade (settings-cascade.mjs resolveRunExecEnv, through exec-env/policy.mjs)
// and the New run dialog (ui/public/app.js), so the dialog shows the environment the run really gets.
import { ENGINES, ENGINE_NAMES, engineLabel } from './engine-switch.mjs';

/** The engines a remote sandbox runs: the engine catalog's `sandbox` flag (src/shared/engine-switch.mjs). An engine
 *  without it runs locally only for now. */
export const REMOTE_ENGINES = Object.freeze(ENGINE_NAMES.filter((e) => ENGINES[e].sandbox));

/** "claude", or "claude, codex and cursor", for messages. */
export const remoteEnginesText = () => (REMOTE_ENGINES.length > 1 ? `${REMOTE_ENGINES.slice(0, -1).join(', ')} and ${REMOTE_ENGINES.at(-1)}` : REMOTE_ENGINES[0]);

/** The run-start refusal of a remote run on `engine`, or null when a sandbox runs it. `title` names the backend ('E2B'). */
export function remoteEngineRefusal(title, engine) {
  const e = engine || 'claude';
  if (REMOTE_ENGINES.includes(e)) return null;
  return `${title} execution runs the ${remoteEnginesText()} engine${REMOTE_ENGINES.length > 1 ? 's' : ''} only (this run uses ${e}): ${engineLabel(e)} runs locally only for now. Pick Local, or switch the engine.`;
}

/** Why a saved remote default does not apply to a run (a workspace run, a Folder project, a run without a project, or
 *  an engine no sandbox runs (REMOTE_ENGINES): the generic remote layer moves one git worktree in), or
 *  null when it does. An explicit per-run pick is not judged here: the start refuses it. A backend's own extra
 *  reasons are its `refusesDefault` (server side). `workMode` is the run's: 'git' (default), 'folder' or 'none'. */
export function remoteRefusesDefault({ engine = null, workspace = false, workMode = 'git' } = {}) {
  if (workspace) return 'a workspace run';
  if (workMode === 'folder') return 'a Folder project';
  if (workMode === 'none') return 'a run without a project';
  if (engine && !REMOTE_ENGINES.includes(engine)) return `the ${engine} engine`;
  return null;
}
