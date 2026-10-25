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
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, dragOut } from './helpers/popups.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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

test('the Running detail Artifacts tab badge counts displayable artifacts and the tab renders per-node groups (Plan, Implementer, Run) without the transient questions file', async () => {
  await checkRows([
    { name: 'the Running detail exposes an Artifacts tab whose badge tracks r.artifacts', run: async () => {
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
    } },
    { name: 'activating the Artifacts tab renders per-node groups with clickable rows', run: async () => {
      const ctx = await boot();
      await openRunWithArtifacts(ctx);
      click(ctx.window, tabOf(ctx.window, 'artifacts'));
      await settle(ctx.window);
      const sec = secOf(ctx.window, 'artifacts');
      const folders = [...sec.querySelectorAll('.afb-folder.is-step')];
      // plan + implement (ordered by the step ledger), then the legacy "Run" folder last — all open.
      assert.deepEqual(folders.map((f) => f.querySelector('.afb-fname').textContent), ['Plan', 'Implementer', 'Run']);
      assert.ok(folders.every((f) => f.getAttribute('aria-expanded') === 'true'), 'step folders start open');
      const names = [...sec.querySelectorAll('.afb-file .afb-name')].map((n) => n.textContent);
      assert.equal(names.length, 3, 'every displayable artifact gets a clickable row (questions dropped)');
      assert.ok(names.includes('plan.md'));
      assert.ok(names.includes('prompt.md'), 'the legacy null-node artifact is surfaced in the Run folder');
      assert.ok(!names.includes('questions.json'), 'the transient questions scratch file is not offered as a row');
      assert.equal(sec.querySelector('.afb-title').textContent, '3 files');
    } },
  ]);
});

test('clicking an artifact row fetches it by pipeline id and mounts the typed viewer (diff lines coloured; markdown through the injected marked+DOMPurify seam)', async () => {
  await checkRows([
    { name: 'clicking an artifact row fetches it by id and mounts the typed viewer', run: async () => {
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
      const diffRow = [...sec.querySelectorAll('.afb-main')]
        .find((r) => r.querySelector('.afb-name').textContent === 'result.diff');
      assert.ok(diffRow, 'the result.diff row is present');
      click(ctx.window, diffRow);
      await settle(ctx.window);

      assert.ok(asked && asked.includes('rel=result.diff'), 'fetched the singular artifact route by pipeline id');
      assert.ok(ctx.window.document.querySelector('.apv'), 'the popup viewer opens');
      assert.equal(ctx.window.document.querySelector('#viewer-card').classList.contains('hidden'), true,
        '#viewer-card is for plain-text notices only');
      const view = ctx.window.document.querySelector('.apv .artifact-view .artifact-diff');
      assert.ok(view, 'the diff viewer is mounted');
      assert.ok(view.querySelector('.artifact-diff-line.add'), 'a +line is coloured as an addition');
      assert.ok(view.querySelector('.artifact-diff-line.del'), 'a -line is coloured as a deletion');
      // Read-only: a selection dragged out of the diff does not close it; a real outside click does.
      const apv = ctx.window.document.querySelector('.apv');
      dragOut(ctx.window, view, apv);
      assert.ok(apv.isConnected, 'a selection dragged out keeps the popup');
      backdropClick(ctx.window, apv);
      assert.equal(ctx.window.document.querySelector('.apv'), null, 'a backdrop click closes it');
    } },
    { name: 'the markdown viewer reuses the injected marked+DOMPurify seam', run: async () => {
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
      const mdRow = [...sec.querySelectorAll('.afb-main')]
        .find((r) => r.querySelector('.afb-name').textContent === 'plan.md');
      click(ctx.window, mdRow);
      await settle(ctx.window);
      const md = ctx.window.document.querySelector('.apv .artifact-view .artifact-markdown');
      assert.ok(md, 'the markdown viewer is mounted through renderMarkdown');
      assert.equal(md.querySelector('h1').textContent, 'Plan');
    } },
  ]);
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
  const mdRow = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-main')]
    .find((r) => r.querySelector('.afb-name').textContent === 'plan.md');
  click(ctx.window, mdRow);
  await settle(ctx.window);
  const md = ctx.window.document.querySelector('.apv .artifact-view .artifact-markdown');
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

// One extra artifact event, attributed to the implement node like the fixtures above.
const shot = (ctx, n) => frame(ctx, {
  type: 'artifact', runId: 'r1', kind: 'deck-shot', path: `shots/s${String(n).padStart(2, '0')}.png`,
  nodeId: 'implement', executionId: 'implement#1', cycle: 1,
});

test('a burst of one kind sits in its own closed folder, the badge counts its files individually, and an open folder survives a live repaint', async () => {
  await checkRows([
    { name: 'a kind over the collapse threshold is one closed folder whose rows are built when it opens', run: async () => {
      const ctx = await boot();
      await openRunWithArtifacts(ctx);
      for (let i = 1; i <= 6; i++) shot(ctx, i);
      click(ctx.window, tabOf(ctx.window, 'artifacts'));
      await settle(ctx.window);
      const sec = secOf(ctx.window, 'artifacts');

      const bulk = sec.querySelector('.afb-folder.is-bulk');
      assert.ok(bulk, 'the six screenshots sit behind one folder');
      assert.equal(bulk.querySelector('.afb-fname').textContent, 'deck-shot');
      assert.equal(bulk.querySelector('.afb-fn').textContent, '6');
      assert.equal(bulk.getAttribute('aria-expanded'), 'false');
      assert.equal(sec.querySelectorAll('.afb-file').length, 3,
        'the three ordinary artifacts are rows; no screenshot is one yet');

      click(ctx.window, bulk);
      await settle(ctx.window);
      assert.equal(sec.querySelector('.afb-folder.is-bulk').getAttribute('aria-expanded'), 'true');
      assert.equal(sec.querySelectorAll('.afb-file').length, 9, 'opening reveals every screenshot');
    } },
    { name: 'the Artifacts badge counts collapsed files individually', run: async () => {
      const ctx = await boot();
      await openRunWithArtifacts(ctx);
      for (let i = 1; i <= 6; i++) shot(ctx, i);
      frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
      await settle(ctx.window);
      assert.equal(tabOf(ctx.window, 'artifacts').querySelector('.rd-tab-badge').textContent, '9');
    } },
    { name: 'an open folder survives a live repaint that changes the list', run: async () => {
      // buildRdArtifacts paints on every state frame. The browser is built once per section and updated in place, so
      // a folder the reader opened stays open while the run keeps adding files to it.
      const ctx = await boot();
      await openRunWithArtifacts(ctx);
      for (let i = 1; i <= 6; i++) shot(ctx, i);
      click(ctx.window, tabOf(ctx.window, 'artifacts'));
      await settle(ctx.window);
      const sec = secOf(ctx.window, 'artifacts');
      click(ctx.window, sec.querySelector('.afb-folder.is-bulk'));
      await settle(ctx.window);
      assert.equal(sec.querySelectorAll('.afb-file').length, 9, 'open');

      shot(ctx, 7);
      frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
      await settle(ctx.window);

      const after = secOf(ctx.window, 'artifacts');
      assert.equal(after.querySelector('.afb-folder.is-bulk').getAttribute('aria-expanded'), 'true', 'still open after the repaint');
      assert.equal(after.querySelector('.afb-folder.is-bulk .afb-fn').textContent, '7');
      assert.equal(after.querySelectorAll('.afb-file').length, 10, 'and its rows, the new one included, are rendered');
    } },
  ]);
});

test('an indexed subresource is never offered as a browsable row', async () => {
  const ctx = await boot();
  await openRunWithArtifacts(ctx);
  // deck.html's kit script: it MUST stay indexed (the raw route resolves `rel`
  // only among indexed rows, so the deck preview 404s without it) and MUST NOT
  // be listed — that pair is the whole point of the deck-asset kind.
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'deck-asset', path: 'deck/deck-stage.js', nodeId: 'implement', executionId: 'implement#1', cycle: 1 });
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'artifacts');
  assert.equal(sec.querySelectorAll('.afb-file').length, 3);
  assert.ok(![...sec.querySelectorAll('.afb-name')].some((n) => n.textContent === 'deck-stage.js'),
    'the kit script is indexed but not listed');
});

test('the History Artifacts tab notes a truncated list and adds no note to a complete one', async () => {
  await checkRows([
    { name: 'the History Artifacts tab says when the route truncated the list', run: async () => {
      const rows = Array.from({ length: 200 }, (_, i) => ({ kind: 'deck-shot', relPath: `shots/s${i}.png`, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 }));
      const ctx = await boot({
        fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts')
          ? ok({ runId: 'p1', artifacts: rows, truncated: true }) : null),
      });
      const sec = ctx.window.document.createElement('div');
      ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
      await settle(ctx.window, 12);
      const note = sec.querySelector('.artifact-truncated');
      assert.ok(note, 'a partial list must not read as the whole run');
      assert.match(note.textContent, /first 200/);
    } },
    { name: 'an untruncated History list carries no such note', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts')
          ? ok({ runId: 'p1', artifacts: [{ kind: 'plan', relPath: 'plan.md' }], truncated: false }) : null),
      });
      const sec = ctx.window.document.createElement('div');
      ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
      await settle(ctx.window, 12);
      assert.equal(sec.querySelector('.artifact-truncated'), null);
    } },
  ]);
});

// r.artifacts is built only from live WS events and the state snapshot carries
// none, so a browser reload mid-run left the live Artifacts tab empty while the
// server held the full attributed list. It now seeds from the same route History
// uses, and skips what a live event already delivered.
test('the live Artifacts tab seeds itself from the server after a reload', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts')
      ? ok({ runId: 'p1', artifacts: [
        { kind: 'deck-manifest', relPath: 'deck-manifest.md', nodeId: 'implement', stepKey: 'implement#1', cycle: 1 },
        { kind: 'plan', relPath: 'plans/plan.md', nodeId: 'plan', stepKey: 'plan#1', cycle: 1 },
      ], truncated: false })
      : null),
  });
  // A run with NO live artifact events — exactly the post-reload state.
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Deck', projectDir: PROJECT, status: 'running', startedAt: '2026-09-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  go(ctx.window, 'running/r1');
  await settle(ctx.window);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 14);

  const names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.ok(names.includes('deck-manifest.md'), names.join(','));
  assert.ok(names.includes('plan.md'), names.join(','));
});

// The WS artifact event carries the ABSOLUTE filesystem path (run-harness
// `_artifact` emits `{kind, path}` straight from the path it was given) while the
// server route returns a run-relative `relPath`. Comparing them directly matched
// nothing, so hydration appended a second copy of everything already on screen.
// This fixture frames absolute paths BECAUSE production does — the earlier
// version framed relative ones and therefore could not see the bug.
test('hydration does not duplicate what a live event already delivered', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts')
      ? ok({ runId: 'p1', artifacts: [
        { kind: 'plan', relPath: 'plans/plan.md', nodeId: 'plan', stepKey: 'plan#1', cycle: 1 },
        { kind: 'result', relPath: 'result.diff', nodeId: 'implement', stepKey: 'implement#1', cycle: 1 },
      ], truncated: false })
      : null),
  });
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'x', projectDir: PROJECT, status: 'running', startedAt: '2026-09-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  go(ctx.window, 'running/r1');
  await settle(ctx.window);
  // Exactly what the engine emits: absolute paths under the run folder.
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'plan', path: '/Users/x/.worca-cc/store/p-1/plans/plan.md', nodeId: 'plan', executionId: 'plan#1', cycle: 1 });
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'result', path: '/Users/x/.worca-cc/store/p-1/pipelines/r-1/result.diff', nodeId: 'implement', executionId: 'implement#1', cycle: 1 });

  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 14);

  const names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.equal(names.filter((n) => n === 'plan.md').length, 1, names.join(','));
  assert.equal(names.filter((n) => n === 'result.diff').length, 1, names.join(','));
});

test('a live event for an already-hydrated file replaces it rather than doubling it', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts')
      ? ok({ runId: 'p1', artifacts: [{ kind: 'deck', relPath: 'deck/deck.html', nodeId: 'implement', stepKey: 'implement#1', cycle: 1 }], truncated: false })
      : null),
  });
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'x', projectDir: PROJECT, status: 'running', startedAt: '2026-09-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  go(ctx.window, 'running/r1');
  await settle(ctx.window);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 14);
  // The builder rewrites deck.html on the next fix cycle; it is re-indexed and re-emitted.
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'deck', path: '/Users/x/.worca-cc/store/p-1/pipelines/r-1/deck/deck.html', nodeId: 'implement', executionId: 'implement#3', cycle: 3 });
  await settle(ctx.window, 6);

  const names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.equal(names.filter((n) => n === 'deck.html').length, 1, names.join(','));
});

// .hidden{display:none} does not UNLOAD an iframe: a framed deck keeps its timers and its narration playing. The
// popup removes its node on close, and focus goes back to what opened it.
test('closing the viewer unloads what it was holding and hands focus back', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'plan.md', text: '# hi' }) : null),
  });
  const doc = ctx.window.document;
  const opener = doc.createElement('button');
  doc.body.appendChild(opener);
  opener.focus();
  await ctx.window.__np.openRunArtifactPopup({ pipelineId: 'p1' }, { kind: 'plan', relPath: 'plan.md' });
  await settle(ctx.window, 10);
  assert.ok(doc.querySelector('.apv .artifact-view'), 'something is mounted');

  doc.querySelector('.apv .apv-close').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await settle(ctx.window);
  assert.equal(doc.querySelector('.apv'), null, 'the popup and its frame/embed/img are gone, not merely display:none');
  assert.equal(doc.activeElement, opener, 'focus is back on the opener');
});

// The hydration flag was set BEFORE the fetch resolved, so a single failed
// request (a server hiccup while the tab was opening) disabled seeding for the
// life of the page — and after a reload mid-run there are no prior WS events
// either, so the tab read "(no artifacts recorded)" with the badge gone.
test('a failed hydration is retried the next time the tab is opened', async () => {
  let attempt = 0;
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifacts')) return null;
      attempt += 1;
      if (attempt === 1) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      return ok({ runId: 'p1', artifacts: [{ kind: 'plan', relPath: 'plans/plan.md', nodeId: 'plan', stepKey: 'plan#1', cycle: 1 }], truncated: false });
    },
  });
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'x', projectDir: PROJECT, status: 'running', startedAt: '2026-09-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  go(ctx.window, 'running/r1');
  await settle(ctx.window);

  click(ctx.window, tabOf(ctx.window, 'artifacts'));      // attempt 1 — fails
  await settle(ctx.window, 14);
  assert.equal(secOf(ctx.window, 'artifacts').querySelectorAll('.afb-file').length, 0);

  // A state frame repaints the open detail, which is where seeding is retried.
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  await settle(ctx.window, 14);
  assert.ok(attempt >= 2, 'the failure did not disable seeding');
  const names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.ok(names.includes('plan.md'), names.join(','));
});

// sameArtifactFile must match in ONE direction only — absolute path ends with
// relative row — exactly as the server resolves. Testing both ways made a
// root-level `index.html` equal `deck/index.html`, so hydration skipped one and
// the live dedupe overwrote the other: one of the two files became unreachable.
test('two files whose basenames collide across directories stay distinct', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts')
      ? ok({ runId: 'p1', artifacts: [
        { kind: 'deck', relPath: 'index.html', nodeId: 'implement', stepKey: 'implement#1', cycle: 1 },
        { kind: 'deck', relPath: 'deck/index.html', nodeId: 'implement', stepKey: 'implement#1', cycle: 1 },
      ], truncated: false })
      : null),
  });
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'x', projectDir: PROJECT, status: 'running', startedAt: '2026-09-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  go(ctx.window, 'running/r1');
  await settle(ctx.window);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 14);

  const names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.equal(names.filter((n) => n === 'index.html').length, 2,
    `both index.html files must be listed: ${names.join(',')}`);
});

// rdAgentsBody attaches the per-node affordance synchronously AND again when
// hydration resolves, and attachNodeArtifactAffordances just appended — so a run
// opened mid-flight (live events already in r.artifacts, earlier rows still only
// on the server) got TWO "Artifacts (N)" toggles on every node card. It
// self-healed on the next state frame, so on a paused run it simply stayed.
test('hydrating the Agents tab does not leave two affordances on a card', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts')
      ? ok({ runId: 'p1', artifacts: [
        { kind: 'plan', relPath: 'plans/older.md', nodeId: 'plan', stepKey: 'plan#1', cycle: 1 },
      ], truncated: false })
      : null),
  });
  await openRunWithArtifacts(ctx);                       // live events land first
  click(ctx.window, tabOf(ctx.window, 'agents'));
  await settle(ctx.window, 16);

  const sec = secOf(ctx.window, 'agents');
  const perCard = [...sec.querySelectorAll('.rd-ag-group, .artifact-group')]
    .map((card) => card.querySelectorAll('.node-artifacts').length);
  for (const n of perCard) assert.ok(n <= 1, `a card carries ${n} affordances: ${perCard.join(',')}`);
  assert.ok(sec.querySelectorAll('.node-artifacts').length >= 1, 'and at least one is present');
});

// Before the first state event a run carries only its launcher UUID, and the
// route 404s on that — while the failure path clears the memo, so `paint` (which
// runs on every state frame, from a tab visible from the first one) re-issued a
// dead GET each time. No pipeline row yet simply means nothing to seed.
test('hydration does not poll before the run has a pipeline id', async () => {
  let calls = 0;
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/artifacts')) return null;
      calls += 1;
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    },
  });
  // A run created but not yet carrying a pipeline id.
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'x', projectDir: PROJECT, status: 'running', startedAt: '2026-09-19T10:00:00Z', kind: 'run' });
  go(ctx.window, 'running/r1');
  await settle(ctx.window);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 10);

  for (let i = 0; i < 3; i++) {
    frame(ctx, { type: 'state', runId: 'r1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
    await settle(ctx.window, 6);
  }
  assert.equal(calls, 0, 'no request is made until a pipeline row exists');
});

// The Artifacts tab seeds from GET /api/runs/:id/artifacts, whose rows carry a
// byte size the live WS event does not. The dedupe replaced the hydrated row
// WHOLESALE with the event-built one, so the size chip vanished the moment a file
// was rewritten — and hydrateRunArtifacts skips any row a live event already
// delivered, so it never came back for the life of the page.
test('a live artifact event keeps the byte size the hydrated row already carried', async () => {
  const ctx = await boot();
  const np = ctx.window.__np;
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: PROJECT, status: 'running' });
  r.artifacts = [{ kind: 'deck', relPath: 'deck/deck.md', nodeId: 'builder', stepKey: 'build#1', cycle: 1, bytes: 4096 }];

  // The builder rewrites the file on its next fix cycle; the re-index re-emits it.
  np.onArtifact(r, { kind: 'deck', path: '/abs/run/deck/deck.md', nodeId: 'builder', executionId: 'build#2', cycle: 2 });

  assert.equal(r.artifacts.length, 1, 'still one row for the file');
  assert.equal(r.artifacts[0].cycle, 2, 'the newest attribution wins');
  assert.equal(r.artifacts[0].stepKey, 'build#2');
  assert.equal(r.artifacts[0].bytes, 4096, 'the size survives the overwrite');
});

// The notice announced that the list was short and stopped there. Rows come back
// oldest-first, so what it was hiding is the NEWEST — deck.pdf, the closing review
// — and the tab offered no way to reach them, while the Ask tool could already
// page to them with nextOffset. Same notice, now a control.
test('the History Artifacts truncation notice loads the next page instead of dead-ending', async () => {
  const asked = [];
  const row = (kind, relPath) => ({ kind, relPath, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 });
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifacts')) return null;
      asked.push(url);
      return url.includes('offset=2')
        ? ok({ runId: 'p1', artifacts: [row('deck', 'deck/deck.pdf')], truncated: false })
        : ok({ runId: 'p1', artifacts: [row('plan', 'plan.md'), row('plan', 'plan-v2.md')], truncated: true, nextOffset: 2 });
    },
  });
  const sec = ctx.window.document.createElement('div');
  ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
  await settle(ctx.window, 12);

  const more = sec.querySelector('.artifact-truncated');
  assert.ok(more, 'a partial list still announces itself');
  assert.equal(more.tagName, 'BUTTON', 'and it is a control, not a dead end');
  assert.equal(sec.querySelectorAll('.afb-file').length, 2);

  click(ctx.window, more);
  await settle(ctx.window, 12);
  assert.ok(asked.some((u) => u.includes('offset=2')), 'the next page was requested by its cursor');
  const names = [...sec.querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.ok(names.includes('deck.pdf'), 'the newest rows are reachable');
  assert.equal(sec.querySelectorAll('.afb-file').length, 3, 'appended to the first page, not replacing it');
  assert.equal(sec.querySelector('.artifact-truncated'), null, 'and the control goes once the last page lands');
});

// resolveIndexedArtifactFileForRow sorts suffix candidates by length precisely
// because basenames collide across directories. The two client-side dedupes took
// the FIRST suffix hit instead, so a live event for `<run>/deck/index.html`
// matched the root `index.html` row as well — merging two different files into
// one row and leaving the other unreachable.
test('a live artifact event binds to the closest-matching row, not the first suffix hit', async () => {
  const ctx = await boot();
  const np = ctx.window.__np;
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: PROJECT, status: 'running' });
  r.artifacts = [
    { kind: 'deck', relPath: 'index.html', nodeId: 'builder', stepKey: 'build#1', cycle: 1 },
    { kind: 'deck', relPath: 'deck/index.html', nodeId: 'builder', stepKey: 'build#1', cycle: 1 },
  ];

  np.onArtifact(r, { kind: 'deck', path: '/abs/run/deck/index.html', nodeId: 'builder', executionId: 'build#2', cycle: 2 });

  assert.equal(r.artifacts.length, 2, 'no new row — it matched an existing file');
  const relOf = (a) => String((a && (a.relPath || a.path)) || '');
  const root = r.artifacts.find((a) => relOf(a) === 'index.html');
  assert.ok(root, 'the ROOT index.html row is untouched');
  assert.equal(root.cycle, 1, 'and keeps its own attribution');
  const nested = r.artifacts.find((a) => relOf(a).endsWith('deck/index.html'));
  assert.equal(nested.cycle, 2, 'the nested file took the new attribution');
});

// The route caps at 200 and returns {truncated, nextOffset}; hydration read only
// `artifacts` and dropped both. Rows are oldest-first, so on a run that indexes
// past the cap — a three-deck presentation run does — the LIVE Artifacts tab, the
// one actually being watched, seeded the 200 oldest and silently omitted the
// newest: deck.pdf, the standalone, the closing review. History already pages
// here; the live surface did not.
test('hydration pages past the route cap so the newest rows are seeded too', async () => {
  const asked = [];
  const row = (kind, relPath) => ({ kind, relPath, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 });
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifacts')) return null;
      asked.push(url);
      return url.includes('offset=2')
        ? ok({ runId: 'p1', artifacts: [row('deck', 'deck/deck.pdf')], truncated: false })
        : ok({ runId: 'p1', artifacts: [row('plan', 'plans/a.md'), row('plan', 'plans/b.md')], truncated: true, nextOffset: 2 });
    },
  });
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 12);

  assert.ok(asked.some((u) => u.includes('offset=2')), 'the second page was requested');
  const sec = secOf(ctx.window, 'artifacts');
  const names = [...sec.querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.ok(names.includes('deck.pdf'), `the newest page is seeded: ${names.join(',')}`);
});

// forgetMissingArtifacts exists because the audit deletes and recreates shots/
// every cycle, so a cut slide leaves an index row for a file that is gone. The
// prune emitted nothing, and the client list is append-only — so the browser kept
// rendering the pruned row and clicking it 404s from a route that resolves only
// among indexed rows. That is the exact failure the prune exists to prevent,
// left standing on the live surface.
test('a pruned artifact is removed from the live list instead of 404ing on click', async () => {
  const ctx = await boot();
  await openRunWithArtifacts(ctx);
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'deck-shot', path: '/abs/run/shots/s43.png', nodeId: 'implement', executionId: 'implement#1', cycle: 1 });
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  let names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.ok(names.includes('s43.png'), 'the shot is listed to begin with');

  // The fix cycle cuts that slide; the engine prunes the row.
  frame(ctx, { type: 'artifact-gone', runId: 'r1', paths: ['/abs/run/shots/s43.png'] });
  await settle(ctx.window);
  names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.ok(!names.includes('s43.png'), `the pruned row is gone: ${names.join(',')}`);
  assert.ok(names.includes('plan.md'), 'and the surviving rows are untouched');
});

test('a raw-artifact error (404/415/413) is said inside the popup; a raw artifact that is there still mounts its media element', async () => {
  await checkRows([
    { name: 'a raw-artifact error is shown, not rendered as a blank frame', run: async () => {
      // The byte kinds frame the raw URL in an <iframe>/<embed>/<img>/<audio>/<video>. The route answers 404 when the
      // file went between listing and click (routine on a live run: the audit clears shots/ every cycle), as a JSON
      // body that would render as a blank frame or a broken image. The viewer probes first and says why.
      const ctx = await boot({
        fetchHandler: (url) => (url.includes('/artifact-raw/')
          ? Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'artifact not found' }) })
          : null),
      });
      await ctx.window.__np.openRunArtifactPopup({ pipelineId: 'p1' }, { kind: 'deck-shot', relPath: 'shots/s43.png' });
      await settle(ctx.window, 8);
      const err = ctx.window.document.querySelector('.apv .apv-error');
      assert.ok(err, 'the reason is on screen');
      assert.equal(err.textContent, 'File not found');
      assert.equal(ctx.window.document.querySelector('.apv img'), null, 'no broken image');
    } },
    { name: 'a 413 opens the info view with Download instead', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => (url.includes('/artifact-raw/')
          ? Promise.resolve({ ok: false, status: 413, json: async () => ({ error: 'artifact too large to preview' }) })
          : null),
      });
      await ctx.window.__np.openRunArtifactPopup({ pipelineId: 'p1' }, { kind: 'deck', relPath: 'deck/deck.pdf', bytes: 30 * 1024 * 1024 });
      await settle(ctx.window, 8);
      const doc = ctx.window.document;
      assert.ok(doc.querySelector('.apv').classList.contains('is-info'));
      assert.equal(doc.querySelector('.apv .apv-info-note').textContent, 'Too large to preview');
      assert.ok(doc.querySelector('.apv .apv-info-dl'), 'and Download is offered');
    } },
    { name: 'a raw artifact that IS there still renders', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => (url.includes('/artifact-raw/')
          ? Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
          : null),
      });
      await ctx.window.__np.openRunArtifactPopup({ pipelineId: 'p1' }, { kind: 'deck-shot', relPath: 'shots/s01.png' });
      await settle(ctx.window, 8);
      const stage = ctx.window.document.querySelector('.apv .apv-stage');
      assert.equal(stage.querySelector('.apv-error'), null, 'no error for a healthy artifact');
      assert.equal(stage.querySelector('img').getAttribute('src'), '/api/runs/p1/artifact-raw/shots/s01.png');
    } },
  ]);
});

// A later page failing threw away every row already in hand: readPage returned
// null and that null propagated as the value of the whole recursive chain, so a
// run whose first 200 rows had arrived rendered "(no artifacts recorded)" because
// page 2 hit a transient error.
test('hydration keeps the pages it already has when a later one fails', async () => {
  const row = (kind, relPath) => ({ kind, relPath, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 });
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifacts')) return null;
      return url.includes('offset=2')
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
        : ok({ runId: 'p1', artifacts: [row('plan', 'plans/a.md'), row('plan', 'plans/b.md')], truncated: true, nextOffset: 2 });
    },
  });
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 12);
  const names = [...secOf(ctx.window, 'artifacts').querySelectorAll('.afb-name')].map((n) => n.textContent);
  assert.ok(names.includes('a.md') && names.includes('b.md'), `page 1 survives: ${names.join(',')}`);
});

test('a failed "load next page" (HTTP error or thrown fetch) keeps the rows and still flags the list as partial', async () => {
  await checkRows([
    { name: 'a failed "load next page" keeps saying the list is partial', run: async () => {
      // A failed "Load the next page" left `body` null, so the truncation notice was
      // NOT re-added — and a partial list with no notice reads as the whole run, which
      // is the one failure the notice exists to prevent.
      const row = (kind, relPath) => ({ kind, relPath, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 });
      const ctx = await boot({
        fetchHandler: (url) => {
          if (!url.includes('/api/runs/p1/artifacts')) return null;
          return url.includes('offset=2')
            ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
            : ok({ runId: 'p1', artifacts: [row('plan', 'a.md'), row('plan', 'b.md')], truncated: true, nextOffset: 2 });
        },
      });
      const sec = ctx.window.document.createElement('div');
      ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
      await settle(ctx.window, 12);
      click(ctx.window, sec.querySelector('.artifact-truncated'));
      await settle(ctx.window, 12);
      assert.ok(sec.querySelector('.artifact-truncated'),
        'the list still declares itself partial after the page failed');
      assert.equal(sec.querySelectorAll('.afb-file').length, 2, 'and keeps the rows it had');
    } },
    { name: 'a thrown failure on a later page keeps the partial list flagged as partial', run: async () => {
      const row = (kind, relPath) => ({ kind, relPath, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 });
      const ctx = await boot({
        fetchHandler: (url) => {
          if (!url.includes('/api/runs/p1/artifacts')) return null;
          return url.includes('offset=2')
            ? Promise.reject(new Error('offline'))
            : ok({ runId: 'p1', artifacts: [row('plan', 'a.md'), row('plan', 'b.md')], truncated: true, nextOffset: 2 });
        },
      });
      const sec = ctx.window.document.createElement('div');
      ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
      await settle(ctx.window, 12);
      click(ctx.window, sec.querySelector('.artifact-truncated'));
      await settle(ctx.window, 12);
      assert.ok(sec.querySelector('.artifact-truncated'), 'still declares itself partial');
      assert.equal(sec.querySelectorAll('.afb-file').length, 2, 'and keeps the rows it had');
    } },
  ]);
});

// The `!body` branch only fires for a NON-OK HTTP response. A THROWN failure —
// the server restarting, the browser going offline, res.json() on a malformed
// body — fell through to the trailing .catch, which re-rendered with no notice at
// all: "(no artifacts recorded)" for a run that has artifacts on page 0, and on a
// later page the accumulated rows with the truncation notice DROPPED, so a
// partial list reads as the whole run.
test('a thrown fetch failure is reported, not silently rendered as an empty run', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts')
      ? Promise.reject(new Error('offline')) : null),
  });
  const sec = ctx.window.document.createElement('div');
  ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
  await settle(ctx.window, 12);
  assert.match(sec.textContent, /Could not load/, `an outright failure says so: ${sec.textContent}`);
  assert.doesNotMatch(sec.textContent, /No artifacts/, 'and does not claim the run has none');
});

// Stopping at the page ceiling is correct; memoising that as a COMPLETE walk is
// not. `Promise.resolve(false)` is permanent, so a run indexing past the ceiling
// lost its newest artifacts from the live tab for the life of the page, with no
// way to ask again.
test('hitting the hydration page ceiling stays retryable', async () => {
  let asked = 0;
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifacts')) return null;
      asked += 1;
      const n = Number((/offset=(\d+)/.exec(url) || [0, 0])[1]);
      return ok({
        runId: 'p1', truncated: true, nextOffset: n + 1,
        artifacts: [{ kind: 'plan', relPath: `plans/p${n}.md`, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 }],
      });
    },
  });
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 40);
  const afterFirst = asked;
  // Bounded, and bounded LOW: each page costs the route 200 synchronous statSyncs,
  // so the pager must not undo the per-request cap it is paging under. The exact
  // ceiling is a tuning constant; that it stops well short of runaway is the point.
  assert.ok(afterFirst > 1 && afterFirst <= 12, `the walk stops at the ceiling: ${afterFirst}`);
  const note = secOf(ctx.window, 'artifacts').querySelector('.artifact-truncated');
  assert.ok(note, 'and the tab says the list is short rather than passing it off as the run');
  // The flag is never cleared and r.artifacts keeps growing from live events, so a
  // count here drifts past what was actually fetched.
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'deck', path: '/abs/run/deck/late.html', nodeId: 'implement', executionId: 'implement#1', cycle: 2 });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  await settle(ctx.window, 10);
  const after = secOf(ctx.window, 'artifacts').querySelector('.artifact-truncated');
  assert.ok(after, 'the notice survives');
  assert.doesNotMatch(after.textContent, /\d/, `no drifting count: ${after.textContent}`);

  // ...and it must NOT re-walk on every frame: this pane repaints per state event,
  // and 25 requests a frame is exactly the cost the design here rules out.
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  await settle(ctx.window, 40);
  assert.equal(asked, afterFirst, 'a repaint does not re-walk the whole cap');
});

// An incomplete walk was left unmemoised, and this pane repaints on every state
// frame — so a run whose page 2 fails transiently re-walked FROM OFFSET 0 on each
// frame: a fresh 200-row request (200 blocking statSyncs on the server) per frame,
// where the design here budgets one cheap GET. Resuming from the cursor where the
// walk stopped keeps the retry but costs one page, not the whole prefix again.
test('a failed page is retried from its cursor, not from the beginning', async () => {
  const asked = [];
  const row = (relPath) => ({ kind: 'plan', relPath, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 });
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifacts')) return null;
      asked.push(url);
      return url.includes('offset=2')
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
        : ok({ runId: 'p1', artifacts: [row('plans/a.md'), row('plans/b.md')], truncated: true, nextOffset: 2 });
    },
  });
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window, 12);
  const firstWalk = asked.length;
  assert.ok(asked.some((u) => u.includes('offset=2')), 'it tried the second page');

  asked.length = 0;
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  await settle(ctx.window, 12);
  assert.ok(asked.length > 0, 'the retry still happens');
  assert.ok(asked.every((u) => u.includes('offset=2')),
    `the retry resumes at the cursor, never re-reading page 1: ${asked.join(' ')} (first walk was ${firstWalk})`);
});

// A pruned path must take EVERY row for that file, not just the closest match.
// The engine drops the superseded row when a file is re-kinded (deck -> deck-asset),
// and onArtifact's dedupe is kind-scoped — so the client kept the old row beside
// the new one and listed the same file twice, with the per-node badge counting it
// twice too.
test('a prune removes every row for the file, whatever kind it was listed under', async () => {
  const ctx = await boot();
  const np = ctx.window.__np;
  const r = np.upsertRun({ runId: 'r1', title: 't', projectDir: PROJECT, status: 'running' });
  r.artifacts = [
    { kind: 'deck', relPath: 'deck/deck-stage.js', nodeId: 'n_build', stepKey: 'b#1', cycle: 1 },
    { kind: 'deck-asset', relPath: 'deck/deck-stage.js', nodeId: 'n_build', stepKey: 'b#2', cycle: 2 },
    { kind: 'deck', relPath: 'deck/deck.html', nodeId: 'n_build', stepKey: 'b#2', cycle: 2 },
  ];

  np.onArtifactGone(r, { paths: ['/abs/run/deck/deck-stage.js'] });

  const rels = r.artifacts.map((a) => a.relPath);
  assert.deepEqual(rels, ['deck/deck.html'], `both rows for the file go: ${rels.join(',')}`);
});

// Chat P5: every run-page opener lands in ONE popup viewer. The run pages' capture-phase Escape handlers send the
// detail back to its list; while the popup is open, Escape is the popup's.
test('the popup viewer owns Escape over the Running detail, and every opener reaches it', async () => {
  await checkRows([
    { name: 'Escape closes the popup and leaves the Running detail where it was', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => (url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'plans/plan.md', text: '# plan' }) : null),
      });
      await openRunWithArtifacts(ctx);
      // The slide layout: there the page's own capture-phase Escape arm goes up to the Runs list. Side by side that
      // arm does nothing, and this row could not fail.
      go(ctx.window, 'running/r1/details/artifacts');
      await settle(ctx.window);
      const doc = ctx.window.document;
      doc.getElementById('runs-shell').dataset.layout = 'slide';
      const hash = ctx.window.location.hash;
      assert.equal(hash, '#running/r1/artifacts');
      await ctx.window.__np.openRunArtifactPopup({ pipelineId: 'p1' }, { kind: 'plan', relPath: 'plans/plan.md', nodeId: 'plan', cycle: 1 });
      assert.ok(doc.querySelector('.apv'), 'the popup is open');
      assert.equal(doc.querySelector('.apv .apv-meta').textContent, 'Plan · cycle 1', 'the live run names the step');
      (doc.activeElement || doc.body).dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await settle(ctx.window);
      assert.equal(doc.querySelector('.apv'), null, 'Escape closed the popup');
      assert.equal(ctx.window.location.hash, hash, 'and did not send the run page back to its list');
      assert.ok(doc.querySelector('#run-detail .rd-sec[data-sec="artifacts"]'), 'the detail is still there');
    } },
    { name: 'a .log-artifact line opens the popup, by its kind, titled with the file name', run: async () => {
      const asked = [];
      const ctx = await boot({
        fetchHandler: (url) => {
          if (!url.includes('/api/runs/p1/artifact?rel=')) return null;
          asked.push(url);
          return ok({ rel: 'result.diff', text: '+a\n' });
        },
      });
      const doc = ctx.window.document;
      const pane = doc.createElement('div');
      pane._artifactCtx = { run: { id: 'r1', pipelineId: 'p1', artifacts: [] }, runId: 'r1' };
      const a = doc.createElement('a');
      a.className = 'log-msg log-artifact';
      a.href = '#';
      a.dataset.path = '/abs/run/result.diff';
      a.dataset.kind = 'result';
      pane.appendChild(a);
      doc.body.appendChild(pane);
      click(ctx.window, a);
      await settle(ctx.window, 8);
      assert.deepEqual(asked, ['/api/runs/p1/artifact?rel=%2Fabs%2Frun%2Fresult.diff']);
      assert.equal(doc.querySelector('.apv .apv-title').textContent, 'result.diff', 'the file name, never the absolute path');
      assert.ok(doc.querySelector('.apv .artifact-view.kind-diff .artifact-diff'));
    } },
    { name: 'the Agents tab\'s per-node row opens the popup', run: async () => {
      const ctx = await boot({
        fetchHandler: (url) => (url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'plans/plan.md', text: '# plan' }) : null),
      });
      await openRunWithArtifacts(ctx);
      click(ctx.window, tabOf(ctx.window, 'agents'));
      await settle(ctx.window);
      const sec = secOf(ctx.window, 'agents');
      click(ctx.window, sec.querySelector('.node-artifacts .artifact-toggle'));
      click(ctx.window, sec.querySelector('.node-artifacts .artifact-list .artifact-row'));
      await settle(ctx.window, 8);
      assert.ok(ctx.window.document.querySelector('.apv'), 'the popup opened');
      assert.equal(ctx.window.document.querySelector('#viewer-card').classList.contains('hidden'), true);
    } },
    { name: 'the popup\'s Download saves through the download form of the raw route', run: async () => {
      const heads = [];
      const ctx = await boot({
        fetchHandler: (url, opts) => {
          if (opts.method === 'HEAD') { heads.push(url); return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); }
          return url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'plans/plan.md', text: '# plan' }) : null;
        },
      });
      const saved = [];
      ctx.window.HTMLAnchorElement.prototype.click = function () { saved.push([this.getAttribute('href'), this.getAttribute('download')]); };
      await ctx.window.__np.openRunArtifactPopup({ pipelineId: 'p1' }, { kind: 'plan', relPath: 'plans/plan.md', bytes: 6 });
      click(ctx.window, ctx.window.document.querySelector('.apv .apv-dl'));
      await settle(ctx.window, 8);
      assert.deepEqual(heads, ['/api/runs/p1/artifact-raw/plans/plan.md?download=1']);
      assert.deepEqual(saved, [['/api/runs/p1/artifact-raw/plans/plan.md?download=1', 'plan.md']]);
    } },
  ]);
});

test('a tab row opens the popup with the tab as its ←/→ list, and its Download saves the file', async () => {
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (opts.method === 'HEAD') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      return url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'x', text: 'x' }) : null;
    },
  });
  const saved = [];
  ctx.window.HTMLAnchorElement.prototype.click = function () { saved.push(this.getAttribute('href')); };
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'artifacts');
  const mainOf = (name) => [...sec.querySelectorAll('.afb-main')].find((m) => m.querySelector('.afb-name').textContent === name);
  click(ctx.window, mainOf('result.diff'));
  await settle(ctx.window, 8);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('.apv .apv-pos').textContent, '2 / 3', 'Plan, Implementer, Run: the tab\'s order');
  assert.equal(doc.querySelector('.apv .apv-meta').textContent, 'Implementer · cycle 1');
  click(ctx.window, doc.querySelector('.apv .apv-next'));
  await settle(ctx.window, 8);
  assert.equal(doc.querySelector('.apv .apv-title').textContent, 'prompt.md');
  assert.equal(doc.querySelector('.apv .apv-meta').textContent, 'Run');
  click(ctx.window, doc.querySelector('.apv .apv-close'));
  click(ctx.window, mainOf('plan.md').parentElement.querySelector('.afb-dl'));
  await settle(ctx.window, 8);
  assert.deepEqual(saved, ['/api/runs/p1/artifact-raw/plans/plan.md?download=1']);
});

test('a row\'s Download that the server refuses is a toast, and nothing is saved', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/artifact-raw/')
      ? Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'artifact not found' }) })
      : null),
  });
  const saved = [];
  ctx.window.HTMLAnchorElement.prototype.click = function () { saved.push(this.getAttribute('href')); };
  await openRunWithArtifacts(ctx);
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'artifacts');
  const main = [...sec.querySelectorAll('.afb-main')].find((m) => m.querySelector('.afb-name').textContent === 'plan.md');
  click(ctx.window, main.parentElement.querySelector('.afb-dl'));
  await settle(ctx.window, 8);
  assert.deepEqual(saved, [], 'a 404 is never saved as the file');
  const t = [...ctx.window.document.querySelectorAll('#toasts > .toast')].pop();
  assert.ok(t, 'a toast');
  assert.equal(t.querySelector('.tt').textContent, 'Download failed');
  assert.equal(t.querySelector('.td').textContent, 'File not found');
});

// ── refine cycle 2: app.js wiring the rows above did not pin ──

test('an empty Artifacts tab says "No artifacts yet" on a live run and "No artifacts" on a saved one', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts') ? ok({ runId: 'p1', artifacts: [], truncated: false }) : null),
  });
  const np = ctx.window.__np;
  const doc = ctx.window.document;
  const live = doc.createElement('div');
  np.buildRdArtifacts(live, { run: np.upsertRun({ runId: 'r1', title: 't', projectDir: PROJECT, status: 'running' }) });
  await settle(ctx.window);
  assert.equal(live.querySelector('.afb-empty').textContent, 'No artifacts yet');
  const saved = doc.createElement('div');
  np.buildHdArtifacts(saved, { id: 'p1' }, { state: {} });
  await settle(ctx.window, 12);
  assert.equal(saved.querySelector('.afb-empty').textContent, 'No artifacts');
});

test('step folders follow the run\'s step order, labelled from the latest state frame — not the first file to land or the first frame', async () => {
  const ctx = await boot();
  frame(ctx, { type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'plan', cycle: 1 });   // no stepper yet
  go(ctx.window, 'running/r1');
  await settle(ctx.window);
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'result', path: 'result.diff', nodeId: 'implement', executionId: 'implement#1', cycle: 1 });
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'plan', path: 'plans/plan.md', nodeId: 'plan', executionId: 'plan#1', cycle: 1 });
  click(ctx.window, tabOf(ctx.window, 'artifacts'));
  await settle(ctx.window);
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1, stepper: STEPPER(), steps: STEPS(), subAgents: SUBS() });
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'artifacts');
  assert.deepEqual([...sec.querySelectorAll('.afb-folder.is-step .afb-fname')].map((f) => f.textContent), ['Plan', 'Implementer']);
});

test('a log line\'s artifact takes size, step and cycle from the run\'s own row; a file the run does not list shows no step', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'x', text: '+a\n' }) : null),
  });
  const doc = ctx.window.document;
  const run = { id: 'r1', pipelineId: 'p1', stepper: STEPPER(),
    artifacts: [{ kind: 'result', relPath: 'result.diff', nodeId: 'implement', cycle: 1, bytes: 2048 }] };
  const pane = doc.createElement('div');
  pane._artifactCtx = { run, runId: 'r1' };
  doc.body.appendChild(pane);
  const line = (path) => {
    const a = doc.createElement('a');
    a.className = 'log-msg log-artifact';
    a.href = '#';
    a.dataset.path = path;
    a.dataset.kind = 'result';
    pane.appendChild(a);
    return a;
  };
  click(ctx.window, line('/abs/run/result.diff'));
  await settle(ctx.window, 8);
  assert.equal(doc.querySelector('.apv .apv-meta').textContent, 'Implementer · cycle 1 · 2.0 KB');
  click(ctx.window, line('/abs/run/other.diff'));
  await settle(ctx.window, 8);
  assert.equal(doc.querySelector('.apv .apv-title').textContent, 'other.diff');
  assert.equal(doc.querySelector('.apv .apv-meta').textContent, '', 'no row says which step made it: no step, never "Run"');
});

test('the Agents tab\'s per-node row steps through its node\'s files', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'x', text: 'x' }) : null),
  });
  await openRunWithArtifacts(ctx);
  frame(ctx, { type: 'artifact', runId: 'r1', kind: 'review', path: 'review.json', nodeId: 'implement', executionId: 'implement#1', cycle: 1 });
  click(ctx.window, tabOf(ctx.window, 'agents'));
  await settle(ctx.window);
  const sec = secOf(ctx.window, 'agents');
  const toggle = [...sec.querySelectorAll('.node-artifacts .artifact-toggle')].find((t) => t.textContent === 'Artifacts (2)');
  assert.ok(toggle, 'the implement node lists two files');
  click(ctx.window, toggle);
  click(ctx.window, toggle.parentElement.querySelector('.artifact-list .artifact-row'));
  await settle(ctx.window, 8);
  assert.equal(ctx.window.document.querySelector('.apv .apv-pos').textContent, '1 / 2');
});

test('a saved run\'s tab names the step in the popup with no History detail open (the Chat run panel re-hosts it)', async () => {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/runs/p1/artifacts')) {
        return ok({ runId: 'p1', artifacts: [{ kind: 'plan', relPath: 'plans/plan.md', nodeId: 'plan', stepKey: 'plan#1', cycle: 1 }], truncated: false });
      }
      return url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'plans/plan.md', text: '# p' }) : null;
    },
  });
  const doc = ctx.window.document;
  const sec = doc.createElement('div');
  doc.body.appendChild(sec);
  ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: { stepper: STEPPER() } });
  await settle(ctx.window, 12);
  click(ctx.window, [...sec.querySelectorAll('.afb-main')].find((m) => m.querySelector('.afb-name').textContent === 'plan.md'));
  await settle(ctx.window, 8);
  assert.equal(doc.querySelector('.apv .apv-meta').textContent, 'Plan · cycle 1');
});

test('a section something cleared gets a fresh browser on its next paint (a builder retry)', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/runs/p1/artifacts') ? ok({ runId: 'p1', artifacts: [{ kind: 'plan', relPath: 'plan.md' }], truncated: false }) : null),
  });
  const sec = ctx.window.document.createElement('div');
  ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
  await settle(ctx.window, 12);
  ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });     // clears the section first
  await settle(ctx.window, 12);
  assert.equal(sec.querySelectorAll('.afb-file').length, 1);
  assert.doesNotMatch(sec.textContent, /Loading artifacts/);
});

// Chat P4 + P5 (lead ruling): the Chat run panel re-hosts the real Artifacts tab, so its browser rows open the same
// body-level popup. The popup's WINDOW-capture Escape runs before the panel's document-capture one and stops there:
// one Escape closes only the popup (focus back on the row), the next closes the panel. The search field owns its
// Escapes the same way (clear, then fold), and only then is Escape the panel's. A document capture spy (added after
// app.js's own listeners) proves the page never saw the Escapes the popup or the field kept.
test('in the Chat run panel the Artifacts tab opens the popup, and Escape closes the popup, then the field, then the panel', async () => {
  const panelBoot = async () => {
    const ctx = await boot({
      fetchHandler: (url, opts) => {
        if (opts.method === 'HEAD') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        return url.includes('/api/runs/p1/artifact?rel=') ? ok({ rel: 'plans/plan.md', text: '# plan' }) : null;
      },
    });
    frame(ctx, { type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT, status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run' });
    frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'running', phase: 'implement', cycle: 1,
      stepper: STEPPER(), steps: STEPS(), subAgents: SUBS(), totalCostUsd: 1.5, prompt: 'Add a dark mode toggle.' });
    for (const a of ARTIFACTS) frame(ctx, { ...a, runId: 'r1' });
    go(ctx.window, 'chat/new/run/r1/artifacts');
    await settle(ctx.window, 8);
    const doc = ctx.window.document;
    const panel = doc.querySelector('[data-chat-panel]');
    assert.ok(panel && !panel.hidden, 'the run panel is open');
    const sec = panel.querySelector('.rd-sec[data-sec="artifacts"]');
    assert.ok(sec && sec.querySelector('.afb'), 'the panel\'s Artifacts tab is the folder browser');
    const seen = [];
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') seen.push(e.target); }, true);
    const esc = () => (doc.activeElement || doc.body).dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return { ctx, doc, panel, sec, seen, esc };
  };
  await checkRows([
    { name: 'a row opens the popup; Escape closes only it and focus is back on the row; the next Escape closes the panel', run: async () => {
      const { ctx, doc, panel, sec, seen, esc } = await panelBoot();
      const hash = ctx.window.location.hash;
      assert.equal(hash, '#chat/new/run/r1/artifacts');
      const main = [...sec.querySelectorAll('.afb-main')].find((m) => m.querySelector('.afb-name').textContent === 'plan.md');
      const key = main.dataset.focusKey;
      main.focus();
      click(ctx.window, main);
      await settle(ctx.window, 8);
      const v = doc.querySelector('.apv');
      assert.ok(v, 'the popup opened');
      assert.equal(v.parentElement, doc.body, 'body-level, not inside the panel');
      assert.equal(v.querySelector('.apv-title').textContent, 'plan.md');
      assert.ok(v.contains(doc.activeElement), 'focus is in the popup');
      esc();
      await settle(ctx.window);
      assert.equal(doc.querySelector('.apv'), null, 'Escape closed the popup');
      assert.equal(panel.hidden, false, 'and left the panel open');
      assert.equal(ctx.window.location.hash, hash, 'on the same address');
      assert.equal(seen.length, 0, 'the page never saw the popup\'s Escape');
      assert.equal(doc.activeElement && doc.activeElement.dataset.focusKey, key, 'focus is back on the row');
      esc();
      await settle(ctx.window);
      assert.equal(panel.hidden, true, 'the next Escape is the panel\'s');
    } },
    { name: 'the search field: the first Escape clears it, the second folds it, the third closes the panel', run: async () => {
      const { ctx, doc, panel, sec, seen, esc } = await panelBoot();
      const head = sec.querySelector('.afb-head');
      const btn = sec.querySelector('.afb-sbtn');
      click(ctx.window, btn);
      const input = sec.querySelector('.afb-filter');
      assert.equal(doc.activeElement, input, 'the field has the focus');
      input.value = 'plan';
      input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
      await settle(ctx.window);
      assert.equal(sec.querySelectorAll('.afb-main').length, 1, 'one match');
      esc();
      await settle(ctx.window);
      assert.equal(input.value, '', 'the first Escape cleared the query');
      assert.ok(head.classList.contains('is-searching'), 'and kept the field open');
      assert.equal(panel.hidden, false);
      esc();
      await settle(ctx.window);
      assert.equal(head.classList.contains('is-searching'), false, 'the second Escape folded the field');
      assert.equal(doc.activeElement, btn, 'focus is on the search button');
      assert.equal(panel.hidden, false, 'the panel is still open');
      assert.equal(ctx.window.location.hash, '#chat/new/run/r1/artifacts');
      assert.equal(seen.length, 0, 'the page never saw the field\'s Escapes');
      esc();
      await settle(ctx.window);
      assert.equal(panel.hidden, true, 'the third Escape is the panel\'s');
    } },
  ]);
});

test('a page the History pager loads hands the focus on (the control pressed is gone): the next page\'s control, else the list', async () => {
  const row = (kind, relPath) => ({ kind, relPath, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 });
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifacts')) return null;
      if (url.includes('offset=4')) return ok({ runId: 'p1', artifacts: [row('deck', 'deck/deck.pdf')], truncated: false });
      if (url.includes('offset=2')) return ok({ runId: 'p1', artifacts: [row('plan', 'c.md'), row('plan', 'd.md')], truncated: true, nextOffset: 4 });
      return ok({ runId: 'p1', artifacts: [row('plan', 'a.md'), row('plan', 'b.md')], truncated: true, nextOffset: 2 });
    },
  });
  const doc = ctx.window.document;
  const sec = doc.createElement('div');
  doc.body.appendChild(sec);
  ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
  await settle(ctx.window, 12);
  const first = sec.querySelector('.artifact-truncated');
  first.focus();
  click(ctx.window, first);
  await settle(ctx.window, 12);
  const second = sec.querySelector('.artifact-truncated');
  assert.ok(second && second !== first, 'a new control for the page after');
  assert.equal(doc.activeElement, second, 'the focus moved on to it');
  click(ctx.window, second);
  await settle(ctx.window, 12);
  assert.equal(sec.querySelector('.artifact-truncated'), null, 'the last page: no control');
  assert.ok(sec.contains(doc.activeElement) && doc.activeElement.matches('.afb-folder, .afb-main'), 'the focus is in the list, never <body>');
});

test('the History pager never takes the focus on its first page, nor from a reader who moved on while a page loaded', async () => {
  const row = (kind, relPath) => ({ kind, relPath, nodeId: 'implement', stepKey: 'implement#1', cycle: 1 });
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifacts')) return null;
      if (url.includes('offset=2')) return ok({ runId: 'p1', artifacts: [row('plan', 'c.md'), row('plan', 'd.md')], truncated: true, nextOffset: 4 });
      return ok({ runId: 'p1', artifacts: [row('plan', 'a.md'), row('plan', 'b.md')], truncated: true, nextOffset: 2 });
    },
  });
  const doc = ctx.window.document;
  const sec = doc.createElement('div');
  const other = doc.createElement('button');
  other.textContent = 'elsewhere';
  doc.body.append(sec, other);
  if (doc.activeElement && doc.activeElement !== doc.body) doc.activeElement.blur();
  ctx.window.__np.buildHdArtifacts(sec, { id: 'p1' }, { state: {} });
  await settle(ctx.window, 12);
  assert.equal(doc.activeElement, doc.body, 'the first page takes no focus');
  const first = sec.querySelector('.artifact-truncated');
  first.focus();
  click(ctx.window, first);
  other.focus();                                    // the reader moves on before the page arrives
  await settle(ctx.window, 12);
  assert.ok(sec.querySelector('.artifact-truncated') !== first, 'the page arrived');
  assert.equal(doc.activeElement, other, 'their focus stays where they put it');
});

// Chat P5 (CONTRACT §3): P1 passes ask-panel a mutable chatDeps; P5 points its openArtifact at the popup viewer, so an
// artifact chip in the Chat opens the same viewer as the run pages instead of navigating to the run's Artifacts tab.
test('the Chat opens an artifact in the same popup viewer (chatDeps.openArtifact)', async () => {
  const asked = [];
  const ctx = await boot({
    fetchHandler: (url) => {
      if (!url.includes('/api/runs/p1/artifact?rel=')) return null;
      asked.push(url);
      return ok({ rel: 'plans/plan.md', text: '# plan' });
    },
  });
  const deps = ctx.window.__np.chat && ctx.window.__np.chat.deps;
  assert.ok(deps && typeof deps.openArtifact === 'function', 'P1 exposes its chatDeps');
  const hash = ctx.window.location.hash;
  deps.openArtifact({ runId: 'p1', pipelineId: 'p1', projectKey: 'proj-00000001' },
    { kind: 'plan', relPath: 'plans/plan.md', nodeId: 'plan', cycle: 1, bytes: 2048 });
  await settle(ctx.window, 10);
  assert.deepEqual(asked, ['/api/runs/p1/artifact?rel=plans%2Fplan.md']);
  const v = ctx.window.document.querySelector('.apv');
  assert.ok(v, 'the popup opened');
  assert.equal(v.querySelector('.apv-title').textContent, 'plan.md');
  assert.equal(v.querySelector('.apv-meta').textContent, 'plan · cycle 1 · 2.0 KB', 'no stepper here: the node id');
  assert.equal(ctx.window.location.hash, hash, 'no navigation to the run page');
  // A run card's ref (P3 artifactRef) carries nodeLabel(nodeId) from its snapshot: the step reads as the run names it.
  deps.openArtifact({ runId: 'p1', pipelineId: 'p1', nodeLabel: (id) => (id === 'plan' ? 'Planner' : id) },
    { kind: 'plan', relPath: 'plans/plan.md', nodeId: 'plan', cycle: 1, bytes: 2048 });
  await settle(ctx.window, 10);
  assert.equal(ctx.window.document.querySelector('.apv .apv-meta').textContent, 'Planner · cycle 1 · 2.0 KB');
});
