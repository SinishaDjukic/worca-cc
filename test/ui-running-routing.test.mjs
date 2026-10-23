// test/ui-running-routing.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

// Behavior tests for the live run in the Runs pane: `#running/<runId>` routes
// through the existing parseHash/showView machinery into `#run-detail`, inside
// `#runs-pane`, beside the compact list (`#runs-list-pane`). Side by side (the
// `split` layout, jsdom's default) nothing on the page closes the pane; in the
// narrow `slide` layout (set by hand: jsdom has no ResizeObserver) `#runs`
// (Back / Escape) slides the run away and returns to the list.
//
// boot() / settle() / go() are copied verbatim from test/ui-history-routing.test.mjs
// (boot 25-84, settle 89-91, go 93-96), with the fetch handler collapsed to this
// suite's two arms; the open() / recv() WebSocket drivers are copied verbatim from
// test/ui-pipeline-tabs.test.mjs:31-33. No shared harness — the duplication is
// the house convention.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';
const ID = 'auth-fix';
const OTHER = 'seo-pSEO';

// `route(url)` may answer a request first (a Response-like object or a Promise); undefined falls through.
async function boot({ url = 'http://localhost:4317/', storage = {}, route = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    const own = route ? route(String(u)) : undefined;
    if (own !== undefined) return own;
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }),
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
  window.localStorage.clear();   // T4's density key must not leak between cases
  // Seeded before app.js loads: the remembered run (worca-cc.runs.last) is read on routing.
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, calls, recv };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

// The narrow layout, by hand: jsdom has no ResizeObserver, so #runs-shell stays `split`
// unless a test flips it (measureRunsLayout keeps the last value on a 0px width).
function slide(window) {
  window.document.getElementById('runs-shell').dataset.layout = 'slide';
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

async function bootWithRuns() {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(ID), live(OTHER)] });
  await settle(ctx.window);
  return ctx;
}

// ---------- structure ----------

// ---------- open / close ----------

test('#running/<id> opens the detail screen and paints its header', async () => {
  const ctx = await bootWithRuns();
  const { window } = ctx;
  go(window, `running/${ID}`);
  await settle(window);
  const doc = window.document;
  const shell = doc.querySelector('#run-shell');
  assert.ok(shell.classList.contains('detail-open'), 'the live detail is open in the pane');
  assert.equal(doc.querySelector('#runs-pane').dataset.kind, 'live');

  const host = doc.querySelector('#run-detail');
  assert.equal(host.getAttribute('aria-hidden'), 'false');
  assert.equal(host.hasAttribute('inert'), false, 'the open screen is interactive');
  const listPane = doc.querySelector('#runs-list-pane');
  assert.equal(listPane.hasAttribute('aria-hidden'), false, 'side by side the list stays in view');
  assert.equal(listPane.hasAttribute('inert'), false, 'and reachable');

  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, ID);
  const status = doc.querySelector('#run-detail .rd-status');
  assert.ok(status.classList.contains('peach'), 'a running pipeline takes statusPill\'s peach family');
  assert.equal(status.querySelector('.rd-status-word').textContent, 'Running');
  assert.match(doc.querySelector('#run-detail .rd-meta').textContent, /proj/);
  // startedLabel passes a bare time string through unchanged (app.js:10912-10917).
  assert.match(doc.querySelector('#run-detail .rd-meta').textContent, /started 10:00/);
  // A run with no step yet reads Starting in the one run model (runs redesign slice 4): Stop, and Pause once a step runs.
  assert.equal(doc.querySelector('#run-detail .rd-pause').hidden, true, 'a starting run offers no Pause yet');
  assert.equal(doc.querySelector('#run-detail .rd-stop').hidden, false);
  ctx.recv({ type: 'state', runId: ID, status: 'running', steps: [{ executionId: 'x:n:1', nodeId: 'n', ordinal: 1, cycle: 1, kind: 'cycle',
    status: 'start', startedAt: '2026-01-01T00:00:00Z' }], active: [{ nodeId: 'n', executionId: 'x:n:1' }] });
  await settle(window);
  assert.equal(doc.querySelector('#run-detail .rd-pause').hidden, false, 'a live run with a step offers Pause');
  assert.equal(doc.querySelector('#run-detail .rd-stop').hidden, false);
});

test('slice 2: split layout: Back shows the list itself; a second settle does not reopen the run (D6 restore skipped)', async () => {
  const { window } = await bootWithRuns();
  window.document.getElementById('runs-shell').dataset.layout = 'split';
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');
  assert.ok(shell.classList.contains('detail-open'));
  window.document.querySelector('#run-detail .rd-back')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'runs');
  assert.equal(shell.classList.contains('detail-open'), false);
  window.dispatchEvent(new window.Event('hashchange'));     // a hashchange echo
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'runs', 'the remembered run is not reopened');
  assert.equal(shell.classList.contains('detail-open'), false);
  assert.equal(window.localStorage.getItem('worca-cc.runs.last'), null, 'Back forgets the run: a later bare #runs shows the list');
  go(window, 'chat/new');
  await settle(window);
  go(window, 'runs');
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'runs');
  assert.equal(shell.classList.contains('detail-open'), false, 'a return from Chat does not reopen the run');
});

test('slide layout: Back returns to #runs, the closing detail stays mounted + inert until the guarded transitionend, and focus returns to the originating row', async () => {
  await checkRows([
    { name: 'slide layout: the Back button returns to #runs and closes the screen', run: async () => {
      const { window } = await bootWithRuns();
      slide(window);
      go(window, `running/${ID}`);
      await settle(window);
      const shell = window.document.querySelector('#run-shell');

      window.document.querySelector('#run-detail .rd-back')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      window.dispatchEvent(new window.Event('hashchange'));
      await settle(window);
      assert.equal(window.location.hash.replace(/^#/, ''), 'runs');
      assert.equal(shell.classList.contains('detail-open'), false);
      assert.equal(window.document.querySelector('#runs-pane').dataset.kind, '');
    } },
    { name: 'slide layout: closing the detail restores focus to the originating row', run: async () => {
      const { window } = await bootWithRuns();
      slide(window);
      // The list only paints while the Runs view is shown (the paint is gated on
      // inRunsView()), so visit it before reading the row the focus comes home to.
      go(window, 'runs');
      await settle(window);
      const row = window.document.querySelector(`#runs-list .runs-row[data-run-id="${ID}"]`);
      assert.ok(row, 'the run has a row in the list');
      assert.equal(row.tagName, 'A', 'rows are links, focusable without a tabindex');

      go(window, `running/${ID}`);
      await settle(window);
      assert.equal(window.document.querySelector('#runs-list-pane').hasAttribute('inert'), true,
        'the list slid away');
      window.document.querySelector('#run-detail .rd-back')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      window.dispatchEvent(new window.Event('hashchange'));
      await settle(window);

      const active = window.document.activeElement;
      assert.ok(active && active.classList.contains('runs-row'), 'focus returned to a row, not <body>');
      assert.equal(active.dataset.runId, ID,
        'and to the row the detail was opened from (re-queried by data-run-id)');
      assert.equal(window.document.querySelector('#runs-list-pane').hasAttribute('inert'), false);
    } },
    { name: 'slide layout: the closing detail stays mounted + inert until the pane\'s guarded transitionend', run: async () => {
      const { window } = await bootWithRuns();
      slide(window);
      go(window, `running/${ID}`);
      await settle(window);
      const host = window.document.querySelector('#run-detail');
      const pane = window.document.querySelector('#runs-pane');

      window.document.querySelector('#run-detail .rd-back')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      window.dispatchEvent(new window.Event('hashchange'));
      await settle(window);
      assert.equal(host.getAttribute('aria-hidden'), 'true');
      assert.equal(host.hasAttribute('inert'), true, 'untabbable while it slides away');
      assert.ok(host.children.length > 0, 'with its content still mounted — that is the point');

      const fire = (target, propertyName) => {
        const e = new window.Event('transitionend', { bubbles: true });
        Object.defineProperty(e, 'propertyName', { value: propertyName });
        target.dispatchEvent(e);
      };
      // transitionend BUBBLES: a descendant's own transition must not clear the DOM.
      fire(host.querySelector('.rd-header'), 'transform');
      assert.ok(host.children.length > 0, 'a descendant transition is ignored');
      fire(host, 'transform');
      assert.ok(host.children.length > 0, 'the screen is inside the pane: only the pane\'s own slide counts');
      fire(pane, 'opacity');
      assert.ok(host.children.length > 0, 'a non-transform property is ignored');
      fire(pane, 'transform');
      assert.equal(host.children.length, 0, 'the pane\'s own transform end clears the screen');
    } },
  ]);
});

// ---------- header actions ----------
// C7 hands `.rd-stop` to Task 10, which replaces the handler BODY in place and
// rewrites the first case below (Task 10 Step 11b). Without these two, the
// header's only two controls ship untested through Tasks 5-9.

test('.rd-pause posts /api/pause, then becomes Resume when the run parks', async () => {
  const { window, calls, recv } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const btn = () => window.document.querySelector('#run-detail .rd-pause');
  assert.equal(btn().dataset.action, 'pause');
  assert.equal(btn().querySelector('.rd-btn-label').textContent, 'Pause');

  btn().dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  const posts = calls.filter((c) => c.url.includes('/api/pause'));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].opts.body), { runId: ID });
  assert.equal(btn().disabled, true, 'pauseRun disabled it for the duration of the request');

  // C16 REGRESSION GUARD. The server has NOT answered yet: r.status is still
  // 'running'. Frames keep arriving (a phase/subagent/cost frame routinely beats
  // the `pausing` snapshot), and each one repaints this header. If paintRdHeader
  // writes `disabled` unconditionally the button is re-armed inside the request
  // window and a second click POSTs /api/pause twice.
  recv({ type: 'phase', runId: ID, phase: 'implement', status: 'start', cycle: 1 });
  await settle(window);
  assert.equal(btn().disabled, true, 'a repaint mid-request must NOT re-enable Pause');
  btn().dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  assert.equal(calls.filter((c) => c.url.includes('/api/pause')).length, 1,
    'still exactly one pause POST');

  recv({ type: 'done', runId: ID, status: 'paused' });   // a pause routes through finishRun
  await settle(window);
  assert.equal(btn().dataset.action, 'resume', 'ONE control, two actions (C6) — there is no .rd-resume');
  assert.equal(btn().querySelector('.rd-btn-label').textContent, 'Resume');
  assert.equal(btn().hidden, false, 'a parked run still offers it');
  assert.equal(btn().disabled, false,
    'the ACTION flipped, so the disable is re-evaluated and the control comes back');
});

// ---------- Escape ----------

test('Escape with the detail open: side by side keeps the pane, in the slide navigates back; on another view it never touches the Runs track', async () => {
  await checkRows([
    { name: 'Escape with the detail open and no modal: side by side it keeps the pane; in the slide it navigates back', run: async () => {
      const { window } = await bootWithRuns();
      go(window, `running/${ID}`);
      await settle(window);
      const shell = window.document.querySelector('#run-shell');

      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(window);
      assert.equal(window.location.hash.replace(/^#/, ''), `running/${ID}`,
        'split: the list is already in view, so Escape on the glance does nothing (D16)');
      assert.ok(shell.classList.contains('detail-open'));

      slide(window);
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(window);
      assert.equal(window.location.hash.replace(/^#/, ''), 'runs');
      assert.equal(shell.classList.contains('detail-open'), false);
    } },
    { name: 'Escape on another view never touches the Running track', run: async () => {
      const { window } = await bootWithRuns();
      slide(window);   // where a leaked Escape would navigate to #runs
      go(window, `running/${ID}`);
      await settle(window);
      // Force the shell to stay open while the hash points elsewhere: the guard is
      // currentView(), not the class, so a stale open shell must not swallow Escape.
      window.location.hash = 'new';
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(window);
      assert.equal(window.location.hash.replace(/^#/, ''), 'new');
    } },
  ]);
});

// ---------- transitionend cleanup ----------

// ---------- detail -> detail ----------

test('a detail->detail hop rebuilds in place and never runs the close path', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  const removed = [];
  const origRemove = shell.classList.remove.bind(shell.classList);
  shell.classList.remove = (...a) => { removed.push(...a); return origRemove(...a); };

  go(window, `running/${OTHER}`);
  await settle(window);
  assert.equal(removed.includes('detail-open'), false, 'the track never slid back to the list');
  assert.ok(shell.classList.contains('detail-open'));
  assert.equal(window.document.querySelector('#run-detail .rd-title').textContent, OTHER,
    'the screen was rebuilt for the new run');
});

// ---------- animation gating ----------

// ---------- deep link / unknown id ----------

test('deep-link boot opens the detail before hello, then upgrades from it', async () => {
  const { window, recv } = await boot({ url: `http://localhost:4317/#running/${ID}` });
  await settle(window);
  const doc = window.document;
  assert.ok(doc.querySelector('#run-shell').classList.contains('detail-open'),
    'the detail is open even though the runs Map is still empty');
  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, ID,
    'the raw runId stands in until hello lands');

  recv({ type: 'hello', runs: [live(ID, { title: 'Fix the auth flow' })] });
  await settle(window);
  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, 'Fix the auth flow');
  assert.equal(window.location.hash.replace(/^#/, ''), `running/${ID}`, 'no bounce');
});

test('a run id hello does not know bounces to #runs, whether deep-linked before hello or typed after it', async () => {
  await checkRows([
    { name: 'a deep link to a run hello does not know bounces to #runs', run: async () => {
      const { window, recv } = await boot({ url: 'http://localhost:4317/#running/ghost' });
      await settle(window);
      recv({ type: 'hello', runs: [live(ID)] });
      await settle(window);
      assert.equal(window.location.hash.replace(/^#/, ''), 'runs',
        'once hello has been processed an unknown id is genuinely bad');
      assert.equal(window.document.querySelector('#run-shell').classList.contains('detail-open'), false);
      assert.equal(window.document.querySelector('#runs-empty').hidden, false, 'the list and the empty pane');
    } },
    { name: 'an unknown id typed after hello bounces immediately', run: async () => {
      const { window } = await bootWithRuns();
      go(window, 'running/ghost');
      await settle(window);
      assert.equal(window.location.hash.replace(/^#/, ''), 'runs');
      assert.equal(window.document.querySelector('#run-shell').classList.contains('detail-open'), false);
    } },
  ]);
});

test('a deep link to a run hello does not know lands on its saved page when the pane remembers it', async () => {
  const KEY = 'proj-0000abcd';
  const storage = { 'worca-cc.runs.last': JSON.stringify({ runId: 'ghost', pipelineId: 'aaaa0001', projectKey: KEY }) };
  const { window, recv } = await boot({ url: 'http://localhost:4317/#running/ghost', storage });
  await settle(window);
  recv({ type: 'hello', runs: [live(ID)] });
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), `history/${KEY}/aaaa0001`,
    'the remembered run ended: its saved page, not the list (D6)');
  assert.equal(window.document.querySelector('#run-shell').classList.contains('detail-open'), false);
  assert.ok(window.document.querySelector('#hist-shell').classList.contains('detail-open'));
});

test('a #running/ link from chat history for a finished run opens its saved page (§5a.1)', async () => {
  const answer = (status, body) => Promise.resolve({ ok: status === 200, status, json: async () => body });
  await checkRows([
    { name: 'the server names the saved run: #history/KEY/PID', run: async () => {
      const route = (u) => (u.includes('/api/run-links/') ? answer(200, { pipelineId: 'p-chat', historyKey: 'k' }) : undefined);
      const { window, recv, calls } = await boot({ url: 'http://localhost:4317/#running/run-old-1', route });
      await settle(window);
      recv({ type: 'hello', runs: [] });
      await settle(window, 6);
      assert.ok(calls.some((c) => c.url === '/api/run-links/run-old-1'), 'the server was asked');
      assert.equal(window.location.hash, '#history/k/p-chat');
    } },
    { name: 'the server does not know it either: #runs and one info toast', run: async () => {
      const route = (u) => (u.includes('/api/run-links/') ? answer(404, { error: 'No saved run for that link' }) : undefined);
      const { window, recv } = await boot({ url: 'http://localhost:4317/#running/run-old-1', route });
      await settle(window);
      recv({ type: 'hello', runs: [] });
      await settle(window, 6);
      assert.equal(window.location.hash, '#runs');
      const toasts = [...window.document.querySelectorAll('.toast.info')].filter((t) => t.textContent.includes('no longer open'));
      assert.equal(toasts.length, 1);
    } },
    { name: 'the person moved on before the answer: no navigation', run: async () => {
      let release;
      const route = (u) => (u.includes('/api/run-links/') ? new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ pipelineId: 'p-chat', historyKey: 'k' }) }); }) : undefined);
      const { window, recv } = await boot({ url: 'http://localhost:4317/#running/run-old-1', route });
      await settle(window);
      recv({ type: 'hello', runs: [] });
      await settle(window);
      go(window, 'schedules');
      await settle(window);
      release();
      await settle(window, 6);
      assert.equal(window.location.hash, '#schedules');
    } },
  ]);
});

// ---------- leave-guard ----------

test('leaving the running view resets the track synchronously', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  go(window, 'new');
  await settle(window);
  assert.equal(shell.classList.contains('detail-open'), false);
  assert.equal(window.document.querySelector('#run-detail').children.length, 0,
    'the instant close path empties the screen synchronously');
});

// ---------- CSS ----------
