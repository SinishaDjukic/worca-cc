// test/ui-run-detail-sync.test.mjs — the run page's Sync stage (#527, plan §6.5 / D6):
// a header `.rd-sync` button summarises the sync record and opens the Live log narrowed to
// x:sync:1; the start commit rides inside the existing `.rd-base` text.
//
// boot() / settle() / go() are copied from test/ui-running-routing.test.mjs (house convention).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';
const ID = 'auth-fix';

async function boot() {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (u) => {
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
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
  return { window, recv };
}
async function settle(n = 3) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); }

const SYNC_ROW = { key: 'x:sync:1', executionId: 'x:sync:1', phase: 'sync', status: 'done', activeMs: 5, runningSince: null };

async function openRun({ steps, branch }) {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [{ runId: ID, title: ID, projectDir: PROJECT, status: 'running', kind: 'run', startedAt: '10:00:00', pendingQuestion: null }] });
  await settle();
  go(ctx.window, `running/${ID}`);
  await settle();
  ctx.recv({ type: 'state', runId: ID, status: 'running', steps, stepper: null, branch });
  await settle();
  return ctx;
}

test('the run page header reflects the sync record: .rd-sync summarises branch.sync (hidden without a Sync row) and .rd-base carries the short start commit with the full sha in its title', async () => {
  await checkRows([
    { name: 'a run with a Sync row shows the .rd-sync summary from branch.sync', run: async () => {
      const { window } = await openRun({
        steps: [SYNC_ROW],
        branch: { source: 'dev', feature: 'worca-cc/auth-fix', baseSha: 'abc1234def5678', sync: { result: 'fast-forwarded', commits: 3, remote: 'origin' } },
      });
      const btn = window.document.querySelector('#run-detail .rd-sync');
      assert.ok(btn, 'the header carries the Sync button');
      assert.equal(btn.hidden, false);
      assert.equal(btn.textContent, 'Synced 3 commits');
      assert.equal(btn.title, 'Synced 3 commits from origin/dev. Show the Sync log');
      assert.equal(btn.getAttribute('aria-label'), btn.title);
      assert.ok(btn.classList.contains('btn-sm'), 'compact like the copy chip beside it');
    } },
    { name: 'a run without the Sync row keeps .rd-sync hidden', run: async () => {
      const { window } = await openRun({ steps: [], branch: { source: 'main', feature: 'worca-cc/auth-fix' } });
      const btn = window.document.querySelector('#run-detail .rd-sync');
      assert.equal(btn.hidden, true);
      assert.equal(window.document.querySelector('#run-detail .rd-base').textContent, 'main →', 'no baseSha: the text is unchanged');
    } },
    { name: '.rd-base carries the short start commit and names it in the title', run: async () => {
      const { window } = await openRun({
        steps: [SYNC_ROW],
        branch: { source: 'dev', feature: 'worca-cc/auth-fix', baseSha: 'abc1234def5678', startRef: 'abc1234def5678', sync: { result: 'remote-start', remote: 'origin' } },
      });
      const base = window.document.querySelector('#run-detail .rd-base');
      assert.equal(base.textContent, 'dev @ abc1234 →');
      assert.match(base.title, /Started from abc1234def5678/);
      assert.match(base.title, /remote tip/);
      const btn = window.document.querySelector('#run-detail .rd-sync');
      assert.equal(btn.textContent, 'From origin', 'the source branch already sits on the left of the row');
      assert.equal(btn.title, 'Started from origin/dev: the local branch was left untouched. Show the Sync log');
    } },
  ]);
});

test('clicking .rd-sync narrows the Live log to x:sync:1', async () => {
  const { window } = await openRun({
    steps: [SYNC_ROW],
    branch: { source: 'dev', feature: 'worca-cc/auth-fix', baseSha: 'abc1234def5678', sync: { result: 'fast-forwarded', commits: 3 } },
  });
  window.document.querySelector('#run-detail .rd-sync').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle();
  const r = window.__np.getRun(ID);
  assert.equal(r.logFilter.execution, 'x:sync:1');
  assert.equal(r.logFilter.node, 'sync');
  assert.equal(window.location.hash, `#running/${ID}/details/logs`, 'Details › Live log is opened');
});
