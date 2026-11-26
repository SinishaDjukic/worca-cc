// test/ui-folder-run-running-runs-list.test.mjs — the test of test/ui-folder-run-running.test.mjs that needs the app
// LOADED with the Runs list grouped by project and a Folder project in its project list: a live Folder run names its
// group kind and its settled changes. app.js reads the View and loads the projects when it loads, so this test lives in
// its own file, booted with them (test/helpers/shared-app-boot.mjs).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPageOn, helloRun } from './helpers/run-page-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const COUNTS = { added: 9, modified: 4, deleted: 1 };
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const PROJ = [{ name: 'Tax papers 2026', path: '/tmp/tax', exists: true, vcs: 'none', workMode: 'folder', key: 'tax-papers-1a2b3c4d' }];
const app = useSharedApp({ before, beforeEach, after }, {
  local: { 'worca-cc.runs.view': JSON.stringify({ show: 'all', groupBy: 'project', person: '' }) },
  fetchHandler: (url) => {
    if (url === '/api/projects') return ok({ projects: PROJ });
    if (url.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: false });
    return null;
  },
});
const bootApp = runPageOn(app);

test('the Runs list: a live Folder run names its group kind and its settled changes before any saved row', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', workMode: 'folder', projectDir: '/tmp/tax' });
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps: [], workMode: 'folder',
    branch: { workMode: 'folder', changes: { state: 'applied', counts: COUNTS } } });
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'done' });
  ctx.showRunning();
  await ctx.settle(8);
  const group = ctx.window.document.querySelector('#runs-list .runs-sec[data-section="project:tax-papers-1a2b3c4d"]');   // View › Group by Project
  assert.equal(group.querySelector('.runs-sec-head .kind-chip').textContent, 'Folder');
  assert.match(group.querySelector('.runs-row[data-run-id="r1"] .runs-row-sub').textContent, /^Applied/);
});
