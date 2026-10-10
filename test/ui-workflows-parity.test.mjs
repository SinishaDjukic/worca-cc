// test/ui-workflows-parity.test.mjs — mockup behaviours the Workflows canvas must keep (composer-mockup.html canvas.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootShell } from './helpers/workflows-shell.mjs';

const at = (s, wx, wy) => { const t = s.c.view.getTransform(); return { x: wx * t.z + t.x, y: wy * t.z + t.y }; };
const ptr = (s, type, p) => s.c.view.stage.dispatchEvent(new s.win.PointerEvent(type, { pointerId: 1, button: 0, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
const keydown = (el, key) => el.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

test('a card press takes the focus (mockup onDown), so Delete removes it after a Library control held the focus', async () => {
  const s = await bootShell();
  const fence = s.doc.createElement('div');
  fence.dataset.canvasKeys = 'off';                       // the Library, a top bar, the dock
  const tab = s.doc.createElement('button');
  fence.appendChild(tab);
  s.doc.body.appendChild(fence);
  tab.focus();
  assert.equal(s.doc.activeElement, tab);
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  const p = at(s, a.x + 116, a.y + 30);
  ptr(s, 'pointerdown', p); ptr(s, 'pointerup', p); s.flush();
  assert.equal(s.doc.activeElement, s.c.view.nodeEl(a.id), 'the pressed card holds the focus');
  keydown(s.doc.activeElement, 'Delete');
  assert.equal(s.c.template().nodes.some((n) => n.id === a.id), false, 'Delete removed the selected card');
});

test('pressing the empty canvas drops the focus a card held (mockup onDown blur)', async () => {
  const s = await bootShell();
  const a = s.c.template().nodes.find((n) => n.kind === 'agent');
  const p = at(s, a.x + 116, a.y + 30);
  ptr(s, 'pointerdown', p); ptr(s, 'pointerup', p); s.flush();
  assert.equal(s.doc.activeElement, s.c.view.nodeEl(a.id));
  const e = at(s, a.x + 116, a.y + 600);
  ptr(s, 'pointerdown', e); ptr(s, 'pointerup', e); s.flush();
  assert.equal(s.doc.activeElement, s.doc.body);
});

test('"+" / Add to canvas never drops a card onto another one: it steps diagonally until the spot is free (BRIEF addAtCenter)', async () => {
  const s = await bootShell();
  const rect = (n) => { const z = s.c.view.size(n); return { l: n.x - 7, t: n.y - 26, r: n.x + z.w + 7, b: n.y + z.h }; };
  const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  for (let i = 0; i < 3; i += 1) {
    const n = s.c.spawn({ key: 'planner' });
    const others = s.c.template().nodes.filter((m) => m.id !== n.id);
    for (const m of others) assert.equal(hit(rect(n), rect(m)), false, `spawn ${i + 1} covers ${m.id}`);
  }
});

test('a fresh canvas stays quiet until its first edit: no error pips on the two bookends (mockup wf.untouched)', async () => {
  const s = await bootShell();
  const pips = () => s.doc.querySelectorAll('#wfv-canvas .npip').length;
  s.c.loadTemplate(null);                                 // Workflows ▾ › New canvas: the load paints at once
  s.flush();
  assert.equal(s.c.template().nodes.length, 2);
  assert.equal(pips(), 0, 'no red pips when the fresh canvas paints');
  s.c.setAgents(s.c.getAgents());                         // the app sets the palette maps after the load: a scheduled validation repaints
  await new Promise((r) => setTimeout(r, 5));
  s.flush();
  assert.equal(pips(), 0, 'the scheduled validation keeps them quiet');
  s.c.spawn({ key: 'planner' });
  await new Promise((r) => setTimeout(r, 5));
  s.flush();
  assert.ok(pips() > 0, 'the first edit brings the pips back');
});
