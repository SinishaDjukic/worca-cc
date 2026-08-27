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

const IDS = ['gv-canvas', 'gv-chip', 'gv-head', 'gv-name', 'gv-dirty', 'gv-errors', 'gv-new', 'gv-autolayout',
  'gv-save', 'gv-ins-rail', 'gv-ins-body', 'gv-ins-toggle', 'gv-palette', 'gv-agent-filter', 'gv-saved-list',
  'gv-saved-count', 'gv-archived', 'gv-dialog-host'];

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
  for (const id of IDS) el[id.replace(/^gv-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = doc.getElementById(id);
  const q = [];
  return {
    dom, win: dom.window, doc, el,
    hostEls: {
      canvas: el.canvas, chip: el.chip, head: el.head, name: el.name, dirty: el.dirty, errors: el.errors,
      newBtn: el.new, autoBtn: el.autolayout, saveBtn: el.save, insRail: el.insRail, insBody: el.insBody,
      insToggle: el.insToggle, palette: el.palette, filter: el.agentFilter, savedList: el.savedList,
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
