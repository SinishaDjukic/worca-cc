// test/design-frames.test.mjs — the stamped, throttled frame emitter (P2 Task 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFrameEmitter } from '../src/core/design/frames.mjs';

const layers = (frames) => frames.map((x) => x.stats.layers);
const setup = (opts = {}) => { const out = []; let t = []; let clock = 1000;
  const f = createFrameEmitter({ designId: 'd', buildId: 'b', emit: (x) => out.push(x), now: () => clock,
    setTimer: (fn) => { t.push(fn); return t.length; }, clearTimer: () => { t = []; }, ...opts });
  return { f, out, fire: () => { const a = t; t = []; for (const x of a) x(); }, tick: (ms) => { clock += ms; } }; };

test('every frame carries the common fields and seq only goes up', () => {
  const { f, out } = setup();
  f.send('design-plan', { planRev: 1 }); f.send('design-section', { sectionId: 'x', status: 'done' });
  assert.deepEqual(out[0], { type: 'design-plan', designId: 'd', buildId: 'b', seq: 1, ts: 1000, planRev: 1 });
  assert.equal(out[1].seq, 2);
  assert.equal(f.lastSeq(), 2);
});
test('seqStart continues above an earlier emitter', () => {
  const { f, out } = setup({ seqStart: 100 });
  f.send('design-plan', {});
  assert.equal(out[0].seq, 101);
});
test('design-agent is at most 2 Hz per agent: first now, last after the window', () => {
  const { f, out, fire, tick } = setup();
  for (let i = 0; i < 10; i++) f.agent('a', { status: 'writing', tokens: { in: i } });
  assert.equal(out.length, 1); assert.equal(out[0].tokens.in, 0);
  f.agent('b', { status: 'thinking' });
  assert.equal(out.length, 2, 'another agent has its own window');
  tick(500); fire();
  assert.equal(out.at(-1).tokens.in, 9);
  assert.equal(out.filter((x) => x.agentId === 'a').length, 2);
});
test('a terminal agent status goes now and replaces what was pending', () => {
  const { f, out, fire } = setup();
  f.agent('a', { status: 'writing' }); f.agent('a', { status: 'writing', tool: { name: 'Write' } });
  f.agent('a', { status: 'done' });
  assert.equal(out.at(-1).status, 'done');
  const n = out.length; fire(); assert.equal(out.length, n);
});
test('M10: the throttle never drops a terminal build frame, inside the window or after a pending one', () => {
  for (const status of ['paused', 'done', 'stopped', 'error', 'interrupted']) {
    const { f, out, fire } = setup();
    f.build({ status: 'building', stats: { layers: 1 } }); f.build({ status: 'building', stats: { layers: 2 } });
    assert.equal(out.length, 1);
    f.build({ status, stats: { layers: 3 } });
    assert.deepEqual([out.at(-1).status, out.at(-1).stats], [status, { layers: 3 }]);
    assert.equal(out.filter((x) => x.status === status).length, 1);
    fire();
    assert.equal(out.at(-1).status, status, 'nothing older arrives after it');
  }
});
test('flush sends what is pending', () => {
  const { f, out } = setup();
  f.agent('a', { status: 'writing' }); f.agent('a', { status: 'reading' });
  f.flush(); assert.equal(out.at(-1).status, 'reading');
});
test('design-file: hash and bytes on the UTF-8, text up to 256 KiB, else none', () => {
  const { f, out } = setup();
  f.file({ path: 'p', sectionId: 'x', part: 'css', rev: 3, text: 'é' });
  assert.equal(out[0].bytes, 2);
  assert.equal(out[0].sha256, createHash('sha256').update('é').digest('hex'));
  assert.equal(out[0].text, 'é');
  f.file({ path: 'p', sectionId: 'x', part: 'css', rev: 4, text: 'x'.repeat(262145) });
  assert.equal('text' in out[1], false);
  assert.equal(out[1].bytes, 262145);
  f.file({ path: 'p', sectionId: 'x', part: 'css', rev: 5, text: 'x'.repeat(262144) });
  assert.equal(out[2].text.length, 262144);
});
test('design-delta is unthrottled and keeps its fields', () => {
  const { f, out } = setup();
  f.delta({ agentId: 'a', path: 'p', sectionId: 'x', part: 'html', rev: 1, splice: { at: 0, del: 0, text: 'a' } });
  f.delta({ agentId: 'a', path: 'p', sectionId: 'x', part: 'html', rev: 2, splice: { at: 1, del: 0, text: 'b' } });
  assert.deepEqual(out.map((x) => x.rev), [1, 2]);
  assert.equal(out[0].type, 'design-delta');
});

test('every terminal agent status goes now; waiting is not terminal', () => {
  for (const status of ['done', 'stopped', 'error', 'interrupted']) {
    const { f, out, fire } = setup();
    f.agent('a', { status: 'writing' }); f.agent('a', { status: 'writing', tokens: { in: 1 } }); f.agent('a', { status });
    assert.deepEqual(out.map((x) => x.status), ['writing', status], status);
    fire(); assert.equal(out.length, 2, status);
  }
  const { f, out } = setup();
  f.agent('a', { status: 'writing' }); f.agent('a', { status: 'waiting' });
  assert.equal(out.length, 1);
});
test('flush cancels the trailing timer, so nothing is sent twice', () => {
  const { f, out, fire } = setup();
  f.agent('a', { status: 'writing' }); f.agent('a', { status: 'reading' }); f.build({ status: 'building' });
  f.flush(); fire();
  assert.deepEqual(out.map((x) => [x.type, x.status]), [['design-agent', 'writing'], ['design-build', 'building'], ['design-agent', 'reading']]);
});
test('a timer armed before a flush never sends the next frame early: the flushed frame starts its window', () => {
  const out = []; let timers = []; let clock = 1000;
  const f = createFrameEmitter({ designId: 'd', buildId: 'b', emit: (x) => out.push(x), now: () => clock,
    setTimer: (fn, ms) => { const h = { fn, at: clock + ms }; timers.push(h); return h; },
    clearTimer: (h) => { timers = timers.filter((x) => x !== h); } });
  const advance = (ms) => { clock += ms; const due = timers.filter((h) => h.at <= clock);
    timers = timers.filter((h) => h.at > clock); for (const h of due) h.fn(); };
  f.build({ status: 'building', stats: { layers: 1 } });
  advance(100); f.build({ status: 'building', stats: { layers: 2 } });
  advance(300); f.flush();
  advance(50); f.build({ status: 'building', stats: { layers: 3 } });
  advance(50);
  assert.deepEqual(layers(out), [1, 2], 'nothing 100 ms after the flushed frame');
  advance(400);
  assert.deepEqual(out.map((x) => [x.stats.layers, x.ts]), [[1, 1000], [2, 1400], [3, 1900]]);
});
test('design-delta is exactly the C-5 frame', () => {
  const { f, out } = setup();
  const splice = { at: 1240, del: 0, text: '<h1 class="title">Ship' };
  f.delta({ agentId: 'a', path: 'sections/hero/index.html', sectionId: 'hero', part: 'html', rev: 41, splice });
  assert.deepEqual(out, [{ type: 'design-delta', designId: 'd', buildId: 'b', seq: 1, ts: 1000, agentId: 'a',
    path: 'sections/hero/index.html', sectionId: 'hero', part: 'html', rev: 41, splice }]);
});
test('fields never overwrite the common fields, so seq only goes up', () => {
  const { f, out } = setup({ seqStart: 10 });
  f.send('design-plan', { type: 'other', designId: 'x', buildId: 'y', seq: 1, ts: 5, planRev: 2 });
  f.agent('a', { agentId: 'z', seq: 1, status: 'thinking' });
  assert.deepEqual(out[0], { type: 'design-plan', designId: 'd', buildId: 'b', seq: 11, ts: 1000, planRev: 2 });
  assert.deepEqual([out[1].agentId, out[1].seq], ['a', 12]);
});
test('send of a design-build or design-agent frame keeps its throttle and its terminal rule', () => {
  const out = []; const timers = new Set();
  const f = createFrameEmitter({ designId: 'd', buildId: 'b', emit: (x) => out.push(x), now: () => 1000,
    setTimer: (fn) => { const h = { fn }; timers.add(h); return h; }, clearTimer: (h) => { timers.delete(h); } });
  const fire = () => { const a = [...timers]; timers.clear(); for (const h of a) h.fn(); };
  f.send('design-build', { status: 'building', stats: { layers: 1 } });
  f.send('design-build', { status: 'building', stats: { layers: 2 } });
  f.send('design-agent', { agentId: 'a', status: 'writing' }); f.send('design-agent', { agentId: 'a', status: 'reading' });
  assert.deepEqual(out.map((x) => x.type), ['design-build', 'design-agent']);
  f.send('design-build', { status: 'done', stats: { layers: 3 } });
  fire();
  const of = (type) => out.filter((x) => x.type === type).map((x) => x.status);
  assert.deepEqual(of('design-build'), ['building', 'done'], 'the pending building frame never lands after done');
  assert.deepEqual(of('design-agent'), ['writing', 'reading']);
  assert.equal(out.find((x) => x.type === 'design-agent').agentId, 'a');
});
test('after a trailing frame the window starts again: the next frame waits out the rest of it', () => {
  const out = []; const t = []; let clock = 1000;
  const f = createFrameEmitter({ designId: 'd', buildId: 'b', emit: (x) => out.push(x), now: () => clock,
    setTimer: (fn, ms) => { t.push({ fn, ms }); return t.length; }, clearTimer: () => {} });
  f.build({ status: 'building', stats: { layers: 1 } }); f.build({ status: 'building', stats: { layers: 2 } });
  assert.deepEqual(t.map((x) => x.ms), [500]);
  clock += 500; t.shift().fn();
  assert.deepEqual(out.map((x) => [x.stats.layers, x.ts]), [[1, 1000], [2, 1500]]);
  clock += 100; f.build({ status: 'building', stats: { layers: 3 } });
  assert.equal(out.length, 2, 'two frames in 100 ms would break 2 Hz');
  assert.deepEqual(t.map((x) => x.ms), [400]);
  clock += 900; f.build({ status: 'building', stats: { layers: 4 } });
  assert.equal(out.length, 2, 'a late timer still owns its window: nothing jumps ahead of it');
  t.shift().fn();
  assert.deepEqual([layers(out), out.at(-1).ts], [[1, 2, 4], 2500]);
  clock += 100; f.build({ status: 'building', stats: { layers: 5 } }); f.flush();
  clock += 100; f.build({ status: 'building', stats: { layers: 6 } });
  assert.deepEqual([layers(out), t.at(-1).ms], [[1, 2, 4, 5], 400], 'a flushed frame starts a window too');
  clock += 1000; for (const x of t.splice(0)) x.fn();
  clock += 600; f.build({ status: 'building', stats: { layers: 7 } });
  assert.deepEqual([layers(out), t.length], [[1, 2, 4, 5, 6, 7], 0], 'a quiet window lets the next frame go now');
});
test('a timer that fires after the terminal frame sends nothing, and an emit that throws there is caught', () => {
  const out = []; const t = []; let fail = false; const errs = [];
  const f = createFrameEmitter({ designId: 'd', buildId: 'b', now: () => 1000,
    emit: (x) => { if (fail) throw new Error('socket gone'); out.push(x); },
    setTimer: (fn) => { t.push(fn); return t.length; }, clearTimer: () => {} });
  f.agent('a', { status: 'writing' }); f.agent('a', { status: 'reading' }); f.agent('a', { status: 'stopped' });
  f.agent('a', { status: 'retrying' });
  t.shift()();
  assert.deepEqual(out.map((x) => x.status), ['writing', 'stopped'], 'a clearTimer that missed sends nothing old, nothing early');
  t.shift()();
  assert.equal(out.at(-1).status, 'retrying');
  f.build({ status: 'building' }); f.build({ status: 'integrating' });
  fail = true;
  const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
  try { assert.doesNotThrow(() => t.shift()()); } finally { console.error = orig; }
  assert.match(errs.join('\n'), /socket gone/);
  fail = false; f.flush();
  assert.equal(out.at(-1).status, 'building', 'the failed frame is not sent twice');
});
test('a terminal frame starts a window too; a frame a whole window after the last goes now', () => {
  const { f, out, fire, tick } = setup();
  f.build({ status: 'building', stats: { layers: 1 } });
  tick(400); f.build({ status: 'paused', stats: { layers: 1 } });
  tick(100); f.build({ status: 'building', stats: { layers: 2 } });
  assert.deepEqual(out.map((x) => x.status), ['building', 'paused'], 'two frames 100 ms apart would break 2 Hz');
  tick(400); fire();
  assert.deepEqual(out.map((x) => [x.status, x.ts]), [['building', 1000], ['paused', 1400], ['building', 1900]]);
  tick(500); f.build({ status: 'building', stats: { layers: 3 } });
  assert.deepEqual(layers(out), [1, 1, 2, 3], 'exactly 500 ms after the last frame is still 2 Hz');
});
test('design-file: the 256 KiB text limit counts UTF-8 bytes, not characters', () => {
  const { f, out } = setup();
  f.file({ path: 'p', sectionId: 'x', part: 'html', rev: 1, text: 'é'.repeat(131072) });
  f.file({ path: 'p', sectionId: 'x', part: 'html', rev: 2, text: 'é'.repeat(131073) });
  assert.deepEqual(out.map((x) => [x.bytes, 'text' in x]), [[262144, true], [262146, false]]);
});
