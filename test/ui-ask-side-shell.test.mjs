// test/ui-ask-side-shell.test.mjs — Ask worca beside the page on the REAL app.js and index.html (chat-panel-boot): the
// page context keys and chips (Task 3), then the header button, the side column and the entry points (Task 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootChat, ok, click, hello, liveRun, KEY, ROW, DETAIL } from './helpers/chat-panel-boot.mjs';

const PROJECT = { key: 'worca-cc-551183d0', name: 'worca-cc', path: '/tmp/p', exists: true };
const WORKSPACE = { id: 'wks-havn-649ebfe7', name: 'Havn', projectPaths: ['/tmp/p'], projectKeys: ['worca-cc-551183d0'] };
const arms = (href) => {
  const path = href.split('?')[0];
  if (path.endsWith('/api/projects')) return ok({ projects: [PROJECT] });
  if (path.endsWith('/api/workspaces')) return ok({ workspaces: [WORKSPACE] });
  // The workspace page's own reads (Team metrics and Team policy rows), empty.
  if (path.endsWith('/api/team-metrics/scopes')) return ok({ projects: [], workspaces: [] });
  if (path.endsWith('/api/policy/scopes')) return ok({ projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false });
  return null;
};

test('a project page names its project on screen, a workspace page its workspace; chips and the page scope follow', async () => {
  const ctx = await bootChat({ arms });
  const chat = ctx.window.__np.chat;
  ctx.go('projects/worca-cc-551183d0');
  await ctx.settle(6);
  assert.equal(chat.getPageContext().pageProjectKey, 'worca-cc-551183d0');
  assert.equal(chat.getPageContext().projectKey, 'worca-cc-551183d0', 'the target key stays as it was');
  assert.deepEqual(chat.getPageChips().map((c) => [c.caption, c.name]), [['Project', 'worca-cc']]);
  assert.deepEqual(chat.getPageScope(), { pinned: true, projectKey: 'worca-cc-551183d0', label: 'worca-cc' });
  ctx.go('workspaces/wks-havn-649ebfe7');
  await ctx.settle(6);
  assert.equal(chat.getPageContext().pageWorkspaceId, 'wks-havn-649ebfe7');
  assert.deepEqual(chat.getPageChips().map((c) => [c.caption, c.name]), [['Workspace', 'Havn']]);
  assert.deepEqual(chat.getPageScope(), { pinned: true, workspaceId: 'wks-havn-649ebfe7', label: 'Havn' });
  ctx.go('schedules');
  await ctx.settle(6);
  assert.deepEqual(chat.getPageChips().map((c) => [c.caption, c.name]), [['Page', 'Schedules']]);
  assert.equal(chat.getPageScope(), null);
});

// ---- Task 8: the header button, the side column and the entry points on the real app ----------------------------
const OPEN_KEY = 'worca-cc.askSide.open';
const sideArms = (href, opts, box) => {
  const path = href.split('?')[0];
  if (path.endsWith('/api/workflows')) return ok({ workflows: [] });
  return arms(href, opts, box);
};
const nav = async (ctx, hash, n = 6) => { ctx.go(hash); await ctx.settle(n); };
const els = (ctx) => {
  const doc = ctx.window.document;
  return { doc, btn: doc.getElementById('topnav-ask'), aside: doc.getElementById('ask-side'), page: doc.querySelector('[data-chat-page]'), section: doc.querySelector('section.view[data-view="chat"]') };
};

test('the button shows everywhere but Chat; the column opens beside the page with the same chat page', async () => {
  const ctx = await bootChat({ arms: sideArms });
  let e = els(ctx);
  assert.equal(e.btn.hidden, true, 'Chat: no button');
  await nav(ctx, 'runs');
  assert.equal(e.btn.hidden, false);
  assert.equal(e.aside.hidden, true, 'hidden until asked');
  click(ctx, e.btn);
  await ctx.settle(4);
  e = els(ctx);
  assert.equal(e.btn.getAttribute('aria-expanded'), 'true');
  assert.equal(e.aside.hidden, false);
  assert.equal(e.page.parentElement, e.aside.querySelector('[data-ask-side-host]'), 'the ONE chat page moved into the column');
  assert.equal(e.page.dataset.host, 'dock');
  assert.equal(e.doc.querySelectorAll('[data-chat-page]').length, 1);
  assert.equal(ctx.window.localStorage.getItem(OPEN_KEY), '1');
  assert.equal(e.doc.activeElement, e.page.querySelector('textarea.ask-input'), 'the button focuses the composer');
  assert.deepEqual([...e.page.querySelectorAll('[data-ask-page-chips] .ask-page-chip')].map((n) => n.dataset.chipId), ['page:runs']);
});

test('back to Chat: the chat goes home to the page, the column and its button hide, the choice stays', async () => {
  const ctx = await bootChat({ arms: sideArms });
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  await nav(ctx, 'chat');
  let e = els(ctx);
  assert.equal(e.page.parentElement, e.section, 'back in the Chat section');
  assert.equal(e.page.dataset.host, 'page');
  assert.equal(e.aside.hidden, true);
  assert.equal(e.btn.hidden, true);
  assert.equal(ctx.window.localStorage.getItem(OPEN_KEY), '1');
  await nav(ctx, 'schedules');
  e = els(ctx);
  assert.equal(e.aside.hidden, false, 'the next page shows it again');
  assert.equal(e.page.dataset.host, 'dock');
  assert.notEqual(e.doc.activeElement, e.page.querySelector('textarea.ask-input'), 'a route leaves the focus on the page');
});

test('Workflows hides the column without forgetting it', async () => {
  const ctx = await bootChat({ arms: sideArms });
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  await nav(ctx, 'workflows', 8);
  assert.equal(els(ctx).aside.hidden, true);
  assert.equal(ctx.window.localStorage.getItem(OPEN_KEY), '1');
  await nav(ctx, 'projects', 8);
  assert.equal(els(ctx).aside.hidden, false);
});

test('a column left open shows on a boot to another page, and the focus stays on the page', async () => {
  const ctx = await bootChat({ arms: sideArms, local: { [OPEN_KEY]: '1' }, url: 'http://localhost:4317/#schedules' });
  const e = els(ctx);
  assert.equal(e.aside.hidden, false);
  assert.equal(e.page.dataset.host, 'dock');
  assert.notEqual(e.doc.activeElement, e.page.querySelector('textarea.ask-input'));
});

test('Hide chat and Open in Chat: the column closes; Open in Chat takes the chat to the Chat page and keeps the choice', async () => {
  const ctx = await bootChat({ arms: sideArms });
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  click(ctx, els(ctx).page.querySelector('[data-ask-open-in-chat]'));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  let e = els(ctx);
  assert.match(ctx.window.location.hash, /^#chat/);
  assert.equal(e.page.parentElement, e.section);
  assert.equal(ctx.window.localStorage.getItem(OPEN_KEY), '1', 'L8: the column stays wanted');
  await nav(ctx, 'runs');
  e = els(ctx);
  assert.equal(e.aside.hidden, false);
  click(ctx, e.page.querySelector('[data-ask-side-hide]'));
  await new Promise((r) => setTimeout(r, 360));             // the 320ms slide out
  assert.equal(els(ctx).aside.hidden, true);
  assert.equal(ctx.window.localStorage.getItem(OPEN_KEY), '0');
});

test('Open History in Chat: the Chat page opens with its History column', async () => {
  const ctx = await bootChat({ arms: sideArms });
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const page = els(ctx).page;
  click(ctx, page.querySelector('[data-ask-side-thread]'));
  assert.equal(page.dataset.history, 'open');
  click(ctx, page.querySelector('[data-ask-history-in-chat]'));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.match(ctx.window.location.hash, /^#chat/);
  assert.equal(page.dataset.host, 'page');
  assert.equal(page.dataset.history, 'open', 'opened once the Chat page hosts it');
  assert.equal(ctx.window.localStorage.getItem('worca-cc.chat.history'), null, 'not a stored choice');
});

test('a run card in the column opens the run page, not the Chat run panel', async () => {
  const ctx = await bootChat({ arms: sideArms });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  ctx.window.__np.chat.deps.openRunPanel({ runId: 'r1', pipelineId: 'p1' });
  assert.match(ctx.window.location.hash, /^#running\/r1/);
  await nav(ctx, 'chat');
  ctx.window.__np.chat.deps.openRunPanel({ runId: 'r1', pipelineId: 'p1' });
  assert.match(ctx.window.location.hash, /^#chat\/[^/]+\/run\/r1/, 'on the Chat page: the run panel, as before');
});

test('openChat goes to Chat from Chat and Workflows, opens the column elsewhere', async () => {
  const ctx = await bootChat({ arms: sideArms });
  const chat = ctx.window.__np.chat;
  await nav(ctx, 'runs');
  chat.openChat({ text: 'hi' });
  await ctx.settle(4);
  let e = els(ctx);
  assert.equal(ctx.window.location.hash, '#runs', 'no navigation');
  assert.equal(e.aside.hidden, false);
  assert.equal(e.page.querySelector('textarea.ask-input').value, 'hi');
  await nav(ctx, 'workflows', 8);
  chat.openChat({ text: 'x' });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  e = els(ctx);
  assert.match(ctx.window.location.hash, /^#chat/, 'Workflows: to the Chat page');
  assert.equal(e.page.parentElement, e.section);
  assert.match(e.page.querySelector('textarea.ask-input').value, /hi\nx$/);
  chat.openChat({ text: 'y' });
  await ctx.settle(4);
  assert.match(ctx.window.location.hash, /^#chat/);
  assert.equal(els(ctx).aside.hidden, true, 'never a hidden column');
  assert.match(els(ctx).page.querySelector('textarea.ask-input').value, /x\ny$/);
});

test('the ⌘K last row names the column on its pages and Chat on Chat', async () => {
  const ctx = await bootChat({ arms: sideArms });
  const doc = ctx.window.document;
  const input = doc.getElementById('tsearch-input');
  const lastRow = () => {
    input.focus();
    input.value = 'hello';
    input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
    const opts = [...doc.querySelectorAll('#tsearch-pop [role="option"]')];
    const last = opts.at(-1);
    return [last.querySelector('.tsearch-title').textContent, last.querySelector('.tsearch-meta').textContent];
  };
  assert.deepEqual(lastRow(), ['Ask in Chat', 'opens a chat']);
  await nav(ctx, 'runs');
  assert.deepEqual(lastRow(), ['Ask worca', 'with this page']);
});

test('the new-reply dot: the button mirrors the Chat row', async () => {
  const ctx = await bootChat({ arms: sideArms });
  const chat = ctx.window.__np.chat;
  const e = els(ctx);
  chat.paintChatUnread(true);
  assert.equal(e.doc.getElementById('topnav-ask-dot').hidden, false);
  assert.equal(e.btn.getAttribute('aria-label'), 'Ask worca, new reply');
  assert.equal(e.doc.getElementById('nav-chat-unread').hidden, false);
  chat.paintChatUnread(false);
  assert.equal(e.doc.getElementById('topnav-ask-dot').hidden, true);
  assert.equal(e.btn.getAttribute('aria-label'), 'Ask worca');
});

test('a narrow push folds the menu to its rail and a hide gives it back; the stored menu choice is untouched', async () => {
  const ctx = await bootChat({ arms: sideArms, innerWidth: 1280 });
  const doc = ctx.window.document;
  await nav(ctx, 'runs');
  assert.equal(doc.querySelector('.sidebar').classList.contains('collapsed'), false);
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  assert.equal(doc.querySelector('.sidebar').classList.contains('collapsed'), true, '1280 - 224 - 440 < 640');
  ctx.window.innerWidth = 1600;
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  assert.equal(doc.querySelector('.sidebar').classList.contains('collapsed'), false, 'room again');
  ctx.window.innerWidth = 1280;
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  assert.equal(doc.querySelector('.sidebar').classList.contains('collapsed'), true);
  click(ctx, els(ctx).btn);
  assert.equal(doc.querySelector('.sidebar').classList.contains('collapsed'), false);
  assert.equal(ctx.window.localStorage.getItem('worca-cc.sidebar.collapsed'), null);
});

test('the phone drawer makes the column inert with the page', async () => {
  const mq = (q) => ({ matches: /760/.test(q) || /1080/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const ctx = await bootChat({ arms: sideArms, matchMedia: mq });
  await nav(ctx, 'runs');
  click(ctx, ctx.window.document.getElementById('mbar-menu'));
  assert.equal(els(ctx).aside.hasAttribute('inert'), true);
});

test('an Escape typed in the side column never steps the page back', async () => {
  const ctx = await bootChat({ arms: sideArms, rows: [ROW] });
  await nav(ctx, `history/${KEY}/${ROW.id}/details/overview`, 10);
  const at = ctx.window.location.hash;
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const ta = els(ctx).page.querySelector('textarea.ask-input');
  ta.focus();
  ta.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await ctx.settle(4);
  assert.equal(ctx.window.location.hash, at, 'still on the run\'s Details');
  ctx.window.document.querySelector('#hist-detail .hd').dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await ctx.settle(4);
  assert.notEqual(ctx.window.location.hash, at, 'from the page itself Escape still steps back');
});

test('a Diff file picked on the page (no hashchange) shows as a File chip in the column', async () => {
  const ctx = await bootChat({ arms: sideArms, rows: [ROW] });
  await nav(ctx, `history/${KEY}/${ROW.id}/details/diff`, 10);
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const chips = () => [...els(ctx).page.querySelectorAll('[data-ask-page-chips] .ask-page-chip')].map((n) => n.dataset.kind);
  assert.deepEqual(chips(), ['run']);
  const sec = ctx.window.document.querySelector('#hist-detail .hd .hd-sec[data-sec="diff"]:not([hidden])');
  assert.ok(sec, 'the Diff section is on screen');
  const file = ctx.window.document.createElement('button');
  file.className = 'hd-diff-file active';
  file.dataset.path = 'src/a.js';
  sec.appendChild(file);
  click(ctx, file);                                          // the page's own click marks the file; the column follows
  await ctx.settle(2);
  assert.deepEqual(chips(), ['run', 'file']);
});

test('a project page deep link with the column open names the project once the projects load', async () => {
  // The projects land after everything else that repaints the chips (the route, the run store's first frames).
  const held = [];
  const late = (href, opts, box) => (href.split('?')[0].endsWith('/api/projects')
    ? new Promise((r) => held.push(() => r(ok({ projects: [PROJECT] })))) : sideArms(href, opts, box));
  const ctx = await bootChat({ arms: late, local: { [OPEN_KEY]: '1' }, url: 'http://localhost:4317/#projects/worca-cc-551183d0' });
  await ctx.settle(8);
  assert.ok(held.length > 0, 'the projects are still loading');
  for (const release of held.splice(0)) release();
  await ctx.settle(8);
  const names = [...els(ctx).page.querySelectorAll('[data-ask-page-chips] .ask-page-chip')].map((n) => [n.dataset.kind, n.querySelector('.ask-page-chip-name').textContent]);
  assert.deepEqual(names, [['project', 'worca-cc']]);
});

test('opening the terminal while the column pushes folds the menu when the page gets too narrow (L12)', async () => {
  const ctx = await bootChat({ arms: sideArms, innerWidth: 1440 });
  const doc = ctx.window.document;
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  assert.equal(doc.querySelector('.sidebar').classList.contains('collapsed'), false, '1440 - 224 - 440 = 776');
  doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true }));
  await ctx.settle(4);
  assert.ok(doc.body.classList.contains('term-open'), 'the terminal opened');
  assert.equal(doc.querySelector('.sidebar').classList.contains('collapsed'), true, 'minus the terminal: under 640');
});

test('while the column folds the menu, the menu toggle is out of the way and stores nothing', async () => {
  const ctx = await bootChat({ arms: sideArms, innerWidth: 1280 });
  const doc = ctx.window.document;
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  assert.ok(doc.body.classList.contains('ask-side-rail'), 'style.css hides #side-toggle');
  click(ctx, doc.getElementById('side-toggle'));
  assert.equal(ctx.window.localStorage.getItem('worca-cc.sidebar.collapsed'), null, 'no stored choice');
  click(ctx, els(ctx).btn);
  assert.equal(doc.body.classList.contains('ask-side-rail'), false);
});

test('below 1081px the column covers the main column, which is inert while it shows', async () => {
  const ctx = await bootChat({ arms: sideArms, innerWidth: 1000 });
  const main = ctx.window.document.querySelector('main.main');
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  assert.equal(main.hasAttribute('inert'), true);
  ctx.window.innerWidth = 1440;
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  assert.equal(main.hasAttribute('inert'), false, 'pushing: the page stays live');
  ctx.window.innerWidth = 1000;
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  assert.equal(main.hasAttribute('inert'), true);
  click(ctx, els(ctx).btn);
  assert.equal(main.hasAttribute('inert'), false, 'hidden: the page is live again');
});

test('a saved run named once History loads: the Run chip follows the record', async () => {
  const ctx = await bootChat({ arms: sideArms, rows: [ROW], local: { [OPEN_KEY]: '1' }, url: `http://localhost:4317/#history/${KEY}/${ROW.id}` });
  await ctx.settle(10);
  const run = els(ctx).page.querySelector('[data-ask-page-chips] .ask-page-chip[data-kind="run"] .ask-page-chip-name');
  assert.equal(run && run.textContent, ROW.title);
});

test('Open in Chat from an empty column chat keeps that chat and its draft, even with another chat unread', async () => {
  const ctx = await bootChat({ arms: sideArms });
  const doc = ctx.window.document;
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const page = els(ctx).page;
  page.querySelector('textarea.ask-input').value = 'my draft';
  // A PR fix run's card lands in another chat while the column shows a new one (ui/server.mjs askPrFixRun): unread.
  ctx.dispatch({ type: 'ask-message', unread: true, threadId: 'ask_0000000b', message: { id: 'askm_0000000b', threadId: 'ask_0000000b', role: 'system', text: '', blocks: [], createdAt: 't' } });
  await ctx.settle(4);
  assert.equal(doc.getElementById('nav-chat-unread').hidden, false, 'precondition: another chat is unread');
  click(ctx, page.querySelector('[data-ask-open-in-chat]'));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#chat', 'home on the Chat page');
  assert.equal(page.dataset.host, 'page');
  assert.equal(page.dataset.view, 'home', 'the empty chat, not the unread one');
  assert.equal(page.querySelector('textarea.ask-input').value, 'my draft');
});

// ---- the guards a revert must turn red (each one a scenario a person hits) --------------------------------------
const TID = 'ask_00000001';
const SNAP = {
  thread: { id: TID, title: 'Deck chat', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
  messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }],
  attachments: [], runLinks: [], worktrees: [], inFlight: null,
};
const threadArms = (href, opts, box) => (href.split('?')[0].endsWith(`/api/ask/threads/${TID}`) ? ok(SNAP) : sideArms(href, opts, box));
const escape = (ctx, target) => {
  const ev = new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
};
const chipsOf = (ctx) => [...els(ctx).page.querySelectorAll('[data-ask-page-chips] .ask-page-chip')].map((n) => `${n.dataset.kind}:${n.querySelector('.ask-page-chip-name').textContent}`);
const scopeOf = (ctx) => els(ctx).page.querySelector('[data-ask-scope-btn]').getAttribute('aria-label');

test('openChat in the column opens the asked chat, takes a quote, and focuses the composer for an empty text even when the column is already open', async () => {
  const ctx = await bootChat({ arms: threadArms });
  const chat = ctx.window.__np.chat;
  await nav(ctx, 'runs');
  chat.openChat({ threadId: TID });
  await ctx.settle(8);
  let e = els(ctx);
  assert.equal(ctx.window.location.hash, '#runs', 'no navigation');
  assert.equal(e.aside.hidden, false);
  assert.equal(e.page.querySelector('[data-ask-side-thread]').textContent, 'Deck chat', 'the asked chat, not a new one');
  chat.openChat({ quote: { text: 'selected words' } });
  assert.match(e.page.querySelector('.ask-chips').textContent, /selected words/, 'the quote rides in the composer');
  const link = e.doc.createElement('a');
  link.href = '#x';
  e.doc.body.appendChild(link);
  link.focus();
  chat.openChat({ text: '  ' });
  e = els(ctx);
  assert.equal(e.doc.activeElement, e.page.querySelector('textarea.ask-input'), 'a blank text is no text: the composer takes the focus');
  assert.equal(e.page.querySelector('textarea.ask-input').value, '');
});

test('a reply that ends while the column is hidden lights the dot on the header button (L13)', async () => {
  const ctx = await bootChat({ arms: threadArms });
  await nav(ctx, 'runs');
  ctx.window.__np.chat.openChat({ threadId: TID });
  await ctx.settle(8);
  click(ctx, els(ctx).page.querySelector('[data-ask-side-hide]'));
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(els(ctx).aside.hidden, true);
  const dot = () => els(ctx).doc.getElementById('topnav-ask-dot');
  assert.equal(dot().hidden, true);
  ctx.dispatch({ type: 'ask-message', unread: true, threadId: TID, message: { id: 'askm_0000000b', threadId: TID, role: 'system', text: '', blocks: [], createdAt: 't' } });
  await ctx.settle(4);
  assert.equal(dot().hidden, false, 'the chat is not on screen, so its news is unread');
});

test('an Escape typed in the column leaves the New workspace wizard alone', async () => {
  const ctx = await bootChat({ arms: sideArms });
  await nav(ctx, 'workspace-create', 8);
  assert.equal(ctx.window.location.hash, '#workspace-create');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const ta = els(ctx).page.querySelector('textarea.ask-input');
  ta.focus();
  escape(ctx, ta);
  await ctx.settle(4);
  assert.equal(ctx.window.location.hash, '#workspace-create', 'the wizard stays open');
  escape(ctx, ctx.window.document.body);
  await ctx.settle(4);
  assert.notEqual(ctx.window.location.hash, '#workspace-create', 'from the page itself Escape still closes it');
});

test('an Escape typed in the column leaves an open run page and an open project page alone', async () => {
  const ctx = await bootChat({ arms: sideArms });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await nav(ctx, 'running/r1/details/overview', 10);
  const runAt = ctx.window.location.hash;
  assert.match(runAt, /^#running\/r1\/details/);
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const ta = els(ctx).page.querySelector('textarea.ask-input');
  ta.focus();
  escape(ctx, ta);
  await ctx.settle(4);
  assert.equal(ctx.window.location.hash, runAt, 'the run page stays on its Details');
  escape(ctx, ctx.window.document.body);
  await ctx.settle(4);
  assert.notEqual(ctx.window.location.hash, runAt, 'from the page itself Escape still steps back');
  await nav(ctx, 'projects/worca-cc-551183d0', 10);
  const projAt = ctx.window.location.hash;
  const ta2 = els(ctx).page.querySelector('textarea.ask-input');
  ta2.focus();
  escape(ctx, ta2);
  await ctx.settle(4);
  assert.equal(ctx.window.location.hash, projAt, 'the project page stays open');
  escape(ctx, ctx.window.document.body);
  await ctx.settle(6);
  assert.notEqual(ctx.window.location.hash, projAt, 'from the page itself Escape still leaves the project');
});

test('an Escape typed in the column keeps the Runs list selection', async () => {
  const ctx = await bootChat({ arms: sideArms, rows: [ROW, { ...ROW, id: 'r2-pipeline', title: 'Second' }] });
  await nav(ctx, 'runs', 10);
  const doc = ctx.window.document;
  const row = doc.querySelector('#runs-list a.runs-row');
  assert.ok(row, 'a Runs row is listed');
  row.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  await ctx.settle(2);
  const selected = () => !doc.getElementById('runs-bulk').hidden;
  assert.ok(selected(), 'the row is selected');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const ta = els(ctx).page.querySelector('textarea.ask-input');
  ta.focus();
  escape(ctx, ta);
  await ctx.settle(2);
  assert.ok(selected(), 'the selection survives an Escape typed in the chat');
  escape(ctx, doc.body);
  await ctx.settle(2);
  assert.equal(selected(), false, 'from the page itself Escape clears it');
});

test('a workspace page deep link with the column open names the workspace once the workspaces load', async () => {
  const ctx = await bootChat({ arms: sideArms, local: { [OPEN_KEY]: '1' }, url: 'http://localhost:4317/#workspaces/wks-havn-649ebfe7' });
  await ctx.settle(8);
  assert.deepEqual(chipsOf(ctx), ['workspace:Havn']);
});

test('a saved run whose History row changes under the page: the Run chip and the empty state follow it', async () => {
  const ctx = await bootChat({ arms: sideArms, rows: [ROW], local: { [OPEN_KEY]: '1' }, url: `http://localhost:4317/#history/${KEY}/${ROW.id}` });
  await ctx.settle(10);
  const first = () => els(ctx).page.querySelector('[data-ask-side-suggest] .ask-side-opt')?.textContent;
  assert.deepEqual(chipsOf(ctx), [`run:${ROW.title}`]);
  assert.equal(first(), 'What did it change?');
  ctx.box.rows = [{ ...ROW, title: 'Renamed run', status: 'error' }];
  ctx.wsBox.ws.dispatch('close', {});                       // the socket drops and comes back: History reloads
  ctx.dispatch({ type: 'hello', runs: [] });
  await ctx.settle(10);
  assert.deepEqual(chipsOf(ctx), ['run:Renamed run'], 'the chip names the new row');
  assert.equal(first(), 'Why did it stop?', 'and the suggestions read its status');
});

test('a Diff deep link with the column open: the first file, opened with no click, is a File chip', async () => {
  const results = { summary: { filesNew: 0, filesChanged: 1, linesAdded: 1, linesRemoved: 0 }, changedFiles: [{ path: 'src/a.js', added: 1, removed: 0 }], newFiles: [] };
  const ctx = await bootChat({ arms: sideArms, rows: [ROW], detail: { ...DETAIL, results }, local: { [OPEN_KEY]: '1' }, url: `http://localhost:4317/#history/${KEY}/${ROW.id}/details/diff` });
  await ctx.settle(15);
  assert.ok(ctx.window.document.querySelector('#hist-detail .hd-diff-file.active'), 'precondition: the Diff opened its first file');
  assert.deepEqual(chipsOf(ctx), [`run:${ROW.title}`, 'file:src/a.js']);
});

test('a reload on a live run page with the column open: the run lands after the chips painted, and its chip names it', async () => {
  const ctx = await bootChat({ arms: sideArms, local: { [OPEN_KEY]: '1' }, url: 'http://localhost:4317/#running/r1' });
  await ctx.settle(8);
  hello(ctx, [liveRun()]);
  await ctx.settle(8);
  assert.deepEqual(chipsOf(ctx), ['run:Add dark mode']);
});

test('a live run Diff with the column open: its first file, opened with no click, is a File chip', async () => {
  const liveDiff = { results: { summary: { filesNew: 1, filesChanged: 0, linesAdded: 1, linesRemoved: 0 }, newFiles: [{ path: 'src/limiter.js', status: 'A', added: 1, removed: 0 }], changedFiles: [] }, patch: '', untrackedCapped: false };
  // The worktree diff lands after the route has painted the chips (a real fetch takes its time).
  const late = () => new Promise((r) => setTimeout(() => r(ok(liveDiff)), 60));
  const arms = (href, opts, box) => (href.split('?')[0].endsWith('/api/runs/r1/live-diff') ? late() : sideArms(href, opts, box));
  const ctx = await bootChat({ arms, local: { [OPEN_KEY]: '1' } });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await nav(ctx, 'running/r1/details/diff', 10);
  await new Promise((r) => setTimeout(r, 150));
  await ctx.settle(6);
  assert.ok(ctx.window.document.querySelector('.rd-sec[data-sec="diff"] .rd-diff-row.active'), 'precondition: the Diff opened its first file');
  assert.deepEqual(chipsOf(ctx), ['run:Add dark mode', 'file:src/limiter.js']);
});

test('Open History in Chat is spent once: the person closes the History column and it stays closed on the next chat', async () => {
  const ctx = await bootChat({ arms: threadArms });
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  click(ctx, els(ctx).page.querySelector('[data-ask-side-thread]'));
  click(ctx, els(ctx).page.querySelector('[data-ask-history-in-chat]'));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  const page = els(ctx).page;
  assert.equal(page.dataset.history, 'open');
  assert.equal(ctx.window.location.hash, '#chat', 'an empty chat goes to the Chat home');
  click(ctx, page.querySelector('.chat-history-toggle'));
  assert.equal(page.dataset.history, 'closed', 'the person closed it');
  await nav(ctx, `chat/${TID}`, 8);
  assert.equal(els(ctx).page.dataset.history, 'closed', 'the one-off request is spent');
});

test('the terminal: closing it gives the menu back, and dragging its width re-asks the rail question (L12)', async () => {
  const ctx = await bootChat({ arms: sideArms, innerWidth: 1440 });
  const doc = ctx.window.document;
  const collapsed = () => doc.querySelector('.sidebar').classList.contains('collapsed');
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const toggleTerm = () => doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true }));
  toggleTerm();
  await ctx.settle(4);
  assert.equal(collapsed(), true, 'open: under 640');
  doc.body.style.setProperty('--term-w', '120px');          // the pane's own grip writes --term-w on the body
  await ctx.settle(2);
  assert.equal(collapsed(), false, '1440 - 224 - 440 - 120 = 656: room again');
  doc.body.style.setProperty('--term-w', '460px');
  await ctx.settle(2);
  assert.equal(collapsed(), true);
  toggleTerm();
  await ctx.settle(4);
  assert.equal(doc.body.classList.contains('term-open'), false, 'the terminal closed');
  assert.equal(collapsed(), false, 'closed: the menu is back');
});

test('a fold the column forces repaints the menu as the rail tier does: the rail Runs tile gets its title', async () => {
  const ctx = await bootChat({ arms: sideArms, innerWidth: 1280 });
  const doc = ctx.window.document;
  await nav(ctx, 'runs');
  const runs = doc.querySelector('.nav button[data-nav="runs"]');
  assert.notEqual(runs.getAttribute('title'), 'Runs', 'precondition: the open menu shows its label');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  assert.equal(doc.querySelector('.sidebar').classList.contains('collapsed'), true);
  assert.equal(runs.getAttribute('title'), 'Runs', 'the rail has no labels: Runs names itself');
});

test('re-entering the Chat page does not re-attach the chat page: the composer keeps its focus', async () => {
  const ctx = await bootChat({ arms: threadArms });
  const doc = ctx.window.document;
  await nav(ctx, 'chat', 8);
  const ta = els(ctx).page.querySelector('textarea.ask-input');
  ta.focus();
  assert.equal(doc.activeElement, ta);
  await nav(ctx, `chat/${TID}`, 8);
  assert.equal(doc.activeElement, els(ctx).page.querySelector('textarea.ask-input'), 'the focus stays in the composer');
});

test('the phone drawer closing leaves the page inert while the column still covers it', async () => {
  const mq = (q) => ({ matches: /760/.test(q) || /1080/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const ctx = await bootChat({ arms: sideArms, matchMedia: mq });
  const main = ctx.window.document.querySelector('main.main');
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  assert.equal(main.hasAttribute('inert'), true, 'the column covers the page');
  const menu = ctx.window.document.getElementById('mbar-menu');
  click(ctx, menu);
  assert.equal(main.hasAttribute('inert'), true, 'drawer open');
  click(ctx, menu);
  assert.equal(ctx.window.document.body.classList.contains('nav-open'), false, 'drawer closed');
  assert.equal(main.hasAttribute('inert'), true, 'the column still covers the page: it stays inert');
});

test('Open in Chat of a column chat with no row yet, after a boot on another page, keeps its page scope and its draft (L8)', async () => {
  const ctx = await bootChat({ arms: sideArms, local: { [OPEN_KEY]: '1' }, url: 'http://localhost:4317/#projects/worca-cc-551183d0' });
  await ctx.settle(8);
  assert.equal(scopeOf(ctx), 'Chat scope: worca-cc', 'a new column chat starts in the page scope (L3)');
  const page = els(ctx).page;
  page.querySelector('textarea.ask-input').value = 'my draft';
  click(ctx, page.querySelector('[data-ask-open-in-chat]'));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#chat');
  assert.equal(page.dataset.host, 'page');
  assert.equal(scopeOf(ctx), 'Chat scope: worca-cc', 'the same new chat: its scope kept');
  assert.equal(page.querySelector('textarea.ask-input').value, 'my draft');
});

// ---- v4: the guards a cycle-3 audit found untested or missing ---------------------------------------------------
const sideOf = (ctx) => ctx.window.__np.chat.askSide;

test('openChat from an artifact popup on a column page closes the popup, as the route to Chat did; the quote lands in the column', async () => {
  const ctx = await bootChat({ arms: sideArms });
  const chat = ctx.window.__np.chat;
  const doc = ctx.window.document;
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await nav(ctx, 'running/r1', 8);
  chat.deps.openArtifact({ runId: 'r1', pipelineId: 'p1' }, { path: 'plans/plan.md', kind: 'plan' });
  await ctx.settle(4);
  assert.ok(doc.querySelector('.viewer-modal.apv'), 'precondition: the popup is open');
  chat.openChat({ quote: { text: 'the span' } });                   // Pinpoint's "to the chat" (pinpointDraft)
  await ctx.settle(4);
  const e = els(ctx);
  assert.equal(doc.querySelector('.viewer-modal.apv'), null, 'the popup closed');
  assert.equal(e.aside.hidden, false);
  assert.match(e.page.querySelector('.ask-chips').textContent, /the span/);
  assert.equal(doc.activeElement, e.page.querySelector('textarea.ask-input'), 'and the composer has the focus');
});

/** A new chat in the column, hidden; then a PR fix run's card lands in chat TID (unread): the dot lights. */
async function unreadElsewhere(ctx) {
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  click(ctx, els(ctx).page.querySelector('[data-ask-side-hide]'));
  await new Promise((r) => setTimeout(r, 360));
  ctx.dispatch({ type: 'ask-message', unread: true, threadId: TID, message: { id: 'askm_0000000b', threadId: TID, role: 'system', text: '', blocks: [], createdAt: 't' } });
  await ctx.settle(4);
  assert.equal(els(ctx).doc.getElementById('topnav-ask-dot').hidden, false, 'precondition: another chat has news');
}

test('the header button opens the chat whose reply lit its dot, as the Chat row does (L13)', async () => {
  const ctx = await bootChat({ arms: threadArms });
  await unreadElsewhere(ctx);
  click(ctx, els(ctx).btn);
  await ctx.settle(8);
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'Deck chat', 'the chat with the news');
  assert.equal(els(ctx).doc.getElementById('topnav-ask-dot').hidden, true);
});

test('an entry point that opens the column with a dot lit keeps the chat the column showed', async () => {
  const ctx = await bootChat({ arms: threadArms });
  await unreadElsewhere(ctx);
  ctx.window.__np.chat.openChat({ text: 'about this page' });
  await ctx.settle(8);
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'New chat', 'the text goes to the chat it was meant for');
  assert.equal(els(ctx).page.querySelector('textarea.ask-input').value, 'about this page');
});

test('where the column covers the page, a run card or a page link in the chat steps it aside so that page shows; pushing, it stays', async () => {
  const ctx = await bootChat({ arms: sideArms, innerWidth: 1000 });
  const chat = ctx.window.__np.chat;
  const main = ctx.window.document.querySelector('main.main');
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  chat.deps.openRunPanel({ runId: 'r1', pipelineId: 'p1' });         // a run card in the column (L9)
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 360));
  await ctx.settle(4);
  assert.match(ctx.window.location.hash, /^#running\/r1/);
  assert.equal(els(ctx).aside.hidden, true, 'the run page shows');
  assert.equal(main.hasAttribute('inert'), false, 'and is live');
  assert.equal(ctx.window.localStorage.getItem(OPEN_KEY), '1', 'the choice is kept');
  await nav(ctx, 'schedules');
  assert.equal(els(ctx).aside.hidden, true, 'it stays aside on the next page');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const e = els(ctx);
  assert.equal(e.aside.hidden, false, 'the button brings it back');
  const link = e.doc.createElement('a');
  link.href = '#projects';
  e.page.querySelector('.ask-transcript').appendChild(link);
  for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    link.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true, cancelable: true, [mod]: true }));
    assert.equal(sideOf(ctx).shown(), true, `${mod}: a new tab or window, the column stays`);
  }
  const own = e.doc.createElement('a');
  own.href = '#projects';
  own.addEventListener('click', (ev) => ev.preventDefault());       // a link the chat handles itself
  e.page.querySelector('.ask-transcript').appendChild(own);
  own.click();
  assert.equal(sideOf(ctx).shown(), true, 'a link the chat handled leaves it be');
  link.click();
  assert.equal(sideOf(ctx).shown(), false, 'a page link steps it aside');
  ctx.window.innerWidth = 1440;
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  chat.deps.openRunPanel({ runId: 'r1', pipelineId: 'p1' });
  assert.equal(sideOf(ctx).shown(), true, 'pushing: the run page is beside the chat already');
});

test('a reply streaming in the column survives the Chat row, Open in Chat and a hop to Workflows: the same live row, no refetch', async () => {
  const ctx = await bootChat({ arms: threadArms });
  const doc = ctx.window.document;
  const gets = () => ctx.calls.filter((c) => c.url.split('?')[0].endsWith(`/api/ask/threads/${TID}`) && (c.opts.method || 'GET') === 'GET').length;
  await nav(ctx, 'runs');
  ctx.window.__np.chat.openChat({ threadId: TID });
  await ctx.settle(8);
  let seq = 0;
  const frame = (f) => { seq += 1; ctx.dispatch({ ...f, threadId: TID, messageId: 'askm_00000002', seq }); };
  frame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'claude-opus-5-5', effort: 'high', startedAt: '2026-10-24T10:00:00.000Z' });
  frame({ type: 'ask-delta', text: 'He' });
  await ctx.settle(4);
  const live = doc.querySelector('[data-chat-page] .ask-msg-assistant');
  assert.ok(live && live.querySelector('.ask-thinking'), 'precondition: a live reply in the column');
  const before = gets();
  const routes = [
    ['the Chat row', async () => { click(ctx, doc.querySelector('.nav button[data-nav="chat"]')); ctx.window.dispatchEvent(new ctx.window.Event('hashchange')); await ctx.settle(6); }],
    ['back to a page', async () => { await nav(ctx, 'runs'); }],
    ['Open in Chat', async () => { click(ctx, els(ctx).page.querySelector('[data-ask-open-in-chat]')); ctx.window.dispatchEvent(new ctx.window.Event('hashchange')); await ctx.settle(6); }],
    ['Workflows', async () => { await nav(ctx, 'workflows', 8); }],
    ['a page again', async () => { await nav(ctx, 'runs'); }],
  ];
  for (const [name, go] of routes) {
    await go();
    frame({ type: 'ask-delta', text: 'l' });
    await ctx.settle(2);
    assert.equal(doc.querySelector('[data-chat-page] .ask-msg-assistant'), live, `${name}: the same live row`);
    assert.ok(live.isConnected && live.querySelector('.ask-thinking'), `${name}: still live, orb and all`);
  }
  assert.equal(gets(), before, 'nothing refetched');
  assert.equal(els(ctx).aside.hidden, false, 'back in the column');
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'Deck chat');
});

test('openChat with a chat or a quote from Workflows or straight from Chat goes to the Chat page; the column never opens hidden', async () => {
  const ctx = await bootChat({ arms: threadArms, local: { [OPEN_KEY]: '1' } });
  const chat = ctx.window.__np.chat;
  await nav(ctx, 'runs');
  assert.equal(els(ctx).aside.hidden, false, 'precondition: the column is wanted');
  await nav(ctx, 'workflows', 8);
  chat.openChat({ threadId: TID });                                 // an alert for a chat reply
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(8);
  let e = els(ctx);
  assert.equal(ctx.window.location.hash, `#chat/${TID}`, 'Workflows: to the Chat page');
  assert.equal(e.page.parentElement, e.section);
  assert.equal(e.aside.hidden, true);
  await nav(ctx, 'workflows', 8);
  chat.openChat({ quote: { text: 'the span' }, text: 'why?' });       // Pinpoint on Workflows
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(8);
  e = els(ctx);
  assert.match(ctx.window.location.hash, /^#chat/);
  assert.equal(e.aside.hidden, true);
  assert.match(e.page.querySelector('.ask-chips').textContent, /the span/);
  await nav(ctx, 'runs');
  await nav(ctx, 'chat', 8);                                          // straight from a column page to Chat
  chat.openChat({ threadId: TID, quote: { text: 'second' } });
  await ctx.settle(8);
  e = els(ctx);
  assert.equal(e.aside.hidden, true, 'Chat: never the column');
  assert.equal(e.page.dataset.host, 'page');
  assert.equal(e.page.parentElement, e.section);
});

test("leaving the project page's chip out takes the project out of a new column chat's scope too", async () => {
  const ctx = await bootChat({ arms: sideArms, local: { [OPEN_KEY]: '1' }, url: 'http://localhost:4317/#projects/worca-cc-551183d0' });
  await ctx.settle(8);
  assert.equal(scopeOf(ctx), 'Chat scope: worca-cc');
  click(ctx, els(ctx).page.querySelector('.ask-page-chip-x'));
  await ctx.settle(2);
  assert.deepEqual(chipsOf(ctx), []);
  assert.equal(scopeOf(ctx), 'Chat scope: No project', 'what the chip said: this project is left out');
});

// ---- v5 (cycle 4): the other pages the chat opens itself, and the dot after a route brings the column back --------
const CTX_TID = 'ask_00000002';
const NP_CARD = { target: 'project', projectKey: 'worca-cc-551183d0', projectName: 'worca-cc', projectDir: '/tmp/p', workspaceId: null, workspaceName: null, members: null,
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'Fix the login bug', title: 'Fix login', sourceBranch: '', featureBranch: 'worca/fix-login', sourceBranchByKey: null, note: '', attachments: [] };
const CTX_SNAP = {
  thread: { ...SNAP.thread, id: CTX_TID, title: 'Topics chat', contexts: [{ kind: 'page', id: 'schedules', label: 'Schedules' }] },
  messages: [
    { ...SNAP.messages[0], threadId: CTX_TID },
    { ...SNAP.messages[0], id: 'askm_00000002', threadId: CTX_TID, seq: 2, role: 'assistant', text: 'Here is a run.', status: 'done',
      blocks: [{ kind: 'card', id: 'card_00000001', state: 'proposed', card: NP_CARD }] },
  ],
  attachments: [], runLinks: [], worktrees: [], inFlight: null,
};
const ctxArms = (href, opts, box) => (href.split('?')[0].endsWith(`/api/ask/threads/${CTX_TID}`) ? ok(CTX_SNAP) : sideArms(href, opts, box));

test('where the column covers the page, a topic row and Open in New run from the chat step it aside too', async () => {
  const ctx = await bootChat({ arms: ctxArms, innerWidth: 1000 });
  const main = ctx.window.document.querySelector('main.main');
  await nav(ctx, 'runs');
  ctx.window.__np.chat.openChat({ threadId: CTX_TID });
  await ctx.settle(8);
  let e = els(ctx);
  assert.equal(main.hasAttribute('inert'), true, 'precondition: the column covers the list');
  click(ctx, e.page.querySelector('[data-ask-ctx-btn]'));
  click(ctx, e.doc.querySelector('.ask-pop-ctx .ask-ctx-topic'));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 360));
  await ctx.settle(4);
  assert.equal(ctx.window.location.hash, '#schedules');
  assert.equal(els(ctx).aside.hidden, true, 'the page the topic names shows');
  assert.equal(main.hasAttribute('inert'), false, 'and is live');
  click(ctx, els(ctx).btn);
  await ctx.settle(8);
  e = els(ctx);
  assert.equal(e.aside.hidden, false, 'the button brings the chat back');
  click(ctx, e.page.querySelector('[data-ask-card-open-np]'));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 360));
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#new');
  assert.equal(els(ctx).aside.hidden, true, 'New run shows with the card in it');
  assert.equal(main.hasAttribute('inert'), false);
  assert.equal(ctx.window.localStorage.getItem(OPEN_KEY), '1', 'the choice is kept');
});

test('news that lands while the column is away keeps the dot when a route brings the column back; the button then opens that chat', async () => {
  const ctx = await bootChat({ arms: threadArms });
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  await nav(ctx, 'workflows', 8);                                   // no column there
  ctx.dispatch({ type: 'ask-message', unread: true, threadId: TID, message: { id: 'askm_0000000b', threadId: TID, role: 'system', text: '', blocks: [], createdAt: 't' } });
  await ctx.settle(4);
  const dot = () => els(ctx).doc.getElementById('topnav-ask-dot');
  const row = () => els(ctx).doc.getElementById('nav-chat-unread');
  assert.equal(row().hidden, false, 'precondition: the Chat row has the news');
  await nav(ctx, 'runs');
  assert.equal(els(ctx).aside.hidden, false, 'the column is back');
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'New chat', 'on the chat it showed');
  assert.equal(dot().hidden, false, 'that chat is not the news: the dot stays');
  assert.equal(row().hidden, false, 'and so does the Chat row\'s');
  click(ctx, els(ctx).btn);                                         // the button hides a shown column
  await new Promise((r) => setTimeout(r, 360));
  click(ctx, els(ctx).btn);
  await ctx.settle(8);
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'Deck chat', 'the chat with the news');
  assert.equal(dot().hidden, true);
});

// ---- v6 (cycle 5): a keyboard topic row, an entry point naming a chat, Open History in Chat below 1100px ----------------
test('where the column covers the page, a topic row chosen by keyboard hands the focus to the header button, never <body>', async () => {
  const ctx = await bootChat({ arms: ctxArms, innerWidth: 1000 });
  await nav(ctx, 'runs');
  ctx.window.__np.chat.openChat({ threadId: CTX_TID });
  await ctx.settle(8);
  const e = els(ctx);
  click(ctx, e.page.querySelector('[data-ask-ctx-btn]'));
  const row = e.doc.querySelector('.ask-pop-ctx .ask-ctx-topic');
  row.focus();
  click(ctx, row);
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 360));
  await ctx.settle(4);
  assert.equal(ctx.window.location.hash, '#schedules');
  assert.equal(els(ctx).aside.hidden, true);
  assert.equal(e.doc.activeElement, e.btn);
});

const bothArms = (href, opts, box) => (href.split('?')[0].endsWith(`/api/ask/threads/${CTX_TID}`) ? ok(CTX_SNAP) : threadArms(href, opts, box));

test('openChat naming a chat on a hidden column opens that chat at once: the dot for the chat it last showed stays lit', async () => {
  const ctx = await bootChat({ arms: bothArms });
  await nav(ctx, 'runs');
  ctx.window.__np.chat.openChat({ threadId: TID });                 // the column on Deck chat
  await ctx.settle(8);
  click(ctx, els(ctx).page.querySelector('[data-ask-side-hide]'));
  await new Promise((r) => setTimeout(r, 360));
  ctx.dispatch({ type: 'ask-message', unread: true, threadId: TID, message: { id: 'askm_0000000b', threadId: TID, role: 'system', text: '', blocks: [], createdAt: 't' } });
  await ctx.settle(4);
  const dot = () => els(ctx).doc.getElementById('topnav-ask-dot');
  assert.equal(dot().hidden, false, 'precondition: news in the chat the column showed');
  const gets = () => ctx.calls.filter((c) => c.url.split('?')[0].endsWith(`/api/ask/threads/${TID}`)).length;
  const before = gets();
  ctx.window.__np.chat.openChat({ threadId: CTX_TID });             // a desktop notification for another chat
  await ctx.settle(8);
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'Topics chat');
  assert.equal(gets(), before, 'the stored chat is not loaded on the way');
  assert.equal(dot().hidden, false, 'Deck chat never showed: its dot stays');
  assert.equal(els(ctx).btn.getAttribute('aria-label'), 'Ask worca, new reply');
  ctx.window.__np.chat.openChat({ threadId: TID });                 // the column already open: openChat switches to the chat it names
  await ctx.settle(8);
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'Deck chat');
  assert.equal(dot().hidden, true, 'and its news is on screen now');
});

test('Open History in Chat below 1100px: the History overlay takes the focus, never <body>', async () => {
  const ctx = await bootChat({ arms: sideArms, innerWidth: 1000 });
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const page = els(ctx).page;
  click(ctx, page.querySelector('[data-ask-side-thread]'));
  const b = page.querySelector('[data-ask-history-in-chat]');
  b.focus();
  click(ctx, b);
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.match(ctx.window.location.hash, /^#chat/);
  assert.equal(page.dataset.history, 'open');
  assert.equal(ctx.window.document.activeElement, page.querySelector('#chat-history'));
});

// ---- v7 (cycle 6): an entry point names a chat once; a keyboard topic row beside the page ------------------------------
test('openChat naming a chat on a column that is already open leaves nothing behind: a later route brings back the chat the person moved to', async () => {
  const ctx = await bootChat({ arms: bothArms });
  await nav(ctx, 'runs');
  click(ctx, els(ctx).btn);                                         // the column, a new chat
  await ctx.settle(4);
  ctx.window.__np.chat.openChat({ threadId: CTX_TID });             // already open: show() has nothing to reveal
  await ctx.settle(8);
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'Topics chat');
  click(ctx, els(ctx).page.querySelector('[data-ask-side-new]'));   // the person starts a new chat
  await ctx.settle(4);
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'New chat');
  await nav(ctx, 'workflows', 8);                                   // no column there
  await nav(ctx, 'schedules', 8);                                   // the route brings it back
  assert.equal(els(ctx).aside.hidden, false);
  assert.equal(els(ctx).page.querySelector('[data-ask-side-thread]').textContent, 'New chat', 'the chat it showed, not the one the entry point named earlier');
});

test('beside the page (> 1080px), a topic row chosen by keyboard keeps the column and hands the focus to its field, never <body>', async () => {
  const ctx = await bootChat({ arms: ctxArms, innerWidth: 1440 });
  await nav(ctx, 'runs');
  ctx.window.__np.chat.openChat({ threadId: CTX_TID });
  await ctx.settle(8);
  const e = els(ctx);
  click(ctx, e.page.querySelector('[data-ask-ctx-btn]'));
  const row = e.doc.querySelector('.ask-pop-ctx .ask-ctx-topic');
  row.focus();
  click(ctx, row);
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#schedules');
  assert.equal(els(ctx).aside.hidden, false, 'the column stays beside the page');
  assert.equal(e.doc.activeElement, e.page.querySelector('textarea.ask-input'));
});

// ---- the merge with the Chats column (#948): its menus open in <body>, outside #ask-side (merge review cycle 1) ------
const LISTED = { ...SNAP.thread, createdAt: '2026-10-24T10:00:00.000Z', updatedAt: '2026-10-24T10:00:00.000Z' };
const listArms = (href, opts, box) => (href.split('?')[0].endsWith('/api/ask/threads')
  ? ok({ threads: [LISTED], total: 1, counts: { all: 1, needs: 0, archived: 0 } }) : threadArms(href, opts, box));
/** Opens a chat row's ⋯ menu from the column's chats menu; answers the menu (it sits in <body>, not in the column). */
const openRowMenu = async (ctx) => {
  const e = els(ctx);
  if (e.aside.hidden) { click(ctx, e.btn); await ctx.settle(4); }
  if (e.page.dataset.history !== 'open') e.page.querySelector('[data-ask-side-thread]').click();
  await ctx.settle(4);
  e.page.querySelector(`[data-chat-history] .runs-item[data-row-key="chat:${TID}"] .runs-more`).click();
  const menu = e.doc.querySelector('.wfv-menu');
  assert.ok(menu && !e.aside.contains(menu), 'precondition: the row menu sits outside the column');
  return menu;
};

test('Escape in a chat row menu the column opened closes the menu only: the project page and the New workspace wizard stay', async () => {
  const ctx = await bootChat({ arms: listArms });
  for (const hash of ['projects/worca-cc-551183d0', 'workspace-create']) {
    await nav(ctx, hash, 10);
    const at = ctx.window.location.hash;
    const menu = await openRowMenu(ctx);
    escape(ctx, menu.querySelector('[role="menuitem"]'));
    await ctx.settle(4);
    assert.equal(ctx.window.location.hash, at, `${hash}: the page stays`);
    assert.equal(els(ctx).doc.querySelector('.wfv-menu'), null, `${hash}: the Escape closed the menu`);
  }
});

test('? typed in the column on the Runs page opens the Chat keys, not the Runs keys', async () => {
  const ctx = await bootChat({ arms: listArms });
  await nav(ctx, 'runs', 8);
  click(ctx, els(ctx).btn);
  await ctx.settle(4);
  const e = els(ctx);
  const thread = e.page.querySelector('[data-ask-side-thread]');
  thread.focus();
  thread.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
  await ctx.settle(2);
  const heads = [...e.doc.querySelectorAll('.keys-modal .keys-h')].map((n) => n.textContent);
  assert.ok(heads.includes('Chat page'), `the Chat sheet (${heads.join(', ')})`);
  assert.ok(!heads.includes('Runs list'), 'not the Runs sheet');
});
