// src/core/exec-env/index.mjs
// The execution-environment layer (plans/e2b-execution-design.md). `local` — today's behaviour — is
// the ABSENCE of an exec-env object: every call site branches on `execEnv?.remote`, so local argv,
// env and state stay byte-identical. Every other name is a backend in ./registry.mjs (e2b today).
import { execEnvNames } from './registry.mjs';
export { execEnvNames, getExecBackend, listExecBackends, describeExecEnvs, defaultBuildBackend } from './registry.mjs';
export { isSandboxGone, isSandboxUnreachable } from './backends/e2b.mjs';

export const DEFAULT_EXEC_ENV = 'local';
/** The names known at load ('local' + the built-in backends). A test backend registered later is
 *  accepted by isExecEnvName/selectExecEnv, which read the registry each time. */
export const EXEC_ENVS = Object.freeze(execEnvNames());
export const isExecEnvName = (v) => typeof v === 'string' && execEnvNames().includes(v);

/** Blank means local; an unknown name is a hard error at run start (like getEngine). */
export function selectExecEnv(name) {
  const key = typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_EXEC_ENV;
  if (!isExecEnvName(key)) throw new Error(`unknown execution environment "${key}" (known: ${execEnvNames().join(', ')})`);
  return key;
}

export const EXEC_ENV_CODES = Object.freeze({ lost: 'EXEC_ENV_LOST', patchRejected: 'EXEC_ENV_PATCH_REJECTED', mergeCommit: 'EXEC_ENV_MERGE_COMMIT',
  hookChange: 'EXEC_ENV_HOOK_CHANGE', configChange: 'EXEC_ENV_CONFIG_CHANGE', injectedChange: 'EXEC_ENV_INJECTED_CHANGE', syncBudget: 'EXEC_ENV_SYNC_BUDGET' });

export const LOST_HINT = 'Changes up to the last finished step are in the local worktree and are committed to the run branch. Start a new run to continue.';

/** The run's sandbox is gone (killed, expired, the provider restarted). Always terminal: the
 *  run fails cleanly, keeping whatever was already synced back (clarify: sandbox-loss). */
export class ExecEnvLostError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ExecEnvLostError';
    this.code = EXEC_ENV_CODES.lost;
    this.execEnvFatal = true;
  }
}

/** The sandbox's changes cannot be brought to the local worktree: the patch did not apply
 *  (EXEC_ENV_PATCH_REJECTED, kept at `patchFile`), or the agent committed a merge, which a content
 *  patch cannot carry (EXEC_ENV_MERGE_COMMIT). Terminal: a retry cannot change either. */
export class ExecEnvSyncError extends Error {
  constructor(message, { patchFile = null, cause, code = EXEC_ENV_CODES.patchRejected } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ExecEnvSyncError';
    this.code = code;
    this.patchFile = patchFile;
    this.execEnvFatal = true;
  }
}

/** A failure no retry, recovery prompt or pause can fix (the orchestrator skips its policy). */
export const isExecEnvFatal = (err) => !!err && err.execEnvFatal === true;
