// test/ui-running-stop-modal.test.mjs — the dedicated "Stop this pipeline?" confirm
// modal (design §6 / D5). Opened from the card's .btn-stop AND the detail header's
// .rd-stop; both stamp the target runId. Keep running cancels, Stop pipeline POSTs
// /api/stop, a failure renders inline, Escape + backdrop close it, and Escape while
// it is open must NOT also navigate the detail screen back to the list.
//
// boot()/dispatch()/showRunning() are a deliberate verbatim copy of
// test/ui-question.test.mjs:19-82 (plus the `scrollIntoView` stub the detail
// screen needs) — the suites do not import each other.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state (stopModalClose, runDetailState) can't leak between cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
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
  function showRunning() {
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

test('the card Stop button opens #stop-modal with the run identity and POSTs nothing', async () => {
  const ctx = await boot();
  seed(ctx);

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  assert.ok(card, 'run card exists');
  const modal = ctx.window.document.getElementById('stop-modal');
  assert.ok(modal, '#stop-modal exists in index.html');
  assert.ok(modal.classList.contains('hidden'), 'modal starts closed');

  click(ctx.window, card.querySelector('.btn-stop'));

  assert.equal(modal.classList.contains('hidden'), false, 'Stop opens the modal');
  assert.equal(modal.dataset.runId, RUN_ID, 'the opener stamps the target runId');
  assert.equal(modal.querySelector('.stop-title').textContent, 'Stop this pipeline?');
  assert.match(
    modal.querySelector('.stop-body').textContent,
    /^Agents in flight are cancelled at their next checkpoint\. The run moves to History as stopped; its worktree and branch stay in place so you can resume from there\.$/,
  );
  assert.equal(modal.querySelector('.stop-ident-title').textContent, 'Implement Chat Connectivity Follow-ups');
  assert.equal(modal.querySelector('.stop-ident-branch').textContent, BRANCH);
  assert.equal(modal.querySelector('.stop-ident-branch').hidden, false, 'branch line shown when known');
  assert.equal(modal.querySelector('.stop-cancel').textContent, 'Keep running');
  assert.equal(modal.querySelector('.stop-confirm').textContent, 'Stop pipeline');
  assert.equal(stopPosts(ctx).length, 0, 'opening the modal must not stop anything');
});

test('a run with no feature branch hides the branch line', async () => {
  const ctx = await boot();
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [{ runId: RUN_ID, title: 'No branch yet', projectDir: '/tmp/p', status: 'running',
      startedAt: '2026-01-01T00:00:00Z', kind: 'run' }],
  });
  ctx.showRunning();

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.querySelector('.stop-ident-title').textContent, 'No branch yet');
  assert.equal(modal.querySelector('.stop-ident-branch').hidden, true, 'no branch -> line hidden');
});

test('"Keep running" closes the modal without POSTing /api/stop', async () => {
  const ctx = await boot();
  seed(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  click(ctx.window, modal.querySelector('.stop-cancel'));

  assert.ok(modal.classList.contains('hidden'), 'Keep running closes it');
  assert.equal(modal.dataset.runId, undefined, 'the runId stamp is cleared on close');
  assert.equal(stopPosts(ctx).length, 0, 'cancel never stops the run');
});

test('"Stop pipeline" POSTs /api/stop {runId} and closes the modal', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/stop')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
      : null),
  });
  seed(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

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
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  const ok = modal.querySelector('.stop-confirm');
  click(ctx.window, ok);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(modal.classList.contains('hidden'), false, 'the modal stays open on failure');
  const err = modal.querySelector('.stop-err');
  assert.equal(err.hidden, false, 'the inline error slot is shown');
  assert.match(err.textContent, /run already finished/);
  assert.equal(ok.disabled, false, 'the confirm button is re-enabled');
  assert.equal(ok.textContent, 'Stop pipeline', 'the busy label is restored');
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
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

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
  modal.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));   // backdrop
  assert.equal(modal.classList.contains('hidden'), false, 'backdrop mid-flight is ignored');

  release();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(modal.classList.contains('hidden'), 'the modal closes when the stop actually lands');
  assert.equal(stopPosts(ctx).length, 1, 'exactly one POST /api/stop');
});

test('backdrop click closes; a click inside the card does not', async () => {
  const ctx = await boot();
  seed(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  click(ctx.window, modal.querySelector('.stop-ident'));       // inside the dialog card
  assert.equal(modal.classList.contains('hidden'), false, 'clicks inside the card do not close');

  modal.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));   // the overlay itself
  assert.ok(modal.classList.contains('hidden'), 'backdrop click closes');
  assert.equal(stopPosts(ctx).length, 0);
});

// The Running detail screen's Escape handler is CAPTURE-phase (Task 5, modelled on
// History's at app.js:10734-10744), and openStopModal's own Escape listener is
// bubble-phase. Capture therefore runs FIRST: without an explicit `#stop-modal`
// guard in that handler, one Escape would close the modal AND navigate the detail
// screen back to the list. These two cases lock the guard down.
function openDetail(ctx) {
  ctx.window.location.hash = `running/${RUN_ID}`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
}

test('the detail header Stop pill opens the same modal, stamped with the same runId', async () => {
  const ctx = await boot();
  seed(ctx);
  openDetail(ctx);
  await new Promise((r) => setTimeout(r, 0));

  const detail = ctx.window.document.getElementById('run-detail');
  const rdStop = detail.querySelector('.rd-stop');
  assert.ok(rdStop, '.rd-stop present on the detail header');
  click(ctx.window, rdStop);

  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false, '.rd-stop opens the modal');
  assert.equal(modal.dataset.runId, RUN_ID, 'the detail opener stamps the same runId');
  assert.equal(stopPosts(ctx).length, 0);
});

test('Escape closes the modal and does NOT also navigate the detail back', async () => {
  const ctx = await boot();
  seed(ctx);
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
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'running',
    'once the modal is gone Escape navigates back');
});

test('leaving the detail while the modal is open tears the overlay down', async () => {
  const ctx = await boot();
  seed(ctx);
  openDetail(ctx);
  await new Promise((r) => setTimeout(r, 0));
  click(ctx.window, ctx.window.document.querySelector('#run-detail .rd-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false);

  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(modal.classList.contains('hidden'),
    'closeRunDetail tears the top-level overlay down instead of stranding it over the list');
});

// The LIST-card path. closeRunDetail's teardown sits BELOW its `detail-open`
// early return — deliberately, since routeRunDetail('') calls it on every plain
// `#running` route and hoisting it would dismiss a list-owned modal. But the
// same early return is on the leave-guard path, so leaving Running entirely used
// to strand a `position:fixed;inset:0` overlay and a live document keydown
// listener over the next view.
test('leaving Running tears down a modal opened from a LIST card', async () => {
  const ctx = await boot();
  seed(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'open, with no detail screen behind it');
  assert.equal(ctx.window.document.getElementById('run-shell').classList.contains('detail-open'), false);

  ctx.window.location.hash = 'history';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(modal.classList.contains('hidden'), 'the overlay does not float over History');
  // Its document keydown listener went with it: Escape now belongs to History,
  // whose own capture-phase handler must also refuse to act while it IS open.
  esc(ctx.window);
  assert.ok(modal.classList.contains('hidden'), 'and stays down');
});
