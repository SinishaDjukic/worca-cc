// test/ui-proposal-host.test.mjs — the chat's proposal well (ui/public/graph/proposal-host.mjs): a proposed workflow drawn
// as the Workflows canvas draws it, in a pannable chat-card well. jsdom has no layout: `viewport` injects the well's box.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { mountProposalGraph, wellTemplate, readingOrder, WELL_MIN_H, WELL_MAX_H, WELL_PAD, WELL_ZOOM_MIN, EXPAND_LABEL } from '../ui/public/graph/proposal-host.mjs';
import { NAV_BTNS, NAV_INSET } from '../ui/public/graph/run-hosts.mjs';
import { manifestAgents } from '../ui/public/graph/run-decor.mjs';
import { manifestPortsFn, manifestTemplate } from '../src/shared/graph/manifest.mjs';
import { autoLayout } from '../src/shared/graph/layout.mjs';
import { NODE_W, LABEL_H, ZOOM_STEP } from '../src/shared/graph/geometry.mjs';

const trackDom = useDomRelease(afterEach);

/** Four agents in a row, 320 px apart (wider than a 700 px well), and a loop wire D.review → B.fix (≤3). */
const agentCell = (id, x, label) => ({ id, kind: 'agent', key: `k${id.slice(2)}`, x, y: 60, label, color: 'blue', icon: '',
  ports: { inputs: [{ id: 'task', type: 'md', required: true }, { id: 'fix', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }, { id: 'review', type: 'md', when: 'blocking' }], await: true } });
const LINE = { version: 2, template: { id: '', name: 'Line' }, graph: {
  nodes: [agentCell('n_a', 60, 'A'), agentCell('n_b', 380, 'B'), agentCell('n_c', 700, 'C'), agentCell('n_d', 1020, 'D')],
  wires: [
    { id: 'w1', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_b', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_b', port: 'plan' }, to: { node: 'n_c', port: 'task' }, loop: false },
    { id: 'w3', from: { node: 'n_c', port: 'plan' }, to: { node: 'n_d', port: 'task' }, loop: false },
    { id: 'w4', from: { node: 'n_d', port: 'review' }, to: { node: 'n_b', port: 'fix' }, loop: true, maxCycles: 3 },
  ] } };

/** Task → two agents in ONE column, laid out the way assemble.mjs lays an Auto proposal out (no footer, no band). */
function stackManifest() {
  const ag = (id) => ({ id, kind: 'agent', key: 'kpar', x: 0, y: 0, label: id, color: 'blue', icon: '',
    ports: { inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
  const m = { version: 2, template: { id: '', name: 'Par' }, graph: {
    nodes: [{ id: 'n_t', kind: 'task', key: null, x: 0, y: 0, label: 'Task', color: '', icon: '',
      ports: { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }], await: false } }, ag('n_1'), ag('n_2')],
    wires: [
      { id: 'w1', from: { node: 'n_t', port: 'task' }, to: { node: 'n_1', port: 'task' }, loop: false },
      { id: 'w2', from: { node: 'n_t', port: 'task' }, to: { node: 'n_2', port: 'task' }, loop: false },
    ] } };
  const pos = autoLayout(manifestTemplate(m), manifestPortsFn(m));
  for (const n of m.graph.nodes) Object.assign(n, pos[n.id]);
  return m;
}
const BAND = () => ({ model: 'Opus 5.5', effort: 'high', flags: [] });

function mount(manifest = LINE, { width = 700, ro = false, ...opts } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><div class="ask-wfcard-graph"></div>'));
  const { window } = dom;
  const ros = [];
  if (ro) window.ResizeObserver = class { constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; ros.push(this); } observe(t) { this.targets.push(t); } unobserve() {} disconnect() { this.disconnected = true; } };
  const host = window.document.querySelector('.ask-wfcard-graph');
  const box = { width };
  const well = mountProposalGraph(host, manifestTemplate(manifest), { doc: window.document, raf: (fn) => { fn(); return 1; },
    viewport: () => ({ left: 0, top: 0, width: box.width, height: 600 }),
    portsFn: manifestPortsFn(manifest), agents: manifestAgents(manifest), ...opts });
  return { window, host, well, box, ros, world: () => host.querySelector('.gv-world') };
}
const xform = (world) => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(world.style.transform || '');
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
/** The well height at zoom `z` (#959: the zoom the first measured placement uses; 1 while unmeasured). */
const wellHOf = (b, z = 1) => Math.min(WELL_MAX_H, Math.max(WELL_MIN_H, Math.ceil(b.h * z)));
const wheel = (window, init) => new window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });

test('mount: the Workflows rendering — template x/y, scale-1 cards with the description footer, orthogonal lanes, the ≤N pill — opening fitted (#959) in a well sized from the graph', async () => {
  await checkRows([
    { name: 'a graph wider than the well opens fitted: the whole width, centred, ≥ WELL_ZOOM_MIN', run: async () => {
      const { host, well, world } = mount(LINE, { width: 700 });
      const v = well.view;
      assert.ok(host.classList.contains('gv-well'));
      assert.ok(v.stage.classList.contains('gv-monitor') && !v.stage.classList.contains('gv-flow'), 'a pannable canvas stage, not the flow rows');
      for (const n of LINE.graph.nodes) {
        const el = v.nodeEl(n.id);
        assert.equal(el.style.transform, `translate(${n.x}px, ${n.y}px)`, `${n.id} at its template x/y`);
        assert.equal(el.style.width, `${NODE_W}px`, 'the canvas card width (scale 1, not FLOW_SCALE)');
        assert.ok(el.querySelector(':scope > .ncap.desc'), 'the description footer the canvas bills');
        assert.equal(el.querySelector(':scope > .nband'), null, 'no chip band unless the host asks');
      }
      for (const w of LINE.graph.wires) {
        const pts = v.wireRoute(w.id);
        assert.ok(pts.length >= 2 && pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 1e-6 || Math.abs(p.y - pts[i - 1].y) < 1e-6), `${w.id} runs in orthogonal lanes`);
      }
      assert.equal(host.querySelector('.wbadge .wmax').textContent, '≤3', 'the loop pill');
      const b = v.bounds(WELL_PAD);
      const t = xform(world());
      const h = wellHOf(b, t.z);
      assert.equal(host.style.height, `${h}px`, 'the well height: the padded graph at its placed zoom, clamped');
      assert.equal(well.height(), h);
      assert.ok(t.z < 1 && t.z >= WELL_ZOOM_MIN, `shrunk to fit (z ${t.z}) — #959`);
      assert.ok(b.w * t.z <= 700 - NAV_INSET + 1e-6, 'the whole width, left of the cluster');
      near(t.x, (700 - NAV_INSET - b.w * t.z) / 2 - b.x * t.z, 'centred');
      assert.equal(v.stage.getAttribute('tabindex'), '-1', 'no dead tab stop');
      assert.equal(host.querySelectorAll('[tabindex="0"]').length, 0, 'nor on the cards');
    } },
    { name: 'a graph that fits is centred at zoom 1, left of the nav cluster\'s column', run: async () => {
      const { well, world } = mount(LINE, { width: 1600 });
      const b = well.view.bounds(WELL_PAD);
      const t = xform(world());
      assert.equal(t.z, 1);
      near(t.x, (1600 - NAV_INSET - b.w) / 2 - b.x, 'centred in the span the cluster leaves');
    } },
    { name: 'a graph still wider than the span at WELL_ZOOM_MIN opens at WELL_ZOOM_MIN at its START edge, not centred', run: async () => {
      const { well, world } = mount(LINE, { width: 300 });
      const b = well.view.bounds(WELL_PAD);
      assert.ok(b.w * WELL_ZOOM_MIN > 300 - NAV_INSET, 'the fixture is too wide at the floor');
      const t = xform(world());
      assert.equal(t.z, WELL_ZOOM_MIN);
      near(t.x, -b.x * WELL_ZOOM_MIN, 'the padded left edge at the well\'s left: the first card in view');
      near(t.y, (well.height() - b.h * t.z) / 2 - b.y * t.z, 'the vertical placement is unchanged: centred');
      well.fit();
      near(xform(world()).x, -b.x * WELL_ZOOM_MIN, 'Center places it there again');
    } },
    { name: 'unmeasured (detached / hidden): the height is already right, the view sits at the start edge; the first width places it', run: async () => {
      const { well, box, host, world } = mount(LINE, { width: 0 });
      const b = well.view.bounds(WELL_PAD);
      assert.equal(host.style.height, `${wellHOf(b)}px`, 'sized from the model, before any measure');
      near(xform(world()).x, -b.x, 'the start edge');
      box.width = 1600;
      well.relayout();
      near(xform(world()).x, (1600 - NAV_INSET - b.w) / 2 - b.x, 'the first measured relayout centres it');
    } },
    { name: 'readingOrder: left to right, then top to bottom', run: async () => {
      assert.deepEqual(readingOrder({ nodes: [{ id: 'b', x: 300, y: 0 }, { id: 'c', x: 0, y: 200 }, { id: 'a', x: 0, y: 50 }, null] }), ['a', 'c', 'b']);
      const { well } = mount(LINE);
      assert.deepEqual(well.order, ['n_a', 'n_b', 'n_c', 'n_d']);
    } },
  ]);
});

test('restack (an Auto proposal with chip bands): x never moves, stacked cards make room for the band + footer; off, the template y is verbatim', () => {
  const m = stackManifest();
  const { well } = mount(m, { band: BAND, restack: true });
  const at = (id) => well.template().nodes.find((n) => n.id === id);
  assert.equal(at('n_1').x, at('n_2').x, 'one column');
  for (const n of m.graph.nodes) assert.equal(at(n.id).x, n.x, `${n.id} keeps its column`);
  const want = autoLayout(manifestTemplate(m), manifestPortsFn(m), { describe: true, band: true });
  for (const n of m.graph.nodes) assert.deepEqual({ x: at(n.id).x, y: at(n.id).y }, want[n.id], `${n.id}: the canvas layout re-run with this well's heights`);
  const [top, low] = [at('n_1'), at('n_2')].sort((a, b) => a.y - b.y);
  const h = well.view.size(top).h;
  assert.ok(low.y - LABEL_H >= top.y + h, 'the lower card\'s label row clears the banded, described card above it');
  const [t0, l0] = [m.graph.nodes[1], m.graph.nodes[2]].sort((a, b) => a.y - b.y);
  assert.ok(l0.y - LABEL_H < t0.y + h, 'precondition: the proposal\'s own y would overlap');
  assert.ok(well.view.nodeEl('n_1').querySelector(':scope > .nband'), 'the chip band is drawn');
  for (const n of well.template().nodes) assert.equal(well.view.nodeEl(n.id).style.transform, `translate(${n.x}px, ${n.y}px)`);
  const plain = mount(m, { band: BAND });
  assert.equal(plain.well.template().nodes.find((n) => n.id === 'n_2').y, m.graph.nodes[2].y, 'no restack: the template y verbatim');
  assert.equal(wellTemplate(manifestTemplate(m), manifestPortsFn(m)).nodes[2].y, m.graph.nodes[2].y);
});

test('the chat\'s wheel policy: a plain vertical wheel scrolls the chat, shift / a mostly horizontal wheel pans, ⌘/ctrl+wheel zooms (never past 1); pans and drags stay inside the graph', () => {
  const { window, well, world } = mount(LINE, { width: 700 });
  const stage = well.view.stage;
  const b = well.view.bounds(WELL_PAD);
  // #959: the well opens fitted; a user who zoomed in to 1 (Zoom in) has the start edge at zoom 1 to pan from.
  well.view.setTransform({ x: -b.x, y: (wellHOf(b) - b.h) / 2 - b.y, z: 1 });
  const start = xform(world());
  const plain = wheel(window, { deltaY: 120 });
  stage.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false, 'a plain vertical wheel is the chat\'s scroll');
  assert.deepEqual(xform(world()), start);
  const shifted = wheel(window, { deltaY: 100, shiftKey: true });
  stage.dispatchEvent(shifted);
  assert.ok(shifted.defaultPrevented);
  near(xform(world()).x, start.x - 100, 'shift+wheel pans along the graph');
  const sideways = wheel(window, { deltaX: 40, deltaY: 5 });
  stage.dispatchEvent(sideways);
  assert.ok(sideways.defaultPrevented);
  near(xform(world()).x, start.x - 140, 'a mostly horizontal trackpad wheel pans');
  for (let i = 0; i < 50; i += 1) stage.dispatchEvent(wheel(window, { deltaX: 400 }));
  near(xform(world()).x, (700 - NAV_INSET) - (b.x + b.w), 'never past the far end (the cluster\'s column stays clear)');
  near(xform(world()).y, start.y, 'a vertical axis that fits stays centred');
  // a drag back past the start edge is clamped there
  stage.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 40, bubbles: true }));
  window.document.dispatchEvent(new window.PointerEvent('pointermove', { pointerId: 1, buttons: 1, clientX: 3000, clientY: 400, bubbles: true }));
  window.document.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1, clientX: 3000, clientY: 400, bubbles: true }));
  near(xform(world()).x, -b.x, 'a drag never pulls the graph past its start edge');
  near(xform(world()).y, start.y, 'nor off its centred vertical axis');
  const zoom = wheel(window, { deltaY: 400, ctrlKey: true, clientX: 300, clientY: 100 });
  stage.dispatchEvent(zoom);
  assert.ok(zoom.defaultPrevented);
  assert.ok(xform(world()).z < 1, '⌘/ctrl+wheel zooms out');
  for (let i = 0; i < 20; i += 1) stage.dispatchEvent(wheel(window, { deltaY: -400, metaKey: true, clientX: 300, clientY: 100 }));
  assert.equal(xform(world()).z, 1, 'never past zoom 1 (the canvas\'s own card size)');
});

test('the nav cluster: the run monitor\'s glyphs + Expand; in/out disable at the zoom ends, Center fits the whole graph, Expand runs one open at a time', async () => {
  let release = null;
  const calls = [];
  const { window, host, well, box, world } = mount(LINE, { width: 1600, onExpand: () => { calls.push(1); return new Promise((r) => { release = r; }); } });
  const nav = host.querySelector(':scope > .gv-nav');
  assert.ok(nav, 'the cluster sits in the well — a sibling of the stage, never in the drag pipeline');
  assert.deepEqual([...nav.querySelectorAll('.gv-nav-btn')].map((b) => [b.dataset.nav, b.getAttribute('aria-label'), b.title]),
    [['in', 'Zoom in', 'Zoom in'], ['out', 'Zoom out', 'Zoom out'], ['center', 'Fit graph to view', 'Fit graph to view'], ['expand', EXPAND_LABEL, EXPAND_LABEL]]);
  const ref = window.document.createElement('div');
  for (const [key, , glyph] of NAV_BTNS) { ref.innerHTML = glyph; assert.equal(nav.querySelector(`[data-nav="${key}"]`).innerHTML, ref.innerHTML, `${key}: the run monitor's glyph`); }
  const btn = (k) => nav.querySelector(`[data-nav="${k}"]`);
  assert.equal(btn('in').disabled, true, 'opened at zoom 1: nothing to zoom in to');
  assert.equal(btn('out').disabled, false);
  btn('out').click();
  near(xform(world()).z, 1 / ZOOM_STEP, 'one step out');
  assert.equal(btn('in').disabled, false);
  btn('in').click();
  near(xform(world()).z, 1, 'and back');
  box.width = 700; well.relayout();
  btn('center').click();
  const b = well.view.bounds(WELL_PAD);
  const t = xform(world());
  assert.ok(t.z < 1 && t.z >= WELL_ZOOM_MIN, `Center fits the whole graph (z ${t.z})`);
  assert.ok(b.w * t.z <= 700 - NAV_INSET + 1e-6, 'the whole width, left of the cluster');
  near(t.x, (700 - NAV_INSET - b.w * t.z) / 2 - b.x * t.z, 'centred');
  const ex = btn('expand');
  ex.click(); ex.click();
  assert.deepEqual(calls, [1], 'one open at a time');
  assert.equal(ex.getAttribute('aria-disabled'), 'true');
  assert.equal(ex.disabled, false, 'never `disabled` (Chrome drops the focus to <body>)');
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ex.hasAttribute('aria-disabled'), false);
  ex.click();
  assert.deepEqual(calls, [1, 1]);
  const bare = mount(LINE);
  assert.deepEqual([...bare.host.querySelectorAll('.gv-nav .gv-nav-btn')].map((x) => x.dataset.nav), ['in', 'out', 'center'], 'no way in: no Expand');
  const boom = mount(LINE, { onExpand: () => { throw new Error('x'); } });
  const bx = boom.host.querySelector('[data-nav="expand"]');
  bx.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(bx.hasAttribute('aria-disabled'), false, 'a throwing open never wedges the button');
});

test('relayout (a width change) never moves a node: an untouched view is placed again, a panned one only stays inside the well; the observer drives it and destroy gives the host back', () => {
  const { window, host, well, box, ros, world } = mount(LINE, { width: 700, ro: true });
  assert.equal(ros.length, 1);
  assert.deepEqual(ros[0].targets, [host], 'the well itself is observed (ask-panel tests find it by .ask-wfcard-graph)');
  const cards = () => LINE.graph.nodes.map((n) => well.view.nodeEl(n.id).style.transform);
  const before = cards();
  const h0 = host.style.height;
  const b = well.view.bounds(WELL_PAD);
  box.width = 1600; ros[0].cb([]);
  assert.deepEqual(cards(), before, 'no card moved');
  assert.equal(host.style.height, h0, 'nor did the well height');
  const w = xform(world());
  assert.ok(w.z <= well.height() / b.h + 1e-9, 'the set height caps the zoom: the well never grows');
  near(w.x, (1600 - NAV_INSET - b.w * w.z) / 2 - b.x * w.z, 'untouched: placed again (it fits: centred)');
  box.width = 700; well.relayout();
  const f = xform(world());
  assert.ok(f.z < 1, 'narrow again: fitted again');
  near(f.x, (700 - NAV_INSET - b.w * f.z) / 2 - b.x * f.z, 'narrow again: fitted again, centred');
  well.view.setTransform({ x: -b.x, y: (wellHOf(b) - b.h) / 2 - b.y, z: 1 });   // the user zoomed in to 1 (#959)
  well.view.stage.dispatchEvent(wheel(window, { deltaY: 100, shiftKey: true }));
  box.width = 800; well.relayout();
  near(xform(world()).x, -b.x - 100, 'a panned view keeps its pan');
  box.width = 1600; well.relayout();
  near(xform(world()).x, (1600 - NAV_INSET - b.w) / 2 - b.x, 'clamped: a graph that now fits is centred');
  well.destroy(); well.destroy();
  assert.equal(ros[0].disconnected, true);
  assert.equal(host.querySelector('.gv-stage'), null);
  assert.equal(host.querySelector('.gv-nav'), null);
  assert.equal(host.classList.contains('gv-well'), false);
  assert.equal(host.style.height, '');
  const late = wheel(window, { deltaY: 100, shiftKey: true });
  host.dispatchEvent(late);
  assert.equal(late.defaultPrevented, false, 'the wheel listener is gone');
});

test('the well height follows the placed zoom, set once by the first measured placement: no later width changes it (#959)', () => {
  const narrow = mount(LINE, { width: 700 });
  const b = narrow.well.view.bounds(WELL_PAD);
  const z = xform(narrow.world()).z;
  assert.ok(z < 1);
  assert.equal(narrow.well.height(), wellHOf(b, z), 'sized at the fitted zoom, not at zoom 1');
  assert.ok(narrow.well.height() < wellHOf(b), 'so a shrunk graph sits in no mostly empty box');
  for (const width of [1600, 300, 900]) {
    narrow.box.width = width; narrow.well.relayout();
    assert.equal(narrow.well.height(), wellHOf(b, z), `${width}px: unchanged`);
    assert.equal(narrow.host.style.height, `${wellHOf(b, z)}px`);
  }
  const late = mount(LINE, { width: 0 });
  assert.equal(late.well.height(), wellHOf(b), 'unmeasured: zoom 1');
  late.box.width = 700; late.well.relayout();
  assert.equal(late.well.height(), wellHOf(b, z), 'the first width sizes it to that placement');
  late.box.width = 1600; late.well.relayout();
  assert.equal(late.well.height(), wellHOf(b, z), 'and only the first');
  const floor = mount(LINE, { width: 300 });
  assert.equal(floor.well.height(), wellHOf(b, WELL_ZOOM_MIN), 'a graph that pans: its height at the floor');
});

test('descriptions: descriptionOf fills the footers at mount; setDescriptions repaints the text only (no card moves, no wire rewritten) and reports a change', () => {
  const { well } = mount(LINE, { descriptionOf: (k) => (k === 'ka' ? 'Plans the work.' : '') });
  const text = (id) => well.view.nodeEl(id).querySelector(':scope > .ncap.desc').textContent;
  assert.equal(text('n_a'), 'Plans the work.');
  assert.equal(text('n_b'), '', 'no text yet: an empty, full-height footer');
  const pos = LINE.graph.nodes.map((n) => [well.view.nodeEl(n.id).style.transform, well.view.nodeEl(n.id).style.height]);
  well.view.wireEl('w2').classList.add('is-hid');
  assert.equal(well.setDescriptions((k) => `About ${k}`), true);
  assert.equal(text('n_a'), 'About ka');
  assert.equal(text('n_d'), 'About kd');
  assert.deepEqual(LINE.graph.nodes.map((n) => [well.view.nodeEl(n.id).style.transform, well.view.nodeEl(n.id).style.height]), pos);
  assert.ok(well.view.wireEl('w2').classList.contains('is-hid'), 'a running build animation keeps its hidden wires');
  assert.equal(well.setDescriptions((k) => `About ${k}`), false, 'nothing changed');
});

test('style.css: the well pans with a grab cursor and selects no text, its cluster sits in its own corner, and a chat graph well stays inside its card (#959)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  for (const rule of [
    '.gv-well{user-select:none;-webkit-user-select:none;}',
    '.gv-well .gv-stage,.gv-well .gv-world .node{cursor:grab;}',
    '.gv-well .gv-stage.panning,.gv-well .gv-stage.panning *{cursor:grabbing !important;}',
    '.gv-well > .gv-nav{right:12px;bottom:12px;}',
  ]) assert.ok(css.includes(rule), `missing: ${rule}`);
  assert.doesNotMatch(css, /\.chat-convo \.ask-msg \.gv-well\{/, 'no rule widens a chat graph well past its card');
  assert.ok(css.includes('.ask-ccard{margin:6px 0;max-width:760px;'), 'the build card\'s text column keeps its width');
});
