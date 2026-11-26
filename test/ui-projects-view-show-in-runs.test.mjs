// test/ui-projects-view-show-in-runs.test.mjs
// The test of test/ui-projects-view.test.mjs whose Runs list starts with the project's group folded: the list reads
// its folded groups from storage when app.js loads, so with one app boot per file this test lives in its own file,
// booted with that storage (test/helpers/shared-app-boot.mjs, C5). Its fixtures are the original file's.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { checkRows } from './helpers/rows.mjs';

const PROJECTS = [
  { name: 'alpha', path: '/Users/me/dev/alpha', exists: true, key: 'alpha-00000001' },
  { name: 'beta', path: '/Users/me/dev/beta', exists: false, key: 'beta-00000002' },
];
const HISTORY = [
  { id: 'p-old', projectKey: 'alpha-00000001', projectName: 'alpha', title: 'Old run', status: 'done', startedAt: '2026-09-01T10:00:00.000Z' },
  { id: 'p-new', projectKey: 'alpha-00000001', projectName: 'alpha', title: 'Newest run', status: 'stopped', startedAt: '2026-09-10T09:30:00.000Z' },
  { id: 'p-b', projectKey: 'beta-00000002', projectName: 'beta', title: 'Beta run', status: 'done', startedAt: '2026-09-05T08:00:00.000Z' },
];

const FOLDED = { 'worca-cc.runs.collapsed': JSON.stringify(['project:alpha-00000001']) };   // Group by Project sections fold by project:KEY
const defaultFetch = (u) => {
  if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
  if (u.includes('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: HISTORY, ghAvailable: false }) });
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] }) });
};
const app = useSharedApp({ before, beforeEach, after }, {
  url: 'http://localhost:4321/',
  local: FOLDED,
  setup: (window) => {
    window.confirm = () => true;
    window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
  },
  fetchHandler: defaultFetch,
});

// The file booted with the folded group; the test's `storage` is that same seed, put back by each reset.
async function boot({ fetchHandler, storage = {} } = {}) {
  assert.deepEqual(storage, FOLDED, 'this file loads app.js with the folded group');
  await app.fresh(fetchHandler ? { fetchHandler } : {});
  return { window: app.window };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

async function goHash(window, hash) {
  window.location.hash = hash;
  await tick(); await tick(); await tick();
}

test('Show in Runs unfolds the project group; New pipeline selects the project, lands on #new and issues ONE config load for it', async () => {
  // One boot walks Show in Runs, then New pipeline; each step's state is recorded as it
  // happens, and the rows read the records.
  const cfgDirs = [];
  const { window } = await boot({
    storage: { 'worca-cc.runs.collapsed': JSON.stringify(['project:alpha-00000001']) },   // Group by Project sections fold by project:KEY
    fetchHandler: (u) => { if (u.startsWith('/api/config')) cfgDirs.push(decodeURIComponent(u.split('projectDir=')[1] || '')); return null; },
  });
  await goHash(window, 'projects/alpha-00000001');
  await tick(); await tick();
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-history'));
  const afterHistory = { hash: window.location.hash, collapsed: JSON.parse(window.localStorage.getItem('worca-cc.runs.collapsed')) };
  await goHash(window, 'projects/alpha-00000001');
  cfgDirs.length = 0;
  click(window, doc.querySelector('#proj-detail .pd-new'));
  const sel = doc.getElementById('projectSelect');
  const afterNew = { hash: window.location.hash, name: sel.options[sel.selectedIndex].dataset.name,
    lastProject: window.localStorage.getItem('worca-cc.lastProject') };
  await tick(); await tick();
  await checkRows([
    { name: 'Show in Runs unfolds the project group on the Runs list; New pipeline selects the project and lands on #new', run: () => {
      assert.equal(afterHistory.hash, '#runs');
      assert.deepEqual(afterHistory.collapsed, [],
        'the project group is unfolded (the folded key is gone)');
      assert.equal(afterNew.hash, '#new');
      assert.equal(afterNew.name, 'alpha');
      assert.equal(afterNew.lastProject, 'alpha');
    } },
    { name: 'New pipeline from a project page issues ONE config load, for the page project', run: () => {
      assert.deepEqual(cfgDirs, ['/Users/me/dev/alpha']);
    } },
  ]);
});
