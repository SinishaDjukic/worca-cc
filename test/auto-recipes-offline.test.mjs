// test/auto-recipes-offline.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { RECIPE_GUIDE, RECIPE_SHAPES, mockShapeFor } from '../src/core/auto/recipes.mjs';
import { assembleShape, normalizeShape } from '../src/shared/graph/assemble.mjs';
import { runGraphOffline } from './helpers/graph-run.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { QUIESCENCE_WARNING } from '../src/core/graph/scheduler.mjs';

useTempHome(after);

const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const PORTS = registryPortsFn(REG);
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const S2 = (agent, extra = {}) => ({ agent, ...extra });

test('mockShapeFor is deterministic and picks by cheap heuristics', () => {
  const trivial = mockShapeFor('demo task');
  assert.equal(trivial.taskKind, 'prompt');
  assert.deepEqual(trivial.stages.map((s) => s.agent), ['planner', 'implementer', 'reviewer'], 'a short prompt is a quick fix');
  const prompt = mockShapeFor('Please add a background job that re-indexes the search catalogue every night and reports failures to the ops channel.');
  assert.deepEqual(prompt.stages.map((s) => s.agent), ['clarify', 'planner', 'refiner', 'implementer', 'reviewer']);
  assert.equal(prompt.stages[2].selfLoop, true);
  const noHuman = mockShapeFor('Please add a background job that re-indexes the search catalogue every night and reports failures to the ops channel.', { humanInLoop: false });
  assert.deepEqual(noHuman.stages.map((s) => s.agent), ['planner', 'refiner', 'implementer', 'reviewer']);
  const web = mockShapeFor('Add a settings page with a toggle button in the React UI so users can switch themes in the browser.');
  assert.deepEqual(web.stages.map((s) => s.agent).slice(-2), ['manualTestsChecklist', 'manualWebUiTesting']);
  const plan = mockShapeFor(`# Plan\n\n## Task 1\n${'detail '.repeat(300)}`);
  assert.equal(plan.taskKind, 'plan-complete-detailed');
  assert.deepEqual(plan.stages.map((s) => s.agent), ['implementer', 'reviewer']);
  const small = mockShapeFor('# Plan\n\n- rename the flag\n- update the test');
  assert.equal(small.taskKind, 'plan-complete-small');
  assert.deepEqual(small.stages.map((s) => s.agent), ['implementer']);
  assert.notEqual(mockShapeFor('demo task'), mockShapeFor('demo task'), 'a fresh object every call');
  for (const s of [trivial, prompt, noHuman, web, plan, small]) normalizeShape(s);   // all canonical
});

test('RECIPE_GUIDE names every task kind, modifier and agent key; RECIPE_SHAPES all normalize', () => {
  for (const k of ['prompt', 'plan-partial', 'plan-complete-detailed', 'plan-complete-small', 'web', 'large', 'risky', 'trivial']) assert.ok(RECIPE_GUIDE.includes(k), k);
  // Substring checks alone are vacuous: pin the SHAPE of the guide too.
  for (const line of ['- web / UI feature', '- large task', '- risky or large plan', '- trivial']) assert.ok(RECIPE_GUIDE.includes(line), line);
  for (const key of ['clarify', 'planner', 'refiner', 'implementer', 'reviewer', 'decomposer', 'planReviewer', 'manualTestsChecklist', 'manualWebUiTesting']) assert.ok(RECIPE_GUIDE.includes(key), key);
  assert.ok(RECIPE_GUIDE.includes('a stage after a parallel group waits for the whole group'), 'the group rule is taught');
  assert.ok(!RECIPE_GUIDE.includes('only as the LAST stage'), 'the old (false) terminal-only rule is gone');
  assert.ok(RECIPE_SHAPES.length >= 12);
  assert.ok(RECIPE_SHAPES.some((r) => r.id === 'parallel-mid'), 'a mid-workflow group is taught and tested');
  for (const r of RECIPE_SHAPES) { assert.ok(r.id); normalizeShape(r.shape); }
});

test('every recipe shape assembles and runs offline to the End card, with and without a human in the loop', { timeout: 300000 }, async () => {
  const shapes = [...RECIPE_SHAPES.map((r) => ({ id: r.id, shape: r.shape })),
    { id: 'mock:trivial', shape: mockShapeFor('demo task') },
    { id: 'mock:web', shape: mockShapeFor('Add a settings page with a toggle button in the React UI so users can switch themes in the browser.') },
    // The LOOP_INTO_GROUP hazard shape: without the rule the web-UI review would loop
    // into the implementer (a group member it does not read) and the run would quiesce
    // with End unreached; with it the review loops to the planner and every member
    // re-fires on the fresh plan.
    { id: 'group-member-loop', shape: { stages: [S2('planner'), { parallel: [S2('implementer'), S2('manualTestsChecklist')] }, S2('manualWebUiTesting')] } }];
  for (const { id, shape } of shapes) {
    for (const humanInLoop of [true, false]) {
      const { template, warnings } = assembleShape(shape, { registry: REG, humanInLoop });
      assert.deepEqual(warnings.filter((w) => w.code === 'LOOP_UNWIRED'), [], `${id}: every verifier loops somewhere`);
      const r = await runGraphOffline({
        template: { ...template, id: `wf_${id.replace(/[^a-z0-9]/gi, '')}` }, portsFn: PORTS, registry: REG,
        projectDir: tmp('worca-auto-recipe-proj-'), pipelineDir: tmp('worca-auto-recipe-pipe-'),
        taskText: '# Task\n\nBUILD IT\n',
      });
      assert.equal(r.result, 'done', `${id} hitl=${humanInLoop}: the run resolves done`);
      assert.equal(r.state.endReached, true, `${id} hitl=${humanInLoop}: a token reached End`);
      assert.ok(!(r.state.warnings || []).includes(QUIESCENCE_WARNING), `${id} hitl=${humanInLoop}: no quiescence`);
      if (!humanInLoop) assert.ok(!template.nodes.some((n) => n.key === 'clarify'), `${id}: no clarifier when the human is out of the loop`);
    }
  }
});
