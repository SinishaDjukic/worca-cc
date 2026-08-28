// test/workflows-questions.test.mjs
// resolveWorkflow: node.askQuestions precedence matrix (spec 2026-07-11 §4).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkflow, writeWorkflow } from '../src/core/workflows.mjs';
import { setStep, setNodeModel } from '../src/core/config.mjs';
import { decomposedTaskNode } from '../src/core/orchestrator.mjs';
import { _resetForTests } from '../src/core/db.mjs';

const homes = [];
const dirs = [];
beforeEach(async () => {
  const h = await mkdtemp(join(tmpdir(), 'worca-cc-qwf-home-'));
  homes.push(h);
  _resetForTests();
  process.env.WORCA_HOME = h;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all([...homes, ...dirs].map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-qwf-')); dirs.push(d); return d; }

// Hand-built registry: capable+off, locked-on, locked-off, unsupported.
// No agentFile => loadAgentFile returns {prompt:'', tools:[]} (workflows.mjs:49).
const REG = {
  planner:  { key: 'planner',  runnerType: 'producer',  asksQuestions: true,  questionsLocked: false, questionsDefault: false },
  clarify:  { key: 'clarify',  runnerType: 'clarifier', asksQuestions: true,  questionsLocked: true,  questionsDefault: true },
  lockOff:  { key: 'lockOff',  runnerType: 'producer',  asksQuestions: true,  questionsLocked: true,  questionsDefault: false },
  plainOld: { key: 'plainOld', runnerType: 'producer' }, // pre-feature meta: no fields
};
const TPL = {
  name: 'Q', steps: [
    [{ id: 'n_clar', key: 'clarify' }],
    [{ id: 'n_plan', key: 'planner' }],
    [{ id: 'n_lock', key: 'lockOff' }],
    [{ id: 'n_old',  key: 'plainOld' }],
  ], feedbacks: [],
};

test('defaults: locked follows questionsDefault; unlocked defaults off; unsupported false', async () => {
  const p = await tmp();
  const wf = await writeWorkflow({ ...TPL });
  const plan = await resolveWorkflow(p, wf.id, REG, await tmp());
  const byId = Object.fromEntries(plan.steps.flat().map((n) => [n.nodeId, n]));
  assert.equal(byId.n_clar.askQuestions, true);   // locked ON
  assert.equal(byId.n_plan.askQuestions, false);  // capable, off by default
  assert.equal(byId.n_lock.askQuestions, false);  // locked OFF
  assert.equal(byId.n_old.askQuestions, false);   // no manifest fields
});

test('node config wins for unlocked agents; is IGNORED for locked/unsupported', async () => {
  const p = await tmp();
  const wf = await writeWorkflow({ ...TPL });
  await setNodeModel(p, wf.id, 'n_plan', { askQuestions: true });
  await setNodeModel(p, wf.id, 'n_lock', { askQuestions: true });  // locked: must stay false
  await setNodeModel(p, wf.id, 'n_old',  { askQuestions: true });  // unsupported: must stay false
  const plan = await resolveWorkflow(p, wf.id, REG, await tmp());
  const byId = Object.fromEntries(plan.steps.flat().map((n) => [n.nodeId, n]));
  assert.equal(byId.n_plan.askQuestions, true);
  assert.equal(byId.n_lock.askQuestions, false);
  assert.equal(byId.n_old.askQuestions, false);
});

test('legacy per-role config applies on wf_default only, below node config', async () => {
  const p = await tmp();
  await setStep(p, 'planner', { askQuestions: true });
  const plan = await resolveWorkflow(p, 'wf_default_v1', REG, await tmp());
  const planner = plan.steps.flat().find((n) => n.key === 'planner');
  assert.equal(planner.askQuestions, true);
});

test('decomposedTaskNode never asks', () => {
  const impl = { model: undefined, effort: undefined, tools: [], fanOut: false, askQuestions: true };
  const node = decomposedTaskNode(impl, { id: 't1', nodeId: 's_impl_p1_t1' }, [], '/tmp/p');
  assert.equal(node.askQuestions, false);
});
