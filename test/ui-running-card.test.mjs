// test/ui-running-card.test.mjs — a live run's ROW in the Runs list: a link built by
// ui/public/runs-list.mjs beside the one status dot (status-dot.mjs, from the run model), the title and its one
// status line, and a click that opens the run in the pane
// (#running/<id>). The run card it replaced (header avatar, meta line, branch chip,
// Pause/Resume/Stop cluster, waiting strip) is gone (D14): Pause/Stop/Resume live in
// the pane's bar (test/ui-running-detail.test.mjs, test/ui-running-stop-modal.test.mjs,
// test/ui-running-resume.test.mjs) and a waiting run is listed under Needs you.
//
// helloRunning() is copied from test/ui-question.test.mjs. showRunning() is test/helpers/run-page-boot.mjs's: the bare
// list with nothing selected (a bare #runs would otherwise reopen the remembered run, D6).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPageOn } from './helpers/run-page-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

// One app for the file (test/helpers/shared-app-boot.mjs). jsdom has no rAF; the run page defers its scroll-to-question
// by a frame (paintRdQuestions). Same shim as test/ui-sidebar-counts.test.mjs, set before app.js loads.
const app = useSharedApp({ before, beforeEach, after }, {
  setup: (window) => {
    window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
  },
});
// The run-page ctx: dispatch, go, showRunning (the bare list with nothing selected), settle, calls, wsBox.
const boot = runPageOn(app);

const RUN_ID = 'run-aaa';

// A bare HH:MM:SS start is today's clock (makeRun), so the subline's time is stable.
function helloRunning(ctx, extra = {}, more = []) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [
      { runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '09:30:15', ...extra },
      ...more,
    ],
  });
}

// The run's row: each run is listed once (runs redesign §3.1).
const rowOf = (ctx, runId = RUN_ID) =>
  ctx.window.document.querySelector(`#runs-list a.runs-row[data-run-id="${runId}"]`);
const dotOf = (row) => row.closest('.runs-item').querySelector(':scope > .runs-pick .status-dot');

test('the status dot per run state, and Needs you holds the question, the pause and the unread failure', async () => {
  const ctx = await boot();
  const run = (runId, extra) => ({ runId, title: runId, projectDir: '/tmp/p', kind: 'run', startedAt: '09:30:15', ...extra });
  helloRunning(ctx, {}, [
    run('s-starting', { status: 'starting' }),
    run('s-ask', { status: 'running', pendingQuestion: { id: 'q', questions: [{ question: 'x?' }] } }),
    run('s-paused', { status: 'paused' }),
    run('s-pausing', { status: 'pausing' }),
    run('s-interrupted', { status: 'running' }),
    run('s-done', { status: 'running' }),
    run('s-stopped', { status: 'running' }),
    run('s-error', { status: 'running' }),
  ]);
  // A run that ends LIVE lingers in the list until it is opened; hello-seeded
  // terminal runs never list (ui-pipeline-tabs: seed-on-first-hello).
  ctx.dispatch({ type: 'done', runId: 's-interrupted', status: 'interrupted' });
  ctx.dispatch({ type: 'done', runId: 's-done', status: 'done' });
  ctx.dispatch({ type: 'done', runId: 's-stopped', status: 'stopped' });
  ctx.dispatch({ type: 'done', runId: 's-error', status: 'error' });
  ctx.showRunning();
  await ctx.settle();

  // A running run with no manifest yet reads Starting (run-model.mjs: no step rows, nothing active).
  const cases = [
    [RUN_ID,          'starting'],
    ['s-starting',    'starting'],
    ['s-ask',         'needs-you'],
    ['s-paused',      'paused'],
    ['s-pausing',     'paused'],
    ['s-interrupted', 'paused'],
    ['s-done',        'ready'],
    ['s-stopped',     'stopped'],
    ['s-error',       'failed'],
  ];
  for (const [id, state] of cases) {
    const row = rowOf(ctx, id);
    assert.ok(row, `${id}: listed`);
    assert.equal(row.closest('.runs-item').querySelectorAll(':scope > .runs-pick .status-dot').length, 1, `${id}: exactly one dot`);
    assert.equal(dotOf(row).dataset.state, state, `${id}: ${state}`);
    assert.equal(row.dataset.state, state);
  }
  // Needs you (D5): the question, the pause and the unread failure; not pausing/interrupted.
  const needs = [...ctx.window.document.querySelectorAll('#runs-list .runs-sec[data-section="needs"] a.runs-row')].map((a) => a.dataset.runId);
  assert.deepEqual(needs, ['s-ask', 's-paused', 's-error']);
});

test('clicking a row opens #running/<runId> in the pane beside the list', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  await ctx.settle();
  const doc = ctx.window.document;
  assert.equal(doc.getElementById('run-shell').classList.contains('detail-open'), false, 'nothing open yet');
  assert.equal(doc.getElementById('runs-empty').hidden, false, 'the pane shows its empty state');

  rowOf(ctx).dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
  await ctx.settle();
  assert.ok(doc.getElementById('run-shell').classList.contains('detail-open'), 'the pane opened the run');
  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, 'Demo run');
  assert.ok(rowOf(ctx), 'the list stays beside it');
  assert.ok(rowOf(ctx).classList.contains('selected'), 'the open run’s row is marked');
  assert.equal(rowOf(ctx).getAttribute('aria-current'), 'true');
});
