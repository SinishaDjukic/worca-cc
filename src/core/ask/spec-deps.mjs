// src/core/ask/spec-deps.mjs — propose_spec's real readers. The tool is listed only while the specBuilder
// flag is on (bundle presence, the clones pattern): off ⇒ {} ⇒ the tool list is byte-identical to today.
import { createSpecValidator } from './spec-proposal.mjs';
import { listProjects } from '../projects.mjs';
import { flagEnabled } from '../flags.mjs';
import { estimateFromHistory } from '../spec-builder/history.mjs';

const projectOf = async (key) => (await listProjects()).find((p) => p.key === key) || null;

/** The parent's authoritative validator (turn.mjs): it also prices the spec from this machine's history. */
export const validateSpecProposal = createSpecValidator({ projectOf, estimate: estimateFromHistory });

export function defaultSpecDeps({ enabled = () => flagEnabled('specBuilder') } = {}) {
  return enabled() ? { specs: { validate: createSpecValidator({ projectOf }) } } : {};
}
