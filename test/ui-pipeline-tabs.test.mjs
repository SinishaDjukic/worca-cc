// test/ui-pipeline-tabs.test.mjs — per-pipeline child tabs under Running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const htmlPath = join(root, 'index.html');
const appPath = join(root, 'app.js');
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, recv };
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

test('hello with two live pipelines renders two child rows + live badge', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix'), live('seo-pSEO')] });
  const rows = window.document.querySelectorAll('#nav-running-children .nav-child');
  assert.equal(rows.length, 2);
  assert.equal(window.document.querySelector('#nav-running-count').textContent, '2');
});

test('a pending question shows pulsing "?" marker + parent roll-up', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix', { pendingQuestion: { id: 'q1', kind: 'clarify', questions: [{ question: 'x?', options: ['a'] }] } })] });
  const q = window.document.querySelector('#nav-running-children .nav-child .child-q');
  assert.ok(q, 'awaiting-input "?" marker present');
  assert.equal(q.textContent, '?');
  assert.equal(window.document.querySelector('#nav-running-rollup').hidden, false);
});

test('focus route shows only the selected card', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix'), live('seo-pSEO')] });
  window.location.hash = 'running/auth-fix';
  window.dispatchEvent(new window.Event('hashchange'));
  const cards = window.document.querySelectorAll('#run-list .run-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].dataset.runId, 'auth-fix');
});

test('a run finishing live lingers as a greyed child row, then drops once opened', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix')] });
  recv({ type: 'done', runId: 'auth-fix', status: 'done' });        // finishes LIVE
  let row = window.document.querySelector('#nav-running-children .nav-child[data-child-run-id="auth-fix"]');
  assert.ok(row, 'lingerer still present');
  assert.ok(row.classList.contains('lingering'));
  window.location.hash = 'running/auth-fix';                        // open → acknowledge
  window.dispatchEvent(new window.Event('hashchange'));
  row = window.document.querySelector('#nav-running-children .nav-child[data-child-run-id="auth-fix"]');
  assert.equal(row, null, 'acknowledged run drops from tabs');
});

// Regression: watching a run LIVE (focus view open) must not pre-acknowledge it.
// Opening a still-running run used to call acknowledgeRun, which made the later
// markLingering a no-op so the finished run skipped Running straight into History.
test('opening a run while LIVE does not suppress its later linger', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix')] });
  window.location.hash = 'running/auth-fix';                        // open while still running
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'done', runId: 'auth-fix', status: 'done' });        // finishes LIVE, focus drops
  const row = window.document.querySelector('#nav-running-children .nav-child[data-child-run-id="auth-fix"]');
  assert.ok(row, 'finished run still lingers in Running (not acknowledged by live-open)');
  assert.ok(row.classList.contains('lingering'));
});

test('a run finishing live shows a static green "●" end marker (done)', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix')] });
  recv({ type: 'done', runId: 'auth-fix', status: 'done' });
  const m = window.document.querySelector('#nav-running-children .nav-child .child-q');
  assert.ok(m, 'finished marker present');
  assert.equal(m.textContent, '●');
  assert.ok(m.classList.contains('ok'), 'green (ok) marker for done');
  assert.equal(m.classList.contains('bad'), false);
});

// A PAUSED run is parked in Running (resumable), not a finished result: it stays
// in the list with a static amber dot + no green/red end marker, and opening it
// (to Resume) must NOT drop it into History.
test('a paused run stays in Running with an amber dot and no end marker', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix')] });
  recv({ type: 'done', runId: 'auth-fix', status: 'paused' });      // pause routes through finishRun
  let row = window.document.querySelector('#nav-running-children .nav-child[data-child-run-id="auth-fix"]');
  assert.ok(row, 'paused run present in Running');
  assert.equal(row.classList.contains('lingering'), false, 'paused is not a greyed lingerer');
  assert.ok(row.querySelector('.child-dot.paused'), 'static amber paused dot');
  assert.equal(row.querySelector('.child-q'), null, 'no green/red end marker for paused');

  window.location.hash = 'running/auth-fix';                        // open to Resume
  window.dispatchEvent(new window.Event('hashchange'));
  row = window.document.querySelector('#nav-running-children .nav-child[data-child-run-id="auth-fix"]');
  assert.ok(row, 'opening a paused run does NOT drop it from Running');
});

// Resuming a paused run mints a NEW runId; the pre-pause log must be carried into
// the resumed run so the live card shows ALL logs, not just the ones before pause.
test('resuming a paused run carries the pre-pause log into the resumed run', async () => {
  const { window, recv } = await boot();
  const origFetch = window.fetch;
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/resume')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'auth-fix-2', pipelineId: 'auth-fix' }) });
    }
    if (u.includes('/log')) return Promise.resolve({ ok: true, status: 200, text: async () => '' });
    return origFetch(url, opts);
  };
  globalThis.fetch = window.fetch;

  recv({ type: 'hello', runs: [live('auth-fix', { pipelineId: 'auth-fix' })] });
  recv({ type: 'log', runId: 'auth-fix', text: 'PRE_PAUSE_LINE', ts: 1 });
  recv({ type: 'done', runId: 'auth-fix', status: 'paused' });

  window.location.hash = 'running';                                  // Overview → paused card renders
  window.dispatchEvent(new window.Event('hashchange'));
  const btn = window.document.querySelector('#run-list .run-card[data-run-id="auth-fix"] .btn-resume');
  assert.ok(btn && !btn.hidden, 'Resume button visible on the paused card');
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const card = window.document.querySelector('#run-list .run-card[data-run-id="auth-fix-2"]');
  assert.ok(card, 'resumed run (new runId) card present');
  assert.match(card.querySelector('.log').textContent, /PRE_PAUSE_LINE/, 'pre-pause log carried into the resumed run');
  assert.equal(
    window.document.querySelector('#run-list .run-card[data-run-id="auth-fix"]'), null,
    'old paused run card dropped (no split/dup)'
  );
});

test('a run failing live shows a static red "●" end marker (error/stopped)', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix')] });
  recv({ type: 'done', runId: 'auth-fix', status: 'error' });
  const m = window.document.querySelector('#nav-running-children .nav-child .child-q');
  assert.ok(m, 'finished marker present');
  assert.equal(m.textContent, '●');
  assert.ok(m.classList.contains('bad'), 'red (bad) marker for error');
  assert.equal(m.classList.contains('ok'), false);
});

test('seed-on-first-hello: a pre-existing terminal run is NOT a lingerer', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('old-done', { status: 'done' })] });
  const rows = window.document.querySelectorAll('#nav-running-children .nav-child');
  assert.equal(rows.length, 0);
});

// v2: a live NON-pipeline run (e.g. a scan) still renders on the Overview (no
// regression), but gets NO child tab (Q&A #1, pipeline-only tabs).
test('a live non-pipeline run shows on Overview but has no child tab', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('scan-1', { kind: 'scan' })] });
  const tabs = window.document.querySelectorAll('#nav-running-children .nav-child');
  assert.equal(tabs.length, 0, 'scan gets no pipeline tab');
  window.location.hash = 'running';   // Overview only paints #run-list while on the Running view
  window.dispatchEvent(new window.Event('hashchange'));
  const cards = window.document.querySelectorAll('#run-list .run-card');
  assert.equal(cards.length, 1, 'scan still renders as an Overview card');
  assert.equal(cards[0].dataset.runId, 'scan-1');
});

// Running badge split: green = running count, amber (with pause flag) = paused
// count, hidden at zero. liveRuns() excludes 'paused' so the counts are disjoint.
test('paused pipelines get their own badge; running badge excludes them', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix'), live('seo-pSEO')] });
  assert.equal(window.document.querySelector('#nav-paused-badge').hidden, true, 'paused badge hidden at zero');
  recv({ type: 'done', runId: 'auth-fix', status: 'paused' });
  assert.equal(window.document.querySelector('#nav-running-count').textContent, '1');
  assert.equal(window.document.querySelector('#nav-paused-count').textContent, '1');
  assert.equal(window.document.querySelector('#nav-paused-badge').hidden, false);
  assert.ok(window.document.querySelector('#nav-paused-badge .pause-flag'), 'pause flag icon present');
});

// Workspace runs list every member project in the child hint (clamped by CSS).
test('a workspace run lists all member projects in the child hint', async () => {
  const { window, recv } = await boot();
  recv({
    type: 'hello',
    runs: [live('ws-run', { kind: 'workspace-run', workspaceId: 'w1', projectNames: ['api', 'web', 'mobile', 'infra'] })],
  });
  const hint = window.document.querySelector('#nav-running-children .nav-child .child-proj');
  assert.equal(hint.textContent, 'api · web · mobile · infra');
  const single = window.document.querySelector('#nav-running-children .nav-child[data-child-run-id="ws-run"]');
  assert.ok(single, 'workspace run still renders a child tab');
});

// A run started by ANOTHER tab / the CLI arrives via the run-created broadcast
// (hello is once-per-socket) and must carry its project metadata immediately.
test('run-created broadcast materializes a child row with project metadata', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [] });
  recv({ type: 'run-created', runId: 'fresh', title: 'fresh run', projectDir: PROJECT, kind: 'run', status: 'starting', startedAt: '10:00:00' });
  const row = window.document.querySelector('#nav-running-children .nav-child[data-child-run-id="fresh"]');
  assert.ok(row, 'child row present without a reload');
  assert.equal(row.querySelector('.child-proj').textContent, 'proj');
  assert.equal(window.document.querySelector('#nav-running-count').textContent, '1');
});

// v3: finishing the FOCUSED run falls back to the Overview (Q&A #5).
test('finishing the focused run falls back to Overview', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix'), live('seo-pSEO')] });
  window.location.hash = 'running/auth-fix';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'done', runId: 'auth-fix', status: 'done' });        // focused run finishes
  assert.equal(window.location.hash.replace(/^#/, ''), 'running', 'hash dropped to Overview');
});
