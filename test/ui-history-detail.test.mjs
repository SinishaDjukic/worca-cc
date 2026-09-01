// test/ui-history-detail.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';
import { MAX_FILE_SECTION_CODE_UNITS } from '../ui/public/diff-view.mjs';
import { MAX_HIGHLIGHT_INPUT_BYTES } from '../ui/public/syntax-highlight.mjs';

// app.js connects at most this many source rows per step (HD_DIFF_WINDOW_LINES);
// app.js exports nothing, so the tests pin the number here.
const WINDOW = 5000;

// Behavior tests for the History DETAIL header: the meta line, the branch-copy
// row, Resume, Archive (honest copy through confirmModal), and the retained-work
// + cost-paused banners — including the deep-link path, where the screen starts
// from the minimal `{id, projectKey}` stub `histRecordFor` mints and is corrected
// once the authoritative list row arrives.
//
// boot()/settle()/go() are a deliberate local copy of
// test/ui-history-routing.test.mjs:25-96 — the suites do not import each other.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

// jsdom windows are heavy (full DOM + timers); this file boots ~79 of them. Left
// alive they accumulate and OOM the worker on a memory-constrained host (the
// Windows CI VM crossed Node's ~2GB heap even though every test passed). Close
// each after its test so the window and its timers are released.
const _openDoms = [];
afterEach(() => { for (const d of _openDoms.splice(0)) { try { d.window.close(); } catch { /* already closed */ } } });

async function boot({ fetchHandler, url = 'http://localhost:4317/', hljsLoader = null } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  _openDoms.push(dom);
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
  if (hljsLoader) window.__worcaTestHooks = { hljsLoader };

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
const ROW = {
  id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj',
  title: 'Implement Log-UX Review Fixes', status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: 'worca-cc/log-ux-fcec04e8',
  sourceBranch: 'feat/log-ux', survived: true, added: 12, removed: 3,
  totalCostUsd: 153.21, totalActiveMs: 6000000, mtime: 1,
  pauseReason: null, retainedWork: null,
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

const PAUSED_DETAIL = { ...DETAIL, state: { ...DETAIL.state, status: 'paused' } };
const COMMIT_FAILED_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    branch: {
      ...DETAIL.state.branch,
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'boom', at: '2026-08-17T21:00:00Z' },
    },
  },
};
const RESULTS = {
  summary: {
    filesNew: 1, filesChanged: 13, filesDeleted: 0,
    linesAdded: 412, linesRemoved: 188, blockingIssues: 0, nitpicks: 0,
  },
  newFiles: [], changedFiles: [], keyThingsToCheck: [], nitpicks: [],
};

// Fresh object per test: setupDiscardWorktreeButton MUTATES the row it is handed
// (`p.retainedWork = null`), so a shared const would leak across cases.
const retainedRow = (over = {}) => ({
  ...ROW,
  retainedWork: {
    reason: 'commit_failed',
    members: [{
      projectKey: KEY, branch: ROW.branch, worktreeDir: '/tmp/wt',
      step: 'commit', message: 'pre-commit hook failed', at: '2026-08-17T21:00:00Z',
    }],
  },
  ...over,
});

const DAY = 86400000;
// resetPeriod stays 'monthly' for the same reason ui-cost-paused.test.mjs:20 does.
const okBudget = () => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
});
const blockedBudget = () => ({ ...okBudget(), windowSpendUsd: 50, remainingUsd: 0, blocked: true });

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

const DETAIL_URL = `/api/history/${KEY}/${ROW.id}`;
const detailHash = `history/${KEY}/${ROW.id}`;

// ARM ORDER IS LOAD-BEARING (ui-history-routing.test.mjs:119-127): the detail URL
// is a PREFIX of the /log and /diff URLs, and `/api/history` is a prefix of the
// POST /api/history/pr enrichment call. Most-specific first, and every history arm
// matches with endsWith, never includes.
function historyArms(box) {
  return (url) => {
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (url.endsWith('/log')) return fail(404, { error: 'no log' });
    if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: false });
    if (url.endsWith(DETAIL_URL)) return ok(box.detail);
    if (url.endsWith('/api/budget')) return ok(box.budget);
    return null;
  };
}

// `box` is mutable so a test can withhold the list row at boot (the deep-link
// case) and deliver it later through a `pipelines-changed` broadcast.
async function bootDetail({
  rows = [ROW], detail = DETAIL, budget = okBudget(), arms = null,
  deepLink = false, hljsLoader = null,
} = {}) {
  const box = { rows, detail, budget };
  const base = historyArms(box);
  const ctx = await boot({
    fetchHandler: (url, opts) => (arms && arms(url, opts, box)) || base(url, opts),
    url: deepLink ? `http://localhost:4317/#${detailHash}` : 'http://localhost:4317/',
    hljsLoader,
  });
  ctx.box = box;
  return ctx;
}

async function openDetail(ctx) {
  go(ctx.window, detailHash);
  await settle(ctx.window);
}

// The authoritative list row lands (or changes) while the detail screen is open:
// `pipelines-changed` -> loadHistoryView({force:true}) -> paintHistory().
async function deliverRows(ctx, rows) {
  ctx.box.rows = rows;
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pipelines-changed' }) });
  await settle(ctx.window, 6);
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// ---------------------------------------------------------------------------
// Header meta
// ---------------------------------------------------------------------------

test('header meta renders status word · day · clock · duration · cost · +A −R', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, results: RESULTS } });
  await openDetail(ctx);
  const meta = ctx.window.document.querySelector('#hist-detail .hd-meta');
  assert.ok(meta, 'the detail header carries a meta line');
  assert.match(meta.textContent, /Done/);
  assert.match(meta.textContent, /\+412/);
  assert.match(meta.textContent, /−188/);            // U+2212, never an ASCII hyphen
  assert.match(meta.textContent, /\$153\.21/);
  assert.match(meta.textContent, /1h 40m/);
  // fmtDate is toLocaleString() — locale- AND timezone-dependent. Assert PRESENCE
  // and segment structure only, never a literal day/clock string.
  assert.ok(meta.querySelector('.hd-day').textContent.length > 0, 'the day segment paints');
  assert.doesNotMatch(meta.textContent, /Invalid Date/);
  const word = meta.querySelector('.hd-status-word');
  assert.equal(word.textContent, 'Done');
  assert.ok(word.classList.contains('st-done'), 'the status word wears its family class');
  // Persisted results win over the list row's live counts.
  assert.equal(meta.querySelector('.diff-add').textContent, '+412');
});

test('meta falls back to the live list counts when results are null', async () => {
  const ctx = await bootDetail();                     // DETAIL.results === null
  await openDetail(ctx);
  const counts = ctx.window.document.querySelector('#hist-detail .hd-diffcounts');
  assert.ok(counts, 'the counts segment falls back to the row');
  assert.equal(counts.querySelector('.diff-add').textContent, '+12');
  assert.equal(counts.querySelector('.diff-del').textContent, '−3');   // U+2212
});

test('meta omits day/clock when nothing carries a timestamp (deep link)', async () => {
  // The row never lands, so the record stays the minimal {id, projectKey} stub and
  // the payload has no startedAt either — the painter must skip both segments
  // rather than render "Invalid Date".
  const ctx = await bootDetail({
    rows: [],
    detail: { ...DETAIL, state: { ...DETAIL.state, startedAt: null } },
  });
  await openDetail(ctx);
  const meta = ctx.window.document.querySelector('#hist-detail .hd-meta');
  assert.equal(meta.querySelector('.hd-day'), null);
  assert.equal(meta.querySelector('.hd-clock'), null);
  assert.doesNotMatch(meta.textContent, /Invalid Date/);
  assert.match(meta.textContent, /Done/, 'the status word still paints');
});

test('branch row copies the feature branch and flags .copied', async () => {
  const ctx = await bootDetail();
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;
  // Stub the clipboard AFTER boot, on the RETURNED window — the boot helper builds
  // the JSDOM itself, and copyBranchToClipboard reads navigator.clipboard at CLICK
  // time. Precedent: test/ui-history-pr.test.mjs:95-98.
  const writes = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async (t) => { writes.push(t); } },
    configurable: true,
  });

  const btn = doc.querySelector('#hist-detail .hd-branch-copy');
  assert.equal(btn.hidden, false, 'the copy button is revealed for a run with a branch');
  assert.equal(doc.querySelector('#hist-detail .hd-branch-name').textContent, ROW.branch);
  const base = doc.querySelector('#hist-detail .hd-base');
  assert.equal(base.hidden, false);
  assert.match(base.textContent, /^feat\/log-ux/);

  click(window, btn);
  // Required, not cosmetic: copyBranchToClipboard awaits writeText and toggles
  // `.copied` a microtask later.
  await settle(window);
  assert.deepEqual(writes, [ROW.branch]);
  assert.ok(btn.classList.contains('copied'), 'the CSS-only "Copied" caption keys off this class');
});

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

test('Resume renders for paused AND interrupted, hidden for done/stopped/error', async () => {
  for (const [status, shown] of [
    ['paused', true], ['interrupted', true], ['done', false], ['stopped', false], ['error', false],
  ]) {
    const ctx = await bootDetail({
      rows: [{ ...ROW, status }],
      detail: { ...DETAIL, state: { ...DETAIL.state, status } },
    });
    await openDetail(ctx);
    assert.equal(
      ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, !shown,
      `status "${status}" -> Resume ${shown ? 'visible' : 'hidden'}`,
    );
  }
});

test('Resume POSTs exactly { pipelineId } and lands on running/<newRunId>', async () => {
  const posts = [];
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'paused' }],
    detail: PAUSED_DETAIL,
    arms: (url, opts) => {
      if (url === '/api/resume') {
        posts.push(JSON.parse(opts.body));
        return ok({ ok: true, runId: 'r-9', pipelineId: ROW.id });
      }
      return null;
    },
  });
  await openDetail(ctx);
  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-resume'));
  await settle(ctx.window, 5);
  // The body assertion test/ui-pause-resume.test.mjs:70 owns for the list card.
  assert.deepEqual(posts, [{ pipelineId: ROW.id }]);
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'running/r-9');
});

test('a DEEP-LINKED Resume acts on the authoritative row, not the minimal stub', async () => {
  // setupHdActions binds Resume ONCE and refreshHdFromRow deliberately never
  // re-runs it, so a handler closing over the load-time `record` would keep the
  // deep link's {id, projectKey} stub forever — upsertRun would then land a running
  // card titled with the raw run id and projectDir ''.
  const ctx = await bootDetail({
    rows: [],                                   // the list is withheld at boot
    detail: PAUSED_DETAIL,
    deepLink: true,
    arms: (url) => (url === '/api/resume' ? ok({ ok: true, runId: 'r-9', pipelineId: ROW.id }) : null),
  });
  await settle(ctx.window, 5);
  await deliverRows(ctx, [{ ...ROW, status: 'paused' }]);

  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-resume'));
  await settle(ctx.window, 6);
  const r = ctx.window.__np.getRun('r-9');
  assert.ok(r, 'the resumed run was upserted');
  assert.equal(r.title, ROW.title, 'titled from the authoritative row, not the raw run id');
  assert.equal(r.projectDir, ROW.projectDir, "projectDir from the row, not ''");
});

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

test('Archive: honest copy + danger styling, DELETE, back to the list, row dropped', async () => {
  const deletes = [];
  const ctx = await bootDetail({
    arms: (url, opts, box) => {
      if (url.startsWith(`/api/runs/${ROW.id}`) && opts.method === 'DELETE') {
        deletes.push(url);
        box.rows = [];        // stateful: a later forced reload must not resurrect it
        return ok({ ok: true });
      }
      return null;
    },
  });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;
  const archive = doc.querySelector('#hist-detail .hd-archive');
  assert.equal(archive.hidden, false, 'a finished run is archivable');

  click(window, archive);
  await settle(window);
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false);
  const msg = doc.querySelector('#confirm-message').textContent;
  assert.match(msg, /local branch/, 'the copy is honest about the local branch');
  assert.match(msg, /remote branch/, 'and about the remote branch surviving');
  assert.ok(doc.querySelector('#confirm-ok').classList.contains('danger'), 'destructive styling while open');

  doc.querySelector('#confirm-cancel').click();
  await settle(window);
  assert.equal(doc.querySelector('#confirm-ok').classList.contains('danger'), false,
    'the tint must never leak to the next confirmModal caller');
  assert.equal(deletes.length, 0, 'cancelling archives nothing');

  click(window, archive);
  await settle(window);
  doc.querySelector('#confirm-ok').click();
  await settle(window, 5);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0], `/api/runs/${ROW.id}?projectKey=${KEY}`);
  assert.equal(window.location.hash.replace(/^#/, ''), 'history');
  assert.equal(doc.querySelector('#history .hist-card'), null, 'the row is dropped from the list');
});

test('Archive is hidden while the run is still live (running/pausing)', async () => {
  // isDeletableEntry's negative direction. The server 409s a live DELETE
  // (ui/server.mjs:1594), but a row left `running` in the DB by a restart has no
  // live process behind it — the button is the only thing standing between the
  // user and an archive of a run that is still mid-flight.
  for (const [status, shown] of [
    ['running', false], ['pausing', false], ['starting', false], ['created', false],
    ['done', true], ['stopped', true], ['error', true],
  ]) {
    const ctx = await bootDetail({
      rows: [{ ...ROW, status }],
      detail: { ...DETAIL, state: { ...DETAIL.state, status } },
    });
    await openDetail(ctx);
    assert.equal(
      ctx.window.document.querySelector('#hist-detail .hd-archive').hidden, !shown,
      `status "${status}" -> Archive ${shown ? 'visible' : 'hidden'}`,
    );
  }
});

test('an in-flight Archive survives a concurrent repaint (never a second DELETE)', async () => {
  // The DELETE removes a worktree and a branch — seconds, not milliseconds. Any
  // repaint inside that window (a `pipelines-changed` broadcast for ANOTHER
  // pipeline) reaches hdSetArchiveGate, which must not re-enable a button that
  // still reads "Archiving…": the click guard would then pass and fire a second
  // DELETE, whose 404 stamps `.hd-error` for an archive that in fact succeeded.
  // The mirror of refreshHistResumeGating's `resumeState === 'busy'` guard.
  const deletes = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = await bootDetail({
    arms: (url, opts, box) => {
      if (url.startsWith(`/api/runs/${ROW.id}`) && opts.method === 'DELETE') {
        deletes.push(url);
        return gate.then(() => { box.rows = []; return { ok: true, status: 200, json: async () => ({ ok: true }) }; });
      }
      return null;
    },
  });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;
  const archive = doc.querySelector('#hist-detail .hd-archive');

  click(window, archive);
  await settle(window);
  doc.querySelector('#confirm-ok').click();
  await settle(window, 3);
  assert.equal(deletes.length, 1, 'the DELETE is in flight');
  assert.equal(archive.disabled, true);
  assert.match(archive.textContent, /Archiving…/);

  await deliverRows(ctx, [ROW]);                     // an unrelated broadcast repaints
  assert.equal(archive.disabled, true, 'the repaint must not re-enable it mid-DELETE');
  assert.match(archive.textContent, /Archiving…/, 'and the label still says so');

  click(window, archive);
  await settle(window);
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), true,
    'a second click is swallowed by the disabled guard — no second confirm');

  release();
  await settle(window, 6);
  assert.equal(deletes.length, 1, 'exactly one DELETE for one archive');
  assert.equal(doc.querySelector('#hist-detail .hd-error').hidden, true, 'and no error stamped');
});

test('a DEEP-LINKED Archive names the run in the confirm copy', async () => {
  const ctx = await bootDetail({ rows: [], deepLink: true });
  await settle(ctx.window, 5);
  await deliverRows(ctx, [ROW]);

  click(ctx.window, ctx.window.document.querySelector('#hist-detail .hd-archive'));
  await settle(ctx.window);
  assert.match(
    ctx.window.document.querySelector('#confirm-message').textContent,
    new RegExp(`^${ROW.title}`),
    'the run title leads the copy — not the raw id from the stub',
  );
});

// ---------------------------------------------------------------------------
// Retained work
// ---------------------------------------------------------------------------

test('Archive is disabled with a tooltip when the list row reports retained work', async () => {
  const ctx = await bootDetail({ rows: [retainedRow()] });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const archive = doc.querySelector('#hist-detail .hd-archive');
  assert.equal(archive.disabled, true);
  assert.match(archive.title, /Recover or discard/);
  const banner = doc.querySelector('#hist-detail .retained-banner');
  assert.equal(banner.hidden, false);
  // The banner's CONTENT, not just its visibility: this block is the only
  // recovery instruction the user ever gets for work that never reached the
  // branch, so a painter that renders an empty banner must fail here.
  assert.match(banner.textContent, /uncommitted work retained/i);
  assert.match(banner.textContent, /pre-commit hook failed/, "git's own stderr, verbatim");
  assert.match(banner.textContent, /Worktree: \/tmp\/wt/);
  assert.match(banner.textContent, /git -C '\/tmp\/wt' add -A/, 'the copy-paste recovery block');
  assert.equal(doc.querySelector('#hist-detail .hist-retained-badge').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hist-discard').hidden, false,
    'an AUTHORITATIVE retention also offers the action');
});

test('discarding the retained worktree clears the banner and re-enables Archive', async () => {
  const ctx = await bootDetail({
    rows: [retainedRow()],
    arms: (url) => (url.includes('/discard-worktree')
      ? ok({ ok: true, remaining: 0, patches: ['/tmp/p.patch'] })
      : null),
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
  await confirmDialog(ctx.window);
  await settle(ctx.window, 5);

  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hist-discard').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
  // The mutation must land on the ROW that lives in state.historyAll, not on a
  // copy: the same paintHistory() rebuilds the list card from that array.
  assert.equal(doc.querySelector('#history .hist-card .hist-retained-badge').hidden, true,
    'the discard mutated the row, not a throwaway copy');
});

test('deep-linked discard still clears the banner after the real row lands', async () => {
  const ctx = await bootDetail({
    rows: [], detail: COMMIT_FAILED_DETAIL, deepLink: true,
    arms: (url) => (url.includes('/discard-worktree')
      ? ok({ ok: true, remaining: 0, patches: ['/tmp/p.patch'] })
      : null),
  });
  await settle(ctx.window, 5);
  const doc = ctx.window.document;

  // (1) PROVISIONAL retention: banner up and Archive blocked, but NO action —
  // discarding must act on the authoritative row, not on an inferred retention.
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, true);
  assert.equal(doc.querySelector('#hist-detail .hist-discard').hidden, true,
    'a provisional retention binds no Discard');

  // (2) the row agrees: the worktree really is still there
  await deliverRows(ctx, [retainedRow()]);
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hist-discard').hidden, false,
    'the action arrives with the authoritative row');

  // (3) discard acts on THAT row, so the repaint really clears
  click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
  await confirmDialog(ctx.window);
  await settle(ctx.window, 6);
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
  assert.equal(doc.querySelector('#history .hist-card .hist-retained-badge').hidden, true,
    'the bound handler mutated the ROW, not the orphaned deep-link stub');
});

test('deep link derives retained work from state.branch.commitFailed, then DEFERS to the row', async () => {
  const ctx = await bootDetail({ rows: [], detail: COMMIT_FAILED_DETAIL, deepLink: true });
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, true);

  // The server gates retainedWork on existsSync(worktreeDir), so a stale
  // commitFailed stamp must not outlive the row. Authoritative in BOTH directions.
  await deliverRows(ctx, [{ ...ROW, retainedWork: null }]);
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, true);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, false);
});

// ---------------------------------------------------------------------------
// Cost-pause banner + resume gating
// ---------------------------------------------------------------------------

test('cost-paused run shows the banner; Continue-without-cap resumes with ignoreCostCap', async () => {
  const posts = [];
  const ctx = await bootDetail({
    // 'cost_pipeline' and 'cost_total' are the only two reasons the product emits.
    rows: [{ ...ROW, status: 'paused', pauseReason: 'cost_pipeline' }],
    detail: PAUSED_DETAIL,
    arms: (url, opts) => {
      if (url === '/api/resume') {
        posts.push(JSON.parse(opts.body));
        return ok({ ok: true, runId: 'r-9', pipelineId: ROW.id });
      }
      return null;
    },
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd').dataset.pauseReason, 'cost_pipeline');
  const banner = doc.querySelector('#hist-detail .hd-banners .cost-banner');
  assert.ok(banner, 'the cost-pause banner renders on the detail screen');
  assert.ok(banner.classList.contains('cb-pipeline'));

  click(ctx.window, banner.querySelector('.cb-override'));
  await settle(ctx.window);
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false,
    'the override asks for confirmation first');
  doc.querySelector('#confirm-ok').click();
  await settle(ctx.window, 6);
  assert.deepEqual(posts, [{ pipelineId: ROW.id, ignoreCostCap: true }]);
});

test('a deep-linked cost-paused run gains its banner exactly once when the row arrives', async () => {
  const ctx = await bootDetail({ rows: [], detail: PAUSED_DETAIL, deepLink: true });
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-banners .cost-banner'), null,
    'the stub carries no pauseReason (it lives on LIST rows only)');

  await deliverRows(ctx, [{ ...ROW, status: 'paused', pauseReason: 'cost_total' }]);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-banners .cost-banner').length, 1);

  // An idempotent repaint must not stack a second banner.
  await deliverRows(ctx, [{ ...ROW, status: 'paused', pauseReason: 'cost_total' }]);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-banners .cost-banner').length, 1);
});

test('a failed resume keeps its title across a repaint; a later budget block still disables it', async () => {
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'paused', pauseReason: 'cost_total' }],
    detail: PAUSED_DETAIL,
    arms: (url) => (url === '/api/resume' ? fail(500, { error: 'worktree is gone' }) : null),
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  const btn = doc.querySelector('#hist-detail .hd-resume');
  assert.equal(btn.hidden, false);
  assert.equal(btn.disabled, false, 'an unblocked budget leaves a cost_total pause resumable');

  click(ctx.window, btn);
  await settle(ctx.window, 5);
  assert.match(btn.title, /Could not resume/, "D3: the server's 400/500 surfaces on the button");
  assert.equal(btn.disabled, false, 'the user may retry');

  // A repaint (pipelines-changed -> loadHistoryView(force) -> paintHistory ->
  // refreshHdFromRow -> refreshHistResumeGating) must not wipe that title.
  await deliverRows(ctx, [{ ...ROW, status: 'paused', pauseReason: 'cost_total' }]);
  assert.match(btn.title, /Could not resume/, 'the failure survives the repaint');

  // ...but a failed resume does NOT opt out of budget gating for the life of the screen.
  ctx.box.budget = blockedBudget();
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'budget-changed', action: null }) });
  await settle(ctx.window, 6);
  assert.equal(btn.disabled, true, 'a later total-budget block still wins');
  assert.match(btn.title, /Total budget reached/);
});

// ---------------------------------------------------------------------------
// Section tabs
// ---------------------------------------------------------------------------

// Everything the pill row can key off, at once: persisted results (Diff badge),
// two sub-agents (Agents badge), one clarify question (Clarify badge) — and, easy
// to miss, a 'live-log' artifact. The shared DETAIL fixture ships `artifacts: []`
// and the Logs tab's `visible` predicate requires a 'live-log' entry, so without
// it only FOUR tabs render and the count assertion below is simply wrong.
const TABS_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    subAgents: [
      { id: 's1', label: 'explore', nodeId: 'implement', stepKey: 'implement', status: 'done', skills: [] },
      { id: 's2', label: 'verify', nodeId: 'implement', stepKey: 'implement', status: 'done', skills: [] },
    ],
  },
  results: RESULTS,
  clarify: {
    questions: [{ id: 'q1', question: 'Which store?', options: ['a', 'b'], allowFreeText: true }],
    answers: [],
  },
  artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }],
};

const tabsOf = (doc) => [...doc.querySelectorAll('#hist-detail .hd-tab')];
const secOf = (doc, key) => doc.querySelector(`#hist-detail .hd-sec[data-sec="${key}"]`);
const badgeOf = (doc, key) => {
  const b = doc.querySelector(`#hist-detail .hd-tab[data-sec="${key}"] .hd-tab-badge`);
  return b ? b.textContent : null;
};

test('tabs render with badges; default = Diff when results exist, else Overview', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(ctx);
  const doc = ctx.window.document;

  assert.deepEqual(
    tabsOf(doc).map((b) => b.dataset.sec),
    ['diff', 'overview', 'agents', 'clarify', 'logs'],
  );
  // filesNew(1) + filesChanged(13). NEVER + filesDeleted: results.mjs:32 buckets
  // 'D' rows into changedFiles (NEW_STATUS is {A,C}) while :29 ALSO counts them in
  // filesDeleted, so adding it double-counts every deletion against the file list.
  assert.equal(badgeOf(doc, 'diff'), '14');
  assert.equal(badgeOf(doc, 'agents'), '2');
  assert.equal(badgeOf(doc, 'clarify'), '1');
  assert.equal(badgeOf(doc, 'overview'), null, 'Overview carries no count');
  assert.equal(badgeOf(doc, 'logs'), null, 'Logs carries no count');

  assert.ok(doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]').classList.contains('active'),
    'persisted results make Diff the default tab');
  assert.equal(secOf(doc, 'diff').hidden, false);
  assert.equal(secOf(doc, 'overview').hidden, true);

  // ...and with nothing to show: DETAIL is results-null, clarify-empty, artifact-free.
  const bare = await bootDetail();
  await openDetail(bare);
  const bareDoc = bare.window.document;
  assert.deepEqual(tabsOf(bareDoc).map((b) => b.dataset.sec), ['diff', 'overview', 'agents']);
  assert.equal(secOf(bareDoc, 'clarify'), null, 'no Q&A -> no Clarify section either');
  assert.equal(secOf(bareDoc, 'logs'), null, 'no live-log artifact -> no Logs section either');
  assert.ok(bareDoc.querySelector('#hist-detail .hd-tab[data-sec="overview"]').classList.contains('active'));
  assert.equal(secOf(bareDoc, 'overview').hidden, false);
  assert.equal(badgeOf(bareDoc, 'agents'), null, 'an empty sub-agent list carries no badge');
});

test('clicking a tab switches the visible section and lazy-builds exactly once', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;

  click(window, doc.querySelector('#hist-detail .hd-tab[data-sec="agents"]'));
  const agents = secOf(doc, 'agents');
  assert.equal(agents.hidden, false);
  assert.equal(agents.dataset.loaded, '1', 'first activation builds the body');
  for (const k of ['diff', 'overview', 'clarify', 'logs']) {
    assert.equal(secOf(doc, k).hidden, true, `${k} is hidden while Agents is active`);
  }
  // initHdTabs ends with activate(default), which stamps DIFF before any click —
  // so exactly TWO sections are built at this point, never one.
  assert.equal(doc.querySelectorAll('#hist-detail .hd-sec[data-loaded="1"]').length, 2);
  assert.equal(secOf(doc, 'clarify').dataset.loaded, undefined, 'an unvisited tab is never built');
  assert.equal(secOf(doc, 'logs').dataset.loaded, undefined);

  // Revisiting never rebuilds: the SAME node object comes back, still stamped once.
  click(window, doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]'));
  assert.equal(agents.hidden, true);
  click(window, doc.querySelector('#hist-detail .hd-tab[data-sec="agents"]'));
  assert.equal(secOf(doc, 'agents'), agents, 'the section node is reused, never re-created');
  assert.equal(agents.dataset.loaded, '1');
  assert.equal(doc.querySelectorAll('#hist-detail .hd-sec[data-loaded="1"]').length, 2,
    'a second visit builds nothing new');
});

test('tabs are wired for a11y', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(ctx);
  const doc = ctx.window.document;

  assert.equal(doc.querySelector('#hist-detail .hd-tabs').getAttribute('role'), 'tablist');
  const tabs = tabsOf(doc);
  assert.equal(tabs.length, 5);
  for (const btn of tabs) {
    const key = btn.dataset.sec;
    const sec = secOf(doc, key);
    assert.ok(btn.id, `${key} tab carries an id for aria-labelledby`);
    assert.equal(btn.getAttribute('role'), 'tab');
    assert.equal(btn.getAttribute('aria-selected'), key === 'diff' ? 'true' : 'false');
    assert.equal(btn.getAttribute('aria-controls'), sec.id);
    assert.equal(sec.getAttribute('role'), 'tabpanel');
    assert.equal(sec.getAttribute('aria-labelledby'), btn.id);
    // Two panels scroll internally (.hd-diff-rows, .hd-sec-logs .log) and neither
    // is reliably reachable by keyboard otherwise. Roving tabindex + Arrow-key
    // navigation on the tablist is a recorded, accepted divergence — no other
    // tablist in this app implements it, so doing it here alone would be an
    // inconsistent partial.
    assert.equal(sec.tabIndex, 0);
  }

  // aria-selected TRACKS the active tab; it is not painted once at build time.
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="logs"]'));
  assert.equal(doc.querySelector('#hist-detail .hd-tab[data-sec="logs"]').getAttribute('aria-selected'), 'true');
  assert.equal(doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]').getAttribute('aria-selected'), 'false');
});

// ---------------------------------------------------------------------------
// Diff tab — file list + patch viewer
// ---------------------------------------------------------------------------

const PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,2 +1,2 @@
 keep
-old
+new
`;

const diffResults = (over = {}) => ({
  summary: {
    filesNew: 0, filesChanged: 1, filesDeleted: 0,
    linesAdded: 1, linesRemoved: 1, blockingIssues: 0, nitpicks: 0,
    ...(over.summary || {}),
  },
  newFiles: [],
  changedFiles: [{ path: 'src/a.js', status: 'M', added: 1, removed: 1 }],
  keyThingsToCheck: [], nitpicks: [],
  ...(over.results || {}),
});

const diffDetail = (results) => ({ ...DETAIL, results });

// `arms` runs BEFORE the shared historyArms base (bootDetail:186), so returning
// null here falls through to the base's own 404 /diff arm. Only the /diff URL is
// intercepted; everything else keeps the base behavior.
const patchArm = (body) => (url) => (
  url.endsWith('/diff') ? Promise.resolve({ ok: true, status: 200, text: async () => body }) : null
);

const filesOf = (doc) => [...doc.querySelectorAll('#hist-detail .hd-diff-file')];
const fileOf = (doc, path, project = '') => filesOf(doc).find((button) => (
  button.dataset.path === path && button.dataset.project === project
));
const paneOf = (doc) => doc.querySelector('#hist-detail .hd-diff-pane');

test("Diff tab lists files and renders the selected file's hunks", async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  // buildHdDiff auto-selects row 1 through a fire-and-forget async select(), so the
  // pane is still empty on the tick the tab is built.
  await settle(ctx.window);
  const doc = ctx.window.document;

  const rows = filesOf(doc);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.hd-diff-path').textContent, 'a.js');
  assert.equal(rows[0].dataset.path, 'src/a.js');

  const pane = paneOf(doc);
  assert.match(pane.textContent, /@@ -1,2 \+1,2 @@/);
  // ASCII +/- in the patch BODY on purpose: these lines are a verbatim unified
  // diff a user may copy, and a U+2212 yields a patch `git apply` rejects.
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+new');
  assert.equal(pane.querySelector('.hd-dl-del .hd-dl-code').textContent, '-old');
  assert.equal(pane.querySelector('.hd-dl-hunk').textContent, '@@ -1,2 +1,2 @@');

  // The patch is fetched from the /diff twin of historyLogUrl, exactly once.
  const diffCalls = ctx.calls.filter((c) => c.url.endsWith('/diff'));
  assert.equal(diffCalls.length, 1);
  assert.equal(diffCalls[0].url, `/api/history/${KEY}/${ROW.id}/diff`);
});

test('the file-list head shows the file count and aggregate counts with U+2212', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const head = ctx.window.document.querySelector('#hist-detail .hd-diff-list-head');
  assert.ok(head, 'the file list carries a head');
  assert.match(head.textContent, /1 file changed/);
  assert.match(head.textContent, /\+1/);
  assert.match(head.textContent, /−1/);            // U+2212 in COUNT displays
  assert.doesNotMatch(head.textContent, /-1/);     // never an ASCII hyphen here
});

test('a deleted file counted in filesChanged is not double-counted in the head', async () => {
  // 'D' rows live in changedFiles (NEW_STATUS is {A,C}) AND count in filesDeleted,
  // so file count = filesNew + filesChanged — never + filesDeleted.
  const results = diffResults({
    summary: { filesChanged: 2, filesDeleted: 1, linesAdded: 1, linesRemoved: 5 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'src/gone.js', status: 'D', added: 0, removed: 4 },
      ],
    },
  });
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;

  const head = doc.querySelector('#hist-detail .hd-diff-list-head');
  assert.match(head.textContent, /2 files changed/);
  assert.doesNotMatch(head.textContent, /3 files changed/);
  assert.equal(filesOf(doc).length, 2);
  assert.ok(fileOf(doc, 'src/gone.js').classList.contains('deleted'), 'a D row is flagged for the strike-through');
});

test('file in results but missing from the patch shows the no-textual-diff note', async () => {
  // bucketFiles derives the summary from the same arrays (results.mjs:42-52), so a
  // second row has to bump filesChanged too — leaving it at 1 encodes a state the
  // product cannot produce.
  const results = diffResults({
    summary: { filesChanged: 2 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'assets/logo.png', status: 'M', binary: true },
      ],
    },
  });
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const { window } = ctx;
  const doc = window.document;

  const rows = filesOf(doc);
  assert.equal(rows.length, 2);
  // A binary entry carries {binary:true} and NEVER {added,removed}.
  const binary = fileOf(doc, 'assets/logo.png');
  assert.match(binary.textContent, /binary/);

  click(window, binary);
  await settle(window);
  const pane = paneOf(doc);
  assert.match(pane.textContent, /\(no textual diff for this file\)/);
  assert.equal(pane.querySelector('.hd-dl-add'), null, 'no hunks are rendered for it');
});

test('non-done run (results null) shows the empty state and never fetches /diff', async () => {
  const ctx = await bootDetail({
    detail: { ...DETAIL, results: null, state: { ...DETAIL.state, status: 'stopped' } },
  });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;

  // No results -> Overview is the default tab; Diff builds on its first click.
  click(window, doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]'));
  await settle(window);

  const empty = doc.querySelector('#hist-detail .hd-diff-empty');
  assert.ok(empty, 'the Diff tab shows the D1 empty state');
  assert.match(empty.textContent, /No diff captured for this run\./);
  assert.match(empty.textContent, /the run has committed no work, or its artifacts have been archived/);
  // The old copy promised diffs only on completion — stopped/errored runs now
  // persist one, so that sentence must be gone.
  assert.doesNotMatch(empty.textContent, /captured when a run completes/);
  assert.equal(doc.querySelector('#hist-detail .hd-diff-file'), null);
  // endsWith, not includes: /api/diff-comments/counts (the History pill's own
  // endpoint) contains "/diff" as a substring and is unrelated to the patch.
  assert.ok(ctx.calls.every((c) => !c.url.endsWith('/diff')), 'the patch is never requested');
});

const noticeOf = (doc) => doc.querySelector('#hist-detail .hd-diff-partial');

test('a stopped run with results renders the diff plus the partial-run notice', async () => {
  const ctx = await bootDetail({
    detail: { ...diffDetail(diffResults()), state: { ...DETAIL.state, status: 'stopped' } },
    arms: patchArm(PATCH),
  });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;

  const notice = noticeOf(doc);
  assert.ok(notice, 'the partial-run notice paints');
  assert.match(notice.textContent, /did not finish/);
  assert.match(notice.textContent, /partially written/);
  assert.match(notice.textContent, /cycles that completed/);

  // The diff itself is unaffected — the artifact exists, so the tab is fully live.
  assert.equal(filesOf(doc).length, 1, 'the file list still renders');
  assert.match(paneOf(doc).textContent, /@@ -1,2 \+1,2 @@/);

  // The notice sits ABOVE the diff grid, not after it.
  const grid = doc.querySelector('#hist-detail .hd-diff');
  const rel = notice.compareDocumentPosition(grid);
  assert.ok(rel & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING, 'the notice precedes the grid');
});

test('an errored run with results also renders the partial-run notice', async () => {
  const ctx = await bootDetail({
    detail: { ...diffDetail(diffResults()), state: { ...DETAIL.state, status: 'error' } },
    arms: patchArm(PATCH),
  });
  await openDetail(ctx);
  await settle(ctx.window);
  assert.ok(noticeOf(ctx.window.document), 'the notice is keyed off "not done", not off "stopped"');
});

test('a done run renders the diff with no partial-run notice', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  assert.equal(noticeOf(ctx.window.document), null, 'a finished run claims nothing about partial work');
});

test('diff fetch failing (404) degrades to the file list + a per-file note', async () => {
  // No `arms`: the shared base already answers /diff with a 404.
  const ctx = await bootDetail({ detail: diffDetail(diffResults()) });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;

  assert.equal(filesOf(doc).length, 1, 'the rows still render');
  const pane = paneOf(doc);
  assert.match(pane.textContent, /src\/a\.js/, 'the pane head still names the file');
  assert.match(pane.textContent, /Could not load the patch/);
  assert.match(pane.textContent, /404/, 'the note names the failure');
});

test('a failed patch fetch re-arms the Diff tab for a retry', async () => {
  // The same contract the Logs tab already honors: a memoised SETTLED rejection
  // would brick the pane for the life of the screen, with recovery only through
  // Back + reopen.
  const results = diffResults({
    summary: { filesChanged: 2, linesAdded: 2, linesRemoved: 1 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'src/b.js', status: 'M', added: 1, removed: 0 },
      ],
    },
  });
  const TWO = `${PATCH}diff --git a/src/b.js b/src/b.js
--- a/src/b.js
+++ b/src/b.js
@@ -0,0 +1 @@
+two
`;
  let n = 0;
  const ctx = await bootDetail({
    detail: diffDetail(results),
    arms: (url) => {
      if (!url.endsWith('/diff')) return null;
      n += 1;
      return n === 1
        ? fail(503, { error: 'boom' })
        : Promise.resolve({ ok: true, status: 200, text: async () => TWO });
    },
  });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  assert.match(paneOf(doc).textContent, /Could not load the patch: HTTP 503/);

  click(ctx.window, fileOf(doc, 'src/b.js'));
  await settle(ctx.window, 4);
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/diff')).length, 2, 'the next select refetches');
  assert.match(paneOf(doc).textContent, /\+two/, 'and the retry renders');
  assert.doesNotMatch(paneOf(doc).textContent, /Could not load the patch/,
    'the settled failure does not outlive the fetch that replaced it');
});

test('workspace run groups rows per project and keys sections by project', async () => {
  // A workspace results object is {summary, perProject} with NO top-level file
  // arrays, and its perProject keys are the same strings the patch's `# <key>`
  // markers carry (orchestrator.mjs:3443).
  const WS_RESULTS = {
    summary: {
      filesNew: 0, filesChanged: 2, filesDeleted: 0,
      linesAdded: 2, linesRemoved: 1, blockingIssues: 0, nitpicks: 0,
    },
    perProject: {
      'proj-a-00000001': {
        summary: {}, newFiles: [],
        changedFiles: [{ path: 'a.js', status: 'M', added: 1, removed: 1 }],
      },
      'proj-b-00000002': {
        summary: {}, newFiles: [],
        changedFiles: [{ path: 'a.js', status: 'M', added: 1, removed: 0 }],
      },
    },
  };
  const WS_PATCH = `# proj-a-00000001
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1 +1 @@
-one
+alpha

# proj-b-00000002
diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -0,0 +1 @@
+beta
`;
  const ctx = await bootDetail({ detail: diffDetail(WS_RESULTS), arms: patchArm(WS_PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const { window } = ctx;
  const doc = window.document;

  const groups = [...doc.querySelectorAll('#hist-detail .hd-tree-project')];
  assert.deepEqual(groups.map((g) => g.textContent), ['proj-a-00000001', 'proj-b-00000002']);
  const rows = filesOf(doc);
  assert.equal(rows.length, 2, 'the same file name appears once per project');

  // Auto-selection landed on the FIRST project's a.js.
  let pane = paneOf(doc);
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+alpha');
  assert.equal(pane.querySelector('.hd-dl-del .hd-dl-code').textContent, '-one');

  // The second same-named file resolves to the SECOND project's section.
  click(window, fileOf(doc, 'a.js', 'proj-b-00000002'));
  await settle(window);
  pane = paneOf(doc);
  assert.equal(pane.querySelector('.hd-dl-add .hd-dl-code').textContent, '+beta');
  assert.equal(pane.querySelector('.hd-dl-del'), null, 'proj-b removed nothing');
});

test('numbered rows keep exact copy cells, accessible gutters, identity data, and heading outline', async () => {
  const ctx = await bootDetail({ detail: diffDetail(diffResults()), arms: patchArm(PATCH) });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  const section = secOf(doc, 'diff');
  assert.equal(section.querySelector('h2.sr-only').textContent, 'Changed files and diff');
  assert.equal(section.querySelector('.hd-diff-pane-head h3').textContent, 'src/a.js');
  assert.equal(section.querySelector('.hd-tree-project'), null, 'single-project trees start at files');

  const [context, deletion, addition] = [...section.querySelectorAll('.hd-dl-row')];
  assert.deepEqual([context.dataset.old, context.dataset.new], ['1', '1']);
  assert.deepEqual([deletion.dataset.old, deletion.dataset.new], ['2', '']);
  assert.deepEqual([addition.dataset.old, addition.dataset.new], ['', '2']);
  assert.equal(context.querySelector('.hd-dl-code').textContent, ' keep');
  assert.equal(deletion.querySelector('.hd-dl-code').textContent, '-old');
  assert.equal(addition.querySelector('.hd-dl-code').textContent, '+new');
  assert.equal(deletion.querySelector('.hd-dl-n-old .sr-only').textContent, 'Old line 2');
  assert.equal(deletion.querySelector('.hd-dl-n-new').getAttribute('aria-hidden'), 'true');
  assert.equal(addition.querySelector('.hd-dl-n-new .hd-dl-n-v').getAttribute('aria-hidden'), 'true');

  for (const item of section.querySelectorAll('.hd-dl-row,.hd-dl-hunk')) {
    assert.ok(item.dataset.fileKey);
    assert.equal(item.dataset.project, '');
    assert.equal(item.dataset.path, 'src/a.js');
    assert.equal(item.dataset.oldPath, 'src/a.js');
    assert.equal(item.dataset.newPath, 'src/a.js');
  }
  assert.equal(section.querySelector('.hd-dl-hunk').classList.contains('hd-dl-row'), false);
});

test('omitted counts, zero ranges, and multiple hunks reset gutter counters', async () => {
  const patch = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -0,0 +1 @@
+first
@@ -9 +20 @@
-gone
+fresh
`;
  const results = diffResults({
    summary: { linesAdded: 2, linesRemoved: 1 },
    results: { changedFiles: [{ path: 'src/a.js', status: 'M', added: 2, removed: 1 }] },
  });
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch) });
  await openDetail(ctx);
  await settle(ctx.window);
  const rows = [...ctx.window.document.querySelectorAll('#hist-detail .hd-dl-row')];
  assert.deepEqual(rows.map((row) => [row.dataset.old, row.dataset.new]), [
    ['', '1'], ['9', ''], ['', '20'],
  ]);
  assert.equal(ctx.window.document.querySelectorAll('#hist-detail .hd-dl-hunk').length, 2);
});

test('plain numbered rows connect before loader completion, then enhance in place', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const languages = [];
  const loader = {
    forLanguage(lang) {
      languages.push(lang);
      return gate;
    },
  };
  const ctx = await bootDetail({
    detail: diffDetail(diffResults()), arms: patchArm(PATCH), hljsLoader: loader,
  });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  const row = doc.querySelector('#hist-detail .hd-dl-add');
  const source = row.querySelector('.hd-dl-src');
  const sign = row.querySelector('.hd-dl-sign');
  const oldGutter = row.querySelector('.hd-dl-n-old');
  const newGutter = row.querySelector('.hd-dl-n-new');
  assert.equal(row.isConnected, true);
  assert.equal(source.textContent, 'new');
  assert.equal(source.querySelector('span'), null);
  assert.deepEqual(languages, ['javascript']);

  release({
    lang: 'javascript',
    highlight: (text) => text.replace(/new/g, '<span class="hljs-keyword">new</span>'),
  });
  await settle(ctx.window, 6);
  assert.equal(row.querySelector('.hd-dl-src'), source);
  assert.equal(row.querySelector('.hd-dl-sign'), sign);
  assert.equal(row.querySelector('.hd-dl-n-old'), oldGutter);
  assert.equal(row.querySelector('.hd-dl-n-new'), newGutter);
  assert.ok(source.querySelector('.hljs-keyword'));
  assert.equal(row.querySelector('.hd-dl-code').textContent, '+new');
});

test('unsupported and input-over-limit files never consult the loader', async () => {
  const calls = [];
  const loader = { forLanguage: async (lang) => { calls.push(lang); return null; } };
  const unsupportedResults = diffResults({
    results: { changedFiles: [{ path: 'main.tf', status: 'M', added: 1, removed: 0 }] },
  });
  const unsupportedPatch = `diff --git a/main.tf b/main.tf
--- a/main.tf
+++ b/main.tf
@@ -0,0 +1 @@
+enabled = true
`;
  const unsupported = await bootDetail({
    detail: diffDetail(unsupportedResults), arms: patchArm(unsupportedPatch), hljsLoader: loader,
  });
  await openDetail(unsupported);
  await settle(unsupported.window);

  const huge = 'x'.repeat(MAX_HIGHLIGHT_INPUT_BYTES + 1);
  const overResults = diffResults({
    results: { changedFiles: [{ path: 'big.js', status: 'M', added: 1, removed: 0 }] },
  });
  const overPatch = `diff --git a/big.js b/big.js
--- a/big.js
+++ b/big.js
@@ -0,0 +1 @@
+${huge}
`;
  const over = await bootDetail({
    detail: diffDetail(overResults), arms: patchArm(overPatch), hljsLoader: loader,
  });
  await openDetail(over);
  await settle(over.window);
  assert.deepEqual(calls, []);
});

test('invalid highlighter markup stays plain while a separate valid hunk commits', async () => {
  const patch = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -0,0 +1 @@
+valid
@@ -0,0 +10 @@
+invalid
`;
  const results = diffResults({
    summary: { linesAdded: 2, linesRemoved: 0 },
    results: { changedFiles: [{ path: 'src/a.js', status: 'M', added: 2, removed: 0 }] },
  });
  const loader = {
    async forLanguage() {
      return {
        lang: 'javascript',
        highlight: (text) => (text === 'valid'
          ? '<span class="hljs-keyword">valid</span>'
          : '<img src=x>'),
      };
    },
  };
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch), hljsLoader: loader });
  await openDetail(ctx);
  await settle(ctx.window, 6);
  const sources = [...ctx.window.document.querySelectorAll('#hist-detail .hd-dl-src')];
  assert.ok(sources[0].querySelector('.hljs-keyword'));
  assert.equal(sources[1].children.length, 0);
  assert.equal(sources[1].textContent, 'invalid');
});

test('CR and empty source rows survive detached highlighted staging exactly', async () => {
  const patch = 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n'
    + '@@ -0,0 +1,2 @@\r\n+x\r\n+\r\n';
  const results = diffResults({
    summary: { linesAdded: 2, linesRemoved: 0 },
    results: { changedFiles: [{ path: 'src/a.js', status: 'M', added: 2, removed: 0 }] },
  });
  const loader = { async forLanguage() { return { lang: 'javascript', highlight: (text) => text }; } };
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch), hljsLoader: loader });
  await openDetail(ctx);
  await settle(ctx.window, 6);
  const sources = [...ctx.window.document.querySelectorAll('#hist-detail .hd-dl-src')];
  assert.equal(sources[0].textContent, 'x\r');
  assert.equal(sources[1].textContent, '\r');
});

test('stale highlighter completion cannot mutate the newly selected file', async () => {
  const results = diffResults({
    summary: { filesChanged: 2, linesAdded: 2, linesRemoved: 1 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'src/b.tf', status: 'M', added: 1, removed: 0 },
      ],
    },
  });
  const patch = `${PATCH}diff --git a/src/b.tf b/src/b.tf
--- a/src/b.tf
+++ b/src/b.tf
@@ -0,0 +1 @@
+value = true
`;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = { forLanguage: () => gate };
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch), hljsLoader: loader });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  click(ctx.window, fileOf(doc, 'src/b.tf'));
  await settle(ctx.window);
  release({
    lang: 'javascript',
    highlight: (text) => `<span class="hljs-keyword">${text}</span>`,
  });
  await settle(ctx.window, 6);
  assert.equal(paneOf(doc).querySelector('.hd-diff-path').textContent, 'src/b.tf');
  assert.equal(paneOf(doc).querySelector('.hljs-keyword'), null);
  assert.equal(paneOf(doc).querySelector('.hd-dl-code').textContent, '+value = true');
});

test('a patch resolving after navigation cannot append a body or start highlighting', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loaderCalls = [];
  const ctx = await bootDetail({
    detail: diffDetail(diffResults()),
    arms: (url) => (url.endsWith('/diff')
      ? gate.then(() => ({ ok: true, status: 200, text: async () => PATCH }))
      : null),
    hljsLoader: { async forLanguage(lang) { loaderCalls.push(lang); return null; } },
  });
  await openDetail(ctx);
  const retiredPane = paneOf(ctx.window.document);
  assert.equal(retiredPane.querySelector('.hd-diff-body'), null);
  go(ctx.window, 'history');
  await settle(ctx.window);
  release();
  await settle(ctx.window, 6);
  assert.equal(retiredPane.querySelector('.hd-diff-body'), null);
  assert.deepEqual(loaderCalls, []);
});

test('a highlighter resolving after navigation leaves the retired plain body untouched', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ctx = await bootDetail({
    detail: diffDetail(diffResults()), arms: patchArm(PATCH),
    hljsLoader: { forLanguage: () => gate },
  });
  await openDetail(ctx);
  await settle(ctx.window);
  const retiredBody = paneOf(ctx.window.document).querySelector('.hd-diff-body');
  assert.ok(retiredBody);
  go(ctx.window, 'history');
  await settle(ctx.window);
  release({
    lang: 'javascript',
    highlight: (text) => `<span class="hljs-keyword">${text}</span>`,
  });
  await settle(ctx.window, 6);
  assert.equal(retiredBody.querySelector('.hljs-keyword'), null);
  assert.equal(retiredBody.querySelector('.hd-dl-add .hd-dl-code').textContent, '+new');
});

test('cross-extension rename uses the new path grammar and exposes both identities', async () => {
  const results = diffResults({
    results: {
      changedFiles: [{
        path: 'tools/new.py', from: 'tools/old.ts', status: 'R', added: 1, removed: 1,
      }],
    },
  });
  const patch = `diff --git a/tools/old.ts b/tools/new.py
similarity index 80%
rename from tools/old.ts
rename to tools/new.py
--- a/tools/old.ts
+++ b/tools/new.py
@@ -1 +1 @@
-const answer: number = 41;
+answer = 42
`;
  const calls = [];
  const loader = { async forLanguage(lang) { calls.push(lang); return null; } };
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch), hljsLoader: loader });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.deepEqual(calls, ['python']);
  const heading = paneOf(doc).querySelector('h3.hd-diff-path');
  assert.equal(heading.textContent, 'tools/new.py');
  assert.equal(heading.title, 'tools/old.ts → tools/new.py');
  assert.equal(heading.getAttribute('aria-label'), 'Renamed from tools/old.ts to tools/new.py');
  for (const row of paneOf(doc).querySelectorAll('.hd-dl-row')) {
    assert.equal(row.dataset.oldPath, 'tools/old.ts');
    assert.equal(row.dataset.newPath, 'tools/new.py');
  }
});

const addedLinesPatch = (path, n, { header = null } = {}) => {
  const lines = Array.from({ length: n }, (_, index) => `+const n${index + 1} = ${index + 1};`);
  return `diff --git a/${path} b/${path}
--- /dev/null
+++ b/${path}
${header || `@@ -0,0 +1,${n} @@`}
${lines.join('\n')}
`;
};
const addedFileResults = (path, n) => diffResults({
  summary: { filesNew: 1, filesChanged: 0, linesAdded: n, linesRemoved: 0 },
  results: { newFiles: [{ path, status: 'A', added: n, removed: 0 }], changedFiles: [] },
});
const bodyOf = (doc) => doc.querySelector('#hist-detail .hd-diff-body');
const rowsOf = (doc) => doc.querySelectorAll('#hist-detail .hd-dl-row');
const moreOf = (doc) => doc.querySelector('#hist-detail .hd-dl-more');

test('a long diff connects one window of rows plus an honest show-more row, never a truncation note', async () => {
  const N = WINDOW + 1000;
  const ctx = await bootDetail({
    detail: diffDetail(addedFileResults('many.js', N)), arms: patchArm(addedLinesPatch('many.js', N)),
  });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(rowsOf(doc).length, WINDOW);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-dl-hunk').length, 1);
  assert.equal(doc.querySelector('#hist-detail .hd-diff-trunc'), null, 'nothing was dropped, so no truncation note');
  const more = moreOf(doc);
  assert.ok(more, 'the hidden rows are one click away');
  assert.equal(more.classList.contains('hd-dl-row'), false, 'a real grid row, not display:contents');
  assert.equal(more.dataset.path, 'many.js', 'carries the same section identity as every other row');
  assert.match(more.querySelector('.hd-dl-more-hint').textContent, /^5000 of 6000 lines shown$/);
  const button = more.querySelector('button.hd-dl-more-btn');
  assert.equal(button.type, 'button');
  assert.equal(button.textContent, 'Show 1000 more lines');
  assert.equal(more, bodyOf(doc).lastElementChild);
  // The gutter is sized for the WIDEST number in the whole file up front, so
  // expanding never shifts the columns.
  assert.equal(bodyOf(doc).style.getPropertyValue('--hd-gutter-width'), 'calc(4ch + 16px)');

  click(ctx.window, button);
  await settle(ctx.window);
  assert.equal(rowsOf(doc).length, N);
  assert.equal(moreOf(doc), null);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-dl-hunk').length, 1, 'the continued hunk gets no second header');
  const last = [...rowsOf(doc)].at(-1);
  assert.equal(last.dataset.new, String(N));
  assert.equal(last.querySelector('.hd-dl-code').textContent, `+const n${N} = ${N};`);
});

test('show-more steps one window at a time, reporting the running total and the singular form', async () => {
  const N = 2 * WINDOW + 1;
  const ctx = await bootDetail({
    detail: diffDetail(addedFileResults('big.js', N)), arms: patchArm(addedLinesPatch('big.js', N)),
  });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(rowsOf(doc).length, WINDOW);
  assert.equal(moreOf(doc).querySelector('button').textContent, `Show ${WINDOW} more lines`);

  click(ctx.window, moreOf(doc).querySelector('button'));
  await settle(ctx.window);
  assert.equal(rowsOf(doc).length, 2 * WINDOW);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-dl-more').length, 1, 'the used control is replaced, not stacked');
  assert.match(moreOf(doc).querySelector('.hd-dl-more-hint').textContent, /^10000 of 10001 lines shown$/);
  assert.equal(moreOf(doc).querySelector('button').textContent, 'Show 1 more line');

  click(ctx.window, moreOf(doc).querySelector('button'));
  await settle(ctx.window);
  assert.equal(rowsOf(doc).length, N);
  assert.equal(moreOf(doc), null);
});

test('a window boundary inside a hunk continues that hunk; later hunks still get their headers', async () => {
  // hunk 1 fills the window exactly (WINDOW lines) and hunk 2 follows: the
  // first window must not render hunk 2's header as a dangling last row.
  const first = Array.from({ length: WINDOW }, (_, i) => `+a${i}`);
  const second = ['+b1', '+b2', '+b3'];
  const patch = `diff --git a/two.js b/two.js
--- a/two.js
+++ b/two.js
@@ -0,0 +1,${first.length} @@
${first.join('\n')}
@@ -10,0 +${first.length + 11},3 @@
${second.join('\n')}
`;
  const ctx = await bootDetail({
    detail: diffDetail(addedFileResults('two.js', first.length + 3)), arms: patchArm(patch),
  });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(rowsOf(doc).length, WINDOW);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-dl-hunk').length, 1);
  assert.equal(moreOf(doc).querySelector('button').textContent, 'Show 3 more lines');
  click(ctx.window, moreOf(doc).querySelector('button'));
  await settle(ctx.window);
  const hunks = [...doc.querySelectorAll('#hist-detail .hd-dl-hunk')];
  assert.equal(hunks.length, 2);
  assert.equal(hunks[1].nextElementSibling.querySelector('.hd-dl-code').textContent, '+b1');
  assert.equal(rowsOf(doc).length, WINDOW + 3);
});

test('the section-size cap still reports truncation, after the show-more row', async () => {
  // ~9 code units per row: well over MAX_FILE_SECTION_CODE_UNITS, so the parser
  // drops the tail (that loss is real and is said so), and the renderer windows
  // the ~55k rows that survive.
  const N = Math.ceil(MAX_FILE_SECTION_CODE_UNITS / 9) + 500;
  const lines = Array.from({ length: N }, () => '+xxxxxxxx');
  const patch = `diff --git a/huge.txt b/huge.txt
--- /dev/null
+++ b/huge.txt
@@ -0,0 +1,${N} @@
${lines.join('\n')}
`;
  const ctx = await bootDetail({
    detail: diffDetail(addedFileResults('huge.txt', N)), arms: patchArm(patch),
  });
  await openDetail(ctx);
  await settle(ctx.window, 5);
  const doc = ctx.window.document;
  assert.equal(rowsOf(doc).length, WINDOW);
  const body = bodyOf(doc);
  const note = body.querySelector('.hd-diff-trunc');
  assert.equal(note.textContent, '(large file — diff truncated)');
  assert.doesNotMatch(note.textContent, /KB/);
  assert.equal(note, body.lastElementChild, 'the note stays the last row');
  assert.equal(note.previousElementSibling, moreOf(doc), 'show-more sits just above it');
  const shown = Number(/^(\d+) of (\d+) lines shown$/.exec(moreOf(doc).querySelector('.hd-dl-more-hint').textContent)[2]);
  assert.ok(shown > WINDOW && shown < N, `the total counts parsed rows only (${shown})`);
});

test('rows connected by show-more are highlighted once both the rows and the highlighter exist', async () => {
  // Hunk 1 is ineligible for highlighting (its header count is wrong, so it
  // stays plain) and fills the first window; hunk 2 is eligible but only
  // connects after a click. Both orders must end with hunk 2 enhanced.
  const bulk = Array.from({ length: WINDOW + 5 }, (_, i) => `+x${i}`);
  const patch = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -0,0 +1,2 @@
${bulk.join('\n')}
@@ -1 +1 @@
-old
+valid
`;
  const results = diffResults({
    summary: { linesAdded: bulk.length + 1, linesRemoved: 1 },
    results: { changedFiles: [{ path: 'src/a.js', status: 'M', added: bulk.length + 1, removed: 1 }] },
  });
  const highlighter = {
    lang: 'javascript',
    highlight: (text) => text.replace(/valid/g, '<span class="hljs-keyword">valid</span>'),
  };
  const enhancedSources = (doc) => [...doc.querySelectorAll('#hist-detail .hd-dl-src')]
    .filter((source) => source.querySelector('.hljs-keyword'))
    .map((source) => source.textContent);

  // Order A: the highlighter finishes first, the click comes later.
  const ready = await bootDetail({
    detail: diffDetail(results), arms: patchArm(patch),
    hljsLoader: { async forLanguage() { return highlighter; } },
  });
  await openDetail(ready);
  await settle(ready.window, 6);
  assert.deepEqual(enhancedSources(ready.window.document), []);
  click(ready.window, moreOf(ready.window.document).querySelector('button'));
  await settle(ready.window);
  assert.deepEqual(enhancedSources(ready.window.document), ['valid']);
  assert.equal(rowsOf(ready.window.document).length, bulk.length + 2);

  // Order B: the click lands while the grammar is still loading.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const late = await bootDetail({
    detail: diffDetail(results), arms: patchArm(patch), hljsLoader: { forLanguage: () => gate },
  });
  await openDetail(late);
  await settle(late.window, 5);
  click(late.window, moreOf(late.window.document).querySelector('button'));
  await settle(late.window);
  assert.deepEqual(enhancedSources(late.window.document), []);
  release(highlighter);
  await settle(late.window, 6);
  assert.deepEqual(enhancedSources(late.window.document), ['valid']);
  const plain = [...late.window.document.querySelectorAll('#hist-detail .hd-dl-src')][0];
  assert.equal(plain.children.length, 0, 'the ineligible hunk stays plain');
});

test('directory collapse changes no selection, pane body, or patch fetch', async () => {
  const results = diffResults({
    summary: { filesChanged: 2, linesAdded: 2, linesRemoved: 1 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'src/b.js', status: 'M', added: 1, removed: 0 },
      ],
    },
  });
  const patch = `${PATCH}diff --git a/src/b.js b/src/b.js
--- a/src/b.js
+++ b/src/b.js
@@ -0,0 +1 @@
+two
`;
  const ctx = await bootDetail({ detail: diffDetail(results), arms: patchArm(patch) });
  await openDetail(ctx);
  await settle(ctx.window);
  const doc = ctx.window.document;
  const body = paneOf(doc).querySelector('.hd-diff-body');
  const active = doc.querySelector('#hist-detail .hd-tree-file[aria-current="true"]');
  click(ctx.window, doc.querySelector('#hist-detail .hd-tree-dir'));
  assert.equal(paneOf(doc).querySelector('.hd-diff-body'), body);
  assert.equal(doc.querySelector('#hist-detail .hd-tree-file[aria-current="true"]'), active);
  assert.equal(ctx.calls.filter((call) => call.url.endsWith('/diff')).length, 1);
});

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

// Two steps across two cycles so the DURATION subtitle carries real numbers
// rather than the shared fixture's empty `steps: []`.
const OV_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    steps: [{ key: 'plan', cycle: 1 }, { key: 'implement', cycle: 2 }],
  },
  results: RESULTS,
};

// Persisted results make Diff the default tab, so Overview has to be clicked;
// a results-null run opens on Overview already and must NOT be re-clicked (that
// would be a no-op anyway, but asserting the state keeps the intent explicit).
async function openOverview(ctx) {
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tab = doc.querySelector('#hist-detail .hd-tab[data-sec="overview"]');
  if (!tab.classList.contains('active')) click(ctx.window, tab);
  await settle(ctx.window);
  return secOf(doc, 'overview');
}

test('Overview: clean verdict + stat cards + task card', async () => {
  const ctx = await bootDetail({ detail: OV_DETAIL });
  const sec = await openOverview(ctx);

  const verdict = sec.querySelector('.hd-ov-verdict');
  assert.ok(verdict, 'the verdict banner renders');
  assert.ok(verdict.classList.contains('clean'), 'an empty keyThingsToCheck is a clean verdict');
  assert.match(verdict.textContent, /Clean — no blocking issues flagged\./);
  assert.equal(sec.querySelector('ul.issues'), null, 'nothing to list when there are no findings');

  const dur = sec.querySelector('.hd-ov-card-duration');
  assert.match(dur.textContent, /1h 40m/);
  assert.match(dur.querySelector('.hd-ov-sub').textContent, /\d+ steps? · \d+ cycles?/);

  const cost = sec.querySelector('.hd-ov-card-cost');
  assert.match(cost.textContent, /\$153\.21/);
  assert.match(cost.querySelector('.hd-ov-value').title, /Estimated cost/);

  const wt = sec.querySelector('.hd-ov-card-worktree');
  assert.match(wt.textContent, /retained|released/);
  assert.match(wt.querySelector('.hd-ov-sub').textContent, /^\/tmp\/wt$/);

  const task = sec.querySelector('.hd-ov-task');
  assert.ok(task, 'the task card renders');
  assert.match(task.textContent, /Fix the log UX\./);
  assert.equal(task.querySelector('.hd-ov-more'), null, 'a short prompt needs no Show more');
  const chips = [...sec.querySelectorAll('.hd-ov-tag')].map((c) => c.textContent);
  assert.ok(chips.includes('feat/log-ux'), `the source branch is a chip — got ${JSON.stringify(chips)}`);
  assert.ok(chips.includes('Alpha'), 'and so is the project name');

  // D6: the LLM "Generate overview" UI is gone from History for good.
  assert.equal(sec.querySelector('.results-overview-btn'), null,
    'D6: no Generate-overview button anywhere in the section');

  // Carried over from the retired ui-history-diff-overview suite: the verdict
  // line is a judgement, never a count restatement. `+A −R` belongs to the header
  // meta (.hd-diffcounts) and to the Diff tab's file-list head — nowhere else.
  assert.doesNotMatch(verdict.textContent, /[+−]/, 'the verdict carries no raw diff counts');
});

test('Overview: findings render when keyThingsToCheck is non-empty', async () => {
  const results = {
    ...RESULTS,
    keyThingsToCheck: [
      { id: 'c1', severity: 'major', title: 'Check X', detail: 'the retry path is untested', location: 'a.js:1' },
    ],
  };
  const ctx = await bootDetail({ detail: { ...OV_DETAIL, results } });
  const sec = await openOverview(ctx);

  const verdict = sec.querySelector('.hd-ov-verdict');
  assert.ok(verdict.classList.contains('warn'));
  assert.match(verdict.textContent, /1 thing to check/);
  assert.equal(sec.querySelector('.hd-ov-chip').textContent, '1');

  const list = sec.querySelector('ul.issues');
  assert.ok(list, 'the findings list renders beneath the verdict');
  assert.equal(list.querySelectorAll('li.issue').length, 1);
  assert.match(list.textContent, /Check X/);
  assert.equal(list.querySelector('.issue-loc').textContent, 'a.js:1');
  assert.equal(list.querySelector('.issue-origin').textContent, 'review');
});

test('Overview: workspace findings are collected from perProject and prefixed', async () => {
  // A workspace results object has NO top-level keyThingsToCheck — the findings
  // live under perProject[<key>], and the rollup summary only COUNTS them. Without
  // the collection every workspace run would falsely read "Clean".
  const results = {
    summary: {
      filesNew: 0, filesChanged: 1, filesDeleted: 0,
      linesAdded: 1, linesRemoved: 1, blockingIssues: 1, nitpicks: 0,
    },
    perProject: {
      'proj-a-00000001': {
        summary: {}, newFiles: [], changedFiles: [],
        keyThingsToCheck: [{ severity: 'critical', title: 'T', location: 'x.js:2' }],
      },
      'proj-b-00000002': { summary: {}, newFiles: [], changedFiles: [], keyThingsToCheck: [] },
    },
  };
  const ctx = await bootDetail({ detail: { ...OV_DETAIL, results } });
  const sec = await openOverview(ctx);

  const verdict = sec.querySelector('.hd-ov-verdict');
  assert.ok(verdict.classList.contains('warn'), 'a perProject finding is not "Clean"');
  assert.match(verdict.textContent, /1 thing to check/);
  assert.equal(sec.querySelector('.issue-loc').textContent, 'proj-a-00000001: x.js:2',
    'the location is prefixed with its project key');
});

test('Overview: non-done run shows the status verdict line', async () => {
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'stopped' }],
    detail: { ...OV_DETAIL, results: null, state: { ...OV_DETAIL.state, status: 'stopped' } },
  });
  await openDetail(ctx);
  const sec = await openOverview(ctx);

  const verdict = sec.querySelector('.hd-ov-verdict');
  assert.ok(verdict.classList.contains('none'));
  assert.match(verdict.textContent, /No review results captured — the run did not complete\./);
  const chip = sec.querySelector('.hd-ov-chip');
  assert.ok(chip.classList.contains('st-stopped'), 'the chip wears the status family class');
  assert.equal(chip.textContent, 'Stopped');
  assert.equal(sec.querySelector('ul.issues'), null);
});

test('Overview: a long prompt truncates with a working Show more', async () => {
  const prompt = 'p'.repeat(700);
  const ctx = await bootDetail({ detail: { ...OV_DETAIL, state: { ...OV_DETAIL.state, prompt } } });
  const sec = await openOverview(ctx);

  const p = sec.querySelector('.hd-ov-task p');
  assert.equal(p.textContent.length, 601, 'LIMIT 600 plus the ellipsis');
  assert.ok(p.textContent.endsWith('…'));
  const more = sec.querySelector('.hd-ov-more');
  assert.ok(more, 'a truncated prompt offers Show more');

  click(ctx.window, more);
  assert.equal(p.textContent, prompt, 'the full prompt lands in place');
  assert.equal(sec.querySelector('.hd-ov-more'), null, 'and the button retires');
});

test('the WORKTREE card flips released -> retained without leaving the tab', async () => {
  // The carried-over phase-4 assertion. A tab body is built exactly ONCE, so the
  // one body that reads mutable record fields only tracks the authoritative row
  // because refreshHdFromRow calls refreshHdOverviewTab() — without it this card
  // would read `released` for the life of the screen.
  const ctx = await bootDetail({ rows: [], detail: DETAIL, deepLink: true });
  await settle(ctx.window, 5);
  const doc = ctx.window.document;

  const sec = secOf(doc, 'overview');
  assert.equal(sec.hidden, false, 'results-null -> Overview is the default tab');
  assert.match(sec.querySelector('.hd-ov-card-worktree .hd-ov-value').textContent, /^released$/,
    'the deep-link stub carries no retainedWork');

  await deliverRows(ctx, [retainedRow()]);
  assert.equal(secOf(doc, 'overview'), sec, 'the SAME section node is repainted in place');
  assert.equal(sec.hidden, false, 'and the user never left the tab');
  assert.equal(sec.querySelector('.hd-ov-card-worktree .hd-ov-value').textContent, 'retained');
  assert.equal(sec.querySelectorAll('.hd-ov-card-worktree').length, 1, 'the repaint replaces, never stacks');
});

test('the WORKTREE card reads retained while the run is still running', async () => {
  // Running pipelines DO appear in History (listAllPipelines filters only
  // `archived_at IS NULL`), and their worktree is very much still on disk — the
  // card printed the live path under the word "released".
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'running' }],
    detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } },
  });
  await openDetail(ctx);
  const sec = secOf(ctx.window.document, 'overview');
  const card = sec.querySelector('.hd-ov-card-worktree');
  assert.equal(card.querySelector('.hd-ov-value').textContent, 'retained');
  assert.match(card.textContent, /\/tmp\/wt/, 'and it names the worktree it just called retained');
});

test('rapid selection does not stack two bodies in the pane', async () => {
  const results = diffResults({
    summary: { filesChanged: 2, linesAdded: 2, linesRemoved: 1 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'src/b.js', status: 'M', added: 1, removed: 0 },
      ],
    },
  });
  const TWO = `${PATCH}diff --git a/src/b.js b/src/b.js
--- a/src/b.js
+++ b/src/b.js
@@ -0,0 +1 @@
+two
`;
  // The patch stays in flight until release() so both selections are mid-await
  // together — the exact race selEpoch exists for.
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = await bootDetail({
    detail: diffDetail(results),
    arms: (url) => (url.endsWith('/diff')
      ? gate.then(() => ({ ok: true, status: 200, text: async () => TWO }))
      : null),
  });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;

  const rows = filesOf(doc);
  assert.equal(rows.length, 2, 'the rows render before the patch arrives');
  assert.equal(doc.querySelectorAll('#hist-detail .hd-diff-body').length, 0);

  click(window, rows[0]);
  click(window, rows[1]);
  release();
  await settle(window, 6);

  assert.equal(doc.querySelectorAll('#hist-detail .hd-diff-body').length, 1);
  assert.equal(paneOf(doc).querySelector('.hd-dl-add .hd-dl-code').textContent, '+two',
    'the LAST selection owns the pane');
  // One fetch for three selections: the promise is memoized, not re-issued.
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/diff')).length, 1);
});

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------

// Everything the roster has to survive at once: a row whose duration exists only
// as finishedAt − startedAt, a row whose cost is null, a halted row, one typed
// row, one graphify user and one skill user. `stepper: null` on purpose —
// A FROZEN v1 manifest whose 'refine' node IS an 'agents' node, so the step row
// really does open the group. (There is no built-in legacy default any more:
// manifestFor(null) is an EMPTY manifest.)
const AG_STEPPER = {
  version: 1, feedbacks: [],
  steps: [{ kind: 'agents', nodes: [{ id: 'refine', uiPhase: 'refine', label: 'Refine', color: 'green' }] }],
};
const AG_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    stepper: AG_STEPPER,
    steps: [{ nodeId: 'refine', cycle: 1, status: 'done', skills: [], graphifyCount: 0 }],
    subAgents: [
      {
        id: 't1', label: 'Codebase surveyor', nodeId: 'refine', cycle: 1, status: 'finished',
        startedAt: '2026-08-17T20:55:00Z', finishedAt: '2026-08-17T20:58:00Z',
        durationMs: null, costUsd: 1.5, skills: [], subagentType: 'Explore', graphifyCount: null,
      },
      {
        id: 't2', label: 'Risk annotator', nodeId: 'refine', cycle: 1, status: 'error',
        startedAt: null, finishedAt: null, durationMs: 5000, costUsd: null, skills: ['skill:tdd'],
        subagentType: null, graphifyCount: 2,
      },
    ],
  },
};

// results is null on these fixtures, so the screen opens on Overview and the tab
// under test always has to be clicked.
async function openTab(ctx, key) {
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tab = doc.querySelector(`#hist-detail .hd-tab[data-sec="${key}"]`);
  if (!tab.classList.contains('active')) click(ctx.window, tab);
  await settle(ctx.window);
  return secOf(doc, key);
}

test('Agents tab groups rows with duration fallback and blank cost', async () => {
  const ctx = await bootDetail({ detail: AG_DETAIL });
  const sec = await openTab(ctx, 'agents');

  const rows = [...sec.querySelectorAll('.hd-ag-row')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Codebase surveyor/);
  assert.match(rows[0].textContent, /3m/);          // finishedAt − startedAt fallback ('3m 0s')
  assert.match(rows[0].textContent, /\$1\.5/);      // fmtUsd4 -> '$1.5000'
  assert.ok(rows[0].querySelector('.agent-type-pill'), 'subagentType paints its violet pill');
  assert.equal(rows[0].querySelector('.graphify-pill'), null, 'a null graphifyCount paints nothing');

  assert.match(rows[1].textContent, /Risk annotator/);
  assert.equal(rows[1].querySelector('.hd-ag-cost').textContent, '', 'a null costUsd leaves the cell blank');
  assert.match(rows[1].textContent, /5s/);          // durationMs wins outright
  assert.ok(rows[1].querySelector('.st.stop'), "subRowStatus('error') === 'stop'");
  assert.ok(rows[1].querySelector('.graphify-pill'));
  assert.equal(rows[1].querySelector('.agent-type-pill'), null, 'an untyped row paints no pill');
  // skillPillsHtml is emitted LAST, exactly as renderSubsTree does it: the CSS
  // gives `.hd-ag-row .subs-skills` flex:0 0 100%, so a mid-row pill block would
  // force-wrap the line and strand the status chip on a row of its own.
  const kids = [...rows[1].children];
  assert.ok(kids[kids.length - 1].classList.contains('subs-skills'), 'the pill row closes the row');
  assert.equal(rows[1].querySelector('.subs-skills .skill-pill').textContent, 'tdd');
});

test('Agents group header carries the rolled-up status and meta', async () => {
  const ctx = await bootDetail({ detail: AG_DETAIL });
  const sec = await openTab(ctx, 'agents');

  const heads = [...sec.querySelectorAll('.hd-ag-head')];
  assert.equal(heads.length, 1, 'one group per main agent that ran');
  assert.match(heads[0].textContent, /Refine/, 'the group wears its node label');
  assert.ok(heads[0].querySelector('.subs-stat.stop'), 'one errored row rolls the group up to stopped');
  assert.match(heads[0].textContent, /2 sub-agents/);
  assert.match(heads[0].textContent, /3m 5s/, 'durations sum across the group');
  assert.match(heads[0].textContent, /\$1\.5/);
});

// P6b Task 14 (C3): the History Agents tab's own call site passes st.steps, so a
// v2 group is named from the ledger row its key's tail points at. Without the 4th
// argument every head here reads a bare "Implementer".
const AG_V2_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    stepper: {
      version: 2,
      template: { id: 'wf', name: 'WF' },
      graph: {
        nodes: [
          { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', color: 'blue', x: 0, y: 0, model: 'claude-fable-5-1', effort: 'max', ports: { inputs: [], outputs: [], await: true } },
          { id: 'n_or', kind: 'or', key: null, label: 'OR', x: 0, y: 0, ports: { inputs: [], outputs: [], await: false } },
        ],
        wires: [],
      },
    },
    steps: [
      { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', skills: [], graphifyCount: 0 },
      { key: 'x:n_impl:1:p1t3', executionId: 'x:n_impl:1:p1t3', nodeId: 'n_impl', ordinal: 1, kind: 'task', title: 'Add schema', cycle: 1, status: 'done', skills: [], graphifyCount: 0 },
      { key: 'x:n_or:1', executionId: 'x:n_or:1', nodeId: 'n_or', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', skills: [], graphifyCount: 0 },
    ],
    subAgents: [
      { id: 't1', label: 'Slice worker', nodeId: 'n_impl', cycle: 1, stepKey: 'x:n_impl:1:p1t3',
        status: 'finished', durationMs: 2000, costUsd: 0.5, skills: [], subagentType: null, graphifyCount: null },
    ],
  },
};

test('Agents tab names a v2 group from the ledger (buildHdAgents passes st.steps)', async () => {
  const ctx = await bootDetail({ detail: AG_V2_DETAIL });
  // Seed the catalog so the head's model pill exercises the LABEL arm of
  // stepModelPillHtml (the raw-id fallback arm is ui-running-detail's).
  ctx.window.__np._setModels([{ id: 'claude-fable-5-1', label: 'Fable 5.1 (1M)', efforts: ['max'] }]);
  const sec = await openTab(ctx, 'agents');
  const heads = [...sec.querySelectorAll('.hd-ag-group .hd-ag-head b')].map((b) => b.textContent);
  // The OR node wrote a ledger row too and must not become an Agents group.
  assert.deepEqual(heads, ['Implementer #1', 'Implementer #1 · Add schema'],
    'the 4th argument (st.steps) reaches cycleAwareLabel');
  const groups = [...sec.querySelectorAll('.hd-ag-group')];
  assert.equal(groups[1].querySelector('.hd-ag-row .hd-ag-name').textContent, 'Slice worker',
    'the sub-agent row landed in the SLICE group, keyed by its v2 stepKey');
  // The manifest node's configured model · effort shows on the step title line.
  assert.equal(groups[0].querySelector('.hd-ag-head .sub-model-pill').textContent, 'Fable 5.1 (1M) · max');
  assert.equal(groups[1].querySelector('.hd-ag-head .sub-model-pill').textContent, 'Fable 5.1 (1M) · max');
});

test('Agents tab empty state', async () => {
  const ctx = await bootDetail();                    // DETAIL: subAgents [] + steps []
  const sec = await openTab(ctx, 'agents');
  assert.equal(sec.querySelector('.hd-ag-row'), null);
  assert.match(sec.querySelector('.hd-ag-empty').textContent, /\(no sub-agents recorded\)/);
});

test('a main agent that spawned nothing still gets a group, coloured by its step', async () => {
  const ctx = await bootDetail({
    detail: {
      ...DETAIL,
      state: {
        ...DETAIL.state,
        stepper: { version: 1, feedbacks: [], steps: [{ kind: 'agents', nodes: [{ id: 'plan', uiPhase: 'plan', label: 'Plan', color: 'violet' }] }] },
        steps: [{ nodeId: 'plan', cycle: 1, status: 'error', skills: [], graphifyCount: 3 }],
        subAgents: [],
      },
    },
  });
  const sec = await openTab(ctx, 'agents');
  const head = sec.querySelector('.hd-ag-head');
  // No rows to roll up, so the colour comes from stepStatusByKey, not subGroupStatus.
  assert.ok(head.querySelector('.subs-stat.stop'));
  assert.equal(head.querySelector('.sub-model-pill'), null,
    'a v1 stepper recorded no per-node model — no pill, never a guess');
  assert.match(head.textContent, /0 sub-agents/);
  assert.equal(head.querySelector('.graphify-pill').textContent, 'graphify ×3');
  assert.match(sec.querySelector('.hd-ag-none').textContent, /No sub-agents spawned/);
});

// ---------------------------------------------------------------------------
// Clarify tab
// ---------------------------------------------------------------------------

const CL_DETAIL = {
  ...DETAIL,
  clarify: {
    questions: [{ id: 'q1', question: 'Which DB?', options: ['a', 'b'], allowFreeText: true }],
    answers: [{ id: 'q1', question: 'Which DB?', choice: 'sqlite' }],
  },
  stepQuestions: [{
    stepKey: '3:impl#2', round: 1, nodeId: 'impl', agentKey: 'implementer',
    questions: [{ id: 's1', question: 'Keep flag?' }], answers: [],
  }],
};

test('Clarify tab renders ASK/ANS cards + step rounds', async () => {
  const ctx = await bootDetail({ detail: CL_DETAIL });
  const sec = await openTab(ctx, 'clarify');
  const doc = ctx.window.document;

  assert.equal(badgeOf(doc, 'clarify'), '2', 'the badge counts run + step questions together');
  const cards = [...sec.querySelectorAll('.hd-cl-card')];
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /Which DB\?/);
  assert.match(cards[0].textContent, /sqlite/);
  assert.equal(cards[0].querySelector('.hd-cl-chip.ask').textContent, 'ASK');
  assert.equal(cards[0].querySelector('.hd-cl-chip.ans').textContent, 'ANS');
  // An unanswered step question keeps its ANS row and says so.
  assert.match(cards[1].textContent, /Keep flag\?/);
  assert.match(cards[1].textContent, /\(none\)/);
  assert.match(sec.querySelector('.hd-cl-caption').textContent, /implementer — round 1 · cycle 2/);
});

test('Clarify caption drops the cycle when the stepKey carries none', async () => {
  const ctx = await bootDetail({
    detail: {
      ...DETAIL,
      stepQuestions: [{
        stepKey: 'plan', round: 2, nodeId: 'plan', agentKey: null,
        questions: [{ id: 's1', question: 'Ship it?' }],
        answers: [{ id: 's1', question: 'Ship it?', choice: '   ' }],
      }],
    },
  });
  const sec = await openTab(ctx, 'clarify');
  assert.equal(sec.querySelector('.hd-cl-caption').textContent, 'plan — round 2');
  // A whitespace-only choice is not an answer.
  assert.match(sec.querySelector('.hd-cl-card').textContent, /\(none\)/);
});

test('Clarify skips a step round that asked nothing', async () => {
  const ctx = await bootDetail({
    detail: {
      ...DETAIL,
      clarify: { questions: [{ id: 'q1', question: 'Which DB?' }], answers: [] },
      stepQuestions: [{ stepKey: '1:plan', round: 1, nodeId: 'plan', agentKey: 'planner', questions: [], answers: [] }],
    },
  });
  const sec = await openTab(ctx, 'clarify');
  assert.equal(sec.querySelectorAll('.hd-cl-card').length, 1);
  assert.equal(sec.querySelector('.hd-cl-caption'), null, 'no questions -> no caption either');
});

// ---------------------------------------------------------------------------
// Logs tab
// ---------------------------------------------------------------------------

// Cycle-less first line, then cycle 1, then cycle 2: exactly one boundary, and the
// leading cycle-less record proves `cycleSeparatorBefore` draws no header above the
// first cycled line.
const LOG_NDJSON = [
  '{"source":"orchestrator","level":"system","text":"pipeline start","ts":"2026-08-17T20:54:42Z"}',
  '{"source":"refiner","level":"phase","text":"Refine Plan","ts":"2026-08-17T20:54:43Z","stepIndex":1,"cycle":1}',
  '{"source":"refiner","level":"phase","text":"Refine Plan (re-run)","ts":"2026-08-17T21:04:12Z","stepIndex":1,"cycle":2}',
].join('\n');

// The shared DETAIL fixture ships `artifacts: []`, and the Logs tab's `visible`
// predicate requires a 'live-log' entry. results stays null, so the screen opens on
// Overview and the Logs tab always has to be clicked.
const LOGS_DETAIL = { ...DETAIL, artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }] };

// Twin of patchArm: `arms` runs BEFORE the shared base (bootDetail:186), whose own
// /log arm answers 404.
const logArm = (body) => (url) => (
  url.endsWith('/log') ? Promise.resolve({ ok: true, status: 200, text: async () => body }) : null
);

test('Logs tab renders the shared filter bar + lines + cycle separator', async () => {
  const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(LOG_NDJSON) });
  const sec = await openTab(ctx, 'logs');

  assert.ok(sec.querySelector('.log-filters'), 'the shared bar, cloned from #run-card-tpl');
  assert.equal(sec.querySelectorAll('.log-line').length, 3);
  const seps = sec.querySelectorAll('.log-sep');
  assert.equal(seps.length, 1, 'one separator at the cycle 1 -> 2 boundary');
  assert.equal(seps[0].textContent, 'Cycle 2');
  // The URL is the same historyLogUrl the list card uses, fetched exactly once.
  const logCalls = ctx.calls.filter((c) => c.url.endsWith('/log'));
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].url, `/api/history/${KEY}/${ROW.id}/log`);
});

test('Logs tab filters via the shared selects', async () => {
  const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(LOG_NDJSON) });
  const sec = await openTab(ctx, 'logs');

  const cycleSel = sec.querySelector('.log-f-cycle');
  assert.deepEqual([...cycleSel.options].map((o) => o.textContent), ['all cycles', 'cycle 1', 'cycle 2']);
  cycleSel.value = '2';
  // The change listener is delegated on the BAR, not the select (app.js:9403), so a
  // non-bubbling event is silently ignored. Same idiom as ui-history-logs.test.mjs:244.
  cycleSel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(sec.querySelectorAll('.log-line').length, 1);
  assert.equal(sec.querySelectorAll('.log-sep').length, 0, 'no orphan separator');
  assert.match(sec.querySelector('.log-line').textContent, /Refine Plan \(re-run\)/);
});

// MOVED here from test/ui-history-logs.test.mjs:308-320: the detail screen is now
// the History surface that clones the bar, so the invariant belongs to this suite.
test('the Logs tab uses the run-card template bar — one markup source', async () => {
  const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(LOG_NDJSON) });
  const sec = await openTab(ctx, 'logs');
  const doc = ctx.window.document;

  const tplBar = doc.getElementById('run-card-tpl').content.querySelector('.log-filters');
  const histBar = sec.querySelector('.log-filters');
  // Children CLASSNAMES, never innerHTML: loadLiveLogs runs fillFilterSelect, which
  // fills the cloned <select>s with <option> children, so the live bar's innerHTML
  // always differs from a fresh template clone.
  assert.deepEqual(
    [...histBar.children].map((el) => el.className),
    [...tplBar.children].map((el) => el.className),
    'History bar matches the template bar — no drift');
  assert.ok(histBar.querySelector('.log-search').getAttribute('aria-label'), 'a11y rides along');
  assert.equal(histBar.querySelector('.log-copy').getAttribute('type'), 'button');
});

test('a failed log fetch re-arms the Logs tab for a retry', async () => {
  let logCalls = 0;
  const ctx = await bootDetail({
    detail: LOGS_DETAIL,
    arms: (url) => {
      if (!url.endsWith('/log')) return null;
      logCalls += 1;
      return logCalls === 1
        ? fail(500, { error: 'boom' })
        : Promise.resolve({ ok: true, status: 200, text: async () => LOG_NDJSON });
    },
  });
  const sec = await openTab(ctx, 'logs');
  assert.match(sec.querySelector('.log').textContent, /Could not load logs: HTTP 500/);
  // loadLiveLogs clears panel.dataset.loaded on failure — the SAME flag initHdTabs
  // stamps — which is what re-arms the tab. That composition is the retry contract.
  assert.equal(sec.dataset.loaded, '', 'the failed load un-stamped the section');

  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="overview"]'));
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="logs"]'));
  await settle(ctx.window);

  assert.equal(logCalls, 2, 'switching back re-issued the fetch');
  assert.equal(secOf(doc, 'logs'), sec, 'the section node is reused, never re-created');
  assert.equal(sec.querySelectorAll('.log-line').length, 3, 'the retry paints the lines');
  assert.equal(sec.dataset.loaded, '1');
});

test('the Logs tab is hidden when there is no live-log artifact', async () => {
  const ctx = await bootDetail();                    // DETAIL ships artifacts: []
  await openDetail(ctx);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-tab[data-sec="logs"]'), null);
  assert.equal(secOf(doc, 'logs'), null);
  assert.ok(ctx.calls.every((c) => !c.url.endsWith('/log')), 'and the NDJSON is never requested');
});

// ---------------------------------------------------------------------------
// Retained work, continued — folded in from the retired test/ui-history-delete
// and test/ui-history-diff-overview suites (the banner and its actions moved
// from the card accordion onto this screen).
// ---------------------------------------------------------------------------

test('discard confirms honestly, POSTs the keyed route, and shows the saved recovery patch', async () => {
  let request = null;
  const ctx = await bootDetail({
    rows: [retainedRow()],
    arms: (url, opts) => {
      if (url.includes('/discard-worktree')) {
        request = { url, method: opts.method };
        return ok({ ok: true, discarded: true, remaining: 0, patches: ['/store/p1/retained-work.patch'] });
      }
      return null;
    },
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
  const confirmText = await confirmDialog(ctx.window);
  await settle(ctx.window, 5);

  assert.equal(request.method, 'POST');
  assert.match(request.url, /\/api\/runs\/fcec04e8\/discard-worktree\?projectKey=/);
  assert.match(confirmText, /exists only in the retained worktree/);
  assert.match(confirmText, /recovery patch of uncommitted changes will be saved/);
  assert.match(doc.querySelector('#viewer').textContent, /retained-work\.patch/,
    'the saved patch path is surfaced, not swallowed');
});

test('a failed discard keeps the banner, the badge and the Archive block — and lets the user retry', async () => {
  const ctx = await bootDetail({
    rows: [retainedRow()],
    arms: (url) => (url.includes('/discard-worktree')
      ? ok({
        ok: true, discarded: false, remaining: 1,
        patches: ['/store/p1/retained-work.patch'],
        warnings: [`${KEY}: worktree still exists at /tmp/retained-p1`],
      })
      : null),
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
  await confirmDialog(ctx.window);
  await settle(ctx.window, 5);

  assert.equal(doc.querySelector('#hist-detail .hist-retained-badge').hidden, false, 'badge stays');
  assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, false, 'banner stays');
  assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, true, 'Archive stays blocked');
  const discardBtn = doc.querySelector('#hist-detail .hist-discard');
  assert.equal(discardBtn.disabled, false, 'the user can retry');
  assert.match(discardBtn.textContent, /Discard/);
  assert.match(doc.querySelector('#viewer').textContent, /worktree still exists/);
});

test('the retained-work banner explains how to clear the warning after a manual commit', async () => {
  const ctx = await bootDetail({ rows: [retainedRow()] });
  await openDetail(ctx);
  const banner = ctx.window.document.querySelector('#hist-detail .retained-banner');
  assert.match(banner.textContent, /After committing manually, use .*Discard worktree/i);
});

test('the retained banner links the recovery patch honestly (retained-work name + label)', async () => {
  const ctx = await bootDetail({
    rows: [retainedRow()],
    detail: { ...DETAIL, artifacts: [{ kind: 'retained-work-patch', relPath: 'retained-work.patch' }] },
  });
  await openDetail(ctx);
  const link = ctx.window.document.querySelector('#hist-detail .retained-patch-link a');
  assert.ok(link, 'the alternate-recovery link renders for a retained-work-patch artifact');
  assert.equal(link.download, `retained-work-${ROW.id}.patch`, 'download name matches what the route prefers');
  assert.match(link.textContent, /recovery patch \(snapshot taken when the work was retained\)/);
});

// Ported from the retired test/ui-history-logs suite: the log cap and the
// copy-on-empty flash cover loadLiveLogs/copyLogToClipboard, both of which the
// Logs tab reuses unchanged.
test('the Logs tab tail-renders huge logs and says so; copy still takes everything', async () => {
  const N = 4005;
  let NDJSON = '';
  for (let i = 0; i < N; i++) {
    NDJSON += `{"source":"planner","level":"info","text":"line ${i}","ts":"2026-06-20T00:00:01Z","stepIndex":0,"cycle":1}\n`;
  }
  const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(NDJSON) });
  const sec = await openTab(ctx, 'logs');

  assert.equal(sec.querySelectorAll('.log .log-line').length, 4000, 'DOM bounded like the live card');
  assert.match(sec.querySelector('.log').textContent, /showing the last 4000 of 4005 matching lines/);
  const writes = [];
  Object.defineProperty(ctx.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async (t) => { writes.push(t); } } });
  click(ctx.window, sec.querySelector('.log-copy'));
  await settle(ctx.window);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].split('\n').length, N, 'copy is the FULL filtered set, not the tail render');
});

test('copy on a filtered-empty Logs pane flashes "nothing to copy" and leaves the clipboard alone', async () => {
  const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(LOG_NDJSON) });
  const sec = await openTab(ctx, 'logs');
  const writes = [];
  Object.defineProperty(ctx.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t) => { writes.push(t); } },
  });
  const search = sec.querySelector('.log-search');
  search.value = 'zz-no-match-zz';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));   // > LOG_SEARCH_DEBOUNCE_MS (120)
  const copyBtn = sec.querySelector('.log-copy');
  click(ctx.window, copyBtn);
  await settle(ctx.window);
  assert.equal(copyBtn.textContent, 'nothing to copy');
  assert.deepEqual(writes, [], 'clipboard untouched');
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(copyBtn.textContent, 'copy', 'label restored after the flash');
});

// P8a: V24 NULLs a retired v1 resume point, so a run can be paused/interrupted
// and still not resumable. Offering Resume would 409 (ENGINE_RETIRED).
test('Resume is hidden for a paused run whose resume point was retired', async () => {
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'paused' }],
    detail: { ...DETAIL, state: { ...DETAIL.state, status: 'interrupted', resumable: false } },
  });
  await openDetail(ctx);
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, true);
});

test('Resume is still offered when a resume point survives', async () => {
  const ctx = await bootDetail({
    rows: [{ ...ROW, status: 'paused' }],
    detail: { ...DETAIL, state: { ...DETAIL.state, status: 'paused', resumable: true } },
  });
  await openDetail(ctx);
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, false);
});

// ── frozen v1 runs: the legacy chip strip ────────────────────────────────────
// Every v1 run in History is frozen (its resume point was retired by the v2
// upgrade). The v1 column painters die with the v1 engine, so a v1 manifest
// renders an INERT chip strip instead: one chip per manifest node, label +
// duration + cost, tinted by the ledger row's status. No wires, no per-node
// click handlers, no executions footer.
const V1_STEPPER = {
  version: 1,
  steps: [
    { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
    { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Planner', color: 'violet', sub: '', cycles: false, model: '', effort: '' }] },
    { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
  ],
  feedbacks: [],
};

test('a frozen v1 run renders a legacy chip strip, never the v2 graph', async () => {
  const ctx = await bootDetail({
    detail: { ...DETAIL, state: { ...DETAIL.state, stepper: V1_STEPPER,
      steps: [{ key: 'plan', phase: 'plan', cycle: 1, status: 'done', activeMs: 120000, costUsd: 0.4 }] } },
  });
  await openDetail(ctx);
  const strip = ctx.window.document.querySelector('#hist-detail .run-strip');
  assert.ok(strip, 'the v1 strip painted');
  assert.equal(ctx.window.document.querySelector('#hist-detail .gv-world'), null, 'no v2 graph for a v1 manifest');
  // The FIRST chip is Preflight — the planner chip is addressed by its node id.
  const chip = strip.querySelector('.rchip[data-id="s0_0"]');
  assert.ok(chip, 'the planner chip exists');
  assert.ok(chip.classList.contains('is-done'), 'status tint from the step row');
  // fmtDuration(120000) === '2m 0s' (app.js:1500) — NOT '2m'.
  assert.equal(chip.textContent, 'Planner · 2m 0s · $0.40');
  // A node with no ledger row is label-only and pending.
  const pre = strip.querySelector('.rchip[data-id="preflight"]');
  assert.equal(pre.textContent, 'Preflight');
  assert.ok(pre.classList.contains('is-pending'));
  // Inert: no wires, no per-chip click handlers, no executions footer.
  assert.equal(strip.querySelector('svg, .gv-wires'), null, 'no wires');
  assert.equal(ctx.window.document.querySelector('#hist-detail .rg-execs'), null, 'no executions footer');
});
