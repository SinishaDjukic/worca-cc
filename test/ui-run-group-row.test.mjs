// test/ui-run-group-row.test.mjs — runs redesign slice 4 (D18): a single run's page says which group it belongs to
// ("Part of Run tags · run 3 of 3", linking the group page), or offers "Add to group…" at Advanced and above.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, settle, ok, ROW } from './helpers/history-detail-boot.mjs';
import { applyLevel } from '../ui/public/ui-level.mjs';

const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
const GROUPS = { groups: [{ id: 'feat_1', kind: 'feature', title: 'Run tags', projectKey: null,
  planning: { pipelineId: 'p0', title: 'Planning', status: 'done' },
  members: [1, 2, 3].map((i) => ({ position: i, title: `Slice ${i}`, pipelineId: `p${i}`, ticketId: null, status: i < 3 ? 'done' : 'running', pr: null, ticket: null, adhoc: false, after: null })),
  cost: { usd: 0, byPipeline: {} } }] };
const handler = (groups) => (url) => (url.startsWith('/api/run-groups') ? json(groups) : null);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

test('a member run\'s page says "Part of Run tags · run 3 of 3" and links the group page', async () => {
  const ctx = await bootApp({ fetchHandler: handler(GROUPS) });
  helloRun(ctx, { runId: 'r3', pipelineId: 'p3' });
  ctx.go('running/r3');
  await ctx.settle(4);
  const line = ctx.window.document.querySelector('#run-detail .rd-page-head .rd-group-line');
  assert.equal(line.hidden, false);
  assert.equal(text(line), 'Group Part of Run tags · run 3 of 3');
  assert.equal(line.querySelector('a.rd-group-link').getAttribute('href'), '#feature/feat_1');
  // QA 8: spans CSS can stack on a phone: the label, "Part of …", the separator, then "run 3 of 3".
  assert.deepEqual([...line.children].map((c) => c.className), ['rd-group-k', 'rd-group-of', 'rd-group-sep', 'rd-group-pos']);
  assert.equal(line.querySelector('.rd-group-pos').textContent, 'run 3 of 3');
  ctx.dispatch({ type: 'state', runId: 'r3', status: 'running', steps: [], active: [] });   // a repaint
  await ctx.settle();
  assert.equal(ctx.window.document.querySelectorAll('#run-detail .rd-group-line a').length, 1, 'never duplicated');
});

test('a run in no group shows "Add to group…" at Advanced, which opens the picker; Simple hides the row', async () => {
  const ctx = await bootApp({ fetchHandler: handler({ groups: [] }) });
  const doc = ctx.window.document;
  applyLevel('advanced', doc);
  helloRun(ctx, { runId: 'r9', pipelineId: 'p9' });
  ctx.go('running/r9');
  await ctx.settle(4);
  const b = doc.querySelector('#run-detail .rd-group-line .rd-group-add');
  assert.equal(b.textContent, 'Add to group…');
  b.click();
  await ctx.settle();
  assert.ok(doc.querySelector('.group-picker'), 'the slice-3 picker opened');
  applyLevel('simple', doc);
  ctx.dispatch({ type: 'state', runId: 'r9', status: 'running', steps: [], active: [] });   // a repaint
  await ctx.settle();
  assert.equal(doc.querySelector('#run-detail .rd-group-line').hidden, true, 'below Advanced the row is hidden');
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
  const line = ctx.window.document.querySelector('#hist-detail .hd-glance .rd-group-line');
  assert.equal(line.hidden, false);
  assert.equal(text(line), 'Group Part of Run tags · run 2 of 3');
});
