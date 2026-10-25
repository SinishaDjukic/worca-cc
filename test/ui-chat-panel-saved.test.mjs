// worca Chat P4: a SAVED run in the Chat run panel — the REAL #hist-detail-tpl screen, opened by its
// pipeline id (a History row, or a finished run whose row has landed), deep links that wait for hello /
// History, an id nothing knows, the ⋯ menu inside the panel, and the screen changing hosts with the route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootChat, liveRun, hello, openPanel, panelOf, screenOf, noticeOf, click, detailLoads, ok, fail, KEY, ROW, TABS_DETAIL,
  PAUSED_DETAIL,
} from './helpers/chat-panel-boot.mjs';

async function bootSaved(opts = {}) {
  const ctx = await bootChat({ rows: [ROW], ...opts });
  hello(ctx, []);
  await ctx.settle(6);
  return ctx;
}

test('a saved run opens in the panel by its pipeline id: the History screen, Details only, tab hops in place', async () => {
  const ctx = await bootSaved();
  const doc = ctx.window.document;
  const screen = await openPanel(ctx, ROW.id, 8);
  assert.ok(screen && screen.classList.contains('hd'), 'the saved run screen is mounted in the panel');
  assert.equal(screen.dataset.presentation, 'panel');
  assert.equal(screen.querySelector('.hd-details').hidden, false);
  assert.equal(screen.querySelector('.hd-glance').hidden, true);
  assert.equal(detailLoads(ctx), 1, 'the saved detail was fetched once');
  assert.equal(screen.querySelector('.hd-title').textContent, ROW.title);
  assert.ok(screen.querySelector('.rd-bar-end .crp-close'), 'the panel Close ends the saved bar too');
  assert.equal(doc.querySelector('#hist-detail').children.length, 0, 'the Runs page host stays empty');
  assert.equal(doc.querySelector('#hist-shell').classList.contains('detail-open'), false);
  const before = ctx.window.history.length;
  click(ctx, screen.querySelector('.hd-tab[data-sec="diff"]'));
  await ctx.settle();
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}/diff`);
  assert.equal(ctx.window.history.length, before);
});

test("the Q&A route opens the saved screen's Q&A (`qa` is `clarify` there)", async () => {
  const ctx = await bootSaved({ detail: TABS_DETAIL });
  const screen = await openPanel(ctx, `${ROW.id}/qa`, 8);
  assert.equal(screen.querySelector('.hd-tab.active').dataset.sec, 'clarify');
});

test('a finished run whose row has landed opens as its saved run, its address moved to the pipeline id', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, [liveRun({ runId: 'r9', pipelineId: ROW.id, status: 'done' })]);
  await ctx.settle(6);
  const screen = await openPanel(ctx, 'r9', 8);
  assert.ok(screen && screen.classList.contains('hd'));
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}`);
});

test('a boot deep link to a saved run waits ("Loading the run…") and opens once History has its row', async () => {
  const ctx = await bootChat({ rows: [ROW], url: `http://localhost:4317/#chat/new/run/${ROW.id}` });
  const notice = noticeOf(ctx);
  assert.equal(panelOf(ctx).hidden, false, 'the panel opens at once');
  assert.equal(notice.hidden, false);
  assert.equal(notice.querySelector('.crp-msg-text').textContent, 'Loading the run…');
  hello(ctx, []);
  await ctx.settle(8);
  assert.equal(notice.hidden, true);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
  assert.equal(detailLoads(ctx), 1, 'opened once');
});

test('a boot deep link to a live run opens it when hello lists it', async () => {
  const ctx = await bootChat({ url: 'http://localhost:4317/#chat/new/run/r1' });
  assert.equal(noticeOf(ctx).hidden, false);
  hello(ctx, [liveRun()]);
  await ctx.settle(6);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
  assert.equal(noticeOf(ctx).hidden, true);
});

test('an id nothing knows, once History has answered: "Could not find this run", whose Close steps back', async () => {
  const ctx = await bootSaved({ rows: [] });
  await openPanel(ctx, 'deadbeef');
  const notice = noticeOf(ctx);
  assert.equal(notice.hidden, false);
  assert.equal(notice.querySelector('.crp-msg-text').textContent, 'Could not find this run');
  assert.equal(screenOf(ctx), null);
  click(ctx, notice.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(ctx.window.location.hash, '#chat');
});

test('a waiting route settles when History fails: "Could not find this run", never a spinner forever', async () => {
  const historyDown = (url) => (url.split('?')[0].endsWith('/api/history') && !url.includes('archived') ? fail(500, { error: 'boom' }) : null);
  const ctx = await bootChat({ rows: [ROW], arms: historyDown, url: `http://localhost:4317/#chat/new/run/${ROW.id}` });
  const notice = noticeOf(ctx);
  assert.equal(notice.querySelector('.crp-msg-text').textContent, 'Loading the run…');
  hello(ctx, []);
  await ctx.settle(8);
  assert.equal(notice.hidden, false);
  assert.equal(notice.querySelector('.crp-msg-text').textContent, 'Could not find this run');
});

test('slide layout: a panel opened while the Runs page still slides the saved screen away leaves no stale screen on the page', async () => {
  const ctx = await bootSaved();
  const doc = ctx.window.document;
  doc.getElementById('runs-shell').dataset.layout = 'slide';
  ctx.go(`history/${KEY}/${ROW.id}`);
  await ctx.settle(8);
  assert.ok(doc.querySelector('#hist-detail .hd'));
  ctx.go('runs');                                   // the slide-out: #hist-detail empties after transitionend or 600 ms
  await ctx.settle();
  await openPanel(ctx, ROW.id, 8);
  await new Promise((r) => setTimeout(r, 650));
  assert.equal(doc.querySelector('#hist-detail').children.length, 0, 'the page host emptied');
  assert.equal(doc.querySelectorAll('.hd').length, 1);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
});

test('the ⋯ menu works in the panel: it opens, and a click elsewhere closes it', async () => {
  const ctx = await bootSaved();
  const screen = await openPanel(ctx, ROW.id, 8);
  const doc = ctx.window.document;
  click(ctx, screen.querySelector('.hd-bar-more'));
  assert.ok(doc.querySelector('body > .wfv-menu'));
  doc.body.dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true }));
  assert.equal(doc.querySelector('body > .wfv-menu'), null);
});

test('the saved screen changes hosts with the route (History page, panel, History page), one host at a time', async () => {
  const ctx = await bootSaved();
  const doc = ctx.window.document;
  ctx.go(`history/${KEY}/${ROW.id}/details`);
  await ctx.settle(8);
  assert.ok(doc.querySelector('#hist-detail .hd'));
  await openPanel(ctx, ROW.id, 8);
  assert.equal(doc.querySelector('#hist-detail').children.length, 0);
  assert.equal(doc.querySelector('#hist-shell').classList.contains('detail-open'), false);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
  assert.equal(doc.querySelectorAll('.hd').length, 1);
  ctx.go(`history/${KEY}/${ROW.id}`);
  await ctx.settle(8);
  assert.equal(screenOf(ctx), null);
  assert.equal(panelOf(ctx).hidden, true);
  assert.ok(doc.querySelector('#hist-detail .hd'));
  assert.equal(doc.querySelectorAll('.hd').length, 1);
});

test("a pipeline id opens the pipeline's current run, never a superseded paused copy listed first (D23)", async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' }), liveRun({ runId: 'r2', status: 'running' })]);
  await ctx.settle(6);
  await openPanel(ctx, 'p1');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2');
  assert.equal(ctx.window.location.hash, '#chat/new/run/r2');
});

test('a pipeline id with a finished and a going run opens the going one', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ runId: 'r0', status: 'done' }), liveRun()]);
  await ctx.settle(6);
  await openPanel(ctx, 'p1');
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r1');
});

test('a pipeline id whose run finished here before its row landed opens that run', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'done' })]);
  await ctx.settle(6);
  const screen = await openPanel(ctx, 'p1');
  assert.ok(screen && screen.classList.contains('rd'));
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
});

test('an id nothing knows, routed after a shown run, empties the panel', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle(6);
  await openPanel(ctx, 'r1');
  await openPanel(ctx, 'deadbeef');
  assert.equal(noticeOf(ctx).querySelector('.crp-msg-text').textContent, 'Could not find this run');
  assert.equal(screenOf(ctx), null);
  assert.equal(ctx.window.__np.rdOpenRun(), null);
});

test("a route to a run this tab does not know yet opens on the run's first frame (a run start sends no pipelines-changed)", async () => {
  const ctx = await bootSaved({ rows: [] });
  await openPanel(ctx, 'r7');
  assert.equal(noticeOf(ctx).querySelector('.crp-msg-text').textContent, 'Could not find this run');
  ctx.dispatch({ type: 'state', runId: 'r7', id: 'p7', status: 'running', title: 'Later', projectDir: '/tmp/p', startedAt: '2026-01-01T00:00:00Z' });
  await ctx.settle(4);
  assert.equal(noticeOf(ctx).hidden, true);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r7');
});

function heldHistory(rows) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const arms = (url) => (url.split('?')[0].endsWith('/api/history') && !url.includes('archived')
    ? gate.then(() => ok({ pipelines: rows, ghAvailable: false })) : null);
  return { arms, release: () => release() };
}
test('after hello, a saved deep link keeps "Loading the run…" until History answers', async () => {
  const h = heldHistory([ROW]);
  const ctx = await bootChat({ arms: h.arms, url: `http://localhost:4317/#chat/new/run/${ROW.id}` });
  hello(ctx, []);
  await ctx.settle(6);
  assert.equal(noticeOf(ctx).querySelector('.crp-msg-text').textContent, 'Loading the run…');
  h.release();
  await ctx.settle(8);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('hd'));
});

test('a live deep link opens at hello, without waiting for History', async () => {
  const h = heldHistory([]);
  const ctx = await bootChat({ arms: h.arms, url: 'http://localhost:4317/#chat/new/run/r1' });
  hello(ctx, [liveRun()]);
  await ctx.settle(6);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
  h.release();
  await ctx.settle();
});

test('a waiting route settles when History cannot be reached at all', async () => {
  const arms = (url) => (url.split('?')[0].endsWith('/api/history') && !url.includes('archived') ? Promise.reject(new Error('offline')) : null);
  const ctx = await bootChat({ arms, url: `http://localhost:4317/#chat/new/run/${ROW.id}` });
  hello(ctx, []);
  await ctx.settle(8);
  assert.equal(noticeOf(ctx).querySelector('.crp-msg-text').textContent, 'Could not find this run');
});

test('after a waiting deep link resolved, a tab the user picked survives History repaints', async () => {
  const ctx = await bootChat({ url: 'http://localhost:4317/#chat/new/run/r1/diff' });
  hello(ctx, [liveRun()]);
  await ctx.settle(8);
  const screen = screenOf(ctx);
  assert.equal(screen.querySelector('.rd-tab.active').dataset.sec, 'diff');
  click(ctx, screen.querySelector('.rd-tab[data-sec="logs"]'));
  await ctx.settle();
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(8);
  assert.equal(screenOf(ctx).querySelector('.rd-tab.active').dataset.sec, 'logs');
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/logs');
});

test('a reconnect hello repaints the panel screen and reloads History', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle(6);
  const screen = await openPanel(ctx, 'r1');
  const loads = () => ctx.calls.filter((c) => c.url.split('?')[0].endsWith('/api/history')).length;
  const before = loads();
  hello(ctx, [liveRun({ title: 'Renamed on the server' })]);
  await ctx.settle(6);
  assert.equal(screen.querySelector('.rd-title').textContent, 'Renamed on the server');
  assert.ok(loads() > before, 'History reloaded');
});

test('Open full page on the saved screen goes to its History page on the same tab', async () => {
  const ctx = await bootSaved({ detail: TABS_DETAIL });
  const screen = await openPanel(ctx, `${ROW.id}/diff`, 8);
  click(ctx, screen.querySelector('.crp-full'));
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, `#history/${KEY}/${ROW.id}/details/diff`);
  assert.ok(ctx.window.document.querySelector('#hist-detail .hd'));
  assert.equal(panelOf(ctx).hidden, true);
});

test('a second click on ⋯ in the panel closes the menu', async () => {
  const ctx = await bootSaved();
  const screen = await openPanel(ctx, ROW.id, 8);
  const more = screen.querySelector('.hd-bar-more');
  const menu = () => ctx.window.document.querySelector('body > .wfv-menu');
  click(ctx, more);
  assert.ok(menu());
  click(ctx, more);
  assert.equal(menu(), null);
});

const okBudget = () => ({ pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly', windowStartMs: Date.now() - 3 * 86400000,
  windowEndMs: Date.now() + 4 * 86400000, msUntilReset: 4 * 86400000, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5, remainingUsd: 37.5, blocked: false });
const blockedBudget = () => ({ ...okBudget(), windowSpendUsd: 50, remainingUsd: 0, blocked: true });
test("a budget-changed unblock re-enables the panel's saved Resume", async () => {
  const b = { budget: blockedBudget() };
  const arms = (url) => (url.includes('/api/budget') ? ok(b.budget) : null);
  const row = { ...ROW, status: 'paused', pauseReason: 'cost_total' };
  const ctx = await bootChat({ rows: [row], detail: { ...PAUSED_DETAIL, state: { ...PAUSED_DETAIL.state, pauseReason: 'cost_total' } }, arms });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  const resume = screen.querySelector('.hd-resume');
  assert.equal(resume.hidden, false);
  assert.equal(resume.disabled, true, 'blocked while the total budget is over');
  b.budget = okBudget();
  ctx.dispatch({ type: 'budget-changed', action: null });
  await ctx.settle(6);
  assert.equal(resume.disabled, false);
});

test("a route that closes the panel closes its saved run's Stop dialog", async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  click(ctx, screen.querySelector('.hd-stop'));
  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  ctx.go('chat');
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(modal.classList.contains('hidden'), true);
});

test('a route that closes the panel closes the Ship it dialog opened from it', async () => {
  const arms = (url) => (url.split('?')[0].endsWith('/api/history') && !url.includes('archived') ? ok({ pipelines: [{ ...ROW, pr: null }], ghAvailable: true }) : null);
  const ctx = await bootChat({ rows: [{ ...ROW, pr: null }], arms });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  const pr = screen.querySelector('.hd-pr');
  assert.ok(pr && !pr.hidden, 'Create PR is offered');
  click(ctx, pr);
  await ctx.settle();
  const modal = ctx.window.document.getElementById('shipit-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  ctx.go('chat');
  await ctx.settle();
  assert.equal(modal.classList.contains('hidden'), true);
});

test('a closed panel leaves no diff-comment poke target: a later hello fetches no comments for it', async () => {
  const ctx = await bootSaved({ detail: TABS_DETAIL });
  await openPanel(ctx, `${ROW.id}/diff`, 10);
  const comments = () => ctx.calls.filter((c) => /comment/i.test(c.url)).length;
  assert.ok(comments() >= 1, 'the Diff tab loaded its comments');
  ctx.go('chat');
  await ctx.settle();
  const before = comments();
  hello(ctx, []);
  await new Promise((r) => setTimeout(r, 400));
  await ctx.settle();
  assert.equal(comments(), before);
});

test('a finished run opened in the panel is acknowledged, as opening it on the Runs page is (a failure leaves Needs you)', async () => {
  const ctx = await bootChat({ rows: [] });
  hello(ctx, [liveRun({ pipelineId: ROW.id })]);
  await ctx.settle(6);
  ctx.go('runs');                                   // History stays current while the run ends: its row lands first
  await ctx.settle(4);
  ctx.dispatch({ type: 'state', runId: 'r1', id: ROW.id, status: 'error' });
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'error' });
  await ctx.settle(6);
  ctx.box.rows = [{ ...ROW, status: 'error' }];
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(8);
  ctx.go('chat');
  await ctx.settle(6);
  const needs = () => { const n = ctx.window.document.getElementById('nav-needs-count'); return n && !n.hidden ? n.textContent : '0'; };
  assert.equal(needs(), '1', 'the failure needs the user');
  const screen = await openPanel(ctx, 'r1', 8);       // its chat card's "Open run ›" (by run id)
  assert.ok(screen && screen.classList.contains('hd'), 'its saved run is on screen');
  assert.ok(JSON.parse(ctx.window.localStorage.getItem('worca-cc.ackRuns') || '[]').includes('r1'));
  assert.equal(needs(), '0');
});

test('closing the panel destroys the Actions controller mounted in it', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, `${ROW.id}/actions`, 8);
  const sec = screen.querySelector('.hd-sec[data-sec="actions"]');
  assert.ok(sec && sec.__actionsCtl, 'an Actions controller is mounted');
  let destroyed = 0;
  const ctl = sec.__actionsCtl;
  const destroy = ctl.destroy;
  ctl.destroy = () => { destroyed += 1; destroy(); };
  ctx.go('chat');
  await ctx.settle();
  assert.equal(destroyed, 1, 'its controller was destroyed with the screen');
});

test("a pipeline id whose only going run died with a restarted server opens its saved run (D23), never that dead live run", async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  ctx.dispatch({ type: 'hello', bootId: 'b1', runs: [liveRun({ pipelineId: ROW.id, status: 'paused' })] });
  await ctx.settle(6);
  ctx.dispatch({ type: 'hello', bootId: 'b2', runs: [] });   // the server restarted: it no longer knows r1
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  assert.ok(screen && screen.classList.contains('hd'), 'the saved screen, whose Resume works');
  assert.equal(ctx.window.location.hash, `#chat/new/run/${ROW.id}`);
});

test('a pipeline id whose going run History already lists (a live row) opens the live run, not its saved screen', async () => {
  const ctx = await bootChat({ rows: [{ ...ROW, status: 'running', live: true }] });
  hello(ctx, [liveRun({ pipelineId: ROW.id })]);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  assert.ok(screen && screen.classList.contains('rd'));
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
});

test('an id nothing knows shows "Could not find this run" even when History lists other rows', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, 'nope0000', 8);
  assert.equal(screen, null, 'no saved screen for an id no row has');
  assert.equal(noticeOf(ctx).hidden, false);
  assert.match(noticeOf(ctx).textContent, /Could not find this run/);
});

test("a route by PIPELINE id to a run this tab does not know yet opens on the run's first frame too", async () => {
  const ctx = await bootChat({ rows: [] });
  hello(ctx, []);
  await ctx.settle(6);
  await openPanel(ctx, 'p7');
  assert.equal(noticeOf(ctx).querySelector('.crp-msg-text').textContent, 'Could not find this run');
  ctx.dispatch({ type: 'state', runId: 'r7', id: 'p7', status: 'running', title: 'Later', projectDir: '/tmp/p', startedAt: '2026-01-01T00:00:00Z' });
  await ctx.settle(4);
  assert.equal(noticeOf(ctx).hidden, true);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
  assert.equal(ctx.window.location.hash, '#chat/new/run/r7');
});

test('a finished run opened in the panel by its PIPELINE id is acknowledged too (its saved row stands for it)', async () => {
  const ctx = await bootChat({ rows: [] });
  hello(ctx, [liveRun({ pipelineId: ROW.id })]);
  await ctx.settle(6);
  ctx.go('runs');
  await ctx.settle(4);
  ctx.dispatch({ type: 'state', runId: 'r1', id: ROW.id, status: 'error' });
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'error' });
  await ctx.settle(6);
  ctx.box.rows = [{ ...ROW, status: 'error' }];
  ctx.dispatch({ type: 'pipelines-changed' });
  await ctx.settle(8);
  ctx.go('chat');
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);      // a History caller's ref: the pipeline id
  assert.ok(screen && screen.classList.contains('hd'), 'its saved run is on screen');
  assert.ok(JSON.parse(ctx.window.localStorage.getItem('worca-cc.ackRuns') || '[]').includes('r1'));
});

test('a PAUSED run opened in the panel is never acknowledged: it stays a live row to resume', async () => {
  const ctx = await bootChat({ rows: [] });
  hello(ctx, [liveRun()]);
  await ctx.settle(6);
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'paused' });
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'paused' });
  await ctx.settle(6);
  const screen = await openPanel(ctx, 'r1');
  assert.ok(screen && screen.classList.contains('rd'), 'precondition: the paused run is on screen');
  assert.equal(screen.querySelector('.rd-pause').dataset.action, 'resume');
  assert.equal(JSON.parse(ctx.window.localStorage.getItem('worca-cc.ackRuns') || '[]').includes('r1'), false);
});

test('Runs page, slide layout: going back to the list empties the saved host after the slide; a run re-opened during the slide keeps its screen', async () => {
  const ctx = await bootSaved();
  const doc = ctx.window.document;
  doc.getElementById('runs-shell').dataset.layout = 'slide';
  ctx.go(`history/${KEY}/${ROW.id}`);
  await ctx.settle(8);
  ctx.go('runs');                                   // the slide-out: #hist-detail empties after transitionend or 600 ms
  await ctx.settle();
  await new Promise((r) => setTimeout(r, 650));
  assert.equal(doc.querySelector('#hist-detail').children.length, 0, 'no stale screen left in the page host');
  ctx.go(`history/${KEY}/${ROW.id}`);
  await ctx.settle(8);
  ctx.go('runs');
  await ctx.settle();
  ctx.go(`history/${KEY}/${ROW.id}`);               // re-opened before the slide-out's clear runs
  await ctx.settle(8);
  await new Promise((r) => setTimeout(r, 650));
  assert.ok(doc.querySelector('#hist-detail .hd'), 'the re-opened screen survives the earlier clear');
});

test('s2 (M2): Chat boot, a saved run in the panel: once the schedules answer, the route names its base branch', async () => {
  // /api/schedules answers only when the test says so: until then the chains are unknown (D2, "The base branch").
  let answer = null;
  const late = (url) => (url.split('?')[0].endsWith('/api/schedules')
    ? new Promise((r) => { answer = () => r({ ok: true, status: 200, json: async () => ({ schedules: [], tickets: [], chains: [], counts: {} }) }); })
    : null);
  const ctx = await bootSaved({ arms: late });
  const screen = await openPanel(ctx, ROW.id, 8);
  const target = () => [...screen.querySelectorAll('.rd-route .rd-route-row')].at(-1).querySelector('.rd-route-place');
  assert.ok(answer, 'the panel asked for the schedules');
  assert.equal(target().textContent, 'The base branch', 'pending: never a guessed branch');
  answer();
  await ctx.settle(8);
  assert.equal(target().textContent, ROW.sourceBranch, 'repainted once the chains are known');
});
