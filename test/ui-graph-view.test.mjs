// test/ui-graph-view.test.mjs — jsdom unit tests for the v2 graph renderer.
// jsdom 29 has NO layout (getBoundingClientRect is all-zeros), no ResizeObserver
// and no pointer capture, so the view takes injectable `raf` and `viewport`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { boot, fixture, loopFixture, portsFn, AGENTS } from './helpers/graph-view-fixture.mjs';
import { nodeSize, portAnchor } from '../src/shared/graph/geometry.mjs';
import { portsOf } from '../src/shared/graph/ports.mjs';
import { FLOW_PAD_Y, flowPerRow } from '../src/shared/graph/flow-layout.mjs';
import { routeGraph } from '../src/shared/graph/lanes.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';

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

test('wires paint the router\'s orthogonal d strings; ghost is the LAST child of the layer', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  const tpl = fixture();
  view.render(tpl, {});
  // w1: n_task.task (292,172) -> n_agent.task (400,97); w2: n_agent.plan (632,…) -> n_end.result (760,160)
  for (const id of ['w1', 'w2']) {
    assert.equal(view.wireEl(id).getAttribute('d'), laneD(tpl, id, { describe: view.mode === 'edit' }));
    assertLaneRoute(view.wireRoute(id), id);
  }
  const layer = host.querySelector('svg.gv-wires');
  assert.equal(layer.lastElementChild.getAttribute('class'), 'wire ghost');
  assert.equal(layer.querySelectorAll('path[data-wire-id]').length, 2);
});

test('loop wires route as backward wires with a ≤N badge; setWireBadge writes and clears the amber cycle badge', async () => {
  await checkRows([
    { name: 'loop wires route as ordinary backward wires and carry a ≤N badge', run: async () => {
      const { doc, host } = boot();
      const { createGraphView } = await import(viewPath);
      const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
      const tpl = loopFixture();
      view.render(tpl, {});
      const d = view.wireEl('w4').getAttribute('d');
      assert.ok(view.wireEl('w4').getAttribute('class').includes('loop'), 'classified as a loop wire');
      // a = n_rev.review (632,…), b = n_agent.fix (400,…): a backward wire — out to the right, back
      // along a lane, into the input from its left.
      assert.equal(d, laneD(tpl, 'w4', { describe: view.mode === 'edit' }));
      const pts = assertLaneRoute(view.wireRoute('w4'), 'w4');
      assert.ok(pts.some((p) => p.x < pts.at(-1).x - 1) && pts.some((p) => p.x > pts[0].x + 1), 'it doubles back');
      const badge = host.querySelector('.wbadge[data-wire-id="w4"]');
      assert.equal(badge.querySelector('.wmax').textContent, '≤2');
    } },
    { name: 'setWireBadge writes an amber cycle badge on a loop wire and clears it', run: async () => {
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
    } },
  ]);
});

test('perf invariants: re-render keeps rows with unchanged port signatures; moveNode writes only changed wires; setGhost writes d once', async () => {
  await checkRows([
    { name: 're-render does NOT rebuild rows whose port signature is unchanged', run: async () => {
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
    } },
    { name: 'moveNode writes ONLY the wires whose route changed; setGhost writes d once', run: async () => {
      const { doc, host } = boot();
      const { createGraphView } = await import(viewPath);
      const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
      const tpl = fixture();
      view.render(tpl, {});
      const w2Before = view.wireEl('w2').getAttribute('d');
      const n0 = view.stats.wireDUpdates;
      tpl.nodes[0].x = 71;                                   // an 11px hop that blocks no other corridor
      view.moveNode('n_task');
      assert.equal(view.stats.wireDUpdates - n0, 1, 'only the one wire whose route moved wrote d');
      assert.equal(view.wireEl('w2').getAttribute('d'), w2Before, 'w2 untouched');
      assert.equal(view.nodeEl('n_task').style.transform, 'translate(71px, 143px)');
      const g0 = view.stats.ghostUpdates;
      view.setGhost('M 0 0 C 1 1, 2 2, 3 3', 'legal');
      view.setGhost('M 0 0 C 1 1, 2 2, 3 3', 'legal');       // identical d => no second write
      assert.equal(view.stats.ghostUpdates - g0, 1);
      assert.equal(view.ghostEl.getAttribute('class'), 'wire ghost on legal');
      view.setGhost(null);
      assert.equal(view.ghostEl.getAttribute('class'), 'wire ghost');
    } },
  ]);
});

test('moveNode rewrites only the wires whose route changed (a card moved onto a floor lane pushes it down)', async () => {
  const { LABEL_H } = await import('../src/shared/graph/geometry.mjs');
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  const tpl = loopFixture();
  const rev = tpl.nodes.find((n) => n.id === 'n_rev');
  rev.x = 760; rev.y = 80;                                  // same row as n_agent: w4 returns on a floor lane under both
  const free = { id: 'n_free', kind: 'agent', key: 'planner', x: 2400, y: 80, config: {} };
  tpl.nodes.push(free);
  view.render(tpl, {});
  const floor = () => Math.max(...view.wireRoute('w4').map((p) => p.y));
  const floor0 = floor();
  const pill = () => view.world.querySelector('.wbadge[data-wire-id="w4"]');
  const top0 = parseFloat(pill().style.top);
  assert.equal(top0, floor0, 'the pill rides the floor lane');
  let n0 = view.stats.wireDUpdates;
  free.x = 580; free.y = floor0 + LABEL_H - 6;              // its label row now sits on the floor lane, below every other wire
  view.moveNode('n_free');
  assert.equal(view.stats.wireDUpdates - n0, 1, 'only the loop whose floor lane it now blocks wrote d');
  assert.ok(floor() > free.y + view.size(free).h, 'the floor lane drops below the moved card');
  assert.ok(parseFloat(pill().style.top) > top0, 'the pill moved down with the floor');
  assert.equal(view.wireEl('w4').getAttribute('d'), laneD(tpl, 'w4', { describe: true }));
  n0 = view.stats.wireDUpdates;
  free.x = 2400; view.moveNode('n_free');
  assert.equal(view.stats.wireDUpdates - n0, 1, 'the floor returns');
  assert.equal(parseFloat(pill().style.top), top0);
  n0 = view.stats.wireDUpdates;
  free.x = 2800; view.moveNode('n_free');
  assert.equal(view.stats.wireDUpdates - n0, 0, 'a move clear of every wire writes nothing');
  assert.equal(view.incidentOf('n_free').size, 0, 'the moved card is incident to no wire at all');
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
  const agentN = fixture().nodes.find((n) => n.id === 'n_agent');
  const hAt = (k) => `${nodeSize(agentN, portsFn(agentN), { footerRows: k }).h}px`;
  assert.equal(card.style.height, hAt(0));
  view.setFooter('n_agent', [{ kind: 'strip', leds: ['done'], summary: '1 run · $0.10', expanded: false }]);   // collapsed strip: +26
  assert.equal(card.style.height, hAt(1));
  assert.equal(card.querySelectorAll(':scope > .xfoot .xtoggle').length, 1);
  assert.equal(card.querySelector(':scope > .xfoot .xsum').textContent, '1 run · $0.10');
  view.setFooter('n_agent', [                            // +26 + 2*22
    { kind: 'strip', leds: ['done', 'active'], summary: '2 runs · $1.12', expanded: true },
    { kind: 'exec', executionId: 'x:n_agent:1', led: 'done', label: 'cycle 1', right: '1m 3s · $0.12' },
    { kind: 'exec', executionId: 'x:n_agent:2', led: 'active', label: 'cycle 2 · fix', right: '4s' },
  ]);
  assert.equal(card.style.height, hAt(3));
  assert.deepEqual([...card.querySelectorAll(':scope > .xfoot .xrow')].map((r) => r.dataset.executionId), ['x:n_agent:1', 'x:n_agent:2']);
  assert.equal(card.querySelectorAll(':scope > .xfoot .xrow')[1].className, 'xrow is-active');
  view.setFooter('n_agent', []);
  assert.equal(card.style.height, hAt(0));
  assert.equal(card.querySelector(':scope > .xfoot'), null, 'clearing removes the footer');
  assert.deepEqual([...card.querySelectorAll('.nbody > *')], rows, 'no row was rebuilt');
  // A `live` band (script nodes P1b, S4): one mono line, keyed by kind so it survives
  // repaints, billed as one footer line (folded from ui-graph-live-band).
  view.setFooter('n_agent', [{ kind: 'strip', leds: ['active'], summary: '1 run' }, { kind: 'live', text: 'npm test …' }]);
  const live = host.querySelector('.node[data-node-id="n_agent"] .xfoot .xlive');
  assert.equal(live.textContent, 'npm test …');
  assert.equal(live.title, 'npm test …');
  view.setFooter('n_agent', [{ kind: 'strip', leds: ['active'], summary: '1 run' }, { kind: 'live', text: '3 failing' }]);
  assert.equal(host.querySelector('.node[data-node-id="n_agent"] .xfoot .xlive'), live, 'the element survives (keyed band)');
  assert.equal(live.textContent, '3 failing');
  assert.equal(live.title, '3 failing');
  assert.equal(view._internals.footers.get('n_agent'), 2, 'a live band bills one footer line');
});

test('setFooter re-curves when the billed line count changes — growth AND removal (D16)', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  const tpl = loopFixture();
  const rev = tpl.nodes.find((n) => n.id === 'n_rev');
  rev.x = 760; rev.y = 80;                                  // same row as n_agent: w4 returns on a floor lane under both
  tpl.nodes = tpl.nodes.filter((n) => n.id !== 'n_end');
  tpl.wires = tpl.wires.filter((w) => w.to.node !== 'n_end');
  view.render(tpl, {});
  const base = view.wireEl('w4').getAttribute('d');
  assert.equal(base, laneD(tpl, 'w4'), 'the un-footed floor lane');
  const pill = view.world.querySelector('.wbadge[data-wire-id="w4"]');
  const top0 = pill.style.top;
  const bands = [{ kind: 'strip', leds: ['done'], summary: '1 run · $0.10', expanded: false }];
  view.setFooter('n_rev', bands);                       // +FOOT_H: the floor lane drops
  assert.notEqual(view.wireEl('w4').getAttribute('d'), base, 'a taller card re-routes the floor lane under it');
  assert.ok(parseFloat(pill.style.top) > parseFloat(top0), 'and its pill follows the floor down');
  const n0 = view.stats.wireDUpdates;
  view.setFooter('n_rev', bands);                       // same line count: the guard never fires
  assert.equal(view.stats.wireDUpdates, n0, 'an unchanged footer generation writes zero wire d');
  view.setFooter('n_rev', []);                          // removal fires too (the empty-bands exit)
  assert.equal(view.wireEl('w4').getAttribute('d'), base, 'removal restores the route byte-for-byte');
  assert.equal(pill.style.top, top0);
});

const VP = { left: 0, top: 0, width: 1280, height: 560 };

test('static mode binds no listeners; mountStaticGraph renders, fits to width (flow: host height, width option), survives a missing ResizeObserver, destroy idempotent', async () => {
  await checkRows([
    { name: 'static mode binds NO listeners and fitToWidth uses the host width', run: async () => {
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
      view.fitToWidth(520);                                  // the width decides z (>= zoomMin 0.3)
      assert.equal(view.getTransform().z, 520 / view.bounds(60).w);
    } },
    { name: 'mountStaticGraph renders, fits to width and survives a missing ResizeObserver', run: async () => {
      const { doc, host, win } = boot();
      assert.equal(typeof win.ResizeObserver, 'undefined', 'jsdom 29 has no ResizeObserver');
      const { mountStaticGraph } = await import(viewPath);
      const view = mountStaticGraph(host, fixture(), {
        doc, portsFn, agents: AGENTS, width: 520, viewport: () => ({ left: 0, top: 0, width: 520, height: 300 }),
      });
      assert.equal(view.mode, 'static');
      assert.equal(view.getTransform().z, 520 / view.bounds(60).w);
      assert.equal(host.querySelectorAll('.node').length, 3);
    } },
    { name: 'mountStaticGraph flow: host height set, width option honoured, destroy is idempotent without a ResizeObserver', run: async () => {
      const { doc, host } = boot();
      const { mountStaticGraph } = await import(viewPath);
      const view = mountStaticGraph(host, loopFixture(), { doc, portsFn, agents: AGENTS, layout: 'flow', scale: 0.65, width: 310, band: () => null });
      assert.equal(view.flowLayout().perRow, 1);
      assert.equal(host.style.height, `${view.flowLayout().height}px`);
      view.destroy(); view.destroy();
      assert.equal(host.querySelector('.gv-stage'), null);
      assert.equal(host.style.height, '', 'destroy releases the host height');
    } },
  ]);
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
  const head = view.nodeEl('n_agent').querySelector('.nlabel');
  assert.equal(head.querySelector('script'), null, 'no script node reached the DOM');
  assert.equal(head.querySelector('img'), null, 'no img node reached the DOM');
  assert.equal(head.querySelector('.tt').textContent, evil.displayName, 'the display name is TEXT, never markup');
});

test('destroy() removes the stage and leaves no listener that can mutate anything', async () => {
  const { doc, host, win } = boot();
  const { createGraphView } = await import(viewPath);
  // A synchronous raf: the pan settles inside pump() rather than a frame later,
  // so the transform below really would have moved if onMove were still bound.
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS,
    viewport: () => ({ ...VP }), raf: (fn) => { fn(); return 1; } });
  view.render(fixture(), {});
  view.createNav();
  const stage = view.stage;
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.destroy();
  assert.equal(host.querySelector('.gv-stage'), null, 'stage removed');
  stage.dispatchEvent(new win.WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 10, clientY: 10, bubbles: true, cancelable: true }));
  // `buttons: 1` is what a real drag reports: onMove drops a button-less move as a
  // release it never saw (D17), which would pass this test against a LIVE nav.
  stage.dispatchEvent(new win.PointerEvent('pointerdown', { pointerId: 3, button: 0, clientX: 10, clientY: 10, bubbles: true }));
  doc.dispatchEvent(new win.PointerEvent('pointermove', { pointerId: 3, buttons: 1, clientX: 200, clientY: 200, bubbles: true }));
  assert.equal(stage.classList.contains('panning'), false, 'no pointerdown listener survived destroy()');
  assert.deepEqual(view.getTransform(), { x: 0, y: 0, z: 1 }, 'no listener survived destroy()');
});

// C-2: safeAgentIcon's gate was a one-value DENYLIST (origin === 'user'), so a
// plugin sidecar's icon — data a marketplace plugin ships, with no code-execution
// consent and SHA-only updates — reached the header SVG's innerHTML verbatim.
// There is no CSP and no auth on the local API, so that is script in worca's own
// origin. The sibling manifest path already allowlist-sanitizes the SAME field;
// this routes the composer through it too.
test('C-2: every non-builtin agent icon is allowlist-sanitized before innerHTML', async () => {
  const { createGraphView, safeAgentIcon, USER_AGENT_ICON } = await import(viewPath);
  const XSS = '<image href=x onerror="globalThis.__pwned=1">';
  const LEGAL = '<path d="M4 4h8"></path>';

  assert.equal(safeAgentIcon({ origin: 'plugin:evil-plugin', icon: XSS }), USER_AGENT_ICON);
  assert.equal(safeAgentIcon({ origin: 'user', icon: XSS }), USER_AGENT_ICON);
  assert.equal(safeAgentIcon({ icon: XSS }), USER_AGENT_ICON, 'no origin at all is untrusted too');
  assert.equal(safeAgentIcon({ origin: 'plugin:evil-plugin', icon: '<path d="M0 0" onload="x()"/>' }),
    USER_AGENT_ICON, 'an allowlisted TAG with a non-allowlisted attribute is dropped whole');
  assert.equal(safeAgentIcon({ origin: 'builtin', icon: XSS }), XSS,
    'builtin icons are repo-shipped fragments and stay untouched');
  assert.equal(safeAgentIcon({ origin: 'plugin:nice', icon: LEGAL }), LEGAL,
    'a plugin icon that passes the allowlist still renders');
  assert.equal(safeAgentIcon(null), '');
  assert.equal(safeAgentIcon({ origin: 'plugin:nice' }), '', 'no icon stays no icon');

  const boom = boot();
  const evil = { key: 'planner', displayName: 'Evil', color: 'red', origin: 'plugin:evil-plugin', icon: XSS };
  const view = createGraphView(boom.host, { doc: boom.doc, portsFn, agents: { planner: evil } });
  view.render(fixture(), {});
  const svg = view.nodeEl('n_agent').querySelector('.nlabel svg');
  assert.equal(svg.querySelector('image'), null, `no <image> reached the DOM: ${svg.innerHTML}`);
  assert.equal(svg.innerHTML.includes('onerror'), false, `no onerror attribute: ${svg.innerHTML}`);
  assert.ok(svg.querySelector('circle'), 'the neutral glyph took its place');

  const good = boot();
  const nice = { key: 'planner', displayName: 'Nice', color: 'green', origin: 'plugin:nice', icon: LEGAL };
  const v2 = createGraphView(good.host, { doc: good.doc, portsFn, agents: { planner: nice } });
  v2.render(fixture(), {});
  const svg2 = v2.nodeEl('n_agent').querySelector('.nlabel svg');
  assert.ok(svg2.querySelector('path'), 'the legal plugin icon rendered');
  assert.equal(svg2.querySelector('path').getAttribute('d'), 'M4 4h8');
});

const nodeOf = (view, id) => view.template().nodes.find((n) => n.id === id);

test('agent band under the head (model · effort · flags; none on flow cards); pick mode turns model/effort into menu buttons', async () => {
  await checkRows([
    { name: 'band: an agent card grows a .nband under its head with model · effort · flags; flow cards never do', run: async () => {
      const { doc, host } = boot();
      const { createGraphView } = await import(viewPath);
      const band = (node) => (node.id === 'n_agent' ? { model: 'Opus 5.5', effort: 'high', flags: [{ text: 'asks', cls: 'q' }, { text: '↩ 3' }] } : null);
      const view = createGraphView(host, { doc, mode: 'static', portsFn, agents: AGENTS, band });
      view.render(fixture(), {});
      const el = view.nodeEl('n_agent');
      const nb = el.querySelector(':scope > .nband');
      assert.ok(nb, 'agent has a band');
      assert.ok(nb.previousElementSibling.classList.contains('nlabel'), 'band sits first in the body, right after the label row'); assert.equal(nb.nextElementSibling.className, 'nbody');
      assert.equal(el.querySelector('.nlabel .tt').title, el.querySelector('.nlabel .tt').textContent, 'head titles carry a tooltip (mockup F, A35)');
      assert.deepEqual([...nb.querySelectorAll('.bchip')].map((c) => c.textContent), ['Opus 5.5', 'high', 'asks', '↩ 3']);
      assert.ok(nb.querySelector('.bchip.flag.q'));
      assert.equal(view.nodeEl('n_task').querySelector(':scope > .nband'), null, 'task card: no band');
      const an = nodeOf(view, 'n_agent');
      assert.equal(el.style.height, `${nodeSize(an, portsFn(an), { band: true }).h}px`, 'nodeSize bills the band');
      assert.equal(view.anchor(an, 'task', 'in').y, portAnchor(an, portsFn(an), 'task', 'in', { band: true }).y, 'anchors move with the band');
      assert.equal(view.anchor(an, 'task', 'in').y - portAnchor(an, portsFn(an), 'task', 'in').y, 24);
      // The repaint is skipped on an equal signature, so the signature must separate its
      // fields: concatenated, {model:'Opus', effort:'5'} and {model:'Opus5', effort:''} collide.
      view.setBands({ n_agent: { model: 'Opus', effort: '5', flags: [] } });
      assert.deepEqual([...el.querySelectorAll('.bchip')].map((c) => c.textContent), ['Opus', '5']);
      view.setBands({ n_agent: { model: 'Opus5', effort: '', flags: [] } });
      assert.deepEqual([...el.querySelectorAll('.bchip')].map((c) => c.textContent), ['Opus5'], 'the band repaints — the two are not the same band');
      view.setBands({ n_agent: { model: '', effort: '', flags: [] } });
      assert.deepEqual([...el.querySelectorAll('.bchip')].map((c) => c.textContent), ['default']);
      assert.ok(el.querySelector('.bchip.model.is-unset'));
    } },
    { name: 'band pick: model/effort chips become <button aria-haspopup="menu" data-chip> when the band says pick; flags stay spans; the signature separates pick', run: async () => {
      const { doc, host } = boot();
      const { createGraphView } = await import(viewPath);
      const band = (node) => (node.id === 'n_agent' ? { model: 'Opus 5.5', effort: '', flags: [{ text: 'asks', cls: 'q' }], pick: true } : null);
      const view = createGraphView(host, { doc, mode: 'static', portsFn, agents: AGENTS, band });
      view.render(fixture(), {});
      const nb = view.nodeEl('n_agent').querySelector(':scope > .nband');
      const chips = [...nb.querySelectorAll('.bchip')];
      assert.deepEqual(chips.map((c) => [c.tagName, c.dataset.chip || null, c.textContent]), [['BUTTON', 'model', 'Opus 5.5'], ['BUTTON', 'effort', 'effort'], ['SPAN', null, 'asks']], 'an empty effort still gets a pickable placeholder chip');
      assert.equal(chips[0].getAttribute('aria-haspopup'), 'menu'); assert.equal(chips[0].getAttribute('aria-expanded'), 'false'); assert.equal(chips[0].type, 'button');
      view.setBands({ n_agent: { model: 'Opus 5.5', effort: '', flags: [{ text: 'asks', cls: 'q' }] } });
      assert.deepEqual([...nb.querySelectorAll('.bchip')].map((c) => c.tagName), ['SPAN', 'SPAN'], 'pick off ⇒ spans, and the empty effort chip is gone');
    } },
  ]);
});

test('layout flow: rows of perRow in dispatch order, routes from the flow router, badges read n×, relayout on width', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'static', portsFn, agents: AGENTS, scale: 0.65, layout: 'flow', band: () => null, order: ['n_agent', 'n_rev'] });
  view.render(loopFixture(), {});
  assert.ok(view.stage.classList.contains('gv-flow'));
  const lay = view.flowLayout();
  assert.equal(lay.width, 702, 'no width yet → FLOW_DEFAULT_WIDTH');
  assert.deepEqual(lay.order, ['n_task', 'n_agent', 'n_rev', 'n_end']);
  assert.equal(lay.perRow, flowPerRow(702));
  const tx = (id) => view.nodeEl(id).style.transform;
  assert.equal(lay.rows[0].top > FLOW_PAD_Y, true, 'the first row sits under its label row');
  assert.equal(tx('n_task'), `translate(20px, ${lay.rows[0].top}px)`);
  assert.equal(tx('n_agent'), `translate(${lay.positions.n_agent.x}px, ${lay.rows[0].top}px)`);
  assert.equal(host.querySelector('.wbadge[data-wire-id="w4"] .wmax').textContent, '≤2');
  assert.equal(view.stage.style.height, `${lay.height}px`);
  assert.equal(view.template().nodes.find((n) => n.id === 'n_agent').x, lay.positions.n_agent.x, 'the laid-out copy carries flow positions');
  assert.equal(loopFixture().nodes.find((n) => n.id === 'n_agent').x, 400, 'the caller\'s template is never mutated');
  const lay2 = view.relayout(310);
  assert.equal(lay2.perRow, 1);
  assert.equal(tx('n_agent'), `translate(20px, ${lay2.rows[1].top}px)`);
  assert.equal(view.stage.style.height, `${lay2.height}px`);
  assert.equal(view.fitToWidth(702).perRow, flowPerRow(702), 'fitToWidth delegates to relayout in flow mode');
});

test('monitor left-drag pans past 4px and swallows exactly its own click, even when it starts on the result link', async () => {
  await checkRows([
    { name: 'monitor nav: a left-drag pans by the exact delta past the 4px threshold, and swallows exactly the click it ends with', run: async () => {
      const { doc, host, win } = boot();
      const { createGraphView, DRAG_PX } = await import(viewPath);
      const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS,
        viewport: () => ({ ...VP }), raf: (fn) => { fn(); return 1; } });
      view.render(fixture(), {});
      const seen = [];
      view.createNav({ onTransform: (t) => seen.push(t) });
      view.setTransform({ x: 0, y: 0, z: 1 });
      assert.equal(DRAG_PX, 4);
      // `buttons: 1` is what a real drag reports on every move; the nav treats a move
      // with no button as a release this document never saw (D17).
      const pe = (type, o) => new win.PointerEvent(type, { pointerId: 7, buttons: 1, bubbles: true, cancelable: true, ...o });
      let clicks = 0;
      host.addEventListener('click', () => { clicks += 1; });

      // (a) a press over a CARD still starts a pan — the run canvas is read-only.
      const card = view.nodeEl('n_agent');
      card.dispatchEvent(pe('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
      doc.dispatchEvent(pe('pointermove', { clientX: 102, clientY: 101 }));
      assert.deepEqual(view.getTransform(), { x: 0, y: 0, z: 1 }, 'under 4px is a click, not a pan');
      assert.equal(view.stage.classList.contains('panning'), false);
      doc.dispatchEvent(pe('pointermove', { clientX: 140, clientY: 60 }));
      assert.deepEqual(view.getTransform(), { x: 40, y: -40, z: 1 }, 'pans by the delta FROM THE PRESS');
      assert.equal(view.stage.classList.contains('panning'), true, 'the grabbing cursor is on');
      doc.dispatchEvent(pe('pointermove', { clientX: 150, clientY: 60 }));
      assert.deepEqual(view.getTransform(), { x: 50, y: -40, z: 1 }, 'and keeps tracking the press origin');
      doc.dispatchEvent(pe('pointerup', { clientX: 150, clientY: 60 }));
      assert.equal(view.stage.classList.contains('panning'), false, 'released');
      assert.ok(seen.length >= 1 && seen[seen.length - 1].x === 50, 'the host is told');

      // (b) the click the browser fires after that drag is NOT a click on the card.
      card.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.equal(clicks, 0, 'the drag swallowed its own click');
      card.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.equal(clicks, 1, 'exactly one: the guard disarms itself');

      // (c) a press that never moved is still a click (the accordion, the gate, the result link).
      card.dispatchEvent(pe('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
      doc.dispatchEvent(pe('pointerup', { clientX: 11, clientY: 10 }));
      card.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.equal(clicks, 2, 'a press that never crossed the threshold clicks through');

      // (d) a RIGHT button press starts nothing.
      const t = view.getTransform();
      view.stage.dispatchEvent(pe('pointerdown', { button: 2, clientX: 300, clientY: 300 }));
      doc.dispatchEvent(pe('pointermove', { clientX: 400, clientY: 400 }));
      assert.deepEqual(view.getTransform(), t, 'only the left button pans');

      // (e) a TOUCH press starts nothing either (D13): a finger keeps the page's scroll,
      //     which is the only thing it can do here — the wrap declares no touch-action.
      view.stage.dispatchEvent(pe('pointerdown', { button: 0, pointerType: 'touch', clientX: 300, clientY: 300 }));
      doc.dispatchEvent(pe('pointermove', { pointerType: 'touch', clientX: 400, clientY: 400 }));
      assert.deepEqual(view.getTransform(), t, 'a finger never pans');

      // (f) a cancelled drag is DROPPED, never settled: Chrome reports pointercancel
      //     at client (0,0), and settling off that teleports the graph (D17).
      view.stage.dispatchEvent(pe('pointerdown', { button: 0, clientX: 500, clientY: 500 }));
      doc.dispatchEvent(pe('pointermove', { clientX: 560, clientY: 530 }));
      const panned = view.getTransform();
      assert.equal(panned.x, t.x + 60, 'the cancelled drag really had panned first');
      doc.dispatchEvent(pe('pointercancel', { clientX: 0, clientY: 0 }));
      assert.deepEqual(view.getTransform(), panned, 'cancel leaves the pan exactly where the user saw it');
      assert.equal(view.stage.classList.contains('panning'), false, 'and the gesture is over');

      // (g) a move that reports NO button is a release this document never saw.
      view.stage.dispatchEvent(pe('pointerdown', { button: 0, clientX: 600, clientY: 600 }));
      doc.dispatchEvent(pe('pointermove', { buttons: 0, clientX: 700, clientY: 700 }));
      assert.deepEqual(view.getTransform(), panned, 'a button-less move ends the gesture instead of panning');
    } },
    { name: 'the run card\'s result link is not natively draggable: a pan that starts on it survives', run: async () => {
      const { doc, host } = boot();
      const { createGraphView } = await import(viewPath);
      const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
      view.render(fixture(), {});
      view.setFooter('n_agent', [{ kind: 'result', text: 'plan.md', path: '/tmp/plan.md' }]);
      const a = view.nodeEl('n_agent').querySelector('.xresult a');
      assert.ok(a, 'the result band renders an anchor');
      assert.equal(a.draggable, false, 'Chrome drags an <a href> natively, which pointercancels the pan (D16)');
      assert.equal(a.getAttribute('href'), '#', 'and it is still the delegated link the host handles');
    } },
  ]);
});

/** The d the view must paint for wire `id`: curves.mjs over the same anchors and card boxes. */
/** The lane router's own `d` for one wire of `tpl` (what the view must paint, byte for byte). */
function laneD(tpl, id, { describe = false } = {}) {
  return routeGraph(tpl, {
    sizeOf: (n) => nodeSize(n, portsFn(n), { describe }),
    anchorOf: (n, port, dir) => portAnchor(n, portsFn(n), port, dir),
    loopWireIds: classifyLoops(tpl, portsFn).loopWireIds,
    pill: (w) => Number.isInteger(w.config && w.config.maxCycles),
  }).routes.get(id).d;
}

/** Every leg axis-aligned; the wire leaves its output and enters its input horizontally, left to right. */
function assertLaneRoute(pts, id) {
  assert.ok(pts.length >= 2, `${id} has a route`);
  for (let i = 1; i < pts.length; i += 1) {
    assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, `${id} leg ${i} is horizontal or vertical`);
  }
  assert.ok(pts[1].y === pts[0].y && pts[1].x > pts[0].x, `${id} leaves its output to the right`);
  assert.ok(pts.at(-2).y === pts.at(-1).y && pts.at(-2).x < pts.at(-1).x, `${id} enters its input from the left`);
  return pts;
}

test('cards: a label row (tile · title · meta) above a frosted body; edit hosts add the description footer', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS,
    modelLabel: (id) => (id === 'claude-sonnet-5' ? 'Sonnet 5' : id) });
  const tpl = fixture();
  const agent = tpl.nodes.find((n) => n.kind === 'agent');
  agent.config.model = 'claude-sonnet-5';
  view.render(tpl, {});
  const card = view.nodeEl(agent.id);
  const label = card.querySelector(':scope > .nlabel');
  assert.ok(label.querySelector('.ltile svg'));
  assert.equal(label.querySelector('.tt').textContent, AGENTS[agent.key].displayName);
  assert.equal(label.querySelector('.lm').textContent, 'Sonnet 5');
  assert.equal(card.querySelector(':scope > .ncap.desc').textContent, AGENTS[agent.key].description || '');
  assert.ok(card.querySelector(':scope > .ncap.desc > span'), 'the two-line clamp sits on an inner span, not the padded footer');
  assert.equal(card.style.height, `${nodeSize(agent, portsFn(agent), { describe: true }).h}px`);
  const task = tpl.nodes.find((n) => n.kind === 'task');
  assert.equal(view.nodeEl(task.id).querySelector(':scope > .ncap').textContent, 'prompt + attached files');
  const mon = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  mon.render(fixture(), {});
  assert.equal(mon.nodeEl(agent.id).querySelector(':scope > .ncap'), null, 'run cards carry no description footer');
});

test('wires paint lanes.mjs d strings, tinted by the SOURCE port type; the ghost stays the last child', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'static', portsFn, agents: AGENTS });
  const tpl = fixture();
  view.render(tpl, {});
  for (const w of tpl.wires) {
    const path = view.wireEl(w.id);
    assert.equal(path.getAttribute('d'), laneD(tpl, w.id));
    const from = tpl.nodes.find((n) => n.id === w.from.node);
    const type = portsFn(from).outputs.find((p) => p.id === w.from.port).type;
    assert.ok(path.classList.contains(`w-${type}`), `${w.id} tinted w-${type}`);
  }
  assert.equal(view.wiresEl.lastElementChild, view.ghostEl);
});

test('every loop wire carries a ≤N pill (default 3); a same-row loop returns on a floor lane under both cards, its pill on that lane', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  const tpl = loopFixture();
  const rev = tpl.nodes.find((n) => n.id === 'n_rev');
  rev.x = 760; rev.y = 80;                                  // same row as n_agent: w4 returns under both cards
  tpl.nodes = tpl.nodes.filter((n) => n.id !== 'n_end');    // keep the row clear
  tpl.wires = tpl.wires.filter((w) => w.to.node !== 'n_end');
  view.render(tpl, {});
  assert.equal(view.isLoopWire('w4'), true);
  const pill = view.world.querySelector('.wbadge[data-wire-id="w4"]');
  assert.equal(pill.textContent, '≤2');
  const c = view.curveOf('w4');
  const floor = Math.max(...c.pts.map((p) => p.y));
  for (const id of ['n_agent', 'n_rev']) {
    const n = tpl.nodes.find((x) => x.id === id);
    assert.ok(floor > n.y + view.size(n).h, `the floor lane runs under ${id}`);
  }
  assert.equal(pill.style.top, `${floor}px`);
  const run = c.pts.filter((p) => p.y === floor).map((p) => p.x);
  const x = parseFloat(pill.style.left);
  assert.ok(x > Math.min(...run) && x < Math.max(...run), 'the pill sits on the floor run');
  assert.ok(x > rev.x + view.size(rev).w, 'nearest its source, clear of the cards');
  delete tpl.wires.find((w) => w.id === 'w4').config;
  view.render(tpl, {});
  assert.equal(view.world.querySelector('.wbadge[data-wire-id="w4"] .wmax').textContent, '≤3', 'default max cycles');
  view.setWireBadge('w4', { text: '2×' });
  assert.equal(view.world.querySelector('.wbadge[data-wire-id="w4"] .wfired').textContent, '2×');
});

test('applyReport: errors pip red, V16–V19 warnings pip amber (only where no error), V15 never', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS });
  const tpl = fixture();
  const [a, b, c] = tpl.nodes;
  view.render(tpl, { report: { errors: [{ code: 'V4', message: 'required input', nodeId: a.id, incomplete: true }],
    warnings: [{ code: 'V18', message: 'double fire', nodeId: b.id }, { code: 'V18', message: 'x', nodeId: a.id },
      { code: 'V15', message: 'unreachable', nodeId: c.id }] } });
  assert.ok(view.nodeEl(a.id).querySelector(':scope > .npip'));
  assert.equal(view.nodeEl(a.id).querySelector(':scope > .nwarn'), null);
  assert.equal(view.nodeEl(b.id).querySelector(':scope > .nwarn').title, 'double fire');
  assert.equal(view.nodeEl(c.id).querySelector(':scope > .nwarn'), null);
  // V19 names only a wire ({wireId}): the pip goes on the wire's TARGET card, never on its source.
  const w2 = tpl.wires.find((w) => w.id === 'w2');
  view.render(tpl, { report: { errors: [], warnings: [{ code: 'V19', message: 'blocking into a plain input', wireId: w2.id }] } });
  assert.equal(view.nodeEl(w2.to.node).querySelector(':scope > .nwarn').title, 'blocking into a plain input');
  assert.equal(view.nodeEl(w2.from.node).querySelector(':scope > .nwarn'), null);
});

test('a flow host keeps every wire inside its left edge: a row-wrap S flattens (xMin)', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'static', portsFn, agents: AGENTS, scale: 0.65, layout: 'flow', band: () => null, order: ['n_agent', 'n_rev'] });
  const tpl = loopFixture();
  view.render(tpl, {});
  const back = tpl.wires.filter((w) => { const p = view.curveOf(w.id).pts; return !view.curveOf(w.id).swoop && p.at(-1).x < p[0].x; });
  assert.ok(back.length > 0, 'the fixture wraps a backward S onto the next row');
  for (const w of tpl.wires) assert.ok(view.curveOf(w.id).pts.every((p) => p.x >= 1), `${w.id} leaves the host's left edge`);
});

test('a moving canvas drops the frosted cards\' backdrop blur until it settles (software compositing: blur = 70–85% of a pan frame)', async () => {
  const { doc, host, win } = boot();
  const { createGraphView, MOVING_SETTLE_MS } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const stage = host.querySelector('.gv-stage');
  await new Promise((r) => win.setTimeout(r, MOVING_SETTLE_MS + 20));   // the mount's own transform write settles
  assert.equal(stage.classList.contains('gv-moving'), false, 'a still canvas is frosted');
  view.setTransform({ x: 10, y: 20, z: 0.8 });
  assert.equal(stage.classList.contains('gv-moving'), true, 'a pan / zoom write marks the stage moving');
  await new Promise((r) => win.setTimeout(r, MOVING_SETTLE_MS / 2));
  view.setTransform({ x: 12, y: 20, z: 0.8 });
  await new Promise((r) => win.setTimeout(r, MOVING_SETTLE_MS / 2 + 20));
  assert.equal(stage.classList.contains('gv-moving'), true, 'every write restarts the settle timer');
  await new Promise((r) => win.setTimeout(r, MOVING_SETTLE_MS + 20));
  assert.equal(stage.classList.contains('gv-moving'), false, 'settled: the blur comes back');
  view.moveNode('n_agent');
  assert.equal(stage.classList.contains('gv-moving'), true, 'a card drag marks it too');
  view.destroy();
  await new Promise((r) => win.setTimeout(r, MOVING_SETTLE_MS + 20));   // no timer fires on a dead view
});

test('a loop pill between two STACKED cards stays off the lower card\'s label row (mockup rectOf bills LABEL_H)', async () => {
  const { LABEL_H } = await import('../src/shared/graph/geometry.mjs');
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS });
  // checkpoint-era hand layouts (old cards were ~15px shorter and had no label row): the reviewer stacked under
  // its loop partner, its label row GAP px clear of the card above
  for (const gap of [6, 14, 22, 30, 38, 44, 52, 60]) {
    const tpl = loopFixture();
    const top = tpl.nodes.find((n) => n.id === 'n_agent');
    const rev = tpl.nodes.find((n) => n.id === 'n_rev');
    rev.x = top.x; rev.y = top.y + view.size(top).h + LABEL_H + gap;
    view.render(tpl, {});
    const p = view.curveOf('w4').mid;
    // a halo (14 x, 9 y) around each card's label row + body
    for (const n of [top, rev]) {
      const on = p.x >= n.x - 14 && p.x <= n.x + view.size(n).w + 14 && p.y >= n.y - LABEL_H - 9 && p.y <= n.y + view.size(n).h + 9;
      assert.ok(!on, `gap ${gap}: the ≤N pill at ${JSON.stringify(p)} sits on ${n.id} (label row from y ${n.y - LABEL_H}, body to y ${n.y + view.size(n).h})`);
    }
  }
});
