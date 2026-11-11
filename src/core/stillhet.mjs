// Stillhet (flag `rail`): the ask switch and the asked-once answer.

/** The internal ask switch. While false, nothing asks about Stillhet. Slice 4 sets it to true. */
export const STILLHET_ASK_ON = false;

/** True when the Stillhet question, the top-bar switch and the Labs row may show. */
export function stillhetAskOpen(env = process.env) {
  return STILLHET_ASK_ON || env.WORCA_STILLHET_ASK === '1';
}

/**
 * The flags service `afterSet` hook: a write that turns `rail` on also records that the install
 * has answered. Turning it off, or any other write, stores nothing else.
 */
export function railAnswerHook(setPrefs) {
  return async (patch) => {
    if (patch && patch.rail === true) await setPrefs({ stillhetAsked: true });
  };
}
