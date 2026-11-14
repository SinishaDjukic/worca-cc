import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootBridge, SLOT_HERO } from './helpers/design-bridge.mjs';
import { checkRows } from './helpers/rows.mjs';

// C-6 additions (P7 Task 8): board in the build doc, play/pause/seek and the film's time in the run doc, and the
// real deck-stage told it is presenting so its own overlay and rail stay off.

const BOARD = { cols: 3, s: 0.178703, gap: 12, pad: 16, padB: 76, r: 8, bg: '#101217' };
const SRC = readFileSync(new URL('../assets/deck-kit/deck-stage.js', import.meta.url), 'utf8');
const DECK = '<!doctype html><html><head></head><body><deck-stage width="1920" height="1080" no-rail><section data-section="s1" data-label="A"></section><section data-section="s2" data-label="B"></section></deck-stage></body></html>';
const styleOf = (b, n) => b.doc.documentElement.style.getPropertyValue(n);
test('board sets the seven variables in the build doc, and does nothing in the run doc', () => {
  const b = bootBridge({ html: SLOT_HERO }); b.send('board', BOARD);
  assert.deepEqual(['cols', 's', 'gap', 'pad', 'pad-b', 'r', 'bg'].map((k) => styleOf(b, `--worca-board-${k}`)), ['3', '0.178703', '12px', '16px', '76px', '8px', '#101217']);
  assert.deepEqual(b.of('err'), []);
  const r = bootBridge({ mode: 'run', html: SLOT_HERO }); r.send('board', BOARD);
  assert.equal(r.doc.documentElement.getAttribute('style'), null);
});
test('a bad board is an err and changes nothing', async () => {
  await checkRows([{ cols: 0 }, { cols: 41 }, { cols: 1.5 }, { s: 0 }, { s: 1.5 }, { s: 'x' }, { gap: -1 }, { pad: 999 }, { r: 99 }, { bg: 'red' }, { bg: '#fff;color:red' }].map((o) => ({ name: JSON.stringify(o), run: () => {
    const b = bootBridge({ html: SLOT_HERO }); b.send('board', { ...BOARD, ...o });
    assert.equal(b.of('err')[0].code, 'bad-message'); assert.equal(b.doc.documentElement.getAttribute('style'), null);
  } })));
});
test('board schedules rects', () => {
  const b = bootBridge({ html: SLOT_HERO }); b.sent.length = 0; b.send('board', BOARD); b.clock.frame();
  assert.equal(b.of('rects').length, 1);
});
test('play, pause and seek reach the film in the run doc only; garbage is an err', () => {
  const calls = [];
  const F = { play: () => calls.push('play'), pause: () => calls.push('pause'), seek: (t) => calls.push(t) };
  const r = bootBridge({ mode: 'run', html: SLOT_HERO }); r.win.F = F;
  r.send('play', {}); r.send('pause', {}); r.send('seek', { at: 1.5 }); r.send('seek', { at: -1 }); r.send('seek', { at: 'x' });
  r.send('seek', { at: 0 }); r.send('seek', { at: -0.001 });   // review M6: Home and a press left of the lane send 0
  assert.deepEqual(calls, ['play', 'pause', 1.5, 0]);
  assert.deepEqual(r.of('err').map((e) => e.code), ['bad-message', 'bad-message', 'bad-message']);
  const none = bootBridge({ mode: 'run', html: SLOT_HERO }); none.send('play', {}); none.send('seek', { at: 1 }); assert.deepEqual(none.of('err'), [], 'a page with no film just ignores it');
  const b = bootBridge({ html: SLOT_HERO }); b.win.F = F; calls.length = 0; b.send('play', {}); b.send('seek', { at: 1 }); assert.deepEqual(calls, [], 'M9: no playback before round end');
});
test('a throwing film is an err, not a dead bridge', () => {
  const r = bootBridge({ mode: 'run', html: SLOT_HERO }); r.win.F = { play() { throw new Error('boom'); } };
  r.send('play', {}); assert.equal(r.of('err')[0].code, 'apply-failed');
  r.send('goto', { index: 0 }); assert.equal(r.of('err').length, 1);
});
test('filmtime becomes time, at most every 0.1 s of film time while playing, always when it stops', () => {
  const r = bootBridge({ mode: 'run', html: SLOT_HERO }); r.sent.length = 0;
  const fire = (t, playing) => r.doc.dispatchEvent(new r.win.CustomEvent('filmtime', { detail: { t, playing, dur: 5 } }));
  fire(0, true); fire(0.01, true); fire(0.05, true); fire(0.11, true); fire(0.12, false);
  const { ns, v, n, t: tt, ...first } = r.of('time')[0];
  assert.deepEqual(first, { at: 0, playing: true, dur: 5 });
  assert.deepEqual(r.of('time').map((m) => [m.at, m.playing]), [[0, true], [0.11, true], [0.12, false]]);
  const b = bootBridge({ html: SLOT_HERO }); b.doc.dispatchEvent(new b.win.CustomEvent('filmtime', { detail: { t: 0, playing: true, dur: 5 } })); assert.deepEqual(b.of('time'), []);
});
test('filmscene becomes visible', () => {
  const r = bootBridge({ mode: 'run', html: SLOT_HERO });
  r.doc.dispatchEvent(new r.win.CustomEvent('filmscene', { detail: { id: 'open' } }));
  assert.equal(r.of('visible')[0].id, 'open');
});
test('the real deck-stage: first slide visible, its overlay off, and the hash it rewrites does not break the nonce', async () => {
  const b = bootBridge({ mode: 'run', html: DECK, resizeObserver: true });
  b.win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  b.win.eval(SRC);
  for (let i = 0; i < 40 && !b.of('visible').length; i++) await new Promise((res) => setTimeout(res, 5));
  assert.equal(b.of('visible')[0].id, 's1');
  assert.equal(b.win.location.hash, '#1', 'deck-stage.js:1300');
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(b.doc.querySelector('deck-stage')._presenting, true, 'our chrome is the parent\'s');
  b.send('goto', { index: 1 });
  assert.equal(b.doc.querySelector('[data-deck-active]').getAttribute('data-section'), 's2');
  assert.equal(b.of('visible').at(-1).id, 's2');
});
test('board: the limits are inclusive, padB is checked too, and a later board replaces the variables', async () => {
  const b = bootBridge({ html: SLOT_HERO });
  b.send('board', { cols: 40, s: 1, gap: 0, pad: 200, padB: 200, r: 16, bg: '#ABCdef' });
  b.send('board', { cols: 1, s: 1e-3, gap: 200, pad: 0, padB: 0, r: 0, bg: '#000000' });
  assert.deepEqual(b.of('err'), []);
  assert.deepEqual(['cols', 's', 'gap', 'pad', 'pad-b', 'r', 'bg'].map((k) => styleOf(b, `--worca-board-${k}`)), ['1', '0.001', '200px', '0px', '0px', '0px', '#000000']);
  await checkRows([{ padB: -1 }, { padB: 201 }, { cols: '3' }, { gap: 'x' }, { r: -1 }, { gap: '12' }, { r: true }, { bg: '#10121' }, { bg: 1 }, { bg: ['#101217'] }, { bg: '#101217;color:red' }, { bg: 'x#101217' }].map((o) => ({ name: JSON.stringify(o), run: () => {
    const c = bootBridge({ html: SLOT_HERO }); c.send('board', { ...BOARD, ...o });
    assert.equal(c.of('err')[0].code, 'bad-message'); assert.equal(c.doc.documentElement.getAttribute('style'), null);
  } })));
});
test('time: at is clamped to the film, a bad detail posts nothing, and a pause to play change always posts', () => {
  const r = bootBridge({ mode: 'run', html: SLOT_HERO }); r.sent.length = 0;
  const fire = (detail) => r.doc.dispatchEvent(new r.win.CustomEvent('filmtime', { detail }));
  fire({ t: Number.NaN, playing: true, dur: 5 }); fire({ t: 1, playing: true, dur: -1 }); fire(null); fire({ t: 1, playing: true });
  assert.deepEqual(r.of('time'), []);
  fire({ t: 7, playing: false, dur: 5 }); fire({ t: -1, playing: false, dur: 5 }); fire({ t: 0.005, playing: false, dur: 5 }); fire({ t: 0.01, playing: true, dur: 5 }); fire({ t: 0.02, playing: true, dur: 5 });
  for (const t of [0.12, 0.2, 0.23]) fire({ t, playing: true, dur: 5 });
  assert.deepEqual(r.of('time').map((m) => [m.at, m.playing, m.dur]), [[5, false, 5], [0, false, 5], [0.005, false, 5], [0.01, true, 5], [0.12, true, 5], [0.23, true, 5]], 'each step is from the last post, not the first');
  assert.deepEqual(r.of('err'), []);
});
test('filmscene: an id that is not a section posts nothing, and the build doc never listens', () => {
  const r = bootBridge({ mode: 'run', html: SLOT_HERO });
  for (const detail of [{ id: 'Bad Id' }, { id: 3 }, null]) r.doc.dispatchEvent(new r.win.CustomEvent('filmscene', { detail }));
  assert.deepEqual([r.of('visible'), r.of('err')], [[], []]);
  const b = bootBridge({ html: SLOT_HERO });
  b.doc.dispatchEvent(new b.win.CustomEvent('filmscene', { detail: { id: 'open' } }));
  assert.deepEqual(b.of('visible'), []);
});
test('seek refuses a non-finite or string at, and a film without the method just ignores it', () => {
  const r = bootBridge({ mode: 'run', html: SLOT_HERO }); const calls = []; r.win.F = { seek: (t) => calls.push(t) };
  r.send('seek', { at: Number.POSITIVE_INFINITY }); r.send('seek', { at: '1' }); r.send('play', {}); r.send('pause', {});
  assert.deepEqual([calls, r.of('err').map((e) => e.code)], [[], ['bad-message', 'bad-message']]);
});
test('the build doc ignores pause too', () => {
  const b = bootBridge({ html: SLOT_HERO }); const calls = []; b.win.F = { pause: () => calls.push('pause') };
  b.send('pause', {}); assert.deepEqual([calls, b.of('err')], [[], []]);
});
test('a <video id="F"> is markup, not a film: play and pause leave it alone', () => {
  const r = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><video id="F"></video></body></html>' });
  const calls = [];
  r.win.HTMLMediaElement.prototype.play = () => calls.push('play');
  r.win.HTMLMediaElement.prototype.pause = () => calls.push('pause');
  assert.equal(r.win.F, r.doc.getElementById('F'));
  r.send('play', {}); r.send('pause', {});
  assert.deepEqual([calls, r.of('err')], [[], []]);
});
test('beyond the plan: the first hello repeats the slide or scene in view, which came before the parent heard ready', () => {
  const HELLO = { mode: 'run', kind: 'pitch', canvas: { w: 1920, h: 1080 } };
  const r = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><deck-stage><section data-section="s1"></section><section data-section="s2"></section></deck-stage></body></html>' });
  r.doc.querySelector('deck-stage').dispatchEvent(new r.win.CustomEvent('slidechange', { bubbles: true, detail: { slide: r.doc.querySelector('[data-section="s2"]') } }));
  r.sent.length = 0;
  r.send('hello', HELLO);
  assert.deepEqual(r.of('visible').map((v) => v.id), ['s2']);
  r.send('hello', HELLO);
  assert.deepEqual(r.of('visible').map((v) => v.id), ['s2'], 'only the first hello');
  const f = bootBridge({ mode: 'run', html: SLOT_HERO });
  f.doc.dispatchEvent(new f.win.CustomEvent('filmscene', { detail: { id: 'open' } }));
  f.sent.length = 0;
  f.send('hello', { ...HELLO, kind: 'video' });
  assert.deepEqual(f.of('visible').map((v) => v.id), ['open']);
  const none = bootBridge({ mode: 'run', html: SLOT_HERO }); none.send('hello', HELLO);
  assert.deepEqual(none.of('visible'), [], 'nothing in view, nothing said');
  const b = bootBridge({ html: SLOT_HERO });
  b.doc.dispatchEvent(new b.win.CustomEvent('filmscene', { detail: { id: 'open' } }));
  b.send('hello', { ...HELLO, mode: 'build' });
  assert.deepEqual(b.of('visible'), [], 'the build doc has nothing in view');
});
test('the deck is told it is presenting once, on the first slidechange, and the bridge ignores that message', async () => {
  const r = bootBridge({ mode: 'run', html: '<!doctype html><html><head></head><body><deck-stage><section data-section="s1"></section><section data-section="s2"></section></deck-stage></body></html>' });
  const told = [];
  r.win.addEventListener('message', (e) => { if (e.data && '__omelette_presenting' in e.data) told.push(e.data.__omelette_presenting); });
  const stage = r.doc.querySelector('deck-stage');
  for (const id of ['s1', 's2', 's1']) stage.dispatchEvent(new r.win.CustomEvent('slidechange', { bubbles: true, detail: { slide: r.doc.querySelector(`[data-section="${id}"]`) } }));
  await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(told, [true]);
  assert.deepEqual([r.of('visible').map((v) => v.id), r.of('err')], [['s1', 's2', 's1'], []]);
});
