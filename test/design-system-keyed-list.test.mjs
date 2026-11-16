// test/design-system-keyed-list.test.mjs — patchKeyed and frameBatch (docs/rail/components.md `comp.keyed-patch`): a list
// redrawn on live data keeps the node of every item whose drawing did not change, moves without re-creating, and keeps an
// orb's canvas in a redrawn item; live redraws wait for the next frame, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { patchKeyed, patchParts, frameBatch } from '../ui/public/design-system/components/index.mjs';

const box = () => new JSDOM('<!doctype html><div id="c"></div>').window.document.getElementById('c');
const li = (k, t = k) => ({ key: k, html: `<p data-k="${k}">${t}</p>` });
const el = (c, k) => c.querySelector(`[data-k="${k}"]`);

test('the first call builds the list and serialises like the concatenated strings', () => {
  const c = box();
  const items = [li('a'), { key: 't', html: 'loose <b>text</b>' }, li('b')];
  assert.deepEqual(patchKeyed(c, items), { kept: 0, replaced: 0, added: 3, removed: 0 });
  assert.equal(c.innerHTML, items.map((x) => x.html).join(''));
});

test('an unchanged item keeps its node; a changed item is replaced and its neighbours are kept', () => {
  const c = box();
  patchKeyed(c, [li('a'), li('b'), li('c')]);
  const [a, b, cc] = ['a', 'b', 'c'].map((k) => el(c, k));
  assert.deepEqual(patchKeyed(c, [li('a'), li('b', 'B!'), li('c')]), { kept: 2, replaced: 1, added: 0, removed: 0 });
  assert.equal(el(c, 'a'), a);
  assert.equal(el(c, 'c'), cc);
  assert.notEqual(el(c, 'b'), b);
  assert.equal(el(c, 'b').textContent, 'B!');
  assert.deepEqual(patchKeyed(c, [li('a'), li('b', 'B!'), li('c')]), { kept: 3, replaced: 0, added: 0, removed: 0 });
});

test('a new key is inserted at its position; a gone key is removed', () => {
  const c = box();
  patchKeyed(c, [li('a'), li('c')]);
  const a = el(c, 'a');
  assert.deepEqual(patchKeyed(c, [li('a'), li('b'), li('c')]), { kept: 2, replaced: 0, added: 1, removed: 0 });
  assert.equal(c.innerHTML, [li('a'), li('b'), li('c')].map((x) => x.html).join(''));
  assert.deepEqual(patchKeyed(c, [li('a'), li('c')]), { kept: 2, replaced: 0, added: 0, removed: 1 });
  assert.equal(el(c, 'b'), null);
  assert.equal(el(c, 'a'), a);
});

test('a reorder moves the nodes without re-creating them', () => {
  const c = box();
  patchKeyed(c, [li('a'), li('b'), li('c')]);
  const nodes = ['a', 'b', 'c'].map((k) => el(c, k));
  assert.deepEqual(patchKeyed(c, [li('c'), li('a'), li('b')]), { kept: 3, replaced: 0, added: 0, removed: 0 });
  assert.deepEqual([...c.children], [nodes[2], nodes[0], nodes[1]]);
});

test('an item of several nodes and text is tracked as one range', () => {
  const c = box();
  const multi = (t) => ({ key: 'm', html: `head ${t}<i>x</i><i>y</i> tail` });
  patchKeyed(c, [li('a'), multi(1), li('b')]);
  assert.deepEqual(patchKeyed(c, [li('a'), multi(2), li('b')]), { kept: 2, replaced: 1, added: 0, removed: 0 });
  assert.equal(c.innerHTML, li('a').html + multi(2).html + li('b').html);
  assert.equal(c.childNodes.length, 6);
  patchKeyed(c, [li('b'), multi(2)]);
  assert.equal(c.innerHTML, li('b').html + multi(2).html);
});

test('a duplicate key gets a stable occurrence suffix and never throws', () => {
  const c = box();
  patchKeyed(c, [li('a'), { key: 'a', html: '<p>second</p>' }, li('b')]);
  const second = c.children[1];
  assert.deepEqual(patchKeyed(c, [li('a'), { key: 'a', html: '<p>second</p>' }, li('b')]), { kept: 3, replaced: 0, added: 0, removed: 0 });
  assert.equal(c.children[1], second);
});

test('a container changed by someone else is rebuilt once', () => {
  const c = box();
  patchKeyed(c, [li('a'), li('b')]);
  c.innerHTML = '<span>foreign</span>';
  assert.deepEqual(patchKeyed(c, [li('a'), li('b')]), { kept: 0, replaced: 0, added: 2, removed: 0 });
  assert.equal(c.innerHTML, li('a').html + li('b').html);
  assert.equal(patchKeyed(c, [li('a'), li('b')]).kept, 2);
});

test('carry keeps the old canvas in a replaced item, takes the new attributes and drops one the new element lacks', () => {
  const c = box();
  const row = (phase, t, extra = '') => ({ key: 'r', html: `<div><canvas data-orb="${phase}"${extra}></canvas><span>${t}</span></div>` });
  patchKeyed(c, [row('think', '1s', ' data-old="1"')], { carry: 'canvas[data-orb]' });
  const cv = c.querySelector('canvas');
  const r = patchKeyed(c, [row('write', '2s')], { carry: 'canvas[data-orb]' });
  assert.equal(r.replaced, 1);
  assert.equal(c.querySelector('canvas'), cv, 'the same canvas');
  assert.equal(cv.getAttribute('data-orb'), 'write');
  assert.equal(cv.hasAttribute('data-old'), false);
  assert.equal(c.querySelector('span').textContent, '2s');
  assert.equal(c.innerHTML, row('write', '2s').html);
});

test('carry leaves what the page set on the kept canvas since its drawing (a DPR-sized backing store) unless the drawing changed it', () => {
  const c = box();
  const row = (phase, t, w = '32') => ({ key: 'r', html: `<div><canvas data-orb="${phase}" width="${w}" height="32" style="width:32px"></canvas><span>${t}</span></div>` });
  patchKeyed(c, [row('think', '1s')], { carry: 'canvas[data-orb]' });
  const cv = c.querySelector('canvas');
  cv.setAttribute('width', '64'); cv.setAttribute('height', '64'); cv.setAttribute('data-phase', 'think');   // the orb's runtime, DPR 2
  patchKeyed(c, [row('write', '2s')], { carry: 'canvas[data-orb]' });
  assert.equal(c.querySelector('canvas'), cv, 'the same canvas');
  assert.equal(cv.getAttribute('data-orb'), 'write');
  assert.equal(cv.getAttribute('width'), '64', 'the backing store keeps its DPR size');
  assert.equal(cv.getAttribute('height'), '64');
  assert.equal(cv.getAttribute('data-phase'), 'think', 'an attribute the drawing never had stays');
  patchKeyed(c, [row('write', '3s', '48')], { carry: 'canvas[data-orb]' });
  assert.equal(cv.getAttribute('width'), '48', 'an attribute the drawing changed is taken');
});

test('frameBatch runs fn once for 5 requests, on the next animation frame', () => {
  const frames = [];
  const win = { requestAnimationFrame: (f) => frames.push(f), cancelAnimationFrame: (i) => { frames[i - 1] = null; } };
  let n = 0;
  const b = frameBatch(win, () => { n++; });
  for (let i = 0; i < 5; i++) b.request();
  assert.equal(frames.length, 1);
  assert.equal(n, 0);
  frames[0]();
  assert.equal(n, 1);
  b.request();
  assert.equal(frames.length, 2, 'a request after the frame asks for a new one');
});

test('frameBatch: flush runs a pending fn now, once; cancel drops it', () => {
  const frames = [];
  const win = { requestAnimationFrame: (f) => frames.push(f), cancelAnimationFrame: (i) => { frames[i - 1] = null; } };
  let n = 0;
  const b = frameBatch(win, () => { n++; });
  b.flush();
  assert.equal(n, 0, 'nothing pending: nothing runs');
  b.request(); b.flush();
  assert.equal(n, 1);
  assert.equal(frames[0], null, 'the frame it was waiting for is cancelled');
  b.request(); b.cancel();
  assert.equal(frames[1], null);
  b.flush();
  assert.equal(n, 1);
});

test('frameBatch falls back to a 16 ms timeout without requestAnimationFrame', () => {
  const t = [];
  const win = { setTimeout: (f, ms) => t.push([f, ms]), clearTimeout: () => {} };
  let n = 0;
  const b = frameBatch(win, () => { n++; });
  b.request(); b.request();
  assert.equal(t.length, 1);
  assert.equal(t[0][1], 16);
  t[0][0]();
  assert.equal(n, 1);
});

test('B2.7 comp.patch-parts: a redraw that changes one part leaves the other parts\' nodes identical (same objects), and an empty part draws nothing', () => {
  const c = box();
  const parts = (b, d = '') => ({ popover: '<div data-k="a">A</div>', 'new-run': b, account: d, session: '<p data-k="s">S</p>' });
  assert.deepEqual(patchParts(c, parts('', null)), { kept: 0, replaced: 0, added: 4, removed: 0 });
  assert.equal(c.innerHTML, '<div data-k="a">A</div><p data-k="s">S</p>', 'empty, null and undefined parts draw nothing');
  const a = el(c, 'a'), s = el(c, 's');
  patchParts(c, parts('<i data-k="b">B</i>'));
  assert.equal(c.innerHTML, '<div data-k="a">A</div><i data-k="b">B</i><p data-k="s">S</p>', 'a part that comes back is inserted at its place');
  assert.equal(el(c, 'a'), a);
  assert.equal(el(c, 's'), s);
  const b = el(c, 'b');
  assert.deepEqual(patchParts(c, parts('<i data-k="b">B</i>', '<u data-k="d">D</u>')), { kept: 3, replaced: 1, added: 0, removed: 0 });
  assert.equal(el(c, 'b'), b);
  assert.deepEqual(patchParts(c, parts('', '<u data-k="d">D</u>')), { kept: 3, replaced: 1, added: 0, removed: 0 });
  assert.equal(el(c, 'b'), null, 'a part that becomes empty is removed');
  assert.equal(el(c, 'a'), a);
  assert.equal(el(c, 's'), s);
});

test('B2.7 comp.patch-parts: a redraw that changes nothing replaces nothing and queues no mutation record', () => {
  const dom = new JSDOM('<!doctype html><div id="c"></div>'), c = dom.window.document.getElementById('c');
  const parts = { head: '<h2>Head</h2>', field: '<input value="x">', tail: 'text <b>tail</b>' };
  patchParts(c, parts);
  const nodes = [...c.childNodes];
  const recs = [];
  const mo = new dom.window.MutationObserver((l) => recs.push(...l));
  mo.observe(c, { childList: true, subtree: true, attributes: true, characterData: true });
  assert.deepEqual(patchParts(c, { ...parts }), { kept: 3, replaced: 0, added: 0, removed: 0 });
  recs.push(...mo.takeRecords()); mo.disconnect();
  assert.equal(recs.length, 0);
  assert.deepEqual([...c.childNodes], nodes);
});
