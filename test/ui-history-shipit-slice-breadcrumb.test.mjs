// test/ui-history-shipit-slice-breadcrumb.test.mjs
// The test of test/ui-history-shipit.test.mjs that reads the run groups the app loads on its FIRST hello (a done
// slice's History page links its feature). With one app boot per file that first hello is the boot's own, so this
// test lives in its own file, booted with its feature group (test/helpers/shared-app-boot.mjs, C5). Its fixtures and
// route table are the original file's, from test/helpers/history-shipit-fixtures.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import {
  PROJECT, settle, go, ROW, row, DETAIL, okBudget, REMOTES, historyArms, groupsArm, hello,
} from './helpers/history-shipit-fixtures.mjs';

// Runs redesign slice 4 (D18): a slice's History glance has no group row and no kind chip; its breadcrumb links the group.
const CHARTS = () => ({ groups: [{ id: 'feat_1', kind: 'feature', title: 'Charts', projectKey: null, planning: null, cost: { usd: 0, byPipeline: {} },
  members: [1, 2, 3].map((i) => ({ position: i, title: `Slice ${i}`, pipelineId: i === 1 ? ROW.id : null, ticketId: i === 1 ? null : `t${i}`,
    status: i === 1 ? 'done' : null, pr: null, ticket: i === 1 ? null : { id: `t${i}`, status: 'scheduled', runAt: null, after: true }, adhoc: false, after: i === 1 ? null : i - 1 })) }] });

// The first hello's run groups are this test's: the boot answers /api/run-groups with its feature group.
const bootGroups = groupsArm(CHARTS());
const app = useSharedApp({ before, beforeEach, after }, {
  fetchHandler: (u, opts) => bootGroups(String(u), opts) || Promise.resolve(String(u).includes('/api/projects')
    ? { ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) }
    : { ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) }),
});

async function bootShip({ rows = [row()], detail = DETAIL, gh = true, prHosts = null, arms = null, remotes = REMOTES } = {}) {
  const box = { rows, detail, gh, prHosts, remotes, budget: okBudget() };
  const base = historyArms(box);
  await app.fresh({ fetchHandler: (url, opts) => (arms && arms(url, opts, box)) || base(url, opts) });
  return { window: app.window, calls: app.calls, wsBox: app.wsBox, box };
}

const detailHash = `history/${ROW.projectKey}/${ROW.id}`;

async function openDetail(ctx, hash = detailHash) {
  go(ctx.window, hash);
  await settle(ctx.window);
}

test('a done slice\'s History page: the breadcrumb links the feature page, no group row, no chip; a repaint keeps it so', async () => {
  const ctx = await bootShip({ arms: groupsArm(CHARTS()) });
  hello(ctx);
  await openDetail(ctx);
  await settle(ctx.window, 4);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-kv [data-fact="group"]').hidden, true, 'no Feature row');
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-page-head .kind-chip'), null, 'no kind chip');
  assert.equal(doc.querySelector('#hist-detail .hd-bar .rd-crumbs a.rd-crumb[href="#feature/feat_1"]').textContent, 'Charts');
  assert.equal(doc.querySelector('#hist-detail .rd-slice-line'), null, 'no slice line either');
  await openDetail(ctx);                                 // the same detail again: painted in place
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-page-head .kind-chip'), null);
  assert.equal(doc.querySelectorAll('#hist-detail .hd-bar .rd-crumbs .rd-crumb').length, 3);
});
