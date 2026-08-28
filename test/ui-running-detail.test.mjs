// test/ui-running-detail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';

// The Running detail screen's body: live pipeline graph, banners, question panel.
//
// boot() / settle() / go() are copied verbatim from test/ui-running-routing.test.mjs
// (itself copied from test/ui-history-routing.test.mjs:25-96); the open() / recv()
// WebSocket drivers come from test/ui-pipeline-tabs.test.mjs:31-33.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

const PROJECT = '/tmp/proj';
const ID = 'auth-fix';

const STEPPER2 = { steps: [{ label: 'Plan', nodes: [{ id: 'a', label: 'Planner' }] },
                           { label: 'Build', nodes: [{ id: 'b', label: 'Implementer' }] }] };
const STEPPER3 = { steps: [{ label: 'Plan', nodes: [{ id: 'a', label: 'Planner' }] },
                           { label: 'Build', nodes: [{ id: 'b', label: 'Implementer' }] },
                           { label: 'Review', nodes: [{ id: 'c', label: 'Reviewer' }] }] };

async function boot({ url = 'http://localhost:4317/', fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(u), opts || {}); if (r) return r; }
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch { /* read-only global already present */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, calls, recv };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

// Boot -> hello -> open the detail on ID.
async function openDetail(extra = {}) {
  const ctx = await boot(extra.bootOpts || {});
  ctx.recv({ type: 'hello', runs: [live(ID, extra.run || {})] });
  await settle(ctx.window);
  go(ctx.window, `running/${ID}`);
  await settle(ctx.window);
  ctx.screen = ctx.window.document.querySelector('#run-detail');
  return ctx;
}

// ---------------------------------------------------------------------------
// T7 helpers (appended to the header above — nothing here re-declares one of its
// names). `frame(ctx, msg)` is the alias Tasks 7-9 use for the ctx.recv it returns.
// ---------------------------------------------------------------------------
const KEY = 'proj-alpha-abcd1234';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const DAY = 86400000;
const okBudget = (over = {}) => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false, ...over,
});

// One History row for the SAME project, so the View-in-History link can resolve a
// projectKey for a live run (see historyKeyForRun in Task 9). listAllPipelines
// (src/core/artifacts.mjs:1521, filtered only by `archived_at IS NULL` on 1527)
// tags every row with {id, projectKey, projectName, projectDir}.
const HISTORY_ROW = {
  id: 'older1', projectKey: KEY, projectName: 'Alpha', projectDir: PROJECT,
  title: 'An older pipeline', status: 'done', startedAt: '2026-08-18T10:00:00Z',
  mtime: 1, totalCostUsd: 1, totalActiveMs: 1000,
};

async function bootRunning({ budget = okBudget(), rows = [HISTORY_ROW] } = {}) {
  const box = { budget, rows };
  // boot(): ({url, fetchHandler}) -> {window, calls, recv}, socket already open.
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return ok({ ok: true });
      if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: false });
      if (url.endsWith('/api/budget')) return ok(box.budget);
      return null;
    },
  });
  ctx.box = box;
  // onHello background-loads /api/history on the FIRST connect, which is what
  // fills state.historyAll for Task 9's link resolution.
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  return ctx;
}

// One WS frame, through the header's recv.
const frame = (ctx, msg) => ctx.recv(msg);

const STEPS = () => ([
  { key: 'plan#1', nodeId: 'plan', cycle: 1, status: 'done',
    activeMs: 65000, costUsd: 0.5, skills: ['skill:brainstorming'] },
  { key: 'implement#1', nodeId: 'implement', cycle: 1, status: 'start',
    activeMs: 30000, costUsd: 1.0, graphifyCount: 2 },
]);

const SUBS = () => ([
  { id: 'a1', label: 'Explore repo', nodeId: 'implement', cycle: 1,
    status: 'running', subagentType: 'Explore', startedAt: '2026-08-19T10:01:00Z' },
  { id: 'a2', label: 'Write tests', nodeId: 'implement', cycle: 1,
    status: 'finished', durationMs: 124000, costUsd: 0.0421 },
]);

// Seed one live pipeline and open its detail screen. `logs` are framed BEFORE the
// screen opens on purpose: until Task 8 lands there is no live appender, so a line
// that arrives after the open cannot reach the pane — buildRdLogs hydrates from
// r.logLines, which is exactly what §5.6 says it does.
async function openRun(ctx, over = {}, logs = []) {
  frame(ctx, {
    type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run',
  });
  // `phase` rides on the STATE frame, deliberately. onState calls the same
  // `advanceRun(r, msg)` when `msg.phase` is set, so r.phaseKey / r.cycle /
  // r.maxCellIdx / r.nodeStatus come out identical — but it mints NO log record,
  // whereas a standalone `{type:'phase'}` frame goes through `onPhase`, which
  // writes `onLog(r, { source:'phase', level:'phase', … })`. That synthetic line
  // would land in `r.logLines` before the detail mounts and silently break every
  // `.log-line` count and every source-facet list in Tasks 7, 8 and 9.
  // `nodeKindFor(r, 'running')` returns 'now' exactly as `'start'` does, so the
  // frontier node still glows. `id:'p1'` is what onState turns into r.pipelineId.
  frame(ctx, {
    type: 'state', runId: 'r1', id: 'p1', status: 'running',
    phase: 'implement', cycle: 1,
    steps: STEPS(), subAgents: SUBS(), totalCostUsd: 1.5,
    branch: { source: 'main', feature: 'worca-cc/dark-p1', worktreeDir: '/tmp/wt' },
    prompt: 'Add a dark mode toggle to the settings page.',
    ...over,
  });
  for (const l of logs) frame(ctx, { type: 'log', runId: 'r1', ...l });
  go(ctx.window, 'running/r1');
  await settle(ctx.window, 6);
  return ctx.window.document.querySelector('#run-detail .rd-header');
}

const secOf = (window, key) => window.document.querySelector(`#run-detail .rd-sec[data-sec="${key}"]`);
const tabOf = (window, key) => window.document.querySelector(`#run-detail .rd-tab[data-sec="${key}"]`);
const rdBox = (window) => window.document.querySelector('#run-detail .rd-sec[data-sec="logs"] .log');
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// ---------- graph ----------



// ---------- banners ----------

test('a cost-paused run renders the cost banner above the graph', async () => {
  const { window, recv } = await openDetail();
  // onDone is the ONLY writer of r.pauseReason: `r.pauseReason = msg.reason ||
  // null;`. onState never sets it, so a `state` frame cannot drive this banner.
  recv({ type: 'done', runId: ID, status: 'paused', reason: 'cost_pipeline' });
  await settle(window);

  const banners = window.document.querySelector('#run-detail .rd-banners');
  const banner = banners.querySelector('.cost-banner');
  assert.ok(banner, 'the cost-pause banner renders on the detail page too (D11)');
  assert.ok(banner.classList.contains('cb-pipeline'));
  assert.match(banner.textContent, /pipeline cost limit reached/);
  const graph = window.document.querySelector('#run-detail .rd-graph');
  assert.equal(banners.compareDocumentPosition(graph) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    window.Node.DOCUMENT_POSITION_FOLLOWING, 'banners sit ABOVE the graph (spec §5.2)');
});

test('"Continue without cap" confirms, then resumes with ignoreCostCap', async () => {
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/api/resume')) {
          posts.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'auth-fix-2', pipelineId: 'p1' }) });
        }
        return null;
      },
    },
  });
  const { window } = ctx;
  window.__np.getRun(ID).pipelineId = 'p1';
  ctx.recv({ type: 'done', runId: ID, status: 'paused', reason: 'cost_pipeline' });
  await settle(window);

  const override = window.document.querySelector('#run-detail .rd-banners .cb-override');
  assert.ok(override, 'the pipeline banner offers the override button');
  override.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);

  const modal = window.document.querySelector('#confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'confirmModal asks first');
  assert.equal(window.document.querySelector('#confirm-title').textContent, 'Continue without cap?');
  window.document.querySelector('#confirm-ok').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);

  assert.deepEqual(posts, [{ pipelineId: 'p1', ignoreCostCap: true }],
    'POST /api/resume carries the cap override');
});

test('the cost banner is rebuilt only when the reason changes', async () => {
  const { window, recv } = await openDetail();
  recv({ type: 'done', runId: ID, status: 'paused', reason: 'cost_pipeline' });
  await settle(window);
  const first = window.document.querySelector('#run-detail .rd-banners .cost-banner');
  recv({ type: 'state', runId: ID, status: 'paused', steps: [] });     // plain repaint
  await settle(window);
  assert.equal(window.document.querySelector('#run-detail .rd-banners .cost-banner'), first,
    'an unchanged reason must not detach the node the .cb-override click is mid-flight on');
});

test('retained work renders from branch.commitFailed and binds Discard exactly once', async () => {
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/discard-worktree')) {
          posts.push(u);
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ remaining: 0, patches: [] }) });
        }
        return null;
      },
    },
  });
  const { window, recv } = ctx;
  window.__np.getRun(ID).pipelineId = 'p1';
  const RETAINED = {
    type: 'state', runId: ID, status: 'running', steps: [],
    branch: { source: 'main', feature: 'worca-cc/auth', worktreeDir: '/tmp/wt',
              commitFailed: { code: 'dirty', step: 'commit', message: 'nothing staged' } },
  };
  recv(RETAINED);
  await settle(window);

  const banner = window.document.querySelector('#run-detail .retained-banner');
  assert.equal(banner.hidden, false, 'the retained-work banner renders on the detail page (D11)');
  assert.match(banner.textContent, /uncommitted work retained/);
  assert.match(banner.textContent, /\/tmp\/wt/);

  // Repaint several times — setupDiscardWorktreeButton adds a listener on EVERY
  // call and gives no removal handle, so an unguarded re-bind would fire one POST
  // per paint.
  recv(RETAINED);
  recv(RETAINED);
  await settle(window);

  const btn = window.document.querySelector('#run-detail .hist-discard');
  assert.equal(btn.hidden, false);
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await confirmDialog(window);
  await settle(window, 5);
  assert.equal(posts.length, 1, 'exactly one POST per click, after three paints');
});

// The success path of setupDiscardWorktreeButton was written for History, which
// rebuilds its whole screen afterwards. The Running detail reuses the button and
// derives retention from r.branch.commitFailed — which the server clears only in
// the DB — so without a run-side clear the banner comes back on the next frame,
// now claiming work is retained for a worktree that is gone.
test('a successful discard clears the Running banner for good and re-arms the button', async () => {
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u) => (u.includes('/discard-worktree')
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ remaining: 0, patches: ['/tmp/x.patch'] }) })
        : null),
    },
  });
  const { window, recv } = ctx;
  window.__np.getRun(ID).pipelineId = 'p1';
  const RETAINED = {
    type: 'state', runId: ID, status: 'running', steps: [],
    branch: { source: 'main', feature: 'worca-cc/auth', worktreeDir: '/tmp/wt',
              commitFailed: { code: 'dirty', step: 'commit', message: 'nothing staged' } },
  };
  recv(RETAINED);
  await settle(window);

  const btn = window.document.querySelector('#run-detail .hist-discard');
  const before = btn.textContent;
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await confirmDialog(window);
  await settle(window, 6);

  assert.equal(window.document.querySelector('#run-detail .retained-banner').hidden, true,
    'the banner goes away on this screen, not just on History');
  assert.equal(window.document.querySelector('#run-detail .hist-discard').hidden, true,
    'and so does the action');
  assert.equal(btn.disabled, false, 'the control is not left permanently disabled');
  assert.equal(btn.textContent, before, 'nor stuck reading "Saving patch…"');

  // The orchestrator keeps stamping commitFailed in its in-memory state; the next
  // frame must NOT resurrect a banner for a worktree that no longer exists.
  recv(RETAINED);
  await settle(window);
  assert.equal(window.document.querySelector('#run-detail .retained-banner').hidden, true,
    'a later state frame does not re-render a now-false retention claim');
});

test('a recovery-patch artifact adds the alternate-recovery link once', async () => {
  const { window, recv } = await openDetail();
  window.__np.getRun(ID).pipelineId = 'p1';
  recv({ type: 'artifact', runId: ID, kind: 'retained-work-patch', path: '/tmp/x.patch' });
  recv({
    type: 'state', runId: ID, status: 'running', steps: [],
    branch: { feature: 'worca-cc/auth', worktreeDir: '/tmp/wt',
              commitFailed: { code: 'dirty', step: 'commit', message: 'nope' } },
  });
  await settle(window);

  let links = window.document.querySelectorAll('#run-detail .retained-patch-link');
  assert.equal(links.length, 1, 'addRecoveryPatchLink ran off the recorded artifact');
  assert.match(links[0].querySelector('a').getAttribute('href'), /\/api\/runs\/p1\/recovery-patch/);

  recv({ type: 'state', runId: ID, status: 'running', steps: [],
         branch: { feature: 'worca-cc/auth', worktreeDir: '/tmp/wt',
                   commitFailed: { code: 'dirty', step: 'commit', message: 'nope' } } });
  await settle(window);
  links = window.document.querySelectorAll('#run-detail .retained-patch-link');
  assert.equal(links.length, 1, 'and self-guards against duplicates on repaint');
});

// ---------- question panel ----------

const clarify = (id = 'q1') => ({
  id, kind: 'clarify',
  questions: [
    { id: 'q1a', question: 'Which auth flow?', options: ['OAuth', 'Magic link', ''] },
    { id: 'q1b', question: 'Anything else?', options: [] },
  ],
});

test('a clarify question renders the large panel on the detail page', async () => {
  const { window, recv } = await openDetail();
  recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const host = window.document.querySelector('#run-detail .rd-questions');
  assert.equal(host.hidden, false, 'the panel container is revealed');
  const panel = host.querySelector('.qpanel');
  assert.equal(panel.classList.contains('hidden'), false);
  assert.equal(panel.querySelectorAll('.qblock').length, 2, 'renderClarifyBody ran into the detail host');
  assert.equal(panel.querySelectorAll('.qopt').length, 2, 'padding options are filtered out');
  assert.ok(panel.querySelector('.btn-go'), 'the submit button is present');
  // It sits between the graph and where T7 puts the tabs.
  const graph = window.document.querySelector('#run-detail .rd-graph');
  assert.equal(graph.compareDocumentPosition(host) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    window.Node.DOCUMENT_POSITION_FOLLOWING, 'the panel follows the graph (spec §5.4)');
});

test('the gate and recovery bodies render on the detail page too (D6)', async () => {
  const gate = await openDetail();
  gate.recv({ type: 'question', runId: ID, id: 'g1', kind: 'gate',
              issues: [{ severity: 'major', title: 'Missing test', detail: 'x' }] });
  await settle(gate.window);
  const gpanel = gate.window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.ok(gpanel.querySelector('.gate-another'), 'the gate body renders');
  assert.equal(gpanel.querySelectorAll('.issues .issue').length, 1);

  const rec = await openDetail();
  rec.recv({ type: 'question', runId: ID, id: 'r1', kind: 'recovery',
             recovery: { cls: 'auth', message: 'token expired' } });
  await settle(rec.window);
  const rpanel = rec.window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.ok(rpanel.querySelector('.recovery-retry'), 'the recovery body renders');
  assert.match(rpanel.textContent, /token expired/);
});

test('answers posted from the DETAIL panel carry the detail panel\'s choices', async () => {
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/api/answer')) {
          posts.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        return null;
      },
    },
  });
  const { window } = ctx;
  ctx.recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const dpanel = window.document.querySelector('#run-detail .rd-questions .qpanel');
  dpanel.querySelectorAll('.qopt')[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  dpanel.querySelector('.btn-go').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.answers[0].choice, 'OAuth',
    'the DETAIL panel\'s slot won, not whichever panel painted last');
});

test('answers posted from the CARD panel still carry the card\'s choices', async () => {
  // THE dual-mount regression, and the one that is RED before the fix.
  // renderClarifyBody rebuilds r._answers on every call; paintRunDetail runs
  // AFTER renderOverview, so the DETAIL panel always paints last and owns that
  // array. The card's option clicks mutate slots nobody reads, and its Submit
  // posts the detail panel's untouched (empty) choices.
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/api/answer')) {
          posts.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        return null;
      },
    },
  });
  const { window } = ctx;
  ctx.recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const cpanel = window.document.querySelector(`#run-list .run-card[data-run-id="${ID}"] .qpanel`);
  assert.ok(cpanel, 'the list card still carries its own panel (D6)');
  cpanel.querySelectorAll('.qopt')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  cpanel.querySelector('.btn-go').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.answers[0].choice, 'Magic link');
});

test('submitting busies BOTH mounted panels and resolving clears both', async () => {
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u) => (u.includes('/api/answer')
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
        : null),
    },
  });
  const { window, recv } = ctx;
  recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const dpanel = window.document.querySelector('#run-detail .rd-questions .qpanel');
  const cpanel = window.document.querySelector(`#run-list .run-card[data-run-id="${ID}"] .qpanel`);
  dpanel.querySelector('.btn-go').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);
  assert.equal(dpanel.querySelector('.btn-go').disabled, true);
  assert.equal(cpanel.querySelector('.btn-go').disabled, true,
    'the card panel cannot stay clickable while an answer is in flight');

  recv({ type: 'question-resolved', runId: ID, id: 'q1' });
  await settle(window);
  assert.equal(window.document.querySelector('#run-detail .rd-questions').hidden, true);
  assert.equal(window.document.querySelector('#run-detail .rd-questions .qpanel').innerHTML, '');
  assert.equal(cpanel.innerHTML, '', 'and the card panel is emptied too');
});

// THE repaint-storm regression. paintRunDetail runs on EVERY ws frame — including
// log lines belonging to a DIFFERENT run — and renderQpanel is destructive. An
// unconditional rebuild silently discards a half-finished answer.
test('an unrelated live frame does not wipe the answers already picked on the detail panel', async () => {
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/api/answer')) {
          posts.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        return null;
      },
    },
  });
  const { window, recv } = ctx;
  recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const panel = () => window.document.querySelector('#run-detail .rd-questions .qpanel');
  const node = panel();
  // Pick an option on question 1, and type free text into question TWO's field.
  // Both questions get a `.qfree` (renderClarifyBody adds one unless
  // `allowFreeText === false`), and its `input` handler CLEARS the selected
  // option **of its own block** (and only when the typed value is non-empty).
  // Typing into `querySelector('.qfree')` — q1a's — would therefore wipe the very
  // selection this test is about to assert survived, and rewrite
  // answers[0].choice to 'typed by hand'. Index [1] is q1b's field, which owns no
  // picked option.
  panel().querySelectorAll('.qopt')[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  const free = panel().querySelectorAll('.qfree')[1];
  assert.ok(free, 'the second question ships a free-text field');
  free.value = 'typed by hand';
  free.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(panel().querySelectorAll('.qopt.sel').length, 1, 'one option is picked');

  // A second run's log line, then this run's own state frame: both reach
  // handleServerMessage's tail and repaint the open detail.
  recv({ type: 'run-created', runId: 'other', title: 'Other', projectDir: PROJECT,
         status: 'running', startedAt: '2026-08-19T11:00:00Z', kind: 'run' });
  recv({ type: 'log', runId: 'other', source: 'planner', level: 'info', text: 'noise', ts: 0, stepIndex: 0, cycle: 1 });
  recv({ type: 'state', runId: ID, status: 'running', steps: [], stepper: null });
  await settle(window, 4);

  assert.equal(panel(), node, 'the panel node itself is not replaced');
  assert.equal(panel().querySelectorAll('.qopt.sel').length, 1,
    'the picked option survives an unrelated repaint');
  assert.equal(panel().querySelectorAll('.qfree')[1].value, 'typed by hand',
    'and so does the free text being typed');

  panel().querySelector('.btn-go').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.answers[0].choice, 'OAuth',
    'the slots the clicks wrote into were not rebuilt out from under them');
  assert.equal(posts[0].payload.answers[1].choice, 'typed by hand',
    'and the typed slot posted its own text');
});

test('a NEW question replaces the panel even though one was already painted', async () => {
  const { window, recv } = await openDetail();
  recv({ type: 'question', runId: ID, ...clarify('q1') });
  await settle(window);
  recv({ type: 'question-resolved', runId: ID, id: 'q1' });
  await settle(window);
  recv({ type: 'question', runId: ID, ...clarify('q2') });
  await settle(window);
  const panel = window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.equal(window.document.querySelector('#run-detail .rd-questions').hidden, false);
  assert.equal(panel.querySelectorAll('.qblock').length, 2, 'the identity guard let the new question through');
  // The stamp is `<id>|<kind>|<count>` — assert the id half, not the whole key,
  // so adding a discriminator to it later does not red this case.
  assert.match(panel.dataset.qid, /^q2\|/);
});

test('the question panel rises in and is neutralized under reduced motion', () => {
  assert.equal((css.match(/@keyframes wr-rise/g) || []).length, 1,
    'the shared keyframe is declared once by Task 3 (C2)');
  assert.match(css, /\.rd-questions\s*\{[^}]*animation:\s*wr-rise/);
  assert.match(css, /\.rd-questions\[hidden\]\s*\{[^}]*display:\s*none/,
    'an explicit twin — the UA [hidden] rule loses to any author display');
  const at = css.indexOf('.rd-questions{');
  const kill = css.indexOf('.rd-questions{animation:none;}');
  assert.ok(kill > at, 'the reduced-motion block sits AFTER the rule it neutralizes');
});

// --- T7: tabs ---------------------------------------------------------------

test('the detail has exactly three tabs, Live log first and active by default', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  const tabs = [...window.document.querySelectorAll('#run-detail .rd-tab')];
  assert.deepEqual(tabs.map((b) => b.dataset.sec), ['logs', 'overview', 'agents']);
  assert.match(tabs[0].textContent, /Live log/);
  assert.match(tabs[1].textContent, /Overview/);
  assert.match(tabs[2].textContent, /Agents/);
  assert.ok(tabs[0].classList.contains('active'), 'Live log is the default tab');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(secOf(window, 'logs').hidden, false);
  assert.equal(secOf(window, 'overview').hidden, true);
  assert.equal(secOf(window, 'agents').hidden, true);
  // D1: no Diff. And no Clarify — a live question is a panel, not a tab.
  assert.equal(window.document.querySelector('#run-detail .rd-tab[data-sec="diff"]'), null);
  assert.equal(window.document.querySelector('#run-detail .rd-tab[data-sec="clarify"]'), null);
  // The Agents pill carries the live sub-agent count.
  assert.equal(tabOf(window, 'agents').querySelector('.rd-tab-badge').textContent, '2');
});

test('the Live log tab is the CARD pipeline: bar, switch, hydrated lines, shared filter', async () => {
  const ctx = await bootRunning();
  await openRun(ctx, {}, [
    { source: 'planner', level: 'info', text: 'pass one', ts: 0, stepIndex: 0, cycle: 1 },
    { source: 'implementer', level: 'warn', text: '429, retrying', ts: 0, stepIndex: 1, cycle: 1 },
  ]);
  const { window } = ctx;
  await settle(window);

  const sec = secOf(window, 'logs');
  assert.ok(sec.classList.contains('rd-sec-logs'));
  // D9: the shared bar, cloned from #run-card-tpl — same controls in the same
  // order. Every control carries BOTH `log-f` and its specific class, so
  // classList[1] is the specific one.
  const bar = sec.querySelector('.log-filters');
  assert.ok(bar, 'the detail carries the shared filter bar');
  assert.deepEqual(
    [...bar.querySelectorAll('.log-f')].map((n) => n.classList[1]),
    ['log-f-source', 'log-f-level', 'log-f-step', 'log-f-cycle', 'log-f-exec', 'log-search', 'log-copy']);
  assert.ok(sec.querySelector('.switch.autoscroll'), 'the auto-scroll switch rides along');
  // Lines come from r.logLines, not from a fetch: no /log request was made.
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/log')).length, 0);
  // Exactly the two seeded lines. `openRun` deliberately carries `phase` on the
  // STATE frame rather than firing a separate `{type:'phase'}` one: `onPhase`
  // synthesizes a log record of its own, which would put a third, `source:'phase'`
  // line in this pane and a third entry in the facet list below.
  assert.equal(sec.querySelectorAll('.log .log-line').length, 2);
  // Facets are populated from the lines seen so far.
  assert.deepEqual([...bar.querySelector('.log-f-source').options].map((o) => o.value),
    ['', 'implementer', 'planner']);

  // The filter is the RUN's own object, so the card and the detail share one.
  const source = bar.querySelector('.log-f-source');
  source.value = 'planner';
  source.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(window);
  const r = window.__np.getRun('r1');
  assert.equal(r.logFilter.source, 'planner');
  assert.equal(sec.querySelectorAll('.log .log-line').length, 1);
  assert.match(sec.querySelector('.log .log-line').textContent, /pass one/);
});

// --- T7: Overview -----------------------------------------------------------


test('the COST sub-line reads "across N steps" when no per-pipeline cap is set', async () => {
  const ctx = await bootRunning({ budget: okBudget({ pipelineLimitUsd: null }) });
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  const cards = [...secOf(window, 'overview').querySelectorAll('.hd-ov-grid .hd-ov-card')];
  assert.equal(cards[1].querySelector('.hd-ov-sub').textContent, 'across 2 steps');
});

test('the Task card shows the prompt with a Show more expander past 600 chars', async () => {
  const ctx = await bootRunning();
  const long = 'x'.repeat(650);
  await openRun(ctx, { prompt: long });
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  const task = secOf(window, 'overview').querySelector('.hd-ov-task');
  assert.equal(task.querySelector('.hd-ov-task-h').textContent, 'Task');
  assert.equal(task.querySelector('p').textContent.length, 601);      // 600 + the ellipsis
  const more = task.querySelector('.hd-ov-more');
  assert.equal(more.textContent, 'Show more');
  click(window, more);
  assert.equal(task.querySelector('p').textContent, long);
  assert.equal(task.querySelector('.hd-ov-more'), null, 'the expander removes itself');
  assert.deepEqual([...task.querySelectorAll('.hd-ov-tag')].map((c) => c.textContent),
    ['proj', 'main', '2 sub-agents']);
});

// --- T7: Agents -------------------------------------------------------------


test('Agents renders the empty state when nothing has been recorded', async () => {
  const ctx = await bootRunning();
  frame(ctx, {
    type: 'run-created', runId: 'r2', title: 'Fresh run', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run',
  });
  go(ctx.window, 'running/r2');
  await settle(ctx.window, 6);
  click(ctx.window, tabOf(ctx.window, 'agents'));
  await settle(ctx.window);
  assert.equal(secOf(ctx.window, 'agents').querySelector('.rd-ag-empty').textContent,
    '(no sub-agents recorded)');
  assert.equal(tabOf(ctx.window, 'agents').querySelector('.rd-tab-badge'), null,
    'no badge when there are no sub-agents');
});

// Sub-agent labels come from attacker-influenced task descriptions, node labels
// from the workflow manifest, and subagentType straight off the `subagent`
// stream — all three are interpolated into innerHTML by rdAgentsBody, so they
// MUST be HTML-escaped. This replaces the two renderSubsTree guards the C9 sweep
// deleted: the painter changed, the sink did not.
test('the Agents tab escapes sub-agent labels, group labels and the type pill', async () => {
  const EVIL = '<img src=x onerror=alert(1)>';
  const EVIL_NODE = '<svg onload=alert(2)>';
  const ctx = await bootRunning();
  await openRun(ctx, {
    stepper: { version: 1, steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
      { kind: 'agents', nodes: [{ id: 'implement', key: 'implement', uiPhase: 'implement', label: EVIL_NODE }] },
      { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
    ], feedbacks: [] },
    steps: [{ key: 'implement#1', nodeId: 'implement', cycle: 1, status: 'start' }],
    subAgents: [{ id: 'a1', label: EVIL, nodeId: 'implement', cycle: 1,
      status: 'running', subagentType: '<b>type</b>' }],
  });
  const { window } = ctx;
  click(window, tabOf(window, 'agents'));
  await settle(window);
  const sec = secOf(window, 'agents');

  assert.equal(sec.querySelectorAll('img, svg').length, 0, 'no markup was parsed out of any label');
  const label = sec.querySelector('.rd-ag-label');
  assert.equal(label.textContent, EVIL, 'the sub-agent label is inert text');
  assert.match(label.innerHTML, /&lt;img/, 'and is stored escaped, not parsed');
  const head = sec.querySelector('.rd-ag-head b');
  assert.equal(head.textContent, EVIL_NODE, 'the group label is inert text');
  assert.match(head.innerHTML, /&lt;svg/);
  const pill = sec.querySelector('.agent-type-pill');
  assert.equal(pill.textContent, '<b>type</b>', 'the type pill is inert text');
  assert.equal(pill.querySelector('b'), null, 'the type pill parsed no element');
});

// The caret's only suppressor was `.rd-terminal …`, i.e. "the run is over". But
// rdRepaintLog has a SECOND empty state — live run, lines present, filter matches
// none — where a caret left blinking after the placeholder reads as a live tail
// that is about to print. `data-empty` is stamped only when r.logLines is
// non-empty, so keying on it leaves a fresh zero-line run its caret.
test('the live-log caret is suppressed beside the "no lines match the filter" placeholder', async () => {
  const ctx = await bootRunning();
  await openRun(ctx, {}, [{ source: 'planner', level: 'info', text: 'pass one', ts: 0, stepIndex: 0, cycle: 1 }]);
  const { window } = ctx;
  const sec = secOf(window, 'logs');
  const box = rdBox(window);
  assert.equal(box.dataset.empty, undefined, 'a matching filter leaves no empty stamp');

  const search = sec.querySelector('.log-search');
  search.value = 'nothing-matches-this';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));   // > LOG_SEARCH_DEBOUNCE_MS (120)

  assert.equal(box.textContent, '(no lines match the filter)');
  assert.equal(box.dataset.empty, '1', 'the filter-empty state is stamped, and the run is still live');
  assert.match(css, /\.rd-sec-logs \.log\[data-empty\]::after\{[^}]*display:\s*none/,
    'the stylesheet hides the caret for that state');
});

// --- T8: live repaint contract ---------------------------------------------

// Lives HERE, not in Task 7, because every assertion after the first depends on a
// live frame reaching sec.__update — and rdUpdateSections, the only thing that
// ever calls it, is this task's.


test('a state frame for the open run repaints the ACTIVE section only', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  const ov = secOf(window, 'overview');
  const agents = secOf(window, 'agents');
  assert.equal(agents.dataset.loaded, undefined, 'Agents was never activated, so never built');
  // Activate Agents once so it IS built, then go back to Overview.
  click(window, tabOf(window, 'agents'));
  await settle(window);
  assert.equal(agents.dataset.loaded, '1');
  click(window, tabOf(window, 'overview'));
  await settle(window);

  frame(ctx, {
    type: 'state', runId: 'r1', id: 'p1', status: 'running',
    steps: STEPS(), totalCostUsd: 9.75,
    subAgents: [...SUBS(), { id: 'a3', label: 'Third', nodeId: 'implement', cycle: 1, status: 'running' }],
    branch: { source: 'main', feature: 'worca-cc/dark-p1', worktreeDir: '/tmp/wt' },
  });
  await settle(window);

  // Active section updated in place.
  const cards = [...ov.querySelectorAll('.hd-ov-grid .hd-ov-card')];
  assert.equal(cards[1].querySelector('.hd-ov-value').textContent, '$9.75');
  // Hidden section: not repainted, but re-armed so activation rebuilds it.
  assert.equal(agents.dataset.loaded, undefined, 'the hidden section was re-armed');
  // The badge tracks the live count even while its tab is hidden.
  assert.equal(tabOf(window, 'agents').querySelector('.rd-tab-badge').textContent, '3');
  click(window, tabOf(window, 'agents'));
  await settle(window);
  assert.equal(agents.querySelectorAll('.rd-ag-row').length, 3, 'rebuilt against current data');
});

test('a log frame appends into the open pane without rebuilding it', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  const sec = secOf(window, 'logs');
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'one', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  const box = rdBox(window);
  assert.equal(box.querySelectorAll('.log-line').length, 1);

  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'two', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  assert.equal(rdBox(window), box, 'the pane node survives — no full rebuild');
  assert.equal(box.querySelectorAll('.log-line').length, 2);

  // Facets GROW as new sources/steps/cycles appear (History's build-once fill is
  // the bug being avoided), and a new cycle still draws its separator.
  frame(ctx, { type: 'log', runId: 'r1', source: 'reviewer', level: 'error', text: 'boom', ts: 0, stepIndex: 5, cycle: 2 });
  await settle(window);
  const bar = sec.querySelector('.log-filters');
  assert.deepEqual([...bar.querySelector('.log-f-source').options].map((o) => o.value),
    ['', 'planner', 'reviewer']);
  assert.deepEqual([...bar.querySelector('.log-f-cycle').options].map((o) => o.value), ['', '1', '2']);
  assert.equal(box.querySelectorAll('.log-sep').length, 1);
  assert.equal(box.querySelector('.log-sep').textContent, 'Cycle 2');
  assert.equal(box.querySelectorAll('.log-line').length, 3);
});

test('frames for another run refresh the sidebar but never touch the open detail', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'mine', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  frame(ctx, {
    type: 'run-created', runId: 'r2', title: 'Other run', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T11:00:00Z', kind: 'run',
  });
  frame(ctx, { type: 'log', runId: 'r2', source: 'planner', level: 'info', text: 'theirs', ts: 0, stepIndex: 0, cycle: 1 });
  frame(ctx, { type: 'state', runId: 'r2', id: 'p2', status: 'running', steps: STEPS(), totalCostUsd: 99 });
  await settle(window);

  const box = rdBox(window);
  assert.equal(box.querySelectorAll('.log-line').length, 1, "r2's lines stay out of r1's pane");
  assert.match(box.textContent, /mine/);
  assert.doesNotMatch(box.textContent, /theirs/);
  assert.equal(window.document.querySelector('#run-detail .rd-header .rd-title').textContent, 'Add dark mode');
  // The sidebar DID learn about r2.
  assert.ok(window.document.querySelector('#nav-running-children button.nav-child[data-child-run-id="r2"]'));
});

test('the existing 1 s interval ticks the open detail, not just the card', async () => {
  const ctx = await bootRunning();
  await openRun(ctx, {
    steps: [
      { key: 'plan#1', nodeId: 'plan', cycle: 1, status: 'done', activeMs: 65000, costUsd: 0.5 },
      { key: 'implement#1', nodeId: 'implement', cycle: 1, status: 'start',
        activeMs: 30000, runningSince: Date.now(), costUsd: 1.0 },
    ],
  });
  const { window } = ctx;
  // ONE timer: the detail screen joins the existing interval's host list rather
  // than getting an interval of its own.
  const r = window.__np.getRun('r1');
  const hosts = window.__np.rdTickHosts(r);
  assert.equal(hosts.length, 2, 'the card and the open detail screen');
  assert.equal(hosts[0], r.el);
  assert.ok(hosts[1].contains(window.document.querySelector('#run-detail .rd-header')),
    'the second host is the mounted detail screen');

  click(window, tabOf(window, 'overview'));
  await settle(window);
  const value = () => secOf(window, 'overview').querySelector('.hd-ov-card-elapsed .hd-ov-value').textContent;
  const before = value();
  await new Promise((r) => setTimeout(r, 1200));
  assert.notEqual(value(), before, 'the ELAPSED stat card ticks without a full repaint');
});

// --- T9: terminal state -----------------------------------------------------

test('a run that finishes while its detail is open keeps the page and goes terminal', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'one', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  assert.equal(rdBox(window).querySelectorAll('.log-line').length, 1);

  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(window, 6);

  // D8: no auto-redirect — the page stays exactly where it was.
  assert.equal(window.location.hash, '#running/r1');
  assert.ok(window.document.getElementById('run-shell').classList.contains('detail-open'));
  assert.ok(window.document.querySelector('#run-detail .rd-header'), 'the screen is still mounted');

  const header = window.document.querySelector('#run-detail .rd-header');
  assert.equal(header.querySelector('.rd-pause').hidden, true);
  assert.equal(header.querySelector('.rd-stop').hidden, true);
  const pill = header.querySelector('.rd-status');
  assert.ok(pill.classList.contains('green'), 'the pill takes the terminal family');
  assert.ok(pill.classList.contains('parked'), 'and its dot stops pulsing');
  assert.ok(window.document.querySelector('#run-detail .rd-graph').classList.contains('settled'));

  const link = header.querySelector('.rd-history-link');
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute('href'), `#history/${KEY}/p1`);
  assert.equal(link.textContent, 'View in History');

  // The log stops growing: a stray late frame lands on a finished run and the
  // pane is unchanged.
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'late', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  assert.doesNotMatch(rdBox(window).textContent, /late/);
});

test('Overview reads the terminal state once the run has finished', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  frame(ctx, { type: 'done', runId: 'r1', status: 'stopped' });
  await settle(window, 6);
  const copy = secOf(window, 'overview').querySelector('.rd-ov-copy').textContent;
  assert.match(copy, /^Stopped\. Finished at \d\d:\d\d:\d\d\.$/);
  assert.ok(secOf(window, 'overview').querySelector('.rd-ov-chip').classList.contains('st-red'));
});

test('the History link is omitted when the pipeline id is unknown', async () => {
  const ctx = await bootRunning();
  frame(ctx, {
    type: 'run-created', runId: 'r3', title: 'No id yet', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run',
  });
  go(ctx.window, 'running/r3');
  await settle(ctx.window, 6);
  // onError (app.js) routes straight to finishRun(r, 'error').
  frame(ctx, { type: 'error', runId: 'r3' });
  await settle(ctx.window, 6);
  const link = ctx.window.document.querySelector('#run-detail .rd-history-link');
  assert.equal(link.hidden, true, 'no pipelineId -> no link');
});

test('the projectKey falls back to another pipeline from the same project dir', async () => {
  // r1's own pipeline id ('p1') is NOT in the History dataset — only an older run
  // from the same projectDir is. The dir->key mapping still resolves the link.
  const ctx = await bootRunning({ rows: [HISTORY_ROW] });
  await openRun(ctx);
  const { window } = ctx;
  assert.equal(ctx.box.rows.some((p) => p.id === 'p1'), false);
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(window, 6);
  assert.equal(window.document.querySelector('#run-detail .rd-history-link').getAttribute('href'),
    `#history/${KEY}/p1`);
});

test('an unresolvable projectKey hides the link instead of guessing one', async () => {
  const ctx = await bootRunning({ rows: [] });          // no history at all
  await openRun(ctx);
  const { window } = ctx;
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(window, 6);
  assert.equal(window.document.querySelector('#run-detail .rd-history-link').hidden, true);
});
// --- P6b Task 14: the Agents tab names v2 groups from the ledger -------------
// C3: cycleAwareLabel's 4th parameter is only reachable through rdAgentsBody's
// call site — a unit test that passes the ledger directly leaves the app arm
// dead. This drives the REAL path: WS frames -> run model -> detail -> tab.

const V2_MANIFEST = {
  version: 2,
  template: { id: 'wf', name: 'WF' },
  graph: {
    nodes: [
      { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', color: 'blue', x: 0, y: 0, ports: { inputs: [], outputs: [], await: true } },
      { id: 'n_or', kind: 'or', key: null, label: 'OR', x: 0, y: 0, ports: { inputs: [], outputs: [], await: false } },
    ],
    wires: [],
  },
};

const V2_STEPS = () => ([
  { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', activeMs: 1000, costUsd: 0.1 },
  { key: 'x:n_impl:1:p1t3', executionId: 'x:n_impl:1:p1t3', nodeId: 'n_impl', ordinal: 1, kind: 'task', title: 'Add schema', cycle: 1, status: 'done', activeMs: 2000, costUsd: 0.2 },
  { key: 'x:n_impl:2', executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, kind: 'cycle', cycle: 2, status: 'start', activeMs: 500, costUsd: 0.05 },
  { key: 'x:n_or:1', executionId: 'x:n_or:1', nodeId: 'n_or', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', activeMs: 1, costUsd: 0 },
]);

const V2_SUBS = () => ([
  { id: 'v1', label: 'Slice worker', nodeId: 'n_impl', cycle: 1, stepKey: 'x:n_impl:1:p1t3', status: 'finished', durationMs: 2000, costUsd: 0.2 },
]);

test('Agents: a v2 run names its groups from the ledger (rdAgentsBody passes r.steps)', async () => {
  const ctx = await bootRunning();
  await openRun(ctx, { stepper: V2_MANIFEST, steps: V2_STEPS(), subAgents: V2_SUBS() });
  const { window } = ctx;
  click(window, tabOf(window, 'agents'));
  await settle(window);
  const sec = secOf(window, 'agents');

  const heads = [...sec.querySelectorAll('.rd-ag-group .rd-ag-head b')].map((b) => b.textContent);
  // The OR node writes a ledger row too and must NOT become an Agents group
  // (agentNodeIdSet's v2 arm); every surviving group wears its ledger label.
  assert.deepEqual(heads, ['Implementer #1', 'Implementer #1 · Add schema', 'Implementer #2'],
    'the 4th argument (r.steps) reaches cycleAwareLabel — without it every head reads a bare "Implementer"');
  // The slice's sub-agent row landed in the slice group, not the cycle group.
  const groups = [...sec.querySelectorAll('.rd-ag-group')];
  assert.equal(groups[1].querySelectorAll('.rd-ag-row').length, 1);
  assert.equal(groups[1].querySelector('.rd-ag-label').textContent, 'Slice worker');
});
