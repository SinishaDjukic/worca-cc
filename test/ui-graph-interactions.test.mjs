// test/ui-graph-interactions.test.mjs — MAJ-30.
// jsdom ports of the MECHANICAL half of the behaviours that were asserted only
// inside scripts/verify-composer-cdp.mjs and scripts/verify-run-monitor-cdp.mjs
// — two scripts no automation runs (see the CI-COVERAGE header block in each).
//
// Ported here: the wheel preventDefault policy on BOTH canvases, the two pan
// gestures that had no automated guard anywhere (middle-button and space+drag),
// the `≤N` → `N×` badge swap, and the two header ornaments' escape from the
// card title's flow.
//
// NOT ported, and deliberately so: everything whose assertion is a MEASUREMENT.
// jsdom has no layout engine — every getBoundingClientRect is 0×0 — so the rail's
// 340px width and its flush right edge, single-column palette pills, the pinned
// filter head, the legend footer span, the 22px card gap, stage-box stability
// through a wheel sequence, post-fit containment and the .nrun/.ngate em-box
// clearance can only be proven in a real browser. Those stay CDP-only; the two
// scripts' headers list them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createGraphView } from '../ui/public/graph/view.mjs';
import { manifestPortsFn, manifestTemplate } from '../src/shared/graph/manifest.mjs';
import { open } from './helpers/composer-shell.mjs';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

// The same two-card manifest test/ui-run-hosts.test.mjs mounts: one agent, one
// End, and w1 carrying a maxCycles budget (which is what mints a `.wbadge`).
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
    viewport: () => ({ left: 0, top: 0, width: 800, height: 400 }),
  });
  view.render(manifestTemplate(MANIFEST), {});
  return { window, doc: window.document, host, view };
}

const wheelOn = (win, el, o) => {
  const ev = new win.WheelEvent('wheel', { bubbles: true, cancelable: true, ...o });
  el.dispatchEvent(ev);
  return ev;
};
const pev = (win, type, o) => new win.PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, ...o });

// ─── wheel preventDefault, canvas 1: the composer ────────────────────────────
// CDP: verify-composer-cdp.mjs check(6) `prevented`.

test('the composer canvas swallows EVERY wheel — plain, ctrl and meta — and gives it back on destroy()', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  for (const o of [{ deltaY: -120 }, { deltaX: 40, deltaY: 0 }, { deltaY: -120, ctrlKey: true }, { deltaY: -120, metaKey: true }]) {
    const ev = wheelOn(s.win, s.c.view.stage, { clientX: 600, clientY: 300, ...o });
    assert.equal(ev.defaultPrevented, true, `the page must never scroll under the canvas: ${JSON.stringify(o)}`);
  }
  s.c.destroy();
  const after = wheelOn(s.win, s.c.view.stage, { clientX: 600, clientY: 300, deltaY: -120 });
  assert.equal(after.defaultPrevented, false, 'destroy() unbinds the wheel handler');
});

// ─── wheel preventDefault, canvas 2: the run monitor ─────────────────────────
// CDP: verify-run-monitor-cdp.mjs check(6) `prevented0` / `prevented1`.

test('the monitor canvas preventDefaults only what it consumes: ctrl+wheel always, a plain wheel only while engaged', () => {
  const { window, host, view } = mountView('monitor');
  const nav = view.createNav({ wheelPan: 'engaged' });
  const stage = view.stage;
  view.setTransform({ x: 0, y: 0, z: 1 });

  // (a) disengaged: a plain wheel belongs to the PAGE — untouched and unmoved.
  const idle = wheelOn(window, stage, { clientX: 400, clientY: 200, deltaX: 40, deltaY: -25 });
  assert.equal(idle.defaultPrevented, false, 'a disengaged plain wheel scrolls the page');
  assert.deepEqual(view.getTransform(), { x: 0, y: 0, z: 1 }, 'and pans nothing');

  // (b) ctrl+wheel zooms with no click at all, and it is always consumed.
  const zoom = wheelOn(window, stage, { clientX: 400, clientY: 200, deltaY: -120, ctrlKey: true });
  assert.equal(zoom.defaultPrevented, true, 'the pinch/ctrl zoom is consumed even while disengaged');
  assert.ok(view.getTransform().z > 1, 'and it really zoomed in');

  // (c) a press on the stage engages; the plain wheel then pans by −delta.
  view.setTransform({ x: 0, y: 0, z: 1 });
  stage.dispatchEvent(pev(window, 'pointerdown', { button: 0, clientX: 400, clientY: 200 }));
  assert.equal(nav.isEngaged(), true);
  const panned = wheelOn(window, stage, { clientX: 400, clientY: 200, deltaX: 40, deltaY: -25 });
  assert.equal(panned.defaultPrevented, true, 'an engaged plain wheel is the canvas\'s');
  assert.deepEqual(view.getTransform(), { x: -40, y: 25, z: 1 });

  // (d) Escape releases the engagement and the page gets the wheel back.
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(nav.isEngaged(), false);
  const released = wheelOn(window, stage, { clientX: 400, clientY: 200, deltaY: 120 });
  assert.equal(released.defaultPrevented, false, 'Escape gives the wheel back to the page');
  assert.equal(host.isConnected, true);
});

// ─── the two pan gestures that had no guard anywhere ─────────────────────────
// CDP: verify-composer-cdp.mjs check(9).

test('a MIDDLE-button drag pans the composer by the exact delta and never grabs the card under it', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const before = JSON.stringify(s.c.template());
  // press on the n_agent CARD: button 1 outranks the hit-test.
  s.c.view.stage.dispatchEvent(pev(s.win, 'pointerdown', { button: 1, clientX: 400, clientY: 80 }));
  assert.equal(s.c.gesture().type, 'pan', 'the middle button always pans');
  assert.equal(s.c.selection(), null, 'and selects nothing');
  assert.ok(s.c.view.stage.classList.contains('panning'));
  s.c.view.stage.dispatchEvent(pev(s.win, 'pointermove', { clientX: 455, clientY: 45 }));
  s.flush();
  assert.deepEqual(s.c.view.getTransform(), { x: 55, y: -35, z: 1 }, 'panned by (+55, −35)');
  s.c.view.stage.dispatchEvent(pev(s.win, 'pointerup', { button: 1, clientX: 455, clientY: 45 }));
  s.flush();
  assert.equal(s.c.gesture(), null);
  assert.equal(s.c.view.stage.classList.contains('panning'), false);
  assert.equal(JSON.stringify(s.c.template()), before, 'a pan mutates no model state');
  // …and a button the composer does not own is ignored outright.
  s.c.view.stage.dispatchEvent(pev(s.win, 'pointerdown', { button: 2, clientX: 400, clientY: 80 }));
  assert.equal(s.c.gesture(), null, 'the right button starts nothing');
});

test('SPACE+drag pans the composer: the key arms the stage, outranks the hit-test and disarms on keyup', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const key = (type, k) => {
    const ev = new s.win.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true });
    s.doc.dispatchEvent(ev);
    return ev;
  };
  const armed = key('keydown', ' ');
  assert.equal(s.c._internal.isSpace(), true, 'space arms the pan modifier');
  assert.equal(armed.defaultPrevented, true, 'and the page never page-downs under the canvas');
  assert.ok(s.c.view.stage.classList.contains('space'), 'the stage takes the grab cursor');

  s.c.view.stage.dispatchEvent(pev(s.win, 'pointerdown', { button: 0, clientX: 400, clientY: 80 }));
  assert.equal(s.c.gesture().type, 'pan', 'space wins over the card under the cursor');
  s.c.view.stage.dispatchEvent(pev(s.win, 'pointermove', { clientX: 360, clientY: 105 }));
  s.flush();
  assert.deepEqual(s.c.view.getTransform(), { x: -40, y: 25, z: 1 }, 'panned by (−40, +25)');
  s.c.view.stage.dispatchEvent(pev(s.win, 'pointerup', { button: 0, clientX: 360, clientY: 105 }));
  s.flush();

  key('keyup', ' ');
  assert.equal(s.c._internal.isSpace(), false, 'keyup disarms');
  assert.equal(s.c.view.stage.classList.contains('space'), false);
  // Rewind the pan first: the same client point maps to a different WORLD point
  // once the canvas has moved, so a press there would miss the card for a reason
  // that has nothing to do with the space modifier.
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  s.c._internal.readRect();
  s.c.view.stage.dispatchEvent(pev(s.win, 'pointerdown', { button: 0, clientX: 400, clientY: 80 }));
  assert.equal(s.c.gesture().type, 'node', 'and the hit-test is back in charge');
});

// ─── the `≤N` → `N×` badge swap ──────────────────────────────────────────────
// CDP: verify-run-monitor-cdp.mjs check(5). jsdom cannot read a cascaded
// font-size, so the port pins the two halves the check rests on: the budget text
// and the delivery count live on SEPARATE nodes, and the run-host block zeroes
// the host's font while re-sizing the child.

test('the ≤N budget pill and the N× delivery count are separate nodes, and the run host hides the first', () => {
  const { host, view } = mountView('monitor');
  const badge = host.querySelector('.wbadge[data-wire-id="w1"]');
  assert.equal(badge.textContent, '≤3', 'render() writes the composer\'s budget pill');
  view.setWireBadge('w1', { text: '2×', title: '2 of 3 cycles' });
  assert.equal(badge.firstChild.nodeType, badge.ownerDocument.TEXT_NODE, 'the budget stays a bare text node');
  assert.equal(badge.firstChild.textContent, '≤3');
  const fired = badge.querySelector('.wfired');
  assert.equal(fired.textContent, '2×', 'the delivery count is its own element');
  assert.equal(fired.title, '2 of 3 cycles');
  assert.equal(badge.textContent, '≤32×', 'both live in the SAME host — only CSS can separate them');
  view.setWireBadge('w1', null);
  assert.equal(badge.querySelector('.wfired'), null);
  assert.equal(badge.textContent, '≤3', 'clearing the count leaves the budget behind');

  // The suppression rule itself, and the child that re-enables a readable size.
  assert.match(css, /\.run-flow\.gv-host \.wbadge\{[^}]*font-size:0[^}]*\}/,
    'the run host zeroes the badge host font — that is what hides ≤N');
  assert.match(css, /\.run-flow\.gv-host \.wbadge \.wfired\{[^}]*font:700 10px\/1\.4 var\(--mono\)[^}]*\}/,
    'and gives the N× child its own font back');
  assert.match(css, /\.run-flow\.gv-host \.wbadge:not\(:has\(> \.wfired\)\)\{[^}]*display:none[^}]*\}/,
    'a wire that never fired shows no badge at all');
});

// ─── the header ornaments vs the card title ──────────────────────────────────
// CDP: verify-run-monitor-cdp.mjs check(7) measures the em-box clearance. jsdom
// pins the two preconditions of that measurement: the ornaments are the CARD's
// own children (never inside .nhead, so they are out of the title's flow) and
// both hang ABOVE the card's top edge on a negative absolute offset.

test('.nrun and .ngate hang off the CARD, not the header, and the CSS lifts them clear of the title', () => {
  const { host, view } = mountView('monitor');
  view.setNodeChrome('n_a', { color: 'violet', gate: { wireId: 'w1', title: 'waiting on the loop gate' },
    totals: { dur: '2m 10s', cost: '$0.42' } });
  const card = host.querySelector('[data-node-id="n_a"]');
  const gate = card.querySelector(':scope > .ngate');
  const run = card.querySelector(':scope > .nrun');
  assert.ok(gate, 'the gate pip is the card\'s own child');
  assert.ok(run, 'so is the duration·cost pill');
  assert.equal(card.querySelector('.nhead .ngate'), null, 'neither is inside the header…');
  assert.equal(card.querySelector('.nhead .nrun'), null, '…so neither can reflow the title');
  assert.ok(card.querySelector('.nhead .tt'), 'and the title span is there to be cleared');
  assert.equal(gate.textContent, '?');
  assert.equal(gate.title, 'waiting on the loop gate');
  assert.equal(gate.dataset.wireId, 'w1');
  assert.equal(run.querySelector('.dur').textContent, '2m 10s');
  assert.equal(run.querySelector('.cost').textContent, '$0.42');

  assert.match(css, /\.gv-world \.ngate\{[^}]*position:absolute[^}]*top:-7px[^}]*\}/,
    'the pip is absolutely placed ABOVE the card edge');
  assert.match(css, /\.gv-world \.nrun\{[^}]*position:absolute[^}]*top:-9px[^}]*\}/,
    'and so is the run pill');
  assert.ok(css.includes('.run-flow.gv-host .gv-world .nrun{margin-top:0;}'),
    'the run host neutralises the v1 .nrun margin that would push it back down');
});
