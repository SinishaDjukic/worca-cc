// P4's stage for decks and video (M9, L7.23, L7.27, L7.32): the model's board arm (a scale-1 layout in the kind's
// region, tile marks from real rects only, slide-pixel size tags, guides clipped to their tile, the ` · timeline`
// cursor label) through P4's own reducers on frames shaped as P2 and P3 send them, then the real stage through
// test/helpers/design-stage-rig.mjs, the overlay's tile marks, and the frame host's `time` reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  initialStage, selectLayout, selectMarks, selectCursors, selectBoard, selectKindChrome, selectStandby, KIND_NOUN, KIND_STAGE,
} from '../ui/public/design/stage-model.mjs';
import { createBuildNarration } from '../ui/public/design/narration.mjs';
import { BOARD_CANVAS, stageRegions, boardPost } from '../ui/public/design/kind-view.mjs';
import { createOverlay } from '../ui/public/design/overlay.mjs';
import { validFrameMessage } from '../ui/public/design/frame-host.mjs';
import { DID, BID, A1, build, plan, agent, section, applied, rects, run } from './helpers/design-stage-frames.mjs';
import { rig } from './helpers/design-stage-rig.mjs';
import { fakeClock } from './helpers/design-clock.mjs';

const sec = (id, job, status = 'planned', o = {}) => ({ id, job, status, agentId: null, summary: '', ...o });
const THREE = [sec('s1', 'Title', 'done'), sec('s2', 'Problem', 'writing'), sec('s3', 'Ask')];
const RECT = { s1: [21, 16, 343, 193], s2: [376, 16, 343, 193], s3: [731, 16, 343, 193] };
const SIZE = { user: { type: 'resize', stageW: 1096, stageH: 900 } };
const READY = (mode) => ({ t: 'ready', mode, vw: 1096, vh: 900, dpr: 1 });
const deck = (sections) => plan(sections, { canvas: { ...BOARD_CANVAS } });
const rectsOf = (ids) => rects(ids.map((id) => [id, ...RECT[id]]));
const S = (kind, steps, now = 0) => run(initialStage({ designId: DID, kind, canvas: BOARD_CANVAS }), steps, now).state;
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

test('selectLayout on a board is scale 1 in its region', () => {
  const KEYS = ['s', 'ox', 'oy', 'pageW', 'viewH', 'framed'];
  const pitch = S('pitch', [SIZE, build(), deck(THREE), READY('build')]);
  assert.deepEqual(pick(selectLayout(pitch), KEYS), { s: 1, ox: 0, oy: 0, pageW: 1096, viewH: 900, framed: false });
  const video = S('video', [SIZE, build(), deck(THREE), READY('build')]);
  assert.deepEqual([selectLayout(video).viewH, selectLayout(video).stageH], [772, 772], 'a parked cursor stays above the timeline');
  const runDoc = S('pitch', [SIZE, build('done'), deck(THREE), READY('run')]);
  assert.deepEqual(pick(selectLayout(runDoc), ['ox', 'oy', 'pageW', 'viewH', 'framed']), { ox: 172, oy: 158.875, pageW: 900, viewH: 506.25, framed: true });
  // A web state's layout, pinned at the checkpoint before the board arm.
  const web = run(initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 } }), [SIZE, READY('build')]).state;
  assert.deepEqual(selectLayout(web), {
    s: 0.7611111111111111, fit: 0.7611111111111111, ox: 0, oy: 0, viewH: 1182.4817518248176, frameW: 1096, frameH: 900,
    pageW: 1440, stageW: 1096, stageH: 900, narrow: false, zoomed: false, framed: false,
  });
});
test('tile marks come only from real rects', () => {
  let st = S('pitch', [SIZE, build(), deck(THREE), READY('build'), rectsOf(['s1', 's2'])]);
  assert.deepEqual(selectMarks(st).tiles.map((t) => t.label), ['1\u00a0\u00a0Title', '2\u00a0\u00a0Problem']);
  st = run(st, [rectsOf(['s1', 's2', 's3'])]).state;
  const tiles = selectMarks(st).tiles;
  assert.deepEqual([tiles.map((t) => t.planned), tiles.map((t) => t.done)], [[false, false, true], [true, false, false]]);
  assert.deepEqual(tiles.map((t) => [t.key, t.rect]), [['s1', RECT.s1], ['s2', RECT.s2], ['s3', RECT.s3]]);
  st = run(st, [section('s2', 'removed')]).state;
  assert.deepEqual(selectMarks(st).tiles.map((t) => t.label), ['1\u00a0\u00a0Title', '2\u00a0\u00a0Ask'], 'tiles count the non-removed sections, as the rail does');
});
test('no tiles over the run doc', () => {
  const stopped = S('pitch', [SIZE, build('stopped'), deck(THREE), READY('run'), rectsOf(['s1', 's2', 's3'])]);
  assert.equal(selectBoard(stopped), null);
  assert.deepEqual(selectMarks(stopped).tiles, []);
  // A restore while the round runs: P4's plain size tags, in page px.
  const live = S('pitch', [
    SIZE, build(), deck(THREE), READY('run'), rectsOf(['s1', 's2', 's3']),
    agent(A1, 'writing', { sectionId: 's2', job: 'Problem' }),
    applied('s2', { tail: { rect: [400, 40, 108.11, 37.17], tag: 'h1' } }),
  ]);
  assert.deepEqual([selectBoard(live), selectMarks(live).tiles, selectMarks(live).boxes.map((b) => b.tag)], [null, [], ['h1 108×37']]);
  assert.equal(selectMarks(S('web', [SIZE, build(), deck(THREE), READY('build'), rectsOf(['s1'])])).tiles, undefined, 'web has no tiles');
});
test('beyond the plan (p8t1 live proof): each swap keeps what is on screen until the next doc is ready', () => {
  // A change round is a new build, and P4 forgets the old round's doc (docMode null) while its run doc stays on screen
  // until the build doc's `ready`: laid out as a board, the slide jumped to the full well for 1 to 4 painted frames.
  const B2 = 'b_000000000002';
  const KEYS = ['ox', 'oy', 'pageW', 'viewH', 'framed'];
  const done = S('pitch', [SIZE, build('done'), deck(THREE), READY('run')]);
  const fitted = pick(selectLayout(done), KEYS);
  assert.deepEqual(fitted, { ox: 172, oy: 158.875, pageW: 900, viewH: 506.25, framed: true });
  let st = run(done, [build('planning', { buildId: B2, kind: 'change', round: 2 }), plan(THREE, { canvas: { ...BOARD_CANVAS }, buildId: B2 })]).state;
  assert.deepEqual([st.docMode, st.sectionOrder.length], [null, 3], 'P4 forgets the doc of the old round; the new plan is in');
  assert.deepEqual(pick(selectLayout(st), KEYS), fitted, 'the run doc stays fitted while it is on screen');
  assert.equal(selectBoard(st), null, 'and gets no board');
  st = run(st, [READY('build')]).state;
  assert.deepEqual(pick(selectLayout(st), KEYS), { ox: 0, oy: 0, pageW: 1096, viewH: 900, framed: false });
  // The round ends: the build doc's tiles stay until the run doc takes its place.
  st = run(st, [rectsOf(['s1', 's2', 's3']), build('done', { buildId: B2, kind: 'change', round: 2 })]).state;
  assert.deepEqual([st.status, st.docMode, selectMarks(st).tiles.map((t) => t.key)], ['done', 'build', ['s1', 's2', 's3']]);
  assert.deepEqual(selectMarks(st).boxes, [], 'a done round still draws no build marks');
  st = run(st, [READY('run')]).state;
  assert.deepEqual(selectMarks(st).tiles, []);
  // A first visit has shown nothing yet: the board, as before.
  assert.equal(pick(selectLayout(S('pitch', [SIZE, build(), deck(THREE)])), KEYS).framed, false);
});
test('no full-width slot lines on a board', () => {
  const steps = [SIZE, build('planning'), deck(THREE), READY('build'), rectsOf(['s1', 's2', 's3'])];
  assert.deepEqual(selectMarks(S('pitch', steps)).slotLines, []);
  assert.equal(selectMarks(S('web', steps)).slotLines.length, 3);
});
test('a size tag on a tile reads slide pixels', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => sec(`s${i + 1}`, `Slide ${i + 1}`, i === 0 ? 'writing' : 'planned'));
  const st = S('pitch', [
    SIZE, build(), deck(twelve), READY('build'), rects([['s1', 21, 16, 343.1, 193]]),
    agent(A1, 'writing', { sectionId: 's1', job: 'Slide 1' }),
    applied('s1', { tail: { rect: [0, 0, 108.11, 37.17], tag: 'h1' } }),
  ]);
  assert.equal(selectBoard(st).s, 0.178703);
  assert.equal(selectMarks(st).boxes[0].tag, 'h1 605×208', 'as m11-Deck.png shows');
  const wired = run(st, [applied('s1', { marks: [{ kind: 'media', rect: [0, 0, 178.703, 89.3515], tag: 'img' }] })]).state;
  assert.equal(selectMarks(wired).wires[0].tag, 'img 1000×500');
});
test('a guide on a tile carries its tile', () => {
  const steps = [
    SIZE, build(), deck(THREE), READY('build'), rectsOf(['s1', 's2', 's3']),
    agent(A1, 'writing', { sectionId: 's2', job: 'Problem' }),
    applied('s2', { marks: [{ kind: 'el', rect: [400, 40, 200, 50], tag: 'h1' }] }),
  ];
  const guides = selectMarks(S('pitch', steps, 1000), 1000).guides;
  assert.deepEqual(guides.map((g) => [g.kind, g.clip]), [['v', RECT.s2], ['h', RECT.s2]]);
  const web = selectMarks(S('web', steps, 1000), 1000).guides;
  assert.deepEqual([web.length, web.some((g) => 'clip' in g)], [2, false]);
});
test('beyond the plan (p8t1 mockup match): a box and a wireframe on a tile carry their tile, as engine.js clips them', () => {
  // engine.js:1640-1650 draws a tile's boxes, tags and wireframes inside its rounded clip: a whole-slide box's tag never
  // hangs over the next row. Whole-tile marks (failed, overflow, reading, the JS meter) keep their tags outside.
  const steps = [
    SIZE, build(), deck(THREE), READY('build'), rectsOf(['s1', 's2', 's3']),
    agent(A1, 'writing', { sectionId: 's2', job: 'Problem' }),
    applied('s2', { tail: { rect: [376, 16, 343, 193], tag: 'section' }, marks: [{ kind: 'media', rect: [400, 40, 100, 50], tag: 'img' }] }),
  ];
  const st = S('pitch', steps);
  const m = selectMarks(st);
  assert.deepEqual([m.boxes.map((b) => b.clip), m.wires.map((w) => w.clip)], [[RECT.s2], [RECT.s2]]);
  m.boxes[0].clip.push(1);
  assert.deepEqual([selectMarks(st).boxes[0].clip, selectMarks(st).tiles[1].rect], [RECT.s2, RECT.s2], 'a copy, never the rect itself');
  const web = selectMarks(S('web', steps));
  assert.deepEqual([web.boxes.length, web.wires.length, [...web.boxes, ...web.wires].some((x) => 'clip' in x)], [1, 1, false]);
});
test('a video scene writing its script says so', () => {
  const at = (kind, path) => selectCursors(S(kind, [
    SIZE, build(), deck([sec('a', 'Open', 'writing')]),
    agent(A1, 'writing', { sectionId: 'a', job: 'Open', tool: { name: 'Write', path } }),
  ]))[0].job;
  assert.equal(at('video', 'sections/a/script.js'), 'Open · timeline');
  assert.equal(at('video', 'sections/a/index.html'), 'Open');
  assert.equal(at('pitch', 'sections/a/script.js'), 'Open');
});

// Real stage, after test/ui-design-stage.test.mjs:235.
const ROW = { id: BID, designId: DID, round: 1, kind: 'first', status: 'building', brief: 'b', fast: false, reason: null, agentsTotal: 1, layers: 0, costUsd: 0, costKnown: true, startedAt: '2026-11-05T10:00:00Z', endedAt: null, createdBy: null };
const DECK = {
  design: { id: DID, kind: 'pitch', title: 'T', version: 0, threadId: null },
  plan: { canvas: { ...BOARD_CANVAS }, sections: [{ id: 's1', job: 'Title' }, { id: 's2', job: 'Problem' }, { id: 's3', job: 'Ask' }] },
  build: ROW, sections: [], versions: [],
};
const FILM = {
  ...DECK,
  design: { ...DECK.design, kind: 'video' },
  plan: { canvas: { ...BOARD_CANVAS, fps: 60 }, sections: DECK.plan.sections.map((s) => ({ ...s, duration: 4 })) },
};
const RECTS_MSG = { scrollX: 0, scrollY: 0, vw: 1096, vh: 900, docH: 900, sections: Object.entries(RECT).map(([id, rect]) => ({ id, rect })) };

test('a pitch board in the real stage', async () => {
  const { readyFrame, sent, fireMsg, paint, q, qa, tick } = await rig(DECK);
  readyFrame('build'); await tick();
  assert.equal(sent().filter((m) => m.t === 'board').length, 1);
  paint();
  assert.equal(q('.frame-box').style.transform, 'translate(0px, 0px) scale(1)');
  fireMsg('rects', RECTS_MSG); paint();
  assert.equal(qa('.dz-tile-chip').length, RECTS_MSG.sections.length);
  assert.deepEqual([...qa('.dz-tile-chip')].map((c) => c.textContent), ['1\u00a0\u00a0Title', '2\u00a0\u00a0Problem', '3\u00a0\u00a0Ask'], 'engine.js:1653 draws two spaces after the number (p8t1)');
});
test('a video stage raises the HUD and draws its timeline in the well', async () => {
  const { q } = await rig(FILM);
  assert.ok(q('.dz-wrap.is-film .dz-hud'));
  assert.ok(q('.dz-wrap > .dz-film-timeline'));
  const web = await rig({ ...DECK, design: { ...DECK.design, kind: 'web' } });
  assert.equal(web.q('.dz-wrap.is-film'), null);
});

// The deck rail (Task 10). The rail's thumbnail frame is the newest iframe, so the rig's `readyFrame` would take it:
// the run doc's frame says `ready` while it is the only one, and the thumbnail frame is patched and fired here by hand.
// The rig's `fireMsg` keeps taking the run doc's frame, the first in DOM order (`.frame-box` comes before the rail).
const DONE = { ...DECK, design: { ...DECK.design, version: 1 }, build: { ...ROW, status: 'done', endedAt: '2026-11-05T10:06:14Z' } };
const fireFrom = (win, f, t, fields = {}) => {
  const n = /#n=([^&#]*)$/.exec(f.getAttribute('src'))[1];
  win.dispatchEvent(Object.assign(new win.Event('message'), { source: f.contentWindow, origin: 'null', data: { ...fields, ns: 'worca-design', v: 1, n, t } }));
};
const listen = (f) => {
  const got = [];
  f.contentWindow.postMessage = (m) => { got.push(m); };
  return got;
};
test('a done pitch in the real stage opens one rail frame, and a rail click reaches the run doc', async () => {
  const { win, readyFrame, fireMsg, frames, sent, tick, q, qa } = await rig(DONE);
  assert.equal(frames().length, 1);
  readyFrame('run'); await tick();
  assert.equal(frames().length, 2, 'the run doc and one thumbnail frame');
  const thumbs = frames()[1];
  assert.equal(thumbs.parentElement, q('.dz-rail-frame-host'));
  const railSent = listen(thumbs);
  fireFrom(win, thumbs, 'ready', { mode: 'build', vw: 128, vh: 232, dpr: 1 });
  assert.deepEqual(railSent.map((m) => m.t), ['hello', 'board']);
  assert.deepEqual([railSent[0].mode, railSent[0].kind, railSent[0].canvas], ['build', 'pitch', { w: 1920, h: 1080 }]);
  assert.deepEqual([railSent[1].cols, railSent[1].s, railSent[1].bg], [1, Math.floor((72 / 1080) * 1e6) / 1e6, '#0B0D11']);
  assert.deepEqual([thumbs.getAttribute('tabindex'), thumbs.getAttribute('aria-hidden')], ['-1', 'true']);
  fireFrom(win, thumbs, 'rects', { ...RECTS_MSG });
  assert.deepEqual([...qa('.dz-rail-tile')].map((b) => b.disabled), [true, true, true], 'the thumbnail frame says nothing of the run doc');
  assert.equal(railSent.length, 2, 'only its ready gets a hello and a board');
  fireMsg('rects', { ...RECTS_MSG, sections: [{ id: 's1', rect: [0, 0, 900, 506] }, { id: 's3', rect: [0, 0, 900, 506] }] });
  const btns = [...qa('.dz-rail-tile')];
  assert.deepEqual(btns.map((b) => b.disabled), [false, true, false]);
  const before = sent().length;
  btns[2].click();
  assert.deepEqual(sent().slice(before).map((m) => [m.t, m.index]), [['goto', 1]]);
  assert.equal(railSent.some((m) => m.t === 'goto'), false, 'goto goes to the run doc only');
  fireMsg('visible', { id: 's3' });
  assert.equal(q('.dz-rail-tile[aria-current="true"]'), btns[2]);
});
// Review M9: the Point toggle stops a playing film first, in the real stage, so the pick lands on a still frame.
test('Point over a playing film pauses it before the run doc takes pick', async () => {
  const DONE_FILM = { ...FILM, design: { ...FILM.design, version: 1 }, build: { ...ROW, status: 'done', endedAt: '2026-11-05T10:06:14Z' } };
  const { stage, readyFrame, fireMsg, sent, tick, q } = await rig(DONE_FILM);
  readyFrame('run'); await tick();
  fireMsg('time', { at: 1, playing: true, dur: 12 });
  assert.equal(q('.dz-transport button').getAttribute('aria-label'), 'Pause', 'the film plays');
  const before = sent().length;
  stage.setPick(true);
  assert.deepEqual(sent().slice(before).map((m) => [m.t, m.on]), [['pause', undefined], ['pick', true]]);
});
test('destroy leaves no timer, listener or frame', async () => {
  const { stage, win, readyFrame, frames, clock, tick } = await rig(DONE);
  readyFrame('run'); await tick();
  const thumbs = frames()[1];
  assert.equal(frames().length, 2, 'the rail frame is open, its first ready still due');
  const railSent = listen(thumbs);
  stage.destroy();
  assert.deepEqual([clock.pending(), frames().length], [0, 0]);
  fireFrom(win, thumbs, 'ready', { mode: 'build', vw: 128, vh: 232, dpr: 1 });
  assert.deepEqual(railSent, [], 'the rail frame host stopped listening');
});

// Beyond the plan's list: Step 4's stage rules the rows above do not reach.
test('beyond the plan: a board\'s first hello has the board canvas before the plan lands; video adds 60 fps', async () => {
  const pitch = await rig({ ...DECK, plan: null });
  pitch.readyFrame('build'); await pitch.tick();
  assert.deepEqual(pitch.sent()[0], { ...pitch.sent()[0], t: 'hello', canvas: { w: 1920, h: 1080 } });
  const film = await rig({ ...FILM, plan: null });
  film.readyFrame('build'); await film.tick();
  assert.deepEqual(film.sent()[0].canvas, { w: 1920, h: 1080, fps: 60 });
  assert.equal(pitch.sent().filter((m) => m.t === 'board').length, 0, 'no sections, no board');
});
test('beyond the plan: a finished pitch sits fitted in the run doc, with no tiles', async () => {
  const done = { ...DECK, design: { ...DECK.design, version: 1 }, build: { ...ROW, status: 'done', endedAt: '2026-11-05T10:06:14Z' } };
  const { readyFrame, fireMsg, paint, q, qa, sent, tick } = await rig(done);
  readyFrame('run'); await tick();
  fireMsg('rects', RECTS_MSG); paint();
  const box = q('.frame-box');
  assert.deepEqual([box.style.transform, box.style.width, box.style.height, box.classList.contains('is-fitted')], ['translate(172px, 158.875px) scale(1)', '900px', '506.25px', true]);
  assert.deepEqual([qa('.dz-tile-chip').length, sent().filter((m) => m.t === 'board').length], [0, 0]);
});
test('beyond the plan: selectKindChrome is the view of the non-removed sections, live while the round is open', () => {
  const st = S('video', [SIZE, build('paused'), deck(THREE.map((s) => ({ ...s, duration: 4 }))), READY('build'), section('s2', 'removed')]);
  const v = selectKindChrome(st);
  assert.deepEqual(v.sections, [
    { id: 's1', job: 'Title', status: 'done', agentId: null, duration: 4 },
    { id: 's3', job: 'Ask', status: 'planned', agentId: null, duration: 4 },
  ]);
  assert.deepEqual([v.kind, v.live, v.docMode], ['video', true, 'build']);
  assert.deepEqual(v.regions, stageRegions({ kind: 'video', docMode: 'build', cw: 1096, ch: 900 }));
  assert.deepEqual(v.board, boardPost({ kind: 'video', docMode: 'build', n: 2, cw: 1096, ch: 900 }));
  assert.equal(selectKindChrome(run(st, [build('stopped')]).state).live, false);
  assert.deepEqual(['web', 'presentation', 'pitch', 'video', 'document'].map((k) => KIND_STAGE[k].board), [false, true, true, true, false]);
  assert.deepEqual(KIND_STAGE.document, KIND_STAGE.web, 'a document is staged as a web page');
  const unmeasured = S('pitch', [build(), deck(THREE)]);
  assert.equal(selectLayout(unmeasured).s > 0, false, 'an unmeasured board stage is not painted');
  assert.equal(selectBoard(unmeasured), null);
});

// The overlay's tile marks, after test/ui-design-overlay.test.mjs's own rig.
function overlay() {
  const clock = fakeClock();
  const win = new JSDOM('<!doctype html><html><body><div class="frame-box"></div></body></html>').window;
  Object.assign(win, { requestAnimationFrame: clock.raf, cancelAnimationFrame: clock.cancelRaf, setTimeout: clock.set, clearTimeout: clock.clear });
  const host = win.document.querySelector('.frame-box');
  const ov = createOverlay({ doc: win.document, win, host, reduced: () => true });
  return { ov, q: (s) => host.querySelector(s), qa: (s) => host.querySelectorAll(s) };
}
const LAYOUT = { s: 1, ox: 0, oy: 0, viewH: 900, pageW: 1096, frameW: 1096, frameH: 900, zoomed: false, narrow: false, stageW: 1096, stageH: 900 };
const NONE = { boxes: [], oranges: [], reds: [], wires: [], guides: [], plus: [], slotLines: [], failed: [], meters: [], pins: [] };
const TILES = [
  { key: 's1', rect: RECT.s1, label: '1 Title', planned: false, done: true },
  { key: 's3', rect: RECT.s3, label: '2 Ask', planned: true, done: false },
];
const paintOf = (marks, hidden = false) => ({ cursors: [], marks: { ...NONE, ...marks }, layout: LAYOUT, scroll: { x: 0, y: 0 }, hidden });

test('beyond the plan: tiles paint below P4\'s marks, keep through Hide cursors, and press nothing', () => {
  const { ov, q, qa } = overlay();
  const box = { key: A1, rect: [400, 40, 200, 50], tag: 'h1 1119×280' };
  ov.paint(paintOf({ tiles: TILES, boxes: [box], plus: [{ key: 's3', x: 747, y: 30 }], pins: [{ key: 'p', rect: [30, 30, 100, 20], tag: 'Title › h1' }] }));
  const edge = q('.dz-tile-edge[data-key="s1"]');
  assert.deepEqual([edge.className, edge.style.left, edge.style.top, edge.style.width, edge.style.height], ['dz-tile-edge', '21px', '16px', '343px', '193px']);
  assert.equal(q('.dz-tile-edge[data-key="s3"]').className, 'dz-tile-edge is-planned');
  const chip = q('.dz-tile-chip[data-key="s1"]');
  assert.deepEqual([chip.className, chip.style.left, chip.style.top, chip.textContent], ['dz-tile-chip is-done', '21px', '209px', '1 Title']);
  assert.deepEqual([q('.dz-tile-chip[data-key="s3"]').className, q('.dz-tile-chip[data-key="s3"]').textContent], ['dz-tile-chip', '2 Ask']);
  const order = [...q('.overlay-doc.is-marks').children].map((el) => el.className.split(' ')[0]);
  assert.deepEqual(order, ['dz-tile-edge', 'dz-tile-edge', 'dz-tile-chip', 'dz-tile-chip', 'dz-plus', 'dz-box', 'dz-box']);
  assert.equal(qa('button').length, 0);
  ov.paint(paintOf({ tiles: TILES, boxes: [box] }, true));
  assert.deepEqual([qa('.dz-tile-edge').length, qa('.dz-tile-chip').length, qa('.dz-box').length], [2, 2, 0], 'tiles label the board, not an agent');
  ov.paint(paintOf({ tiles: [{ key: 'x', label: 'no rect' }, TILES[0]] }));
  assert.deepEqual([qa('.dz-tile-edge').length, qa('.dz-tile-chip').length], [1, 1]);
  ov.paint(paintOf({}));
  assert.deepEqual([qa('.dz-tile-edge').length, qa('.dz-tile-chip').length], [0, 0]);
});
test('beyond the plan (p8t1 mockup match): a mark that carries its tile is clipped to it, rounded as the tile', () => {
  const { ov, q } = overlay();
  ov.paint(paintOf({ boxes: [{ key: A1, rect: [400, 40, 200, 50], tag: 'section 1920×1080', clip: RECT.s2 }], wires: [{ key: 'w', rect: [380, 20, 100, 50], tag: null, main: false, clip: RECT.s2 }] }));
  assert.equal(q('.dz-box').style.getPropertyValue('clip-path'), 'inset(-24px -119px -119px -24px round var(--r-md))');
  assert.equal(q('.dz-wire').style.getPropertyValue('clip-path'), 'inset(-4px -239px -139px -4px round var(--r-md))');
  ov.paint(paintOf({ boxes: [{ key: A1, rect: [400, 40, 200, 50], tag: 'h1 1119×280' }] }));
  assert.equal(q('.dz-box').style.getPropertyValue('clip-path'), '', 'a mark that loses its tile loses the clip');
});
test('beyond the plan: a clipped guide spans its tile; one without a clip keeps P4\'s full-page line', () => {
  const { ov, q } = overlay();
  const guides = [
    { key: 'v', kind: 'v', color: 'red', x: 400, y0: -200, y1: 550, ms: 1100, clip: RECT.s2 },
    { key: 'h', kind: 'h', color: 'blue', y: 40, ms: 900, tag: 'Problem', clip: RECT.s2 },
  ];
  ov.paint(paintOf({ guides }));
  const v = q('.dz-guide-v');
  const h = q('.dz-guide-h');
  assert.deepEqual([v.style.left, v.style.top, v.style.height], ['400px', '16px', '193px']);
  assert.deepEqual([h.style.top, h.style.left, h.style.width], ['40px', '376px', '343px']);
  ov.paint(paintOf({ guides: [{ ...guides[0], key: 'v2', y0: 300, y1: 400 }, { ...guides[1], key: 'h2', clip: undefined }] }));
  assert.deepEqual([q('.dz-guide-v').style.top, q('.dz-guide-v').style.height], ['300px', '0px'], 'a guide below its tile draws nothing');
  assert.deepEqual([q('.dz-guide-h').style.left, q('.dz-guide-h').style.width], ['', '']);
});

test('beyond the plan: the frame host reads `time {at, playing, dur}`, the film time capped at its length', () => {
  const env = (o) => validFrameMessage({ ns: 'worca-design', v: 1, n: 'N', t: 'time', ...o }, 'N');
  assert.deepEqual(env({ at: 3, playing: true, dur: 32 }), { t: 'time', at: 3, playing: true, dur: 32 });
  assert.deepEqual(env({ at: 40, playing: false, dur: 32, extra: 1 }), { t: 'time', at: 32, playing: false, dur: 32 });
  assert.deepEqual(env({ at: 0, playing: false, dur: 24000 }), { t: 'time', at: 0, playing: false, dur: 24000 });
  for (const bad of [{ at: -1, playing: true, dur: 32 }, { at: 1, playing: true, dur: 0 }, { at: 1, playing: true, dur: 24001 }, { at: 1, playing: 'yes', dur: 32 }, { at: Infinity, playing: true, dur: 32 }, { at: '1', playing: true, dur: 32 }, { playing: true, dur: 32 }]) {
    assert.equal(env(bad), null, JSON.stringify(bad));
  }
});

test('a document\'s nouns: its sections are sections, and the whole is a document', () => {
  assert.equal(KIND_NOUN.document, 'section');
  const st = run(initialStage({ designId: DID, kind: 'document', canvas: { w: 794 } }), [build('planning')]).state;
  assert.equal(selectStandby(st).title, 'Planning the document');
  const n = createBuildNarration({ designId: DID, kind: 'document' });
  n.push(build('building')); n.push(build('integrating'));
  assert.ok(n.view().lines.some((l) => l.text === 'Every section is in. Putting the document together.'), JSON.stringify(n.view().lines));
});
