// The finished deck's slide rail (ui/public/design/deck-rail.mjs, through kind-chrome.mjs and
// test/helpers/design-kind-chrome.mjs): the mockup's rail (`canvas/src/engine.js` `_railRect`, `_renderDeck`) as one
// sandboxed thumbnail frame of the build doc at one column, with the numbered buttons in the parent (L7.6). It appears
// only while the frame holds the run doc and nothing is live (M9, L7.22, L7.30), `goto` takes the run doc's own order
// (L7.8, Review Focus 1), and there is none below a 560 px stage (L7.24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railTiles, deckIndexOf } from '../ui/public/design/deck-rail.mjs';
import { rig, SLIDES } from './helpers/design-kind-chrome.mjs';

const close = (a, b, d = 0.01) => assert.ok(Math.abs(a - b) <= d, `${a} vs ${b}`);

const RUN = { t: 'rects', scrollX: 0, scrollY: 0, vw: 900, vh: 506, docH: 506, sections: [{ id: 's1', rect: [0, 0, 900, 506] }, { id: 's3', rect: [0, 0, 900, 506] }] };
const atRun = () => { const r = rig({ sections: SLIDES.map((s) => ({ ...s, status: s.id === 's2' ? 'stopped' : 'done' })) }); r.chrome.setDocMode('run'); r.chrome.onFrameMessage(RUN); return r; };
test('railTiles: the mockup\'s rail, with a floor', () => {
  const t = railTiles({ n: 12, ch: 900 });
  assert.equal(t.s, 0.060802); assert.equal(t.gap, 8); assert.equal(t.top, 12);
  close(t.tileW, 116.74); close(t.tileH, 65.67); close(t.x, 19.26);
  const many = railTiles({ n: 40, ch: 900 });
  assert.equal(many.s, 0.037037); close(many.tileH, 40); assert.equal(many.frameH, Math.ceil(40 * many.tileH + 39 * 8));
});
test('building: no rail and no goto', () => {
  const { doc, chrome, rails, of } = rig();
  assert.equal(doc.querySelector('.dz-rail'), null); assert.equal(rails.length, 0);
  chrome.onFrameMessage({ t: 'visible', id: 's1' });
  assert.deepEqual(of('goto'), []);
});
test('the run doc gets the rail: one thumbnail frame, one column, no pointer events; numbers and names in the parent', () => {
  const { doc, rails } = atRun();
  assert.equal(rails.length, 1);
  rails[0].onReady();
  const [t, b] = rails[0].posts[0];
  assert.deepEqual([t, b.cols, b.gap, b.pad, b.padB, b.r, b.bg], ['board', 1, 8, 0, 0, 4, '#0B0D11']);
  assert.ok(doc.querySelector('.dz-rail-frame-host'));
  const btns = [...doc.querySelectorAll('.dz-rail-tile')];
  assert.deepEqual(btns.map((x) => x.getAttribute('aria-label')), ['Slide 1: Title', 'Slide 2: Problem', 'Slide 3: Ask']);
  assert.deepEqual(btns.map((x) => x.querySelector('.dz-rail-num').textContent), ['1', '2', '3']);
});
test('goto uses the run doc\'s order, and a slide it does not hold is disabled', () => {
  const { doc, of } = atRun();
  const btns = doc.querySelectorAll('.dz-rail-tile');
  assert.equal(btns[1].disabled, true, 's2 was stopped: the deck does not hold it');
  btns[2].click();
  assert.deepEqual(of('goto'), [{ index: 1 }], 's3 is the second slide of the real deck');
  btns[1].click(); assert.equal(of('goto').length, 1);
});
test('visible marks the rail; a garbage id does nothing', () => {
  const { doc, chrome } = atRun();
  chrome.onFrameMessage({ t: 'visible', id: 's3' });
  assert.equal(doc.querySelector('.dz-rail-tile[aria-current="true"]').getAttribute('aria-label'), 'Slide 3: Ask');
  chrome.onFrameMessage({ t: 'visible', id: 'ghost' });
  assert.equal(doc.querySelector('.dz-rail-tile[aria-current="true"]').getAttribute('aria-label'), 'Slide 3: Ask');
});
test('arrow keys move between the slides the deck holds', () => {
  const { doc, chrome, of } = atRun();
  chrome.onFrameMessage({ t: 'visible', id: 's1' });
  const first = doc.querySelector('.dz-rail-tile');
  first.dispatchEvent(new first.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.deepEqual(of('goto'), [{ index: 1 }]);
});
// Review M7: the mark moves (one current tile), and the focus moves with an arrow key, so the next key goes on from there.
test('a new visible slide takes the mark from the last one', () => {
  const { doc, chrome } = atRun();
  chrome.onFrameMessage({ t: 'visible', id: 's1' });
  chrome.onFrameMessage({ t: 'visible', id: 's3' });
  assert.deepEqual([...doc.querySelectorAll('[aria-current]')].map((b) => b.getAttribute('aria-label')), ['Slide 3: Ask']);
});
test('an arrow key takes the focus along, so the next key goes on from the new slide', () => {
  const r = rig({ sections: SLIDES.map((s) => ({ ...s, status: 'done' })) });
  r.chrome.setDocMode('run');
  r.chrome.onFrameMessage({ ...RUN, sections: ['s1', 's2', 's3'].map((id) => ({ id, rect: [0, 0, 900, 506] })) });
  const btns = [...r.doc.querySelectorAll('.dz-rail-tile')];
  btns[0].focus();
  const down = () => r.doc.activeElement.dispatchEvent(new r.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  down(); down();
  assert.deepEqual(r.of('goto'), [{ index: 1 }, { index: 2 }]);
  assert.equal(r.doc.activeElement, btns[2]);
});
test('a failed slide has its red edge', () => {
  const r = rig({ sections: SLIDES.map((s) => ({ ...s, status: s.id === 's2' ? 'failed' : 'done' })) }); r.chrome.setDocMode('run'); r.chrome.onFrameMessage(RUN);
  assert.ok(r.doc.querySelectorAll('.dz-rail-tile')[1].classList.contains('is-failed'));
});
test('a live round takes the rail away at once; a new run doc opens a fresh thumbnail frame', () => {
  const { doc, chrome, rails, of } = atRun();
  chrome.onDesignFrame({ type: 'design-build', status: 'building' });
  assert.equal(doc.querySelector('.dz-rail'), null); assert.equal(rails[0].destroyed, true);
  chrome.onFrameMessage({ t: 'visible', id: 's3' }); assert.deepEqual(of('goto'), []);
  chrome.onDesignFrame({ type: 'design-build', status: 'done' });
  chrome.setDocMode('run');
  assert.equal(rails.length, 2);
});
test('a restore reloads the rail, since the slides may differ', () => {
  const { chrome, rails } = atRun();
  chrome.setDocMode('run');
  assert.equal(rails.length, 2); assert.equal(rails[0].destroyed, true);
});
test('a narrow stage has no rail: the slide fills it, and the stage\'s own tap zones and keys remain', () => {
  const r = rig({ cw: 400, ch: 700 }); r.chrome.setDocMode('run');
  assert.equal(r.doc.querySelector('.dz-rail'), null); assert.equal(r.rails.length, 0);
});

// Beyond the plan's list: Step 3's rules the rows above do not reach.
test('beyond the plan: the rail sits in the well at the mockup\'s numbers, one button over each thumbnail', () => {
  const { doc, wrap, rails } = atRun();
  const rail = doc.querySelector('.dz-rail');
  assert.equal(rail.parentElement, wrap);
  const g = railTiles({ n: 3, ch: 900 });
  assert.equal(g.s, Math.floor((72 / 1080) * 1e6) / 1e6, 'three slides keep the 72 px cap');
  assert.equal(doc.querySelector('.dz-rail-scroll').style.height, `${g.frameH + 24}px`);
  const host = doc.querySelector('.dz-rail-frame-host');
  assert.equal(rails[0].host, host);
  assert.deepEqual([host.style.left, host.style.top, host.style.width, host.style.height], [`${g.x}px`, '12px', `${g.tileW}px`, `${g.frameH}px`]);
  const btns = [...doc.querySelectorAll('.dz-rail-tile')];
  assert.deepEqual(btns.map((b) => b.style.top), [0, 1, 2].map((i) => `${12 + i * (g.tileH + 8)}px`));
  assert.deepEqual(btns.map((b) => [b.style.left, b.style.width, b.style.height, b.type]), btns.map(() => [`${g.x}px`, `${g.tileW}px`, `${g.tileH}px`, 'button']));
  assert.deepEqual([deckIndexOf('s3', ['s1', 's3']), deckIndexOf('s2', ['s1', 's3']), deckIndexOf('s1', null)], [1, -1, -1]);
});
test('beyond the plan: before the run doc reports its slides, nothing is pressable', () => {
  const r = rig({ sections: SLIDES.map((s) => ({ ...s, status: 'done' })) });
  r.chrome.setDocMode('run');
  const btns = [...r.doc.querySelectorAll('.dz-rail-tile')];
  assert.deepEqual(btns.map((b) => b.disabled), [true, true, true]);
  btns[0].click();
  assert.deepEqual(r.of('goto'), []);
  r.chrome.onFrameMessage({ ...RUN, sections: [{ id: 's1', rect: [0, 0, 900, 506] }, { id: 's2', rect: [0, 0, 900, 506] }, { id: 's3', rect: [0, 0, 900, 506] }] });
  assert.deepEqual(btns.map((b) => b.disabled), [false, false, false]);
  btns[2].click();
  assert.deepEqual(r.of('goto'), [{ index: 2 }]);
  r.chrome.onFrameMessage({ t: 'visible', id: 's3' });
  r.chrome.setDocMode('run');
  const again = [...r.doc.querySelectorAll('.dz-rail-tile')];
  assert.deepEqual([again.map((b) => b.disabled), r.doc.querySelector('[aria-current]')], [[true, true, true], null], 'a restored run doc reports its own slides');
});
test('beyond the plan: every frame the host makes is kept out of the tab order and the tree, and gets the board', () => {
  const { rails } = atRun();
  const r = rails[0];
  assert.deepEqual(r.posts, [], 'nothing goes down before the frame is ready');
  const one = r.host.ownerDocument.createElement('iframe');
  r.host.append(one);
  r.onReady();
  assert.deepEqual([one.getAttribute('tabindex'), one.getAttribute('aria-hidden')], ['-1', 'true']);
  one.remove();
  const two = r.host.ownerDocument.createElement('iframe');
  r.host.append(two);
  r.onReady();
  assert.deepEqual([two.getAttribute('tabindex'), two.getAttribute('aria-hidden')], ['-1', 'true'], 'a retry makes a new iframe');
  assert.deepEqual(r.posts.map(([t]) => t), ['board', 'board']);
});
test('beyond the plan: a taller stage scales the thumbnails, and the ready frame gets the new board', () => {
  const r = rig({ sections: Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, job: `Slide ${i + 1}`, status: 'done', agentId: null })) });
  r.chrome.setDocMode('run');
  r.rails[0].onReady();
  assert.equal(r.rails[0].posts[0][1].s, 0.060802);
  r.chrome.resize({ cw: 1096, ch: 900 });
  assert.equal(r.rails[0].posts.length, 1, 'the same size posts nothing');
  r.chrome.resize({ cw: 1096, ch: 1000 });
  assert.equal(r.rails[0].posts.length, 2);
  assert.deepEqual(r.rails[0].posts[1][1], { ...r.rails[0].posts[0][1], s: railTiles({ n: 12, ch: 1000 }).s });
  assert.equal(r.doc.querySelector('.dz-rail-frame-host').style.height, `${railTiles({ n: 12, ch: 1000 }).frameH}px`);
});
test('beyond the plan: a restore made while a round was paused opens the rail once the round stops, with what the run doc said', () => {
  const r = rig({ sections: SLIDES.map((s) => ({ ...s, status: 'done' })) });
  r.chrome.onDesignFrame({ type: 'design-build', status: 'paused' });
  r.chrome.setDocMode('run');
  r.chrome.onFrameMessage(RUN);
  r.chrome.onFrameMessage({ t: 'visible', id: 's3' });
  assert.deepEqual([r.rails.length, r.doc.querySelector('.dz-rail')], [0, null]);
  r.chrome.onDesignFrame({ type: 'design-build', status: 'stopped' });
  assert.equal(r.rails.length, 1);
  const btns = [...r.doc.querySelectorAll('.dz-rail-tile')];
  assert.deepEqual(btns.map((b) => b.disabled), [false, true, false]);
  assert.equal(r.doc.querySelector('.dz-rail-tile[aria-current="true"]'), btns[2]);
  r.chrome.onDesignFrame({ type: 'design-build', status: 'stopped' });
  assert.equal(r.rails.length, 1, 'an update opens no second rail');
});
test('beyond the plan: the buttons are rebuilt only when the slides change, and keep what the run doc said', () => {
  const { doc, chrome } = atRun();
  chrome.onFrameMessage({ t: 'visible', id: 's3' });
  const first = doc.querySelector('.dz-rail-tile');
  chrome.resize({ cw: 1096, ch: 900 });
  assert.equal(doc.querySelector('.dz-rail-tile'), first, 'an update with the same slides keeps the buttons');
  chrome.setPlan({ sections: SLIDES.map((s) => ({ ...s, job: s.id === 's3' ? 'The ask' : s.job, status: s.id === 's2' ? 'stopped' : 'done' })) });
  const btns = [...doc.querySelectorAll('.dz-rail-tile')];
  assert.notEqual(btns[0], first);
  assert.deepEqual(btns.map((b) => [b.getAttribute('aria-label'), b.disabled, b.getAttribute('aria-current')]), [
    ['Slide 1: Title', false, null], ['Slide 2: Problem', true, null], ['Slide 3: The ask', false, 'true'],
  ]);
});
test('beyond the plan: a stage narrowed below 560 px drops the rail, and widening brings it back', () => {
  const { doc, chrome, rails } = atRun();
  chrome.resize({ cw: 500, ch: 900 });
  assert.deepEqual([doc.querySelector('.dz-rail'), rails[0].destroyed], [null, true]);
  chrome.resize({ cw: 1096, ch: 900 });
  assert.equal(rails.length, 2);
  assert.deepEqual([...doc.querySelectorAll('.dz-rail-tile')].map((b) => b.disabled), [false, true, false], 'the run doc\'s order is kept');
});
test('beyond the plan: a build doc takes the rail\'s run doc away; destroy removes the rail and its frame', () => {
  const a = atRun();
  a.chrome.onDesignFrame({ type: 'design-build', status: 'stopped' });
  a.chrome.setDocMode('build');
  assert.deepEqual([a.doc.querySelector('.dz-rail'), a.rails[0].destroyed, a.rails.length], [null, true, 1]);
  a.chrome.onFrameMessage(RUN);
  assert.equal(a.rails.length, 1, 'rects from a build doc open nothing');
  const b = atRun();
  b.chrome.destroy();
  assert.deepEqual([b.doc.querySelector('.dz-rail'), b.rails[0].destroyed], [null, true]);
  b.chrome.setDocMode('run');
  assert.equal(b.rails.length, 1, 'a destroyed chrome opens nothing');
});
