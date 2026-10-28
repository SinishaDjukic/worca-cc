// test/ui-report-run.test.mjs — "Report this run": the preview modal History detail's
// per-run ⋯ menu opens. Running detail does not offer it; a finished run there links
// to its saved page instead. The modal renders the EXACT payload
// POST /api/pipelines/:id/report returns, and nothing leaves the machine until the
// user presses Copy, Download, or the issue link — worca itself never calls GitHub.
//
// boot()/dispatch()/showRunning() are a deliberate local copy of
// test/ui-running-stop-modal.test.mjs:22-82 — the suites do not import each other —
// plus three additions: the jsdom-window bookkeeping ui-history-detail.test.mjs:37-38
// uses; a navigator.clipboard stub, because jsdom ships neither navigator.clipboard
// nor document.execCommand and the copy path would otherwise fall through legacyCopy
// and report "copy failed"; and a VirtualConsole with omitJSDOMErrors, because two
// tests click a real <a href> and jsdom's unimplemented navigation would print an
// error per booted window.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { previewText, REPORT_PREVIEW_DEBOUNCE_MS } from '../ui/public/report-run.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { useAppTimers } from './helpers/app-timers.mjs';
import { backdropClick, pressEscape, discardPrompt, discardChanges } from './helpers/popups.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PKEY = 'proj-alpha-11111111';
const PID = 'abc123de';
const RUN_ID = 'run-report-1';

// Release each booted window (test/helpers/jsdom-release.mjs): every boot leaves an
// app.js instance that pins its DOM for the life of the process.
const trackDom = useDomRelease(afterEach);

const REPORT = {
  payload: { schemaVersion: 1, reason: 'too-slow', run: { id: PID },
             included: { paths: false, prompt: false },
             app: { worca: '1.2.0' }, steps: [], subAgents: [] },
  issue: { url: 'https://github.com/SinishaDjukic/worca-cc/issues/new?labels=too-slow',
           truncated: false, filename: `worca-run-report-${PID}-too-slow.json` },
};

const FILED_URL = 'https://github.com/SinishaDjukic/worca-cc/issues/512';
const FILED = { ok: true, url: FILED_URL, labeled: true };

// ── boot(): test/ui-running-stop-modal.test.mjs:22-82, plus trackDom and clipboard ──
async function boot({ fetchHandler, clipboard } = {}) {
  // #report-issue is a real <a href> and two tests click it. jsdom has no navigation,
  // so its activation behaviour raises a `jsdomError` ("Not implemented: navigation
  // (except hash changes)") which the DEFAULT virtual console forwards to
  // console.error. It does not fail the file — node:test ignores stderr — but it
  // prints once per booted window and buries a real failure. Forward everything EXCEPT
  // jsdomError, so a genuine page error still surfaces.
  //
  // jsdom 29 (package.json: ^29.1.1) renamed this: the old
  // `sendTo(console, { omitJSDOMErrors: true })` is gone and
  // `forwardTo(console, { jsdomErrors: 'none' })` is the replacement
  // (node_modules/jsdom/lib/jsdom/virtual-console.js).
  const virtualConsole = new VirtualConsole();
  virtualConsole.forwardTo(console, { jsdomErrors: 'none' });
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'),
    { url: 'http://localhost:4317/', virtualConsole });
  trackDom(dom);
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {}
    close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };

  // jsdom ships neither navigator.clipboard nor document.execCommand, so the app's
  // copy path would fall through legacyCopy and report "copy failed" unless we
  // install one here. Install BEFORE app.js runs, because `navigator` is aliased
  // onto globalThis below.
  if (clipboard) Object.defineProperty(window.navigator, 'clipboard', { value: clipboard, configurable: true });

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); }
    catch { /* read-only global already present — leave it */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  function dispatch(msg) { wsBox.ws.dispatch('message', { data: JSON.stringify(msg) }); }
  function showRunning() {
    window.location.hash = 'running';
    window.dispatchEvent(new window.Event('hashchange'));
  }
  return { window, dispatch, showRunning, calls, wsBox };
}

// ── local helpers ─────────────────────────────────────────────────────────────
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const esc = (w) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const settle = async (w, n = 4) => { for (let i = 0; i < n; i += 1) await new Promise((r) => w.setTimeout(r, 0)); };
const go = (w, hash) => { w.location.hash = hash; w.dispatchEvent(new w.Event('hashchange')); };
const reportPosts = (ctx) => ctx.calls.filter((c) => /\/report$/.test(c.url) && c.opts.method === 'POST');
const issuePosts = (ctx) => ctx.calls.filter((c) => /\/report-issue$/.test(c.url) && c.opts.method === 'POST');

const jsonRes = (status, body) => Promise.resolve({
  ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body),
});

// ── the History fixtures, shaped like test/ui-history-detail.test.mjs:113-133 ──
const DETAIL_URL = `/api/history/${PKEY}/${PID}`;
const DETAIL_HASH = `history/${PKEY}/${PID}`;

const ROW = {
  id: PID, projectKey: PKEY, projectName: 'Alpha', projectDir: '/tmp/proj',
  title: 'Alpha', status: 'done', startedAt: '2026-06-01T00:00:00Z',
  branch: 'worca-cc/alpha-abc123de', sourceBranch: 'dev', survived: true,
  added: 12, removed: 3, totalCostUsd: 4.21, totalActiveMs: 640000, mtime: 1,
  pauseReason: null, retainedWork: null,
};

const DETAIL = {
  state: {
    id: PID, title: 'Alpha', status: 'done', startedAt: ROW.startedAt,
    stepper: null, steps: [], subAgents: [], totalCostUsd: 4.21, totalActiveMs: 640000,
    branch: { source: 'dev', feature: ROW.branch, worktreeDir: '/tmp/wt' },
    prompt: 'do the thing',
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
};

const DAY = 86400000;
const BUDGET = {
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
};

/**
 * The fetch arms. ARM ORDER IS LOAD-BEARING and every history arm matches with
 * `endsWith`, never `includes` — the detail URL is a PREFIX of the /log and /diff
 * URLs, and `/api/history` is a prefix of `POST /api/history/pr`. This is
 * test/ui-history-detail.test.mjs:181-195's rule, verbatim; break it and #hist-detail
 * never paints, so `.hd-report` is null and every assertion below reads off nothing.
 * The report endpoint is matched first because it is the only POST here.
 */
function arms({ report = REPORT, reportStatus = 200, filed = FILED, filedStatus = 200,
                rows = [ROW], detail = DETAIL } = {}) {
  return (url) => {
    // BEFORE the '/report' arm: that one matches with endsWith too, and
    // '/report-issue' would otherwise be answered by it if the order ever flipped.
    if (url.endsWith('/report-issue')) return jsonRes(filedStatus, filed);
    if (url.endsWith('/report')) return jsonRes(reportStatus, report);
    if (url.endsWith('/api/history/pr')) return jsonRes(200, { ok: true });
    if (url.endsWith('/diff')) return jsonRes(404, { error: 'no diff' });
    if (url.endsWith('/log')) return jsonRes(404, { error: 'no log' });
    if (url.endsWith('/api/history')) return jsonRes(200, { pipelines: rows, ghAvailable: false });
    if (url.endsWith(DETAIL_URL)) return jsonRes(200, detail);
    if (url.endsWith('/api/budget')) return jsonRes(200, BUDGET);
    return null;
  };
}

/**
 * Land on History detail. Visit the Runs LIST first so /api/history delivers the
 * authoritative row: go straight to the detail hash and `record` is the minimal
 * {id, projectKey} deep-link stub, which is a different (and, for the .hd-report gate,
 * more dangerous) code path — covered separately below.
 */
async function openHistoryDetail(ctx) {
  go(ctx.window, 'runs');
  await settle(ctx.window, 6);
  go(ctx.window, DETAIL_HASH);
  await settle(ctx.window, 8);
}

async function openHistoryReport(ctx) {
  await openHistoryDetail(ctx);
  const btn = ctx.window.document.querySelector('#hist-detail .hd-report');
  assert.ok(btn, '#hist-detail painted and carries .hd-report');
  click(ctx.window, btn);
  await settle(ctx.window, 8);
  return btn;
}

/** Seed one live run and open its Running detail — ui-running-stop-modal.test.mjs:89-100. */
async function armRunning(ctx, { status = 'running' } = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [{ runId: RUN_ID, title: 'Alpha', projectDir: '/tmp/proj', status,
             startedAt: '2026-06-01T00:00:00Z', kind: 'run', pipelineId: PID }],
  });
  ctx.showRunning();
  await settle(ctx.window, 4);
  ctx.dispatch({ type: 'state', runId: RUN_ID, status, branch: { feature: ROW.branch } });
  go(ctx.window, `#running/${RUN_ID}`);
  await settle(ctx.window, 8);
}

// ── tests ─────────────────────────────────────────────────────────────────────
test('the History ⋯ menu carries "Report this run"; it opens the preview modal (two opt-ins, six reasons) and reports the run PIPELINE id', async () => {
  // One boot: the ⋯ menu opens and its item is clicked once; what each step shows is
  // recorded as it happens, and the rows read the records.
  const ctx = await boot({ fetchHandler: arms() });
  await openHistoryDetail(ctx);
  const doc = ctx.window.document;
  // Slice 2: the bar's one ⋯ (runMoreItems) lists it; its item clicks the hidden .hd-report carrier.
  const more = doc.querySelector('#hist-detail .hd-bar-more');
  const moreHidden = more.hidden;
  click(ctx.window, more);
  await settle(ctx.window);
  const item = [...doc.querySelectorAll('body > .wfv-menu .menu-item')].find((b) => b.textContent.trim() === 'Report this run');
  const btn = doc.querySelector('#hist-detail .hd-report');
  const menu = { itemHidden: item?.hidden, role: item?.getAttribute('role'), text: item?.textContent.trim(),
    posts: reportPosts(ctx).length, btnHidden: btn?.hidden };
  click(ctx.window, item);
  await settle(ctx.window, 8);
  const modal = doc.getElementById('report-modal');
  await checkRows([
    { name: 'History detail shows "Report this run" and opens the preview modal', run: () => {
      assert.ok(btn, 'the button exists on History detail');
      assert.equal(menu.btnHidden, false, 'a finished run can be reported');
      assert.equal(modal.classList.contains('hidden'), false, 'the preview opens');
      assert.equal(modal.querySelectorAll('#report-optins input[type="checkbox"]').length, 2);
      assert.equal(modal.querySelector('#report-reason').options.length, 6);
    } },
    { name: 'the History ⋯ menu carries "Report this run" and it opens the report modal', run: () => {
      assert.equal(moreHidden, false, 'a finished run shows the ⋯ trigger');
      assert.ok(item, 'the report item lives inside the ⋯ menu');
      assert.equal(menu.itemHidden, false);
      assert.equal(menu.role, 'menuitem');
      assert.equal(menu.text, 'Report this run');
      assert.equal(menu.posts, 0, 'opening the menu builds nothing');
      assert.equal(modal.classList.contains('hidden'), false,
        'the item opens the report modal');
      assert.equal(reportPosts(ctx).length, 1, 'exactly one call, to build the preview');
      assert.match(reportPosts(ctx).at(-1).url, new RegExp(`/api/pipelines/${PID}/report$`),
        'it reports the run PIPELINE id');
    } },
  ]);
});

test('a still-running pipeline reached by DEEP LINK does not offer the button', async () => {
  // Withhold the list row: `record` is then the minimal {id, projectKey} deep-link stub
  // with neither `status` nor `live`. isDeletableEntry is a DENY-list, so the stub ALONE
  // reads as deletable — the gate has to judge on data.state.status (T4c). This is the
  // one test that distinguishes isDeletableEntry(record) from
  // isDeletableEntry({ ...record, status: st.status }).
  const ctx = await boot({ fetchHandler: arms({
    rows: [],
    detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } },
  }) });
  go(ctx.window, DETAIL_HASH);
  await settle(ctx.window, 8);
  const btn = ctx.window.document.querySelector('#hist-detail .hd-report');
  assert.ok(btn, 'the button is in the history-detail template');
  assert.equal(btn.hidden, true, 'a run that is still going cannot be reported');
});

test('the preview renders the EXACT payload the endpoint returned', async () => {
  const ctx = await boot({ fetchHandler: arms() });
  await openHistoryReport(ctx);
  const pre = ctx.window.document.getElementById('report-preview');
  assert.deepEqual(JSON.parse(pre.textContent), REPORT.payload, 'the preview is the payload, verbatim');
  assert.equal(ctx.window.document.getElementById('report-issue').getAttribute('href'), REPORT.issue.url,
    'the issue link is the one the server built');
});

test('nothing is posted until the button is pressed, and worca never calls GitHub', async () => {
  const ctx = await boot({ fetchHandler: arms() });
  await openHistoryDetail(ctx);
  assert.equal(reportPosts(ctx).length, 0, 'no report call before the button is pressed');

  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-report'));
  await settle(ctx.window, 8);
  assert.equal(reportPosts(ctx).length, 1, 'exactly one call, to build the preview');
  // The ONLY outbound path is the anchor the user clicks; worca itself never fetches GitHub.
  assert.equal(ctx.calls.some((c) => c.url.includes('github.com')), false,
    'worca makes no network call to GitHub');
});

test('ticking an opt-in re-requests the payload and repaints the preview', async () => {
  const ctx = await boot({ fetchHandler: arms() });
  await openHistoryReport(ctx);
  const box = ctx.window.document.querySelector('#report-optins input[data-optin="prompt"]');
  box.checked = true;
  box.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await settle(ctx.window, 8);
  const last = reportPosts(ctx).at(-1);
  assert.deepEqual(JSON.parse(last.opts.body).include, { paths: false, prompt: true },
    'the opt-in state rides the next request');
});

test('the issue link is inert while a rebuild is in flight', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const base = arms();
  const ctx = await boot({ fetchHandler: (url) => (url.endsWith('/report')
    ? gate.then(() => jsonRes(200, REPORT)) : base(url)) });
  await openHistoryDetail(ctx);
  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-report'));
  await settle(ctx.window, 4);

  const link = ctx.window.document.getElementById('report-issue');
  assert.equal(link.hasAttribute('href'), false,
    'the link cannot fire with a payload that disagrees with the preview (D24)');
  release();
  await settle(ctx.window, 8);
  assert.equal(link.getAttribute('href'), REPORT.issue.url, 'and it arrives with the payload');
});

// Slice 2: the report flow is reached from the run page's one ⋯ menu, live and saved. A finished run
// on Running detail has no visible report button; its ⋯ lists Report this run (a hidden carrier).
test('a done, stopped or error run\'s Running header has no report button; its ⋯ lists Report this run', async () => {
  // A boot per status (the loop's rows).
  await checkRows(['done', 'stopped', 'error'].map((status) => ({
    name: `a ${status} run's Running header has no report button`,
    run: async () => {
      // Its History row is still `live` (the refetch after the finish has not landed), so
      // the Running page shows the finished run instead of handing over to the saved one.
      const ctx = await boot({ fetchHandler: arms({ rows: [{ ...ROW, live: true }] }) });
      // `hello` is what populates `runs` and sets helloSeeded; without it routeRunDetail
      // mounts a title-only screen, repaintRunDetail never runs, and paintRdTerminal —
      // the thing that paints the terminal header — is never called at all.
      await armRunning(ctx, { status: 'running' });
      const doc = ctx.window.document;
      assert.ok(doc.querySelector('#run-detail .rd-report').closest('.run-menu-carriers[hidden]'),
        'the run-detail template carries the report carrier, never shown');
      assert.equal(doc.querySelector('#run-detail .rd-report').hidden, true, 'a running run is not offered it');

      ctx.dispatch({ type: 'state', runId: RUN_ID, status });
      await settle(ctx.window, 8);
      const header = doc.querySelector('#run-detail .rd-header');
      assert.equal(header.querySelector('.rd-report'), null, 'a finished run has no report button');
      assert.equal([...header.querySelectorAll('button, a')].some((b) => /Report this run/.test(b.textContent)),
        false, 'nothing in the header offers to report the run');
      assert.equal(header.querySelector('.rd-history-link'), null, 'no link to click: the saved run opens on its own');
      assert.ok(doc.querySelector('#run-detail .rd-bar .rd-report').closest('[hidden]'), 'nor does the shared bar show one');
      doc.querySelector('#run-detail .rd-bar-more').dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      const items = [...doc.querySelectorAll('body > .wfv-menu .menu-item')].map((b) => b.querySelector('.wfv-menu-l').textContent);
      assert.ok(items.includes('Report this run'), 'the ⋯ lists Report this run');
    },
  })));
});

test('Escape closes the report modal WITHOUT navigating the detail screen away', async () => {
  const ctx = await boot({ fetchHandler: arms() });
  // Slide: there the saved run's own Escape WOULD navigate to #runs (side by side it does
  // nothing on the glance), so a leak past the modal's guard shows in the hash.
  ctx.window.document.getElementById('runs-shell').dataset.layout = 'slide';
  await openHistoryReport(ctx);
  const before = ctx.window.location.hash;
  esc(ctx.window);
  await settle(ctx.window, 4);
  assert.equal(ctx.window.document.getElementById('report-modal').classList.contains('hidden'), true,
    'the modal closes');
  assert.equal(ctx.window.location.hash, before,
    'the capture-phase guard must bail while the report modal is open');
});

// #report-modal is a top-level `position:fixed;inset:0` overlay with a live document
// keydown listener — the same class as #stop-modal and #ship-it-modal, and those are
// torn down on the way out in three places (app.js showView, closeRunDetail,
// closeHistDetail). Leaving the screen with one up floats a full-screen dialog for a
// run the user has navigated away from over an unrelated view, and a pending debounce
// can still POST /report for it.
test('leaving the saved run (back to the Runs list, or another view) tears the report modal down', async () => {
  const ctx = await boot({ fetchHandler: arms() });
  // The detail -> list hop exists in the narrow slide layout only: side by side a bare
  // #runs reopens the remembered run (this one), so it does not mean "the list" there.
  ctx.window.document.getElementById('runs-shell').dataset.layout = 'slide';
  await checkRows([
    { name: 'going back to the Runs list tears the report modal down', run: async () => {
      await openHistoryReport(ctx);
      const modal = ctx.window.document.getElementById('report-modal');
      assert.equal(modal.classList.contains('hidden'), false, 'the modal is up');

      go(ctx.window, 'runs');
      await settle(ctx.window, 8);
      assert.equal(ctx.window.document.getElementById('hist-shell').classList.contains('detail-open'), false,
        'the saved run slid away');
      assert.equal(modal.classList.contains('hidden'), true,
        'detail -> list stays inside the Runs view, so closeHistDetail is what must close it');
    } },
    { name: 'switching views tears the report modal down', run: async () => {
      // History detail -> another view: the modal must not outlive the screen it opened on.
      await openHistoryReport(ctx);
      const modal = ctx.window.document.getElementById('report-modal');
      assert.equal(modal.classList.contains('hidden'), false, 'the modal is up on History detail');

      go(ctx.window, 'new');
      await settle(ctx.window, 8);
      assert.equal(modal.classList.contains('hidden'), true,
        'a view change must not leave a dialog for the previous run floating over the next view');
    } },
  ]);
});

// D24 covers a rebuild that is in flight; a rebuild that is merely PENDING behind the
// debounce is exactly as stale. Between the keystroke and the timer the link
// still carries the href built from the previous text, and mousedown on it fires that
// href — the precise failure the `input` binding was chosen to avoid.
test('a pending (debounced) rebuild makes the issue link, Copy JSON and Create inert until the fresh payload lands, which carries the typed text (D24)', async (t) => {
  // One boot: one keystroke, then the link, Copy JSON and Create are all tried inside the
  // debounce and Create again after it. What each step shows is recorded as it happens,
  // and the rows read the records.
  const copied = [];
  const ctx = await boot({ fetchHandler: arms(),
    clipboard: { writeText: async (t) => { copied.push(t); } } });
  await openHistoryReport(ctx);
  const link = ctx.window.document.getElementById('report-issue');
  const firstHref = link.getAttribute('href');

  const timers = useAppTimers(t);
  let pendingHasHref; let pending; let freshHref; let rebuiltWith;
  try {
    const box = ctx.window.document.getElementById('report-expectation');
    box.value = 'the reviewer looped forever';
    box.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));

    // SAME TICK as the keystroke — the debounce has not run, so the payload behind the
    // link is the one built without this text.
    pendingHasHref = link.hasAttribute('href');
    click(ctx.window, link);
    click(ctx.window, ctx.window.document.getElementById('report-copy'));
    stubTab(ctx.window);
    click(ctx.window, createBtn(ctx.window));
    await timers.settle(4);
    pending = { copied: copied.length, issuePosts: issuePosts(ctx).length };

    await timers.advance(REPORT_PREVIEW_DEBOUNCE_MS + 50);
    await timers.settle(8);
    freshHref = link.getAttribute('href');
    rebuiltWith = JSON.parse(reportPosts(ctx).at(-1).opts.body).expectation;
    click(ctx.window, createBtn(ctx.window));
    await timers.settle(8);
  } finally {
    t.mock.timers.reset();
  }
  await checkRows([
    { name: 'typing an expectation invalidates the issue link BEFORE the debounce fires (D24)', run: () => {
      assert.equal(firstHref, REPORT.issue.url, 'the first build landed');
      assert.equal(pendingHasHref, false,
        'a pending rebuild leaves the link inert, like an in-flight one');
      assert.equal(pending.copied, 0,
        'neither the link nor Copy JSON can ship a payload the preview is not showing');
      assert.equal(freshHref, REPORT.issue.url, 'the fresh payload revives it');
      assert.equal(rebuiltWith,
        'the reviewer looped forever', 'and the rebuild carried the typed text');
    } },
    { name: 'a pending rebuild makes the create button inert, like the link (D24)', run: () => {
      assert.equal(pending.issuePosts, 0,
        'a report cannot be filed from a payload the preview is not showing');
      assert.equal(JSON.parse(issuePosts(ctx)[0].opts.body).expectation, 'the reviewer looped forever',
        'once the rebuild lands, the filed report carries the typed text');
    } },
  ]);
});

test('typing rebuilds the preview once after 1 s of quiet, and a control change inside the wait rebuilds at once and supersedes the queued rebuild', async (t) => {
  // One boot: the first row's rebuild has landed before the second row types, and each
  // row counts the posts from its own start.
  const ctx = await boot({ fetchHandler: arms() });
  await openHistoryReport(ctx);
  await checkRows([
    { name: 'typing does not rebuild the preview until the reporter has been quiet for 1s', run: async () => {
      assert.equal(REPORT_PREVIEW_DEBOUNCE_MS, 1000, 'the delay the reporter asked for');
      const before = reportPosts(ctx).length;

      const timers = useAppTimers(t);
      try {
        const box = ctx.window.document.getElementById('report-expectation');
        box.value = 'the diff swallowed my change';
        box.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
        // A FRACTION of the window, not a few zero-delay macrotasks and not the full
        // constant. Settling on zero-delay ticks passes for any delay above ~0, and
        // waiting the whole constant would move in lockstep with whatever app.js does —
        // both let a hardcoded 250 back in unnoticed. A quarter of the way in is far
        // past a regression and far short of the real delay, so the assert polices the
        // WIRING (app.js must use REPORT_PREVIEW_DEBOUNCE_MS) rather than restating the
        // number. The `assert.equal` above still pins the value itself.
        await timers.advance(REPORT_PREVIEW_DEBOUNCE_MS / 4);
        await timers.settle(8);
        assert.equal(reportPosts(ctx).length, before,
          'a quarter of the window in, no rebuild yet');

        await timers.advance(REPORT_PREVIEW_DEBOUNCE_MS + 50);
        await timers.settle(8);
        assert.equal(reportPosts(ctx).length, before + 1, 'exactly one rebuild once typing stops');
        assert.equal(JSON.parse(reportPosts(ctx).at(-1).opts.body).expectation,
          'the diff swallowed my change', 'carrying the final text');
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'a control change inside the wait supersedes the queued rebuild instead of re-blanking', run: async () => {
      const before = reportPosts(ctx).length;
      const preview = ctx.window.document.getElementById('report-preview');

      const timers = useAppTimers(t);
      try {
        const box = ctx.window.document.getElementById('report-expectation');
        box.value = 'the diff swallowed my change';
        box.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));

        // Inside the 1s window: switching the reason rebuilds at once, as it always has.
        const reason = ctx.window.document.getElementById('report-reason');
        reason.value = reason.options[1].value;
        reason.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
        await timers.settle(8);
        assert.equal(reportPosts(ctx).length, before + 1, 'the control change rebuilt immediately');
        assert.equal(preview.textContent, previewText(REPORT.payload),
          'and the fresh JSON is on screen — not the building placeholder');

        // Past the point where the textarea's own timer would have fired.
        await timers.advance(REPORT_PREVIEW_DEBOUNCE_MS + 50);
        await timers.settle(8);
        assert.equal(reportPosts(ctx).length, before + 1,
          'the superseded rebuild never ran — the preview is not re-blanked after it');
        assert.equal(preview.textContent, previewText(REPORT.payload), 'and the JSON never left the screen');
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

test('Copy JSON, and opening the issue link, put the exact preview text on the clipboard first', async () => {
  const copied = [];
  const ctx = await boot({ fetchHandler: arms(),
    clipboard: { writeText: async (t) => { copied.push(t); } } });
  await openHistoryReport(ctx);
  await checkRows([
    { name: 'Copy JSON copies the exact preview text', run: async () => {
      click(ctx.window, ctx.window.document.getElementById('report-copy'));
      await settle(ctx.window, 4);
      assert.equal(copied.length, 1);
      assert.equal(copied[0], ctx.window.document.getElementById('report-preview').textContent,
        'clipboard === preview, byte for byte');
    } },
    { name: 'opening the issue link copies the JSON first, so the body is not lying', run: async () => {
      copied.length = 0;                          // the first row's copy is not this row's
      click(ctx.window, ctx.window.document.getElementById('report-issue'));
      await settle(ctx.window, 4);
      assert.equal(copied.length, 1, 'the JSON is on the clipboard before GitHub opens (D23)');
      assert.equal(copied[0], ctx.window.document.getElementById('report-preview').textContent);
    } },
  ]);
});

test('a failed build shows an inline error and leaves the modal usable', async () => {
  const ctx = await boot({ fetchHandler: arms({ report: { error: 'boom' }, reportStatus: 500 }) });
  await openHistoryReport(ctx);
  const err = ctx.window.document.querySelector('#report-modal .report-error');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /boom/, 'the server message is surfaced');
  assert.equal(ctx.window.document.getElementById('report-issue').hasAttribute('href'), false,
    'and the link stays inert');
});

// ── "Create GitHub issue" ─────────────────────────────────────────────────────
// The primary action files the issue through the server (`gh issue create`), so the
// full JSON report rides along instead of being pasted by hand. #report-issue — the
// prefilled browser link — survives as the fallback, revealed only when gh fails.

/** A stand-in for the tab the click opens; jsdom implements no real window.open. */
function stubTab(window) {
  const tab = { location: null, closed: false, close() { this.closed = true; } };
  window.open = () => tab;
  return tab;
}

const createBtn = (w) => w.document.getElementById('report-create-issue');

test('Create GitHub issue opens the tab synchronously in the click, files via the server (reason/include) and points the tab at the new issue; the browser never calls GitHub', async () => {
  // One boot with a gated /report-issue: the click runs once, the tab count is read the
  // moment the click handler returns, then the gate opens; the rows read what was recorded.
  let release;
  const gate = new Promise((r) => { release = r; });
  const base = arms();
  const ctx = await boot({ fetchHandler: (url, opts) => (url.endsWith('/report-issue')
    ? gate.then(() => jsonRes(200, FILED)) : base(url, opts)) });
  await openHistoryReport(ctx);
  const tab = stubTab(ctx.window);
  const openTab = ctx.window.open;
  let openedAt = 0;
  let calls = 0;
  ctx.window.open = (...args) => { openedAt = ++calls; return openTab(...args); };

  click(ctx.window, createBtn(ctx.window));
  const openedInClick = openedAt;
  release();
  await settle(ctx.window, 8);
  await checkRows([
    { name: 'the primary action files the issue and points the opened tab at it', run: () => {
      assert.equal(issuePosts(ctx).length, 1, 'exactly one create call');
      const sent = JSON.parse(issuePosts(ctx)[0].opts.body);
      assert.equal(sent.reason, 'poor-quality', 'the reason the select is showing');
      assert.deepEqual(sent.include, { paths: false, prompt: false });
      assert.equal(tab.location, FILED_URL, 'the tab opened by the click lands on the new issue');
      assert.equal(tab.closed, false);
      assert.equal(ctx.calls.some((c) => c.url.includes('github.com')), false,
        'the browser still never talks to GitHub — the server holds the gh login');
    } },
    { name: 'the tab is opened synchronously, before the request is awaited', run: () => {
      // A popup blocker only honours window.open inside the user gesture. Opening it
      // after `await fetch` loses the gesture and the new tab is silently eaten.
      assert.equal(openedInClick, 1, 'the tab exists the moment the click handler runs');
    } },
  ]);
});

test('a gh failure reveals the prefilled link and closes the empty tab', async () => {
  const ctx = await boot({ fetchHandler: arms({
    filed: { ok: false, kind: 'auth', error: 'gh auth login',
             issue: { url: REPORT.issue.url, truncated: false, filename: REPORT.issue.filename } },
  }) });
  await openHistoryReport(ctx);
  const link = ctx.window.document.getElementById('report-issue');
  assert.equal(link.hidden, true, 'the fallback link is out of the way while gh is presumed to work');

  const tab = stubTab(ctx.window);
  click(ctx.window, createBtn(ctx.window));
  await settle(ctx.window, 8);

  const err = ctx.window.document.querySelector('#report-modal .report-error');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /gh auth login/, 'the reporter is told how to fix it');
  assert.equal(tab.closed, true, 'no orphan blank tab is left behind');
  assert.equal(link.hidden, false, 'and the browser path is offered instead');
  assert.equal(link.getAttribute('href'), REPORT.issue.url);
});

test('a 500 from the create route is surfaced without losing the modal', async () => {
  const ctx = await boot({ fetchHandler: arms({ filed: { error: 'boom' }, filedStatus: 500 }) });
  await openHistoryReport(ctx);
  const tab = stubTab(ctx.window);
  click(ctx.window, createBtn(ctx.window));
  await settle(ctx.window, 8);

  const err = ctx.window.document.querySelector('#report-modal .report-error');
  assert.match(err.textContent, /boom/);
  assert.equal(tab.closed, true);
  assert.equal(createBtn(ctx.window).disabled, false, 'the button is usable again');
  assert.equal(ctx.window.document.getElementById('report-modal').classList.contains('hidden'), false);
});

test('a blocked popup still hands the reporter the created issue', async () => {
  const ctx = await boot({ fetchHandler: arms() });
  await openHistoryReport(ctx);
  ctx.window.open = () => null;   // what a popup blocker returns

  click(ctx.window, createBtn(ctx.window));
  await settle(ctx.window, 8);

  const filed = ctx.window.document.getElementById('report-filed');
  assert.equal(filed.hidden, false, 'the created issue is surfaced in the modal');
  const a = filed.querySelector('a');
  assert.equal(a.getAttribute('href'), FILED_URL, 'as a link the reporter can click');
});

test('Report this run: Cancel sits before Create GitHub issue; a backdrop click never closes it; a written expectation makes Escape ask', async () => {
  const ctx = await boot({ fetchHandler: arms() });
  await openHistoryReport(ctx);
  const doc = ctx.window.document;
  const modal = doc.getElementById('report-modal');
  assert.deepEqual([...doc.querySelectorAll('.report-head-actions button')].map((b) => b.textContent), ['Cancel', 'Create GitHub issue']);
  assert.ok(doc.querySelector('#report-modal .card.dlg > .report-top.dlg-head'), 'the pinned head of the shared dialog anatomy');
  backdropClick(ctx.window, modal);
  assert.equal(modal.classList.contains('hidden'), false, 'never on a backdrop click');
  const ta = doc.getElementById('report-expectation');
  ta.value = 'it should have stopped';
  ta.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  pressEscape(ctx.window);
  assert.ok(discardPrompt(doc), 'asks first');
  discardChanges(doc);
  await settle(ctx.window, 2);
  assert.equal(modal.classList.contains('hidden'), true);
});

test('Report this run: while the issue is filing, Cancel and Escape wait; once filed the way out says Close and Escape asks nothing, even over a written expectation', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const base = arms();
  const ctx = await boot({ fetchHandler: (url, opts) => (url.endsWith('/report-issue') ? gate.then(() => jsonRes(200, FILED)) : base(url, opts)) });
  await openHistoryReport(ctx);
  const doc = ctx.window.document;
  const modal = doc.getElementById('report-modal');
  stubTab(ctx.window);
  // Written before Create: a change until it is filed, then part of the issue — nothing left to lose.
  const timers = useAppTimers(t);
  try {
    const ta = doc.getElementById('report-expectation');
    ta.value = 'it should have stopped';
    ta.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
    await timers.advance(REPORT_PREVIEW_DEBOUNCE_MS + 50);   // the preview rebuilds with it: Create is ready again
    await timers.settle(8);
  } finally {
    t.mock.timers.reset();
  }
  click(ctx.window, createBtn(ctx.window));
  assert.equal(doc.getElementById('report-close').disabled, true, 'Cancel waits while filing');
  pressEscape(ctx.window);
  assert.equal(modal.classList.contains('hidden'), false, 'so does Escape');
  release();
  await settle(ctx.window, 6);
  assert.equal(doc.getElementById('report-close').disabled, false);
  assert.equal(doc.getElementById('report-close').textContent, 'Close');
  pressEscape(ctx.window);
  assert.equal(discardPrompt(doc), null, 'filed: nothing left to lose');
  assert.equal(modal.classList.contains('hidden'), true);
});
