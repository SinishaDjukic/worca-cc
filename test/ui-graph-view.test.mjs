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

test('moveNode repaints ONLY the incident wires; setGhost writes d once', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  const tpl = fixture();
  view.render(tpl, {});
  const w2Before = view.wireEl('w2').getAttribute('d');
  const n0 = view.stats.wireDUpdates;
  tpl.nodes[0].x = 71;                                   // n_task: incident = w1 only
  view.moveNode('n_task');
  assert.equal(view.stats.wireDUpdates - n0, 1, 'exactly one wire repainted');
  assert.equal(view.wireEl('w2').getAttribute('d'), w2Before, 'w2 untouched');
  assert.equal(view.nodeEl('n_task').style.transform, 'translate(71px, 143px)');
  const g0 = view.stats.ghostUpdates;
  view.setGhost('M 0 0 C 1 1, 2 2, 3 3', 'legal');
  view.setGhost('M 0 0 C 1 1, 2 2, 3 3', 'legal');       // identical d => no second write
  assert.equal(view.stats.ghostUpdates - g0, 1);
  assert.equal(view.ghostEl.getAttribute('class'), 'wire ghost on legal');
  view.setGhost(null);
  assert.equal(view.ghostEl.getAttribute('class'), 'wire ghost');
});

test('setNodeChrome paints --c, the gate pip and the header totals; nulls clear them', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const card = view.nodeEl('n_agent');
  view.setNodeChrome('n_agent', { color: 'violet', gate: { wireId: 'w1', title: 'waiting on a loop gate' }, totals: { dur: '2m 10s', cost: '$0.42' } });
  assert.equal(card.style.getPropertyValue('--c'), 'var(--violet)');
  assert.equal(card.querySelector(':scope > .ngate').dataset.wireId, 'w1');
  assert.equal(card.querySelector(':scope > .nrun .dur').textContent, '2m 10s');
  assert.equal(card.querySelector(':scope > .nrun .cost').textContent, '$0.42');
  assert.ok(card.classList.contains('run-node') && card.dataset.id === 'n_agent', 'the 1s tick hook selects .run-node[data-id] .dur');
  view.setNodeChrome('n_agent', { color: '', gate: null, totals: null });
  assert.equal(card.querySelector(':scope > .ngate'), null);
  assert.equal(card.querySelector(':scope > .nrun'), null);
});

test('setWireBadge writes an amber cycle badge on a loop wire and clears it', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  // loopFixture(), NOT fixture(): a badge HOST only exists for a wire whose
  // config.maxCycles is an integer (renderWires), and only w4 has one. On the
  // plain fixture every assertion below dereferences null.
  view.render(loopFixture(), {});
  view.setWireBadge('w4', { text: '2x', title: '2 of 3 cycles' });
  const badge = host.querySelector('.wbadge[data-wire-id="w4"] .wfired');
  assert.equal(badge.textContent, '2x');
  assert.equal(badge.title, '2 of 3 cycles');
  view.setWireBadge('w4', null);
  assert.equal(host.querySelector('.wfired'), null);
  view.setWireBadge('w1', { text: '1x' });                // a plain wire has no badge host: no-op
  assert.equal(host.querySelector('.wfired'), null);
});

test('setStatus / setWireLive / setFooter are classList + height only', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const card = view.nodeEl('n_agent');
  const rows = [...card.querySelectorAll('.nbody > *')];
  view.setStatus('n_agent', 'active');
  assert.ok(card.classList.contains('is-active'));
  view.setStatus('n_agent', 'done');
  assert.ok(card.classList.contains('is-done') && !card.classList.contains('is-active'));
  assert.equal(card.dataset.status, 'done');
  view.setWireLive(['w1']);
  assert.ok(view.wireEl('w1').classList.contains('wire-live'));
  assert.ok(!view.wireEl('w2').classList.contains('wire-live'));
  view.setWireLive([]);
  assert.ok(!view.wireEl('w1').classList.contains('wire-live'));
  assert.equal(card.style.height, '191.5px');
  view.setFooter('n_agent', [{ kind: 'strip', leds: ['done'], summary: '1 run · $0.10', expanded: false }]);   // collapsed strip: +26
  assert.equal(card.style.height, '217.5px');
  assert.equal(card.querySelectorAll(':scope > .xfoot .xtoggle').length, 1);
  assert.equal(card.querySelector(':scope > .xfoot .xsum').textContent, '1 run · $0.10');
  view.setFooter('n_agent', [                            // +26 + 2*22
    { kind: 'strip', leds: ['done', 'active'], summary: '2 runs · $1.12', expanded: true },
    { kind: 'exec', executionId: 'x:n_agent:1', led: 'done', label: 'cycle 1', right: '1m 3s · $0.12' },
    { kind: 'exec', executionId: 'x:n_agent:2', led: 'active', label: 'cycle 2 · fix', right: '4s' },
  ]);
  assert.equal(card.style.height, '261.5px');
  assert.deepEqual([...card.querySelectorAll(':scope > .xfoot .xrow')].map((r) => r.dataset.executionId), ['x:n_agent:1', 'x:n_agent:2']);
  assert.equal(card.querySelectorAll(':scope > .xfoot .xrow')[1].className, 'xrow is-active');
  view.setFooter('n_agent', []);
  assert.equal(card.style.height, '191.5px');
  assert.equal(card.querySelector(':scope > .xfoot'), null, 'clearing removes the footer');
  assert.deepEqual([...card.querySelectorAll('.nbody > *')], rows, 'no row was rebuilt');
  // anchors are top-relative: the footer never re-routes a wire (D8)
  assert.equal(view.wireEl('w2').getAttribute('d'), 'M 620 193 C 683 193, 697 199, 760 199');
});

test('centerOn puts the node box centre at the viewport centre', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, {
    doc, portsFn, agents: AGENTS, viewport: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
  });
  view.render(fixture(), {});
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.centerOn('n_agent');                              // box (400,80,220,191.5), centre (510, 175.75)
  const T = view.getTransform();
  assert.equal(T.x, 500 - 510);
  assert.equal(T.y, 300 - 175.75);
});

const VP = { left: 0, top: 0, width: 1280, height: 560 };

test('fit centres model bounds and never magnifies past 1x', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
  view.render(fixture(), {});
  view.fit({ insetRight: 0, pad: 60 });
  const T = view.getTransform();
  // boxes span x 60..980, y 80..271.5 => padded bounds (0, 20, 1040, 311.5)
  assert.equal(T.z, 1, 'fit caps at 1x');
  assert.equal(T.x, 120);
  assert.equal(T.y, 104.25);
  view.fit({ insetRight: 280, pad: 60 });               // inspector expanded band
  assert.ok(Math.abs(view.getTransform().z - 1000 / 1040) < 1e-12);
});

test('static mode binds NO listeners and fitToWidth uses the host width', async () => {
  const { doc, host, win } = boot();
  const { createGraphView } = await import(viewPath);
  let bound = 0;
  const realAdd = win.HTMLElement.prototype.addEventListener;
  win.HTMLElement.prototype.addEventListener = function (...a) { bound += 1; return realAdd.apply(this, a); };
  const view = createGraphView(host, { doc, mode: 'static', portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
  view.render(fixture(), {});
  const nav = view.createNav();                          // refused in static mode
  win.HTMLElement.prototype.addEventListener = realAdd;
  assert.equal(bound, 0, 'static mode installs zero element listeners, even via createNav');
  assert.equal(typeof nav.destroy, 'function');
  assert.ok(view.stage.classList.contains('gv-static'));
  view.fitToWidth(520);                                  // 520/1040 = 0.5 >= zoomMin 0.3
  assert.equal(view.getTransform().z, 0.5);
});

test('monitor nav: wheelPan "engaged" ignores a plain wheel until engaged', async () => {
  const { doc, host, win } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
  view.render(fixture(), {});
  const nav = view.createNav({ wheelPan: 'engaged' });
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.stage.dispatchEvent(new win.WheelEvent('wheel', { deltaX: 40, deltaY: -25, bubbles: true, cancelable: true }));
  assert.deepEqual(view.getTransform(), { x: 0, y: 0, z: 1 }, 'not engaged => page scrolls, graph does not pan');
  // ctrl+wheel is captured even when not engaged
  view.stage.dispatchEvent(new win.WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 600, clientY: 300, bubbles: true, cancelable: true }));
  assert.ok(view.getTransform().z > 1);
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.stage.dispatchEvent(new win.PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true }));
  view.stage.dispatchEvent(new win.WheelEvent('wheel', { deltaX: 40, deltaY: -25, bubbles: true, cancelable: true }));
  assert.deepEqual(view.getTransform(), { x: -40, y: 25, z: 1 }, 'engaged => plain wheel pans by exactly -delta');
  nav.destroy();
  view.stage.dispatchEvent(new win.WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true, cancelable: true }));
  assert.equal(view.getTransform().x, -40, 'no listener after destroy');
});

test('thumbnailFor guards empty templates and returns svg markup otherwise', async () => {
  const { createGraphView, thumbnailFor } = await import(viewPath);
  assert.equal(typeof createGraphView, 'function');
  assert.equal(thumbnailFor(null, portsFn, { width: 240, height: 90 }), '');
  assert.equal(thumbnailFor({ nodes: [], wires: [] }, portsFn, { width: 240, height: 90 }), '');
  const svg = thumbnailFor(fixture(), portsFn, { width: 240, height: 90 });
  assert.match(svg, /^<svg[\s>]/);
  assert.ok(!svg.includes('NaN'), 'no NaN in the path data');
});

test('mountStaticGraph renders, fits to width and survives a missing ResizeObserver', async () => {
  const { doc, host, win } = boot();
  assert.equal(typeof win.ResizeObserver, 'undefined', 'jsdom 29 has no ResizeObserver');
  const { mountStaticGraph } = await import(viewPath);
  const view = mountStaticGraph(host, fixture(), {
    doc, portsFn, agents: AGENTS, width: 520, viewport: () => ({ left: 0, top: 0, width: 520, height: 300 }),
  });
  assert.equal(view.mode, 'static');
  assert.equal(view.getTransform().z, 0.5);
  assert.equal(host.querySelectorAll('.node').length, 3);
});

// Replaces the origin-trust half of the retired test/ui-agent-xss.test.mjs
// (Task 8 deletes it with the rest of the v1 composer suite): a USER agent's
// meta is writable through POST /api/agents, so its icon must never reach
// innerHTML. Keep this test — it is the only guard left on that path.
test('safeAgentIcon refuses a user agent\'s icon markup and keeps builtin glyphs', async () => {
  const { doc, host } = boot();
  const { createGraphView, safeAgentIcon, USER_AGENT_ICON } = await import(viewPath);
  assert.equal(safeAgentIcon({ origin: 'builtin', icon: '<path d="M4 4h8"/>' }), '<path d="M4 4h8"/>');
  assert.equal(safeAgentIcon({ origin: 'user', icon: '<img src=x onerror=alert(1)>' }), USER_AGENT_ICON);
  assert.equal(safeAgentIcon(null), '');
  const evil = { key: 'evil', displayName: '<img src=x onerror=alert(1)>', color: 'red', origin: 'user', icon: '<script>alert(1)<\/script>' };
  const view = createGraphView(host, { doc, portsFn, agents: { planner: evil } });
  view.render(fixture(), {});
  const head = view.nodeEl('n_agent').querySelector('.nhead');
  assert.equal(head.querySelector('script'), null, 'no script node reached the DOM');
  assert.equal(head.querySelector('img'), null, 'no img node reached the DOM');
  assert.equal(head.querySelector('.tt').textContent, evil.displayName, 'the display name is TEXT, never markup');
});

test('destroy() removes the stage and leaves no listener that can mutate anything', async () => {
  const { doc, host, win } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
  view.render(fixture(), {});
  view.createNav({ wheelPan: 'always' });
  const stage = view.stage;
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.destroy();
  assert.equal(host.querySelector('.gv-stage'), null, 'stage removed');
  stage.dispatchEvent(new win.WheelEvent('wheel', { deltaX: 40, bubbles: true, cancelable: true }));
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual(view.getTransform(), { x: 0, y: 0, z: 1 }, 'no listener survived destroy()');
});
