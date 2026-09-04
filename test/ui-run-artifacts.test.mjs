// test/ui-run-artifacts.test.mjs
//
// Proves the Phase 3 UI WIRING (not just the pure adapters): the per-step
// artifact viewers are reachable from the real Running-detail render path. The
// pure primitives (artifactsByNodeCycle / viewerKindFor / renderArtifact) are
// covered by test/artifact-view.test.mjs; here we drive the actual DOM.
//
// boot() / settle() / go() / live() / openRun() are a deliberate local copy of the
// harness in test/ui-running-detail.test.mjs (the UI suites do not import each
// other), trimmed to what these cases need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(u), opts || {}); if (r) return r; }
    if (String(u).includes('/api/projects')) {
      return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    }
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  lastWs._l.open?.forEach((fn) => fn());
  return { window, calls, recv };
}

async function settle(window, n = 6) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); }
const frame = (ctx, msg) => ctx.recv(msg);
const secOf = (window, key) => window.document.querySelector(`#run-detail .rd-sec[data-sec="${key}"]`);
const tabOf = (window, key) => window.document.querySelector(`#run-detail .rd-tab[data-sec="${key}"]`);
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// A v1 manifest whose two agent cells fix the run's node order (plan → implement),
// so the run-level Artifacts view orders its groups by the step ledger.
const STEPPER = () => ({ version: 1, steps: [
  { kind: 'agents', nodes: [{ id: 'plan', key: 'plan', uiPhase: 'plan', label: 'Plan' }] },
  { kind: 'agents', nodes: [{ id: 'implement', key: 'implement', uiPhase: 'implement', label: 'Implementer' }] },
], feedbacks: [] });
const STEPS = () => ([
  { key: 'plan#1', nodeId: 'plan', cycle: 1, status: 'done' },
  { key: 'implement#1', nodeId: 'implement', cycle: 1, status: 'start' },
]);
const SUBS = () => ([
  { id: 'a1', label: 'Explore repo', nodeId: 'implement', cycle: 1, status: 'running' },
]);

// A realistic r.artifacts set: two attributed nodes across kinds + one legacy
// (nodeId == null) that must fall into the run-level bucket. The 'questions' event
// is emitted live but its scratch file is deleted once answered, so it is a
// transient marker (like 'live-log'/'pipeline') that the Artifacts tab must drop —
// only the three durable artifacts below are displayable.
const ARTIFACTS = [
  { type: 'artifact', kind: 'plan', path: 'plans/plan.md', nodeId: 'plan', executionId: 'plan#1', cycle: 1 },
  { type: 'artifact', kind: 'questions', path: 'questions.json', nodeId: 'plan', executionId: 'plan#1', cycle: 1 },
  { type: 'artifact', kind: 'result', path: 'result.diff', nodeId: 'implement', executionId: 'implement#1', cycle: 1 },
  { type: 'artifact', kind: 'prompt', path: 'prompt.md', nodeId: null, executionId: null, cycle: null },
];

// Seed one live run + open its detail, then frame the artifact events so
// r.artifacts is populated before any tab that reads it is activated.
async function openRunWithArtifacts(ctx, over = {}) {
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  frame(ctx, {
    type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1,
    stepper: STEPPER(), steps: STEPS(), subAgents: SUBS(), totalCostUsd: 1.5,
    branch: { source: 'main', feature: 'worca-cc/dark-p1', worktreeDir: '/tmp/wt' },
    prompt: 'Add a dark mode toggle.', ...over,
  });
  go(ctx.window, 'running/r1');
  await settle(ctx.window);
  for (const a of ARTIFACTS) frame(ctx, { ...a, runId: 'r1' });
  return ctx;
}

test('the Running detail exposes an Artifacts tab whose badge tracks r.artifacts', async () => {
  const ctx = await boot();
  await openRunWithArtifacts(ctx);
  // A state frame forces a full detail repaint so rdPaintTabBadges runs.
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  await settle(ctx.window);
  const tab = tabOf(ctx.window, 'artifacts');
  assert.ok(tab, 'an Artifacts tab is rendered');
  assert.match(tab.textContent, /Artifacts/);
  assert.equal(tab.querySelector('.rd-tab-badge').textContent, '3',
    'badge counts the three displayable artifacts (the transient questions marker is dropped)');
});

test('activating the Artifacts tab renders per-node groups with clickable rows', async () => {
  const ctx = await boot();
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'artifacts');
  const groups = [...sec.querySelectorAll('.artifact-group')];
  // plan + implement (ordered by the step ledger), then the legacy "Run" bucket last.
  assert.deepEqual(groups.map((g) => g.querySelector('.artifact-group-head b').textContent),
    ['Plan', 'Implementer', 'Run']);
  const rows = [...sec.querySelectorAll('.artifact-row')];
  assert.equal(rows.length, 3, 'every displayable artifact gets a clickable row (questions dropped)');
  assert.ok(rows.some((r) => r.querySelector('.artifact-name').textContent === 'plan.md'));
  assert.ok(rows.some((r) => r.querySelector('.artifact-name').textContent === 'prompt.md'),
    'the legacy null-node artifact is surfaced in the Run bucket');
  assert.ok(!rows.some((r) => r.querySelector('.artifact-name').textContent === 'questions.json'),
    'the transient questions scratch file is not offered as a row');
});

test('clicking an artifact row fetches it by id and mounts the typed viewer', async () => {
  const DIFF = 'diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n';
  let asked = null;
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/runs/p1/artifact?rel=')) { asked = url; return ok({ rel: 'result.diff', text: DIFF }); }
      return null;
    },
  });
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'artifacts');
  const diffRow = [...sec.querySelectorAll('.artifact-row')]
    .find((r) => r.querySelector('.artifact-name').textContent === 'result.diff');
  assert.ok(diffRow, 'the result.diff row is present');
  click(ctx.window, diffRow);
  await settle(ctx.window);

  assert.ok(asked && asked.includes('rel=result.diff'), 'fetched the singular artifact route by pipeline id');
  const viewerCard = ctx.window.document.querySelector('#viewer-card');
  assert.equal(viewerCard.classList.contains('hidden'), false, 'the viewer modal opens');
  const view = ctx.window.document.querySelector('#viewer .artifact-view .artifact-diff');
  assert.ok(view, 'the diff viewer is mounted');
  assert.ok(view.querySelector('.artifact-diff-line.add'), 'a +line is coloured as an addition');
  assert.ok(view.querySelector('.artifact-diff-line.del'), 'a -line is coloured as a deletion');
});

test('the markdown viewer reuses the injected marked+DOMPurify seam', async () => {
  const MD = '# Plan\n\nhello';
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/runs/p1/artifact?rel=')) return ok({ rel: 'plans/plan.md', text: MD });
      return null;
    },
  });
  // Stub the SAME hook the Ask panel uses; artifactViewerDeps reads it at call time.
  ctx.window.__worcaTestHooks = {
    askMarkdown: () => Promise.resolve({
      marked: { parse: (s) => `<h1>${s.split('\n')[0].replace(/^#\s*/, '')}</h1><p>hello</p>` },
      createDOMPurify: (win) => ({
        sanitize: (html) => { const t = win.document.createElement('template'); t.innerHTML = html; return t.content; },
      }),
    }),
  };
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'artifacts');
  const mdRow = [...sec.querySelectorAll('.artifact-row')]
    .find((r) => r.querySelector('.artifact-name').textContent === 'plan.md');
  click(ctx.window, mdRow);
  await settle(ctx.window);
  const md = ctx.window.document.querySelector('#viewer .artifact-view .artifact-markdown');
  assert.ok(md, 'the markdown viewer is mounted through renderMarkdown');
  assert.equal(md.querySelector('h1').textContent, 'Plan');
});

test('renderMarkdown hardens untrusted content: strips stray classes, neutralizes inputs', async () => {
  // The DOMPurify stub is a passthrough, so this exercises renderMarkdown's OWN
  // post-sanitize pass (untrusted artifact content must not borrow app styles or
  // ship live form controls).
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'plans/plan.md', text: '#x' }) : null),
  });
  ctx.window.__worcaTestHooks = {
    askMarkdown: () => Promise.resolve({
      marked: { parse: () => '<p class="app-danger">x</p><pre><code class="language-js">y</code></pre>'
        + '<input type="text"><input type="checkbox" checked>' },
      createDOMPurify: (win) => ({
        sanitize: (html) => { const t = win.document.createElement('template'); t.innerHTML = html; return t.content; },
      }),
    }),
  };
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  const mdRow = [...secOf(ctx.window, 'artifacts').querySelectorAll('.artifact-row')]
    .find((r) => r.querySelector('.artifact-name').textContent === 'plan.md');
  click(ctx.window, mdRow);
  await settle(ctx.window);
  const md = ctx.window.document.querySelector('#viewer .artifact-view .artifact-markdown');
  assert.equal(md.querySelector('p').hasAttribute('class'), false, 'arbitrary class stripped');
  assert.equal(md.querySelector('code').getAttribute('class'), 'language-js', 'code language hint kept');
  assert.equal(md.querySelectorAll('input[type="text"]').length, 0, 'non-checkbox input removed');
  const cb = md.querySelector('input[type="checkbox"]');
  assert.ok(cb && cb.hasAttribute('disabled'), 'checkbox force-disabled');
});

test('the Agents tab carries a per-node "Artifacts (N)" affordance that opens rows', async () => {
  const ctx = await boot();
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'agents'));
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'agents');
  const toggles = [...sec.querySelectorAll('.rd-ag-group .node-artifacts .artifact-toggle')];
  // plan produced one displayable (plan.md; its questions.json scratch is dropped)
  // and implement produced one (result.diff) — so both affordances read "Artifacts (1)".
  assert.deepEqual(toggles.map((t) => t.textContent), ['Artifacts (1)', 'Artifacts (1)']);
  // Expand both and prove the questions scratch file is never offered as a row.
  const names = [];
  for (const toggle of toggles) {
    const body = toggle.parentElement.querySelector('.artifact-list');
    assert.equal(body.hidden, true, 'the list starts collapsed');
    click(ctx.window, toggle);
    assert.equal(body.hidden, false, 'clicking expands the list');
    for (const r of body.querySelectorAll('.artifact-row .artifact-name')) names.push(r.textContent);
  }
  assert.deepEqual(names.sort(), ['plan.md', 'result.diff']);
  assert.ok(!names.includes('questions.json'), 'the transient questions file is not offered');
});
