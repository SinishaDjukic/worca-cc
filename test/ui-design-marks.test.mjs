// test/ui-design-marks.test.mjs — the Design stage model's facts (ui/public/design/stage-model.mjs): where each cursor
// stands, and the marks the overlay draws, each from a real C-5 frame or C-6 bridge message (U3). Frames and bridge
// messages come from test/helpers/design-stage-frames.mjs, shaped as P2 and P3 send them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialStage, selectCursors, selectMarks, pruneGuides, draftTarget, pinLabel,
} from '../ui/public/design/stage-model.mjs';
import { DID, BID, A1, A2, LEAD, build, plan, agent, section, delta, applied, rects, run } from './helpers/design-stage-frames.mjs';

const S = (steps) => run(initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 } }), steps).state;
const HERO = ['hero', 100, 200, 500, 300];
const WRITING = [build(), plan(['hero', 'price']), rects([HERO, ['price', 100, 600, 500, 300]]), agent(A1, 'writing')];
const pos = (s, id) => { const c = selectCursors(s).find((x) => x.agentId === id); return [c.x, c.y]; };
const TAIL = { rect: [300, 230, 8, 20], tag: 'p', box: [100, 220, 500, 58] };

test('position ladder: tail, else section rect, else lead home', () => {
  assert.deepEqual(pos(S(WRITING), A1), [110, 203]);
  assert.deepEqual(pos(S([...WRITING, applied('hero', { tail: TAIL })]), A1), [310, 240]);
  assert.deepEqual(pos(S([build('planning'), agent(LEAD, 'writing', { role: 'lead', job: 'Lead', sectionId: null })]), LEAD), [720, 360]);
});
test('U3: no movement without a fact', () => {
  const base = S([...WRITING, applied('hero', { tail: TAIL })]);
  const after = run(base, [
    build('building', { stats: { agentsNow: 9, costUsd: 3, elapsedMs: 99000 } }),
    agent(A1, 'thinking'), agent(A1, 'writing', { tool: { name: 'Write', path: 'sections/hero/index.html' } }),
    delta('sections/price/index.html', 1, 0, '<p>'), section('price', 'writing', { agentId: A2 }),
    rects([HERO, ['price', 100, 600, 500, 300]]),
    { type: 'design-question', designId: DID, buildId: BID, seq: 90, ts: 9, agentId: A2, askId: 'as_1', job: 'Price', heading: 'H', questions: [] },
  ], 60000).state;
  assert.deepEqual(pos(after, A1), [310, 240]);
});
test('a layout shift moves a cursor and its box by exactly its section\'s delta', () => {
  const s = run(S([...WRITING, applied('hero', { tail: TAIL })]), [rects([['hero', 100, 300, 500, 300], ['price', 100, 700, 500, 300]])]).state;
  assert.deepEqual(pos(s, A1), [310, 340]);
  assert.deepEqual(selectMarks(s).boxes[0].rect, [100, 320, 500, 58]);
});
test('a lead that reads a section moves there, with an orange box; a builder keeps its place', () => {
  const read = { tool: { name: 'Read', path: 'sections/hero/index.html' } };
  const lead = S([build('integrating'), plan(['hero']), rects([HERO]), agent(LEAD, 'reading', { role: 'lead', job: 'Lead', sectionId: null, ...read })]);
  assert.deepEqual(pos(lead, LEAD), [110, 203]);
  assert.deepEqual(selectMarks(lead).oranges, [{ key: LEAD, rect: [100, 200, 500, 300], tag: 'hero' }].map((o) => ({ ...o, tag: 'Hero' })));
  const grep = S([...WRITING, agent(A2, 'reading', { sectionId: 'price', job: 'Price', tool: { name: 'Grep', path: 'sections/hero/style.css' } })]);
  assert.deepEqual(pos(grep, A2), [110, 603]);
  assert.equal(selectMarks(grep).oranges.length, 1);
  const folder = S([...WRITING, agent(A2, 'reading', { sectionId: 'price', job: 'Price', tool: { name: 'Grep', path: 'sections/hero' } })]);
  assert.equal(selectMarks(folder).oranges.length, 1, 'P2 sends a Grep or Glob folder path');
  const bash = S([...WRITING, agent(A2, 'reading', { sectionId: 'price', job: 'Price', tool: { name: 'Bash', path: null } })]);
  assert.deepEqual(selectMarks(bash).oranges, []);
  const write = S([...WRITING, agent(A1, 'writing', { tool: { name: 'Write', path: 'sections/hero/index.html' } })]);
  assert.deepEqual(selectMarks(write).oranges, []);
});
test('blue box: the tail element, with a size tag; falls back through marks to the tail; only while writing', () => {
  const m = (s) => selectMarks(s).boxes;
  assert.deepEqual(m(S([...WRITING, applied('hero', { tail: TAIL })])), [{ key: A1, rect: [100, 220, 500, 58], tag: 'p 500×58' }]);
  const noBox = { rect: [300, 230, 8, 20], tag: 'h1' };
  assert.equal(m(S([...WRITING, applied('hero', { tail: noBox, marks: [{ rect: [100, 200, 400, 40], tag: 'h1', kind: 'el' }] })]))[0].tag, 'h1 400×40');
  assert.equal(m(S([...WRITING, applied('hero', { tail: noBox })]))[0].tag, 'h1 8×20');
  assert.deepEqual(m(S([...WRITING, applied('hero', { tail: TAIL }), agent(A1, 'thinking')])), []);
  assert.deepEqual(m(S([...WRITING, applied('hero', { tail: TAIL }), agent(A1, 'done')])), []);
});
test('+ marks: one per planned section at its slot, gone once it starts or is removed', () => {
  const s = S([build(), plan(['hero', 'price']), rects([HERO, ['price', 100, 600, 500, 20]])]);
  assert.deepEqual(selectMarks(s).plus, [{ key: 'hero', x: 116, y: 214 }, { key: 'price', x: 116, y: 610 }]);
  assert.deepEqual(selectMarks(run(s, [section('hero', 'writing', { agentId: A1 })]).state).plus.map((p) => p.key), ['price']);
  assert.deepEqual(selectMarks(run(s, [section('price', 'removed')]).state).plus.map((p) => p.key), ['hero']);
});
test('guides: from a real new element at least 60 wide, red edge and blue edge with the job, 500 ms apart, at most 6, gone after their life', () => {
  const big = (x) => ({ marks: [{ rect: [x, 300, 200, 40], tag: 'p', kind: 'el' }], tail: TAIL });
  let s = run(S(WRITING), [applied('hero', big(100))], 1000).state;
  assert.deepEqual(selectMarks(s, 1000).guides.map((g) => [g.kind, g.color, g.kind === 'v' ? g.x : g.y, g.ms, g.tag ?? null]),
    [['v', 'red', 100, 1100, null], ['h', 'blue', 300, 900, 'Hero']]);
  assert.deepEqual([selectMarks(s, 1000).guides[0].y0, selectMarks(s, 1000).guides[0].y1], [60, 800]);
  assert.equal(selectMarks(run(s, [applied('hero', big(110))], 1400).state, 1400).guides.length, 2, 'too soon');
  assert.equal(selectMarks(run(S(WRITING), [applied('hero', { marks: [{ rect: [1, 1, 59, 9], tag: 'b', kind: 'el' }] })], 0).state).guides.length, 0, 'too narrow');
  for (let t = 1500; t < 4000; t += 500) s = run(s, [applied('hero', big(t))], t).state;
  assert.ok(selectMarks(s, 3500).guides.length <= 6);
  assert.deepEqual(selectMarks(pruneGuides(s, 99999), 99999).guides, []);
  const reduced = run(initialStage({ designId: DID, kind: 'web', canvas: { w: 1440 }, reduced: true }), [...WRITING, applied('hero', big(100))], 1000).state;
  assert.deepEqual(selectMarks(reduced, 1000).guides, []);
});
test('red box only from a measured overflow; clears when it stops', () => {
  const on = S([...WRITING, applied('hero', { rect: [100, 200, 1500, 300], overflow: true })]);
  assert.deepEqual(selectMarks(on).reds, [{ key: 'hero', rect: [100, 200, 1500, 300], tag: 'Overflow' }]);
  assert.deepEqual(selectMarks(run(on, [applied('hero', { overflow: false })]).state).reds, []);
});
test('wireframe: media marks only, the largest is main with its size, gone when the section is done', () => {
  const s = S([...WRITING, applied('hero', { marks: [{ rect: [0, 0, 640, 400], tag: 'img', kind: 'media' }, { rect: [0, 0, 50, 50], tag: 'circle', kind: 'media' }, { rect: [0, 0, 90, 90], tag: 'p', kind: 'el' }] })]);
  assert.deepEqual(selectMarks(s).wires.map((w) => [w.tag, w.main]), [['img 640×400', true], [null, false]]);
  assert.deepEqual(selectMarks(run(s, [section('hero', 'done')]).state).wires, []);
});
test('failed section: dashed box and a chip from design-section; slot lines only while planning; js meter from real bytes', () => {
  const s = S([...WRITING, section('hero', 'failed')]);
  assert.deepEqual(selectMarks(s).failed, [{ key: 'hero', rect: [100, 200, 500, 300], tag: 'Hero failed' }]);
  const p = S([build('planning'), plan(['hero']), rects([HERO])]);
  assert.deepEqual(selectMarks(p).slotLines, [{ key: 'hero', y: 200, tag: 'Hero' }]);
  assert.deepEqual(selectMarks(S(WRITING)).slotLines, []);
  const js = S([...WRITING, delta('sections/hero/script.js', 1, 0, 'x'.repeat(2150), { part: 'js' })]);
  assert.deepEqual(selectMarks(js).meters, [{ key: 'hero', rect: [100, 200, 500, 300], text: 'js 2.1 KB' }]);
});
test('a finished round shows no marks but pins', () => {
  const s = S([...WRITING, applied('hero', { tail: TAIL, overflow: true }), build('done'), { t: 'picked', id: 'hero', path: 'p', tag: 'h1', text: 'Ship it', html: '<h1>', rect: [1, 2, 3, 4] }]);
  const m = selectMarks(s);
  for (const k of ['boxes', 'oranges', 'reds', 'wires', 'guides', 'plus', 'slotLines', 'failed', 'meters']) assert.deepEqual(m[k], [], k);
  assert.deepEqual(m.pins, [{ key: 'hero|p', rect: [1, 2, 3, 4], tag: 'Hero › "Ship it"' }]);
});
test('draftTarget', () => {
  for (const [p, want] of [
    ['sections/hero/index.html', { sectionId: 'hero', part: 'html' }], ['sections/hero/style.css', { sectionId: 'hero', part: 'css' }],
    ['sections/hero/script.js', { sectionId: 'hero', part: 'js' }], ['sections\\hero\\index.html', { sectionId: 'hero', part: 'html' }],
    ['tokens.css', { sectionId: null, part: 'css', file: 'tokens' }], ['global.css', { sectionId: null, part: 'css', file: 'global' }],
    ['shell.html', null], ['plan.json', null], ['sections/hero/assets/a.svg', null], ['assets/x.png', null]]) assert.deepEqual(draftTarget(p), want, p);
});

// Beyond the plan's list: the rules of Task 4 that the cases above do not reach.

const lead = (status, o = {}) => agent(LEAD, status, { role: 'lead', job: 'Lead', sectionId: null, ...o });
const at = (y, vh = 900) => rects([HERO], { scrollY: y, vh });

test('the integrating lead\'s home is stored once from the scroll, whichever of its frame and the build\'s comes second', () => {
  const buildFirst = S([build('integrating'), plan(['hero']), at(1000), lead('thinking')]);
  assert.deepEqual(pos(buildFirst, LEAD), [720, 1270]);
  assert.deepEqual(pos(run(buildFirst, [at(3000), lead('writing')]).state, LEAD), [720, 1270], 'a later scroll does not move it');
  const leadFirst = S([build('building'), plan(['hero']), at(1000), lead('thinking'), at(2000)]);
  assert.deepEqual(pos(leadFirst, LEAD), [720, 360]);
  assert.deepEqual(pos(run(leadFirst, [build('integrating'), at(5000)]).state, LEAD), [720, 2270]);
  assert.deepEqual(pos(S([build('integrating'), lead('thinking'), at(1000)]), LEAD), [720, 360], '360 while scroll.vh is 0');
  const read = run(buildFirst, [lead('reading', { tool: { name: 'Read', path: 'sections/hero/index.html' } })]).state;
  assert.deepEqual(pos(read, LEAD), [110, 203]);
  assert.deepEqual(pos(run(read, [lead('thinking', { tool: { name: 'Read', path: 'sections/hero/index.html' } })]).state, LEAD), [720, 1270], 'a lead whose read clears goes back home');
  const resumed = run(buildFirst, [build('paused'), at(4000), build('integrating'), lead('thinking')]).state;
  assert.deepEqual(pos(resumed, LEAD), [720, 4270], 'a new integrating stretch stores a new home');
});
test('a section id that names an Object property is just an id', () => {
  const s = S([build(), agent(A1, 'writing', { sectionId: 'constructor', job: 'C' })]);
  assert.deepEqual(pos(s, A1), [720, 360]);
  assert.equal(pinLabel(s, { id: 'constructor', tag: 'p', text: '' }), 'constructor › p');
});
test('reading: only while the status is reading, with Read, Grep or Glob, of a section the plan holds', () => {
  const reader = (status, name, path) => S([...WRITING, agent(A2, status, { sectionId: 'price', job: 'Price', tool: { name, path } })]);
  assert.deepEqual(selectMarks(reader('thinking', 'Read', 'sections/hero/index.html')).oranges, [], 'P2 sends {thinking, tool: Read} after the read');
  assert.deepEqual(selectMarks(reader('reading', 'Glob', 'sections/footer')).oranges, [], 'not a planned section');
  const measured = S([build(), plan(['hero', 'price']), rects([HERO, ['footer', 100, 900, 500, 100]]), agent(A2, 'reading', { sectionId: 'price', job: 'Price', tool: { name: 'Glob', path: 'sections/footer' } })]);
  assert.deepEqual(selectMarks(measured).oranges, [], 'a section the frame shows but the plan does not hold');
  assert.deepEqual(selectMarks(reader('reading', 'Read', 'sectionsx/hero/index.html')).oranges, []);
  assert.deepEqual(selectMarks(reader('reading', 'Bash', 'sections/hero')).oranges, [], 'any other tool reads nothing');
  assert.deepEqual(selectMarks(reader('reading', 'Read', 'sections\\hero\\index.html')).oranges, [{ key: A2, rect: [100, 200, 500, 300], tag: 'Hero' }]);
});
test('a cursor leaves from where it is: its tail, else its section', () => {
  const tailed = run(S([...WRITING, applied('hero', { tail: TAIL })]), [agent(A1, 'done')]).effects.find((e) => e.type === 'leave');
  assert.deepEqual([tailed.x, tailed.y], [310, 240]);
  const ended = run(S(WRITING), [build('stopped')]).effects.find((e) => e.type === 'leave');
  assert.deepEqual([ended.x, ended.y], [110, 203]);
});
test('applied: no agent on stage changes only layers, the section rect and overflow; a rect it brings shifts nothing', () => {
  const media = { rect: [100, 300, 640, 400], tag: 'img', kind: 'media' };
  const s = run(S([build(), plan(['hero']), rects([HERO])]), [applied('hero', { layers: 7, rect: [100, 250, 500, 300], overflow: true, tail: TAIL, marks: [media, { rect: [100, 300, 200, 40], tag: 'p', kind: 'el' }] })], 1000).state;
  const m = selectMarks(s, 1000);
  assert.equal(s.layers, 7);
  assert.deepEqual([m.reds, m.wires, m.guides, m.plus], [[{ key: 'hero', rect: [100, 250, 500, 300], tag: 'Overflow' }], [], [], [{ key: 'hero', x: 116, y: 264 }]]);
  assert.deepEqual(pos(run(s, [agent(A1, 'writing')]).state, A1), [110, 253], 'the tail was nobody\'s');
  const gone = run(S([...WRITING, agent(A1, 'done')]), [applied('hero', { tail: TAIL, marks: [media, { rect: [100, 300, 200, 40], tag: 'p', kind: 'el' }] })], 1000).state;
  assert.deepEqual([selectMarks(gone, 1000).wires, selectMarks(gone, 1000).guides, gone.agents[A1].pos], [[], [], null], 'an agent that left takes nothing');
  const tailed = S([...WRITING, applied('hero', { tail: TAIL })]);
  const moved = run(tailed, [applied('hero', { rect: [100, 300, 500, 300], tail: { rect: [300, 330, 8, 20], tag: 'p', box: [100, 320, 500, 58] } }), rects([['hero', 100, 300, 500, 300]])]).state;
  assert.deepEqual(pos(moved, A1), [310, 340], 'the fresh tail is not shifted again');
});
test('rects replace the known rects; wires and pins move with their section', () => {
  const s = S([...WRITING, applied('hero', { marks: [{ rect: [100, 220, 640, 400], tag: 'img', kind: 'media' }] }), { t: 'picked', id: 'hero', path: 'p', tag: 'h1', text: 'Hi', html: '<h1>', rect: [100, 230, 50, 20] }]);
  const r = run(s, [rects([['hero', 120, 260, 500, 300]])]).state;
  const m = selectMarks(r);
  assert.deepEqual([m.wires[0].rect, m.pins[0].rect], [[120, 280, 640, 400], [120, 290, 50, 20]]);
  assert.deepEqual(m.plus.map((p) => p.key), ['hero'], 'price left the list, so its rect is no longer known');
  assert.equal(run(r, [rects([['hero', 120, 260, 500, 300]])]).state, r, 'nothing new measured: the same state');
  assert.notEqual(run(r, [rects([['hero', 120, 260, 500, 300]], { scrollY: 5 })]).state, r);
});
test('pins: one per id and path, labelled by the section\'s job, cut at 22 characters', () => {
  const pick = (o) => ({ t: 'picked', id: 'hero', path: 'p', tag: 'h1', text: '', html: '<h1>', rect: [1, 2, 3, 4], ...o });
  const s = S([...WRITING, pick({ text: 'First' }), pick({ path: 'q', tag: 'img' }), pick({ text: 'Again' })]);
  assert.deepEqual(selectMarks(s).pins.map((p) => [p.key, p.tag]), [['hero|p', 'Hero › "Again"'], ['hero|q', 'Hero › img']]);
  assert.equal(pinLabel(s, { id: 'hero', tag: 'h1', text: 'A heading that runs well past the cut' }), 'Hero › "A heading that runs we…"');
  assert.deepEqual(['Twenty two characters!', 'Twenty three characters', 'Two lines\nof text'].map((text) => pinLabel(s, { id: 'hero', tag: 'p', text })),
    ['Hero › "Twenty two characters!"', 'Hero › "Twenty three character…"', 'Hero › "Two lines"']);
  assert.equal(pinLabel(S([build()]), { id: 'promo', tag: 'p', text: '' }), 'promo › p', 'the section id without a plan job');
});
test('a halted round keeps only +, failed boxes and pins', () => {
  for (const st of ['stopped', 'paused', 'error', 'interrupted']) {
    const s = S([...WRITING, section('price', 'failed'), applied('hero', { tail: TAIL, overflow: true, marks: [{ rect: [100, 300, 640, 400], tag: 'img', kind: 'media' }, { rect: [100, 300, 200, 40], tag: 'p', kind: 'el' }] }),
      delta('sections/hero/script.js', 1, 0, 'x'), { t: 'picked', id: 'hero', path: 'p', tag: 'h1', text: '', html: '<h1>', rect: [1, 2, 3, 4] }, build(st)]);
    const m = selectMarks(s);
    for (const k of ['boxes', 'oranges', 'reds', 'wires', 'guides', 'slotLines', 'meters']) assert.deepEqual(m[k], [], `${st} ${k}`);
    assert.deepEqual([m.plus.map((p) => p.key), m.failed.map((f) => f.key), m.pins.map((p) => p.key)], [['hero'], ['price'], ['hero|p']], st);
  }
});
test('guides: a pair is added only while at most 4 are live, so never a 7th; from the first element at least 60 wide', () => {
  const big = (x) => ({ marks: [{ rect: [x, 300, 200, 40], tag: 'p', kind: 'el' }] });
  let s = S(WRITING);
  for (const t of [1000, 1500, 2000]) s = run(s, [applied('hero', big(t))], t).state;
  assert.equal(selectMarks(s, 2000).guides.length, 6);
  s = run(s, [applied('hero', big(2500))], 2500).state;
  assert.equal(selectMarks(s, 2500).guides.length, 5, 'five live after pruning: no new pair');
  s = run(s, [applied('hero', big(3000))], 3000).state;
  const keys = selectMarks(s, 3000).guides.map((g) => g.key);
  assert.deepEqual([keys.length, new Set(keys).size, s.guides.length], [5, 5, 5], 'an added pair drops the ended ones');
  assert.deepEqual(selectMarks(run(S(WRITING), [applied('hero', { marks: [{ rect: [7, 300, 60, 40], tag: 'p', kind: 'el' }] })], 0).state).guides.map((g) => g.x ?? g.y), [7, 300], 'exactly 60 wide');
  const first = run(S(WRITING), [applied('hero', { marks: [{ rect: [5, 5, 30, 9], tag: 'b', kind: 'el' }, { rect: [0, 0, 640, 400], tag: 'img', kind: 'media' }, { rect: [40, 300, 200, 40], tag: 'p', kind: 'el' }, { rect: [70, 400, 300, 40], tag: 'p', kind: 'el' }] })], 0).state;
  assert.deepEqual(selectMarks(first).guides.map((g) => g.x ?? g.y), [40, 300]);
});
test('the box is the newest element; wires are the latest apply\'s media; slot lines skip a removed section', () => {
  const two = [{ rect: [100, 200, 400, 40], tag: 'h1', kind: 'el' }, { rect: [100, 250, 300, 20], tag: 'p', kind: 'el' }];
  assert.equal(selectMarks(S([...WRITING, applied('hero', { tail: { rect: [300, 250, 8, 20], tag: 'p' }, marks: two })])).boxes[0].tag, 'p 300×20');
  const img = S([...WRITING, applied('hero', { marks: [{ rect: [0, 0, 640, 400], tag: 'img', kind: 'media' }] })]);
  assert.deepEqual(selectMarks(run(img, [applied('hero', { marks: two })]).state).wires, [], 'the agent moved on from the image');
  const p = S([build('planning'), plan(['hero', 'price']), rects([HERO, ['price', 100, 600, 500, 300]]), section('hero', 'removed')]);
  assert.deepEqual(selectMarks(p).slotLines.map((l) => l.key), ['price']);
  assert.deepEqual(selectMarks(run(p, [agent(A2, 'writing', { sectionId: 'price', job: 'Price' })]).state).slotLines, [], 'L4.35: a builder on stage while planning is building');
});
test('the js meter follows splices: bytes under 1 KB, an Edit deletes, other parts do not count', () => {
  const js = (rev, text, o) => delta('sections/hero/script.js', rev, 0, text, o);
  assert.deepEqual(selectMarks(S([...WRITING, js(1, 'x'.repeat(900)), js(2, '', { del: 100 }), js(3, 'y'.repeat(12))])).meters.map((m) => m.text), ['js 812 B']);
  assert.deepEqual(selectMarks(S([...WRITING, delta('sections/hero/index.html', 1, 0, 'x'.repeat(5000))])).meters, []);
});
