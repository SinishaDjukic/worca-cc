// test/ui-tab-fold.test.mjs — which tabs of a detail screen's row go under "More" at a given width (jsdom does no
// layout, so the decision is a pure function: widths in, folded keys out). The wiring is test/ui-detail-tabs.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldTabs } from '../ui/public/tab-fold.mjs';
import { checkRows } from './helpers/rows.mjs';

const tabs = (...pairs) => pairs.map(([key, width]) => ({ key, width }));
// A run page: five row tabs and three others. Gap 10, More 50.
const ROW = tabs(['overview', 100], ['task', 60], ['diff', 60], ['qa', 60], ['logs', 60]);
const REST = tabs(['actions', 80], ['workflow', 90], ['agents', 70]);
const fold = (over = {}) => foldTabs({ row: ROW, rest: REST, active: 'overview', avail: 1000, gap: 10, more: 50, ...over });
// The default split drawn: 340 of row + More 50 + 5 gaps.
const DEFAULT_WIDTH = 440;

test('a bar the default split fits keeps it: the others under More, no row tab folded', async () => {
  await checkRows([
    { name: 'wide', run: () => assert.deepEqual(fold(), { rest: true, extra: [] }) },
    { name: 'exactly wide enough', run: () => assert.deepEqual(fold({ avail: DEFAULT_WIDTH }), { rest: true, extra: [] }) },
    { name: 'width never pulls a tab out of More', run: () => assert.deepEqual(fold({ avail: 100000 }), { rest: true, extra: [] }) },
    { name: 'one other tab that fits stays in the row', run: () => assert.deepEqual(fold({ rest: tabs(['workflow', 90]) }), { rest: false, extra: [] }) },
    { name: 'no other tab', run: () => assert.deepEqual(fold({ rest: [] }), { rest: false, extra: [] }) },
  ]);
});

test('a narrow bar folds the row from the right until it fits', async () => {
  await checkRows([
    { name: 'one tab', run: () => assert.deepEqual(fold({ avail: DEFAULT_WIDTH - 1 }), { rest: true, extra: ['logs'] }) },
    { name: 'it fits with that one gone', run: () => assert.deepEqual(fold({ avail: DEFAULT_WIDTH - 70 }), { rest: true, extra: ['logs'] }) },
    { name: 'two tabs', run: () => assert.deepEqual(fold({ avail: DEFAULT_WIDTH - 71 }), { rest: true, extra: ['logs', 'qa'] }) },
    { name: 'down to Overview, Task and More', run: () => assert.deepEqual(fold({ avail: 230 }), { rest: true, extra: ['logs', 'qa', 'diff'] }) },
  ]);
});

test('the gaps and the More button are counted, once there is a More', async () => {
  const row = tabs(['overview', 100], ['task', 100]);
  await checkRows([
    { name: 'no More: two tabs and one gap', run: () => assert.deepEqual(
      foldTabs({ row, rest: [], active: 'overview', avail: 210, gap: 10, more: 50 }), { rest: false, extra: [] }) },
    { name: 'the gap tips it', run: () => assert.deepEqual(
      foldTabs({ row, rest: [], active: 'overview', avail: 209, gap: 10, more: 50 }), { rest: false, extra: ['task'] }) },
    // 340 of tabs and 4 gaps would fit in 390; More and its gap do not.
    { name: 'More tips it', run: () => assert.deepEqual(fold({ avail: 390 }), { rest: true, extra: ['logs'] }) },
  ]);
});

test('Overview and the open tab are pinned: never folded by width, and the open one is counted when it sits under More', async () => {
  await checkRows([
    { name: 'the open row tab is skipped', run: () => assert.deepEqual(fold({ active: 'logs', avail: DEFAULT_WIDTH - 1 }), { rest: true, extra: ['qa'] }) },
    { name: 'a tiny bar keeps Overview, the open tab and More', run: () => assert.deepEqual(
      fold({ active: 'diff', avail: 1 }), { rest: true, extra: ['logs', 'qa', 'task'] }) },
    // The open Actions (80) joins the row: 440 + 90.
    { name: 'the open other tab takes room', run: () => assert.deepEqual(fold({ active: 'actions', avail: 529 }), { rest: true, extra: ['logs'] }) },
    { name: 'and fits beside the whole row', run: () => assert.deepEqual(fold({ active: 'actions', avail: 530 }), { rest: true, extra: [] }) },
    { name: 'no open tab', run: () => assert.deepEqual(fold({ active: null, avail: 1 }), { rest: true, extra: ['logs', 'qa', 'diff', 'task'] }) },
  ]);
});

test('a lone other tab goes under More first; row tabs fold only if the row still does not fit', async () => {
  const rest = tabs(['workflow', 90]);
  // In the row: 340 + 90 + 5 gaps = 480. Under More: 340 + 50 + 5 gaps = 440.
  await checkRows([
    { name: 'it fits', run: () => assert.deepEqual(fold({ rest, avail: 480 }), { rest: false, extra: [] }) },
    { name: 'the lone tab folds first', run: () => assert.deepEqual(fold({ rest, avail: 479 }), { rest: true, extra: [] }) },
    { name: 'then the row, from the right', run: () => assert.deepEqual(fold({ rest, avail: 439 }), { rest: true, extra: ['logs'] }) },
    { name: 'the open lone tab is skipped', run: () => assert.deepEqual(
      fold({ rest, active: 'workflow', avail: 479 }), { rest: false, extra: ['logs'] }) },
  ]);
});

test('an unmeasured bar keeps the default split', async () => {
  await checkRows([0, -1, Number.NaN, undefined].flatMap((avail) => [
    { name: `avail ${avail}`, run: () => assert.deepEqual(foldTabs({ row: ROW, rest: REST, active: 'overview', avail, gap: 10, more: 50 }), { rest: true, extra: [] }) },
    { name: `avail ${avail}, one other tab`, run: () => assert.deepEqual(
      foldTabs({ row: ROW, rest: REST.slice(0, 1), active: 'overview', avail, gap: 10, more: 50 }), { rest: false, extra: [] }) },
  ]));
});

test('a bar nothing fits in folds everything foldable, and empty or unmeasured input never throws', async () => {
  await checkRows([
    { name: 'queue exhausted, lone tab included', run: () => assert.deepEqual(
      fold({ rest: tabs(['workflow', 90]), avail: 1 }), { rest: true, extra: ['logs', 'qa', 'diff', 'task'] }) },
    { name: 'nothing to fold', run: () => assert.deepEqual(
      foldTabs({ row: [], rest: [], active: null, avail: 1, gap: 10, more: 50 }), { rest: false, extra: [] }) },
    { name: 'widths that are not finite count as 0', run: () => assert.deepEqual(
      foldTabs({ row: tabs(['overview', Number.NaN], ['task', undefined]), rest: [], active: 'overview', avail: 1, gap: Number.NaN, more: Infinity }),
      { rest: false, extra: [] }) },
  ]);
});

test('monotone prefix: every narrower bar folds at least what a wider one folds, in the same order', () => {
  for (const [rest, active] of [[REST, 'overview'], [REST, 'diff'], [REST, 'actions'], [REST.slice(0, 1), 'overview'], [REST.slice(0, 1), 'workflow'], [[], 'qa'],
    [[], 'overview']]) {
    // The lone tab's fold (rest) comes before the row keys, so it reads as the queue's first item.
    const queue = (r) => [...(r.rest && rest.length === 1 ? ['rest'] : []), ...r.extra];
    let wider = queue(fold({ rest, active, avail: 700 }));
    for (let avail = 700; avail >= 1; avail--) {
      const now = queue(fold({ rest, active, avail }));
      assert.deepEqual(now.slice(0, wider.length), wider, `${active}, ${rest.length} others, at ${avail}px`);
      wider = now;
    }
  }
});

test('half a pixel of rounding does not fold a tab', async () => {
  await checkRows([
    { name: 'within tolerance', run: () => assert.deepEqual(fold({ avail: DEFAULT_WIDTH - 0.5 }), { rest: true, extra: [] }) },
    { name: 'past it', run: () => assert.deepEqual(fold({ avail: DEFAULT_WIDTH - 0.6 }), { rest: true, extra: ['logs'] }) },
  ]);
});
