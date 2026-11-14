// src/core/requirements/interview-model.mjs — the model and effort of a Claude interview call (A1.1 D2, D8). Split out of
// interview.mjs so model-choice.mjs (9c) can use it without an import cycle; interview.mjs re-exports all three.
import { listModels } from '../config.mjs';
import { utilityModelFor } from '../settings-cascade.mjs';
import { withRole } from '../model-roles.mjs';

const DEFAULTS = Object.freeze({
  listModels,
  // Model roles (D3): an unset interview slot takes the everyday role.
  interviewSlot: () => withRole(utilityModelFor('claude', 'requirementsInterview'), 'claude', 'requirementsInterview'),
});

/** D8: the first plain (not [1m]) Opus in the catalog, which lists the newest first. */
export async function requirementsModel(list = listModels) {
  try {
    const m = (await list(null)).find((x) => x && /^claude-opus-/.test(x.id) && !x.id.includes('['));
    return m ? m.id : undefined;
  } catch { return undefined; }
}

export const DEFAULT_INTERVIEW_EFFORT = 'medium';

/**
 * A1.1 D2: the model and effort of an interview call. The stored `requirementsInterview` pair counts for
 * its model only while the catalog still lists it (a failing catalog read: it counts); otherwise the
 * default Opus applies, with the default effort unless the pair names one. Unset = the default pair.
 * `source` is 'settings' when a stored model or effort was used. Never throws.
 */
export async function interviewModel(deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  let slot = {};
  try { slot = d.interviewSlot() || {}; } catch { slot = {}; }
  let stored = null;
  if (typeof slot.model === 'string' && slot.model) {
    stored = slot.model;   // a failing catalog read: it counts as stored
    try {
      const want = slot.model.toLowerCase();
      const hit = (await d.listModels(null)).find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === want);
      stored = hit ? hit.id : null;   // the catalog's spelling, so label and cost lookups agree
    } catch { /* keep it */ }
  }
  const model = stored || await requirementsModel(d.listModels);
  const effort = slot.effort || (stored ? null : DEFAULT_INTERVIEW_EFFORT);
  return { model: model ?? null, effort: effort || null, source: stored || slot.effort ? 'settings' : 'default' };
}
