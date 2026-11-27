// test/shape-care-start.test.mjs — Shaper small runs B2 (src/core/shape/care-start.mjs): the Start step's ask (size, Worca's
// pick, estimates, History, model names, the models line) and the answer validator. Every DB and settings read is a seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { careStartAsk, careAnswerValidator } from '../src/core/shape/care-start.mjs';
import { GRAPH_SHAPE_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

const AGENTS = [...new Set(GRAPH_SHAPE_WORKFLOW.nodes.filter((n) => n.kind === 'agent').map((n) => n.key))];
const historyOf = (n) => () => new Map(AGENTS.map((a) => [a, { cost: Array(n).fill(1), ms: Array(n).fill(60_000) }]));
const thin = (care, n) => ({ care, features: n, enough: false, note: 'not enough history yet' });
const rich = (care, n) => ({ care, features: n, enough: true, figures: { changesAfterShip: 2.1, costPerFeature: 36 } });
const figuresOf = (n) => () => Object.fromEntries(['lean', 'balanced', 'thorough'].map((c) => [c, n >= 3 ? rich(c, n) : thin(c, n)]));
const NAMES = { everyday: 'Sonnet 5', deep: 'Opus 5.5', second: 'GPT 5' };
const deps = (over = {}) => ({ history: historyOf(3), figures: figuresOf(3), roleModel: async (_e, role) => NAMES[role] || null, ...over });
const ask = (over = {}, depsOver = {}) => careStartAsk({ prompt: 'take payments', size: 'large', projectDir: '/p', engine: 'claude', fillNotes: null, ...over, deps: deps(depsOver) });

test('the ask: size, facts, Worca\'s pick, names and a description per position', async () => {
  const s = await ask();
  assert.equal(s.size, 'large');
  assert.equal(s.facts.requirements, 16);
  assert.equal(s.pick.position, 'thorough');
  assert.deepEqual(s.names, { everyday: 'Sonnet 5', strong: 'Opus 5.5', second: 'GPT 5' });
  assert.deepEqual(Object.keys(s.positions), ['lean', 'balanced', 'thorough']);
  assert.ok(s.positions.lean.description.endsWith('1 fix cycle'));
  assert.equal(s.modelsLine, null);
});

test('estimates: null for every position with 2 samples per agent, a figure for each with 3', async () => {
  const two = await ask({}, { history: historyOf(2) });
  for (const p of ['lean', 'balanced', 'thorough']) assert.equal(two.positions[p].estimate, null, p);
  assert.equal(two.estimateCap, null);
  const three = await ask();
  for (const p of ['lean', 'balanced', 'thorough']) assert.ok(three.positions[p].estimate && three.positions[p].estimate.costUsd > 0, p);
  assert.equal(three.positions.thorough.estimate.costUsd, 8 * three.positions.thorough.estimate.perRun);
});

test('estimateCap names Lean and Balanced when their figures are equal; all three without a size', async () => {
  const s = await ask();
  assert.equal(s.estimateCap, 'Lean and Balanced differ in fix cycles and models, which recorded step costs do not show yet');
  const none = await ask({ size: null });
  assert.equal(none.estimateCap, 'Lean, Balanced and Thorough differ in fix cycles and models, which recorded step costs do not show yet');
});

test('History: enough false with 2 features, true with 3; the line per position', async () => {
  const two = await ask({}, { figures: figuresOf(2) });
  assert.deepEqual(two.history.lean, { enough: false, features: 2, line: 'Lean: not enough history yet' });
  const three = await ask();
  assert.deepEqual(three.history.thorough, { enough: true, features: 3, line: 'Thorough · 2.1 changes after ship per feature · ≈ $36 each · 3 features' });
});

test('the models line from fixture B\'s fillNotes (3 project, 1 run, 1 slot), and null for none', async () => {
  const fillNotes = { source: 'care', filled: ['n_review'], kept: { run: ['n_roles'], project: ['n_clarify', 'n_plan', 'n_refine'], slot: ['n_impl'] } };
  assert.equal((await ask({ fillNotes })).modelsLine,
    "Models: your picks for this run are kept for 1 agent · your project's picks are kept for 3 agents · your step models are kept for 1 agent");
  assert.equal((await ask({ fillNotes: { source: 'care', filled: [], kept: { run: [], project: [], slot: [] } } })).modelsLine, null);
});

test('never throws: a failing estimate or figures read gives null / not enough history, and warns', async () => {
  const warned = [];
  const s = await ask({}, { history: () => { throw new Error('db gone'); }, figures: () => { throw new Error('db gone'); }, warn: (m) => warned.push(m) });
  for (const p of ['lean', 'balanced', 'thorough']) {
    assert.equal(s.positions[p].estimate, null);
    assert.equal(s.history[p].enough, false);
  }
  assert.equal(warned.length, 1);
});

test('careAnswerValidator: the server\'s pick, reason and facts whatever the payload carries; a bad position is refused', async () => {
  const start = await ask();
  const v = careAnswerValidator(start);
  const out = v({ care: { position: 'lean', worcaPick: 'lean', chosenBy: 'default', reason: 'mine', facts: {} } });
  assert.equal(out.ok, true);
  assert.deepEqual({ ...out.payload, at: null }, { position: 'lean', chosenBy: 'person', worcaPick: 'thorough', reason: start.pick.reason, facts: start.facts, at: null });
  assert.ok(!Number.isNaN(Date.parse(out.payload.at)));
  assert.equal(v({ care: { position: 'thorough' } }).payload.chosenBy, 'default');
  for (const bad of [null, {}, { care: { position: 'max' } }, { care: 'lean' }]) {
    assert.deepEqual(v(bad), { ok: false, errors: [{ field: 'care', message: 'Care must be Lean, Balanced or Thorough.' }] });
  }
});

test('no model id literal in the module', () => {
  const src = readFileSync(new URL('../src/core/shape/care-start.mjs', import.meta.url), 'utf8');
  assert.ok(!/claude-|gpt-|opus|sonnet|haiku|gemini/i.test(src));
});
