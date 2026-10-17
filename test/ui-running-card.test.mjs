// test/ui-running-card.test.mjs — a live run's ROW in the Runs list: a link built by
// ui/public/runs-list.mjs holding a status icon, the title and a one-line subline
// ("<word> · <step or start time>"), and a click that opens the run in the pane
// (#running/<id>). The run card it replaced (header avatar, meta line, branch chip,
// Pause/Resume/Stop cluster, waiting strip) is gone (D14): Pause/Stop/Resume live in
// the pane's bar (test/ui-running-detail.test.mjs, test/ui-running-stop-modal.test.mjs,
// test/ui-running-resume.test.mjs) and a waiting run is listed under Needs you.
//
// boot()/dispatch()/helloRunning() are copied from test/ui-question.test.mjs (boot
// 19-82, RUN_ID 84, helloRunning 88-96) — the nearest suite that captures the
// WebSocket instance. showRunning() follows test/helpers/run-page-boot.mjs: the bare
// list with nothing selected (a bare #runs would otherwise reopen the remembered run, D6).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  // jsdom has no rAF; the run page defers its scroll-to-question by a frame
  // (paintRdQuestions). Same shim as test/ui-sidebar-counts.test.mjs.
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1;
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(url), opts || {});
      if (r) return r;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  function dispatch(msg) {
    wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  }
  function go(hash) {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
  }
  // The bare list with nothing selected: forget the remembered run first (rule 5).
  function showRunning() {
    window.localStorage.removeItem('worca-cc.runs.last');
    go('runs');
  }
  // Rows repaint on a microtask and a changed row is REPLACED: settle, then re-query.
  const settle = async (n = 3) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { window, dispatch, go, showRunning, settle, calls, wsBox };
}

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

// The run's row: each run is listed once, under Needs you or in its section (#724).
const rowOf = (ctx, runId = RUN_ID) =>
  ctx.window.document.querySelector(`#runs-list .runs-row[data-run-id="${runId}"]`);
const subOf = (row) => row.querySelector('.runs-row-sub').textContent;
const wordOf = (row) => subOf(row).split(' · ')[0];

test('status icon + word per run state', async () => {
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

  const cases = [
    [RUN_ID,          'run',    'Running'],
    ['s-starting',    'start',  'Starting'],
    ['s-ask',         'ask',    'Answer 1 question'],
    ['s-paused',      'paused', 'Paused by you'],
    ['s-pausing',     'paused', 'Pausing'],
    ['s-interrupted', 'paused', 'Interrupted'],
    ['s-done',        'done',   'Finished'],
    ['s-stopped',     'stop',   'Stopped'],
    ['s-error',       'fail',   'Failed'],
  ];
  for (const [id, icon, word] of cases) {
    const row = rowOf(ctx, id);
    assert.ok(row, `${id}: listed`);
    const ics = [...row.querySelectorAll('.runs-ic')];
    assert.equal(ics.length, 1, `${id}: exactly one icon`);
    assert.ok(ics[0].classList.contains(`runs-ic-${icon}`), `${id}: icon is ${icon}`);
    assert.equal(row.dataset.icon, icon);
    assert.equal(wordOf(row), word, `${id}: word`);
  }
  // Needs you (#724): the question, the interrupted run and the unread failure; not a manual pause, not pausing.
  const needs = [...ctx.window.document.querySelectorAll('#runs-list .runs-needs .runs-row')].map((a) => a.dataset.runId);
  assert.deepEqual(needs, ['s-ask', 's-interrupted', 's-error']);
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
