// test/helpers/auto-proposal-fixture.mjs — the REAL P1 pipeline, offline: mock classifier → assembler → buildProposal.
import { loadAgentRegistry } from '../../src/core/agent-registry.mjs';
import { assembleShape } from '../../src/shared/graph/assemble.mjs';
import { mockShapeFor } from '../../src/core/auto/recipes.mjs';
import { buildProposal } from '../../src/core/auto/proposal.mjs';

export const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
export const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'max'] }, { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['low', 'medium', 'high'] }];
export const WEB_TASK = 'Add a settings page with a toggle button in the React UI so users can switch themes in the browser.';

/** A proposal for `text` (default: the web task ⇒ clarify · planner · refiner⟳ · implementer ⇄ reviewer + checklist → web testing, OR valve). */
export function proposalFor(text = WEB_TASK, { round = 1, match = null, humanInLoop = true } = {}) {
  const shape = mockShapeFor(text, { humanInLoop });          // raw recipe clone: stage tunables sit at the top level
  shape.stages[0].model = 'claude-sonnet-5'; shape.stages[0].effort = 'medium';
  const built = assembleShape(shape, { registry: REG, humanInLoop });
  return buildProposal({ round, shape: built.shape, template: built.template, match, tunables: built.tunables, registry: REG, models: MODELS, warnings: built.warnings, costUsd: 0.02, fingerprint: 'top-level: src/ ui/\nhints: web-ui likely (react); tests: jsdom' });
}
