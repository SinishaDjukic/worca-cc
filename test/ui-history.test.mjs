import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for Task 5: the expandable .hist-card History view. We boot the
// REAL app.js against the REAL index.html under jsdom, stub fetch + WebSocket,
// drive the History load via the same path the app uses (select a project ->
// onProjectChanged -> loadHistory; navigate to #history), and assert the cards
// render, expand, and tint from the lazily-fetched saved state.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

// Boot app.js into a fresh jsdom window. `fetchHandler(url, opts)` may return a
// Promise to override a request; returning null falls through to the defaults.
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
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
  function showHistory() {
    window.location.hash = 'history';
    window.dispatchEvent(new window.Event('hashchange'));
  }
  // The card no longer expands — open the run's DETAIL screen (#history/<key>/<id>).
  function showDetail(key, id) {
    window.location.hash = `history/${key}/${id}`;
    window.dispatchEvent(new window.Event('hashchange'));
  }
  // Three macrotasks covers fetch -> safeJson -> paint for the detail load.
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

  return { window, calls, wsBox, selectProject, showHistory, showDetail, settle };
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
// Card anatomy (the v2 list card: icon + title + meta line + branch row)
// ---------------------------------------------------------------------------

test('history renders 2 .hist-card divs (no <li>), status icon + word, nav count=2', async () => {
  const ctx = await boot({
    fetchHandler: armsFor([
      row({ id: 'p-done', title: 'Done run', status: 'done', startedAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'p-stop', title: 'Stopped run', status: 'stopped', startedAt: '2026-01-02T00:00:00Z' }),
    ]),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const cards = doc.querySelectorAll('#history .hist-card');
  assert.equal(cards.length, 2, 'two history cards rendered');
  assert.equal(doc.querySelectorAll('#history li').length, 0, 'no <li> emitted');

  // The status .badge is gone: the icon carries the family, the word the label.
  assert.equal(doc.querySelectorAll('#history .badge:not(.hist-retained-badge)').length, 0,
    'the status badge pill was replaced by the icon + word');
  assert.ok(cards[0].querySelector('.hist-sic').classList.contains('st-done'), 'done -> green check family');
  assert.equal(cards[0].querySelector('.hist-status-word').textContent, 'Done');
  assert.ok(cards[0].querySelector('.hist-status-word').classList.contains('st-done'));
  assert.ok(cards[1].querySelector('.hist-sic').classList.contains('st-stopped'), 'stopped -> red square family');
  assert.equal(cards[1].querySelector('.hist-status-word').textContent, 'Stopped');
  // Exactly one glyph is shown per family.
  const shown = [...cards[0].querySelectorAll('.hist-sic .sic')].filter((s) => !s.hasAttribute('hidden'));
  assert.deepEqual(shown.map((s) => s.getAttribute('class')), ['sic sic-done']);

  // Titles surface in .h-meta b (a cross-file contract).
  assert.equal(cards[0].querySelector('.h-meta b').textContent, 'Done run');

  assert.equal(doc.querySelector('#nav-history-count').textContent, '2', 'nav count reflects rendered cards');
});

test('interrupted lands in the amber paused family with the word "Interrupted"', async () => {
  const ctx = await boot({
    fetchHandler: armsFor([row({ id: 'pi', title: 'Stuck', status: 'interrupted', startedAt: '2026-06-02T00:00:00Z' })]),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = ctx.window.document.querySelector('#history .hist-card');
  // The icon column answers "can this be resumed?", so interrupted is amber, not red.
  assert.ok(card.querySelector('.hist-sic').classList.contains('st-paused'));
  assert.equal(card.querySelector('.hist-status-word').textContent, 'Interrupted');
  assert.equal(card.querySelector('.hist-sic').getAttribute('aria-label'), 'Interrupted');
});

test('the meta line renders day · clock · duration · cost, and hides each segment when absent', async () => {
  const ctx = await boot({
    fetchHandler: armsFor([
      row({ id: 'full', title: 'Full', status: 'done', startedAt: '2026-01-01T09:30:00Z', totalActiveMs: 83000, totalCostUsd: 0.42 }),
      row({ id: 'bare', title: 'Bare', status: 'done', startedAt: null }),
    ]),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const [full, bare] = ctx.window.document.querySelectorAll('#history .hist-card');

  // fmtDate is toLocaleString() — locale AND timezone dependent, so assert
  // presence/structure only, never a literal day/clock string.
  assert.equal(full.querySelector('.hist-day-seg').hidden, false);
  assert.ok(full.querySelector('.hist-day').textContent.length > 0);
  assert.equal(full.querySelector('.hist-clock-seg').hidden, false);
  assert.ok(full.querySelector('.hist-clock').textContent.length > 0);
  assert.equal(full.querySelector('.hist-time').textContent, '1m 23s');
  assert.equal(full.querySelector('.hist-total').textContent, '$0.42');
  assert.match(full.querySelector('.hist-total').title, /[Ee]stimat/);

  assert.equal(bare.querySelector('.hist-day-seg').hidden, true, 'no timestamp -> no day segment');
  assert.equal(bare.querySelector('.hist-clock-seg').hidden, true);
  assert.equal(bare.querySelector('.hist-time-seg').hidden, true, 'no totalActiveMs -> no duration segment');
  assert.equal(bare.querySelector('.hist-total-seg').hidden, true, 'no totalCostUsd -> no cost segment');
});

test('the diff pill shows +A −R, falls back to "no diff", and hides when merged or gone', async () => {
  const base = { status: 'done', startedAt: '2026-01-01T00:00:00Z', branch: 'worca-cc/f', sourceBranch: 'main' };
  const ctx = await boot({
    fetchHandler: armsFor([
      row({ ...base, id: 'counts', title: 'Counts', survived: true, added: 12, removed: 5 }),
      row({ ...base, id: 'zero', title: 'Zero', survived: true, added: 0, removed: 0 }),
      row({ ...base, id: 'merged', title: 'Merged', survived: true, added: 9, removed: 1,
            pr: { state: 'MERGED', url: 'https://gh/x/pull/1' } }),
      row({ ...base, id: 'gone', title: 'Gone', survived: false, added: 3, removed: 2 }),
    ]),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const [counts, zero, merged, gone] = ctx.window.document.querySelectorAll('#history .hist-card');

  const pill = (c) => c.querySelector('.hist-diff-pill');
  assert.equal(pill(counts).hidden, false);
  assert.equal(counts.querySelector('.hist-diff .diff-add').textContent, '+12');
  assert.equal(counts.querySelector('.hist-diff .diff-del').textContent, '−5'); // U+2212, not '-'
  assert.equal(counts.querySelector('.hist-nodiff').hidden, true);

  assert.equal(pill(zero).hidden, false);
  assert.equal(zero.querySelector('.hist-diff').hidden, true);
  assert.equal(zero.querySelector('.hist-nodiff').hidden, false, 'zero changes reads "no diff"');

  assert.equal(pill(merged).hidden, true, 'a merged PR retires the pill');
  assert.equal(pill(gone).hidden, true, 'a branch that did not survive has no counts to show');
});

// ---------------------------------------------------------------------------
// Navigation (the card is a link to #history/<projectKey>/<id>)
// ---------------------------------------------------------------------------


test('clicking the title opens the viewer modal and does NOT navigate', async () => {
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
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const card = doc.querySelector('#history .hist-card');
  card.querySelector('.h-meta b').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.settle();

  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'history', 'title click did not navigate');
  const viewer = doc.querySelector('#viewer-card');
  assert.equal(viewer.classList.contains('hidden'), false, 'viewer modal opened');
  assert.match(doc.querySelector('#viewer').textContent, /saved audit/, 'viewer shows the saved markdown');
});


test('empty history renders a .hist-empty div (no <li>)', async () => {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsListResponse([], []);
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const empty = doc.querySelector('#history .hist-empty');
  assert.ok(empty, '.hist-empty div present');
  assert.match(empty.textContent, /No saved pipelines/);
  assert.equal(doc.querySelectorAll('#history li').length, 0, 'no <li> in empty state');
  assert.equal(doc.querySelector('#nav-history-count').textContent, '0');
});

test('history load error renders a .hist-empty div (no <li>)', async () => {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const empty = doc.querySelector('#history .hist-empty');
  assert.ok(empty, '.hist-empty div present on error');
  assert.match(empty.textContent, /Could not load history: boom/);
  assert.equal(doc.querySelectorAll('#history li').length, 0, 'no <li> in error state');
});

// ---------------------------------------------------------------------------
// The stepper the detail screen paints from the saved manifest
// ---------------------------------------------------------------------------



test('Refresh shows a busy spinner/disabled affordance, cleared by the final history-pr batch', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/history') && !url.endsWith('/api/history/pr')
      ? runsListResponse([{ id: 'p1', title: 'Feat', status: 'done', startedAt: '2026-01-01T00:00:00Z', projectKey: 'k1', projectName: 'K1' }])
      : null),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const btn = doc.querySelector('#refresh-history');
  btn.dispatchEvent(new ctx.window.Event('click', { bubbles: true })); // force refresh
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(btn.disabled, true, 'Refresh disabled while loading');
  assert.ok(btn.classList.contains('busy'), 'Refresh shows the busy spinner');
  assert.equal(doc.querySelector('#history').getAttribute('aria-busy'), 'true', 'list marked aria-busy');

  // The final Phase-2 batch (done:true) for the current token clears the affordance.
  const posts = ctx.calls.filter((c) => c.url.endsWith('/api/history/pr') && c.opts.body);
  const token = JSON.parse(posts.at(-1).opts.body).token;
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'history-pr', token, done: true, items: [] }) });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(btn.disabled, false, 'Refresh re-enabled after the final batch');
  assert.ok(!btn.classList.contains('busy'), 'busy spinner cleared');
  assert.equal(doc.querySelector('#history').getAttribute('aria-busy'), 'false', 'aria-busy cleared');
});



test('History never renders review sections, even when the payload carries them', async () => {
  // The server still sends `reviews`; History is a record of the run, not a
  // review surface, so nothing paints them anywhere on the detail screen.
  const detailPayload = {
    state: { phase: 'done', status: 'done', cycle: 2, steps: [] },
    auditMarkdown: '',
    clarify: {
      questions: [{ id: 'q1', question: 'Postgres or SQLite?', options: ['pg', 'sqlite', ''], allowFreeText: true }],
      answers: [{ id: 'q1', question: 'Postgres or SQLite?', choice: 'sqlite' }],
    },
    reviews: [
      { kind: 'impl', cycle: 1, issues: [{ severity: 'major', title: 'Missing null-check', detail: 'guard input', location: 'src/x.mjs:10' }], summary: 'one issue' },
      { kind: 'impl', cycle: 2, issues: [], summary: 'resolved' },
    ],
    results: null, overview: null, stepQuestions: [], artifacts: [],
  };
  const ctx = await boot({
    fetchHandler: armsFor([row({ id: 'p-ex', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z' })],
      { 'p-ex': detailPayload }),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.showDetail(KEY, 'p-ex');
  await ctx.settle();

  const hd = ctx.window.document.querySelector('#hist-detail .hd');
  assert.equal(hd.querySelector('.hist-reviews'), null, 'reviews section is not rendered');
  assert.equal(hd.querySelector('.hist-cycle-tag'), null, 'no review cycle tags rendered');
  assert.doesNotMatch(hd.textContent, /Missing null-check/, 'no review issue leaks onto the screen');
  // The clarify answer, by contrast, IS reachable — through its own tab.
  const clarifyTab = [...hd.querySelectorAll('.hd-tab')].find((t) => /Clarify/i.test(t.textContent));
  assert.ok(clarifyTab, 'a Clarify tab is offered when the run has Q&A');
});
