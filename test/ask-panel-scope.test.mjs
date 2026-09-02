// test/ask-panel-scope.test.mjs — the #397 project selector: header button,
// popover, per-field context merge on send, PATCH persistence, restore on
// thread load, and the scopeMismatch card warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';

const OPTIONS = {
  '/api/projects': { projects: [
    { key: 'demo-00000001', name: 'Demo', path: '/p/demo', exists: true },
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

test('#397: pick a project → label, per-field merged send context, PATCH once a thread exists', async () => {
  const state = { patches: [], bodies: [], snap: null };
  const ctx = makePanel({
    fetchHandler: handler(state),
    getPageContext: () => ({ view: 'history-detail', projectDir: '/p/other', pipelineId: '4e1f2a9b', diffPath: 'src/a.js' }),
  });
  ctx.panel.open();
  const btn = ctx.doc.querySelector('[data-ask-scope-btn]');
  assert.ok(btn, 'the header carries the scope button');
  assert.equal(btn.textContent.trim(), 'Auto');

  btn.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const items = scopeItems(ctx.doc);
  assert.ok(items.some((i) => /Auto \(follow current page\)/.test(i.textContent)));
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
  scopeItems(ctx.doc).find((i) => /Auto/.test(i.textContent)).click();
  await ctx.tick();
  assert.deepEqual(state.patches, [{ scope: { pinned: false } }]);
  assert.equal(btn.textContent.trim(), 'Auto');
  ctx.doc.querySelector('textarea.ask-input').value = 'again';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const auto = state.bodies[1].context;
  assert.equal(auto.pinned, false);
  assert.equal(auto.projectDir, '/p/other', 'Auto follows the page again');

  // pinning WITH a thread PATCHes the project scope
  btn.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  scopeItems(ctx.doc).find((i) => /Team/.test(i.textContent)).click();
  await ctx.tick();
  assert.deepEqual(state.patches[1], { scope: { pinned: true, workspaceId: 'wks-team-0000abcd' } });
  assert.equal(btn.textContent.trim(), 'Team');
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
  // New chat resets to Auto
  ctx.doc.querySelector('[data-ask-new-btn]').click();
  await ctx.tick();
  assert.equal(btn.textContent.trim(), 'Auto');
  assert.ok(!btn.classList.contains('is-pinned'));
  ctx.panel.destroy();
});

test('#397: a scopeMismatch card renders the warning; a clean card does not', async () => {
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
  const warns = [...ctx.doc.querySelectorAll('.ask-card-scope-warn')];
  assert.equal(warns.length, 1, 'exactly the flagged card warns');
  assert.match(warns[0].textContent, /different project or workspace/);
  ctx.panel.destroy();
});

test('#397 follow-up: header order is logo → scope → title → spacer → icon buttons', () => {
  const ctx = makePanel({ fetchHandler: handler({ patches: [], bodies: [], snap: null }) });
  ctx.panel.open();
  const kids = [...ctx.doc.querySelector('.ask-header').children];
  assert.equal(kids[0].className, 'ask-header-logo');
  assert.ok(kids[1].hasAttribute('data-ask-scope-btn'), 'the scope pill sits right after the logo');
  assert.equal(kids[2].className, 'ask-title');
  assert.equal(kids[3].className, 'ask-header-spacer');
  assert.ok(kids[4].hasAttribute('data-ask-threads-btn'), 'then the icon buttons');
});
