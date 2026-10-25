// test/ask-panel-side.test.mjs — Ask worca beside the page on the panel alone (ask-panel-harness): the composer's page
// chips, "Leave … out" and the "on <page>" caption (Task 4), then the side column host (Task 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, key, deleteFromList } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { pageChips } from '../ui/public/ask-page-chips.mjs';

const TID = 'ask_00000001';
const U = '0f0f0f0f-0000-4000-8000-000000000001';
const RUN = { view: 'running', runId: U, pipelineId: 'aaaa1111', runPage: 'diff', diffPath: 'a.mjs', pinned: false };
const RUN_CHIPS = [
  { id: 'run:aaaa1111', kind: 'run', caption: 'Run', name: 'Deck', icon: 'run', leaveOut: 'Leave this run out', keys: ['runId', 'pipelineId', 'runPage', 'diffPath', 'view'], status: 'done' },
  { id: 'file:a.mjs', kind: 'file', caption: 'File', name: 'a.mjs', icon: 'diff', leaveOut: 'Leave this file out', keys: ['diffPath'], parent: 'run:aaaa1111' },
];
const PROJECTS_PAGE = { ctx: { view: 'projects' }, chips: [{ id: 'page:projects', kind: 'page', caption: 'Page', name: 'Projects', icon: 'project', leaveOut: 'Leave this page out', keys: ['view'] }] };
const threadRow = (title = null, context = null) => ({ id: TID, title, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context, totals: {} });
const userRow = (id, seq, text, blocks = []) => ({ id, threadId: TID, seq, role: 'user', text, blocks, status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' });
const snapOf = (messages = [], context = null) => ({ thread: threadRow('Deck chat', context), messages, attachments: [], runLinks: [], worktrees: [], inFlight: null });

/** Records the message POST bodies, the MCP preview bodies and the chat GETs; `state.snap` answers the chat's GET. */
function api(state) {
  state.bodies ||= [];
  state.previews ||= [];
  state.gets ||= 0;
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/ask/threads' && method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: threadRow() }) };
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      state.bodies.push(JSON.parse(opts.body));
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', assistantMessageId: 'askm_00000009' }) };
    }
    if (method === 'PATCH') { (state.patches ||= []).push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ thread: { id: TID } }) }; }
    if (url === '/api/ask/mcp-preview') { state.previews.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET' && state.snap) { state.gets += 1; return { ok: true, status: 200, json: async () => state.snap }; }
    if (url.startsWith('/api/ask/threads') && method === 'GET') return { ok: true, status: 200, json: async () => ({ threads: state.list || [], total: (state.list || []).length }) };
    if (state.options && state.options[url]) return { ok: true, status: 200, json: async () => state.options[url] };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
const ticks = async (ctx, n = 3) => { for (let i = 0; i < n; i++) await ctx.tick(); };
const chipIds = (doc) => [...doc.querySelectorAll('[data-ask-page-chips] .ask-page-chip:not([hidden])')].map((n) => n.dataset.chipId);
const send = async (ctx, text) => {
  ctx.doc.querySelector('textarea.ask-input').value = text;
  ctx.doc.querySelector('[data-ask-send]').click();
  await ticks(ctx, 4);
};
/** A page the test moves between: `page.set(next)` then a hashchange, as app.js routes. */
function pageOf(initial) {
  const page = { ctx: initial.ctx, chips: initial.chips };
  return {
    page,
    deps: { getPageContext: () => page.ctx, deps: { getPageChips: () => page.chips } },
    go(ctx, next) { page.ctx = next.ctx; page.chips = next.chips; ctx.window.dispatchEvent(new ctx.window.Event('hashchange')); },
  };
}

test('the composer shows the page chips after the lead row and repaints on a page change', async () => {
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api({}), ...p.deps });
  ctx.panel.open();
  assert.deepEqual(chipIds(ctx.doc), ['run:aaaa1111', 'file:a.mjs']);
  const row = ctx.doc.querySelector('[data-ask-page-chips]');
  assert.equal(row.hidden, false);
  assert.ok(row.previousElementSibling.matches('[data-chat-composer-lead]'), 'the lead row stays the first child');
  assert.equal(row.querySelector('.ask-page-chip-x').getAttribute('aria-label'), 'Leave this run out');
  assert.deepEqual([...row.querySelectorAll('.ask-page-chip-cap')].map((n) => n.textContent), ['Run', 'File']);
  assert.equal(row.querySelector('.ask-page-chip-name').textContent, 'Deck');
  p.go(ctx, PROJECTS_PAGE);
  assert.deepEqual(chipIds(ctx.doc), ['page:projects']);
  p.page.ctx = { view: 'chat' };
  p.page.chips = [];
  ctx.panel.contextChanged();
  assert.equal(row.hidden, true);
  p.page.ctx = RUN;
  p.page.chips = RUN_CHIPS;
  ctx.panel.pageChanged();
  assert.deepEqual(chipIds(ctx.doc), ['run:aaaa1111', 'file:a.mjs'], 'pageChanged repaints without a hashchange');
  ctx.panel.destroy();
});

test('leaving the run out hides its file chip and keeps both out of the next message and the Sets preview', async () => {
  const state = {};
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api(state), ...p.deps });
  ctx.panel.open();
  ctx.doc.querySelector('.ask-page-chip-x').click();
  assert.deepEqual(chipIds(ctx.doc), [], 'the file goes with its run');
  ctx.panel.contextChanged();
  assert.deepEqual(chipIds(ctx.doc), [], 'still out while the run is on screen');
  await ticks(ctx);
  const preview = state.previews.at(-1).context;
  for (const k of ['runId', 'pipelineId', 'runPage', 'diffPath', 'view']) assert.equal(k in preview, false, `preview ${k}`);
  await send(ctx, 'why?');
  assert.equal(state.bodies.length, 1);
  const sent = state.bodies[0].context;
  for (const k of ['runId', 'pipelineId', 'runPage', 'diffPath', 'view']) assert.equal(k in sent, false, k);
  assert.equal(sent.pinned, false);
  ctx.panel.destroy();
});

test('leaving the file out keeps the run', async () => {
  const state = {};
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api(state), ...p.deps });
  ctx.panel.open();
  ctx.doc.querySelectorAll('.ask-page-chip-x')[1].click();
  assert.deepEqual(chipIds(ctx.doc), ['run:aaaa1111']);
  await send(ctx, 'and this?');
  const sent = state.bodies[0].context;
  assert.equal('diffPath' in sent, false);
  assert.deepEqual([sent.view, sent.runId, sent.pipelineId, sent.runPage], ['running', U, 'aaaa1111', 'diff']);
  ctx.panel.destroy();
});

test('left-out chips are pruned to the chips on screen: a later visit brings them back', async () => {
  const state = {};
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api(state), ...p.deps });
  ctx.panel.open();
  ctx.doc.querySelector('.ask-page-chip-x').click();
  assert.deepEqual(chipIds(ctx.doc), []);
  p.go(ctx, PROJECTS_PAGE);
  assert.deepEqual(chipIds(ctx.doc), ['page:projects']);
  p.go(ctx, { ctx: RUN, chips: RUN_CHIPS });
  assert.deepEqual(chipIds(ctx.doc), ['run:aaaa1111', 'file:a.mjs'], 'back on the run: both chips again');
  await send(ctx, 'now?');
  assert.equal(state.bodies[0].context.runId, U, 'and the run rides again');
  ctx.panel.destroy();
});

test('a chip left out stays out through a send and the next message; a later visit brings it back', async () => {
  const state = {};
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api(state), ...p.deps });
  ctx.panel.open();
  ctx.doc.querySelectorAll('.ask-page-chip-x')[1].click();          // the file left out
  await send(ctx, 'one');
  assert.deepEqual(chipIds(ctx.doc), ['run:aaaa1111'], 'still out after the send');
  let seq = 0;
  const push = (bare) => { seq += 1; ctx.panel.pushServerFrame({ ...bare, threadId: TID, messageId: 'askm_00000009', seq }); ctx.flush(); };
  push({ type: 'ask-start', userMessageId: 'askm_u0000009', model: 'm', effort: 'high', startedAt: 't' });
  push({ type: 'ask-done', text: 'ok', blocks: [], usage: null, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {} });
  await ticks(ctx, 4);
  await send(ctx, 'two');
  assert.equal(state.bodies.length, 2);
  assert.equal('diffPath' in state.bodies[1].context, false, 'the next message leaves the file out too');
  assert.equal(state.bodies[1].context.runId, U, 'and keeps the run');
  p.go(ctx, PROJECTS_PAGE);
  p.go(ctx, { ctx: RUN, chips: RUN_CHIPS });
  assert.deepEqual(chipIds(ctx.doc), ['run:aaaa1111', 'file:a.mjs'], 'a later visit brings it back');
  ctx.panel.destroy();
});

test('a file left out on one run is not left out on the next run that shows the same file (the chips the page builds)', async () => {
  const state = {};
  const A = { view: 'history-detail', pipelineId: 'aaaa1111', runPage: 'diff', diffPath: 'a.mjs', pinned: false };
  const page = { ctx: A };
  const ctx = makePanel({ fetchHandler: api(state), getPageContext: () => page.ctx, deps: { getPageChips: () => pageChips(page.ctx) } });
  ctx.panel.open();
  ctx.doc.querySelectorAll('.ask-page-chip-x')[1].click();
  assert.deepEqual(chipIds(ctx.doc), ['run:aaaa1111']);
  page.ctx = { ...A, pipelineId: 'bbbb2222' };                     // straight to another run's Diff, same first file
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  assert.deepEqual(chipIds(ctx.doc), ['run:bbbb2222', 'file:bbbb2222:a.mjs'], 'the other run shows its file');
  await send(ctx, 'and here?');
  assert.equal(state.bodies[0].context.diffPath, 'a.mjs', 'and sends it');
  ctx.panel.destroy();
});

test('a queued message keeps the page it was typed on, not the page on screen when the queue sends it', async () => {
  const state = {};
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api(state), ...p.deps });
  ctx.panel.open();
  await send(ctx, 'first');
  assert.equal(state.bodies.length, 1);
  let seq = 0;
  const push = (bare) => { seq += 1; ctx.panel.pushServerFrame({ ...bare, threadId: TID, messageId: 'askm_00000009', seq }); ctx.flush(); };
  push({ type: 'ask-start', userMessageId: 'askm_u0000009', model: 'm', effort: 'high', startedAt: 't' });
  ctx.doc.querySelectorAll('.ask-page-chip-x')[1].click();          // the file left out while typing
  await send(ctx, 'and this run?');
  assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 1, 'queued behind the reply');
  p.go(ctx, PROJECTS_PAGE);                                         // the person moves on while it waits
  push({ type: 'ask-done', text: 'ok', blocks: [], usage: null, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {} });
  await ticks(ctx, 6);
  ctx.flush();
  assert.equal(state.bodies.length, 2, 'the queue sent it');
  const sent = state.bodies[1].context;
  assert.equal(state.bodies[1].text, 'and this run?');
  assert.deepEqual([sent.view, sent.runId, sent.runPage, 'diffPath' in sent], ['running', U, 'diff', false], 'the run page it was typed on, minus the chip left out then');
  ctx.panel.destroy();
});

test('a page chip draws its icon, caption, titled name and a × with its glyph, label and title', async () => {
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api({}), ...p.deps });
  ctx.panel.open();
  const chip = ctx.doc.querySelector('.ask-page-chip');
  assert.ok(chip.querySelector(':scope > .ic svg'), 'the page icon leads the chip');
  assert.equal(chip.querySelector('.ask-page-chip-name').title, 'Deck', 'a long name is readable in full on hover');
  const x = chip.querySelector('.ask-page-chip-x');
  assert.ok(x.querySelector('svg'), 'the × button draws a glyph');
  assert.equal(x.title, 'Leave this run out');
  ctx.panel.destroy();
});

test('a repaint that changes nothing keeps the chip row and its focus; a new name repaints', async () => {
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api({}), ...p.deps });
  ctx.panel.open();
  const x = ctx.doc.querySelector('.ask-page-chip-x');
  x.focus();
  ctx.panel.pageChanged();
  assert.equal(ctx.doc.querySelector('.ask-page-chip-x'), x, 'the same node');
  assert.equal(ctx.doc.activeElement, x, 'with its focus');
  p.page.chips = [{ ...RUN_CHIPS[0], name: 'Deck v2' }, RUN_CHIPS[1]];
  ctx.panel.pageChanged();
  assert.equal(ctx.doc.querySelector('.ask-page-chip-name').textContent, 'Deck v2', 'a run title that lands later repaints');
  ctx.panel.destroy();
});

test('leaving a chip out in No project re-previews the Sets at once and puts the focus in the composer', async () => {
  const state = {};
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api(state), ...p.deps });
  ctx.panel.open();
  await ticks(ctx, 8);
  const before = state.previews.length;
  const x = ctx.doc.querySelector('.ask-page-chip-x');
  x.focus();
  x.click();
  await ticks(ctx, 8);
  assert.equal(state.previews.length, before + 1, 'one new preview, without waiting for a route');
  assert.equal('runId' in state.previews.at(-1).context, false);
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'), 'the × is gone; the focus goes to the composer');
  ctx.panel.destroy();
});

test('a user row with a where block shows "on <label>"; one without shows nothing', async () => {
  const state = { snap: snapOf([
    userRow('askm_u0000001', 1, 'what changed?', [{ kind: 'where', label: 'Run · Diff', icon: 'diff' }]),
    userRow('askm_u0000002', 2, 'and on Chat?', []),
    userRow('askm_u0000003', 3, 'old icon', [{ kind: 'where', label: 'Projects', icon: 'not-an-icon' }]),
  ]) };
  const ctx = makePanel({ fetchHandler: api(state) });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx, 4);
  ctx.flush();
  const users = [...ctx.doc.querySelectorAll('.ask-msg-user')];
  assert.equal(users.length, 3);
  assert.deepEqual(users.map((u) => u.querySelector('.ask-user-where')?.textContent ?? null), ['on Run · Diff', null, 'on Projects']);
  assert.ok(users[0].querySelector('.ask-user-where svg'), 'a known icon leads the caption');
  assert.equal(users[2].querySelector('.ask-user-where svg'), null, 'an unknown icon name draws nothing');
  assert.equal(users[0].lastElementChild.className, 'ask-user-where', 'under the bubble');
  ctx.panel.destroy();
});

// ---- Task 5: the side column host -------------------------------------------------------------------------------
const OPTIONS = {
  '/api/projects': { projects: [{ key: 'demo-00000001', name: 'Demo', path: '/Users/me/demo', exists: true, vcs: 'git' }] },
  '/api/workflows': { workflows: [] },
  '/api/guardrails': { guardrails: [] },
  '/api/workspaces': { workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: [], projectPaths: [] }] },
};
const DEMO = { pinned: true, projectKey: 'demo-00000001', label: 'Demo' };
const TEAM = { pinned: true, workspaceId: 'wks-team-0000abcd', label: 'Team' };
const scopeLabel = (doc) => doc.querySelector('[data-ask-scope-btn]').getAttribute('aria-label');
const hashchange = (ctx) => ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
const listRow = (id, title) => ({ id, title, createdAt: '2026-10-24T10:00:00.000Z', updatedAt: '2026-10-24T10:00:00.000Z', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false });

test('setHost: the side column marks the root, shows its own head, closes the History column; any other host is ignored', async () => {
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 1600 });
  const page = ctx.panel.root;
  assert.equal(ctx.panel.host(), 'page');
  assert.equal(page.dataset.host, 'page');
  assert.equal(page.dataset.history, 'open', 'from 1600px the Chat page opens its History column');
  ctx.panel.setHost('dock');
  assert.equal(ctx.panel.host(), 'dock');
  assert.equal(page.dataset.host, 'dock');
  assert.equal(page.dataset.history, 'closed', 'a dropdown in the column: closed on the way in');
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null, 'never a stored choice');
  for (const sel of ['[data-ask-side-thread]', '[data-ask-side-new][data-ask-new-btn]', '[data-ask-open-in-chat]', '[data-ask-side-hide]', '[data-ask-history-in-chat]', '[data-ask-side-empty]']) assert.ok(page.querySelector(sel), sel);
  assert.deepEqual(['[data-ask-side-new]', '[data-ask-open-in-chat]', '[data-ask-side-hide]'].map((s) => page.querySelector(s).getAttribute('aria-label')), ['New chat', 'Open in Chat', 'Hide chat']);
  ctx.panel.setHost('sideways');
  assert.equal(ctx.panel.host(), 'dock');
  ctx.panel.setHost('page');
  assert.equal(page.dataset.host, 'page');
  assert.equal(page.dataset.history, 'open', 'back on the Chat page: the stored (or default) choice');
  ctx.panel.destroy();
});

test('an empty chat in the side column: the composer stays docked, the page suggestions fill it and send nothing', async () => {
  const state = {};
  const ctx = makePanel({ fetchHandler: api(state), getPageContext: () => ({ view: 'projects' }), deps: { getPageChips: () => PROJECTS_PAGE.chips } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx);
  assert.equal(ctx.panel.root.dataset.view, 'home');
  assert.ok(ctx.doc.querySelector('[data-chat-dock] > .ask-composer'), 'no hero in the column: the composer is docked');
  assert.equal(ctx.doc.querySelector('.ask-side-empty-h').textContent, 'Ask about your projects');
  const opts = [...ctx.doc.querySelectorAll('[data-ask-side-suggest] .ask-side-opt')];
  assert.deepEqual(opts.map((b) => b.textContent), ['Which projects have Team metrics off?', 'Which projects are behind origin?']);
  const input = ctx.doc.querySelector('textarea.ask-input');
  opts[0].click();
  assert.equal(input.value, 'Which projects have Team metrics off?');
  assert.equal(ctx.doc.activeElement, input);
  input.value = 'draft';
  opts[1].click();
  assert.equal(input.value, 'draft\nWhich projects are behind origin?', 'a draft keeps its text');
  await ticks(ctx);
  assert.equal(state.bodies.length, 0, 'nothing was sent');
  ctx.panel.setHost('page');
  assert.ok(ctx.doc.querySelector('[data-chat-hero-slot] > .ask-composer'), 'the Chat page puts it back in the hero slot');
  ctx.panel.destroy();
});

test('Hide chat, Open in Chat and the chats menu: the side actions, a dropdown that Escape and the scrim close', async () => {
  const calls = [];
  const sideActions = { hide: () => calls.push(['hide']), openInChat: (id) => calls.push(['openInChat', id]), openHistoryInChat: () => calls.push(['history']) };
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]), list: [listRow(TID, 'Deck chat')] };
  const ctx = makePanel({ fetchHandler: api(state), innerWidth: 1600, deps: { sideActions } });
  ctx.panel.setHost('dock');
  ctx.panel.open({ threadId: TID });
  await ticks(ctx, 4);
  ctx.flush();
  const page = ctx.panel.root;
  const menu = ctx.doc.querySelector('[data-ask-side-thread]');
  assert.equal(menu.textContent, 'Deck chat', "the menu button names the chat");
  ctx.doc.querySelector('[data-ask-open-in-chat]').click();
  ctx.doc.querySelector('[data-ask-side-hide]').click();
  assert.deepEqual(calls, [['openInChat', TID], ['hide']]);
  menu.click();
  assert.equal(page.dataset.history, 'open');
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, false, 'its scrim catches a press outside');
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null, 'a dropdown is never a stored choice');
  const e = key(ctx.window, ctx.doc.activeElement, 'Escape');
  assert.equal(e.defaultPrevented, true);
  assert.equal(page.dataset.history, 'closed');
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(ctx.doc.activeElement, menu, 'focus back on the chats menu, not the hidden History button');
  menu.click();
  ctx.doc.querySelector('[data-chat-scrim]').click();
  assert.equal(page.dataset.history, 'closed');
  assert.equal(ctx.doc.activeElement, menu);
  menu.click();
  ctx.doc.querySelector('[data-ask-history-in-chat]').click();
  assert.equal(page.dataset.history, 'closed');
  assert.deepEqual(calls.at(-1), ['history']);
  ctx.panel.destroy();
});

test('a new chat in the side column starts in the page scope and follows the page until a send; the Chat page stays No project', async () => {
  const state = { options: OPTIONS };
  let scope = DEMO;
  const ctx = makePanel({ fetchHandler: api(state), getPageContext: () => ({ view: 'project-detail', pageProjectKey: 'demo-00000001' }), deps: { getPageScope: () => scope } });
  ctx.panel.open();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: No project', 'the Chat page: a new chat is No project (D1)');
  ctx.panel.setHost('dock');
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo', 'the column: the page scope');
  scope = TEAM;
  hashchange(ctx);
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Team');
  scope = null;
  hashchange(ctx);
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: No project');
  scope = DEMO;
  ctx.panel.pageChanged();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo');
  await send(ctx, 'hi');
  assert.deepEqual([state.bodies[0].context.pinned, state.bodies[0].context.projectKey], [true, 'demo-00000001']);
  scope = TEAM;
  hashchange(ctx);
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo', 'a chat with a message keeps its scope');
  ctx.doc.querySelector('[data-ask-side-new]').click();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Team', 'New chat in the column: the page scope again');
  ctx.panel.setHost('page');
  ctx.doc.querySelector('.chat-head > [data-ask-new-btn]').click();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: No project', 'New chat on the Chat page: No project');
  ctx.panel.destroy();
});

test('a pill pick stops the page scope from following', async () => {
  const state = { options: OPTIONS };
  let scope = DEMO;
  const ctx = makePanel({ fetchHandler: api(state), getPageContext: () => ({ view: 'runs' }), deps: { getPageScope: () => scope } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo');
  ctx.doc.querySelector('[data-ask-scope-btn]').click();
  await ticks(ctx);
  [...ctx.doc.querySelectorAll('.ask-scope-item')].find((i) => i.querySelector('.ask-model-name').textContent === 'No project').click();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: No project');
  scope = TEAM;
  hashchange(ctx);
  ctx.panel.pageChanged();
  ctx.panel.setHost('page');
  ctx.panel.setHost('dock');
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: No project', 'the page never overwrites a pick');
  assert.deepEqual(state.patches || [], [], 'no row yet: nothing PATCHed');
  ctx.panel.destroy();
});

test('a scope app.js sets (a project just added from the chat) is a pick too', async () => {
  const state = { options: OPTIONS };
  let scope = DEMO;
  const ctx = makePanel({ fetchHandler: api(state), getPageContext: () => ({ view: 'runs' }), deps: { getPageScope: () => scope } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo');
  assert.equal(ctx.panel.setScope({ pinned: true, projectKey: 'notes-00000003', label: 'Notes' }), true);
  scope = TEAM;
  hashchange(ctx);
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Notes');
  ctx.panel.destroy();
});

test('a chat with messages keeps its scope when it moves to the column or the page changes', async () => {
  const state = { options: OPTIONS, snap: snapOf([userRow('askm_u0000001', 1, 'hi')], { pinned: true, projectKey: 'demo-00000001' }) };
  let scope = TEAM;
  const ctx = makePanel({ fetchHandler: api(state), deps: { getPageScope: () => scope } });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx, 4);
  ctx.flush();
  assert.match(scopeLabel(ctx.doc), /^Chat scope: (Demo|demo-00000001)$/);
  ctx.panel.setHost('dock');
  hashchange(ctx);
  assert.match(scopeLabel(ctx.doc), /^Chat scope: (Demo|demo-00000001)$/);
  ctx.panel.destroy();
});

test('moving host mid-reply keeps the live row, its orb and the queue: nothing is rebuilt or refetched', async () => {
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]) };
  const ctx = makePanel({ fetchHandler: api(state) });
  ctx.panel.setHost('dock');
  ctx.panel.open({ threadId: TID });
  await ticks(ctx, 4);
  ctx.flush();
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'claude-opus-5-5', effort: 'high', startedAt: '2026-10-24T10:00:00.000Z' },
    { type: 'ask-delta', text: 'Hel' },
    { type: 'ask-delta', text: 'lo' },
  ], { threadId: TID, messageId: 'askm_00000002' });
  ctx.panel.pushServerFrame(frames[0]);
  ctx.panel.pushServerFrame(frames[1]);
  ctx.flush();
  const live = ctx.doc.querySelector('.ask-msg-assistant');
  assert.ok(live && live.querySelector('.ask-thinking'), 'a live reply with its orb row');
  await send(ctx, 'and then?');
  assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 1, 'queued behind the reply');
  const gets = state.gets;
  const section = ctx.doc.createElement('section');
  ctx.doc.body.appendChild(section);
  section.appendChild(ctx.panel.root);                      // app.js moves the root, then flips the host
  ctx.panel.setHost('page');
  ctx.panel.pushServerFrame(frames[2]);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-msg-assistant'), live, 'the same live row');
  assert.ok(live.isConnected && live.querySelector('.ask-thinking'), 'still live, orb and all');
  assert.match(live.querySelector('.ask-answer').textContent, /Hello/);
  assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 1, 'the queue came along');
  assert.equal(ctx.doc.querySelector('[data-ask-queue]').hidden, false);
  ctx.doc.body.appendChild(ctx.panel.root);
  ctx.panel.setHost('dock');
  assert.equal(ctx.doc.querySelector('.ask-msg-assistant'), live, 'and back');
  assert.equal(state.gets, gets, 'no chat refetch');
  assert.equal(ctx.panel.threadId(), TID);
  ctx.panel.destroy();
});

test('the column lists the 3 newest chats under the suggestions; a row opens that chat', async () => {
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]), list: [listRow(TID, 'Deck chat'), listRow('ask_00000002', 'Two'), listRow('ask_00000003', 'Three'), listRow('ask_00000004', 'Four')] };
  const ctx = makePanel({ fetchHandler: api(state) });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  const rows = [...ctx.doc.querySelectorAll('.ask-side-recent-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.ask-side-recent-t').textContent), ['Deck chat', 'Two', 'Three']);
  assert.equal(ctx.doc.querySelector('.ask-side-recent').hidden, false);
  rows[0].click();
  await ticks(ctx, 4);
  ctx.flush();
  assert.equal(state.gets, 1, 'the chat loads');
  assert.equal(ctx.panel.root.dataset.view, 'thread');
  ctx.panel.destroy();
});

test('a route that brings the column back leaves the focus on the page; the button focuses the composer', async () => {
  const ctx = makePanel({ fetchHandler: api({}) });
  ctx.panel.setHost('dock');
  ctx.panel.open(undefined, { focus: false });
  const input = ctx.doc.querySelector('textarea.ask-input');
  assert.notEqual(ctx.doc.activeElement, input);
  ctx.panel.close();
  ctx.panel.open();
  assert.equal(ctx.doc.activeElement, input);
  ctx.panel.destroy();
});

test('tier crossing with the chats menu open: the dropdown stays open (the column is always an overlay)', async () => {
  const state = { list: [listRow(TID, 'Deck chat')] };
  const ctx = makePanel({ fetchHandler: api(state), innerWidth: 1440 });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx);
  ctx.doc.querySelector('[data-ask-side-thread]').click();
  assert.equal(ctx.panel.root.dataset.history, 'open');
  for (const w of [1000, 1440, 700]) {
    Object.defineProperty(ctx.window, 'innerWidth', { value: w, configurable: true });
    ctx.window.dispatchEvent(new ctx.window.Event('resize'));
    assert.equal(ctx.panel.root.dataset.history, 'open', `still open at ${w}px`);
    assert.equal(ctx.doc.querySelector('[data-chat-scrim]').hidden, false);
  }
  assert.equal(ctx.storage.getItem('worca-cc.chat.history'), null);
  ctx.panel.destroy();
});

test('moving host keeps a pinned reply at the bottom: a scroller that comes back at the top is pinned again', async () => {
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]) };
  const ctx = makePanel({ fetchHandler: api(state) });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx, 4);
  ctx.flush();
  const t = ctx.doc.querySelector('.ask-transcript');
  Object.defineProperty(t, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 400, configurable: true });
  t.scrollTop = 600;
  const section = ctx.doc.createElement('section');
  ctx.doc.body.appendChild(section);
  section.appendChild(ctx.panel.root);
  t.scrollTop = 0;                                          // a browser resets a scroller the DOM move detached
  ctx.panel.setHost('dock');                                // moved with the chat open (the panel API allows it)
  assert.equal(t.scrollTop, 1000, 'back at the bottom');
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, true, 'still pinned: no Jump to latest');
  ctx.panel.close();                                        // app.js's own order: hide, move, flip the host, show
  ctx.doc.body.appendChild(ctx.panel.root);
  t.scrollTop = 0;
  ctx.panel.setHost('page');
  ctx.panel.open(undefined, { focus: false });
  ctx.flush();
  assert.equal(t.scrollTop, 1000, 'the show after the move pins it too');
  ctx.panel.destroy();
});

test('Open in Chat of a column chat with no row yet keeps that new chat: its page scope and its draft (L8)', async () => {
  const state = { options: OPTIONS };
  const ctx = makePanel({ fetchHandler: api(state), getPageContext: () => ({ view: 'project-detail', pageProjectKey: 'demo-00000001' }), deps: { getPageScope: () => DEMO } });
  ctx.panel.setHost('dock');
  ctx.panel.open();                                         // the first show of the session: nothing stored, nothing shown yet
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo');
  ctx.doc.querySelector('textarea.ask-input').value = 'my draft';
  ctx.panel.close();
  ctx.panel.setHost('page');                                // app.js: the column hides, chat/new routes the Chat page
  ctx.panel.open({ threadId: null });
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo', 'the same new chat, its scope kept');
  assert.equal(ctx.doc.querySelector('textarea.ask-input').value, 'my draft');
  assert.equal(ctx.panel.root.dataset.view, 'home');
  ctx.panel.destroy();
});

test("Pinpoint's send on the column's first show waits for the stored chat, then sends in it", async () => {
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]) };
  const ctx = makePanel({ fetchHandler: api(state) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.setHost('dock');
  ctx.panel.open();                                         // restores the stored chat: still loading
  assert.equal(ctx.panel.sendQuoted({ quote: { text: 'the span' }, text: 'Go deeper' }), true);
  await ticks(ctx, 8);
  ctx.flush();
  assert.equal(state.bodies.length, 1, 'sent once the chat is there');
  assert.match(state.bodies[0].text, /Go deeper/);
  assert.equal(ctx.doc.querySelector('textarea.ask-input').value, '', 'nothing left behind in the composer');
  ctx.panel.destroy();
});

test('a press on the page beside the column closes the chats menu', async () => {
  const state = { list: [listRow(TID, 'Deck chat')] };
  const ctx = makePanel({ fetchHandler: api(state) });
  const outside = ctx.doc.createElement('div');
  ctx.doc.body.appendChild(outside);
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx);
  ctx.doc.querySelector('[data-ask-side-thread]').click();
  assert.equal(ctx.panel.root.dataset.history, 'open');
  ctx.doc.querySelector('.chat-history').dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  assert.equal(ctx.panel.root.dataset.history, 'open', 'a press inside the menu keeps it');
  outside.dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  assert.equal(ctx.panel.root.dataset.history, 'closed');
  ctx.panel.destroy();
});

const optTexts = (doc) => [...doc.querySelectorAll('[data-ask-side-suggest] .ask-side-opt')].map((b) => b.textContent);

test('the chats menu button is a labelled popup control', async () => {
  const ctx = makePanel({ fetchHandler: api({}) });
  ctx.panel.setHost('dock');
  const menu = ctx.doc.querySelector('[data-ask-side-thread]');
  assert.equal(menu.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(menu.getAttribute('aria-controls'), 'chat-history');
  assert.ok(ctx.doc.getElementById('chat-history'), 'and the id it controls exists');
  ctx.panel.destroy();
});

test('the empty state follows the run on screen: its status, its Diff file, and it keeps its buttons across a no-op repaint', async () => {
  const p = pageOf({ ctx: RUN, chips: RUN_CHIPS });
  const ctx = makePanel({ fetchHandler: api({}), ...p.deps });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  assert.deepEqual(optTexts(ctx.doc), ['Explain the changes in this file', 'What did it change?', 'Is it ready to ship?', 'Start a run after this one']);
  const first = ctx.doc.querySelector('.ask-side-opt');
  ctx.panel.pageChanged();
  assert.equal(ctx.doc.querySelector('.ask-side-opt'), first, 'a repaint that changes nothing keeps the buttons');
  p.page.chips = [{ ...RUN_CHIPS[0], status: 'error' }, RUN_CHIPS[1]];
  ctx.panel.pageChanged();
  assert.deepEqual(optTexts(ctx.doc), ['Explain the changes in this file', 'Why did it stop?', 'What did it change?', 'Start a run after this one'], 'same heading, new items');
  p.page.ctx = { ...RUN };
  delete p.page.ctx.diffPath;
  ctx.panel.pageChanged();
  assert.deepEqual(optTexts(ctx.doc), ['Why did it stop?', 'What did it change?', 'Start a run after this one']);
  ctx.doc.querySelector('.ask-page-chip-x').click();                 // the run left out: the page says nothing of it
  assert.equal(ctx.doc.querySelector('.ask-side-empty-h').textContent, 'Ask worca');
  ctx.panel.destroy();
});

test('a suggestion fills the composer: the field grows to fit, the caret waits at the end, the focus follows the click', async () => {
  const p = pageOf({ ctx: { view: 'projects' }, chips: [] });
  const ctx = makePanel({ fetchHandler: api({}), ...p.deps });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  const other = ctx.doc.createElement('button');
  ctx.doc.body.appendChild(other);
  other.focus();
  const input = ctx.doc.querySelector('textarea.ask-input');
  Object.defineProperty(input, 'scrollHeight', { value: 64, configurable: true });
  ctx.doc.querySelector('.ask-side-opt').click();
  assert.equal(input.value, 'Which projects have Team metrics off?');
  assert.equal(input.selectionStart, input.value.length, 'the caret waits at the end');
  assert.equal(ctx.doc.activeElement, input, 'the focus follows the click');
  assert.equal(input.style.height, '64px', 'a suggestion that wraps makes the field grow, as typing does');
  ctx.panel.destroy();
});

test('the column lists untitled chats as New chat, hides the Recent block when there are none, and its History button opens the menu', async () => {
  const none = makePanel({ fetchHandler: api({ list: [] }) });
  none.panel.setHost('dock');
  none.panel.open();
  await ticks(none, 4);
  assert.equal(none.doc.querySelector('.ask-side-recent').hidden, true, 'no chats: no Recent chats caption and no History button');
  none.panel.destroy();
  const ctx = makePanel({ fetchHandler: api({ list: [listRow('ask_00000005', null), listRow('ask_00000006', 'Two')] }) });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  const rows = [...ctx.doc.querySelectorAll('.ask-side-recent-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.ask-side-recent-t').textContent), ['New chat', 'Two']);
  assert.ok(rows[0].querySelector('.ask-side-recent-meter'), 'each row carries its meter');
  assert.equal(ctx.doc.querySelector('.ask-side-recent').hidden, false);
  ctx.doc.querySelector('.ask-side-history').click();
  assert.equal(ctx.panel.root.dataset.history, 'open');
  ctx.panel.destroy();
});

test('a Chats column view other than All (Archived, Needs you) never replaces the recent chats the empty state lists', async () => {
  const state = { list: [listRow('ask_00000005', 'Alpha'), listRow('ask_00000006', 'Beta')] };
  const ctx = makePanel({ fetchHandler: (url, o) => {
    if (url.startsWith('/api/ask/threads?') && /[?&]show=archived/.test(url)) return { ok: true, status: 200, json: async () => ({ threads: [{ ...listRow('ask_00000009', 'Gamma archived'), archivedAt: '2026-10-24T11:00:00.000Z' }], total: 1 }) };
    return api(state)(url, o);
  } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  const recent = () => [...ctx.doc.querySelectorAll('.ask-side-recent-row .ask-side-recent-t')].map((n) => n.textContent);
  assert.deepEqual(recent(), ['Alpha', 'Beta']);
  ctx.doc.querySelector('[data-ask-side-thread]').click();
  ctx.doc.querySelector('#chats-view-btn').click();
  [...ctx.doc.querySelectorAll('.wfv-menu [role="menuitemradio"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Archived').click();
  await ticks(ctx, 6);
  assert.ok(ctx.doc.querySelector('[data-chat-history] a.runs-row[data-row-key="chat:ask_00000009"]'), 'the menu shows the archived chat');
  assert.deepEqual(recent(), ['Alpha', 'Beta'], 'the empty state still lists the newest chats');
  ctx.panel.destroy();
});

test('New chat in the column closes the open chats menu and names the new chat on the menu button', async () => {
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]), list: [listRow(TID, 'Deck chat')] };
  const ctx = makePanel({ fetchHandler: api(state), innerWidth: 1440 });
  ctx.panel.setHost('dock');
  ctx.panel.open({ threadId: TID });
  await ticks(ctx, 4);
  ctx.flush();
  const menu = ctx.doc.querySelector('[data-ask-side-thread]');
  assert.equal(menu.textContent, 'Deck chat');
  menu.click();
  assert.equal(ctx.panel.root.dataset.history, 'open');
  ctx.doc.querySelector('[data-ask-side-new]').click();
  assert.equal(ctx.panel.root.dataset.history, 'closed');
  assert.equal(menu.textContent, 'New chat');
  ctx.panel.destroy();
});

test('moving the panel to another host closes an open popover', async () => {
  const ctx = makePanel({ fetchHandler: api({ options: OPTIONS }) });
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-scope-btn]').click();
  await ticks(ctx);
  assert.ok(ctx.doc.querySelector('.ask-scope-item'), 'the scope popover is open');
  ctx.panel.setHost('dock');
  assert.equal(ctx.doc.querySelector('.ask-scope-item'), null, 'it does not travel with the panel');
  ctx.panel.destroy();
});

test('following the page never takes the focus from the page; a direct hop between two workspaces follows too', async () => {
  let scope = null;
  const ctx = makePanel({ fetchHandler: api({ options: OPTIONS }), getPageContext: () => ({ view: 'workspaces' }), deps: { getPageScope: () => scope } });
  ctx.panel.setHost('dock');
  ctx.panel.open(undefined, { focus: false });
  const link = ctx.doc.createElement('a');
  link.href = '#x';
  ctx.doc.body.appendChild(link);
  link.focus();
  scope = TEAM;
  hashchange(ctx);
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Team', 'the scope followed');
  assert.equal(ctx.doc.activeElement, link, 'and the focus stayed on the page');
  scope = { pinned: true, workspaceId: 'wks-other-0000beef', label: 'Other' };
  hashchange(ctx);
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Other');
  ctx.panel.destroy();
});

test('New chat after a pill pick follows the page again', async () => {
  let scope = DEMO;
  const ctx = makePanel({ fetchHandler: api({ options: OPTIONS }), getPageContext: () => ({ view: 'runs' }), deps: { getPageScope: () => scope } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-scope-btn]').click();
  await ticks(ctx);
  [...ctx.doc.querySelectorAll('.ask-scope-item')].find((i) => i.querySelector('.ask-model-name').textContent === 'No project').click();
  scope = TEAM;
  hashchange(ctx);
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: No project', 'the pick holds');
  ctx.doc.querySelector('[data-ask-side-new]').click();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Team', 'New chat starts in the page scope');
  scope = DEMO;
  hashchange(ctx);
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo', 'and follows the page again');
  ctx.panel.destroy();
});

test('moving host keeps a reader who scrolled up where they were: no jump to the bottom', async () => {
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]) };
  const ctx = makePanel({ fetchHandler: api(state) });
  ctx.panel.open({ threadId: TID });
  await ticks(ctx, 4);
  ctx.flush();
  const t = ctx.doc.querySelector('.ask-transcript');
  Object.defineProperty(t, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 400, configurable: true });
  t.scrollTop = 100;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, false, 'precondition: scrolled up, Jump to latest shows');
  const section = ctx.doc.createElement('section');
  ctx.doc.body.appendChild(section);
  section.appendChild(ctx.panel.root);
  ctx.panel.setHost('dock');
  assert.equal(t.scrollTop, 100, 'not pulled to the bottom');
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, false, 'still unpinned');
  ctx.panel.destroy();
});

test('a project or a workspace picked in the pill stops the page scope from following too', async () => {
  for (const [pick, label, start] of [['Demo', 'Chat scope: Demo', TEAM], ['Team', 'Chat scope: Team', DEMO]]) {
    let scope = start;
    const ctx = makePanel({ fetchHandler: api({ options: OPTIONS }), getPageContext: () => ({ view: 'runs' }), deps: { getPageScope: () => scope } });
    ctx.panel.setHost('dock');
    ctx.panel.open();
    assert.equal(scopeLabel(ctx.doc), `Chat scope: ${start.label}`);
    ctx.doc.querySelector('[data-ask-scope-btn]').click();
    await ticks(ctx);
    [...ctx.doc.querySelectorAll('.ask-scope-item')].find((i) => i.textContent.includes(pick)).click();
    assert.equal(scopeLabel(ctx.doc), label);
    scope = { pinned: true, projectKey: 'other-00000002', label: 'Other' };
    hashchange(ctx);
    ctx.panel.pageChanged();
    ctx.panel.setHost('page');
    ctx.panel.setHost('dock');
    assert.equal(scopeLabel(ctx.doc), label, `${pick}: the page never overwrites a pick`);
    ctx.panel.destroy();
  }
});

test('leaving the page\'s project out of an empty column chat takes it out of the scope the chat follows', async () => {
  const page = { view: 'project-detail', pageProjectKey: 'demo-00000001', projectKey: 'demo-00000001' };
  const chips = [{ id: 'project:demo-00000001', kind: 'project', caption: 'Project', name: 'Demo', icon: 'project', leaveOut: 'Leave this project out', keys: ['pageProjectKey', 'view'] }];
  const seen = [];
  // No argument = the whole page (the project); the page minus the left-out chip = nothing to be about.
  const getPageScope = (c) => { seen.push(c); return !c || c.pageProjectKey ? DEMO : null; };
  const ctx = makePanel({ fetchHandler: api({ options: OPTIONS }), getPageContext: () => page, deps: { getPageChips: () => chips, getPageScope } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: Demo');
  ctx.doc.querySelector('.ask-page-chip-x').click();
  assert.equal(scopeLabel(ctx.doc), 'Chat scope: No project', 'the project left out of the messages is out of the scope too');
  assert.equal('pageProjectKey' in seen.at(-1), false, 'the scope reads the page minus the chips left out');
  ctx.panel.destroy();
});

test('a chat that goes away under the column (all history cleared, a stored chat gone) leaves the focus on the page', async () => {
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]) };
  const ctx = makePanel({ fetchHandler: api(state) });
  ctx.panel.setHost('dock');
  ctx.panel.open({ threadId: TID }, { focus: false });
  await ticks(ctx, 4);
  ctx.flush();
  const link = ctx.doc.createElement('a');
  link.href = '#x';
  ctx.doc.body.appendChild(link);
  link.focus();
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  await ticks(ctx);
  assert.equal(ctx.panel.threadId(), null, 'the chat is gone: a new one');
  assert.equal(ctx.doc.activeElement, link, 'cleared: the focus stays on the page');
  ctx.panel.destroy();
  const gone = makePanel({ fetchHandler: (url, o) => (url.startsWith(`/api/ask/threads/${TID}`) ? { ok: false, status: 404, json: async () => ({ error: 'not found' }) } : api({})(url, o)) });
  gone.storage.setItem('worca-cc.ask.thread', TID);
  const link2 = gone.doc.createElement('a');
  link2.href = '#x';
  gone.doc.body.appendChild(link2);
  link2.focus();
  gone.panel.setHost('dock');
  gone.panel.open(undefined, { focus: false });               // a route shows the column: the stored chat is gone
  await ticks(gone, 6);
  assert.equal(gone.panel.threadId(), null);
  assert.equal(gone.doc.activeElement, link2, 'gone: the focus stays on the page');
  gone.panel.destroy();
});

// ---- v5 (cycle 4): the dot in the column, the toasts' clearance, and the pages the chat opens itself -------------
const NEWS = 'ask_0000000b';
const newsFrame = (threadId) => ({ type: 'ask-message', unread: true, threadId, message: { id: 'askm_0000000b', threadId, role: 'system', text: '', blocks: [], createdAt: 't' } });

test('a route that brings the column back keeps the dot for news in another chat; that chat on screen clears it; the Chat page clears it on any show', async () => {
  const dots = [];
  const ctx = makePanel({ fetchHandler: api({}), deps: { onUnread: (on) => dots.push(on) } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx);
  ctx.panel.close();                                         // a page without the column (Workflows, Chat)
  ctx.panel.pushServerFrame(newsFrame(NEWS));                // a PR fix run's card lands in another chat
  assert.equal(ctx.panel.unreadThreadId(), NEWS);
  ctx.panel.open(undefined, { focus: false });               // back on a page: the column shows its own new chat
  assert.equal(ctx.panel.unreadThreadId(), NEWS, 'the news is not on screen: the dot stays');
  assert.deepEqual(dots, [true]);
  ctx.panel.close();
  ctx.panel.open({ threadId: NEWS });                        // the header button opens that chat (R12)
  assert.equal(ctx.panel.unreadThreadId(), null);
  assert.deepEqual(dots, [true, false]);
  ctx.panel.close();
  ctx.panel.setHost('page');
  ctx.panel.pushServerFrame(newsFrame('ask_0000000c'));
  ctx.panel.open();                                          // the Chat page, as before: any show clears it
  assert.equal(ctx.panel.unreadThreadId(), null);
  assert.deepEqual(dots, [true, false, true, false]);
  ctx.panel.destroy();
});

test('the docked composer\'s height reaches the body, so the toasts can clear it where the column covers the page', async () => {
  const ctx = makePanel({ fetchHandler: api({}), resizeObserver: true });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx);
  const dock = ctx.doc.querySelector('[data-chat-dock]');
  const ro = ctx.resizeObservers.find((o) => o.targets.includes(dock));
  assert.ok(ro, 'the dock strip is observed');
  Object.defineProperty(dock, 'offsetHeight', { value: 234, configurable: true });
  ro.cb([]);
  assert.equal(ctx.doc.body.style.getPropertyValue('--ask-side-dock-h'), '234px');
  assert.equal(ctx.doc.querySelector('.chat-convo').style.getPropertyValue('--chat-dock-h'), '234px', 'the transcript clearance as before');
  ctx.panel.destroy();
});

/** A column panel whose side actions record each uncover with the address at that moment (it must come first). */
function sidePanel(state, over = {}) {
  const calls = [];
  const holder = {};
  const sideActions = { uncover: () => calls.push(['uncover', holder.ctx.window.location.hash]) };
  const ctx = makePanel({ fetchHandler: api(state), ...over, deps: { sideActions, ...(over.deps || {}) } });
  holder.ctx = ctx;
  ctx.panel.setHost('dock');
  return { ctx, calls };
}

test('a topic row in the context menu steps a covering column aside before it routes', async () => {
  const state = { snap: { ...snapOf(), thread: { ...threadRow('Deck chat'), contexts: [{ kind: 'page', id: 'schedules', label: 'Schedules' }] } } };
  const { ctx, calls } = sidePanel(state);
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ticks(ctx, 6);
  ctx.doc.querySelector('[data-ask-ctx-btn]').click();
  ctx.doc.querySelector('.ask-pop-ctx .ask-ctx-topic').click();
  assert.equal(ctx.window.location.hash, '#schedules');
  assert.deepEqual(calls, [['uncover', '']], 'stepped aside first, then routed');
  ctx.panel.destroy();
});

test('Manage on the Connectors page steps a covering column aside before it routes', async () => {
  const state = {};
  const base = api(state);
  const preview = { sets: [{ id: 'general', name: 'General', group: 'general', routes: [], members: 1, started: 1 }],
    copies: [{ name: 'jira', copy: 'jira', setId: 'general', setName: 'General', serverId: 'manual:jira', projects: [], description: '', renamedFrom: null, provisional: false }], skipped: [], started: 1 };
  const { ctx, calls } = sidePanel(state, { fetchHandler: (url, opts) => (url === '/api/ask/mcp-preview' ? { ok: true, status: 200, json: async () => preview } : base(url, opts)) });
  ctx.panel.open();
  await ticks(ctx, 6);
  ctx.doc.querySelector('[data-ask-mcp-btn]').click();
  await ticks(ctx, 4);
  ctx.doc.querySelector('.ask-pop-mcp [data-mcp-key="manage"]').click();
  assert.equal(ctx.window.location.hash, '#connectors');
  assert.deepEqual(calls, [['uncover', '']]);
  ctx.panel.destroy();
});

test('a run card\'s Open run steps a covering column aside before it routes', async () => {
  const STARTED = { kind: 'card', id: 'card_00000001', state: 'started', runId: 'run-uuid-1', card: { target: 'project', projectKey: 'demo-00000001', projectName: 'Demo', projectDir: '/Users/me/demo', title: 'Fix login', brief: 'b', workflowId: 'wf_default', guardrailsId: 'normal' } };
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi'), { ...userRow('askm_00000002', 2, 'ok', [STARTED]), role: 'assistant', status: 'done' }]) };
  const { ctx, calls } = sidePanel(state);
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ticks(ctx, 6);
  ctx.flush();
  ctx.doc.querySelector('a.ask-rc-open').click();
  assert.equal(ctx.window.location.hash, '#running/run-uuid-1');
  assert.deepEqual(calls, [['uncover', '']]);
  ctx.panel.destroy();
});

// ---- v6 (cycle 5): the field after the slide-in, the dot on a deleted chat, the recent rows across repaints ------------
test('the column\'s composer fits its field again when the field\'s width changes: the slide-in from 0px leaves no tall empty box', async () => {
  const ctx = makePanel({ fetchHandler: api({}), resizeObserver: true });
  const input = ctx.doc.querySelector('textarea.ask-input');
  const box = { w: 0 };
  Object.defineProperty(input, 'clientWidth', { get: () => box.w, configurable: true });
  Object.defineProperty(input, 'scrollHeight', { get: () => (box.w < 200 ? 400 : 35), configurable: true });   // the placeholder wraps in a squeezed field
  ctx.panel.setHost('dock');
  ctx.panel.open();                                          // the column is still sliding in from 0px wide
  await ticks(ctx);
  assert.equal(input.style.height, '120px', 'precondition: measured while squeezed');
  const sheet = ctx.doc.querySelector('.chat-convo');
  const ro = ctx.resizeObservers.find((o) => o.targets.includes(sheet));
  assert.ok(ro, 'the conversation column is observed');
  box.w = 400;                                               // the slide-in ends
  ro.cb([]);
  assert.equal(input.style.height, '35px', 'fitted at the column\'s width');
  input.style.height = '50px';
  ro.cb([]);                                                 // a reply growing the transcript: same width, nothing to fit
  assert.equal(input.style.height, '50px');
  ctx.panel.destroy();
});

test('deleting the chat the dot is lit for clears the dot: the button never opens a chat that is gone', async () => {
  const dots = [];
  const state = { list: [listRow(TID, 'Deck chat'), listRow(NEWS, 'News chat')] };
  const ctx = makePanel({ fetchHandler: api(state), deps: { onUnread: (on) => dots.push(on) } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx);
  ctx.panel.pushServerFrame(newsFrame(NEWS));                // news in another chat while the column shows a new chat
  assert.equal(ctx.panel.unreadThreadId(), NEWS, 'precondition: the dot is lit for it');
  ctx.doc.querySelector('[data-ask-side-thread]').click();   // the chats menu
  await ticks(ctx, 4);
  state.list = [listRow(TID, 'Deck chat')];
  await deleteFromList(ctx, NEWS);
  await ticks(ctx, 8);
  assert.equal(ctx.panel.unreadThreadId(), null);
  assert.deepEqual(dots, [true, false]);
  ctx.panel.destroy();
});

const RECENT = [listRow(TID, 'Deck chat'), listRow('ask_00000002', 'Two'), listRow('ask_00000003', 'Three'), listRow('ask_00000004', 'Four')];
const recentRows = (doc) => [...doc.querySelectorAll('.ask-side-recent-row')];

test('the recent chats keep their rows and their focus across a repaint that changes nothing (a live run repaints on every frame)', async () => {
  const ctx = makePanel({ fetchHandler: api({ list: RECENT }), getPageContext: () => ({ view: 'runs' }) });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 6);
  const before = recentRows(ctx.doc);
  assert.equal(before.length, 3);
  before[1].focus();
  for (let i = 0; i < 5; i++) ctx.panel.pageChanged();      // the run store's subscription: one per frame
  const after = recentRows(ctx.doc);
  assert.ok(after.length === 3 && after.every((n, i) => n === before[i]), 'the same rows');
  assert.equal(ctx.doc.activeElement, before[1], 'the focus stays on the row');
  ctx.panel.destroy();
});

test('the recent chats repaint when the list changes, even after their list left the page (a released test page) — nothing throws', async () => {
  const state = { list: RECENT };
  const ctx = makePanel({ fetchHandler: api(state), getPageContext: () => ({ view: 'runs' }) });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 6);
  const late = [];
  const onRejection = (r) => late.push(String((r && r.message) || r));
  process.on('unhandledRejection', onRejection);
  try {
    state.list = [listRow('ask_00000005', 'Fresh'), ...RECENT];
    ctx.doc.querySelector('.ask-side-recent-list').remove();    // test/helpers/jsdom-release.mjs takes the page apart like this
    ctx.doc.querySelector('[data-ask-side-thread]').click();    // the chats menu refetches the list
    await ticks(ctx, 8);
    await new Promise((r) => setTimeout(r, 20));
  } finally { process.off('unhandledRejection', onRejection); }
  assert.deepEqual(late, []);
  assert.equal(ctx.doc.querySelector('.ask-side-recent').hidden, false);
  ctx.panel.destroy();
});

// ---- v7 (cycle 6): the dot across other deletes, the recent rows' content, the focus a pick or a route leaves -----------
test('deleting another chat leaves the dot lit for the chat with the news', async () => {
  const dots = [];
  const state = { list: [listRow(TID, 'Deck chat'), listRow(NEWS, 'News chat')] };
  const ctx = makePanel({ fetchHandler: api(state), deps: { onUnread: (on) => dots.push(on) } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx);
  ctx.panel.pushServerFrame(newsFrame(NEWS));                // news in another chat while the column shows a new chat
  assert.equal(ctx.panel.unreadThreadId(), NEWS, 'precondition: the dot is lit for it');
  ctx.doc.querySelector('[data-ask-side-thread]').click();   // the chats menu
  await ticks(ctx, 4);
  state.list = [listRow(NEWS, 'News chat')];
  await deleteFromList(ctx, TID);                            // a chat that is not the news
  await ticks(ctx, 8);
  assert.equal(ctx.panel.unreadThreadId(), NEWS, 'its news is still unseen');
  assert.deepEqual(dots, [true]);
  ctx.panel.destroy();
});

test('a chat the person declines to delete, or whose delete the server refuses, keeps its dot', async () => {
  const dots = [];
  const box = { confirm: false, fail: false };
  const state = { list: [listRow(TID, 'Deck chat'), listRow(NEWS, 'News chat')] };
  const base = api(state);
  const ctx = makePanel({
    fetchHandler: (url, opts = {}) => (opts.method === 'DELETE' && box.fail ? { ok: false, status: 500, json: async () => ({ error: 'boom' }) } : base(url, opts)),
    confirm: async () => box.confirm,
    deps: { onUnread: (on) => dots.push(on) },
  });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx);
  ctx.panel.pushServerFrame(newsFrame(NEWS));                // news in another chat while the column shows a new chat
  ctx.doc.querySelector('[data-ask-side-thread]').click();   // the chats menu
  await ticks(ctx, 4);
  await deleteFromList(ctx, NEWS);                           // declined in the dialog
  await ticks(ctx, 6);
  assert.equal(ctx.panel.unreadThreadId(), NEWS, 'declined: the chat stays, so does its dot');
  box.confirm = true;
  box.fail = true;
  await deleteFromList(ctx, NEWS);                           // confirmed, the server answers 500
  await ticks(ctx, 8);
  assert.equal(ctx.panel.unreadThreadId(), NEWS, 'refused: the chat is still there');
  assert.deepEqual(dots, [true]);
  box.fail = false;
  state.list = [listRow(TID, 'Deck chat')];
  await deleteFromList(ctx, NEWS);                           // and now it goes
  await ticks(ctx, 8);
  assert.equal(ctx.panel.unreadThreadId(), null);
  assert.deepEqual(dots, [true, false]);
  ctx.panel.destroy();
});

test('the recent chats repaint for a rename or a new meter (same ids), and as the clock moves (same list)', async () => {
  const at = Date.parse('2026-10-24T10:00:00.000Z');
  const clock = { t: at + 10_000 };
  const state = { list: RECENT };
  const ctx = makePanel({ fetchHandler: api(state), getPageContext: () => ({ view: 'runs' }), now: () => clock.t });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 6);
  const row = () => recentRows(ctx.doc)[0];
  assert.equal(row().querySelector('.ask-side-recent-t').textContent, 'Deck chat');
  assert.equal(row().querySelector('.ask-side-recent-when').textContent, 'just now');
  clock.t = at + 5 * 60_000;
  ctx.panel.pageChanged();                                   // nothing but the time moved
  assert.equal(row().querySelector('.ask-side-recent-when').textContent, '5m ago');
  state.list = [{ ...RECENT[0], title: 'Renamed chat', totals: { costUsd: 1.5 } }, ...RECENT.slice(1)];
  ctx.doc.querySelector('[data-ask-side-thread]').click();   // the chats menu refetches the list
  await ticks(ctx, 8);
  assert.equal(row().querySelector('.ask-side-recent-t').textContent, 'Renamed chat');
  assert.match(row().querySelector('.ask-side-recent-meter').textContent, /\$1\.5/);
  ctx.panel.destroy();
});

test('a recent chat picked by keyboard opens it and hands the focus to the field: the row leaves with the empty state, never to <body>', async () => {
  const ctx = makePanel({ fetchHandler: api({ list: RECENT, snap: snapOf([userRow('askm_u0000001', 1, 'hi')]) }), getPageContext: () => ({ view: 'runs' }) });
  ctx.panel.setHost('dock');
  ctx.panel.open(undefined, { focus: false });
  await ticks(ctx, 6);
  const row = recentRows(ctx.doc)[0];
  row.focus();
  row.click();
  await ticks(ctx, 6);
  assert.equal(ctx.doc.querySelector('[data-chat-page]').dataset.view, 'thread', 'the chat it names is open');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'));
  ctx.panel.destroy();
});

test('beside the page (the column stays), a topic row chosen by keyboard hands the focus to the field, never <body>', async () => {
  const state = { snap: { ...snapOf(), thread: { ...threadRow('Deck chat'), contexts: [{ kind: 'page', id: 'schedules', label: 'Schedules' }] } } };
  const { ctx, calls } = sidePanel(state);
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open(undefined, { focus: false });
  await ticks(ctx, 6);
  ctx.doc.querySelector('[data-ask-ctx-btn]').click();
  const row = ctx.doc.querySelector('.ask-pop-ctx .ask-ctx-topic');
  row.focus();
  row.click();                                               // the menu closes with the row in it (focusTrigger: false)
  assert.equal(ctx.window.location.hash, '#schedules');
  assert.deepEqual(calls, [['uncover', '']], 'asked to step aside: beside the page that is a no-op');
  assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'));
  ctx.panel.destroy();
});

test('under a dialog the History overlay takes no focus: a welcome or a confirm up, the overlay open, nothing focused', async () => {
  const ctx = makePanel({ fetchHandler: api({}), innerWidth: 1000 });
  const modal = ctx.doc.createElement('div');
  modal.className = 'viewer-modal';
  ctx.doc.body.appendChild(modal);
  ctx.panel.setHistoryOpen(true, { persist: false });
  ctx.panel.open();                                          // the composer refuses (the dialog and the overlay)
  assert.equal(ctx.doc.activeElement, ctx.doc.body, 'the focus stays for the dialog');
  ctx.panel.destroy();
});

// ---- the merge with the Chats column (#948): its menus, its keys and its views beside the page ----------------------------
test('beside the page a press in a menu the Chats column opened keeps the chats menu open; a press on the page closes it', async () => {
  const ctx = makePanel({ fetchHandler: api({ list: [listRow(TID, 'Deck chat')] }) });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  ctx.doc.querySelector('[data-ask-side-thread]').click();
  await ticks(ctx, 4);
  ctx.doc.querySelector(`[data-chat-history] .runs-item[data-row-key="chat:${TID}"] .runs-more`).click();
  const menu = ctx.doc.querySelector('.wfv-menu');
  assert.ok(menu && !ctx.panel.root.contains(menu), 'precondition: the row menu sits outside the column');
  menu.querySelector('[role="menuitem"]').dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  assert.equal(ctx.panel.root.dataset.history, 'open', 'a press in the row menu keeps the chats menu');
  const outside = ctx.doc.createElement('div');
  ctx.doc.body.appendChild(outside);
  outside.dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  assert.equal(ctx.panel.root.dataset.history, 'closed', 'a press on the page beside it closes it');
  ctx.panel.destroy();
});

test('beside the page the Chat keys act only from inside the column: the page keeps its own ? and ⌥⌘N', async () => {
  const ctx = makePanel({ fetchHandler: api({ list: [listRow(TID, 'Deck chat')] }) });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  const onPage = ctx.doc.createElement('button');
  ctx.doc.body.appendChild(onPage);
  onPage.focus();
  assert.equal(key(ctx.window, onPage, '?').defaultPrevented, false, 'the page\'s ? is its own');
  assert.equal(ctx.doc.querySelector('.keys-modal'), null, 'no Chat keys sheet over the page');
  assert.equal(key(ctx.window, onPage, 'n', { code: 'KeyN', metaKey: true, altKey: true }).defaultPrevented, false, 'nor ⌥⌘N');
  const field = ctx.doc.querySelector('textarea.ask-input');
  assert.equal(key(ctx.window, field, 'n', { code: 'KeyN', metaKey: true, altKey: true }).defaultPrevented, true, 'inside the column the Chat keys work');
  ctx.panel.destroy();
});

test('a history clear empties the recent chats even while the Chats column shows another view', async () => {
  const state = { list: [listRow('ask_00000005', 'Alpha'), listRow('ask_00000006', 'Beta')] };
  const ctx = makePanel({ fetchHandler: (url, o) => {
    if (url.startsWith('/api/ask/threads?') && /[?&]show=archived/.test(url)) return { ok: true, status: 200, json: async () => ({ threads: [], total: 0 }) };
    return api(state)(url, o);
  } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  ctx.doc.querySelector('[data-ask-side-thread]').click();
  ctx.doc.querySelector('#chats-view-btn').click();
  [...ctx.doc.querySelectorAll('.wfv-menu [role="menuitemradio"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Archived').click();
  await ticks(ctx, 6);
  assert.equal(ctx.doc.querySelectorAll('.ask-side-recent-row').length, 2, 'precondition: the recent chats outlive the view change');
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared', threadIds: ['ask_00000005'] });
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-side-recent-t')].map((n) => n.textContent), ['Beta'], 'the chats it names leave');
  ctx.panel.pushServerFrame({ type: 'ask-history-cleared' });
  assert.equal(ctx.doc.querySelector('.ask-side-recent').hidden, true, 'a clear of every chat leaves none');
  ctx.panel.destroy();
});

test('a recent chat deleted from the Needs you view leaves the recent chats, even when no list can be read again', async () => {
  const alpha = { ...listRow('ask_00000005', 'Alpha'), waiting: true, tracking: true };
  const state = { list: [alpha, listRow('ask_00000006', 'Beta')] };
  const ctx = makePanel({ fetchHandler: (url, o) => {
    if (state.down && url.startsWith('/api/ask/threads?')) return { ok: false, status: 500, json: async () => ({}) };
    if (url.startsWith('/api/ask/threads?') && /[?&]show=needs/.test(url)) return { ok: true, status: 200, json: async () => ({ threads: state.list.filter((t) => t.waiting), total: 1 }) };
    if (url === '/api/ask/threads/ask_00000005' && o && o.method === 'DELETE') {
      state.list = state.list.filter((t) => t.id !== 'ask_00000005');
      state.down = true;                                     // only the delete itself can take the row out
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return api(state)(url, o);
  } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  ctx.doc.querySelector('[data-ask-side-thread]').click();
  ctx.doc.querySelector('#chats-view-btn').click();
  [...ctx.doc.querySelectorAll('.wfv-menu [role="menuitemradio"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Needs you').click();
  await ticks(ctx, 6);
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-side-recent-t')].map((n) => n.textContent), ['Alpha', 'Beta'], 'precondition');
  await deleteFromList(ctx, 'ask_00000005');
  await ticks(ctx, 8);
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-side-recent-t')].map((n) => n.textContent), ['Beta']);
  ctx.panel.destroy();
});

test('the recent chats are the newest by activity, whatever leads the Chats column (a pinned older chat)', async () => {
  const pinnedOld = { ...listRow('ask_00000005', 'Pinned old'), pinnedAt: '2026-10-20T09:00:00.000Z', updatedAt: '2026-10-20T09:00:00.000Z' };
  const fresh = { ...listRow('ask_00000006', 'Fresh'), updatedAt: '2026-10-24T12:00:00.000Z' };
  const ctx = makePanel({ fetchHandler: api({ list: [pinnedOld, listRow('ask_00000007', 'Middle'), fresh] }) });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-side-recent-t')].map((n) => n.textContent), ['Fresh', 'Middle', 'Pinned old']);
  ctx.panel.destroy();
});

test('Delete group (the Chats column) clears the dot and the recent row of a chat it removed, as a delete does', async () => {
  const GID = 'askg_00000001';
  const dots = [];
  const state = { list: [{ ...listRow(NEWS, 'News chat'), groupId: GID }, listRow(TID, 'Deck chat')] };
  const base = api(state);
  const ctx = makePanel({ fetchHandler: (url, o = {}) => {
    if (url === '/api/ask/groups') return { ok: true, status: 200, json: async () => ({ groups: state.list.some((t) => t.groupId) ? [{ id: GID, name: 'Release prep', count: 1, total: 1 }] : [] }) };
    if (url === `/api/ask/groups/${GID}?deleteChats=true` && o.method === 'DELETE') {
      state.list = state.list.filter((t) => t.groupId !== GID);
      state.down = true;                                     // the list's re-read fails: only the ids it names take the row out
      return { ok: true, status: 200, json: async () => ({ threadIds: [NEWS] }) };
    }
    if (state.down && url.startsWith('/api/ask/threads?')) return { ok: false, status: 500, json: async () => ({}) };
    return base(url, o);
  }, deps: { onUnread: (on) => dots.push(on) } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  ctx.panel.pushServerFrame(newsFrame(NEWS));                // news in a grouped chat while the column shows a new chat
  assert.equal(ctx.panel.unreadThreadId(), NEWS, 'precondition: the dot is lit for it');
  assert.ok([...ctx.doc.querySelectorAll('.ask-side-recent-t')].some((n) => n.textContent === 'News chat'), 'precondition: a recent row');
  ctx.doc.querySelector('[data-ask-side-thread]').click();   // the chats menu
  await ticks(ctx, 4);
  ctx.doc.querySelector(`[data-chat-history] .runs-item[data-row-key="cgroup:${GID}"] .runs-more`).click();
  [...ctx.doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Delete group…').click();
  await ticks(ctx, 10);
  assert.equal(ctx.panel.unreadThreadId(), null, 'the button never opens a chat that is gone');
  assert.deepEqual(dots, [true, false]);
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-side-recent-t')].map((n) => n.textContent), ['Deck chat']);
  ctx.panel.destroy();
});

// ---- the side column's Recent chats whatever view the Chats column was left on (merge review cycle 1, M2) ----------
/** A storage holding the Chats view the person left the list on (chats-list.mjs CHATS_VIEW_KEY). */
const savedView = (view) => {
  const map = new Map([['worca-cc.chats.view', JSON.stringify(view)]]);
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
};
const recentTitles = (doc) => [...doc.querySelectorAll('.ask-side-recent-t')].map((n) => n.textContent);
const pickView = (ctx, label) => {
  ctx.doc.querySelector('#chats-view-btn').click();
  [...ctx.doc.querySelectorAll('.wfv-menu [role="menuitemradio"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === label).click();
};

test('a Chats list left on Needs you: the column still lists the newest chats and History; an archive and a view change keep them right', async () => {
  const alpha = { ...listRow('ask_00000005', 'Alpha'), waiting: true };
  const state = { list: [alpha, listRow('ask_00000006', 'Beta')] };
  const base = api(state);
  const ctx = makePanel({ storage: savedView({ show: 'needs' }), fetchHandler: (url, o = {}) => {
    if (url.startsWith('/api/ask/threads?') && /[?&]show=needs/.test(url)) {
      const threads = state.list.filter((t) => t.waiting);
      return { ok: true, status: 200, json: async () => ({ threads, total: threads.length }) };
    }
    if (url === '/api/ask/threads/ask_00000005' && o.method === 'PATCH' && JSON.parse(o.body).archived === true) {
      state.list = state.list.filter((t) => t.id !== 'ask_00000005');
      return { ok: true, status: 200, json: async () => ({ thread: alpha }) };
    }
    return base(url, o);
  } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 6);
  assert.deepEqual(recentTitles(ctx.doc), ['Alpha', 'Beta'], 'the newest chats, not the Needs you list');
  assert.equal(ctx.doc.querySelector('.ask-side-recent').hidden, false, 'with its History button');
  ctx.doc.querySelector('[data-ask-side-thread]').click();
  await ticks(ctx, 4);
  ctx.doc.querySelector('[data-chat-history] .runs-item[data-row-key="chat:ask_00000005"] .runs-more').click();
  [...ctx.doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Archive').click();
  await ticks(ctx, 8);
  assert.deepEqual(recentTitles(ctx.doc), ['Beta'], 'a chat archived from Needs you leaves them');
  pickView(ctx, 'All');
  assert.deepEqual(recentTitles(ctx.doc), ['Beta'], 'while the All view loads they stay');
  await ticks(ctx, 6);
  assert.deepEqual(recentTitles(ctx.doc), ['Beta']);
  ctx.panel.destroy();
});

test('a Chats list sorted by title with more to page: the column still lists the newest chats by activity', async () => {
  const old = (id, title) => ({ ...listRow(id, title), updatedAt: '2026-10-01T10:00:00.000Z' });
  const fresh = { ...listRow('ask_00000007', 'Zulu fresh'), updatedAt: '2026-10-24T12:00:00.000Z' };
  const ctx = makePanel({ storage: savedView({ show: 'all', sort: 'title', groupBy: 'none' }), fetchHandler: (url, o = {}) => {
    if (url.startsWith('/api/ask/threads?') && /[?&]sort=title/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ threads: [old('ask_00000005', 'Alpha'), old('ask_00000006', 'Beta')], cursor: 'next', total: 3 }) };
    }
    return api({ list: [fresh, old('ask_00000005', 'Alpha'), old('ask_00000006', 'Beta')] })(url, o);
  } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 6);
  assert.deepEqual(recentTitles(ctx.doc), ['Zulu fresh', 'Alpha', 'Beta'], 'not the first page of the A–Z list');
  ctx.panel.destroy();
});

test('Rename in the Chats column renames the chat the column shows on its menu button too', async () => {
  const state = { snap: snapOf([userRow('askm_u0000001', 1, 'hi')]), list: [listRow(TID, 'Deck chat')] };
  const ctx = makePanel({ fetchHandler: api(state), deps: { chatDeps: { prompt: async () => ({ title: 'Renamed chat' }) } } });
  ctx.panel.setHost('dock');
  ctx.panel.open({ threadId: TID });
  await ticks(ctx, 4);
  ctx.flush();
  const menu = ctx.doc.querySelector('[data-ask-side-thread]');
  assert.equal(menu.textContent, 'Deck chat');
  menu.click();
  await ticks(ctx, 4);
  ctx.doc.querySelector(`[data-chat-history] .runs-item[data-row-key="chat:${TID}"] .runs-more`).click();
  [...ctx.doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Rename…').click();
  await ticks(ctx, 6);
  assert.equal(menu.textContent, 'Renamed chat');
  ctx.panel.destroy();
});

test('the Chat page asks nothing apart for the recent rows; the side column asks once it shows the chat page, and a repaint of the same list asks nothing more', async () => {
  const alpha = { ...listRow('ask_00000005', 'Alpha'), waiting: true };
  const base = api({ list: [alpha, listRow('ask_00000006', 'Beta')] });
  const ctx = makePanel({ storage: savedView({ show: 'needs' }), fetchHandler: (url, o = {}) => {
    if (url.startsWith('/api/ask/threads?') && /[?&]show=needs/.test(url)) return { ok: true, status: 200, json: async () => ({ threads: [alpha], total: 1 }) };
    return base(url, o);
  } });
  const apart = () => ctx.fetchCalls.filter((c) => c.url.startsWith('/api/ask/threads?show=all&sort=activity')).length;
  ctx.panel.open();                                          // the Chat page
  await ticks(ctx, 6);
  assert.ok(ctx.doc.querySelector('[data-chat-history] a.runs-row[data-row-key="chat:ask_00000005"]'), 'precondition: the Needs you list loaded');
  assert.equal(apart(), 0, 'the Chat page shows no recent rows: nothing asked');
  ctx.panel.setHost('dock');
  await ticks(ctx, 4);
  assert.deepEqual(recentTitles(ctx.doc), ['Alpha', 'Beta'], 'the side column catches up');
  assert.equal(apart(), 1);
  ctx.doc.querySelector('[data-chat-history] .runs-item[data-row-key="chat:ask_00000005"] .runs-check').click();
  await ticks(ctx, 4);
  assert.ok(ctx.doc.querySelector('[data-chat-history] .is-selecting'), 'precondition: the selection repainted the list');
  assert.equal(apart(), 1, 'the same list: nothing asked again');
  ctx.panel.destroy();
});

test('an apart answer for the recent rows that lands after the All view loaded never paints over its newest chats', async () => {
  const base = api({ list: [listRow('ask_00000005', 'Alpha'), listRow('ask_00000006', 'Beta')] });
  let release = null;
  const ctx = makePanel({ storage: savedView({ show: 'needs' }), fetchHandler: (url, o = {}) => {
    if (url.startsWith('/api/ask/threads?') && /[?&]show=needs/.test(url)) return { ok: true, status: 200, json: async () => ({ threads: [], total: 0 }) };
    if (!release && url.startsWith('/api/ask/threads?show=all')) {   // the first apart fetch: held
      return new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ threads: [listRow('ask_00000009', 'Stale')], total: 1 }) }); });
    }
    return base(url, o);
  } });
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await ticks(ctx, 4);
  assert.ok(release, 'precondition: the apart fetch is held');
  pickView(ctx, 'All');
  await ticks(ctx, 6);
  assert.deepEqual(recentTitles(ctx.doc), ['Alpha', 'Beta'], 'the All view gives them');
  release();
  await ticks(ctx, 4);
  assert.deepEqual(recentTitles(ctx.doc), ['Alpha', 'Beta'], 'the late answer is dropped');
  ctx.panel.destroy();
});
