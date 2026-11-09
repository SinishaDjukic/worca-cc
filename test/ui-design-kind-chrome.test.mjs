// The deck and video chrome (ui/public/design/kind-chrome.mjs) on its own, through test/helpers/design-kind-chrome.mjs:
// while a round builds it owns only the `board` message the build doc lays its tiles out by (M9, L7.23). P4's model
// draws the tiles; the rail and the film bar come in later tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
