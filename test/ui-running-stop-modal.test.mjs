// test/ui-running-stop-modal.test.mjs — the dedicated "Stop this run?" confirm
// modal (design §6 / D5). Opened from the run page header's .rd-stop (the Runs list
// rows carry no controls), which stamps the target runId. Keep running cancels, Stop
// pipeline POSTs /api/stop, a failure renders inline, Escape + backdrop close it, and
// Escape while it is open must NOT also navigate the detail screen back to the list.
//
// boot()/dispatch()/showRunning() are a deliberate verbatim copy of
// test/ui-question.test.mjs:19-82 (plus the `scrollIntoView` stub the detail
// screen needs) — the suites do not import each other.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state (stopModalClose, runDetailState) can't leak between cases.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { cardAlertOf } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, dragOut } from './helpers/popups.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;

  // jsdom doesn't implement scrollIntoView; the detail screen calls it on open.
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1; // OPEN — app.js gates backfill subscribes on wsReady
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

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
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
  // The bare Runs list with nothing open: forget the remembered run first, or a bare
  // route would reopen it side by side.
  function showRunning() {
    window.localStorage.removeItem('worca-cc.runs.last');
    window.location.hash = 'running';
    window.dispatchEvent(new window.Event('hashchange'));
  }

  return { window, dispatch, showRunning, calls, wsBox };
}

const RUN_ID = 'run-stop-1';
const BRANCH = 'worca-cc/chat-connectivity-followups-9c21ae44';

// Open the WS, seed one running pipeline, land on Running, then give it a branch
// (r.branchFeature is only ever set from a `state` frame — app.js:1525-1527).
function seed(ctx) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [{
      runId: RUN_ID, title: 'Implement Chat Connectivity Follow-ups', projectDir: '/tmp/p',
      status: 'running', startedAt: '2026-01-01T00:00:00Z', kind: 'run', pipelineId: 'p1',
    }],
  });
  ctx.showRunning();
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', branch: { feature: BRANCH } });
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const esc = (window) =>
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const stopPosts = (ctx) => ctx.calls.filter((c) => c.url.includes('/api/stop'));

function openDetail(ctx) {
  ctx.window.location.hash = `running/${RUN_ID}`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
}
// Open the run page and press its header Stop pill (the list row has no Stop).
async function openStop(ctx) {
  openDetail(ctx);
  await new Promise((r) => setTimeout(r, 0));
  const rdStop = ctx.window.document.querySelector('#run-detail .rd-stop');
  assert.ok(rdStop, '.rd-stop present on the run page header');
  click(ctx.window, rdStop);
  return rdStop;
}

test('the run page Stop pill opens #stop-modal with the run identity and POSTs nothing', async () => {
  const ctx = await boot();
  seed(ctx);

  const modal = ctx.window.document.getElementById('stop-modal');
  assert.ok(modal, '#stop-modal exists in index.html');
  assert.ok(modal.classList.contains('hidden'), 'modal starts closed');

  await openStop(ctx);

  assert.equal(modal.classList.contains('hidden'), false, 'Stop opens the modal');
  assert.equal(modal.dataset.runId, RUN_ID, 'the opener stamps the target runId');
  assert.equal(modal.querySelector('.stop-title').textContent, 'Stop this run?');
  assert.equal(
    modal.querySelector('.stop-body').textContent,
    "A stopped run can't be resumed. Its work so far stays on its branch.",
  );
  assert.equal(modal.querySelector('.stop-ident-title').textContent, 'Implement Chat Connectivity Follow-ups');
  assert.equal(modal.querySelector('.stop-ident-title').title, BRANCH, 'the branch is a tooltip');
  assert.equal(modal.querySelector('.stop-ident-branch'), null);
  assert.equal(modal.querySelector('.stop-cancel').textContent, 'Keep running');
  assert.equal(modal.querySelector('.stop-confirm').textContent, 'Stop run');
  assert.equal(ctx.window.document.activeElement, modal.querySelector('.stop-cancel'), 'D11: the safe choice has the focus');
  assert.equal(stopPosts(ctx).length, 0, 'opening the modal must not stop anything');
});

// One boot: each row opens the modal from the run page again.
test('"Keep running" and a backdrop click close the modal without POSTing /api/stop; a click inside the card does not close it', async () => {
  const ctx = await boot();
  seed(ctx);
  await checkRows([
    { name: '"Keep running" closes the modal without POSTing /api/stop', run: async () => {
      await openStop(ctx);

      const modal = ctx.window.document.getElementById('stop-modal');
      click(ctx.window, modal.querySelector('.stop-cancel'));

      assert.ok(modal.classList.contains('hidden'), 'Keep running closes it');
      assert.equal(modal.dataset.runId, undefined, 'the runId stamp is cleared on close');
      assert.equal(stopPosts(ctx).length, 0, 'cancel never stops the run');
    } },
    { name: 'a backdrop click (press and release on the overlay) closes; a click inside the card, or a selection dragged out of it, does not', run: async () => {
      await openStop(ctx);
      const modal = ctx.window.document.getElementById('stop-modal');
      click(ctx.window, modal.querySelector('.stop-ident'));                 // inside the dialog card
      dragOut(ctx.window, modal.querySelector('.stop-ident'), modal);       // a selection dragged out
      assert.equal(modal.classList.contains('hidden'), false, 'neither closes it');
      backdropClick(ctx.window, modal);
      assert.ok(modal.classList.contains('hidden'), 'a real outside click is the safe "Keep running"');
      assert.equal(stopPosts(ctx).length, 0);
    } },
  ]);
});

test('"Stop run" POSTs /api/stop {runId} and closes the modal', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/stop')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
      : null),
  });
  seed(ctx);
  await openStop(ctx);

  const modal = ctx.window.document.getElementById('stop-modal');
  click(ctx.window, modal.querySelector('.stop-confirm'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const posts = stopPosts(ctx);
  assert.equal(posts.length, 1, 'exactly one POST /api/stop');
  assert.equal(posts[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(posts[0].opts.body), { runId: RUN_ID });
  assert.ok(modal.classList.contains('hidden'), 'a successful stop closes the modal');
});

test('a failed /api/stop renders inline in the modal and re-arms the button', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/stop')
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'run already finished' }) })
      : null),
  });
  seed(ctx);
  await openStop(ctx);

  const modal = ctx.window.document.getElementById('stop-modal');
  const ok = modal.querySelector('.stop-confirm');
  click(ctx.window, ok);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(modal.classList.contains('hidden'), false, 'the modal stays open on failure');
  const alert = cardAlertOf(modal.querySelector('.stop-card'));
  assert.ok(alert, 'a card alert is shown above the buttons');
  assert.equal(alert.title, 'Could not stop the run');
  assert.match(alert.detail, /run already finished/);
  assert.equal(modal.querySelector('.stop-err'), null, 'the old inline slot is gone');
  assert.equal(ok.disabled, false, 'the confirm button is re-enabled');
  assert.equal(ok.textContent, 'Stop run', 'the busy label is restored');
  assert.equal(modal.querySelector('.stop-cancel').disabled, false, 'Keep running is armed again');
});

// Nothing aborts the POST, so a cancel taken after it left the browser cannot
// undo it: closing the dialog would only suppress the UI feedback while the
// orchestrator stopped the run anyway — the exact outcome the confirmation
// exists to prevent. Once Stop is under way the cancel affordance is withdrawn.
test('cancel, Escape and backdrop are inert while the stop POST is in flight', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/stop')
      ? gate.then(() => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
      : null),
  });
  seed(ctx);
  await openStop(ctx);

  const modal = ctx.window.document.getElementById('stop-modal');
  const cancel = modal.querySelector('.stop-cancel');
  assert.equal(cancel.disabled, false, 'cancel is live before the POST');

  click(ctx.window, modal.querySelector('.stop-confirm'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(cancel.disabled, true, 'Keep running is withdrawn once it can no longer take effect');

  click(ctx.window, cancel);
  assert.equal(modal.classList.contains('hidden'), false, 'cancel mid-flight does not fake a cancellation');
  esc(ctx.window);
  assert.equal(modal.classList.contains('hidden'), false, 'Escape mid-flight is ignored');
  backdropClick(ctx.window, modal);   // backdrop: press and release
  assert.equal(modal.classList.contains('hidden'), false, 'backdrop mid-flight is ignored');

  release();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(modal.classList.contains('hidden'), 'the modal closes when the stop actually lands');
  assert.equal(stopPosts(ctx).length, 1, 'exactly one POST /api/stop');
});

// The Running detail screen's Escape handler is CAPTURE-phase (Task 5, modelled on
// History's at app.js:10734-10744), and openStopModal's own Escape listener is
// bubble-phase. Capture therefore runs FIRST: without an explicit `#stop-modal`
// guard in that handler, one Escape would close the modal AND navigate the detail
// screen back to the list. The next case locks the guard down.
test('Escape closes the modal and does NOT also navigate the detail back', async () => {
  const ctx = await boot();
  seed(ctx);
  // The narrow (slide) layout, where Escape on the glance DOES go back to the list: side by
  // side it does nothing, so "the hash did not change" would prove nothing (rule 4).
  ctx.window.document.getElementById('runs-shell').dataset.layout = 'slide';
  openDetail(ctx);
  await new Promise((r) => setTimeout(r, 0));
  click(ctx.window, ctx.window.document.querySelector('#run-detail .rd-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  esc(ctx.window);

  assert.ok(modal.classList.contains('hidden'), 'Escape closes the modal');
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), `running/${RUN_ID}`,
    'the modal owns Escape — the detail screen stays open');

  // A second Escape, with no modal open, belongs to the detail screen again.
  esc(ctx.window);
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'runs',
    'once the modal is gone Escape navigates back to the list');
});

// Leaving Runs entirely. closeRunDetail's teardown sits BELOW its `detail-open`
// early return, and the same early return is on the leave-guard path, so leaving
// the view used to strand a `position:fixed;inset:0` overlay and a live document
// keydown listener over the next view. The modal now only opens from the run page.
// Each row boots its own page.
test('leaving the run page or the Runs view while the modal is open tears the overlay down', async () => {
  await checkRows([
    { name: 'leaving the detail while the modal is open tears the overlay down', run: async () => {
      const ctx = await boot();
      seed(ctx);
      openDetail(ctx);
      await new Promise((r) => setTimeout(r, 0));
      click(ctx.window, ctx.window.document.querySelector('#run-detail .rd-stop'));

      const modal = ctx.window.document.getElementById('stop-modal');
      assert.equal(modal.classList.contains('hidden'), false);

      // Leave through another view: side by side a bare #runs would keep this run open (rule 1).
      ctx.window.location.hash = 'new';
      ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
      await new Promise((r) => setTimeout(r, 0));

      assert.ok(modal.classList.contains('hidden'),
        'closeRunDetail tears the top-level overlay down instead of stranding it over the next view');
    } },
    { name: 'leaving Runs tears down a modal opened from the run page', run: async () => {
      const ctx = await boot();
      seed(ctx);
      await openStop(ctx);

      const modal = ctx.window.document.getElementById('stop-modal');
      assert.equal(modal.classList.contains('hidden'), false, 'open, over the run page');
      assert.ok(ctx.window.document.getElementById('run-shell').classList.contains('detail-open'));

      ctx.window.location.hash = 'new';
      ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
      await new Promise((r) => setTimeout(r, 0));

      assert.equal(ctx.window.document.getElementById('run-shell').classList.contains('detail-open'), false,
        'leaving the view closed the detail');
      assert.ok(modal.classList.contains('hidden'), 'the overlay does not float over the next view');
      // Its document keydown listener went with it: Escape now belongs to the next view.
      esc(ctx.window);
      assert.ok(modal.classList.contains('hidden'), 'and stays down');
      assert.equal(ctx.window.location.hash, '#new', 'Escape did not route anywhere through the dead modal');
    } },
  ]);
});

// A paused run: a seed of its own (status paused, a pipeline id) — the run page still offers Stop.
function seedPaused(ctx, { status = 'paused' } = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [{ runId: RUN_ID, title: 'Parked work', projectDir: '/tmp/p', status,
      startedAt: '2026-01-01T00:00:00Z', kind: 'run', pipelineId: 'p1' }],
  });
  // What a tab really holds for a paused run: it went through done(paused) — finishRun marked
  // it _finished — like every paused run a tab learns of (a live frame or the backfill replay).
  if (status === 'paused') ctx.dispatch({ type: 'done', runId: RUN_ID, status: 'paused' });
  ctx.showRunning();
}

test('a PAUSED run: Stop reads "Keep paused" and POSTs its pipeline id with the runId', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/stop')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, pipelineId: 'p1', runId: RUN_ID, status: 'stopped' }) })
      : null),
  });
  seedPaused(ctx);
  const rdStop = await openStop(ctx);
  assert.equal(rdStop.hidden, false, 'a paused run offers Stop on its page');
  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.querySelector('.stop-cancel').textContent, 'Keep paused');
  click(ctx.window, modal.querySelector('.stop-confirm'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(stopPosts(ctx).map((c) => JSON.parse(c.opts.body)), [{ runId: RUN_ID, pipelineId: 'p1' }]);
  assert.ok(modal.classList.contains('hidden'), 'closed on success');
});

test('a paused run the server no longer holds (runId: null back): the page settles it locally', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/stop')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, pipelineId: 'p1', runId: null, status: 'stopped' }) })
      : null),
  });
  seedPaused(ctx);
  const rdStop = await openStop(ctx);
  const modal = ctx.window.document.getElementById('stop-modal');
  click(ctx.window, modal.querySelector('.stop-confirm'));
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(rdStop.hidden, true, 'the run is stopped: no more Stop on its page');
});

const tick = () => new Promise((r) => setTimeout(r, 0));

test('a paused run stopped on the same runId finishes like a live stop: Needs you drops it at once', async () => {
  const rows = [{ id: 'p1', projectKey: 'proj-alpha-abcd1234', projectDir: '/tmp/p', title: 'Parked work',
    status: 'paused', startedAt: '2026-01-01T00:00:00Z', mtime: 1 }];
  const okj = (b) => Promise.resolve({ ok: true, status: 200, json: async () => b });
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/api/history/pr') ? okj({ ok: true })
    : url.endsWith('/api/history') ? okj({ pipelines: rows, ghAvailable: false }) : null) });
  seedPaused(ctx);
  openDetail(ctx);
  for (let i = 0; i < 6; i++) await tick();
  const needs = ctx.window.document.getElementById('nav-needs-count');
  assert.equal(needs.hidden, false, 'paused: it needs you');
  // The frames the server sends on the run's own runId: no POST answer will finish it here.
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'stopped', id: 'p1' });
  ctx.dispatch({ type: 'done', runId: RUN_ID, status: 'stopped' });
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(needs.hidden, true, 'stopped: nothing needs you (not the stale paused History row)');
  assert.ok(JSON.parse(ctx.window.localStorage.getItem('worca-cc.lingerRuns') || '[]').includes(RUN_ID),
    'it lingers like a pipeline stopped live');
});

test('a stray error frame after a pause leaves the run paused', async () => {
  const ctx = await boot();
  seedPaused(ctx);
  ctx.dispatch({ type: 'error', runId: RUN_ID, message: 'late' });
  openDetail(ctx);
  await tick();
  const scr = ctx.window.document.querySelector('#run-detail');
  assert.equal(scr.querySelector('.rd-status-word').textContent, 'Paused');
  assert.equal(scr.querySelector('.rd-stop').hidden, false);
});

test('an INTERRUPTED run offers no working Stop on its page (it stays resumable)', async () => {
  const ctx = await boot();
  seedPaused(ctx, { status: 'interrupted' });
  openDetail(ctx);
  await new Promise((r) => setTimeout(r, 0));
  // The one run model never lists Stop for an interrupted run: it offers Resume and Archive.
  const stop = ctx.window.document.querySelector('#run-detail .rd-stop');
  assert.equal(stop.hidden, true);
  assert.ok(ctx.window.document.querySelector('#run-detail [data-model-action="archive"]:not([hidden])'));
});
