// A person's project choice on New run (the select, the `#` Tab cycle, the attach picker), as one guarded change. Nothing is
// touched until the Target guard has been answered: Cancel leaves the run target, the select and the features exactly as they
// were. The page owns the DOM and state; everything it must do is injected, so the order is testable without booting it.
import { guardScopeChange } from './scope-guard.mjs';

/**
 * @param {object} deps
 * @param {{get: () => {items: unknown[]}, clear: () => void}} deps.store   the attached features
 * @param {() => string} deps.getRunTarget      'project' | 'workspace' | 'none'
 * @param {(target: string) => void} deps.setRunTarget
 * @param {() => string} deps.getApplied        the project path the page last APPLIED, not what the select shows now
 * @param {(path: string) => void} deps.setSelect  writes the project select's value
 * @param {() => unknown} deps.reapply          loads the chosen project's state; may return a promise
 * @param {() => Promise<'remove'|'cancel'>} deps.ask
 * @returns {(path: string) => Promise<'applied'|'cancelled'>}
 */
export function createProjectChange({ store, getRunTarget, setRunTarget, getApplied, setSelect, reapply, ask }) {
  return async function changeProject(path) {
    const applied = getApplied();
    const changed = getRunTarget() !== 'project' || path !== applied;
    const outcome = await guardScopeChange({
      store,
      ask,
      skip: () => !changed,
      apply: () => {
        if (getRunTarget() !== 'project') setRunTarget('project');
        setSelect(path);
      },
      revert: () => setSelect(applied),
    });
    if (outcome === 'applied') await reapply();
    return outcome;
  };
}
