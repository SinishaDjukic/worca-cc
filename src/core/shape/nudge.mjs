// src/core/shape/nudge.mjs — when the run card offers Shape it first (spec D8, §9 item 3), from the Ask model's
// `assess` on propose_run (S2). Advisory: a malformed assess is no nudge, never an error.
import { normalizePerspectives, DEFAULT_PERSPECTIVES } from '../../shared/shape/perspectives.mjs';

export const NUDGE_MIN_OPEN_DECISIONS = 2;
export const OPEN_DECISIONS_MAX = 6;
const SIZES = new Set(['small', 'medium', 'large']);

/** @returns {null|{reason:'large'|'thin'|'both', size:string|null, openDecisions:string[], perspectives:string[]}} */
export function nudgeFor(assess) {
  if (!assess || typeof assess !== 'object' || Array.isArray(assess)) return null;
  const size = SIZES.has(assess.size) ? assess.size : null;
  const openDecisions = (Array.isArray(assess.openDecisions) ? assess.openDecisions : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().slice(0, 160))
    .slice(0, OPEN_DECISIONS_MAX);
  const large = size === 'large';
  const thin = openDecisions.length >= NUDGE_MIN_OPEN_DECISIONS;
  if (!large && !thin) return null;
  const p = normalizePerspectives(Array.isArray(assess.perspectives) ? assess.perspectives : [...DEFAULT_PERSPECTIVES]);
  return { reason: large && thin ? 'both' : large ? 'large' : 'thin', size, openDecisions,
    perspectives: p.ok ? p.perspectives : [...DEFAULT_PERSPECTIVES] };
}
