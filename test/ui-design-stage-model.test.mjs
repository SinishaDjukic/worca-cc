// test/ui-design-stage-model.test.mjs — the Design stage model's core (ui/public/design/stage-model.mjs): one cursor
// per agent on stage (U3), crew colours, leaving, rounds and a stale build's frames. Frames come from
// test/helpers/design-stage-frames.mjs, shaped as P2 sends them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialStage, reduceFrame, reduceUser, selectCursors, effectiveStatus, CREW_TOKENS, LEAD_TOKEN,
} from '../ui/public/design/stage-model.mjs';
import { DID, A1, A2, LEAD, build, plan, agent, section, run } from './helpers/design-stage-frames.mjs';

const S0 = () => initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 } });
const ids = (s) => selectCursors(s).map((c) => c.agentId).sort();

test('U3: one cursor per agent on stage; an ended process has none', () => {
  for (const st of ['starting', 'thinking', 'writing', 'reading', 'waiting', 'retrying']) {
    assert.deepEqual(ids(run(S0(), [build(), agent(A1, st)]).state), [A1], st);
  }
  for (const st of ['done', 'stopped', 'error', 'interrupted']) {
    assert.deepEqual(ids(run(S0(), [build(), agent(A1, 'writing'), agent(A1, st)]).state), [], st);
  }
});
test('U3: nothing but an agent frame makes a cursor', () => {
  const { state } = run(S0(), [build('building', { stats: { agentsNow: 12, agentsTotal: 13 } }), plan(['hero', 'price']), section('hero', 'writing', { agentId: A1 })]);
  assert.deepEqual(ids(state), []);
});
test('U3: a cursor leaves once, from where it was, and it is gone at once', () => {
  const r = run(S0(), [build(), agent(A1, 'writing'), agent(A1, 'done'), agent(A1, 'done')]);
  const leaves = r.effects.filter((e) => e.type === 'leave');
  assert.equal(leaves.length, 1);
  assert.deepEqual([leaves[0].agentId, leaves[0].quick], [A1, false]);
  assert.ok(Number.isFinite(leaves[0].x) && Number.isFinite(leaves[0].y));
  assert.deepEqual(ids(r.state), []);
});
test('M12: a waiting agent stays on stage, flagged, with its colour', () => {
  const a = run(S0(), [build(), agent(A1, 'writing')]).state;
  const c0 = selectCursors(a)[0];
  const c = selectCursors(run(a, [agent(A1, 'waiting')]).state)[0];
  assert.deepEqual([c.waiting, c.crew], [true, c0.crew]);
});
test('P2 L2.1: an agent row can come back: same id, same colour, one cursor', () => {
  const a = run(S0(), [build(), agent(LEAD, 'writing', { role: 'lead', job: 'Lead', sectionId: null }), agent(LEAD, 'done', { role: 'lead', job: 'Lead', sectionId: null })]).state;
  const b = run(a, [build('integrating'), agent(LEAD, 'thinking', { role: 'lead', job: 'Integrate', sectionId: null })]).state;
  assert.deepEqual(selectCursors(b).map((c) => [c.agentId, c.job, c.crew]), [[LEAD, 'Integrate', LEAD_TOKEN]]);
});
test('Review Focus 3: a terminal build clears every cursor, with no agent frame', () => {
  for (const st of ['done', 'stopped', 'error', 'interrupted']) {
    const r = run(S0(), [build(), agent(A1, 'writing'), agent(A2, 'waiting', { sectionId: 'price', job: 'Price' }), build(st)]);
    assert.deepEqual(ids(r.state), [], st);
    assert.equal(r.effects.filter((e) => e.type === 'leave').length, 2, st);
    assert.equal(r.effects.find((e) => e.type === 'leave').quick, st === 'stopped', st);
  }
});
test('P2 ends agents before the build: a quick exit only after the person\'s own Stop', () => {
  const live = run(S0(), [build(), agent(A1, 'writing'), agent(A2, 'writing', { sectionId: 'price', job: 'Price' })]).state;
  const mine = run(live, [{ user: { type: 'stopping', on: true } }, agent(A1, 'stopped'), agent(A2, 'stopped'), build('stopped')]);
  assert.deepEqual(mine.effects.filter((e) => e.type === 'leave').map((e) => e.quick), [true, true]);
  assert.equal(mine.state.stopping, false, 'a terminal build clears it');
  const theirs = run(live, [agent(A1, 'stopped'), build('stopped')]);
  assert.deepEqual(theirs.effects.filter((e) => e.type === 'leave').map((e) => [e.agentId, e.quick]), [[A1, false], [A2, true]]);
});
test('paused keeps only waiting agents', () => {
  const r = run(S0(), [build(), agent(A1, 'writing'), agent(A2, 'waiting', { sectionId: 'price', job: 'Price' }), build('paused', { reason: 'failed' })]);
  assert.deepEqual(ids(r.state), [A2]);
});
test('a new buildId starts clean and asks to subscribe', () => {
  const a = run(S0(), [build(), agent(A1, 'writing')]).state;
  const r = reduceFrame(a, build('planning', { buildId: 'b_000000000002', kind: 'change' }), 5);
  assert.deepEqual(ids(r.state), []);
  assert.ok(r.effects.some((e) => e.type === 'subscribe' && e.buildId === 'b_000000000002'));
  assert.deepEqual(r.effects.filter((e) => e.type === 'load').map((e) => e.mode), ['build']);
  const ended = reduceFrame(a, build('done', { buildId: 'b_000000000003' }), 6);
  assert.deepEqual([ended.effects.some((e) => e.type === 'subscribe'), ended.effects.find((e) => e.type === 'load').mode], [false, 'run'], 'a build seen only once it ended needs no snapshot');
});
test('frames of another design do nothing', () => {
  const s = S0();
  const r = reduceFrame(s, agent(A1, 'writing', { designId: 'd_other' }), 0);
  assert.equal(r.state, s);
  assert.deepEqual(r.effects, []);
});
test('colours: lead is ink; 12 running builders are all different and on worca hue tokens; a freed colour comes back; no violet', () => {
  const names = Array.from({ length: 12 }, (_, i) => `a_${String(i).padStart(8, '0')}`);
  const s = run(S0(), [build(), ...names.map((n) => agent(n, 'writing', { sectionId: n.slice(2), job: n }))]).state;
  const crews = selectCursors(s).map((c) => c.crew);
  assert.equal(new Set(crews).size, 12);
  assert.ok(crews.every((c) => CREW_TOKENS.includes(c)));
  assert.doesNotMatch(CREW_TOKENS.join(), /violet/);
  assert.equal(selectCursors(run(S0(), [build('planning'), agent(LEAD, 'thinking', { role: 'lead', job: 'Lead', sectionId: null })]).state)[0].crew, LEAD_TOKEN);
  const t = run(s, [agent(names[3], 'done'), agent('a_99999999', 'writing', { sectionId: 'z', job: 'Z' })]).state;
  assert.equal(selectCursors(t).find((c) => c.agentId === 'a_99999999').crew, crews[3]);
});

// Beyond the plan's list: the rules of Task 3 that the cases above do not reach.

test('a builder that comes back keeps its colour while it is free, and takes the next free one once it is held', () => {
  const a = run(S0(), [build(), agent(A1, 'writing'), agent(A1, 'done'), agent(A2, 'writing', { sectionId: 'price', job: 'Price' }), agent(A1, 'writing')]).state;
  const crew = (s, id) => selectCursors(s).find((c) => c.agentId === id).crew;
  assert.deepEqual([crew(a, A1), crew(a, A2)], [CREW_TOKENS[0], CREW_TOKENS[1]]);
  assert.equal(crew(run(a, [agent('a_00000003', 'writing', { sectionId: 'c', job: 'C' })]).state, 'a_00000003'), CREW_TOKENS[2], 'a kept colour does not move the rotation');
  const names = Array.from({ length: 12 }, (_, i) => `a_${String(i).padStart(8, '0')}`);
  const full = run(S0(), [build(), ...names.map((n) => agent(n, 'writing', { sectionId: n.slice(2), job: n }))]).state;
  const held = run(full, [agent(names[0], 'done'), agent(names[1], 'done'), agent('a_99999999', 'writing', { sectionId: 'z', job: 'Z' }), agent(names[0], 'writing')]).state;
  assert.deepEqual([crew(held, 'a_99999999'), crew(held, names[0])], [CREW_TOKENS[0], CREW_TOKENS[1]]);
  assert.equal(selectCursors(held).find((c) => c.role === 'builder' && c.agentId === names[0]).colorIndex, 1);
});
test('L4.34: a design-build still building between the stopped agents keeps the person\'s quick exits; a Resume clears a left-over Stop', () => {
  const live = run(S0(), [build(), agent(A1, 'waiting'), agent(A2, 'writing', { sectionId: 'price', job: 'Price' })]).state;
  // P2's `_endAgent` -> `_waitingChanged` sends `design-build` (still `building`) as a waiting agent is stopped.
  const mine = run(live, [{ user: { type: 'stopping', on: true } }, agent(A1, 'stopped'), build('building', { waiting: 0 }), agent(A2, 'stopped'), build('stopped')]);
  assert.deepEqual(mine.effects.filter((e) => e.type === 'leave').map((e) => [e.agentId, e.quick]), [[A1, true], [A2, true]]);
  const paused = run(S0(), [build(), agent(A1, 'writing'), build('paused'), { user: { type: 'stopping', on: true } }]).state;
  assert.equal(paused.stopping, true);
  assert.equal(run(paused, [build('building')]).state.stopping, false);
});
test('L4.35: while planning, a builder on stage makes the effective status building', () => {
  const lead = run(S0(), [build('planning'), agent(LEAD, 'thinking', { role: 'lead', job: 'Lead', sectionId: null })]).state;
  assert.equal(effectiveStatus(lead), 'planning');
  assert.equal(effectiveStatus(run(lead, [agent(A1, 'writing')]).state), 'building');
  assert.equal(effectiveStatus(run(lead, [agent(A1, 'writing'), agent(A1, 'done')]).state), 'planning');
  assert.equal(effectiveStatus(S0()), null);
});
test('a stale build\'s late frames are dropped; after a snapshot, a frame at or below its seq is dropped', () => {
  const a = run(S0(), [build(), agent(A1, 'writing')]).state;
  const stale = reduceFrame(a, agent(A2, 'writing', { buildId: 'b_000000000009' }), 0);
  assert.equal(stale.state, a);
  assert.deepEqual(stale.effects, []);
  const other = reduceFrame(a, build('stopped', { designId: 'd_other', buildId: 'b_000000000009' }), 0);
  assert.equal(other.state, a, 'a design-build is spared the buildId check, never the designId one');
  assert.deepEqual(other.effects, []);
  const snapped = { ...a, minSeq: 1000 };
  assert.equal(reduceFrame(snapped, agent(A2, 'writing', { seq: 1000 }), 0).state, snapped);
  assert.deepEqual(ids(reduceFrame(snapped, agent(A2, 'writing', { seq: 1001 }), 0).state), [A1, A2]);
});
test('a Continue of the same build reopens the camera, and reloads the build doc only over a run doc', () => {
  const done = run(S0(), [build(), build('done')]).state;
  const held = { ...done, docMode: 'run', camera: { ...done.camera, on: false, scale: 0.6, y: 1900, key: 'k', doneFramed: true } };
  const r = reduceFrame(held, build('building'), 0);
  assert.deepEqual(r.effects.filter((e) => e.type === 'load').map((e) => e.mode), ['build']);
  assert.deepEqual(r.state.camera, { ...held.camera, on: true, y: null, key: '', doneFramed: false });
  assert.equal(r.state.nextMode, 'build');
  assert.deepEqual(reduceFrame({ ...held, docMode: 'build' }, build('building'), 0).effects.filter((e) => e.type === 'load'), []);
  const fresh = reduceFrame(held, build('planning', { buildId: 'b_000000000002', kind: 'change' }), 0).state;
  assert.deepEqual([fresh.camera.scale, fresh.camera.on, fresh.camera.y, fresh.buildKind, fresh.round], [0.6, true, null, 'change', 1], 'a change round holds its zoom (L4.32)');
});
test('a new build sends the old crew off at the normal pace, from where it was', () => {
  const a = run(S0(), [build(), agent(A1, 'writing'), agent(A2, 'waiting', { sectionId: 'price', job: 'Price' })]).state;
  const r = reduceFrame({ ...a, stopping: true }, build('planning', { buildId: 'b_000000000002', kind: 'change' }), 0);
  assert.deepEqual(r.effects.filter((e) => e.type === 'leave').map((e) => [e.agentId, e.crew, e.quick, e.x, e.y]),
    [[A1, CREW_TOKENS[0], false, 720, 360], [A2, CREW_TOKENS[1], false, 720, 360]]);
  assert.deepEqual([r.state.stopping, r.state.agentOrder, r.state.nextColor], [false, [], 0]);
});
test('design-plan keeps every field it sends and sets the canvas the lead home follows', () => {
  const rec = { id: 'hero', job: 'Hero', status: 'planned', estHeight: 600, parts: ['html'], agentId: null, summary: '', band: 'dark' };
  const s = run(S0(), [build('planning'), plan([rec], { canvas: { w: 1280 } }), agent(LEAD, 'thinking', { role: 'lead', job: 'Lead', sectionId: null })]).state;
  assert.deepEqual([s.canvas, s.sectionOrder, s.sections.hero.band, s.planRev], [{ w: 1280 }, ['hero'], 'dark', 1]);
  assert.deepEqual(selectCursors(s).map((c) => [c.x, c.y]), [[640, 360]]);
  assert.equal(run(s, [section('hero', 'writing', { agentId: A1 })]).state.sections.hero.status, 'writing');
  const noCanvas = run(initialStage({ designId: DID, kind: 'web', canvas: null }), [build('planning'), agent(LEAD, 'thinking', { role: 'lead', job: 'Lead', sectionId: null })]).state;
  assert.deepEqual(selectCursors(noCanvas).map((c) => [c.x, c.y]), [[640, 360]], 'L4.9: 1280 without a plan canvas');
});
test('the reducers never change the state they are given', () => {
  const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
  const live = freeze(run(S0(), [build(), plan(['hero', 'price']), agent(A1, 'writing'), agent(A2, 'waiting', { sectionId: 'price', job: 'Price' })]).state);
  assert.doesNotThrow(() => run(live, [{ user: { type: 'stopping', on: true } }, section('hero', 'writing', { agentId: A1 }), agent(A1, 'stopped'), build('paused'), build('building'), build('done'), build('planning', { buildId: 'b_000000000002' })]));
  assert.equal(reduceUser(live, { type: 'stopping', on: false }).state, live, 'no change, same state');
});
