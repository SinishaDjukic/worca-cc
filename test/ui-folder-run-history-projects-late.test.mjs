// test/ui-folder-run-history-projects-late.test.mjs — the test of test/ui-folder-run-history.test.mjs that needs the
// app LOADED with the Runs list grouped by project and its project list still in flight: the Folder chip lands when
// /api/projects answers after the rows. app.js reads the View and loads the projects when it loads, so this test lives
// in its own file, booted with them (test/helpers/shared-app-boot.mjs).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { settle, go, ROW, DETAIL, detailOn, historyFetch } from './helpers/history-detail-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const COUNTS = { added: 9, modified: 4, deleted: 1 };
const FROW = (over = {}) => ({ ...ROW, title: 'Rename receipts by date and vendor', projectName: 'Tax papers 2026', projectDir: '/tmp/tax',
  branch: null, sourceBranch: null, survived: false, workMode: 'folder', changes: { state: 'pending', counts: COUNTS }, ...over });
const PROJ = [{ name: 'Tax papers 2026', path: '/tmp/tax', exists: true, vcs: 'none', workMode: 'folder', key: ROW.projectKey }];
let release;
const gate = new Promise((r) => { release = r; });
const app = useSharedApp({ before, beforeEach, after }, {
  local: { 'worca-cc.runs.view': JSON.stringify({ show: 'all', groupBy: 'project', person: '' }) },
  fetchHandler: historyFetch((url) => (url.includes('/api/projects') ? gate.then(() => ({ ok: true, status: 200, json: async () => ({ projects: PROJ }) })) : null)),
});
const bootDetail = detailOn(app).detail;

test('the Runs list in the app: the Folder chip lands when /api/projects answers after the rows; the row reads Applied', async () => {
  const ctx = await bootDetail({ rows: [FROW({ changes: { state: 'applied', counts: COUNTS } })], detail: DETAIL });
  go(ctx.window, 'runs');
  await settle(ctx.window, 8);
  const doc = ctx.window.document;
  const group = () => doc.querySelector(`#runs-list .runs-sec[data-section="project:${ROW.projectKey}"]`);   // View › Group by Project
  assert.equal(group().querySelector('.kind-chip'), null, 'no project row yet: no chip');
  assert.match(group().querySelector('.runs-row-sub').textContent, /^Applied/);
  release();
  await settle(ctx.window, 8);
  assert.equal(group().querySelector('.runs-sec-head .kind-chip').textContent, 'Folder');
});
