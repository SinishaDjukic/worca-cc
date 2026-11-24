// src/shared/chat-verbosity.mjs — the Chat reply-style levels (#1230). Pure and browser-safe: the server, the
// settings cascade, the team-policy registry and the UI all read the SAME list, so every layer (chat, project,
// user, team) accepts the same five values. Order runs from most to least verbose and is the display order.
export const VERBOSITY_LEVELS = Object.freeze(['detailed', 'normal', 'concise', 'terse', 'caveman']);
export const DEFAULT_VERBOSITY = 'normal';
export const VERBOSITY_LABELS = Object.freeze({ detailed: 'Detailed', normal: 'Normal', concise: 'Concise', terse: 'Terse', caveman: 'Caveman' });
/** The shared refusal tail: "chat.verbosity must be one of …". */
export const VERBOSITY_HINT = 'must be one of detailed | normal | concise | terse | caveman';

/** Strict membership: no case folding, strings only. */
export function isVerbosity(v) {
  return typeof v === 'string' && VERBOSITY_LEVELS.includes(v);
}
