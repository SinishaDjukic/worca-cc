// The Design stage's overlay (ui/public/design/overlay.mjs): one keyed element per cursor and per mark, in the build
// doc's coordinates, inside the scaled `.frame-box`. Cursors enter from and leave to the stage's right edge, glide by
// the mock's distance rule, and draw a trail only past 26 screen px; reduced motion skips all of that. Every string is
// text. The model's output arrives as plain data: placed cursors, a `selectMarks` result and `leave` effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOverlay } from '../ui/public/design/overlay.mjs';
import { A1 } from './helpers/design-stage-frames.mjs';
import { fakeClock } from './helpers/design-clock.mjs';

function rig({ reduced } = {}) {
  const clock = fakeClock();
  const dom = new JSDOM('<!doctype html><html><body><div class="frame-box"></div></body></html>');
  const win = dom.window;
  Object.assign(win, { requestAnimationFrame: clock.raf, cancelAnimationFrame: clock.cancelRaf, setTimeout: clock.set, clearTimeout: clock.clear });
  const doc = win.document;
  const host = doc.querySelector('.frame-box');
  const hits = [];
  const ov = createOverlay({ doc, win, host, reduced: () => reduced === true, onCursor: (id) => hits.push(id) });
  return { ov, clock, win, host, hits, q: (s) => host.querySelector(s), qa: (s) => host.querySelectorAll(s) };
}

const LAYOUT = { s: 0.5, ox: 188, oy: 0, viewH: 1800, pageW: 1440, frameW: 720, zoomed: true, narrow: false, stageW: 1096, stageH: 900 };
const NONE = { boxes: [], oranges: [], reds: [], wires: [], guides: [], plus: [], slotLines: [], failed: [], meters: [], pins: [] };
const C = (o) => ({ agentId: A1, job: 'Hero', role: 'builder', crew: '--teal-ink', colorIndex: 1, waiting: false, x: 100, y: 200, parked: 0, ...o });
const P = (o = {}) => ({ cursors: [], marks: NONE, layout: LAYOUT, scroll: { x: 0, y: 40 }, hidden: false, ...o });

test('keyed: one element per cursor, the same element across paints, positioned in document coordinates', () => {
  const { ov, q } = rig({ reduced: true });
  ov.paint(P({ cursors: [C()] }));
  const el = q('.dz-cursor');
  assert.equal(q('.overlay-doc.is-cursors').style.transform, 'translate(0px, -40px)');
  assert.deepEqual([el.style.getPropertyValue('--x'), el.style.getPropertyValue('--y'), el.style.getPropertyValue('--crew')], ['100px', '200px', 'var(--teal-ink)']);
  ov.paint(P({ cursors: [C({ x: 300 })] }));
  assert.equal(q('.dz-cursor'), el);
  assert.equal(el.style.getPropertyValue('--x'), '300px');
  ov.paint(P({ cursors: [] }));
  assert.equal(q('.dz-cursor'), null);
});
test('cursor glyph and label: the mock\'s arrow, the job as text, amber when waiting', () => {
  const { ov, q } = rig({ reduced: true });
  ov.paint(P({ cursors: [C({ waiting: true })] }));
  const el = q('.dz-cursor');
  assert.equal(el.querySelector('svg path').getAttribute('d'), 'M0 0L4.4 14.6L7.2 8.6L13.8 6.2Z');
  assert.equal(el.querySelector('.dz-cursor-label').textContent, 'Hero');
  assert.ok(el.classList.contains('is-waiting'));
});
test('Review Focus 4: a hostile job or tag stays text', () => {
  const { ov, q } = rig({ reduced: true });
  ov.paint(P({ cursors: [C({ job: '<img src=x onerror=alert(1)>' })], marks: { ...NONE, boxes: [{ key: A1, rect: [0, 0, 500, 50], tag: '<b>x</b>' }] } }));
  assert.equal(q('img, b'), null);
  assert.equal(q('.dz-cursor-label').textContent, '<img src=x onerror=alert(1)>');
});
test('off screen: an arrow icon on the label, both ways', () => {
  const { ov, q } = rig({ reduced: true });
  ov.paint(P({ cursors: [C({ parked: 1 })] }));
  assert.ok(q('.dz-cursor-label svg path').getAttribute('d').startsWith('M12 5v14'));
  ov.paint(P({ cursors: [C({ parked: -1 })] }));
  assert.ok(q('.dz-cursor-label svg path').getAttribute('d').startsWith('M12 19V5'));
  ov.paint(P({ cursors: [C({ parked: 0 })] }));
  assert.equal(q('.dz-cursor-label svg'), null);
});
test('a new cursor enters from the stage\'s right edge, then goes to its real place; none of that under reduced motion', () => {
  const { ov, q, clock } = rig();
  ov.paint(P({ cursors: [C()] }));
  assert.equal(q('.dz-cursor').style.getPropertyValue('--x'), `${(1096 - 188) / 0.5 - 4 / 0.5}px`);
  assert.equal(q('.dz-cursor').style.getPropertyValue('--y'), '206px');
  clock.frame();
  assert.equal(q('.dz-cursor').style.getPropertyValue('--x'), '100px');
  const r = rig({ reduced: true }); r.ov.paint(P({ cursors: [C()] }));
  assert.equal(r.q('.dz-cursor').style.getPropertyValue('--x'), '100px');
});
test('glide follows the mock\'s distance rule in document px; a trail only past 26 screen px; none under reduced motion', () => {
  const { ov, q, clock } = rig();
  ov.paint(P({ cursors: [C()] })); clock.frame();
  ov.paint(P({ cursors: [C({ x: 110 })] }));
  assert.equal(q('.dz-cursor').style.getPropertyValue('--glide'), '120ms');
  assert.equal(q('.dz-trail'), null, '10 document px is 5 screen px at 0.5');
  ov.paint(P({ cursors: [C({ x: 1110 })] }));
  assert.equal(q('.dz-cursor').style.getPropertyValue('--glide'), `${Math.round(320 + (1000 / 1800) * 1000)}ms`);
  assert.ok(q('.dz-trail'));
  clock.tick(1000);
  assert.equal(q('.dz-trail'), null, 'it removes itself');
  const r = rig({ reduced: true }); r.ov.paint(P({ cursors: [C()] })); r.ov.paint(P({ cursors: [C({ x: 1110 })] }));
  assert.equal(r.q('.dz-trail'), null);
});
test('a process that ends flies to the stage\'s right edge, is not a cursor any more, and removes itself; reduced motion removes it at once', () => {
  const { ov, q, qa, clock } = rig();
  ov.paint(P({ cursors: [C()] })); clock.frame();
  ov.paint(P({ cursors: [] }));
  ov.leave({ agentId: A1, crew: '--teal-ink', colorIndex: 1, x: 100, y: 200, quick: false }, LAYOUT);
  clock.frame();
  const el = q('.dz-cursor.is-leaving');
  assert.equal(el.style.getPropertyValue('--x'), `${(1096 - 188) / 0.5 + 24 / 0.5}px`);
  assert.equal(el.style.getPropertyValue('--y'), `${200 + ((1 % 5) - 2) * 24}px`);
  assert.equal(el.style.getPropertyValue('--glide'), '600ms');
  assert.equal(qa('.dz-cursor:not(.is-leaving)').length, 0);
  clock.tick(650);
  assert.equal(q('.dz-cursor'), null);
  const q2 = rig(); q2.ov.leave({ agentId: A1, crew: '--teal-ink', colorIndex: 0, x: 1, y: 1, quick: true }, LAYOUT); q2.clock.frame();
  assert.equal(q2.q('.dz-cursor.is-leaving').style.getPropertyValue('--glide'), '400ms');
  const r = rig({ reduced: true }); r.ov.leave({ agentId: A1, crew: '--teal-ink', colorIndex: 0, x: 1, y: 1, quick: false }, LAYOUT);
  assert.equal(r.q('.dz-cursor'), null);
});
test('at a low zoom the stage edge is past the page edge, and cursors use the stage edge; a lead enters 6 px in', () => {
  const edge = (1096 - 188) / 0.5;
  assert.ok(edge > LAYOUT.pageW);
  const { ov, q } = rig();
  ov.paint(P({ cursors: [C({ role: 'lead', job: 'Lead', crew: '--ink' })] }));
  assert.equal(q('.dz-cursor').style.getPropertyValue('--x'), `${edge - 6 / 0.5}px`);
});
test('marks: box with four handles and its tag, kept by key; a tag under 30 screen px is hidden; each kind has its class', () => {
  const { ov, q, qa } = rig({ reduced: true });
  const marks = { ...NONE, boxes: [{ key: 'b', rect: [10, 20, 500, 58], tag: 'p 500×58' }, { key: 'tiny', rect: [0, 0, 40, 10], tag: 'b 40×10' }],
    oranges: [{ key: 'o', rect: [0, 0, 100, 100], tag: 'Hero' }], reds: [{ key: 'r', rect: [0, 0, 100, 100], tag: 'Overflow' }],
    wires: [{ key: 'w0', rect: [0, 0, 640, 400], tag: 'img 640×400', main: true }, { key: 'w1', rect: [0, 0, 50, 50], tag: null, main: false }],
    plus: [{ key: 'p', x: 116, y: 214 }], slotLines: [{ key: 'l', y: 200, tag: 'Hero' }], failed: [{ key: 'f', rect: [0, 0, 100, 100], tag: 'Hero failed' }], meters: [{ key: 'm', rect: [0, 0, 100, 100], text: 'js 2.1 KB' }],
    guides: [{ key: 'g', kind: 'v', color: 'red', x: 100, y0: 60, y1: 800, ms: 1100 }, { key: 'h', kind: 'h', color: 'blue', y: 300, ms: 900, tag: 'Hero' }], pins: [{ key: 'pin', rect: [0, 0, 100, 100], tag: 'Hero › h1' }] };
  ov.paint(P({ marks }));
  const box = q('.dz-box[data-key="b"]');
  assert.deepEqual([box.style.left, box.style.top, box.style.width, box.style.height], ['10px', '20px', '500px', '58px']);
  assert.equal(box.querySelectorAll('.dz-h').length, 4);
  assert.equal(box.querySelector('.dz-tag').textContent, 'p 500×58');
  assert.equal(q('.dz-box[data-key="tiny"] .dz-tag'), null);
  for (const [sel, n] of [['.dz-box.is-orange', 1], ['.dz-box.is-red', 1], ['.dz-box.is-failed', 1], ['.dz-box.is-pin', 1], ['.dz-wire.is-main', 1], ['.dz-wire', 2], ['.dz-plus', 1], ['.dz-slotline', 1], ['.dz-guide-v', 1], ['.dz-guide-h', 1]]) assert.equal(qa(sel).length, n, sel);
  assert.equal(q('.dz-guide-v').style.getPropertyValue('--d'), '1100ms');
  assert.equal(q('.dz-box.is-failed .dz-tag').classList.contains('is-ui'), true);
  ov.paint(P({ marks: NONE }));
  assert.equal(qa('.overlay-doc.is-marks > *').length, 0);
});
test('hide cursors hides cursors and marks, keeps pins, and the elements come back', () => {
  const { ov, qa } = rig({ reduced: true });
  const marks = { ...NONE, boxes: [{ key: 'b', rect: [0, 0, 500, 50], tag: 't' }], pins: [{ key: 'pin', rect: [0, 0, 100, 100], tag: 'x' }] };
  ov.paint(P({ cursors: [C()], marks, hidden: true }));
  assert.deepEqual([qa('.dz-cursor').length, qa('.dz-box').length, qa('.dz-box.is-pin').length], [0, 1, 1]);
  ov.paint(P({ cursors: [C()], marks, hidden: false }));
  assert.deepEqual([qa('.dz-cursor').length, qa('.dz-box').length], [1, 2]);
});
test('a click on a cursor names its agent; a wheel over it lets the next wheels through to the frame', () => {
  const { ov, q, hits, win, clock } = rig({ reduced: true });
  ov.paint(P({ cursors: [C()] }));
  q('.dz-cursor').click();
  assert.deepEqual(hits, [A1]);
  q('.dz-cursor').dispatchEvent(new win.Event('wheel', { bubbles: true }));
  assert.ok(q('.overlay-doc.is-cursors').classList.contains('is-pass'));
  clock.tick(200);
  assert.equal(q('.overlay-doc.is-cursors').classList.contains('is-pass'), false);
});
test('the overlay is hidden from assistive tech: the HUD dots are its accessible twin', () => {
  const { ov, q } = rig({ reduced: true }); ov.paint(P());
  assert.equal(q('.overlay-doc.is-cursors').getAttribute('aria-hidden'), 'true');
});

// R7's fallback (tools/spikes/design-stage-r7-r20/RESULTS.md): WebKit trails a sandboxed frame's scroll by a 50 ms
// frame, so the marks hide while the scroll moves and the cursors stay. The marks come back once the scroll rests:
// 200 ms after its last move, 600 ms under reduced motion, where the stage paints only every 500 ms.
test('R7: while the scroll moves the marks hide and the cursors stay; the marks come back once it rests', () => {
  const { ov, q, clock } = rig();
  const marks = { ...NONE, boxes: [{ key: 'b', rect: [0, 0, 500, 50], tag: 't' }], meters: [{ key: 'm', rect: [0, 0, 400, 300], text: 'js 2.1 KB' }] };
  const clip = q('.overlay-clip');
  ov.paint(P({ cursors: [C()], marks })); clock.frame();
  assert.equal(clip.style.visibility, '', 'the first paint is no scroll');
  assert.equal(q('.dz-meter .dz-tag').textContent, 'js 2.1 KB');
  ov.paint(P({ cursors: [C()], marks, scroll: { x: 0, y: 140 } }));
  assert.equal(clip.style.visibility, 'hidden');
  assert.equal(q('.overlay-doc.is-marks').style.transform, 'translate(0px, -140px)', 'still moved, so it lands in place');
  assert.equal(q('.overlay-doc.is-cursors').style.visibility, '');
  assert.ok(q('.dz-box[data-key="b"]'), 'hidden, not removed');
  clock.tick(150);
  ov.paint(P({ cursors: [C()], marks, scroll: { x: 0, y: 240 } }));
  clock.tick(150);
  assert.equal(clip.style.visibility, 'hidden', 'each move re-arms the rest');
  ov.paint(P({ cursors: [C({ x: 140 })], marks, scroll: { x: 0, y: 240 } }));
  assert.equal(clip.style.visibility, 'hidden', 'a paint without a scroll move does not end it early');
  clock.tick(50);
  assert.equal(clip.style.visibility, '');
  const r = rig({ reduced: true });
  r.ov.paint(P({ marks })); r.ov.paint(P({ marks, scroll: { x: 0, y: 140 } }));
  r.clock.tick(500);
  assert.equal(r.q('.overlay-clip').style.visibility, 'hidden', 'a 2 Hz paint beat does not flicker it');
  r.clock.tick(100);
  assert.equal(r.q('.overlay-clip').style.visibility, '');
});
test('leave before the paint that drops the agent (the stage\'s order) flies the live cursor with its label; hidden cursors fly nowhere', () => {
  const { ov, q, qa, clock, hits } = rig();
  ov.paint(P({ cursors: [C()] })); clock.frame();
  const el = q('.dz-cursor');
  ov.leave({ agentId: A1, crew: '--teal-ink', colorIndex: 2, x: 100, y: 200, quick: false }, LAYOUT);
  ov.paint(P({ cursors: [] }));
  clock.frame();
  assert.equal(qa('.dz-cursor').length, 1);
  assert.equal(q('.dz-cursor.is-leaving'), el);
  assert.equal(el.querySelector('.dz-cursor-label').textContent, 'Hero');
  assert.equal(el.style.getPropertyValue('--glide'), '700ms');
  el.click();
  assert.deepEqual(hits, [], 'a leaving cursor names no agent');
  clock.tick(700);
  assert.equal(q('.dz-cursor'), null);
  const after = rig();
  after.ov.paint(P({ cursors: [C()] })); after.clock.frame(); after.ov.paint(P({ cursors: [] }));
  after.ov.leave({ agentId: A1, crew: '--teal-ink', colorIndex: 1, x: 100, y: 200, quick: false }, LAYOUT); after.clock.frame();
  assert.equal(after.q('.dz-cursor.is-leaving .dz-cursor-label').textContent, 'Hero', 'the paint that dropped it left its label');
  const hid = rig();
  hid.ov.paint(P({ cursors: [C()], hidden: true }));
  hid.ov.leave({ agentId: A1, crew: '--teal-ink', colorIndex: 1, x: 100, y: 200, quick: false }, LAYOUT); hid.clock.frame();
  assert.equal(hid.q('.dz-cursor'), null);
});
test('destroy removes both layers and every pending timer and frame', () => {
  const { ov, host, clock } = rig();
  ov.paint(P({ cursors: [C()], marks: { ...NONE, boxes: [{ key: 'b', rect: [0, 0, 500, 50], tag: 't' }] } })); clock.frame();
  ov.paint(P({ cursors: [C({ x: 1110 })], scroll: { x: 0, y: 900 } }));
  ov.leave({ agentId: 'a_0000000b', crew: '--ink', colorIndex: 0, x: 1, y: 1, quick: true }, LAYOUT);
  assert.ok(clock.pending() > 0);
  ov.destroy();
  assert.equal(host.children.length, 0);
  assert.equal(clock.pending(), 0);
  ov.paint(P({ cursors: [C()], scroll: { x: 0, y: 0 } }));
  ov.leave({ agentId: A1, crew: '--teal-ink', colorIndex: 1, x: 100, y: 200, quick: false }, LAYOUT);
  assert.equal(clock.pending(), 0, 'a destroyed overlay starts nothing');
});
test('cursors shown again stand in place, with no entry flight; an entry still lands where the latest paint put it', () => {
  const { ov, q, clock } = rig();
  ov.paint(P({ cursors: [C()] })); clock.frame();
  ov.paint(P({ cursors: [C()], hidden: true }));
  ov.paint(P({ cursors: [C()] }));
  assert.equal(q('.dz-cursor').style.getPropertyValue('--x'), '100px');
  const r = rig();
  r.ov.paint(P({ cursors: [C()] })); r.ov.paint(P({ cursors: [C({ x: 400, y: 500 })] }));
  r.clock.frame();
  assert.deepEqual([r.q('.dz-cursor').style.getPropertyValue('--x'), r.q('.dz-cursor').style.getPropertyValue('--y')], ['400px', '500px']);
  assert.equal(r.q('.dz-trail'), null, 'an entry draws no trail');
});
test('a long glide caps at 950 ms; the trail counts screen px; a colour change repaints the same cursor', () => {
  const { ov, q, clock } = rig();
  ov.paint(P({ cursors: [C()] })); clock.frame();
  ov.paint(P({ cursors: [C({ x: 140 })] }));
  assert.equal(q('.dz-trail'), null, '40 document px is 20 screen px at 0.5');
  ov.paint(P({ cursors: [C({ x: 3140 })] }));
  assert.equal(q('.dz-cursor').style.getPropertyValue('--glide'), '950ms');
  const el = q('.dz-cursor');
  ov.paint(P({ cursors: [C({ x: 3140, crew: '--stage-coral' })] }));
  assert.equal(q('.dz-cursor'), el);
  assert.equal(el.style.getPropertyValue('--crew'), 'var(--stage-coral)');
});
test('marks keep their stacking whatever order they arrive in, and a wire that stops being the main one loses its class in place', () => {
  const { ov, q, host } = rig({ reduced: true });
  const pin = { key: 'pin', rect: [0, 0, 100, 100], tag: 'x' };
  const wire = (main) => ({ key: 'w', rect: [0, 0, 640, 400], tag: main ? 'img 640×400' : null, main });
  ov.paint(P({ marks: { ...NONE, pins: [pin], wires: [wire(true)] } }));
  const w = q('.dz-wire');
  ov.paint(P({ marks: { ...NONE, pins: [pin], wires: [wire(true)], boxes: [{ key: 'b', rect: [0, 0, 500, 50], tag: 't' }], plus: [{ key: 'p', x: 1, y: 1 }] } }));
  assert.deepEqual([...host.querySelector('.overlay-doc.is-marks').children].map((e) => e.className), ['dz-plus', 'dz-wire is-main', 'dz-box', 'dz-box is-pin']);
  ov.paint(P({ marks: { ...NONE, pins: [pin], wires: [wire(false)] } }));
  assert.equal(q('.dz-wire'), w);
  assert.equal(w.className, 'dz-wire');
  assert.equal(w.querySelector('.dz-tag'), null);
});
test('a cursor with no agent id or a mark with no rect is skipped, and the rest still draw', () => {
  const { ov, qa } = rig({ reduced: true });
  ov.paint(P({ cursors: [C({ agentId: undefined }), C()], marks: { ...NONE, boxes: [{ key: 'x' }, { key: 'b', rect: [0, 0, 500, 50], tag: 't' }] } }));
  assert.deepEqual([qa('.dz-cursor').length, qa('.dz-box').length], [1, 1]);
});
