// test/ui-history-shipit.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { cardAlertOf } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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

async function boot({ fetchHandler, url = 'http://localhost:4317/', hooks = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
  const { window } = dom;
  if (hooks) window.__worcaTestHooks = hooks;   // e.g. the real marked + DOMPurify for the Preview tab

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
    if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: box.gh, ...(box.prHosts ? { prHosts: box.prHosts } : {}) });
    if (url.endsWith(DETAIL_URL) || url.endsWith(WKS_DETAIL_URL)) return ok(box.detail);
    if (url.endsWith('/api/budget')) return ok(box.budget);
    return null;
  };
}

async function bootShip({ rows = [row()], detail = DETAIL, gh = true, prHosts = null, arms = null, deepLink = false, remotes = REMOTES, hooks = null } = {}) {
  const box = { rows, detail, gh, prHosts, remotes, budget: okBudget() };
  const base = historyArms(box);
  const ctx = await boot({
    fetchHandler: (url, opts) => (arms && arms(url, opts, box)) || base(url, opts),
    url: deepLink ? `http://localhost:4317/#${detailHash}` : 'http://localhost:4317/',
    hooks,
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
// A run outside a chain: `chain` is just its source; `branches` are each remote's
// remote-tracking branches (the server drops HEAD and the run's own branch only).
const REMOTES = { ok: true, remotes: [remote('origin', 'me', 'https://github.com/me/repo.git')],
  defaults: { pushRemote: 'origin', baseRemote: 'origin' }, remembered: null,
  chain: ['feat/log-ux'], defaultBase: 'feat/log-ux', branches: { origin: ['feat/log-ux', 'main'] } };
const FORK_REMOTES = { ok: true,
  remotes: [remote('origin', 'me', 'https://github.com/me/repo.git'), remote('upstream', 'up', 'git@github.com:up/repo.git')],
  defaults: { pushRemote: 'origin', baseRemote: 'upstream' }, remembered: null,
  chain: ['feat/log-ux'], defaultBase: 'feat/log-ux',
  branches: { origin: ['feat/log-ux', 'main'], upstream: ['feat/log-ux', 'main'] } };
// dev -> nb1 -> this run (started from nb1's feature branch `feat/log-ux`): the ROOT is the default.
const CHAIN_REMOTES = { ...FORK_REMOTES, chain: ['dev', 'nb1', 'feat/log-ux'], defaultBase: 'dev',
  branches: { origin: ['feat/log-ux', 'main', 'mine'], upstream: ['dev', 'main', 'nb1', 'release'] } };
const baseSelOf = (modal) => modal.querySelector('.shipit-base-branch');
// The pick's structure: [optgroup label | null for a bare option, [values]].
const groupsOf = (sel) => [...sel.children].map((c) => (c.tagName === 'OPTGROUP'
  ? [c.label, [...c.children].map((o) => o.value)] : [null, [c.value]]));
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
  assert.equal(modal.querySelector('.shipit-base-wrap').hidden, false, 'the base is a pick, in the summary line');
  assert.equal(baseSelOf(modal).value, 'feat/log-ux');
  assert.equal(modal.querySelector('.shipit-base').textContent, '', 'the plain text gives way to the pick');
  assert.match(modal.querySelector('.shipit-sub').textContent, /Implement Log-UX Review Fixes/);
});

// ---------------------------------------------------------------------------
// Confirming
// ---------------------------------------------------------------------------

test('confirm POSTs /api/pr and swaps the header control to a link + merge pill; existed:true also resolves to View PR', async () => {
  await checkRows([
    { name: 'confirm POSTs /api/pr and swaps the header control to a link + merge pill', run: async () => {
      const ctx = await bootShip({ arms: prArm(PR_OK) });
      const modal = await openModal(ctx);
      click(ctx.window, modal.querySelector('.shipit-ok'));
      await settle(ctx.window, 6);

      const post = prPosts(ctx)[0];
      assert.ok(post, 'the confirm button POSTs /api/pr');
      assert.deepEqual(JSON.parse(post.opts.body),
        { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id, pushRemote: 'origin', baseRemote: 'origin', baseBranch: 'feat/log-ux' });
      assert.equal(modal.classList.contains('hidden'), true, 'a successful ship closes the modal');
      const link = hdPrLink(ctx.window);
      assert.equal(link.hidden, false);
      assert.equal(link.href, 'https://x/pull/7');
      assert.equal(link.textContent, 'View PR');
      assert.equal(hdPr(ctx.window).hidden, true, 'the button never coexists with the link');
      // `.hd .hist-merge` only — the pill is a SIBLING of `.hd-pr` in row 1, so a
      // `.hd-pr .hist-merge` alternative could never match.
      assert.match(hdMerge(ctx.window).textContent, /can merge/);
    } },
    { name: 'existed:true still resolves to a View PR link', run: async () => {
      const ctx = await bootShip({ arms: prArm({ ...PR_OK, url: 'https://x/pull/11', existed: true }) });
      const modal = await openModal(ctx);
      click(ctx.window, modal.querySelector('.shipit-ok'));
      await settle(ctx.window, 6);
      const link = hdPrLink(ctx.window);
      assert.equal(link.hidden, false);
      assert.equal(link.textContent, 'View PR');
      assert.equal(link.href, 'https://x/pull/11');
    } },
  ]);
});

test('UNKNOWN mergeability schedules exactly one recheck; a later recheck updates the pill or hides it if still UNKNOWN', async () => {
  await checkRows([
    { name: 'UNKNOWN mergeability schedules exactly one recheck', run: async () => {
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
    } },
    { name: 'a delayed re-check updates the stuck "checking…" pill to can-merge', run: async () => {
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
    } },
    { name: 'a re-check that is still UNKNOWN hides the pill instead of leaving it stuck', run: async () => {
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
    } },
  ]);
});

test('PR failure shows the error inside the modal and re-enables confirm', async () => {
  const ctx = await bootShip({
    arms: (url, opts) => (url.endsWith('/api/pr') && opts.method === 'POST'
      ? fail(500, { error: 'push failed' }) : null),
  });
  const modal = await openModal(ctx);
  click(ctx.window, modal.querySelector('.shipit-ok'));
  await settle(ctx.window, 6);
  const alert = cardAlertOf(modal.querySelector('.shipit-card'));
  assert.ok(alert, 'a card alert is shown');
  assert.equal(alert.title, 'Not shipped');
  assert.match(alert.detail, /push failed/);
  const alertEl = modal.querySelector('.shipit-card .card-alert');
  const follows = (a, b) => !!(a.compareDocumentPosition(b) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(follows(modal.querySelector('.shipit-desc'), alertEl), 'the alert sits below the description box');
  assert.equal(alertEl.nextElementSibling, modal.querySelector('.shipit-actions'), 'just above the buttons');
  assert.equal(modal.querySelector('.shipit-err'), null, 'the old inline slot is gone');
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
  // The slide layout: there, an Escape that leaked past the modal would send the glance
  // back to the list. Side by side it does nothing, and the check below would be vacuous.
  window.document.getElementById('runs-shell').dataset.layout = 'slide';

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

test('one confirm click is one POST: a second open or a cancel mid-POST never stacks a second confirm handler', async () => {
  await checkRows([
    { name: 'a second open does not stack a second confirm handler', run: async () => {
      const ctx = await bootShip({ arms: prArm(PR_OK) });
      const modal = await openModal(ctx);
      click(ctx.window, hdPr(ctx.window));                     // second open while already open
      assert.equal(modal.classList.contains('hidden'), false);
      click(ctx.window, modal.querySelector('.shipit-ok'));
      await settle(ctx.window, 6);
      assert.equal(prPosts(ctx).length, 1, 'one confirm click === one POST');
    } },
    { name: 'cancelling while the POST is in flight cannot stack a second confirm handler', run: async () => {
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
    } },
  ]);
});

// closeHistDetail is the only teardown, and a detail->detail hop never goes
// through it: the screen is swapped underneath a modal whose confirm handler
// still closes over the PREVIOUS record, i.e. one click would open a PR for the
// run the user just navigated away from.
test('leaving the detail screen or detail->detail navigation tears the modal down, and Create PR still works after', async () => {
  const OTHER = row({ id: 'aaaa1111', title: 'Another run' });
  const ctx = await bootShip({ rows: [row(), OTHER], arms: prArm(PR_OK) });
  const { window } = ctx;
  await checkRows([
    { name: 'leaving the detail screen closes the modal, and Create PR still works after', run: async () => {
      await openModal(ctx);
      // Leave Runs: a bare #history would reopen this same run in the split layout (D6).
      go(window, 'new');
      await settle(window, 6);
      // The modal is a top-level overlay, not a child of #hist-detail: emptying the
      // detail host does not dismiss it, so closeHistDetail must tear it down.
      assert.equal(isOpen(window), false, 'navigating away dismisses the overlay');

      await openDetail(ctx);
      click(window, hdPr(window));
      assert.ok(isOpen(window), 'the double-open guard did not leave Create PR permanently dead');
    } },
    { name: 'detail -> detail navigation tears the modal down too', run: async () => {
      await openModal(ctx);
      assert.ok(isOpen(window));

      go(window, `history/${KEY}/${OTHER.id}`);
      await settle(window, 5);
      assert.equal(isOpen(window), false, 'the modal does not outlive the screen it belonged to');
    } },
  ]);
});

// ---------------------------------------------------------------------------
// Keeping the list row in step
// ---------------------------------------------------------------------------

test('a successful ship updates the list row, and PR-enrichment hooks repaint the open detail header', async () => {
  await checkRows([
    { name: 'a successful ship updates the LIST row too (no stale Create PR)', run: async () => {
      const OTHER = row({ id: 'aaaa1111', title: 'Another run' });
      const ctx = await bootShip({ rows: [row(), OTHER], arms: prArm(PR_OK) });
      const { window } = ctx;
      const rowSel = `#runs-list .runs-row[data-slot="group"][data-pipeline-id="${ROW.id}"]`;
      const word = () => window.document.querySelector(`${rowSel} .runs-row-sub`).textContent;
      const modal = await openModal(ctx);
      assert.match(word(), /^Finished\b/, 'no PR yet: the row reads Finished');
      click(window, modal.querySelector('.shipit-ok'));
      await settle(window, 6);

      // Row<->row hops do NOT refetch the list, so the ship itself must keep the row current.
      const listFetches = () => ctx.calls.filter((c) => c.url.endsWith('/api/history')).length;
      const before = listFetches();
      go(window, `history/${KEY}/${OTHER.id}`);                // another saved run...
      await settle(window, 6);
      await openDetail(ctx);                                   // ...and back
      await settle(window, 6);
      assert.equal(listFetches(), before, 'hopping between saved runs does not refetch /api/history');

      assert.ok(window.document.querySelector(rowSel), 'the list row is still there');
      assert.match(word(), /^In review\b/, 'the row reads the OPEN PR');
      // Re-entering the run must NOT offer Create PR again: that was the stale-button ->
      // double-POST loop (patchHistoryPr in the ship path + the `if (!record.pr)` gate).
      assert.equal(hdPr(window).hidden, true, 'the Create-PR button was swapped out');
      assert.equal(hdPrLink(window).hidden, false);
      assert.match(hdPrLink(window).textContent, /View PR/);
    } },
    { name: 'the PR-enrichment hooks repaint the OPEN detail header', run: async () => {
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
    } },
  ]);
});

// ---------------------------------------------------------------------------
// The tri-state header + histPrEligible
// ---------------------------------------------------------------------------

test('OPEN/MERGED records render links, not the button, even when the merged branch is gone', async () => {
  await checkRows([
    { name: 'OPEN/MERGED records render links, not the button', run: async () => {
      for (const [state, label] of [['OPEN', 'View PR'], ['MERGED', 'Merged']]) {
        const ctx = await bootShip({ rows: [row({ pr: { state, url: 'https://x/pull/5' } })] });
        await openDetail(ctx);
        const link = hdPrLink(ctx.window);
        assert.equal(hdPr(ctx.window).hidden, true, `${state}: no Create-PR button`);
        assert.equal(link.hidden, false, `${state}: the link renders`);
        assert.equal(link.textContent, label);
        assert.equal(link.classList.contains('merged'), state === 'MERGED');
      }
    } },
    { name: 'a MERGED run whose branch is gone still shows the link', run: async () => {
      // Link-first, matching setupPrButton's order (app.js:8552-8569).
      const ctx = await bootShip({
        rows: [row({ survived: false, pr: { state: 'MERGED', url: 'https://x/pull/5' } })],
      });
      await openDetail(ctx);
      assert.equal(hdPrLink(ctx.window).hidden, false);
      assert.equal(hdPrLink(ctx.window).textContent, 'Merged');
    } },
  ]);
});

test('Create PR eligibility: never for workspace runs (detail or list, histPrEligible), hidden when gh is unavailable', async () => {
  await checkRows([
    { name: 'a workspace run with no member facts never shows Create PR', run: async () => {
      // `members` absent (legacy/lite row) ⇒ no affected member ⇒ not eligible — even
      // though the row satisfies every primary-only clause (survived/branch/sourceBranch).
      const ctx = await bootShip({
        rows: [row({ projectKey: WKS_KEY, target: 'workspace' })],
      });
      await openDetail(ctx, wksDetailHash);
      assert.equal(hdPr(ctx.window).hidden, true, 'no Create PR for a workspace run');
      assert.equal(hdPrLink(ctx.window).hidden, true);
    } },
    { name: 'a workspace run cannot reach the ship-it modal from the LIST either', run: async () => {
      // The end-to-end half of the predicate test below. Only the saved page's Create-PR
      // control opens the modal, and the shared predicate never offers it for a workspace
      // row, so opening that run from its list row can never arm the modal — and
      // confirming it can never 404 on POST /api/pr.
      const ctx = await bootShip({ rows: [row({ projectKey: WKS_KEY, target: 'workspace' })] });
      go(ctx.window, 'runs');                                  // nothing remembered: the bare list
      await settle(ctx.window);
      const listRow = ctx.window.document.querySelector(
        `#runs-list .runs-row[data-slot="group"][data-project-key="${WKS_KEY}"][data-pipeline-id="${ROW.id}"]`);
      assert.ok(listRow, 'the workspace row is listed');
      click(ctx.window, listRow);                              // navigate the way the row does
      await settle(ctx.window, 5);
      assert.equal(ctx.window.location.hash, `#${wksDetailHash}`, 'the row opens its saved page');
      assert.equal(hdPr(ctx.window).hidden, true, 'no Create PR on the workspace run');
      assert.equal(isOpen(ctx.window), false, 'the ship-it modal never opens for a workspace run');
      assert.equal(prPosts(ctx).length, 0, 'and no POST /api/pr is fired');
    } },
    { name: 'histPrEligible: a workspace row is judged by its members, never the primary-only clauses', run: async () => {
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
    } },
    { name: 'gh unavailable hides Create PR even for an otherwise eligible run', run: async () => {
      const ctx = await bootShip({ gh: false });
      await openDetail(ctx);
      assert.equal(hdPr(ctx.window).hidden, true);
      assert.equal(ctx.window.__np.histPrEligible(ROW), false, 'the predicate reads state.ghAvailable');
    } },
  ]);
});

// ---------------------------------------------------------------------------
// Fork support: the push-remote / base-repo selectors
// ---------------------------------------------------------------------------

test('the modal loads project remotes into both selects with server defaults and confirm POSTs the chosen push/base remotes', async () => {
  const ctx = await bootShip({ remotes: FORK_REMOTES, arms: prArm(PR_OK) });
  const modal = await openModal(ctx);
  await checkRows([
    { name: 'the modal loads the project remotes into both selects with the server defaults', run: async () => {
      assert.equal(modal.querySelector('.shipit-remotes').hidden, false);
      const pushSel = modal.querySelector('.shipit-push-remote');
      const baseSel = modal.querySelector('.shipit-base-remote');
      assert.deepEqual(optionValues(pushSel), ['origin', 'upstream']);
      assert.deepEqual([...baseSel.options].map((o) => o.textContent), ['origin — me/repo', 'upstream — up/repo']);
      assert.equal(pushSel.value, 'origin');
      assert.equal(baseSel.value, 'upstream');
      assert.equal(pushSel.disabled, false);
      assert.match(modal.querySelector('.shipit-remotes-hint').textContent, /me:worca-cc\/log-ux-fcec04e8 → up\/repo feat\/log-ux/);
      assert.equal(baseSelOf(modal).value, 'feat/log-ux', 'the summary line offers the run\'s source');
      const req = remotesCalls(ctx)[0];
      assert.ok(req && req.url.includes(`projectKey=${KEY}`) && req.url.includes(`id=${ROW.id}`), 'resolved by key + id');
    } },
    { name: 'confirm POSTs the chosen push/base remotes', run: async () => {
      const baseSel = modal.querySelector('.shipit-base-remote');
      baseSel.value = 'origin';
      baseSel.dispatchEvent(new ctx.window.Event('change'));
      assert.equal(modal.querySelector('.shipit-remotes-hint').textContent, '', 'same repo: no cross-repo hint');
      click(ctx.window, modal.querySelector('.shipit-ok'));
      await settle(ctx.window, 6);
      assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body),
        { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id, pushRemote: 'origin', baseRemote: 'origin', baseBranch: 'feat/log-ux' });
      assert.equal(hdPrLink(ctx.window).hidden, false);
    } },
  ]);
});

test('remotes that cannot load: selectors hidden, POST omits them, the known chain is still offered and the pick unlocks after a failed POST', async () => {
  await checkRows([
    { name: 'when the remotes cannot be loaded the selectors stay hidden and the POST omits them', run: async () => {
      const ctx = await bootShip({ remotes: null, arms: prArm(PR_OK) });
      const modal = await openModal(ctx);
      assert.equal(modal.querySelector('.shipit-remotes').hidden, true);
      assert.equal(modal.querySelector('.shipit-base-wrap').hidden, true, 'no chain known: no pick');
      assert.equal(modal.querySelector('.shipit-base').textContent, 'feat/log-ux', 'the plain source text stays');
      click(ctx.window, modal.querySelector('.shipit-ok'));
      await settle(ctx.window, 6);
      assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body), { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id });
      assert.equal(hdPrLink(ctx.window).hidden, false, 'the ship still succeeds on server defaults');
    } },
    { name: 'remotes that cannot be loaded still offer the known chain, and the pick unlocks after a failed POST', run: async () => {
      const ctx = await bootShip({
        arms: (url, opts) => {
          if (/\/api\/pr\/remotes\?/.test(url)) return fail(500, { error: 'git remote failed: x', chain: ['dev', 'nb1', 'feat/log-ux'], defaultBase: 'dev' });
          if (url.endsWith('/api/pr') && opts.method === 'POST') return fail(500, { error: 'gh pr create failed: no such base' });
          return null;
        },
      });
      const modal = await openModal(ctx);
      assert.equal(modal.querySelector('.shipit-remotes').hidden, true, 'no remotes: the remote selects stay hidden');
      assert.equal(modal.querySelector('.shipit-base-wrap').hidden, false, 'the chain is still offered');
      assert.deepEqual(groupsOf(baseSelOf(modal)), [['This chain', ['dev', 'nb1', 'feat/log-ux']]]);
      assert.equal(baseSelOf(modal).value, 'dev');
      click(ctx.window, modal.querySelector('.shipit-ok'));
      assert.equal(baseSelOf(modal).disabled, true, 'locked while the POST is in flight');
      await settle(ctx.window, 6);
      assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body), { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id, baseBranch: 'dev' });
      assert.match(cardAlertOf(modal.querySelector('.shipit-card')).detail, /no such base/, 'gh\'s error surfaces in the dialog');
      assert.equal(baseSelOf(modal).disabled, false, 'unlocked for a retry with another base');
    } },
  ]);
});

test('remote selects: disabled while the POST is in flight (re-enabled on failure); late remotes never touch a re-opened modal or unlock an in-flight confirm', async () => {
  await checkRows([
    { name: 'a remotes response that lands after cancel does not touch a re-opened modal', run: async () => {
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
    } },
    { name: 'selects are disabled while the POST is in flight and re-enabled on failure', run: async () => {
      const ctx = await bootShip({
        arms: (url, opts) => (url.endsWith('/api/pr') && opts.method === 'POST' ? fail(500, { error: 'git push failed: denied' }) : null),
      });
      const modal = await openModal(ctx);
      const sel = modal.querySelector('.shipit-push-remote');
      click(ctx.window, modal.querySelector('.shipit-ok'));
      assert.equal(sel.disabled, true, 'locked while the POST is in flight');
      assert.equal(baseSelOf(modal).disabled, true, 'the base pick is locked with it');
      await settle(ctx.window, 6);
      assert.equal(sel.disabled, false, 'unlocked so the user can pick another remote and retry');
      assert.equal(baseSelOf(modal).disabled, false);
      assert.match(cardAlertOf(modal.querySelector('.shipit-card')).detail, /push failed/);
    } },
    { name: 'remotes that arrive after confirm was pressed stay disabled until that POST settles', run: async () => {
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
      assert.equal(baseSelOf(modal).disabled, true, 'the base pick too');
      assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body), { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id },
        'that POST went out without the fields (server defaults)');
      releasePost();
      await settle(ctx.window, 6);
      assert.equal(modal.querySelector('.shipit-push-remote').disabled, false, 'unlocked once the POST failed');
    } },
  ]);
});

// ---------------------------------------------------------------------------
// Base branch: a run chain defaults to its ROOT; the base remote's branches follow
// ---------------------------------------------------------------------------

test('base branch: a chained run preselects and POSTs the chain root; an unchained run offers its source first', async () => {
  await checkRows([
    { name: 'a chained run preselects the chain root and POSTs it as baseBranch', run: async () => {
      const ctx = await bootShip({ remotes: CHAIN_REMOTES, arms: prArm(PR_OK) });
      const modal = await openModal(ctx);
      const sel = baseSelOf(modal);
      assert.equal(modal.querySelector('.shipit-base-wrap').hidden, false);
      assert.deepEqual(groupsOf(sel), [
        ['This chain', ['dev', 'nb1', 'feat/log-ux']],             // root first, ending with the direct source
        ['Branches on upstream', ['main', 'release']],              // the base remote's OTHER branches, no duplicates
      ]);
      assert.equal(sel.value, 'dev', 'the chain ROOT, not the direct source');
      assert.equal(sel.disabled, false);
      assert.match(modal.querySelector('.shipit-remotes-hint').textContent, /→ up\/repo dev$/, 'the hint names the chosen base');
      click(ctx.window, modal.querySelector('.shipit-ok'));
      await settle(ctx.window, 6);
      assert.deepEqual(JSON.parse(prPosts(ctx)[0].opts.body),
        { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id, pushRemote: 'origin', baseRemote: 'upstream', baseBranch: 'dev' });
    } },
    { name: 'a run outside a chain offers its source first, with no "This chain" group', run: async () => {
      const ctx = await bootShip();
      const modal = await openModal(ctx);
      assert.deepEqual(groupsOf(baseSelOf(modal)), [[null, ['feat/log-ux']], ['Branches on origin', ['main']]]);
      assert.equal(baseSelOf(modal).value, 'feat/log-ux');
    } },
  ]);
});

test('switching the base remote re-lists its branches and keeps a pick that still exists', async () => {
  const ctx = await bootShip({ remotes: CHAIN_REMOTES, arms: prArm(PR_OK) });
  const { window } = ctx;
  const modal = await openModal(ctx);
  const sel = baseSelOf(modal);
  const remoteSel = modal.querySelector('.shipit-base-remote');
  const pick = (v) => { sel.value = v; sel.dispatchEvent(new window.Event('change')); };
  const toRemote = (v) => { remoteSel.value = v; remoteSel.dispatchEvent(new window.Event('change')); };

  pick('release');
  assert.match(modal.querySelector('.shipit-remotes-hint').textContent, /→ up\/repo release$/);
  toRemote('origin');
  assert.deepEqual(groupsOf(sel), [['This chain', ['dev', 'nb1', 'feat/log-ux']], ['Branches on origin', ['main', 'mine']]]);
  assert.equal(sel.value, 'dev', 'origin has no release: back to the default');
  pick('main');
  toRemote('upstream');
  assert.equal(sel.value, 'main', 'a pick the new remote still has is kept');
  pick('nb1');
  toRemote('origin');
  assert.equal(sel.value, 'nb1', 'a chain branch is always kept');
  assert.equal(remotesCalls(ctx).length, 1, 'the branches came with the remotes: no refetch');
  click(window, modal.querySelector('.shipit-ok'));
  await settle(window, 6);
  assert.equal(JSON.parse(prPosts(ctx)[0].opts.body).baseBranch, 'nb1');
});

// ---------------------------------------------------------------------------
// The PR description: Write / Preview, Generate with AI (POST /api/pr/describe),
// and the optional `body` on the confirm POST
// ---------------------------------------------------------------------------

const descOf = (modal) => modal.querySelector('.shipit-desc-input');
const previewOf = (modal) => modal.querySelector('.shipit-desc-preview');
const genBtnOf = (modal) => modal.querySelector('.shipit-generate');
const stopBtnOf = (modal) => modal.querySelector('.shipit-generate-stop');
const descErrOf = (modal) => modal.querySelector('.shipit-desc-err');
const tabOf = (modal, mode) => modal.querySelector(`.shipit-desc-tab[data-mode="${mode}"]`);
const describeCalls = (ctx) => ctx.calls.filter((c) => c.url.endsWith('/api/pr/describe'));
const typeInto = (window, ta, value) => { ta.value = value; ta.dispatchEvent(new window.Event('input', { bubbles: true })); };
const confirmOpen = (w) => !w.document.getElementById('confirm-modal').classList.contains('hidden');
const escape = (w) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const realMarkdown = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });

// A describe request that hangs until released. With `honorAbort` it rejects the
// way fetch does once its signal aborts; without, the response can still land
// late (a server that answered anyway) so the stale-response guards are exercised.
function gatedDescribe({ honorAbort = true } = {}) {
  const g = { signals: [], releases: [] };
  g.arm = (url, opts) => {
    if (!url.endsWith('/api/pr/describe')) return null;
    g.signals.push(opts.signal);
    return new Promise((resolve, reject) => {
      g.releases.push((body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }));
      if (honorAbort) opts.signal?.addEventListener('abort', () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e); });
    });
  };
  g.release = (body, status) => g.releases[g.releases.length - 1](body, status);
  return g;
}

test('description: Preview renders markdown, Write restores raw text; confirm reads it at click time and sends body only when non-empty', async () => {
  let n = 0;
  const ctx = await bootShip({
    hooks: { askMarkdown: realMarkdown },
    arms: (url, opts) => (url.endsWith('/api/pr') && opts.method === 'POST'
      ? (++n === 1 ? fail(500, { error: 'git push failed: denied' }) : ok(PR_OK)) : null),
  });
  const modal = await openModal(ctx);
  await checkRows([
    { name: 'Preview renders the draft as markdown, Write brings the raw text back', run: async () => {
      typeInto(ctx.window, descOf(modal), '## Summary\n\nRetries **twice**.');
      click(ctx.window, tabOf(modal, 'preview'));
      await settle(ctx.window, 6);
      assert.equal(tabOf(modal, 'preview').getAttribute('aria-selected'), 'true');
      assert.equal(descOf(modal).hidden, true);
      assert.equal(previewOf(modal).hidden, false);
      assert.equal(previewOf(modal).querySelector('h2')?.textContent, 'Summary', 'rendered through the page markdown pipeline');
      assert.equal(previewOf(modal).querySelector('strong')?.textContent, 'twice');
      click(ctx.window, tabOf(modal, 'text'));
      assert.equal(descOf(modal).hidden, false);
      assert.equal(previewOf(modal).hidden, true);
      assert.equal(descOf(modal).value, '## Summary\n\nRetries **twice**.', 'Write loses nothing');
    } },
    { name: 'confirm reads the description at click time and sends `body` only when it is non-empty', run: async () => {
      typeInto(ctx.window, descOf(modal), '  \n ');
      click(ctx.window, modal.querySelector('.shipit-ok'));
      await settle(ctx.window, 6);
      assert.ok(!('body' in JSON.parse(prPosts(ctx)[0].opts.body)), 'a blank description sends no body: today\'s PR');
      typeInto(ctx.window, descOf(modal), '## Summary\nShips it.');
      click(ctx.window, modal.querySelector('.shipit-ok'));
      await settle(ctx.window, 6);
      assert.deepEqual(JSON.parse(prPosts(ctx)[1].opts.body),
        { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id, pushRemote: 'origin', baseRemote: 'origin', baseBranch: 'feat/log-ux', body: '## Summary\nShips it.' });
      assert.equal(isOpen(ctx.window), false);
    } },
  ]);
});

test('Generate with AI posts the run + base branch, reads "Generating…" while in flight, then fills the description', async () => {
  const g = gatedDescribe();
  const ctx = await bootShip({ arms: g.arm });
  const modal = await openModal(ctx);
  click(ctx.window, genBtnOf(modal));
  await settle(ctx.window);
  assert.equal(describeCalls(ctx).length, 1);
  assert.deepEqual(JSON.parse(describeCalls(ctx)[0].opts.body),
    { projectDir: '/tmp/proj', projectKey: KEY, id: ROW.id, baseBranch: 'feat/log-ux' });
  assert.equal(genBtnOf(modal).disabled, true);
  assert.equal(genBtnOf(modal).textContent, 'Generating…');
  assert.equal(stopBtnOf(modal).hidden, false, 'a generation in flight can be stopped');
  click(ctx.window, genBtnOf(modal));
  assert.equal(describeCalls(ctx).length, 1, 'a second click while in flight sends nothing');
  g.release({ ok: true, body: '## Summary\nRetries fetch.' });
  await settle(ctx.window, 6);
  assert.equal(descOf(modal).value, '## Summary\nRetries fetch.');
  assert.equal(genBtnOf(modal).disabled, false);
  assert.equal(genBtnOf(modal).textContent, 'Generate with AI');
  assert.equal(stopBtnOf(modal).hidden, true);
  assert.equal(isOpen(ctx.window), true, 'nothing is submitted: the text waits for the user');
  assert.equal(prPosts(ctx).length, 0);
});

test('Generate with AI locks the description while in flight and unlocks on landing and on Stop', async () => {
  const g = gatedDescribe();
  const ctx = await bootShip({ arms: g.arm });
  const modal = await openModal(ctx);
  assert.equal(descOf(modal).readOnly, false);
  click(ctx.window, genBtnOf(modal)); await settle(ctx.window);
  assert.equal(descOf(modal).readOnly, true);
  g.release({ ok: true, body: 'Drafted.' }); await settle(ctx.window, 6);
  assert.equal(descOf(modal).readOnly, false);
  click(ctx.window, genBtnOf(modal)); await settle(ctx.window);
  click(ctx.window, ctx.window.document.getElementById('confirm-ok')); await settle(ctx.window);   // replace "Drafted."
  assert.equal(descOf(modal).readOnly, true, 'locked again for the second draft');
  click(ctx.window, stopBtnOf(modal)); await settle(ctx.window, 6);
  assert.equal(descOf(modal).readOnly, false, 'Stop lifts the lock');
});

test('Generate over a draft asks first: Escape on that confirm keeps the draft AND the modal; Replace overwrites it', async () => {
  const g = gatedDescribe();
  const ctx = await bootShip({ arms: g.arm });
  const modal = await openModal(ctx);
  typeInto(ctx.window, descOf(modal), 'my own words');
  click(ctx.window, genBtnOf(modal));
  await settle(ctx.window);
  assert.equal(confirmOpen(ctx.window), true, 'a draft is never replaced without asking');
  assert.equal(describeCalls(ctx).length, 0, 'nothing generated before the answer');
  escape(ctx.window);
  await settle(ctx.window);
  assert.equal(confirmOpen(ctx.window), false);
  assert.equal(isOpen(ctx.window), true, 'Escape closes the confirm only, not the ship-it modal under it');
  assert.equal(describeCalls(ctx).length, 0);
  assert.equal(descOf(modal).value, 'my own words');

  click(ctx.window, genBtnOf(modal));
  await settle(ctx.window);
  click(ctx.window, ctx.window.document.getElementById('confirm-ok'));
  await settle(ctx.window);
  assert.equal(describeCalls(ctx).length, 1);
  g.release({ ok: true, body: 'Generated.' });
  await settle(ctx.window, 6);
  assert.equal(descOf(modal).value, 'Generated.');
});

test('Stop or closing the modal aborts an in-flight generation; a late response never writes into a re-opened modal', async () => {
  await checkRows([
    { name: 'Stop aborts an in-flight generation: the button resets, no error, the description is untouched', run: async () => {
      const g = gatedDescribe();
      const ctx = await bootShip({ arms: g.arm });
      const modal = await openModal(ctx);
      click(ctx.window, genBtnOf(modal));
      await settle(ctx.window);
      assert.equal(g.signals[0].aborted, false);
      click(ctx.window, stopBtnOf(modal));
      await settle(ctx.window, 6);
      assert.equal(g.signals[0].aborted, true, 'the request is cancelled (AbortController)');
      assert.equal(genBtnOf(modal).disabled, false);
      assert.equal(genBtnOf(modal).textContent, 'Generate with AI');
      assert.equal(stopBtnOf(modal).hidden, true);
      assert.equal(descErrOf(modal).hidden, true, 'a stop is not an error');
      assert.equal(descOf(modal).value, '');
      assert.equal(isOpen(ctx.window), true);
    } },
    { name: 'closing the modal aborts the generation, and a late response never writes into a re-opened modal', run: async () => {
      const g = gatedDescribe({ honorAbort: false });
      const ctx = await bootShip({ arms: g.arm });
      const { window } = ctx;
      const modal = await openModal(ctx);
      click(window, genBtnOf(modal));
      await settle(window);
      click(window, modal.querySelector('.shipit-cancel'));
      assert.equal(g.signals[0].aborted, true, 'closing the modal cancels the request');
      click(window, hdPr(window));                        // re-open: a new generation owns the modal
      await settle(window);
      assert.equal(genBtnOf(modal).textContent, 'Generate with AI', 'the new open starts idle');
      g.release({ ok: true, body: 'stale text' });        // the old response lands anyway
      await settle(window, 6);
      assert.equal(descOf(modal).value, '', 'the stale response must not fill the new modal');
      assert.equal(genBtnOf(modal).disabled, false);
      assert.equal(descErrOf(modal).hidden, true);
      // Same for a failure that lands late.
      click(window, genBtnOf(modal));
      await settle(window);
      escape(window);
      click(window, hdPr(window));
      await settle(window);
      g.release({ error: 'boom' }, 500);
      await settle(window, 6);
      assert.equal(descErrOf(modal).hidden, true, 'a stale failure paints nothing either');
      assert.equal(genBtnOf(modal).textContent, 'Generate with AI');
    } },
  ]);
});

test('every open starts fresh: default base pick, empty description on the Write tab', async () => {
  const ctx = await bootShip({
    remotes: CHAIN_REMOTES,
    arms: (url) => (url.endsWith('/api/pr/describe') ? fail(500, { error: 'boom' }) : null),
  });
  const { window } = ctx;
  const modal = await openModal(ctx);
  // The second row starts on the modal the first row re-opened.
  await checkRows([
    { name: 'a re-open starts from the fresh default, not the previous pick', run: async () => {
      baseSelOf(modal).value = 'nb1';
      click(window, modal.querySelector('.shipit-cancel'));
      click(window, hdPr(window));
      await settle(window);
      assert.equal(baseSelOf(modal).value, 'dev');
    } },
    { name: 'every open starts from an empty description on the Write tab', run: async () => {
      typeInto(window, descOf(modal), 'left over');
      click(window, tabOf(modal, 'preview'));
      await settle(window);
      typeInto(window, descOf(modal), '');
      click(window, genBtnOf(modal));
      await settle(window, 6);
      assert.equal(descErrOf(modal).hidden, false);
      descOf(modal).value = 'left over';
      click(window, modal.querySelector('.shipit-cancel'));
      click(window, hdPr(window));
      await settle(window);
      assert.equal(descOf(modal).value, '');
      assert.equal(tabOf(modal, 'text').getAttribute('aria-selected'), 'true');
      assert.equal(descOf(modal).hidden, false);
      assert.equal(previewOf(modal).hidden, true);
      assert.equal(descErrOf(modal).hidden, true);
    } },
  ]);
});

// ---------------------------------------------------------------------------
// Sync before run (#527, plan §5.6): the base moved on the remote since the run started
// ---------------------------------------------------------------------------

test('base warning: shown when baseStatus.movedSinceRun > 0 on the chosen base remote, hidden for another remote, a base change or null', async () => {
  await checkRows([
    { name: 'baseStatus.movedSinceRun > 0 on the chosen base shows the warning; a base change hides it', run: async () => {
      const ctx = await bootShip({ remotes: { ...REMOTES, baseStatus: { base: 'feat/log-ux', remote: 'origin', movedSinceRun: 3, fetchedAt: null, stale: false } } });
      const modal = await openModal(ctx);
      const warn = modal.querySelector('#shipit-base-warn');
      assert.equal(warn.hidden, false);
      assert.equal(warn.textContent, 'origin/feat/log-ux has 3 new commits since this run started. The PR may need an update.');
      const sel = baseSelOf(modal);
      sel.value = 'main';
      sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
      assert.equal(warn.hidden, true, 'another base: the warning no longer applies');
    } },
    { name: 'the base warning is about baseStatus.remote: a PR into another remote\'s same-named branch hides it (#527)', run: async () => {
      const ctx = await bootShip({ remotes: { ...FORK_REMOTES, baseStatus: { base: 'feat/log-ux', remote: 'origin', movedSinceRun: 2, fetchedAt: null, stale: false } } });
      const modal = await openModal(ctx);
      const warn = modal.querySelector('#shipit-base-warn');
      const remoteSel = modal.querySelector('.shipit-base-remote');
      assert.equal(remoteSel.value, 'upstream');
      assert.equal(baseSelOf(modal).value, 'feat/log-ux');
      assert.equal(warn.hidden, true, 'upstream/feat/log-ux is not the branch that moved');
      remoteSel.value = 'origin';
      remoteSel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
      baseSelOf(modal).value = 'feat/log-ux';
      baseSelOf(modal).dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
      assert.equal(warn.hidden, false);
      assert.match(warn.textContent, /^origin\/feat\/log-ux has 2 new commits/);
    } },
    { name: 'baseStatus.movedSinceRun null keeps the warning hidden', run: async () => {
      const ctx = await bootShip({ remotes: { ...REMOTES, baseStatus: { base: 'feat/log-ux', remote: 'origin', movedSinceRun: null, fetchedAt: null, stale: false } } });
      const modal = await openModal(ctx);
      assert.equal(modal.querySelector('#shipit-base-warn').hidden, true);
    } },
  ]);
});

// ---------------------------------------------------------------------------
// Azure DevOps (D8): eligibility by any PR host, the host name on the base remote,
// no cross-repo PRs, the missing-credential reason, and `forge` on Generate
// ---------------------------------------------------------------------------

const AZ_BASE = { name: 'origin', slug: 'dev.azure.com/acme/Shop/api', owner: 'acme/Shop', forge: 'azure', prHost: 'Azure DevOps', prSupported: true };
const AZ_FORK = { name: 'fork', slug: 'dev.azure.com/acme/Shop/api-fork', owner: 'acme/Shop', forge: 'azure', prHost: 'Azure DevOps', prSupported: true };
const azRemotes = (list, defaults = { pushRemote: 'origin', baseRemote: 'origin' }) => ({ ...REMOTES, remotes: list, defaults });
const baseLabelOf = (modal) => modal.querySelector('label[for="shipit-base-remote"]').textContent;
const hintOf = (modal) => modal.querySelector('.shipit-remotes-hint').textContent;

test('(e) Create PR eligibility reads any PR host: an Azure DevOps token alone offers it, no host hides it', async () => {
  await checkRows([
    { name: 'gh missing, Azure configured', run: async () => {
      const ctx = await bootShip({ gh: false, prHosts: { github: false, azure: true } });
      await openDetail(ctx);
      assert.equal(hdPr(ctx.window).hidden, false);
      assert.equal(ctx.window.__np.histPrEligible(ROW), true);
    } },
    { name: 'neither host', run: async () => {
      const ctx = await bootShip({ gh: false, prHosts: { github: false, azure: false } });
      await openDetail(ctx);
      assert.equal(hdPr(ctx.window).hidden, true);
      assert.equal(ctx.window.__np.histPrEligible(ROW), false);
    } },
  ]);
});

test('(a)(b)(c)(g) the Ship-it modal names the base remote\'s PR host and says why an Azure PR cannot open', async () => {
  await checkRows([
    { name: '(a) the base label names Azure DevOps', run: async () => {
      const modal = await openModal(await bootShip({ remotes: azRemotes([AZ_BASE]) }));
      assert.equal(baseLabelOf(modal), 'Open PR in (Azure DevOps)');
      assert.equal(hintOf(modal), '');
    } },
    { name: '(b) a fork push into an Azure base says forks are not supported, not Cross-repo', run: async () => {
      const modal = await openModal(await bootShip({ remotes: azRemotes([AZ_BASE, AZ_FORK], { pushRemote: 'fork', baseRemote: 'origin' }) }));
      assert.equal(hintOf(modal), 'Azure DevOps pull requests between repositories (forks) are not supported yet — push to origin.');
    } },
    { name: '(c) a missing credential shows the server\'s reason', run: async () => {
      const prReason = 'Azure DevOps is not configured: set WORCA_ADO_TOKEN (a PAT with Code: Read & Write) where worca runs';
      const modal = await openModal(await bootShip({ remotes: azRemotes([{ ...AZ_BASE, prSupported: false, prReason }]) }));
      assert.equal(hintOf(modal), prReason);
    } },
    { name: '(g) a remote with no known PR host keeps the plain label', run: async () => {
      const modal = await openModal(await bootShip({
        remotes: azRemotes([{ name: 'origin', slug: 'gitlab.com/g/api', owner: 'g', forge: null, prHost: null, prSupported: true }]),
      }));
      assert.equal(baseLabelOf(modal), 'Open PR in');
    } },
  ]);
});

test('(d) Generate with AI sends forge:azure for an Azure base remote, and no forge for GitHub', async () => {
  const describeBody = async (remotes) => {
    const bodies = [];
    const ctx = await bootShip({
      remotes,
      arms: (url, opts) => (url.endsWith('/api/pr/describe') ? (bodies.push(JSON.parse(opts.body)), ok({ body: 'drafted' })) : null),
    });
    const modal = await openModal(ctx);
    click(ctx.window, genBtnOf(modal));
    await settle(ctx.window, 6);
    assert.equal(bodies.length, 1);
    return bodies[0];
  };
  await checkRows([
    { name: 'Azure base remote', run: async () => assert.equal((await describeBody(azRemotes([AZ_BASE]))).forge, 'azure') },
    { name: 'GitHub base remote', run: async () => assert.equal('forge' in (await describeBody(REMOTES)), false) },
  ]);
});

test('(f) the Azure PR-host flag survives the history cache', async () => {
  const ctx = await bootShip({ gh: false, prHosts: { github: false, azure: true } });
  go(ctx.window, 'runs');
  await settle(ctx.window, 6);                       // /api/history answered, writeHistoryCache ran
  const blob = JSON.parse(ctx.window.localStorage.getItem('worca-cc.history.cache.v1'));
  assert.equal(blob.adoAvailable, true);
  assert.equal(blob.ghAvailable, false);
});
