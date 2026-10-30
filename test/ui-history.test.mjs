import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { liveRowState } from '../ui/public/runs-list.mjs';
import { runModel } from '../src/shared/run-model.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

// Behavior tests for the finished runs in the Runs list (`#runs-list .runs-row[data-kind="hist"]`,
// the History rows from GET /api/history). We boot the REAL app.js against the REAL
// index.html under jsdom, stub fetch + WebSocket, navigate to #runs (which loads
// History), and assert the rows render, link to the saved page, and show the load
// states. Card-only features (the meta segments, the diff pill) left with the card (D14).
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

// Boot app.js into a fresh jsdom window. `fetchHandler(url, opts)` may return a
// Promise to override a request; returning null falls through to the defaults.
async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(url), opts || {});
      if (r) return r;
    }
    // Default boot fetches: /api/projects returns our one project so the select
    // can be populated; /api/config benign.
    if (String(url).includes('/api/projects')) {
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

  // Select our project the way a user would: set the <select> value + dispatch
  // change. This triggers onProjectChanged -> loadHistory(PROJECT).
  function selectProject() {
    const sel = window.document.querySelector('#projectSelect');
    sel.value = PROJECT;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  // The Runs page (History's rows live in its list now).
  function showRuns() {
    window.location.hash = 'runs';
    window.dispatchEvent(new window.Event('hashchange'));
  }
  // Three macrotasks covers fetch -> safeJson -> paint for the detail load.
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

  return { window, calls, wsBox, selectProject, showRuns, settle };
}

function runsListResponse(pipelines, live = []) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });
}
const runsList = (pipelines, live = []) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });

const KEY = 'proj-0000abcd';
// MOST-SPECIFIC FIRST: the keyed detail URL /api/history/<key>/<id> has both
// /api/history and /api/history/pr as prefixes, so every arm matches with endsWith.
const armsFor = (rows, detailById) => (url) => {
  if (url.endsWith('/api/history/pr')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  for (const [id, payload] of Object.entries(detailById || {})) {
    if (url.endsWith(`/api/history/${KEY}/${id}`)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => payload });
    }
  }
  if (url.endsWith('/api/history')) return runsList(rows);
  return null;
};
const row = (over) => ({ projectKey: KEY, projectName: 'Proj', projectDir: '/x/proj', ...over });

// ---------------------------------------------------------------------------
// Row anatomy (a compact Runs row: the status dot + title + its one status line)
// ---------------------------------------------------------------------------

const histRows = (doc) => doc.querySelectorAll('#runs-list .runs-row[data-kind="hist"]');
const dotOf = (r) => r.closest('.runs-item').querySelector(':scope > .runs-pick .status-dot');

test('Runs list rows: status dot + line + title per finished run; interrupted reads Paused and is not Needs you', async () => {
  await checkRows([
    { name: 'the Runs list renders one row per finished run (no <li>): status dot + line + title', run: async () => {
      const ctx = await boot({
        fetchHandler: armsFor([
          row({ id: 'p-done', title: 'Done run', status: 'done', startedAt: '2026-01-01T00:00:00Z' }),
          row({ id: 'p-stop', title: 'Stopped run', status: 'stopped', startedAt: '2026-01-02T00:00:00Z' }),
        ]),
      });
      ctx.showRuns();
      await new Promise((r) => setTimeout(r, 0));

      const doc = ctx.window.document;
      assert.equal(histRows(doc).length, 2, 'two finished rows rendered');
      // Recent lists newest first (the stopped run started later); read each row by its id.
      const rows = ['p-done', 'p-stop'].map((id) => doc.querySelector(`#runs-list .runs-row[data-pipeline-id="${id}"]`));
      assert.equal(doc.querySelectorAll('#runs-list li').length, 0, 'no <li> emitted');

      // No status .badge pill: the one status dot (run model) carries the state, the line says it.
      assert.equal(doc.querySelectorAll('#runs-list .badge').length, 0, 'no status badge pill on a row');
      assert.equal(dotOf(rows[0]).dataset.state, 'ready', 'a done run with no PR is Ready');
      assert.match(rows[0].querySelector('.runs-row-sub').textContent, /^Ready to ship · /);
      assert.equal(dotOf(rows[1]).dataset.state, 'stopped');
      assert.match(rows[1].querySelector('.runs-row-sub').textContent, /^Stopped · /);
      assert.equal(rows[0].closest('.runs-item').querySelectorAll('.status-dot').length, 1, 'exactly one dot per row');

      // Titles surface in .runs-row-title.
      assert.equal(rows[0].querySelector('.runs-row-title').textContent, 'Done run');
      assert.equal(rows[1].querySelector('.runs-row-title').textContent, 'Stopped run');
    } },
    { name: 'interrupted reads "paused: interrupted" with the grey paused dot', run: async () => {
      const ctx = await boot({
        fetchHandler: armsFor([row({ id: 'pi', title: 'Stuck', status: 'interrupted', startedAt: '2026-06-02T00:00:00Z' })]),
      });
      ctx.showRuns();
      await new Promise((r) => setTimeout(r, 0));
      const doc = ctx.window.document;
      const r = doc.querySelector('#runs-list .runs-row[data-kind="hist"]');
      // An interrupted run can be resumed, so it reads Paused (run-model.mjs), never Failed.
      assert.equal(dotOf(r).dataset.state, 'paused');
      // The dot is decorative: the line is in the row link's own text, which names it.
      assert.equal(dotOf(r).getAttribute('aria-hidden'), 'true');
      assert.match(r.textContent, /interrupted/);
      assert.equal(doc.querySelector('#runs-list .runs-sec[data-section="needs"]'), null, 'an interrupted run is not Needs you (D5)');
    } },
  ]);
});

test('S2: a finished-unsuccessful run renders the unsuccessful dot, word and reason line', async () => {
  const REASON = 'Implement produced no changes to the worktree.';
  const ctx = await boot({
    fetchHandler: armsFor([
      row({ id: 'p-bad', title: 'Did nothing', status: 'done', successful: false, outcomeReason: REASON, startedAt: '2026-01-03T00:00:00Z' }),
    ]),
  });
  ctx.showRuns();
  await new Promise((r) => setTimeout(r, 0));
  const doc = ctx.window.document;
  const r = doc.querySelector('#runs-list .runs-row[data-pipeline-id="p-bad"]');
  assert.equal(dotOf(r).dataset.state, 'unsuccessful');
  assert.equal(dotOf(r).dataset.symbol, 'alert');
  assert.equal(r.closest('.runs-item').dataset.stateWord, 'Unsuccessful', 'the rendered row word, not just the dot');
  const sub = r.querySelector('.runs-row-sub').textContent;
  assert.match(sub, /Done · unsuccessful/);
  assert.ok(sub.includes(REASON), 'the reason sentence is on the subline');
});

test('S2: a LIVE done run flagged unsuccessful reads the unsuccessful word and dot', () => {
  // The live list item (runsLiveItem) carries the outcome at top level and on its model run.
  const it = { status: 'done', successful: false, outcomeReason: 'r', run: { status: 'done', successful: false, outcomeReason: 'r' } };
  assert.equal(liveRowState(it).word, 'Unsuccessful');
  assert.equal(runModel(it.run).state, 'unsuccessful');
});

// ---------------------------------------------------------------------------
// Navigation (the row is a link to #history/<projectKey>/<id>)
// ---------------------------------------------------------------------------


test('clicking the title opens the run page like the rest of the row (no viewer modal)', async () => {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      if (url.endsWith(`/api/history/${KEY}/p-done`)) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { phase: 'done', status: 'done' }, auditMarkdown: '# saved audit' }) });
      }
      if (url.endsWith('/api/history')) return runsList([row({ id: 'p-done', title: 'Done run', status: 'done', startedAt: '2026-01-01T00:00:00Z' })]);
      return null;
    },
  });
  ctx.showRuns();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const r = doc.querySelector('#runs-list .runs-row[data-kind="hist"]');
  assert.equal(r.getAttribute('href'), `#history/${KEY}/p-done`, 'the row is a link to the saved run');
  assert.equal(doc.getElementById('hist-shell').classList.contains('detail-open'), false, 'nothing open before the click');
  r.querySelector('.runs-row-title').dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
  await ctx.settle();

  assert.equal(ctx.window.location.hash.replace(/^#/, ''), `history/${KEY}/p-done`, 'the title is part of the row link');
  assert.ok(doc.getElementById('hist-shell').classList.contains('detail-open'), 'the saved run opened in the pane');
  assert.equal(doc.querySelector('#viewer-card').classList.contains('hidden'), true, 'no viewer modal');
});


test('empty history renders a .runs-note, a load error a .runs-note-err', async () => {
  await checkRows([
    { name: 'empty history renders a .runs-note (no <li>)', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => {
          if (url.includes('/api/history')) return runsListResponse([], []);
          return null;
        },
      });
      ctx.showRuns();
      await new Promise((r) => setTimeout(r, 0));

      const doc = ctx.window.document;
      const empty = doc.querySelector('#runs-list .runs-note');
      assert.ok(empty, '.runs-note present');
      assert.match(empty.textContent, /No runs yet/);
      assert.equal(empty.classList.contains('runs-note-err'), false, 'an empty list is not an error');
      assert.equal(histRows(doc).length, 0);
      assert.equal(doc.querySelectorAll('#runs-list li').length, 0, 'no <li> in empty state');
    } },
    { name: 'history load error renders a .runs-note-err (no <li>)', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => {
          if (url.includes('/api/history')) {
            return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
          }
          return null;
        },
      });
      ctx.showRuns();
      await new Promise((r) => setTimeout(r, 0));

      const doc = ctx.window.document;
      const err = doc.querySelector('#runs-list .runs-note-err');
      assert.ok(err, '.runs-note-err present on error');
      assert.match(err.textContent, /Could not load finished runs: boom/);
      assert.equal(doc.querySelectorAll('#runs-list li').length, 0, 'no <li> in error state');
    } },
  ]);
});
