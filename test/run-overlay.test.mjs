// test/run-overlay.test.mjs — the ONE check of a run's per-node overlay (src/core/run-overlay.mjs): POST /api/run
// `overlay.nodes` and propose_run `nodes` both go through it (checkShapeModels + runsOn, agent nodes only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRunOverlay, parseOverlayNodes, checkRunOverlay, overlayWorkflowRefusal, overlayStepModels, OVERLAY_ERRORS, OVERLAY_MAX_NODES } from '../src/core/run-overlay.mjs';

const WF = { id: 'wf_review', name: 'Review', version: 2, nodes: [
  { id: 'n_task', kind: 'task' }, { id: 'n_plan', kind: 'agent', key: 'planner' }, { id: 'n_impl', kind: 'agent', key: 'implementer' }, { id: 'n_end', kind: 'end' }] };
const MODELS = [
  { id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'], harnesses: ['claude'] },
  { id: 'claude-haiku-4-5', efforts: ['medium', 'high'], harnesses: ['claude'] },
  { id: 'gpt-5.5', efforts: ['minimal', 'low', 'medium', 'high'], harnesses: ['codex'] },
];

test('parseRunOverlay: shape only — nodes only, objects keyed by id, typed and trimmed values; junk never throws', () => {
  assert.deepEqual(parseRunOverlay({ nodes: { n_plan: { model: ' claude-opus-5-5 ', effort: 'high', fanOut: true } } }),
    { overlay: { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high', fanOut: true } } } });
  assert.deepEqual(parseRunOverlay({ nodes: {} }), { overlay: null }, 'an empty overlay is none');
  assert.deepEqual(parseRunOverlay({ nodes: { n_plan: { model: 'claude-opus-5-5', effort: '', subagentModel: '' } } }),
    { overlay: { nodes: { n_plan: { model: 'claude-opus-5-5' } } } }, "'' clears nothing — it is just absent");
  assert.equal(parseRunOverlay([]).error, OVERLAY_ERRORS.shape);
  assert.match(parseRunOverlay({ nodes: {}, foo: {} }).error, /^overlay takes nodes and wires only \(got "foo"\)$/);
  assert.match(parseRunOverlay({ nodes: [] }).error, /^overlay\.nodes must be an object keyed by node id$/);
  assert.match(parseRunOverlay({ nodes: { n_plan: 'opus' } }).error, /^overlay\.nodes\.n_plan must be an object$/);
  assert.match(parseRunOverlay({ nodes: { n_plan: { model: 'x', reason: 'why' } } }).error, /^overlay\.nodes\.n_plan: unknown key "reason"$/);
  for (const [sel, re] of [
    [{ model: '' }, /node "n_plan": model must be a catalog model id/], [{ model: 7 }, /model must be a catalog model id/],
    [{ effort: 3 }, /node "n_plan": effort must be a string/], [{ fanOut: 'yes' }, /node "n_plan": fanOut must be true or false/],
    [{ askQuestions: 1 }, /askQuestions must be true or false/], [{ subagentModel: 'gpt' }, /node "n_plan": unknown sub-agent model "gpt"/],
    [{ subagentModel: { toString: 0 } }, /node "n_plan": subagentModel must be a string/],
  ]) assert.match(parseRunOverlay({ nodes: { n_plan: sel } }).error, re, JSON.stringify(sel));
  const many = Object.fromEntries(Array.from({ length: OVERLAY_MAX_NODES + 1 }, (_, i) => [`n${i}`, {}]));
  assert.equal(parseRunOverlay({ nodes: many }).error, `overlay.nodes names more than ${OVERLAY_MAX_NODES} nodes`);
  assert.deepEqual(parseOverlayNodes({ n_plan: { model: 'x', reason: 'r' } }, { what: 'nodes', keys: ['model', 'effort', 'subagentModel', 'reason'] }),
    { nodes: { n_plan: { model: 'x', reason: 'r' } } }, 'propose_run takes a reason');
  assert.deepEqual(parseOverlayNodes(null), { nodes: null });
});

test('checkRunOverlay: agent node ids only; checkShapeModels on the catalog; the engine must run the model; canonical output', () => {
  const ok = checkRunOverlay({ n_plan: { model: 'CLAUDE-OPUS-5-5', effort: 'high' }, n_impl: { model: 'claude-haiku-4-5', fanOut: false } }, { workflow: WF, models: MODELS, engine: 'claude' });
  assert.deepEqual(ok, { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' }, n_impl: { model: 'claude-haiku-4-5', fanOut: false, effort: '' } }, wires: {}, errors: [] },
    'the catalog\'s casing; a model always names its effort (\'\' = its default)');
  const bad = checkRunOverlay({ n_ghost: { model: 'claude-opus-5-5' }, n_task: {}, n_plan: { model: 'gone' }, n_impl: { model: 'claude-haiku-4-5', effort: 'max' } }, { workflow: WF, models: MODELS });
  assert.deepEqual(bad.errors, [
    'node "n_ghost" is not an agent node of workflow wf_review',
    'node "n_task" is not an agent node of workflow wf_review',
    'node "n_plan": unknown model "gone"',
    'node "n_impl": model claude-haiku-4-5 has no effort "max"',
  ]);
  assert.deepEqual(checkRunOverlay({ n_plan: { effort: 'high' } }, { workflow: WF, models: MODELS }).errors, ['node "n_plan": an effort needs a model']);
  assert.deepEqual(checkRunOverlay({ n_plan: { model: 'gpt-5.5' } }, { workflow: WF, models: MODELS, engine: 'claude' }).errors,
    ['node "n_plan": gpt-5.5 runs on Codex, not on Claude — pick a model this run\'s engine runs']);
  assert.deepEqual(checkRunOverlay({ n_plan: { model: 'gpt-5.5', effort: 'low' } }, { workflow: WF, models: MODELS, engine: 'codex' }).errors, []);
  assert.deepEqual(checkRunOverlay({ n_plan: { model: 'claude-opus-5-5' } }, { workflow: WF, models: MODELS, requireModel: true }).errors,
    ['node "n_impl": needs a model — this install has no default model (Claude Code is not signed in)']);
  assert.deepEqual(checkRunOverlay({ n_plan: { model: 'claude-opus-5-5', effort: '' } }, { workflow: WF, models: MODELS }).errors, [], 'a canonical entry checks clean again');
  const proto = parseRunOverlay(JSON.parse('{"nodes":{"__proto__":{"model":"claude-opus-5-5"}}}'));
  assert.deepEqual(checkRunOverlay(proto.overlay.nodes, { workflow: WF, models: MODELS }).errors, ['node "__proto__" is not an agent node of workflow wf_review']);
  assert.deepEqual(checkRunOverlay(null, {}), { nodes: {}, wires: {}, errors: [] });
});

test('overlayWorkflowRefusal: Auto decides at start, the workspace scan pins its own models', () => {
  assert.equal(overlayWorkflowRefusal({ id: 'wf_auto', name: 'Auto', version: 2, auto: true }), OVERLAY_ERRORS.auto);
  assert.equal(overlayWorkflowRefusal(WF, { scan: true }), OVERLAY_ERRORS.scan);
  assert.equal(overlayWorkflowRefusal(WF), null);
});

test('an entry with more keys than an overlay entry can name is one short error (the 64-node bound covers keys too)', () => {
  const sel = {}; for (let i = 0; i < 10000; i++) sel[`k${i}`] = 0;
  const r = parseRunOverlay({ nodes: { n_plan: sel } });
  assert.ok(r.error, 'refused');
  assert.ok(r.error.length < 300, `bounded: ${r.error.length} chars`);
  assert.match(r.error, /^overlay\.nodes\.n_plan takes only model, effort, fanOut, askQuestions, subagentModel$/);
  // every legal key, once — still fine; one unknown among a few keys keeps its precise message
  assert.equal(parseRunOverlay({ nodes: { n_plan: { model: 'm', effort: 'high', fanOut: true, askQuestions: false, subagentModel: 'auto' } } }).error, undefined);
  assert.match(parseRunOverlay({ nodes: { n_plan: { model: 'm', reason: 'x' } } }).error, /^overlay\.nodes\.n_plan: unknown key "reason"$/);
  // the proposal's own key set (reason allowed) bounds by ITS size
  const p = parseOverlayNodes({ n_plan: sel }, { what: 'nodes', keys: ['model', 'effort', 'subagentModel', 'reason'] });
  assert.match(p.error, /^nodes\.n_plan takes only model, effort, subagentModel, reason$/);
});

test('overlayStepModels: the overlay models the run\'s cells really run, as deviationsFor stepModels (the off-policy record)', () => {
  const cell = (id, key, model) => ({ id, kind: 'agent', key, model, effort: '' });
  const manifest = { graph: { nodes: [cell('n_plan', 'planner', 'claude-haiku-4-5'), cell('n_impl', 'implementer', 'claude-opus-5-5'),
    cell('n_rev', 'reviewer', 'claude-opus-5-5'), { id: 'n_end', kind: 'end' }] },
  runOverlay: { nodes: { n_plan: { model: 'CLAUDE-HAIKU-4-5', effort: '' }, n_impl: { model: 'gpt-5.5', effort: '' }, n_rev: { fanOut: true } } } };
  assert.deepEqual(overlayStepModels(manifest), [{ role: 'planner', model: 'claude-haiku-4-5' }],
    'a pick the resolver dropped (another engine: the cell ran something else) and a fan-out-only entry record nothing');
  for (const m of [null, {}, { graph: { nodes: [] } }, { runOverlay: { nodes: null }, graph: manifest.graph }, { runOverlay: {}, graph: manifest.graph }]) {
    assert.deepEqual(overlayStepModels(m), []);
  }
});

test('an effort or sub-agent value no model could name is refused with a short error (never echoed whole, at any length)', () => {
  const BIG = 'e'.repeat(100_000);
  for (const entry of [{ model: 'claude-opus-5-5', effort: BIG }, { model: 'claude-opus-5-5', subagentModel: BIG }]) {
    const r = parseRunOverlay({ nodes: { n_plan: entry } });
    assert.ok(r.error && r.error.length < 200, `the run API's error is ${r.error && r.error.length} chars`);
    const p = parseOverlayNodes({ n_plan: { ...entry, reason: 'x' } }, { what: 'nodes', keys: ['model', 'effort', 'subagentModel', 'reason'] });
    assert.ok(p.errors && p.errors.join('; ').length < 200, 'propose_run\'s errors are short too');
  }
  assert.match(parseRunOverlay({ nodes: { n_plan: { model: 'claude-opus-5-5', effort: BIG } } }).error, /^node "n_plan": effort must be a string naming one of the model's efforts$/);
  assert.match(parseRunOverlay({ nodes: { n_plan: { model: 'claude-opus-5-5', subagentModel: `inherit${BIG}` } } }).error, /^node "n_plan": unknown sub-agent model "inherite{57}…"$/);
  assert.deepEqual(parseRunOverlay({ nodes: { n_plan: { model: 'claude-opus-5-5', effort: ' xhigh ', subagentModel: 'inherit' } } }).overlay,
    { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'xhigh', subagentModel: 'inherit' } } }, 'the vocabulary still parses');
});

test('parseRunOverlay: wires carry a whole maxCycles of 1..100; other top-level keys are refused', () => {
  assert.deepEqual(parseRunOverlay({ wires: { w9: { maxCycles: 3 } } }), { overlay: { wires: { w9: { maxCycles: 3 } } } });
  assert.match(parseRunOverlay({ wires: { w9: { maxCycles: 0 } } }).error, /overlay\.wires\.w9: maxCycles must be a whole number from 1 to 100/);
  assert.match(parseRunOverlay({ wires: { w9: { maxCycles: 2, gate: 'x' } } }).error, /overlay\.wires\.w9: unknown key "gate"/);
  assert.match(parseRunOverlay({ nodes: {}, foo: {} }).error, /^overlay takes nodes and wires only/);
});

test('checkRunOverlay: a wire must be a wire of the workflow', () => {
  const workflow = { id: 'wf_x', nodes: [{ id: 'n_plan', kind: 'agent', key: 'planner' }], wires: [{ id: 'w9' }] };
  const ok = checkRunOverlay(null, { workflow, wires: { w9: { maxCycles: 2 } } });
  assert.deepEqual([ok.errors, ok.wires], [[], { w9: { maxCycles: 2 } }]);
  const bad = checkRunOverlay(null, { workflow, wires: { w_gone: { maxCycles: 2 } } });
  assert.deepEqual(bad.errors, ['wire "w_gone" is not a wire of workflow wf_x']);
});
