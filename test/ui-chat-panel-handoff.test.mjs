// worca Chat P4: the run panel keeps a run's life inside Chat. A finished live run becomes its saved run
// in place (same tab, Q&A → clarify, address replaced); Resume follows the resumed run instead of
// opening the Runs page; a paused saved run stopped from the panel re-reads itself there; Archive closes
// the panel instead of opening the Runs list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDialog } from './helpers/confirm-modal.mjs';
import {
  bootChat, liveRun, hello, openPanel, panelOf, screenOf, click, detailLoads, ok, KEY, ROW, DETAIL, TABS_DETAIL, PAUSED_DETAIL, PROJECT_DIR,
} from './helpers/chat-panel-boot.mjs';

test('a live run that finishes hands off to its saved run inside the panel, on the same tab, in place', async () => {
  const ctx = await bootChat({ rows: [], detail: TABS_DETAIL });
  hello(ctx, [liveRun({ pipelineId: ROW.id })]);
  await ctx.settle(6);
  await openPanel(ctx, 'r1/qa');
  const before = ctx.window.history.length;
  ctx.dispatch({ type: 'state', runId: 'r1', id: ROW.id, status: 'done' });
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'done' });
  await ctx.settle(6);
  assert.ok(screenOf(ctx).classList.contains('rd'), 'no saved row yet: the live screen stays');
  ctx.box.rows = [ROW];
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(10);
  const screen = screenOf(ctx);
  assert.ok(screen && screen.classList.contains('hd'), 'the saved screen took over');
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}/clarify`);
  assert.equal(ctx.window.history.length, before, 'the address was replaced, not pushed');
  assert.equal(screen.querySelector('.hd-tab.active').dataset.sec, 'clarify');
  assert.equal(ctx.window.__np.rdOpenRun(), null);
  assert.equal(ctx.window.document.querySelectorAll('.rd').length, 0);
  assert.ok(JSON.parse(ctx.window.localStorage.getItem('worca-cc.ackRuns') || '[]').includes('r1'), 'the finished live run is acknowledged');
});

test('Resume in the panel stays in Chat: the panel follows the resumed run', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle(6);
  const screen = await openPanel(ctx, 'r1');
  const toggle = screen.querySelector('.rd-pause');
  assert.equal(toggle.dataset.action, 'resume');
  click(ctx, toggle);
  await ctx.settle(8);
  assert.deepEqual(ctx.box.resumed.map((b) => b.pipelineId), ['p1']);
  assert.match(ctx.window.location.hash, /^#chat\/new\/run\/r2(\/overview)?$/);
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2');
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
  assert.equal(ctx.window.document.querySelector('#run-detail').children.length, 0);
});

// #792 / Q4: a resume started elsewhere (the scheduled usage-limit resume, another tab) only reaches this tab as a
// newer copy of the pipeline. The panel open on the paused run follows it in place, as its own Resume does.
test('a scheduled resume of the paused run open in the panel moves the panel to the new run, on the same tab', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle(6);
  await openPanel(ctx, 'r1/logs');
  ctx.dispatch({ type: 'run-created', runId: 'r2', title: 'Add dark mode', projectDir: PROJECT_DIR, kind: 'run', status: 'starting' });
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p1', status: 'running' });   // the first state names the pipeline
  await ctx.settle(8);
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2', 'the panel follows to the resumed run');
  assert.equal(ctx.window.location.hash, '#chat/new/run/r2/logs', 'still Chat; the panel address follows the new run');
  assert.equal(screenOf(ctx).querySelector('.rd-tab.active').dataset.sec, 'logs');
});

test("a resume from the chat run card (P3's navigate:false) never hops, but the open panel still follows the run", async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle(6);
  await openPanel(ctx, 'r1/logs');
  const btn = ctx.window.document.createElement('button');
  ctx.window.document.body.appendChild(btn);
  await ctx.window.__np.chatRunControls.resume({ runId: 'r1', pipelineId: 'p1' }, btn);
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r2/logs', 'still Chat; the panel address follows the new run');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2');
  assert.equal(screenOf(ctx).querySelector('.rd-tab.active').dataset.sec, 'logs');
});

test('a paused saved run stopped from the panel re-reads itself in the panel', async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  assert.equal(detailLoads(ctx), 1);
  click(ctx, screen.querySelector('.hd-stop'));
  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the Stop dialog asks first (R7)');
  click(ctx, modal.querySelector('.stop-confirm'));
  await ctx.settle(8);
  assert.equal(ctx.box.stops.length, 1);
  assert.equal(ctx.box.stops[0].pipelineId, ROW.id);
  assert.equal(detailLoads(ctx), 2, 'the panel re-read the run');
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
  assert.equal(ctx.window.document.querySelector('#hist-detail').children.length, 0);
});

test('Archive from the panel closes it (the run is gone) instead of opening the Runs list', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  click(ctx, screen.querySelector('.hd-archive'));
  await confirmDialog(ctx.window);
  await ctx.settle(8);
  assert.equal(ctx.box.deleted.length, 1);
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(ctx.window.location.hash, '#chat');
});

test("a run that finishes hands off once the done frame's own History reload lists its row (no pipelines-changed)", async () => {
  const ctx = await bootChat({ rows: [], detail: TABS_DETAIL });
  hello(ctx, [liveRun({ pipelineId: ROW.id })]);
  await ctx.settle(6);
  await openPanel(ctx, 'r1/logs');
  ctx.box.rows = [{ ...ROW, status: 'running', live: true }];   // the terminal state frame lands before the row is written
  ctx.dispatch({ type: 'state', runId: 'r1', id: ROW.id, status: 'done' });
  await ctx.settle(8);
  assert.ok(screenOf(ctx).classList.contains('rd'));
  ctx.box.rows = [ROW];                                         // written by the time `done` arrives
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'done' });
  await ctx.settle(10);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}/logs`);
});

test('Resume on the saved screen in the panel stays in Chat: the panel follows the resumed run, on the same tab', async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: { ...TABS_DETAIL, state: { ...TABS_DETAIL.state, status: 'paused' } } });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, `${ROW.id}/logs`, 8);
  assert.equal(screen.querySelector('.hd-tab.active').dataset.sec, 'logs');
  click(ctx, screen.querySelector('.hd-resume'));
  await ctx.settle(10);
  assert.deepEqual(ctx.box.resumed.map((b) => b.pipelineId), [ROW.id]);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r2/logs');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2');
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
  assert.equal(ctx.window.document.querySelector('#run-detail').children.length, 0);
});

test('a resume still in flight when the panel closes never leaves Chat', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const arms = (href) => (href.split('?')[0].endsWith('/api/resume') ? gate.then(() => ok({ runId: 'r2' })) : null);
  const ctx = await bootChat({ arms });
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle(6);
  const screen = await openPanel(ctx, 'r1');
  click(ctx, screen.querySelector('.rd-pause'));
  await ctx.settle();
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  release();
  await ctx.settle(10);
  assert.equal(ctx.window.location.hash, '#chat');
  assert.equal(panelOf(ctx).hidden, true);
});

test('a resume that lands after the panel moved to another run never leaves Chat, and the panel stays on that run', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const arms = (url) => (url.split('?')[0].endsWith('/api/resume') ? held.then(() => ok({ runId: 'r9' })) : null);
  const ctx = await bootChat({ arms });
  hello(ctx, [liveRun({ status: 'paused' }), liveRun({ runId: 'r2', pipelineId: 'p2', title: 'Second' })]);
  await ctx.settle(6);
  const screen = await openPanel(ctx, 'r1');
  click(ctx, screen.querySelector('.rd-pause'));
  await ctx.settle();
  await openPanel(ctx, 'r2');
  release();
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r2');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2');
});

test("resuming ANOTHER run from its chat card leaves the panel on its own run", async () => {
  const arms = (url) => (url.split('?')[0].endsWith('/api/resume') ? ok({ runId: 'r9' }) : null);
  const ctx = await bootChat({ arms });
  hello(ctx, [liveRun(), liveRun({ runId: 'r2', pipelineId: 'p2', title: 'Second', status: 'paused' })]);
  await ctx.settle(6);
  await openPanel(ctx, 'r1');
  const btn = ctx.window.document.createElement('button');
  ctx.window.document.body.appendChild(btn);
  await ctx.window.__np.chatRunControls.resume({ runId: 'r2', pipelineId: 'p2' }, btn);
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r1');
});

test('a chat card resume that lands after the user left Chat never hops to the run page', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const arms = (url) => (url.split('?')[0].endsWith('/api/resume') ? held.then(() => ok({ runId: 'r9' })) : null);
  const ctx = await bootChat({ arms });
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  const btn = ctx.window.document.createElement('button');
  ctx.window.document.body.appendChild(btn);
  const done = ctx.window.__np.chatRunControls.resume({ runId: 'r1', pipelineId: 'p1' }, btn);
  ctx.go('runs');
  await ctx.settle(4);
  release();
  await done;
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#runs');
});

test('a paused saved run stopped from the panel re-reads itself on the same tab', async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: { ...TABS_DETAIL, state: { ...TABS_DETAIL.state, status: 'paused' } } });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, `${ROW.id}/diff`, 8);
  click(ctx, screen.querySelector('.hd-stop'));
  click(ctx, ctx.window.document.querySelector('#stop-modal .stop-confirm'));
  await ctx.settle(8);
  assert.equal(detailLoads(ctx), 2);
  assert.equal(screenOf(ctx).querySelector('.hd-tab.active').dataset.sec, 'diff');
});

test("the panel re-reading its saved run leaves another run's Stop dialog up (a chat card's)", async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  hello(ctx, [liveRun({ runId: 'r3', pipelineId: 'p3', title: 'Third' })]);
  await ctx.settle(6);
  await openPanel(ctx, ROW.id, 8);
  const modal = ctx.window.document.getElementById('stop-modal');
  ctx.window.__np.openStopModal({ runId: 'r3' });   // e.g. from r3's chat run card
  assert.equal(modal.classList.contains('hidden'), false);
  ctx.box.rows = [{ ...ROW, status: 'stopped' }];   // another tab / the CLI stopped the panel's run
  ctx.box.detail = { ...DETAIL, state: { ...DETAIL.state, status: 'stopped' } };
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(12);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
  assert.equal(detailLoads(ctx), 2, 'the panel re-read its run');
  assert.equal(modal.classList.contains('hidden'), false, "r3's Stop dialog stays up");
  assert.equal(modal.dataset.runId, 'r3');
});

test('a hand-off in the panel leaves a Ship it dialog opened from a chat card for ANOTHER run alone', async () => {
  const X = { ...ROW, id: 'aaaa0001', title: 'Other finished run', pr: null };
  const XDETAIL = { ...DETAIL, state: { ...DETAIL.state, id: X.id, title: X.title } };
  const arms = (href, opts, box) => {
    const path = href.split('?')[0];
    if (path.endsWith('/api/history') && !href.includes('archived')) return ok({ pipelines: box.rows, ghAvailable: true });
    if (path.endsWith(`/api/history/${KEY}/${X.id}`)) return ok(XDETAIL);
    return null;
  };
  const ctx = await bootChat({ rows: [X], arms });
  hello(ctx, [liveRun({ pipelineId: ROW.id })]);
  await ctx.settle(6);
  await openPanel(ctx, 'r1');
  const modal = ctx.window.document.getElementById('shipit-modal');
  let settled = null;
  void ctx.window.__np.chat.deps.openShipIt({ pipelineId: X.id, projectKey: KEY }).then((v) => { settled = v; });
  await ctx.settle(10);
  assert.equal(modal.classList.contains('hidden'), false, 'precondition: Ship it is open for X');
  ctx.dispatch({ type: 'state', runId: 'r1', id: ROW.id, status: 'done' });
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'done' });
  await ctx.settle(6);
  ctx.box.rows = [X, ROW];
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(12);
  assert.ok(screenOf(ctx).classList.contains('hd'), 'precondition: the hand-off happened');
  assert.equal(modal.classList.contains('hidden'), false, "X's Ship it dialog stays up");
  assert.equal(settled, null, 'the chat card is not told "not opened"');
});

test("swapping the panel's saved run leaves a Ship it dialog a chat card opened for ANOTHER run alone", async () => {
  const X = { ...ROW, id: 'aaaa0001', title: 'Other finished run', pr: null };
  const XDETAIL = { ...DETAIL, state: { ...DETAIL.state, id: X.id, title: X.title } };
  const arms = (href, opts, box) => {
    const path = href.split('?')[0];
    if (path.endsWith('/api/history') && !href.includes('archived')) return ok({ pipelines: box.rows, ghAvailable: true });
    if (path.endsWith(`/api/history/${KEY}/${X.id}`)) return ok(XDETAIL);
    return null;
  };
  const ctx = await bootChat({ rows: [X, ROW], arms });
  hello(ctx, [liveRun()]);
  await ctx.settle(6);
  await openPanel(ctx, ROW.id, 8);
  assert.ok(screenOf(ctx).classList.contains('hd'));
  const modal = ctx.window.document.getElementById('shipit-modal');
  void ctx.window.__np.chat.deps.openShipIt({ pipelineId: X.id, projectKey: KEY });
  await ctx.settle(10);
  assert.equal(modal.classList.contains('hidden'), false, 'precondition: Ship it is open for X');
  await openPanel(ctx, 'r1');                         // the panel swaps its saved run for a live one
  assert.ok(screenOf(ctx).classList.contains('rd'));
  assert.equal(modal.classList.contains('hidden'), false, "X's Ship it dialog stays up");
});

test('Archive in flight, then Close: Chat never jumps to the Runs list when the DELETE lands', async () => {
  let release = null;
  const arms = (href, opts) => {
    if (opts && opts.method === 'DELETE' && href.includes('/api/runs/')) return new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ ok: true }) }); });
    return null;
  };
  const ctx = await bootChat({ rows: [ROW], arms });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  click(ctx, screen.querySelector('.hd-archive'));
  await confirmDialog(ctx.window);
  await ctx.settle(4);
  assert.ok(release, 'precondition: the DELETE is in flight');
  click(ctx, screen.querySelector('.crp-close'));   // the user closes the panel meanwhile
  await ctx.settle();
  assert.equal(ctx.window.location.hash, '#chat');
  release();
  await ctx.settle(10);
  assert.equal(ctx.window.location.hash, '#chat', 'still on Chat');
});

test('Restore from the panel keeps the run open there, re-read and restored', async () => {
  const archivedDetail = { ...DETAIL, state: { ...DETAIL.state, archivedAt: '2026-09-01T00:00:00Z' } };
  const arms = (href, opts, box) => {
    if (href.split('?')[0].endsWith('/restore')) { box.detail = DETAIL; box.rows = [ROW]; return ok({ ok: true }); }
    return null;
  };
  const ctx = await bootChat({ rows: [{ ...ROW, archivedAt: '2026-09-01T00:00:00Z' }], detail: archivedDetail, arms });
  hello(ctx, []);
  await ctx.settle(6);
  await openPanel(ctx, ROW.id, 10);
  const loads = detailLoads(ctx);
  click(ctx, screenOf(ctx).querySelector('.hd-restore'));
  await confirmDialog(ctx.window);
  await ctx.settle(12);
  assert.equal(panelOf(ctx).hidden, false);
  assert.ok(screenOf(ctx).classList.contains('hd'));
  assert.ok(detailLoads(ctx) > loads, 're-read');
  assert.equal(screenOf(ctx).querySelector('.hd-restore').hidden, true, 'restored');
  assert.equal(ctx.window.document.querySelector('#hist-detail').children.length, 0);
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}`);
});

test('a resume follow or a hand-off that replaces the screen holding focus keeps focus in the panel, never <body>', async () => {
  const ctx = await bootChat({ rows: [], detail: TABS_DETAIL });
  hello(ctx, [liveRun({ pipelineId: ROW.id, status: 'paused' })]);
  await ctx.settle(6);
  const live = await openPanel(ctx, 'r1/logs');
  const toggle = live.querySelector('.rd-pause');
  toggle.focus();
  click(ctx, toggle);                                       // Resume: the panel follows r2
  await ctx.settle(8);
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2');
  assert.equal(ctx.window.document.activeElement, panelOf(ctx), 'the resume follow keeps focus in the panel');
  screenOf(ctx).querySelector('.rd-tab[data-sec="logs"]').focus();
  ctx.dispatch({ type: 'state', runId: 'r2', id: ROW.id, status: 'done' });
  ctx.dispatch({ type: 'done', runId: 'r2', status: 'done' });
  await ctx.settle(6);
  ctx.box.rows = [ROW];
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(10);
  assert.ok(screenOf(ctx).classList.contains('hd'), 'handed off to the saved run');
  assert.equal(ctx.window.document.activeElement, panelOf(ctx), 'the hand-off keeps focus in the panel');
});

test('a hand-off never pulls focus out of the chat composer', async () => {
  const ctx = await bootChat({ rows: [], detail: TABS_DETAIL });
  hello(ctx, [liveRun({ pipelineId: ROW.id })]);
  await ctx.settle(6);
  await openPanel(ctx, 'r1');
  const input = ctx.window.document.querySelector('[data-chat-page] textarea.ask-input');
  input.focus();
  ctx.dispatch({ type: 'state', runId: 'r1', id: ROW.id, status: 'done' });
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'done' });
  await ctx.settle(6);
  ctx.box.rows = [ROW];
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(10);
  assert.ok(screenOf(ctx).classList.contains('hd'));
  assert.equal(ctx.window.document.activeElement, input);
});

test("the panel re-reading its saved run leaves up a Stop dialog a chat card opened for ANOTHER paused run by its pipeline id", async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  hello(ctx, []);
  await ctx.settle(6);
  await openPanel(ctx, ROW.id, 8);
  const modal = ctx.window.document.getElementById('stop-modal');
  ctx.window.__np.openStopModal({ pipelineId: 'p9', title: 'Other paused run' });   // a chat card's: no run in this tab
  assert.equal(modal.classList.contains('hidden'), false);
  ctx.box.rows = [{ ...ROW, status: 'stopped' }];   // another tab / the CLI stopped the panel's run
  ctx.box.detail = { ...DETAIL, state: { ...DETAIL.state, status: 'stopped' } };
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(12);
  assert.equal(detailLoads(ctx), 2, 'the panel re-read its run');
  assert.equal(modal.classList.contains('hidden'), false, "p9's Stop dialog stays up");
  assert.equal(modal.dataset.pipelineId, 'p9');
});

test('Chat with no run panel open: a pipelines-changed frame reloads no History (only an open panel reads those rows)', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, [liveRun()]);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle(6);
  const lists = () => ctx.calls.filter((c) => c.url.split('?')[0].endsWith('/api/history')).length;
  const before = lists();
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(6);
  assert.equal(lists(), before, 'no History reload behind the Chat page');
  await openPanel(ctx, 'r1');
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(6);
  assert.ok(lists() > before, 'with the panel open it reloads');
});

test("resuming ANOTHER run from its chat card leaves a saved run in the panel where it is", async () => {
  const arms = (url) => (url.split('?')[0].endsWith('/api/resume') ? ok({ runId: 'r9' }) : null);
  const ctx = await bootChat({ rows: [ROW], arms });
  hello(ctx, [liveRun({ runId: 'r2', pipelineId: 'p2', title: 'Second', status: 'paused' })]);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  assert.ok(screen.classList.contains('hd'));
  const btn = ctx.window.document.createElement('button');
  ctx.window.document.body.appendChild(btn);
  await ctx.window.__np.chatRunControls.resume({ runId: 'r2', pipelineId: 'p2' }, btn);
  await ctx.settle(8);
  assert.ok(ctx.calls.some((c) => c.url.split('?')[0].endsWith('/api/resume')), 'precondition: the other run resumed');
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}`);
  assert.equal(screenOf(ctx), screen, 'the saved screen stays');
});

test('Restore from the panel says so in an ok toast that offers no way off Chat', async () => {
  const archivedDetail = { ...DETAIL, state: { ...DETAIL.state, archivedAt: '2026-09-01T00:00:00Z' } };
  const arms = (href, opts, box) => {
    if (href.split('?')[0].endsWith('/restore')) { box.detail = DETAIL; box.rows = [ROW]; return ok({ ok: true }); }
    return null;
  };
  const ctx = await bootChat({ rows: [{ ...ROW, archivedAt: '2026-09-01T00:00:00Z' }], detail: archivedDetail, arms });
  hello(ctx, []);
  await ctx.settle(6);
  await openPanel(ctx, ROW.id, 10);
  click(ctx, screenOf(ctx).querySelector('.hd-restore'));
  await confirmDialog(ctx.window);
  await ctx.settle(12);
  const toasts = [...ctx.window.document.querySelectorAll(`.toast[data-key="restore-${ROW.id}"]`)];
  assert.ok(toasts.some((t) => t.classList.contains('ok') && /Run restored/.test(t.textContent)), 'an ok "Run restored" toast');
  assert.equal(toasts.filter((t) => t.querySelector('.toast-act')).length, 0, 'no "Open" action: the run is already open in the panel');
});

test('Archive in flight, then the panel moves to another saved run: the DELETE landing leaves that run open', async () => {
  const X = { ...ROW, id: 'aaaa0001', title: 'Other finished run' };
  const XDETAIL = { ...DETAIL, state: { ...DETAIL.state, id: X.id, title: X.title } };
  let release = null;
  const arms = (href, opts) => {
    const path = href.split('?')[0];
    if (opts && opts.method === 'DELETE' && href.includes('/api/runs/')) return new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ ok: true }) }); });
    if (path.endsWith(`/api/history/${KEY}/${X.id}`)) return ok(XDETAIL);
    return null;
  };
  const ctx = await bootChat({ rows: [ROW, X], arms });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  click(ctx, screen.querySelector('.hd-archive'));
  await confirmDialog(ctx.window);
  await ctx.settle(4);
  assert.ok(release, 'precondition: the DELETE is in flight');
  const other = await openPanel(ctx, X.id, 8);
  assert.ok(other && other.classList.contains('hd'));
  release();
  await ctx.settle(10);
  assert.equal(ctx.window.location.hash, `#chat/new/run/${X.id}`);
  assert.equal(panelOf(ctx).hidden, false);
  assert.equal(screenOf(ctx), other);
});

test("the panel re-reading its saved run closes that run's OWN Stop dialog (another tab stopped it meanwhile)", async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  const modal = ctx.window.document.getElementById('stop-modal');
  click(ctx, screen.querySelector('.hd-stop'));
  assert.equal(modal.classList.contains('hidden'), false, 'precondition: its Stop dialog is up');
  ctx.box.rows = [{ ...ROW, status: 'stopped' }];
  ctx.box.detail = { ...DETAIL, state: { ...DETAIL.state, status: 'stopped' } };
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(12);
  assert.equal(detailLoads(ctx), 2, 'the panel re-read its run');
  assert.equal(modal.classList.contains('hidden'), true, 'no Stop dialog left over a run that is already stopped');
});

test("Runs page: Resume on the live screen still lands on running/<new> (the Chat run panel never takes the page's resume)", async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle(6);
  ctx.go('running/r1');
  await ctx.settle(8);
  const rd = ctx.window.document.querySelector('#run-detail .rd');
  const toggle = rd.querySelector('.rd-pause');
  assert.equal(toggle.dataset.action, 'resume');
  click(ctx, toggle);
  await ctx.settle(8);
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#running/r2');
  assert.equal(panelOf(ctx).hidden, true, 'the Chat run panel stayed shut');
});

test('a control disabled under the focus (a busy Resume or Submit) keeps focus in the panel; focus that moved on is left alone', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle(6);
  const doc = ctx.window.document;
  const screen = await openPanel(ctx, 'r1');
  const btn = screen.querySelector('.rd-pause');
  // What a browser does when the focused Resume turns busy: focus falls to <body> and a focusout with no
  // relatedTarget fires from the now disabled control. jsdom never blurs a disabled control, so the test plays it.
  const busyBlur = (b) => {
    b.disabled = false;
    b.blur();
    b.disabled = true;
    b.dispatchEvent(new ctx.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
  };
  btn.focus();
  assert.equal(doc.activeElement, btn, 'precondition: the Resume toggle has the focus');
  busyBlur(btn);
  await ctx.settle();
  assert.equal(doc.activeElement, panelOf(ctx), 'focus stays in the panel, never <body>');
  btn.disabled = false;
  btn.focus();
  btn.disabled = true;
  const input = doc.querySelector('[data-chat-page] textarea.ask-input');
  input.focus();           // focus moved on to another element: never taken back
  btn.dispatchEvent(new ctx.window.FocusEvent('focusout', { bubbles: true, relatedTarget: input }));
  await ctx.settle();
  assert.equal(doc.activeElement, input);
  btn.disabled = false;
  const tab = screen.querySelector('.rd-tab[data-sec="logs"]');
  tab.focus();
  tab.blur();              // an enabled control blurred: no busy state, nothing to keep
  await ctx.settle();
  assert.equal(doc.activeElement, doc.body);
});

test('the panel re-reading its saved run under the focus (another tab stopped it) keeps focus in the panel, never <body>', async () => {
  const paused = { ...TABS_DETAIL, state: { ...TABS_DETAIL.state, status: 'paused' } };
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: paused });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, `${ROW.id}/diff`, 8);
  const tab = screen.querySelector('.hd-tab[data-sec="diff"]');
  tab.focus();
  assert.equal(ctx.window.document.activeElement, tab, 'precondition: a tab of the saved screen has the focus');
  ctx.box.rows = [{ ...ROW, status: 'stopped' }];        // another tab, the CLI or a chat card stopped it
  ctx.box.detail = { ...TABS_DETAIL, state: { ...TABS_DETAIL.state, status: 'stopped' } };
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(12);
  assert.equal(detailLoads(ctx), 2, 'precondition: the panel re-read its run');
  assert.notEqual(screenOf(ctx), screen, 'precondition: the screen holding focus was replaced');
  assert.equal(ctx.window.document.activeElement, panelOf(ctx), 'focus stays in the panel');
});

test('a passive re-read of the panel\'s saved run leaves focus in the chat composer', async () => {
  const paused = { ...TABS_DETAIL, state: { ...TABS_DETAIL.state, status: 'paused' } };
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: paused });
  hello(ctx, []);
  await ctx.settle(6);
  await openPanel(ctx, `${ROW.id}/diff`, 8);
  const input = ctx.window.document.querySelector('[data-chat-page] textarea.ask-input');
  input.focus();
  ctx.box.rows = [{ ...ROW, status: 'stopped' }];
  ctx.box.detail = { ...TABS_DETAIL, state: { ...TABS_DETAIL.state, status: 'stopped' } };
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(12);
  assert.equal(detailLoads(ctx), 2, 'precondition: the panel re-read its run');
  assert.equal(ctx.window.document.activeElement, input, 'the composer keeps the focus');
});

test('Restore in the panel re-reads the run and leaves focus in the panel (never on the closed confirm or <body>)', async () => {
  const archivedDetail = { ...DETAIL, state: { ...DETAIL.state, archivedAt: '2026-09-01T00:00:00Z' } };
  const arms = (href, opts, box) => {
    if (href.split('?')[0].endsWith('/restore')) { box.detail = DETAIL; box.rows = [ROW]; return ok({ ok: true }); }
    return null;
  };
  const ctx = await bootChat({ rows: [{ ...ROW, archivedAt: '2026-09-01T00:00:00Z' }], detail: archivedDetail, arms });
  hello(ctx, []);
  await ctx.settle(6);
  await openPanel(ctx, ROW.id, 10);
  click(ctx, screenOf(ctx).querySelector('.hd-restore'));
  await confirmDialog(ctx.window);
  await ctx.settle(12);
  assert.equal(screenOf(ctx).querySelector('.hd-restore').hidden, true, 'precondition: restored and re-read');
  assert.equal(ctx.window.document.activeElement, panelOf(ctx));
});

test('Stop on a paused saved run in the panel re-reads it and leaves focus in the panel', async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  click(ctx, screen.querySelector('.hd-stop'));
  click(ctx, ctx.window.document.querySelector('#stop-modal .stop-confirm'));
  await ctx.settle(8);
  assert.equal(detailLoads(ctx), 2, 'precondition: the panel re-read the run');
  assert.equal(ctx.window.document.activeElement, panelOf(ctx));
});

test('Stop confirmed from the live panel bar hands focus back to the panel, never to <body> or the hidden dialog', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await openPanel(ctx, 'r1');
  const doc = ctx.window.document;
  const stop = screenOf(ctx).querySelector('.rd-stop');
  stop.focus();
  click(ctx, stop);
  await ctx.settle();
  const modal = doc.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the Stop dialog asks first');
  const confirm = modal.querySelector('.stop-confirm');
  assert.equal(doc.activeElement, modal.querySelector('.stop-cancel'), 'run 4 D11: the dialog opens on the safe choice');
  click(ctx, confirm);
  await ctx.settle(8);
  assert.equal(ctx.box.stops.length, 1, 'the stop was posted');
  assert.ok(modal.classList.contains('hidden'), 'the dialog closed');
  assert.equal(doc.activeElement, panelOf(ctx));
});

test('Archive from the panel hands focus back to the opener, as Close does (never left on the closed confirm or <body>)', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  const doc = ctx.window.document;
  const card = doc.createElement('button');            // stands in for the chat card's Open run
  doc.querySelector('[data-view="chat"]').appendChild(card);
  card.focus();
  const screen = await openPanel(ctx, ROW.id, 8);
  click(ctx, screen.querySelector('.hd-archive'));
  await confirmDialog(ctx.window);
  await ctx.settle(8);
  assert.equal(panelOf(ctx).hidden, true, 'precondition: the panel closed');
  assert.equal(ctx.window.location.hash, '#chat');
  assert.equal(doc.activeElement, card, 'focus is back on the opener');
});
