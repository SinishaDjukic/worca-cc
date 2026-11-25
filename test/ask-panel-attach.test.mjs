// test/ask-panel-attach.test.mjs — the Chat composer's Requirements attach: the `#` popover, the card strip, send gating,
// the queue, the scope guard, sent feature cards and the shaped card's start body. jsdom, like the other ask-panel suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key } from './helpers/ask-panel-harness.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const FEATURE = { seq: 5, id: 'FEAT-5', title: 'Login flow', criteriaCount: 3, startable: true };
const OTHER = { seq: 6, id: 'FEAT-6', title: 'Logout flow', criteriaCount: 2, startable: true };

/** A panel pinned to project p1 with the flag on. `state.resolve` decides what attach/resolve answers. */
function rig({ messages, resolve } = {}) {
  const state = { posted: [], resolveCalls: 0, resolve: resolve || ((seqs) => seqs.map((seq) => ({ seq, status: 'ok' }))), features: [FEATURE, OTHER] };
  const handler = (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (url === '/api/ask/threads' && method === 'POST') return json(201, { thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } });
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      state.posted.push(JSON.parse(opts.body));
      return messages ? messages(state.posted.length, JSON.parse(opts.body)) : json(202, { userMessageId: 'askm_u0000001', assistantMessageId: MID });
    }
    if (url.startsWith('/api/requirements/search')) return json(200, { features: state.features });
    if (url === '/api/requirements/attach/resolve') {
      state.resolveCalls += 1;
      return json(200, { items: state.resolve(JSON.parse(opts.body).seqs) });
    }
    if (url === '/api/projects') return json(200, { projects: [{ key: 'p1', name: 'P1' }, { key: 'p2', name: 'P2' }] });
    return json(200, {});
  };
  const ctx = makePanel({ fetchHandler: handler });
  applyFlags({ requirements: true }, ctx.doc);
  ctx.panel.open();
  ctx.panel.setScope({ pinned: true, projectKey: 'p1', label: 'P1' });
  return { ctx, state, input: ctx.doc.querySelector('textarea.ask-input') };
}

const settle = async (ctx) => { for (let i = 0; i < 4; i += 1) await ctx.tick(); ctx.flush(); };
const strip = (ctx) => [...ctx.doc.querySelectorAll('[data-ask-attach-cards] .ask-chip-feature')];
const queuedChips = (ctx) => [...ctx.doc.querySelectorAll('[data-ask-queue-features] .ask-chip-feature')];
const typeText = (ctx, input, text) => {
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
};

/** Attach FEATURE the way a person does: `#`, the popover lists it, Enter attaches the highlighted row. */
async function attachViaHash(ctx, input) {
  typeText(ctx, input, '#');
  await settle(ctx);
  assert.ok(ctx.doc.querySelector('[data-ui="attach-hash-popup"]'), 'the popover opens');
  const e = key(ctx.window, input, 'Enter');
  await settle(ctx);
  return e;
}

test('Enter via onComposerKeydown does not send: with the popover open it attaches', async () => {
  const { ctx, state, input } = rig();
  const e = await attachViaHash(ctx, input);
  assert.equal(e.defaultPrevented, true);
  assert.equal(state.posted.length, 0, 'no POST to the message route');
  assert.equal(ctx.fetchCalls.filter((c) => c.url === '/api/ask/threads').length, 0, 'no thread created either');
  assert.deepEqual(strip(ctx).map((c) => c.dataset.seq), ['5']);
  assert.equal(input.value, '', 'only the #query was removed');
  assert.equal(ctx.doc.querySelector('[data-ui="attach-hash-popup"]'), null, 'the popover closed');
});

test('the attach button sits right after the scope pill and says how many are attached', async () => {
  const { ctx, input } = rig();
  const btn = ctx.doc.querySelector('.ask-composer-row .ask-scope-btn').nextElementSibling;
  assert.equal(btn.hidden, false);
  assert.equal(btn.getAttribute('aria-label'), 'Pull from Requirements');
  await attachViaHash(ctx, input);
  assert.deepEqual([btn.querySelector('.ask-bar-n').textContent, btn.getAttribute('aria-label')], ['1', '1 feature from Requirements']);
  assert.equal(btn.classList.contains('is-bare'), false, 'with a count it is no longer a bare square');
});

test('flag off: the button is hidden and # opens nothing', async () => {
  const { ctx, input } = rig();
  applyFlags({ requirements: false }, ctx.doc);
  assert.equal(ctx.doc.querySelector('.ask-composer-row .ask-scope-btn').nextElementSibling.hidden, true);
  typeText(ctx, input, '#');
  await settle(ctx);
  assert.equal(ctx.doc.querySelector('[data-ui="attach-hash-popup"]'), null);
});

test('send carries requirements:[{seq}] and the store clears only after the 202', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ctx, state, input } = rig({ messages: () => ({ ok: true, status: 202, json: async () => { await gate; return { userMessageId: 'askm_u0000001', assistantMessageId: MID }; } }) });
  await attachViaHash(ctx, input);
  typeText(ctx, input, 'build it');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.deepEqual(state.posted[0].requirements, [{ seq: 5 }]);
  assert.equal(state.posted[0].text, 'build it');
  assert.equal(strip(ctx).length, 1, 'still attached while the reply to the POST is out');
  release();
  await settle(ctx);
  assert.equal(strip(ctx).length, 0, 'cleared after the 202');
  assert.equal(input.value, '');
});

test('flag off omits requirements: the body has no such key', async () => {
  const { ctx, state, input } = rig();
  await attachViaHash(ctx, input);
  applyFlags({ requirements: false }, ctx.doc);
  typeText(ctx, input, 'hello');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.equal(state.posted.length, 1);
  assert.equal(Object.hasOwn(state.posted[0], 'requirements'), false);
  assert.match(ctx.doc.querySelector('.ask-chip-feature .ask-chip-status').textContent, /Requirements unavailable/);
});

test('send blocked, A-7 message: an archived item stops the send and keeps text and card', async () => {
  const { ctx, state, input } = rig({ resolve: (seqs) => seqs.map((seq) => ({ seq, status: 'archived' })) });
  await attachViaHash(ctx, input);
  typeText(ctx, input, 'build it');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.equal(state.posted.length, 0);
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /^Remove FEAT-5 "Login flow" \(archived\) to continue\.$/);
  assert.equal(input.value, 'build it');
  assert.equal(strip(ctx).length, 1);
});

test('a not_ready item blocks Send with the "not Ready" line and keeps text and card', async () => {
  const { ctx, state, input } = rig({ resolve: (seqs) => seqs.map((seq) => ({ seq, status: 'not_ready' })) });
  await attachViaHash(ctx, input);
  typeText(ctx, input, 'build it');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.equal(state.posted.length, 0);
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /^Remove FEAT-5 "Login flow" \(not Ready\) to continue\.$/);
  assert.equal(input.value, 'build it');
  assert.equal(strip(ctx).length, 1);
});

test('wrong_scope (a programmatic scope change) blocks Send and asks nothing', async () => {
  const { ctx, state, input } = rig({ resolve: (seqs) => seqs.map((seq) => ({ seq, status: 'wrong_scope' })) });
  await attachViaHash(ctx, input);
  ctx.panel.setScope({ pinned: true, projectKey: 'p2', label: 'P2' });
  await settle(ctx);
  assert.equal(ctx.doc.querySelector('.viewer-modal'), null, 'a programmatic scope change asks nothing');
  assert.equal(strip(ctx).length, 1);
  typeText(ctx, input, 'go');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.equal(state.posted.length, 0);
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /not in this target/);
});

test('a refusal (409) puts text and features back; the next send retries them', async () => {
  const { ctx, state, input } = rig({
    messages: (n) => (n === 1
      ? { ok: false, status: 409, json: async () => ({ code: 'REQUIREMENTS_UNAVAILABLE', error: 'Remove FEAT-5 "Login flow" (archived) to continue.' }) }
      : { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) }),
  });
  await attachViaHash(ctx, input);
  typeText(ctx, input, 'build it');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /Remove FEAT-5/);
  assert.equal(input.value, 'build it');
  assert.equal(strip(ctx).length, 1);
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.deepEqual(state.posted[1].requirements, [{ seq: 5 }]);
  assert.equal(strip(ctx).length, 0);
});

test('a queued message carries its features; the store clears with the input', async () => {
  const { ctx, state, input } = rig();
  typeText(ctx, input, 'first');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  await attachViaHash(ctx, input);
  typeText(ctx, input, 'second');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.equal(state.posted.length, 1, 'queued, not posted');
  assert.equal(strip(ctx).length, 0, 'the strip left with the input');
  ctx.panel.pushServerFrame({ type: 'ask-done', text: 'ok', blocks: [], usage: null, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: {}, threadId: TID, messageId: MID, seq: 2 });
  await settle(ctx);
  assert.equal(state.posted.length, 2);
  assert.equal(state.posted[1].text, 'second');
  assert.deepEqual(state.posted[1].requirements, [{ seq: 5 }]);
});

test('a person picking another scope while features are attached is asked first; Cancel keeps everything', async () => {
  const { ctx, input } = rig();
  await attachViaHash(ctx, input);
  ctx.doc.querySelector('[data-ask-scope-btn]').click();
  await settle(ctx);
  const p2 = [...ctx.doc.querySelectorAll('.ask-scope-item')].find((b) => /P2/.test(b.textContent));
  p2.click();
  await settle(ctx);
  const dialog = ctx.doc.querySelector('.viewer-modal');
  assert.ok(dialog, 'the question is up');
  assert.equal(strip(ctx).length, 1, 'nothing removed before the answer');
  [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
  await settle(ctx);
  assert.equal(strip(ctx).length, 1);
  assert.match(ctx.doc.querySelector('.ask-scope-label').textContent, /P1/);
});

test('"Remove features and change" clears the store and applies the scope', async () => {
  const { ctx, input } = rig();
  await attachViaHash(ctx, input);
  ctx.doc.querySelector('[data-ask-scope-btn]').click();
  await settle(ctx);
  [...ctx.doc.querySelectorAll('.ask-scope-item')].find((b) => /P2/.test(b.textContent)).click();
  await settle(ctx);
  [...ctx.doc.querySelectorAll('.viewer-modal button')].find((b) => b.textContent === 'Remove features and change').click();
  await settle(ctx);
  assert.equal(strip(ctx).length, 0);
  assert.match(ctx.doc.querySelector('.ask-scope-label').textContent, /P2/);
});

test('attaching pins the scope: page-follow no longer changes it', async () => {
  let page = { ctx: { view: 'projects' }, scope: { pinned: true, projectKey: 'p2', label: 'P2' } };
  const ctx = makePanel({
    fetchHandler: (url) => ({ ok: true, status: 200, json: async () => (url.startsWith('/api/requirements/search') ? { features: [FEATURE] } : {}) }),
    getPageContext: () => page.ctx, deps: { getPageScope: () => page.scope },
  });
  applyFlags({ requirements: true }, ctx.doc);
  ctx.panel.setHost('dock');
  ctx.panel.open();
  await settle(ctx);
  assert.match(ctx.doc.querySelector('.ask-scope-label').textContent, /P2/, 'a new side chat follows the page');
  await attachViaHash(ctx, ctx.doc.querySelector('textarea.ask-input'));
  page = { ctx: { view: 'projects' }, scope: { pinned: true, projectKey: 'p9', label: 'P9' } };
  ctx.panel.pageChanged();
  ctx.panel.contextChanged();
  await settle(ctx);
  assert.match(ctx.doc.querySelector('.ask-scope-label').textContent, /P2/, 'the page moved, the pinned scope stayed');
});

const userWithFeature = { id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'do it', blocks: [{ kind: 'feature', seq: 5, id: 'FEAT-5', title: 'Login flow', criteriaCount: 3, markdown: '# Login' }], status: null, createdAt: 't' };
const PROJECT_CARD = {
  target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj', workspaceId: null, workspaceName: null, members: null,
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'Fix it', title: 'Fix', sourceBranch: '', featureBranch: 'worca/fix', sourceBranchByKey: null,
  note: '', attachments: [],
};

/** A chat whose snapshot holds `userWithFeature` and a card from the reply that answers it. */
async function openWithFeatureCard(card, runBodies, runReply = () => ({ ok: true, status: 200, json: async () => ({ runId: 'run-1' }) })) {
  const snap = {
    thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [userWithFeature, { id: MID, threadId: TID, seq: 2, role: 'assistant', text: 'ok', blocks: [{ kind: 'card', id: 'card_00000001', state: 'proposed', card }], status: 'done', createdAt: 't' }],
    attachments: [], runLinks: [], inFlight: null,
  };
  const ctx = makePanel({
    fetchHandler: (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (url === `/api/ask/threads/${TID}` && method === 'GET') return json(snap);
      if (url === '/api/run' && method === 'POST') { runBodies.push(JSON.parse(opts.body)); return runReply(runBodies.length); }
      if (url === '/api/projects') return json({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }] });
      if (url === '/api/workflows') return json({ workflows: [{ id: 'wf_default', name: 'Default' }] });
      if (url === '/api/guardrails') return json({ guardrails: [{ id: 'normal', name: 'Normal' }] });
      // Chat runs: source branch: Current (checked out), so a branchless card starts as today.
      if (url.startsWith('/api/run-defaults')) return json({ chatSourceBranch: { mode: 'current', source: 'default', needs: [] } });
      return json({});
    },
  });
  applyFlags({ requirements: true }, ctx.doc);
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  for (let i = 0; i < 8; i += 1) await ctx.tick();
  ctx.flush();
  return ctx;
}

test('a feature block in a user message renders as a sent card that opens in place', async () => {
  const ctx = await openWithFeatureCard(PROJECT_CARD, []);
  const card = ctx.doc.querySelector('.ask-msg-user .sent-feature-card');
  assert.ok(card, 'the sent card is in the user message');
  assert.match(card.textContent, /Login flow/);
  assert.match(card.textContent, /FEAT-5/);
  card.querySelector('.sent-feature-head').click();
  await settle(ctx);
  assert.equal(card.querySelector('.sent-feature-panel').hidden, false);
  assert.match(card.querySelector('.sent-feature-body').textContent, /# Login/);
});

test('shaped card start composes requirements; a card with a source omits them', async () => {
  const runBodies = [];
  const ctx = await openWithFeatureCard(PROJECT_CARD, runBodies);
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 8; i += 1) await ctx.tick();
  assert.deepEqual(runBodies[0]?.requirements, [{ seq: 5 }]);

  const sourced = [];
  const ctx2 = await openWithFeatureCard({ ...PROJECT_CARD, source: { plugin: 'p', sourceId: 's', taskId: 't' } }, sourced);
  ctx2.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 8; i += 1) await ctx2.tick();
  assert.equal(sourced.length, 1);
  assert.equal(Object.hasOwn(sourced[0], 'requirements'), false);
});

test('a proposal card Start refused for a live run asks, then resends with confirmAttachedRunning', async () => {
  const runBodies = [];
  const busy = { ok: false, status: 409, json: async () => ({ code: 'RUN_IN_PROGRESS', runId: 'run-9', error: 'FEAT-5 "Login flow" already has a run in progress. Start another run anyway?' }) };
  const ctx = await openWithFeatureCard(PROJECT_CARD, runBodies, (n) => (n === 1 ? busy : { ok: true, status: 200, json: async () => ({ runId: 'run-2' }) }));
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 8; i += 1) await ctx.tick();
  const dialog = ctx.doc.querySelector('.viewer-modal');
  assert.ok(dialog, 'the person is asked');
  assert.match(dialog.textContent, /already has a run in progress/);
  assert.equal(runBodies.length, 1, 'nothing resent before the answer');
  [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Run again').click();
  for (let i = 0; i < 8; i += 1) await ctx.tick();
  assert.equal(runBodies.length, 2);
  assert.equal(runBodies[0].confirmAttachedRunning, undefined);
  assert.equal(runBodies[1].confirmAttachedRunning, true);
  assert.deepEqual(runBodies[1].requirements, [{ seq: 5 }]);
});

test('Cancel on the live-run question sends nothing more', async () => {
  const runBodies = [];
  const busy = { ok: false, status: 409, json: async () => ({ code: 'RUN_IN_PROGRESS', runId: 'run-9', error: 'busy' }) };
  const ctx = await openWithFeatureCard(PROJECT_CARD, runBodies, () => busy);
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 8; i += 1) await ctx.tick();
  [...ctx.doc.querySelectorAll('.viewer-modal button')].find((b) => b.textContent === 'Cancel').click();
  for (let i = 0; i < 8; i += 1) await ctx.tick();
  assert.equal(runBodies.length, 1);
  assert.match(ctx.doc.querySelector('.ask-card-err').textContent, /cancelled/i);
});

test('a new chat starts in the scope of the attached features, so they can be sent', async () => {
  const { ctx, state, input } = rig();
  typeText(ctx, input, 'first');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  await attachViaHash(ctx, input);
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  await settle(ctx);
  state.posted.length = 0;
  assert.match(ctx.doc.querySelector('.ask-scope-label').textContent, /P1/, 'the new chat is in the features\' project');
  assert.equal(strip(ctx).length, 1);
  typeText(ctx, input, 'go');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.equal(state.posted.length, 1);
  assert.deepEqual(state.posted[0].requirements, [{ seq: 5 }]);
  assert.equal(state.posted[0].context.projectKey, 'p1');
});

test('picking the features\' own scope again asks nothing', async () => {
  const { ctx, input } = rig();
  await attachViaHash(ctx, input);
  ctx.doc.querySelector('[data-ask-scope-btn]').click();
  await settle(ctx);
  [...ctx.doc.querySelectorAll('.ask-scope-item')].find((b) => /P1/.test(b.textContent)).click();
  await settle(ctx);
  assert.equal(ctx.doc.querySelector('.viewer-modal'), null, 'no question');
  assert.equal(strip(ctx).length, 1);
});

test('queued message: its features show on the queue card and a scope change is asked about', async () => {
  const { ctx, state, input } = rig();
  typeText(ctx, input, 'first');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  await attachViaHash(ctx, input);
  typeText(ctx, input, 'second');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  assert.equal(strip(ctx).length, 0, 'left the composer');
  assert.equal(queuedChips(ctx).length, 1, 'shown on the queue card');
  ctx.doc.querySelector('[data-ask-scope-btn]').click();
  await settle(ctx);
  [...ctx.doc.querySelectorAll('.ask-scope-item')].find((b) => /P2/.test(b.textContent)).click();
  await settle(ctx);
  const dialog = ctx.doc.querySelector('.viewer-modal');
  assert.ok(dialog, 'the queued features are guarded too');
  [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Remove features and change').click();
  await settle(ctx);
  assert.equal(queuedChips(ctx).length, 0, 'removed from the queued message');
  assert.equal(state.posted.length, 1);
});

test('a queued feature can be removed from its card', async () => {
  const { ctx, input } = rig();
  typeText(ctx, input, 'first');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.flush();
  await attachViaHash(ctx, input);
  typeText(ctx, input, 'second');
  key(ctx.window, input, 'Enter');
  await settle(ctx);
  ctx.doc.querySelector('[data-ask-queue-features] .ask-chip-x').click();
  await settle(ctx);
  assert.equal(queuedChips(ctx).length, 0);
});
