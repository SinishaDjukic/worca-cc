// test/workflows-lean.test.mjs — the reserved Lean built-in (wf_lean_build): Clarify -> design-level Plan ->
// Implement -> adversarial Review -> one fix pass, no Refine. Listed after Default, never a row. Also pins
// Default's one light refine cycle.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  readWorkflow, listWorkflows, writeGraphWorkflow, deleteWorkflow, assertRunnableWorkflow, resolveGraph,
  setWorkflowNodeDefaults,
} from '../src/core/workflows.mjs';
import {
  LEAN_WORKFLOW_ID, LEAN_WORKFLOW_NAME, GRAPH_LEAN_WORKFLOW, GRAPH_DEFAULT_WORKFLOW, isReservedWorkflowId,
} from '../src/core/graph/builtin-workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { RESERVED_WORKFLOW_IDS as COMPOSER_RESERVED } from '../ui/public/graph/composer.mjs';
import { BUILTIN_WORKFLOW_IDS } from '../ui/public/chat/home-lists.mjs';

useTempHome(after);

const edges = (wf) => wf.wires.map((w) => `${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`);

test('wf_lean_build is clarify -> plan -> implement ⇄ review with ONE fix pass and no refine', () => {
  const wf = GRAPH_LEAN_WORKFLOW;
  assert.equal(LEAN_WORKFLOW_ID, 'wf_lean_build');
  assert.equal(LEAN_WORKFLOW_NAME, 'Lean');
  assert.equal(wf.version, 2);
  assert.deepEqual(wf.nodes.filter((n) => n.kind === 'agent').map((n) => n.key), ['clarify', 'planner', 'implementer', 'reviewer']);
  assert.deepEqual(edges(wf), [
    'n_task.task->n_clarify.task', 'n_task.task->n_plan.task', 'n_clarify.answers->n_plan.answers',
    'n_plan.plan->n_impl.plan', 'n_plan.plan->n_review.plan', 'n_impl.done->n_review.done',
    'n_review.review->n_impl.fix', 'n_review.pass->n_end.result',
  ]);
  // maxCycles 2 = review, one fix, re-review; then the person decides.
  assert.deepEqual(wf.wires.find((w) => w.from.port === 'review').config, { maxCycles: 2 });
  assert.equal(wf.nodes.find((n) => n.key === 'planner').config.subagentModel, 'sonnet', 'the planner re-checks its lanes');
  assert.deepEqual(wf.nodes.find((n) => n.key === 'reviewer').config, {}, 'the reviewer keeps the auto pick for severity calls');
  assert.ok(Object.isFrozen(wf.nodes[2].config), 'deep-frozen');
  const reg = loadAgentRegistry();
  const { ok, errors } = validateGraph(wf, registryPortsFn(reg, loadScriptRegistry({ agentKeys: Object.keys(reg) })));
  assert.ok(ok, JSON.stringify(errors));
});

test('Default runs ONE light refine cycle and continues with what is left', () => {
  const w5 = GRAPH_DEFAULT_WORKFLOW.wires.find((w) => w.id === 'w5');
  assert.deepEqual(w5.config, { maxCycles: 1, onExhausted: 'clean' });
  const reg = loadAgentRegistry();
  const { ok, errors } = validateGraph(GRAPH_DEFAULT_WORKFLOW, registryPortsFn(reg, loadScriptRegistry({ agentKeys: Object.keys(reg) })));
  assert.ok(ok, JSON.stringify(errors));
});

test('on a fresh home it reads, runs and resolves, and the planner lanes resolve to sonnet', async () => {
  assert.equal(await readWorkflow(LEAN_WORKFLOW_ID), GRAPH_LEAN_WORKFLOW);
  assert.equal(await assertRunnableWorkflow(LEAN_WORKFLOW_ID), GRAPH_LEAN_WORKFLOW);
  const resolved = await resolveGraph(process.cwd(), LEAN_WORKFLOW_ID, loadAgentRegistry());
  assert.equal(resolved.nodes.n_plan.subagentModel, 'sonnet');
  assert.equal(resolved.nodes.n_review.subagentModel, '');
  assert.deepEqual(resolved.wires, { w9: { maxCycles: 2 } });
});

test('reserved: never a row, a "Lean" save keeps its own id, delete and defaults are refused', async () => {
  assert.equal(isReservedWorkflowId(LEAN_WORKFLOW_ID), true);
  assert.ok(COMPOSER_RESERVED.has(LEAN_WORKFLOW_ID), 'the composer opens it read-only');
  assert.ok(BUILTIN_WORKFLOW_IDS.includes(LEAN_WORKFLOW_ID));
  assert.equal((await writeGraphWorkflow({ name: 'Lean', nodes: [], wires: [] })).id, 'wf_lean', 'no name slugs onto the built-in');
  assert.equal((await writeGraphWorkflow({ id: LEAN_WORKFLOW_ID, name: 'Mine', nodes: [], wires: [] })).id, 'wf_mine');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM workflows WHERE id = ?').get(LEAN_WORKFLOW_ID).n, 0);
  assert.equal(await deleteWorkflow(LEAN_WORKFLOW_ID), false);
  await assert.rejects(setWorkflowNodeDefaults(LEAN_WORKFLOW_ID, {}), /built-in Lean workflow cannot store defaults/);
  assert.ok(!(await listWorkflows()).some((w) => w.id === LEAN_WORKFLOW_ID), 'the saved list never carries it');
});

// The agent texts the lean shape leans on (run 6c9cf587 audit W1/W4/W5): a reviewer race floor with no "latent"
// escape, plans as contracts, and fix passes that neither run the full suite nor poll a background run.
test('agent prompts: the race floor needs a file:line proof, plans carry no code bodies, no polling', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../agents/${f}`, import.meta.url), 'utf8');
  const reviewer = read('worca-cc-code-reviewer.md');
  assert.match(reviewer, /concrete interleaving on the real code[^\n]*whether or not anyone has observed it/);
  assert.match(reviewer, /"Latent", "suspected", "not observed" or "unlikely" never lower a race below major/);
  assert.match(reviewer, /citing file:line, that no interleaving is possible/);
  assert.match(reviewer, /"The plan decided this" never lowers a severity/);
  assert.doesNotMatch(reviewer, /CONFIRMED race/, 'a race no longer needs to be observed to be major');
  assert.match(read('worca-cc-planner.md'), /Do NOT write full function bodies/);
  const impl = read('worca-cc-implementer.md');
  assert.match(impl, /Do \*\*not\*\* run the full suite in fix mode/);
  assert.match(impl, /Never wait for it with `sleep`, `until` or polling loops/);
  assert.match(read('worca-cc-plan-refiner.md'), /at most 1\.3× the size of the input plan/);
});
