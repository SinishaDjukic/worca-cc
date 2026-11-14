// src/core/prompt-check/perspective-choices.mjs — the run card's proposed perspectives and what the person changed
// (flag proposedPerspectives, docs/prompt-check.md "Perspectives"). One row per started run that had a proposal, written
// by the start route once the run id exists. Ids, kind, surface, run id and time only: never prompt text. The route
// validates first, so a TypeError here means a caller bug.
import { getDb } from '../db.mjs';
import { PROMPT_KINDS } from '../../shared/prompt-check/assessment.mjs';
import { normalizePerspectives, perspectivesWith } from '../../shared/shape/perspectives.mjs';
import { CORRECTION_ID_RE } from './corrections.mjs';

export const CHOICE_SURFACES = Object.freeze(['run-card']);

const ORDER = perspectivesWith({ compliance: true }).map((p) => p.key);
/** The keys as given (deduplicated, in perspective order); unlike normalizePerspectives it never adds Product. */
const keysOf = (v, name) => {
  if (!Array.isArray(v) || !normalizePerspectives(v, { compliance: true }).ok) throw new TypeError(`${name} is invalid`);
  return ORDER.filter((k) => v.includes(k));
};
const minus = (a, b) => a.filter((k) => !b.includes(k));
const parse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };

const rowOut = (r) => ({
  id: r.id, runId: r.run_id, surface: r.surface, kind: r.kind, proposed: parse(r.proposed), chosen: parse(r.chosen),
  dropped: parse(r.dropped), added: parse(r.added), at: r.at,
});

/** Store one choice → the stored row as an object. Only the named fields are read; any other key is ignored. */
export function recordPerspectiveChoice(input, { now = new Date() } = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('a choice is required');
  const { runId, surface } = input;
  if (typeof runId !== 'string' || !CORRECTION_ID_RE.test(runId)) throw new TypeError('runId is invalid');
  if (!CHOICE_SURFACES.includes(surface)) throw new TypeError('surface is invalid');
  const kind = input.kind == null ? null : input.kind;
  if (kind !== null && !PROMPT_KINDS.includes(kind)) throw new TypeError('kind is invalid');
  const proposed = keysOf(input.proposed, 'proposed');
  const chosen = keysOf(input.chosen, 'chosen');
  const dropped = minus(proposed, chosen);
  const added = minus(chosen, proposed);
  const at = now.toISOString();
  const r = getDb().prepare(`INSERT INTO perspective_choices (run_id, surface, kind, proposed, chosen, dropped, added, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, surface, kind, JSON.stringify(proposed), JSON.stringify(chosen),
    JSON.stringify(dropped), JSON.stringify(added), at);
  return { id: Number(r.lastInsertRowid), runId, surface, kind, proposed, chosen, dropped, added, at };
}

/** The stored choices (of one run, given its id), newest first. */
export function listPerspectiveChoices({ runId = null } = {}) {
  const rows = runId != null
    ? getDb().prepare('SELECT * FROM perspective_choices WHERE run_id = ? ORDER BY at DESC, id DESC').all(runId)
    : getDb().prepare('SELECT * FROM perspective_choices ORDER BY at DESC, id DESC').all();
  return rows.map(rowOut);
}

export const PROPOSAL_ERROR = 'perspectiveProposal must be { proposed: perspective keys, kind }';
const PROPOSED_MAX = 6;

/** POST /api/run `perspectiveProposal` (flag on): `{ proposed, kind }` with only those keys, or null for any other shape. */
export function perspectiveProposalOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { proposed, kind } = raw;
  if (!Array.isArray(proposed) || proposed.length < 1 || proposed.length > PROPOSED_MAX) return null;
  if (!normalizePerspectives(proposed, { compliance: true }).ok) return null;
  if (kind !== null && kind !== undefined && !PROMPT_KINDS.includes(kind)) return null;
  return { proposed: ORDER.filter((k) => proposed.includes(k)), kind: kind ?? null };
}
