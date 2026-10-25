// worca Chat P4: hops and controls INSIDE a panel screen keep to the panel. A graph footer row opens
// Logs on the panel's own address (live and saved); the Actions pill and the Overview's Actions strip open
// Actions in place; the Overview's resume offers read the panel's Resume toggle, not the Runs page's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootChat, liveRun, hello, openPanel, screenOf, click, ok, KEY, ROW, TABS_DETAIL } from './helpers/chat-panel-boot.mjs';

// A running service of the run (the header's Actions pill) and a finished run's Actions model (the Overview strip).
const SVC = (runId) => [{
  instanceId: `act:${runId}:${KEY}:run`, runId, member: KEY, actionId: 'run', label: 'Run', kind: 'service',
  status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: Date.now(),
  histKey: KEY, workspaceId: null, runTitle: 'Log UX',
}];
const svcArms = (runId) => (url) => (url.endsWith('/api/actions/running') ? ok(SVC(runId)) : null);
const ACT_MODEL = {
  runId: ROW.id, workspace: false, finished: true, enabled: true,
  members: [{ projectKey: KEY, projectName: 'Alpha', branch: ROW.branch, checkout: null, actions: [], builtins: [] }],
  instances: [], stacks: [], stackStates: [],
};

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

test('the saved Overview Actions strip "Open tab ›" opens Actions inside the panel', async () => {
  const arms = (url) => (url.includes(`/api/runs/${ROW.id}/actions?`) ? ok(ACT_MODEL) : null);
  const ctx = await bootChat({ rows: [ROW], arms });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, `${ROW.id}/overview`, 10);
  const strip = screen.querySelector('.hd-sec[data-sec="overview"] .act-strip');
  assert.ok(strip, 'the strip is mounted');
  const open = [...strip.querySelectorAll('button')].find((b) => b.textContent === 'Open tab ›');
  assert.ok(open);
  click(ctx, open);
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}/actions`);
  assert.equal(screenOf(ctx), screen);
});

test('the live Overview Actions strip "Open tab ›" opens Actions inside the panel', async () => {
  const model = { ...ACT_MODEL, runId: 'p1' };
  const arms = (url) => (url.includes('/api/runs/p1/actions?') ? ok(model) : null);
  const ctx = await bootChat({ arms });
  hello(ctx, [liveRun({ status: 'done' })]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/overview', 10);
  assert.ok(screen && screen.classList.contains('rd'));
  const strip = screen.querySelector('.rd-sec[data-sec="overview"] .act-strip');
  assert.ok(strip && !strip.hidden, 'the strip is mounted');
  const open = [...strip.querySelectorAll('button')].find((b) => b.textContent === 'Open tab ›');
  assert.ok(open);
  click(ctx, open);
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/actions');
  assert.equal(screenOf(ctx), screen);
});

test('Runs page: a glance row opens its tab as a NEW history entry (Back walks it back to Summary), live and saved', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, [liveRun({ status: 'done' }), liveRun({ runId: 'r5', pipelineId: 'p5', title: 'Going' })]);
  await ctx.settle(6);
  ctx.go(`history/${KEY}/${ROW.id}`);
  await ctx.settle(8);
  const hd = ctx.window.document.querySelector('#hist-detail .hd');
  const before = ctx.window.history.length;
  click(ctx, hd.querySelector('.hd-result [data-rd-tab="diff"]'));
  await ctx.settle(4);
  assert.equal(ctx.window.location.hash, `#history/${KEY}/${ROW.id}/diff`);
  assert.equal(ctx.window.history.length, before + 1, 'saved: pushed, not replaced');
  ctx.window.history.back();                                 // browser Back: Summary again
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, `#history/${KEY}/${ROW.id}`);
  assert.ok(hd.querySelector('.hd-tab[data-sec="overview"]').classList.contains('active'));
  assert.equal(hd.querySelector('.hd-to-run'), null, 'no ‹ Run: the tabs are the way');
  ctx.go('running/r5');
  await ctx.settle(8);
  const rd = ctx.window.document.querySelector('#run-detail .rd');
  const before2 = ctx.window.history.length;
  click(ctx, rd.querySelector('[data-rd-tab]:not([data-rd-tab="overview"])'));   // Summary is the page itself
  await ctx.settle(4);
  assert.match(ctx.window.location.hash, /^#running\/r5\/[a-z]+$/);
  assert.doesNotMatch(ctx.window.location.hash, /\/details\//);
  assert.equal(ctx.window.history.length, before2 + 1, 'live: pushed, not replaced');
});
