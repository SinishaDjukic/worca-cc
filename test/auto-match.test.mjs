import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeGraphWorkflow, writeWorkflow, GRAPH_DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { assembleShape } from '../src/shared/graph/assemble.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { autoCandidates, findEquivalentWorkflow } from '../src/core/auto/match.mjs';

useTempHome(after);
const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const S = (agent, extra = {}) => ({ agent, ...extra });

test('candidates = the built-in Default first, then every live v2 row OLDEST first; wf_auto and v1 rows never', async () => {
  // A fresh test home has NO seed rows (V24 seeds only an existing DB), so write them here —
  // WITH their historical createdAt (writeGraphWorkflow keeps a string createdAt), so the
  // order below is deterministic. wf_mine is written LAST and stamped now.
  for (const t of SEED_TEMPLATES) await writeGraphWorkflow({ id: t.id, name: t.name, domain: t.domain, nodes: t.nodes, wires: t.wires, createdAt: t.createdAt });
  await writeGraphWorkflow({ id: 'wf_mine', name: 'Mine', origin: 'auto', nodes: SEED_TEMPLATES[4].nodes, wires: SEED_TEMPLATES[4].wires });
  await writeWorkflow({ id: 'wf_v1row', name: 'V1 row', steps: ['planner'], feedbacks: [] });
  const c = await autoCandidates();
  assert.equal(c[0], GRAPH_DEFAULT_WORKFLOW);
  assert.deepEqual(c.slice(1, 3).map((t) => t.id), ['wf_full', 'wf_no-clarify'], 'rows come oldest first');
  assert.equal(c[c.length - 1].id, 'wf_mine', 'the row written today comes last');
  assert.ok(c.some((t) => t.id === 'wf_full') && c.some((t) => t.id === 'wf_mine'));
  assert.ok(!c.some((t) => t.id === 'wf_auto'));
  assert.ok(!c.some((t) => t.id === 'wf_v1row'), 'a v1 row is never a candidate');
});

test('an assembled shape finds its exact twin; Default beats an identical row; the OLDER twin beats a newer duplicate; ±1 agent is no match', async () => {
  const c = await autoCandidates();
  const dflt = assembleShape({ stages: [S('clarify'), S('planner'), S('refiner', { selfLoop: true }), S('implementer'), S('reviewer')] }, { registry: REG }).template;
  const m1 = findEquivalentWorkflow(dflt, c);
  assert.equal(m1.candidate.id, 'wf_default', 'the built-in comes first even though wf_clarify-implement is identical');
  assert.equal(m1.nodeMap.get('n_planner'), 'n_plan');

  const qf = assembleShape({ stages: [S('planner'), S('implementer'), S('reviewer')] }, { registry: REG }).template;
  const m2 = findEquivalentWorkflow(qf, c);
  assert.equal(m2.candidate.id, 'wf_quick-fix', 'the OLDER seed beats the identical, newer auto row (D8: reuse, do not duplicate)');
  assert.equal(m2.nodeMap.get('n_implementer'), 'n_impl');

  const plus = assembleShape({ stages: [S('planner'), S('refiner', { selfLoop: true }), S('implementer'), S('reviewer')] }, { registry: REG }).template;
  assert.equal(findEquivalentWorkflow(plus, c), null, 'plan+refine+implement+review matches no seed');
  assert.equal(findEquivalentWorkflow(qf, []), null);
});
