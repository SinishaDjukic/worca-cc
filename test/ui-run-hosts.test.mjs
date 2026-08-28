// test/ui-run-hosts.test.mjs
// P6a — the DOM half of the run monitor: the view's decor fast paths (consumer-side
// pins of P5's contract), the run-monitor CSS block, applyDecor, the host adapters
// and the app.js version arms. (The artifact routes live in test/api-run-artifact.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createGraphView } from '../ui/public/graph/view.mjs';
import { manifestPortsFn, manifestTemplate } from '../src/shared/graph/manifest.mjs';

const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');
const MANIFEST = {
  version: 2, template: { id: 'wf_t', name: 'T' },
  graph: {
    nodes: [
      { id: 'n_a', kind: 'agent', key: 'planner', x: 0, y: 0, label: 'Planner', color: 'violet',
        ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'plan', type: 'md', when: 'always' }], await: true } },
      { id: 'n_end', kind: 'end', key: null, x: 400, y: 0, label: 'End', color: '',
        ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } },
    ],
    wires: [{ id: 'w1', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' }, loop: true, maxCycles: 3 }],
  },
};

function mountView(mode = 'monitor') {
  const dom = new JSDOM('<!doctype html><div id="h" style="width:800px;height:400px"></div>');
  const { window } = dom;
  const host = window.document.getElementById('h');
  const view = createGraphView(host, {
    mode, doc: window.document, portsFn: manifestPortsFn(MANIFEST), agents: {},
    raf: (fn) => { fn(); return 1; },
    // `viewport` is a FUNCTION: view.readRect() does `R = { ...viewport() }`.
    viewport: () => ({ left: 0, top: 0, width: 800, height: 400 }),
  });
  view.render(manifestTemplate(MANIFEST), {});
  return { window, host, view };
}

test('setFooter builds one band per row and sizes the card from the band count', () => {
  const { view, host } = mountView();
  const card = () => host.querySelector('[data-node-id="n_a"]');
  const h0 = parseFloat(card().style.height);
  view.setFooter('n_a', [{ kind: 'strip', leds: ['done', 'active'], summary: '2 runs · $1.12', expanded: false }]);
  assert.equal(card().querySelectorAll('.xfoot .xtoggle').length, 1);
  assert.equal(card().querySelector('.xsum').textContent, '2 runs · $1.12');
  assert.equal(card().querySelectorAll('.xsq .xq').length, 2);
  const h1 = parseFloat(card().style.height);
  assert.equal(h1, h0 + 26, 'one band = FOOT_H');
  view.setFooter('n_a', [
    { kind: 'strip', leds: ['done', 'active'], summary: '2 runs · $1.12', expanded: true },
    { kind: 'exec', executionId: 'x:n_a:1', led: 'done', label: 'cycle 1', right: '1m 3s · $0.12' },
    { kind: 'exec', executionId: 'x:n_a:2', led: 'active', label: 'cycle 2 · fix', right: '4s' },
  ]);
  assert.equal(parseFloat(card().style.height), h0 + 26 + 22 + 22, 'extra bands are EXEC_ROW_H');
  const rows = [...card().querySelectorAll('.xrow')];
  assert.deepEqual(rows.map((r) => r.dataset.executionId), ['x:n_a:1', 'x:n_a:2']);
  assert.equal(rows[1].className, 'xrow is-active');
  view.setFooter('n_a', []);
  assert.equal(card().querySelector('.xfoot'), null, 'clearing removes the footer');
  assert.equal(parseFloat(card().style.height), h0, 'and restores the card height');
});

test('setNodeChrome paints --c, the gate pip and the header totals; nulls clear them', () => {
  const { view, host } = mountView();
  const card = host.querySelector('[data-node-id="n_a"]');
  view.setNodeChrome('n_a', { color: 'violet', gate: { wireId: 'w1', title: 'waiting on a loop gate' }, totals: { dur: '2m 10s', cost: '$0.42' } });
  assert.equal(card.style.getPropertyValue('--c'), 'var(--violet)');
  assert.equal(card.querySelector('.ngate').dataset.wireId, 'w1');
  assert.equal(card.querySelector('.nrun .dur').textContent, '2m 10s');
  assert.equal(card.querySelector('.nrun .cost').textContent, '$0.42');
  assert.equal(card.classList.contains('run-node'), true, 'the 1s tick hook selects .run-node[data-id] .dur');
  assert.equal(card.dataset.id, 'n_a');
  view.setNodeChrome('n_a', { color: '', gate: null, totals: null });
  assert.equal(card.querySelector('.ngate'), null);
  assert.equal(card.querySelector('.nrun'), null);
});

test('setWireBadge writes an amber cycle badge and clears it', () => {
  const { view, host } = mountView();
  view.setWireBadge('w1', { text: '2×', title: '2 of 3 cycles' });
  const badge = host.querySelector('.wbadge[data-wire-id="w1"] .wfired');
  assert.equal(badge.textContent, '2×');
  assert.equal(badge.title, '2 of 3 cycles');
  view.setWireBadge('w1', null);
  assert.equal(host.querySelector('.wfired'), null);
});

test('the run-monitor CSS block styles the hosts and states it ACTUALLY writes, at the end of the file, and re-declares no shared keyframe', () => {
  for (const sel of ['.run-flow.gv-host{', '.run-flow-wrap.gv-wrap-monitor{', '.rc-detailed .run-flow-wrap.gv-wrap-static{height:300px',
    '.run-flow.gv-host .gv-world .node.is-error', '.run-flow.gv-host .gv-world .node.is-skipped',
    '.run-flow.gv-host .gv-wires path.wire-live', '.rd-graph.settled .run-flow.gv-host .gv-wires path.wire-live{animation:none;}',
    '.run-flow.gv-host .wbadge:not(:has(> .wfired))', '.run-flow.gv-host .gv-world .xfoot>.fan{', '--run-host-h', '.run-warn{', '.rg-hint{']) {
    assert.ok(css.includes(sel), `${sel} must be written`);
  }
  for (const kf of ['@keyframes wireFlow', '@keyframes sqPulse', '@keyframes nodeGlow{', '@keyframes xqPulse']) {
    assert.equal(css.split(kf).length - 1, 1, `${kf} must be declared exactly once`);
  }
  assert.equal(css.includes('--gv-host'), false, 'the --gv-* namespace belongs to injectGeometry (test/ui-graph-css.test.mjs)');
  // sqPulse may attach ONLY to the v1 fan square (test/ui-run-flow-css.test.mjs); v2 leds pulse through xqPulse.
  for (const m of css.matchAll(/([^{}]+)\{[^}]*animation:\s*sqPulse[^}]*\}/g)) assert.equal(m[1].trim(), '.run-flow .node .fan .sq.on');
  // The host reset: `.gv-stage{inset:0}` must fill the WRAP, not .run-flow's 118px padding box.
  assert.ok(/\.run-flow\.gv-host\{[^}]*position:absolute[^}]*padding:0[^}]*display:block/.test(css), 'the graph host drops the v1 flex/padding box');
  // Three of the selectors above also occur INSIDE other rules (the `.rd-graph.settled`
  // twin and the reduced-motion arm for the ants; the two `::after` pip rules for
  // is-error; `> .rg-hint{opacity:...}` for the hint chip), so a bare substring pin
  // survives DELETING the rule it is meant to protect. Pin those three by BODY.
  assert.match(css, /\.run-flow\.gv-host \.gv-wires path\.wire-live\{[^}]*stroke-dasharray[^}]*animation:\s*wireFlow[^}]*\}/,
    'the ants rule itself must dash the wire and run wireFlow (the settled/reduced-motion arms are not it)');
  assert.match(css, /\.run-flow\.gv-host \.gv-world \.node\.is-error\{[^}]*border-color[^}]*\}/,
    'the is-error card must get its own border colour (the ::after pip rules are not it)');
  assert.match(css, /(^|\n)\.rg-hint\{[^}]*position:absolute[^}]*opacity:0[^}]*\}/,
    'the hint chip rule itself (the :hover / .rg-engaged arms only toggle its opacity)');
  // The v1 `.run-flow .node .fan` rule (same specificity, earlier) leaks margin-top + border-top onto the 26px band.
  const fan = (css.match(/\.run-flow\.gv-host \.gv-world \.xfoot>\.fan\{[^}]*\}/) || [''])[0];
  assert.ok(/margin:0/.test(fan) && /border-top:0/.test(fan), 'the fan neutraliser resets margin + border');
  // Appended at the END: the 3–4-class v1 rules tie P5's block, so source order must win (A32 deviation).
  assert.ok(css.indexOf('.run-flow.gv-host{') > css.indexOf('/* v2 composer shell'), 'the P6 block follows the composer block');
  // Spelled WITHOUT the space, so the ask-dock arm stays the LAST with-space block (test/ui-ask-style.test.mjs).
  assert.ok(css.lastIndexOf('@media (prefers-reduced-motion:reduce)') > css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
});

// ── applyDecor: the ONE DOM pass ─────────────────────────────────────────────
import { decorFromState, applyDecor } from '../ui/public/graph/run-decor.mjs';

const RUN = (over = {}) => ({ stepper: MANIFEST, status: 'running', steps: [], active: [],
  endReached: false, result: null, warnings: [], wireDeliveries: {}, tokens: {}, gate: null, ...over });

test('applyDecor paints statuses, the collapsed strip, ants and badges; expanding one node lists its rows', () => {
  const { view, host } = mountView();
  const st = RUN({
    steps: [
      { key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle', status: 'done', activeMs: 63000, costUsd: 0.12, trigger: { wireIds: [], freshPorts: ['task'] } },
      { key: 'x:n_a:2', executionId: 'x:n_a:2', nodeId: 'n_a', ordinal: 2, kind: 'cycle', status: 'start', activeMs: 4000, costUsd: 0, trigger: { wireIds: ['w1'], freshPorts: [] } },
    ],
    active: [{ nodeId: 'n_a', executionId: 'x:n_a:2' }],
    wireDeliveries: { w1: 2 },
    gate: { wireId: 'w1', fromNode: 'n_a', toNode: 'n_end', askId: 'gate-w1-3' },
  });
  const decor = decorFromState(st);
  applyDecor(view, decor);
  const card = host.querySelector('[data-node-id="n_a"]');
  assert.ok(card.classList.contains('is-active'));
  assert.equal(host.querySelector('[data-node-id="n_end"]').classList.contains('is-pending'), true);
  assert.equal(card.querySelector('.xsum').textContent, '2 runs · $0.12');
  assert.equal(card.querySelectorAll('.xrow').length, 0, 'collapsed by default');
  assert.equal(card.querySelector('.ngate').dataset.wireId, 'w1');
  assert.equal(card.querySelector('.nrun .dur').textContent, '1m 7s');
  assert.equal(host.querySelector('.wbadge[data-wire-id="w1"] .wfired').textContent, '2×');
  assert.equal(host.querySelector('path[data-wire-id="w1"]').classList.contains('wire-live'), true);

  applyDecor(view, { ...decor, expanded: 'n_a' });
  assert.deepEqual([...card.querySelectorAll('.xrow')].map((r) => r.dataset.executionId), ['x:n_a:1', 'x:n_a:2']);
  assert.equal(card.querySelector('.xtoggle').getAttribute('aria-expanded'), 'true');
});

test('applyDecor is self-clearing: a settled repaint strands no ant, badge or pip', () => {
  const { view, host } = mountView();
  applyDecor(view, decorFromState(RUN({ wireDeliveries: { w1: 1 }, gate: { wireId: 'w1', fromNode: 'n_a' },
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'start', activeMs: 10, trigger: { wireIds: ['w1'] } }],
    active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }] })));
  applyDecor(view, decorFromState(RUN({ status: 'done', endReached: true, result: { type: 'md', path: '/tmp/p/plan.md' },
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 10 },
      { key: 'x:n_end:1', executionId: 'x:n_end:1', nodeId: 'n_end', ordinal: 1, status: 'done' }] })));
  assert.equal(host.querySelector('.ngate'), null, 'the gate pip is gone');
  assert.equal(host.querySelector('.wfired'), null, 'the badge is gone');
  assert.equal(host.querySelector('path.wire-live'), null, 'nothing marches on a resolved run');
  const endCard = host.querySelector('[data-node-id="n_end"]');
  assert.equal(endCard.querySelector('.xresult a').textContent, 'plan.md');
  assert.equal(endCard.querySelector('.xresult a').dataset.path, '/tmp/p/plan.md');
});

test('a run that finished at quiescence renders End as skipped with no result row', () => {
  const { view, host } = mountView();
  const decor = decorFromState(RUN({ status: 'done', endReached: false }));
  applyDecor(view, decor);
  assert.equal(host.querySelector('[data-node-id="n_end"]').classList.contains('is-skipped'), true);
  assert.equal(host.querySelector('.xresult'), null);
  assert.equal(decor.warnings[0], 'finished at quiescence — End not reached');
});

test('applyDecor: band ORDER is fan → strip → exec → result; the pip and the result land on ONE card each', () => {
  const { view, host } = mountView();
  const st = RUN({
    status: 'done', endReached: true, result: { type: 'md', path: '/tmp/p/plan.md' },
    steps: [
      { key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle', status: 'done', activeMs: 63000, costUsd: 0.12 },
      { key: 'x:n_end:1', executionId: 'x:n_end:1', nodeId: 'n_end', ordinal: 1, status: 'done' },
    ],
    gate: { wireId: 'w1', fromNode: 'n_a', toNode: 'n_end', askId: 'g' },
  });
  const decor = decorFromState(st, { subsOf: (id) => (id === 'n_a' ? [{ status: 'running' }, { status: 'finished' }] : []) });
  applyDecor(view, { ...decor, expanded: 'n_a' });
  const a = host.querySelector('[data-node-id="n_a"]');
  const e = host.querySelector('[data-node-id="n_end"]');
  assert.deepEqual([...a.querySelectorAll('.xfoot > *')].map((n) => n.className.split(' ')[0]), ['fan', 'xtoggle', 'xrow']);
  assert.equal(a.querySelector('.fan .fl').textContent, '×2', 'the sub-agent fan rides the footer');
  assert.equal(a.querySelector('.xrow .xr').textContent, '1m 3s · $0.12', 'the exec row\'s right column is dur · cost');
  assert.equal(a.querySelector('.xresult'), null, 'the result band is End-only');
  assert.deepEqual([...e.querySelectorAll('.xfoot > *')].map((n) => n.className.split(' ')[0]), ['xtoggle', 'xresult'], 'the result band is LAST');
  assert.equal(e.querySelector('.xresult a').textContent, 'plan.md');
  assert.equal(e.querySelector('.ngate'), null, 'the gate pip is FROM-node-only');
  assert.equal(a.querySelector('.ngate').dataset.wireId, 'w1');
  assert.equal(e.querySelector('.nrun'), null, 'a flow card has no header dur · cost');
});

// ── the host adapters ─────────────────────────────────────────────────────────
import { mountRunGraph, STATIC_HOST_H, HINT_TEXT } from '../ui/public/graph/run-hosts.mjs';

function mountHost(mode, w = 800) {
  const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
  const { window } = dom;
  const wrap = window.document.querySelector('.run-flow-wrap');
  const host = window.document.querySelector('.run-flow');
  const m = mountRunGraph(host, { mode, doc: window.document, raf: (fn) => { fn(); return 1; },
    // `viewport` is a FUNCTION, handed verbatim to createGraphView (view.readRect() calls it).
    viewport: () => ({ left: 0, top: 0, width: w, height: mode === 'static' ? STATIC_HOST_H : 520 }),
    onRowClick: (...a) => calls.push(['row', ...a]),
    onGateClick: (...a) => calls.push(['gate', ...a]),
    onResultClick: (...a) => calls.push(['result', ...a]) });
  return { window, wrap, host, m };
}
let calls = [];

// The world's inline transform is the ONE observable the view is guaranteed to
// write (`translate(x, y) scale(z)`); read it rather than assuming a getter.
const xform = (world) => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(world.style.transform || '');
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
};
const zoomOf = (world) => (xform(world) || { z: NaN }).z;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
// A graph 2652px wide (nodes at x 0 and 2400 + NODE_W 220 + 2×16 pad) in an 800px card.
const WIDE = { ...MANIFEST, graph: { nodes: [MANIFEST.graph.nodes[0], { ...MANIFEST.graph.nodes[1], x: 2400 }], wires: MANIFEST.graph.wires } };
// A vertically stacked graph: the HEIGHT (not the width) decides the fit.
const TALL = { ...MANIFEST, graph: { nodes: [MANIFEST.graph.nodes[0], { ...MANIFEST.graph.nodes[1], x: 0, y: 500 }], wires: MANIFEST.graph.wires } };

test('the static host centres a graph that fits (width−32 × 300−32) at ≤ 1×, stamps its classes, reads the manifest for its headers and binds no listeners', () => {
  calls = [];
  const { m, host, wrap, window } = mountHost('static');
  m.update('run1', MANIFEST, decorFromState(RUN()));
  const world = host.querySelector('.gv-world');
  assert.ok(world, 'the world is rendered');
  // bounds(16) = 652×175.5 into 768×268 → z = min(1.178, 1.527) clamped to 1; centred, then inset by 16.
  const t = xform(world);
  assert.equal(t.z, 1, 'fit never magnifies past 1×');
  near(t.x, 90, 'x = 16 + (768 − 652)/2 + 16');
  near(t.y, 78.25, 'y = 16 + (268 − 175.5)/2 + 16');
  assert.equal(host.style.width, '', 'a graph that fits leaves the host at the wrap width');
  assert.equal(host.classList.contains('gv-host'), true, 'the host drops the v1 flex box (style.css .run-flow.gv-host)');
  assert.deepEqual([...wrap.classList], ['run-flow-wrap', 'gv-wrap', 'gv-wrap-static']);
  assert.equal(wrap.querySelector('.rg-hint'), null, 'no hint chip on a static host');
  // Headers come from the MANIFEST (History renders with the registry absent).
  const head = host.querySelector('[data-node-id="n_a"] .nhead');
  assert.equal(head.className, 'nhead h-violet');
  assert.equal(head.querySelector('.tt').textContent, 'Planner');
  const before = world.style.transform;
  host.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true }));
  assert.equal(world.style.transform, before, 'static mode never reacts to pointers');
});

test('a graph wider than the card at the 0.3 floor is LEFT-aligned and widens the host so the wrap scrolls natively', () => {
  calls = [];
  const { m, host } = mountHost('static');
  m.update('run1', WIDE, decorFromState(RUN({ stepper: WIDE })));
  const t = xform(host.querySelector('.gv-world'));
  near(t.z, 0.3, 'the floor');
  // sw = 2652 × 0.3 = 795.6 > 768 → host width = ceil(795.6 + 32); x = 16 − b.x·z = 16 + 16×0.3.
  assert.equal(host.style.width, '828px');
  near(t.x, 20.8, 'left-aligned at the 16px inset, not centred');
});

test('the static fit is capped by STATIC_HOST_H, not just by the width', () => {
  calls = [];
  const { m, host } = mountHost('static');
  m.update('run1', TALL, decorFromState(RUN({ stepper: TALL })));
  const z = zoomOf(host.querySelector('.gv-world'));
  assert.ok(z < 0.5, `a 500px-tall graph must shrink to fit 300−32px, got ${z}`);
});

test('the RENDERED footers feed the fit: each extra band on the bottom card shrinks the static zoom', () => {
  const base = { stepper: TALL, status: 'running', steps: [], active: [], endReached: false,
    result: null, warnings: [], wireDeliveries: {}, tokens: {}, gate: null };
  const zoomFor = (decor) => {
    calls = [];
    const { m, host } = mountHost('static');
    m.update('run1', TALL, decor);
    return zoomOf(host.querySelector('.gv-world'));
  };
  const endRow = { key: 'x:n_end:1', executionId: 'x:n_end:1', nodeId: 'n_end', ordinal: 1, status: 'done' };
  const bare = zoomFor(decorFromState(base));
  const strip = zoomFor(decorFromState({ ...base, steps: [endRow] }));
  const stripResult = zoomFor(decorFromState({ ...base, status: 'done', endReached: true,
    result: { type: 'md', path: '/p/plan.md' }, steps: [endRow] }));
  const fanned = zoomFor(decorFromState({ ...base, status: 'done', endReached: true,
    result: { type: 'md', path: '/p/plan.md' }, steps: [endRow] },
  { subsOf: (id) => (id === 'n_end' ? [{ status: 'done' }] : []) }));
  assert.ok(strip < bare, `strip band must grow the card (${strip} < ${bare})`);
  assert.ok(stripResult < strip, `result band must grow the card (${stripResult} < ${strip})`);
  assert.ok(fanned < stripResult, `fan band must grow the card (${fanned} < ${stripResult})`);
});

test('the monitor host sizes itself clamp(360, fitted + 48, 600) through --run-host-h, shows the hint chip and stamps its classes', () => {
  calls = [];
  const { m, wrap, host } = mountHost('monitor');
  m.update('run1', MANIFEST, decorFromState(RUN()));
  // bounds(24).h = 191.5, zw = 1 → round(191.5) = 192 → floor 360.
  assert.equal(wrap.style.getPropertyValue('--run-host-h'), '360px');
  assert.equal(wrap.querySelector('.rg-hint').textContent, HINT_TEXT);
  assert.equal(wrap.classList.contains('rg-engaged'), false);
  assert.equal(host.classList.contains('gv-host'), true);
  assert.deepEqual([...wrap.classList], ['run-flow-wrap', 'gv-wrap', 'gv-wrap-monitor']);
  assert.equal(host.querySelector('[data-node-id="n_a"] .nhead .tt').textContent, 'Planner');
  // A tall graph hits the 600px ceiling: bounds(24).h = 658.5 → round(658.5) → 600.
  const tall = mountHost('monitor');
  tall.m.update('run1', TALL, decorFromState(RUN({ stepper: TALL })));
  assert.equal(tall.wrap.style.getPropertyValue('--run-host-h'), '600px');
  assert.ok(zoomOf(tall.host.querySelector('.gv-world')) < 1, 'and fits both axes into (800, 600)');
});

test('engagement: pointerdown or focus on the STAGE engages; Escape and an outside pointerdown disengage', () => {
  const { m, wrap, host, window } = mountHost('monitor');
  m.update('run1', MANIFEST, decorFromState(RUN()));
  // P5's nav binds `pointerdown` + `focus` on view.stage (`.gv-stage`), which fills
  // the wrap; an event on the WRAP is on an ancestor and never reaches the stage.
  const stage = m.view.stage;
  assert.ok(host.contains(stage), 'the stage is the engagement surface');
  const down = (id, target) => target.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: id, button: 0, bubbles: true }));
  down(1, stage);
  assert.equal(wrap.classList.contains('rg-engaged'), true);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(wrap.classList.contains('rg-engaged'), false);
  stage.dispatchEvent(new window.FocusEvent('focus'));
  assert.equal(wrap.classList.contains('rg-engaged'), true, 'Tab onto the stage engages too');
  down(3, window.document.body);
  assert.equal(wrap.classList.contains('rg-engaged'), false, 'an outside pointerdown disengages');
});

test('the footer accordion opens ONE node; row / gate / result clicks report out; the result link never navigates', () => {
  calls = [];
  const { m, host, window } = mountHost('monitor');
  const st = RUN({ steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }],
    status: 'done', endReached: true, result: { type: 'md', path: '/tmp/p/plan.md' },
    gate: { wireId: 'w1', fromNode: 'n_a', toNode: 'n_end', askId: 'g' } });
  m.update('run1', MANIFEST, decorFromState(st));
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.xrow').length, 1, 'expanded');
  host.querySelector('.xrow').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  host.querySelector('.ngate').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  host.querySelector('.xresult a').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, 'the chip is an <a href="#">: without preventDefault the click changes the route');
  assert.deepEqual(calls, [['row', 'x:n_a:1', 'n_a'], ['gate', 'w1'], ['result', '/tmp/p/plan.md']]);
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.xrow').length, 0, 'a second click collapses');
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.xrow').length, 1, 'open again');
  m.update('run2', MANIFEST, decorFromState(st));
  assert.equal(host.querySelectorAll('.xrow').length, 0, 'a different run collapses an OPEN accordion');
});

test('a user pan/zoom survives a strip toggle and a decor update; the accordion re-fits only while untouched', () => {
  calls = [];
  const { m, host, window } = mountHost('monitor');
  const st = RUN({ steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }] });
  m.update('run1', MANIFEST, decorFromState(st));
  const world = host.querySelector('.gv-world');
  const fitted = world.style.transform;
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.notEqual(world.style.transform, fitted, 'untouched → the taller card re-fits');
  m.view.setTransform({ x: 5, y: 5, z: 1 });
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(xform(world), { x: 5, y: 5, z: 1 }, 'touched → a toggle leaves the transform alone');
  m.update('run1', MANIFEST, decorFromState({ ...st, status: 'done' }));
  assert.deepEqual(xform(world), { x: 5, y: 5, z: 1 }, 'a decor update never re-fits');
  m.update('run2', MANIFEST, decorFromState(st));
  assert.notDeepEqual(xform(world), { x: 5, y: 5, z: 1 }, 'a NEW run is a new build: it fits again');
});

test('update() re-renders only on a structural change and re-applies the decor only for a NEW bag', () => {
  calls = [];
  const { m, host } = mountHost('monitor');
  const st = RUN({ steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }] });
  const bag = decorFromState(st);
  m.update('run1', MANIFEST, bag);
  const view = m.view;
  const writes = view.stats.wireDUpdates;
  const sum = host.querySelector('.xsum');
  sum.textContent = 'poke';
  m.update('run1', MANIFEST, bag);
  assert.equal(host.querySelector('.xsum').textContent, 'poke', 'the SAME bag is not re-applied');
  assert.equal(view.stats.wireDUpdates, writes, 'and nothing re-renders');
  m.update('run1', MANIFEST, decorFromState(st));
  assert.equal(host.querySelector('.xsum').textContent, '1 run · $0.10', 'a new bag repaints the footer');
  assert.equal(view.stats.wireDUpdates, writes, 'still no render: statuses and footers are fast paths');
  // A node-set change is structural: the view is rebuilt for the new manifest.
  const THREE = { ...MANIFEST, graph: { nodes: [...MANIFEST.graph.nodes, { ...MANIFEST.graph.nodes[0], id: 'n_b', key: 'reviewer', label: 'Reviewer', x: 0, y: 300 }], wires: MANIFEST.graph.wires } };
  m.update('run1', THREE, decorFromState(RUN({ stepper: THREE })));
  assert.equal(host.querySelectorAll('.gv-world .node').length, 3, 'the new node is rendered');
  assert.notEqual(m.view, view, 'a fresh view: its portsFn and headers read the NEW manifest');
});

test('destroy() unbinds everything and gives the host and the wrap back untouched', () => {
  calls = [];
  const { m, host, wrap, window } = mountHost('static');
  m.update('run1', WIDE, decorFromState(RUN({ stepper: WIDE })));
  assert.equal(host.style.width, '828px');
  m.destroy();
  assert.equal(host.querySelector('.gv-world'), null, 'the view is torn down');
  assert.equal(host.style.width, '', 'the inline width is cleared');
  assert.deepEqual([...host.classList], ['run-flow']);
  assert.deepEqual([...wrap.classList], ['run-flow-wrap']);
  const mon = mountHost('monitor');
  mon.m.update('run1', MANIFEST, decorFromState(RUN()));
  const stage = mon.m.view.stage;
  mon.m.destroy();
  assert.equal(mon.wrap.querySelector('.rg-hint'), null, 'the hint chip is gone');
  assert.equal(mon.wrap.style.getPropertyValue('--run-host-h'), '', 'the host height is released');
  assert.deepEqual([...mon.wrap.classList], ['run-flow-wrap']);
  stage.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 9, button: 0, bubbles: true }));
  assert.equal(mon.wrap.classList.contains('rg-engaged'), false, 'the nav listeners are gone');
});

// A host whose measured width TRACKS the inline width the static fit writes —
// what a browser really does (`.gv-stage` is `inset:0` inside `.run-flow.gv-host`,
// so view.readRect() returns the host's own box). The constant viewport above
// cannot see the oscillation this pins.
function mountLiveWidthHost(w = 800) {
  const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
  const { window } = dom;
  const host = window.document.querySelector('.run-flow');
  const m = mountRunGraph(host, { mode: 'static', doc: window.document, raf: (fn) => { fn(); return 1; },
    viewport: () => ({ left: 0, top: 0, width: parseFloat(host.style.width) || w, height: STATIC_HOST_H }) });
  return { window, host, m };
}

test('the static fit is idempotent: it clears its own inline width BEFORE measuring', () => {
  calls = [];
  const { m, host } = mountLiveWidthHost();
  m.update('run1', WIDE, decorFromState(RUN({ stepper: WIDE })));
  const w1 = host.style.width;
  assert.equal(w1, '828px', 'the wide fixture overflows the card, so the host is widened inline');
  const t1 = xform(host.querySelector('.gv-world'));
  m.fit();
  assert.equal(host.style.width, w1, 'a second fit measures the CARD, not the width it just wrote');
  assert.deepEqual(xform(host.querySelector('.gv-world')), t1, 'so the transform is stable too');
  m.fit();
  assert.equal(host.style.width, w1, 'and a third');
});

test('a hidden host (0×0) is never fitted — on EITHER host — and the first paint that sees a box re-fits it', () => {
  calls = [];
  // `display:none` (compact density, a closed detail screen) measures 0×0 in
  // every engine; jsdom's injected viewport says the same.
  const hidden = (mode) => {
    const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
    const { window } = dom;
    const wrap = window.document.querySelector('.run-flow-wrap');
    const host = window.document.querySelector('.run-flow');
    const box = { width: 0 };
    const m = mountRunGraph(host, { mode, doc: window.document, raf: (fn) => { fn(); return 1; },
      viewport: () => ({ left: 0, top: 0, width: box.width,
        height: box.width ? (mode === 'static' ? STATIC_HOST_H : 520) : 0 }) });
    return { window, wrap, host, m, box };
  };

  const mon = hidden('monitor');
  mon.m.update('run1', MANIFEST, decorFromState(RUN()));
  assert.deepEqual(xform(mon.host.querySelector('.gv-world')), { x: 0, y: 0, z: 1 },
    "a 0-width monitor host keeps the view's identity transform: no fit ran");
  assert.equal(mon.wrap.style.getPropertyValue('--run-host-h'), '', 'and its height is not pinned to the 360px floor');
  mon.box.width = 800;
  // NOT structural (same run, same node set) and the bag is new: only the
  // zero→non-zero transition may re-fit here.
  mon.m.update('run1', MANIFEST, decorFromState(RUN()));
  assert.equal(mon.wrap.style.getPropertyValue('--run-host-h'), '360px', 'the reveal re-fits the host');
  assert.equal(zoomOf(mon.host.querySelector('.gv-world')), 1, 'and lays the graph out for the real box');

  const stat = hidden('static');
  stat.m.update('run1', WIDE, decorFromState(RUN({ stepper: WIDE })));
  assert.deepEqual(xform(stat.host.querySelector('.gv-world')), { x: 0, y: 0, z: 1 }, 'the static fitter bails on 0×0 too');
  assert.equal(stat.host.style.width, '', 'and writes no inline width off a 0-width measurement');
  stat.box.width = 800;
  stat.m.update('run1', WIDE, decorFromState(RUN({ stepper: WIDE })));
  assert.equal(stat.host.style.width, '828px', 'the reveal fits the card');
});
test('destroy() re-arms bind(): a re-mounted host delegates clicks again', () => {
  calls = [];
  const { m, host, wrap, window } = mountHost('monitor');
  const st = RUN({ steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }] });
  m.update('run1', MANIFEST, decorFromState(st));
  m.destroy();
  m.update('run1', MANIFEST, decorFromState(st));
  assert.equal(wrap.querySelector('.rg-hint').textContent, HINT_TEXT, 'the hint chip is back');
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.xrow').length, 1, 'the delegated accordion listener was re-bound');
});

// ── app.js: version arms ────────────────────────────────────────────────────
// jsdom boot idiom copied from test/ui-subagent-cycle-split.test.mjs (`boot()`).
async function bootApp() {
  const htmlPath2 = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
  const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
  const dom = new JSDOM(readFileSync(htmlPath2, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}
// A v2 manifest WITH the v1 shim cells a real buildGraphManifest emits (P4–P7),
// so the v1-only helpers (manifestSig, manifestFor) see what they see live.
const WITH_SHIM = { ...MANIFEST, steps: [
  { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
  { kind: 'agents', nodes: [{ id: 'n_a', key: 'planner', uiPhase: 'plan', label: 'Planner', color: 'violet' }] },
  { kind: 'agents', nodes: [{ id: 'n_end', key: null, uiPhase: 'end', label: 'End' }] },
  { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] }], feedbacks: [] };

test('v2 runs take the graph arm of every label helper; v1 runs are untouched', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }],
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'start', activeMs: 10, startedAt: '2026-08-26T10:00:00Z' }],
    endReached: false, result: null, warnings: [], wireDeliveries: {}, gate: null });
  assert.equal(np.isGraphRun(r), true);
  assert.deepEqual(np.activeNodes(r).map((a) => a.nodeId), ['n_a']);
  assert.equal(np.statusPill(r).text, 'Planner');
  assert.equal(np.runDotClass(r), 'violet');
  const label = np.runStepLabel(r);
  assert.deepEqual([label.n, label.m, label.name], [0, 1, 'Planner'], 'n/m are DONE agent nodes over agent nodes');
  // `active` reaches a run model ONLY through onState (app.js's single writer),
  // which bumps the decor generation — activeNodes reads the memoised reducer
  // output, so poking r.active directly would still show the last generation.
  np.onState(r, { status: 'running', stepper: MANIFEST,
    active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }, { nodeId: 'n_a2', executionId: 'x:n_a2:1' }],
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'start', activeMs: 10, startedAt: '2026-08-26T10:00:00Z' }] });
  assert.equal(np.statusPill(r).text, '2 agents running');
  assert.equal(np.rdStateCopy(r, 'Planner'), '2 agents running.');
  // v1 run: the phaseKey switch still rules.
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  v1.phaseKey = 'implement';
  assert.equal(np.isGraphRun(v1), false);
  assert.equal(np.statusPill(v1).text, 'Implementing');
  assert.equal(np.runDotClass(v1), 'blue');
});

test('isGraphRun is false for a REAL v1 stepper object, not just for a null one', async () => {
  const window = await bootApp();
  const np = window.__np;
  const v1 = np.makeRun({ runId: 'r9', title: 't', projectDir: '/p', status: 'running' });
  assert.equal(np.isGraphRun(v1), false, 'a null stepper is not a graph run');
  // A truthiness check (`!!r.stepper`) passes the null case and fails THIS one.
  np.onState(v1, { status: 'running', stepper: { version: 1, steps: [{ kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan' }] }], feedbacks: [] } });
  assert.ok(v1.stepper, 'the v1 manifest was adopted');
  assert.equal(np.isGraphRun(v1), false, 'stepper.version 1 is NOT a graph run');
  v1.phaseKey = 'implement';
  assert.equal(np.statusPill(v1).text, 'Implementing', 'and it keeps the v1 phaseKey switch');
});

test('activeNodes orders in-flight executions newest-first, by executionId-only rows, a composite parent by its slices', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r8', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST,
    steps: [
      { key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'start', activeMs: 10, startedAt: '2026-08-26T10:00:00Z' },
      // a composite parent's slice: the parent x:n_end:1 has NO row of its own
      { key: 'x:n_end:1:p1t1', executionId: 'x:n_end:1:p1t1', nodeId: 'n_end', kind: 'task', parentExecutionId: 'x:n_end:1', ordinal: 1, status: 'start', activeMs: 10, startedAt: '2026-08-26T10:00:09Z' },
      { key: 'preflight', phase: 'preflight', cycle: 0, status: 'done', startedAt: '2026-08-26T10:00:20Z' },   // no executionId: never a row
    ],
    active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }, { nodeId: 'n_end', executionId: 'x:n_end:1' }],
    endReached: false, warnings: [], wireDeliveries: {}, gate: null });
  assert.deepEqual(np.activeNodes(r).map((a) => a.nodeId), ['n_end', 'n_a'], 'newest first, NOT state.active order');
});

test('runDotClass on a v2 run uses the PULSING dot families only', async () => {
  const window = await bootApp();
  const np = window.__np;
  const green = { ...MANIFEST, graph: { ...MANIFEST.graph, nodes: [{ ...MANIFEST.graph.nodes[0], color: 'green' }, MANIFEST.graph.nodes[1]] } };
  const r = np.makeRun({ runId: 'r7', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: green, active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }], steps: [] });
  assert.equal(np.statusPill(r).family, 'green', 'the pill may be green');
  assert.equal(np.runDotClass(r), 'grey-pulse', '.child-dot.green is the STATIC done dot — a live run never wears it');
  np.onState(r, { status: 'running', stepper: green, active: [], steps: [] });
  assert.equal(np.runDotClass(r), 'peach', 'nothing in flight → the Running family');
});

test('runDecorFor is memoised per state generation and per mode: ONE reducer pass, one bag per host', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r6', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });
  const d1 = np.runDecorFor(r, 'static');
  assert.equal(np.runDecorFor(r, 'static'), d1, 'the SAME object for the same mode until the next event');
  assert.equal(d1.mode, 'static');
  assert.equal(d1.run, r);
  assert.equal(d1.runId, 'r6');
  // Each mode gets its OWN shallow copy: the detail's paint must not flip the
  // card's bag to mode 'monitor' (every mounted host holds the bag it was given).
  const dm = np.runDecorFor(r, 'monitor');
  assert.notEqual(dm, d1);
  assert.equal(dm.mode, 'monitor');
  assert.equal(d1.mode, 'static', 'and the static bag is untouched by it');
  assert.equal(np.runDecorFor(r).mode, 'monitor', 'a mode-less caller defaults, never writes mode: undefined');
  assert.equal(dm.footers, d1.footers, 'both copies share ONE reducer pass');
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });
  const d2 = np.runDecorFor(r, 'static');
  assert.notEqual(d2, d1, 'a state event invalidates the bag');
  np.onSubagent(r, { id: 's1', transition: 'spawn', nodeId: 'n_a', stepKey: 'x:n_a:1', status: 'running' });
  assert.notEqual(np.runDecorFor(r, 'static'), d2, 'a subagent delta invalidates it too');
  // finishRun is a generation too: isLive(r) reads _finished/status, and the
  // memoised bag caches live:true (marching ants, pulsing leds).
  const d3 = np.runDecorFor(r, 'monitor');
  assert.equal(d3.live, true);
  np.finishRun(r, 'error');
  const d4 = np.runDecorFor(r, 'monitor');
  assert.notEqual(d4, d3, 'a terminal transition invalidates the bag');
  assert.equal(d4.resolved, true);
  assert.deepEqual(d4.liveWireIds, [], 'nothing marches on a finished run');
});

test('nodeLabelLookup and agentNodeIdSet read a v2 manifest\'s graph.nodes (labels; agent ids only)', async () => {
  const window = await bootApp();
  const np = window.__np;
  const label = np.nodeLabelLookup(MANIFEST);
  assert.equal(label('n_a'), 'Planner');
  assert.equal(label('n_end'), 'End');
  assert.equal(label('nope'), 'nope', 'unknown ids fall back to the id');
  assert.deepEqual([...np.agentNodeIdSet(MANIFEST)], ['n_a'], 'flow nodes are never Agents-dropdown groups');
  // v1 manifests keep today's shim-cell readers.
  const v1 = { version: 1, steps: [{ kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan' }] }], feedbacks: [] };
  assert.equal(np.nodeLabelLookup(v1)('s0_0'), 'Plan');
  assert.deepEqual([...np.agentNodeIdSet(v1)], ['s0_0']);
});
