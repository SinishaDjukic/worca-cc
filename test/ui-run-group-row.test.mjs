// test/ui-run-group-row.test.mjs — runs redesign slice 4 (D18), run 3 (D6-D8): a single run's page says which group it
// belongs to in its facts block (Feature: "Run tags · run 3 of 3", linking the group page), its kind chip reads
// "Run 3 of 3" and its bar's breadcrumb "Runs › Run tags › Run 3"; or it offers "Add to group…" at Advanced and above.
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

test('a member run\'s page says "Feature: Run tags · run 3 of 3", links the group page, and names its place', async () => {
  const ctx = await bootApp({ fetchHandler: handler(GROUPS) });
  helloRun(ctx, { runId: 'r3', pipelineId: 'p3' });
  ctx.go('running/r3');
  await ctx.settle(4);
  const kv = ctx.window.document.querySelector('#run-detail .rd-sheet .rd-kv');
  const g = kv.querySelector('[data-fact="group"]');
  assert.equal(g.hidden, false);
  assert.equal(g.querySelector('.rd-kv-k').textContent, 'Feature');
  assert.equal(text(g.querySelector('.rd-kv-v')), 'Run tags · run 3 of 3');
  assert.equal(g.querySelector('a.rd-group-link').getAttribute('href'), '#feature/feat_1');
  assert.deepEqual([...g.querySelector('.rd-kv-v').children].map((c) => c.className), ['rd-group-link', 'rd-group-pos']);
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-title-row .kind-chip').textContent, 'Run 3 of 3');
  assert.deepEqual([...ctx.window.document.querySelectorAll('#run-detail .rd-bar .rd-crumbs .rd-crumb')].map(text), ['Runs', 'Run tags', 'Run 3']);
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-page-head .rd-page-meta'), null, 'the title meta line is gone');
  ctx.dispatch({ type: 'state', runId: 'r3', status: 'running', steps: [], active: [] });   // a repaint
  await ctx.settle();
  assert.equal(ctx.window.document.querySelectorAll('#run-detail .rd-group-line a').length, 1, 'never duplicated');
});

test('a member run in the Chat run panel keeps no breadcrumb (its "Runs" crumb would leave Chat)', async () => {
  const ctx = await bootChat({ arms: (url) => (url.startsWith('/api/run-groups') ? ok(GROUPS) : null) });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  assert.equal(screen.dataset.presentation, 'panel');
  assert.equal(screen.querySelector('.rd-title-row .kind-chip').textContent, 'Run 1 of 3', 'the groups are loaded');
  const nav = screen.querySelector('.rd-bar .rd-crumbs');
  assert.equal(nav.hidden, true);
  assert.equal(nav.querySelectorAll('.rd-crumb').length, 0);
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
  assert.equal(doc.querySelector('#run-detail .rd-bar .rd-crumbs').hidden, true, 'a single run has no breadcrumb');
  applyLevel('expert', doc);
});

test('the finished page shows the Group row under its glance', async () => {
  const groups = { groups: [{ ...GROUPS.groups[0], planning: null,
    members: GROUPS.groups[0].members.map((m, i) => (i === 1 ? { ...m, pipelineId: ROW.id } : m)) }] };
  const ctx = await bootDetail({ arms: (url) => (url.startsWith('/api/run-groups') ? ok(groups) : null) });
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  await settle(ctx.window, 4);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const row = ctx.window.document.querySelector('#hist-detail .hd-glance .rd-kv [data-fact="group"]');
  assert.equal(row.hidden, false);
  assert.equal(row.querySelector('.rd-kv-k').textContent, 'Feature');
  assert.equal(text(row.querySelector('.rd-kv-v')), 'Run tags · run 2 of 3');
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-glance .rd-title-row .kind-chip').textContent, 'Run 2 of 3');
  assert.deepEqual([...ctx.window.document.querySelectorAll('#hist-detail .hd-bar .rd-crumbs .rd-crumb')].map(text), ['Runs', 'Run tags', 'Run 2']);
});
