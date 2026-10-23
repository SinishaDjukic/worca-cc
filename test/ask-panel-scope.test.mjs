// test/ask-panel-scope.test.mjs — the #397 project selector: composer-row
// button (right of "+"), popover, per-field context merge on send, PATCH
// persistence, restore on thread load, the scope frame, the divider; no scope warning card (P4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key } from './helpers/ask-panel-harness.mjs';
import { registerChatCard, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';

const TID = 'ask_00000001';

const OPTIONS = {
  '/api/projects': { projects: [
    { key: 'demo-00000001', name: 'Demo', path: '/Users/me/demo', displayPath: '~/demo', exists: true, vcs: 'git' },
    { key: 'notes-00000003', name: 'Notes', path: 'C:\\Users\\me\\Notes', displayPath: 'C:\\Users\\me\\Notes', exists: true, vcs: 'none' },
    { key: 'gone-00000002', name: 'Gone', path: '/p/gone', exists: false },
  ] },
  '/api/workflows': { workflows: [] },
  '/api/guardrails': { guardrails: [] },
  '/api/workspaces': { workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: [], projectPaths: [] }] },
};

function handler(state) {
  return (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (OPTIONS[url]) return { ok: true, status: 200, json: async () => OPTIONS[url] };
    if (url === '/api/ask/threads' && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    }
    if (url === `/api/ask/threads/${TID}` && method === 'PATCH') {
      state.patches.push(JSON.parse(opts.body));
      if (state.patchBusy) return { ok: false, status: 409, json: async () => ({ error: 'wait for this reply to finish before changing the chat scope', code: 'TURN_IN_FLIGHT' }) };
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID } }) };
    }
    if (url === `/api/ask/threads/${TID}` && method === 'GET' && state.snap) {
      return { ok: true, status: 200, json: async () => state.snap };
    }
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      state.bodies.push(JSON.parse(opts.body));
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: 'askm_00000001' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

const scopeItems = (doc) => [...doc.querySelectorAll('.ask-scope-item')];
const ticks = async (ctx, n = 3) => { for (let i = 0; i < n; i++) await ctx.tick(); };
const label = (btn) => btn.querySelector('.ask-scope-label').textContent;
const rowNamed = (doc, name) => scopeItems(doc).find((i) => i.querySelector('.ask-model-name').textContent === name);
const storeWith = (id) => { const m = new Map([['worca-cc.ask.thread', id]]); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const snapOf = ({ context = null, messages = [] } = {}) => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context, totals: {} }, messages, attachments: [], runLinks: [], worktrees: [], inFlight: null });
const send = async (ctx, text) => { ctx.doc.querySelector('textarea.ask-input').value = text; ctx.doc.querySelector('[data-ask-send]').click(); await ticks(ctx); };

test('#397 + P4: pick a project → label, per-field send context, PATCH once a thread exists; No project sends no page target', async () => {
  const state = { patches: [], bodies: [], snap: null };
  const ctx = makePanel({
    fetchHandler: handler(state),
    getPageContext: () => ({ view: 'history-detail', projectDir: '/p/other', pipelineId: '4e1f2a9b', diffPath: 'src/a.js' }),
  });
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  assert.ok(btn, 'the composer row carries the scope button');
  assert.equal(btn.textContent.trim(), 'No project');

  btn.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const items = scopeItems(ctx.doc);
  assert.equal(items[0].querySelector('.ask-model-name').textContent, 'No project', 'No project is the first row');
  assert.ok(!items.some((i) => /Auto/.test(i.textContent)), 'no Auto (U5)');
  assert.ok(items.some((i) => /Gone \(missing\)/.test(i.textContent)), 'a missing project keeps its marker');
  assert.ok(items.some((i) => /Team/.test(i.textContent)), 'workspaces are listed too');
  items.find((i) => /^Demo/.test(i.textContent.trim())).click();
  await ctx.tick();
  assert.equal(btn.textContent.trim(), 'Demo');
  assert.equal(state.patches.length, 0, 'no thread yet — nothing to PATCH');

  // send: the pin replaces the page's target keys; everything else rides along
  ctx.doc.querySelector('textarea.ask-input').value = 'hello';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(state.bodies.length, 1);
  const sent = state.bodies[0].context;
  assert.equal(sent.pinned, true);
  assert.equal(sent.projectKey, 'demo-00000001');
  assert.equal(sent.projectDir, undefined, 'the page target is replaced, not merged alongside');
  assert.equal(sent.view, 'history-detail');
  assert.equal(sent.pipelineId, '4e1f2a9b');
  assert.equal(sent.diffPath, 'src/a.js');

  // with a thread: switching back to Auto PATCHes the scope and sends pinned:false
  btn.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  rowNamed(ctx.doc, 'No project').click();
  await ctx.tick();
  assert.deepEqual(state.patches, [{ scope: { pinned: false } }]);
  assert.equal(btn.textContent.trim(), 'No project');
  ctx.doc.querySelector('textarea.ask-input').value = 'again';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const none = state.bodies[1].context;
  assert.equal(none.pinned, false);
  assert.equal(none.projectDir, undefined, 'No project carries no page target (CONTRACT §4)');
  assert.equal(none.pipelineId, '4e1f2a9b', 'the run on screen still rides');
  assert.equal(none.diffPath, 'src/a.js');

  // pinning WITH a thread PATCHes the project scope
  btn.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  scopeItems(ctx.doc).find((i) => /Team/.test(i.textContent)).click();
  await ctx.tick();
  assert.deepEqual(state.patches[1], { scope: { pinned: true, workspaceId: 'wks-team-0000abcd' } });
  assert.equal(btn.textContent.trim(), 'Team');
  ctx.panel.destroy();
});

test('MCP registry §9.1 + P4: a pin and No project both strip the fallback tag with the page target', async () => {
  const state = { patches: [], bodies: [], snap: null };
  const ctx = makePanel({
    fetchHandler: handler(state),
    getPageContext: () => ({ view: 'settings', projectDir: '/p/other', projectSource: 'fallback' }),
  });
  ctx.panel.open();
  const send = async (text) => {
    ctx.doc.querySelector('textarea.ask-input').value = text;
    ctx.doc.querySelector('[data-ask-send]').click();
    await ctx.tick(); await ctx.tick(); await ctx.tick();
  };
  await send('auto');
  assert.equal(state.bodies[0].context.projectSource, undefined, 'No project sends no page target, tagged or not');
  assert.equal(state.bodies[0].context.projectDir, undefined);
  assert.equal(state.bodies[0].context.view, 'settings');
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  btn.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  scopeItems(ctx.doc).find((i) => /^Demo/.test(i.textContent.trim())).click();
  await ctx.tick();
  ctx.panel.pushServerFrame({ type: 'ask-done', threadId: TID, messageId: 'askm_00000001', seq: 1, text: '', blocks: [], status: 'done' });
  await send('pinned');
  const pinned = state.bodies.at(-1).context;
  assert.equal(pinned.projectKey, 'demo-00000001');
  assert.equal(pinned.projectDir, undefined);
  assert.equal(pinned.projectSource, undefined, 'the tag goes with the target keys');
  ctx.panel.destroy();
});

test('#397: reopening a pinned thread restores the selector (name resolved from /api/projects)', async () => {
  const state = { patches: [], bodies: [], snap: {
    thread: { id: TID, title: 'Scoped chat', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: { pinned: true, projectKey: 'demo-00000001', view: 'history' }, totals: {} },
    messages: [], attachments: [], runLinks: [], worktrees: [], inFlight: null,
  } };
  const store = new Map([['worca-cc.ask.thread', TID]]);
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const ctx = makePanel({ fetchHandler: handler(state), storage });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  assert.equal(btn.querySelector('.ask-scope-label').textContent, 'Demo', 'restored and resolved to the display name');
  assert.ok(btn.classList.contains('is-pinned'));
  // U5: New chat starts in No project
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  await ctx.tick();
  assert.equal(btn.textContent.trim(), 'No project');
  assert.ok(!btn.classList.contains('is-pinned'));
  ctx.panel.destroy();
});

test('P4: no amber scope warning — a stored block still flagged scopeMismatch renders like any proposal', async () => {
  const card = { target: 'project', projectKey: 'other-00000003', projectName: 'Other', projectDir: '/p/other', workspaceId: null, workspaceName: null, members: null, workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'do it', title: 'Do it', sourceBranch: null, featureBranch: 'x/do-it-00000001', sourceBranchByKey: null };
  const state = { patches: [], bodies: [], snap: {
    thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: { pinned: true, projectKey: 'demo-00000001' }, totals: {} },
    messages: [
      { id: 'askm_00000002', threadId: TID, seq: 1, role: 'assistant', text: 'a', status: 'done', blocks: [{ kind: 'card', id: 'card_00000001', state: 'proposed', card, scopeMismatch: true }], createdAt: 't' },
      { id: 'askm_00000003', threadId: TID, seq: 2, role: 'assistant', text: 'b', status: 'done', blocks: [{ kind: 'card', id: 'card_00000002', state: 'proposed', card }], createdAt: 't' },
    ],
    attachments: [], runLinks: [], worktrees: [], inFlight: null,
  } };
  const store = new Map([['worca-cc.ask.thread', TID]]);
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const ctx = makePanel({ fetchHandler: handler(state), storage });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelectorAll('.ask-card-scope-warn').length, 0, 'no warning card, flagged or not (U16)');
  assert.equal(ctx.doc.querySelectorAll('.ask-rp').length, 2, 'both proposals still render');
  ctx.panel.destroy();
});

test('P4 scope pill and menu (canvas ScopeMenu): every level, the dashed circle, No project · Projects · Workspaces · Add project…, radios', async () => {
  const opened = [];
  const ctx = makePanel({ fetchHandler: handler({ patches: [], bodies: [], snap: null }), deps: { chatDeps: { openAddProject: () => opened.push('add') } } });
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  assert.equal(btn.dataset.minLevel, undefined, 'the pill shows at every interface level');
  assert.equal(ctx.doc.querySelector('[data-ask-mcp-btn]').dataset.minLevel, 'advanced', 'Sets · N stays Advanced');
  assert.deepEqual(['aria-haspopup', 'aria-expanded', 'aria-label', 'title'].map((a) => btn.getAttribute(a)), ['menu', 'false', 'Chat scope: No project', 'Chat scope: No project']);
  assert.equal(label(btn), 'No project');
  assert.ok(btn.querySelector(':scope > svg circle[stroke-dasharray="3 3"]'), 'No project: the dashed circle');
  btn.click();
  await ticks(ctx);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const pop = ctx.doc.querySelector('.ask-pop-scope');
  assert.equal(pop.getAttribute('aria-label'), 'Chat scope');
  assert.deepEqual([...pop.querySelectorAll('.ask-pop-caption')].map((c) => [c.textContent, c.getAttribute('role')]), [['Chat scope', 'presentation'], ['Projects', 'presentation'], ['Workspaces', 'presentation']]);
  assert.equal(pop.querySelectorAll('.ask-pop-divider[role="separator"]').length, 3);
  const rows = scopeItems(ctx.doc);
  assert.deepEqual(rows.map((r) => r.querySelector('.ask-model-name').textContent), ['No project', 'Demo', 'Notes', 'Gone (missing)', 'Team', 'Add project…']);
  assert.deepEqual(rows.map((r) => r.getAttribute('role')), ['menuitemradio', 'menuitemradio', 'menuitemradio', 'menuitemradio', 'menuitemradio', 'menuitem']);
  assert.deepEqual(rows.map((r) => r.getAttribute('aria-checked')), ['true', 'false', 'false', 'false', 'false', null]);
  assert.deepEqual(rows.map((r) => r.querySelector('.kind-chip')?.textContent ?? null), [null, 'Git', 'Folder', null, null, null], 'no vcs on the row: no chip (P1b projectKind); a workspace row: no constant Workspace chip');
  const shape = (r) => [...r.children].map((c) => c.tagName.toLowerCase() + (c.className ? `.${c.className}` : ''));
  assert.deepEqual(rows.slice(0, 5).map((r) => shape(r).at(-1)), Array(5).fill('span.ask-scope-check'), 'every radio row ends in the same check slot, picked or not');
  assert.deepEqual(rows.slice(0, 5).map((r) => r.querySelector(':scope > .ask-scope-check').getAttribute('aria-hidden')), Array(5).fill('true'));
  assert.deepEqual(rows.slice(0, 5).map((r) => r.querySelectorAll('.ask-model-check').length), [1, 0, 0, 0, 0], 'the ✓ only in the picked row\'s slot');
  assert.equal(rows[5].querySelector('.ask-scope-check'), null, 'Add project… is no radio: no slot');
  assert.deepEqual(rows.map((r) => r.querySelector('.ask-scope-sub')?.textContent ?? null), [null, '~/demo', 'C:\\Users\\me\\Notes', '/p/gone', null, null], 'displayPath (S22), else path');
  assert.equal(rows[1].title, '/Users/me/demo', 'the title holds the absolute path');
  assert.equal(rows[0].querySelector('.ask-model-check').getAttribute('aria-hidden'), 'true', 'aria-checked carries the pick');
  assert.ok(rows[1].querySelector(':scope > svg path[d^="M22 19a2"]'), 'a project row: the folder');
  assert.equal(rows[4].querySelectorAll(':scope > svg rect').length, 3, 'a workspace row: the grid');
  assert.equal(rows[5].querySelectorAll(':scope > svg path').length, 2, 'Add project…: the folder with a plus');
  assert.equal(ctx.doc.activeElement, rows[0]);
  key(ctx.window, rows[0], 'ArrowDown');
  assert.equal(ctx.doc.activeElement, rows[1], 'a menuitemradio is a stop for the arrow keys');
  rows[5].click();
  await ctx.tick();
  assert.deepEqual(opened, ['add'], 'Add project… opens the Add project dialog (chatDeps.openAddProject)');
  assert.equal(ctx.doc.querySelector('.ask-pop-scope'), null, 'the menu closed first');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  btn.click(); await ticks(ctx);
  rowNamed(ctx.doc, 'Notes').click(); await ctx.tick();
  assert.equal(label(btn), 'Notes');
  assert.equal(btn.getAttribute('aria-label'), 'Chat scope: Notes');
  assert.ok(btn.querySelector(':scope > svg path[d^="M22 19a2"]'), 'a project: the folder');
  ctx.panel.destroy();
});

test('P4 first open (canvas FirstOpen): no projects and no workspaces → No project and Add project… only; no opener → No project alone', async () => {
  const empty = (url) => (url === '/api/projects' ? { projects: [] } : url === '/api/workspaces' ? { workspaces: [] } : null);
  const fetchHandler = (url, opts) => { const e = empty(url); return e ? { ok: true, status: 200, json: async () => e } : handler({ patches: [], bodies: [], snap: null })(url, opts); };
  for (const [deps, want, dividers] of [[{ chatDeps: { openAddProject: () => {} } }, ['No project', 'Add project…'], 1], [{}, ['No project'], 0]]) {
    const ctx = makePanel({ fetchHandler, deps });
    ctx.panel.open();
    ctx.doc.querySelector('[data-ask-scope-btn]').click();
    await ticks(ctx);
    assert.deepEqual(scopeItems(ctx.doc).map((r) => r.querySelector('.ask-model-name').textContent), want);
    assert.deepEqual([...ctx.doc.querySelectorAll('.ask-pop-scope .ask-pop-caption')].map((c) => c.textContent), ['Chat scope']);
    assert.equal(ctx.doc.querySelectorAll('.ask-pop-scope .ask-pop-divider').length, dividers);
    ctx.panel.destroy();
  }
});

test('P4 ask-scope: the open chat\'s pill follows a server-side switch with no PATCH, so the next send keeps the pin; another chat\'s frame changes nothing', async () => {
  const state = { patches: [], bodies: [], snap: snapOf() };
  const ctx = makePanel({ fetchHandler: handler(state), storage: storeWith(TID) });
  ctx.panel.open();
  await ticks(ctx, 4);
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  assert.equal(label(btn), 'No project');
  ctx.panel.pushServerFrame({ type: 'ask-scope', threadId: 'ask_00000099', scope: { pinned: true, projectKey: 'demo-00000001' }, label: 'Demo' });
  assert.equal(label(btn), 'No project', 'another chat\'s switch');
  ctx.panel.pushServerFrame({ type: 'ask-scope', threadId: TID, scope: { pinned: true, projectKey: 'demo-00000001' }, label: 'Demo' });
  assert.equal(label(btn), 'Demo');
  assert.ok(btn.classList.contains('is-pinned'));
  assert.equal(btn.getAttribute('aria-label'), 'Chat scope: Demo');
  await ctx.tick();
  assert.deepEqual(state.patches, [], 'the server stored it already');
  await send(ctx, 'go on');
  assert.equal(state.bodies.at(-1).context.pinned, true, 'the next send cannot overwrite the switch');
  assert.equal(state.bodies.at(-1).context.projectKey, 'demo-00000001');
  ctx.panel.pushServerFrame({ type: 'ask-scope', threadId: TID, scope: { pinned: true, workspaceId: 'wks-team-0000abcd' } });
  await ticks(ctx);
  assert.equal(label(btn), 'Team', 'a frame with no label: the name resolves from /api/workspaces');
  ctx.panel.destroy();
});

test('P4 panel.setScope: a pin or No project, PATCHed on an existing chat, no focus move; a pin without its key is refused', async () => {
  const state = { patches: [], bodies: [], snap: snapOf() };
  const ctx = makePanel({ fetchHandler: handler(state), storage: storeWith(TID) });
  ctx.panel.open();
  await ticks(ctx, 4);
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  btn.focus();
  assert.equal(ctx.panel.setScope({ pinned: true, workspaceId: 'wks-team-0000abcd', label: 'Team' }), true);
  await ctx.tick();
  assert.equal(label(btn), 'Team');
  assert.deepEqual(state.patches, [{ scope: { pinned: true, workspaceId: 'wks-team-0000abcd' } }]);
  assert.equal(ctx.doc.activeElement, btn, 'the API never steals the focus');
  for (const bad of [{ pinned: true }, { pinned: 'yes', projectKey: 'demo-00000001' }, null, 'demo']) assert.equal(ctx.panel.setScope(bad), false, JSON.stringify(bad));
  await ctx.tick();
  assert.equal(state.patches.length, 1);
  assert.equal(ctx.panel.setScope({ pinned: false }), true);
  await ctx.tick();
  assert.equal(label(btn), 'No project');
  assert.deepEqual(state.patches.at(-1), { scope: { pinned: false } });
  ctx.panel.destroy();
  assert.equal(ctx.panel.setScope({ pinned: false }), false, 'a destroyed panel');
});

test('P4 card ctx: a registered card can set the scope and give the composer the focus back', async () => {
  let seen = null;
  registerChatCard('p4-probe', (block, c) => { seen = c; return { el: c.doc.createElement('div') }; });
  try {
    const card = { kind: 'card', id: 'card_0000000a', state: 'proposed', card: { type: 'p4-probe' } };
    const state = { patches: [], bodies: [], snap: snapOf({ messages: [{ id: 'askm_00000002', threadId: TID, seq: 1, role: 'assistant', text: '', status: 'done', blocks: [card], createdAt: 't' }] }) };
    const ctx = makePanel({ fetchHandler: handler(state), storage: storeWith(TID) });
    ctx.panel.open();
    await ticks(ctx, 4);
    assert.ok(seen, 'the probe card was built');
    assert.equal(seen.setScope({ pinned: true, projectKey: 'demo-00000001', label: 'Demo' }), true);
    assert.equal(label(ctx.doc.querySelector('[data-ask-scope-btn]')), 'Demo');
    ctx.doc.body.focus();
    seen.focusComposer();
    assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('textarea.ask-input'));
    ctx.panel.destroy();
  } finally { _resetChatExtensions(); }
});

test('P4 (SEAMS S39): a scope PATCH refused mid-reply (409 TURN_IN_FLIGHT) keeps the pick — a resync does not undo it, the next send carries it', async () => {
  const state = { patches: [], bodies: [], snap: snapOf(), patchBusy: true };
  const ctx = makePanel({ fetchHandler: handler(state), storage: storeWith(TID) });
  ctx.panel.open();
  await ticks(ctx, 4);
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  btn.click(); await ticks(ctx);
  rowNamed(ctx.doc, 'Demo').click();
  await ticks(ctx);
  assert.equal(state.patches.length, 1, 'the PATCH was sent (and refused)');
  assert.equal(label(btn), 'Demo');
  ctx.panel.onHello([]);
  await ticks(ctx, 4);
  assert.equal(label(btn), 'Demo', 'the resync keeps the held pick (the stored row still says No project)');
  await send(ctx, 'next');
  assert.deepEqual([state.bodies.at(-1).context.pinned, state.bodies.at(-1).context.projectKey], [true, 'demo-00000001']);
  ctx.panel.onHello([]);
  await ticks(ctx, 4);
  assert.equal(label(btn), 'No project', 'once a send carried it the hold ends: the stored row speaks again (this fake row never changes)');
  ctx.panel.destroy();
});

test('P4 panel.optionsChanged: the cached lists go, so the next scope menu refetches /api/projects', async () => {
  const ctx = makePanel({ fetchHandler: handler({ patches: [], bodies: [], snap: null }) });
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  const fetched = () => ctx.fetchCalls.filter((c) => c.url === '/api/projects').length;
  btn.click(); await ticks(ctx); btn.click();
  const once = fetched();
  btn.click(); await ticks(ctx); btn.click();
  assert.equal(fetched(), once, 'a reopen reads the cache');
  ctx.panel.optionsChanged();
  btn.click(); await ticks(ctx);
  assert.equal(fetched(), once + 1);
  ctx.panel.destroy();
});

test('P4 (SEAMS S41): a stored context without `pinned` restores the scope its key names, as the server reads it; the next send keeps it', async () => {
  const state = { patches: [], bodies: [], snap: snapOf({ context: { projectKey: 'demo-00000001', view: 'new' } }) };
  const ctx = makePanel({ fetchHandler: handler(state), storage: storeWith(TID) });
  ctx.panel.open();
  await ticks(ctx, 4);
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  assert.equal(label(btn), 'Demo', 'a row stored before P4 names its project (P4a chatScopeOf)');
  assert.ok(btn.classList.contains('is-pinned'));
  await send(ctx, 'go on');
  assert.deepEqual([state.bodies.at(-1).context.pinned, state.bodies.at(-1).context.projectKey], [true, 'demo-00000001'], 'the next send does not drop the chat to No project');
  ctx.panel.destroy();
});

test('P4 (SEAMS S39): a hold ends with an accepted PATCH, a server switch or leaving the chat — a later resync shows the stored scope again', async () => {
  const TID2 = 'ask_00000002';
  const held = async (extra = () => null) => {
    const state = { patches: [], bodies: [], snap: snapOf(), patchBusy: true };
    const base = handler(state);
    const ctx = makePanel({ fetchHandler: (url, opts) => extra(url, opts) || base(url, opts), storage: storeWith(TID) });
    ctx.panel.open();
    await ticks(ctx, 4);
    const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
    btn.click(); await ticks(ctx);
    rowNamed(ctx.doc, 'Demo').click(); await ticks(ctx);
    assert.equal(label(btn), 'Demo', 'held (409)');
    return { state, ctx, btn };
  };
  const resync = async ({ state, ctx, btn }) => {
    state.snap = snapOf({ context: { pinned: true, workspaceId: 'wks-team-0000abcd' } });   // switched elsewhere, its frame missed
    ctx.panel.onHello([]);
    await ticks(ctx, 4);
    const got = label(btn);
    ctx.panel.destroy();
    return got;
  };
  const a = await held();
  a.state.patchBusy = false;
  a.btn.click(); await ticks(a.ctx);
  rowNamed(a.ctx.doc, 'Notes').click(); await ticks(a.ctx);
  assert.equal(await resync(a), 'Team', 'an accepted PATCH ends the hold');
  const b = await held();
  b.ctx.panel.pushServerFrame({ type: 'ask-scope', threadId: TID, scope: { pinned: true, projectKey: 'notes-00000003' }, label: 'Notes' });
  await ticks(b.ctx);
  assert.equal(await resync(b), 'Team', 'a server switch (ask-scope) ends the hold');
  const c = await held((url) => (url === `/api/ask/threads/${TID2}` ? { ok: true, status: 200, json: async () => ({ ...snapOf(), thread: { ...snapOf().thread, id: TID2 } }) } : null));
  c.ctx.panel.open({ threadId: TID2 }); await ticks(c.ctx, 4);
  c.ctx.panel.open({ threadId: TID }); await ticks(c.ctx, 4);
  assert.equal(await resync(c), 'Team', 'leaving the chat ends the hold');
});

test('P4 divider (canvas Switched): a system divider block is a centered rule with the scope icon and kind chip; blocks keep their order', async () => {
  const sys = (id, seq, blocks) => ({ id, threadId: TID, seq, role: 'system', text: blocks[0].text, status: null, blocks, createdAt: 't' });
  const state = { patches: [], bodies: [], snap: snapOf({ context: { pinned: true, workspaceId: 'wks-team-0000abcd' }, messages: [
    { id: 'askm_00000002', threadId: TID, seq: 1, role: 'user', text: 'make the photo bigger', status: null, blocks: null, createdAt: 't' },
    sys('askm_00000003', 2, [{ kind: 'divider', text: 'Switched to Notes', scope: { pinned: true, projectKey: 'notes-00000003' } }]),
    sys('askm_00000004', 3, [{ kind: 'divider', text: 'Switched to Team', scope: { pinned: true, workspaceId: 'wks-team-0000abcd' } }, { kind: 'notice', text: 'Context restored from history' }]),
    { id: 'askm_00000005', threadId: TID, seq: 4, role: 'user', text: '[worca event] scope switched', status: null, blocks: [{ kind: 'notice', synthetic: true, quiet: true, text: 'Switched to Team' }], createdAt: 't' },
    { id: 'askm_00000006', threadId: TID, seq: 5, role: 'user', text: '[worca event] workflow saved', status: null, blocks: [{ kind: 'notice', synthetic: true, text: 'Workflow "X" saved' }], createdAt: 't' },
  ] }) };
  const ctx = makePanel({ fetchHandler: handler(state), storage: storeWith(TID) });
  ctx.panel.open();
  await ticks(ctx, 6);
  const divs = [...ctx.doc.querySelectorAll('.ask-msg-system .ask-divider')];
  assert.deepEqual(divs.map((d) => [d.getAttribute('role'), d.getAttribute('aria-label'), d.querySelector('.ask-divider-t').textContent]), [
    ['separator', 'Switched to Notes', 'Switched to Notes'], ['separator', 'Switched to Team', 'Switched to Team']]);
  assert.deepEqual(divs.map((d) => d.querySelector('.kind-chip')?.className ?? null), ['kind-chip kind-folder', 'kind-chip kind-ws'], 'Folder from /api/projects vcs:none; Workspace');
  assert.ok(divs[0].querySelector('.ask-divider-in > svg path[d^="M22 19a2"]'));
  assert.equal(divs[1].querySelectorAll('.ask-divider-in > svg rect').length, 3);
  assert.deepEqual([...divs[1].parentElement.children].map((c) => c.className), ['ask-divider', 'ask-notice'], 'the divider, then the notice: block order');
  assert.equal(ctx.doc.querySelectorAll('.ask-msg-system .ask-notice').length, 1, 'a divider is never also a notice line');
  const quiet = [...ctx.doc.querySelectorAll('.ask-msg-user[hidden]')];
  assert.deepEqual(quiet.map((r) => r.children.length), [0], 'S39: the quiet event row renders nothing');
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-msg-user:not([hidden])')].map((r) => r.textContent), ['make the photo bigger', 'Workflow "X" saved'], 'a loud synthetic notice still shows');
  ctx.panel.destroy();
});

test('run 1: a scope label that would be cut under 56px hides; the icon stays and the tooltip names the scope', async () => {
  const ctx = makePanel({ fetchHandler: handler({ patches: [], bodies: [], snap: null }), resizeObserver: true });
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  const label = btn.querySelector('.ask-scope-label');
  assert.equal(btn.title, 'Chat scope: No project');
  const ro = ctx.resizeObservers.find((o) => o.targets.includes(btn.closest('.ask-composer-row')));
  assert.ok(ro, 'the composer row is observed');
  Object.defineProperty(label, 'scrollWidth', { configurable: true, get: () => 70 });
  Object.defineProperty(label, 'clientWidth', { configurable: true, get: () => 22 });
  ro.cb([]);
  assert.ok(btn.classList.contains('is-compact'), 'a 22px slice of a 70px label: icon only');
  Object.defineProperty(label, 'clientWidth', { configurable: true, get: () => 70 });
  ro.cb([]);
  assert.ok(!btn.classList.contains('is-compact'), 'the whole label fits again');
  ctx.panel.destroy();
  assert.equal(ro.disconnected, true, 'destroy() disconnects it');
});
