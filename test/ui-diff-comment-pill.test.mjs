// test/ui-diff-comment-pill.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const WS_ROW = { ...ROW, id: 'w0000001', projectKey: 'workspaces/wks-team-0000abcd',
  target: 'workspace', workspaceName: 'Team', projectName: 'team' };

/** Boot straight onto the History LIST with a controllable counts payload. */
async function bootList({ rows = [ROW], counts = {} } = {}) {
  const box = { rows, counts };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return ok({ ok: true });
      if (url.endsWith('/api/diff-comments/counts')) return ok({ counts: box.counts });
      if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: false });
      if (url.endsWith('/api/budget')) return ok(okBudget());
      return null;
    },
  });
  // The skeleton cache paints before the network answers; start from a clean slate
  // so the assertions below are about the pill, not about cache replay
  // (test/ui-history-cache.test.mjs owns that behaviour).
  ctx.window.localStorage.clear();
  go(ctx.window, 'history');
  await settle(ctx.window, 8);
  ctx.cbox = box;
  return ctx;
}
// `buildHistCard` stamps `node.dataset.pipelineId` and `node.dataset.projectKey` --
// so the attribute is `data-pipeline-id`. There is NO `data-id`.
const pillOf = (doc, id) => doc.querySelector(`#history .hist-card[data-pipeline-id="${id}"] .hist-cmt-pill`);

test('the pill is hidden when a run has no unresolved comments', async () => {
  const ctx = await bootList();
  const pill = pillOf(ctx.window.document, ROW.id);
  assert.ok(pill, 'the template node exists on every card');
  assert.equal(pill.hidden, true);
});

test('the pill shows the count from /api/diff-comments/counts, keyed "<storeKey>/<id>"', async () => {
  const ctx = await bootList({ counts: { [`${KEY}/${ROW.id}`]: 3 } });
  const pill = pillOf(ctx.window.document, ROW.id);
  assert.equal(pill.hidden, false);
  assert.equal(pill.querySelector('.hist-cmt-count').textContent, '3');
  assert.equal(pill.title, '3 unresolved diff comments');
  assert.equal(pill.parentElement.className, 'hist-meta-line', 'it sits in the meta line, beside the diff pill');
});

test('the singular title is used at one', async () => {
  const ctx = await bootList({ counts: { [`${KEY}/${ROW.id}`]: 1 } });
  assert.equal(pillOf(ctx.window.document, ROW.id).title, '1 unresolved diff comment');
});

test("a workspace run's pill keys off workspaces/<id>/<runId>", async () => {
  const ctx = await bootList({ rows: [WS_ROW], counts: { [`${WS_ROW.projectKey}/${WS_ROW.id}`]: 2 } });
  const pill = pillOf(ctx.window.document, WS_ROW.id);
  assert.equal(pill.hidden, false);
  assert.equal(pill.querySelector('.hist-cmt-count').textContent, '2');
});

test('a diff-comments-changed frame repaints the pill WITHOUT reloading /api/history', async () => {
  const ctx = await bootList();
  assert.equal(pillOf(ctx.window.document, ROW.id).hidden, true);
  const historyCalls = () => ctx.calls.filter((c) => c.url.endsWith('/api/history')).length;
  const before = historyCalls();
  const countCalls = () => ctx.calls.filter((c) => c.url.endsWith('/api/diff-comments/counts')).length;
  const countsBefore = countCalls();
  ctx.cbox.counts = { [`${KEY}/${ROW.id}`]: 5 };
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'diff-comments-changed', storeKey: KEY, pipelineId: ROW.id }) });
  await settle(ctx.window, 8);
  assert.ok(countCalls() > countsBefore, 'the counts endpoint was refetched');
  assert.equal(historyCalls(), before,
    'and NOT /api/history — that response has a localStorage skeleton cache (D14)');
  const pill = pillOf(ctx.window.document, ROW.id);
  assert.equal(pill.hidden, false);
  assert.equal(pill.querySelector('.hist-cmt-count').textContent, '5');
});
