// src/core/prompt-check/corrections.mjs — a person's correction of the prompt check's kind (docs/prompt-check.md, "The
// chip"). One row per pick in prompt_kind_corrections: the surface, its ids and the two kinds, stamped by the server.
// Never prompt text. The route validates first, so a TypeError here means a caller bug.
import { getDb } from '../db.mjs';
import { PROMPT_KINDS } from '../../shared/prompt-check/assessment.mjs';

export const CORRECTION_SURFACES = Object.freeze(['chat', 'shaper', 'run-card', 'new-run']);
export const CORRECTION_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

const idOf = (v, name) => {
  if (v == null) return null;
  if (typeof v !== 'string' || !CORRECTION_ID_RE.test(v)) throw new TypeError(`${name} is invalid`);
  return v;
};

const rowOut = (r) => ({
  id: r.id, surface: r.surface, threadId: r.thread_id, cardId: r.card_id, runId: r.run_id,
  proposedKind: r.proposed_kind, chosenKind: r.chosen_kind, at: r.at,
});

/** Store one correction → the stored row as an object. Only the named fields are read; any other key is ignored. */
export function recordKindCorrection(input, { now = new Date() } = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('a correction is required');
  const { surface, proposedKind, chosenKind } = input;
  if (!CORRECTION_SURFACES.includes(surface)) throw new TypeError('surface is invalid');
  if (!PROMPT_KINDS.includes(proposedKind)) throw new TypeError('proposedKind is invalid');
  if (!PROMPT_KINDS.includes(chosenKind)) throw new TypeError('chosenKind is invalid');
  const threadId = idOf(input.threadId, 'threadId');
  const cardId = idOf(input.cardId, 'cardId');
  const runId = idOf(input.runId, 'runId');
  const at = now.toISOString();
  const r = getDb().prepare(`INSERT INTO prompt_kind_corrections (surface, thread_id, card_id, run_id, proposed_kind, chosen_kind, at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(surface, threadId, cardId, runId, proposedKind, chosenKind, at);
  return { id: Number(r.lastInsertRowid), surface, threadId, cardId, runId, proposedKind, chosenKind, at };
}

/** The corrections of a thread or a run, newest first. */
export function listKindCorrections({ threadId = null, runId = null } = {}) {
  const where = threadId != null ? 'thread_id = ?' : 'run_id = ?';
  return getDb().prepare(`SELECT * FROM prompt_kind_corrections WHERE ${where} ORDER BY at DESC, id DESC`)
    .all(threadId != null ? threadId : runId).map(rowOut);
}
