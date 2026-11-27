// test/ui-shape-run-order-map.test.mjs — Shaper small runs slice 9 (R-ux-4, R-qa-4): the still run order map, its pure
// layout (runOrderLayout: columns, rows, the links that still hold a run back, routing) and its painter
// (renderRunOrderMap). Literal featureView slice rows of the 16-run feature; no database, no server.
// The module is imported inside each test, so each behaviour fails on its own until it exists.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { ORDER_STATES, SIXTEEN_PAIRS, sixteenSlices, slicesOf } from './helpers/shape-order-slices.mjs';
import { runStatus } from '../src/shared/shape/run-status.mjs';
import { runModel } from '../src/shared/run-model.mjs';
import { markDot, renderStatusDot } from '../ui/public/status-dot.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const MODULE = new URL('../ui/public/shape/run-order-map.mjs', import.meta.url);
const trackDom = useDomRelease(afterEach);
const load = () => import('../ui/public/shape/run-order-map.mjs');
const newDoc = () => trackDom(new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true })).window.document;

const EMPTY = { width: 0, height: 0, runs: [], links: [], implied: [] };
const BASE_LINKS = [[2, 7], [2, 8], [3, 4], [3, 10], [4, 5], [5, 6], [6, 7], [7, 12], [8, 15], [9, 16], [10, 12], [12, 16],
  [13, 14], [14, 15], [15, 16]];
/** Every reduced link of the 16-run feature: the base ones plus those from runs 1 and 11, which base has finished. */
const ALL_LINKS = [...BASE_LINKS, [1, 2], [1, 3], [11, 13]].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const IMPLIED = [[1, 4], [3, 5], [3, 6], [1, 7], [3, 7], [4, 7], [5, 7], [1, 8], [1, 12], [11, 14], [13, 15], [11, 16], [13, 16], [14, 16]];

const pairs = (links) => links.map((l) => [l.from, l.to]);
const sorted = (list) => [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const byRun = (layout) => new Map(layout.runs.map((r) => [r.index, r]));
const has = (layout, from, to) => layout.links.some((l) => l.from === from && l.to === to);
const segments = (link) => link.points.slice(1).map((p, i) => [link.points[i], p]);
const span = ([[ax, ay], [bx, by]]) => ({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) });
/** A segment inside a box's interior (a link may start or end on its own dot's edge). */
const meetsOpen = (seg, box) => { const s = span(seg); return s.x0 < box.x1 && s.x1 > box.x0 && s.y0 < box.y1 && s.y1 > box.y0; };
/** A segment that touches a box at all. */
const meetsClosed = (seg, box) => { const s = span(seg); return s.x0 <= box.x1 && s.x1 >= box.x0 && s.y0 <= box.y1 && s.y1 >= box.y0; };
const dotBox = (r) => ({ x0: r.x - 6, y0: r.y - 6, x1: r.x + 6, y1: r.y + 6 });
const labelBox = (r) => ({ x0: r.x + 7, y0: r.y - 12, x1: r.x + 7 + 7 * String(r.index).length, y1: r.y - 1 });
/** Every (link, run) pair where a segment meets the run's dot or label box; the boxes come from the run's centre. */
function crossings(layout) {
  const out = [];
  for (const link of layout.links) {
    for (const seg of segments(link)) {
      for (const r of layout.runs) {
        if (meetsOpen(seg, dotBox(r))) out.push(`${link.from}→${link.to} meets the dot of run ${r.index}`);
        if (meetsClosed(seg, labelBox(r))) out.push(`${link.from}→${link.to} meets the label of run ${r.index}`);
      }
    }
  }
  return out;
}
/**
 * Pairs of links that share no run yet draw as one line: two parallel segments less than 3px apart whose stretches overlap
 * or end less than 3px from each other (an exit stub lined up with another link's entry stub reads as a false link).
 */
function falseJoins(layout) {
  const out = [];
  const links = layout.links;
  for (let i = 0; i < links.length; i += 1) {
    for (let j = i + 1; j < links.length; j += 1) {
      const p = links[i];
      const q = links[j];
      if (p.from === q.from || p.to === q.to || p.from === q.to || p.to === q.from) continue;
      for (const s of segments(p).map(span)) {
        for (const t of segments(q).map(span)) {
          const sv = s.x0 === s.x1;
          if (sv !== (t.x0 === t.x1)) continue;
          const apart = sv ? Math.abs(s.x0 - t.x0) : Math.abs(s.y0 - t.y0);
          const gap = sv ? Math.max(t.y0 - s.y1, s.y0 - t.y1) : Math.max(t.x0 - s.x1, s.x0 - t.x1);
          if (apart < 3 && gap < 3) out.push(`${p.from}→${p.to} & ${q.from}→${q.to}`);
        }
      }
    }
  }
  return [...new Set(out)];
}
/** Longest-path depth over `buildsOn`, for an acyclic list. */
function depths(slices) {
  const map = new Map(slices.map((s) => [s.index, s]));
  const memo = new Map();
  const of = (i) => {
    if (!memo.has(i)) memo.set(i, map.get(i).buildsOn.length ? 1 + Math.max(...map.get(i).buildsOn.map(of)) : 0);
    return memo.get(i);
  };
  return new Map(slices.map((s) => [s.index, of(s.index)]));
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 200 seeded graphs of 6 to 20 runs, each run building on some lower-numbered ones; every run planned. */
function randomGraphs() {
  const rnd = mulberry32(9137);
  return Array.from({ length: 200 }, () => {
    const n = 6 + Math.floor(rnd() * 15);
    const p = 0.05 + rnd() * 0.45;
    const links = Array.from({ length: n }, (_, i) => [i + 1, Array.from({ length: i }, (__, d) => d + 1).filter(() => rnd() < p)]);
    return slicesOf(links);
  });
}
/** Runs 1–5 in a chain, all done unless `five` says otherwise, plus small change run 6 on run 5. */
function changeChain({ five = 'done', six = {} } = {}) {
  const links = [[1, []], [2, [1]], [3, [2]], [4, [3]], [5, [4]], [6, [5]]];
  return slicesOf(links, { done: [1, 2, 3, 4], states: { 5: { state: five }, 6: { kind: 'change', ...six } } });
}
/**
 * The run the feature page row holds for a slice in this state, as runModel reads it (a test-side table, so the map's
 * own mapping is never its oracle). Any other state is a run not started, or one whose mark decides its dot.
 */
const ROW_RUN = {
  paused: { status: 'paused' }, stopped: { status: 'stopped' }, error: { status: 'error' },
  canceled: { ticket: { status: 'canceled' } }, failed: { ticket: { status: 'failed' } },
};
const NOT_STARTED_RUN = { ticket: { status: 'scheduled' } };
/** The class a row's dot takes for slice `index`: the row's run model, repainted by the run's mark. */
function rowDotClass(doc, slices, index) {
  const map = new Map(slices.map((s) => [s.index, s]));
  const slice = map.get(index);
  const st = runStatus({ slice, slices: map, snap: null });
  return renderStatusDot(doc, markDot(runModel(ROW_RUN[slice.state] || NOT_STARTED_RUN), st.mark, st.word)).className;
}
/** Every run of `slices` finished. */
const allDone = (slices) => slices.map(({ waitsFor, ...s }) => ({ ...s, state: 'done' }));
const classesOf = (el) => [...el.classList].filter((c) => c !== 'status-dot').sort();
const runEl = (root, index) => root.querySelector(`.rom-run[data-run="${index}"]`);
const dotOf = (root, index) => runEl(root, index).querySelector('.status-dot');
/** The points an SVG path's `d` draws (absolute M, L, H and V). */
function pathPoints(d) {
  const out = [];
  let at = [0, 0];
  for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    assert.ok('MLHV'.includes(cmd), `path command ${cmd} in "${d}" is not an absolute straight line`);
    const nums = (args.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const step = cmd === 'M' || cmd === 'L' ? 2 : 1;
    for (let i = 0; i < nums.length; i += step) {
      at = cmd === 'H' ? [nums[i], at[1]] : cmd === 'V' ? [at[0], nums[i]] : [nums[i], nums[i + 1]];
      out.push(at);
    }
  }
  return out;
}

// ── layout ──
test('layout: every run\'s column is right of each run it builds on', async () => {
  const { runOrderLayout } = await load();
  const sixteen = byRun(runOrderLayout(sixteenSlices('base')));
  assert.equal(sixteen.size, 16);
  assert.deepEqual([sixteen.get(7).col, sixteen.get(12).col, sixteen.get(16).col], [5, 6, 7]);
  const graphs = [sixteenSlices('none'), ...randomGraphs()];
  assert.equal(graphs.length, 201);
  for (const slices of graphs) {
    const runs = byRun(runOrderLayout(slices));
    const want = depths(slices);
    assert.equal(runs.size, slices.length);
    for (const s of slices) {
      for (const d of s.buildsOn) assert.ok(runs.get(s.index).col > runs.get(d).col, `run ${s.index} is right of run ${d}`);
      assert.equal(runs.get(s.index).col, want.get(s.index), `run ${s.index}: the longest path to it`);
    }
  }
});

test('layout: rows follow run number inside a column', async () => {
  const { runOrderLayout } = await load();
  // The slices arrive out of order: the rows still follow the run numbers.
  const { runs } = runOrderLayout(sixteenSlices('base').reverse());
  const column = (c) => runs.filter((r) => r.col === c).sort((a, b) => a.row - b.row).map((r) => r.index);
  assert.deepEqual(column(2), [4, 8, 10, 14]);
  assert.deepEqual(column(0), [1, 9, 11]);
  assert.deepEqual(runs.filter((r) => r.col === 2).map((r) => r.row).sort(), [0, 1, 2, 3]);
});

test('layout: the pixel geometry places each dot, its label and the drawing\'s size', async () => {
  const { RUN_ORDER_GEOMETRY, runOrderLayout } = await load();
  assert.deepEqual({ ...RUN_ORDER_GEOMETRY },
    { COL_W: 64, ROW_H: 36, PAD: 24, DOT: 12, LABEL_PX: 11, DIGIT_W: 7, GAP_X: 22, LANE_Y: 7, TRACK: 4, GAP_TRACKS: 9,
      LANE_TRACKS: 5 });
  assert.ok(Object.isFrozen(RUN_ORDER_GEOMETRY));
  const layout = runOrderLayout(sixteenSlices('base'));
  assert.deepEqual([layout.width, layout.height], [48 + 7 * 64, 48 + 3 * 36]);
  for (const r of layout.runs) {
    assert.deepEqual([r.x, r.y], [24 + r.col * 64, 24 + r.row * 36], `run ${r.index}`);
    assert.deepEqual(r.dot, dotBox(r), `run ${r.index}'s dot box`);
    assert.deepEqual(r.label, labelBox(r), `run ${r.index}'s label box`);
  }
});

test('layout: each run carries the row\'s own mark, word and kind', async () => {
  const { runOrderLayout } = await load();
  const slices = sixteenSlices('busy');
  slices.find((s) => s.index === 13).kind = 'change';
  const map = new Map(slices.map((s) => [s.index, s]));
  const runs = byRun(runOrderLayout(slices));
  for (const s of slices) {
    const st = runStatus({ slice: s, slices: map, snap: null });
    const r = runs.get(s.index);
    assert.deepEqual([r.mark, r.word, r.kind], [st.mark, st.word, s.kind], `run ${s.index}`);
  }
});

test('layout: deterministic', async () => {
  const { runOrderLayout } = await load();
  for (const name of Object.keys(ORDER_STATES)) {
    assert.deepEqual(runOrderLayout(sixteenSlices(name)), runOrderLayout(sixteenSlices(name)), name);
  }
});

test('layout: finishing a run never moves a dot', async () => {
  const { runOrderLayout } = await load();
  const places = (spec) => runOrderLayout(sixteenSlices(spec)).runs.map((r) => [r.index, r.col, r.row, r.x, r.y]).sort((a, b) => a[0] - b[0]);
  const none = places('none');
  assert.equal(none.length, 16);
  const allDone = { done: SIXTEEN_PAIRS.map(([run]) => run) };
  for (const spec of ['base', 'busy', 'held', allDone]) assert.deepEqual(places(spec), none, JSON.stringify(spec));
});

// ── which links are drawn ──
test('holding: base draws exactly the 15 links', async () => {
  const { runOrderLayout } = await load();
  assert.deepEqual(pairs(runOrderLayout(sixteenSlices('base')).links), BASE_LINKS);   // sorted (from, to)
});

test('holding: run 2 done draws no link from 2', async () => {
  const { runOrderLayout } = await load();
  const { done, states } = ORDER_STATES.base;
  const { 2: _two, ...rest } = states;
  const layout = runOrderLayout(sixteenSlices({ done: [...done, 2], states: rest }));
  assert.deepEqual(layout.links.filter((l) => l.from === 2), []);
  assert.ok(has(layout, 6, 7), '6→7 stays');
  assert.ok(has(layout, 8, 15), '8→15 stays');
  assert.deepEqual(pairs(layout.links), BASE_LINKS.filter(([from]) => from !== 2));
});

test('holding: a started target draws no incoming link', async () => {
  const { runOrderLayout } = await load();
  const layout = runOrderLayout(sixteenSlices('busy'));
  assert.equal(has(layout, 5, 6), false, 'run 6 is running, run 5 failed');
  assert.equal(has(layout, 4, 5), false, 'run 5 failed, run 4 is at a stop');
  assert.ok(has(layout, 2, 7) && has(layout, 6, 7), 'run 7 has not started');
  const started = new Set(sixteenSlices('busy').filter((s) => !['planned', 'held'].includes(s.state)).map((s) => s.index));
  assert.deepEqual(layout.links.filter((l) => started.has(l.to) || [1, 3].includes(l.from)), []);
});

test('holding: a held run (not started yet) keeps its incoming link', async () => {
  const { runOrderLayout } = await load();
  const slices = slicesOf([[1, []], [2, [1]]], { states: { 1: { state: 'running' }, 2: { state: 'held' } } });
  assert.deepEqual(pairs(runOrderLayout(slices).links), [[1, 2]]);
});

test('holding: a stop held until another run finishes keeps its incoming link', async () => {
  const { runOrderLayout } = await load();
  assert.ok(has(runOrderLayout(sixteenSlices('held')), 3, 4), 'run 4 is held after run 3, which is running');
  const atStop = (held) => slicesOf([[1, []], [2, [1]]],
    { states: { 1: { state: 'running' }, 2: { state: 'approval', stop: { reason: 'check', held } } } });
  assert.deepEqual(pairs(runOrderLayout(atStop(true)).links), [[1, 2]]);
  assert.deepEqual(runOrderLayout(atStop(false)).links.map((l) => [l.from, l.to, l.faint]), [[1, 2, true]],
    'a stop that is not held has started, so no link is open: the link is drawn faint');
});

test('holding: a link from a canceled run stays', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const { done, states } = ORDER_STATES.busy;
  const { 6: _six, ...rest } = states;
  const slices = sixteenSlices({ done, states: { ...rest, 5: { state: 'canceled' },
    6: { state: 'planned', waitsFor: [5], cannotStart: { run: 5, reason: 'canceled' } } } });
  const link = runOrderLayout(slices).links.find((l) => l.from === 5 && l.to === 6);
  assert.ok(link, '5→6 stays');
  assert.equal(link.faint, undefined, 'a link that holds a run back is not faint');
  const dot = dotOf(renderRunOrderMap(newDoc(), slices), 5);
  assert.ok(dot.classList.contains('is-dark-grey'), `a canceled run draws its row's dark grey dot (${dot.className})`);
  assert.equal(dot.classList.contains('is-grey-ring'), false, `never the hollow ring (${dot.className})`);
});

// ── no open link: every link, faint ──
test('faint: all done draws every reduced link, each faint', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const slices = sixteenSlices({ done: SIXTEEN_PAIRS.map(([run]) => run) });
  const { links } = runOrderLayout(slices);
  assert.equal(ALL_LINKS.length, 18);
  assert.deepEqual(pairs(links), ALL_LINKS);   // sorted (from, to), implied links left out
  assert.deepEqual(links.map((l) => l.faint), ALL_LINKS.map(() => true));
  const root = renderRunOrderMap(newDoc(), slices);
  assert.equal(root.querySelectorAll('.status-dot.is-green').length, 16);
  assert.equal(root.querySelectorAll('path.rom-link.is-faint').length, 18);
  assert.equal(root.querySelectorAll('path.rom-link:not(.is-faint)').length, 0);
});

test('faint: the faint drawing routes as the all-planned drawing', async () => {
  const { runOrderLayout } = await load();
  const graphs = [sixteenSlices('none'), ...randomGraphs()];
  assert.equal(graphs.length, 201);
  let checked = 0;
  for (const planned of graphs) {
    const name = JSON.stringify(planned.map((s) => [s.index, s.buildsOn]));
    const done = runOrderLayout(allDone(planned));
    assert.ok(done.links.every((l) => l.faint === true), `every link is faint: ${name}`);
    assert.deepEqual(done.links.map(({ faint, ...l }) => l), runOrderLayout(planned).links, name);
    assert.deepEqual(crossings(done), [], name);
    assert.deepEqual(falseJoins(done), [], name);
    checked += done.links.length;
  }
  assert.ok(checked > 200, `faint links checked: ${checked}`);
});

test('faint: one open link draws only open links, none faint', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const noneFaint = (slices, want, name) => {
    const { links } = runOrderLayout(slices);
    assert.deepEqual(pairs(links), want, name);
    assert.equal(links.some((l) => 'faint' in l), false, `${name}: no link carries faint`);
    assert.equal(renderRunOrderMap(newDoc(), slices).querySelectorAll('.is-faint').length, 0, `${name}: no faint path`);
  };
  noneFaint(sixteenSlices('base'), BASE_LINKS, 'base');
  noneFaint(sixteenSlices('busy'),
    [[2, 7], [2, 8], [6, 7], [7, 12], [8, 15], [9, 16], [10, 12], [11, 13], [12, 16], [13, 14], [14, 15], [15, 16]],
    'busy: started targets');
  const { done, states } = ORDER_STATES.base;
  const { 2: _two, ...rest } = states;
  noneFaint(sixteenSlices({ done: [...done, 2], states: rest }), BASE_LINKS.filter(([from]) => from !== 2), 'run 2 done');
  noneFaint(slicesOf([[1, []], [2, [1]], [3, [2]], [4, [3]]], { done: [1, 2], states: { 3: { state: 'running' } } }),
    [[3, 4]], 'one open link among met ones');
});

test('faint: every target started and no link open draws every link faint', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const slices = slicesOf([[1, []], [2, [1]], [3, [2]]],
    { done: [1], states: { 2: { state: 'running' }, 3: { state: 'running' } } });
  assert.deepEqual(runOrderLayout(slices).links.map((l) => [l.from, l.to, l.faint]), [[1, 2, true], [2, 3, true]]);
  assert.equal(renderRunOrderMap(newDoc(), slices).querySelectorAll('path.rom-link.is-faint').length, 2);
});

test('faint: a graph with no links at all draws nothing', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const slices = slicesOf([[1, []], [2, []], [3, []]], { done: [1] });
  assert.deepEqual(runOrderLayout(slices).links, []);
  assert.equal(renderRunOrderMap(newDoc(), slices).querySelectorAll('path.rom-link').length, 0);
});

// ── a run with no mark: the row's dot ──
test('marks: a paused, stopped, canceled or failed run carries its row\'s dot, never the hollow ring', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const doc = newDoc();
  const slices = slicesOf([[1, []], [2, [1]], [3, [2]], [4, [3]], [5, [4]], [6, [5]]], { done: [1],
    states: { 2: { state: 'paused' }, 3: { state: 'stopped' }, 4: { state: 'canceled' }, 5: { state: 'error' },
      6: { state: 'failed' } } });
  const root = renderRunOrderMap(doc, slices);
  assert.deepEqual([2, 3, 4, 5, 6].map((n) => classesOf(dotOf(root, n))),
    [['is-grey'], ['is-dark-grey'], ['is-dark-grey'], ['has-sym', 'is-red'], ['has-sym', 'is-red']]);
  for (const n of [2, 3, 4, 5, 6]) {
    assert.equal(dotOf(root, n).classList.contains('is-grey-ring'), false, `run ${n} is not the hollow ring`);
    assert.equal(dotOf(root, n).className, rowDotClass(doc, slices, n), `run ${n}'s dot is the row's dot`);
  }
  assert.deepEqual([2, 3, 4].map((n) => dotOf(root, n).dataset.state), ['paused', 'stopped', 'stopped']);
  assert.deepEqual(runOrderLayout(slices).runs.map((r) => r.rowState),
    ['waiting', 'paused', 'stopped', 'stopped', 'failed', 'failed']);
});

test('marks: a paused run held behind another keeps the dashed ring', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const slices = slicesOf([[1, []], [2, [1]], [3, [1]]],
    { done: [1], states: { 2: { state: 'paused', heldResume: { after: 3 } }, 3: { state: 'running' } } });
  assert.equal(byRun(runOrderLayout(slices)).get(2).rowState, 'paused');
  const dot = dotOf(renderRunOrderMap(newDoc(), slices), 2);
  assert.deepEqual(classesOf(dot), ['is-dashed-ring'], 'the mark wins, as on its row');
  assert.equal(dot.dataset.state, 'paused', 'painted over the paused row\'s model');
});

test('reduction: implied links left out', async () => {
  const { runOrderLayout } = await load();
  const layout = runOrderLayout(sixteenSlices('none'));
  assert.deepEqual(sorted(pairs(layout.implied)), sorted(IMPLIED));
  const drawn = new Set(pairs(layout.links).map(String));
  assert.deepEqual(IMPLIED.filter((p) => drawn.has(String(p))), [], 'no implied link is drawn');
  const all = SIXTEEN_PAIRS.flatMap(([to, buildsOn]) => buildsOn.map((from) => [from, to]));
  assert.deepEqual(sorted(pairs(layout.links)), sorted(all.filter((p) => !IMPLIED.some((i) => String(i) === String(p)))),
    'every other link is drawn while nothing is done');
  const three = runOrderLayout(slicesOf([[1, []], [2, [1]], [3, [1, 2]]]));
  assert.deepEqual(pairs(three.links), [[1, 2], [2, 3]]);
  assert.deepEqual(pairs(three.implied), [[1, 3]]);
});

// ── routing ──
test('routing: 2→7 avoids runs 5, 6 and 8', async () => {
  const { runOrderLayout } = await load();
  const layout = runOrderLayout(sixteenSlices('base'));
  const link = layout.links.find((l) => l.from === 2 && l.to === 7);
  assert.ok(link, 'the 2→7 link is drawn');
  const runs = byRun(layout);
  for (const n of [5, 6, 8]) {
    for (const seg of segments(link)) assert.equal(meetsOpen(seg, runs.get(n).dot), false, `${JSON.stringify(seg)} meets run ${n}`);
  }
});

test('routing: no segment of any link meets any run\'s dot or label', async () => {
  const { runOrderLayout } = await load();
  let drawn = 0;
  let skips = 0;
  for (const slices of [sixteenSlices('none'), sixteenSlices('base'), sixteenSlices('busy'), ...randomGraphs()]) {
    const layout = runOrderLayout(slices);
    const runs = byRun(layout);
    drawn += layout.links.length;
    skips += layout.links.filter((l) => runs.get(l.to).col - runs.get(l.from).col > 1).length;
    assert.deepEqual(crossings(layout), []);
  }
  assert.ok(drawn > 200 && skips > 50, `the graphs draw links, skipping columns too (${drawn}, ${skips})`);
});

test('routing: links that share no run never run together or within 3px of each other', async () => {
  const { runOrderLayout } = await load();
  let checked = 0;
  for (const slices of [...Object.keys(ORDER_STATES).map((n) => sixteenSlices(n)), ...randomGraphs()]) {
    const layout = runOrderLayout(slices);
    checked += layout.links.length;
    assert.deepEqual(falseJoins(layout), [], JSON.stringify(slices.map((s) => [s.index, s.buildsOn])));
  }
  assert.ok(checked > 200, `links checked: ${checked}`);
});

test('routing: segments are axis-aligned and join the two dots\' edges', async () => {
  const { runOrderLayout } = await load();
  for (const slices of [sixteenSlices('none'), sixteenSlices('base'), ...randomGraphs()]) {
    const layout = runOrderLayout(slices);
    const runs = byRun(layout);
    for (const link of layout.links) {
      const a = runs.get(link.from);
      const b = runs.get(link.to);
      const name = `${link.from}→${link.to}`;
      assert.deepEqual(link.points[0], [a.x + 6, a.y], `${name} leaves the source dot's right edge`);
      assert.deepEqual(link.points.at(-1), [b.x - 6, b.y], `${name} enters the target dot's left edge`);
      for (const [[ax, ay], [bx, by]] of segments(link)) assert.ok(ax === bx || ay === by, `${name}: ${ax},${ay} to ${bx},${by}`);
    }
  }
});

test('routing: a link turns in a column gap and passes a column only in the lane beside its source row', async () => {
  const { runOrderLayout } = await load();
  for (const slices of [sixteenSlices('none'), sixteenSlices('base'), ...randomGraphs()]) {
    const layout = runOrderLayout(slices);
    const runs = byRun(layout);
    for (const link of layout.links) {
      const a = runs.get(link.from);
      const b = runs.get(link.to);
      const name = `${link.from}→${link.to}`;
      let passes = 0;
      for (const seg of segments(link)) {
        const s = span(seg);
        if (s.x0 === s.x1 && s.y0 !== s.y1) {
          const off = (s.x0 - 24) % 64;
          assert.ok(off >= 22 && off <= 54 && (off - 22) % 4 === 0, `${name} turns at x ${s.x0}, ${off}px right of a column`);
        } else if (layout.runs.some((r) => s.x0 < r.x && r.x < s.x1)) {
          passes += 1;
          // The lane just below the source row or just above it: its tracks clear the dots and the next row's labels.
          const d = s.y0 - a.y;
          const tracks = [7, 11, 15, 19, 23];
          assert.ok(tracks.includes(d) || tracks.includes(d + 36),
            `${name} passes a column at y ${s.y0}, its source row at y ${a.y}`);
        }
      }
      if (b.col - a.col === 1) assert.equal(passes, 0, `${name} goes to the next column without a lane`);
      else assert.ok(passes > 0, `${name} skips columns along a lane`);
    }
  }
});

// ── change run ──
test('change run: placed right of its builds-on run and drawn with the ink ring', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const slices = changeChain({ six: { nextTurn: true } });
  const layout = runOrderLayout(slices);
  const six = byRun(layout).get(6);
  assert.deepEqual([six.col, six.kind], [5, 'change']);
  assert.deepEqual(layout.links.filter((l) => l.to === 6).map((l) => [l.from, l.faint]), [[5, true]],
    'run 5 is done and no link is open: the link into run 6 is drawn faint');
  const root = renderRunOrderMap(newDoc(), slices);
  assert.ok(dotOf(root, 6).classList.contains('is-ink-ring'), dotOf(root, 6).className);
  assert.equal(runEl(root, 6).dataset.kind, 'change');
  assert.equal(root.querySelectorAll('[data-kind]').length, 1, 'only the change run carries data-kind');
});

test('change run: a link is drawn into a waiting change run', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const slices = changeChain({ five: 'running' });
  assert.deepEqual(slices.find((s) => s.index === 6).waitsFor, [5]);
  const layout = runOrderLayout(slices);
  assert.deepEqual(pairs(layout.links), [[5, 6]]);
  const six = byRun(layout).get(6);
  assert.deepEqual(layout.links[0].points.at(-1), [six.x - 6, six.y], 'it ends at the change run\'s left edge');
  assert.deepEqual(crossings(layout), []);
  const root = renderRunOrderMap(newDoc(), slices);
  assert.ok(dotOf(root, 6).classList.contains('is-grey-ring'), dotOf(root, 6).className);
  assert.equal(runEl(root, 6).dataset.kind, 'change');
});

// ── later runs (R-arch-5): since s8 a Verifier fix or change run carries buildsOn [the last run before it] ──
test('later runs: a fix run and a change run whose buildsOn is [5] stand in the column after run 5\'s', async () => {
  const { runOrderLayout } = await load();
  const chain = [[1, []], [2, [1]], [3, [2]], [4, [3]], [5, [4]]];
  const later = byRun(runOrderLayout(slicesOf([...chain, [6, [5]], [7, [5]]],
    { done: [1, 2, 3, 4, 5], states: { 6: { kind: 'change', nextTurn: true }, 7: { kind: 'change' } } })));
  const after = later.get(5).col + 1;
  assert.deepEqual([later.get(6).col, later.get(7).col], [after, after]);
  assert.deepEqual([later.get(6).row, later.get(7).row], [0, 1]);
  assert.notEqual(after, 0, 'never in the first column');

  const sixteen = byRun(runOrderLayout(slicesOf([...SIXTEEN_PAIRS, [17, [16]]],
    { done: SIXTEEN_PAIRS.map(([run]) => run), states: { 17: { kind: 'change' } } })));
  assert.deepEqual([sixteen.get(17).col, sixteen.get(16).col + 1], [8, 8]);

});

// A change run from the chat card or a run's stop carries buildsOn [] (no s8 dependsOn). The drawing still stands it in
// the column after the last run before it; the first run of a feature (also buildsOn []) stays in the first column.
test('later runs: a change run whose buildsOn is empty stands in the column after the last run before it, the first run stays in the first', async () => {
  const { runOrderLayout } = await load();
  const chain = [[1, []], [2, [1]], [3, [2]], [4, [3]], [5, [4]]];
  const chat = byRun(runOrderLayout(slicesOf([...chain, [6, []]],
    { done: [1, 2, 3, 4, 5], states: { 6: { kind: 'change' } } })));
  assert.equal(chat.get(1).col, 0, 'the first run stays in the first column');
  assert.equal(chat.get(6).col, chat.get(5).col + 1, 'run 6 stands after run 5');
  assert.notEqual(chat.get(6).col, 0, 'never in the first column');

  // After a Verifier run ([5]) and another empty one: each stands after the run just before it.
  const mixed = byRun(runOrderLayout(slicesOf([...chain, [6, [5]], [7, []], [8, []]],
    { done: [1, 2, 3, 4, 5], states: { 6: { kind: 'change' }, 7: { kind: 'change' }, 8: { kind: 'change' } } })));
  assert.deepEqual([6, 7, 8].map((n) => mixed.get(n).col), [5, 6, 7]);
  const shown = runOrderLayout(slicesOf([...chain, [6, []]], { done: [1, 2, 3, 4, 5], states: { 6: { kind: 'change' } } }));
  assert.deepEqual(shown.links.filter((l) => l.to === 6), [], 'no link is drawn: run 6 builds on nothing');

  // In the 16-run feature the last run before run 17 is run 16 (column 7), not the deepest run.
  const sixteen = byRun(runOrderLayout(slicesOf([...SIXTEEN_PAIRS, [17, []]], { states: { 17: { kind: 'change' } } })));
  assert.equal(sixteen.get(17).col, sixteen.get(16).col + 1);

  // A first run that is a change run, and outline runs that build on nothing, stay in the first column.
  const first = byRun(runOrderLayout(slicesOf([[1, []], [2, []], [3, [1]]], { states: { 1: { kind: 'change' } } })));
  assert.deepEqual([1, 2, 3].map((n) => first.get(n).col), [0, 0, 1]);
});

// ── painter ──
test('render: root aria-hidden, every dot class from markDot and in the CSS dot set', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const doc = newDoc();
  const slices = sixteenSlices('busy');
  const root = renderRunOrderMap(doc, slices);
  assert.equal(root.tagName, 'DIV');
  assert.equal(root.ownerDocument, doc);
  assert.ok(root.classList.contains('rom'));
  assert.equal(root.getAttribute('aria-hidden'), 'true');
  assert.equal(root.getAttribute('tabindex'), '-1');
  const svg = root.querySelector('.rom-plot > svg.rom-links');
  assert.ok(svg, 'the links svg is in the plot');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('focusable'), 'false');
  assert.equal(root.querySelectorAll('a, button, input, [tabindex]').length, 0, 'nothing inside takes focus');
  assert.equal(root.querySelectorAll('.rom-run').length, 16);
  const cssDots = new Set([...readStyleCss().matchAll(/\.status-dot\.(is-[a-z][a-z-]*)/g)].map((m) => m[1]));
  const layout = byRun(runOrderLayout(slices));
  for (const s of slices) {
    const el = runEl(root, s.index);
    assert.equal(el.tagName, 'SPAN');
    assert.equal(el.querySelectorAll('.status-dot').length, 1, `run ${s.index} has one dot`);
    const dot = dotOf(root, s.index);
    assert.equal(dot.className, rowDotClass(doc, slices, s.index), `run ${s.index}'s dot is the row's dot`);
    assert.deepEqual([...dot.classList].filter((c) => c.startsWith('is-') && !cssDots.has(c)), [], `run ${s.index}`);
    assert.equal(el.dataset.mark, layout.get(s.index).mark, `run ${s.index}'s data-mark`);
    assert.equal(el.querySelector('span.rom-n.num').textContent, String(s.index));
  }
  const classes = (n) => [...dotOf(root, n).classList].filter((c) => c !== 'status-dot').sort();
  assert.deepEqual(classes(1), ['is-green']);
  assert.deepEqual(classes(2), ['has-sym', 'is-amber']);
  assert.deepEqual(classes(5), ['has-sym', 'is-red']);
  assert.deepEqual(classes(6), ['is-peach', 'is-pulse']);
  assert.deepEqual(classes(9), ['is-ink-ring']);
  assert.deepEqual([...root.querySelectorAll('.is-pulse')].map((d) => d.closest('.rom-run').dataset.mark), ['live']);
  const held = renderRunOrderMap(doc, sixteenSlices('held'));
  assert.ok(dotOf(held, 4).classList.contains('is-dashed-ring'), dotOf(held, 4).className);
});

test('render: the map is dots, numbers and links only, at the layout\'s pixels, a new element each call', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const doc = newDoc();
  const slices = sixteenSlices('base');
  const layout = runOrderLayout(slices);
  const root = renderRunOrderMap(doc, slices);
  const plot = root.querySelector(':scope > .rom-plot');
  assert.deepEqual([Number.parseFloat(plot.style.width), Number.parseFloat(plot.style.height)], [layout.width, layout.height]);
  for (const r of layout.runs) {
    const el = runEl(root, r.index);
    assert.deepEqual([Number.parseFloat(el.style.left), Number.parseFloat(el.style.top)], [r.x, r.y], `run ${r.index}`);
  }
  const text = [...root.querySelectorAll('.rom-n')].map((n) => n.textContent).join('');
  assert.equal(root.textContent, text, 'no caption, legend or word');
  assert.equal(root.querySelectorAll('animate, animateTransform, animateMotion').length, 0, 'a still drawing');
  const again = renderRunOrderMap(doc, slices);
  assert.notEqual(again, root);
  assert.equal(root.parentNode, null, 'the caller places it');
});

test('render: one path per drawn link', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const doc = newDoc();
  const slices = sixteenSlices('base');
  const layout = runOrderLayout(slices);
  const root = renderRunOrderMap(doc, slices);
  const paths = [...root.querySelectorAll('.rom-links path.rom-link')];
  assert.equal(paths.length, layout.links.length);
  assert.equal(paths.length, 15);
  for (const link of layout.links) {
    const path = root.querySelector(`path.rom-link[data-from="${link.from}"][data-to="${link.to}"]`);
    assert.ok(path, `${link.from}→${link.to}`);
    assert.equal(path.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.deepEqual(pathPoints(path.getAttribute('d')), link.points, `${link.from}→${link.to}`);
  }
  assert.ok(root.querySelector('[data-from="2"]'));
  const { done, states } = ORDER_STATES.base;
  const { 2: _two, ...rest } = states;
  const after = renderRunOrderMap(doc, sixteenSlices({ done: [...done, 2], states: rest }));
  assert.equal(after.querySelectorAll('[data-from="2"]').length, 0, 'run 2 is done: its links are gone');
  // Each path's classes follow its layout link: faint ones carry is-faint, and nothing else is added.
  for (const [list, drawn] of [[slices, BASE_LINKS.length], [allDone(slices), ALL_LINKS.length]]) {
    const painted = renderRunOrderMap(doc, list);
    assert.equal(painted.querySelectorAll('path.rom-link').length, drawn);
    for (const link of runOrderLayout(list).links) {
      const path = painted.querySelector(`path.rom-link[data-from="${link.from}"][data-to="${link.to}"]`);
      assert.deepEqual([...path.classList], link.faint ? ['rom-link', 'is-faint'] : ['rom-link'], `${link.from}→${link.to}`);
    }
  }
});

// ── malformed input, imports ──
test('malformed input: a non-array or empty input gives the empty layout and an empty map', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  for (const bad of [null, undefined, {}, 'runs', []]) assert.deepEqual(runOrderLayout(bad), EMPTY, JSON.stringify(bad));
  const doc = newDoc();
  for (const bad of [[], null]) {
    const root = renderRunOrderMap(doc, bad);
    assert.ok(root.classList.contains('rom'));
    assert.equal(root.getAttribute('aria-hidden'), 'true');
    assert.equal(root.querySelectorAll('.rom-run, path.rom-link').length, 0);
  }
});

test('malformed input: a cycle, a link to a missing run and a repeated run number never throw', async () => {
  const { runOrderLayout, renderRunOrderMap } = await load();
  const cycle = slicesOf([[1, [2]], [2, [1]]]);
  const loop = runOrderLayout(cycle);
  assert.equal(loop.runs.length, 2);
  assert.deepEqual(loop.runs.map((r) => r.col).sort(), [0, 1]);
  assert.equal(loop.links.length, 1, 'the edge that closes the cycle is not drawn');
  assert.ok(byRun(loop).get(loop.links[0].to).col > byRun(loop).get(loop.links[0].from).col);
  assert.equal(renderRunOrderMap(newDoc(), cycle).querySelectorAll('.rom-run').length, 2);
  assert.deepEqual(runOrderLayout(allDone(cycle)).links.map((l) => [l.from, l.to, l.faint]),
    [[loop.links[0].from, loop.links[0].to, true]], 'the closing edge stays out of the faint drawing too');

  const missing = runOrderLayout(slicesOf([[1, []], [2, [1, 99]]]));
  assert.deepEqual(missing.runs.map((r) => [r.index, r.col]).sort(), [[1, 0], [2, 1]]);
  assert.deepEqual(pairs(missing.links), [[1, 2]]);
  assert.deepEqual(missing.implied, []);

  const twice = slicesOf([[1, []], [2, [1]]], { done: [1] });
  twice.push({ index: 2, title: 'Run 2 again', state: 'done', kind: 'change', buildsOn: [] });
  const kept = runOrderLayout(twice);
  assert.equal(kept.runs.length, 2);
  assert.deepEqual([byRun(kept).get(2).col, byRun(kept).get(2).kind, byRun(kept).get(2).mark], [1, null, 'ring'], 'the first slice is kept');
});

test('the module imports only run-status, run-model and status-dot, reuses namedWaits, and lays out with no DOM', async () => {
  const { runOrderLayout } = await load();
  const src = readFileSync(MODULE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const allowed = ['../src/shared/shape/run-status.mjs', '../src/shared/run-model.mjs', '../ui/public/status-dot.mjs']
    .map((p) => new URL(p, import.meta.url).href);
  const specs = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  assert.deepEqual(specs.filter((s) => !allowed.includes(new URL(s, MODULE).href)), []);
  assert.match(src, /\bnamedWaits\s*\(/, 'implied links come from namedWaits');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(runOrderLayout(sixteenSlices('base')).runs.length, 16);
});
