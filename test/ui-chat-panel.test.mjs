// worca Chat P4: a LIVE run in the Chat run panel. The REAL #run-detail-tpl screen mounts in
// [data-chat-panel] (Details only), its address is #chat/<thread>/run/<id>[/<tab>], tab hops rewrite it
// in place, live frames repaint it, Close / Open full page / a bare #chat give it back, the history
// column folds below 1500px, and the Runs page and the panel never hold the screen at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootChat, liveRun, hello, openPanel, panelOf, pageOf, screenOf, click } from './helpers/chat-panel-boot.mjs';

async function bootLive(extra = {}) {
  const ctx = await bootChat();
  hello(ctx, [liveRun(extra)]);
  await ctx.settle();
  return ctx;
}

test('a live run opens in the panel on Details; the Runs page stays empty and remembers nothing', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  const screen = await openPanel(ctx, 'r1');
  assert.ok(screen && screen.classList.contains('rd'), 'the live run screen is mounted in the panel');
  assert.equal(screen.dataset.presentation, 'panel');
  assert.equal(screen.dataset.mode, 'details');
  assert.equal(screen.querySelector('.rd-details').hidden, false);
  assert.equal(screen.querySelector('.rd-glance').hidden, true);
  assert.equal(screen.querySelector('.rd-title').textContent, 'Add dark mode');
  assert.equal(panelOf(ctx).hidden, false);
  assert.equal(panelOf(ctx).getAttribute('aria-label'), 'Run details');
  assert.equal(pageOf(ctx).dataset.panel, 'open');
  const end = screen.querySelector('.rd-bar-end');
  assert.ok(end.querySelector('.crp-full') && end.querySelector('.crp-close'), 'Open full page and Close end the bar');
  assert.equal(doc.querySelector('#run-detail').children.length, 0, 'the Runs page host stays empty');
  assert.equal(doc.querySelector('#run-shell').classList.contains('detail-open'), false);
  assert.equal(doc.querySelectorAll('.rd').length, 1, 'one live screen in the document');
  assert.equal(ctx.window.localStorage.getItem('worca-cc.runs.last'), null, 'the Runs page memory is untouched');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r1', 'the panel screen is the open live run');
});

test('a tab route opens that tab; a tab click rewrites the address in place', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1/diff');
  assert.equal(screen.querySelector('.rd-tab.active').dataset.sec, 'diff');
  const before = ctx.window.history.length;
  click(ctx, screen.querySelector('.rd-tab[data-sec="logs"]'));
  await ctx.settle();
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/logs');
  assert.equal(ctx.window.history.length, before, 'replaceState, not a new history entry');
  assert.equal(screen.querySelector('.rd-tab.active').dataset.sec, 'logs');
  assert.equal(screenOf(ctx), screen, 'a tab hop keeps the mounted screen');
});

test('either Q&A key in the route opens the live screen\'s Q&A (`clarify` maps to `qa` here)', async () => {
  const ctx = await bootLive();
  const viaClarify = await openPanel(ctx, 'r1/clarify');
  assert.equal(viaClarify.querySelector('.rd-tab.active').dataset.sec, 'qa');
  ctx.go('chat');
  await ctx.settle();
  const viaQa = await openPanel(ctx, 'r1/qa');
  assert.equal(viaQa.querySelector('.rd-tab.active').dataset.sec, 'qa');
});

test('live frames repaint the screen in the panel', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', title: 'Dark mode, renamed' });
  await ctx.settle();
  assert.equal(screen.querySelector('.rd-title').textContent, 'Dark mode, renamed');
});

test('Close empties and hides the panel, steps the address back and returns focus to the opener', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  await openPanel(ctx, 'r1');
  assert.equal(doc.activeElement, panelOf(ctx), 'focus moves into the panel');
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(pageOf(ctx).dataset.panel, 'closed');
  assert.equal(panelOf(ctx).querySelector('.crp-host').children.length, 0);
  assert.equal(ctx.window.location.hash, '#chat');
  assert.equal(ctx.window.__np.rdOpenRun(), null);

  // Opened from a control (a run card's "Open run"), Close hands focus back to it.
  const opener = doc.createElement('button');
  doc.querySelector('[data-view="chat"]').appendChild(opener);
  opener.focus();
  ctx.window.__np.routeChatRunPanel(['r1']);
  assert.equal(panelOf(ctx).hidden, false);
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(doc.activeElement, opener);
});

test('a #chat route without a run segment closes the panel', async () => {
  const ctx = await bootLive();
  assert.ok(await openPanel(ctx, 'r1'), 'precondition: the panel holds the run');
  ctx.go('chat');
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(screenOf(ctx), null);
  assert.equal(ctx.window.__np.rdOpenRun(), null);
});

test('below 1500px the history column folds while the panel is open and comes back on close; at 1500px or wider it stays', async () => {
  const ctx = await bootLive();
  pageOf(ctx).dataset.history = 'open';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1280, configurable: true });
  const screen = await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'closed');
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'open');
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1600, configurable: true });
  await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'open');
});

test('Open full page: the run page takes the screen over on the same tab, and the panel lets it go', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  const screen = await openPanel(ctx, 'r1/logs');
  click(ctx, screen.querySelector('.crp-full'));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#running/r1/details/logs');
  assert.ok(doc.querySelector('#run-shell').classList.contains('detail-open'));
  assert.ok(doc.querySelector('#run-detail .rd'));
  assert.equal(doc.querySelector('#run-detail .rd-tab.active').dataset.sec, 'logs');
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(panelOf(ctx).querySelector('.crp-host').children.length, 0);
  assert.equal(doc.querySelectorAll('.rd').length, 1);
});

test("a panel swap closes only its own run's Stop dialog; one opened for another run stays (its POST may be in flight)", async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun(), liveRun({ runId: 'r2', pipelineId: 'p2', title: 'Second' }), liveRun({ runId: 'r3', pipelineId: 'p3', title: 'Third' })]);
  await ctx.settle();
  const modal = ctx.window.document.getElementById('stop-modal');
  await openPanel(ctx, 'r1');
  ctx.window.__np.openStopModal({ runId: 'r3' });   // e.g. from r3's chat run card
  assert.equal(modal.classList.contains('hidden'), false);
  await openPanel(ctx, 'r2');                       // the panel swaps r1 → r2
  assert.equal(modal.classList.contains('hidden'), false, "r3's dialog stays up");
  assert.equal(modal.dataset.runId, 'r3');
  modal.querySelector('.stop-cancel').click();
  ctx.window.__np.openStopModal({ runId: 'r2' });   // the panel's own run
  await openPanel(ctx, 'r1');
  assert.equal(modal.classList.contains('hidden'), true, "the panel run's dialog closes with its screen");
});

test('slide layout: a panel opened while the Runs page still slides its screen away leaves no stale screen on the page', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  doc.getElementById('runs-shell').dataset.layout = 'slide';
  ctx.go('running/r1');
  await ctx.settle(6);
  assert.ok(doc.querySelector('#run-detail .rd'));
  ctx.go('runs');                                   // the slide-out: #run-detail empties after transitionend or 600 ms
  await ctx.settle();
  await openPanel(ctx, 'r1');
  await new Promise((r) => setTimeout(r, 650));
  assert.equal(doc.querySelector('#run-detail').children.length, 0, 'the page host emptied');
  assert.equal(doc.querySelectorAll('.rd').length, 1);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
});

test('one owner: the Runs page hands the live screen to the panel and takes it back', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  ctx.go('running/r1/details/logs');
  await ctx.settle(6);
  assert.ok(doc.querySelector('#run-detail .rd'));
  await openPanel(ctx, 'r1/logs');
  assert.equal(doc.querySelector('#run-detail').children.length, 0);
  assert.equal(doc.querySelector('#run-shell').classList.contains('detail-open'), false);
  assert.ok(screenOf(ctx) && screenOf(ctx).classList.contains('rd'));
  assert.equal(doc.querySelectorAll('.rd').length, 1);
  ctx.go('running/r1');
  await ctx.settle(6);
  assert.equal(screenOf(ctx), null);
  assert.equal(panelOf(ctx).hidden, true);
  assert.ok(doc.querySelector('#run-detail .rd'));
  assert.equal(doc.querySelectorAll('.rd').length, 1);
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r1');
});

test('a re-tab route keeps the mounted screen; a route to another run swaps it', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun(), liveRun({ runId: 'r2', pipelineId: 'p2', title: 'Second' })]);
  await ctx.settle();
  const s1 = await openPanel(ctx, 'r1');
  assert.equal(await openPanel(ctx, 'r1/logs'), s1, 'a re-tab never re-mounts (no refetch, drafts kept)');
  assert.equal(s1.querySelector('.rd-tab.active').dataset.sec, 'logs');
  const s2 = await openPanel(ctx, 'r2');
  assert.notEqual(s2, s1);
  assert.equal(s2.querySelector('.rd-title').textContent, 'Second');
  assert.equal(ctx.window.__np.rdOpenRun().runId, 'r2');
});

test('a chat thread keeps its id in the panel address, its tab hops and its Close', async () => {
  const ctx = await bootLive();
  ctx.go('chat/ask_0000abcd/run/r1');
  await ctx.settle(6);
  const screen = screenOf(ctx);
  assert.ok(screen);
  click(ctx, screen.querySelector('.rd-tab[data-sec="logs"]'));
  await ctx.settle();
  assert.equal(ctx.window.location.hash, '#chat/ask_0000abcd/run/r1/logs');
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(ctx.window.location.hash, '#chat/ask_0000abcd');
});

test('a route keeps the tab key it was given; only a changed id rewrites the address', async () => {
  const ctx = await bootLive();
  await openPanel(ctx, 'r1/clarify');
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/clarify');
});

test('exactly 1500px wide, the history column stays beside the panel', async () => {
  const ctx = await bootLive();
  pageOf(ctx).dataset.history = 'open';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1500, configurable: true });
  await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'open');
});

test("the fold is not the user's choice: a column the user closed stays closed, the stored setting is untouched, and a fold is undone once", async () => {
  const ctx = await bootLive();
  const stored = () => ctx.window.localStorage.getItem('worca-cc.chat.history');
  const before = stored();
  pageOf(ctx).dataset.history = 'closed';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1280, configurable: true });
  let screen = await openPanel(ctx, 'r1');
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'closed', 'closed by the user: it stays closed');
  pageOf(ctx).dataset.history = 'open';
  screen = await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'closed');
  assert.equal(stored(), before, 'the fold is not persisted');
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'open');
  assert.equal(stored(), before);
  pageOf(ctx).dataset.history = 'closed';             // the user closes it
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1600, configurable: true });
  screen = await openPanel(ctx, 'r1');
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'closed', 'an earlier fold is not undone twice');
});

test('the window narrowing past 1500px with the panel open folds the history column; Close brings it back', async () => {
  const ctx = await bootLive();
  pageOf(ctx).dataset.history = 'open';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1600, configurable: true });
  const screen = await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'open');
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1280, configurable: true });
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  assert.equal(pageOf(ctx).dataset.history, 'closed');
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'open');
});

test("below P1's 1100px overlay breakpoint Close never re-opens the history column", async () => {
  const ctx = await bootLive();
  pageOf(ctx).dataset.history = 'open';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1280, configurable: true });
  const screen = await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'closed');
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1000, configurable: true });
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'closed', 'narrowed to an overlay width: it stays closed');
  pageOf(ctx).dataset.history = 'open';               // P1's overlay, open when the panel opens
  const again = await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'closed');
  click(ctx, again.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'closed', 'the overlay is the user\'s to open');
});

test('Close after a re-tab still returns focus to the opener', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  ctx.go('chat');
  await ctx.settle();
  const opener = doc.createElement('button');
  doc.querySelector('[data-view="chat"]').appendChild(opener);
  opener.focus();
  ctx.window.__np.routeChatRunPanel(['r1']);
  ctx.window.__np.routeChatRunPanel(['r1', 'logs']);
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(doc.activeElement, opener);
});

test('Back (a #chat route) with focus in the panel hands focus back to the opener', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  ctx.go('chat');
  await ctx.settle();
  const opener = doc.createElement('button');
  doc.querySelector('[data-view="chat"]').appendChild(opener);
  opener.focus();
  ctx.window.__np.routeChatRunPanel(['r1', 'logs']);
  screenOf(ctx).querySelector('.rd-tab[data-sec="diff"]').focus();
  ctx.go('chat');
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(doc.activeElement, opener);
});

test('Close with no opener to return to puts focus in the chat composer, never on the hidden panel', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  ctx.go('chat');
  await ctx.settle();
  if (doc.activeElement && doc.activeElement !== doc.body) doc.activeElement.blur();
  ctx.window.__np.routeChatRunPanel(['r1']);
  assert.equal(doc.activeElement, panelOf(ctx));
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  assert.ok(doc.activeElement.matches('[data-chat-page] textarea.ask-input'), `focus is on ${doc.activeElement.className}`);
});

test('closing the panel destroys the Workflow graph mounted in it', async () => {
  const ctx = await bootLive();
  let disconnects = 0;
  ctx.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() { disconnects += 1; } };
  const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, color: 'violet',
    ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
  const stepper = { version: 2, template: { id: 'wf_k', name: 'K' }, graph: {
    nodes: [agent('n_plan', 'planner'), { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
    wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] } };
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper, steps: [], active: [] });
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/workflow');
  assert.ok(screen.querySelector('.run-flow.gv-host'), 'a graph is mounted');
  const before = disconnects;
  ctx.go('chat');
  await ctx.settle();
  assert.ok(disconnects > before, 'its ResizeObserver was disconnected (the mount destroyed)');
});

test('the history column folds on the 1500px crossing only: wider or exactly 1500px keeps it, 1500 -> 1499 folds it, and with the panel closed a resize never folds it', async () => {
  const ctx = await bootLive();
  const resize = (w) => {
    Object.defineProperty(ctx.window, 'innerWidth', { value: w, configurable: true });
    ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  };
  pageOf(ctx).dataset.history = 'open';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1600, configurable: true });
  const screen = await openPanel(ctx, 'r1');
  resize(1700);
  assert.equal(pageOf(ctx).dataset.history, 'open', 'widening crosses nothing');
  resize(1500);
  assert.equal(pageOf(ctx).dataset.history, 'open', 'exactly 1500px still fits the column');
  resize(1499);
  assert.equal(pageOf(ctx).dataset.history, 'closed', 'from 1500px to below it folds');
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'open');
  resize(1600);
  resize(1280);
  assert.equal(pageOf(ctx).dataset.history, 'open', 'no panel: the column is the user\'s');
});

test('a non-Q&A route with a waiting question leaves focus on the panel (only Q&A jumps to the question)', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  ctx.dispatch({ type: 'question', runId: 'r1', id: 'gate-1', kind: 'gate', issues: [{ severity: 'minor', title: 'Naming', detail: 'foo -> bar' }] });
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/logs');
  assert.equal(screen.querySelector('.rd-tab.active').dataset.sec, 'logs');
  assert.equal(ctx.window.document.activeElement, panelOf(ctx), 'focus moved into the panel, not onto the question');
});

test('Back (a #chat route) with focus in the chat composer leaves it there; with focus lost (body) it goes to the opener', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  ctx.go('chat');
  await ctx.settle();
  const opener = doc.createElement('button');
  doc.querySelector('[data-view="chat"]').appendChild(opener);
  opener.focus();
  ctx.window.__np.routeChatRunPanel(['r1', 'logs']);
  const input = doc.querySelector('[data-chat-page] textarea.ask-input');
  input.focus();
  ctx.go('chat');
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(doc.activeElement, input, 'Back never pulls focus out of the composer');
  opener.focus();
  ctx.window.__np.routeChatRunPanel(['r1']);
  doc.activeElement.blur();
  assert.equal(doc.activeElement, doc.body, 'precondition: focus is nowhere');
  ctx.go('chat');
  await ctx.settle();
  assert.equal(doc.activeElement, opener, 'focus lost with the panel goes back to the opener');
});

test("exactly at P1's 1100px overlay breakpoint the column is not an overlay: Close re-opens a folded column", async () => {
  const ctx = await bootLive();
  pageOf(ctx).dataset.history = 'open';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1280, configurable: true });
  const screen = await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'closed');
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1100, configurable: true });
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'open');
});

test('Close after the opener left the page (a repainted chat card) puts focus in the chat composer', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  ctx.go('chat');
  await ctx.settle();
  const opener = doc.createElement('button');
  doc.querySelector('[data-view="chat"]').appendChild(opener);
  opener.focus();
  ctx.window.__np.routeChatRunPanel(['r1']);
  opener.remove();                                   // the card repainted meanwhile
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  assert.ok(doc.activeElement.matches('[data-chat-page] textarea.ask-input'), `focus is on ${doc.activeElement.tagName}.${doc.activeElement.className}`);
});

test('a history column the user re-opens beside the panel stays open while the window keeps resizing below 1500px', async () => {
  const ctx = await bootLive();
  const resize = (w) => {
    Object.defineProperty(ctx.window, 'innerWidth', { value: w, configurable: true });
    ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  };
  pageOf(ctx).dataset.history = 'open';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1280, configurable: true });
  await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'closed', 'precondition: the panel folded it');
  pageOf(ctx).dataset.history = 'open';               // the user opens it again (P1's toggle sets the attribute)
  resize(1279);
  resize(1200);
  assert.equal(pageOf(ctx).dataset.history, 'open', 'only the 1500px crossing folds it');
});

test('Runs page, slide layout: going back to the list empties the live host after the slide; a run re-opened during the slide keeps its screen', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  doc.getElementById('runs-shell').dataset.layout = 'slide';
  ctx.go('running/r1');
  await ctx.settle(6);
  ctx.go('runs');                                   // the slide-out: #run-detail empties after transitionend or 600 ms
  await ctx.settle();
  await new Promise((r) => setTimeout(r, 650));
  assert.equal(doc.querySelector('#run-detail').children.length, 0, 'no stale screen left in the page host');
  ctx.go('running/r1');
  await ctx.settle(6);
  ctx.go('runs');
  await ctx.settle();
  ctx.go('running/r1');                             // re-opened before the slide-out's clear runs
  await ctx.settle(6);
  await new Promise((r) => setTimeout(r, 650));
  assert.ok(doc.querySelector('#run-detail .rd'), 'the re-opened screen survives the earlier clear');
});

test("a history column the user opens and then closes again beside the panel stays closed after Close (the user's last word)", async () => {
  const ctx = await bootLive();
  pageOf(ctx).dataset.history = 'open';
  Object.defineProperty(ctx.window, 'innerWidth', { value: 1280, configurable: true });
  const screen = await openPanel(ctx, 'r1');
  assert.equal(pageOf(ctx).dataset.history, 'closed', 'precondition: the panel folded it');
  const toggle = ctx.window.document.querySelector('[data-chat-page] [data-ask-threads-btn]');
  click(ctx, toggle);                                 // the user opens it beside the panel
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'open');
  click(ctx, toggle);                                 // and closes it again
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'closed');
  click(ctx, screen.querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(pageOf(ctx).dataset.history, 'closed', "Close never undoes the user's own close");
});
