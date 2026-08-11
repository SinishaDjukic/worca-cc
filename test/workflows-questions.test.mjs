// test/workflows-questions.test.mjs
// resolveGraph: the node askQuestions precedence matrix (spec 2026-07-11 §4),
// now over v2 graph nodes — overlay > template node.config > role > sidecar,
// with locked/unsupported agents overriding the whole chain.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGraph, writeWorkflow } from '../src/core/workflows.mjs';
import { setStep, setNodeModel } from '../src/core/config.mjs';
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
// No agentFile => loadAgentFile returns {prompt:'', tools:[]}.
const IN = [{ id: 'task', type: 'md', required: true, as: 'file' }];
const OUT = [{ id: 'out', type: 'md', when: 'always', filename: '{base}.md', store: 'run', artifactKind: 'out' }];
const REG = {
  planner: {
    key: 'planner', runnerType: 'producer', origin: 'builtin', order: 1, inputs: IN, outputs: OUT,
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
  },
  clarify: {
    key: 'clarify', runnerType: 'clarifier', origin: 'builtin', order: 2,
    inputs: IN, outputs: [{ id: 'out', type: 'json', when: 'always', filename: 'clarify.json', store: 'run', artifactKind: 'clarify' }],
    asksQuestions: true, questionsLocked: true, questionsDefault: true,
  },
  lockOff: {
    key: 'lockOff', runnerType: 'producer', origin: 'user', order: 3, inputs: IN, outputs: OUT,
    asksQuestions: true, questionsLocked: true, questionsDefault: false,
  },
  plainOld: { key: 'plainOld', runnerType: 'producer', origin: 'user', order: 4, inputs: IN, outputs: OUT },
};

/** One task node feeding four independent agents, each landing on an OR -> End. */
function questionsGraph() {
  const agents = [
    ['n_clar', 'clarify'],
    ['n_plan', 'planner'],
    ['n_lock', 'lockOff'],
    ['n_old', 'plainOld'],
  ];
  return {
    name: 'Q',
    domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      ...agents.map(([id, key], i) => ({ id, kind: 'agent', key, x: 300, y: i * 200, config: {} })),
      { id: 'n_or', kind: 'or', x: 600, y: 300, config: { arity: 3 } },
      { id: 'n_end', kind: 'end', x: 900, y: 300, config: {} },
    ],
    wires: [
      ...agents.map(([id], i) => ({ id: `w${i + 1}`, from: { node: 'n_task', port: 'task' }, to: { node: id, port: 'task' } })),
      { id: 'w5', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_or', port: 'in1' } },
      { id: 'w6', from: { node: 'n_lock', port: 'out' }, to: { node: 'n_or', port: 'in2' } },
      { id: 'w7', from: { node: 'n_old', port: 'out' }, to: { node: 'n_or', port: 'in3' } },
      { id: 'w8', from: { node: 'n_or', port: 'out' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}

test('defaults: locked follows questionsDefault; unlocked defaults off; unsupported false', async () => {
  const p = await tmp();
  const wf = await writeWorkflow(questionsGraph());
  const { nodeCtx } = await resolveGraph(p, wf.id, REG, await tmp());
  assert.equal(nodeCtx.n_clar.askQuestions, true);   // locked ON
  assert.equal(nodeCtx.n_plan.askQuestions, false);  // capable, off by default
  assert.equal(nodeCtx.n_lock.askQuestions, false);  // locked OFF
  assert.equal(nodeCtx.n_old.askQuestions, false);   // no manifest fields
});

test('node config wins for unlocked agents; is IGNORED for locked/unsupported', async () => {
  const p = await tmp();
  const wf = await writeWorkflow(questionsGraph());
  await setNodeModel(p, wf.id, 'n_plan', { askQuestions: true });
  await setNodeModel(p, wf.id, 'n_lock', { askQuestions: true });  // locked: must stay false
  await setNodeModel(p, wf.id, 'n_old', { askQuestions: true });   // unsupported: must stay false
  const { nodeCtx } = await resolveGraph(p, wf.id, REG, await tmp());
  assert.equal(nodeCtx.n_plan.askQuestions, true);
  assert.equal(nodeCtx.n_lock.askQuestions, false);
  assert.equal(nodeCtx.n_old.askQuestions, false);
});

test('the template node.config sits between the overlay and the role layer', async () => {
  const p = await tmp();
  const tpl = questionsGraph();
  tpl.nodes.find((n) => n.id === 'n_plan').config = { askQuestions: true };
  const wf = await writeWorkflow(tpl);
  assert.equal((await resolveGraph(p, wf.id, REG, await tmp())).nodeCtx.n_plan.askQuestions, true);
  await setNodeModel(p, wf.id, 'n_plan', { askQuestions: false });
  assert.equal((await resolveGraph(p, wf.id, REG, await tmp())).nodeCtx.n_plan.askQuestions, false);
});

test('legacy per-role config reaches every workflow, below the node layers', async () => {
  const p = await tmp();
  await setStep(p, 'planner', { askQuestions: true });
  const wf = await writeWorkflow(questionsGraph());
  // A SAVED template, not just the built-in default: the role layer is the
  // weakest configured layer, but it is not workflow-scoped.
  assert.equal((await resolveGraph(p, wf.id, REG, await tmp())).nodeCtx.n_plan.askQuestions, true);
  assert.equal((await resolveGraph(p, 'wf_default', REG, await tmp())).nodeCtx.n_plan.askQuestions, true);
  await setNodeModel(p, wf.id, 'n_plan', { askQuestions: false });
  assert.equal((await resolveGraph(p, wf.id, REG, await tmp())).nodeCtx.n_plan.askQuestions, false,
    'the per-node overlay still wins');
});
