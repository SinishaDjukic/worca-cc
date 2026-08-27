// test/ui-history-routing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for the two-screen History shell: `#history/<projectKey>/<id>`
// routes through the existing parseHash/showView machinery into the detail
// screen, and `#history` (or Back / Escape / leaving the view) returns to the
// list. We boot the REAL app.js against the REAL index.html under jsdom, stub
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

test('back to #history closes the detail screen', async () => {
  const ctx = await boot({ fetchHandler: handler });
  const shell = await openDetail(ctx);
  assert.ok(shell.classList.contains('detail-open'));

  go(ctx.window, 'history');
  await settle(ctx.window);
  assert.equal(shell.classList.contains('detail-open'), false, 'the track slides back to the list');
  // NOT asserting #hist-detail is empty here: this is the ANIMATED close path and
  // jsdom never fires `transitionend`, so the screen is emptied only by the 600ms
  // fallback timer. The INSTANT path's clearing is covered synchronously by
  // 'leaving the history view resets the track' below.
});

test('the Back button returns to the list', async () => {
  const ctx = await boot({ fetchHandler: handler });
  const shell = await openDetail(ctx);
  const back = ctx.window.document.querySelector('#hist-detail .hd-back');
  assert.ok(back, 'the detail header carries a Back button');

  back.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await settle(ctx.window);
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'history');
  assert.equal(shell.classList.contains('detail-open'), false);
});

test('Escape with the detail open and no modal navigates back', async () => {
  const ctx = await boot({ fetchHandler: handler });
  const shell = await openDetail(ctx);

  ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(ctx.window);
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'history');
  assert.equal(shell.classList.contains('detail-open'), false);
});

test('Escape is swallowed while a modal owns it', async () => {
  const ctx = await boot({ fetchHandler: handler });
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

test('workspace param routes to the workspace detail endpoint', async () => {
  const ROW2 = { ...ROW, projectKey: 'workspaces/team-a', target: 'workspace', id: 'aa11bb22' };
  const { window, calls } = await boot({ fetchHandler: handlerFor([ROW2]) });
  // parseHash keeps the inner slashes; parseHistDetailParam splits at the LAST one.
  go(window, 'history/workspaces/team-a/aa11bb22');
  await settle(window);
  assert.ok(window.document.querySelector('#hist-shell').classList.contains('detail-open'));
  assert.ok(
    calls.some((c) => c.url === '/api/workspaces/team-a/runs/aa11bb22'),
    'the workspace-aware route is used (the keyed route would 404 on a slashed key)',
  );
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

  window.document.querySelector('#hist-detail .hd-back').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'history');
});

test('deep-link boot opens the detail directly (the list still loads behind it)', async () => {
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
});

test('deep-link boot with BOTH endpoints live still upgrades the record from the stub', async () => {
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
});

test('routing into the detail paints the header meta and the branch row', async () => {
  // The routing-level guard that openHistDetail -> loadHistDetailScreen really
  // reaches the header painters (they were inert stubs while Task 3 landed). The
  // meta line's own content is pinned by test/ui-history-detail.test.mjs.
  const ctx = await boot({ fetchHandler: handler });
  await openDetail(ctx);
  const doc = ctx.window.document;
  assert.ok(doc.querySelector('#hist-detail .hd-meta').textContent.trim().length > 0,
    'the meta line is populated, not the empty template node');
  assert.equal(doc.querySelector('#hist-detail .hd-branch-copy').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .hd-archive').hidden, false,
    'a finished run offers Archive');
  assert.equal(doc.querySelector('#hist-detail .hd-resume').hidden, true,
    'a done run offers no Resume');
});

test('opening the detail moves focus to Back', async () => {
  // Spec §11, direction 1. It also has to happen AFTER the list is marked inert:
  // moving focus into a subtree is fine, but leaving document.activeElement
  // inside a freshly-inert one is not.
  const ctx = await boot({ fetchHandler: handler });
  await openDetail(ctx);
  const back = ctx.window.document.querySelector('#hist-detail .hd-back');
  assert.equal(ctx.window.document.activeElement, back,
    'focus lands on the detail screen, not on whatever the list left behind');
});

test('closing the detail restores focus to the card that opened it', async () => {
  // Spec §11, direction 2. The click must go through the CARD's own handler:
  // that is what records the return target (a deep link leaves it null and the
  // restore is skipped).
  const { window } = await boot({ fetchHandler: handler });
  go(window, 'history');
  await settle(window, 6);
  const head = window.document.querySelector('#history .hist-card .hist-head');
  assert.ok(head, 'the list painted a card to open from');

  head.dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), detailHash, 'the card navigated');

  window.document.querySelector('#hist-detail .hd-back')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  // Matched by data stamps, not by node identity: the restore re-queries the card
  // so it survives a list repaint between open and close.
  const active = window.document.activeElement;
  assert.ok(active && active.classList.contains('hist-head'),
    'focus returned to a list card head, not to <body>');
  assert.equal(active.closest('.hist-card').dataset.pipelineId, ROW.id,
    'and to the card the detail was opened from');
});

test('the closing detail is inert for the whole slide-out', async () => {
  // Its content is only removed on transitionend, so for those ~460ms `.hd-back`,
  // the tab pills and `.hd-archive` sit off-screen behind the list. `aria-hidden`
  // alone does NOT remove focusability — only `inert` does.
  const ctx = await boot({ fetchHandler: handler });
  await openDetail(ctx);
  const host = ctx.window.document.querySelector('#hist-detail');
  assert.equal(host.hasAttribute('inert'), false, 'the open screen is interactive');

  ctx.window.document.querySelector('#hist-detail .hd-back')
    .dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle(ctx.window);
  assert.equal(host.getAttribute('aria-hidden'), 'true');
  assert.equal(host.hasAttribute('inert'), true, 'and untabbable while it slides away');
  assert.ok(host.children.length > 0, 'with its content still mounted — that is the point');

  await openDetail(ctx);
  assert.equal(host.hasAttribute('inert'), false, 'reopening restores it');
});

test('leaving the history view does not park focus on a hidden list card', async () => {
  // The focus restore exists for list<->detail hops. On the instant path the whole
  // section is hidden 17 lines later, so restoring there hands focus to a node
  // inside a `display:none` subtree.
  const { window } = await boot({ fetchHandler: handler });
  go(window, 'history');
  await settle(window, 6);
  window.document.querySelector('#history .hist-card .hist-head')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);

  go(window, 'running');
  await settle(window);
  const active = window.document.activeElement;
  assert.equal(active ? active.closest('.hist-card') : null, null,
    'focus is not restored into the History list the view switch just hid');
});

test('leaving the history view resets the track', async () => {
  const ctx = await boot({ fetchHandler: handler });
  const shell = await openDetail(ctx);
  assert.ok(shell.classList.contains('detail-open'));

  go(ctx.window, 'running');
  await settle(ctx.window);
  assert.equal(shell.classList.contains('detail-open'), false);
  assert.equal(ctx.window.document.querySelector('#hist-detail').children.length, 0,
    'the instant close path empties the screen synchronously');
});
