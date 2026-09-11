// test/ui-run-hosts.test.mjs
// P6a — the DOM half of the run monitor: the view's decor fast paths (consumer-side
// pins of P5's contract), the run-monitor CSS block, applyDecor, the host adapters
// and the app.js version arms. (The artifact routes live in test/api-run-artifact.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

test('setFooter bills LINES, not bands: wrapped fan squares and stacked exec rows grow the card', () => {
  const { view, host } = mountView();
  const card = () => host.querySelector('[data-node-id="n_a"]');
  const h0 = parseFloat(card().style.height);
  // 17 squares wrap onto two 16-per-line rows (.f2): FOOT_H + one extra line.
  view.setFooter('n_a', [{ kind: 'fan', leds: Array(17).fill('done'), count: 32, lines: 2 }]);
  assert.equal(card().querySelector('.xfoot > .fan').className, 'fan f2');
  assert.equal(card().querySelectorAll('.xfoot .fsq > .sq').length, 17, 'squares live in the wrapping .fsq column');
  assert.equal(card().querySelector('.fan .fl').textContent, '×32');
  assert.equal(parseFloat(card().style.height), h0 + 26 + 22);
  // A stacked exec row bills 2 lines, a two-line-label row 3 — and the classes drive the CSS grid.
  view.setFooter('n_a', [
    { kind: 'strip', leds: ['done'], summary: '2 runs · $33.43', expanded: true },
    { kind: 'exec', executionId: 'x:n_a:1', led: 'done', label: 'cycle 2 · revise', right: '20m 42s · $31.98', units: 2, stack: true, l2: false },
    { kind: 'exec', executionId: 'x:n_a:2', led: 'done', label: 'Link FirebaseAI, plist setup + smoke tes…', right: '12m 28s · $1.45', units: 3, stack: true, l2: true },
  ]);
  assert.equal(parseFloat(card().style.height), h0 + 26 + 2 * 22 + 3 * 22, 'strip 1 + stacked 2 + l2 3 lines');
  const rows = [...card().querySelectorAll('.xrow')];
  assert.equal(rows[0].className, 'xrow is-done stack');
  assert.equal(rows[1].className, 'xrow is-done stack l2');
  // The in-place sync path (same executionId, layout changed) must converge too.
  view.setFooter('n_a', [
    { kind: 'strip', leds: ['done'], summary: '2 runs · $33.43', expanded: true },
    { kind: 'exec', executionId: 'x:n_a:1', led: 'done', label: 'cycle 2', right: '20m 42s · $31.98', units: 1, stack: false, l2: false },
    { kind: 'exec', executionId: 'x:n_a:2', led: 'done', label: 'Link FirebaseAI, plist setup + smoke tes…', right: '12m 28s · $1.45', units: 3, stack: true, l2: true },
  ]);
  assert.equal([...card().querySelectorAll('.xrow')][0].className, 'xrow is-done');
  assert.equal(parseFloat(card().style.height), h0 + 26 + 22 + 3 * 22);
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
    '.run-flow.gv-host .gv-wires path.wire-live', '.rd-graph.settled .run-flow.gv-host .gv-wires path.wire-live{animation:none;stroke-dashoffset:0;}',
    '.run-flow.gv-host .wbadge:not(:has(> .wfired))', '.run-flow.gv-host .gv-world .xfoot>.fan{', '--run-host-h', '.run-warn{', '.rg-hint{',
    '.rg-hint{position:absolute;left:12px;',
    '.gv-wrap-monitor .run-flow.gv-host .gv-world .node{cursor:grab;}',
    '.gv-wrap-monitor .run-flow.gv-host .gv-stage{cursor:grab;}',
    '.gv-wrap-monitor .run-flow.gv-host .gv-stage.panning,.gv-wrap-monitor .run-flow.gv-host .gv-stage.panning *{cursor:grabbing !important;}',
    '.run-flow-wrap.gv-wrap-monitor > .gv-nav{right:12px;bottom:12px;}']) {
    assert.ok(css.includes(sel), `${sel} must be written`);
  }
  for (const kf of ['@keyframes wireDash', '@keyframes sqPulse', '@keyframes nodeGlow{', '@keyframes xqPulse']) {
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
  assert.match(css, /\.run-flow\.gv-host \.gv-wires path\.wire-live\{[^}]*stroke-dasharray[^}]*animation:wireDash \.6s linear infinite[^}]*\}/,
    'the ants rule itself must dash the wire and own the marching animation (the settled/reduced-motion arms are not it)');
  assert.match(css, /\.run-flow\.gv-host \.gv-world \.node\.is-error\{[^}]*border-color[^}]*\}/,
    'the is-error card must get its own border colour (the ::after pip rules are not it)');
  assert.match(css, /(^|\n)\.rg-hint\{[^}]*position:absolute[^}]*opacity:0[^}]*\}/,
    'the hint chip rule itself (the :hover / .rg-engaged arms only toggle its opacity)');
  assert.equal(css.includes('rg-engaged'), false, 'the engagement arm is gone with the state machine');
  // The v1 `.run-flow .node .fan` rule (same specificity, earlier) leaks margin-top + border-top onto the 26px band.
  const fan = (css.match(/\.run-flow\.gv-host \.gv-world \.xfoot>\.fan\{[^}]*\}/) || [''])[0];
  assert.ok(/margin:0/.test(fan) && /border-top:0/.test(fan), 'the fan neutraliser resets margin + border');
  // Appended at the END: the 3–4-class v1 rules tie P5's block, so source order must win (A32 deviation).
  assert.ok(css.indexOf('.run-flow.gv-host{') > css.indexOf('/* v2 composer shell'), 'the P6 block follows the composer block');
  // Spelled WITHOUT the space, so the ask-dock arm stays the LAST with-space block (test/ui-ask-style.test.mjs).
  assert.ok(css.lastIndexOf('@media (prefers-reduced-motion:reduce)') > css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
});

test('the ants march per path — a seamless 12px loop, no :root clock', () => {
  // One iteration travels exactly one 6+6 dash period (12px), so the loop
  // boundary — and any restart when wire-live flips on — is invisible; phase
  // parity across wires comes from setWireLive's negative animation-delay
  // (test/ui-graph-view.test.mjs), not from a shared :root clock. Animating an
  // inherited registered custom property on :root forced a whole-document
  // style recalc per frame (the 2026-08-31 run-detail freeze) and must never
  // come back. jsdom evaluates neither @property nor animations, so pin the
  // stylesheet TEXT.
  assert.equal(css.includes('@property --wire-dash'), false, 'the :root clock property is fully retired');
  assert.equal(css.includes('--wire-dash'), false, 'nothing reads the retired clock variable');
  assert.equal(css.includes(':root{animation'), false, 'nothing may ever animate :root');
  assert.equal(css.split('@keyframes wireDash{to{stroke-dashoffset:-12px;}}').length - 1, 1,
    'one iteration travels exactly one dash period, on the path property itself');
  assert.equal(css.includes('wireFlow'), false, 'the snapping keyframe is fully retired');
  const ants = (css.match(/\.run-flow\.gv-host \.gv-wires path\.wire-live\{[^}]*\}/) || [''])[0];
  assert.ok(ants.includes('animation:wireDash .6s linear infinite'), 'the path owns the marching animation (-12px per .6s keeps 20px/s)');
  assert.ok(ants.includes('stroke-dasharray:6 6'), 'the 6+6 dash IS the 12px period the keyframe travels');
  assert.ok(!ants.includes('stroke-dashoffset'), 'the base rule sets no offset — the keyframe animates from the initial 0');
  // The kill-switches: both settled shapes and reduced motion stop the path's
  // animation and pin the phase at 0.
  assert.ok(css.includes('.rd-graph.settled .run-flow .wires path.wire-live{animation:none;stroke-dashoffset:0;}'),
    'the v1-shaped settled arm pins the phase too');
  assert.ok(css.includes('.rd-graph.settled .run-flow.gv-host .gv-wires path.wire-live{animation:none;stroke-dashoffset:0;}'),
    'the v2 settled arm pins the phase too');
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion:reduce)'));
  assert.equal(reduced.includes(':root{animation:none;}'), false, 'no :root clock left for reduced motion to stop');
  assert.ok(reduced.includes('.run-flow.gv-host .gv-wires path.wire-live{stroke-dashoffset:0;}'),
    'reduced motion pins the phase on the path');
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

test('applyDecor wires the layout through: capped strip leds, wrapped fan, stacked slice rows', () => {
  const { view, host } = mountView();
  const steps = Array.from({ length: 7 }, (_, i) => ({ key: `x:n_a:${i + 1}`, executionId: `x:n_a:${i + 1}`,
    nodeId: 'n_a', ordinal: i + 1, kind: 'cycle', status: 'done', activeMs: 63000, costUsd: 0.12 }));
  steps.push({ key: 'x:n_a:8:t', executionId: 'x:n_a:8:t', nodeId: 'n_a', ordinal: 8, kind: 'task',
    title: 'Link FirebaseAI, plist setup and smoke test wiring', parentExecutionId: 'x:n_a:8',
    status: 'done', activeMs: 748000, costUsd: 1.45 });
  const decor = decorFromState(RUN({ status: 'done', steps }),
    { subsOf: (id) => (id === 'n_a' ? Array.from({ length: 32 }, () => ({ status: 'finished' })) : []) });
  applyDecor(view, { ...decor, expanded: 'n_a' });
  const a = host.querySelector('[data-node-id="n_a"]');
  assert.equal(a.querySelectorAll('.xsq .xq').length, 6, '8 runs → 6 strip leds, the summary text carries the tail');
  assert.equal(a.querySelector('.xsum').textContent, '8 runs · $2.29');
  assert.equal(a.querySelector('.xfoot > .fan').className, 'fan f2', '24 capped squares wrap onto two lines');
  assert.equal(a.querySelectorAll('.fsq > .sq').length, 24);
  assert.equal(a.querySelector('.fl').textContent, '×32');
  const rows = [...a.querySelectorAll('.xrow')];
  assert.equal(rows[0].className, 'xrow is-done', 'a short cycle row keeps its one compact line');
  assert.equal(rows[7].className, 'xrow is-done stack l2', 'the truncated 40-char slice title takes two clamped lines');
  assert.equal(rows[7].querySelector('.xr').textContent, '12m 28s · $1.45');
});

test('the stacked-row / wrapped-fan CSS exists and keeps every height on the --gv-* rhythm', () => {
  for (const sel of ['.gv-world .xfoot>:first-child{height:var(--gv-foot-h);}',
    '.gv-world .xfoot>.fan.f2{height:calc(var(--gv-foot-h) + var(--gv-exec-row-h));}',
    '.gv-world .xfoot>.xrow.stack{height:calc(2*var(--gv-exec-row-h));',
    '.gv-world .xfoot>.xrow.stack.l2{height:calc(3*var(--gv-exec-row-h));}',
    '-webkit-line-clamp:2', '.gv-world .xfoot .fsq{']) {
    assert.ok(css.includes(sel), `${sel} must be written`);
  }
  // The squares must never shrink again, and dur · cost must never wrap mid-text.
  assert.match(css, /\.gv-world \.xfoot \.xq,\.gv-world \.xfoot \.sq\{[^}]*flex:0 0 auto[^}]*\}/);
  assert.match(css, /\.gv-world \.xfoot \.xr,\.gv-world \.xfoot \.fl\{[^}]*white-space:nowrap[^}]*\}/);
  assert.ok(css.includes('flex:0 0 var(--gv-fan-w)'), 'the fan column is the shared FAN_ROW_W');
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
    onResultClick: (...a) => calls.push(['result', ...a]),
    onNodeClick: (...a) => calls.push(['node', ...a]) });
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
  assert.equal(wrap.className.includes('rg-engaged'), false, 'there is no engagement state any more');
  assert.equal(host.classList.contains('gv-host'), true);
  assert.deepEqual([...wrap.classList], ['run-flow-wrap', 'gv-wrap', 'gv-wrap-monitor']);
  assert.equal(host.querySelector('[data-node-id="n_a"] .nhead .tt').textContent, 'Planner');
  // A tall graph hits the 600px ceiling: bounds(24).h = 658.5 → round(658.5) → 600.
  const tall = mountHost('monitor');
  tall.m.update('run1', TALL, decorFromState(RUN({ stepper: TALL })));
  assert.equal(tall.wrap.style.getPropertyValue('--run-host-h'), '600px');
  assert.ok(zoomOf(tall.host.querySelector('.gv-world')) < 1, 'and fits both axes into (800, 600)');
});

test('the monitor canvas never captures the page scroll: no engagement class, and the hint chip says what the gestures are', () => {
  const { m, wrap, host, window } = mountHost('monitor');
  m.update('run1', MANIFEST, decorFromState(RUN()));
  const stage = m.view.stage;
  assert.ok(host.contains(stage), 'the stage is the gesture surface');
  stage.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, button: 0, bubbles: true }));
  stage.dispatchEvent(new window.FocusEvent('focus'));
  assert.equal(wrap.className.includes('rg-engaged'), false, 'engagement is gone for good');
  const plain = new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  stage.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false, 'a plain wheel scrolls the PAGE, even after a press');
  assert.equal(wrap.querySelector('.rg-hint').textContent, 'drag to pan · ⌘/ctrl+scroll to zoom');
  assert.equal(wrap.querySelector('.rg-hint').textContent, HINT_TEXT);
});

test('the monitor host mounts the nav cluster: 1.2x steps about the host centre, clamped and disabled at the stops, Center = zoom-to-fit', () => {
  calls = [];
  const { m, wrap, host, window } = mountHost('monitor');
  m.update('run1', MANIFEST, decorFromState(RUN()));
  const nav = wrap.querySelector(':scope > .gv-nav');
  assert.ok(nav, 'the cluster is a SIBLING of the stage, on the wrap');
  assert.deepEqual([...nav.querySelectorAll('button')].map((b) => b.dataset.nav), ['in', 'out', 'center']);
  assert.equal(nav.querySelector('[data-nav="center"]').title, 'Fit graph to view');
  assert.equal(host.querySelector('.gv-nav'), null, 'and never inside the stage');
  const btn = (k) => nav.querySelector(`[data-nav="${k}"]`);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const world = host.querySelector('.gv-world');
  const fitted = xform(world);
  // mountHost injects an 800x520 viewport, so the host centre is (400, 260).
  const worldAt = (t, sx, sy) => ({ x: (sx - t.x) / t.z, y: (sy - t.y) / t.z });
  const w0 = worldAt(fitted, 400, 260);
  click(btn('in'));
  near(zoomOf(world), fitted.z * 1.2, 'z x 1.2');
  const w1 = worldAt(xform(world), 400, 260);
  near(w1.x, w0.x, 'the world point under the host centre never moves');
  near(w1.y, w0.y, 'nor on y');
  click(btn('out'));
  near(zoomOf(world), fitted.z, 'and back');
  for (let i = 0; i < 12; i += 1) click(btn('in'));
  near(zoomOf(world), 1.6, 'clamped at the monitor zoomMax');
  assert.equal(btn('in').disabled, true, 'a button that cannot move is disabled');
  assert.equal(btn('out').disabled, false);
  for (let i = 0; i < 24; i += 1) click(btn('out'));
  near(zoomOf(world), 0.3, 'clamped at the monitor zoomMin');
  assert.equal(btn('out').disabled, true);
  assert.equal(btn('in').disabled, false);
  // Center is a zoom-to-FIT: it restores exactly what the auto-fit computes, and
  // re-derives --run-host-h on the way (it runs the same two-pass fitMonitor).
  m.view.setTransform({ x: 999, y: -400, z: 0.9 });
  click(btn('center'));
  assert.deepEqual(xform(world), fitted, 'Center restores the fit transform exactly');
  assert.equal(btn('out').disabled, false, 'and the cluster repaints');
  assert.equal(wrap.style.getPropertyValue('--run-host-h'), '360px', 'the host height survives the round trip');
});

test('a drag pans the monitor host, keeps its pan through a repaint, and Center hands the auto re-fit back', () => {
  calls = [];
  const { m, wrap, host, window } = mountHost('monitor');
  const st = RUN({ steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }] });
  m.update('run1', MANIFEST, decorFromState(st));
  const world = host.querySelector('.gv-world');
  const fitted = xform(world);
  const stage = m.view.stage;
  // `buttons: 1` is what a real drag reports on every move; a move with no button
  // is a release this document never saw, and the nav drops the gesture (D17).
  const pe = (type, o) => new window.PointerEvent(type, { pointerId: 4, buttons: 1, bubbles: true, cancelable: true, ...o });
  stage.dispatchEvent(pe('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
  window.document.dispatchEvent(pe('pointermove', { clientX: 160, clientY: 130 }));
  window.document.dispatchEvent(pe('pointerup', { clientX: 160, clientY: 130 }));
  assert.deepEqual(xform(world), { x: fitted.x + 60, y: fitted.y + 30, z: fitted.z }, 'the drag panned by the delta');
  // That drag swallows exactly one click (view.mjs): spend it before using the accordion.
  stage.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.xrow').length, 1, 'the delegated accordion click survived the drag');
  assert.equal(xform(world).x, fitted.x + 60, 'a touched view keeps its pan while the card grows');
  wrap.querySelector(':scope > .gv-nav [data-nav="center"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const centred = xform(world);
  m.fit();
  assert.deepEqual(xform(world), centred, 'Center left the view exactly at the fit of the TALLER graph');
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
  // `buttons: 1`: onMove drops a button-less move before it can ever add .panning
  // (D17), so without it this would pass against a live, non-destroyed nav.
  mon.window.document.dispatchEvent(new window.PointerEvent('pointermove', { pointerId: 9, buttons: 1, clientX: 200, clientY: 200, bubbles: true }));
  assert.equal(stage.classList.contains('panning'), false, 'the nav listeners are gone');
  assert.equal(mon.wrap.querySelector('.gv-nav'), null, 'the cluster is gone too');
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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}
// A v2 manifest WITH the v1 shim cells a real buildGraphManifest emits (P4–P7),
// so the v1-only helper (manifestFor) sees what it sees live.
const WITH_SHIM = { ...MANIFEST, steps: [
  { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
  { kind: 'agents', nodes: [{ id: 'n_a', key: 'planner', uiPhase: 'plan', label: 'Planner', color: 'violet' }] },
  { kind: 'agents', nodes: [{ id: 'n_end', key: null, uiPhase: 'end', label: 'End' }] },
  { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] }], feedbacks: [] };

test('every label helper reads the graph; a run with no manifest reads plainly "Running"', async () => {
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
  // An error pause names its cause; any OTHER reason is the orchestrator's own
  // free text (a usage-limit line); a reasonless pause is still "Paused by you".
  assert.match(np.rdStateCopy({ ...r, status: 'paused', pauseReason: 'error', pauseDetail: 'claude exited with code 1: disk full' }, 'Planner'),
    /^Paused after an error: claude exited with code 1: disk full\. Fix the cause, then Resume/);
  assert.match(np.rdStateCopy({ ...r, status: 'paused', pauseReason: "You've hit your session limit · resets 6pm" }, 'Planner'),
    /^Paused — You've hit your session limit · resets 6pm\./);
  assert.match(np.rdStateCopy({ ...r, status: 'paused', pauseReason: null }, 'Planner'), /^Paused by you\./);
  // A run whose manifest has not arrived yet: no active agent to name, and the
  // v1 phaseKey switch that used to name a phase is gone.
  const bare = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  assert.equal(np.isGraphRun(bare), false);
  assert.equal(np.statusPill(bare).text, 'Running');
  assert.equal(np.runDotClass(bare), 'peach');
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
  assert.equal(np.statusPill(v1).text, 'Running', 'and a frozen v1 run names no agent');
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

// ── paintGraphFor + the three hosts ─────────────────────────────────────────
function hostPair(doc) {
  const host = doc.createElement('div'); host.className = 'run-flow';
  const wrap = doc.createElement('div'); wrap.className = 'run-flow-wrap'; wrap.appendChild(host);
  doc.body.appendChild(wrap);
  return host;
}
const V1_STEPPER = { version: 1, steps: [{ kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan' }] }], feedbacks: [] };

test('paintGraphFor routes by stepper.version, mounts the v2 renderer once per host, and its v1 arm is the frozen chip strip', async () => {
  const window = await bootApp();
  const np = window.__np;
  const doc = window.document;
  const host = hostPair(doc);
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [], endReached: false, warnings: [], wireDeliveries: {}, gate: null });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'), []);
  assert.ok(host.querySelector('.gv-world'), 'v2 manifest → the graph renderer');
  assert.equal(host.querySelector('.run-strip'), null, 'the frozen strip never paints for a v2 manifest');
  const world = host.querySelector('.gv-world');
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }], steps: [] });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'), []);
  assert.equal(host.querySelector('.gv-world'), world, 'a repaint reuses the mount');
  assert.ok(host.querySelector('[data-node-id="n_a"]').classList.contains('is-active'), 'and applies the new bag');
  // A v1 manifest in a FRESH host: the INERT frozen chip strip, never the graph.
  // `decor` is null on every v1 call site, so the strip takes the ledger rows as
  // paintGraphFor's 4th argument instead.
  const host2 = hostPair(doc);
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  np.onState(v1, { status: 'running', stepper: V1_STEPPER });
  np.paintGraphFor(host2, v1.stepper, null, [{ key: 'plan', phase: 'plan', status: 'done', activeMs: 1000 }]);
  assert.equal(host2.querySelector('.gv-world'), null, 'v1 never reaches the graph renderer');
  const strip = host2.querySelector('.run-strip');
  assert.ok(strip, 'the frozen chip strip painted');
  assert.equal(strip.querySelector('.rchip[data-id="s0_0"]').textContent, 'Plan \u00b7 1s');
  // No stepper at all: the host is emptied, never left holding a stale paint.
  const host3 = hostPair(doc);
  np.paintGraphFor(host3, null, null, []);
  assert.equal(host3.children.length, 0);
});

test('destroyGraphMounts tears down every mount under a root; the next paint mounts afresh', async () => {
  const window = await bootApp();
  const np = window.__np;
  const host = hostPair(window.document);
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  const world = host.querySelector('.gv-world');
  np.destroyGraphMounts(window.document.body);
  assert.equal(host.querySelector('.gv-world'), null, 'the view is gone');
  assert.equal(host.classList.contains('gv-host'), false, 'the host class is released');
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.ok(host.querySelector('.gv-world'), 'a fresh mount');
  assert.notEqual(host.querySelector('.gv-world'), world);
});

// ── the app-level retune wiring (Task 7) ─────────────────────────────────────
async function liveGraph(stepper = MANIFEST) {
  const window = await bootApp();
  const np = window.__np;
  const host = hostPair(window.document);
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper, active: [], steps: [] });
  return { window, np, host, r, doc: window.document };
}
const clickCard = (window, host, id = 'n_a') =>
  host.querySelector(`[data-node-id="${id}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

test('a card click on the LIVE detail graph opens the retune popover', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host);
  const pop = doc.querySelector('.rt-pop');
  assert.ok(pop, 'the popover opened for an agent card on a running run');
  assert.match(pop.textContent, /n_a/, 'and it is pointed at the node that was clicked');
});

test('destroyGraphMounts closes the retune popover: it must not outlive its host', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host);
  assert.ok(doc.querySelector('.rt-pop'), 'open first');
  // The panel is appended to document.body at z-index 70, so a screen teardown
  // that leaves it there floats it over the NEXT screen, anchored to a card that
  // is no longer in the document, with Apply still live.
  np.destroyGraphMounts(doc.body);
  assert.equal(doc.querySelector('.rt-pop'), null, 'the teardown takes the popover with it');
});

test('destroyGraphMounts leaves a popover anchored OUTSIDE the root it is tearing down', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host);
  assert.ok(doc.querySelector('.rt-pop'), 'open first');
  // This function also runs for the HISTORY host (closeHistDetail). Closing on a
  // teardown of a graph the popover is not anchored in would throw away the
  // user's in-progress model/effort edit on the live detail behind it.
  const elsewhere = doc.createElement('div');
  doc.body.appendChild(elsewhere);
  np.destroyGraphMounts(elsewhere);
  assert.ok(doc.querySelector('.rt-pop'), 'an unrelated teardown leaves the edit alone');
});

test('a FLOW card opens the popover too, and the cursor rule agrees with it', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  const flow = [...host.querySelectorAll('.node[data-node-id]')]
    .find((el) => !el.classList.contains('node-agent'));
  assert.ok(flow, 'the fixture manifest has a flow card');
  flow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const pop = doc.querySelector('.rt-pop');
  assert.ok(pop, 'a flow card explains itself rather than being a dead click');
  assert.match(pop.textContent, /Flow cards spawn nothing/);
  // The cursor opt-in must cover the same cards; scoping it to `.node-agent` left
  // this one looking inert while still opening a panel.
  assert.ok(css.includes('.gv-world .node[data-node-id]{cursor:pointer;}'));
});

test('an EFFORT with no model still gets a caption — it is in the argv', async () => {
  const window = await bootApp();
  const np = window.__np;
  // buildGraphManifest fills `effort` independently of `model`, and _execCtx passes
  // it to the CLI whether or not a model is set, so `--effort high` is genuinely
  // there. Dropping the caption would stop the card reporting a real flag.
  assert.equal(np.modelEffortText({ model: '', effort: 'high' }), 'default · high');
  assert.equal(np.modelEffortText({ model: '', effort: '' }), '', 'pure inherit still says nothing');
  assert.equal(np.modelEffortText(null), '');
  const tuned = { ...MANIFEST, graph: { ...MANIFEST.graph,
    nodes: [{ ...MANIFEST.graph.nodes[0], model: '', effort: 'high' }, MANIFEST.graph.nodes[1]] } };
  assert.deepEqual(np.tuneByNode(tuned), { n_a: { model: '', effort: 'high', retuned: false } },
    'and the shared manifest read keeps the node');
});

test('a card that opens a panel says so to assistive tech', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  const card = host.querySelector('[data-node-id="n_a"]');
  // It swallows Enter/Space and mounts a role="dialog" elsewhere in the DOM. A
  // bare tabindex div announces none of that: `cursor:pointer` is the sighted half
  // of the affordance, this is the other half.
  assert.equal(card.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(card.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(card.getAttribute('aria-expanded'), 'false');
  clickCard(window, host, 'n_a');
  assert.equal(card.getAttribute('aria-expanded'), 'true', 'only the popover knows when it is up');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(card.getAttribute('aria-expanded'), 'false');
});

test('History and a settled run make no such promise, though they mount the same host', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  const card = () => host.querySelector('[data-node-id="n_a"]');

  // History mounts mode 'monitor' with onNodeClick wired and never opens anything,
  // so "a callback was passed" is not the question — the screen is.
  np.paintGraphFor(host, r.stepper, Object.assign({}, np.runDecorFor(r, 'monitor'), { record: { runId: 'r1' } }));
  assert.equal(card().getAttribute('aria-haspopup'), null, 'History cards are not triggers');

  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.equal(card().getAttribute('aria-haspopup'), 'dialog', 'the live detail is');

  // And it goes away when the run does — the same moment the stylesheet's
  // `:not(.settled)` drops the pointer cursor.
  r.status = 'done';
  r._decorSeq = (r._decorSeq || 0) + 1;
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.equal(card().getAttribute('aria-haspopup'), null);
  assert.equal(card().getAttribute('aria-expanded'), null);
  void window; void doc;
});

test('a card whose dialog is still OPEN keeps its trigger relationship', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host, 'n_a');
  const card = host.querySelector('[data-node-id="n_a"]');
  assert.equal(card.getAttribute('aria-expanded'), 'true');

  // The run ends. The panel does NOT close — it swaps to a note — so stripping the
  // trigger here would leave a live role="dialog" on document.body that nothing
  // points at, and rob the popover's own close() of the attribute it resets.
  r.status = 'done';
  r._decorSeq = (r._decorSeq || 0) + 1;
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.ok(doc.querySelector('.rt-pop'), 'the panel is still up');
  assert.equal(card.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(card.getAttribute('aria-expanded'), 'true');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(card.getAttribute('aria-expanded'), 'false', 'the popover resets it on close');
});

test('the skipped card is revisited once its dialog closes', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host, 'n_a');
  const card = host.querySelector('[data-node-id="n_a"]');

  r.status = 'done';
  r._decorSeq = (r._decorSeq || 0) + 1;
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.equal(card.getAttribute('aria-haspopup'), 'dialog', 'kept while its dialog is up');

  // Recording that pass as done would short-circuit every later call and leave
  // this card announcing itself as a trigger for good — long after the popover
  // closed and the cursor rule stopped offering it.
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  r._decorSeq = (r._decorSeq || 0) + 1;
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.equal(card.getAttribute('aria-haspopup'), null);
  assert.equal(card.getAttribute('aria-expanded'), null);
});

test('a static host mounts no panel, so its cards make no such promise', () => {
  const { host, m } = mountHost('static');
  m.update('r1', MANIFEST, { nodeIds: ['n_a'], wireIds: [], status: {}, colors: {}, footers: {}, totals: {} });
  const card = host.querySelector('[data-node-id="n_a"]');
  assert.equal(card.getAttribute('aria-haspopup'), null);
});

test('an auto-repeat verdict belongs to the card it was decided for', () => {
  calls = [];
  const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
  const { window } = dom;
  const host = window.document.querySelector('.run-flow');
  const THREE = { ...MANIFEST, graph: { ...MANIFEST.graph,
    nodes: [MANIFEST.graph.nodes[0], { ...MANIFEST.graph.nodes[0], id: 'n_c', y: 300 }, MANIFEST.graph.nodes[1]] } };
  // Declines for n_a, accepts for n_c. A single per-host flag let a repeat that
  // arrived after focus moved apply one card's verdict to the other.
  const m = mountRunGraph(host, { mode: 'monitor', doc: window.document, raf: (fn) => { fn(); return 1; },
    viewport: () => ({ left: 0, top: 0, width: 900, height: 520 }),
    onNodeClick: (id) => { calls.push(id); return id !== 'n_a'; } });
  m.update('r1', THREE, { nodeIds: ['n_a', 'n_c', 'n_end'], wireIds: [], status: {}, colors: {}, footers: {}, totals: {} });
  const a = host.querySelector('[data-node-id="n_a"]');
  const c = host.querySelector('[data-node-id="n_c"]');
  c.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  const strayRepeat = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, repeat: true });
  a.dispatchEvent(strayRepeat);
  assert.equal(strayRepeat.defaultPrevented, false, "n_c's verdict is not n_a's");
});

test('a node retuned back to INHERIT keeps its pill, marked', async () => {
  const window = await bootApp();
  const np = window.__np;
  const host = hostPair(window.document);
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: '', status: 'running' });
  // The engine stamps `retuned` and clears model/effort. Without the marker
  // carrying its own caption the pill vanishes — and with it the only record, on
  // History, that this node did not always run on what it ended up inheriting.
  const cleared = { ...MANIFEST, graph: { ...MANIFEST.graph,
    nodes: [{ ...MANIFEST.graph.nodes[0], model: '', effort: '', retuned: true }, MANIFEST.graph.nodes[1]] } };
  np.onState(r, { status: 'running', stepper: cleared, active: [], steps: [] });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'), []);
  const pill = host.querySelector('[data-node-id="n_a"] .ntune');
  assert.ok(pill, 'the pill survives the clear');
  assert.equal(pill.textContent, 'inherit');
  assert.equal(pill.classList.contains('is-retuned'), true);
  assert.match(pill.title, /changed during the run/);
  // A node nobody touched and nothing configured still paints nothing.
  assert.equal(np.modelEffortText({ model: '', effort: '' }), '');
});

test('a pill clipped by its own max-width still has a tooltip', async () => {
  const window = await bootApp();
  const np = window.__np;
  const host = hostPair(window.document);
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: '', status: 'running' });
  const long = { ...MANIFEST, graph: { ...MANIFEST.graph,
    nodes: [{ ...MANIFEST.graph.nodes[0], model: 'anthropic/claude-opus-5-20260101-1m', effort: 'max' },
      MANIFEST.graph.nodes[1]] } };
  np.onState(r, { status: 'running', stepper: long, active: [], steps: [] });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'), []);
  // `.gv-world .ntune` is max-width + ellipsis, and the graph has no other surface
  // that spells the model out.
  const pill = host.querySelector('[data-node-id="n_a"] .ntune');
  assert.equal(pill.title, 'anthropic/claude-opus-5-20260101-1m · max');
});

test('the .ntune pill is a MONITOR ornament: the clipped list card does not paint it', async () => {
  const { np, host, r } = await liveGraph(TUNED);
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'), []);
  assert.ok(host.querySelector('[data-node-id="n_a"] .ntune'), 'the run detail shows it');

  // The Running-list card mounts 'static': its wrap is a fixed 300px with
  // overflow-y:hidden and the pill hangs at bottom:-9px, outside view.bounds(), so
  // the fit reserves no room and the bottom row's pill would be clipped. That card
  // already prints the same words in its step label.
  const staticHost = hostPair(host.ownerDocument);
  np.paintGraphFor(staticHost, r.stepper, np.runDecorFor(r, 'static'), []);
  assert.equal(staticHost.querySelector('[data-node-id="n_a"] .ntune'), null);
  // The bag is SHARED across modes, so the entry is still there — only the paint
  // is gated.
  assert.ok(np.runDecorFor(r, 'static').tune.n_a.text);
});

test('the .ntune pill is stacked and click-through, so it cannot hide or steal the footer', () => {
  // It straddles the card's bottom edge and `.xfoot` is bottom:0 with an opaque
  // background, so they share 9px of a 22px band.
  const rule = /\.gv-world \.ntune\{([^}]*)\}/.exec(css);
  assert.ok(rule, '.ntune is declared');
  assert.match(rule[1], /z-index:3/, 'without it the winner is DOM insertion order');
  assert.match(rule[1], /pointer-events:none/, 'a click in the overlap belongs to .xrow / .xresult a');
});

test('History and a terminal run never open it (the guard lives inside onNodeClick)', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  // History mounts mode 'monitor' too and always supplies onNodeClick; `record`
  // on the bag is what tells the two screens apart (app.js:11439).
  np.paintGraphFor(host, r.stepper, Object.assign({}, np.runDecorFor(r, 'monitor'), { record: { runId: 'r1' } }));
  clickCard(window, host);
  assert.equal(doc.querySelector('.rt-pop'), null, "History's graph is read-only");

  const host2 = hostPair(doc);
  r.status = 'done';                       // RETUNE_DEAD_STATUS: nothing will dispatch again
  np.paintGraphFor(host2, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host2);
  assert.equal(doc.querySelector('.rt-pop'), null, 'a finished run has nothing left to retune');
});

// `tune` is read straight off the MANIFEST cell (run-decor.mjs#tuneByNode), which
// is what a live retune patches (manifest.mjs#patchManifestNodeTune).
const TUNED = { ...MANIFEST, graph: { ...MANIFEST.graph,
  nodes: [{ ...MANIFEST.graph.nodes[0], model: 'claude-opus-5', effort: 'high' }, MANIFEST.graph.nodes[1]] } };

test('the tune pill label is resolved INSIDE the memoised bag, not stamped on afterwards', async () => {
  const { np, host, r } = await liveGraph(TUNED);
  const shared = np.runDecorFor(r, 'monitor');
  assert.ok(shared.tune.n_a, 'the manifest cell produced a tune entry');
  // decorFromState takes the app's formatter (`tuneText: modelEffortText`), so the
  // caption is part of the reducer's output. Nothing mutates the bag after the
  // fact: it is documented as IMMUTABLE and shared across every host, and
  // run-hosts skips paint() outright on an unchanged bag identity, so a caption
  // written into it later could not reach the DOM anyway.
  assert.equal(shared.tune.n_a.text, 'claude-opus-5 · high',
    'no catalog in this harness (state.models is []), so the label falls back to the raw id');
  np.paintGraphFor(host, r.stepper, shared, []);
  assert.equal(host.querySelector('[data-node-id="n_a"] .ntune').textContent, 'claude-opus-5 · high');
});

test('a rebuild that drops the anchored card closes the panel, with no follow loop', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host, 'n_a');
  assert.ok(doc.querySelector('.rt-pop'), 'open first');

  // A decomposition rewrites the node ids, so run-hosts destroys and rebuilds every
  // card. The rAF follow loop notices a detached anchor too — but it is OPTIONAL
  // (jsdom defines no requestAnimationFrame here, and neither do some embedders),
  // so the paint path has to be able to say it as well. A fixed panel at z-index 70
  // with a live Apply, anchored to nothing, is not something to leave to chance.
  const rewritten = { ...MANIFEST, graph: { ...MANIFEST.graph,
    nodes: [{ ...MANIFEST.graph.nodes[0], id: 'n_a_t1' }, MANIFEST.graph.nodes[1]] } };
  np.onState(r, { status: 'running', stepper: rewritten, active: [], steps: [] });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.equal(doc.querySelector('.rt-pop'), null);
});

test('a state frame carrying a retune reaches the OPEN popover, not just the pill', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host);
  const modelSel = doc.querySelector('.rt-pop [data-field="model"]');
  assert.ok(modelSel, 'open on n_a');
  assert.equal(modelSel.value, '', 'opened while the node was on inherit');

  // A `/retune` from chat, or a second browser tab. No node id moves, so the card
  // and the panel both survive — and without a sync, Apply would post the stale
  // inherit and quietly revert the override that just landed.
  const tuned = { ...MANIFEST, graph: { ...MANIFEST.graph,
    nodes: [{ ...MANIFEST.graph.nodes[0], model: 'claude-opus-5', effort: 'high' }, MANIFEST.graph.nodes[1]] } };
  np.onState(r, { status: 'running', stepper: tuned, active: [], steps: [] });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  assert.equal(doc.querySelector('.rt-pop [data-field="model"]').value, 'claude-opus-5');
});

test('a popover opened while another was up still logs its failures to the run', async () => {
  const { window, np, host, doc, r } = await liveGraph();
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  window.fetch = () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'nope' }) });

  clickCard(window, host, 'n_a');       // first panel
  clickCard(window, host, 'n_end');     // opening this CLOSES the first
  clickCard(window, host, 'n_a');       // and this one opens after that close
  const apply = doc.querySelector('.rt-apply');
  assert.ok(apply, 'the agent card is back to its editable arm');

  // open() closes whatever panel is up, and that close fires onClose, which drops
  // the app's run reference. Assigning the reference BEFORE open() therefore left
  // every popover opened this way with none at all, and a failed Apply logged
  // nowhere — the one job the reference exists for.
  const before = (r.logLines || []).length;
  apply.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((res) => setTimeout(res, 0));
  const added = (r.logLines || []).slice(before);
  assert.equal(added.length, 1, 'the failure reached the run log');
  assert.match(added[0].text, /retune failed: nope/);
});

test('a cross-project catalog that FAILS to load is never offered as the picker list', async () => {
  const window = await bootApp();
  const np = window.__np;
  const host = hostPair(window.document);
  const doc = window.document;
  np._setModels([{ id: 'a-only', label: 'A Only', efforts: ['high'] }]);
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: '/proj/b', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });

  let hits = 0;
  const stub = () => { hits++; return Promise.reject(new Error('down')); };
  window.fetch = stub;
  Object.defineProperty(globalThis, 'fetch', { value: stub, configurable: true, writable: true });

  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host, 'n_a');
  for (let i = 0; i < 4; i++) await new Promise((res) => setTimeout(res, 0));
  const opts = [...doc.querySelectorAll('.rt-pop [data-field="model"] option')].map((o) => o.value);
  // Pushing A's catalog in would offer ids the engine validates against B and
  // answers 400 to — the very thing opening with [] avoids.
  assert.deepEqual(opts, [''], "the selected project's models are never offered here");

  // And a failed answer is recorded, so a run streaming state frames does not
  // issue one /api/config per frame forever.
  const before = hits;
  for (let i = 0; i < 5; i++) {
    r._decorSeq = (r._decorSeq || 0) + 1;
    np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  }
  assert.equal(hits, before, 'no re-ask per paint');
});

test("an unresolved project borrows BUILT-IN labels only, never a custom collision", async () => {
  const window = await bootApp();
  const np = window.__np;
  np._setModels([
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['high'] },              // built-in
    { id: 'shared-id', label: 'A: Shared', efforts: ['high'], custom: 'global' },
  ]);
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: '/proj/b', status: 'running' });
  const cat = np.catalogForRun(r);
  // Every project's catalog carries the same built-ins, so borrowing those labels
  // is safe. A CUSTOM id can mean a different model in another project — printing
  // A's name for B's model is a confident wrong answer, and the retune popover
  // beside it would be showing something else.
  assert.deepEqual(cat.map((m) => m.id), ['claude-opus-5']);
  assert.equal(np.modelEffortText({ model: 'claude-opus-5', effort: 'high' }, cat), 'Opus 5 · high');
  assert.equal(np.modelEffortText({ model: 'shared-id', effort: '' }, cat), 'shared-id',
    'the raw id, not the other project\'s label');
});

test("a run from ANOTHER project is offered its own catalog, not the selected one", async () => {
  const window = await bootApp();
  const np = window.__np;
  const host = hostPair(window.document);
  const doc = window.document;
  // state.projectDir is '' in this harness (no project selected); the run names
  // one, so the two differ exactly as they do when A is selected and B is running.
  np._setModels([{ id: 'a-only', label: 'A Only', efforts: ['high'] }]);
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: '/proj/b', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });

  // paintRunList applies no project filter, so a live run of project B is openable
  // while A is selected — and the engine validates against listModels(B).
  // app.js calls the BARE global `fetch` (bootApp copies the boot stub onto
  // globalThis), while the popover calls `doc.defaultView.fetch` — stub both.
  const stub = () => Promise.resolve({ ok: true, status: 200,
    json: async () => ({ models: [{ id: 'b-only', label: 'B Only', efforts: ['high'] }] }) });
  window.fetch = stub;
  Object.defineProperty(globalThis, 'fetch', { value: stub, configurable: true, writable: true });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'));
  clickCard(window, host, 'n_a');
  const opts = () => [...doc.querySelectorAll('.rt-pop [data-field="model"] option')].map((o) => o.value);
  assert.deepEqual(opts(), [''], "A's models are not offered for a B node");
  for (let i = 0; i < 4; i++) await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(opts(), ['', 'b-only'], "B's own catalog arrived and filled the list");
});

test('a catalog that lands AFTER the first paint re-resolves the pill label', async () => {
  const window = await bootApp();
  const np = window.__np;
  const host = hostPair(window.document);
  // upsertRun, not makeRun: the invalidation walks the runs Map, which is where
  // every live run actually lives (handleServerMessage upserts on the first frame).
  // projectDir '' — the SELECTED project, so state.models is this run's catalog.
  // A foreign-project run is a different question, covered by its own tests.
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: '', status: 'running' });
  np.onState(r, { status: 'running', stepper: TUNED, active: [], steps: [] });
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'), []);
  const pill = () => host.querySelector('[data-node-id="n_a"] .ntune').textContent;
  assert.equal(pill(), 'claude-opus-5 · high', 'no catalog yet -> the raw id');

  // /api/config resolves. Nothing would fix the pill on its own: runDecorFor
  // memoises the bag per _decorSeq and run-hosts skips paint() outright when the
  // bag identity is unchanged, so an id painted early would stay raw for the life
  // of the card. setModelCatalog bumps both.
  np._setModels([{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['high'] }]);
  np.paintGraphFor(host, r.stepper, np.runDecorFor(r, 'monitor'), []);
  assert.equal(pill(), 'Opus 5 · high', 'the catalog label, not the raw id');
});

test('the tune map is built once per generation, not rebuilt per paint', async () => {
  const { np, host, r } = await liveGraph(TUNED);
  const bag = np.runDecorFor(r, 'monitor');
  np.paintGraphFor(host, r.stepper, bag, []);
  const first = bag.tune;
  np.paintGraphFor(host, r.stepper, bag, []);
  // The monitor host paints on every state/token frame and most of those paints
  // are dropped by run-hosts' `nextDecor === decor` fast path, so rebuilding the
  // map per frame would be pure garbage.
  assert.equal(bag.tune, first, 'the same map object survives a second paint');
  assert.equal(np.runDecorFor(r, 'monitor').tune, first, 'and a second bag read of the same generation');
});

test('a v2 CARD: the graph mounts into an empty host, survives a shim-signature change, and its wrap click opens the detail (v2 only)', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  const node = np.buildRunCard(r);              // stepper null → nothing painted
  window.document.body.appendChild(node);
  r.el = node;
  const host = node.querySelector('.rc-detailed .run-flow');
  assert.equal(host.children.length, 0, 'a stepper-less card paints nothing (the v1 columns are gone)');
  np.onState(r, { status: 'running', stepper: WITH_SHIM, active: [], steps: [] });
  const stage = host.querySelector('.gv-stage');
  assert.ok(stage, 'the v2 renderer replaced the columns');
  assert.equal(host.querySelector('.col'), null);
  // A later manifest whose v1 SHIM signature differs must not disturb the mount
  // (the v1 structural rebuild that used to wipe the host is gone).
  const shim2 = { ...WITH_SHIM, steps: [...WITH_SHIM.steps.slice(0, 2),
    { kind: 'agents', nodes: [{ id: 'n_x', key: 'reviewer', uiPhase: 'review', label: 'Reviewer' }] }, ...WITH_SHIM.steps.slice(2)] };
  np.onState(r, { status: 'running', stepper: shim2, active: [], steps: [] });
  assert.equal(host.querySelector('.gv-stage'), stage, 'the mount is untouched by the v1 rebuild path');
  // D5: the card's graph is scenery (pointer-events:none world); the WRAP takes
  // the click and opens the detail — decided at click time, v2 only.
  window.location.hash = '';
  node.querySelector('.rc-detailed .run-flow-wrap').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(window.location.hash, '#running/r1');
  window.location.hash = '';
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  const card1 = np.buildRunCard(v1);
  window.document.body.appendChild(card1);
  card1.querySelector('.rc-detailed .run-flow-wrap').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(window.location.hash, '', 'a v1 card\'s graph stays inert');
  // A card built AFTER the manifest arrived never paints the v1 columns at all.
  const pre = np.makeRun({ runId: 'r3', title: 't', projectDir: '/p', status: 'running' });
  pre.stepper = MANIFEST;
  assert.equal(np.buildRunCard(pre).querySelector('.rc-detailed .run-flow').children.length, 0, 'no v1 columns for a v2 manifest');
});

test('openRunArtifact reads the End chip through the by-id route on Running and the keyed routes on History', async () => {
  const window = await bootApp();
  const np = window.__np;
  const urls = [];
  globalThis.fetch = window.fetch = (u) => { urls.push(String(u)); return Promise.resolve({ ok: true, status: 200, json: async () => ({ rel: 'plan.md', text: '# plan' }) }); };
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  r.pipelineId = 'abcd1234';
  await np.openRunArtifact({ run: r, runId: 'r1' }, '/tmp/p/plan.md');
  await np.openRunArtifact({ run: { id: 'p1' }, runId: 'p1', record: { projectKey: 'proj-alpha-00000001' } }, '/tmp/p/plan.md');
  await np.openRunArtifact({ run: { id: 'p1' }, runId: 'p1', record: { projectKey: 'workspaces/wks-a-00000001', target: 'workspace' } }, '/tmp/p/plan.md');
  assert.deepEqual(urls, [
    '/api/runs/abcd1234/artifact?rel=%2Ftmp%2Fp%2Fplan.md',
    '/api/history/proj-alpha-00000001/p1/artifact?rel=%2Ftmp%2Fp%2Fplan.md',
    '/api/workspaces/wks-a-00000001/runs/p1/artifact?rel=%2Ftmp%2Fp%2Fplan.md',
  ]);
  assert.equal(window.document.querySelector('#viewer-title').textContent, 'Saved: plan.md', 'the payload lands in the saved-artifact viewer');
  assert.equal(window.document.querySelector('#viewer-card').classList.contains('hidden'), false);
});

test('applyRunLogFilter assigns onto r.logFilter and repaints; focusLogExecution narrows the Running log and activates the detail\'s Logs tab', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running', kind: 'run', startedAt: '10:00:00', pendingQuestion: null });
  const node = np.buildRunCard(r);
  window.document.body.appendChild(node);
  r.el = node;
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });
  np.applyRunLogFilter(r, { execution: 'x:n_a:1', node: 'n_a' });
  assert.equal(r.logFilter.execution, 'x:n_a:1');
  assert.equal(r.logFilter.node, 'n_a');
  assert.equal(r.logFilter.source, '', 'the other axes are untouched');
  np.focusLogExecution({ run: r, runId: 'r1' }, 'x:n_a:2', 'n_a');
  assert.equal(r.logFilter.execution, 'x:n_a:2');
  // The History arm never dereferences a null histDetailState (nothing is open).
  np.focusLogExecution({ run: { id: 'p1' }, runId: 'p1', record: { projectKey: 'k' } }, 'x:n_a:1', 'n_a');
  // Open this run's detail: a footer-row click must land on a VISIBLE Logs tab.
  window.location.hash = 'running/r1';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((res) => setTimeout(res, 0));
  const screen = window.document.querySelector('#run-detail').firstElementChild;   // the cloned #run-detail-tpl screen
  assert.ok(screen.querySelector('.rd-graph .run-flow .gv-world'), 'the detail host mounted the graph');
  // The Live log is the detail's FIRST tab (C1): park the screen on Overview so
  // the activation is observable.
  np.detailTabsOf(screen).activate('overview');
  const sec = screen.querySelector('.rd-sec-logs');
  assert.equal(sec.hidden, true, 'the Logs tab is hidden behind Overview');
  np.focusLogExecution({ run: r, runId: 'r1' }, 'x:n_a:1', 'n_a');
  assert.equal(sec.hidden, false, 'a footer-row click activates the Logs tab');
  assert.equal(screen.querySelector('.rd-tab[data-sec="logs"]').classList.contains('active'), true);
  assert.equal(r.logFilter.execution, 'x:n_a:1');
  window.location.hash = '';
});

test('compact density renders NO graph on a v2 card (Running-page lock); detailed mounts it', async () => {
  const window = await bootApp();
  const np = window.__np;
  np.setRunDensity('compact');
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  const node = np.buildRunCard(r);
  window.document.body.appendChild(node);
  r.el = node;
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });
  const host = node.querySelector('.rc-detailed .run-flow');
  assert.equal(node.dataset.density, 'compact');
  assert.equal(host.querySelector('.gv-stage'), null, 'compact: nothing is mounted into the hidden body');
  np.setRunDensity('detailed');
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });
  assert.ok(host.querySelector('.gv-stage'), 'detailed: the graph mounts on the next paint');
});

// ── banner / progress / gate copy / History header + Overview ────────────────
test('progress reads numerically everywhere and the quiescence banner appears once', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'done' });
  np.onState(r, { status: 'done', stepper: MANIFEST, active: [], endReached: false, warnings: [],
    wireDeliveries: { w1: 2 }, gate: null,
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }] });
  assert.deepEqual((({ n, m }) => [n, m])(np.runStepLabel(r)), [1, 1]);
  const banners = window.document.createElement('div');
  np.paintQuiescenceBanner(banners, np.runDecorFor(r, 'monitor'));
  np.paintQuiescenceBanner(banners, np.runDecorFor(r, 'monitor'));
  assert.equal(banners.querySelectorAll('.run-warn').length, 1, 'idempotent');
  assert.equal(banners.querySelector('.run-warn').textContent, 'finished at quiescence — End not reached');
  assert.equal(banners.querySelector('.run-warn').hidden, false);
  np.paintQuiescenceBanner(banners, { quiescent: false });
  assert.equal(banners.querySelector('.run-warn').hidden, true);
  assert.equal(np.progressText(r), '1/1 done');
  assert.equal(np.histCountsLine({ ...r, stepper: MANIFEST }), '1 execution · 2 loop deliveries');
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  assert.equal(np.progressText(v1), '', 'v1 runs have no numeric progress');
});

test('the gate intro names the wire it holds on; v1 keeps the two literals byte-identical', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: [] });
  assert.equal(np.gateWireCopy(r, 'w1'), ' on Planner → End (w1)');
  assert.equal(np.gateWireCopy(r, 'nope'), '', 'an unknown wire adds nothing');
  const intro = (run, pq) => { const p = window.document.createElement('div'); np.renderGateBody(run, p, pq); return p.querySelector('.gate-intro').textContent; };
  assert.equal(intro(r, { id: 'g', kind: 'gate', wireId: 'w1', issues: [] }),
    'This cycle reached its limit on Planner → End (w1). Approve another cycle to keep iterating, or continue with what you have.');
  assert.equal(intro(r, { id: 'g', kind: 'gate', wireId: 'w1', issues: [{ severity: 'major', title: 'x' }] }),
    'This cycle reached its limit on Planner → End (w1) with open issues. Approve another cycle to keep iterating, or continue with what you have.');
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  assert.equal(intro(v1, { id: 'g', kind: 'gate', issues: [] }),
    'This cycle reached its limit. Approve another cycle to keep iterating, or continue with what you have.');
  assert.equal(intro(v1, { id: 'g', kind: 'gate', issues: [{ severity: 'major', title: 'x' }] }),
    'This cycle reached its limit with open issues. Approve another cycle to keep iterating, or continue with what you have.');
});

test('the card meta shows `n/m` and the compact chip `n/m done` on a v2 run; a v1 card is untouched', async () => {
  const window = await bootApp();
  const np = window.__np;
  const done = [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, status: 'done', activeMs: 1000, costUsd: 0.1 }];
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  const node = np.buildRunCard(r);
  window.document.body.appendChild(node);
  r.el = node;
  assert.equal(node.querySelector('.rc-prog').hidden, true, 'hidden until a v2 manifest arrives');
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: done });
  assert.equal(node.querySelector('.rc-prog').hidden, false);
  assert.equal(node.querySelector('.rc-prog-text').textContent, '1/1');
  // The segment is painted ABOVE renderRunMeta's `.rc-branch` early return.
  const bare = window.document.createElement('div');
  bare.innerHTML = '<span class="rm-text"></span><span class="rc-seg rc-prog" hidden><span class="rc-prog-text"></span></span>';
  np.renderRunMeta(r, bare);
  assert.equal(bare.querySelector('.rc-prog').hidden, false, 'a branch-less root still gets the progress segment');
  np.setRunDensity('compact');
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: done });
  assert.equal(node.querySelector('.rc-step-chip').textContent, '1/1 done', 'D15: a number, never a bar');
  np.setRunDensity('detailed');
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  const c1 = np.buildRunCard(v1);
  window.document.body.appendChild(c1);
  v1.el = c1;
  np.onState(v1, { status: 'running', stepper: V1_STEPPER });
  assert.equal(c1.querySelector('.rc-prog').hidden, true, 'v1: no progress segment');
  np.setRunDensity('compact');
  np.onState(v1, { status: 'running', stepper: V1_STEPPER });
  assert.match(c1.querySelector('.rc-step-chip').textContent, /^STEP \d+\/\d+$/, 'v1 keeps STEP n/m');
  np.setRunDensity('detailed');
});

test('the detail header .rd-step reads `n/m done · <who>` on a v2 run (C16: only the meta list changes)', async () => {
  const window = await bootApp();
  const np = window.__np;
  const screen = window.document.querySelector('#run-detail-tpl').content.firstElementChild.cloneNode(true);
  window.document.body.appendChild(screen);
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'running' });
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [{ nodeId: 'n_a', executionId: 'x:n_a:1' }], steps: [] });
  np.paintRdHeader(screen, r);
  assert.equal(screen.querySelector('.rd-meta .rd-step').textContent, '0/1 done · Planner');
  assert.ok(screen.querySelector('.rd-pause'), 'the single toggling control stays');
  assert.equal(screen.querySelector('.rd-resume'), null, 'C6: there is no .rd-resume');
  const v1 = np.makeRun({ runId: 'r2', title: 't', projectDir: '/p', status: 'running' });
  np.onState(v1, { status: 'running', stepper: V1_STEPPER });
  np.paintRdHeader(screen, v1);
  assert.match(screen.querySelector('.rd-meta .rd-step').textContent, /^step \d+\/\d+ · /, 'v1 keeps `step n/m · name`');
});

test('paintRunDetail shows the quiescence banner on a v2 run that drained without End', async () => {
  const window = await bootApp();
  const np = window.__np;
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: '/p', status: 'done', kind: 'run', startedAt: '10:00:00', pendingQuestion: null });
  np.onState(r, { status: 'done', stepper: MANIFEST, active: [], steps: [], endReached: false, warnings: [] });
  window.location.hash = 'running/r1';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((res) => setTimeout(res, 0));
  const screen = window.document.querySelector('#run-detail').firstElementChild;
  const warn = screen.querySelector('.rd-banners .run-warn');
  assert.ok(warn, 'the banner lives in .rd-banners');
  assert.equal(warn.hidden, false);
  assert.equal(warn.textContent, 'finished at quiescence — End not reached');
  window.location.hash = '';
});

test('History: the header meta carries the End chip and the Overview the counts + quiescence note (v2 only; D5 untouched)', async () => {
  const window = await bootApp();
  const np = window.__np;
  const doc = window.document;
  const urls = [];
  globalThis.fetch = window.fetch = (u) => { urls.push(String(u)); return Promise.resolve({ ok: true, status: 200, json: async () => ({ rel: 'plan.md', text: '# plan' }) }); };
  const screen = doc.querySelector('#hist-detail-tpl').content.firstElementChild.cloneNode(true);
  doc.body.appendChild(screen);
  const record = { id: 'p1', projectKey: 'proj-alpha-00000001', title: 't' };
  const base = { id: 'p1', status: 'done', startedAt: '2026-08-26T10:00:00Z', totalActiveMs: 1000, totalCostUsd: 0.1,
    stepper: MANIFEST, steps: [], active: [], warnings: [], wireDeliveries: {}, gate: null };
  np.paintHdHeaderMeta(screen, record, { state: { ...base, endReached: true, result: { type: 'md', path: '/tmp/p/plan.md' } } });
  const link = screen.querySelector('.hd-meta .hd-result a');
  assert.equal(link.textContent, 'plan.md');
  assert.equal(link.title, '/tmp/p/plan.md');
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(urls, ['/api/history/proj-alpha-00000001/p1/artifact?rel=%2Ftmp%2Fp%2Fplan.md'], 'the keyed route, through historyRunUrl');
  np.paintHdHeaderMeta(screen, record, { state: { ...base, endReached: true, result: { type: 'void' } } });
  assert.equal(screen.querySelector('.hd-meta .hd-result').textContent, '— completed');
  np.paintHdHeaderMeta(screen, record, { state: { ...base, endReached: false, result: { type: 'md', path: '/tmp/p/plan.md' } } });
  assert.equal(screen.querySelector('.hd-meta .hd-result'), null, 'no chip until End binds — a recorded result on a quiescent run is not one');
  assert.equal(screen.querySelector('.hd-meta .hd-model'), null, 'D5: History never shows model/effort');
  // Overview: the DURATION sub-line counts executions/deliveries; the note appears once, v2 only.
  const sec = doc.createElement('div');
  const done = [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, cycle: 1, status: 'done', activeMs: 1000 }];
  np.buildHdOverview(sec, record, { state: { ...base, endReached: false, wireDeliveries: { w1: 2 }, steps: done }, results: null });
  assert.equal(sec.querySelector('.hd-ov-card-duration .hd-ov-sub').textContent, '1 execution · 2 loop deliveries');
  const note = sec.querySelector('.hd-ov-note.run-warn');
  assert.ok(note, 'the one-line note under the stat grid');
  assert.equal(note.getAttribute('role'), 'status');
  assert.equal(note.textContent, 'finished at quiescence — End not reached');
  np.buildHdOverview(sec, record, { state: { ...base, endReached: true, result: { type: 'void' }, steps: done }, results: null });
  assert.equal(sec.querySelector('.hd-ov-note'), null, 'a run that bound End carries no note');
  np.buildHdOverview(sec, record, { state: { ...base, stepper: V1_STEPPER, steps: [{ key: 'plan', nodeId: 's0_0', cycle: 1, status: 'done' }] }, results: null });
  assert.match(sec.querySelector('.hd-ov-card-duration .hd-ov-sub').textContent, /^\d+ steps? · \d+ cycles?$/, 'v1 keeps its steps · cycles line');
  assert.equal(sec.querySelector('.hd-ov-note'), null);
});

// -------------------------------------------------------------------- MAJ-20
// setFooter used to `.remove()` every .xfoot and rebuild it, so the run
// monitor's ONE interactive footer control was destroyed on every decor
// generation (r._decorSeq bumps on each `state`/`subagent` event). A keyboard
// user's focus landed on <body>, and a pointerdown→pointerup straddling a
// repaint produced no click. A dataset.sig diff cannot fix the EXPANDED node —
// its exec rows carry a live `dur` — so the fix is element reuse.
test('MAJ-20: a repaint with an equal-but-new decor bag reuses the footer elements and keeps focus', () => {
  const { view, host, window } = mountView();
  const st = RUN({
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle', status: 'done', activeMs: 63000, costUsd: 0.12 }],
    wireDeliveries: { w1: 1 },
  });
  applyDecor(view, decorFromState(st, { live: true, now: 0 }));
  const card = host.querySelector('[data-node-id="n_a"]');
  const foot1 = card.querySelector('.xfoot');
  const toggle1 = card.querySelector('.xtoggle');
  toggle1.focus();
  assert.equal(window.document.activeElement, toggle1, 'precondition: the toggle has focus');
  applyDecor(view, decorFromState(st, { live: true, now: 0 }));          // a NEW bag, equal contents
  assert.equal(card.querySelector('.xfoot'), foot1, '.xfoot identity preserved');
  assert.equal(card.querySelector('.xtoggle'), toggle1, '.xtoggle identity preserved');
  assert.equal(window.document.activeElement, toggle1, 'focus stayed on the toggle');
});

test('MAJ-20: an expanded node keeps its rows across a repaint and still updates their text', () => {
  const { view, host, window } = mountView();
  const base = {
    steps: [
      { key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle', status: 'done', activeMs: 63000, costUsd: 0.12 },
      { key: 'x:n_a:2', executionId: 'x:n_a:2', nodeId: 'n_a', ordinal: 2, kind: 'cycle', status: 'start', activeMs: 4000, costUsd: 0 },
    ],
    active: [{ nodeId: 'n_a', executionId: 'x:n_a:2' }],
  };
  applyDecor(view, { ...decorFromState(RUN(base), { live: false }), expanded: 'n_a' });
  const card = host.querySelector('[data-node-id="n_a"]');
  const rows1 = [...card.querySelectorAll('.xrow')];
  assert.equal(rows1.length, 2, 'precondition: expanded');
  const toggle1 = card.querySelector('.xtoggle');
  toggle1.focus();
  const right0 = rows1[1].querySelector('.xr').textContent;
  // the SAME executions, one second later: only the live duration moved
  const later = { ...base, steps: [base.steps[0], { ...base.steps[1], activeMs: 9000 }] };
  applyDecor(view, { ...decorFromState(RUN(later), { live: false }), expanded: 'n_a' });
  const rows2 = [...card.querySelectorAll('.xrow')];
  assert.deepEqual(rows2, rows1, 'every .xrow element is the SAME node, keyed by executionId');
  assert.equal(card.querySelector('.xtoggle'), toggle1);
  assert.equal(window.document.activeElement, toggle1, 'focus survives an expanded repaint');
  assert.equal(card.querySelector('.xtoggle').getAttribute('aria-expanded'), 'true', 'still expanded');
  assert.notEqual(rows2[1].querySelector('.xr').textContent, right0, 'the live duration DID update in place');
  assert.match(rows2[1].querySelector('.xr').textContent, /9s/);
});

test('MAJ-20: rows that vanish are removed, new ones are appended in order, and a collapse drops them', () => {
  const { view, host } = mountView();
  const one = { steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle', status: 'done', activeMs: 1000, costUsd: 0.1 }] };
  applyDecor(view, { ...decorFromState(RUN(one), { live: false }), expanded: 'n_a' });
  const card = host.querySelector('[data-node-id="n_a"]');
  const row1 = card.querySelector('.xrow');
  const two = { steps: [one.steps[0], { key: 'x:n_a:2', executionId: 'x:n_a:2', nodeId: 'n_a', ordinal: 2, kind: 'cycle', status: 'start', activeMs: 2000, costUsd: 0 }],
    active: [{ nodeId: 'n_a', executionId: 'x:n_a:2' }] };
  applyDecor(view, { ...decorFromState(RUN(two), { live: false }), expanded: 'n_a' });
  const rows = [...card.querySelectorAll('.xrow')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0], row1, 'the first row was reused, not rebuilt');
  assert.deepEqual(rows.map((r) => r.dataset.executionId), ['x:n_a:1', 'x:n_a:2'], 'appended in order');
  assert.deepEqual([...card.querySelectorAll('.xfoot > *')].map((n) => n.className.split(' ')[0]), ['xtoggle', 'xrow', 'xrow']);
  // collapse: the rows go, the toggle stays the same element
  const toggle = card.querySelector('.xtoggle');
  applyDecor(view, { ...decorFromState(RUN(two), { live: false }), expanded: null });
  assert.equal(card.querySelectorAll('.xrow').length, 0);
  assert.equal(card.querySelector('.xtoggle'), toggle, 'the toggle is never rebuilt by a collapse');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

// ── live node retune: the card-click knob and the model · effort pill ────────

test('monitor: a click on a card body fires onNodeClick with the node id', () => {
  calls = [];
  const { window, host, m } = mountHost('monitor');
  m.update('r1', MANIFEST, { nodeIds: ['n_a'], wireIds: [], status: { n_a: 'pending' }, colors: {}, footers: {}, totals: {} });
  const card = host.querySelector('[data-node-id="n_a"]');
  // `.nhead .tt` always exists (view.mjs:386) — a descendant, to prove delegation.
  card.querySelector('.nhead .tt').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls.filter((c) => c[0] === 'node'), [['node', 'n_a', card]],
    'the delegated handler resolves the card from a descendant target');
});

test('monitor: a footer row still wins over the card handler', () => {
  calls = [];
  const { window, host, m } = mountHost('monitor');
  // A real decor bag: the footer bands `.xrow` lives in are built by
  // decorFromState/applyDecor, not by a hand-rolled footers literal.
  const st = RUN({
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle',
      status: 'done', activeMs: 1000, costUsd: 0, trigger: { wireIds: [], freshPorts: ['task'] } }],
  });
  m.update('r1', MANIFEST, decorFromState(st));
  // The host owns `expanded` itself (the bag's flag is overwritten on paint), so
  // open the footer the way a user does — through .xtoggle, which the click chain
  // handles and returns on, reaching neither onRowClick nor the card branch.
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  host.querySelector('.xrow').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls.map((c) => c[0]), ['row'], 'the card branch is last and never swallows a row click');
});

test('static: no click listener at all, so the Running-list card stays inert', () => {
  calls = [];
  const { window, host, m } = mountHost('static');
  m.update('r1', MANIFEST, { nodeIds: ['n_a'], wireIds: [], status: {}, colors: {}, footers: {}, totals: {} });
  host.querySelector('[data-node-id="n_a"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, []);
});

test('monitor: Enter on a focused card fires onNodeClick (cards are tabindex=0)', () => {
  calls = [];
  const { window, host, m } = mountHost('monitor');
  m.update('r1', MANIFEST, { nodeIds: ['n_a'], wireIds: [], status: {}, colors: {}, footers: {}, totals: {} });
  const card = host.querySelector('[data-node-id="n_a"]');
  card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(calls.filter((c) => c[0] === 'node').map((c) => c.slice(0, 2)), [['node', 'n_a']]);
});

test('a footer row click never falls through to the card when no onRowClick is wired', () => {
  const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
  const { window } = dom;
  const host = window.document.querySelector('.run-flow');
  const seen = [];
  // `if (row && onRowClick)` let a host mounted WITHOUT onRowClick reach the card
  // branch below, opening the retune popover from a click on an execution log row.
  const m = mountRunGraph(host, { mode: 'monitor', doc: window.document, raf: (fn) => { fn(); return 1; },
    viewport: () => ({ left: 0, top: 0, width: 900, height: 520 }),
    onNodeClick: (...a) => { seen.push(a); return true; } });
  const st = RUN({
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle',
      status: 'done', activeMs: 1000, costUsd: 0, trigger: { wireIds: [], freshPorts: ['task'] } }],
  });
  m.update('r1', MANIFEST, decorFromState(st));
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const row = host.querySelector('.xrow');
  assert.ok(row.closest('.node[data-node-id]'), 'the row really does sit inside a card');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(seen, [], 'the row branch consumed it, as .ngate does');
});

test('a card keydown the callback DECLINES is left to the browser (History, a settled run)', () => {
  calls = [];
  const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
  const { window } = dom;
  const document = window.document;
  const host = document.querySelector('.run-flow');
  // The app's own onNodeClick returns false on History and on a terminal run.
  // Swallowing the key anyway would leave Space on a focused card doing nothing
  // at all, where it used to page-scroll the detail body.
  const m = mountRunGraph(host, { mode: 'monitor', doc: document, raf: (fn) => { fn(); return 1; },
    viewport: () => ({ left: 0, top: 0, width: 900, height: 520 }),
    onNodeClick: (...a) => { calls.push(['node', ...a]); return false; } });
  m.update('r1', MANIFEST, { nodeIds: ['n_a'], wireIds: [], status: {}, colors: {}, footers: {}, totals: {} });
  const card = host.querySelector('[data-node-id="n_a"]');
  const ev = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  card.dispatchEvent(ev);
  assert.equal(calls.length, 1, 'the callback still gets its say');
  assert.equal(ev.defaultPrevented, false, 'a declined activation keeps the browser default');
});

test('auto-repeat leaves keys it has no business with alone', () => {
  calls = [];
  const { window, document } = (() => {
    const dom = new JSDOM('<!doctype html><div class="run-flow-wrap"><div class="run-flow"></div></div>');
    return { window: dom.window, document: dom.window.document };
  })();
  const host = document.querySelector('.run-flow');
  // A History host: onNodeClick always declines. An `e.repeat` bail placed above
  // the target and callback guards preventDefaulted every held key in the host —
  // the first Space scrolled once and every repeat after it jammed, and a repeat
  // on the host BACKGROUND was swallowed with no card involved at all.
  const m = mountRunGraph(host, { mode: 'monitor', doc: document, raf: (fn) => { fn(); return 1; },
    viewport: () => ({ left: 0, top: 0, width: 900, height: 520 }),
    onNodeClick: (...a) => { calls.push(['node', ...a]); return false; } });
  m.update('r1', MANIFEST, { nodeIds: ['n_a'], wireIds: [], status: {}, colors: {}, footers: {}, totals: {} });
  const card = host.querySelector('[data-node-id="n_a"]');
  const first = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  card.dispatchEvent(first);
  const repeat = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, repeat: true });
  card.dispatchEvent(repeat);
  assert.equal(first.defaultPrevented, false, 'a declined press scrolls');
  assert.equal(repeat.defaultPrevented, false, 'and so does every repeat of it — no jam');

  const bg = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, repeat: true });
  host.dispatchEvent(bg);
  assert.equal(bg.defaultPrevented, false, 'a repeat on the background is not the card handler\'s business');
});

test('auto-repeat is not a second activation: a HELD key fires the card once', () => {
  calls = [];
  const { window, host, m } = mountHost('monitor');
  m.update('r1', MANIFEST, { nodeIds: ['n_a'], wireIds: [], status: {}, colors: {}, footers: {}, totals: {} });
  const card = host.querySelector('[data-node-id="n_a"]');
  card.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  // The popover toggles when reopened on the same anchor, so ~30 repeats a second
  // would strobe it open/closed with focus ping-ponging between card and panel.
  const held = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, repeat: true });
  card.dispatchEvent(held);
  card.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, repeat: true }));
  assert.equal(calls.filter((c) => c[0] === 'node').length, 1, 'only the first keydown activates');
  assert.equal(held.defaultPrevented, true, 'and the held key still does not fall through to scrolling');
});

test('static: no keydown listener either', () => {
  calls = [];
  const { window, host, m } = mountHost('static');
  m.update('r1', MANIFEST, { nodeIds: ['n_a'], wireIds: [], status: {}, colors: {}, footers: {}, totals: {} });
  host.querySelector('[data-node-id="n_a"]')
    .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(calls, [], 'the keydown arm lives inside the same isStatic guard');
});

// The ornaments the click chain deliberately excludes are DESCENDANTS of the card
// (`.xfoot` is a direct child, view.mjs:618), and two of them are natively keyboard
// activatable: `.xtoggle` is a <button> (view.mjs:276-277) and `.xresult a` is an
// <a href> (view.mjs:292-294). For both, the activation click IS the keydown's
// default action, so a preventDefault() on the way up cancels it.
test('monitor: Enter on the footer toggle is left to the browser, not swallowed by the card arm', () => {
  calls = [];
  const { window, host, m } = mountHost('monitor');
  const st = RUN({
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle',
      status: 'done', activeMs: 1000, costUsd: 0, trigger: { wireIds: [], freshPorts: ['task'] } }],
  });
  m.update('r1', MANIFEST, decorFromState(st));
  const toggle = host.querySelector('.xtoggle');
  assert.ok(toggle.closest('.node[data-node-id]'), 'the toggle really does sit inside a card');
  const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  toggle.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, 'the browser still synthesises the activation click');
  assert.deepEqual(calls, [], 'and the card handler never fires from an ornament');
  // The activation click the browser would now generate still expands the footer.
  toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(host.querySelectorAll('.xrow').length, 1, 'Enter on the toggle still opens the footer');
});

test('monitor: Enter on a result link is left to the browser too', () => {
  calls = [];
  const { window, host, m } = mountHost('monitor');
  m.update('r1', MANIFEST, decorFromState(RUN({ status: 'done', endReached: true,
    result: { type: 'md', path: '/tmp/p/plan.md' } })));
  const link = host.querySelector('.xresult a');
  assert.ok(link.closest('.node[data-node-id]'), 'the result link really does sit inside a card');
  const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  link.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.deepEqual(calls, []);
});

test('monitor: Space on a footer row does not fire the card handler', () => {
  calls = [];
  const { window, host, m } = mountHost('monitor');
  const st = RUN({
    steps: [{ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, kind: 'cycle',
      status: 'done', activeMs: 1000, costUsd: 0, trigger: { wireIds: [], freshPorts: ['task'] } }],
  });
  m.update('r1', MANIFEST, decorFromState(st));
  host.querySelector('.xtoggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const ev = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  host.querySelector('.xrow').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  assert.deepEqual(calls, [], 'ornaments are excluded from the keydown arm exactly as from the click chain');
});

test('the live-detail cursor opt-in is written, and the base cursor is untouched', () => {
  // Both halves of the selector are load-bearing, not decoration. `:not(.settled)`
  // mirrors RD_TERMINAL, the set openRetuneFor refuses; `.node` rather than
  // `.node-agent` covers flow cards, which openRetuneFor also accepts (on its
  // note-only arm). Either mismatch leaves a cursor promising what the click does
  // not deliver, or an inert-looking card that opens a panel anyway.
  assert.ok(css.includes('.rd-graph:not(.settled) .run-flow.gv-host .gv-world .node[data-node-id]{cursor:pointer;}'));
  assert.ok(css.includes('.run-flow.gv-host .gv-world .node{cursor:default;}'), 'the default still applies elsewhere');
});

test('setNodeTune writes, updates and removes the pill in place', () => {
  const { view, host } = mountView();
  const card = () => host.querySelector('[data-node-id="n_a"]');
  view.setNodeTune('n_a', { text: 'Opus 5 · high' });
  assert.equal(card().querySelector('.ntune').textContent, 'Opus 5 · high');
  const pill = card().querySelector('.ntune');
  view.setNodeTune('n_a', { text: 'Sonnet 5' });
  assert.equal(card().querySelector('.ntune'), pill, 'the element is reused, never rebuilt');
  assert.equal(pill.textContent, 'Sonnet 5', 'no effort, no separator');
  view.setNodeTune('n_a', null);
  assert.equal(card().querySelector('.ntune'), null, "'' = inherit removes the pill");
  // A raw decor entry that never went through paintGraphFor's label pass has no
  // `text` — the pill must stay off rather than print an object.
  view.setNodeTune('n_a', { model: 'claude-opus-5', effort: 'high' });
  assert.equal(card().querySelector('.ntune'), null, 'no text, no pill');
});

test('the .ntune pill is styled and cannot collide with .nrun', () => {
  assert.match(css, /\.gv-world \.ntune\{[^}]*position:absolute[^}]*\}/);
  assert.match(css, /\.gv-world \.ntune\{[^}]*bottom:-9px;left:16px[^}]*\}/);
  assert.match(css, /\.gv-world \.nrun\{[^}]*top:-9px;right:16px[^}]*\}/);
});
