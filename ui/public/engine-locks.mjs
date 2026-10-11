// Engines this instance will not start at all (GET /api/engines `broker: true`: the credential broker is on, and only
// Claude Code spends through it). Every engine picker greys them out with the reason, instead of refusing at Start.

const locks = new Map();   // engine -> reason
const PICKERS = '#engineSelect, .ask-card-engine, .inherit-field[data-setting="run.engine"] select, .inherit-field[data-setting="askEngine"] select';
const SUFFIX = ' — off while the credential broker is on';

/** Take GET /api/engines' list; a missing list keeps no locks (offer every engine, the server still decides). */
export function setEngineLocks(list) {
  locks.clear();
  for (const e of Array.isArray(list) ? list : []) if (e && e.broker && typeof e.name === 'string') locks.set(e.name, e.reason || '');
}

/** Why `engine` is locked, else null. */
export function engineLock(engine) { return locks.has(engine) ? locks.get(engine) : null; }

/** Disable a picker's locked options (text says why, title gives the server's reason). Returns whether the
 *  selected option is now one of them, so the caller can move off it. */
export function lockEngineOptions(select) {
  if (!select || !select.options) return false;
  for (const o of select.options) {
    const why = engineLock(o.value);
    if (why === null) continue;
    o.disabled = true;
    o.title = why;
    if (!o.textContent.endsWith(SUFFIX)) o.textContent += SUFFIX;
  }
  return engineLock(select.value) !== null;
}

/** Lock every engine picker under `root`. */
export function applyEngineLocks(root = globalThis.document) {
  if (!root || !root.querySelectorAll) return;
  for (const s of root.querySelectorAll(PICKERS)) lockEngineOptions(s);
}
