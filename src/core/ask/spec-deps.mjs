// src/core/ask/spec-deps.mjs — propose_spec's real readers. The tool is listed only while the specBuilder
// flag is on (bundle presence, the clones pattern): off ⇒ {} ⇒ the tool list is byte-identical to today.
import { createSpecValidator } from './spec-proposal.mjs';
import { checkPaths } from '../spec-builder/grounding.mjs';
import { listProjects } from '../projects.mjs';
import { flagEnabled } from '../flags.mjs';
import { estimateFromHistory } from '../spec-builder/history.mjs';

const projectOf = async (key) => (await listProjects()).find((p) => p.key === key) || null;

/** The parent's authoritative validator (turn.mjs): prices the spec, grounds it, attaches the shape — never rejects on shape (R2). */
export const validateSpecProposal = createSpecValidator({ projectOf, estimate: estimateFromHistory, checkPaths });

/** One validator per tool server (createAskToolServer: one per turn), so the shape budget is per turn. */
export function defaultSpecDeps({ enabled = () => flagEnabled('specBuilder') } = {}) {
  return enabled() ? { specs: { validate: createSpecValidator({ projectOf, checkPaths, enforceShape: true }) } } : {};
}
