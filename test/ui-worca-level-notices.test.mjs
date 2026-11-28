// test/ui-worca-level-notices.test.mjs
// The run-finished message (R-po-6): which of the viewer's finished runs queue a toast, and what it says.
// Pure functions of ui/public/worca-level/notices.mjs, plus the wiring's post-load hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownFinishedRun, runFinishedNotice, REAL_RUNS_FOR_RUNNER } from '../ui/public/worca-level/notices.mjs';
import { createWorcaLevelWiring } from '../ui/public/worca-level/app-wiring.mjs';

const viewAt = (level, realRuns) => ({
  level: level ? { index: level } : null,
  ladder: [{ index: 2, items: [{ id: 'realRuns', count: realRuns, of: 3 }] }],
  next: null,
});
const shared = (name) => ({ shared: true, name });
const local = { shared: false, name: null };

test('a real run reads the count from the refreshed view, capped at 3 (R-po-6)', () => {
  assert.equal(REAL_RUNS_FOR_RUNNER, 3);
  assert.deepEqual(runFinishedNotice(viewAt(1, 1), { runId: 'a', real: true }), { title: '1 of 3 real runs toward Runner' });
  assert.deepEqual(runFinishedNotice(viewAt(1, 3), { runId: 'a', real: true }), { title: '3 of 3 real runs toward Runner' });
  assert.deepEqual(runFinishedNotice(viewAt(1, 7), { runId: 'a', real: true }), { title: '3 of 3 real runs toward Runner' });
});

test('a demo run gets the demo copy', () => {
  assert.deepEqual(runFinishedNotice(viewAt(1, 0), { runId: 'a', real: false }), { title: "Demo runs don't count. Try one on your project." });
});

test('nothing at Runner or above', () => {
  assert.equal(runFinishedNotice(viewAt(2, 3), { runId: 'a', real: true }), null);
  assert.equal(runFinishedNotice(viewAt(4, 30), { runId: 'a', real: false }), null);
});

test('a missing view, queue entry or count shows nothing', () => {
  assert.equal(runFinishedNotice(null, { runId: 'a', real: true }), null);
  assert.equal(runFinishedNotice(viewAt(1, 1), null), null);
  assert.equal(runFinishedNotice({ level: null, ladder: [], next: null }, { runId: 'a', real: true }), null);
});

test('a person with no level yet still sees the message', () => {
  assert.deepEqual(runFinishedNotice(viewAt(null, 2), { runId: 'a', real: true }), { title: '2 of 3 real runs toward Runner' });
});

test('own run: a local install queues every done run; a shared one only the viewer\'s, case-insensitively', () => {
  const frame = { status: 'done', real: true };
  assert.deepEqual(ownFinishedRun({ runId: 'r1' }, 'done', frame, local), { runId: 'r1', real: true });
  assert.deepEqual(ownFinishedRun({ runId: 'r1', startedBy: 'ADA' }, 'done', frame, shared('ada')), { runId: 'r1', real: true });
  assert.equal(ownFinishedRun({ runId: 'r1', startedBy: 'bob' }, 'done', frame, shared('ada')), null, "another person's run shows nothing");
  assert.equal(ownFinishedRun({ runId: 'r1' }, 'done', frame, shared('ada')), null);
});

test('error, stopped and paused runs queue nothing; a frame without real queues nothing', () => {
  for (const status of ['error', 'stopped', 'paused']) {
    assert.equal(ownFinishedRun({ runId: 'r1' }, status, { status, real: false }, local), null, status);
  }
  assert.equal(ownFinishedRun({ runId: 'r1' }, 'done', { status: 'done', pipelineDir: null }, local), null, 'recovery broadcast');
  assert.equal(ownFinishedRun({ runId: 'r1' }, 'done', undefined, local), null);
  assert.equal(ownFinishedRun({ runId: 'r1' }, 'done', { real: 'yes' }, local), null);
});

// ── the wiring's post-load hook ──
function wiringWith(views) {
  const toasts = [];
  const queue = [...views];
  const w = createWorcaLevelWiring({
    menu: { prepend() {}, querySelector: () => null, replaceChildren() {} }, repaint() {}, isSettled: () => false, setupOpen: () => false,
    notify: (o) => toasts.push(o), fetchView: async () => queue.shift(), doc: { getElementById: () => null },
  });
  return { w, toasts };
}

test('the toast shows after the next successful load, once, with its key', async () => {
  const { w, toasts } = wiringWith([viewAt(1, 1), viewAt(1, 2)]);
  w.queueRunFinished({ runId: 'r1', real: true });
  await w.refreshNow();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].tone, 'info');
  assert.equal(toasts[0].key, 'worca-run-progress');
  assert.equal(toasts[0].title, '1 of 3 real runs toward Runner');
  assert.ok(toasts[0].timeout > 0);
  await w.refreshNow();
  assert.equal(toasts.length, 1, 'the queue is spent');
});

test('a failed load keeps the queue for the next good one', async () => {
  const { w, toasts } = wiringWith([null, viewAt(1, 2)]);
  w.queueRunFinished({ runId: 'r1', real: true });
  await w.refreshNow();
  assert.equal(toasts.length, 0);
  await w.refreshNow();
  assert.equal(toasts[0].title, '2 of 3 real runs toward Runner');
});

test('at Runner the queue is dropped without a toast', async () => {
  const { w, toasts } = wiringWith([viewAt(2, 3)]);
  w.queueRunFinished({ runId: 'r1', real: true });
  await w.refreshNow();
  assert.equal(toasts.length, 0);
});

test('reload reads the view again and repaints; a failed read keeps the view that was held', async () => {
  const answers = [viewAt(1, 1), new Error('offline'), viewAt(2, 3)];
  let repaints = 0;
  const w = createWorcaLevelWiring({
    menu: { prepend() {}, querySelector: () => null, replaceChildren() {} }, repaint: () => { repaints += 1; }, isSettled: () => false, setupOpen: () => false,
    notify() {}, fetchView: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; }, doc: { getElementById: () => null },
  });
  await w.reload();
  const held = w.state.view;
  assert.equal(held.level.index, 1);
  assert.equal(repaints, 1);
  await w.reload();
  assert.equal(w.state.view, held, 'a failed read never turns a known level into none');
  assert.equal(repaints, 1);
  await w.reload();
  assert.equal(w.state.view.level.index, 2);
  assert.equal(repaints, 2);
});
