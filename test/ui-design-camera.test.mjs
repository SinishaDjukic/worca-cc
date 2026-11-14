// test/ui-design-camera.test.mjs — the Design stage's camera (ui/public/design/stage-model.mjs, M11): it frames the
// crew, moves only when the crew changes, stops on a real scroll or a zoom, and parks the cursors it cannot show.
// Frames and bridge messages come from test/helpers/design-stage-frames.mjs, shaped as P2 and P3 send them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialStage, reduceUser, reduceBridge, frameCrew, fitWidth, selectLayout, cameraStep, placeCursors,
} from '../ui/public/design/stage-model.mjs';
import { DID, A1, A2, LEAD, build, plan, agent, section, rects, run } from './helpers/design-stage-frames.mjs';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const G = { stageW: 1096, stageH: 900, pageW: 1440, docH: 6000 };
const live = (...ids) => ids.map(([id, y, h]) => ({ id, rect: [0, y, 1440, h] }));

test('M11: a small crew sits at fit-width, a big one zooms out, and 0.45 is the floor', () => {
  const small = frameCrew({ ...G, sections: live(['a', 100, 300], ['b', 300, 400]) });
  near(small.scale, 1096 / 1440); near(small.y, 0);
  const mid = frameCrew({ ...G, sections: live(['a', 2000, 600], ['b', 2600, 600]) });
  near(mid.scale, 776 / 1200); near(mid.y, 2000 - 14 / mid.scale);
  const big = frameCrew({ ...G, sections: live(['a', 100, 1500], ['b', 1600, 1500]) });
  assert.equal(big.scale, 0.45); assert.equal(big.spanH, 3000);
});
test('M11: the formula: stageH above the HUD band, 14 px of padding each side; side-by-side sections share a span', () => {
  const r = frameCrew({ ...G, sections: [{ id: 'a', rect: [0, 500, 300, 776] }, { id: 'b', rect: [300, 500, 300, 776] }] });
  near(r.scale, Math.min(1096 / 1440, (900 - 96 - 28) / 776));
  assert.equal(r.spanH, 776);
});
test('fit wins over the floor: a very narrow stage never crops the page sideways', () => {
  assert.equal(frameCrew({ ...G, stageW: 500, sections: live(['a', 0, 3000]) }).scale, 500 / 1440);
});
test('zooming back in needs a clear gain, so the page does not pump; zooming out does not', () => {
  const at = (curS, span) => frameCrew({ ...G, curS, sections: live(['a', 2000, span]) }).scale;
  assert.equal(at(0.6, 776 / 0.62), 0.6);
  near(at(0.6, 776 / 0.7), 0.7);
  near(at(0.6, 776 / 0.5), 0.5);
  near(frameCrew({ ...G, curS: 0.6, force: true, sections: live(['a', 2000, 776 / 0.62]) }).scale, 0.62);
});
test('selectLayout: wide fits and fills; narrow keeps 40 px sides and 24 px top; the box is stageH / scale tall', () => {
  const at = (viewport, scale = null, canvas = { w: 1440 }) => { let s = initialStage({ designId: DID, kind: 'web', canvas });
    s = reduceUser(s, { type: 'resize', stageW: 1096, stageH: 900 }).state;
    if (viewport) s = reduceUser(s, { type: 'viewport', name: viewport }).state;
    if (scale) s = { ...s, camera: { ...s.camera, scale } };
    return selectLayout(s); };
  const wide = at(null); near(wide.s, 1096 / 1440); assert.equal(wide.pageW, 1440); near(wide.viewH, 900 / wide.s); assert.deepEqual([wide.ox, wide.oy, wide.narrow, wide.zoomed], [0, 0, false, false]);
  const phone = at('phone'); assert.deepEqual([phone.s, phone.ox, phone.oy, phone.viewH, phone.narrow, phone.framed], [1, 353, 24, 852, true, true]);
  const tablet = at('tablet'); assert.deepEqual([tablet.s, tablet.pageW], [1, 820]);
  const z = at(null, 0.5); assert.deepEqual([z.s, z.ox, z.viewH, z.zoomed, z.framed], [0.5, 188, 1800, true, true]);
  assert.equal(at(null, 0.99).s, 1096 / 1440, 'a scale above fit is capped');
});
const STAGED = (steps) => run(reduceUser(initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 } }), { type: 'resize', stageW: 1096, stageH: 900 }).state, steps).state;
const CREW = [build(), plan(['a', 'b', 'c']), rects([['a', 0, 2000, 1440, 600], ['b', 0, 2600, 1440, 600], ['c', 0, 3200, 1440, 600]], { docH: 6000 }), agent(A1, 'writing', { sectionId: 'a', job: 'A' })];
const step = (s, now = 1000) => cameraStep(s, now);
test('M11: moves only when the crew changes, at most 400 ms, instantly under reduced motion', () => {
  const a = step(STAGED(CREW));
  const mv = a.effects.find((e) => e.type === 'camera');
  assert.equal(mv.ms, 400); assert.ok(mv.scale > 0);
  assert.deepEqual(step(a.state, 2000).effects, [], 'same crew, nothing');
  const grown = run(a.state, [rects([['a', 0, 2000, 1440, 900], ['b', 0, 2900, 1440, 600], ['c', 0, 3500, 1440, 600]], { docH: 6000 })], 2000).state;
  assert.deepEqual(step(grown, 2100).effects, [], 'growth alone never moves it');
  const resized = reduceUser(a.state, { type: 'resize', stageW: 1096, stageH: 700 }, 2500).state;
  assert.equal(step(resized, 2500).effects.filter((e) => e.type === 'camera').length, 1, 'a new stage size reframes (engine.js:822)');
  const more = run(a.state, [agent(A2, 'writing', { sectionId: 'b', job: 'B' })], 3000).state;
  assert.equal(step(more, 3000).effects.filter((e) => e.type === 'camera').length, 1);
  const r = run(initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 }, reduced: true }), [{ user: { type: 'resize', stageW: 1096, stageH: 900 } }, ...CREW]).state;
  assert.equal(step(r).effects.find((e) => e.type === 'camera').ms, 0);
});
test('a waiting agent\'s section stays framed; a failed section is framed; a lead alone moves nothing', () => {
  const w = step(STAGED([...CREW, agent(A1, 'waiting', { sectionId: 'a', job: 'A' })]));
  assert.equal(w.effects.filter((e) => e.type === 'camera').length, 1);
  const f = step(STAGED([build(), plan(['a']), rects([['a', 0, 2000, 1440, 600]], { docH: 6000 }), section('a', 'failed')]));
  assert.equal(f.effects.filter((e) => e.type === 'camera').length, 1);
  assert.deepEqual(step(STAGED([build('planning'), agent(LEAD, 'writing', { role: 'lead', job: 'Lead', sectionId: null })])).effects, []);
  assert.deepEqual(step(STAGED([build('integrating'), plan(['a']), rects([['a', 0, 2000, 1440, 600]]), agent(LEAD, 'thinking', { role: 'lead', job: 'Lead', sectionId: null })])).effects, []);
});
test('M11: a first round done goes back to fit-width at the top, once', () => {
  const a = step(STAGED(CREW)).state;
  const done = step(run(a, [build('done')], 5000).state, 5000);
  const mv = done.effects.find((e) => e.type === 'camera');
  assert.deepEqual([mv.y, mv.ms], [0, 400]); near(mv.scale, 1096 / 1440);
  assert.deepEqual(step(done.state, 6000).effects, []);
});
const cameraMoves = (r) => r.effects.filter((e) => e.type === 'camera');
test('M11: a change round stays on the changed section when done', () => {
  const a = step(STAGED([build('building', { kind: 'change' }), ...CREW.slice(1)])).state;
  const cam = [a.camera.scale, a.camera.y];
  const done = step(run(a, [build('done', { kind: 'change' })], 5000).state, 5000);
  assert.deepEqual(cameraMoves(done), []);
  assert.deepEqual([done.state.camera.scale, done.state.camera.y], cam);
  assert.equal(selectLayout(done.state).s, cam[0]);
});
test('M11: a whole-round Stop stays at the current zoom', () => {
  const a = step(STAGED(CREW)).state;
  const cam = [a.camera.scale, a.camera.y];
  const stopped = step(run(a, [build('stopped')], 5000).state, 5000);
  assert.deepEqual(cameraMoves(stopped), []);
  assert.deepEqual([stopped.state.camera.scale, stopped.state.camera.y], cam);
  assert.equal(selectLayout(stopped.state).s, cam[0]);
});
test('no pumping: a crew change that shifts the page 20 px or less on screen does not move it; more does', () => {
  const R = rects([['a', 0, 2000, 1440, 600], ['b', 0, 2020, 1440, 100], ['c', 0, 2050, 1440, 100]], { docH: 6000 });
  const a = step(STAGED([build(), plan(['a', 'b', 'c']), R, agent(A1, 'writing', { sectionId: 'a', job: 'A' })]), 1000).state;
  const b = run(a, [agent(A1, 'done', { sectionId: 'a', job: 'A' }), agent(A2, 'writing', { sectionId: 'b', job: 'B' })], 2000).state;
  assert.deepEqual(cameraMoves(step(b, 2000)), [], '20 page px at 0.76 is 15 screen px');
  const c = run(b, [agent(A2, 'done', { sectionId: 'b', job: 'B' }), agent('a_00000003', 'writing', { sectionId: 'c', job: 'C' })], 3000).state;
  assert.equal(cameraMoves(step(c, 3000)).length, 1, '50 page px at 0.76 is 38 screen px');
});
test('the lowest running section clears the 96 px HUD band', () => {
  const r = frameCrew({ ...G, sections: live(['a', 2000, 600], ['b', 2600, 600]) });
  assert.ok((3200 - r.y) * r.scale <= 900 - 96);
});
test('Review Focus 5: only a real scroll stops the camera', () => {
  const moved = step(STAGED(CREW), 1000).state;
  const R = (scrollY, docH = 6000) => rects([['a', 0, 2000, 1440, 600], ['b', 0, 2600, 1440, 600], ['c', 0, 3200, 1440, 600]], { scrollY, docH });
  assert.equal(run(moved, [R(1900)], 1300).state.camera.on, true, 'our own ease');
  assert.equal(run(moved, [R(1950, 6400)], 2000).state.camera.on, true, 'the document grew: scroll anchoring');
  assert.equal(run(moved, [R(moved.scroll.y + 1)], 2000).state.camera.on, true, 'under the 2 px slop');
  const resized = reduceUser(moved, { type: 'resize', stageW: 1096, stageH: 700 }, 3000).state;
  assert.equal(run(resized, [R(1800)], 3200).state.camera.on, true, 'an iframe resize can clamp scrollY');
  assert.equal(run(moved, [R(1500)], 2000).state.camera.on, false, 'the person scrolled');
});
test('M11: a person who scrolled or zoomed gets Follow back; a new round or a Resume also brings the camera back', () => {
  const off = run(step(STAGED(CREW), 1000).state, [rects([['a', 0, 2000, 1440, 600]], { scrollY: 1500, docH: 6000 })], 2000).state;
  assert.deepEqual(step(run(off, [agent(A2, 'writing', { sectionId: 'b', job: 'B' })], 2100).state, 2100).effects, [], 'stopped: the crew moves on alone');
  const back = reduceUser(off, { type: 'follow' }, 3000).state;
  assert.equal(back.camera.on, true);
  assert.equal(step(back, 3000).effects.filter((e) => e.type === 'camera').length, 1, 'frames at once');
  assert.equal(run(off, [build('planning', { buildId: 'b_000000000002' })], 4000).state.camera.on, true);
  assert.equal(run(run(off, [build('paused', { reason: 'failed' })], 4000).state, [build('building')], 4100).state.camera.on, true);
});
test('zoom: exp(-dy*.01), clamped, about the pointer, stops the camera; only on a wide page', () => {
  const s = run(STAGED(CREW), [rects([['a', 0, 2000, 1440, 600]], { scrollY: 2000, docH: 6000 })]).state;
  const r = reduceUser(s, { type: 'zoom', dy: 50, stageY: 200 }, 9);
  const mv = r.effects.find((e) => e.type === 'camera');
  const s0 = 1096 / 1440; const s1 = s0 * Math.exp(-0.5);
  near(mv.scale, s1); near(mv.y, 2000 + 200 / s0 - 200 / s1); assert.equal(mv.ms, 0);
  assert.equal(r.state.camera.on, false);
  assert.equal(reduceUser(s, { type: 'zoom', dy: 99999, stageY: 0 }).effects[0].scale, 0.45);
  near(reduceUser(s, { type: 'zoom', dy: -99999, stageY: 0 }).effects[0].scale, s0);
  const phone = reduceUser(s, { type: 'viewport', name: 'phone' }).state;
  assert.deepEqual(reduceUser(phone, { type: 'zoom', dy: 50, stageY: 0 }).effects, []);
});
test('placeCursors: parks only past the band, spreads a crowd, stacks at the top, and never changes the count', () => {
  const V = { scrollY: 0, s: 1, ox: 0, oy: 0, stageW: 1000, stageH: 900, frameW: 1000 };
  const C = (agentId, x, y, colorIndex = 0) => ({ agentId, x, y, colorIndex });
  assert.deepEqual(placeCursors([C('a', 50, 500)], V)[0].parked, 0);
  assert.deepEqual(placeCursors([C('a', 50, 804)], V)[0].parked, 0);
  const below = placeCursors([C('a', 50, 850)], V)[0];
  assert.deepEqual([below.parked, below.y, below.x], [1, 804, 50]);
  const up = placeCursors([C('a', 50, 100, 4)], { ...V, scrollY: 500 })[0];
  assert.deepEqual([up.parked, up.y], [-1, 500 + 8 + 24]);
  assert.equal(placeCursors([C('a', 50, 0)], V)[0].parked, 0, 'at the page top nothing is above');
  assert.equal(placeCursors([C('a', 50, 503)], { ...V, scrollY: 500, oy: 24 })[0].parked, -1, 'the top edge is oy + 8 on a narrow page');
  const crowd = placeCursors(['a', 'b', 'c', 'd', 'e'].map((n) => C(n, 50, 900)), V);
  assert.deepEqual(crowd.map((c) => c.x), [118, 294, 470, 646, 822].map((x) => x - 0));
  assert.equal(placeCursors([C('a', 5000, 100)], V)[0].x, 940);
  assert.equal(placeCursors([C('a', -50, 100)], V)[0].x, 2);
});
test('M11: at 0.45, what fits is on screen and only the rest parks; the count holds', () => {
  const s = 0.45; const V = { scrollY: 0, s, ox: 0, oy: 0, stageW: 1096, stageH: 900, frameW: 1440 * s };
  const fits = placeCursors([{ agentId: 'a', x: 10, y: 1700, colorIndex: 0 }], V);
  assert.equal(fits[0].parked, 0);
  const far = placeCursors([{ agentId: 'a', x: 10, y: 1700, colorIndex: 0 }, { agentId: 'b', x: 10, y: 2600, colorIndex: 1 }], V);
  assert.deepEqual(far.map((c) => c.parked), [0, 1]);
  assert.equal(far.length, 2);
});

// The rules below have no row in the plan's test list; each pins one camera rule of its Step 3.
const READY = (mode) => ({ t: 'ready', mode, vw: 1440, vh: 900, dpr: 1 });
test('fitWidth: a wide page fills the stage; a narrow one keeps 40 px each side and never grows past 1', () => {
  assert.equal(fitWidth(1096, 1440), 1096 / 1440);
  assert.equal(fitWidth(400, 390), 320 / 390);
  assert.equal(fitWidth(1096, 390), 1);
});
test('placeCursors: four parked below keep their own x; only a fifth spreads them', () => {
  const V = { scrollY: 0, s: 1, ox: 0, oy: 0, stageW: 1000, stageH: 900, frameW: 1000 };
  const four = placeCursors(['a', 'b', 'c', 'd'].map((agentId) => ({ agentId, x: 50, y: 900, colorIndex: 0 })), V);
  assert.deepEqual(four.map((c) => [c.x, c.parked]), [[50, 1], [50, 1], [50, 1], [50, 1]]);
});
test('resize: the same size changes nothing; a scale at fit re-fits, a zoomed one stays', () => {
  const s = STAGED([]);
  assert.equal(reduceUser(s, { type: 'resize', stageW: 1096, stageH: 900 }, 50).state, s);
  const zoomed = { ...s, camera: { ...s.camera, scale: 0.5, key: 'k', force: false } };
  const z = reduceUser(zoomed, { type: 'resize', stageW: 1200, stageH: 800 }, 100).state;
  assert.deepEqual([z.view.stageW, z.view.stageH], [1200, 800]);
  assert.deepEqual([z.camera.scale, z.camera.key, z.camera.force, z.camera.pendingUntil], [0.5, '', true, 700]);
  const atFit = reduceUser({ ...s, camera: { ...s.camera, scale: 1096 / 1440 } }, { type: 'resize', stageW: 1200, stageH: 800 }, 100).state;
  assert.equal(atFit.camera.scale, null);
  const framed = step(z, 100);
  assert.equal(framed.state.camera.force, false, 'the next cameraStep clears force');
});
test('viewport: a new one re-fits and reframes; the same or an unknown one changes nothing', () => {
  const s0 = STAGED([]);
  const s = { ...s0, camera: { ...s0.camera, scale: 0.5, key: 'k' } };
  const t = reduceUser(s, { type: 'viewport', name: 'tablet' }).state;
  assert.deepEqual([t.view.viewport, t.camera.scale, t.camera.key], ['tablet', null, '']);
  assert.equal(reduceUser(s, { type: 'viewport', name: 'desktop' }).state, s);
  assert.equal(reduceUser(s, { type: 'viewport', name: 'toString' }).state, s);
});
test('a skipped move keeps the new crew key and the old target, so small shifts still add up', () => {
  const R = rects([['a', 0, 2000, 1440, 600], ['b', 0, 2020, 1440, 100]], { docH: 6000 });
  const a = step(STAGED([build(), plan(['a', 'b']), R, agent(A1, 'writing', { sectionId: 'a', job: 'A' })]), 1000).state;
  const b = run(a, [agent(A1, 'done', { sectionId: 'a', job: 'A' }), agent(A2, 'writing', { sectionId: 'b', job: 'B' })], 2000).state;
  const skipped = step(b, 2000);
  assert.deepEqual(cameraMoves(skipped), []);
  assert.notEqual(skipped.state.camera.key, a.camera.key);
  assert.equal(skipped.state.camera.y, a.camera.y);
});
test('ready: a build doc starts at the top and is framed again; a run doc keeps the target, and the camera neither frames nor stops over it', () => {
  const moved = run(step(STAGED(CREW), 1000).state, [rects([['a', 0, 2000, 1440, 600]], { scrollY: 1850, docH: 6000 })], 1300).state;
  assert.equal(moved.scroll.y, 1850);
  const b = reduceBridge(moved, READY('build'), 5000).state;
  assert.deepEqual([b.docMode, b.nextMode, b.camera.y, b.camera.key, b.camera.pendingUntil, b.scroll.y], ['build', null, null, '', 5600, 0]);
  assert.equal(cameraMoves(step(b, 5000)).length, 1, 'the new frame is at scroll 0, so the camera moves at once');
  const change = run(step(STAGED([build('building', { kind: 'change' }), ...CREW.slice(1)])).state, [build('done', { kind: 'change' })], 5000).state;
  const r = reduceBridge(change, READY('run'), 6000).state;
  assert.deepEqual([r.docMode, r.camera.y], ['run', change.camera.y]);
  assert.equal(run(r, [rects([['a', 0, 2000, 1440, 600]], { scrollY: 100, docH: 6000 })], 9000).state.camera.on, true, 'scrolling a run doc');
  const first = reduceBridge(run(step(STAGED(CREW)).state, [build('done')], 5000).state, READY('run'), 6000).state;
  assert.deepEqual(step(first, 6000).effects, [], 'a run doc is never framed');
});
const ZOOMED = [build(), plan(['a']), rects([['a', 0, 2000, 1440, 776 / 0.6]], { docH: 6000 }), agent(A1, 'writing', { sectionId: 'a', job: 'A' })];
test('from a zoomed-out crew: a resize takes a small zoom back in at once, and a first round done goes back to fit', () => {
  const a = step(STAGED(ZOOMED)).state;
  near(a.camera.scale, 0.6, 1e-9);
  const resized = step(reduceUser(a, { type: 'resize', stageW: 1096, stageH: 926 }, 2000).state, 2000);
  near(cameraMoves(resized)[0].scale, (802 * 0.6) / 776, 1e-9);
  const done = step(run(a, [build('done')], 5000).state, 5000);
  near(cameraMoves(done)[0].scale, 1096 / 1440);
  assert.equal(selectLayout(done.state).s, 1096 / 1440);
});
test('the camera rests while it is off, while the lead integrates and once a round halted; a person\'s scroll forgets its target', () => {
  const R = (scrollY) => rects([['a', 0, 2000, 1440, 600], ['b', 0, 2600, 1440, 600], ['c', 0, 3200, 1440, 600]], { scrollY, docH: 6000 });
  const off = run(step(STAGED(CREW), 1000).state, [R(1500)], 2000).state;
  assert.deepEqual([off.camera.on, off.camera.y], [false, null]);
  assert.deepEqual(step(run(off, [agent(A2, 'writing', { sectionId: 'b', job: 'B' })], 2100).state, 2100).effects, [], 'b is measured, and still nothing');
  const failedA = [plan(['a']), rects([['a', 0, 2000, 1440, 600]], { docH: 6000 }), section('a', 'failed')];
  for (const st of ['integrating', 'stopped', 'error', 'interrupted']) {
    assert.deepEqual(step(STAGED([build(st), ...failedA])).effects, [], st);
  }
});
test('the camera is the web stage\'s: a deck stage neither frames nor zooms', () => {
  const pitch = run(reduceUser(initialStage({ designId: DID, kind: 'pitch', canvas: { w: 1440 } }), { type: 'resize', stageW: 1096, stageH: 900 }).state, CREW).state;
  assert.deepEqual(step(pitch).effects, []);
  assert.deepEqual(reduceUser(pitch, { type: 'zoom', dy: 50, stageY: 0 }).effects, []);
});
test('a new round frames its crew only once the frame reported the page height: an applied before the first rects moves nothing (review M1)', () => {
  // A new round starts at docH 0; the bridge answers hello with an `applied` (with a rect) before its first `rects`.
  const before = step(STAGED([build('building', { kind: 'change' }), plan(['a', 'b', 'c', 'd', 'e']), { t: 'applied', id: 'e', rev: 0, added: 0, layers: 0, rect: [0, 2800, 1440, 600], tail: null, marks: [], overflow: false }, agent(A1, 'writing', { sectionId: 'e', job: 'E' })]), 1000);
  assert.deepEqual(cameraMoves(before), []);
  assert.equal(before.state.camera.key, '', 'the crew key waits for the page height');
  const measured = step(run(before.state, [rects([['e', 0, 2800, 1440, 600]], { docH: 4200 })], 1100).state, 1100);
  const want = frameCrew({ sections: [{ id: 'e', rect: [0, 2800, 1440, 600] }], stageW: 1096, stageH: 900, pageW: 1440, docH: 4200, curS: 1096 / 1440 });
  assert.ok(want.y > 2000);
  assert.deepEqual(cameraMoves(measured).map((e) => [e.scale, e.y]), [[want.scale, want.y]]);
});
test('an unmeasured stage frames nothing (no scale 0, no NaN target)', () => {
  const s = run(initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 } }), CREW).state;
  const r = step(s);
  assert.deepEqual(cameraMoves(r), []);
  assert.deepEqual([r.state.camera.scale, r.state.camera.y, r.state.camera.key], [null, null, '']);
});
test('the person\'s whole-round Stop: each agent\'s own `stopped` frame under `building` moves nothing (L4.34)', () => {
  const two = [...CREW, agent(A2, 'writing', { sectionId: 'b', job: 'B' })];
  const a = step(STAGED(two), 1000).state;
  const stopping = reduceUser(a, { type: 'stopping', on: true }, 2000).state;
  const one = run(stopping, [agent(A1, 'stopped', { sectionId: 'a', job: 'A' })], 2100);
  assert.equal(one.effects.filter((e) => e.type === 'leave').length, 1);
  assert.deepEqual(cameraMoves(step(one.state, 2100)), [], 'the crew shrank to b, and the zoom holds');
  assert.equal(cameraMoves(step(run(a, [agent(A1, 'stopped', { sectionId: 'a', job: 'A' })], 2100).state, 2100)).length, 1, 'without a Stop the camera follows b');
});
