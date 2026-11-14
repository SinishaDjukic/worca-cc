// A video's timeline and transport (M9, L5, L7.7, L7.18, L7.21, L7.22): the parent draws one block per scene from the
// plan's durations; only over the run doc with nothing live does it gain the transport, a playhead, pointer scrub and
// slider keys, all driven by the frame's `time` messages. Film time travels as `at` on the wire (Contract issue 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFilmBar, filmTimeline, fmtClock, seekFromX, sceneAt } from '../ui/public/design/film-transport.mjs';
import { rig } from './helpers/design-kind-chrome.mjs';
import { readFileSync } from 'node:fs';
import { cssRules } from './helpers/css-rules.mjs';

const SCENES = [{ id: 'a', job: 'Open', status: 'done', agentId: 'a_1', duration: 6 }, { id: 'b', job: 'Nine minutes', status: 'writing', agentId: 'a_2', duration: 10 }, { id: 'c', job: 'End card', status: 'planned', agentId: null, duration: 4 }];
test('filmTimeline: blocks from plan durations', () => {
  const m = filmTimeline(SCENES);
  assert.equal(m.dur, 20);
  assert.deepEqual(m.blocks.map((b) => [b.id, b.start, b.end, b.left, b.width]), [['a', 0, 6, 30 * 0, 30], ['b', 6, 16, 30, 50], ['c', 16, 20, 80, 20]]);
});
test('ticks: the mockup\'s 4 s and 8 s at 52 s; bounded at the longest film', () => {
  const at = (duration) => filmTimeline([{ id: 'a', job: 'A', status: 'done', duration }]).ticks;
  const t52 = at(52);
  assert.deepEqual(t52.slice(0, 3).map((x) => [x.t, x.label]), [[0, '0:00'], [4, null], [8, '0:08']]);
  assert.ok(at(20).every((x) => x.t % 2 === 0));
  assert.ok(at(24000).length <= 16, 'at most 40 scenes × 600 s');
  assert.equal(fmtClock(605), '10:05'); assert.equal(fmtClock(52.9), '0:52');
});
test('seekFromX: the mockup\'s 16 px margins, clamped', () => {
  assert.equal(seekFromX({ x: 548, width: 1096, dur: 20 }), 10);
  assert.equal(seekFromX({ x: 0, width: 1096, dur: 20 }), 0);
  assert.equal(seekFromX({ x: 5000, width: 1096, dur: 20 }), 20);
});
test('building: the timeline shows every scene; no transport, no playhead, no scrub', () => {
  const { doc, chrome, of } = rig({ kind: 'video', sections: SCENES });
  assert.ok(doc.querySelector('.dz-film-timeline'));
  const tl = doc.querySelector('.dz-film-timeline');
  assert.deepEqual([...doc.querySelectorAll('.dz-tl-block')].map((b) => [b.querySelector('.dz-tl-name').textContent, b.style.left, b.style.width]), [['Open', '0%', 'calc(30% - 3px)'], ['Nine minutes', '30%', 'calc(50% - 3px)'], ['End card', '80%', 'calc(20% - 3px)']]);
  assert.ok(doc.querySelectorAll('.dz-tl-block')[2].classList.contains('is-planned'));
  assert.ok(doc.querySelectorAll('.dz-tl-block')[1].classList.contains('is-writing'));
  assert.equal(doc.querySelectorAll('.dz-tl-block')[1].style.getPropertyValue('--dz-crew'), '#86C4E3');
  assert.equal(doc.querySelector('.dz-transport'), null);
  assert.equal(doc.querySelector('.dz-tl-head'), null);
  assert.equal(tl.getAttribute('role'), null); assert.equal(tl.getAttribute('tabindex'), null);
  tl.dispatchEvent(new doc.defaultView.MouseEvent('pointerdown', { clientX: 548, bubbles: true }));
  chrome.onFrameMessage({ t: 'time', at: 0, playing: false, dur: 20 });
  for (const t of ['seek', 'play', 'pause']) assert.deepEqual(of(t), [], t);
});
function atRun() {
  const r = rig({ kind: 'video', sections: SCENES.map((s) => ({ ...s, status: 'done' })) });
  r.chrome.setDocMode('run');
  const tl = r.doc.querySelector('.dz-film-timeline');
  tl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1096, height: 128 });
  const time = (at, playing = false) => r.chrome.onFrameMessage({ ns: 'worca-design', t: 'time', at, playing, dur: 20 });
  return { ...r, tl, time };
}
test('finished: frame, transport, playhead; the label follows the scene', () => {
  const { doc, chrome } = atRun();
  chrome.onFrameMessage({ t: 'visible', id: 'b' });
  chrome.onFrameMessage({ t: 'time', playing: false, dur: 20, at: 7 });
  assert.equal(doc.querySelector('.dz-transport b').textContent, 'Nine minutes');
  assert.ok(doc.querySelectorAll('.dz-tl-block')[1].classList.contains('is-selected'));
  assert.equal(doc.querySelector('.dz-tl-lane > .dz-tl-head').style.left, '35%');
  assert.equal(doc.querySelector('.dz-transport .dz-meta').textContent, '0:07 / 0:20');
});
test('play and pause go to the frame; the button follows what the frame says', () => {
  const { doc, of, chrome } = atRun();
  const btn = doc.querySelector('.dz-transport button');
  assert.equal(btn.getAttribute('aria-label'), 'Play');
  btn.click(); assert.equal(of('play').length, 1);
  chrome.onFrameMessage({ t: 'time', ...{ playing: true, dur: 20 }, at: 1 });
  assert.equal(doc.querySelector('.dz-transport button').getAttribute('aria-label'), 'Pause');
  doc.querySelector('.dz-transport button').click(); assert.equal(of('pause').length, 1);
});
test('scrub: a press seeks and pauses while held, and resumes if it was playing', () => {
  const { tl, of, chrome, doc } = atRun();
  chrome.onFrameMessage({ t: 'time', playing: true, dur: 20, at: 1 });
  const W = doc.defaultView;
  tl.dispatchEvent(new W.MouseEvent('pointerdown', { clientX: 548, bubbles: true }));
  assert.equal(of('pause').length, 1); assert.deepEqual(of('seek').at(-1), { at: 10 });
  tl.dispatchEvent(new W.MouseEvent('pointermove', { clientX: 16, bubbles: true }));
  assert.deepEqual(of('seek').at(-1), { at: 0 });
  tl.dispatchEvent(new W.MouseEvent('pointerup', { clientX: 16, bubbles: true }));
  assert.equal(of('play').length, 1);
});
test('keys on the timeline: arrows, shift for a frame, Home, End, Space', () => {
  const { tl, of, doc, chrome } = atRun();
  assert.equal(tl.getAttribute('role'), 'slider'); assert.equal(tl.getAttribute('tabindex'), '0');
  chrome.onFrameMessage({ t: 'time', playing: false, dur: 20, at: 5 });
  const key = (o) => tl.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { bubbles: true, ...o }));
  key({ key: 'ArrowRight' }); assert.deepEqual(of('seek').at(-1), { at: 6 });
  key({ key: 'ArrowLeft', shiftKey: true }); assert.ok(Math.abs(of('seek').at(-1).at - (5 - 1 / 60)) < 1e-6);
  key({ key: 'Home' }); assert.deepEqual(of('seek').at(-1), { at: 0 });
  key({ key: 'End' }); assert.deepEqual(of('seek').at(-1), { at: 20 });
  key({ key: ' ' }); assert.equal(of('play').length, 1);
});
test('a live round takes transport and scrub away at once, even mid-play', () => {
  const { doc, chrome, tl, of } = atRun();
  chrome.onFrameMessage({ t: 'time', playing: true, dur: 20, at: 3 });
  chrome.onDesignFrame({ type: 'design-build', status: 'planning' });
  assert.equal(of('pause').length, 1, 'the old frame stops playing');
  assert.equal(doc.querySelector('.dz-transport'), null);
  assert.equal(doc.querySelector('.dz-tl-head'), null);
  assert.equal(tl.getAttribute('role'), null);
  tl.dispatchEvent(new doc.defaultView.MouseEvent('pointerdown', { clientX: 548, bubbles: true }));
  assert.deepEqual(of('seek'), []);
  chrome.onFrameMessage({ t: 'time', playing: true, dur: 20, at: 4 });
  assert.equal(doc.querySelector('.dz-transport'), null);
});
// Review M8 (Review Focus 3, mid-drag): a press held when a round turns live is let go, so the next run doc's
// pointer moves seek nothing until a new press.
test('a press held when a round turns live is let go; the next run doc seeks only on a new press', () => {
  const { tl, of, doc, chrome, time } = atRun();
  const W = doc.defaultView;
  time(4, true);
  tl.dispatchEvent(new W.MouseEvent('pointerdown', { clientX: 548, bubbles: true }));
  assert.deepEqual([of('seek'), of('pause').length], [[{ at: 10 }], 1]);
  chrome.onDesignFrame({ type: 'design-build', status: 'building' });
  chrome.setDocMode('build');
  tl.dispatchEvent(new W.MouseEvent('pointerup', { clientX: 548, bubbles: true }));
  chrome.onDesignFrame({ type: 'design-build', status: 'done' });
  chrome.setDocMode('run');
  tl.dispatchEvent(new W.MouseEvent('pointermove', { clientX: 16, bubbles: true }));
  tl.dispatchEvent(new W.MouseEvent('pointerup', { clientX: 16, bubbles: true }));
  assert.deepEqual([of('seek'), of('play').length], [[{ at: 10 }], 0], 'no button is down: a move seeks nothing');
});
// Review m4: the run doc's pause during a live round is dropped, so a Stop before any ready must not bring back Pause.
test('a live round forgets the film played: a Stop before the build doc is ready shows Play', () => {
  const { doc, chrome, time, of } = atRun();
  time(3, true);
  assert.equal(doc.querySelector('.dz-transport button').getAttribute('aria-label'), 'Pause');
  chrome.onDesignFrame({ type: 'design-build', status: 'building' });
  time(3, false);
  chrome.onDesignFrame({ type: 'design-build', status: 'stopped' });
  const btn = doc.querySelector('.dz-transport button');
  assert.equal(btn.getAttribute('aria-label'), 'Play');
  btn.click(); assert.deepEqual([of('play').length, of('pause').length], [1, 1], 'one click plays');
});
// SPEC U5: one icon button after the play button, `Mute` / `Unmute`, only when the film has sound. The bar keeps the
// state, since build mode throws the transport away and run mode makes it again.
test('the sound button: only with sound, after play, and kept across a build', () => {
  const doc = new JSDOM('<div class="dz-wrap"></div>').window.document;
  const mutes = [];
  const bar = createFilmBar({ doc, host: doc.querySelector('.dz-wrap'), onSeek() {}, onPlay() {}, onPause() {}, onMute: (m) => { mutes.push(m); } });
  bar.setSections(SCENES.map((s) => ({ ...s, status: 'done' })));
  bar.setMode('run');
  const mute = () => doc.querySelector('.dz-transport .dz-mute');
  const label = () => [mute().title, mute().getAttribute('aria-label'), mute().getAttribute('aria-pressed')];
  assert.equal(mute(), null, 'no sound, no button');
  bar.setSound({ on: true, muted: false });
  assert.deepEqual([...doc.querySelectorAll('.dz-transport > *')].map((el) => el.tagName.toLowerCase() + (el.classList.contains('dz-mute') ? '.dz-mute' : '')), ['button', 'button.dz-mute', 'b', 'span']);
  assert.equal(doc.querySelector('.dz-transport button').getAttribute('aria-label'), 'Play', 'play stays the first button');
  assert.deepEqual([mute().className, mute().type], ['btn btn-sm btn-quiet btn-icon dz-mute', 'button']);
  assert.deepEqual(label(), ['Mute', 'Mute', null]);
  const before = mute().innerHTML;
  mute().click();
  assert.deepEqual(mutes, [true]);
  assert.equal(mute().title, 'Mute', 'the bar shows what it is told');
  bar.setSound({ on: true, muted: true });
  assert.deepEqual(label(), ['Unmute', 'Unmute', null]);
  assert.notEqual(mute().innerHTML, before, 'its own icon');
  mute().click();
  assert.deepEqual(mutes, [true, false]);
  bar.setMode('build');
  assert.equal(doc.querySelector('.dz-mute'), null);
  bar.setMode('run');
  assert.deepEqual(label(), ['Unmute', 'Unmute', null], 'run mode makes it again, as it was');
  mute().click();
  assert.deepEqual(mutes, [true, false, false]);
  bar.setSound({ on: false, muted: true });
  assert.equal(doc.querySelector('.dz-mute'), null);
  bar.setMode('build');
  bar.setSound({ on: true, muted: false });
  assert.equal(doc.querySelector('.dz-mute'), null, 'no transport in build mode');
  bar.setMode('run');
  assert.deepEqual(label(), ['Mute', 'Mute', null]);
  bar.destroy();
  assert.equal(doc.querySelector('.dz-mute'), null);
});
test('a failed or missing scene keeps its block; a new plan redraws', () => {
  const r = atRun();
  r.chrome.setPlan({ sections: SCENES.map((s) => ({ ...s, status: s.id === 'b' ? 'failed' : 'done' })), canvas: { w: 1920, h: 1080, fps: 60 } });
  assert.ok(r.doc.querySelectorAll('.dz-tl-block')[1].classList.contains('is-failed'));
  r.chrome.setPlan({ sections: [...SCENES, { id: 'd', job: 'New', status: 'planned', duration: 5 }], canvas: { w: 1920, h: 1080, fps: 60 } });
  assert.equal(r.doc.querySelectorAll('.dz-tl-block').length, 4);
});

// Beyond the plan: the edges the rows above leave open.
test('beyond the plan: no length is no NaN; sceneAt and fmtClock at their edges', () => {
  const z = filmTimeline([{ id: 'a', job: 'A', status: 'done', duration: 0 }, { id: 'b', job: 'B', status: 'done', duration: null }]);
  assert.deepEqual([z.dur, z.ticks, z.blocks.map((b) => [b.left, b.width])], [0, [], [[0, 0], [0, 0]]]);
  assert.deepEqual(filmTimeline([{ id: 'a', job: 'A', status: 'done', duration: 11 }, { id: 'b', job: 'B', status: 'done', duration: 9 }]).blocks.map((b) => b.width), [55, 45]);
  const { blocks } = filmTimeline(SCENES);
  assert.deepEqual([0, 5.99, 6, 19.99, 20, 99].map((t) => sceneAt(blocks, t).id), ['a', 'a', 'b', 'c', 'c', 'c']);
  assert.equal(sceneAt([], 1), null);
  assert.deepEqual([fmtClock(-3), fmtClock(NaN), fmtClock(59.99), fmtClock(60)], ['0:00', '0:00', '0:59', '1:00']);
  assert.equal(seekFromX({ x: 20, width: 32, dur: 20 }), 0, 'a bar with no lane seeks nothing');
  const steps = (duration) => filmTimeline([{ id: 'a', job: 'A', status: 'done', duration }]).ticks.map((x) => x.t);
  assert.deepEqual([steps(32).length, steps(32)[1], steps(31)[1]], [9, 4, 2], 'a film of 16 steps takes the next step');
});
test('beyond the plan: a finished film draws no crew and no build marks', () => {
  const r = rig({ kind: 'video', sections: SCENES });
  const block = (i) => r.doc.querySelectorAll('.dz-tl-block')[i];
  assert.equal(block(0).style.getPropertyValue('--dz-crew'), '#86C4E3');
  assert.equal(block(2).style.getPropertyValue('--dz-crew'), '', 'a scene with no agent has no crew');
  assert.ok(block(2).querySelector('.dz-tl-plus'));
  assert.equal(block(1).querySelector('.dz-tl-plus'), null);
  r.chrome.setDocMode('run');
  assert.deepEqual([0, 1, 2].map((i) => block(i).style.getPropertyValue('--dz-crew')), ['', '', '']);
  assert.deepEqual([0, 1, 2].map((i) => [...block(i).classList].sort().join(' ')), ['dz-tl-block is-done is-selected', 'dz-tl-block', 'dz-tl-block']);
  assert.equal(r.doc.querySelector('.dz-tl-plus'), null);
  r.chrome.onDesignFrame({ type: 'design-build', status: 'building' });
  assert.equal(r.doc.querySelector('.dz-tl-block.is-selected'), null);
  assert.equal(block(1).style.getPropertyValue('--dz-crew'), '#86C4E3', 'a change round tints again');
  assert.ok(block(1).classList.contains('is-writing'));
  assert.ok(block(2).querySelector('.dz-tl-plus'));
});
test('beyond the plan: time rebuilds nothing; the icon changes only when playing does', () => {
  const { doc, chrome, time } = atRun();
  const btn = doc.querySelector('.dz-transport button');
  const blocks = [...doc.querySelectorAll('.dz-tl-block')];
  time(1, true);
  const ic = btn.firstElementChild;
  for (let at = 1.1; at < 3; at += 0.1) time(at, true);
  chrome.onFrameMessage({ t: 'visible', id: 'a' });
  chrome.setPlan({ sections: SCENES.map((s) => ({ ...s, status: 'done' })) });
  assert.equal(doc.querySelector('.dz-transport button'), btn);
  assert.equal(btn.firstElementChild, ic);
  assert.ok([...doc.querySelectorAll('.dz-tl-block')].every((el, i) => el === blocks[i]), 'the same blocks');
  assert.equal(doc.querySelectorAll('.dz-transport').length, 1);
  assert.equal(doc.querySelectorAll('.dz-film-timeline').length, 1);
  time(3, false);
  assert.notEqual(btn.firstElementChild, ic);
  assert.equal(btn.getAttribute('title'), 'Play');
});
test('beyond the plan: the slider reads the film; time is clamped to it', () => {
  const { tl, doc, time } = atRun();
  assert.deepEqual(['aria-label', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'].map((a) => tl.getAttribute(a)), ['Film position', '0', '20', '0', '0:00 of 0:20']);
  time(7.256);
  assert.deepEqual([tl.getAttribute('aria-valuenow'), tl.getAttribute('aria-valuetext')], ['7.26', '0:07 of 0:20']);
  time(25);
  assert.deepEqual([doc.querySelector('.dz-tl-head').style.left, doc.querySelector('.dz-transport .dz-meta').textContent], ['100%', '0:20 / 0:20']);
  assert.equal(doc.querySelector('.dz-transport b').textContent, 'End card', 'with no visible yet, the scene under the playhead');
});
test('beyond the plan: the scene the frame names wins over the plan\'s windows', () => {
  const { doc, chrome, time } = atRun();
  chrome.onFrameMessage({ t: 'visible', id: 'c' });
  time(3);
  assert.equal(doc.querySelector('.dz-transport b').textContent, 'End card');
  assert.deepEqual([...doc.querySelectorAll('.dz-tl-block.is-selected')].map((b) => b.dataset.id), ['c']);
});
test('beyond the plan: a new run doc starts the bar at 0, paused', () => {
  const { doc, chrome, time, of } = atRun();
  chrome.onFrameMessage({ t: 'visible', id: 'c' });
  chrome.onFrameMessage({ t: 'time', at: 17, playing: true, dur: 30 });
  assert.equal(doc.querySelector('.dz-transport .dz-meta').textContent, '0:17 / 0:30');
  chrome.onDesignFrame({ type: 'design-build', status: 'building' });
  chrome.onDesignFrame({ type: 'design-build', status: 'done' });
  chrome.setDocMode('run');
  assert.deepEqual([doc.querySelector('.dz-transport .dz-meta').textContent, doc.querySelector('.dz-transport b').textContent], ['0:00 / 0:20', 'Open']);
  doc.querySelector('.dz-transport button').click();
  assert.equal(of('play').length, 1, 'Play, not a second pause');
  assert.equal(of('pause').length, 1);
});
test('beyond the plan: picking stops a playing film, only over the run doc', () => {
  const b = rig({ kind: 'video', sections: SCENES });
  b.chrome.pause();
  assert.deepEqual(b.of('pause'), []);
  const r = atRun();
  r.chrome.pause();
  assert.deepEqual(r.of('pause'), [{}]);
});
test('beyond the plan: a cancelled press resumes too; keys with a modifier stay the browser\'s', () => {
  const { tl, of, doc, time } = atRun();
  const W = doc.defaultView;
  time(4);
  tl.dispatchEvent(new W.MouseEvent('pointerdown', { clientX: 548, bubbles: true }));
  tl.dispatchEvent(new W.MouseEvent('pointerup', { clientX: 548, bubbles: true }));
  assert.deepEqual([of('pause').length, of('play').length, of('seek').length], [0, 0, 1], 'a paused film stays paused');
  time(4, true);
  tl.dispatchEvent(new W.MouseEvent('pointerdown', { clientX: 548, bubbles: true }));
  tl.dispatchEvent(new W.MouseEvent('pointercancel', { bubbles: true }));
  assert.equal(of('play').length, 1);
  tl.dispatchEvent(new W.MouseEvent('pointermove', { clientX: 16, bubbles: true }));
  tl.dispatchEvent(new W.MouseEvent('pointerup', { clientX: 16, bubbles: true }));
  assert.deepEqual([of('seek').length, of('play').length], [2, 1], 'nothing held: a move seeks nothing, a release plays nothing');
  for (const mod of ['altKey', 'ctrlKey', 'metaKey']) {
    const e = new W.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true, [mod]: true });
    tl.dispatchEvent(e);
    assert.equal(e.defaultPrevented, false, mod);
  }
  const e = new W.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
  tl.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual([of('seek').length, of('seek').at(-1)], [3, { at: 3 }]);
  time(20);
  tl.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  time(0);
  tl.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
  assert.deepEqual(of('seek').slice(-2), [{ at: 20 }, { at: 0 }], 'keys stop at the ends');
});
test('beyond the plan: destroy takes the bar, the transport and the inputs; a deck has no bar', () => {
  const { doc, chrome, tl, of } = atRun();
  chrome.destroy();
  assert.deepEqual([doc.querySelector('.dz-film-timeline'), doc.querySelector('.dz-transport')], [null, null]);
  tl.dispatchEvent(new doc.defaultView.MouseEvent('pointerdown', { clientX: 548, bubbles: true }));
  chrome.pause();
  assert.deepEqual([of('seek'), of('pause')], [[], []]);
  const deck = rig();
  deck.chrome.setDocMode('run');
  assert.equal(deck.doc.querySelector('.dz-film-timeline'), null);
});
test('beyond the plan, the mockup match (p8t1): the bar and its blocks draw their lines inside, so nothing in them shifts', () => {
  const rules = cssRules(readFileSync(new URL('../ui/public/design/design.css', import.meta.url), 'utf8'));
  const body = (sel) => rules.filter((r) => r.sel === sel).map((r) => r.body).join(';');
  // engine.js _renderTimeline paints the bar's top line and a block's 3 px crew bar inside the box, and its rings centred
  // on the edge: a border would push the ticks, lane, playhead and name chip down (chip at block + 6, not + 9).
  for (const sel of ['.dz-film-timeline', '.dz-tl-block', '.dz-tl-block.is-planned', '.dz-tl-block.is-writing', '.dz-tl-block.is-done']) {
    assert.doesNotMatch(body(sel), /(^|;)\s*border(-top)?\s*:/, sel);
  }
  assert.match(body('.dz-film-timeline'), /box-shadow:inset 0 1px 0 var\(--stage-edge\)/);
  assert.match(body('.dz-tl-block.is-writing'), /box-shadow:inset 0 3px 0 var\(--dz-crew,var\(--stage-mark\)\)/);
  assert.match(body('.dz-tl-block.is-done'), /box-shadow:inset 0 3px 0 var\(--dz-crew,transparent\)/);
  assert.match(body('.dz-tl-block.is-planned'), /outline:1px dashed [^;]+;outline-offset:-1px/);
  for (const sel of ['.dz-tl-block.is-failed', '.dz-tl-block.is-selected']) assert.match(body(sel), /outline:2px solid [^;]+;outline-offset:-1px/, sel);
  assert.match(body('.dz-tl-tick span'), /top:-12\.5px/, 'the label baseline 19 px under the bar top');
  assert.match(body('.frame-box.is-fitted'), /border-radius:var\(--r-md\)/, 'the fitted ring and the frame box round with the frame');
});
