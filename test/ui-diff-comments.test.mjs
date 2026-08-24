// test/ui-diff-comments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

async function boot({ fetchHandler, url = 'http://localhost:4317/', hljsLoader = null } = {}) {
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
  if (hljsLoader) window.__worcaTestHooks = { hljsLoader };

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
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

const DAY = 86400000;
// resetPeriod stays 'monthly' for the same reason ui-cost-paused.test.mjs:20 does.
const okBudget = () => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
});
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
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

const diffDetail = (results) => ({ ...DETAIL, results });

// Arm order is load-bearing: the detail URL is a PREFIX of /log, /diff and
// /comments, so match on the full suffix, most specific first. Returning null
// falls through to historyArms.
function armsFor(box) {
  return (url, opts) => {
    const method = opts.method || 'GET';
    if (/\/comments\/dc_[0-9a-f]{8}$/.test(url) && method === 'PATCH') { box.calls.push(['PATCH', url, opts.body]); return ok({ comment: {} }); }
    if (/\/comments\/dc_[0-9a-f]{8}$/.test(url) && method === 'DELETE') { box.calls.push(['DELETE', url]); return ok({ ok: true }); }
    if (url.endsWith('/comments') && method === 'POST') { box.calls.push(['POST', url, opts.body]); return ok({ comment: {} }); }
    if (url.endsWith('/comments')) return ok({ comments: box.comments, patchAvailable: box.patchAvailable });
    // refreshCommentCounts() fires on load and on every poke. Armed so it cannot
    // fall through to boot()'s catch-all (which answers with the CONFIG payload)
    // and muddy ctx.calls.
    if (url.endsWith('/api/diff-comments/counts')) return ok({ counts: box.counts });
    // The Ask panel mounts with the app and openSheet() hits its thread endpoints.
    // Answer them blandly so the hand-off case does not depend on the chat API.
    if (url.includes('/api/ask/threads') && method === 'POST') return ok({ thread: { id: 'ask_00000001', title: null } });
    if (url.includes('/api/ask/')) return ok({ threads: [], thread: { id: 'ask_00000001', title: null }, messages: [], runLinks: [], attachments: [], worktrees: [], inFlight: null });
    if (url.endsWith('/diff')) return Promise.resolve({ ok: true, status: 200, text: async () => box.patch });
    return null;
  };
}

// `results` must be non-null or there is no Diff tab at all (the guard is
// `if (!results)` — falsy, so `{}` would NOT take the empty branch, but it would
// produce no file rows either). `changedFiles` is what hdDiffFileRows turns into
// the file list, so it has to name the fixture's paths.
const cmtResults = (files) => ({
  summary: { filesNew: 0, filesChanged: files.length, filesDeleted: 0, linesAdded: 2, linesRemoved: 1, blockingIssues: 0, nitpicks: 0 },
  newFiles: [], changedFiles: files, keyThingsToCheck: [], nitpicks: [],
});
const A_JS = [{ path: 'src/a.js', status: 'M', added: 2, removed: 1 }];
const BIG_JS = [{ path: 'big.js', status: 'M', added: 3000, removed: 0 }];
const BIN_FILES = [{ path: 'logo.png', status: 'M', binary: true }];

// Rows: ctx(old 1/new 1) del(old 2) add(new 2) add(new 3) ctx(old 3/new 4).
const CMT_PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@
 keep
-old
+new
+added
 line3
`;
const BIN_PATCH = 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n';

// 3 000 rows x 208 code units = 624 000 > MAX_FILE_SECTION_CODE_UNITS (500 000).
// The cap slices the RAW section text BEFORE parsing, so the tail rows never become
// DOM and `truncated` is set. ~2 400 rows survive — under HD_DIFF_WINDOW_LINES, so
// there is no show-more row to confuse this case.
const capPatch = () => {
  const lines = Array.from({ length: 3_000 }, (_, i) => `+${String(i + 1).padStart(5, '0')} ${'x'.repeat(200)}`).join('\n');
  return `diff --git a/big.js b/big.js\n--- a/big.js\n+++ b/big.js\n@@ -0,0 +1,3000 @@\n${lines}\n`;
};

// The 6 000-row fixture the two WINDOWING cases share: one hunk, no truncation,
// so HD_DIFF_WINDOW_LINES (5 000) really does leave row 5 500 out of the DOM
// until "Show more" is clicked.
const bigPatch = () => {
  const lines = Array.from({ length: 6000 }, (_, i) => `+line ${i + 1}`).join('\n');
  return `diff --git a/big.js b/big.js\n--- a/big.js\n+++ b/big.js\n@@ -0,0 +1,6000 @@\n${lines}\n`;
};

const cmt = (over = {}) => ({ id: 'dc_00000001', path: 'src/a.js', projectKey: null, side: 'new', line: 2,
  lineText: 'new', body: 'please add a test', author: 'user', resolved: false, resolvedAt: null,
  sentRunId: null, createdAt: '2026-08-26T10:00:00.000Z', ...over });

const hover = (window, row) => row.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
const keydown = (window, node, key, init = {}) => node.dispatchEvent(
  new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

/** The one boot every project-run case uses. `box` stays mutable so a poke can
 *  change the comment set between renders. 8 ticks, not 3: buildHdDiff paints the
 *  file list from `results` first and repaints after the SECOND fetch
 *  (ensureComments) lands, so a synthetic row appears one round trip late. */
async function bootComments({ patch = CMT_PATCH, files = A_JS, comments = [], patchAvailable = true, counts = {} } = {}) {
  const box = { patch, comments, patchAvailable, counts, calls: [] };
  const ctx = await bootDetail({ detail: diffDetail(cmtResults(files)), arms: armsFor(box) });
  await openDetail(ctx);
  await settle(ctx.window, 8);
  ctx.cbox = box;
  return ctx;
}

const WS_KEY = 'workspaces/wks-team-0000abcd';
const WS_ROW = { ...ROW, projectKey: WS_KEY, target: 'workspace', workspaceName: 'Team', projectName: 'team' };
const WS_URL = `/api/workspaces/wks-team-0000abcd/runs/${ROW.id}`;
const WS_HASH = `history/${WS_KEY}/${ROW.id}`;
// The '# <key>' marker is what makes splitPatchSections stamp `project` on the
// section, and results.perProject is what makes hdDiffFileRows stamp it on the
// file row. Both are needed, and they must agree.
const WS_PATCH = `# team-00000001\n${CMT_PATCH}`;
const wsResults = () => ({
  summary: { filesNew: 0, filesChanged: 1, filesDeleted: 0, linesAdded: 2, linesRemoved: 1, blockingIssues: 0, nitpicks: 0 },
  newFiles: [], changedFiles: [], keyThingsToCheck: [], nitpicks: [],
  perProject: { 'team-00000001': { newFiles: [], changedFiles: [{ path: 'src/a.js', status: 'M', added: 2, removed: 1 }] } },
});

async function bootWsComments() {
  const box = { comments: [], calls: [] };
  const ctx = await bootDetail({
    rows: [WS_ROW],
    detail: { ...DETAIL, results: wsResults() },
    arms: (url, opts, b) => {
      const method = opts.method || 'GET';
      if (url.endsWith(`${WS_URL}/comments`) && method === 'POST') { box.calls.push(['POST', url, opts.body]); return ok({ comment: {} }); }
      if (url.endsWith(`${WS_URL}/comments`)) return ok({ comments: box.comments, patchAvailable: true });
      if (url.endsWith('/api/diff-comments/counts')) return ok({ counts: {} });
      if (url.endsWith(`${WS_URL}/diff`)) return Promise.resolve({ ok: true, status: 200, text: async () => WS_PATCH });
      if (url.endsWith(WS_URL)) return ok(b.detail);   // AFTER the two suffixes above
      return null;
    },
  });
  go(ctx.window, WS_HASH);
  await settle(ctx.window, 8);
  ctx.cbox = box;
  return ctx;
}

test('hovering a row arms the + button; Cmd+Enter POSTs the exact anchor', async () => {
  const ctx = await bootComments();
  const { window } = ctx;
  const doc = window.document;
  assert.equal(doc.querySelector('.hd-cmt-add'), null, 'nothing is armed before a hover');
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  const btn = doc.querySelector('.hd-cmt-add');
  assert.ok(btn, 'armed on hover');
  assert.equal(btn.parentElement.className, 'hd-dl-code',
    'in the code cell, NEVER in .hd-dl-src — hdApplyHighlights replaceChildren()s that span');
  click(window, btn);
  const ta = doc.querySelector('.hd-cmt-input');
  assert.ok(ta, 'the composer opened under the row');
  assert.equal(ta.closest('.hd-cmt-block').previousElementSibling.dataset.new, '2');
  ta.value = 'please add a test';
  keydown(window, ta, 'Enter', { metaKey: true });
  await settle(window, 8);
  const posts = ctx.cbox.calls.filter((c) => c[0] === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0][1], `/api/history/${KEY}/${ROW.id}/comments`);
  assert.deepEqual(JSON.parse(posts[0][2]),
    { path: 'src/a.js', side: 'new', line: 2, body: 'please add a test' },
    'no `project` key at all on a single-project run (D4)');
  assert.equal(doc.querySelector('.hd-cmt-input'), null, 'the composer closed on success');
});

test('the + button refuses to arm on a row with no number on either side', async () => {
  // An unparseable @@ header leaves every row with oldNo === newNo === null, and
  // hdDiffRow stamps data-old/-new as '' — not anchorable, so no affordance.
  const broken = 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ nonsense @@\n+one\n';
  const ctx = await bootComments({ patch: broken });
  const { window } = ctx;
  const row = window.document.querySelector('.hd-dl-row');
  assert.ok(row, 'the row still renders');
  assert.equal(row.dataset.new, '');
  hover(window, row);
  assert.equal(window.document.querySelector('.hd-cmt-add'), null);
});

test('Cancel closes the composer without POSTing', async () => {
  const ctx = await bootComments();
  const { window } = ctx;
  const doc = window.document;
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  click(window, doc.querySelector('.hd-cmt-add'));
  doc.querySelector('.hd-cmt-input').value = 'never sent';
  click(window, doc.querySelector('.hd-cmt-cancel'));
  await settle(window);
  assert.equal(doc.querySelector('.hd-cmt-input'), null, 'the composer closed');
  assert.equal(ctx.cbox.calls.length, 0, 'Cancel never POSTs');
});

// THE regression test for the Escape guard / D20. The handler that would navigate
// away is registered on `document` in the CAPTURE phase, so the event must be
// dispatched on the TEXTAREA and allowed to bubble — dispatching on `document`
// would make `e.target` the document and the `.hd-cmt-composer` guard would
// (correctly) not match.
test('Esc closes the composer and does NOT leave the detail screen', async () => {
  const ctx = await bootComments();
  const { window } = ctx;
  const doc = window.document;
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  click(window, doc.querySelector('.hd-cmt-add'));
  const ta = doc.querySelector('.hd-cmt-input');
  assert.ok(ta, 'the composer opened');
  ta.value = 'a draft nobody wants to lose';
  const hashBefore = window.location.hash;
  keydown(window, ta, 'Escape');
  await settle(window);
  assert.equal(doc.querySelector('.hd-cmt-input'), null, 'the composer closed');
  assert.equal(window.location.hash, hashBefore, 'still on the detail screen — the capture guard held');
  assert.ok(doc.querySelector('#hist-detail .hd-diff-body'), 'the diff is still rendered');
  assert.equal(ctx.cbox.calls.length, 0, 'Esc never POSTs');
});

test('Esc with no composer open still leaves the detail screen (the guard is scoped)', async () => {
  const ctx = await bootComments();
  const { window } = ctx;
  keydown(window, window.document.querySelector('#hist-detail .hd-diff-pane'), 'Escape');
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'history', 'the existing behaviour is untouched');
});

test('comments render as cards under their row, stacked in creation order', async () => {
  const ctx = await bootComments({ comments: [
    cmt({ id: 'dc_00000001', body: 'first' }),
    cmt({ id: 'dc_00000002', body: 'second', author: 'ask' }),
    cmt({ id: 'dc_00000003', side: 'old', line: 2, lineText: 'old', body: 'on the deleted line' }),
  ] });
  const doc = ctx.window.document;
  const block = doc.querySelector('.hd-dl-row[data-new="2"]').nextElementSibling;
  assert.ok(block.classList.contains('hd-cmt-block'), 'a SIBLING div, never inside the row (display:contents)');
  assert.deepEqual([...block.querySelectorAll('.hd-cmt-body')].map((n) => n.textContent), ['first', 'second'],
    'server order is preserved — no client re-sort');
  assert.deepEqual([...block.querySelectorAll('.hd-cmt-author')].map((n) => n.textContent), ['User', 'Ask']);
  assert.equal(block.querySelector('.hd-cmt-time').textContent, '2026-08-26 10:00');
  const del = doc.querySelector('.hd-dl-row[data-old="2"]');
  assert.equal(del.nextElementSibling.querySelector('.hd-cmt-body').textContent, 'on the deleted line',
    'the old-side anchor lands on the DELETED row, not the added one');
  assert.equal(doc.querySelector('.hd-cmt-detached'), null, 'every anchor rendered, so no detached block');
});

test('a comment whose sent_run_id is set shows the "sent to #<runId>" marker', async () => {
  const ctx = await bootComments({ comments: [cmt({ sentRunId: 'abcd1234' })] });
  assert.equal(ctx.window.document.querySelector('.hd-cmt-sent').textContent, 'sent to #abcd1234');
});

test('Resolve PATCHes {resolved:true} and the card dims; Reopen PATCHes {resolved:false}', async () => {
  const ctx = await bootComments({ comments: [cmt()] });
  const { window } = ctx;
  const doc = window.document;
  const card = () => doc.querySelector('[data-comment-id="dc_00000001"]');
  assert.equal(card().querySelector('.hd-cmt-resolve').textContent, 'Resolve');
  assert.equal(card().classList.contains('resolved'), false);
  ctx.cbox.comments = [cmt({ resolved: true, resolvedAt: '2026-08-26T11:00:00.000Z' })];
  click(window, card().querySelector('.hd-cmt-resolve'));
  await settle(window, 8);
  const patches = () => ctx.cbox.calls.filter((c) => c[0] === 'PATCH');
  assert.equal(patches()[0][1], `/api/history/${KEY}/${ROW.id}/comments/dc_00000001`);
  assert.deepEqual(JSON.parse(patches()[0][2]), { resolved: true });
  assert.ok(card().classList.contains('resolved'), 'repainted dimmed');
  assert.equal(card().querySelector('.hd-cmt-tag').textContent, 'Resolved');
  assert.equal(card().querySelector('.hd-cmt-resolve').textContent, 'Reopen');
  ctx.cbox.comments = [cmt()];
  click(window, card().querySelector('.hd-cmt-resolve'));
  await settle(window, 8);
  assert.equal(patches().length, 2);
  assert.deepEqual(JSON.parse(patches()[1][2]), { resolved: false });
  assert.equal(card().classList.contains('resolved'), false, 'reopened');
});

test('Delete confirms via confirmModal and only then DELETEs', async () => {
  const ctx = await bootComments({ comments: [cmt()] });
  const { window } = ctx;
  const doc = window.document;
  click(window, doc.querySelector('.hd-cmt-delete'));
  await settle(window);
  // confirmModal's real options are {title, message, confirmLabel, cancelLabel,
  // checkbox, danger}. `body`/`confirmText` do not exist and would render an EMPTY
  // modal — that is exactly what this assertion catches.
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false, 'the modal is up');
  assert.equal(doc.querySelector('#confirm-title').textContent, 'Delete this comment?');
  assert.match(doc.querySelector('#confirm-message').textContent, /cannot be recovered/);
  assert.equal(doc.querySelector('#confirm-ok').textContent, 'Delete');
  assert.ok(doc.querySelector('#confirm-ok').classList.contains('danger'));
  assert.equal(ctx.cbox.calls.length, 0, 'nothing is sent before the user confirms');
  ctx.cbox.comments = [];
  doc.querySelector('#confirm-ok').click();      // the ui-history-detail.test.mjs precedent
  await settle(window, 8);
  assert.deepEqual(ctx.cbox.calls.map((c) => c[0]), ['DELETE']);
  assert.equal(doc.querySelector('[data-comment-id="dc_00000001"]'), null, 'gone after the repaint');
});

test('a comment whose row is outside the first window attaches when Show more connects it', async () => {
  const ctx = await bootComments({ patch: bigPatch(), files: BIG_JS,
    comments: [cmt({ path: 'big.js', line: 5500, lineText: 'line 5500', body: 'late row' })] });
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('.hd-cmt-block [data-comment-id="dc_00000001"]'), null, 'row not connected yet');
  assert.equal(doc.querySelectorAll('.hd-cmt-detached [data-comment-id]').length, 1, 'shown detached meanwhile');
  click(ctx.window, doc.querySelector('.hd-dl-more-btn'));
  await settle(ctx.window, 8);
  const card = doc.querySelector('.hd-cmt-block [data-comment-id="dc_00000001"]');
  assert.ok(card, 'attached when its window materialized');
  assert.ok(card.closest('.hd-cmt-block').previousElementSibling.matches('.hd-dl-row[data-new="5500"]'),
    'directly under its own row');
  assert.equal(doc.querySelector('.hd-cmt-detached'), null, 'the detached copy is gone, never doubled');
});

test('a comment past the 500k parse cap renders detached, below "(large file — diff truncated)"', async () => {
  const ctx = await bootComments({ patch: capPatch(), files: BIG_JS,
    comments: [cmt({ path: 'big.js', line: 2999, lineText: 'a line the parser never reached', body: 'past the cap' })] });
  const doc = ctx.window.document;
  const body = doc.querySelector('.hd-diff-body');
  assert.ok(body.querySelector('.hd-diff-trunc'), 'precondition: the section really was truncated');
  assert.equal(doc.querySelector('.hd-dl-row[data-new="2999"]'), null, 'precondition: that row is not in the DOM');
  const detached = body.querySelector(':scope > .hd-cmt-detached');
  assert.ok(detached, 'the comment is never dropped — this is what line_text exists for');
  assert.equal(body.lastElementChild, detached, 'below the truncation note, which stays last among the diff rows');
  assert.equal(detached.querySelector('.hd-cmt-where').textContent, 'big.js:2999 (new)');
  assert.equal(detached.querySelector('.hd-cmt-quote').textContent, 'a line the parser never reached');
  assert.equal(detached.querySelector('.hd-cmt-body').textContent, 'past the cap');
  assert.ok(detached.querySelector('.hd-cmt-resolve') && detached.querySelector('.hd-cmt-delete')
    && detached.querySelector('.hd-cmt-ask'), 'the full action set, exactly like an attached card');
});

test('a binary section shows "(no textual diff for this file)" plus the detached cards', async () => {
  const ctx = await bootComments({ patch: BIN_PATCH, files: BIN_FILES,
    comments: [cmt({ path: 'logo.png', line: 1, lineText: '', body: 'wrong asset' })] });
  const doc = ctx.window.document;
  const body = doc.querySelector('.hd-diff-body');
  // splitPatchSections still gives a binary section a path (from the diff --git
  // header), so it IS in patchIndex; the refusal comes from parseFileSection().binary.
  assert.equal(body.querySelector('.hd-diff-note').textContent, '(no textual diff for this file)');
  assert.equal(body.querySelectorAll('.hd-cmt-detached [data-comment-id]').length, 1);
  hover(ctx.window, body);
  assert.equal(doc.querySelector('.hd-cmt-add'), null, 'no anchorable rows, so nothing to arm');
});

test('a path absent from the patch gets a synthetic file row that carries its badge', async () => {
  const ctx = await bootComments({ comments: [
    cmt(),
    cmt({ id: 'dc_00000002', path: 'ghost/gone.js', line: 7, lineText: 'gone', body: 'about a file not in this patch' }),
  ] });
  const doc = ctx.window.document;
  const ghost = [...doc.querySelectorAll('#hist-detail .hd-diff-file')].find((b) => b.dataset.path === 'ghost/gone.js');
  assert.ok(ghost, 'a synthetic row appeared for the orphan path');
  assert.equal(ghost.querySelector('.hd-cmt-badge').textContent, '1');
  assert.equal(ghost.querySelector('.hd-diff-counts').textContent, '',
    'no bogus "+0 −0" — the synthetic entry carries {path} and nothing else');
  click(ctx.window, ghost);
  await settle(ctx.window, 8);
  const body = doc.querySelector('.hd-diff-body');
  assert.equal(body.querySelector('.hd-diff-note').textContent, '(no textual diff for this file)');
  assert.equal(body.querySelector('.hd-cmt-detached .hd-cmt-body').textContent, 'about a file not in this patch');
});

test('patchAvailable:false disables the + button but keeps Resolve, Delete and Ask Worca', async () => {
  // The /diff arm still serves a patch, so rows render; only the comments
  // endpoint reports the artifact gone. canCreate() is driven solely by
  // patchAvailable, which is the whole point of the flag.
  const ctx = await bootComments({ patchAvailable: false, comments: [cmt()] });
  const { window } = ctx;
  const doc = window.document;
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  assert.equal(doc.querySelector('.hd-cmt-add'), null, 'creation is off when the run has no stored diff');
  const card = doc.querySelector('[data-comment-id="dc_00000001"]');
  assert.ok(card.querySelector('.hd-cmt-resolve'), 'resolve still works');
  assert.ok(card.querySelector('.hd-cmt-delete'), 'delete still works');
  assert.ok(card.querySelector('.hd-cmt-ask'), 'Ask Worca still works');
});

test('the file-list badge counts UNRESOLVED comments only, detached ones included', async () => {
  const ctx = await bootComments({ patch: capPatch(), files: BIG_JS, comments: [
    cmt({ id: 'dc_00000001', path: 'big.js', line: 1, lineText: 'l1', body: 'attached, open' }),
    cmt({ id: 'dc_00000002', path: 'big.js', line: 2, lineText: 'l2', body: 'attached, resolved',
      resolved: true, resolvedAt: '2026-08-26T11:00:00.000Z' }),
    cmt({ id: 'dc_00000003', path: 'big.js', line: 2999, lineText: 'past the cap', body: 'detached, open' }),
  ] });
  const doc = ctx.window.document;
  const btn = [...doc.querySelectorAll('#hist-detail .hd-diff-file')].find((b) => b.dataset.path === 'big.js');
  const badge = btn.querySelector('.hd-cmt-badge');
  assert.equal(badge.textContent, '2', 'the resolved one is excluded; the detached one is NOT');
  assert.equal(badge.title, '2 unresolved comments');
  assert.equal(btn.lastElementChild, badge, 'painted after renderFileTree, whose counts slot is one-shot');
});

test('a diff-comments-changed frame for THIS run repaints in place; one for another run is ignored', async () => {
  const ctx = await bootComments();
  const before = ctx.calls.filter((c) => c.url.endsWith('/comments')).length;
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'diff-comments-changed', storeKey: 'other-00000009', pipelineId: 'ffffffff' }) });
  await settle(ctx.window, 6);
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/comments')).length, before, 'another run: no refetch');
  ctx.cbox.comments = [cmt({ author: 'ask', body: 'from the assistant' })];
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'diff-comments-changed', storeKey: KEY, pipelineId: ROW.id }) });
  await settle(ctx.window, 8);
  assert.ok(ctx.calls.filter((c) => c.url.endsWith('/comments')).length > before, 'this run: refetched');
  assert.ok(ctx.window.document.querySelector('[data-comment-id="dc_00000001"]'), 'card rendered in place');
});

test('a poke never re-fetches /diff and never resets the window cursor', async () => {
  const ctx = await bootComments({ patch: bigPatch(), files: BIG_JS });
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('.hd-dl-more-btn'));      // expand to window 2
  await settle(ctx.window, 8);
  const expanded = doc.querySelectorAll('.hd-dl-row').length;
  assert.ok(expanded > 5000, 'precondition: two windows are connected');
  ctx.cbox.comments = [cmt({ path: 'big.js', line: 12, lineText: 'line 12', body: 'from the assistant', author: 'ask' })];
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'diff-comments-changed', storeKey: KEY, pipelineId: ROW.id }) });
  await settle(ctx.window, 8);
  assert.equal(doc.querySelectorAll('.hd-dl-row').length, expanded, 'the window cursor survived the poke (D18)');
  assert.ok(doc.querySelector('.hd-cmt-block [data-comment-id="dc_00000001"]'), 'the card landed in place');
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/diff')).length, 1, 'the patch itself is never refetched');
});

test('a poke never destroys an open composer draft', async () => {
  const ctx = await bootComments();
  const { window } = ctx;
  const doc = window.document;
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  click(window, doc.querySelector('.hd-cmt-add'));
  doc.querySelector('.hd-cmt-input').value = 'half-written';
  ctx.cbox.comments = [cmt({ author: 'ask', body: 'landed while typing' })];
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'diff-comments-changed', storeKey: KEY, pipelineId: ROW.id }) });
  await settle(window, 8);
  assert.equal(doc.querySelector('.hd-cmt-input').value, 'half-written',
    'repaintCards skips any block with data-composer="1"');
  assert.ok(doc.querySelector('[data-comment-id="dc_00000001"]'), 'and the new card still arrived');
});

test('workspace runs POST the member project taken from the rendered section', async () => {
  const ctx = await bootWsComments();
  const { window } = ctx;
  const doc = window.document;
  const file = doc.querySelector('#hist-detail .hd-diff-file');
  assert.equal(file.dataset.project, 'team-00000001', 'the member key reached the file row');
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  click(window, doc.querySelector('.hd-cmt-add'));
  doc.querySelector('.hd-cmt-input').value = 'member note';
  click(window, doc.querySelector('.hd-cmt-save'));
  await settle(window, 8);
  const post = ctx.cbox.calls.find((c) => c[0] === 'POST');
  assert.equal(post[1], `${WS_URL}/comments`,
    'the TWIN route — the /api/history :key regex forbids the slash in "workspaces/<id>" (D8)');
  assert.deepEqual(JSON.parse(post[2]),
    { project: 'team-00000001', path: 'src/a.js', side: 'new', line: 2, body: 'member note' },
    'the member is explicit, taken from the section that was rendered — never inferred (D4)');
});

test("the card's Ask Worca button appends the exact reference and sends nothing", async () => {
  // askPanel is a module-local `let` with no test seam, so this reads the mounted
  // panel's real textarea — the test/ui-ask-integration.test.mjs precedent — rather
  // than spying on appendToComposer, which nothing can reach.
  const ctx = await bootComments({ comments: [
    cmt(),
    cmt({ id: 'dc_00000002', line: 3, lineText: 'added', body: 'and this one' }),
  ] });
  const { window } = ctx;
  const doc = window.document;
  click(window, doc.querySelector('[data-comment-id="dc_00000001"] .hd-cmt-ask'));
  await settle(window, 6);
  const ta = doc.querySelector('.ask-input');
  assert.ok(ta, 'the Ask panel is mounted by the app boot');
  assert.equal(ta.value, '[diff comment dc_00000001 — src/a.js:2 (new)] "please add a test"');
  click(window, doc.querySelector('[data-comment-id="dc_00000002"] .hd-cmt-ask'));
  await settle(window, 6);
  assert.deepEqual(ta.value.split('\n'), [
    '[diff comment dc_00000001 — src/a.js:2 (new)] "please add a test"',
    '[diff comment dc_00000002 — src/a.js:3 (new)] "and this one"',
  ], 'they stack, one per line, so the user can send several at once');
  assert.equal(ctx.calls.filter((c) => (c.opts.method || 'GET') === 'POST' && c.url.includes('/messages')).length, 0,
    'append never sends');
});

const SECRET_FILES = [{ path: 'src/a.js', status: 'M', added: 2, removed: 1 },
  { path: 'config/.env', status: 'M', added: 1, removed: 1 }];
const SECRET_PATCH = `${CMT_PATCH}diff --git a/config/.env b/config/.env
--- a/config/.env
+++ b/config/.env
@@ -1 +1 @@
-A=1
+A=2
`;
// `protectedPaths` is what the server computes with protectedSectionKeys(); a
// single-project run keys sections by the bare path.
const guardedArms = (box) => (url, opts) => {
  if (url.endsWith('/comments') && (opts.method || 'GET') === 'GET') {
    return ok({ comments: box.comments, patchAvailable: true, protectedPaths: box.protectedPaths });
  }
  return armsFor(box)(url, opts);
};
const guardedBox = () => ({ patch: SECRET_PATCH, comments: [], patchAvailable: true, counts: {},
  calls: [], protectedPaths: ['config/.env'] });

test('a protected file renders, says so, and never arms the + (the floor would refuse it)', async () => {
  const box = guardedBox();
  const ctx = await bootDetail({ detail: diffDetail(cmtResults(SECRET_FILES)), arms: guardedArms(box) });
  await openDetail(ctx);
  await settle(ctx.window, 8);
  const { window } = ctx;
  const doc = window.document;
  const secret = [...doc.querySelectorAll('#hist-detail .hd-diff-file')].find((b) => b.dataset.path === 'config/.env');
  assert.ok(secret, 'the file is NEVER hidden — the run really did change it');
  click(window, secret);
  await settle(window, 8);
  assert.ok(doc.querySelector('.hd-dl-row'), 'and its diff still renders');
  const chip = doc.querySelector('.hd-diff-pane-head .hd-diff-guarded');
  assert.ok(chip, 'the pane head says why the gutter is missing');
  assert.match(chip.title, /\*\.key/, 'and the tooltip admits the rule is a basename match');
  hover(window, doc.querySelector('.hd-dl-row[data-new="1"]'));
  assert.equal(doc.querySelector('.hd-cmt-add'), null, 'no + on a file the floor always rejects');
});

test('an ordinary file in the same run is unaffected', async () => {
  const box = guardedBox();
  const ctx = await bootDetail({ detail: diffDetail(cmtResults(SECRET_FILES)), arms: guardedArms(box) });
  await openDetail(ctx);
  await settle(ctx.window, 8);
  const { window } = ctx;
  const doc = window.document;
  click(window, [...doc.querySelectorAll('#hist-detail .hd-diff-file')].find((b) => b.dataset.path === 'src/a.js'));
  await settle(window, 8);
  assert.equal(doc.querySelector('.hd-diff-pane-head .hd-diff-guarded'), null, 'no chip on src/a.js');
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  assert.ok(doc.querySelector('.hd-cmt-add'), 'the + is still there');
});

test('a failed comment load disarms the +, and the next poke brings it back', async () => {
  const box = { patch: CMT_PATCH, comments: [], patchAvailable: true, counts: {}, calls: [], fail: true };
  const arms = (url, opts) => {
    if (url.endsWith('/comments') && (opts.method || 'GET') === 'GET' && box.fail) {
      box.fail = false;                     // one blip, then the endpoint recovers
      return fail(500, { error: 'boom' });
    }
    return armsFor(box)(url, opts);
  };
  const ctx = await bootDetail({ detail: diffDetail(cmtResults(A_JS)), arms });
  await openDetail(ctx);
  await settle(ctx.window, 8);
  const { window } = ctx;
  const doc = window.document;
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  assert.equal(doc.querySelector('.hd-cmt-add'), null, 'the failed fetch left creation off');
  box.comments = [cmt({ author: 'ask', body: 'landed anyway' })];
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'diff-comments-changed', storeKey: KEY, pipelineId: ROW.id }) });
  await settle(window, 8);
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  assert.ok(doc.querySelector('.hd-cmt-add'), 'the retried fetch re-armed the gutter WITHOUT a re-select');
  assert.ok(doc.querySelector('[data-comment-id="dc_00000001"]'), 'and the card arrived too');
});

test('re-arming is idempotent: one + button, one composer', async () => {
  const ctx = await bootComments({ comments: [cmt()] });
  const { window } = ctx;
  const doc = window.document;
  ctx.cbox.comments = [cmt(), cmt({ id: 'dc_00000002', line: 3, lineText: 'added', body: 'second' })];
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'diff-comments-changed', storeKey: KEY, pipelineId: ROW.id }) });
  await settle(window, 8);
  hover(window, doc.querySelector('.hd-dl-row[data-new="2"]'));
  assert.equal(doc.querySelectorAll('.hd-cmt-add').length, 1, 'one gutter button, not one per repaint');
  click(window, doc.querySelector('.hd-cmt-add'));
  assert.equal(doc.querySelectorAll('.hd-cmt-input').length, 1, 'and one composer per click');
});
