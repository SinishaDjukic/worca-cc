// src/core/engines/events.mjs
// The normalized event vocabulary every engine adapter emits and every consumer
// reads. Engine-neutral: no wire format here.
export const EVENT_TYPES = Object.freeze(new Set([
  'session', 'text', 'usage', 'tool', 'toolResult', 'subagent', 'result', 'retry', 'hook', 'stderr', 'log', 'compact',
  // Spend outside a `result` (the usage ledger, plans/core-protection-layer-design.md §4.3): what worca's relay measured
  // that no result covered ({ source: 'relay', messages, byModel }, at a route's close), or a figure the engine itself
  // reported on a way out with no result ({ source: 'engine', costUsd?, usage? }).
  'spend',
]));

/** Already normalized? `hook` is the one type that carries `raw`; for every other
 *  type a `raw` key means a legacy runner envelope that still needs normalizing. */
export function isNormalized(e) {
  return !!e && typeof e === 'object' && EVENT_TYPES.has(e.type) && (e.type === 'hook' || !('raw' in e));
}
