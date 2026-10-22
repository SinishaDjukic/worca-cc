// test/helpers/history-detail-boot.mjs
// The shared boot, fixtures and helpers of the History detail suites (test/ui-history-detail*.test.mjs).
// Every test imports a fresh copy of app.js (cache-busted) and node keeps each module instance, so one
// file of ~110 tests outgrew the default heap; each suite file runs in its own process.
import { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './confirm-modal.mjs';
import { useDomRelease } from './jsdom-release.mjs';
import { proposalFor } from './auto-proposal-fixture.mjs';
import { MAX_FILE_SECTION_CODE_UNITS } from '../../ui/public/diff-view.mjs';
import { MAX_HIGHLIGHT_INPUT_BYTES } from '../../ui/public/syntax-highlight.mjs';

// app.js connects at most this many source rows per step (HD_DIFF_WINDOW_LINES);
// app.js exports nothing, so the tests pin the number here.
export const WINDOW = 5000;

// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases.

export const htmlPath = fileURLToPath(new URL('../../ui/public/index.html', import.meta.url));
export const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));

export const PROJECT = '/tmp/proj';

// Each test boots a jsdom window and its own app.js instance. Release each window after its test (see
// helpers/jsdom-release.mjs); the suites are also split in three files, so no one process holds them all.
const trackDom = useDomRelease(afterEach);

// `local`: localStorage items set before app.js loads (it reads some once at import, e.g. the Runs View menu).
export async function boot({ fetchHandler, url = 'http://localhost:4317/', hljsLoader = null, hooks = null, local = null } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  trackDom(dom);
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
  if (hljsLoader || hooks) window.__worcaTestHooks = { ...(hljsLoader ? { hljsLoader } : {}), ...hooks };
  for (const [k, v] of Object.entries(local || {})) window.localStorage.setItem(k, v);

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0)); // let loadProjects/loadConfig settle

  return { window, calls, wsBox };
}

export async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

export function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

export const KEY = 'proj-alpha-abcd1234';
export const ROW = {
  id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj',
  title: 'Implement Log-UX Review Fixes', status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: 'worca-cc/log-ux-fcec04e8',
  sourceBranch: 'feat/log-ux', survived: true, added: 12, removed: 3,
  totalCostUsd: 153.21, totalActiveMs: 6000000, mtime: 1,
  pauseReason: null, retainedWork: null,
};
export const DETAIL = {
  state: {
    id: ROW.id, title: ROW.title, status: 'done', startedAt: ROW.startedAt,
    stepper: null, steps: [], subAgents: [], totalCostUsd: 153.21, totalActiveMs: 6000000,
    branch: { source: 'feat/log-ux', feature: ROW.branch, worktreeDir: '/tmp/wt' },
    prompt: 'Fix the log UX.',
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
};

export const PAUSED_DETAIL = { ...DETAIL, state: { ...DETAIL.state, status: 'paused' } };
export const COMMIT_FAILED_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    branch: {
      ...DETAIL.state.branch,
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'boom', at: '2026-08-17T21:00:00Z' },
    },
  },
};
export const RESULTS = {
  summary: {
    filesNew: 1, filesChanged: 13, filesDeleted: 0,
    linesAdded: 412, linesRemoved: 188, blockingIssues: 0, nitpicks: 0,
  },
  newFiles: [], changedFiles: [], keyThingsToCheck: [], nitpicks: [],
};

// Fresh object per test: setupDiscardWorktreeButton MUTATES the row it is handed
// (`p.retainedWork = null`), so a shared const would leak across cases.
export const retainedRow = (over = {}) => ({
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

export const DAY = 86400000;
// resetPeriod stays 'monthly' for the same reason ui-cost-paused.test.mjs:20 does.
export const okBudget = () => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
});
export const blockedBudget = () => ({ ...okBudget(), windowSpendUsd: 50, remainingUsd: 0, blocked: true });

export const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
export const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

export const DETAIL_URL = `/api/history/${KEY}/${ROW.id}`;
export const detailHash = `history/${KEY}/${ROW.id}`;

// ARM ORDER IS LOAD-BEARING (ui-history-routing.test.mjs:119-127): the detail URL
// is a PREFIX of the /log and /diff URLs, and `/api/history` is a prefix of the
// POST /api/history/pr enrichment call. Most-specific first, and every history arm
// matches with endsWith, never includes.
export function historyArms(box) {
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
export async function bootDetail({
  rows = [ROW], detail = DETAIL, budget = okBudget(), arms = null,
  deepLink = false, hljsLoader = null, hooks = null, local = null,
} = {}) {
  const box = { rows, detail, budget };
  const base = historyArms(box);
  const ctx = await boot({
    fetchHandler: (url, opts) => (arms && arms(url, opts, box)) || base(url, opts),
    url: deepLink ? `http://localhost:4317/#${detailHash}` : 'http://localhost:4317/',
    hljsLoader,
    hooks,
    local,
  });
  ctx.box = box;
  return ctx;
}

// A run opens on its glance; these tests predate it and read the Details tabs, which
// used to open on Diff when the run had results. `where` names the route: '' for the
// glance, or a Details tab.
export async function openDetail(ctx, where = 'details/diff') {
  go(ctx.window, where ? `${detailHash}/${where}` : detailHash);
  await settle(ctx.window);
}

// The authoritative list row lands (or changes) while the detail screen is open:
// `pipelines-changed` -> loadHistoryView({force:true}) -> paintHistory().
export async function deliverRows(ctx, rows) {
  ctx.box.rows = rows;
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pipelines-changed' }) });
  await settle(ctx.window, 6);
}

export const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));


// Everything the pill row can key off, at once: persisted results (Diff badge),
// two sub-agents (Agents badge), one clarify question (Clarify badge) — and, easy
// to miss, a 'live-log' artifact. The shared DETAIL fixture ships `artifacts: []`
// and the Logs tab's `visible` predicate requires a 'live-log' entry, so without
// it only FOUR tabs render and the count assertion below is simply wrong.
export const TABS_DETAIL = {
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

export const tabsOf = (doc) => [...doc.querySelectorAll('#hist-detail .hd-tab')];
export const secOf = (doc, key) => doc.querySelector(`#hist-detail .hd-sec[data-sec="${key}"]`);
export const badgeOf = (doc, key) => {
  const b = doc.querySelector(`#hist-detail .hd-tab[data-sec="${key}"] .hd-tab-badge`);
  return b ? b.textContent : null;
};

export const PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,2 +1,2 @@
 keep
-old
+new
`;

export const diffResults = (over = {}) => ({
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

export const diffDetail = (results) => ({ ...DETAIL, results });

// `arms` runs BEFORE the shared historyArms base (bootDetail:186), so returning
// null here falls through to the base's own 404 /diff arm. Only the /diff URL is
// intercepted; everything else keeps the base behavior.
export const patchArm = (body) => (url) => (
  url.endsWith('/diff') ? Promise.resolve({ ok: true, status: 200, text: async () => body }) : null
);

export const filesOf = (doc) => [...doc.querySelectorAll('#hist-detail .hd-diff-file')];
export const fileOf = (doc, path, project = '') => filesOf(doc).find((button) => (
  button.dataset.path === path && button.dataset.project === project
));
export const paneOf = (doc) => doc.querySelector('#hist-detail .hd-diff-pane');

export { confirmDialog, proposalFor, MAX_FILE_SECTION_CODE_UNITS, MAX_HIGHLIGHT_INPUT_BYTES };
