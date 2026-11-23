// Thread modes that belong to a surface of their own: a composer chat (the Workflows editor). Such a thread is closed to
// the browser extension and is in no Chat list, page, count or search. A thread with no mode (null) is a plain chat; a
// chat with a design is a plain chat too (docs/design.md "In the chat": its design points at it, designs.thread_id).
// No imports: the store, the routes and the server read it.

/** The modes a thread can carry. Constants only: the store builds its "not in" list from them. */
export const SURFACE_MODES = Object.freeze(['composer']);

/** True for a mode that keeps its thread away from the extension and out of the Chat lists. */
export function isSurfaceMode(mode) {
  return typeof mode === 'string' && SURFACE_MODES.includes(mode);
}

/** The helper calls a turn may make after it ends: the first-turn title and the follow-up suggestions. An event turn
 *  (synthetic) makes neither; a title only replaces an automatic one. */
export function turnHelperFlags({ synthetic = false, userSeq = 0, titleWasAuto = false } = {}) {
  return {
    firstTurn: !synthetic && userSeq === 1 && !!titleWasAuto,
    suggest: !synthetic,
  };
}
