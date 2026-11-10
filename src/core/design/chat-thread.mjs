// src/core/design/chat-thread.mjs
// A design's own chat (P5): one ask thread of mode 'design' per design, titled from the design so no title call
// ever fires (L30), with its scope taken from the design row (L5.4). Also the chat's share of a design's total
// (builds plus chat), the design's scope for a turn, and the models a build of this design would spawn.

import { getDb } from '../db.mjs';
import { createThread, getThread, updateThread } from '../ask/store.mjs';
import { resolveDesignModel } from './spawn-options.mjs';
import { getDesign } from './store.mjs';

/**
 * Makes the design's thread: titled with the design's title (P1 gives an untitled design `Untitled design`), and
 * scoped to the design's project or to No project, so the first message finds the scope already right.
 * @param {{ design: { title: string, projectKey?: string|null }, by?: string|null }} opts
 * @returns {object} the thread as the store reads it
 */
export function createDesignThread({ design, by = null }) {
  const thread = createThread({ title: String(design.title).slice(0, 120), createdBy: by, mode: 'design' });
  const context = design.projectKey ? { pinned: true, projectKey: design.projectKey } : { pinned: false };
  return updateThread(thread.id, { context });
}

/** The design that owns `threadId`, else null. */
export function designIdForThread(threadId) {
  if (typeof threadId !== 'string' || !threadId) return null;
  return getDb().prepare('SELECT id FROM designs WHERE thread_id = ?').get(threadId)?.id ?? null;
}

/** What the design's chat has spent so far: 0 for no thread or a thread that is gone. */
export function chatSpendUsd(threadId) {
  return threadId ? getThread(threadId)?.totals.costUsd ?? 0 : 0;
}

/** The chat's scope, from the design row: its project, else null (No project). */
export function designScope(designId) {
  const k = getDesign(designId)?.projectKey;
  return k ? { projectKey: k } : null;
}

/** The distinct models a build of `design` spawns (lead and builder on the design's engine, its own picks first), as
 *  P2's continue check builds them. */
export function designBuildModels(design) {
  const engine = design?.engine ?? 'claude';
  return [...new Set(['lead', 'builder'].map((r) => resolveDesignModel(r, { engine, design }).model).filter(Boolean))];
}
