// The shipped Promo video workflow (wf_promo_video) against the REAL agent sidecars and the REAL
// built-in script layer: a sidecar that drifts from the graph's wires breaks this file, not a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { portsOf } from '../src/shared/graph/ports.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';
import { checkRows } from './helpers/rows.mjs';
import {
  GRAPH_PROMO_VIDEO_WORKFLOW as G,
  PROMO_VIDEO_WORKFLOW_ID,
  promoVideoGraphFingerprint,
  PROMO_VIDEO_SHIPPED_FINGERPRINTS,
} from '../src/core/graph/promo-video-workflow.mjs';

const node = (id) => G.nodes.find((n) => n.id === id);
const wire = (id) => G.wires.find((w) => w.id === id);
const into = (nodeId, port) => G.wires.filter((w) => w.to.node === nodeId && w.to.port === port);

const AGENTS = ['promoSetup', 'promoVoice', 'promoExplorer', 'promoWriter', 'promoCapture', 'promoMascot', 'promoScenes', 'promoReview'];
const SCRIPTS = ['promoVoices', 'promoNarrate', 'promoRender'];

test('wf_promo_video validates against the REAL sidecars and scripts: 0 errors, 0 warnings', () => {
  const { ok, errors, warnings } = validateGraph(G, realPortsFn());
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 1));
  assert.equal(ok, true);
  // The review and render steps read the storyboard and timeline THROUGH THE FILE (promo/storyboard.md,
  // promo/timeline.json — written once, before the fix loop), not through wires: two always-sourced payload
  // wires into a card inside the loop are V18's double-fire hazard (the Presentation precedent, deckOutputs).
  assert.deepEqual(warnings, [], JSON.stringify(warnings, null, 1));
  const into = (node, port) => G.wires.filter((w) => w.to.node === node && w.to.port === port);
  assert.equal(into('n_review', 'storyboard').length, 0);
  assert.equal(into('n_review', 'timeline').length, 0);
  assert.equal(into('n_render', 'timeline').length, 0);
});

test('wf_promo_video: identity, the plan\'s node ids, every agent and script key placed once', () => {
  assert.equal(G.id, PROMO_VIDEO_WORKFLOW_ID);
  assert.equal(PROMO_VIDEO_WORKFLOW_ID, 'wf_promo_video');
  assert.equal(G.name, 'Promo video');
  assert.equal(G.domain, 'video');
  assert.equal(G.version, 2);
  assert.ok(Object.isFrozen(G) && Object.isFrozen(G.nodes[0].config), 'deep-frozen');
  assert.deepEqual(G.nodes.map((n) => n.id).sort(), ['n_capture', 'n_end', 'n_explore', 'n_mascot', 'n_narrate', 'n_or',
    'n_render', 'n_review', 'n_scenes', 'n_setup', 'n_task', 'n_voice', 'n_voices', 'n_write']);
  assert.deepEqual(G.nodes.filter((n) => n.kind === 'agent').map((n) => n.key).sort(), [...AGENTS].sort());
  assert.deepEqual(G.nodes.filter((n) => n.kind === 'script').map((n) => n.key).sort(), [...SCRIPTS].sort());
  assert.equal(G.nodes.filter((n) => n.kind === 'task').length, 1);
  assert.equal(G.nodes.filter((n) => n.kind === 'end').length, 1);
  // Every keyed node resolves to a ported sidecar of the right kind.
  const portsFn = realPortsFn();
  for (const n of G.nodes.filter((x) => x.key)) {
    const p = portsOf(portsFn, n);
    assert.ok(p.known && p.ported, `${n.id} (${n.kind} ${n.key}) resolves to a ported sidecar`);
  }
});

test('wf_promo_video: every required input is wired, and every wire lands on a declared port', () => {
  const portsFn = realPortsFn();
  const byId = new Map(G.nodes.map((n) => [n.id, n]));
  for (const n of G.nodes) {
    for (const inp of portsOf(portsFn, n).inputs) {
      if (!inp.required || inp.loop) continue;
      assert.equal(into(n.id, inp.id).length, 1, `required input ${n.id}.${inp.id} is wired exactly once`);
    }
  }
  for (const w of G.wires) {
    const from = portsOf(portsFn, byId.get(w.from.node)).outputs.find((p) => p.id === w.from.port);
    const to = portsOf(portsFn, byId.get(w.to.node)).inputs.find((p) => p.id === w.to.port);
    assert.ok(from, `${w.id}: ${w.from.node}.${w.from.port} is a declared output`);
    assert.ok(to, `${w.id}: ${w.to.node}.${w.to.port} is a declared input`);
  }
});

test('wf_promo_video: the fix loop closes on the or card into n_scenes.fixes, with cycle caps', () => {
  const { loopWireIds } = classifyLoops(G, realPortsFn());
  assert.deepEqual([...loopWireIds].sort(), ['w25', 'w30']);
  assert.deepEqual(wire('w25').from, { node: 'n_review', port: 'findings' });
  assert.deepEqual(wire('w25').to, { node: 'n_or', port: 'in1' });
  assert.equal(wire('w25').config.maxCycles, 2, 'review -> scenes');
  assert.deepEqual(wire('w30').from, { node: 'n_render', port: 'findings' });
  assert.deepEqual(wire('w30').to, { node: 'n_or', port: 'in2' });
  assert.equal(wire('w30').config.maxCycles, 1, 'render -> scenes: a render finding re-runs scenes + review');
  assert.deepEqual(into('n_scenes', 'fixes').map((w) => w.from), [{ node: 'n_or', port: 'out' }]);
});

test('wf_promo_video wiring invariants: gates, barriers, the render step and the self-skipping cards', async () => {
  await checkRows([
    { name: 'the render runs once per clean review and is the terminal step', run: () => {
      assert.deepEqual(wire('w27').from, { node: 'n_review', port: 'pass' });
      assert.deepEqual(wire('w27').to, { node: 'n_render', port: 'await' });
      assert.deepEqual(into('n_end', 'result').map((w) => w.from), [{ node: 'n_render', port: 'pass' }]);
      assert.deepEqual(into('n_render', 'film').map((w) => w.from), [{ node: 'n_scenes', port: 'film' }]);
    } },
    { name: 'the three human gates ask', run: () => {
      for (const id of ['n_setup', 'n_voice', 'n_write']) assert.equal(node(id).config.askQuestions, true, id);
    } },
    { name: 'the setup answers reach everything that reads them; the voice pick reaches the narrator', run: () => {
      const fromSetup = G.wires.filter((w) => w.from.node === 'n_setup').map((w) => `${w.to.node}.${w.to.port}`).sort();
      assert.deepEqual(fromSetup, ['n_explore.answers', 'n_mascot.answers', 'n_voices.answers', 'n_write.answers']);
      assert.deepEqual(into('n_voice', 'voices').map((w) => w.from), [{ node: 'n_voices', port: 'voices' }]);
      assert.deepEqual(into('n_narrate', 'answers').map((w) => w.from), [{ node: 'n_voice', port: 'answers' }]);
      assert.deepEqual(into('n_narrate', 'script').map((w) => w.from), [{ node: 'n_write', port: 'script' }]);
    } },
    { name: 'the multi-input steps wait for every input (awaitAll), the in-loop verifier does not', run: () => {
      for (const id of ['n_write', 'n_narrate', 'n_capture', 'n_mascot', 'n_scenes']) assert.equal(node(id).config.awaitAll, true, id);
      // An awaitAll verifier would wait for a fresh storyboard and timeline on every fix cycle — which
      // never come — and the run would stall after the first blocking review.
      assert.notEqual(node('n_review').config.awaitAll, true);
      assert.notEqual(node('n_render').config.awaitAll, true);
      assert.equal(node('n_scenes').config.fanOut, true);
    } },
    { name: 'the mascot card waits on the timeline (the film dir is initialised by the narrate step)', run: () => {
      assert.deepEqual(into('n_mascot', 'timeline').map((w) => w.from), [{ node: 'n_narrate', port: 'timeline' }]);
    } },
    { name: 'the task reaches the setup form, the explorer and the writer', run: () => {
      const taskConsumers = G.wires.filter((w) => w.from.node === 'n_task').map((w) => w.to.node).sort();
      assert.deepEqual(taskConsumers, ['n_explore', 'n_setup', 'n_write']);
    } },
    { name: 'geometry: one 280 px row, the optional cards on a second row', run: () => {
      const row = G.nodes.filter((n) => n.y === 200).sort((a, b) => a.x - b.x);
      assert.deepEqual(row.map((n) => n.id), ['n_task', 'n_setup', 'n_explore', 'n_write', 'n_narrate', 'n_capture',
        'n_scenes', 'n_review', 'n_render', 'n_end']);
      row.forEach((n, i) => assert.equal(n.x, 40 + 280 * i, `${n.id} sits on the 280 px pitch`));
      assert.deepEqual(G.nodes.filter((n) => n.y === 430).map((n) => n.id).sort(), ['n_mascot', 'n_or', 'n_voice', 'n_voices']);
    } },
  ]);
});

test('wf_promo_video fingerprint: stable, and the current shape is not listed as a prior one', () => {
  assert.equal(promoVideoGraphFingerprint(G),
    'n_capture,n_end,n_explore,n_mascot,n_narrate,n_or,n_render,n_review,n_scenes,n_setup,n_task,n_voice,n_voices,n_write'
    + '|w1,w10,w11,w12,w13,w14,w15,w16,w17,w18,w19,w2,w20,w21,w22,w25,w26,w27,w28,w3,w30,w31,w4,w5,w6,w7,w8,w9');
  // Geometry and config are not part of the shape.
  const moved = { nodes: G.nodes.map((n) => ({ ...n, x: n.x + 7, config: {} })), wires: G.wires };
  assert.equal(promoVideoGraphFingerprint(moved), promoVideoGraphFingerprint(G));
  assert.deepEqual([...PROMO_VIDEO_SHIPPED_FINGERPRINTS], [], 'first ship: no prior shapes');
  assert.ok(!PROMO_VIDEO_SHIPPED_FINGERPRINTS.includes(promoVideoGraphFingerprint(G)));
});
