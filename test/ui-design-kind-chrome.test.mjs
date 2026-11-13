// The deck and video chrome (ui/public/design/kind-chrome.mjs) on its own, through test/helpers/design-kind-chrome.mjs:
// while a round builds it owns only the `board` message the build doc lays its tiles out by (M9, L7.23). P4's model
// draws the tiles; the rail and the film bar come in later tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createKindChrome } from '../ui/public/design/kind-chrome.mjs';
import { kindChromeView } from '../ui/public/design/kind-view.mjs';
import { rig } from './helpers/design-kind-chrome.mjs';

const RECTS = {
  t: 'rects', scrollX: 0, scrollY: 0, vw: 1096, vh: 900, docH: 900,
  sections: [{ id: 's1', rect: [21, 16, 343, 193] }, { id: 's2', rect: [376, 16, 343, 193] }, { id: 's3', rect: [731, 16, 343, 193] }],
};
const BOARD = { cols: 2, s: 0.273958, gap: 12, pad: 16, padB: 76, r: 8, bg: '#101217' };
const SCENES = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, job: `Scene ${i + 1}`, status: 'planned', agentId: null, duration: 4 }));

test('building: the board goes down once, again after ready, and on a real change only', () => {
  const { chrome, of } = rig();
  assert.deepEqual(of('board'), [BOARD], 'three slides at 1096 wide: two columns give the widest tile, 526 px');
  chrome.onFrameMessage({ t: 'ready', mode: 'build' });
  assert.equal(of('board').length, 2);
  assert.deepEqual(of('board')[1], BOARD);
  chrome.resize({ cw: 1096, ch: 900 });
  assert.equal(of('board').length, 2);
  chrome.resize({ cw: 800, ch: 900 });
  assert.deepEqual([of('board').length, of('board')[2].cols], [3, 1]);
});
test('video posts its board above the timeline', () => {
  const { of } = rig({ kind: 'video', sections: SCENES });
  assert.deepEqual(of('board'), [{ cols: 3, s: 0.180555, gap: 12, pad: 16, padB: 70, r: 8, bg: '#101217' }]);
});
test('no board in the run doc, and none with no sections', () => {
  const { chrome, of } = rig();
  const n = of('board').length;
  chrome.setDocMode('run');
  assert.equal(of('board').length, n);
  assert.deepEqual(rig({ sections: [] }).of('board'), []);
});
test('no navigation while building: nothing to press', () => {
  const { chrome, of, wrap } = rig();
  chrome.onFrameMessage(RECTS);
  chrome.onFrameMessage({ t: 'visible', id: 's1' });
  assert.deepEqual(of('goto'), []);
  assert.equal(wrap.querySelectorAll('button').length, 0);
});
test('a change round from the run doc posts its board again', () => {
  const { chrome, of } = rig();
  chrome.setDocMode('run');
  const n = of('board').length;
  chrome.onDesignFrame({ type: 'design-build', status: 'building' });
  chrome.setDocMode('build');
  assert.ok(of('board').length > n);
  assert.deepEqual(of('board').at(-1), of('board')[0]);
});

// Beyond the plan's list: Step 4's `lastBoard` rules.
test('beyond the plan: a ready run doc posts nothing; a ready build doc with no board yet posts nothing', () => {
  const { chrome, of } = rig({ sections: [] });
  chrome.onFrameMessage({ t: 'ready', mode: 'build' });
  chrome.onFrameMessage({ t: 'ready', mode: 'run' });
  assert.deepEqual(of('board'), []);
  chrome.setPlan({ sections: [{ id: 's1', job: 'Title', status: 'planned', agentId: null }] });
  assert.equal(of('board').length, 1);
  chrome.onFrameMessage({ t: 'ready', mode: 'run' });
  assert.equal(of('board').length, 1);
});
test('beyond the plan: an unmeasured stage posts nothing and forgets the board, so the next measure posts it again', () => {
  const { chrome, of } = rig();
  chrome.resize({ cw: 0, ch: 0 });
  assert.equal(of('board').length, 1);
  chrome.onFrameMessage({ t: 'ready', mode: 'build' });
  assert.equal(of('board').length, 1, 'no board to send again');
  chrome.resize({ cw: 1096, ch: 900 });
  assert.deepEqual(of('board'), [BOARD, BOARD]);
});
test('beyond the plan: a board is recorded even when the frame was not ready to take it', () => {
  const posts = [];
  let ready = false;
  const doc = new JSDOM('<div class="dz-wrap"></div>').window.document;
  const chrome = createKindChrome({
    doc, wrap: doc.querySelector('.dz-wrap'), kind: 'pitch', openRailFrame: () => null, colorOf: () => null,
    post: (t, f) => { posts.push([t, f, ready]); return ready; },
  });
  const view = kindChromeView({ kind: 'pitch', live: true, docMode: null, sections: [{ id: 's1', job: 'T', status: 'planned', agentId: null }], stageW: 1096, stageH: 900 });
  chrome.update(view);
  chrome.update({ ...view, board: { ...view.board } });
  assert.equal(posts.length, 1, 'the same board is not posted twice');
  ready = true;
  chrome.onFrameMessage({ t: 'ready', mode: 'build' });
  assert.deepEqual(posts.map(([t, , r]) => [t, r]), [['board', false], ['board', true]]);
  chrome.destroy();
});

// A video's sound in the preview (SPEC D12, U5; Review Focus 8): the chrome owns the player. A run doc's `ready` loads
// the tracks; play unlocks the elements inside the click; the frame's `time` drives them; leaving the run doc, picking,
// a lost frame, a hidden tab and destroy stop them. The page has no media: each method defines an own `paused` and
// records the call with the number of `play` posts the frame had by then.
const TRACKS = JSON.parse(readFileSync(new URL('./fixtures/film-sound-cases.json', import.meta.url), 'utf8')).tracks;
const DONE_SCENES = SCENES.slice(0, 3).map((s) => ({ ...s, status: 'done' }));
const flush = () => new Promise((resolve) => setImmediate(resolve));
function stubMedia(win, mark = () => 0) {
  const calls = [];
  const P = win.HTMLMediaElement.prototype;
  const flag = (el, value) => Object.defineProperty(el, 'paused', { value, writable: true, configurable: true });
  P.play = function play() { flag(this, false); calls.push(['play', this, mark()]); return Promise.resolve(); };
  P.pause = function pause() { flag(this, true); calls.push(['pause', this, mark()]); };
  P.load = function load() { calls.push(['load', this, mark()]); };
  return calls;
}
function held() {
  const d = {};
  d.promise = new Promise((resolve, reject) => { Object.assign(d, { resolve, reject }); });
  return d;
}
function film({ kind = 'video', tracks = TRACKS, cw = 1096, ch = 900 } = {}) {
  const loads = [];
  let next = null;
  const r = rig({
    kind, sections: DONE_SCENES, cw, ch,
    loadTracks: () => {
      loads.push(1);
      const d = next;
      next = null;
      return d ? d.promise : Promise.resolve(tracks);
    },
    fileUrl: (name) => `/f/${name}`,
  });
  const calls = stubMedia(r.win, () => r.of('play').length);
  const made = [];
  const create = r.doc.createElement.bind(r.doc);
  r.doc.createElement = (tag, ...rest) => {
    const el = create(tag, ...rest);
    if (String(tag).toLowerCase() === 'audio') made.push(el);
    return el;
  };
  return {
    ...r, loads, calls, made,
    hold() { next = held(); return next; },
    mute: () => r.wrap.querySelector('.dz-mute'),
    time: (at, playing = true) => r.chrome.onFrameMessage({ t: 'time', at, playing, dur: 12 }),
    els: () => made.slice(-3),
    playing: () => made.slice(-3).map((el) => el.paused === false),
  };
}

test('sound: a run doc\'s ready loads the tracks once, then Mute shows', async () => {
  const f = film();
  f.chrome.onFrameMessage({ t: 'ready', mode: 'build' });
  await flush();
  assert.deepEqual([f.loads.length, f.mute()], [0, null], 'a build doc plays nothing');
  f.chrome.setDocMode('run');
  assert.deepEqual([f.loads.length, f.mute()], [1, null], 'not before the tracks');
  await flush();
  assert.deepEqual([f.loads.length, f.mute()?.title], [1, 'Mute']);
  assert.deepEqual(f.made.map((el) => new URL(el.src).pathname), ['/f/voice-a.mp3', '/f/voice-b.mp3', '/f/music.mp3']);
  for (const tracks of [null, { clips: [], music: null }]) {
    const none = film({ tracks });
    none.chrome.setDocMode('run');
    await flush();
    assert.deepEqual([none.loads.length, none.mute(), none.made], [1, null, []], JSON.stringify(tracks));
  }
});
test('sound: a ready takes the button away at once, before its tracks arrive', async () => {
  const f = film();
  f.chrome.setDocMode('run');
  await flush();
  assert.ok(f.mute());
  const d = f.hold();
  f.chrome.setDocMode('run');
  assert.equal(f.mute(), null);
  d.resolve(TRACKS);
  await flush();
  assert.equal(f.mute().title, 'Mute');
});
test('sound: play unlocks every element before the frame is told; a time message plays them', async () => {
  const f = film();
  f.chrome.setDocMode('run');
  await flush();
  const els = f.els();
  f.wrap.querySelector('.dz-transport button').click();
  assert.equal(f.of('play').length, 1);
  assert.deepEqual(f.calls.splice(0).map(([name, el, plays]) => [name, els.indexOf(el), plays]), [
    ['play', 0, 0], ['pause', 0, 0], ['play', 1, 0], ['pause', 1, 0], ['play', 2, 0], ['pause', 2, 0],
  ]);
  f.time(1);
  assert.deepEqual(f.playing(), [true, false, true]);
  f.time(1.1, false);
  assert.deepEqual(f.playing(), [false, false, false]);
});
test('sound: a round turning live, picking, a build ready and a lost frame each silence it', async () => {
  const f = film();
  f.chrome.setDocMode('run');
  await flush();
  f.time(1);
  assert.deepEqual(f.playing(), [true, false, true]);
  f.chrome.pause();
  assert.deepEqual(f.playing(), [false, false, false], 'picking');
  f.time(1.1);
  f.chrome.silence();
  assert.deepEqual(f.playing(), [false, false, false], 'a lost frame');
  f.time(1.2);
  f.chrome.onFrameMessage({ t: 'ready', mode: 'build' });
  assert.deepEqual(f.playing(), [false, false, false], 'a build ready');
  f.time(1.3);
  assert.deepEqual(f.playing(), [false, false, false], 'no sound until a run doc loads its tracks again');
  f.chrome.setDocMode('run');
  await flush();
  f.time(1);
  assert.deepEqual(f.playing(), [true, false, true]);
  f.chrome.onDesignFrame({ type: 'design-build', status: 'building' });
  assert.deepEqual(f.playing(), [false, false, false], 'a round turning live');
});
test('sound: tracks arriving after destroy or after a newer ready make no element', async () => {
  const f = film();
  const d = f.hold();
  f.chrome.setDocMode('run');
  f.chrome.destroy();
  d.resolve(TRACKS);
  await flush();
  assert.deepEqual(f.made, []);
  const g = film();
  const first = g.hold();
  g.chrome.setDocMode('run');
  const second = g.hold();
  g.chrome.setDocMode('run');
  first.resolve(TRACKS);
  await flush();
  assert.deepEqual([g.made.length, g.mute()], [0, null], 'a newer run ready');
  const third = g.hold();
  g.chrome.setDocMode('run');
  g.chrome.onFrameMessage({ t: 'ready', mode: 'build' });
  second.resolve(TRACKS);
  third.resolve(TRACKS);
  await flush();
  assert.deepEqual([g.made.length, g.mute()], [0, null], 'a newer build ready');
  const h = film();
  h.hold().reject(new Error('offline'));
  h.chrome.setDocMode('run');
  await flush();
  assert.deepEqual([h.made, h.mute()], [[], null], 'a failed load is no sound');
});
test('sound: Mute mutes every element and is kept; a hidden tab silences them; destroy pauses and empties them', async () => {
  const f = film();
  f.chrome.setDocMode('run');
  await flush();
  f.mute().click();
  assert.deepEqual([f.made.every((el) => el.muted), f.mute().title, f.win.localStorage['worca.design.mute']], [true, 'Unmute', '1']);
  f.chrome.setDocMode('run');
  await flush();
  const els = f.els();
  assert.deepEqual([els.every((el) => el.muted), f.mute().title], [true, 'Unmute'], 'the next run doc starts muted');
  f.mute().click();
  assert.deepEqual([els.some((el) => el.muted), f.mute().title, f.win.localStorage['worca.design.mute']], [false, 'Mute', '0']);
  const tab = (state) => {
    Object.defineProperty(f.doc, 'visibilityState', { configurable: true, get: () => state });
    f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
  };
  f.time(1);
  tab('visible');
  assert.deepEqual(f.playing(), [true, false, true]);
  tab('hidden');
  assert.deepEqual(f.playing(), [false, false, false]);
  f.time(1.1);
  assert.deepEqual(f.playing(), [true, false, true], 'the next time message plays again');
  f.chrome.destroy();
  assert.ok(els.every((el) => el.paused && el.getAttribute('src') === null));
});
test('sound: the state waits for a bar made later; a deck given loadTracks never calls it; no loadTracks, no button', async () => {
  const win = new JSDOM('<div class="dz-wrap"></div>', { url: 'http://localhost/' }).window;
  const doc = win.document;
  stubMedia(win);
  const early = createKindChrome({
    doc, wrap: doc.querySelector('.dz-wrap'), kind: 'video', post: () => true, openRailFrame: () => null, colorOf: () => null,
    loadTracks: async () => TRACKS, fileUrl: (name) => `/f/${name}`,
  });
  early.onFrameMessage({ t: 'ready', mode: 'run' });
  await flush();
  assert.equal(doc.querySelector('.dz-film-timeline'), null, 'no view yet, so no bar');
  early.update(kindChromeView({ kind: 'video', live: false, docMode: 'run', sections: DONE_SCENES, stageW: 1096, stageH: 900 }));
  assert.equal(doc.querySelector('.dz-transport .dz-mute')?.title, 'Mute');
  early.destroy();
  const deck = film({ kind: 'pitch' });
  deck.chrome.setDocMode('run');
  await flush();
  assert.deepEqual([deck.loads, deck.made], [[], []]);
  const plain = rig({ kind: 'video', sections: DONE_SCENES });
  plain.chrome.setDocMode('run');
  await flush();
  assert.equal(plain.wrap.querySelector('.dz-mute'), null);
  assert.doesNotThrow(() => plain.chrome.silence());
});
