// Stillhet (flag `stillhet`): the ask switch and the asked-once answer.

/** The internal ask switch. While false, nothing asks about Stillhet. The last slice of feature 3 sets it to true, once every area runs on live data. */
export const STILLHET_ASK_ON = false;

/** True when the Stillhet question may show, and the top-bar switch while Stillhet is off. Settings › Labs shows the `stillhet`
 *  row whatever this says, and the switch shows while Stillhet is on (docs/stillhet/navigation.md `nav.design-switch`). */
export function stillhetAskOpen(env = process.env) {
  return STILLHET_ASK_ON || env.WORCA_STILLHET_ASK === '1';
}

/**
 * The flags service `afterSet` hook: a write that turns `stillhet` on also records that the install
 * has answered. Turning it off, or any other write, stores nothing else.
 */
export function stillhetAnswerHook(setPrefs) {
  return async (patch) => {
    if (patch && patch.stillhet === true) await setPrefs({ stillhetAsked: true });
  };
}

/** The key the flag was stored under before it was renamed. Read, never written. */
export const STILLHET_OLD_FLAG = 'rail';

/** A stored flag map with the old key read as `stillhet` (the new key wins when both are there). The old key is dropped,
 *  so the next write stores only the new one. Pure: returns a new map. */
export function readOldStillhetFlag(stored) {
  if (!stored || typeof stored[STILLHET_OLD_FLAG] !== 'boolean') return stored;
  const { [STILLHET_OLD_FLAG]: old, ...rest } = stored;
  return typeof rest.stillhet === 'boolean' ? rest : { ...rest, stillhet: old };
}

/** WORCA_FLAGS with the old key read as `stillhet` (`rail`, `-rail`), so a lock set before the rename still holds. */
export function readOldStillhetEnv(str) {
  return String(str || '').split(',').map((t) => t.replace(/^(\s*-?)rail(\s*)$/, '$1stillhet$2')).join(',');
}
