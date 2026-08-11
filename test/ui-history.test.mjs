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

// v2 run manifests (buildGraphManifest, src/core/workflows.mjs:567). History
// renders the graph the run actually ran, through the same graph-view + run-decor
// pair as the live monitor; the persisted step rows ARE the exec ledger.
function gnode(id, { key = null, label, color = '', model = '', effort = '', x = 0 } = {}) {
  return {
    id, kind: key ? 'agent' : 'task', key, label, color, sub: '', x, y: 200, model, effort, loop: false,
    ports: {
      inputs: key ? [{ id: 'in', type: 'md', required: true, loop: false, expands: false }] : [],
      outputs: [{ id: 'out', type: 'md', when: 'always' }],
    },
  };
}
const gmanifest = (nodes, wires = []) => ({ version: 2, graph: { nodes, wires }, bookends: { preflight: true, done: true } });
const gstep = (nodeId, ordinal, o = {}) => ({
  key: `x:${nodeId}:${ordinal}`, executionId: `x:${nodeId}:${ordinal}`, nodeId,
  cycle: ordinal, status: 'done', activeMs: 0, runningSince: null, ...o,
});
const cardLabels = (detail) => [...detail.querySelectorAll('.node[data-node-id] .nhead .tt')].map((e) => e.textContent);

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
          json: async () => ({
            state: {
              status: 'stopped',
              stepper: gmanifest([
                gnode('n_plan', { key: 'planner', label: 'Plan', color: 'violet', x: 0 }),
                gnode('n_impl', { key: 'implementer', label: 'Implement', color: 'peach', x: 300 }),
                gnode('n_review', { key: 'reviewer', label: 'Review', color: 'blue', x: 600 }),
              ]),
              steps: [gstep('n_plan', 1), gstep('n_impl', 1, { status: 'stopped' })],
            },
            auditMarkdown: '',
          }),
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

  // Decorated graph: the ledger says plan completed and the implementer stopped;
  // the reviewer never ran.
  const byId = {};
  for (const n of detail.querySelectorAll('.node[data-node-id]')) byId[n.dataset.nodeId] = n;
  assert.ok(byId.n_plan.classList.contains('is-done'), 'plan done');
  assert.ok(byId.n_impl.classList.contains('is-stopped'), 'implementer stopped where it halted');
  assert.ok(byId.n_review.classList.contains('is-pending'), 'review pending');
  assert.ok(!byId.n_review.classList.contains('is-done'), 'review not done');

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
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: {
          status: 'done',
          stepper: gmanifest([
            gnode('n_plan', { key: 'planner', label: 'Plan', color: 'violet', x: 0 }),
            gnode('n_review', { key: 'reviewer', label: 'Review', color: 'blue', x: 300 }),
          ]),
          steps: [gstep('n_plan', 1), gstep('n_review', 1)],
        } }) });
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

  // Every execution in the ledger completed -> every card reads done.
  const detail = doc.querySelector('#history .hist-detail');
  const nodes = [...detail.querySelectorAll('.node[data-node-id]')];
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every((n) => n.classList.contains('is-done')), 'a done ledger tints every card done');
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
    status: 'stopped',
    stepper: gmanifest([
      gnode('s0_0', { key: 'planner', label: 'Plan', color: 'violet', x: 0 }),
      gnode('s1_0', { key: 'refiner', label: 'Refine Plan', color: 'green', x: 300 }),
      gnode('s4_0', { key: 'manualTestsChecklist', label: 'Manual Tests Checklist', color: 'blue', x: 600 }),
      gnode('s5_0', { key: 'manualWebUiTesting', label: 'Manual web UI testing', color: 'violet', x: 900 }),
    ]),
    steps: [gstep('s0_0', 1), gstep('s1_0', 1, { status: 'stopped' })],
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
  assert.deepEqual(cardLabels(detail), ['Plan', 'Refine Plan', 'Manual Tests Checklist', 'Manual web UI testing']);
  assert.ok(detail.querySelector('.node[data-node-id="s1_0"]').classList.contains('is-stopped'));
  assert.ok(detail.querySelector('.node[data-node-id="s0_0"]').classList.contains('is-done'));
});

test('a frozen v1 manifest degrades to the flat chip strip (no graph to draw)', async () => {
  const legacyState = {
    status: 'done',
    stepper: {
      version: 1,
      steps: [
        { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
        { kind: 'agents', nodes: [{ id: 'plan', uiPhase: 'plan', label: 'Plan', color: 'violet' }] },
        { kind: 'agents', nodes: [{ id: 'review', uiPhase: 'review', label: 'Review', color: 'blue' }] },
      ],
    },
    steps: [{ nodeId: 'plan', status: 'done', activeMs: 4000, costUsd: 0.03 }],
  };
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
  const chips = [...detail.querySelectorAll('.run-strip .rchip')];
  assert.deepEqual(chips.map((c) => c.dataset.id), ['preflight', 'plan', 'review']);
  assert.equal(chips[1].textContent, 'Plan · 4s · $0.03');
  assert.ok(chips[1].classList.contains('is-done'));
  assert.ok(chips[2].classList.contains('is-pending'), 'a node with no step row never ran');
  assert.equal(detail.querySelector('.node[data-node-id]'), null, 'v1 has no graph to render');
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
    status: 'done',
    stepper: gmanifest([
      gnode('s0_0', { key: 'planner', label: 'Plan', color: 'violet', model: 'Opus 4.8', effort: 'high', x: 0 }),
      gnode('s1_0', { key: 'refiner', label: 'Refine Plan', color: 'green', x: 300 }),
    ]),
    steps: [gstep('s0_0', 1), gstep('s1_0', 1)],
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
  // The shared card's geometry is fixed by its port lists, so model · effort
  // rides the header as a tooltip; a node with neither shows the "default"
  // placeholder, exactly as the composer caption does.
  assert.equal(detail.querySelector('.node[data-node-id="s0_0"] .nhead').title, 'Plan — Opus 4.8 · high');
  assert.equal(detail.querySelector('.node[data-node-id="s1_0"] .nhead').title, 'Refine Plan — default');
});

test('a self-cycling node folds its two executions into one card + a 2-run footer', async () => {
  const refiner = gnode('s1_0', { key: 'refiner', label: 'Refine', color: 'green', x: 0 });
  refiner.ports.inputs.push({ id: 'fix', type: 'md', required: false, loop: true, expands: false });
  refiner.ports.outputs.push({ id: 'review', type: 'md', when: 'blocking' });
  refiner.loop = true;
  const state = {
    status: 'done',
    stepper: gmanifest([refiner], [
      { id: 'fb_refine', from: { node: 's1_0', port: 'review' }, to: { node: 's1_0', port: 'fix' }, loop: true, maxCycles: 3 },
    ]),
    steps: [gstep('s1_0', 1, { activeMs: 1000, costUsd: 0.01 }), gstep('s1_0', 2, { activeMs: 2000, costUsd: 0.02 })],
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
  const node = ctx.window.document.querySelector('#history .hist-detail .node[data-node-id="s1_0"]');
  assert.equal(node.querySelector('.nrun .dur').textContent, '3s', 'both cycles summed');
  assert.equal(node.querySelector('.nrun .cost').textContent, '$0.03');
  assert.equal(node.querySelector('.xsum').textContent, '2 runs · $0.03', 'the executions footer counts both');
  // The wire's budget still renders; a frozen run replays no trigger, so no
  // fired-count badge is claimed.
  const badge = ctx.window.document.querySelector('#history .hist-detail .wbadge[data-wire-id="fb_refine"]');
  assert.equal(badge.textContent, '≤3');
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
