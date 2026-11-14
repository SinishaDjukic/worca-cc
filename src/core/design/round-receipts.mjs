// src/core/design/round-receipts.mjs
// Design P5 Task 8: a chat's `design-round` receipt follows its build's `design-build` frames, with no AI. A live
// round never flips the card; a pause writes `paused` with the round's facts and a Resume flips it back to `running`;
// a terminal frame writes its facts once (`done` adds the design's version). The card is found by scanning its
// design's thread for the build id and taking the STORED state, so a new server instance picks a paused card up.
// A frame seen before the card exists waits for `posted(buildId)` (a fast build can end before the turn stores it).
// `interrupted` is never a frame: boot reconciles receipts from build rows (`sweepDesignRoundCards`, ask store).

/** Build status → receipt state. Receipt states are these six: running, paused, done, stopped, failed, interrupted. */
export const ROUND_STATE_OF = Object.freeze({
  planning: 'running', building: 'running', integrating: 'running',
  paused: 'paused', done: 'done', stopped: 'stopped', error: 'failed', interrupted: 'interrupted',
});

const TERMINAL = new Set(['done', 'stopped', 'failed', 'interrupted']);
const num = (v) => (Number.isFinite(v) ? v : 0);

/** The receipt's facts from a frame: the HUD's round cost (`stage-model.mjs` `roundCost`: spent plus the live estimate). */
function factsOf(frame) {
  const s = frame.stats && typeof frame.stats === 'object' ? frame.stats : {};
  return { agents: s.agentsTotal, costUsd: num(s.costUsd) + num(s.estimatedUsd), costKnown: s.costKnown === true, elapsedMs: s.elapsedMs, reason: frame.reason ?? null };
}

/**
 * @param {{ threadOfDesign: (designId: string) => string|null, listMessages: (threadId: string) => object[],
 *   flipCard: (threadId: string, cardId: string, patch: object) => unknown, versionOf: (designId: string) => number }} deps
 * @returns {{ onFrame: (frame: object) => void, posted: (buildId: string) => void }}
 */
export function createRoundReceipts({ threadOfDesign, listMessages, flipCard, versionOf }) {
  const cards = new Map();     // buildId → { threadId, cardId, state }: open builds only
  const waiting = new Map();   // buildId → the newest frame seen before its card existed

  function resolve(frame) {
    const threadId = threadOfDesign(frame.designId);
    if (!threadId) return null;
    for (const message of listMessages(threadId)) {
      if (!Array.isArray(message.blocks)) continue;
      for (const b of message.blocks) {
        if (b && b.kind === 'card' && b.card && b.card.type === 'design-round' && b.card.buildId === frame.buildId) {
          return { threadId, cardId: b.id, state: b.state };
        }
      }
    }
    return null;
  }

  function onFrame(frame) {
    if (!frame || frame.type !== 'design-build' || !Object.hasOwn(ROUND_STATE_OF, frame.status)) return;
    const { buildId } = frame;
    let entry = cards.get(buildId);
    if (!entry) {
      entry = resolve(frame);
      if (!entry) { waiting.set(buildId, frame); return; }
      waiting.delete(buildId);   // the card exists: an older frame must not replay over this one
      cards.set(buildId, entry);
    }
    const state = ROUND_STATE_OF[frame.status];
    if (state !== entry.state) {
      const patch = state === 'running' ? { state }
        : { state, card: { ...factsOf(frame), ...(state === 'done' ? { version: versionOf(frame.designId) } : {}) } };
      flipCard(entry.threadId, entry.cardId, patch);
      entry.state = state;
    }
    if (TERMINAL.has(state)) cards.delete(buildId);
  }

  function posted(buildId) {
    const frame = waiting.get(buildId);
    if (!frame) return;
    waiting.delete(buildId);
    onFrame(frame);
  }

  return { onFrame, posted };
}
