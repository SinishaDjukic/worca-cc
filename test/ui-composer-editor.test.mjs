// test/ui-composer-editor.test.mjs — the composer's pointer pipeline under jsdom.
// jsdom has no layout, no rAF and no pointer capture: `viewport` injects the
// stage rect and `raf` queues frames so "60 moves ⇒ 1 frame" is observable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
// From the HELPER, never from ui-graph-view.test.mjs: importing a *.test.mjs file
// evaluates it, which re-registers and re-runs all 17 view tests inside THIS
// process — every "# pass N" below would be wrong and the suite total would
// double-count them.
import { fixture, portsFn, AGENTS } from './helpers/graph-view-fixture.mjs';

const composerPath = new URL('../ui/public/graph/composer.mjs', import.meta.url).href;
const RECT = { left: 0, top: 0, width: 1280, height: 560 };

const IDS = ['gv-canvas', 'gv-chip', 'gv-head', 'gv-name', 'gv-errors', 'gv-new', 'gv-autolayout',
  'gv-save', 'gv-ins-rail', 'gv-ins-body', 'gv-ins-toggle', 'gv-ins-tabs', 'gv-palette', 'gv-agent-filter',
  'gv-saved-list', 'gv-saved-count', 'gv-archived', 'gv-dialog-host'];

export function shell() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const el = {};
  for (const id of IDS) {
    // Anchored: a loose /save/ also matches gv-saved-list and gv-saved-count,
    // which are containers, not buttons.
    const tag = /^gv-(name|agent-filter)$/.test(id) ? 'input'
      : (/^gv-(save|new|autolayout|errors|ins-toggle)$/.test(id) ? 'button' : 'div');
    const n = doc.createElement(tag);
    n.id = id;
    doc.body.appendChild(n);
  }
  // chip and rail are the stage's SIBLINGS inside the canvas host, exactly as in index.html
  doc.getElementById('gv-canvas').append(doc.getElementById('gv-chip'), doc.getElementById('gv-ins-rail'));
  // …and the tablist is the rail's own top row, mirroring index.html.
  for (const tab of ['agents', 'info']) {
    const b = doc.createElement('button');
    b.type = 'button'; b.dataset.tab = tab; b.textContent = tab;
    doc.getElementById('gv-ins-tabs').appendChild(b);
  }
  for (const id of IDS) el[id.replace(/^gv-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = doc.getElementById(id);
  const q = [];
  return {
    dom, win: dom.window, doc, el,
    hostEls: {
      canvas: el.canvas, chip: el.chip, head: el.head, name: el.name, errors: el.errors,
      newBtn: el.new, autoBtn: el.autolayout, saveBtn: el.save, insRail: el.insRail, insBody: el.insBody,
      insToggle: el.insToggle, insTabs: el.insTabs, palette: el.palette, filter: el.agentFilter, savedList: el.savedList,
      savedCount: el.savedCount, archived: el.archived, dialogHost: el.dialogHost,
    },
    raf: (fn) => { q.push(fn); return q.length; },
    flush: () => { const l = q.splice(0, q.length); for (const fn of l) fn(); return l.length; },
    frames: () => q.length,
  };
}

export const API = {
  agents: async () => Object.values(AGENTS),
  agentsAll: async () => Object.values(AGENTS),
  config: async () => ({ models: [{ id: 'sonnet', label: 'Sonnet' }], efforts: ['low', 'high'] }),
  listWorkflows: async () => [],
  listArchived: async () => [],
  readWorkflow: async () => null,
  saveWorkflow: async () => ({ ok: true, workflow: { id: 'wf_x' } }),
  deleteWorkflow: async () => ({ ok: true }),
};

export async function open(overrides = {}) {
  const s = shell();
  const { createComposer } = await import(composerPath);
  const c = createComposer(s.hostEls, {
    doc: s.doc, api: { ...API, ...(overrides.api || {}) }, raf: s.raf,
    viewport: () => ({ ...RECT }), storage: overrides.storage || null, portsFn,
  });
  c.mount();
  c.loadTemplate(overrides.template === undefined ? fixture() : overrides.template);
  return { ...s, c };
}

const down = (s, x, y, extra = {}) => s.c.view.stage.dispatchEvent(new s.win.PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra }));
const move = (s, x, y) => s.c.view.stage.dispatchEvent(new s.win.PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y, bubbles: true }));
const up = (s, x, y) => s.c.view.stage.dispatchEvent(new s.win.PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true }));

test('60 pointermoves coalesce into ONE frame and ONE ghost d write', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  down(s, 620, 193);                                     // n_agent.plan output anchor
  assert.equal(s.c.gesture().type, 'wire');
  const g0 = s.c.view.stats.ghostUpdates;
  for (let i = 0; i < 60; i += 1) move(s, 200 + i, 480 + (i % 7));
  assert.equal(s.frames(), 1, '60 moves => exactly one queued frame');
  assert.equal(s.c.view.stats.ghostUpdates - g0, 0, 'no DOM write before the frame runs');
  s.flush();
  assert.equal(s.c.view.stats.ghostUpdates - g0, 1, 'the frame writes d exactly once');
  assert.equal(s.c.stats.rectReads, 2, 'one read at mount + one at gesture start; ZERO on the move path');
  up(s, 259, 486);
  s.flush();
  assert.equal(s.c.gesture(), null);
  assert.equal(s.c.template().wires.length, 2, 'a drop on empty canvas commits nothing');
  assert.equal(s.c.view.ghostEl.getAttribute('class'), 'wire ghost');
});

test('a drag from an INPUT port mirrors the tangent, snaps to a legal anchor and commits', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  down(s, 400, 160);                                     // n_agent.fix (input)
  move(s, 280, 160); s.flush();
  const d = s.c.view.ghostEl.getAttribute('d');
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.equal(d, 'M 400 160 C 346 160, 334 160, 280 160');
  assert.ok(n[2] < n[0], 'first control x is LEFT of the anchor (mirrored)');
  move(s, 280, 199); s.flush();                          // onto n_task.task (output)
  assert.equal(s.c.view.ghostEl.getAttribute('class'), 'wire ghost on legal');
  assert.match(s.c.view.ghostEl.getAttribute('d'), /280 199$/, 'ghost end snapped to the anchor');
  assert.ok(s.c.view.nodeEl('n_task').querySelector('.prow[data-port="task"]').classList.contains('drop-ok'));
  up(s, 280, 199); s.flush();
  assert.equal(s.c.template().wires.length, 3);
  const w = s.c.template().wires[2];
  assert.deepEqual(w.from, { node: 'n_task', port: 'task' }, 'normalised output → input on commit');
  assert.deepEqual(w.to, { node: 'n_agent', port: 'fix' });
  assert.equal(s.c.isDirty(), true);
  assert.equal(s.c.view.wiresEl.lastElementChild.getAttribute('class'), 'wire ghost', 'ghost is still last');
});

test('illegal drops show the reason chip at world→screen + 14 and commit nothing', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  down(s, 620, 193);                                     // n_agent.plan (already wired to n_end.result)
  move(s, 760, 199); s.flush();                          // over n_end.result
  assert.equal(s.c.view.ghostEl.getAttribute('class'), 'wire ghost on illegal');
  assert.equal(s.el.chip.textContent, 'already connected');
  assert.equal(s.el.chip.hidden, false);
  assert.equal(s.el.chip.style.left, `${760 + 14}px`);
  assert.equal(s.el.chip.style.top, `${199 + 14}px`);
  assert.ok(s.c.view.nodeEl('n_end').querySelector('.prow[data-port="result"]').classList.contains('drop-bad'));
  move(s, 400, 136); s.flush();                          // over n_agent.task — same node
  assert.equal(s.el.chip.textContent, 'same node');
  up(s, 400, 136); s.flush();
  assert.equal(s.c.template().wires.length, 2);
  assert.equal(s.el.chip.hidden, true);
  assert.equal(s.c.isDirty(), false);
});

test('a self-loop drop (blocking output → own loop input) is legal and commits an amber loop wire', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  down(s, 620, 193);                                     // n_agent.plan (when:'always')
  move(s, 400, 160); s.flush();                          // over n_agent.fix (loop input) — same card
  assert.equal(s.el.chip.textContent, 'same node', 'a plain output still cannot feed its own card');
  up(s, 400, 160); s.flush();
  assert.equal(s.c.template().wires.length, 2);
  down(s, 620, 217);                                     // n_agent.review (when:'blocking')
  move(s, 400, 160); s.flush();                          // over n_agent.fix again
  assert.equal(s.c.view.ghostEl.getAttribute('class'), 'wire ghost on legal');
  assert.equal(s.el.chip.hidden, true);
  assert.ok(s.c.view.nodeEl('n_agent').querySelector('.prow[data-port="fix"]').classList.contains('drop-ok'));
  up(s, 400, 160); s.flush();
  assert.equal(s.c.template().wires.length, 3, 'the self-loop committed');
  const w = s.c.template().wires[2];
  assert.deepEqual(w.from, { node: 'n_agent', port: 'review' });
  assert.deepEqual(w.to, { node: 'n_agent', port: 'fix' });
  assert.equal(s.c.view.wiresEl.querySelector(`path[data-wire-id="${w.id}"]`).getAttribute('class'), 'wire loop', 'classified as a loop wire');
  assert.deepEqual(s.c.report().errors, [], 'the validator agrees');
  assert.equal(s.c.isDirty(), true);
});

test('destroy() unbinds everything; pointercancel and window blur end a gesture', async () => {
  const s = await open();
  down(s, 400, 80); move(s, 500, 120); s.flush();
  assert.equal(s.c.gesture().type, 'node');
  s.win.dispatchEvent(new s.win.Event('blur'));
  assert.equal(s.c.gesture(), null, 'blur cancels');
  assert.equal(s.c.template().nodes[1].x, 400, 'the moved node reverted');
  down(s, 400, 80);
  s.c.view.stage.dispatchEvent(new s.win.PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
  assert.equal(s.c.gesture(), null, 'pointercancel cancels');
  const before = JSON.stringify(s.c.template());
  s.c.destroy();
  down(s, 400, 80); move(s, 900, 400); s.flush();
  s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  assert.equal(s.c.gesture(), null, 'no listener survived destroy()');
  assert.equal(JSON.stringify(s.c.template()), before, 'nothing mutated after destroy()');
});

const wheel = (s, o) => s.c.view.stage.dispatchEvent(new s.win.WheelEvent('wheel', { bubbles: true, cancelable: true, ...o }));
const key = (s, k, o = {}) => s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));

test('ctrl+wheel zooms about the cursor (world point invariant) and clamps 0.4..1.6', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const before = s.c._internal.toWorld(600, 300);
  wheel(s, { deltaY: -120, ctrlKey: true, clientX: 600, clientY: 300 });
  const after = s.c._internal.toWorld(600, 300);
  assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6);
  assert.ok(Math.abs(s.c.view.getTransform().z - Math.exp(0.24)) < 1e-9);
  for (let i = 0; i < 12; i += 1) wheel(s, { deltaY: -240, ctrlKey: true, clientX: 600, clientY: 300 });
  assert.ok(s.c.view.getTransform().z <= 1.6 + 1e-12);
  for (let i = 0; i < 30; i += 1) wheel(s, { deltaY: 240, ctrlKey: true, clientX: 600, clientY: 300 });
  assert.ok(s.c.view.getTransform().z >= 0.4 - 1e-12);
});

test('plain wheel pans by exactly −delta; deltaMode 1 scales by 16', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  wheel(s, { deltaX: 40, deltaY: -25 });
  assert.deepEqual(s.c.view.getTransform(), { x: -40, y: 25, z: 1 });
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  wheel(s, { deltaX: 1, deltaY: 0, deltaMode: 1 });
  assert.equal(s.c.view.getTransform().x, -16);
});

test('keyboard: nudge, delete, undo/redo, Escape — all skipped while typing', async () => {
  const s = await open();
  s.c.select({ kind: 'node', id: 'n_agent' });
  // nudge() is snap(x + SNAP), not x + SNAP: the fixture's 400 is OFF the 11px
  // grid, and snap(411) = round(411/11)*11 = 37*11 = 407. The first arrow press
  // therefore moves 7px (onto the grid) and every press after it moves 11.
  key(s, 'ArrowRight');
  assert.equal(s.c.template().nodes[1].x, 407, 'nudged onto the 11px grid');
  assert.equal(s.c.template().nodes[1].x % 11, 0);
  key(s, 'ArrowRight');
  assert.equal(s.c.template().nodes[1].x, 418, 'on-grid => a full SNAP step');
  key(s, 'z', { metaKey: true });
  assert.equal(s.c.template().nodes[1].x, 407, 'undo');
  key(s, 'z', { metaKey: true, shiftKey: true });
  assert.equal(s.c.template().nodes[1].x, 418, 'redo');
  s.el.name.focus();
  s.el.name.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  assert.equal(s.c.template().nodes.length, 3, 'typing in the name field never deletes a node');
  s.c.select({ kind: 'node', id: 'n_agent' });
  key(s, 'Backspace');
  assert.equal(s.c.template().nodes.length, 2, 'node deleted');
  assert.equal(s.c.template().wires.length, 0, 'its wires went with it');
  assert.equal(s.c.selection(), null);
});

test('fit centres the model in the band left of the inspector and never magnifies', async () => {
  const s = await open();
  s.c.fit();                                   // rail open => insetRight 340 => vw 940
  const T = s.c.view.getTransform();
  assert.ok(Math.abs(T.z - 940 / 1040) < 1e-12, 'z = vw / bounds.w');
  assert.ok(Math.abs(T.x - 0) < 1e-9, 'exactly centred: (940 - 1040*z)/2 - 0*z = 0');
  s.c.fit({ insetRight: 28 });                 // rail collapsed => vw 1252
  assert.equal(s.c.view.getTransform().z, 1, 'fit never magnifies past 1x');
});

test('a whole drag is ONE undo entry and the ring caps at 50', async () => {
  const s = await open();
  assert.equal(s.c.undoDepth(), 0);
  down(s, 400, 80);
  for (let i = 0; i < 20; i += 1) { move(s, 400 + i * 5, 80 + i * 3); s.flush(); }
  up(s, 500, 140); s.flush();
  assert.equal(s.c.undoDepth(), 1, '20 frames => one undo entry');
  const moved = { ...s.c.template().nodes[1] };
  s.c.undo();
  assert.equal(s.c.template().nodes[1].x, 400);
  s.c.redo();
  assert.equal(s.c.template().nodes[1].x, moved.x);
  for (let i = 0; i < 60; i += 1) s.c.commit('n', () => { s.c.template().nodes[1].x += 11; });
  assert.equal(s.c.undoDepth(), 50, 'ring capped at UNDO_LIMIT');
});

test('errors disable Save, show the chip, pip the node, and centre it on click', async () => {
  const s = await open({ template: { id: '', name: '', version: 2, domain: '', nodes: [], wires: [] } });
  await new Promise((r) => setTimeout(r, 0));            // let scheduleValidate run
  assert.ok(s.el.save.disabled, 'Save disabled while the graph has errors');
  assert.equal(s.el.errors.hidden, false);
  assert.match(s.el.errors.textContent, /^\d+ errors?$/);
  const s2 = await open();
  // Drop the End node and ONLY the wire that fed it. Clearing EVERY wire (the
  // first draft did) also unwires n_agent.task and n_task.task, so V9 + V20 stay
  // red after the repair below and the recovery half of this test can never pass.
  // Verified 2026-08-27: end removed + w1 kept => exactly [V21]; + n_end2 + w9 => ok.
  s2.c.commit('rm-end', () => {
    const t = s2.c.template();
    t.nodes = t.nodes.filter((n) => n.kind !== 'end');
    t.wires = t.wires.filter((w) => w.id === 'w1');
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s2.el.save.disabled, true, 'V21: exactly one End node');
  s2.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const pip = s2.c.view.world.querySelector('.npip');
  if (pip) { pip.dispatchEvent(new s2.win.MouseEvent('click', { bubbles: true })); assert.notDeepEqual(s2.c.view.getTransform(), { x: 0, y: 0, z: 1 }, 'pip click centres the offender'); }
  s2.c.commit('fix', () => { s2.c.template().nodes.push({ id: 'n_end2', kind: 'end', x: 900, y: 200, config: {} }); s2.c.template().wires.push({ id: 'w9', from: { node: 'n_agent', port: 'plan' }, to: { node: 'n_end2', port: 'result' } }); });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s2.el.errors.hidden, true);
  assert.equal(s2.el.save.disabled, false);
});

test('validation runs ONCE per commit, never per frame', async () => {
  const s = await open();
  await new Promise((r) => setTimeout(r, 0));
  const v0 = s.c.stats.validations;
  down(s, 400, 80);
  for (let i = 0; i < 30; i += 1) { move(s, 400 + i, 80 + i); s.flush(); }
  assert.equal(s.c.stats.validations, v0, 'zero validations during the drag');
  up(s, 430, 110); s.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.c.stats.validations, v0 + 1, 'exactly one after the commit');
});

test('palette groups by domain, pins Flow last, hides placeable:false, disables placed bookends', async () => {
  const agents = [
    { key: 'planner', displayName: 'Plan', domain: 'coding', color: 'violet', order: 1, inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'plan', type: 'md' }, { id: 'revise', type: 'md' }] },
    { key: 'wsScan', displayName: 'Workspace Scan', domain: 'shared', order: 0.5, placeable: false, inputs: [], outputs: [] },
    { key: 'docs', displayName: 'Docs', domain: 'writing', order: 2, inputs: [], outputs: [{ id: 'doc', type: 'md' }] },
  ];
  const s = await open({ api: { agents: async () => agents, agentsAll: async () => agents } });
  const { renderPalette } = await import(new URL('../ui/public/graph/palette.mjs', import.meta.url).href);
  renderPalette(s.el.palette, { agents, placedKinds: ['task', 'end'], collapsed: new Set(), doc: s.doc });
  const groups = [...s.el.palette.querySelectorAll('.pal-group')].map((g) => g.dataset.domain);
  assert.deepEqual(groups, ['coding', 'writing', 'flow'], 'domains first-seen (empty groups omitted), pinned Flow last');
  assert.equal(s.el.palette.querySelector('.ap[data-key="wsScan"]'), null, 'placeable:false never listed');
  assert.equal(s.el.palette.querySelector('.ap[data-key="planner"] .p').textContent, 'in plan · out plan, revise');
  assert.equal(s.el.palette.querySelector('.ap[data-kind="task"]').disabled, true);
  assert.equal(s.el.palette.querySelector('.ap[data-kind="and"]').disabled, false);
  assert.equal(s.el.palette.querySelector('.ap[data-kind="and"] .p').textContent, 'in in1..inN · out out');
});

test('click spawns at the canvas centre with the 24-try de-stacker', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const n0 = s.c.template().nodes.length;
  s.c.spawn({ kind: 'and' });
  s.c.spawn({ kind: 'and' });
  const nodes = s.c.template().nodes;
  assert.equal(nodes.length, n0 + 2);
  assert.equal(nodes[n0].kind, 'and');
  assert.equal(nodes[n0].config.arity, 2);
  assert.notDeepEqual({ x: nodes[n0].x, y: nodes[n0].y }, { x: nodes[n0 + 1].x, y: nodes[n0 + 1].y }, 'second spawn de-stacked');
  assert.equal(nodes[n0].x % 11, 0, 'snapped to the 11px grid');
  assert.equal(s.c.undoDepth(), 2, 'each spawn is one undo entry');
});

test('drag-to-spawn: ghost after 4px, drop inside the stage commits, outside cancels', async () => {
  const s = await open();
  const agents = [{ key: 'planner', displayName: 'Plan', domain: 'coding', order: 1, inputs: [], outputs: [] }];
  const { renderPalette } = await import(new URL('../ui/public/graph/palette.mjs', import.meta.url).href);
  renderPalette(s.el.palette, { agents, placedKinds: [], collapsed: new Set(), doc: s.doc });
  const pill = s.el.palette.querySelector('.ap[data-key="planner"]');
  const n0 = s.c.template().nodes.length;
  pill.dispatchEvent(new s.win.PointerEvent('pointerdown', { pointerId: 3, button: 0, clientX: 100, clientY: 700, bubbles: true }));
  s.doc.dispatchEvent(new s.win.PointerEvent('pointermove', { pointerId: 3, clientX: 102, clientY: 700, bubbles: true }));
  assert.equal(s.doc.querySelector('.gv-drag-ghost'), null, '2px is still a click');
  s.doc.dispatchEvent(new s.win.PointerEvent('pointermove', { pointerId: 3, clientX: 400, clientY: 300, bubbles: true }));
  assert.ok(s.doc.querySelector('.gv-drag-ghost'), 'ghost after 4px');
  s.doc.dispatchEvent(new s.win.PointerEvent('pointerup', { pointerId: 3, clientX: 400, clientY: 300, bubbles: true }));
  assert.equal(s.c.template().nodes.length, n0 + 1, 'dropped inside the stage => spawned');
  assert.equal(s.doc.querySelector('.gv-drag-ghost'), null, 'ghost removed');
  pill.dispatchEvent(new s.win.PointerEvent('pointerdown', { pointerId: 4, button: 0, clientX: 100, clientY: 700, bubbles: true }));
  s.doc.dispatchEvent(new s.win.PointerEvent('pointermove', { pointerId: 4, clientX: 1270, clientY: 300, bubbles: true }));
  s.doc.dispatchEvent(new s.win.PointerEvent('pointerup', { pointerId: 4, clientX: 1270, clientY: 300, bubbles: true }));
  assert.equal(s.c.template().nodes.length, n0 + 1, 'a drop under the inspector rail cancels');
});

test('agent inspector gates rows on meta booleans and commits every change', async () => {
  const meta = { key: 'planner', displayName: 'Plan', color: 'violet', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false, inputs: [], outputs: [] };
  const s = await open({ api: { agents: async () => [meta], agentsAll: async () => [meta] } });
  s.c.setAgents({ planner: meta });
  s.c.select({ kind: 'node', id: 'n_agent' });
  const body = s.el.insBody;
  assert.ok(body.querySelector('[data-field="model"]'), 'model select');
  assert.ok(body.querySelector('[data-field="fanOut"]'), 'fan-out row exists for a fanOut agent');
  assert.ok(body.querySelector('[data-field="askQuestions"]'));
  assert.ok(body.querySelector('[data-field="awaitAll"]'));
  const sel2 = body.querySelector('[data-field="model"]');
  sel2.value = 'sonnet';
  sel2.dispatchEvent(new s.win.Event('change', { bubbles: true }));
  assert.equal(s.c.template().nodes[1].config.model, 'sonnet');
  assert.equal(s.c.undoDepth(), 1, 'a field change is one undo entry');
  const box = body.querySelector('[data-field="awaitAll"]');
  box.checked = true;
  box.dispatchEvent(new s.win.Event('change', { bubbles: true }));
  assert.equal(s.c.template().nodes[1].config.awaitAll, true);
});

test('locked questions are forced + disabled; a non-asking agent has no row', async () => {
  const locked = { key: 'planner', displayName: 'Plan', asksQuestions: true, questionsLocked: true, questionsDefault: true, inputs: [], outputs: [] };
  const s = await open();
  s.c.setAgents({ planner: locked });
  s.c.select({ kind: 'node', id: 'n_agent' });
  const box = s.el.insBody.querySelector('[data-field="askQuestions"]');
  assert.equal(box.disabled, true);
  assert.equal(box.checked, true);
  assert.equal(box.closest('.ins-tog').title, 'Always on for this agent');
  const mute = { key: 'planner', displayName: 'Plan', asksQuestions: false, inputs: [], outputs: [] };
  s.c.setAgents({ planner: mute });
  s.c.select(null); s.c.select({ kind: 'node', id: 'n_agent' });
  assert.equal(s.el.insBody.querySelector('[data-field="askQuestions"]'), null);
});

test('arity stepper floors at 2; loop wires get maxCycles; Task gets planStoreSeed', async () => {
  const s = await open();
  s.c.spawn({ kind: 'and' });
  const andId = s.c.template().nodes[s.c.template().nodes.length - 1].id;
  const inp = s.el.insBody.querySelector('[data-field="arity"]');
  inp.value = '1';
  inp.dispatchEvent(new s.win.Event('change', { bubbles: true }));
  assert.equal(s.c.template().nodes.find((n) => n.id === andId).config.arity, 2, 'floor is 2 (V12)');
  s.c.select({ kind: 'node', id: 'n_task' });
  const seed = s.el.insBody.querySelector('[data-field="planStoreSeed"]');
  assert.ok(seed, 'Task node exposes planStoreSeed');
  seed.checked = true;
  seed.dispatchEvent(new s.win.Event('change', { bubbles: true }));
  assert.equal(s.c.template().nodes[0].config.planStoreSeed, true);
  s.c.select({ kind: 'wire', id: 'w1' });
  assert.equal(s.el.insBody.querySelector('[data-field="maxCycles"]'), null, 'a plain wire has no budget control (V13)');
});

test('the rail collapse state persists under worca.composer.inspector', async () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const s = await open({ storage });
  assert.equal(s.el.insRail.dataset.open, 'open');
  s.el.insToggle.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  assert.equal(s.el.insRail.dataset.open, 'collapsed');
  assert.equal(s.el.insToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(store.get('worca.composer.inspector'), 'collapsed');
  const s2 = await open({ storage });
  assert.equal(s2.el.insRail.dataset.open, 'collapsed', 'restored on the next mount');
});

test('Save posts version 2 with the loaded id; Save-as omits it', async () => {
  const posts = [];
  const s = await open({ api: { saveWorkflow: async (b) => { posts.push(b); return { ok: true, workflow: { id: b.id || 'wf_new' } }; } } });
  s.c.loadTemplate({ id: 'wf_loaded', name: 'Loaded', version: 2, domain: 'coding', nodes: fixture().nodes, wires: fixture().wires });
  await new Promise((r) => setTimeout(r, 0));
  s.el.save.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  const dlg = s.el.dialogHost.querySelector('dialog.save-dialog');
  assert.equal(dlg.querySelector('.sd-name').value, 'Loaded');
  dlg.querySelector('.sd-confirm').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts[0].version, 2);
  assert.equal(posts[0].id, 'wf_loaded');
  assert.ok(Array.isArray(posts[0].nodes) && Array.isArray(posts[0].wires));
  assert.equal(s.c.isDirty(), false, 'saving clears the dirty flag');
  s.c.openSaveDialog({ saveAs: true });
  const dlg2 = s.el.dialogHost.querySelector('dialog.save-dialog');
  dlg2.querySelector('.sd-name').value = 'Copy';
  dlg2.querySelector('.sd-confirm').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts[1].id, undefined, 'Save-as omits the id');
  assert.equal(posts[1].name, 'Copy');
});

test('a 422 renders the validator issues verbatim and keeps the dialog open', async () => {
  const s = await open({ api: { saveWorkflow: async () => ({ ok: false, status: 422, issues: [
    { code: 'V21', message: 'exactly one end node is required' },
    { code: 'V5', message: 'n_agent.task is not wired', nodeId: 'n_agent' },
  ] }) } });
  // The canvas must be DIRTY before we assert a failed save leaves it dirty —
  // a freshly loaded template is clean, so the first draft's final assertion
  // could never hold. setName is the cheapest legitimate mutation.
  s.c.setName('Dirty one');
  assert.equal(s.c.isDirty(), true, 'precondition');
  s.el.save.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  const dlg = s.el.dialogHost.querySelector('dialog.save-dialog');
  dlg.querySelector('.sd-name').value = 'X';
  dlg.querySelector('.sd-confirm').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const msg = dlg.querySelector('.sd-msg');
  assert.match(msg.textContent, /exactly one end node is required/);
  assert.match(msg.textContent, /n_agent\.task is not wired/);
  assert.ok(dlg.hasAttribute('open') || dlg.open, 'dialog stays open on 422');
  assert.equal(s.c.isDirty(), true);
});

test('an empty name is refused client-side before any POST', async () => {
  let calls = 0;
  const s = await open({ api: { saveWorkflow: async () => { calls += 1; return { ok: true, workflow: { id: 'x' } }; } } });
  s.el.save.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  const dlg = s.el.dialogHost.querySelector('dialog.save-dialog');
  dlg.querySelector('.sd-name').value = '   ';
  dlg.querySelector('.sd-confirm').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 0);
  assert.equal(dlg.querySelector('.sd-msg').textContent, 'name is required');
});

// ---------------------------------------------------------------- rail tabs +
// palette accordion. The agents card below the canvas is gone: the palette now
// lives in the rail behind an Agents/Info tab, and each domain is its own
// disclosure ("dropdown") instead of a row of collapse chips.
const PAL_AGENTS = [
  { key: 'planner', displayName: 'Plan', domain: 'coding', order: 1, inputs: [], outputs: [{ id: 'plan', type: 'md' }] },
  { key: 'docs', displayName: 'Docs', domain: 'writing', order: 2, inputs: [], outputs: [{ id: 'doc', type: 'md' }] },
];
const palMod = () => import(new URL('../ui/public/graph/palette.mjs', import.meta.url).href);

test('each palette group is a collapsible header and the chip row is gone', async () => {
  const s = await open();
  const { renderPalette } = await palMod();
  renderPalette(s.el.palette, { agents: PAL_AGENTS, placedKinds: [], collapsed: new Set(), doc: s.doc });
  assert.equal(s.el.palette.querySelector('.pal-chips'), null, 'the domain chip row is replaced by the headers');
  const heads = [...s.el.palette.querySelectorAll('.pal-grp')];
  assert.deepEqual(heads.map((h) => h.dataset.domain), ['coding', 'writing', 'flow'], 'every group, Flow included, is a disclosure');
  assert.equal(heads[0].tagName, 'BUTTON');
  assert.equal(heads[0].getAttribute('aria-expanded'), 'true');
  assert.equal(heads[0].querySelector('.lab').textContent, 'coding');
  assert.equal(heads[0].querySelector('.chip').textContent, '1');
  assert.equal(s.el.palette.querySelector('.pal-group[data-domain="coding"] .pills').hidden, false);
});

test('a collapsed group keeps its header and hides only its pills', async () => {
  const s = await open();
  const { renderPalette } = await palMod();
  renderPalette(s.el.palette, { agents: PAL_AGENTS, placedKinds: [], collapsed: new Set(['coding', 'flow']), doc: s.doc });
  for (const domain of ['coding', 'flow']) {
    const sec = s.el.palette.querySelector(`.pal-group[data-domain="${domain}"]`);
    assert.equal(sec.hidden, false, `${domain} header stays reachable`);
    assert.equal(sec.querySelector('.pal-grp').getAttribute('aria-expanded'), 'false');
    assert.equal(sec.querySelector('.pills').hidden, true, `${domain} pills hidden`);
  }
  assert.equal(s.el.palette.querySelector('.pal-group[data-domain="writing"] .pills').hidden, false);
});

test('a live filter force-expands a collapsed group that matches', async () => {
  const s = await open();
  const { renderPalette, applyFilter } = await palMod();
  const collapsed = new Set(['coding']);
  renderPalette(s.el.palette, { agents: PAL_AGENTS, placedKinds: [], collapsed, doc: s.doc });
  applyFilter(s.el.palette, 'plan', collapsed);
  const coding = s.el.palette.querySelector('.pal-group[data-domain="coding"]');
  assert.equal(coding.querySelector('.pills').hidden, false, 'the query overrides the collapse');
  assert.equal(coding.querySelector('.pal-grp').getAttribute('aria-expanded'), 'true');
  assert.equal(s.el.palette.querySelector('.pal-group[data-domain="writing"]').hidden, true, 'a group with no match drops out');
  applyFilter(s.el.palette, '', collapsed);
  assert.equal(coding.querySelector('.pills').hidden, true, 'clearing the query restores the collapse');
});

test('clicking a group header toggles it through the composer', async () => {
  const s = await open({ api: { agents: async () => PAL_AGENTS, agentsAll: async () => PAL_AGENTS } });
  s.c.setAgents(Object.fromEntries(PAL_AGENTS.map((a) => [a.key, a])));
  s.c.paintPalette();
  const head = s.el.palette.querySelector('.pal-grp[data-domain="coding"]');
  head.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  assert.equal(s.el.palette.querySelector('.pal-group[data-domain="coding"] .pills').hidden, true);
  s.el.palette.querySelector('.pal-grp[data-domain="coding"]').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  assert.equal(s.el.palette.querySelector('.pal-group[data-domain="coding"] .pills').hidden, false);
});

test('the rail opens on the Agents tab and remembers the last tab', async () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const s = await open({ storage });
  assert.equal(s.el.insRail.dataset.tab, 'agents');
  assert.equal(s.el.insTabs.querySelector('[data-tab="agents"]').getAttribute('aria-selected'), 'true');
  s.el.insTabs.querySelector('[data-tab="info"]').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  assert.equal(s.el.insRail.dataset.tab, 'info');
  assert.equal(s.el.insTabs.querySelector('[data-tab="agents"]').getAttribute('aria-selected'), 'false');
  assert.equal(store.get('worca.composer.tab'), 'info');
  const s2 = await open({ storage });
  assert.equal(s2.el.insRail.dataset.tab, 'info', 'restored on the next mount');
});

test('selecting a node repaints Info but never switches the tab', async () => {
  const s = await open();
  assert.equal(s.el.insRail.dataset.tab, 'agents');
  s.c.select({ kind: 'node', id: 'n_agent' });
  assert.equal(s.el.insRail.dataset.tab, 'agents', 'no auto-switch');
  assert.equal(s.el.insBody.querySelector('.ins-panel').dataset.nodeId, 'n_agent', 'Info is painted anyway');
});

// -------------------------------------------------------------------- MAJ-19
// The composer's keydown listener lives on `doc`, so it is still live while a
// modal is up. Two modal shapes reach it: the composer's own <dialog> (whose
// Cancel/Save buttons are focusable non-inputs `isTyping` does not cover) and
// the app's overlays — plain <div role="dialog"> that only toggle the `hidden`
// CLASS, which `dialog[open]` alone misses (index.html:1247, app.js:6973
// auto-focuses their <button>).
const keyOn = (s, target, k, o = {}) => target.dispatchEvent(
  new s.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));

/** The app's #confirm-modal, reduced to the two facts the guard reads: a
 *  role="dialog" host that carries `hidden` as a CLASS, and a focusable button. */
function appConfirmModal(s, { open: isOpen = true } = {}) {
  const host = s.doc.createElement('div');
  host.id = 'confirm-modal';
  host.className = `viewer-modal confirm-modal${isOpen ? '' : ' hidden'}`;
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  const ok = s.doc.createElement('button');
  ok.type = 'button'; ok.id = 'confirm-ok'; ok.textContent = 'Confirm';
  host.appendChild(ok);
  s.doc.body.appendChild(host);
  return { host, ok };
}

test('MAJ-19: Backspace aimed at the save dialog never edits the graph behind it', async () => {
  const s = await open();
  s.c.select({ kind: 'node', id: 'n_agent' });
  const dlg = s.c.openSaveDialog();
  assert.ok(dlg, 'dialog mounted');
  const x0 = s.c.template().nodes.find((n) => n.id === 'n_agent').x;
  keyOn(s, dlg.querySelector('.sd-confirm'), 'Backspace');
  assert.equal(s.c.template().nodes.some((n) => n.id === 'n_agent'), true, 'the node survives the modal keystroke');
  keyOn(s, dlg.querySelector('.sd-cancel'), 'ArrowRight');
  assert.equal(s.c.template().nodes.find((n) => n.id === 'n_agent').x, x0, 'arrows never nudge behind the modal');
  // Focus outside the dialog (jsdom's showModal fallback focuses nothing): the
  // `dialog[open]` arm has to catch it too.
  keyOn(s, s.doc, 'Backspace');
  assert.equal(s.c.template().nodes.some((n) => n.id === 'n_agent'), true, 'a document-targeted key is guarded too');
  // typing in the NAME field stays ignored by the pre-existing isTyping guard
  keyOn(s, dlg.querySelector('.sd-name'), 'Backspace');
  assert.equal(s.c.template().nodes.some((n) => n.id === 'n_agent'), true);
});

test("MAJ-19: Backspace aimed at the app's confirm modal never edits the graph", async () => {
  const s = await open();
  s.c.select({ kind: 'node', id: 'n_agent' });
  const m = appConfirmModal(s);
  keyOn(s, m.ok, 'Backspace');
  assert.equal(s.c.template().nodes.some((n) => n.id === 'n_agent'), true, 'the × confirm cannot delete a node');
  keyOn(s, s.doc, 'Backspace');
  assert.equal(s.c.template().nodes.some((n) => n.id === 'n_agent'), true, 'nor can a stray key while it is up');
});

test('MAJ-19: the modal guard is not over-broad — closed overlays leave the keyboard live', async () => {
  const s = await open();
  appConfirmModal(s, { open: false });                 // .hidden CLASS = closed
  const sheet = s.doc.createElement('section');        // Ask Worca sheet: hidden ATTRIBUTE
  sheet.setAttribute('role', 'dialog'); sheet.hidden = true;
  s.doc.body.appendChild(sheet);
  s.c.openSaveDialog();
  const dlg = s.el.dialogHost.querySelector('dialog.save-dialog');
  dlg.querySelector('.sd-cancel').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  assert.equal(dlg.hasAttribute('open') || dlg.open, false, 'precondition: the save dialog is closed');
  s.c.select({ kind: 'node', id: 'n_agent' });
  keyOn(s, s.doc, 'Backspace');
  assert.equal(s.c.template().nodes.some((n) => n.id === 'n_agent'), false, 'Backspace still deletes with no modal up');
  // The Ask Worca sheet is role="dialog" WITHOUT aria-modal and stays open while
  // the canvas is used (ask-panel.mjs:202-207, :522) — it never owns the keyboard.
  const ask = s.doc.createElement('section');
  ask.className = 'ask-sheet'; ask.setAttribute('role', 'dialog'); ask.setAttribute('aria-label', 'Ask Worca');
  ask.hidden = false;
  s.doc.body.appendChild(ask);
  s.c.select({ kind: 'node', id: 'n_task' });
  keyOn(s, s.doc, 'Backspace');
  assert.equal(s.c.template().nodes.some((n) => n.id === 'n_task'), false, 'an open non-modal Ask sheet leaves the keyboard live');
});

// --------------------------------------------------------------------- MAJ-6
// "New canvas" and a saved row's "Open" replace the canvas AND wipe the undo
// ring, so unsaved work is unrecoverable. Both now ask through the injected
// `hooks.confirmDiscard` seam; an ABSENT hook proceeds, which is what keeps
// every headless caller (unit tests, the CDP probe) behaving as before.
test('MAJ-6: a refused confirmDiscard leaves the canvas, the undo ring and the dirty flag untouched', async () => {
  const s = await open();
  let asked = 0;
  s.c.hooks.confirmDiscard = async () => { asked += 1; return false; };
  s.c.spawn({ key: 'planner' });
  const nodes = s.c.template().nodes.length;
  const depth = s.c.undoDepth();
  assert.equal(s.c.isDirty(), true, 'precondition: dirty');
  assert.ok(depth > 0, 'precondition: undo has the spawn');
  s.hostEls.newBtn.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked, 1, 'New canvas asked');
  assert.equal(s.c.template().nodes.length, nodes, 'canvas untouched');
  assert.equal(s.c.undoDepth(), depth, 'undo ring untouched');
  assert.equal(s.c.isDirty(), true, 'still dirty');
  assert.equal(await s.c.openTemplate({ id: 'wf_x', name: 'X', version: 2, nodes: [], wires: [] }), null,
    'Open refused returns null');
  assert.equal(asked, 2, 'Open asked too');
  assert.equal(s.c.template().nodes.length, nodes, 'canvas still untouched');
  assert.equal(s.c.undoDepth(), depth);
});

test('MAJ-6: an accepted confirmDiscard proceeds; a clean canvas never asks; no hook proceeds', async () => {
  const s = await open();
  let asked = 0;
  s.c.hooks.confirmDiscard = async () => { asked += 1; return true; };
  s.hostEls.newBtn.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked, 0, 'a CLEAN canvas is never guarded');
  s.c.spawn({ key: 'planner' });
  assert.equal(s.c.isDirty(), true);
  s.hostEls.newBtn.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked, 1);
  assert.equal(s.c.template().nodes.length, 2, 'back to the bare Task/End canvas');
  assert.equal(s.c.undoDepth(), 0);
  assert.equal(s.c.isDirty(), false);
  // no hook at all => proceed (the headless default)
  const s2 = await open();
  s2.c.spawn({ key: 'planner' });
  assert.equal(s2.c.isDirty(), true);
  s2.hostEls.newBtn.dispatchEvent(new s2.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s2.c.template().nodes.length, 2, 'no hook installed => New canvas proceeds');
});

test('MAJ-6: a confirmDiscard that throws is treated as "no" — the work survives', async () => {
  const s = await open();
  s.c.hooks.confirmDiscard = async () => { throw new Error('modal blew up'); };
  s.c.spawn({ key: 'planner' });
  const nodes = s.c.template().nodes.length;
  s.hostEls.newBtn.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.c.template().nodes.length, nodes, 'a broken hook never costs the user the canvas');
});

test('MAJ-6: loadTemplate stays SYNCHRONOUS and unguarded (the programmatic model API)', async () => {
  const s = await open();
  s.c.hooks.confirmDiscard = async () => false;
  s.c.spawn({ key: 'planner' });
  const t = s.c.loadTemplate({ id: 'wf_p', name: 'P', version: 2, domain: '', nodes: [], wires: [] });
  assert.equal(t.id, 'wf_p', 'returns the template, not a promise');
  assert.equal(s.c.template().id, 'wf_p');
});
