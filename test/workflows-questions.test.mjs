// test/workflows-questions.test.mjs
// resolveGraph: node.askQuestions precedence matrix (spec 2026-07-11 §4).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGraph, writeGraphWorkflow, GRAPH_DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';
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

// Hand-built registry: capable+off, locked-on, locked-off, unsupported. Every
// entry is meta v2 (resolveGraph refuses an un-ported sidecar).
// No agentFile => loadAgentFile returns {prompt:'', tools:[]}.
const PORTS = {
  metaVersion: 2,
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
};
const REG = {
  planner:  { key: 'planner',  runnerType: 'producer',  asksQuestions: true,  questionsLocked: false, questionsDefault: false, ...PORTS },
  clarify:  { key: 'clarify',  runnerType: 'clarifier', asksQuestions: true,  questionsLocked: true,  questionsDefault: true, ...PORTS },
  lockOff:  { key: 'lockOff',  runnerType: 'producer',  asksQuestions: true,  questionsLocked: true,  questionsDefault: false, ...PORTS },
  plainOld: { key: 'plainOld', runnerType: 'producer', ...PORTS }, // pre-feature meta: no question fields
};
const TPL = {
  id: 'wf_q', name: 'Q',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_clar', kind: 'agent', key: 'clarify',  x: 240, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner',  x: 480, y: 0, config: {} },
    { id: 'n_lock', kind: 'agent', key: 'lockOff',  x: 720, y: 0, config: {} },
    { id: 'n_old',  kind: 'agent', key: 'plainOld', x: 960, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} },
  ],
  wires: [],
};

test('defaults: locked follows questionsDefault; unlocked defaults off; unsupported false', async () => {
  const p = await tmp();
  const wf = await writeGraphWorkflow({ ...TPL });
  const byId = (await resolveGraph(p, wf.id, REG, await tmp())).nodes;
  assert.equal(byId.n_clar.askQuestions, true);   // locked ON
  assert.equal(byId.n_plan.askQuestions, false);  // capable, off by default
  assert.equal(byId.n_lock.askQuestions, false);  // locked OFF
  assert.equal(byId.n_old.askQuestions, false);   // no manifest fields
});

test('node config wins for unlocked agents; is IGNORED for locked/unsupported', async () => {
  const p = await tmp();
  const wf = await writeGraphWorkflow({ ...TPL });
  await setNodeModel(p, wf.id, 'n_plan', { askQuestions: true });
  await setNodeModel(p, wf.id, 'n_lock', { askQuestions: true });  // locked: must stay false
  await setNodeModel(p, wf.id, 'n_old',  { askQuestions: true });  // unsupported: must stay false
  const byId = (await resolveGraph(p, wf.id, REG, await tmp())).nodes;
  assert.equal(byId.n_plan.askQuestions, true);
  assert.equal(byId.n_lock.askQuestions, false);
  assert.equal(byId.n_old.askQuestions, false);
});

test('legacy per-role config applies on wf_default only, below node config', async () => {
  const p = await tmp();
  await setStep(p, 'planner', { askQuestions: true });
  // The built-in default's own keys, all meta v2 (the legacy per-role layer is
  // keyed by agent KEY and applies to wf_default only).
  const reg = Object.fromEntries(['clarify', 'planner', 'refiner', 'implementer', 'reviewer']
    .map((k) => [k, { key: k, runnerType: k === 'reviewer' ? 'verifier' : 'producer', asksQuestions: true, ...PORTS }]));
  const nodes = (await resolveGraph(p, GRAPH_DEFAULT_WORKFLOW.id, reg, await tmp())).nodes;
  const planner = Object.values(nodes).find((n) => n.key === 'planner');
  assert.equal(planner.askQuestions, true);
});
