// test/ui-graph-view.test.mjs
// The shared graph RENDERER (composer editable / run live / static preview).
// Everything here is model-driven: graph-view reads node x/y and the ports
// function and derives every anchor from graph-geometry, so the render path
// touches NO layout API. That is what makes it jsdom-testable at all — jsdom
// has no layout, and getBoundingClientRect() would answer zeros. The suite
// pins that contract explicitly (see "render path never measures").
//
// Card anatomy per spec §6 as amended by f: inputs zone, 9px separator, outputs
// zone, a SECOND 9px separator, then the synthesized `await` gate row on agent
// cards only. Task/End/OR additionally render a 24px caption row LAST.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { portsFnFor } from '../ui/public/graph/graph-model.mjs';
import { EMBEDDED_AGENTS, mergePalette } from '../ui/public/graph/agents-meta.mjs';
import { portAnchor, bezierPath, nodeSize } from '../ui/public/graph/graph-geometry.mjs';
import { createGraphView, USER_AGENT_ICON } from '../ui/public/graph/graph-view.mjs';

const ports = portsFnFor(EMBEDDED_AGENTS);
const agentsByKey = Object.fromEntries(mergePalette(null).map((a) => [a.key, a]));

function dom() {
  const d = new JSDOM('<!doctype html><body><div id="host"></div></body>');
  return { doc: d.window.document, window: d.window };
}

/** task -> planner -> implementer -> reviewer, an or valve, an and card, end. */
function template() {
  return {
    id: 'wf_v', name: 'V', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 40, y: 190, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 340, y: 150, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 640, y: 150, config: {} },
      { id: 'n_review', kind: 'agent', key: 'reviewer', x: 940, y: 150, config: {} },
      { id: 'n_or', kind: 'or', x: 640, y: 520, config: { arity: 2 } },
      { id: 'n_and', kind: 'and', x: 940, y: 520, config: { arity: 2 } },
      { id: 'n_end', kind: 'end', x: 1240, y: 150, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
      { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
      { id: 'w5', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
      { id: 'w6', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or', port: 'in2' } },
      { id: 'w7', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
      { id: 'w8', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
      { id: 'w9', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_and', port: 'in1' } },
      { id: 'w10', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_and', port: 'in2' } },
      { id: 'w11', from: { node: 'n_and', port: 'out' }, to: { node: 'n_impl', port: 'await' } },
    ],
  };
}

function mount(tpl = template(), opts = {}) {
  const { doc, window } = dom();
  const host = doc.getElementById('host');
  const view = createGraphView(host, { doc, portsFn: ports, agents: agentsByKey, ...opts });
  view.render(tpl);
  return { doc, window, host, view };
}

const card = (host, id) => host.querySelector(`.node[data-node-id="${id}"]`);
const rows = (el) => [...el.querySelectorAll('.nbody > .prow, .nbody > .psep')];
const rowKinds = (el) => rows(el).map((r) => (r.classList.contains('psep') ? 'sep' : (r.dataset.port || 'cap')));

// --------------------------------------------------------------- structure

test('one card per node, positioned from the model x/y alone', () => {
  const { host } = mount();
  assert.equal(host.querySelectorAll('.node').length, 7);
  const plan = card(host, 'n_plan');
  assert.equal(plan.style.left, '340px');
  assert.equal(plan.style.top, '150px');
  assert.equal(plan.style.width, '220px');
  // Height is the geometry module's, never measured.
  const { h } = nodeSize(ports({ id: 'n_plan', kind: 'agent', key: 'planner' }), { caption: false });
  assert.equal(plan.style.height, `${h}px`);
});

test('every node and wire lives inside ONE transformed world element', () => {
  const { host, view } = mount();
  const world = host.querySelector('.gv-world');
  assert.ok(world, 'world element exists');
  assert.equal(host.querySelectorAll('.gv-world').length, 1);
  for (const n of host.querySelectorAll('.node')) assert.equal(n.parentElement, world);
  assert.equal(host.querySelector('svg.gv-wires').parentElement, world);
  view.setTransform({ x: 12, y: -8, zoom: 1.25 });
  assert.equal(world.style.transform, 'translate(12px, -8px) scale(1.25)');
  // Nothing else carries a transform — pan/zoom is the world's job alone.
  const others = [...host.querySelectorAll('*')].filter((e) => e !== world && e.style && e.style.transform);
  assert.deepEqual(others, []);
});

test('render path never measures — zero getBoundingClientRect', () => {
  const { doc, window } = dom();
  let calls = 0;
  window.Element.prototype.getBoundingClientRect = function () {
    calls += 1;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
  const view = createGraphView(doc.getElementById('host'), { doc, portsFn: ports, agents: agentsByKey });
  view.render(template());
  view.setTransform({ x: 4, y: 4, zoom: 0.5 });
  view.render(template());
  assert.equal(calls, 0, 'graph-view derives every anchor from the model');
});

// ------------------------------------------------------------ card anatomy

test('an agent card stacks inputs, separator, outputs, separator, then the await gate row', () => {
  const { host } = mount();
  // planner: task, answers, revise in; plan out; await last.
  assert.deepEqual(rowKinds(card(host, 'n_plan')),
    ['task', 'answers', 'revise', 'sep', 'plan', 'sep', 'await']);
  // reviewer: two conditional outputs.
  assert.deepEqual(rowKinds(card(host, 'n_review')),
    ['plan', 'done', 'sep', 'review', 'pass', 'sep', 'await']);
});

test('the await row is a left-edge dashed gate, subdued until a wire lands on it', () => {
  const { host } = mount();
  const unwired = card(host, 'n_plan').querySelector('.prow[data-port="await"]');
  assert.ok(unwired.classList.contains('gate'), 'gate row');
  assert.ok(unwired.classList.contains('in'), 'the gate is an INPUT row');
  assert.ok(unwired.classList.contains('off'), 'subdued while unwired');
  assert.ok(unwired.querySelector('i.gdot'), 'dashed-ring dot, not a type dot');
  assert.equal(unwired.querySelector('.pt').textContent, 'any');
  // w11 lands on n_impl.await.
  const wired = card(host, 'n_impl').querySelector('.prow[data-port="await"]');
  assert.equal(wired.classList.contains('off'), false, 'wired gate is no longer subdued');
});

test('flow cards carry no await row and use the dark-ink system header', () => {
  const { host } = mount();
  for (const id of ['n_task', 'n_end', 'n_and', 'n_or']) {
    const el = card(host, id);
    assert.equal(el.querySelector('.prow[data-port="await"]'), null, `${id} has no await row`);
    assert.ok(el.querySelector('.nhead').classList.contains('h-flow'), `${id} header is flow ink`);
  }
  // ...and agent cards are tinted by meta.color, never h-flow.
  const head = card(host, 'n_plan').querySelector('.nhead');
  assert.ok(head.classList.contains('h-violet'), 'planner is violet');
  assert.equal(head.classList.contains('h-flow'), false);
});

test('Task renders its single output FIRST, then the caption row', () => {
  const { host } = mount();
  const el = card(host, 'n_task');
  assert.deepEqual(rowKinds(el), ['task', 'sep', 'cap']);
  assert.equal(el.querySelector('.prow.cap .pt').textContent, 'prompt + attached files');
  assert.ok(el.querySelector('.prow[data-port="task"]').classList.contains('out'));
  const { h } = nodeSize(ports({ id: 'n_task', kind: 'task' }), { caption: true });
  assert.equal(h, 110.5);
  assert.equal(el.style.height, '110.5px');
});

test('End is a pinned sink: one any input, a caption, no outputs', () => {
  const { host } = mount();
  const el = card(host, 'n_end');
  assert.deepEqual(rowKinds(el), ['result', 'sep', 'cap']);
  assert.equal(el.querySelector('.prow.cap .pt').textContent, 'pipeline result');
  assert.equal(el.querySelector('.prow.out'), null, 'zero outputs');
  assert.ok(el.querySelector('.prow[data-port="result"] i.dot.any'), 'any dot');
  assert.ok(el.classList.contains('pinned'), 'End is pinned like Task');
  assert.ok(card(host, 'n_task').classList.contains('pinned'));
});

test('OR captions its resolved output type; AND is statically void and captionless', () => {
  const { host } = mount();
  const or = card(host, 'n_or');
  // in1 <- reviewer.review (md), in2 <- planner.plan (md) => resolves md.
  assert.deepEqual(rowKinds(or), ['in1', 'in2', 'sep', 'out', 'sep', 'cap']);
  assert.equal(or.querySelector('.prow[data-port="out"] .pt').textContent, 'md');
  assert.ok(or.querySelector('.prow[data-port="out"] i.dot.md'), 'resolved md dot');
  assert.equal(or.querySelector('.prow.cap .pt').textContent, 'forwards freshest input');
  assert.equal(or.querySelector('.prow[data-port="in1"] .pt').textContent, 'any');

  const and = card(host, 'n_and');
  assert.deepEqual(rowKinds(and), ['in1', 'in2', 'sep', 'out']);
  assert.equal(and.querySelector('.prow[data-port="out"] .pt').textContent, 'void');
  assert.equal(and.querySelector('.prow.cap'), null, 'AND carries no caption');
});

test('an unresolvable OR renders its out as any', () => {
  const tpl = template();
  tpl.wires = tpl.wires.filter((w) => w.to.node !== 'n_or');
  const { host } = mount(tpl);
  const or = card(host, 'n_or');
  assert.equal(or.querySelector('.prow[data-port="out"] .pt').textContent, 'any');
  assert.ok(or.querySelector('.prow[data-port="out"] i.dot.any'));
});

test('dots are typed, conditional outputs are amber diamonds with their when caption', () => {
  const { host } = mount();
  const plan = card(host, 'n_plan');
  assert.ok(plan.querySelector('.prow[data-port="task"] i.dot.md'));
  assert.ok(plan.querySelector('.prow[data-port="answers"] i.dot.json'));
  const impl = card(host, 'n_impl');
  assert.ok(impl.querySelector('.prow[data-port="done"] i.dot.void'));
  const review = card(host, 'n_review');
  assert.ok(review.querySelector('.prow[data-port="review"] i.dia'), 'blocking output is a diamond');
  assert.equal(review.querySelector('.prow[data-port="review"] .pt').textContent, 'on blocking');
  assert.equal(review.querySelector('.prow[data-port="pass"] .pt').textContent, 'on clean');
});

test('loop inputs carry the amber loop chip; expands inputs carry the fan-out chip', () => {
  const { host } = mount();
  assert.equal(card(host, 'n_plan').querySelector('.prow[data-port="revise"] .chip.am').textContent, 'loop');
  assert.equal(card(host, 'n_impl').querySelector('.prow[data-port="fix"] .chip.am').textContent, 'loop');
  // Same glyph the NORMATIVE legend names: "⤫N = fan-out".
  assert.equal(card(host, 'n_impl').querySelector('.prow[data-port="task"] .chip.fan').textContent, '⤫N');
  assert.equal(card(host, 'n_plan').querySelector('.prow[data-port="task"] .chip'), null, 'plain inputs get no chip');
});

// ------------------------------------------------------------------ icons

test('builtin icons are injected raw; a user agent gets the fixed glyph instead', () => {
  const hostile = {
    ...EMBEDDED_AGENTS.planner,
    key: 'evil', displayName: '<img src=x onerror=alert(1)>', origin: 'user',
    icon: '<script>alert(1)</script>',
  };
  const tpl = {
    id: 'wf_x', name: 'X', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_evil', kind: 'agent', key: 'evil', x: 300, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
    ],
    wires: [],
  };
  const { doc } = dom();
  const view = createGraphView(doc.getElementById('host'), {
    doc, portsFn: portsFnFor({ ...EMBEDDED_AGENTS, evil: hostile }), agents: { evil: mergePalette([hostile])[0] },
  });
  view.render(tpl);
  const el = doc.querySelector('.node[data-node-id="n_evil"]');
  assert.equal(el.querySelector('script'), null, 'no script survives');
  assert.equal(el.querySelector('img'), null, 'the display name is text, never markup');
  assert.equal(el.querySelector('.nhead .tt').textContent, '<img src=x onerror=alert(1)>');
  assert.ok(el.querySelector('.nhead svg').innerHTML.includes(USER_AGENT_ICON.slice(0, 24)), 'fixed user glyph');
  // A builtin keeps its shipped icon markup.
  const { host } = mount();
  assert.ok(card(host, 'n_plan').querySelector('.nhead svg').innerHTML.length > 10);
});

// ------------------------------------------------------------------ wires

test('wires are single beziers whose endpoints ARE the geometry anchors', () => {
  const tpl = template();
  const { host } = mount(tpl);
  const svg = host.querySelector('svg.gv-wires');
  assert.equal(svg.querySelectorAll('path.wire').length, tpl.wires.length);
  const w2 = svg.querySelector('path.wire[data-wire-id="w2"]');
  const from = tpl.nodes.find((n) => n.id === 'n_plan');
  const to = tpl.nodes.find((n) => n.id === 'n_impl');
  const a = portAnchor(from, ports(from), 'plan', 'out');
  const b = portAnchor(to, ports(to), 'plan', 'in');
  assert.equal(w2.getAttribute('d'), bezierPath(a, b));
});

test('loop wires bow, go amber, and carry their maxCycles pill', () => {
  const { host } = mount();
  const loop = host.querySelector('path.wire[data-wire-id="w5"]');
  assert.ok(loop.classList.contains('loop'), 'w5 is the blocking-source loop wire');
  const plain = host.querySelector('path.wire[data-wire-id="w7"]');
  assert.equal(plain.classList.contains('loop'), false, 'or.out is always-sourced, never a loop wire');
  const badge = host.querySelector('.wbadge[data-wire-id="w5"]');
  assert.equal(badge.textContent, '≤3');
  assert.equal(host.querySelector('.wbadge[data-wire-id="w7"]'), null);
});

test('the await wire lands on the left-edge gate anchor', () => {
  const tpl = template();
  const { host } = mount(tpl);
  const impl = tpl.nodes.find((n) => n.id === 'n_impl');
  const anchor = portAnchor(impl, ports(impl), 'await', 'in');
  assert.equal(anchor.x, impl.x, 'left edge');
  const d = host.querySelector('path.wire[data-wire-id="w11"]').getAttribute('d');
  assert.ok(d.endsWith(`${anchor.x} ${anchor.y}`), `wire ends at the gate anchor (${d})`);
});

// -------------------------------------------------------------- zoom decor

test('port dots fade below 0.6 zoom', () => {
  const { host, view } = mount();
  const world = host.querySelector('.gv-world');
  view.setTransform({ x: 0, y: 0, zoom: 0.61 });
  assert.equal(world.classList.contains('dots-faded'), false);
  view.setTransform({ x: 0, y: 0, zoom: 0.59 });
  assert.ok(world.classList.contains('dots-faded'), 'dots fade under 0.6');
});

// ------------------------------------------------------------ repaint/decor

test('re-render is incremental: the same node element is reused and repositioned', () => {
  const tpl = template();
  const { host, view } = mount(tpl);
  const before = card(host, 'n_plan');
  tpl.nodes.find((n) => n.id === 'n_plan').x = 999;
  view.render(tpl);
  const after = card(host, 'n_plan');
  assert.equal(after, before, 'element identity survives a repaint');
  assert.equal(after.style.left, '999px');
});

test('a removed node and its wires disappear on the next render', () => {
  const tpl = template();
  const { host, view } = mount(tpl);
  tpl.nodes = tpl.nodes.filter((n) => n.id !== 'n_and');
  tpl.wires = tpl.wires.filter((w) => w.from.node !== 'n_and' && w.to.node !== 'n_and');
  view.render(tpl);
  assert.equal(card(host, 'n_and'), null);
  assert.equal(host.querySelector('path.wire[data-wire-id="w9"]'), null);
  assert.equal(host.querySelectorAll('.node').length, 6);
});

test('selection paints the outline class and nothing else', () => {
  const { host, view } = mount();
  view.render(template(), { selection: { kind: 'node', id: 'n_plan' } });
  assert.ok(card(host, 'n_plan').classList.contains('sel'));
  assert.equal(card(host, 'n_impl').classList.contains('sel'), false);
  view.render(template(), { selection: { kind: 'wire', id: 'w2' } });
  assert.equal(card(host, 'n_plan').classList.contains('sel'), false);
  assert.ok(host.querySelector('path.wire[data-wire-id="w2"]').classList.contains('sel'));
});

test('validation findings paint a red pip on the offending node and stroke its wire', () => {
  const { host, view } = mount();
  view.render(template(), {
    report: {
      errors: [
        { code: 'V9', msg: "required input 'n_impl.plan' is unwired", nodeId: 'n_impl' },
        { code: 'V8', msg: 'wire w2 type mismatch', wireId: 'w2' },
      ],
      warnings: [],
    },
  });
  const pip = card(host, 'n_impl').querySelector('.npip');
  assert.ok(pip, 'error pip rendered');
  assert.equal(pip.title, "required input 'n_impl.plan' is unwired");
  assert.ok(host.querySelector('path.wire[data-wire-id="w2"]').classList.contains('bad'));
  assert.equal(card(host, 'n_plan').querySelector('.npip'), null);
});
