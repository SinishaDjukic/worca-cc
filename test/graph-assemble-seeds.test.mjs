// test/graph-assemble-seeds.test.mjs
// The acceptance invariant of spec §4.2: the eight seed shapes (the seven shipped
// seeds and the built-in Default) are exactly what the assembler produces from
// their shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleShape } from '../src/shared/graph/assemble.mjs';
import { isomorphic } from '../src/shared/graph/isomorphic.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';

const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const PORTS = registryPortsFn(REG);
const S = (agent, extra = {}) => ({ agent, ...extra });
const REF = () => S('refiner', { selfLoop: true });

const SEED_SHAPES = {
  wf_default: { stages: [S('clarify'), S('planner'), REF(), S('implementer'), S('reviewer')] },
  wf_full: { stages: [S('clarify'), S('planner'), REF(), S('decomposer'), S('implementer'), S('reviewer'), S('manualTestsChecklist'), S('manualWebUiTesting')] },
  'wf_no-clarify': { stages: [S('planner'), REF(), S('decomposer'), S('implementer'), S('reviewer'), S('manualTestsChecklist'), S('manualWebUiTesting', { loop: false })] },
  'wf_provided-plan': { taskKind: 'plan-complete-detailed', stages: [REF(), S('decomposer'), S('implementer'), S('reviewer'), S('manualTestsChecklist'), S('manualWebUiTesting')] },
  'wf_full-no-decompose': { stages: [S('clarify'), S('planner'), REF(), S('implementer'), S('reviewer'), S('manualTestsChecklist'), S('manualWebUiTesting')] },
  'wf_quick-fix': { stages: [S('planner'), S('implementer'), S('reviewer')] },
  'wf_clarify-implement': { stages: [S('clarify'), S('planner'), REF(), S('implementer'), S('reviewer')] },
  'wf_clarify-quick-fix': { stages: [S('clarify'), S('planner'), S('implementer'), S('reviewer')] },
};

for (const [id, shape] of Object.entries(SEED_SHAPES)) {
  test(`${id} is reproduced by the assembler (isomorphic, zero errors, zero warnings)`, () => {
    const seedTpl = id === 'wf_default' ? GRAPH_DEFAULT_WORKFLOW : SEED_TEMPLATES.find((t) => t.id === id);
    const { template, warnings } = assembleShape(shape, { registry: REG });
    const report = validateGraph(template, PORTS);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(warnings, [], `${id}: the seeds carry no warnings`);
    assert.equal(template.nodes.length, seedTpl.nodes.length);
    assert.equal(template.wires.length, seedTpl.wires.length);
    assert.ok(isomorphic(template, seedTpl), `${id}: topology differs`);
  });
}
