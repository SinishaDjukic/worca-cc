import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
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

  return { window, calls, wsBox, selectProject, showHistory };
}

function runsListResponse(pipelines, live = []) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });
}

test('history renders 2 .hist-card divs (no <li>), badges DONE/STOPPED, nav count=2', async () => {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) {
        return runsListResponse([
          { id: 'p-done', title: 'Done run', status: 'done', startedAt: '2026-01-01T00:00:00Z' },
          { id: 'p-stop', title: 'Stopped run', status: 'stopped', startedAt: '2026-01-02T00:00:00Z' },
        ]);
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const cards = doc.querySelectorAll('#history .hist-card');
  assert.equal(cards.length, 2, 'two history cards rendered');
  assert.equal(doc.querySelectorAll('#history li').length, 0, 'no <li> emitted');

  const badges = [...doc.querySelectorAll('#history .badge')];
  assert.equal(badges[0].textContent, 'DONE');
  assert.ok(badges[0].classList.contains('green'), 'done badge is green');
  assert.equal(badges[1].textContent, 'STOPPED');
  assert.ok(badges[1].classList.contains('red'), 'stopped badge is red');

  // Titles surface in .h-meta b.
  assert.equal(cards[0].querySelector('.h-meta b').textContent, 'Done run');

  assert.equal(doc.querySelector('#nav-history-count').textContent, '2', 'nav count reflects rendered cards');
});

test('interrupted entry renders an INTERRUPTED red badge', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/history')
      ? runsListResponse([{ id: 'pi', title: 'Stuck', status: 'interrupted', startedAt: '2026-06-02T00:00:00Z',
                            projectName: 'Proj', projectKey: 'proj-0000abcd', projectDir: '/x/proj' }])
      : null),
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const badge = ctx.window.document.querySelector('#history .badge');
  assert.equal(badge.textContent, 'INTERRUPTED');
  assert.ok(badge.classList.contains('red'), 'interrupted badge is red');
});

test('expanding a card toggles aria-expanded, unhides detail, tints stepper from fetched state', async () => {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) {
        return runsListResponse([{ id: 'p-stop', title: 'Stopped run', status: 'stopped', startedAt: '2026-01-02T00:00:00Z' }]);
      }
      // Lazy per-card detail fetch: GET /api/runs/:id?projectDir=...
      if (url.includes('/api/runs/p-stop')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ state: { phase: 'implement', status: 'stopped', cycle: 1 }, auditMarkdown: '' }),
        });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const card = doc.querySelector('#history .hist-card');
  const head = card.querySelector('.hist-head');
  const detail = card.querySelector('.hist-detail');
  assert.equal(head.getAttribute('aria-expanded'), 'false', 'starts collapsed');
  assert.equal(detail.hidden, true, 'detail starts hidden');

  // Click the head (NOT the title) to expand.
  head.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0)); // let the lazy detail fetch resolve

  assert.equal(head.getAttribute('aria-expanded'), 'true', 'expanded after click');
  assert.equal(detail.hidden, false, 'detail unhidden after expand');

  // Tinted stepper: phase=implement, status=stopped => preflight/plan/refine done,
  // implement stopped, review/done pending.
  const byId = {};
  for (const n of detail.querySelectorAll('.run-node[data-id]')) byId[n.dataset.id] = n;
  assert.ok(byId.preflight.classList.contains('is-done'), 'preflight done');
  assert.ok(byId.plan.classList.contains('is-done'), 'plan done');
  assert.ok(byId.refine.classList.contains('is-done'), 'refine done');
  assert.ok(byId.implement.classList.contains('is-stopped'), 'implement stopped (halt cell)');
  assert.ok(byId.implement.querySelector('.nstat.stopped svg'), 'stopped X badge at halt cell');
  assert.ok(byId.review.classList.contains('is-pending'), 'review pending');
  assert.ok(!byId.review.classList.contains('is-done'), 'review not done');

  // Collapse again toggles aria-expanded back + re-hides.
  head.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(head.getAttribute('aria-expanded'), 'false', 'collapses on second click');
  assert.equal(detail.hidden, true, 'detail re-hidden');
});

test('clicking the title opens the viewer modal (distinct from expand)', async () => {
  let detailFetches = 0;
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) {
        return runsListResponse([{ id: 'p-done', title: 'Done run', status: 'done', startedAt: '2026-01-01T00:00:00Z' }]);
      }
      if (url.includes('/api/runs/p-done')) {
        detailFetches++;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { phase: 'done', status: 'done' }, auditMarkdown: '# saved audit' }) });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const card = doc.querySelector('#history .hist-card');
  const head = card.querySelector('.hist-head');

  // Click the title -> viewer opens; the head must NOT expand.
  card.querySelector('.h-meta b').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(head.getAttribute('aria-expanded'), 'false', 'title click did not expand the card');
  const viewer = doc.querySelector('#viewer-card');
  assert.equal(viewer.classList.contains('hidden'), false, 'viewer modal opened');
  assert.match(doc.querySelector('#viewer').textContent, /saved audit/, 'viewer shows the saved markdown');
});

test('keyboard: Enter on the head toggles expand', async () => {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) {
        return runsListResponse([{ id: 'p-done', title: 'Done run', status: 'done', startedAt: '2026-01-01T00:00:00Z' }]);
      }
      if (url.includes('/api/runs/p-done')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { phase: 'done', status: 'done' } }) });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));

  const doc = ctx.window.document;
  const head = doc.querySelector('#history .hist-head');
  head.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(head.getAttribute('aria-expanded'), 'true', 'Enter expands the card');

  // DONE state tints every node done.
  const detail = doc.querySelector('#history .hist-detail');
  const nodes = [...detail.querySelectorAll('.run-node[data-id]')];
  assert.ok(nodes.length > 0);
  assert.ok(nodes.every((n) => n.classList.contains('is-done')), 'DONE tints every node done');
  assert.ok(detail.querySelector('.run-node[data-id="done"] .nstat.done svg'), 'done badge present');
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

const runsList = (pipelines, live = []) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });

test('History card renders the persisted manifest nodes on expand', async () => {
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
  const { window, showHistory } = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/runs/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: customState, auditMarkdown: '' }) });
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Custom', status: 'stopped', startedAt: '2026-06-02T00:00:00Z' }]);
      return null;
    },
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('#history .hist-head').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  const detail = window.document.querySelector('#history .hist-card .hist-detail');
  const labels = [...detail.querySelectorAll('.run-node .nmeta b')].map((e) => e.textContent);
  assert.deepEqual(labels, ['Preflight', 'Plan', 'Refine Plan', 'Manual Tests Checklist', 'Manual web UI testing', 'Done']);
  // stopped at refine (cell idx 2) -> that node is is-stopped, earlier done.
  assert.ok(detail.querySelector('.run-node[data-id="s1_0"]').classList.contains('is-stopped'));
  assert.ok(detail.querySelector('.run-node[data-id="s0_0"]').classList.contains('is-done'));
});

test('History card without a saved manifest still renders the legacy seven', async () => {
  const legacyState = { status: 'done', phase: 'done', steps: [] }; // no .stepper
  const { window, showHistory } = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/runs/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: legacyState, auditMarkdown: '' }) });
      if (url.includes('/api/history')) return runsList([{ id: 'p1', title: 'Old', status: 'done', startedAt: '2026-06-02T00:00:00Z' }]);
      return null;
    },
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('#history .hist-head').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  const detail = window.document.querySelector('#history .hist-card .hist-detail');
  const labels = [...detail.querySelectorAll('.run-node .nmeta b')].map((e) => e.textContent);
  assert.deepEqual(labels, ['Preflight', 'Clarify', 'Plan', 'Refine', 'Implement', 'Review', 'Done']);
  assert.ok([...detail.querySelectorAll('.run-node[data-id]')].every((n) => n.classList.contains('is-done')));
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

test('History card shows per-node model·effort from the saved manifest', async () => {
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
  const { window, showHistory } = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/config')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          config: { steps: {}, customModels: [] },
          models: [{ id: 'opus', label: 'Opus 4.8', efforts: ['high'] }],
          efforts: ['high'],
        }) });
      }
      if (url.includes('/api/runs/')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: customState, auditMarkdown: '' }) });
      }
      if (url.includes('/api/history')) {
        return runsList([{ id: 'p1', title: 'Custom', status: 'done', startedAt: '2026-06-02T00:00:00Z' }]);
      }
      return null;
    },
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('#history .hist-head').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0)); // let the lazy detail fetch resolve

  const detail = window.document.querySelector('#history .hist-card .hist-detail');
  // model · effort renders as a visible .nmodel sub-line (friendly model label,
  // resolved from state.models loaded at boot via loadConfig); a step with neither
  // model nor effort shows the "default" placeholder.
  assert.equal(detail.querySelector('.run-node[data-id="s0_0"] .nmodel').textContent, 'Opus 4.8 · high');
  assert.equal(detail.querySelector('.run-node[data-id="s1_0"] .nmodel').textContent, 'default');
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
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsListResponse([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z' }]);
      if (url.includes('/api/runs/p1')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, auditMarkdown: '' }) });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  // The adapter's cycle map is the public contract; assert it directly.
  const counts = ctx.window.__np.loopCounts(state.stepper, ctx.window.__np.histNodeCycle(state));
  assert.equal(counts.s1_0, 1, 'two cycles -> one loop-back badge');
  // Summed dur/cost still paint into the graph node.
  const node = ctx.window.document.querySelector('#history .hist-detail .run-node[data-id="s1_0"]');
  assert.equal(node.querySelector('.dur').textContent, '3s');
  assert.equal(node.querySelector('.cost').textContent, '$0.03');
});

test('expanded history card renders clarify Q&A but not reviews', async () => {
  const detailPayload = {
    state: { phase: 'done', status: 'done', cycle: 2, steps: [] },
    auditMarkdown: '',
    clarify: {
      questions: [{ id: 'q1', question: 'Postgres or SQLite?', options: ['pg', 'sqlite', ''], allowFreeText: true }],
      answers: [{ id: 'q1', question: 'Postgres or SQLite?', choice: 'sqlite' }],
    },
    // Server still sends reviews; the History expand must IGNORE them (not render).
    reviews: [
      { kind: 'impl', cycle: 1, issues: [{ severity: 'major', title: 'Missing null-check', detail: 'guard input', location: 'src/x.mjs:10' }], summary: 'one issue' },
      { kind: 'impl', cycle: 2, issues: [], summary: 'resolved' },
    ],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) {
        return runsListResponse([{ id: 'p-ex', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z' }]);
      }
      if (url.includes('/api/runs/p-ex')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => detailPayload });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0)); // let the lazy detail fetch resolve

  const detail = ctx.window.document.querySelector('#history .hist-card .hist-detail');

  // Clarify is now a dropdown bar under Sub-agents; open it to read the Q&A.
  const clarifyBar = detail.querySelector('.clarify-bar');
  assert.ok(clarifyBar && !clarifyBar.hidden, 'clarify dropdown rendered');
  clarifyBar.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  const panel = clarifyBar.querySelector('.clarify-panel');
  assert.match(panel.textContent, /Postgres or SQLite\?/);
  assert.match(panel.textContent, /sqlite/);
  // Read-only: the panel content carries no form controls (the disclosure toggle
  // lives on the bar, not in the panel).
  assert.equal(panel.querySelectorAll('input,button,select,textarea').length, 0, 'clarify is read-only in History');

  // Reviews must NOT render in History anymore, even though the payload carries them.
  assert.equal(detail.querySelector('.hist-reviews'), null, 'reviews section is not rendered');
  assert.equal(detail.querySelector('.hist-cycle-tag'), null, 'no review cycle tags rendered');
});

test('history detail omits clarify/reviews sections when both are empty', async () => {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsListResponse([{ id: 'p-bare', title: 'Bare', status: 'done', startedAt: '2026-01-01T00:00:00Z' }]);
      if (url.includes('/api/runs/p-bare')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          state: { phase: 'done', status: 'done', steps: [] }, auditMarkdown: '',
          clarify: { questions: [], answers: [] }, reviews: [],
        }) });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  ctx.window.document.querySelector('#history .hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const detail = ctx.window.document.querySelector('#history .hist-card .hist-detail');
  assert.equal(detail.querySelector('.hist-clarify'), null, 'no clarify section when empty');
  assert.equal(detail.querySelector('.hist-reviews'), null, 'no reviews section when empty');
});

test('history detail clarify/review section is not duplicated on a cached re-expand', async () => {
  const payload = {
    state: { phase: 'done', status: 'done', steps: [] }, auditMarkdown: '',
    clarify: { questions: [{ id: 'q1', question: 'Q?', options: ['', '', ''], allowFreeText: true }], answers: [] },
    reviews: [],
  };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history')) return runsListResponse([{ id: 'p-rx', title: 'R', status: 'done', startedAt: '2026-01-01T00:00:00Z' }]);
      if (url.includes('/api/runs/p-rx')) return Promise.resolve({ ok: true, status: 200, json: async () => payload });
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const head = ctx.window.document.querySelector('#history .hist-head');
  head.dispatchEvent(new ctx.window.Event('click', { bubbles: true })); // expand (fetch)
  await new Promise((r) => setTimeout(r, 0));
  head.dispatchEvent(new ctx.window.Event('click', { bubbles: true })); // collapse
  head.dispatchEvent(new ctx.window.Event('click', { bubbles: true })); // re-expand (cached, no refetch)
  await new Promise((r) => setTimeout(r, 0));
  const detail = ctx.window.document.querySelector('#history .hist-card .hist-detail');
  const clarifyBars = detail.querySelectorAll('.clarify-bar');
  assert.equal(clarifyBars.length, 1, 'exactly one clarify bar after re-expand');
  // Open the dropdown: the question renders exactly once (renderClarifyPanel resets
  // the panel each open, so a cached re-expand never duplicates the Q&A).
  clarifyBars[0].querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(clarifyBars[0].querySelectorAll('.clarify-panel .qblock').length, 1, 'question rendered once, not duplicated');
});
