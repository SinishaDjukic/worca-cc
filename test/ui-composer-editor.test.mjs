// test/ui-composer-editor.test.mjs
// The free-form node composer: palette rail, pointer wiring, selection,
// keyboard, pan/zoom, undo ring, inspector and the save dialog.
//
// Every legality question goes through graph-model's OBJECT-signature
// canWire({template, portsFn, from, to}) — the editor hands it the LIVE
// template and the mirrored ports function, never a hand-rolled wire list, so
// or-homogeneity and the uniform single-wire rule (V7 ⟨f⟩) are decided in one
// place. Save's disabled state is likewise derived from the client VALIDATE
// ADAPTER's report, never from a bespoke "is there an End node?" check; the
// tests assert the adapter FIRST and the button SECOND so the chain is pinned.
//
// jsdom caveats, verified empirically: `HTMLElement.prototype.setPointerCapture`
// does not exist (the editor must call it optionally), and
// `new window.PointerEvent(...)` IS constructible — so the drags below are real
// pointer sequences, not synthetic method calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { portsFnFor, validateGraph, resolveOrOutType } from '../ui/public/graph/graph-model.mjs';
import { EMBEDDED_AGENTS, mergePalette } from '../ui/public/graph/agents-meta.mjs';
import { portAnchor, SNAP } from '../ui/public/graph/graph-geometry.mjs';
import { LEGEND_TEXT } from '../ui/public/graph/graph-view.mjs';
import { createComposerEditor } from '../ui/public/graph/composer-editor.mjs';

const ports = portsFnFor(EMBEDDED_AGENTS);
const palette = mergePalette(null);

const SHELL = `<!doctype html><body>
  <div id="pal"></div>
  <input id="filter" type="search" />
  <div id="canvas"></div>
  <div id="inspector"></div>
  <div id="dialog"></div>
  <button id="save" type="button">Save pipeline</button>
</body>`;

function boot({ template = null, onSave = () => {}, agents = palette, canvasInsetTop } = {}) {
  const dom = new JSDOM(SHELL, { url: 'http://localhost:4317/' });
  const { window } = dom;
  const doc = window.document;
  const els = {
    palette: doc.getElementById('pal'),
    filter: doc.getElementById('filter'),
    canvas: doc.getElementById('canvas'),
    inspector: doc.getElementById('inspector'),
    dialog: doc.getElementById('dialog'),
    save: doc.getElementById('save'),
  };
  const editor = createComposerEditor({
    doc,
    canvas: els.canvas,
    palette: els.palette,
    inspector: els.inspector,
    dialogHost: els.dialog,
    saveButton: els.save,
    filter: els.filter,
    portsFn: ports,
    agents,
    template,
    onSave,
    canvasInsetTop,
  });
  return { window, doc, els, editor };
}

// --- pointer plumbing -------------------------------------------------------
// getBoundingClientRect() answers zeros under jsdom and the editor starts at
// identity transform, so client coords ARE world coords in these tests.

function pe(window, target, type, x, y, init = {}) {
  target.dispatchEvent(new window.PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, ...init,
  }));
}

function drag({ window, doc, els }, from, to, init = {}) {
  pe(window, els.canvas, 'pointerdown', from.x, from.y, init);
  pe(window, doc, 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, init);
  pe(window, doc, 'pointermove', to.x, to.y, init);
  pe(window, doc, 'pointerup', to.x, to.y, init);
}

const anchor = (editor, nodeId, portId, dir) => {
  const tpl = editor.template();
  const node = tpl.nodes.find((n) => n.id === nodeId);
  return portAnchor(node, ports(node), portId, dir);
};

const nodeOfKind = (editor, kind) => editor.template().nodes.find((n) => n.kind === kind);
const nodeOfKey = (editor, key) => editor.template().nodes.find((n) => n.key === key);
const wireInto = (editor, nodeId, port) =>
  editor.template().wires.find((w) => w.to.node === nodeId && w.to.port === port) || null;
const pill = (els, sel) => els.palette.querySelector(sel);
const chipText = (els) => {
  const chip = els.canvas.querySelector('.gv-chip');
  return chip && !chip.hidden ? chip.textContent : '';
};

/** Place an agent from the palette and return its node. */
function place(ctx, key) {
  pill(ctx.els, `.ap[data-key="${key}"]`).click();
  return nodeOfKey(ctx.editor, key);
}
function placeFlow(ctx, kind) {
  pill(ctx.els, `.ap[data-kind="${kind}"]`).click();
  return [...ctx.editor.template().nodes].reverse().find((n) => n.kind === kind);
}

/** Move a node to an exact spot without going through a drag. */
function put(editor, id, x, y) {
  editor.moveNode(id, x, y);
}

// ============================================================ new canvas

test('a new canvas preloads one Task node AND one End node', () => {
  const { editor } = boot();
  const tpl = editor.template();
  assert.equal(tpl.version, 2);
  assert.deepEqual(tpl.nodes.map((n) => n.kind).sort(), ['end', 'task']);
  const ser = editor.serialize();
  assert.ok(ser.nodes.some((n) => n.kind === 'task'), 'serialization carries the task node');
  assert.ok(ser.nodes.some((n) => n.kind === 'end'), 'serialization carries the end node');
  assert.deepEqual(ser.wires, []);
});

test('the empty canvas states how to start, and the hint retires on the first wire', () => {
  const ctx = boot();
  const empty = ctx.els.canvas.querySelector('.gv-empty');
  assert.equal(empty.textContent, 'Wire agents from the Task node to the End node — outputs → inputs');
  assert.equal(empty.hidden, false);

  const task = nodeOfKind(ctx.editor, 'task');
  const end = nodeOfKind(ctx.editor, 'end');
  put(ctx.editor, end.id, 600, 0);
  drag(ctx, anchor(ctx.editor, task.id, 'task', 'out'), anchor(ctx.editor, end.id, 'result', 'in'));
  assert.equal(ctx.editor.template().wires.length, 1);
  assert.equal(ctx.els.canvas.querySelector('.gv-empty').hidden, true);
});

test('the legend carries the NORMATIVE string', () => {
  const { els } = boot();
  assert.equal(
    els.canvas.querySelector('.gv-legend').textContent,
    'grey = data · amber = loop · ◆ = conditional · ○ = gate · ⤫N = fan-out',
  );
  assert.equal(els.canvas.querySelector('.gv-legend').textContent, LEGEND_TEXT);
});

// ============================================================== palette

// Regression: setAgents used to `view.destroy()` (host.replaceChildren()) and
// then repaint into the now-detached world, so the canvas went permanently
// blank after any agent save (save agent -> invalidateAgentCaches ->
// refreshComposerPalette -> setComposerPalette -> editor.setAgents). It must
// swap the registry the way the run monitor does (graph-view.setAgents) and
// repaint in place.
test('setAgents swaps the palette in place: the canvas survives and headers repaint', () => {
  const ctx = boot();
  const plan = place(ctx, 'planner');
  const world = ctx.els.canvas.querySelector('.gv-world');
  assert.ok(world, 'the view world is mounted');
  assert.ok(ctx.els.canvas.querySelector(`.node[data-node-id="${plan.id}"]`), 'the node renders');

  const renamed = palette.map((a) => (a.key === 'planner' ? { ...a, displayName: 'Planner Two' } : a));
  ctx.editor.setAgents(renamed);

  // The mount is the SAME element and still holds the cards — no detached root.
  assert.equal(ctx.els.canvas.querySelector('.gv-world'), world, 'the world stays attached');
  assert.ok(world.isConnected, 'the world is still in the document');
  const card = ctx.els.canvas.querySelector(`.node[data-node-id="${plan.id}"]`);
  assert.ok(card, 'the canvas is not blank after a palette swap');
  // ...and the new registry reached the renderer, not just the palette rail.
  assert.match(card.querySelector('.nhead').textContent, /Planner Two/);
  assert.ok(pill(ctx.els, '.ap[data-key="planner"]'), 'the palette rail repainted too');
});

test('the pinned Flow group is Task · End · AND · OR · Combine, in that order, last', () => {
  const { els } = boot();
  const groups = [...els.palette.querySelectorAll('.pal-group')];
  const flow = groups[groups.length - 1];
  assert.equal(flow.dataset.domain, 'flow');
  assert.deepEqual(
    [...flow.querySelectorAll('.ap')].map((p) => p.dataset.kind),
    ['task', 'end', 'and', 'or', 'combine'],
  );
});

test('Task and End pills are disabled once one is placed; AND/OR/Combine never are', () => {
  const ctx = boot();
  assert.equal(pill(ctx.els, '.ap[data-kind="task"]').disabled, true);
  assert.equal(pill(ctx.els, '.ap[data-kind="end"]').disabled, true);
  assert.equal(pill(ctx.els, '.ap[data-kind="and"]').disabled, false);
  // Deleting End re-enables its pill — the disable state tracks the model.
  ctx.editor.deleteNode(nodeOfKind(ctx.editor, 'end').id);
  assert.equal(pill(ctx.els, '.ap[data-kind="end"]').disabled, false);
  assert.equal(pill(ctx.els, '.ap[data-kind="task"]').disabled, true);
});

test('placeable:false agents never reach the rail', () => {
  const { els } = boot();
  assert.equal(pill(els, '.ap[data-key="workspaceScanner"]'), null);
  assert.ok(pill(els, '.ap[data-key="planner"]'), 'placeable agents do');
});

test('pill line 2 is the lowercase META port ids — the await gate is not repeated', () => {
  const { els } = boot();
  assert.equal(pill(els, '.ap[data-key="refiner"]').querySelector('.p').textContent,
    'in plan, revise · out plan, revise');
  const impl = pill(els, '.ap[data-key="implementer"]').querySelector('.p').textContent;
  assert.equal(impl, 'in plan, fix, task · out done');
  assert.ok(!impl.includes('await'), 'the universal gate is not on every pill');
  assert.equal(pill(els, '.ap[data-kind="end"]').querySelector('.p').textContent, 'in result · terminal');
});

test('the filter narrows pills by name and port ids, and empties whole groups', () => {
  const { els } = boot();
  els.filter.value = 'decompose';
  els.filter.dispatchEvent(new els.filter.ownerDocument.defaultView.Event('input', { bubbles: true }));
  const visible = [...els.palette.querySelectorAll('.ap')].filter((p) => !p.hidden);
  assert.deepEqual(visible.map((p) => p.dataset.key || p.dataset.kind), ['decomposer']);
  els.filter.value = 'checklist';
  els.filter.dispatchEvent(new els.filter.ownerDocument.defaultView.Event('input', { bubbles: true }));
  const byPort = [...els.palette.querySelectorAll('.ap')].filter((p) => !p.hidden).map((p) => p.dataset.key);
  assert.ok(byPort.includes('manualWebUiTesting'), 'its `checklist` input is real pill text');
  assert.ok(byPort.includes('manualTestsChecklist'));
});

// =========================================================== spawn + drag

test('clicking a palette pill spawns that node on the canvas', () => {
  const ctx = boot();
  const before = ctx.editor.template().nodes.length;
  const plan = place(ctx, 'planner');
  assert.ok(plan, 'planner node exists');
  assert.equal(plan.kind, 'agent');
  assert.equal(ctx.editor.template().nodes.length, before + 1);
  assert.ok(ctx.els.canvas.querySelector(`.node[data-node-id="${plan.id}"]`), 'and is rendered');
});

test('dragging a node persists SNAPPED x/y', () => {
  const ctx = boot();
  const plan = place(ctx, 'planner');
  put(ctx.editor, plan.id, 100, 100);
  // Grab the card body (below the header, away from every port anchor).
  drag(ctx, { x: 210, y: 108 }, { x: 210 + 47, y: 108 + 34 });
  const moved = ctx.editor.template().nodes.find((n) => n.id === plan.id);
  assert.equal(moved.x % SNAP, 0, `x snapped to the ${SNAP}px grid (got ${moved.x})`);
  assert.equal(moved.y % SNAP, 0, `y snapped (got ${moved.y})`);
  assert.equal(moved.x, 143);   // snap(147)
  assert.equal(moved.y, 132);   // snap(134)
});

// ============================================================== wiring

function wired(ctx) {
  // task -> planner -> implementer, end parked out of the way.
  const task = nodeOfKind(ctx.editor, 'task');
  const end = nodeOfKind(ctx.editor, 'end');
  put(ctx.editor, task.id, 0, 0);
  put(ctx.editor, end.id, 1500, 800);
  const plan = place(ctx, 'planner');
  put(ctx.editor, plan.id, 300, 0);
  const impl = place(ctx, 'implementer');
  put(ctx.editor, impl.id, 700, 0);
  return { task, end, plan, impl };
}

/** task -> planner -> end and nothing else: the smallest graph that VALIDATES,
 *  so Save's live state is about the rule under test and not a stray V9. */
function minimal(ctx) {
  const task = nodeOfKind(ctx.editor, 'task');
  const end = nodeOfKind(ctx.editor, 'end');
  put(ctx.editor, task.id, 0, 0);
  put(ctx.editor, end.id, 700, 0);
  const plan = place(ctx, 'planner');
  put(ctx.editor, plan.id, 300, 0);
  drag(ctx, anchor(ctx.editor, task.id, 'task', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  drag(ctx, anchor(ctx.editor, plan.id, 'plan', 'out'), anchor(ctx.editor, end.id, 'result', 'in'));
  return { task, end, plan };
}

test('a legal wire drag creates the wire; the ghost is cleared on drop', () => {
  const ctx = boot();
  const { task, plan } = wired(ctx);
  drag(ctx, anchor(ctx.editor, task.id, 'task', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  const w = wireInto(ctx.editor, plan.id, 'task');
  assert.ok(w, 'wire created');
  assert.deepEqual(w.from, { node: task.id, port: 'task' });
  assert.equal(ctx.els.canvas.querySelector('.gv-ghost').hidden, true);
  assert.equal(chipText(ctx.els), '');
});

test('a type-mismatched drop is refused with canWire\'s reason chip', () => {
  const ctx = boot();
  const { plan } = wired(ctx);
  const clarify = place(ctx, 'clarify');
  put(ctx.editor, clarify.id, 300, 400);
  // clarify.answers is json; planner.task is md.
  drag(ctx, anchor(ctx.editor, clarify.id, 'answers', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  assert.equal(wireInto(ctx.editor, plan.id, 'task'), null, 'no wire');
  assert.equal(chipText(ctx.els), 'json → md type mismatch');
});

test('a drop on an ALREADY-WIRED input is refused — one string for every input kind', () => {
  const ctx = boot();
  const { task, end, plan, impl } = wired(ctx);
  const review = place(ctx, 'reviewer');
  put(ctx.editor, review.id, 1100, 0);
  const or = placeFlow(ctx, 'or');
  put(ctx.editor, or.id, 700, 500);

  // 1. an agent meta input
  drag(ctx, anchor(ctx.editor, task.id, 'task', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  const first = wireInto(ctx.editor, plan.id, 'task');
  drag(ctx, anchor(ctx.editor, plan.id, 'plan', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  assert.equal(wireInto(ctx.editor, plan.id, 'task').id, first.id, 'the original wire is untouched');
  assert.equal(chipText(ctx.els), 'already connected');

  // 2. the synthesized await gate
  drag(ctx, anchor(ctx.editor, plan.id, 'plan', 'out'), anchor(ctx.editor, impl.id, 'await', 'in'));
  assert.ok(wireInto(ctx.editor, impl.id, 'await'), 'gate accepts any type');
  drag(ctx, anchor(ctx.editor, review.id, 'pass', 'out'), anchor(ctx.editor, impl.id, 'await', 'in'));
  assert.equal(chipText(ctx.els), 'already connected');

  // 3. an or inK
  drag(ctx, anchor(ctx.editor, plan.id, 'plan', 'out'), anchor(ctx.editor, or.id, 'in1', 'in'));
  assert.ok(wireInto(ctx.editor, or.id, 'in1'));
  drag(ctx, anchor(ctx.editor, review.id, 'review', 'out'), anchor(ctx.editor, or.id, 'in1', 'in'));
  assert.equal(chipText(ctx.els), 'already connected');

  // 4. end.result
  drag(ctx, anchor(ctx.editor, review.id, 'pass', 'out'), anchor(ctx.editor, end.id, 'result', 'in'));
  assert.ok(wireInto(ctx.editor, end.id, 'result'));
  drag(ctx, anchor(ctx.editor, impl.id, 'done', 'out'), anchor(ctx.editor, end.id, 'result', 'in'));
  assert.equal(chipText(ctx.els), 'already connected');
});

test('rewiring is delete-then-drop: Del on the selected wire frees the input', () => {
  const ctx = boot();
  const { task, plan } = wired(ctx);
  drag(ctx, anchor(ctx.editor, task.id, 'task', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  const old = wireInto(ctx.editor, plan.id, 'task');

  // Click the wire at its midpoint to select it, then Del.
  const path = ctx.els.canvas.querySelector(`path.wire[data-wire-id="${old.id}"]`);
  assert.ok(path, 'the wire is painted');
  ctx.editor.select({ kind: 'wire', id: old.id });
  ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  assert.equal(wireInto(ctx.editor, plan.id, 'task'), null, 'input is free again');

  const refine = place(ctx, 'refiner');
  put(ctx.editor, refine.id, 300, 400);
  drag(ctx, anchor(ctx.editor, refine.id, 'plan', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  const next = wireInto(ctx.editor, plan.id, 'task');
  assert.ok(next, 'the redrop lands');
  assert.equal(next.from.node, refine.id);
  assert.equal(chipText(ctx.els), '');
});

test('an AND card accepts a wire from ANY output type', () => {
  const ctx = boot();
  const { plan, impl } = wired(ctx);
  const and = placeFlow(ctx, 'and');
  put(ctx.editor, and.id, 1100, 500);
  drag(ctx, anchor(ctx.editor, plan.id, 'plan', 'out'), anchor(ctx.editor, and.id, 'in1', 'in'));
  drag(ctx, anchor(ctx.editor, impl.id, 'done', 'out'), anchor(ctx.editor, and.id, 'in2', 'in'));
  assert.ok(wireInto(ctx.editor, and.id, 'in1'), 'md into and.in1');
  assert.ok(wireInto(ctx.editor, and.id, 'in2'), 'void into and.in2');
  assert.equal(chipText(ctx.els), '');
  // ...and its static void out is NOT legal into an md input.
  drag(ctx, anchor(ctx.editor, and.id, 'out', 'out'), anchor(ctx.editor, impl.id, 'plan', 'in'));
  assert.equal(wireInto(ctx.editor, impl.id, 'plan'), null);
  assert.equal(chipText(ctx.els), 'void → md type mismatch');
});

test('an OR valve takes two md blocking outputs and feeds a loop input — legal, no warning', () => {
  const ctx = boot();
  const { plan, impl } = wired(ctx);
  const review = place(ctx, 'reviewer');
  put(ctx.editor, review.id, 1100, 0);
  const pr = place(ctx, 'planReviewer');
  put(ctx.editor, pr.id, 1100, 300);
  const or = placeFlow(ctx, 'or');
  put(ctx.editor, or.id, 700, 600);

  drag(ctx, anchor(ctx.editor, review.id, 'review', 'out'), anchor(ctx.editor, or.id, 'in1', 'in'));
  drag(ctx, anchor(ctx.editor, pr.id, 'review', 'out'), anchor(ctx.editor, or.id, 'in2', 'in'));
  drag(ctx, anchor(ctx.editor, or.id, 'out', 'out'), anchor(ctx.editor, impl.id, 'fix', 'in'));

  assert.ok(wireInto(ctx.editor, or.id, 'in1'));
  assert.ok(wireInto(ctx.editor, or.id, 'in2'));
  assert.ok(wireInto(ctx.editor, impl.id, 'fix'), 'the valve feeds the loop input');
  assert.equal(chipText(ctx.els), '');

  const tpl = ctx.editor.template();
  assert.equal(resolveOrOutType(tpl.nodes.find((n) => n.id === or.id), tpl, ports), 'md');
  const report = ctx.editor.report();
  assert.deepEqual(report.warnings.filter((w) => w.code === 'V19'), [],
    'or inputs are the canonical loop-valve terminals — V19 is exempt there');
  assert.deepEqual(report.errors.filter((e) => e.code === 'V8' || e.code === 'V12'), []);
  assert.ok(plan, 'planner is on the canvas');
});

test('a heterogeneous drop on a resolved OR is refused with the resolved type', () => {
  const ctx = boot();
  const { plan } = wired(ctx);
  const clarify = place(ctx, 'clarify');
  put(ctx.editor, clarify.id, 300, 400);
  const or = placeFlow(ctx, 'or');
  put(ctx.editor, or.id, 700, 600);

  drag(ctx, anchor(ctx.editor, plan.id, 'plan', 'out'), anchor(ctx.editor, or.id, 'in1', 'in'));
  drag(ctx, anchor(ctx.editor, clarify.id, 'answers', 'out'), anchor(ctx.editor, or.id, 'in2', 'in'));
  assert.equal(wireInto(ctx.editor, or.id, 'in2'), null, 'the json drop is refused');
  assert.equal(chipText(ctx.els), 'or inputs must match: md');
});

// ================================================= validate adapter -> Save

test('deleting End reports V21 through the adapter, and Save derives disabled from THAT', () => {
  const ctx = boot();
  const { end } = minimal(ctx);

  // Sanity: the graph validates, so Save is live.
  assert.deepEqual(ctx.editor.report().errors, []);
  assert.equal(ctx.els.save.disabled, false);

  ctx.editor.select({ kind: 'node', id: end.id });
  ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

  // 1. the ADAPTER speaks first...
  const report = ctx.editor.report();
  const v21 = report.errors.filter((e) => e.code === 'V21');
  assert.equal(v21.length, 1, JSON.stringify(report.errors));
  assert.equal(v21[0].msg, 'a template must declare exactly one end node (found 0)');
  // ...and it is the SAME verdict the shared validator gives.
  assert.deepEqual(report, validateGraph(ctx.editor.template(), ports));
  // 2. ...then the button follows it.
  assert.equal(ctx.els.save.disabled, true);
  assert.equal(ctx.els.save.dataset.errorCount, '1');
});

test('deleting a node takes its wires with it', () => {
  const ctx = boot();
  const { task, plan } = wired(ctx);
  drag(ctx, anchor(ctx.editor, task.id, 'task', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  assert.equal(ctx.editor.template().wires.length, 1);
  ctx.editor.select({ kind: 'node', id: plan.id });
  ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  assert.equal(ctx.editor.template().nodes.find((n) => n.id === plan.id), undefined);
  assert.deepEqual(ctx.editor.template().wires, []);
  assert.equal(ctx.els.canvas.querySelector(`.node[data-node-id="${plan.id}"]`), null);
});

// ================================================================ undo

test('undo/redo restore the exact serialization', () => {
  const ctx = boot();
  const { task, plan } = wired(ctx);
  const before = JSON.stringify(ctx.editor.serialize());
  drag(ctx, anchor(ctx.editor, task.id, 'task', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  const after = JSON.stringify(ctx.editor.serialize());
  assert.notEqual(before, after);

  ctx.editor.undo();
  assert.equal(JSON.stringify(ctx.editor.serialize()), before);
  ctx.editor.redo();
  assert.equal(JSON.stringify(ctx.editor.serialize()), after);

  // Cmd+Z / Shift+Cmd+Z drive the same ring.
  ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
  assert.equal(JSON.stringify(ctx.editor.serialize()), before);
  ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }));
  assert.equal(JSON.stringify(ctx.editor.serialize()), after);
});

test('the undo ring holds 50 steps and drops the oldest', () => {
  const ctx = boot();
  const plan = place(ctx, 'planner');
  const states = [];
  for (let i = 0; i < 60; i += 1) {
    states.push(JSON.stringify(ctx.editor.serialize()));
    put(ctx.editor, plan.id, 11 * (i + 1), 0);
  }
  assert.equal(ctx.editor.undoDepth(), 50);
  for (let i = 0; i < 50; i += 1) ctx.editor.undo();
  assert.equal(ctx.editor.undoDepth(), 0);
  assert.equal(JSON.stringify(ctx.editor.serialize()), states[10], 'the oldest 10 fell off the ring');
  ctx.editor.undo();   // a no-op at the bottom
  assert.equal(JSON.stringify(ctx.editor.serialize()), states[10]);
});

// =========================================================== pan and zoom

test('the wheel pans; space-drag and middle-drag pan too', () => {
  const ctx = boot();
  ctx.els.canvas.dispatchEvent(new ctx.window.WheelEvent('wheel', { deltaX: 30, deltaY: 20, bubbles: true, cancelable: true }));
  assert.deepEqual(ctx.editor.transform(), { x: -30, y: -20, zoom: 1 });

  ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  drag(ctx, { x: 100, y: 100 }, { x: 140, y: 130 });
  assert.deepEqual(ctx.editor.transform(), { x: 10, y: 10, zoom: 1 });
  ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keyup', { key: ' ', bubbles: true }));

  // Middle-drag pans regardless of the space latch.
  drag(ctx, { x: 100, y: 100 }, { x: 90, y: 95 }, { button: 1, buttons: 4 });
  assert.deepEqual(ctx.editor.transform(), { x: 0, y: 5, zoom: 1 });
});

test('Cmd+wheel and pinch zoom about the cursor, clamped to 0.4-1.6', () => {
  const ctx = boot();
  const cursor = { x: 240, y: 160 };
  const worldBefore = ctx.editor.toWorld(cursor.x, cursor.y);
  ctx.els.canvas.dispatchEvent(new ctx.window.WheelEvent('wheel', {
    deltaY: -100, metaKey: true, bubbles: true, cancelable: true, clientX: cursor.x, clientY: cursor.y,
  }));
  const t = ctx.editor.transform();
  assert.ok(t.zoom > 1, `zoomed in (got ${t.zoom})`);
  const worldAfter = ctx.editor.toWorld(cursor.x, cursor.y);
  assert.ok(Math.abs(worldAfter.x - worldBefore.x) < 1e-6, 'the point under the cursor did not move');
  assert.ok(Math.abs(worldAfter.y - worldBefore.y) < 1e-6);

  // Pinch (ctrlKey wheel, the trackpad idiom) shares the path and the clamp.
  for (let i = 0; i < 40; i += 1) {
    ctx.els.canvas.dispatchEvent(new ctx.window.WheelEvent('wheel', {
      deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: cursor.x, clientY: cursor.y,
    }));
  }
  assert.equal(ctx.editor.transform().zoom, 1.6, 'clamped at the ceiling');
  for (let i = 0; i < 80; i += 1) {
    ctx.els.canvas.dispatchEvent(new ctx.window.WheelEvent('wheel', {
      deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true, clientX: cursor.x, clientY: cursor.y,
    }));
  }
  assert.equal(ctx.editor.transform().zoom, 0.4, 'clamped at the floor');
});

test('the zoom cluster reads out, steps, and fits; port dots fade under 0.6', () => {
  const ctx = boot();
  const world = ctx.els.canvas.querySelector('.gv-world');
  const cluster = ctx.els.canvas.querySelector('.gv-zoom');
  assert.equal(cluster.querySelector('.pct').textContent, '100%');
  cluster.querySelector('.zoom-out').click();
  assert.ok(ctx.editor.transform().zoom < 1);
  assert.equal(cluster.querySelector('.pct').textContent, `${Math.round(ctx.editor.transform().zoom * 100)}%`);
  cluster.querySelector('.zoom-in').click();
  assert.equal(ctx.editor.transform().zoom, 1);

  ctx.editor.setZoom(0.5);
  assert.ok(world.classList.contains('dots-faded'));
  ctx.editor.setZoom(1);
  assert.equal(world.classList.contains('dots-faded'), false);

  put(ctx.editor, nodeOfKind(ctx.editor, 'end').id, 4000, 3000);
  cluster.querySelector('.zoom-fit').click();
  assert.ok(ctx.editor.transform().zoom < 1, 'fit zooms out to hold both bookends');
});

test('the auto-layout button re-ranks the graph deterministically', () => {
  const ctx = boot();
  const { task, plan } = wired(ctx);
  drag(ctx, anchor(ctx.editor, task.id, 'task', 'out'), anchor(ctx.editor, plan.id, 'task', 'in'));
  put(ctx.editor, plan.id, 2200, 1900);
  ctx.els.canvas.querySelector('.gv-autolayout').click();
  const laid = ctx.editor.template().nodes.find((n) => n.id === plan.id);
  const src = ctx.editor.template().nodes.find((n) => n.id === task.id);
  assert.equal(src.x, 60, 'the source ranks first at x0');
  assert.equal(laid.x, 360, 'rank 1 sits one 300px column right');
  const snapshot = JSON.stringify(ctx.editor.serialize());
  ctx.els.canvas.querySelector('.gv-autolayout').click();
  assert.equal(JSON.stringify(ctx.editor.serialize()), snapshot, 'idempotent');
  ctx.editor.undo();
  assert.equal(ctx.editor.template().nodes.find((n) => n.id === plan.id).x, 2200, 'auto-layout is undoable');
});

// ============================================================== inspector

test('the agent panel is gated by meta booleans, exactly as the old step rows were', () => {
  const ctx = boot();
  const plan = place(ctx, 'planner');
  ctx.editor.select({ kind: 'node', id: plan.id });
  const ins = ctx.els.inspector;
  assert.equal(ins.querySelector('.ins-name').textContent, 'Plan');
  assert.ok(ins.querySelector('.ins-model'), 'model row');
  assert.ok(ins.querySelector('.ins-effort'), 'effort row');
  // planner: fanOut true, asksQuestions true but NOT locked and default off.
  assert.equal(ins.querySelector('.ins-fanout').hidden, false);
  const plannerQ = ins.querySelector('.ins-questions input');
  assert.equal(plannerQ.disabled, false, 'unlocked agents stay editable');
  assert.equal(plannerQ.checked, false, 'and start at their declared default');
  assert.equal(ins.querySelector('.ins-questions').title, '');
  assert.ok(ins.querySelector('.ins-awaitall'), 'the awaitAll toggle SURVIVES');

  // An agent that does not declare the capability gets NO row at all. Every
  // shipped builtin asks questions, so this branch is pinned with a registry
  // entry that does not — which is exactly what a user sidecar looks like.
  const quiet = boot({ agents: mergePalette([{ ...EMBEDDED_AGENTS.implementer, asksQuestions: false }]) });
  const quietImpl = place(quiet, 'implementer');
  quiet.editor.select({ kind: 'node', id: quietImpl.id });
  assert.equal(quiet.els.inspector.querySelector('.ins-questions'), null,
    'no questions row without the capability');
  assert.ok(quiet.els.inspector.querySelector('.ins-awaitall'), 'awaitAll is unconditional');

  // clarify: asksQuestions + questionsLocked + questionsDefault.
  const clarify = place(ctx, 'clarify');
  ctx.editor.select({ kind: 'node', id: clarify.id });
  const q = ctx.els.inspector.querySelector('.ins-questions input');
  assert.ok(q, 'questions row shown');
  assert.equal(q.disabled, true, 'locked');
  assert.equal(q.checked, true, 'forced to the agent default');
  assert.equal(ctx.els.inspector.querySelector('.ins-questions').title, 'Always on for this agent');

  // manualTestsChecklist declares fanOut:false -> no fan-out row at all.
  const chk = place(ctx, 'manualTestsChecklist');
  ctx.editor.select({ kind: 'node', id: chk.id });
  assert.equal(ctx.els.inspector.querySelector('.ins-fanout'), null);
});

test('inspector edits land in node.config and are undoable', () => {
  const ctx = boot();
  const plan = place(ctx, 'planner');
  ctx.editor.select({ kind: 'node', id: plan.id });
  const toggle = ctx.els.inspector.querySelector('.ins-awaitall input');
  toggle.checked = true;
  toggle.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(ctx.editor.template().nodes.find((n) => n.id === plan.id).config.awaitAll, true);
  ctx.editor.undo();
  assert.ok(!ctx.editor.template().nodes.find((n) => n.id === plan.id).config.awaitAll);
});

test('the flow panel edits arity and re-synthesizes the in-ports', () => {
  const ctx = boot();
  const or = placeFlow(ctx, 'or');
  ctx.editor.select({ kind: 'node', id: or.id });
  const arity = ctx.els.inspector.querySelector('.ins-arity input');
  assert.equal(Number(arity.value), 2);
  assert.equal(Number(arity.min), 2);
  arity.value = '3';
  arity.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(ctx.editor.template().nodes.find((n) => n.id === or.id).config.arity, 3);
  const card = ctx.els.canvas.querySelector(`.node[data-node-id="${or.id}"]`);
  assert.deepEqual([...card.querySelectorAll('.prow.in')].map((r) => r.dataset.port), ['in1', 'in2', 'in3']);
  // Below 2 is refused — V12's floor. (The panel is re-rendered after every
  // edit, so re-query rather than reusing the detached input.)
  const arity2 = ctx.els.inspector.querySelector('.ins-arity input');
  arity2.value = '1';
  arity2.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(ctx.editor.template().nodes.find((n) => n.id === or.id).config.arity, 2);
});

test('the OR panel reports the resolved forwarded type; End has nothing to configure', () => {
  const ctx = boot();
  const { plan } = wired(ctx);
  const or = placeFlow(ctx, 'or');
  put(ctx.editor, or.id, 700, 600);
  ctx.editor.select({ kind: 'node', id: or.id });
  assert.equal(ctx.els.inspector.querySelector('.ins-resolved').textContent, 'unresolved');
  drag(ctx, anchor(ctx.editor, plan.id, 'plan', 'out'), anchor(ctx.editor, or.id, 'in1', 'in'));
  ctx.editor.select({ kind: 'node', id: or.id });
  assert.equal(ctx.els.inspector.querySelector('.ins-resolved').textContent, 'forwards: md');

  ctx.editor.select({ kind: 'node', id: nodeOfKind(ctx.editor, 'end').id });
  assert.equal(ctx.els.inspector.querySelector('.ins-name').textContent, 'End');
  assert.equal(ctx.els.inspector.querySelectorAll('input, select, textarea').length, 0, 'read-only panel');
});

test('selecting a loop wire opens its maxCycles editor', () => {
  const ctx = boot();
  const { impl } = wired(ctx);
  const review = place(ctx, 'reviewer');
  put(ctx.editor, review.id, 1100, 0);
  // A wire is a LOOP wire only when its blocking source sits in the same SCC —
  // so close the cycle first, then wire the blocking arm back.
  drag(ctx, anchor(ctx.editor, impl.id, 'done', 'out'), anchor(ctx.editor, review.id, 'done', 'in'));
  drag(ctx, anchor(ctx.editor, review.id, 'review', 'out'), anchor(ctx.editor, impl.id, 'fix', 'in'));
  const w = wireInto(ctx.editor, impl.id, 'fix');
  ctx.editor.select({ kind: 'wire', id: w.id });
  const max = ctx.els.inspector.querySelector('.ins-maxcycles input');
  assert.ok(max, 'loop wires carry a budget editor');
  max.value = '5';
  max.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(ctx.editor.template().wires.find((x) => x.id === w.id).config.maxCycles, 5);
});

// ============================================================ save dialog

test('the save dialog posts a v2 template including the canvas view state', async () => {
  const posted = [];
  const ctx = boot({ onSave: (body) => { posted.push(body); return Promise.resolve({ ok: true }); } });
  minimal(ctx);
  ctx.editor.setZoom(0.8);

  ctx.els.save.click();
  const dialog = ctx.els.dialog.querySelector('.save-dialog');
  assert.ok(dialog, 'the modal replaces the old window.prompt');
  dialog.querySelector('.sd-name').value = 'My Flow';
  dialog.querySelector('.sd-domain').value = 'coding';
  dialog.querySelector('.sd-confirm').click();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(posted.length, 1);
  const body = posted[0];
  assert.equal(body.name, 'My Flow');
  assert.equal(body.domain, 'coding');
  assert.equal(body.version, 2);
  assert.ok(body.nodes.some((n) => n.kind === 'task'));
  assert.ok(body.nodes.some((n) => n.kind === 'end'));
  assert.equal(body.wires.length, 2);
  assert.deepEqual(Object.keys(body.canvas).sort(), ['x', 'y', 'zoom']);
  assert.equal(body.canvas.zoom, 0.8);
});

test('a loaded template round-trips its canvas through the editor', () => {
  const loaded = {
    id: 'wf_load', name: 'Loaded', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 300, y: 0, config: {} },
    ],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }],
    canvas: { x: -40, y: 12, zoom: 1.25 },
  };
  const ctx = boot({ template: loaded });
  assert.deepEqual(ctx.editor.transform(), { x: -40, y: 12, zoom: 1.25 });
  assert.deepEqual(ctx.editor.serialize().canvas, { x: -40, y: 12, zoom: 1.25 });
  assert.equal(ctx.els.save.disabled, false, 'a valid loaded template saves');
});

test('dirty tracking flips on the first edit and clears after a save', async () => {
  const ctx = boot({ onSave: () => Promise.resolve({ ok: true }) });
  assert.equal(ctx.editor.isDirty(), false);
  minimal(ctx);
  assert.equal(ctx.editor.isDirty(), true);
  ctx.els.save.click();
  const dialog = ctx.els.dialog.querySelector('.save-dialog');
  dialog.querySelector('.sd-name').value = 'X';
  dialog.querySelector('.sd-confirm').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.editor.isDirty(), false);
});

// --- the top drawer overlays the canvas --------------------------------------
// The drawer added in this change is an OVERLAY (it does not reflow the card),
// so everything that assumed "the canvas rect is the visible region" needs the
// inset. jsdom zeroes every rect, so each case stubs a real box.

test('a palette spawn clears the drawer overlay when canvasInsetTop reports one', () => {
  // A new canvas has no persisted view state, so the transform is identity and
  // client coords are world coords. snap() is the 11px half-grid.
  const spawnY = (inset) => {
    const ctx = boot({ canvasInsetTop: inset });
    ctx.els.canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
    });
    return ctx.editor.spawn({ key: 'planner' }).y;
  };

  // inset 0  -> centre y 300, minus the 60px header lead -> snap(240) = 242
  assert.equal(spawnY(undefined), 242, 'the default is byte-for-byte the old behaviour');
  // inset 200 -> centre of the VISIBLE band is 200 + (600-200)/2 = 400 -> snap(340) = 341
  assert.equal(spawnY(() => 200), 341, 'the node lands below the open overlay');
});

test('fit() fits into the band the drawer leaves visible', () => {
  // Deliberately assertion-by-property, not by magic number: what matters is
  // that the topmost card paints BELOW the panel, whatever the zoom works out to.
  const rect = { left: 0, top: 0, width: 800, height: 640, right: 800, bottom: 640 };
  const fitted = (inset) => {
    const ctx = boot({ canvasInsetTop: inset });
    ctx.els.canvas.getBoundingClientRect = () => rect;
    ctx.editor.fit();
    const t = ctx.editor.transform();
    const topWorldY = Math.min(...ctx.editor.template().nodes.map((n) => n.y));
    return { t, screenTop: topWorldY * t.zoom + t.y };
  };

  // A literal, NOT fitted(() => 0): both of those run the NEW code with inset 0,
  // so comparing them to each other could never fail. These are the numbers
  // today's fit() produces for a fresh Task+End canvas in an 800x640 rect —
  // b = {x:0, y:140, w:1240, h:230.5}, zoom = round(min(800/1240, 640/230.5)*100)/100
  // = 0.65, y = -140*0.65. `x` is -0 (`-b.x * zoom` with b.x === 0) and deepEqual
  // is SameValue on zeros, so write it as -0.
  assert.deepEqual(fitted(undefined).t, { x: -0, y: -91, zoom: 0.65 },
    'no inset is byte-for-byte the pre-drawer fit');
  assert.ok(fitted(() => 0).screenTop < 240,
    'guard: without the inset the graph really does start under the panel');
  assert.ok(fitted(() => 240).screenTop >= 240,
    'with the inset the highest card paints below the 240px panel');
});

test('successive pill spawns cascade instead of stacking on one pixel', () => {
  // centerWorld() is a pure function of the rect and the transform, and spawn()
  // changes neither — so without a cascade the second card would fully cover the
  // first, and hitTest (topmost-first) would make the first unreachable.
  const ctx = boot();
  const a = ctx.editor.spawn({ key: 'planner' });
  const b = ctx.editor.spawn({ key: 'planner' });
  assert.notDeepEqual({ x: b.x, y: b.y }, { x: a.x, y: a.y },
    'the second card is not hidden underneath the first');

  // An explicit position is still honoured verbatim — the cascade is only for
  // the centre-of-canvas default.
  const c = ctx.editor.spawn({ key: 'planner' }, { x: a.x, y: a.y });
  assert.deepEqual({ x: c.x, y: c.y }, { x: a.x, y: a.y },
    'spawn(entry, at) still places exactly where it is told');
});
