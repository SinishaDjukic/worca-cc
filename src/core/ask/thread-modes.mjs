// Thread modes that belong to a surface of their own: a composer chat (the Workflows editor) and a design chat (a
// design's titled thread). Such a thread is in no Chat list, page, count or search, and is closed to the browser
// extension. A thread with no mode (null) is a plain chat. No imports: the store, the routes and the server read it.

/** The modes a thread can carry. Constants only: the store builds its "not in" list from them. */
export const SURFACE_MODES = Object.freeze(['composer', 'design']);

/** True for a mode that keeps its thread out of the Chat lists and away from the extension. */
export function isSurfaceMode(mode) {
  return typeof mode === 'string' && SURFACE_MODES.includes(mode);
}

/** The helper calls a turn may make after it ends: the first-turn title and the follow-up suggestions. A design chat
 *  makes neither (no hidden AI); an event turn (synthetic) makes neither; a title only replaces an automatic one. */
export function turnHelperFlags({ mode = null, synthetic = false, userSeq = 0, titleWasAuto = false } = {}) {
  return {
    firstTurn: !synthetic && userSeq === 1 && !!titleWasAuto && mode !== 'design',
    suggest: !synthetic && mode !== 'design',
  };
}
