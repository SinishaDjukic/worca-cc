// test/ui-run-group-row.test.mjs — runs redesign slice 4 (D18), run 3 (D6-D8): a single run's kind chip says which
// group it belongs to ("Run 3 of 3", a link to the group page) and the top bar's breadcrumb "Runs › Run tags"; its
// facts block has no group row then. A run in no group offers "Add to group…" there at Advanced and above.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, settle, ok, ROW } from './helpers/history-detail-boot.mjs';
import { bootChat, liveRun, hello, openPanel } from './helpers/chat-panel-boot.mjs';
import { applyLevel } from '../ui/public/ui-level.mjs';

const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
const GROUPS = { groups: [{ id: 'feat_1', kind: 'feature', title: 'Run tags', projectKey: null,
  planning: { pipelineId: 'p0', title: 'Planning', status: 'done' },
  members: [1, 2, 3].map((i) => ({ position: i, title: `Slice ${i}`, pipelineId: `p${i}`, ticketId: null, status: i < 3 ? 'done' : 'running', pr: null, ticket: null, adhoc: false, after: null })),
  cost: { usd: 0, byPipeline: {} } }] };
const handler = (groups) => (url) => (url.startsWith('/api/run-groups') ? json(groups) : null);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const trail = (doc) => [...doc.querySelectorAll('#topnav-crumbs .nav-trail a')].map(text);

test('a member run\'s page has no Feature row; its kind chip "Run 3 of 3" links the group page', async () => {
  const ctx = await bootApp({ fetchHandler: handler(GROUPS) });
  helloRun(ctx, { runId: 'r3', pipelineId: 'p3' });
  ctx.go('running/r3');
  await ctx.settle(4);
  const doc = ctx.window.document;
  const g = doc.querySelector('#run-detail .rd-sheet .rd-kv [data-fact="group"]');
  assert.equal(g.hidden, true, 'the chip says it: no second Feature row');
  assert.equal(g.querySelector('.rd-kv-v').children.length, 0);
  assert.equal(doc.querySelector('#run-detail .rd-group-link'), null);
  assert.equal(doc.querySelector('#run-detail .rd-group-pos'), null);
  const chip = doc.querySelector('#run-detail .rd-title-row .kind-chip');
  assert.equal(chip.tagName, 'A');
  assert.equal(chip.getAttribute('href'), '#feature/feat_1');
  assert.equal(chip.textContent, 'Run 3 of 3', 'the › is CSS, not text');
  assert.match(chip.getAttribute('aria-label'), /^Run 3 of 3, open feature Run tags$/);
  assert.deepEqual(trail(doc), ['Runs', 'Run tags'], 'the trail ends at the parent: the run itself is the h1');
  assert.equal(doc.querySelector('#run-detail .rd-crumbs'), null, 'no in-page breadcrumb');
  assert.equal(doc.querySelector('#run-detail .rd-page-head .rd-page-meta'), null, 'the title meta line is gone');
  ctx.dispatch({ type: 'state', runId: 'r3', status: 'running', steps: [], active: [] });   // a repaint
  await ctx.settle();
  assert.equal(doc.querySelectorAll('#run-detail .rd-title-row .kind-chip').length, 1, 'never duplicated');
  assert.equal(doc.querySelector('#run-detail .rd-title-row .kind-chip').tagName, 'A');
});

test('a member run in the Chat run panel keeps no breadcrumb; its screen carries the same chip link', async () => {
  const ctx = await bootChat({ arms: (url) => (url.startsWith('/api/run-groups') ? ok(GROUPS) : null) });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  assert.equal(screen.dataset.presentation, 'panel');
  assert.equal(screen.querySelector('.rd-title-row .kind-chip').textContent, 'Run 1 of 3', 'the groups are loaded');
  // The panel shows Details only; its screen's chip is the same link.
  assert.equal(screen.querySelector('.rd-glance').hidden, true, 'the panel never shows the glance (Details only)');
  const chip = screen.querySelector('.rd-title-row .kind-chip');
  assert.equal(chip.tagName, 'A', 'the same chip link as on the page');
  assert.equal(chip.getAttribute('href'), '#feature/feat_1');
  assert.equal(chip.textContent, 'Run 1 of 3', 'the › is CSS');
  const g = screen.querySelector('.rd-kv [data-fact="group"]');
  assert.equal(g.hidden, true, 'no Feature row in the panel either');
  assert.equal(screen.querySelector('.rd-crumbs'), null, 'no in-page breadcrumb');
  assert.equal(screen.querySelector('.ph'), null, 'the panel has no page head');
  assert.equal(ctx.window.document.getElementById('topnav-crumbs').hidden, true, 'Chat shows no trail');
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
  assert.equal(doc.querySelector('#run-detail .rd-title-row .kind-chip').textContent, 'Run', 'a single run\'s chip');
  assert.equal(doc.querySelector('#run-detail .rd-title-row .kind-chip').tagName, 'SPAN');
  assert.deepEqual(trail(doc), ['Runs'], 'a single run\'s parent is the Runs list');
  applyLevel('expert', doc);
});

test('the finished page has no Group row: its kind chip links the group', async () => {
  const groups = { groups: [{ ...GROUPS.groups[0], planning: null,
    members: GROUPS.groups[0].members.map((m, i) => (i === 1 ? { ...m, pipelineId: ROW.id } : m)) }] };
  const ctx = await bootDetail({ arms: (url) => (url.startsWith('/api/run-groups') ? ok(groups) : null) });
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  await settle(ctx.window, 4);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const row = ctx.window.document.querySelector('#hist-detail .hd-glance .rd-kv [data-fact="group"]');
  assert.equal(row.hidden, true, 'no Feature row: the chip links the group');
  const chip = ctx.window.document.querySelector('#hist-detail .rd-title-row .kind-chip');
  assert.equal(chip.textContent, 'Run 2 of 3');
  assert.equal(chip.getAttribute('href'), '#feature/feat_1');
  assert.deepEqual(trail(ctx.window.document), ['Runs', 'Run tags']);
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
