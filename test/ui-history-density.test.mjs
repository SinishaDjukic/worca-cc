// test/ui-history-density.test.mjs
//
// Behavior tests for History's two densities. Expanding a row in the LIST reveals
// a mini view of the pipeline (stage rail + results summary + a way in), not the
// whole record; #history/<id> is the detail view, where the five stacked
// dropdowns become one tab bar.
//
// Same boot harness as test/ui-history-logs.mjs (real app.js against real
// index.html under jsdom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// A three-stage manifest, as the list row now carries it.
const STEPPER = {
  steps: [
    { nodes: [{ id: 'preflight', label: 'Preflight' }] },
    { nodes: [{ id: 'planner', label: 'Plan', uiPhase: 'plan' }] },
    { nodes: [{ id: 'implementer', label: 'Implement', uiPhase: 'implement' }] },
  ],
  feedbacks: [],
};

const ROW = {
  id: 'p-1', projectKey: 'proj-00000001', projectName: 'proj', projectDir: PROJECT,
  title: 'Rework auth session store', status: 'done', phase: 'done', cycle: 2,
  startedAt: '2026-06-20T00:00:00Z', branch: 'worca-cc/auth-5c1d90ae',
  added: 880, removed: 341, totalCostUsd: 7.12, totalActiveMs: 3127000, stepper: STEPPER,
};

// The saved steps matter: the Agents panel is hidden unless at least one main
// agent ran, so a fixture with no steps would contribute no Agents tab.
const STEPS = [
  { key: 'preflight', nodeId: 'preflight', phase: 'preflight', stepIndex: 0, cycle: 1, status: 'done', activeMs: 1200, costUsd: 0 },
  { key: 'planner', nodeId: 'planner', phase: 'plan', stepIndex: 1, cycle: 1, status: 'done', activeMs: 44000, costUsd: 0.08 },
  { key: 'implementer', nodeId: 'implementer', phase: 'implement', stepIndex: 2, cycle: 2, status: 'done', activeMs: 90000, costUsd: 7.04 },
];

const DETAIL = {
  state: { phase: 'done', status: 'done', cycle: 2,
           subAgents: [{ id: 's1', nodeId: 'implementer', cycle: 2, label: 'extract adapter', status: 'done' }],
           steps: STEPS, stepper: STEPPER },
  auditMarkdown: '',
  clarify: { questions: [{ id: 'q1', question: 'Hard or soft delete?', options: ['hard', 'soft'] }],
             answers: [{ id: 'q1', question: 'Hard or soft delete?', choice: 'soft' }] },
  reviews: [],
  results: {
    summary: { filesNew: 1, filesChanged: 3, filesDeleted: 0, linesAdded: 880, linesRemoved: 341,
               blockingIssues: 3, nitpicks: 1 },
    newFiles: [{ path: 'src/session.js', added: 120, removed: 0, status: 'A' }],
    changedFiles: [{ path: 'src/auth.js', added: 40, removed: 12, status: 'M' }],
    keyThingsToCheck: [
      { id: 'c1', severity: 'critical', title: 'Session fixation on renew', detail: 'renew() keeps the id' },
      { id: 'c2', severity: 'major', title: 'No expiry on the fallback path', detail: '' },
      { id: 'c3', severity: 'major', title: 'Cookie flags unset in dev', detail: '' },
    ],
    nitpicks: [],
  },
  artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }],
};

const NDJSON =
  '{"source":"planner","level":"info","text":"Planning…","ts":"2026-06-20T00:00:01Z","stepIndex":0,"cycle":1}\n';

async function boot({ row = ROW, detail = DETAIL } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/history/') && u.endsWith('/log')) {
      return Promise.resolve({ ok: true, status: 200, text: async () => NDJSON });
    }
    if (u.includes('/api/history/')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => detail });
    }
    if (u.includes('/api/history')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [row], ghAvailable: false }) });
    }
    if (u.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  recv({ type: 'hello', runs: [] });                     // live set known + empty
  const go = async (hash) => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { window, go, tick: () => new Promise((r) => setTimeout(r, 0)) };
}

const histCard = (window) => window.document.querySelector('#history .hist-card');

// ── list density: the expandable section holds a MINI view ───────────────────

test('the collapsed row is unchanged: the rail lives inside the expandable section', async () => {
  const ctx = await boot();
  await ctx.go('history');
  const c = histCard(ctx.window);
  assert.ok(c, 'a row rendered');
  assert.equal(c.classList.contains('mini'), true);
  // The row's own head is untouched — the rail and the CTA are in .hist-detail,
  // which is still [hidden] until the reader expands it. Adding them to the head
  // would have doubled the height of every collapsed row.
  assert.equal(c.querySelector('.hist-detail').hidden, true);
  assert.ok(c.querySelector('.hist-detail > .run-rail-wrap'), 'the rail is inside the section');
  assert.ok(c.querySelector('.hist-detail > .hist-cta'), 'so is the way in');
});

test('expanding a row draws the rail from the row itself — no detail fetch needed', async () => {
  const ctx = await boot();
  await ctx.go('history');
  const c = histCard(ctx.window);
  // Paint happens at BUILD time, off row.stepper + row.phase, so the rail is
  // already there before the (async) detail request resolves.
  const cells = [...c.querySelectorAll('.hist-detail .run-rail .rcell')];
  assert.equal(cells.length, 3, 'one marker per stage from the row payload');
  assert.deepEqual(cells.map((x) => x.querySelector('.rlabel').textContent),
    ['Preflight', 'Plan', 'Implement']);
  assert.ok(cells.every((x) => x.classList.contains('is-done')), 'a done run is done throughout');
  assert.match(c.querySelector('.hist-detail .run-stats').textContent, /3\/3/);
  assert.match(c.querySelector('.hist-detail .run-stats').textContent, /cycle 2/);
});

test('a stopped run reads as stopped AT the stage it stopped at', async () => {
  const ctx = await boot({
    row: { ...ROW, status: 'interrupted', phase: 'plan', cycle: 1 },
  });
  await ctx.go('history');
  const cells = [...histCard(ctx.window).querySelectorAll('.hist-detail .run-rail .rcell')];
  assert.equal(cells[0].classList.contains('is-done'), true, 'preflight ran');
  assert.equal(cells[1].classList.contains('is-stopped'), true, 'it stopped in Plan');
  assert.equal(cells[2].classList.contains('is-pending'), true, 'implement never started');
  assert.match(histCard(ctx.window).querySelector('.hist-cta-text').textContent,
    /Stopped at stage 2 of 3/);
});

test('the list keeps ONE region behind the expander; the rest is detail-only', async () => {
  const ctx = await boot();
  await ctx.go('history');
  const c = histCard(ctx.window);
  c.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  for (let i = 0; i < 4; i++) await ctx.tick();

  assert.equal(c.querySelector('.hist-detail').hidden, false, 'expanded');
  // The results summary is the peek. The graph, the tab bar, the other panels and
  // Archive stay out of the list — that is the "expandable inside expandable" fix.
  assert.ok(c.querySelector('.results-section').textContent.includes('Session fixation'),
    'the findings are the peek');
  assert.equal(c.querySelector('.run-tabs').hidden, true, 'no tab bar in a list');
  assert.match(c.querySelector('.hist-cta-text').textContent, /detail view/);
});

test('outcome quality is hoisted into the row head, and said only once', async () => {
  const ctx = await boot();
  await ctx.go('history');
  const c = histCard(ctx.window);
  c.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  for (let i = 0; i < 4; i++) await ctx.tick();

  const pill = c.querySelector('.hist-outcome');
  assert.equal(pill.hidden, false);
  assert.equal(pill.textContent, '3 to check', 'the question a reader brings to History');
  assert.equal(pill.classList.contains('check'), true);
  // Same string as the Results panel's own chip, which is why the panel's copy is
  // suppressed in CSS rather than rendered twice.
  const chip = c.querySelector('.results-chips .results-chip');
  assert.equal(chip.textContent, pill.textContent, 'one source of truth (statusChip)');
});

test('a clean run says Clean', async () => {
  const ctx = await boot({
    detail: { ...DETAIL,
      results: { ...DETAIL.results, summary: { ...DETAIL.results.summary, blockingIssues: 0 },
                 keyThingsToCheck: [] } },
  });
  await ctx.go('history');
  const c = histCard(ctx.window);
  c.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  for (let i = 0; i < 4; i++) await ctx.tick();
  const pill = c.querySelector('.hist-outcome');
  assert.equal(pill.textContent, 'Clean');
  assert.equal(pill.classList.contains('clean'), true);
});

// ── detail density: #history/<id> ────────────────────────────────────────────

test('#history/<id> is the detail view: one pipeline, expanded, at full density', async () => {
  const ctx = await boot();
  await ctx.go('history/p-1');
  const cards = ctx.window.document.querySelectorAll('#history .hist-card');
  assert.equal(cards.length, 1, 'one pipeline');
  assert.equal(cards[0].classList.contains('full'), true);
  assert.equal(cards[0].querySelector('.hist-detail').hidden, false,
    'a detail view that opens collapsed would be a click for nothing');
  // The project-filter pills belong to a LIST.
  assert.equal(ctx.window.document.querySelector('#historyFilter').hidden, true);
  const back = ctx.window.document.querySelector('.detail-bar .detail-back');
  assert.match(back.textContent, /History/, 'a deep link falls back to the list that owns it');
});

test('the five stacked dropdowns become one tab bar, one panel at a time', async () => {
  const ctx = await boot();
  await ctx.go('history/p-1');
  const c = ctx.window.document.querySelector('#history .hist-card');
  const tabs = [...c.querySelectorAll('.run-tab')];
  assert.deepEqual(tabs.map((t) => t.dataset.tabKey),
    ['results', 'diff', 'overview', 'agents', 'clarify', 'log'],
    'every populated panel contributes exactly one tab');
  const on = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
  assert.equal(on.length, 1);
  assert.equal(on[0].dataset.tabKey, 'results', 'the findings open first');

  const off = [...c.querySelectorAll('.hist-detail > [data-tab]')].filter((p) => p.classList.contains('tab-off'));
  assert.equal(off.length, 5, 'the other five are off — not stacked below');

  // A tab carries the count its panel already renders; a lone badge is compacted
  // to its number because the label beside it says what is counted.
  assert.equal(tabs.find((t) => t.dataset.tabKey === 'clarify').querySelector('.n').textContent, '1');
  assert.match(tabs.find((t) => t.dataset.tabKey === 'diff').querySelector('.n').textContent,
    /changed.*removed/, 'several badges keep the words that tell them apart');
});

test('selecting a tab opens the panel it controls, including a lazily-fetched one', async () => {
  const ctx = await boot();
  await ctx.go('history/p-1');
  const c = ctx.window.document.querySelector('#history .hist-card');
  const logTab = [...c.querySelectorAll('.run-tab')].find((t) => t.dataset.tabKey === 'log');
  logTab.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  for (let i = 0; i < 4; i++) await ctx.tick();

  assert.equal(c.querySelector('.logs-bar').classList.contains('tab-off'), false);
  assert.equal(c.querySelector('.results-section').classList.contains('tab-off'), true);
  // The saved-log replay is behind the bar's own button; the tab has to drive it.
  assert.equal(c.querySelector('.logs-bar .btn-subs').getAttribute('aria-expanded'), 'true');
  assert.equal(c.querySelectorAll('.logs-panel .log .log-line').length, 1,
    'the NDJSON replay rendered');
});

test('Archive is a detail-view action, not a list one', async () => {
  const ctx = await boot();
  await ctx.go('history');
  const listCard = histCard(ctx.window);
  listCard.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  for (let i = 0; i < 4; i++) await ctx.tick();
  // Present in the DOM (one template) but not part of the list's mini view.
  assert.ok(listCard.querySelector('.hist-actions'), 'same template');
  await ctx.go('history/p-1');
  assert.ok(ctx.window.document.querySelector('#history .hist-card.full .hist-actions'),
    'the destructive action lives on the page about ONE pipeline');
});

test('a #history/<id> for an id that is not in history says so', async () => {
  const ctx = await boot();
  await ctx.go('history/nope');
  assert.match(ctx.window.document.querySelector('#history').textContent,
    /not in history/);
});
