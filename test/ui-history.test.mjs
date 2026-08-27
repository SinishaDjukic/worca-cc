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

test('clicking a card navigates to its detail screen, which tints the stepper from the fetched state', async () => {
  const ctx = await boot({
    fetchHandler: armsFor(
      [row({ id: 'p-stop', title: 'Stopped run', status: 'stopped', startedAt: '2026-01-02T00:00:00Z' })],
      { 'p-stop': { state: { phase: 'implement', status: 'stopped', cycle: 1 }, auditMarkdown: '' } },
    ),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const card = doc.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-head').hasAttribute('aria-expanded'), false,
    'the head is a link, not a disclosure');

  card.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.settle();

  assert.equal(ctx.window.location.hash.replace(/^#/, ''), `history/${KEY}/p-stop`);
  assert.ok(doc.querySelector('#hist-shell').classList.contains('detail-open'), 'the detail screen slid in');

  // Tinted stepper: phase=implement, status=stopped => preflight/plan/refine done,
  // implement stopped, review/done pending.
  const byId = {};
  for (const n of doc.querySelectorAll('#hist-detail .hd .run-node[data-id]')) byId[n.dataset.id] = n;
  assert.ok(byId.preflight.classList.contains('is-done'), 'preflight done');
  assert.ok(byId.plan.classList.contains('is-done'), 'plan done');
  assert.ok(byId.refine.classList.contains('is-done'), 'refine done');
  assert.ok(byId.implement.classList.contains('is-stopped'), 'implement stopped (halt cell)');
  assert.ok(byId.implement.querySelector('.nstat.stopped svg'), 'stopped X badge at halt cell');
  assert.ok(byId.review.classList.contains('is-pending'), 'review pending');
});

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

test('Enter on the head navigates, and so does the open-details chevron', async () => {
  const detail = { state: { phase: 'done', status: 'done' } };
  const ctx = await boot({
    fetchHandler: armsFor([row({ id: 'p-done', title: 'Done run', status: 'done', startedAt: '2026-01-01T00:00:00Z' })],
      { 'p-done': detail }),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  doc.querySelector('#history .hist-head')
    .dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await ctx.settle();
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), `history/${KEY}/p-done`, 'Enter opens the detail');

  // DONE state tints every node done.
  const nodes = [...doc.querySelectorAll('#hist-detail .hd .run-node[data-id]')];
  assert.ok(nodes.length > 0);
  assert.ok(nodes.every((n) => n.classList.contains('is-done')), 'DONE tints every node done');
  assert.ok(doc.querySelector('#hist-detail .hd .run-node[data-id="done"] .nstat.done svg'), 'done badge present');

  // Back to the list, then in again through the chevron button.
  ctx.window.location.hash = 'history';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle();
  doc.querySelector('#history .hist-open').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.settle();
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), `history/${KEY}/p-done`, 'the chevron opens it too');
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

test('the detail screen renders the persisted manifest nodes', async () => {
  const customState = {
    status: 'stopped', phase: 'refine', cycle: 1, steps: [],
    stepper: {
      version: 1,
      steps: [
        { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
        { kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan', color: 'violet', cycles: false }] },
        { kind: 'agents', nodes: [{ id: 's1_0', uiPhase: 'refine', label: 'Refine Plan', color: 'green', cycles: true }] },
        { kind: 'agents', nodes: [{ id: 's4_0', uiPhase: 'manual-checklist', label: 'Manual Tests Checklist', color: 'blue', cycles: false }] },
        { kind: 'agents', nodes: [{ id: 's5_0', uiPhase: 'manual-web', label: 'Manual web UI testing', color: 'violet', cycles: false }] },
        { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
      ],
    },
  };
  const ctx = await boot({
    fetchHandler: armsFor([row({ id: 'p1', title: 'Custom', status: 'stopped', startedAt: '2026-06-02T00:00:00Z' })],
      { p1: { state: customState, auditMarkdown: '' } }),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.showDetail(KEY, 'p1');
  await ctx.settle();

  const hd = ctx.window.document.querySelector('#hist-detail .hd');
  const labels = [...hd.querySelectorAll('.run-node .nmeta b')].map((e) => e.textContent);
  assert.deepEqual(labels, ['Preflight', 'Plan', 'Refine Plan', 'Manual Tests Checklist', 'Manual web UI testing', 'Done']);
  // stopped at refine (cell idx 2) -> that node is is-stopped, earlier done.
  assert.ok(hd.querySelector('.run-node[data-id="s1_0"]').classList.contains('is-stopped'));
  assert.ok(hd.querySelector('.run-node[data-id="s0_0"]').classList.contains('is-done'));
});

test('a run without a saved manifest still renders the legacy seven', async () => {
  const legacyState = { status: 'done', phase: 'done', steps: [] }; // no .stepper
  const ctx = await boot({
    fetchHandler: armsFor([row({ id: 'p1', title: 'Old', status: 'done', startedAt: '2026-06-02T00:00:00Z' })],
      { p1: { state: legacyState, auditMarkdown: '' } }),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.showDetail(KEY, 'p1');
  await ctx.settle();

  const hd = ctx.window.document.querySelector('#hist-detail .hd');
  const labels = [...hd.querySelectorAll('.run-node .nmeta b')].map((e) => e.textContent);
  assert.deepEqual(labels, ['Preflight', 'Clarify', 'Plan', 'Refine', 'Implement', 'Review', 'Done']);
  assert.ok([...hd.querySelectorAll('.run-node[data-id]')].every((n) => n.classList.contains('is-done')));
});

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

test('the detail screen shows per-node model·effort from the saved manifest', async () => {
  const customState = {
    status: 'done', phase: 'done', cycle: 0, steps: [],
    stepper: {
      version: 1,
      steps: [
        { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
        { kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan', color: 'violet',
                                    sub: 'architecture & breakdown', model: 'opus', effort: 'high', cycles: false }] },
        { kind: 'agents', nodes: [{ id: 's1_0', uiPhase: 'refine', label: 'Refine Plan', color: 'green',
                                    sub: 'tighten the plan', model: '', effort: '', cycles: true }] },
        { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
      ],
    },
  };
  const arms = armsFor([row({ id: 'p1', title: 'Custom', status: 'done', startedAt: '2026-06-02T00:00:00Z' })],
    { p1: { state: customState, auditMarkdown: '' } });
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/config')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          config: { steps: {}, customModels: [] },
          models: [{ id: 'opus', label: 'Opus 4.8', efforts: ['high'] }],
          efforts: ['high'],
        }) });
      }
      return arms(url);
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.showDetail(KEY, 'p1');
  await ctx.settle();

  const hd = ctx.window.document.querySelector('#hist-detail .hd');
  // model · effort renders as a visible .nmodel sub-line (friendly model label,
  // resolved from state.models loaded at boot via loadConfig); a step with neither
  // model nor effort shows the "default" placeholder.
  assert.equal(hd.querySelector('.run-node[data-id="s0_0"] .nmodel').textContent, 'Opus 4.8 · high');
  assert.equal(hd.querySelector('.run-node[data-id="s1_0"] .nmodel').textContent, 'default');
});

test('history feeds loopCounts from st.steps[] cycles (self-cycle fired twice -> count 1)', async () => {
  const state = {
    phase: 'done', status: 'done', cycle: 2,
    stepper: {
      version: 1,
      steps: [
        { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
        { kind: 'agents', nodes: [{ id: 's1_0', key: 'refiner', uiPhase: 'refine', label: 'Refine', color: 'green', cycles: true }] },
        { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
      ],
      feedbacks: [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }],
    },
    steps: [
      { nodeId: 's1_0', phase: 'refine', cycle: 1, activeMs: 1000, costUsd: 0.01 },
      { nodeId: 's1_0', phase: 'refine', cycle: 2, activeMs: 2000, costUsd: 0.02 },
    ],
  };
  const ctx = await boot({
    fetchHandler: armsFor([row({ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z' })],
      { p1: { state, auditMarkdown: '' } }),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.showDetail(KEY, 'p1');
  await ctx.settle();
  // The adapter's cycle map is the public contract; assert it directly.
  const counts = ctx.window.__np.loopCounts(state.stepper, ctx.window.__np.histNodeCycle(state));
  assert.equal(counts.s1_0, 1, 'two cycles -> one loop-back badge');
  // Summed dur/cost still paint into the graph node.
  const node = ctx.window.document.querySelector('#hist-detail .hd .run-node[data-id="s1_0"]');
  assert.equal(node.querySelector('.dur').textContent, '3s');
  assert.equal(node.querySelector('.cost').textContent, '$0.03');
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
