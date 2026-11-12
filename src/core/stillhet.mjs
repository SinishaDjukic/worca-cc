// Stillhet (flag `rail`): the ask switch and the asked-once answer.

/** The internal ask switch. While false, nothing asks about Stillhet. The last slice of feature 3 sets it to true, once every area runs on live data. */
export const STILLHET_ASK_ON = false;

/** True when the Stillhet question may show, and the top-bar switch while Stillhet is off. Settings › Labs shows the `rail`
 *  row whatever this says, and the switch shows while Stillhet is on (plans/rail/implementation-prompt.md, Opt-in and opt-out). */
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
