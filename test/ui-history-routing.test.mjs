// test/ui-history-routing.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

// Behavior tests for the saved run in the Runs pane: `#history/<projectKey>/<id>`
// routes through the existing parseHash/showView machinery into `#hist-detail`,
// inside `#runs-pane`, beside the compact list. Side by side (the `split` layout,
// jsdom's default) a bare `#runs`/`#history` reopens the remembered run, so nothing
// on the page closes the pane; in the narrow `slide` layout (set by hand: jsdom has
// no ResizeObserver) `#runs` (Back / Escape) slides the saved run away and returns
// to the list. We boot the REAL app.js against the REAL index.html under jsdom, stub
// fetch + WebSocket, and drive navigation purely through the hash.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

// Boot app.js into a fresh jsdom window. Cloned from test/ui-history.test.mjs:23-96
// with one change: `url` is a parameter so a deep-link case can boot straight
// onto a detail hash.
async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
  const { window } = dom;

  // jsdom doesn't implement scrollIntoView; the viewer modal calls it on open.
  window.Element.prototype.scrollIntoView = function () {};

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
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(u), opts || {});
      if (r) return r;
    }
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
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
  await new Promise((r) => setTimeout(r, 0)); // let loadProjects/loadConfig settle

  return { window, calls, wsBox };
}

// There is no shared settle helper: ui-history.test.mjs inlines single ticks and
// ui-history-pr.test.mjs loops 4. Three macrotasks covers fetch -> safeJson ->
// paint for both the list and the detail load.
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
function split(window) {
  window.document.getElementById('runs-shell').dataset.layout = 'split';
}

const KEY = 'proj-alpha-abcd1234';
const ROW = {
  id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj',
  title: 'Implement Log-UX Review Fixes', status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: 'worca-cc/log-ux-fcec04e8',
  sourceBranch: 'feat/log-ux', survived: true, added: 12, removed: 3,
  totalCostUsd: 153.21, totalActiveMs: 6000000, mtime: 1,
};
const DETAIL = {
  state: {
    id: ROW.id, title: ROW.title, status: 'done', startedAt: ROW.startedAt,
    stepper: null, steps: [], subAgents: [], totalCostUsd: 153.21, totalActiveMs: 6000000,
    branch: { source: 'feat/log-ux', feature: ROW.branch, worktreeDir: '/tmp/wt' },
    prompt: 'Fix the log UX.',
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
};

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

// ARM ORDER IS LOAD-BEARING: `/api/history` is a prefix of the POST
// /api/history/pr enrichment call, and the detail URL is a prefix of the log and
// diff URLs. Most-specific first, and every history arm matches with endsWith,
// never includes — `'/api/history/proj-alpha-abcd1234/…'.includes('/api/history/pr')`
// is TRUE (the project key starts with "pr"), so an `includes` PR arm swallows
// the detail fetch and hands it `{ok:true}`, which surfaces as the detail
// screen's "no saved details for this pipeline yet" error.
// The /diff and /log arms deliberately fall through (this task issues neither);
// they hold the mandated order so later tasks can fill them in place.
function handlerFor(rows, detail = DETAIL) {
  return (url) => {
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/diff')) return null;
    if (url.endsWith('/log')) return null;
    if (url.endsWith('/api/history')) return ok({ pipelines: rows, ghAvailable: false });
    for (const r of rows) {
      const key = String(r.projectKey || '');
      const detailUrl = key.startsWith('workspaces/')
        ? `/api/workspaces/${key.slice('workspaces/'.length)}/runs/${r.id}`
        : `/api/history/${key}/${r.id}`;
      if (url.endsWith(detailUrl)) return ok(detail);
    }
    return null;
  };
}

const handler = handlerFor([ROW]);

const detailHash = `history/${KEY}/${ROW.id}`;

async function openDetail(ctx) {
  go(ctx.window, detailHash);
  await settle(ctx.window);
  return ctx.window.document.querySelector('#hist-shell');
}

test('#history/<key>/<id> opens the detail screen and fetches the keyed detail URL', async () => {
  const { window, calls } = await boot({ fetchHandler: handler });
  go(window, detailHash);
  await settle(window);
  const shell = window.document.querySelector('#hist-shell');
  assert.ok(shell, '#hist-shell must exist');
  assert.ok(shell.classList.contains('detail-open'), 'the shell slides to the detail screen');
  assert.ok(calls.some((c) => c.url.includes(`/api/history/${KEY}/${ROW.id}`)), 'keyed detail URL fetched');
  assert.equal(window.document.querySelector('#hist-detail .hd-title').textContent, ROW.title);
});

test('back/Back button/Escape: side by side keeps the saved run, the slide layout returns to the list', async () => {
  const ctx = await boot({ fetchHandler: handler });
  // Each row starts side by side on a freshly opened saved run. Reopening right after a
  // slide-out is safe: its 600ms fallback clears the screen only while no run is open.
  await checkRows([
    { name: 'back to #history: side by side it reopens the saved run; in the slide it closes the detail screen', run: async () => {
      split(ctx.window);
      const shell = await openDetail(ctx);
      assert.ok(shell.classList.contains('detail-open'));

      // Split: a bare #history is #runs, which restores the run the pane showed last (D6).
      go(ctx.window, 'history');
      await settle(ctx.window);
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), detailHash, 'side by side the pane keeps the saved run');
      assert.ok(shell.classList.contains('detail-open'));

      slide(ctx.window);
      go(ctx.window, 'history');
      await settle(ctx.window);
      assert.equal(ctx.window.location.hash, '#runs', 'the legacy bare hash lands on #runs');
      assert.equal(shell.classList.contains('detail-open'), false, 'the pane slides back to the list');
      // NOT asserting #hist-detail is empty here: this is the ANIMATED close path and
      // jsdom never fires `transitionend`, so the screen is emptied only by the 600ms
      // fallback timer.
    } },
    { name: 'the Back button: slide returns to the list; side by side it keeps the saved run', run: async () => {
      split(ctx.window);
      const shell = await openDetail(ctx);
      const back = ctx.window.document.querySelector('#hist-detail .hd-back');
      assert.ok(back, 'the detail header carries a Back button');

      // Split: CSS hides the button (the list is in view); a stray click lands on #runs, which
      // restores this very run, so the glance stays.
      back.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
      await settle(ctx.window);
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), detailHash);
      assert.ok(shell.classList.contains('detail-open'));

      slide(ctx.window);
      ctx.window.document.querySelector('#hist-detail .hd-back')
        .dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
      await settle(ctx.window);
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'runs');
      assert.equal(shell.classList.contains('detail-open'), false);
    } },
    { name: 'Escape with the detail open and no modal: side by side it keeps the pane; in the slide it navigates back', run: async () => {
      split(ctx.window);
      const shell = await openDetail(ctx);

      ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(ctx.window);
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), detailHash,
        'split: Escape on the glance does nothing, the list is already in view (D16)');
      assert.ok(shell.classList.contains('detail-open'));

      slide(ctx.window);
      ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(ctx.window);
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'runs');
      assert.equal(shell.classList.contains('detail-open'), false);
    } },
  ]);
});

test('Escape is swallowed while a modal owns it', async () => {
  const ctx = await boot({ fetchHandler: handler });
  // Slide: there a leaked Escape WOULD navigate to #runs (side by side it does nothing anyway).
  slide(ctx.window);
  const shell = await openDetail(ctx);
  // At this task the detail screen has no overlay trigger of its own, so reveal
  // #confirm-modal directly. This exercises the same capture-phase guard every
  // arm uses (viewer / confirm / plugin).
  ctx.window.document.querySelector('#confirm-modal').classList.remove('hidden');

  ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(ctx.window);
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), detailHash, 'the modal owns Escape, not the router');
  assert.ok(shell.classList.contains('detail-open'), 'the detail screen stays open');
});

test('Escape is swallowed while ANY pop-up is up, not only the ones a list named (interface mode, a schedule sheet)', async () => {
  await checkRows([
    { name: 'the interface-mode dialog over the detail screen', run: async () => {
      const ctx = await boot({ fetchHandler: handler });
      slide(ctx.window);
      const shell = await openDetail(ctx);
      ctx.window.document.querySelector('#mode-modal').classList.remove('hidden');
      ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(ctx.window);
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), detailHash);
      assert.ok(shell.classList.contains('detail-open'));
    } },
    { name: 'a pop-up built by a module (the schedule sheet\'s .viewer-modal)', run: async () => {
      const ctx = await boot({ fetchHandler: handler });
      slide(ctx.window);
      const shell = await openDetail(ctx);
      const doc = ctx.window.document;
      doc.body.append(Object.assign(doc.createElement('div'), { className: 'viewer-modal sched-modal' }));
      doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(ctx.window);
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), detailHash);
      assert.ok(shell.classList.contains('detail-open'));
    } },
  ]);
});

test('unknown id renders the detail error state with a working Back', async () => {
  const missing = (url) => {
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: false });
    if (url.endsWith(`/api/history/${KEY}/nope1234`)) {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'pipeline not found' }) });
    }
    return null;
  };
  const { window } = await boot({ fetchHandler: missing });
  go(window, `history/${KEY}/nope1234`);
  await settle(window);

  const err = window.document.querySelector('#hist-detail .hd-error');
  assert.ok(err, 'the detail header carries an error slot');
  assert.equal(err.hidden, false, 'the error slot is revealed');
  assert.match(err.textContent, /Could not load run/);

  // Back is shown in the slide layout only (side by side the list is in view).
  slide(window);
  window.document.querySelector('#hist-detail .hd-back').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'runs');
  assert.equal(window.document.querySelector('#hist-shell').classList.contains('detail-open'), false);
});

test('deep-link boot opens the detail directly and upgrades the stub record when both endpoints answer', async () => {
  await checkRows([
    { name: 'deep-link boot opens the detail directly (the list still loads behind it)', run: async () => {
      // NOT "without a list paint first": on a deep-link boot prevView is null, so
      // showView DOES call loadHistoryView() and the list paints behind the track.
      // That is intended — the row is what upgrades the detail's record.
      const { window, calls } = await boot({
        fetchHandler: handler,
        url: `http://localhost:4317/#${detailHash}`,
      });
      await settle(window, 4);
      assert.ok(window.document.querySelector('#hist-shell').classList.contains('detail-open'));
      assert.ok(calls.some((c) => c.url.includes(`/api/history/${KEY}/${ROW.id}`)));
      assert.ok(calls.some((c) => c.url === '/api/history'), 'the list loads behind the detail');
      assert.ok(window.document.querySelector(`#runs-list .runs-row[data-pipeline-id="${ROW.id}"]`),
        'and its row is in the list beside the pane');
    } },
    { name: 'deep-link boot with BOTH endpoints live still upgrades the record from the stub', run: async () => {
      // THE regression this exists for. showView calls loadHistoryView() BEFORE
      // routeHistoryDetail(), so the list fetch is issued first and usually resolves
      // first: the list paint runs while the detail's `data` is still null and cannot
      // upgrade it. Without loadHistDetailScreen's own re-resolve step the minimal
      // {id, projectKey} stub sticks for the life of the screen.
      //
      // The observable proof is the title fallback chain (data.state.title ->
      // record.title -> the raw run id): serve a detail payload with NO state.title,
      // so the header can only read ROW.title off an UPGRADED record.
      const titleless = { ...DETAIL, state: { ...DETAIL.state, title: '' } };
      const { window } = await boot({
        fetchHandler: handlerFor([ROW], titleless),
        url: `http://localhost:4317/#${detailHash}`,
      });
      await settle(window, 5);
      assert.equal(
        window.document.querySelector('#hist-detail .hd-title').textContent,
        ROW.title,
        'the authoritative list row won — not the raw run id from the stub',
      );
      assert.equal(
        window.document.querySelector('#hist-detail .hd-branch-name').textContent,
        ROW.branch,
        'the branch row painted from the upgraded record too',
      );
    } },
  ]);
});
