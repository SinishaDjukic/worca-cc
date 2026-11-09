// The board geometry of a deck or a video stage (ui/public/design/kind-view.mjs): pure numbers from the mockup's
// `_layoutView` and `_tileGeom` (canvas/src/engine.js), the kinds the server builds as boards, and the labels a tile
// grid needs. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_CANVAS, isDeckKind, isBoardKind, unitNoun, boardLayout, stageRegions, boardPost, kindChromeView, cursorLabel,
  guideSpan, tagSize,
} from '../ui/public/design/kind-view.mjs';
import { isBoardKind as serverIsBoardKind, isDeckKind as serverIsDeckKind } from '../src/core/design/kinds.mjs';

const close = (a, b, d = 0.01) => assert.ok(Math.abs(a - b) <= d, `${a} vs ${b}`);
const C = { w: 1920, h: 1080 };
const KINDS = ['web', 'presentation', 'pitch', 'video', 'constructor', undefined];

test('the kinds and nouns match the server', () => {
  assert.deepEqual(['web', 'presentation', 'pitch', 'video'].map(isBoardKind), ['web', 'presentation', 'pitch', 'video'].map(serverIsBoardKind));
  assert.deepEqual(KINDS.map(isBoardKind), KINDS.map(serverIsBoardKind));
  assert.deepEqual(KINDS.map(isDeckKind), KINDS.map(serverIsDeckKind));
  assert.deepEqual(BOARD_CANVAS, C);
  assert.deepEqual([unitNoun('web', 2), unitNoun('web', 1), unitNoun('pitch', 12), unitNoun('presentation', 1), unitNoun('video', 8), unitNoun('video', 1)], ['sections', 'section', 'slides', 'slide', 'scenes', 'scene']);
});
test('boardLayout takes the cols that give the biggest tile, as the mockup does', () => {
  const d = boardLayout({ n: 12, cw: 1096, availH: 808, canvas: C });
  assert.deepEqual([d.cols, d.rows, d.s, d.fits, d.gap, d.pad], [3, 4, 0.178703, true, 12, 16]);
  close(d.tileW, 343.1); close(d.tileH, 193);
  const f = boardLayout({ n: 8, cw: 1096, availH: 686, canvas: C });
  assert.deepEqual([f.cols, f.rows, f.s, f.fits], [3, 3, 0.180555, true]);
  const many = boardLayout({ n: 40, cw: 1096, availH: 808, canvas: C });
  assert.deepEqual([many.cols, many.rows, many.s, many.fits], [5, 8, 0.105833, false], 'never below 200 px wide: the board scrolls');
  const phone = boardLayout({ n: 12, cw: 400, availH: 608, canvas: C });
  assert.deepEqual([phone.cols, phone.rows, phone.s, phone.fits], [1, 12, 0.191666, false]);
  assert.equal(boardLayout({ n: 0, cw: 1096, availH: 808, canvas: C }), null);
  const short = boardLayout({ n: 3, cw: 1096, availH: 100, canvas: C });
  assert.deepEqual([short.cols, short.rows, short.s, short.fits], [3, 1, 0.180555, false], 'never more columns than tiles');
  assert.equal(boardLayout({ n: 6, cw: 2000, availH: 400, canvas: C }).cols, 3, 'of equal tiles, the first column count');
  const narrow = boardLayout({ n: 1, cw: 200, availH: 808, canvas: C });
  assert.deepEqual([narrow.cols, narrow.fits], [1, false], 'under 200 px the board counts as not fitting');
});
test('stageRegions: the mockup\'s numbers, per kind and doc', () => {
  const r = (kind, docMode, cw = 1096, ch = 900) => stageRegions({ kind, docMode, cw, ch });
  const db = r('pitch', 'build');
  assert.deepEqual([db.board, db.frame, db.availH, db.padB, db.rail, db.timeline, db.transport, db.hudRaised], [true, { x: 0, y: 0, w: 1096, h: 900 }, 808, 76, null, null, false, false]);
  const vb = r('video', 'build');
  assert.deepEqual([vb.board, vb.frame, vb.availH, vb.padB, vb.timeline, vb.rail, vb.transport, vb.hudRaised], [true, { x: 0, y: 0, w: 1096, h: 772 }, 686, 70, { x: 0, y: 772, w: 1096, h: 128 }, null, false, true]);
  const dr = r('pitch', 'run');
  assert.deepEqual([dr.board, dr.frame, dr.rail, dr.transport], [false, { x: 172, y: 158.875, w: 900, h: 506.25 }, { x: 0, y: 0, w: 148, h: 900 }, false]);
  const vr = r('video', 'run');
  assert.deepEqual([vr.board, vr.frame, vr.timeline, vr.transport, vr.hudRaised], [false, { x: 24, y: 53.25, w: 1048, h: 589.5 }, { x: 0, y: 772, w: 1096, h: 128 }, true, true]);
  const nr = r('pitch', 'run', 400, 700);
  assert.deepEqual([nr.rail, nr.frame], [null, { x: 24, y: 213, w: 352, h: 198 }]);
});
test('cursorLabel: only a video scene writing its script says so', () => {
  assert.equal(cursorLabel({ kind: 'video', job: 'Scene 3', part: 'js' }), 'Scene 3 · timeline');
  for (const o of [{ kind: 'video', job: 'Scene 3', part: 'html' }, { kind: 'pitch', job: 'Title', part: 'js' }, { kind: 'web', job: 'Hero', part: 'js' }]) assert.equal(cursorLabel(o), o.job);
});
test('on a tile, guides stop at the tile and a tag reads slide pixels', () => {
  assert.deepEqual(guideSpan([100, 30, 343, 193]), { h: [100, 443], v: [30, 223] });
  assert.equal(guideSpan(null), null);
  assert.deepEqual(tagSize([0, 0, 108.11, 37.17], 0.178703), [605, 208]);
});

// Beyond the plan's list: Step 3's rules for the edges of the regions and the board message.
test('beyond the plan: every arm returns every key, and a doc that is not the run doc is the build arm', () => {
  const KEYS = ['availH', 'board', 'frame', 'hudRaised', 'padB', 'rail', 'timeline', 'transport'];
  for (const kind of ['web', 'pitch', 'video']) {
    for (const docMode of ['build', 'run', null]) assert.deepEqual(Object.keys(stageRegions({ kind, docMode, cw: 1096, ch: 900 })).sort(), KEYS, `${kind} ${docMode}`);
  }
  assert.deepEqual(stageRegions({ kind: 'video', docMode: null, cw: 1096, ch: 900 }), stageRegions({ kind: 'video', docMode: 'build', cw: 1096, ch: 900 }));
  const web = stageRegions({ kind: 'web', docMode: 'run', cw: 1096, ch: 900 });
  assert.deepEqual([web.board, web.frame, web.rail, web.timeline, web.transport, web.hudRaised], [false, { x: 0, y: 0, w: 1096, h: 900 }, null, null, false, false]);
});
test('beyond the plan: boardPost is null off a board, in the run doc, with no sections and on an unmeasured stage', () => {
  const at = (o) => boardPost({ kind: 'pitch', docMode: 'build', n: 3, cw: 1096, ch: 900, ...o });
  assert.deepEqual(at({}), { cols: 2, s: 0.273958, gap: 12, pad: 16, padB: 76, r: 8, bg: '#101217' });
  assert.deepEqual(at({ docMode: null }), at({}));
  assert.deepEqual(at({ kind: 'video', n: 8 }), { cols: 3, s: 0.180555, gap: 12, pad: 16, padB: 70, r: 8, bg: '#101217' });
  for (const o of [{ kind: 'web' }, { docMode: 'run' }, { n: 0 }, { cw: 0 }, { ch: 0 }]) assert.equal(at(o), null, JSON.stringify(o));
  const sections = [{ id: 's1', job: 'Title', status: 'done', agentId: null }];
  const v = kindChromeView({ kind: 'pitch', live: true, docMode: 'build', sections, stageW: 1096, stageH: 900 });
  assert.deepEqual(v, {
    kind: 'pitch', live: true, docMode: 'build', sections,
    regions: stageRegions({ kind: 'pitch', docMode: 'build', cw: 1096, ch: 900 }),
    board: boardPost({ kind: 'pitch', docMode: 'build', n: 1, cw: 1096, ch: 900 }),
  });
});
