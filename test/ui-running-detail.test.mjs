// test/ui-running-detail.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { useAppTimers } from './helpers/app-timers.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

// The Running detail screen's body: live pipeline graph, banners, question panel.
//
// boot() / settle() / go() are copied verbatim from test/ui-running-routing.test.mjs
// (itself copied from test/ui-history-routing.test.mjs:25-96); the open() / recv()
// WebSocket drivers come from test/ui-pipeline-tabs.test.mjs:31-33.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';
const ID = 'auth-fix';

const STEPPER2 = { steps: [{ label: 'Plan', nodes: [{ id: 'a', label: 'Planner' }] },
                           { label: 'Build', nodes: [{ id: 'b', label: 'Implementer' }] }] };
const STEPPER3 = { steps: [{ label: 'Plan', nodes: [{ id: 'a', label: 'Planner' }] },
                           { label: 'Build', nodes: [{ id: 'b', label: 'Implementer' }] },
                           { label: 'Review', nodes: [{ id: 'c', label: 'Reviewer' }] }] };

async function boot({ url = 'http://localhost:4317/', fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
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

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
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
  const box = { budget, rows, chains: [], schedulesFail: false, groups: null };
  // boot(): ({url, fetchHandler}) -> {window, calls, recv}, socket already open.
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/schedules')) {
        return box.schedulesFail
          ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
          : ok({ schedules: [], tickets: [], counts: {}, chains: box.chains });
      }
      if (url.endsWith('/api/history/pr')) return ok({ ok: true });
      if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: false });
      if (url.endsWith('/api/budget')) return ok(box.budget);
      // Runs redesign slice 4: the groups the Group row reads, only when a test sets box.groups.
      if (box.groups && url.includes('/api/run-groups')) return ok({ groups: box.groups });
      // D16: the slice endpoint, only when a test sets box.slice (else the boot's benign default: not a slice).
      if (box.slice && /\/api\/shape\/pipelines\/[^/]+\/slice$/.test(url)) return ok(box.slice);
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
  // The tab tests below drive Details › Live log, so they land there directly; the
  // glance itself is covered by the glance tests further down.
  go(ctx.window, 'running/r1/details/logs');
  await settle(ctx.window, 6);
  return ctx.window.document.querySelector('#run-detail .rd-header');
}

const secOf = (window, key) => window.document.querySelector(`#run-detail .rd-sec[data-sec="${key}"]`);
const tabOf = (window, key) => window.document.querySelector(`#run-detail .rd-tab[data-sec="${key}"]`);
const rdBox = (window) => window.document.querySelector('#run-detail .rd-sec[data-sec="logs"] .log');
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// ---------- graph ----------



// ---------- banners ----------

test('a cost-paused run renders the cost banner above the facts, and a plain repaint keeps the same banner node', async () => {
  await checkRows([
    { name: 'a cost-paused run renders the cost banner above the graph', run: async () => {
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
      // The graph moved into Details › Workflow; on the glance the banners lead the run's
      // sheet, above its facts (spec §5.2's "above everything the run shows").
      const facts = window.document.querySelector('#run-detail .rd-glance .rd-facts');
      assert.equal(banners.compareDocumentPosition(facts) & window.Node.DOCUMENT_POSITION_FOLLOWING,
        window.Node.DOCUMENT_POSITION_FOLLOWING, 'banners sit ABOVE the run\'s facts');
    } },
    { name: 'the cost banner is rebuilt only when the reason changes', run: async () => {
      const { window, recv } = await openDetail();
      recv({ type: 'done', runId: ID, status: 'paused', reason: 'cost_pipeline' });
      await settle(window);
      const first = window.document.querySelector('#run-detail .rd-banners .cost-banner');
      recv({ type: 'state', runId: ID, status: 'paused', steps: [] });     // plain repaint
      await settle(window);
      assert.equal(window.document.querySelector('#run-detail .rd-banners .cost-banner'), first,
        'an unchanged reason must not detach the node the .cb-override click is mid-flight on');
    } },
  ]);
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

  assert.deepEqual(posts, [{ pipelineId: 'p1', baseCheck: true, ignoreCostCap: true }],
    'POST /api/resume carries the cap override');
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
  assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Retained worktree discarded',
    detail: 'Nothing uncommitted needed saving.', action: '' }, 'no Details when no patch was saved');
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
  assert.equal(window.document.querySelector('#run-detail .hist-discard'), null,
    'and so does the action');
  assert.equal(btn.disabled, false, 'the control is not left permanently disabled');
  assert.equal(btn.textContent, before, 'nor stuck reading "Saving patch…"');
  assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Retained worktree discarded',
    detail: '1 recovery patch saved.', action: 'Details' }, 'the result is a toast, not a viewer');

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
  const pauseBtn = rpanel.querySelector('.recovery-pause');
  assert.ok(pauseBtn, 'the give-up button is "Pause"');
  assert.equal(pauseBtn.textContent, 'Pause');
  assert.equal(rpanel.querySelector('.recovery-abort'), null, 'no Abort control remains');
});

test('waiting for the network: a hello paints the banner naming the host; a state frame with networkWait null removes it', async () => {
  const until = new Date(Date.now() + 3_600_000).toISOString();
  const nw = { node: 'implementer', host: 'api.anthropic.com', since: new Date().toISOString(), until };
  const { window, recv } = await openDetail({ run: { networkWait: nw } });
  const banner = window.document.querySelector('#run-detail .rd-banners .net-wait-banner');
  assert.ok(banner, 'the banner renders from the first hello (makeRun keeps networkWait)');
  assert.match(banner.textContent, /Waiting for network… api\.anthropic\.com is unreachable/);
  recv({ type: 'state', runId: ID, status: 'running', steps: [], networkWait: null });
  await settle(window);
  assert.equal(window.document.querySelector('#run-detail .rd-banners .net-wait-banner'), null, 'the network is back: no banner');
});

test('the recovery body carries the network note only when the prompt waits for the network', async () => {
  const until = new Date(Date.now() + 3_600_000).toISOString();
  const net = await openDetail();
  net.recv({ type: 'question', runId: ID, id: 'n1', kind: 'recovery',
             recovery: { cls: 'network', message: 'ECONNRESET', network: { host: 'api.anthropic.com', since: new Date().toISOString(), until } } });
  await settle(net.window);
  const npanel = net.window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.match(npanel.querySelector('.recovery-network').textContent, /api\.anthropic\.com is unreachable/);
  assert.ok(npanel.querySelector('.recovery-retry'), 'Retry is still offered');
  assert.ok(npanel.querySelector('.recovery-pause'), 'Pause is still offered');

  const plain = await openDetail();
  plain.recv({ type: 'question', runId: ID, id: 'n2', kind: 'recovery', recovery: { cls: 'network', message: 'HTTP 500' } });
  await settle(plain.window);
  assert.equal(plain.window.document.querySelector('#run-detail .rd-questions .qpanel .recovery-network'), null);
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

  panel().querySelector('.btn-primary').dispatchEvent(new window.Event('click', { bubbles: true }));
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

// --- T7: tabs ---------------------------------------------------------------

test('Details has eight tabs, results first; the route picks the open one', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  const tabs = [...window.document.querySelectorAll('#run-detail .rd-tab')];
  assert.deepEqual(tabs.map((b) => b.dataset.sec), ['overview', 'diff', 'artifacts', 'actions', 'workflow', 'qa', 'logs', 'agents']);
  assert.match(tabs[0].textContent, /Overview/);
  assert.match(tabs[3].textContent, /Actions/);
  assert.match(tabs[6].textContent, /Logs/);
  assert.match(tabs[5].textContent, /Q&A/);
  // openRun lands on #running/r1/details/logs.
  assert.equal(window.document.querySelector('#run-detail .rd').dataset.mode, 'details');
  assert.ok(tabOf(window, 'logs').classList.contains('active'), 'the routed tab is open');
  assert.equal(tabOf(window, 'logs').getAttribute('aria-selected'), 'true');
  assert.equal(secOf(window, 'logs').hidden, false);
  assert.equal(secOf(window, 'workflow').hidden, true);
  assert.equal(secOf(window, 'overview').hidden, true);
  // No Clarify tab: a waiting question renders on the glance; Q&A is the record.
  assert.equal(window.document.querySelector('#run-detail .rd-tab[data-sec="clarify"]'), null);
  // The Agents pill carries the live sub-agent count.
  assert.equal(tabOf(window, 'agents').querySelector('.rd-tab-badge').textContent, '2');
  // A tab click rewrites the address in place (no extra history entry).
  click(window, tabOf(window, 'overview'));
  await settle(window);
  assert.equal(window.location.hash, '#running/r1/details/overview');
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
  // D9: the shared bar, cloned from #log-bar-tpl — same controls in the same
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

// --- T7: Agents -------------------------------------------------------------


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

test('frames for another run reach the run model but never touch the open detail', async () => {
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
  // The page DID learn about r2.
  assert.ok(window.__np.getRun('r2'), 'r2 is in the run model');
});

test('the existing 1 s interval ticks the open detail', async () => {
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
  assert.equal(hosts.length, 1, 'only the open detail screen (the list card is gone; r.el is null)');
  assert.ok(hosts[0].contains(window.document.querySelector('#run-detail .rd-header')),
    'the host is the mounted detail screen');

  click(window, tabOf(window, 'overview'));
  await settle(window);
  const value = () => secOf(window, 'overview').querySelector('.hd-ov-card-elapsed .hd-ov-value').textContent;
  const before = value();
  const realNow = Date.now;
  const t0 = realNow();
  Date.now = () => t0 + 1500;
  try {
    window.__np.timerTick();
  } finally {
    Date.now = realNow;
  }
  assert.notEqual(value(), before, 'the ELAPSED stat card ticks without a full repaint');
});

// --- T9: terminal state -----------------------------------------------------

test('a run that finishes while its page is open keeps the page, goes terminal, and Overview reads the terminal state', async () => {
  await checkRows([
    { name: 'a run that finishes while its detail is open keeps the page and goes terminal', run: async () => {
      const ctx = await bootRunning();
      await openRun(ctx);
      const { window } = ctx;
      frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'one', ts: 0, stepIndex: 0, cycle: 1 });
      await settle(window);
      assert.equal(rdBox(window).querySelectorAll('.log-line').length, 1);
      // The graph is built when Workflow first opens (Overview leads the tabs): visit it, then
      // come back to Logs so the address below still reads details/logs.
      click(window, tabOf(window, 'workflow'));
      click(window, tabOf(window, 'logs'));
      await settle(window);
      // MAJ-30: the LIVE half of `.rd-graph.settled`. Only the terminal half was
      // pinned, so a paintRdTerminal that stamped `settled` unconditionally killed
      // the marching ants on every running graph with the suite still green — the
      // ants themselves are asserted only by verify-run-monitor-cdp.mjs check(4a/4b).
      assert.equal(window.document.querySelector('#run-detail .rd-graph').classList.contains('settled'), false,
        'a live run never carries .settled');

      frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
      await settle(window, 6);

      // History has no finished row for p1 yet: the page stays exactly where it was.
      assert.equal(window.location.hash, '#running/r1/details/logs');
      assert.ok(window.document.getElementById('run-shell').classList.contains('detail-open'));
      assert.ok(window.document.querySelector('#run-detail .rd-header'), 'the screen is still mounted');

      const header = window.document.querySelector('#run-detail .rd-header');
      const bar = window.document.querySelector('#run-detail .rd-bar');
      assert.equal(bar.querySelector('.rd-pause').hidden, true);
      assert.equal(bar.querySelector('.rd-stop').hidden, true);
      const pill = header.querySelector('.rd-status');   // the bar names the run; Details' header carries the status
      assert.ok(pill.classList.contains('green'), 'the pill takes the terminal family');
      assert.ok(pill.classList.contains('parked'), 'and its dot stops pulsing');
      assert.ok(window.document.querySelector('#run-detail .rd-graph').classList.contains('settled'));
      assert.equal(header.querySelector('.rd-history-link'), null, 'no link to click: the hand-over is automatic');

      // The log stops growing: a stray late frame lands on a finished run and the
      // pane is unchanged.
      frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'late', ts: 0, stepIndex: 0, cycle: 1 });
      await settle(window);
      assert.doesNotMatch(rdBox(window).textContent, /late/);
    } },
    { name: 'Overview reads the terminal state once the run has finished', run: async () => {
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
    } },
  ]);
});

test('a run that finished while open moves to its saved run on the same tab once History has it — not while its History row is still live', async () => {
  await checkRows([
    { name: 'a run that finishes while open moves to its saved run, on the same tab, once History has it', run: async () => {
      const ctx = await bootRunning();
      await openRun(ctx);
      const { window } = ctx;
      click(window, tabOf(window, 'logs'));
      await settle(window);
      assert.equal(ctx.box.rows.some((p) => p.id === 'p1'), false, 'History loaded before p1 was saved');
      // The refetch after the finish brings its finished row: the page hands over.
      ctx.box.rows = [HISTORY_ROW, { ...HISTORY_ROW, id: 'p1', status: 'done' }];
      frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
      await settle(window, 8);
      assert.equal(window.location.hash, `#history/${KEY}/p1/details/logs`, 'the same tab, on the saved run');
    } },
    { name: 'a History row that is still live is not the saved run yet', run: async () => {
      const ctx = await bootRunning();
      await openRun(ctx);
      const { window } = ctx;
      ctx.box.rows = [HISTORY_ROW, { ...HISTORY_ROW, id: 'p1', status: 'running', live: true }];
      frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
      await settle(window, 8);
      assert.equal(window.location.hash, '#running/r1/details/logs', 'its final state may not be on disk yet');
    } },
  ]);
});

test('opening a finished run goes straight to its saved run (glance or tab); with no saved row it stays on the Running page', async () => {
  await checkRows([
    { name: 'opening a finished run goes straight to its saved run (glance or tab)', run: async () => {
      const ctx = await bootRunning({ rows: [HISTORY_ROW, { ...HISTORY_ROW, id: 'p1', status: 'done' }] });
      await openRun(ctx);
      const { window } = ctx;
      frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
      await settle(window, 6);
      assert.equal(window.location.hash, `#history/${KEY}/p1/details/logs`);
      go(window, 'running/r1');
      await settle(window, 6);
      assert.equal(window.location.hash, `#history/${KEY}/p1`, 'the glance opens the saved glance');
      go(window, 'running/r1/details/diff');
      await settle(window, 6);
      assert.equal(window.location.hash, `#history/${KEY}/p1/details/diff`, 'a tab opens the same tab');
    } },
    { name: 'a finished run with no saved row stays on the Running page', run: async () => {
      // No pipeline id, or History without its row (an older run from the same dir does not count).
      const ctx = await bootRunning({ rows: [HISTORY_ROW] });
      frame(ctx, {
        type: 'run-created', runId: 'r3', title: 'No id yet', projectDir: PROJECT,
        status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run',
      });
      go(ctx.window, 'running/r3');
      await settle(ctx.window, 6);
      // onError (app.js) routes straight to finishRun(r, 'error').
      frame(ctx, { type: 'error', runId: 'r3' });
      await settle(ctx.window, 6);
      assert.equal(ctx.window.location.hash, '#running/r3', 'no pipelineId: nothing to hand over to');
      await openRun(ctx);
      frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
      await settle(ctx.window, 6);
      assert.equal(ctx.window.location.hash, '#running/r1/details/logs', 'p1 has no row yet');
    } },
  ]);
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
      { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', color: 'blue', x: 0, y: 0, model: 'claude-fable-5-1', effort: 'max', ports: { inputs: [], outputs: [], await: true } },
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
  // The manifest node's model/effort selection reaches every group head as a
  // pill. state.models is unseeded here, so the RAW id prints (the fallback arm
  // of stepModelPillHtml; the label arm is covered by ui-history-detail).
  for (const g of groups) {
    assert.equal(g.querySelector('.rd-ag-head .sub-model-pill').textContent, 'claude-fable-5-1 · max');
  }
});

// --- script nodes P1b: the live line of a running script card (S4) ----------
const SCRIPT_MANIFEST = {
  version: 2, template: { id: 'wf', name: 'WF' },
  graph: {
    nodes: [
      { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', color: 'blue', x: 0, y: 0, ports: { inputs: [], outputs: [], await: true } },
      { id: 'n_tests', kind: 'script', key: 'runTests', label: 'Run tests', color: 'violet', runtime: 'node', x: 300, y: 0, ports: { inputs: [], outputs: [], await: true } },
    ],
    wires: [],
  },
};

test('a running script card shows its last captured line; agent lines never repaint the graph', async (t) => {
  const ctx = await bootRunning();
  const { window } = ctx;
  window.document.documentElement.dataset.level = 'expert';        // footers are expert detail (docs/ui-levels.md)
  await openRun(ctx, {
    stepper: SCRIPT_MANIFEST, active: [{ nodeId: 'n_tests', executionId: 'x:n_tests:1' }],
    steps: [
      { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', activeMs: 1000, costUsd: 0.1 },
      { key: 'x:n_tests:1', executionId: 'x:n_tests:1', nodeId: 'n_tests', ordinal: 1, kind: 'cycle', cycle: 1, status: 'start', activeMs: 10, costUsd: 0, nodeKey: 'runTests', runtime: 'node' },
    ],
    subAgents: [],
  });
  click(window, tabOf(window, 'workflow'));   // the graph is built when Workflow first opens
  await settle(window);
  const liveOf = () => window.document.querySelector('#run-detail .rd-graph .node[data-node-id="n_tests"] .xfoot .xlive');
  assert.equal(liveOf(), null, 'no line captured yet');
  const timers = useAppTimers(t);
  try {
    frame(ctx, { type: 'log', runId: 'r1', source: 'implementer', level: 'info', text: 'agent chatter', nodeId: 'n_impl' });
    frame(ctx, { type: 'log', runId: 'r1', source: 'runTests', level: 'info', text: '  212 passing  ', nodeId: 'n_tests', executionId: 'x:n_tests:1' });
    frame(ctx, { type: 'log', runId: 'r1', source: 'runTests', level: 'info', text: '3 failing', nodeId: 'n_tests', executionId: 'x:n_tests:1' });
    assert.equal(liveOf(), null, 'coalesced: nothing repaints synchronously on a log frame');
    await timers.advance(320);   // > LIVE_LINE_MS (250)
    assert.equal(liveOf().textContent, '3 failing', 'one repaint carries the newest line');
    assert.equal(window.document.querySelector('#run-detail .rd-graph .node[data-node-id="n_impl"] .xfoot .xlive'), null, 'agents have no live band');
    // A loop re-runs the card: execution 2 is active and has captured nothing yet. A line stands only for the
    // execution that wrote it, so execution 1's last line must not be shown as execution 2's.
    frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: SCRIPT_MANIFEST,
      active: [{ nodeId: 'n_tests', executionId: 'x:n_tests:2' }],
      steps: [
        { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', activeMs: 1000, costUsd: 0.1 },
        { key: 'x:n_tests:1', executionId: 'x:n_tests:1', nodeId: 'n_tests', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', activeMs: 900, costUsd: 0, nodeKey: 'runTests', runtime: 'node', exitCode: 1 },
        { key: 'x:n_tests:2', executionId: 'x:n_tests:2', nodeId: 'n_tests', ordinal: 2, kind: 'cycle', cycle: 2, status: 'start', activeMs: 5, costUsd: 0, nodeKey: 'runTests', runtime: 'node' },
      ],
      subAgents: [] });
    await timers.settle(6);
    assert.equal(liveOf(), null, 'the previous execution\'s last line is not the new execution\'s');
    frame(ctx, { type: 'log', runId: 'r1', source: 'runTests', level: 'info', text: 'retrying', nodeId: 'n_tests', executionId: 'x:n_tests:2' });
    await timers.advance(320);
    assert.equal(liveOf().textContent, 'retrying');
    // One ellipsised line: the band never carries a 64 KiB log line (the runner's cap) into the DOM, and the
    // trailing-blank cut is linear (a /\s+$/ regex is quadratic on a long blank run that is not at the end).
    frame(ctx, { type: 'log', runId: 'r1', source: 'runTests', level: 'info', text: `x${' '.repeat(70000)}y   `, nodeId: 'n_tests', executionId: 'x:n_tests:2' });
    await timers.advance(320);
    assert.equal(liveOf().textContent.length, 240);
    assert.ok(liveOf().textContent.startsWith('x '));
  } finally {
    t.mock.timers.reset();
  }
});

// --- the glance (status line, trail, sheet) and the two modes ---------------

const GLANCE_MANIFEST = {
  version: 2, template: { id: 'wf', name: 'WF' },
  graph: {
    nodes: ['plan', 'impl', 'docs'].map((k, i) => ({
      id: `n_${k}`, kind: 'agent', key: k, label: { plan: 'Plan', impl: 'Implement', docs: 'Docs' }[k],
      color: 'blue', x: i * 300, y: 0, ports: { inputs: [], outputs: [], await: true },
    })),
    wires: [],
  },
};
const T = (m) => `2026-08-19T10:0${m}:00Z`;
const GLANCE_STEPS = () => ([
  { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1, cycle: 1, kind: 'cycle', status: 'done', startedAt: T(0), endedAt: T(1), activeMs: 60000, costUsd: 0.2 },
  { key: 'x:n_plan:2', executionId: 'x:n_plan:2', nodeId: 'n_plan', ordinal: 2, cycle: 2, kind: 'cycle', status: 'done', startedAt: T(1), endedAt: T(2), activeMs: 60000, costUsd: 0.2 },
  { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, cycle: 1, kind: 'cycle', status: 'start', startedAt: T(2), endedAt: null, activeMs: 1000, runningSince: T(2), costUsd: 0.1 },
  { key: 'x:n_docs:1', executionId: 'x:n_docs:1', nodeId: 'n_docs', ordinal: 1, cycle: 1, kind: 'cycle', status: 'start', startedAt: T(2), endedAt: null, activeMs: 1000, runningSince: T(2), costUsd: 0 },
]);

async function openGlance(ctx, hash = 'running/r1', over = {}) {
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Rate limit uploads', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: GLANCE_MANIFEST,
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }, { nodeId: 'n_docs', executionId: 'x:n_docs:1' }],
    steps: GLANCE_STEPS(), subAgents: [], totalCostUsd: 0.5, ...over });
  go(ctx.window, hash);
  await settle(ctx.window, 6);
  return ctx.window.document.querySelector('#run-detail .rd');
}

test('Details is a route: a tab row and a Now row open it; Escape and ‹ Run come back', async () => {
  const ctx = await bootRunning();
  const { window } = ctx;
  const rd = await openGlance(ctx);
  click(window, rd.querySelector('.rd-result [data-rd-tab="workflow"]'));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 4);
  assert.equal(window.location.hash, '#running/r1/details/workflow');
  assert.equal(rd.dataset.mode, 'details');
  assert.equal(rd.querySelector('.rd-details').hidden, false);
  assert.equal(rd.querySelector('.rd-glance').hidden, true);
  assert.equal(rd.querySelector('.rd-to-run').hidden, false);
  assert.equal(rd.querySelector('.rd-back').hidden, true);
  assert.ok(tabOf(window, 'workflow').classList.contains('active'), 'the row\'s tab is open');
  assert.ok(secOf(window, 'workflow').querySelector('.rd-graph .run-flow'), 'the graph lives in Workflow');
  assert.equal(rd.querySelector('.rd-mini'), null, 'no bottom bar: the shared bar carries the way back');

  // Escape: Details -> glance (same run); on the glance it keeps the pane side by side (D16).
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 4);
  assert.equal(window.location.hash, '#running/r1');
  assert.equal(rd.dataset.mode, 'glance');

  // A Now row deep-links to its tab; "‹ Run" returns.
  click(window, rd.querySelector('.rd-nowlist [data-rd-tab="workflow"]'));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 4);
  assert.equal(window.location.hash, '#running/r1/details/workflow');
  click(window, rd.querySelector('.rd-to-run'));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 4);
  assert.equal(rd.dataset.mode, 'glance');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 4);
  assert.equal(window.location.hash, '#running/r1', 'side by side, Escape on the glance keeps the pane (the list is already visible)');
  // Narrow (slide) layout: Escape on the glance goes back to the list.
  window.document.getElementById('runs-shell').dataset.layout = 'slide';
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 4);
  assert.equal(window.location.hash, '#runs');
});

test('a finished run: its headline, the facts, what to check, Create pull request', async () => {
  const results = {
    summary: { filesNew: 1, filesChanged: 1, filesDeleted: 0, linesAdded: 12, linesRemoved: 3, blockingIssues: 1, nitpicks: 0 },
    newFiles: [{ path: 'src/limiter.js', status: 'A', added: 10, removed: 0 }],
    changedFiles: [{ path: 'src/upload.js', status: 'M', added: 2, removed: 3, issues: [] }],
    keyThingsToCheck: [{ id: 'c1', severity: 'major', title: 'Unauthenticated uploads fall back to IP' }],
    nitpicks: [],
  };
  // Still `live` in History (the refetch after the finish has not landed), so the Running
  // page shows the result itself rather than handing over to the saved run.
  const row = { ...HISTORY_ROW, id: 'p1', live: true, survived: true, branch: 'worca-cc/dark-p1', sourceBranch: 'main', pr: null };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return ok({ ok: true });
      if (url.endsWith('/api/history')) return ok({ pipelines: [row], ghAvailable: true });
      if (url.endsWith('/api/budget')) return ok(okBudget());
      if (url.includes('/api/runs/p1?projectDir=')) return ok({ state: { status: 'done' }, results, clarify: { questions: [], answers: [] } });
      return null;
    },
  });
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  const { window } = ctx;
  const rd = await openGlance(ctx);
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(window, 10);
  assert.equal(rd.dataset.glance, 'done');
  // No PR yet: the one run model's state and line (runs redesign slice 4), the same words as the Runs list.
  const st = rd.querySelector('.rd-sheet .run-status');
  assert.equal(st.dataset.state, 'ready');
  assert.equal(st.querySelector('.run-status-text').textContent, 'Ready to ship');
  assert.equal(rd.querySelector('.rd-orb'), null, 'no glance orb: the status dot says it');
  // Time · Cost · Changes, each labelled once.
  const facts = rd.querySelector('.rd-facts .rd-stats');
  assert.equal(facts.children.length, 3);
  assert.deepEqual([...facts.querySelectorAll('div > span')].map((s) => s.textContent), ['time', 'cost', '2 files changed']);
  assert.match(facts.textContent, /\+12/);
  const filesLink = facts.querySelector('a.rd-stat-link');
  assert.match(filesLink.getAttribute('href'), /\/details\/diff$/, 'F-22: the files tile opens the diff');
  assert.match(rd.querySelector('.rd-clock') ? rd.querySelector('.rd-clock').textContent : 'started 00:00', /^started (\d{2}:\d{2}|[A-Z][a-z]{2}(, \d{2}:\d{2}| \d+, \d{2}:\d{2}))/, 'F-9: the Runs list time style');
  const result = rd.querySelector('.rd-result');
  assert.equal(result.hidden, false);
  assert.equal(result.querySelector('.issues'), null, 'the things to check live in Overview only');
  assert.equal(result.querySelector('[data-rd-tab="diff"] .rd-srow-v').textContent, '2 files');
  assert.equal(result.querySelector('[data-rd-tab="diff"] .rd-srow-v').classList.contains('mono'), false, 'run 3 (D14): sans values');
  const pr = rd.querySelector('.rd-pr-slot .rd-create-pr');
  assert.ok(pr, 'an eligible run offers Create pull request');
  assert.equal(pr.textContent, 'Create PR');
  // The card's one button is the pull request, behind its glyph; following up is the bar's Run after.
  assert.deepEqual([...rd.querySelectorAll('.rd-pr-slot > *')].map((b) => b.firstElementChild.dataset.icon),
    ['pr-create']);
  assert.equal(result.querySelector('.rd-follow-up'), null, 'no follow-up CTA on the card');
  const after = rd.querySelector('.rd-bar .rd-after');
  assert.equal(after.hidden, false, 'a finished run keeps Run after in the bar');
  assert.equal(after.title, 'Start a follow-up run');
  assert.equal(after.getAttribute('aria-label'), 'Start a follow-up run');
  click(window, pr);
  assert.equal(window.location.hash, `#history/${KEY}/p1`, 'it hands over to the ship-it flow');
});

test('a finished run whose branch has only a closed pull request: Create pull request opens Ship it', async () => {
  // The history-pr rows carry a CLOSED PR (the Runs list draws its glyph). It must not
  // block the hand-over: only an open or merged PR does, as on the saved run's header.
  const row = { ...HISTORY_ROW, id: 'p1', live: true, survived: true, branch: 'worca-cc/dark-p1', sourceBranch: 'main',
    pr: { state: 'CLOSED', url: 'https://github.com/o/r/pull/7', number: 7 } };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return ok({ ok: true });
      if (url.endsWith('/api/history')) return ok({ pipelines: [row], ghAvailable: true });
      if (url.endsWith('/api/budget')) return ok(okBudget());
      if (url.includes(`/api/history/${KEY}/p1`)) return ok({ state: { status: 'done', steps: [] }, results: null });
      if (url.includes('/api/runs/p1?projectDir=')) return ok({ state: { status: 'done' }, results: null, clarify: { questions: [], answers: [] } });
      return null;
    },
  });
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  const { window } = ctx;
  const rd = await openGlance(ctx);
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(window, 10);
  const pr = rd.querySelector('.rd-pr-slot .rd-create-pr');
  assert.ok(pr, 'a closed PR still offers Create pull request');
  click(window, pr);
  assert.equal(window.location.hash, `#history/${KEY}/p1`);
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 10);
  assert.equal(window.document.getElementById('shipit-modal').classList.contains('hidden'), false,
    'the Ship it dialog opens on arrival');
});

// Run 3 (D11): the run's own PR is one bar right under the facts block: the list's chip with "PR #N", the checks fact and
// Watch at its right. The header carries the one View PR; the slot holds no button and nothing sits under Results.
function prBarBoot(state, calls) {
  const url = 'https://github.com/o/r/pull/781';
  const row = { ...HISTORY_ROW, id: 'p1', live: true, survived: true, branch: 'worca-cc/dark-p1', sourceBranch: 'main',
    pr: { state, url, number: 781, ...(state === 'OPEN' ? { checks: { state: 'failing', total: 15, failed: 1, pending: 0 } } : {}) } };
  return boot({
    fetchHandler: (u) => {
      if (u.includes('/api/pr/checks')) {
        calls.push(u);
        return ok({ checks: { state: 'failure', failed: 1, total: 15 }, status: { tone: 'bad', label: 'Checks failing', detail: '1 of 15 checks failed' }, watch: { watching: false } });
      }
      if (u.endsWith('/api/history/pr')) return ok({ ok: true });
      if (u.endsWith('/api/history')) return ok({ pipelines: [row], ghAvailable: true });
      if (u.endsWith('/api/budget')) return ok(okBudget());
      if (u.includes('/api/runs/p1?projectDir=')) return ok({ state: { status: 'done' }, results: null, clarify: { questions: [], answers: [] } });
      return null;
    },
  });
}
test('run 3: an open PR is one bar under the facts; the header carries View PR; no slot button, no bottom block', async () => {
  const calls = [];
  const ctx = await prBarBoot('OPEN', calls);
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  await openGlance(ctx);
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(ctx.window, 10);
  const scr = ctx.window.document.querySelector('#run-detail');
  const sheet = scr.querySelector('.rd-sheet');
  const box = sheet.querySelector('.rd-pr-box');
  assert.equal(box.previousElementSibling, sheet.querySelector('.rd-kv'), 'the PR bar sits right under the facts');
  assert.equal(scr.querySelector('.rd-pr-slot').hidden, true, 'no View pull request button');
  const chip = box.querySelector('.rd-pr-status .rd-prs-sum a.runs-pr');
  assert.ok(chip, 'the chip links the PR');
  assert.equal(chip.getAttribute('href'), 'https://github.com/o/r/pull/781');
  assert.equal(chip.querySelector('.runs-pr-num').textContent, 'PR #781');
  assert.equal(chip.querySelector('.runs-pr-word').textContent, 'Checks failing');
  assert.equal(box.querySelector('.rd-prs-detail').textContent, '1 of 15 checks failed');
  assert.ok(box.querySelector('.rd-prs-watch [role="switch"]'), 'Watch, the standard switch');
  const primary = [...scr.querySelectorAll('.rd-bar-end .rd-actions .btn-primary')].filter((b) => !b.hidden);
  assert.deepEqual(primary.map((b) => b.textContent.trim()), ['View PR']);
  assert.doesNotMatch(scr.querySelector('.rd-sheet .run-status-text').textContent, /PR #/);
  assert.equal(scr.querySelector('.rd-sheet .run-status-text').textContent, 'Needs you · Checks failing');
  assert.equal(scr.querySelector('.rd-result [data-rd-cta]'), null, 'nothing PR-shaped under Results');
});

test('run 3: a merged PR paints the chip alone: no checks fetch, no Watch', async () => {
  const calls = [];
  const ctx = await prBarBoot('MERGED', calls);
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  await openGlance(ctx);
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(ctx.window, 10);
  const scr = ctx.window.document.querySelector('#run-detail');
  const status = scr.querySelector('.rd-pr-box .rd-pr-status');
  assert.equal(status.hidden, false);
  assert.equal(scr.querySelector('.rd-pr-slot').hidden, true);
  const chip = status.querySelector('.rd-prs-sum .runs-pr');
  assert.equal(chip.querySelector('.runs-pr-num').textContent, 'PR #781');
  assert.equal(chip.querySelector('svg').innerHTML.length > 0, true);
  assert.equal(status.querySelector('.rd-prs-watch'), null, 'no Watch on a merged PR');
  assert.deepEqual(calls, [], 'no checks fetch');
});

// Run 3 (D11), review M2: an open PR that merges on the open page keeps its chip alone. Neither a checks read still in
// flight nor a pr-watch-changed refresh paints its checks line or Watch back.
test('run 3: a PR that merges while its page is open never gets its checks line or Watch back', async () => {
  const url = 'https://github.com/o/r/pull/790';
  const row = { ...HISTORY_ROW, id: 'p1', live: true, survived: true, branch: 'worca-cc/dark-p1', sourceBranch: 'main',
    pr: { state: 'OPEN', url, number: 790, checks: { state: 'pending', total: 15, failed: 0, pending: 3 } } };
  const ANSWER = { checks: { state: 'pending', total: 15, failed: 0, pending: 3 }, mergeable: 'MERGEABLE',
    status: { tone: 'run', label: 'Checks running', detail: '3 of 15 checks running' }, watch: { watching: true } };
  const held = [];
  let hold = false;
  let reads = 0;
  const ctx = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/pr/checks')) {
        reads += 1;
        if (!hold) return ok(ANSWER);
        return new Promise((resolve) => held.push(() => resolve(ok(ANSWER))));
      }
      if (u.endsWith('/api/history/pr')) return ok({ ok: true });
      if (u.endsWith('/api/history')) return ok({ pipelines: [structuredClone(row)], ghAvailable: true });
      if (u.endsWith('/api/budget')) return ok(okBudget());
      if (u.includes('/api/runs/p1?projectDir=')) return ok({ state: { status: 'done' }, results: null, clarify: { questions: [], answers: [] } });
      return null;
    },
  });
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  const rd = await openGlance(ctx);
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(ctx.window, 10);
  const box = rd.querySelector('.rd-pr-status');
  assert.ok(box.querySelector('.rd-prs-watch'), 'the open PR has Watch');
  assert.match(box.textContent, /3 of 15 checks running/);
  // A refresh whose read is still in flight when the PR merges.
  hold = true;
  frame(ctx, { type: 'pr-watch-changed', projectKey: row.projectKey, pipelineId: 'p1' });
  await settle(ctx.window, 4);
  assert.equal(held.length, 1, 'the refresh read is in flight');
  row.pr = { state: 'MERGED', url, number: 790 };
  frame(ctx, { type: 'pipelines-changed' });
  await settle(ctx.window, 10);
  assert.equal(box.querySelector('.rd-prs-watch'), null, 'merged: no Watch');
  assert.equal(box.querySelector('.rd-prs-sum .runs-pr .runs-pr-word').textContent, 'Merged');
  held.shift()();
  await settle(ctx.window, 10);
  assert.equal(box.querySelector('.rd-prs-watch'), null, 'the late answer paints no Watch');
  assert.doesNotMatch(box.textContent, /checks running/, 'the late answer paints no checks line');
  hold = false;
  const before = reads;
  frame(ctx, { type: 'pr-watch-changed', projectKey: row.projectKey, pipelineId: 'p1' });
  await settle(ctx.window, 10);
  assert.equal(reads, before, 'a refresh reads no checks for a merged PR');
  assert.equal(box.querySelector('.rd-prs-watch'), null, 'a refresh paints no Watch');
  assert.doesNotMatch(box.textContent, /checks running/, 'a refresh paints no checks line');
});

// QA 3: the run page PR box leads with the Runs list's own chip (prChip over the run model's prState), the same word and
// icon as the list; GitHub's verdict stays a note only when it adds something the chip does not say.
test('QA 3: the run page PR box leads with the list\'s chip, also after a pr-watch-changed refresh', async () => {
  const url = 'https://github.com/o/r/pull/803';
  const FAILING = { state: 'failing', total: 12, failed: 3, pending: 0 };
  await checkRows([
    { name: 'draft PR whose checks fail: the chip, not "Draft"', pr: { draft: true, checks: FAILING }, checks: FAILING,
      status: { tone: 'none', label: 'Draft' }, word: 'Checks failing', cls: 'is-failing', icon: 'pull-request-draft', noText: 'Draft' },
    { name: 'ready PR: the chip "Ready" and the note "Ready to merge"', pr: {}, checks: { state: 'passing', total: 12, failed: 0, pending: 0 },
      status: { tone: 'ok', label: 'Ready to merge' }, word: 'Ready', cls: 'is-ready', icon: 'pull-request', note: 'Ready to merge' },
    { name: 'a pr-watch-changed frame repaints the chip as Fixing', pr: { checks: FAILING }, checks: FAILING,
      status: { tone: 'bad', label: 'Checks failing' }, word: 'Checks failing', cls: 'is-failing', icon: 'pull-request', fixing: true },
  ].map((c) => ({ name: c.name, run: async () => {
    const { ICONS } = await import('../ui/public/icons.mjs');
    const row = { ...HISTORY_ROW, id: 'p1', live: true, survived: true, branch: 'worca-cc/dark-p1', sourceBranch: 'main',
      pr: { url, number: 803, state: 'OPEN', ...c.pr } };
    const ctx = await boot({
      fetchHandler: (u) => {
        if (u.includes('/api/pr/checks')) return ok({ checks: c.checks, mergeable: 'MERGEABLE', status: c.status, watch: null });
        if (u.endsWith('/api/history/pr')) return ok({ ok: true });
        if (u.endsWith('/api/history')) return ok({ pipelines: [row], ghAvailable: true });
        if (u.endsWith('/api/budget')) return ok(okBudget());
        if (u.includes('/api/runs/p1?projectDir=')) return ok({ state: { status: 'done' }, results: null, clarify: { questions: [], answers: [] } });
        return null;
      },
    });
    frame(ctx, { type: 'hello', runs: [] });
    await settle(ctx.window, 6);
    const rd = await openGlance(ctx);
    frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
    await settle(ctx.window, 10);
    const box = rd.querySelector('.rd-pr-status');
    const chip = () => box.querySelector('.rd-prs-sum .runs-pr');
    assert.equal(box.hidden, false, 'the box shows');
    assert.ok(chip() && chip().classList.contains(c.cls), `the list's chip leads: ${box.innerHTML}`);
    assert.equal(chip().querySelector('.runs-pr-word').textContent, c.word);
    assert.equal(chip().querySelector('.runs-pr-num').textContent, 'PR #803', 'run 3 (D11): the bar names its PR');
    assert.equal(chip().querySelector('svg').innerHTML, ICONS[c.icon], `the ${c.icon} icon`);
    if (c.noText) assert.doesNotMatch(box.textContent, new RegExp(c.noText), 'GitHub\'s restatement of the PR state is gone');
    if (c.note) assert.match(box.textContent, new RegExp(c.note), 'a verdict the chip does not say stays');
    if (c.fixing) {
      // The handler asks for the repaint BEFORE it marks the row fixing (app.js pr-watch-changed): the chip is read at paint time.
      frame(ctx, { type: 'pr-watch-changed', projectKey: row.projectKey, pipelineId: 'p1', fixing: true });
      await settle(ctx.window, 10);
      assert.ok(chip(), 'the refresh keeps the chip');
      assert.equal(box.hidden, false);
      assert.equal(chip().querySelector('.runs-pr-word').textContent, 'Fixing');
    }
  } })));
});

test('Details › Diff reads the live worktree while the run goes', async () => {
  const patch = 'diff --git a/src/limiter.js b/src/limiter.js\nnew file mode 100644\n--- /dev/null\n+++ b/src/limiter.js\n@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;\n';
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/runs/r1/live-diff')) {
        return ok({ results: { summary: { filesNew: 1, filesChanged: 0, linesAdded: 2, linesRemoved: 0 },
          newFiles: [{ path: 'src/limiter.js', status: 'A', added: 2, removed: 0 }], changedFiles: [] }, patch, untrackedCapped: false });
      }
      if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: false });
      if (url.endsWith('/api/budget')) return ok(okBudget());
      return null;
    },
  });
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  const { window } = ctx;
  await openGlance(ctx, 'running/r1/details/diff');
  await settle(window, 8);
  const sec = secOf(window, 'diff');
  assert.equal(sec.hidden, false);
  assert.match(sec.querySelector('.rd-diff-note').textContent, /^Live:/);
  assert.equal(sec.querySelector('.rd-diff-refresh').hidden, false, 'a live diff refreshes on demand');
  assert.deepEqual([...sec.querySelectorAll('.rd-diff-row-path')].map((n) => n.textContent), ['src/limiter.js']);
  assert.equal(sec.querySelectorAll('.hd-dl-row.hd-dl-add').length, 2, 'the patch lines render');
  assert.equal(tabOf(window, 'diff').querySelector('.rd-tab-badge').textContent, '1');
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/live-diff')).length, 1, 'fetched once, not per frame');
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: GLANCE_MANIFEST, steps: GLANCE_STEPS() });
  await settle(window, 4);
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/live-diff')).length, 1);
});

// --- Live view: the fogged focus graph beside the glance card ---------------

const LIVE_KEY = 'worca-cc.run.liveView';
const liveParts = (rd) => ({
  glance: rd.querySelector('.rd-glance'),
  sw: rd.querySelector('.rd-live-switch'),
  row: rd.querySelector('.rd-live-row'),
  panel: rd.querySelector('.rd-live'),
  world: () => rd.querySelector('.rd-live .run-flow .gv-world'),
});

test('Live view: switching off animates out then drops the graph (transitionend or timeout), and switching back on mid-exit keeps the same graph', async (t) => {
  await checkRows([
    { name: 'Live view: switching off animates out first, then drops the graph (transitionend or a timeout)', run: async () => {
      const ctx = await bootRunning();
      const { window } = ctx;
      window.localStorage.setItem(LIVE_KEY, '0');
      const rd = await openGlance(ctx);
      const p = liveParts(rd);
      click(window, p.sw);
      await settle(window);

      click(window, p.sw);
      await settle(window);
      assert.equal(p.sw.getAttribute('aria-checked'), 'false');
      assert.equal(window.localStorage.getItem(LIVE_KEY), '0');
      assert.equal(p.panel.classList.contains('is-in'), false, 'the exit transition starts');
      assert.equal(p.panel.hidden, false, 'still on screen while it animates out');
      assert.ok(p.world(), 'the graph lives until the exit ends');
      p.panel.dispatchEvent(new window.Event('transitionend'));
      assert.equal(p.panel.hidden, true);
      assert.equal(p.world(), null, 'the mount is destroyed');
      assert.equal(p.glance.dataset.live, undefined, 'the card goes back to the middle');

      // No transitionend (a background tab, a cancelled transition): the timeout finishes it.
      click(window, p.sw);
      await settle(window);
      const timers = useAppTimers(t);
      try {
        click(window, p.sw);
        await timers.advance(700);   // > LIVE_EXIT_MS (500)
        assert.equal(p.panel.hidden, true);
        assert.equal(p.world(), null);
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'Live view: switching back on mid-exit keeps the same graph', run: async () => {
      const ctx = await bootRunning();
      const { window } = ctx;
      window.localStorage.setItem(LIVE_KEY, '0');
      const rd = await openGlance(ctx);
      const p = liveParts(rd);
      click(window, p.sw);
      await settle(window);
      const world = p.world();
      const timers = useAppTimers(t);
      try {
        click(window, p.sw);
        click(window, p.sw);
        await timers.settle();
        assert.ok(p.panel.classList.contains('is-in'));
        p.panel.dispatchEvent(new window.Event('transitionend'));   // the reversed exit's end
        assert.equal(p.panel.hidden, false, 'an exit that was reversed never hides the panel');
        assert.equal(p.world(), world, 'no rebuild');
        await timers.advance(700);   // > LIVE_EXIT_MS (500)
        assert.equal(p.world(), world, 'nor does the old timeout');
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

// #555: a run-page action that fails is said where the user is — a toast — not only in the run log.
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });
const clickToastAction = (window) => {
  const all = window.document.querySelectorAll('#toasts > .toast');
  all[all.length - 1].querySelector('.toast-act').click();
};

test('a failed resume raises an error toast whose Retry replays the same options; a run with no pipeline id says so in a toast', async () => {
  await checkRows([
    { name: 'a failed resume raises an error toast whose Retry replays the same options', run: async () => {
      const bodies = [];
      const ctx = await openDetail({
        bootOpts: { fetchHandler: (u, opts) => {
          if (!u.includes('/api/resume')) return null;
          bodies.push(JSON.parse(opts.body));
          return fail(400, { error: 'pipeline not found' });
        } },
      });
      const { window, recv } = ctx;
      window.__np.getRun(ID).pipelineId = 'p1';
      recv({ type: 'state', runId: ID, status: 'paused', steps: [] });
      await settle(window);
      await window.__np.resumeRunFromCard(ID, null, { ignoreCostCap: true });
      assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'Could not resume the run',
        detail: 'pipeline not found', action: 'Retry' });
      assert.ok(window.__np.getRun(ID).logLines.some((l) => /resume failed: pipeline not found/.test(String(l.text))),
        'the run-log line stays');
      clickToastAction(window);
      await settle(window, 5);
      assert.equal(bodies.length, 2, 'Retry resumes again');
      assert.equal(bodies[1].ignoreCostCap, true, 'with the same options');
    } },
    { name: 'a resume of a run with no pipeline id says so in a toast', run: async () => {
      const ctx = await openDetail();
      const { window, recv } = ctx;
      recv({ type: 'state', runId: ID, status: 'paused', steps: [] });
      await settle(window);
      window.__np.getRun(ID).pipelineId = '';
      await window.__np.resumeRunFromCard(ID, null);
      const t = lastToast(window.document);
      assert.equal(t.tone, 'err');
      assert.equal(t.title, 'Could not resume the run');
      assert.match(t.detail, /no pipeline id/);
    } },
  ]);
});

test('a refused pause raises an error toast; a refused Away-mode change puts the select back and toasts', async () => {
  await checkRows([
    { name: 'a refused pause on the run page raises an error toast', run: async () => {
      const ctx = await openDetail({
        bootOpts: { fetchHandler: (u) => (u.includes('/api/pause') ? fail(409, { error: 'run is not live' }) : null) },
      });
      const { window, screen } = ctx;
      const btn = screen.querySelector('.rd-pause');
      assert.notEqual(btn.dataset.action, 'resume');
      btn.click();
      await settle(window, 5);
      assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'Could not pause the run',
        detail: 'run is not live', action: '' });
      assert.equal(btn.disabled, false, 'Pause can be tried again');
    } },
    { name: 'a refused Away-mode change puts the select back and raises a toast', run: async () => {
      const ctx = await openDetail({
        bootOpts: { fetchHandler: (u) => (u.includes('/api/run/night') ? fail(400, { error: 'run is over' }) : null) },
      });
      const { window, screen } = ctx;
      const sel = screen.querySelector('.rd-night');
      assert.equal(sel.value, 'auto');
      sel.value = 'on';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await settle(window, 5);
      assert.equal(sel.value, 'auto', 'the select reverts to what the run still has');
      assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'Could not change Away mode for this run',
        detail: 'run is over', action: '' });
      assert.ok(window.__np.getRun(ID).logLines.some((l) => /Away mode: run is over/.test(String(l.text))),
        'the run-log line stays');
    } },
  ]);
});

test('Escape typed in the terminal pane belongs to the shell: the run screen stays (#573)', async () => {
  const ctx = await bootRunning();
  const { window } = ctx;
  const rd = await openGlance(ctx);
  click(window, rd.querySelector('.rd-result [data-rd-tab="workflow"]'));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 4);
  assert.equal(window.location.hash, '#running/r1/details/workflow');
  const pane = window.document.querySelector('body > .term-pane');
  assert.ok(pane, 'the terminal pane is mounted');
  const input = window.document.createElement('textarea');            // xterm's hidden input is a textarea
  pane.appendChild(input);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 4);
  assert.equal(window.location.hash, '#running/r1/details/workflow');
  assert.equal(rd.dataset.mode, 'details');
});

test("Overview (live): worca's own AI calls are not counted as the run's sub-agents", async () => {
  const ctx = await bootRunning();
  await openRun(ctx, { subAgents: [...SUBS(),
    { id: 'run-title-0a0b0c0d', label: 'Run title', subagentType: 'run-title', nodeId: 'preflight', stepKey: 'x:preflight:1', status: 'finished', costUsd: 0.0021 },
    { id: 'night-decider-ab12cd34', label: 'Away mode review (questions)', subagentType: 'night-decider', nodeId: 'implement', status: 'finished', costUsd: 0.05 },
  ] });
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  assert.deepEqual([...secOf(window, 'overview').querySelectorAll('.hd-ov-tag')].map((c) => c.textContent),
    ['proj', 'main', '2 sub-agents'], 'the run title and the Away mode review are worca\'s, not the agents\'');
});

test('Agents (live): a sub-agent type named like an Object member keeps its own type pill', async () => {
  const ctx = await bootRunning();
  const row = (id, subagentType) => ({ id, label: id, subagentType, nodeId: 'n_impl', stepKey: 'x:n_impl:1', status: 'finished' });
  await openRun(ctx, {
    stepper: V2_MANIFEST,
    steps: [{ key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', activeMs: 500, costUsd: 0.4 }],
    subAgents: [row('s1', 'constructor'), row('s2', 'toString'), row('s3', '__proto__')],
  });
  const { window } = ctx;
  click(window, tabOf(window, 'agents'));
  await settle(window);
  assert.deepEqual([...secOf(window, 'agents').querySelectorAll('.rd-ag-row .agent-type-pill')].map((p) => p.textContent),
    ['constructor', 'toString', '__proto__']);
});

// --- run progress (P5) and the one status block (runs redesign slice 4, D19, D20) ----------------
const statusOf = (screen) => screen.querySelector('.rd-glance .rd-sheet .run-status');
const runBarOf = (screen) => screen.querySelector('.rd-glance .rd-sheet .run-status-bar');

test('the run page carries the progress bar in its status block, and no chain bar or slice line', async () => {
  const ctx = await bootRunning();
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: V2_MANIFEST, steps: V2_STEPS(), active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }], subAgents: [], totalCostUsd: 1 });
  go(ctx.window, 'running/r1');
  await settle(ctx.window, 6);
  const screen = ctx.window.document.querySelector('#run-detail');
  const bar = runBarOf(screen);
  assert.ok(bar, 'the bar lives in the glance\'s status block');
  assert.equal(bar.hidden, false, 'a live graph run shows it');
  assert.ok(bar.querySelector('.run-prog-fill'), 'painted by paintProgressBar');
  assert.equal(bar.getAttribute('aria-label'), 'Run progress', 'the removed .rd-prog\'s focus stop moves to it');
  assert.equal(screen.querySelector('.rd-prog-chain'), null, 'a run page draws only its own bar (D19)');
  assert.equal(screen.querySelector('.rd-slice-line'), null);
  assert.equal(statusOf(screen).dataset.state, 'working');
  assert.match(statusOf(screen).querySelector('.run-status-text').textContent, /^Working · .*Implementer/, 'the model line, word first');
  assert.equal(screen.querySelector('.rd-meta .rd-step').textContent, 'Implementer', 'the header step segment keeps the P5 text');
});

test('a failed run has no bar and draws the "!" symbol (D20)', async () => {
  const ctx = await bootRunning();
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'error', stepper: V2_MANIFEST, steps: V2_STEPS(), subAgents: [], totalCostUsd: 1 });
  go(ctx.window, 'running/r1');
  await settle(ctx.window, 6);
  const screen = ctx.window.document.querySelector('#run-detail');
  assert.equal(runBarOf(screen).hidden, true);
  assert.equal(statusOf(screen).dataset.state, 'failed');
  assert.equal(statusOf(screen).querySelector('.status-dot').dataset.symbol, 'alert');
});

async function openProgressRun(over = {}) {
  const ctx = await bootRunning();
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: V2_MANIFEST, steps: V2_STEPS(), active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }], subAgents: [], totalCostUsd: 1, ...over });
  go(ctx.window, 'running/r1');
  await settle(ctx.window, 6);
  return { ctx, screen: ctx.window.document.querySelector('#run-detail') };
}

test('a question turns the run page bar amber and the status line says what needs you (P4/P5)', async () => {
  const { ctx, screen } = await openProgressRun();
  assert.equal(runBarOf(screen).dataset.tone, 'blue');
  assert.ok(runBarOf(screen).querySelector('.run-prog-fill'));
  frame(ctx, { type: 'question', runId: 'r1', ...clarify() });
  await settle(ctx.window, 6);
  assert.equal(runBarOf(screen).dataset.tone, 'amber');
  assert.equal(statusOf(screen).dataset.state, 'needs-you');
  assert.match(statusOf(screen).querySelector('.run-status-text').textContent, /needs you/i);
  assert.equal(statusOf(screen).querySelector('.status-dot').getAttribute('aria-label'), 'Needs you');
});

test('a finished run that reached the end reads Ready and hides its bar (D20)', async () => {
  const { ctx, screen } = await openProgressRun();
  const steps = V2_STEPS().map((s) => ({ ...s, status: 'done' }));
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'done', endReached: true, stepper: V2_MANIFEST, steps, active: [], subAgents: [], totalCostUsd: 1 });
  await settle(ctx.window, 6);
  assert.equal(statusOf(screen).dataset.state, 'ready');
  assert.equal(runBarOf(screen).hidden, true, 'a finished run states its end once, in the status line');
});

test('the progress tone equals the status family for every status, with and without a question', async () => {
  for (const status of ['running', 'paused', 'pausing', 'interrupted', 'done', 'stopped', 'error']) {
    const { ctx } = await openProgressRun();
    const np = ctx.window.__np;
    // A question frame sticks to the run, so each status is checked without it first, then with it.
    for (const pendingQuestion of [false, true]) {
      frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status, stepper: V2_MANIFEST, steps: V2_STEPS(), active: [], subAgents: [], totalCostUsd: 1 });
      if (pendingQuestion) frame(ctx, { type: 'question', runId: 'r1', ...clarify() });
      const r = np.getRun('r1');
      assert.equal(Boolean(r.pendingQuestion), pendingQuestion, `${status}: the question frame reached the run`);
      assert.equal(np.runDecorFor(r).stageProgress.tone, np.runStatusMeta(r).family, `${status} ${pendingQuestion ? '+ question' : ''}`);
    }
  }
});

test('a staged manifest reads "<Stage> · …" on the status line and the header, never "Step:" (P5)', async () => {
  const staged = JSON.parse(JSON.stringify(V2_MANIFEST));
  staged.graph.nodes[0].progressStage = 'build';
  const { screen } = await openProgressRun({ stepper: staged });
  const line = statusOf(screen).dataset.line;
  assert.match(line, /^Build · /);
  assert.ok(!/^Step/.test(line));
  assert.equal(screen.querySelector('.rd-meta .rd-step').textContent, 'Build · Implementer');
  assert.equal(runBarOf(screen).dataset.tone, 'blue');
});

// --- the Group row (runs redesign slice 4, D18): where the run sits, instead of the chain bar and the slice line ----
const STAGED_V2 = () => {
  const m = JSON.parse(JSON.stringify(V2_MANIFEST));
  m.graph.nodes[0].progressStage = 'build';
  return m;
};
const CHAIN_OF_THREE = () => [{ id: 'p:p0', title: 'Chain', members: [
  { pipelineId: 'p0', ticketId: null, state: 'done', title: 'Zero', projectDir: PROJECT },
  { pipelineId: 'p1', ticketId: null, state: 'current', title: 'Add dark mode', projectDir: PROJECT },
  { pipelineId: null, ticketId: 'tick3', state: 'waiting', title: 'Third', projectDir: PROJECT },
] }];
const FEATURE_OF_THREE = () => [{ id: 'feat_1', kind: 'feature', title: 'Charts', projectKey: null, planning: null, cost: { usd: 0, byPipeline: {} },
  members: [1, 2, 3].map((i) => ({ position: i, title: `Slice ${i}`, pipelineId: `p${i - 1}`, ticketId: null, status: i === 1 ? 'done' : 'running', pr: null, ticket: null, adhoc: false, after: null })) }];
// Run 3 (D8): the group is the facts block's first row; its dt names the kind, its dd links the group page.
const groupLineOf = (screen) => screen.querySelector('.rd-glance .rd-sheet .rd-kv [data-fact="group"]');
const groupValueOf = (screen) => groupLineOf(screen).querySelector('.rd-kv-v');
const lineText = (el) => el.textContent.replace(/\s+/g, ' ').trim();

async function openChainRun(ctx) {
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: STAGED_V2(), steps: V2_STEPS(), active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }], subAgents: [], totalCostUsd: 1 });
  go(ctx.window, 'running/r1');
  await settle(ctx.window, 8);
  return ctx.window.document.querySelector('#run-detail');
}

test('a run in a chain of three says "Part of Chain · run 2 of 3", linking the chain\'s group page; no chain bar', async () => {
  const ctx = await bootRunning();
  ctx.box.chains = CHAIN_OF_THREE();
  const screen = await openChainRun(ctx);
  const line = groupLineOf(screen);
  assert.equal(line.hidden, false);
  assert.equal(line.querySelector('.rd-kv-k').textContent, 'Chain');
  assert.equal(lineText(groupValueOf(screen)), 'Chain · run 2 of 3');
  assert.equal(line.querySelector('a.rd-group-link').getAttribute('href'), '#group/p%3Ap0');
  assert.equal(screen.querySelector('.rd-prog-chain'), null);
  assert.equal(runBarOf(screen).querySelectorAll('.run-prog-sec').length, 4, 'only the run\'s own four sections');
});

test('a live slice says "Part of Charts · run 2 of 3" linking the feature page; a repaint keeps one link', async () => {
  const ctx = await bootRunning();
  frame(ctx, { type: 'hello', flags: { shapeFirst: true }, runs: [] });
  ctx.box.groups = FEATURE_OF_THREE();
  frame(ctx, { type: 'run-groups-changed' });
  await settle(ctx.window, 4);
  const screen = await openChainRun(ctx);
  const line = groupLineOf(screen);
  assert.equal(line.querySelector('.rd-kv-k').textContent, 'Feature');
  assert.equal(lineText(groupValueOf(screen)), 'Charts · run 2 of 3');
  assert.equal(line.querySelector('a.rd-group-link').getAttribute('href'), '#feature/feat_1');
  assert.equal(screen.querySelector('.rd-slice-line'), null, 'the Group row replaces the slice line');
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: STAGED_V2(), steps: V2_STEPS(), active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }], subAgents: [], totalCostUsd: 2 });
  await settle(ctx.window, 4);
  assert.equal(screen.querySelectorAll('.rd-group-link').length, 1, 'painting twice leaves one link');
});

test('chain freshness: no group at first, a schedules-changed frame then shows the Group row', async () => {
  const ctx = await bootRunning();
  const screen = await openChainRun(ctx);
  assert.equal(groupLineOf(screen).querySelector('.rd-group-link'), null);
  ctx.box.chains = CHAIN_OF_THREE();
  frame(ctx, { type: 'schedules-changed' });
  await settle(ctx.window, 8);
  assert.equal(lineText(groupValueOf(screen)), 'Chain · run 2 of 3');
});

test('a failing /api/schedules is not refetched by repaints; the run reads as in no group', async () => {
  const ctx = await bootRunning();
  ctx.box.schedulesFail = true;
  const screen = await openChainRun(ctx);
  const asked = ctx.calls.filter((c) => c.url.endsWith('/api/schedules')).length;
  assert.ok(asked >= 1, 'the chain lookup asked');
  for (let i = 0; i < 3; i++) {
    frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: STAGED_V2(), steps: V2_STEPS(), active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }], subAgents: [], totalCostUsd: 1 + i });
    await settle(ctx.window, 4);
  }
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/api/schedules')).length, asked, 'repaints do not refetch a failing lookup');
  assert.equal(groupLineOf(screen).querySelector('.rd-group-link'), null);
});

test('run page: Apply to branch clears the notice, and a later state frame does not bring it back', async () => {
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u) => (u.includes('/apply-retained')
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, applied: [{ projectKey: null, branch: 'worca-cc/auth', sha: 'abcdef0123456789', committed: true }], failed: [], remaining: 0 }) })
        : null),
    },
  });
  const { window, recv } = ctx;
  window.__np.getRun(ID).pipelineId = 'p1';
  const RETAINED = {
    type: 'state', runId: ID, status: 'running', steps: [],
    branch: { source: 'main', feature: 'worca-cc/auth', worktreeDir: '/tmp/wt',
              commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook failed' } },
  };
  recv(RETAINED);
  await settle(window);
  const notice = window.document.querySelector('#run-detail .retained-banner');
  assert.equal(notice.hidden, false);
  window.document.querySelector('#run-detail .wt-apply').dispatchEvent(new window.Event('click', { bubbles: true }));
  await confirmDialog(window);
  await settle(window, 6);
  assert.equal(notice.hidden, true, 'applied: the notice goes on this screen too');
  recv(RETAINED);
  await settle(window);
  assert.equal(notice.hidden, true, 'the finished orchestrator\'s stale commitFailed stamp does not resurrect it');
});

test('run page: a checkout on History\'s row shows the notice, and a row without it clears it', async () => {
  const CO = { members: [{ projectKey: KEY, worktreeDir: '/tmp/co', branch: 'worca-cc/dark-p1', at: '2026-10-14T09:00:00Z', policy: 'on-demand' }] };
  const box = { rows: [{ ...HISTORY_ROW, id: 'p1', live: true, survived: true, branch: 'worca-cc/dark-p1', sourceBranch: 'main', pr: null, checkout: CO }] };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return ok({ ok: true });
      if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: true });
      if (url.endsWith('/api/budget')) return ok(okBudget());
      if (url.includes('/api/runs/p1?projectDir=')) return ok({ state: { status: 'done' }, results: null, clarify: { questions: [], answers: [] } });
      return null;
    },
  });
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  await openGlance(ctx);
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(ctx.window, 10);
  const n = ctx.window.document.querySelector('#run-detail .retained-banner');
  assert.equal(n.hidden, false);
  assert.equal(n.dataset.kind, 'checkout');
  assert.deepEqual([...n.querySelectorAll('button')].map((b) => b.textContent), ['Discard', 'Get the diff', 'Actions tab ›']);
  box.rows = [{ ...box.rows[0], checkout: null }];
  frame(ctx, { type: 'pipelines-changed' });
  await settle(ctx.window, 12);
  assert.equal(n.hidden, true, 'a checkout discarded elsewhere clears the notice here (rdRepaintOpenGlance repaints the banners)');
});
