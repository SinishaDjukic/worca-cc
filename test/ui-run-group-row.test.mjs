// test/ui-run-group-row.test.mjs — runs redesign slice 4 (D18), run 3 (D6-D8): a run in a group has no kind chip and no
// group row; its bar's breadcrumb "Runs › Run tags › Run 3" names its place and links the group page. A run in no group
// offers "Add to group…" in its facts block's last row at Advanced and above.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, settle, ok, ROW, DETAIL } from './helpers/history-detail-boot.mjs';
import { bootChat, liveRun, hello, openPanel } from './helpers/chat-panel-boot.mjs';
import { applyLevel } from '../ui/public/ui-level.mjs';

const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
const GROUPS = { groups: [{ id: 'feat_1', kind: 'feature', title: 'Run tags', projectKey: null,
  planning: { pipelineId: 'p0', title: 'Planning', status: 'done' },
  members: [1, 2, 3].map((i) => ({ position: i, title: `Slice ${i}`, pipelineId: `p${i}`, ticketId: null, status: i < 3 ? 'done' : 'running', pr: null, ticket: null, adhoc: false, after: null })),
  cost: { usd: 0, byPipeline: {} } }] };
const handler = (groups) => (url) => (url.startsWith('/api/run-groups') ? json(groups) : null);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

test('a member run\'s page has no Group row and no kind chip; its breadcrumb links the group page', async () => {
  const ctx = await bootApp({ fetchHandler: handler(GROUPS) });
  helloRun(ctx, { runId: 'r3', pipelineId: 'p3' });
  ctx.go('running/r3');
  await ctx.settle(4);
  const doc = ctx.window.document;
  const g = doc.querySelector('#run-detail .rd-sheet .rd-kv [data-fact="group"]');
  assert.equal(g.hidden, true, 'the breadcrumb says it: no Group row');
  assert.equal(g.querySelector('.rd-kv-v').children.length, 0);
  assert.equal(doc.querySelector('#run-detail .rd-group-link'), null);
  assert.equal(doc.querySelector('#run-detail .rd-group-pos'), null);
  assert.equal(doc.querySelector('#run-detail .rd-page-head .kind-chip'), null, 'no kind chip');
  assert.equal(doc.querySelector('#run-detail .rd-bar .rd-crumbs a.rd-crumb:not([data-crumb])').getAttribute('href'), '#feature/feat_1');
  assert.deepEqual([...doc.querySelectorAll('#run-detail .rd-bar .rd-crumbs .rd-crumb')].map(text), ['Runs', 'Run tags', 'Run 3']);
  assert.equal(doc.querySelector('#run-detail .rd-page-head .rd-page-meta'), null, 'the title meta line is gone');
  ctx.dispatch({ type: 'state', runId: 'r3', status: 'running', steps: [], active: [] });   // a repaint
  await ctx.settle();
  assert.equal(doc.querySelector('#run-detail .rd-page-head .kind-chip'), null, 'still no chip after a repaint');
});

test('a member run in the Chat run panel keeps no breadcrumb, no Group row and no kind chip', async () => {
  const ctx = await bootChat({ arms: (url) => (url.startsWith('/api/run-groups') ? ok(GROUPS) : null) });
  applyLevel('advanced', ctx.window.document);   // in no group the row would offer "Add to group…": hidden means found
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  assert.equal(screen.dataset.presentation, 'panel');
  assert.equal(screen.querySelector('.rd-glance').hidden, true, 'the panel never shows the glance (Details only)');
  assert.equal(screen.querySelector('.rd-page-head .kind-chip'), null, 'no kind chip');
  const g = screen.querySelector('.rd-kv [data-fact="group"]');
  assert.equal(g.hidden, true, 'no Group row in the panel either');
  assert.equal(g.querySelector('.rd-group-add'), null, 'the groups are loaded: no Add to group…');
  const nav = screen.querySelector('.rd-bar .rd-crumbs');
  assert.equal(nav.hidden, true);
  assert.equal(nav.querySelectorAll('.rd-crumb').length, 0);
  applyLevel('expert', ctx.window.document);
});

test('a run in no group shows "Add to group…" at Advanced, which opens the picker; Simple hides the row', async () => {
  const ctx = await bootApp({ fetchHandler: handler({ groups: [] }) });
  const doc = ctx.window.document;
  applyLevel('advanced', doc);
  helloRun(ctx, { runId: 'r9', pipelineId: 'p9' });
  ctx.go('running/r9');
  await ctx.settle(4);
  const b = doc.querySelector('#run-detail .rd-kv [data-fact="group"] .rd-group-add');
  assert.equal(b.textContent, 'Add to group…');
  b.click();
  await ctx.settle();
  assert.ok(doc.querySelector('.group-picker'), 'the slice-3 picker opened');
  applyLevel('simple', doc);
  ctx.dispatch({ type: 'state', runId: 'r9', status: 'running', steps: [], active: [] });   // a repaint
  await ctx.settle();
  assert.equal(doc.querySelector('#run-detail .rd-kv [data-fact="group"]').hidden, true, 'below Advanced the row is hidden');
  assert.equal(doc.querySelector('#run-detail .rd-page-head .kind-chip'), null, 'a single run has no chip');
  assert.equal(doc.querySelector('#run-detail .rd-bar .rd-crumbs').hidden, true, 'a single run has no breadcrumb');
  applyLevel('expert', doc);
});

test('the finished page has no Group row and no kind chip: its breadcrumb links the group', async () => {
  const groups = { groups: [{ ...GROUPS.groups[0], planning: null,
    members: GROUPS.groups[0].members.map((m, i) => (i === 1 ? { ...m, pipelineId: ROW.id } : m)) }] };
  const ctx = await bootDetail({ arms: (url) => (url.startsWith('/api/run-groups') ? ok(groups) : null) });
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  await settle(ctx.window, 4);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const row = ctx.window.document.querySelector('#hist-detail .hd-glance .rd-kv [data-fact="group"]');
  assert.equal(row.hidden, true, 'no Group row: the breadcrumb links the group');
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-glance .rd-page-head .kind-chip'), null, 'no kind chip');
  assert.deepEqual([...ctx.window.document.querySelectorAll('#hist-detail .hd-bar .rd-crumbs .rd-crumb')].map(text), ['Runs', 'Run tags', 'Run 2']);
});

const LONG = 'Implement the run page head so that a very long run title stays on one line and is cut with an ellipsis where the column ends';

test('a long title keeps its full text in the h1 and its title attribute (the cut is CSS only)', async () => {
  const ctx = await bootApp({ fetchHandler: handler({ groups: [] }) });
  helloRun(ctx, { runId: 'r7', pipelineId: 'p7', title: LONG });
  ctx.go('running/r7');
  await ctx.settle(4);
  const h = ctx.window.document.querySelector('#run-detail .rd-glance .rd-page-title');
  assert.equal(h.textContent, LONG);
  assert.equal(h.title, LONG);
  const d = await bootDetail({ rows: [{ ...ROW, title: LONG }], detail: { ...DETAIL, state: { ...DETAIL.state, title: LONG } },
    arms: (url) => (url.startsWith('/api/run-groups') ? ok({ groups: [] }) : null) });
  d.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  await settle(d.window, 4);
  await openDetail(d, '');
  await settle(d.window, 6);
  const hh = d.window.document.querySelector('#hist-detail .hd-glance .rd-page-title');
  assert.equal(hh.textContent, LONG);
  assert.equal(hh.title, LONG);
});

test('s2: a feature run built on Run 1\'s branch reads "Merged into dev" in its route, never Run 1\'s branch', async () => {
  const PR915 = { state: 'MERGED', url: 'https://github.com/o/r/pull/915', number: 915 };
  const run1 = { ...ROW, id: 'p1', title: 'Slice 1', branch: 'feat/run-1', sourceBranch: 'dev', pr: PR915 };
  const run2 = { ...ROW, branch: 'feat/run-2', sourceBranch: 'feat/run-1', pr: PR915 };   // one PR for the feature
  const groups = { groups: [{ ...GROUPS.groups[0], planning: null, members: [
    { ...GROUPS.groups[0].members[0], pipelineId: 'p1', status: 'done', pr: PR915 },
    { ...GROUPS.groups[0].members[1], pipelineId: ROW.id, status: 'done', pr: PR915 }] }] };
  const ctx = await bootDetail({ rows: [run1, run2], arms: (url) => (url.startsWith('/api/run-groups') ? ok(groups) : null) });
  ctx.window.localStorage.removeItem('worca-cc.run.showRoute');   // start folded
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  await settle(ctx.window, 4);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const route = ctx.window.document.querySelector('#hist-detail .hd-glance .rd-route');
  assert.equal(text(route.querySelector('.rd-route-fold')), 'Merged into dev · o/r#915');
  route.querySelector('.rd-route-toggle').click();
  assert.equal(text(route.querySelector('ol .rd-route-row:last-child .rd-route-place')), 'dev');
  assert.ok(!route.textContent.includes('feat/run-1'), 'Run 1\'s branch appears nowhere in the route');
  assert.ok(!ctx.window.document.querySelector('#hist-detail .hd-glance .run-status').textContent.includes('feat/run-1'));
});
