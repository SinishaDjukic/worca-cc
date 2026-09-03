// test/ui-history-shipit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for the "Ship it?" confirm modal and the History DETAIL header's
// PR control: one shared eligibility predicate (histPrEligible), a modal that
// summarizes the change and POSTs /api/pr, and the tri-state header (Create PR /
// OPEN link / MERGED link) kept in step with the list card behind it.
//
// boot()/settle()/go() are a deliberate local copy of
// test/ui-history-detail.test.mjs:25-96 — the suites do not import each other.
// prTokens()/dispatchPr() mirror test/ui-history-pr-phase.test.mjs:45-46.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state (pendingShipIt, shipItClose, histDetailState) can't leak.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
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

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const KEY = 'proj-alpha-abcd1234';
const WKS_KEY = 'workspaces/team-a';
const ROW = {
  id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj',
  title: 'Implement Log-UX Review Fixes', status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: 'worca-cc/log-ux-fcec04e8',
  sourceBranch: 'feat/log-ux', survived: true, added: 12, removed: 3,
  totalCostUsd: 153.21, totalActiveMs: 6000000, mtime: 1,
  pauseReason: null, retainedWork: null, pr: null,     // resolved: no PR yet
};
// Fresh object per boot: a successful ship MUTATES the row it is handed
// (`record.pr = pr`, and the record IS the object in state.historyAll), so a
// shared const would hand the next test a run that already has an open PR.
const row = (over = {}) => ({ ...ROW, ...over });
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
const RESULTS = {
  summary: {
    filesNew: 1, filesChanged: 13, filesDeleted: 0,
    linesAdded: 412, linesRemoved: 188, blockingIssues: 0, nitpicks: 0,
  },
  newFiles: [], changedFiles: [], keyThingsToCheck: [], nitpicks: [],
};

const DAY = 86400000;
const okBudget = () => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
});

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

const DETAIL_URL = `/api/history/${KEY}/${ROW.id}`;
const WKS_DETAIL_URL = `/api/workspaces/team-a/runs/${ROW.id}`;
const detailHash = `history/${KEY}/${ROW.id}`;
const wksDetailHash = `history/${WKS_KEY}/${ROW.id}`;

// ARM ORDER IS LOAD-BEARING (ui-history-routing.test.mjs:119-127): the detail URL
// is a PREFIX of the /log and /diff URLs, and `/api/history` is a prefix of the
// POST /api/history/pr enrichment call. Most-specific first, and every history arm
// matches with endsWith, never includes — except the remotes arm, whose URL carries
// a query string (it can never collide with the `/api/pr` endsWith matchers).
function historyArms(box) {
  return (url) => {
    if (/\/api\/pr\/remotes\?/.test(url)) return box.remotes ? ok(box.remotes) : fail(500, { error: 'git remote failed' });
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (url.endsWith('/log')) return fail(404, { error: 'no log' });
    if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: box.gh });
    if (url.endsWith(DETAIL_URL) || url.endsWith(WKS_DETAIL_URL)) return ok(box.detail);
    if (url.endsWith('/api/budget')) return ok(box.budget);
    return null;
  };
}

async function bootShip({ rows = [row()], detail = DETAIL, gh = true, arms = null, deepLink = false, remotes = REMOTES } = {}) {
  const box = { rows, detail, gh, remotes, budget: okBudget() };
  const base = historyArms(box);
  const ctx = await boot({
    fetchHandler: (url, opts) => (arms && arms(url, opts, box)) || base(url, opts),
    url: deepLink ? `http://localhost:4317/#${detailHash}` : 'http://localhost:4317/',
  });
  ctx.box = box;
  ctx.prTokens = () => ctx.calls
    .filter((c) => c.url.endsWith('/api/history/pr') && c.opts.body)
    .map((c) => JSON.parse(c.opts.body).token);
  ctx.dispatchPr = (msg) => ctx.wsBox.ws.dispatch('message', {
    data: JSON.stringify({ type: 'history-pr', done: true, items: [], ...msg }),
  });
  return ctx;
}

async function openDetail(ctx, hash = detailHash) {
  go(ctx.window, hash);
  await settle(ctx.window);
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

const modalOf = (w) => w.document.querySelector('#shipit-modal');
const isOpen = (w) => !modalOf(w).classList.contains('hidden');
const hdPr = (w) => w.document.querySelector('#hist-detail .hd-pr');
const hdPrLink = (w) => w.document.querySelector('#hist-detail .hd-pr-link');
const hdMerge = (w) => w.document.querySelector('#hist-detail .hd .hist-merge');
// `/api/pr/mergeable` does NOT endsWith('/api/pr'), so this counts creates only.
const prPosts = (ctx) => ctx.calls.filter((c) => c.url.endsWith('/api/pr') && c.opts.method === 'POST');

// Standard happy-path PR arm.
const prArm = (body) => (url, opts) => (
  url.endsWith('/api/pr') && opts.method === 'POST' ? ok(body) : null);
const PR_OK = { ok: true, url: 'https://x/pull/7', mergeable: 'MERGEABLE', existed: false };

// Shapes mirror GET /api/pr/remotes.
const remote = (name, owner, url) => ({ name, fetchUrl: url, pushUrl: url, host: 'github.com', owner, repo: 'repo', slug: `${owner}/repo` });
const REMOTES = { ok: true, remotes: [remote('origin', 'me', 'https://github.com/me/repo.git')],
  defaults: { pushRemote: 'origin', baseRemote: 'origin' }, remembered: null };
const FORK_REMOTES = { ok: true,
  remotes: [remote('origin', 'me', 'https://github.com/me/repo.git'), remote('upstream', 'up', 'git@github.com:up/repo.git')],
  defaults: { pushRemote: 'origin', baseRemote: 'upstream' }, remembered: null };
const remotesCalls = (ctx) => ctx.calls.filter((c) => /\/api\/pr\/remotes\?/.test(c.url));   // like prPosts above
const optionValues = (sel) => [...sel.options].map((o) => o.value);

// Open the detail screen and press its Create-PR button.
async function openModal(ctx) {
  await openDetail(ctx);
  const btn = hdPr(ctx.window);
  assert.equal(btn.hidden, false, 'an eligible, resolved run offers Create PR');
  click(ctx.window, btn);
  await settle(ctx.window);          // let the remotes fetch land before a test confirms
  return modalOf(ctx.window);
}

// ---------------------------------------------------------------------------
// Opening + the summary line
// ---------------------------------------------------------------------------

test('detail Create PR opens the ship-it modal with the summary + branch → base', async () => {
  const ctx = await bootShip({ detail: { ...DETAIL, results: RESULTS } });
  const modal = await openModal(ctx);
  assert.equal(modal.classList.contains('hidden'), false);
  assert.match(modal.textContent, /Ship it\?/);
  assert.match(modal.textContent, /14 files/);        // filesNew + filesChanged, 'D' rows not double-counted
  assert.match(modal.textContent, /\+412/);
  assert.match(modal.textContent, /−188/);            // U+2212 — this is a COUNT
  assert.match(modal.querySelector('.shipit-branch').textContent, /log-ux/);
  assert.equal(modal.querySelector('.shipit-base').textContent, 'feat/log-ux');
  assert.match(modal.querySelector('.shipit-sub').textContent, /Implement Log-UX Review Fixes/);
});

test('the summary falls back to the live list counts and drops the middot with them', async () => {
  const ctx = await bootShip();                        // DETAIL.results === null
  const modal = await openModal(ctx);
  const files = modal.querySelector('.shipit-files');
  assert.equal(modal.querySelector('.shipit-summary').hidden, false, 'counts still summarize the change');
  assert.equal(files.textContent, '', 'no persisted results -> no file count');
  assert.equal(modal.querySelector('.shipit-add').textContent, '+12');
  assert.equal(modal.querySelector('.shipit-del').textContent, '−3');   // U+2212
  // `.shipit-files:empty + .shipit-dot{display:none}` can only fire while the dot
  // is the count's IMMEDIATE sibling — assert the structure the rule keys off
  // (jsdom does not load the linked stylesheet, so computed style proves nothing).
  assert.ok(files.nextElementSibling.classList.contains('shipit-dot'),
    'the separator is the file count\'s adjacent sibling so it collapses with it');
  // NOT tested: "survived false -> .shipit-summary hidden". That state is
  // UNREACHABLE through the UI — histPrEligible requires `survived` and gates both
  // doors into the modal — and openShipItModal has no test seam.
});

// ---------------------------------------------------------------------------
// Confirming
// ---------------------------------------------------------------------------

test('confirm POSTs /api/pr and swaps the header control to a link + merge pill', async () => {
  const ctx = await bootShip({ arms: prArm(PR_OK) });
  const modal = await openModal(ctx);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 6);

  const post = prPosts(ctx)[0];
  assert.ok(post, 'the confirm button POSTs /api/pr');
  assert.deepEqual(JSON.parse(post.opts.body),
    { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id, pushRemote: 'origin', baseRemote: 'origin' });
  assert.equal(modal.classList.contains('hidden'), true, 'a successful ship closes the modal');
  const link = hdPrLink(ctx.window);
  assert.equal(link.hidden, false);
  assert.equal(link.href, 'https://x/pull/7');
  assert.equal(link.textContent, 'View PR');
  assert.equal(hdPr(ctx.window).hidden, true, 'the button never coexists with the link');
  // `.hd .hist-merge` only — the pill is a SIBLING of `.hd-pr` in row 1, so a
  // `.hd-pr .hist-merge` alternative could never match.
  assert.match(hdMerge(ctx.window).textContent, /can merge/);
});

test('existed:true still resolves to a View PR link', async () => {
  const ctx = await bootShip({ arms: prArm({ ...PR_OK, url: 'https://x/pull/11', existed: true }) });
  const modal = await openModal(ctx);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 6);
  const link = hdPrLink(ctx.window);
  assert.equal(link.hidden, false);
  assert.equal(link.textContent, 'View PR');
  assert.equal(link.href, 'https://x/pull/11');
});

test('UNKNOWN mergeability schedules exactly one recheck', async () => {
  const ctx = await bootShip({
    arms: (url, opts) => {
      if (url.endsWith('/api/pr/mergeable')) return ok({ ok: true, mergeable: 'CONFLICTING' });
      if (url.endsWith('/api/pr') && opts.method === 'POST') return ok({ ...PR_OK, mergeable: 'UNKNOWN' });
      return null;
    },
  });
  // prMergeRecheckMs() (app.js:8880) reads the seam at CALL time, so setting it on
  // the RETURNED window after boot is enough — the helper builds the JSDOM itself.
  ctx.window.__prMergeRecheckMs = 0;
  const modal = await openModal(ctx);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 8);
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/api/pr/mergeable')).length, 1,
    'exactly one recheck, never a poll loop');
  assert.match(hdMerge(ctx.window).textContent, /conflicts/);
});

test('PR failure shows the error inside the modal and re-enables confirm', async () => {
  const ctx = await bootShip({
    arms: (url, opts) => (url.endsWith('/api/pr') && opts.method === 'POST'
      ? fail(500, { error: 'push failed' }) : null),
  });
  const modal = await openModal(ctx);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 6);
  const err = modal.querySelector('.shipit-err');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /push failed/);
  assert.equal(modal.classList.contains('hidden'), false, 'a failure keeps the modal open');
  assert.equal(modal.querySelector('.shipit-ok').disabled, false, 'confirm is retryable');
  assert.equal(hdPrLink(ctx.window).hidden, true, 'no link for a PR that was never opened');
});

// ---------------------------------------------------------------------------
// Closing, and the handler-stacking guards
// ---------------------------------------------------------------------------

test('cancel / Escape / backdrop close without POSTing', async () => {
  const ctx = await bootShip({ arms: prArm(PR_OK) });
  const { window } = ctx;
  const modal = await openModal(ctx);

  const closers = {
    cancel: () => click(window, modal.querySelector('.shipit-cancel')),
    backdrop: () => click(window, modal),          // e.target === the overlay itself
    escape: () => window.document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  };
  for (const [name, close] of Object.entries(closers)) {
    if (!isOpen(window)) click(window, hdPr(window));      // re-open for the next variant
    assert.ok(isOpen(window), `${name}: the modal is open first`);
    close();
    await settle(window);
    assert.equal(isOpen(window), false, `${name} closes the modal`);
    assert.equal(prPosts(ctx).length, 0, `${name} never POSTs /api/pr`);
    // Escape belongs to the modal, not the detail screen: the run stays open.
    assert.ok(window.document.querySelector('#hist-shell').classList.contains('detail-open'),
      `${name} leaves the detail screen open`);
  }
});

test('a second open does not stack a second confirm handler', async () => {
  const ctx = await bootShip({ arms: prArm(PR_OK) });
  const modal = await openModal(ctx);
  click(ctx.window, hdPr(ctx.window));                     // second open while already open
  assert.equal(modal.classList.contains('hidden'), false);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 6);
  assert.equal(prPosts(ctx).length, 1, 'one confirm click === one POST');
});

test('cancelling while the POST is in flight cannot stack a second confirm handler', async () => {
  // Regression guard: `done()` used to be non-idempotent, so the stale generation
  // hid the freshly-opened modal, nulled the new generation's teardown handle and
  // left its keydown listener attached — after which one click fired N POSTs.
  let release;
  const hanging = new Promise((r) => { release = r; });
  const ctx = await bootShip({
    arms: (url, opts) => (url.endsWith('/api/pr') && opts.method === 'POST' ? hanging : null),
  });
  const { window } = ctx;
  const modal = await openModal(ctx);

  click(window, modal.querySelector('.shipit-ok'));        // (1) POST hangs
  await settle(window);
  click(window, modal.querySelector('.shipit-cancel'));    // (2) cancel mid-flight
  assert.equal(isOpen(window), false, 'cancel closes even while the POST is in flight');
  assert.equal(hdPr(window).hidden, false, 'record.pr is still unset, so Create PR is still offered');

  click(window, hdPr(window));                             // (3) a NEW generation owns the modal
  assert.ok(isOpen(window), 'the modal re-opens');

  release({ ok: true, status: 200, json: async () => PR_OK });   // (4) the stale POST lands
  await settle(window, 6);
  assert.ok(isOpen(window), 'the stale generation must not hide the freshly-opened modal');

  click(window, modal.querySelector('.shipit-ok'));        // (5) exactly ONE more POST
  await settle(window, 6);
  assert.equal(prPosts(ctx).length, 2, 'two confirm clicks === two POSTs, never three');
});

test('leaving the detail screen closes the modal, and Create PR still works after', async () => {
  const ctx = await bootShip({ arms: prArm(PR_OK) });
  const { window } = ctx;
  await openModal(ctx);
  go(window, 'history');
  await settle(window, 6);
  // The modal is a top-level overlay, not a child of #hist-detail: emptying the
  // detail host does not dismiss it, so closeHistDetail must tear it down.
  assert.equal(isOpen(window), false, 'navigating away dismisses the overlay');

  await openDetail(ctx);
  click(window, hdPr(window));
  assert.ok(isOpen(window), 'the double-open guard did not leave Create PR permanently dead');
});

test('detail -> detail navigation tears the modal down too', async () => {
  // closeHistDetail is the only teardown, and a detail->detail hop never goes
  // through it: the screen is swapped underneath a modal whose confirm handler
  // still closes over the PREVIOUS record, i.e. one click would open a PR for the
  // run the user just navigated away from.
  const OTHER = row({ id: 'aaaa1111', title: 'Another run' });
  const ctx = await bootShip({ rows: [row(), OTHER] });
  const { window } = ctx;
  await openModal(ctx);
  assert.ok(isOpen(window));

  go(window, `history/${KEY}/${OTHER.id}`);
  await settle(window, 5);
  assert.equal(isOpen(window), false, 'the modal does not outlive the screen it belonged to');
});

// ---------------------------------------------------------------------------
// Keeping the list card in step
// ---------------------------------------------------------------------------

test('a successful ship updates the LIST card too (no stale Create PR)', async () => {
  const ctx = await bootShip({ arms: prArm(PR_OK) });
  const { window } = ctx;
  const modal = await openModal(ctx);
  click(window, modal.querySelector('.shipit-ok'));
  await settle(window, 6);

  go(window, 'history');                                   // list<->detail hops do NOT refetch
  await settle(window, 6);
  const card = window.document.querySelector('#history .hist-card');
  assert.ok(card, 'the list card is still there');
  assert.equal(card.querySelector('.hist-pr'), null, 'the Create-PR button was swapped out');
  assert.match(card.querySelector('.hist-pr-link').textContent, /View PR/);

  // Re-entering the run must NOT re-open the modal — that was the stale-button ->
  // double-POST loop (patchHistoryPr in the ship path + the `if (!record.pr)` gate).
  await openDetail(ctx);
  assert.equal(isOpen(window), false, 'a shipped run never re-opens the confirm modal');
  assert.equal(prPosts(ctx).length, 1);
});

test('the PR-enrichment hooks repaint the OPEN detail header', async () => {
  // A row the list delivered without `pr` (enrichment still in flight): the button
  // stays hidden until a resolution arrives, and BOTH resolution paths —
  // finalizeHistoryPr (terminal batch) and patchHistoryPr (per-entry batch) —
  // must reach the open detail screen.
  const prless = row();
  delete prless.pr;                                        // enrichment still in flight
  const ctx = await bootShip({ rows: [prless] });
  const { window } = ctx;
  await openDetail(ctx);
  assert.equal(hdPr(window).hidden, true, 'pr === undefined -> the control stays hidden');

  const token = ctx.prTokens().at(-1);
  assert.ok(token != null, 'the client POSTed a load token');
  ctx.dispatchPr({ token, done: true, items: [] });        // terminal: row.pr = null
  await settle(window);
  assert.equal(hdPr(window).hidden, false, 'the terminal batch reveals Create PR');

  ctx.dispatchPr({
    token,
    items: [{ projectKey: KEY, id: ROW.id, pr: { state: 'MERGED', url: 'https://x/pull/9', number: 9 } }],
  });
  await settle(window);
  assert.equal(hdPr(window).hidden, true);
  assert.equal(hdPrLink(window).textContent, 'Merged');
});

// ---------------------------------------------------------------------------
// The tri-state header + histPrEligible
// ---------------------------------------------------------------------------

test('OPEN/MERGED records render links, not the button', async () => {
  for (const [state, label] of [['OPEN', 'View PR'], ['MERGED', 'Merged']]) {
    const ctx = await bootShip({ rows: [row({ pr: { state, url: 'https://x/pull/5' } })] });
    await openDetail(ctx);
    const link = hdPrLink(ctx.window);
    assert.equal(hdPr(ctx.window).hidden, true, `${state}: no Create-PR button`);
    assert.equal(link.hidden, false, `${state}: the link renders`);
    assert.equal(link.textContent, label);
    assert.equal(link.classList.contains('merged'), state === 'MERGED');
  }
});

test('a MERGED run whose branch is gone still shows the link', async () => {
  // Link-first, matching setupPrButton's order (app.js:8552-8569).
  const ctx = await bootShip({
    rows: [row({ survived: false, pr: { state: 'MERGED', url: 'https://x/pull/5' } })],
  });
  await openDetail(ctx);
  assert.equal(hdPrLink(ctx.window).hidden, false);
  assert.equal(hdPrLink(ctx.window).textContent, 'Merged');
});

test('workspace runs never show Create PR', async () => {
  // POST /api/pr has NO workspace arm — its key regex (ui/server.mjs:1637) rejects
  // a `workspaces/…` composite with a 404 — yet workspace rows satisfy every other
  // clause because listAllPipelines hands rowToHistoryEntry the primary member dir.
  const ctx = await bootShip({
    rows: [row({ projectKey: WKS_KEY, target: 'workspace' })],
  });
  await openDetail(ctx, wksDetailHash);
  assert.equal(hdPr(ctx.window).hidden, true, 'no Create PR for a workspace run');
  assert.equal(hdPrLink(ctx.window).hidden, true);
});

test('a workspace run cannot reach the ship-it modal from the LIST card either', async () => {
  // The end-to-end half of the predicate test below. The list card's Create-PR
  // button is the ONLY writer of pendingShipIt; with the shared predicate in place
  // that button is never rendered for a workspace row, so navigating from the card
  // can never arm the modal — and confirming it can never 404 on POST /api/pr.
  const ctx = await bootShip({ rows: [row({ projectKey: WKS_KEY, target: 'workspace' })] });
  go(ctx.window, 'history');
  await settle(ctx.window);
  const card = ctx.window.document.querySelector('#history .hist-card');
  assert.ok(card, 'the workspace row still renders a card');
  const btn = card.querySelector('.hist-pr');
  assert.equal(btn.hidden, true, 'no Create-PR button on a workspace card');
  // If a future change re-opens the gate, clicking it must still not ship.
  click(ctx.window, btn);
  // Navigate the way the card does, then let the detail screen settle.
  await openDetail(ctx, wksDetailHash);
  assert.equal(isOpen(ctx.window), false, 'the ship-it modal never opens for a workspace run');
  assert.equal(prPosts(ctx).length, 0, 'and no POST /api/pr is fired');
});

test('histPrEligible rejects a workspace run that satisfies every other clause', async () => {
  const ctx = await bootShip();
  await openDetail(ctx);                                   // state.ghAvailable is true here
  const { histPrEligible } = ctx.window.__np;
  assert.equal(typeof histPrEligible, 'function', 'the predicate is on the test seam');
  assert.equal(histPrEligible({ survived: true, branch: 'b', sourceBranch: 's' }), true);
  assert.equal(histPrEligible({ survived: true, branch: 'b', sourceBranch: 's', target: 'workspace' }), false);
  assert.equal(histPrEligible({ survived: false, branch: 'b', sourceBranch: 's' }), false);
  assert.equal(histPrEligible({ survived: true, branch: '', sourceBranch: 's' }), false);
  assert.equal(histPrEligible({ survived: true, branch: 'b', sourceBranch: '' }), false);
  assert.equal(histPrEligible(null), false);
});

test('gh unavailable hides Create PR even for an otherwise eligible run', async () => {
  const ctx = await bootShip({ gh: false });
  await openDetail(ctx);
  assert.equal(hdPr(ctx.window).hidden, true);
  assert.equal(ctx.window.__np.histPrEligible(ROW), false, 'the predicate reads state.ghAvailable');
});

// ---------------------------------------------------------------------------
// Merge-pill re-check (moved from test/ui-history-pr.test.mjs: the pill is
// detail-only now, and the PR is opened from this modal, not the list card).
// ---------------------------------------------------------------------------

test('a delayed re-check updates the stuck "checking…" pill to can-merge', async () => {
  let recheckBody = null;
  // The re-check RESPONSE is gated, not its timer: with __prMergeRecheckMs = 0 an
  // ungated arm resolves inside the same settle() that opens the PR, so the
  // intermediate "checking…" state would never be observable.
  let releaseRecheck;
  const recheckGate = new Promise((r) => { releaseRecheck = r; });
  const ctx = await bootShip({
    arms: (url, opts) => {
      if (url.endsWith('/api/pr/mergeable') && opts.method === 'POST') {
        recheckBody = JSON.parse(opts.body);
        return recheckGate.then(() => ok({ ok: true, mergeable: 'MERGEABLE' }));
      }
      if (url.endsWith('/api/pr') && opts.method === 'POST') {
        return ok({ ok: true, url: 'https://gh/x/pull/3', mergeable: 'UNKNOWN' });
      }
      return null;
    },
  });
  ctx.window.__prMergeRecheckMs = 0;   // fire on the next tick (no fake timers)
  const modal = await openModal(ctx);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 4);         // PR opened -> pill paints "checking…"
  const pill = hdMerge(ctx.window);
  assert.ok(pill.classList.contains('unknown'), 'pill starts as checking…');
  assert.match(pill.textContent, /checking/);
  releaseRecheck();
  await settle(ctx.window, 4);         // fetch + json + apply
  assert.equal(recheckBody.id, ROW.id, 're-check posted the same pipeline id');
  assert.ok(pill.classList.contains('ok'), 'pill updated to can-merge after re-check');
  assert.match(pill.textContent, /can merge/);
});

test('a re-check that is still UNKNOWN hides the pill instead of leaving it stuck', async () => {
  let releaseRecheck;
  const recheckGate = new Promise((r) => { releaseRecheck = r; });
  const ctx = await bootShip({
    arms: (url, opts) => {
      if (url.endsWith('/api/pr/mergeable') && opts.method === 'POST') return recheckGate.then(() => ok({ ok: true, mergeable: 'UNKNOWN' }));
      if (url.endsWith('/api/pr') && opts.method === 'POST') {
        return ok({ ok: true, url: 'https://gh/x/pull/4', mergeable: 'UNKNOWN' });
      }
      return null;
    },
  });
  ctx.window.__prMergeRecheckMs = 0;
  const modal = await openModal(ctx);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 4);
  const pill = hdMerge(ctx.window);
  assert.equal(pill.hidden, false, 'pill shows checking… first');
  releaseRecheck();
  await settle(ctx.window, 4);
  assert.equal(pill.hidden, true, 'still-unknown pill is hidden, not left stuck');
});

// ---------------------------------------------------------------------------
// Fork support: the push-remote / base-repo selectors
// ---------------------------------------------------------------------------

test('the modal loads the project remotes into both selects with the server defaults', async () => {
  const ctx = await bootShip({ remotes: FORK_REMOTES });
  const modal = await openModal(ctx);
  assert.equal(modal.querySelector('.shipit-remotes').hidden, false);
  const pushSel = modal.querySelector('.shipit-push-remote');
  const baseSel = modal.querySelector('.shipit-base-remote');
  assert.deepEqual(optionValues(pushSel), ['origin', 'upstream']);
  assert.deepEqual([...baseSel.options].map((o) => o.textContent), ['origin — me/repo', 'upstream — up/repo']);
  assert.equal(pushSel.value, 'origin');
  assert.equal(baseSel.value, 'upstream');
  assert.equal(pushSel.disabled, false);
  assert.match(modal.querySelector('.shipit-remotes-hint').textContent, /me:worca-cc\/log-ux-fcec04e8 → up\/repo feat\/log-ux/);
  assert.equal(modal.querySelector('.shipit-base').textContent, 'feat/log-ux', 'the summary line is untouched');
  const req = remotesCalls(ctx)[0];
  assert.ok(req && req.url.includes(`projectKey=${KEY}`) && req.url.includes(`id=${ROW.id}`), 'resolved by key + id');
});

test('confirm POSTs the chosen push/base remotes', async () => {
  const ctx = await bootShip({ remotes: FORK_REMOTES, arms: prArm(PR_OK) });
  const modal = await openModal(ctx);
  const baseSel = modal.querySelector('.shipit-base-remote');
  baseSel.value = 'origin';
  baseSel.dispatchEvent(new ctx.window.Event('change'));
  assert.equal(modal.querySelector('.shipit-remotes-hint').textContent, '', 'same repo: no cross-repo hint');
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 6);
  assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body),
    { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id, pushRemote: 'origin', baseRemote: 'origin' });
  assert.equal(hdPrLink(ctx.window).hidden, false);
});

test('when the remotes cannot be loaded the selectors stay hidden and the POST omits them', async () => {
  const ctx = await bootShip({ remotes: null, arms: prArm(PR_OK) });
  const modal = await openModal(ctx);
  assert.equal(modal.querySelector('.shipit-remotes').hidden, true);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 6);
  assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body), { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id });
  assert.equal(hdPrLink(ctx.window).hidden, false, 'the ship still succeeds on server defaults');
});

test('a remotes response that lands after cancel does not touch a re-opened modal', async () => {
  let release;
  const hanging = new Promise((r) => { release = r; });
  let n = 0;
  const ctx = await bootShip({
    arms: (url) => (/\/api\/pr\/remotes\?/.test(url) && ++n === 1 ? hanging : null),
  });
  const { window } = ctx;
  await openDetail(ctx);
  click(window, hdPr(window));                                  // (1) first open: remotes hang
  click(window, modalOf(window).querySelector('.shipit-cancel'));
  click(window, hdPr(window));                                  // (2) second open: served by historyArms (origin only)
  await settle(window);
  const modal = modalOf(window);
  assert.deepEqual(optionValues(modal.querySelector('.shipit-push-remote')), ['origin']);
  release({ ok: true, status: 200, json: async () => FORK_REMOTES });   // (3) the stale response lands
  await settle(window, 3);
  assert.deepEqual(optionValues(modal.querySelector('.shipit-push-remote')), ['origin'],
    'the stale generation must not repopulate the new generation');
  assert.equal(remotesCalls(ctx).length, 2);
});

test('selects are disabled while the POST is in flight and re-enabled on failure', async () => {
  const ctx = await bootShip({
    arms: (url, opts) => (url.endsWith('/api/pr') && opts.method === 'POST' ? fail(500, { error: 'git push failed: denied' }) : null),
  });
  const modal = await openModal(ctx);
  const sel = modal.querySelector('.shipit-push-remote');
  click(ctx.window, modal.querySelector('.shipit-ok'));
  assert.equal(sel.disabled, true, 'locked while the POST is in flight');
  await settle(ctx.window, 6);
  assert.equal(sel.disabled, false, 'unlocked so the user can pick another remote and retry');
  assert.match(modal.querySelector('.shipit-err').textContent, /push failed/);
});

test('remotes that arrive after confirm was pressed stay disabled until that POST settles', async () => {
  let releaseRemotes;
  const remotesGate = new Promise((r) => { releaseRemotes = r; });
  let releasePost;
  const postGate = new Promise((r) => { releasePost = r; });
  const ctx = await bootShip({
    arms: (url, opts) => {
      if (/\/api\/pr\/remotes\?/.test(url)) return remotesGate;
      if (url.endsWith('/api/pr') && opts.method === 'POST') return postGate.then(() => fail(500, { error: 'git push failed: denied' }));
      return null;
    },
  });
  await openDetail(ctx);
  click(ctx.window, hdPr(ctx.window));
  const modal = modalOf(ctx.window);
  click(ctx.window, modal.querySelector('.shipit-ok'));           // confirm before the list arrived
  releaseRemotes({ ok: true, status: 200, json: async () => FORK_REMOTES });
  await settle(ctx.window, 3);
  assert.equal(modal.querySelector('.shipit-remotes').hidden, false, 'the list still paints');
  assert.equal(modal.querySelector('.shipit-push-remote').disabled, true, 'but stays locked under the in-flight POST');
  assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body), { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id },
    'that POST went out without the fields (server defaults)');
  releasePost();
  await settle(ctx.window, 6);
  assert.equal(modal.querySelector('.shipit-push-remote').disabled, false, 'unlocked once the POST failed');
});
