// src/core/shape/nudge.mjs — when the run card offers Shape it first (spec D8, §9 item 3), from the Ask model's
// `assess` on propose_run (S2). Advisory: a malformed assess is no nudge, never an error. `assess` is read through the
// shared prompt-check assessment (src/shared/prompt-check/assessment.mjs), so its size may be very-large (nudged as large).
import { normalizePerspectives, DEFAULT_PERSPECTIVES } from '../../shared/shape/perspectives.mjs';
import { normalizeAssessment } from '../../shared/prompt-check/assessment.mjs';

export const NUDGE_MIN_OPEN_DECISIONS = 2;
export const OPEN_DECISIONS_MAX = 6;

/** @returns {null|{reason:'large'|'thin'|'both', size:string|null, openDecisions:string[], perspectives:string[]}} */
export function nudgeFor(assess) {
  if (!assess || typeof assess !== 'object' || Array.isArray(assess)) return null;
  const a = normalizeAssessment(assess);
  const size = a.size === 'very-large' ? 'large' : a.size;
  const openDecisions = a.openDecisions;
  const large = size === 'large';
  const thin = openDecisions.length >= NUDGE_MIN_OPEN_DECISIONS;
  if (!large && !thin) return null;
  // Every listed perspective must be known (an unknown one falls back to the defaults, as before).
  const listed = Array.isArray(assess.perspectives) ? assess.perspectives : null;
  const known = new Set(a.perspectives.map((x) => x.id));
  const p = listed && listed.every((x) => known.has(typeof x === 'string' ? x : x?.id))
    ? normalizePerspectives(a.perspectives.map((x) => x.id))
    : { ok: false };
  return { reason: large && thin ? 'both' : large ? 'large' : 'thin', size, openDecisions,
    perspectives: p.ok ? p.perspectives : [...DEFAULT_PERSPECTIVES] };
}
