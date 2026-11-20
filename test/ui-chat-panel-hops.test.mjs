// worca Chat P4: hops and controls INSIDE a panel screen keep to the panel. A graph footer row opens
// Logs on the panel's own address (live and saved); the Actions pill opens Actions in place (the Overview has
// no Actions strip any more: one-level run page); the Overview's resume offers read the panel's Resume toggle, not the Runs page's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootChat, liveRun, hello, openPanel, screenOf, click, ok, KEY, ROW, TABS_DETAIL } from './helpers/chat-panel-boot.mjs';

// A running service of the run (the header's Actions pill).
const SVC = (runId) => [{
  instanceId: `act:${runId}:${KEY}:run`, runId, member: KEY, actionId: 'run', label: 'Run', kind: 'service',
  status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: Date.now(),
  histKey: KEY, workspaceId: null, runTitle: 'Log UX',
}];
const svcArms = (runId) => (url) => (url.endsWith('/api/actions/running') ? ok(SVC(runId)) : null);
test("a graph footer row on the live screen narrows the log and opens Logs on the panel's address", async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  ctx.window.__np.focusLogExecution({ run: ctx.window.__np.getRun('r1') }, 'x:plan:1', 'plan');
  await ctx.settle();
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/logs');
  assert.equal(screen.querySelector('.rd-tab.active').dataset.sec, 'logs');
  assert.equal(ctx.window.__np.getRun('r1').logFilter.execution, 'x:plan:1');
});

test("a graph footer row on the saved screen opens Logs on the panel's address", async () => {
  const ctx = await bootChat({ rows: [ROW], detail: TABS_DETAIL });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  ctx.window.__np.focusLogExecution({ run: {}, record: ROW }, 'x:plan:1', 'plan');
  await ctx.settle();
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}/logs`);
  assert.equal(screen.querySelector('.hd-tab.active').dataset.sec, 'logs');
});

test('"Resume with another model…" on Overview reads the panel\'s Resume toggle: while it is busy, nothing starts', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused', pauseReason: 'usage_limit' })]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/overview');
  const offer = screen.querySelector('.rd-ov-model');
  assert.ok(offer, 'a usage-limit pause offers another model');
  screen.querySelector('.rd-pause').disabled = true;   // a resume already in flight (C16)
  const configCalls = () => ctx.calls.filter((c) => c.url.split('?')[0].endsWith('/api/config')).length;
  const before = configCalls();
  click(ctx, offer);
  await ctx.settle();
  assert.equal(configCalls(), before, 'no model picker: the in-flight resume owns the run');
});

test('the saved header Actions pill opens Actions inside the panel, in place', async () => {
  const ctx = await bootChat({ rows: [ROW], arms: svcArms(ROW.id) });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  ctx.dispatch({ type: 'actions-changed', action: 'start' });
  await ctx.settle(4);
  const pill = screen.querySelector('.hd-row1 .act-pill');
  assert.ok(pill, 'the running-service pill');
  const before = ctx.window.history.length;
  click(ctx, pill);
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}/actions`);
  assert.equal(ctx.window.history.length, before);
  assert.equal(screenOf(ctx), screen);
  assert.equal(screen.querySelector('.hd-tab.active').dataset.sec, 'actions');
});

test('the live header Actions pill opens Actions inside the panel, in place', async () => {
  const ctx = await bootChat({ arms: svcArms('p1') });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  ctx.dispatch({ type: 'actions-changed', action: 'start' });
  await ctx.settle(4);
  const pill = screen.querySelector('.rd-row1 .act-pill');
  assert.ok(pill, 'the running-service pill');
  const before = ctx.window.history.length;
  click(ctx, pill);
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/actions');
  assert.equal(ctx.window.history.length, before);
  assert.equal(screenOf(ctx), screen);
  assert.equal(screen.querySelector('.rd-tab.active').dataset.sec, 'actions');
});
