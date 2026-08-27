// test/ui-graph-view.test.mjs — jsdom unit tests for the v2 graph renderer.
// jsdom 29 has NO layout (getBoundingClientRect is all-zeros), no ResizeObserver
// and no pointer capture, so the view takes injectable `raf` and `viewport`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, fixture, loopFixture, portsFn, AGENTS } from './helpers/graph-view-fixture.mjs';

const viewPath = new URL('../ui/public/graph/view.mjs', import.meta.url).href;

test('createGraphView builds stage/world/wire-layer and one card per node', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const stage = host.querySelector('.gv-stage');
  assert.ok(stage, 'stage exists');
  assert.equal(stage.getAttribute('tabindex'), '0');
  assert.ok(stage.classList.contains('gv-edit'));
  assert.equal(host.firstElementChild, stage, 'stage is prepended, host chrome survives');
  const world = stage.querySelector('.gv-world');
  assert.ok(world.querySelector('svg.gv-wires'));
  assert.equal(world.querySelectorAll('.node').length, 3);
});

test('cards carry transform + explicit px height from nodeSize', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const agent = view.nodeEl('n_agent');
  assert.equal(agent.style.transform, 'translate(400px, 80px)');
  assert.equal(agent.style.height, '191.5px');           // 95.5 + 24*(2+2)
  assert.equal(view.nodeEl('n_task').style.height, '110.5px');
  assert.equal(view.nodeEl('n_end').style.height, '110.5px');
  assert.equal(agent.dataset.nodeId, 'n_agent');
  assert.equal(agent.getAttribute('tabindex'), '0');
  // zones: 2 inputs, sep, 2 outputs, sep, await  => 5 rows, 2 separators
  assert.equal(agent.querySelectorAll('.nbody > .prow').length, 5);
  assert.equal(agent.querySelectorAll('.nbody > .psep').length, 2);
  assert.equal(agent.querySelector('.prow.gate').dataset.port, 'await');
  // conditional output renders a diamond + "on blocking", never a type dot
  const review = [...agent.querySelectorAll('.prow.out')].find((r) => r.dataset.port === 'review');
  assert.ok(review.querySelector('i.dia'));
  assert.equal(review.querySelector('.pt').textContent, 'on blocking');
});

test('wires paint exact bezier d strings; ghost is the LAST child of the layer', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  view.render(fixture(), {});
  // w1: n_task.task (280,199) -> n_agent.task (400,136); dx = clamp(48,160,0.45*120) = 54
  assert.equal(view.wireEl('w1').getAttribute('d'), 'M 280 199 C 334 199, 346 136, 400 136');
  // w2: n_agent.plan (620,193) -> n_end.result (760,199); dx = 0.45*140 = 63
  assert.equal(view.wireEl('w2').getAttribute('d'), 'M 620 193 C 683 193, 697 199, 760 199');
  const layer = host.querySelector('svg.gv-wires');
  assert.equal(layer.lastElementChild.getAttribute('class'), 'wire ghost');
  assert.equal(layer.querySelectorAll('path[data-wire-id]').length, 2);
});

test('loop wires bow below and carry a ≤N badge at the cubic midpoint', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  view.render(loopFixture(), {});
  const d = view.wireEl('w4').getAttribute('d');
  assert.ok(view.wireEl('w4').getAttribute('class').includes('loop'), 'classified as a loop wire');
  // a = n_rev.review (620,537), b = n_agent.fix (400,160); bow = 56 + 0.2*377 = 131.4
  assert.equal(d, 'M 620 537 C 719 668.4, 301 291.4, 400 160');
  const badge = host.querySelector('.wbadge[data-wire-id="w4"]');
  assert.equal(badge.textContent, '≤2');
});

test('re-render does NOT rebuild rows whose port signature is unchanged', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  const tpl = fixture();
  view.render(tpl, {});
  const rowsBefore = [...view.nodeEl('n_agent').querySelectorAll('.nbody > *')];
  tpl.nodes[1].x = 480;                       // a pure move must not touch the body
  view.render(tpl, {});
  const rowsAfter = [...view.nodeEl('n_agent').querySelectorAll('.nbody > *')];
  assert.equal(rowsAfter.length, rowsBefore.length);
  for (let i = 0; i < rowsAfter.length; i += 1) {
    assert.equal(rowsAfter[i], rowsBefore[i], `row ${i} is the SAME element (identity), not a rebuild`);
  }
  assert.equal(view.nodeEl('n_agent').style.transform, 'translate(480px, 80px)');
  // changing the signature (arity) DOES rebuild
  tpl.nodes.push({ id: 'n_and', kind: 'and', x: 900, y: 400, config: { arity: 2 } });
  view.render(tpl, {});
  const andRows = [...view.nodeEl('n_and').querySelectorAll('.nbody > .prow')];
  tpl.nodes[3].config.arity = 3;
  view.render(tpl, {});
  const andRows2 = [...view.nodeEl('n_and').querySelectorAll('.nbody > .prow')];
  assert.equal(andRows.length, 3);            // in1, in2, out
  assert.equal(andRows2.length, 4);           // in1, in2, in3, out
  assert.notEqual(andRows2[0], andRows[0], 'signature change rebuilds the body');
});
