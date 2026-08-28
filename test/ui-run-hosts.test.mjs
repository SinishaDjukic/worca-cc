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
