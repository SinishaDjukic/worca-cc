// ui/public/ws-seq.mjs
// A reconnect re-subscribes to a live run and the server replays that run's buffered events
// (ui/server.mjs replayEntry). Each buffered event carries a per-run `seq`; one this page has
// already applied is skipped, so a socket that drops (a proxy's idle timeout) never shows a
// log line twice. Frames without a seq (state snapshots, other channels) always apply.
// Pure: no DOM.

/** Whether `msg` was already applied to run `r`; records it when it was not. */
export function alreadyApplied(r, msg) {
  const seq = msg && typeof msg.seq === 'number' ? msg.seq : null;
  if (seq === null || !r) return false;
  if (seq <= (r.lastSeq || 0)) return true;
  r.lastSeq = seq;
  return false;
}

/** A restarted server numbers from 1 again: forget what was applied when its boot id changes. */
export function noteBoot(state, bootId, runsMap) {
  if (!bootId) return;
  if (state.serverBootId && state.serverBootId !== bootId) {
    for (const r of runsMap.values()) r.lastSeq = 0;
  }
  state.serverBootId = bootId;
}
