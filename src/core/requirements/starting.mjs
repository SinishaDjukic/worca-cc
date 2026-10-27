// src/core/requirements/starting.mjs
// Features with a start in flight: between the run handler's call and the stored start row (A2 D6). A leaf module that
// imports nothing, so start.mjs (which marks a start), edits.mjs and interview.mjs (which wait for one) share it without
// an import cycle.

const starting = new Set();

/** What an action that waits for a start in flight answers (BUSY). */
export const STARTING_MESSAGE = 'this feature is starting a run. Try again in a moment.';
export const markStarting = (seq) => { starting.add(Number(seq)); };
export const unmarkStarting = (seq) => { starting.delete(Number(seq)); };
export const isStarting = (seq) => starting.has(Number(seq));
