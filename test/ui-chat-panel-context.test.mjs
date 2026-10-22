// worca Chat P4: the Chat page's context follows the run in the panel (R4: no panel, no run context),
// with the same keys the run pages send; chatDeps.openRunPanel opens a live run by its run id and a saved
// one by its pipeline id, even before History lists it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootChat, liveRun, hello, openPanel, panelOf, screenOf, noticeOf, click, ok, KEY, ROW, DETAIL, TABS_DETAIL, PAUSED_DETAIL, DETAIL_URL,
} from './helpers/chat-panel-boot.mjs';

test('no panel, no run context; a live run in the panel gives its ids and the open tab', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  ctx.go('chat');
  await ctx.settle();
  assert.deepEqual(ctx.window.__np.chatRunPanelContext(), {});
  const screen = await openPanel(ctx, 'r1');
  assert.deepEqual(ctx.window.__np.chatRunPanelContext(), { runId: 'r1', pipelineId: 'p1', projectDir: '/tmp/p', runPage: 'overview' });
  click(ctx, screen.querySelector('.rd-tab[data-sec="diff"]'));
  await ctx.settle();
  assert.equal(ctx.window.__np.chatRunPanelContext().runPage, 'diff');
});

test('a saved run in the panel gives its pipeline id and project key', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  await openPanel(ctx, ROW.id, 8);
  assert.deepEqual(ctx.window.__np.chatRunPanelContext(), { pipelineId: ROW.id, projectKey: KEY, runPage: 'overview' });
});

test('openRunPanel: a saved run (pipeline id + project key) opens before History lists it, on the asked tab', async () => {
  const ctx = await bootChat({ rows: [] });
  hello(ctx, []);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  ctx.window.__np.openChatRunPanel({ pipelineId: ROW.id, projectKey: KEY }, { tab: 'diff' });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}/diff`);
  const screen = screenOf(ctx);
  assert.ok(screen && screen.classList.contains('hd'));
  assert.ok(ctx.calls.some((c) => c.url.split('?')[0].endsWith(DETAIL_URL)));
});

test("openRunPanel takes either Q&A key (and 'workflow') and lands on the key the mounted screen uses", async () => {
  // Live: 'clarify' (a History caller's key) opens the live screen's `qa`; 'workflow' opens Workflow.
  const live = await bootChat();
  hello(live, [liveRun()]);
  await live.settle();
  live.go('chat');
  await live.settle();
  live.window.__np.openChatRunPanel({ runId: 'r1' }, { tab: 'clarify' });
  live.window.dispatchEvent(new live.window.Event('hashchange'));
  await live.settle(6);
  assert.equal(screenOf(live).querySelector('.rd-tab.active').dataset.sec, 'qa');
  live.window.__np.openChatRunPanel({ runId: 'r1' }, { tab: 'workflow' });
  live.window.dispatchEvent(new live.window.Event('hashchange'));
  await live.settle(6);
  assert.equal(screenOf(live).querySelector('.rd-tab.active').dataset.sec, 'workflow');

  // Saved: 'qa' (a live run's Answer key) opens the saved screen's `clarify`.
  const saved = await bootChat({ rows: [ROW], detail: TABS_DETAIL });
  hello(saved, []);
  await saved.settle(6);
  saved.go('chat');
  await saved.settle();
  saved.window.__np.openChatRunPanel({ pipelineId: ROW.id, projectKey: KEY }, { tab: 'qa' });
  saved.window.dispatchEvent(new saved.window.Event('hashchange'));
  await saved.settle(8);
  assert.equal(screenOf(saved).querySelector('.hd-tab.active').dataset.sec, 'clarify');
});

test('an archived run in the panel keeps its Archived feed across a pipelines-changed (refetched, not dropped)', async () => {
  const ARCH = { ...DETAIL, state: { ...DETAIL.state, archivedAt: '2026-08-18T00:00:00Z' } };
  let archivedFetches = 0;
  const arms = (url) => {
    if (url.startsWith('/api/history?archived=1')) { archivedFetches += 1; return ok({ pipelines: [{ ...ROW, archivedAt: '2026-08-18T00:00:00Z' }] }); }
    return null;
  };
  const ctx = await bootChat({ rows: [], detail: ARCH, arms });
  hello(ctx, []);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  ctx.window.__np.openChatRunPanel({ pipelineId: ROW.id, projectKey: KEY });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(8);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
  assert.equal(archivedFetches, 1, 'the archived detail pulled its feed (loadHistDetailScreen)');
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(8);
  assert.equal(archivedFetches, 2, 'the open panel refetches the Archived feed instead of dropping it');
});

test('openRunPanel: a pipeline id with a live run opens that live run, by its run id', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  ctx.go('chat');
  await ctx.settle();
  ctx.window.__np.openChatRunPanel({ pipelineId: 'p1' });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
});

test("openRunPanel with a pipeline id opens the pipeline's current run (D23): the going one, never a superseded paused copy", async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' }), liveRun({ runId: 'r2', status: 'running' })]);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  ctx.window.__np.openChatRunPanel({ pipelineId: 'p1' }, { tab: 'artifacts' });
  assert.equal(ctx.window.location.hash, '#chat/new/run/r2/artifacts');
  const done = await bootChat();
  hello(done, [liveRun({ runId: 'r0', status: 'done' }), liveRun()]);
  await done.settle(6);
  done.go('chat');
  await done.settle();
  done.window.__np.openChatRunPanel({ pipelineId: 'p1' });
  assert.equal(done.window.location.hash, '#chat/new/run/r1');
});

test('getPageContext on Chat carries the panel run (the installed chatPanelContext seam), and nothing once it closes', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await openPanel(ctx, 'r1');
  const chat = ctx.window.__np.chat;
  assert.deepEqual(chat.getPageContext(), { view: 'chat', runId: 'r1', pipelineId: 'p1', projectDir: '/tmp/p', runPage: 'overview' });
  ctx.go('chat');
  await ctx.settle();
  assert.deepEqual(chat.getPageContext(), { view: 'chat' });
});

test('the composer re-previews its MCP sets when the panel run lands with no hashchange (P1 askPanel.contextChanged)', async () => {
  const ctx = await bootChat({ url: 'http://localhost:4317/#chat/new/run/r1' });
  hello(ctx, [liveRun()]);
  await ctx.settle(10);
  const previews = ctx.calls.filter((c) => c.url.includes('/api/ask/mcp-preview')).map((c) => JSON.parse(c.opts.body || '{}').context || {});
  const last = previews.at(-1) || {};
  assert.equal(last.projectDir, undefined, 'P4 No project: the run rides, its project folder does not (CONTRACT §4)');
  assert.equal(last.pinned, false);
  assert.equal(last.runId, 'r1');
});

test('openRunPanel with a workspace ref opens the workspace saved run, and the context names the workspace', async () => {
  const ctx = await bootChat({ rows: [] });
  hello(ctx, []);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  ctx.window.__np.openChatRunPanel({ pipelineId: 'bbbb2222', workspaceId: 'wks-team-0000abcd' });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(8);
  assert.ok(ctx.calls.some((c) => c.url.includes('wks-team-0000abcd') && c.url.includes('bbbb2222')), 'the workspace run detail was fetched');
  const c = ctx.window.__np.chatRunPanelContext();
  assert.equal(c.workspaceId, 'wks-team-0000abcd');
  assert.equal(c.projectKey, undefined);
});

test('openRunPanel with a run id before hello waits for it, then opens it', async () => {
  const ctx = await bootChat();
  ctx.go('chat');
  await ctx.settle();
  ctx.window.__np.openChatRunPanel({ runId: 'r1' });
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(4);
  hello(ctx, [liveRun()]);
  await ctx.settle(6);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
});

test('a pipeline id listed only in the loaded Archived feed opens as its saved run', async () => {
  const at = '2026-08-18T00:00:00Z';
  const B = { ...ROW, id: 'bbbb2222', title: 'Other archived', archivedAt: at };
  const arms = (url) => (url.startsWith('/api/history?archived=1') ? ok({ pipelines: [{ ...ROW, archivedAt: at }, B] }) : null);
  const ctx = await bootChat({ rows: [], detail: { ...TABS_DETAIL, state: { ...TABS_DETAIL.state, archivedAt: at } }, arms });
  hello(ctx, []);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  ctx.window.__np.openChatRunPanel({ pipelineId: ROW.id, projectKey: KEY });   // loads the Archived feed
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(8);
  const s = await openPanel(ctx, 'bbbb2222', 8);
  assert.ok(s && s.classList.contains('hd'));
  assert.equal(s.querySelector('.hd-title').textContent, 'Other archived');
});

test('a run card pressed while the panel shows another run becomes the opener: focus moves in, and Close hands it back to that card', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun(), liveRun({ runId: 'r2', pipelineId: 'p2', title: 'Second' })]);
  await ctx.settle();
  ctx.go('chat');
  await ctx.settle();
  const doc = ctx.window.document;
  const a = doc.createElement('button');
  const b = doc.createElement('button');
  doc.querySelector('[data-view="chat"]').append(a, b);
  a.focus();
  ctx.window.__np.openChatRunPanel({ runId: 'r1' });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  b.focus();
  ctx.window.__np.openChatRunPanel({ runId: 'r2' });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.equal(screenOf(ctx).querySelector('.rd-title').textContent, 'Second');
  assert.equal(doc.activeElement, panelOf(ctx), 'focus moved into the panel');
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(doc.activeElement, b);
});

const openVia = async (ctx, ref, opts) => {
  ctx.window.__np.openChatRunPanel(ref, opts);
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(8);
};

test("openRunPanel with a pipeline id whose only going run died with a restarted server opens the saved run (D23)", async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  ctx.dispatch({ type: 'hello', bootId: 'b1', runs: [liveRun({ pipelineId: ROW.id, status: 'paused' })] });
  await ctx.settle(6);
  ctx.dispatch({ type: 'hello', bootId: 'b2', runs: [] });
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  await openVia(ctx, { pipelineId: ROW.id, projectKey: KEY });
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}`);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
});

test('openRunPanel with a run id this tab never saw and its pipeline id opens the saved run, not a wait for that run', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  await openVia(ctx, { runId: 'old00001', pipelineId: ROW.id, projectKey: KEY });
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}`);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
});

test('openRunPanel with a bare pipeline id nothing knows (no project key) shows "Could not find this run", never a screen', async () => {
  const ctx = await bootChat({ rows: [] });
  hello(ctx, []);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  await openVia(ctx, { pipelineId: 'beef0001' });
  assert.equal(ctx.window.location.hash, '#chat/new/run/beef0001');
  assert.equal(screenOf(ctx), null);
  assert.match(noticeOf(ctx).textContent, /Could not find this run/);
});

test('a card pressed with focus inside the panel (or nowhere) keeps the original opener: Close hands focus back to it', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun(), liveRun({ runId: 'r2', pipelineId: 'p2', title: 'Second' })]);
  await ctx.settle();
  ctx.go('chat');
  await ctx.settle();
  const doc = ctx.window.document;
  const a = doc.createElement('button');
  doc.querySelector('[data-view="chat"]').append(a);
  a.focus();
  await openVia(ctx, { runId: 'r1' });
  screenOf(ctx).querySelector('.rd-tab[data-sec="diff"]').focus();   // inside the panel
  await openVia(ctx, { runId: 'r1' }, { tab: 'logs' });
  doc.activeElement.blur();                                           // nowhere
  await openVia(ctx, { runId: 'r2' });
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(doc.activeElement, a);
});

test('a chat card ref (run id + pipeline id) after a server restart opens the saved run, never the dead live run', async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'interrupted' }] });
  ctx.dispatch({ type: 'hello', bootId: 'b1', runs: [liveRun({ pipelineId: ROW.id, status: 'running' })] });
  await ctx.settle(6);
  ctx.dispatch({ type: 'hello', bootId: 'b2', runs: [] });
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  const snap = ctx.window.__np.askRunStore.byPipeline(ROW.id);   // what the P3 card paints and hands over
  assert.equal(snap.runId, 'r1', 'precondition: the card still names the run the old server ran');
  await openVia(ctx, { runId: snap.runId, pipelineId: ROW.id });
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}`);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
});

test("a card ref naming a superseded paused copy opens the pipeline's going run (D23, as P1's default did)", async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' }), liveRun({ runId: 'r2', status: 'running' })]);
  await ctx.settle(6);
  ctx.go('chat');
  await ctx.settle();
  await openVia(ctx, { runId: 'r1', pipelineId: 'p1' });
  assert.equal(ctx.window.location.hash, '#chat/new/run/r2');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2');
});

test('Open run (no tab) on the run the panel already shows keeps its tab and adds no history entry', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/logs');
  const before = ctx.window.history.length;
  await openVia(ctx, { runId: 'r1', pipelineId: 'p1' });
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/logs');
  assert.equal(ctx.window.history.length, before, 'no new entry for Back to step through');
  assert.equal(screenOf(ctx), screen);
  assert.equal(screen.querySelector('.rd-tab.active').dataset.sec, 'logs');
  await openVia(ctx, { runId: 'r1', pipelineId: 'p1' }, { tab: 'workflow' });   // a tab (Expand) still routes
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/workflow');
});
