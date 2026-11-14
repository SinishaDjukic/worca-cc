// test/ui-design-drafts.test.mjs — the Design stage model's drafts, snapshot and document effects
// (ui/public/design/stage-model.mjs): splices and rev gaps, design-file, the snapshot, and what each doc is sent at
// `ready`. Frames come from test/helpers/design-stage-frames.mjs, shaped as P2 sends them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialStage, reduceBridge, reduceUser, selectCursors } from '../ui/public/design/stage-model.mjs';
import {
  DID, BID, A1, A2, build, plan, agent, section, delta, file, snapshot, applied, stats, run,
} from './helpers/design-stage-frames.mjs';

const eff = (r, type) => r.effects.filter((e) => e.type === type);
const HTML = 'sections/hero/index.html';
const BASE = [build(), plan(['hero']), agent(A1, 'writing')];
const S0 = () => initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 } });
const after = (steps) => run(S0(), steps);

test('Write appends and feeds the full prefix; an Edit is a delete splice, then an insert', () => {
  const r = after([...BASE, delta(HTML, 1, 0, '<h1>Ship'), delta(HTML, 2, 8, ' it</h1>')]);
  assert.equal(eff(r, 'feed').at(-1).text, '<h1>Ship it</h1>');
  assert.deepEqual([eff(r, 'feed').at(-1).sectionId, eff(r, 'feed').at(-1).final], ['hero', false]);
  const e = run(r.state, [delta(HTML, 3, 4, '', { del: 7 }), delta(HTML, 4, 4, 'Go')]);
  assert.deepEqual(eff(e, 'feed').map((f) => f.text), ['<h1></h1>', '<h1>Go</h1>']);
});
test('a Write over a non-empty draft clears it first, then appends (draft.mjs:200-203)', () => {
  const r = after([...BASE, delta(HTML, 1, 0, '<p>old</p>'), delta(HTML, 2, 0, '', { del: 10 }), delta(HTML, 3, 0, '<p>new')]);
  assert.deepEqual(eff(r, 'feed').map((f) => f.text), ['<p>old</p>', '', '<p>new']);
  assert.equal(run(r.state, [delta(HTML, 4, 2, '', { del: 99 })]).state.resyncing, true, 'a delete past the end is a gap');
});
test('a rev gap asks one re-subscribe and holds later deltas until the snapshot', () => {
  const r = after([...BASE, delta(HTML, 1, 0, 'a'), delta(HTML, 3, 1, 'c'), delta(HTML, 4, 2, 'd')]);
  assert.equal(eff(r, 'subscribe').filter((e) => e.buildId === BID).length, 2, 'the first design-build, then one for the gap');
  assert.equal(eff(r, 'feed').length, 1);
  assert.equal(r.state.resyncing, true);
});
test('a splice past the end of the draft is a gap', () => {
  const r = after([...BASE, delta(HTML, 1, 500, 'x')]);
  assert.equal(r.state.resyncing, true);
  assert.equal(eff(r, 'feed').length, 0);
});
test('design-file is the truth and is final; too big means fetch', () => {
  const r = after([...BASE, delta(HTML, 1, 0, 'half'), file(HTML, 2, '<h1>whole</h1>')]);
  assert.deepEqual([eff(r, 'feed').at(-1).text, eff(r, 'feed').at(-1).final], ['<h1>whole</h1>', true]);
  assert.equal(eff(run(r.state, [file(HTML, 2, 'stale')]), 'feed').length, 0, 'a rev at or below the draft is ignored');
  const big = run(r.state, [{ ...file(HTML, 3, ''), text: undefined, bytes: 300000 }]);
  assert.deepEqual(eff(big, 'fetchFile').map((e) => [e.path, e.rev]), [[HTML, 3]]);
  assert.equal(run(big.state, [delta(HTML, 4, 0, 'x')]).state.resyncing, true, 'a textless file sets no rev, so the next delta is a gap');
});
test('CSS goes straight to the bridge; JS never does, and only its bytes are kept', () => {
  const r = after([...BASE, delta('sections/hero/style.css', 1, 0, '.a{}', { part: 'css' }), delta('tokens.css', 1, 0, ':root{}', { sectionId: null, part: 'css' }), delta('sections/hero/script.js', 1, 0, 'alert(1)', { part: 'js' })]);
  const css = eff(r, 'bridge').filter((e) => e.t === 'css').map((e) => [e.fields.file, e.fields.rev, e.fields.text, e.fields.final]);
  assert.deepEqual(css, [['hero', 1, '.a{}', false], ['tokens', 1, ':root{}', false]], 'P3 requires a rev and drops one at or below the last');
  assert.doesNotMatch(JSON.stringify(r.effects), /alert\(1\)/);
});
test('an agent that ends mid-write finalizes its section, so the text settles', () => {
  const r = after([...BASE, delta(HTML, 1, 0, 'x'), agent(A1, 'stopped')]);
  assert.deepEqual(eff(r, 'finalize').map((e) => e.key), [HTML]);
});
test('a removed section drops its pending reveal', () => {
  assert.deepEqual(eff(after([...BASE, delta(HTML, 1, 0, 'x'), section('hero', 'removed')]), 'drop').map((e) => e.key), [HTML]);
});
test('P3: the first plan reloads the build doc for the lead\'s shell; a new id reloads; the same ids do not', () => {
  const ready = { t: 'ready', mode: 'build', vw: 1440, vh: 900, dpr: 1 };
  const a = after([build('planning'), ready, plan(['hero'])]);
  assert.deepEqual(eff(a, 'load').map((e) => e.mode), ['build', 'build']);
  const b = run(a.state, [ready]);
  assert.deepEqual(eff(b, 'bridge').map((e) => e.t), ['hello', 'plan']);
  assert.equal(eff(run(b.state, [plan(['hero'], { planRev: 2 })]), 'load').length, 0);
  const c = run(b.state, [plan(['hero', 'faq'], { planRev: 3 })]);
  assert.deepEqual(eff(c, 'load').map((e) => e.mode), ['build']);
});
test('ready in a build doc: hello, plan, css tokens then global then sections, then unfinished sections; nothing finished is resent', () => {
  const r = after([...BASE, section('old', 'done'), delta('global.css', 1, 0, 'g', { sectionId: null, part: 'css' }), delta('tokens.css', 1, 0, 't', { sectionId: null, part: 'css' }),
    delta('sections/hero/style.css', 1, 0, 's', { part: 'css' }), delta(HTML, 1, 0, '<p>'), delta('sections/old/index.html', 1, 0, 'o', { sectionId: 'old' })]);
  // `run` returns only the effects of the steps it is given, so these are the ready's own.
  const ready = run(r.state, [{ t: 'ready', mode: 'build', vw: 1, vh: 1, dpr: 1 }]);
  const seq = ready.effects.filter((e) => e.type === 'bridge' || e.type === 'flush').map((e) => (e.type === 'flush' ? `flush:${e.sectionId}` : e.t === 'css' ? `css:${e.fields.file}` : e.t));
  assert.deepEqual(seq, ['hello', 'plan', 'css:tokens', 'css:global', 'css:hero', 'flush:hero']);
  assert.deepEqual(ready.effects.find((e) => e.t === 'hello').fields, { mode: 'build', kind: 'web', canvas: { w: 1440 } });
});
test('ready in a run doc: hello only, and pick when it was asked for', () => {
  const r = after([...BASE, build('done'), { user: { type: 'pick', on: true } }]);
  const ready = run(r.state, [{ t: 'ready', mode: 'run', vw: 1, vh: 1, dpr: 1 }]);
  assert.deepEqual(ready.effects.filter((e) => e.type === 'bridge').map((e) => [e.t, e.fields.on]), [['hello', undefined], ['pick', true]]);
  const b = after([...BASE, { user: { type: 'pick', on: true } }]);
  assert.equal(eff(b, 'bridge').filter((e) => e.t === 'pick').length, 0, 'the build doc has no pick');
});
test('ready in a run doc after a change round puts the page back on the changed section; a first round starts at the top', () => {
  const ready = { t: 'ready', mode: 'run', vw: 1, vh: 1, dpr: 1 };
  const s = after([build('done', { kind: 'change' })]).state;
  const change = reduceBridge({ ...s, camera: { ...s.camera, scale: 0.6, y: 1900 } }, ready, 0);
  assert.deepEqual(eff(change, 'bridge').map((e) => [e.t, e.fields.y, e.fields.behavior]), [['hello', undefined, undefined], ['scroll', 1900, 'auto']]);
  const first = reduceBridge(after([build('done')]).state, ready, 0);
  assert.deepEqual(eff(first, 'bridge').map((e) => e.t), ['hello']);
});
test('deck and video plans send no estHeight', () => {
  const r = run(initialStage({ designId: DID, kind: 'pitch', canvas: { w: 1920, h: 1080 } }), [build(), { t: 'ready', mode: 'build', vw: 1, vh: 1, dpr: 1 }, plan(['s1'])]);
  const again = run(r.state, [{ t: 'ready', mode: 'build', vw: 1, vh: 1, dpr: 1 }]);
  assert.deepEqual(again.effects.find((e) => e.t === 'plan').fields.sections, [{ id: 's1' }]);
});
test('done loads the run doc; stopped and paused do not; a change round goes back to the build doc', () => {
  const load = (steps) => eff(after(steps), 'load').map((e) => e.mode);
  assert.deepEqual(load([build(), build('done')]), ['build', 'run']);
  assert.deepEqual(load([build(), build('stopped')]), ['build']);
  assert.deepEqual(load([build(), build('paused')]), ['build']);
  const done = after([build(), build('done'), { t: 'ready', mode: 'run', vw: 1, vh: 1, dpr: 1 }]);
  assert.deepEqual(eff(run(done.state, [build('planning', { buildId: 'b_000000000002', kind: 'change' })]), 'load').at(-1).mode, 'build');
  const partial = after([build(), build('done', { reason: 'partial' }), { t: 'ready', mode: 'run', vw: 1, vh: 1, dpr: 1 }]);
  const again = run(partial.state, [build('building')]);
  assert.deepEqual(eff(again, 'load').map((e) => e.mode), ['build'], 'a Retry after a partial round keeps the buildId');
  assert.deepEqual([again.state.camera.on, again.state.camera.doneFramed], [true, false]);
});
test('L3.15: layers come only from applied, latest wins, stats.layers is never read', () => {
  let s = after([build('building', { stats: { layers: 126 } })]).state;
  assert.equal(s.layers, 0);
  s = run(s, [applied('hero', { layers: 40 }), applied('price', { layers: 44 }), applied('price', { layers: 41 })]).state;
  assert.equal(s.layers, 41);
});
test('design-restored loads the run doc and asks for fresh details', () => {
  const r = after([{ type: 'design-restored', designId: DID, version: 3, restoredFrom: 1, ts: 1 }]);
  assert.deepEqual(eff(r, 'load').map((e) => e.mode), ['run']);
  assert.equal(eff(r, 'refresh').length, 1);
});
test('Review Focus 2: a lost delta, then a snapshot: one cursor per agent and no doubled text', () => {
  const gap = after([...BASE, delta(HTML, 1, 0, 'ab'), agent(A2, 'writing', { sectionId: 'price', job: 'Price' }), delta(HTML, 5, 9, 'zz')]);
  const crew = selectCursors(gap.state).map((c) => [c.agentId, c.crew]);
  const snap = run(gap.state, [snapshot({ seq: 50, build: { status: 'building', round: 1, kind: 'first', reason: null, waiting: 0, stats: stats() },
    plan: { planRev: 1, canvas: { w: 1440 }, sections: [{ id: 'hero', job: 'Hero', status: 'writing' }] }, sections: [{ id: 'hero', job: 'Hero', status: 'writing', agentId: A1 }],
    agents: [agent(A1, 'writing'), agent(A2, 'writing', { sectionId: 'price', job: 'Price' })].map(({ type, designId, buildId, seq, ts, ...a }) => a),
    drafts: [{ path: HTML, rev: 7, text: 'abcdef' }] })]);
  assert.deepEqual(selectCursors(snap.state).map((c) => [c.agentId, c.crew]), crew, 'same crew, same colours');
  assert.equal(snap.state.resyncing, false);
  assert.deepEqual(eff(snap, 'flush').map((e) => [e.key, e.text, e.final]), [[HTML, 'abcdef', false]]);
  const next = run(snap.state, [delta(HTML, 8, 6, 'g', { seq: 51 }), delta(HTML, 6, 0, 'OLD', { seq: 40 })]);
  assert.equal(eff(next, 'feed').at(-1).text, 'abcdefg', 'an older frame is dropped by seq, the next one applies');
  assert.equal(next.state.resyncing, false);
});
test('P2 L2.21: after a Continue the base design-file lands first at the jumped rev, and deltas follow it with no gap', () => {
  const r = after([...BASE, delta(HTML, 1, 0, 'x'), file(HTML, 1800000000001, 'base'), delta(HTML, 1800000000002, 4, '!')]);
  assert.deepEqual([eff(r, 'feed').at(-1).text, r.state.resyncing], ['base!', false]);
});
test('a delta that jumps rev with no base file is still a gap, and the snapshot heals it', () => {
  const r = after([...BASE, delta(HTML, 1, 0, 'x'), delta(HTML, 1800000000000, 1, 'y')]);
  assert.equal(r.state.resyncing, true);
  assert.equal(run(r.state, [snapshot({ seq: 2 })]).state.resyncing, false);
});
test('late join: deltas of older paths before the snapshot are one gap, held, and the snapshot heals them; hello again re-subscribes once', () => {
  const r = after([build('building'), plan(['hero']), delta(HTML, 40, 99, 'x'), delta(HTML, 41, 100, 'y')]);
  assert.deepEqual([eff(r, 'subscribe').length, eff(r, 'feed').length, r.state.resyncing], [2, 0, true]);
  const s = run(r.state, [snapshot({ seq: 60, drafts: [{ path: HTML, rev: 41, text: 'abc' }] })]).state;
  assert.equal(s.resyncing, false);
  const re = reduceUser(s, { type: 'rejoin' });
  assert.deepEqual([eff(re, 'subscribe').length, re.state.resyncing], [1, true]);
});
test('picked: an effect for the chat and a pin to draw; unpin removes it', () => {
  const r = after([build(), plan(['hero']), { t: 'picked', id: 'hero', path: 'p', tag: 'h1', text: 'x', html: '<h1>', rect: [1, 2, 3, 4] }]);
  assert.deepEqual(eff(r, 'picked')[0].pin, { id: 'hero', path: 'p', tag: 'h1', text: 'x', html: '<h1>', rect: [1, 2, 3, 4] });
  assert.equal(r.state.pins.length, 1);
  assert.equal(reduceUser(r.state, { type: 'unpin', id: 'hero', path: 'p' }).state.pins.length, 0);
});

// Beyond the plan's list: rules of Task 6's Step 3 that the cases above do not reach.

test('a section the plan does not hold is ignored; a plan with no doc ready sends nothing; done loads the run doc once; rejoin needs an open build', () => {
  const s = after(BASE).state;
  assert.equal(run(s, [section('other', 'failed')]).state, s);
  assert.deepEqual(eff(after([build(), plan(['hero'])]), 'bridge'), []);
  assert.deepEqual(eff(after([build(), build('done'), build('done')]), 'load').map((e) => e.mode), ['build', 'run']);
  const ended = after([build(), build('done')]).state;
  assert.equal(reduceUser(ended, { type: 'rejoin' }).state, ended);
});
test('a snapshot sends off an agent it does not hold on stage, and gives the build doc its plan or a reload for a new id', () => {
  assert.deepEqual(eff(run(after(BASE).state, [snapshot({ seq: 900 })]), 'leave').map((e) => e.agentId), [A1]);
  const ready = { t: 'ready', mode: 'build', vw: 1, vh: 1, dpr: 1 };
  const s = after([build(), plan(['hero']), ready]).state;
  const snap = (ids) => snapshot({ seq: 901, plan: { planRev: 2, canvas: { w: 1440 }, sections: ids.map((id) => ({ id, job: id, status: 'planned', estHeight: 300 })) } });
  assert.deepEqual(eff(run(s, [snap(['hero'])]), 'bridge').map((e) => [e.t, e.fields.sections]), [['plan', [{ id: 'hero', estHeight: 300 }]]]);
  assert.deepEqual([eff(run(s, [snap(['hero', 'faq'])]), 'load').length, eff(run(s, [snap(['hero', 'faq'])]), 'bridge').length], [1, 0]);
});
test('an agent that left leaves its text final, so the next build doc gets it settled', () => {
  const r = after([...BASE, delta(HTML, 1, 0, 'x'), agent(A1, 'stopped'), { t: 'ready', mode: 'build', vw: 1, vh: 1, dpr: 1 }]);
  assert.deepEqual(eff(r, 'flush').map((e) => [e.key, e.text, e.final]), [[HTML, 'x', true]]);
  const ended = after([...BASE, delta(HTML, 1, 0, 'x'), build('stopped')]);
  assert.deepEqual(eff(ended, 'finalize').map((e) => e.key), [HTML], 'an end-of-build settles it too');
});
test('a snapshot keeps where a known cursor stands and the order agents came in', () => {
  const s = after([...BASE, agent(A2, 'writing', { sectionId: 'price', job: 'Price' }), applied('hero', { tail: { rect: [300, 230, 8, 20], tag: 'p' } })]).state;
  const strip = ({ type, designId, buildId, seq, ts, ...a }) => a;
  const snap = run(s, [snapshot({ seq: 902, agents: [agent(A2, 'writing', { sectionId: 'price', job: 'Price' }), agent(A1, 'writing')].map(strip) })]).state;
  assert.deepEqual(selectCursors(snap).map((c) => [c.agentId, c.x, c.y]), selectCursors(s).map((c) => [c.agentId, c.x, c.y]));
});
test('a done section is not flushed again; a first round\'s run doc is not scrolled; unpin removes only its own path', () => {
  const done = after([...BASE, delta(HTML, 1, 0, 'x'), section('hero', 'done'), { t: 'ready', mode: 'build', vw: 1, vh: 1, dpr: 1 }]);
  assert.deepEqual(eff(done, 'flush'), []);
  const s = after([build('done')]).state;
  assert.deepEqual(eff(reduceBridge({ ...s, camera: { ...s.camera, y: 1900 } }, { t: 'ready', mode: 'run', vw: 1, vh: 1, dpr: 1 }, 0), 'bridge').map((e) => e.t), ['hello']);
  const pick = (path) => ({ t: 'picked', id: 'hero', path, tag: 'h1', text: '', html: '<h1>', rect: [1, 2, 3, 4] });
  const two = after([build(), plan(['hero']), pick('p'), pick('q')]).state;
  assert.deepEqual(reduceUser(two, { type: 'unpin', id: 'hero', path: 'p' }).state.pins.map((p) => p.path), ['q']);
});

// Review fix cycle 2: the snapshot's guards and its settled text.
const strip = ({ type, designId, buildId, seq, ts, ...a }) => a;
const PRICE = 'sections/price/index.html';
test('a snapshot sends a section no agent on stage holds as final, and settles the text of an agent that leaves through it (review M2)', () => {
  // hero's builder stopped (its text settled); a delta of price is lost; the snapshot must not re-ghost hero.
  const s = after([...BASE, plan(['hero', 'price']), delta(HTML, 1, 0, 'ab'), agent(A2, 'writing', { sectionId: 'price', job: 'Price' }), delta(PRICE, 1, 0, 'p', { sectionId: 'price' }), agent(A1, 'stopped'), delta(PRICE, 3, 1, 'q', { sectionId: 'price' })]);
  assert.equal(s.state.resyncing, true);
  const snap = run(s.state, [snapshot({ seq: 70, plan: { planRev: 1, canvas: { w: 1440 }, sections: [{ id: 'hero', job: 'Hero', status: 'stopped' }, { id: 'price', job: 'Price', status: 'writing' }] },
    agents: [agent(A1, 'stopped'), agent(A2, 'writing', { sectionId: 'price', job: 'Price' })].map(strip),
    drafts: [{ path: HTML, rev: 1, text: 'ab' }, { path: PRICE, rev: 3, text: 'pzq' }] })]);
  assert.deepEqual(eff(snap, 'flush').map((e) => [e.key, e.final]), [[HTML, true], [PRICE, false]]);
  assert.deepEqual([snap.state.drafts[HTML].final, snap.state.drafts[PRICE].final], [true, false]);
  // A late join: hero stopped before the page opened; its first and only flush is final.
  const late = after([build('building'), plan(['hero', 'price']), snapshot({ seq: 80, plan: { planRev: 1, canvas: { w: 1440 }, sections: [{ id: 'hero', job: 'Hero', status: 'stopped' }, { id: 'price', job: 'Price', status: 'writing' }] },
    agents: [agent(A1, 'stopped'), agent(A2, 'writing', { sectionId: 'price', job: 'Price' })].map(strip), drafts: [{ path: HTML, rev: 4, text: 'abc' }, { path: PRICE, rev: 2, text: 'pq' }] })]);
  assert.deepEqual(eff(late, 'flush').map((e) => [e.key, e.final]), [[HTML, true], [PRICE, false]]);
  // hero's builder was writing when the socket dropped; the snapshot says it ended and its section is done: the done
  // section is flushed anyway, final, with the snapshot's whole text.
  const gone = after([...BASE, delta(HTML, 1, 0, 'ab'), delta(HTML, 3, 2, 'x')]);
  const left = run(gone.state, [snapshot({ seq: 90, plan: { planRev: 1, canvas: { w: 1440 }, sections: [{ id: 'hero', job: 'Hero', status: 'done' }] },
    agents: [agent(A1, 'done')].map(strip), drafts: [{ path: HTML, rev: 3, text: 'abcx' }] })]);
  assert.deepEqual(eff(left, 'leave').map((e) => e.agentId), [A1]);
  assert.deepEqual(eff(left, 'flush').map((e) => [e.key, e.text, e.final]), [[HTML, 'abcx', true]]);
  // A leaver whose draft the snapshot no longer holds settles what was shown.
  const none = run(gone.state, [snapshot({ seq: 91, agents: [agent(A1, 'done')].map(strip), drafts: [] })]);
  assert.deepEqual(eff(none, 'finalize').map((e) => e.key), [HTML]);
});
test('a snapshot asked for again with nothing sent between repeats its seq and still lands; later deltas apply', () => {
  const first = run(after([...BASE, delta(HTML, 1, 0, 'a'), delta(HTML, 3, 1, 'c')]).state, [snapshot({ seq: 50, drafts: [{ path: HTML, rev: 2, text: 'ab' }], agents: [agent(A1, 'writing')].map(strip) })]).state;
  assert.equal(first.minSeq, 50);
  const re = reduceUser(first, { type: 'rejoin' }).state;
  assert.equal(re.resyncing, true);
  const again = run(re, [snapshot({ seq: 50, drafts: [{ path: HTML, rev: 2, text: 'ab' }], agents: [agent(A1, 'writing')].map(strip) })]);
  assert.equal(again.state.resyncing, false, 'the same seq is not dropped as old');
  assert.equal(eff(run(again.state, [delta(HTML, 3, 2, 'c', { seq: 51 })]), 'feed').at(-1).text, 'abc');
});
test('a snapshot applies its build: a round paused while the socket was down shows as paused', () => {
  const s = reduceUser(after([...BASE, delta(HTML, 1, 0, 'a')]).state, { type: 'rejoin' }).state;
  const snap = run(s, [snapshot({ seq: 60, build: { status: 'paused', round: 1, kind: 'first', reason: 'failed', waiting: 0, stats: stats() }, agents: [agent(A1, 'stopped')].map(strip) })]);
  assert.deepEqual([snap.state.status, snap.state.reason], ['paused', 'failed']);
});
test('a snapshot keeps the colour of a builder that stayed on stage, and never gives two builders one colour', () => {
  // A1 is on stage with colour 0; A2 (off stage) last held 0 too, as after the 12 colours wrapped. The snapshot lists A2 first.
  const s = after([...BASE, agent(A2, 'writing', { sectionId: 'price', job: 'Price' }), agent(A2, 'stopped', { sectionId: 'price', job: 'Price' })]).state;
  assert.equal(s.agents[A1].colorIndex, 0);
  const wrapped = { ...s, agents: { ...s.agents, [A2]: { ...s.agents[A2], colorIndex: 0 } } };
  const snap = run(wrapped, [snapshot({ seq: 95, agents: [agent(A2, 'writing', { sectionId: 'price', job: 'Price' }), agent(A1, 'writing')].map(strip) })]).state;
  assert.equal(snap.agents[A1].colorIndex, 0, 'A1 keeps its colour mid-build');
  assert.notEqual(snap.agents[A2].colorIndex, 0, 'A2 takes a free one');
  assert.equal(new Set(selectCursors(snap).map((c) => c.crew)).size, 2);
});
