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
