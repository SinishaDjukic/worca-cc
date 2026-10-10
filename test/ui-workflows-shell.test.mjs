// test/ui-workflows-shell.test.mjs — the Workflows chrome: menus, zoom, "+", drop, selection toolbar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootShell, fixture, loopFixture } from './helpers/workflows-shell.mjs';

const items = (doc) => [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].map((b) => b.querySelector('.wfv-menu-l').textContent);
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const keydown = (el, key, extra = {}) => el.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));

test('"Workflows ▾": New canvas, Open…, Import…, Export… (disabled until saved)', async () => {
  const s = await bootShell({ template: { ...fixture(), id: '' } });     // fixture() is SAVED (id 'wf_t'): Export would be live
  click(s.g('wfv-wf-menu'));
  assert.deepEqual(items(s.doc), ['New canvas', 'Open…', 'Import…', 'Export…']);
  const exp = [...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.startsWith('Export'));
  assert.equal(exp.disabled, true);
  assert.equal(exp.title, 'Save the pipeline first');
  click([...s.doc.querySelectorAll('.wfv-menu-item')][0]);
  assert.deepEqual(s.calls.at(-1), ['newCanvas']);
  assert.equal(s.doc.querySelector('.wfv-menu'), null, 'a pick closes the menu');
});

test('zoom menu: exactly Zoom in / Zoom out / Fit graph to view; the label follows the zoom', async () => {
  const s = await bootShell();
  click(s.g('wfv-zoom'));
  assert.deepEqual(items(s.doc), ['Zoom in', 'Zoom out', 'Fit graph to view']);
  const z0 = s.c.view.getTransform().z;
  click(s.doc.querySelector('.wfv-menu-item'));
  assert.ok(Math.abs(s.c.view.getTransform().z - Math.min(1.6, z0 * 1.2)) < 1e-9);
  assert.equal(s.g('wfv-zoom-label').textContent, `${Math.round(s.c.view.getTransform().z * 100)}%`);
});

test('"+": Flow cards (Task/End "1 placed" once on the canvas), Agent…, Script…, New agent…, New script…', async () => {
  const s = await bootShell();
  click(s.g('wfv-add'));
  assert.deepEqual(items(s.doc), ['Task', 'End', 'AND', 'OR', 'Combine', 'Agent…', 'Script…', 'New agent…', 'New script…']);
  const task = [...s.doc.querySelectorAll('.wfv-menu-item')][0];
  assert.equal(task.disabled, s.c.template().nodes.some((n) => n.kind === 'task'));
  const and = [...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.startsWith('AND'));
  const n0 = s.c.template().nodes.length;
  click(and);
  assert.equal(s.c.template().nodes.length, n0 + 1);
  const added = s.c.template().nodes.at(-1);
  assert.equal(added.kind, 'and');
  assert.deepEqual(s.c.selection(), { kind: 'node', id: added.id });
});

test('a Library drop spawns the card at point − (116, 20), snapped; an agent payload keeps its key', async () => {
  const s = await bootShell();
  const key = s.c.template().nodes.find((n) => n.kind === 'agent').key;
  const canvas = s.g('wfv-canvas');
  const dt = { types: ['application/x-worca'], getData: (t) => (t === 'application/x-worca' ? JSON.stringify({ kind: 'agent', key }) : ''), dropEffect: '' };
  const over = new s.win.Event('dragover', { bubbles: true, cancelable: true });
  Object.assign(over, { dataTransfer: dt, clientX: 600, clientY: 300 });
  canvas.dispatchEvent(over);
  assert.equal(over.defaultPrevented, true);
  assert.ok(canvas.classList.contains('is-drop'));
  const drop = new s.win.Event('drop', { bubbles: true, cancelable: true });
  Object.assign(drop, { dataTransfer: dt, clientX: 600, clientY: 300 });
  canvas.dispatchEvent(drop);
  const n = s.c.template().nodes.at(-1);
  const t = s.c.view.getTransform();
  const wx = (600 - t.x) / t.z; const wy = (300 - t.y) / t.z;
  assert.deepEqual([n.kind, n.key, n.x, n.y], ['agent', key, Math.round((wx - 116) / 11) * 11, Math.round((wy - 20) / 11) * 11]);
  assert.ok(!canvas.classList.contains('is-drop'));
});

test('agent toolbar: Model ▾ / Effort ▾ / Await all inputs / Delete / More; edits are one undo step each', async () => {
  const s = await bootShell();
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  s.c.select({ kind: 'node', id: a.id });
  const tb = s.doc.querySelector('.wfv-tb');
  assert.ok(tb, 'toolbar shown for a selected node');
  const labels = [...tb.querySelectorAll('button')].map((b) => b.dataset.tb);
  assert.ok(labels.includes('model') && labels.includes('effort') && labels.includes('awaitAll') && labels.includes('delete') && labels.includes('more'));
  const depth = s.c.undoDepth();
  click(tb.querySelector('[data-tb="awaitAll"]'));
  assert.equal(s.c.template().nodes.find((n) => n.id === a.id).config.awaitAll, true);
  assert.equal(s.c.undoDepth(), depth + 1);
  assert.equal(s.doc.querySelector('.wfv-tb [data-tb="awaitAll"]').getAttribute('aria-pressed'), 'true');
  click(s.doc.querySelector('.wfv-tb [data-tb="model"]'));
  assert.deepEqual(items(s.doc), ['inherit', 'Sonnet 5', 'Haiku 4.5']);
  click([...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.startsWith('Sonnet 5')));
  assert.equal(s.c.template().nodes.find((n) => n.id === a.id).config.model, 'claude-sonnet-5');
  click(s.doc.querySelector('.wfv-tb [data-tb="more"]'));
  assert.ok(s.doc.querySelector('.wfv-pop .ins-panel'), 'More shows the full inspector');
});

test('wire toolbar: a loop wire gets "Loop wire", from → to, a Max cycles stepper and Delete wire', async () => {
  const s = await bootShell({ template: loopFixture() });
  const loop = s.c.template().wires.find((w) => s.c.view.isLoopWire(w.id));
  s.c.select({ kind: 'wire', id: loop.id });
  const tb = s.doc.querySelector('.wfv-tb');
  assert.match(tb.textContent, /Loop wire/);
  assert.match(tb.querySelector('.wfv-tb-mono').textContent, new RegExp(`${loop.from.port} → ${loop.to.port}`));
  const before = Number.isInteger(loop.config?.maxCycles) ? loop.config.maxCycles : 3;
  click(tb.querySelector('[data-tb="cycles+"]'));
  assert.equal(s.c.template().wires.find((w) => w.id === loop.id).config.maxCycles, before + 1);
  assert.ok(tb.ownerDocument.querySelector('.wfv-tb [data-tb="delete"]').textContent.includes('Delete wire'));
});

test('an open menu owns the arrows: ArrowRight never nudges the selected node', async () => {
  const s = await bootShell();
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  const x0 = a.x;                                         // `a` is the live node: compare against a copy
  s.c.select({ kind: 'node', id: a.id });
  click(s.g('wfv-zoom'));
  keydown(s.doc.activeElement, 'ArrowRight');
  keydown(s.doc.activeElement, 'Delete');
  assert.equal(s.c.template().nodes.find((n) => n.id === a.id).x, x0);
  keydown(s.doc.activeElement, 'Escape');
  assert.equal(s.doc.querySelector('.wfv-menu'), null);
  assert.equal(s.doc.activeElement, s.g('wfv-zoom'), 'focus returns to the trigger');
});

test('Max cycles stops at the limit a run accepts (LIMITS.maxCycles, 20): "+" is disabled there and saves nothing', async () => {
  const t = loopFixture();
  for (const w of t.wires) if (w.config && w.config.maxCycles) w.config = { ...w.config, maxCycles: 20 };
  const s = await bootShell({ template: t });
  const loop = s.c.template().wires.find((w) => s.c.view.isLoopWire(w.id));
  assert.equal(loop.config.maxCycles, 20, 'precondition: the loop wire sits at the limit');
  s.c.select({ kind: 'wire', id: loop.id });
  const plus = s.doc.querySelector('.wfv-tb [data-tb="cycles+"]');
  assert.equal(plus.getAttribute('aria-disabled'), 'true');
  const depth = s.c.undoDepth();
  click(plus);
  assert.equal(s.c.template().wires.find((w) => w.id === loop.id).config.maxCycles, 20);
  assert.equal(s.c.undoDepth(), depth, 'no edit');
});

test('a script card\'s Params popover: Escape closes it, resets aria-expanded and returns focus to Params', async () => {
  const s = await bootShell();
  const node = s.c.spawn({ kind: 'script', key: 'shell' });
  s.c.select({ kind: 'node', id: node.id });
  const params = s.doc.querySelector('.wfv-tb [data-tb="params"]');
  click(params);
  assert.ok(s.doc.querySelector('.wfv-pop'), 'Params opens the popover');
  assert.equal(params.getAttribute('aria-expanded'), 'true');
  keydown(s.doc.querySelector('.wfv-pop'), 'Escape');
  assert.equal(s.doc.querySelector('.wfv-pop'), null);
  assert.equal(params.getAttribute('aria-expanded'), 'false');
  assert.equal(s.doc.activeElement, params, 'focus returns to Params');
});

test('a menu is measured once fixed: "+" shares its anchor\'s left edge, the zoom menu its right edge', async () => {
  const s = await bootShell();
  const P = s.win.HTMLElement.prototype;
  const ow = Object.getOwnPropertyDescriptor(P, 'offsetWidth');
  // jsdom has no layout: model a block <div> in <body>, as wide as the viewport until it is position:fixed.
  Object.defineProperty(P, 'offsetWidth', { configurable: true, get() {
    if (!this.classList.contains('wfv-menu')) return ow.get.call(this);
    return this.style.position === 'fixed' ? 180 : s.win.innerWidth;
  } });
  try {
    s.g('wfv-add').getBoundingClientRect = () => ({ left: 322, right: 362, top: 600, bottom: 640, width: 40, height: 40 });
    s.g('wfv-zoom').getBoundingClientRect = () => ({ left: 700, right: 766, top: 605, bottom: 635, width: 66, height: 30 });
    click(s.g('wfv-add'));
    assert.equal(s.doc.querySelector('.wfv-menu').style.left, '322px');
    click(s.g('wfv-zoom'));
    assert.equal(s.doc.querySelector('.wfv-menu').style.left, `${766 - 180}px`);
  } finally { Object.defineProperty(P, 'offsetWidth', ow); }
});

test('the More popover keeps to the band between the top bars (60) and the dock (stage − 80)', async () => {
  const s = await bootShell();
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  s.c.select({ kind: 'node', id: a.id });
  let H = 2000;
  let PH = 400;
  Object.defineProperty(s.g('wfv-stage'), 'clientHeight', { configurable: true, get: () => H });
  const P = s.win.HTMLElement.prototype;
  const oh = Object.getOwnPropertyDescriptor(P, 'offsetHeight');
  Object.defineProperty(P, 'offsetHeight', { configurable: true, get() {
    if (!this.classList.contains('wfv-pop')) return oh.get.call(this);
    return Math.min(PH, parseFloat(this.style.maxHeight) || PH);          // CSS max-height clips the content
  } });
  try {
    click(s.doc.querySelector('.wfv-tb [data-tb="more"]'));
    const pop = s.doc.querySelector('.wfv-pop');
    const tb = s.doc.querySelector('.wfv-tb');
    s.c.view.setTransform({ x: 0, y: 0, z: 1 });
    const base = parseFloat(tb.style.top);
    const at = (y) => { s.c.view.setTransform({ x: 0, y: y - base, z: 1 }); return parseFloat(tb.style.top); };
    let top = at(300);
    assert.equal(pop.style.top, `${top + 28 + 6}px`, 'room below: 6 px under the toolbar');
    H = 800; top = at(600);                                  // below 720 − 634 < 400; above 600 − 6 − 60 ≥ 400
    assert.equal(pop.style.top, `${top - 6 - 400}px`, 'no room below: above the toolbar');
    H = 700; PH = 600; top = at(300);                        // below 620 − 334 = 286 > above 300 − 66 = 234
    assert.equal(pop.style.maxHeight, '286px', 'neither side fits: the roomier one, shortened');
    assert.equal(pop.style.top, `${top + 34}px`);
    top = at(500);                                           // above 434 > below 86
    assert.equal(pop.style.maxHeight, '434px');
    assert.equal(pop.style.top, '60px');
  } finally { Object.defineProperty(P, 'offsetHeight', oh); }
});

test('on a short stage the More popover never covers its own toolbar (no 160 px floor past the room it has)', async () => {
  const s = await bootShell();
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  s.c.select({ kind: 'node', id: a.id });
  let H = 400;
  let PH = 420;
  Object.defineProperty(s.g('wfv-stage'), 'clientHeight', { configurable: true, get: () => H });
  const P = s.win.HTMLElement.prototype;
  const oh = Object.getOwnPropertyDescriptor(P, 'offsetHeight');
  Object.defineProperty(P, 'offsetHeight', { configurable: true, get() {
    if (!this.classList.contains('wfv-pop')) return oh.get.call(this);
    return Math.min(PH, parseFloat(this.style.maxHeight) || PH);
  } });
  const covered = [];
  try {
    click(s.doc.querySelector('.wfv-tb [data-tb="more"]'));
    const pop = s.doc.querySelector('.wfv-pop');
    const tb = s.doc.querySelector('.wfv-tb');
    s.c.view.setTransform({ x: 0, y: 0, z: 1 });
    const base = parseFloat(tb.style.top);
    const at = (y) => { s.c.view.setTransform({ x: 0, y: y - base, z: 1 }); return parseFloat(tb.style.top); };
    for (const h of [400, 440, 480]) for (const ph of [200, 300, 420]) for (let ty = 70; ty < h - 100; ty += 10) {
      H = h; PH = ph;
      const t = at(ty);
      const y = parseFloat(pop.style.top);
      const hh = Math.min(ph, parseFloat(pop.style.maxHeight));
      if (y < t + 28 && y + hh > t) covered.push(`H ${h}, popover ${ph}, toolbar at ${t}: ${y}–${y + hh}`);
    }
  } finally { Object.defineProperty(P, 'offsetHeight', oh); }
  assert.deepEqual(covered, []);
});

test('a drop places only what the Library offers: a workspace-only or unknown agent key (a raw payload) places nothing', async () => {
  const s = await bootShell();
  const canvas = s.g('wfv-canvas');
  const drop = (payload) => {
    const dt = { types: ['application/x-worca'], getData: (t) => (t === 'application/x-worca' ? JSON.stringify(payload) : ''), dropEffect: '' };
    const ev = new s.win.Event('drop', { bubbles: true, cancelable: true });
    Object.assign(ev, { dataTransfer: dt, clientX: 600, clientY: 300 });
    canvas.dispatchEvent(ev);
  };
  const n0 = s.c.template().nodes.length;
  drop({ kind: 'agent', key: 'workspaceScanner' });      // scope workspace-only: never in the canvas palette
  drop({ kind: 'agent', key: 'constructor' });           // not an own key of the palette map
  drop({ kind: 'script', key: 'noSuchScript' });
  assert.equal(s.c.template().nodes.length, n0, 'nothing placed');
  drop({ kind: 'agent', key: 'planner' });
  assert.equal(s.c.template().nodes.at(-1).key, 'planner', 'a palette agent still lands');
  s.c.setScripts({ shell: { key: 'shell', metaVersion: 2 } });
  drop({ kind: 'script', key: 'shell' });
  assert.equal(s.c.template().nodes.at(-1).key, 'shell', 'a known script still lands');
});

test('"Workflows ▾" › Export… waits while the open workflow has unsaved changes (it exports the SAVED row)', async () => {
  const s = await bootShell();                                         // fixture() is saved (id 'wf_t')
  const exportItem = () => [...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.startsWith('Export'));
  s.c.spawn({ key: 'planner' });
  click(s.g('wfv-wf-menu'));
  assert.equal(exportItem().disabled, true);
  assert.equal(exportItem().title, 'Save your changes first');
  click(s.g('wfv-wf-menu'));                                           // the trigger's second click closes it
  s.c.markSaved('wf_t', 'T', '');
  click(s.g('wfv-wf-menu'));
  assert.equal(exportItem().disabled, false);
  click(exportItem());
  assert.deepEqual(s.calls.at(-1), ['exportCurrent']);
});

test('a command/code param in the Params popover keeps its own Escape (Tab-out): the popover stays, the next Tab leaves the editor', async () => {
  const s = await bootShell({ highlight: async (text) => text });     // app.js passes scriptHighlight: the params get the real code editor
  s.c.setScripts({ shell: { key: 'shell', displayName: 'Shell', runtime: 'shell', metaVersion: 2, inputs: [], outputs: [],
    params: [{ id: 'command', type: 'command', label: 'Command', required: true }, { id: 'note', type: 'string', label: 'Note' }] } });
  const node = s.c.spawn({ kind: 'script', key: 'shell' });
  s.c.select({ kind: 'node', id: node.id });
  const params = s.doc.querySelector('.wfv-tb [data-tb="params"]');
  click(params);
  const ta = s.doc.querySelector('.wfv-pop .code-editor textarea');
  assert.ok(ta, 'precondition: the command param is a code editor inside the popover');
  ta.focus();
  const esc = new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  ta.dispatchEvent(esc);
  assert.ok(s.doc.querySelector('.wfv-pop'), 'this Escape arms the editor\'s Tab-out: the popover stays');
  assert.equal(s.doc.activeElement, ta, '… and the caret stays in the editor');
  const tab = new s.win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  ta.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, false, 'the next Tab leaves the editor for the controls after it (no keyboard dead end)');
  keydown(s.doc.querySelector('.wfv-pop [name="param:note"]') || s.doc.querySelector('.wfv-pop'), 'Escape');
  assert.equal(s.doc.querySelector('.wfv-pop'), null, 'Escape from any other control still closes the popover');
  assert.equal(s.doc.activeElement, params);
});

// Review cycle 2 M1: a menu pick and a toolbar edit removed or rebuilt the element that held the focus, so it fell to
// <body>, where the canvas owns Delete / Backspace / the arrows (the next Delete deleted the selected card).
const del = (s) => keydown(s.doc.activeElement, 'Delete');

test('a menu pick hands the focus back to its trigger, never <body>', async () => {
  const s = await bootShell();
  const zoom = s.g('wfv-zoom');
  click(zoom);
  assert.notEqual(s.doc.activeElement, zoom, 'precondition: the open menu holds the focus');
  click(s.doc.querySelector('.wfv-menu-item'));
  assert.equal(s.doc.querySelector('.wfv-menu'), null, 'the pick closed the menu');
  assert.equal(s.doc.activeElement, zoom);
  const add = s.g('wfv-add');
  click(add);
  click([...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.startsWith('AND')));
  assert.equal(s.c.template().nodes.at(-1).kind, 'and', 'the pick still ran');
  assert.equal(s.doc.activeElement, add);
});

test('a toolbar Model pick keeps the focus on the rebuilt Model button; the next Delete never reaches the card', async () => {
  const s = await bootShell();
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  s.c.select({ kind: 'node', id: a.id });
  const model = s.doc.querySelector('.wfv-tb [data-tb="model"]');
  model.focus();
  click(model);
  click([...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.startsWith('Sonnet 5')));
  assert.equal(s.c.template().nodes.find((n) => n.id === a.id).config.model, 'claude-sonnet-5');
  assert.equal(model.isConnected, false, 'precondition: the commit rebuilt the toolbar');
  assert.equal(s.doc.activeElement, s.doc.querySelector('.wfv-tb [data-tb="model"]'));
  del(s);
  assert.ok(s.c.template().nodes.some((n) => n.id === a.id), 'the card is still there');
});

test('an Await-all toggle keeps the focus on the rebuilt button; the next Delete never reaches the card', async () => {
  const s = await bootShell();
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  s.c.select({ kind: 'node', id: a.id });
  const aw = s.doc.querySelector('.wfv-tb [data-tb="awaitAll"]');
  aw.focus();
  click(aw);
  assert.equal(aw.isConnected, false, 'precondition: the commit rebuilt the toolbar');
  const now = s.doc.querySelector('.wfv-tb [data-tb="awaitAll"]');
  assert.equal(now.getAttribute('aria-pressed'), 'true');
  assert.equal(s.doc.activeElement, now);
  del(s);
  assert.ok(s.c.template().nodes.some((n) => n.id === a.id), 'the card is still there');
});

test('a stepper "+" keeps the focus on the rebuilt "+"; the next Delete never reaches the card', async () => {
  const s = await bootShell();
  const and = s.c.spawn({ kind: 'and' });
  s.c.select({ kind: 'node', id: and.id });
  const plus = s.doc.querySelector('.wfv-tb [data-tb="arity+"]');
  plus.focus();
  click(plus);
  assert.equal(s.c.template().nodes.find((n) => n.id === and.id).config.arity, 3);
  assert.equal(plus.isConnected, false, 'precondition: the commit rebuilt the toolbar');
  assert.equal(s.doc.activeElement, s.doc.querySelector('.wfv-tb [data-tb="arity+"]'));
  del(s);
  assert.ok(s.c.template().nodes.some((n) => n.id === and.id), 'the card is still there');
});

test('a focused toolbar control with no successor in the rebuilt toolbar hands the focus to the selected card', async () => {
  const s = await bootShell();
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  s.c.select({ kind: 'node', id: a.id });
  const gone = s.doc.querySelector('.wfv-tb [data-tb="effort"]');
  gone.dataset.tb = 'gone';                             // a control the next toolbar does not draw
  gone.focus();
  click(s.doc.querySelector('.wfv-tb [data-tb="awaitAll"]'));
  assert.equal(gone.isConnected, false);
  assert.equal(s.doc.activeElement, s.c.view.nodeEl(a.id), 'the card itself, never <body>');
});

test('Fit graph to view shows a graph too wide for the 40% zoom floor (Presentation): the fit goes lower, Zoom out stops there, Zoom in comes back', async () => {
  const { RECT } = await import('./helpers/workflows-shell.mjs');
  const { LABEL_H } = await import('../src/shared/graph/geometry.mjs');
  // The built-in Presentation workflow's shape: Task, a row of cards 280 px apart, End — wider than 40% of a 1280 px stage.
  const wide = { id: 'wf_wide', name: 'Wide', version: 2, domain: '',
    nodes: [{ id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
      ...Array.from({ length: 14 }, (_, i) => ({ id: `n_p${i}`, kind: 'agent', key: 'planner', x: 320 + 280 * i, y: 200, config: {} })),
      { id: 'n_end', kind: 'end', x: 320 + 280 * 14, y: 200, config: {} }],
    wires: [] };
  const s = await bootShell({ template: wide });
  const pick = (label) => {
    click(s.g('wfv-zoom'));
    click([...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.startsWith(label)));
  };
  const z = () => s.c.view.getTransform().z;
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  pick('Fit graph to view');
  const fz = z();
  assert.ok(fz < 0.4, `the fit went below the 40% floor (${fz})`);
  for (const n of s.c.template().nodes) {
    const size = s.c.view.size(n);
    const a = s.c.view.toScreen(n.x, n.y - LABEL_H);
    const b = s.c.view.toScreen(n.x + size.w, n.y + size.h);
    assert.ok(a.x >= 0 && a.y >= 0 && b.x <= RECT.width && b.y <= RECT.height, `${n.id} inside the stage: ${JSON.stringify([a, b])}`);
  }
  assert.equal(s.g('wfv-zoom-label').textContent, `${Math.round(fz * 100)}%`);
  pick('Zoom out');
  assert.equal(z(), fz, 'Zoom out stops at the fit: no jump up to the 40% floor, nothing smaller');
  pick('Zoom in');
  assert.ok(Math.abs(z() - fz * 1.2) < 1e-9, 'Zoom in from the fit');
  pick('Zoom out');
  assert.ok(Math.abs(z() - fz) < 1e-9, 'back to the fit');
  // A graph that fits above the floor keeps the 40% floor for zooming out.
  s.c.loadTemplate(fixture());
  pick('Fit graph to view');
  assert.ok(z() >= 0.4);
  for (let i = 0; i < 12; i += 1) pick('Zoom out');
  assert.ok(Math.abs(z() - 0.4) < 1e-9, `the user floor is 40% again (${z()})`);
  s.c.destroy();
});
