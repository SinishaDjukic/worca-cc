// test/ask-panel-overview-api.test.mjs — what the chat panel gives the tool panel's Overview (issue 1064): the meter
// routing (openContext: the Overview on the Chat page, the popover in the side column and for a new chat), the
// aria-haspopup that follows it, contextSnapshot / threadFacts / contextActions, watch() kinds, and the running
// commands with their Stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, openChat } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_0000c0de';
const BID = 't-0000000001:1';
const CMD = { kind: 'card', id: 'card_00000001', state: 'command',
  card: { type: 'command', blockId: BID, sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'demo · main', cwd: '/w/demo', warning: null } };
const T = (over) => ({ costUsd: 0.1, input: 1, output: 1, cacheRead: 0, cacheCreation: 0, turns: 1, agents: 0, ...over });
const thread = (over = {}) => ({ id: TID, title: 'A chat', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  model: null, effort: null, sessionId: null, context: null, contexts: [{ kind: 'project', id: 'p1', label: 'P' }],
  totals: T({ ctx: 120400, ctxWindow: 1000000 }), createdBy: null, ...over });
const ok = (body, status = 200) => ({ ok: true, status, json: async () => body });

function setup({ openOverview = undefined, blocks = [], view = null } = {}) {
  const calls = [];
  const stops = [];
  const chatDeps = openOverview === undefined ? null : { openOverview: (a) => { calls.push(a); return openOverview; } };
  const ctx = makePanel({ chatDeps, fetchHandler: (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.startsWith(`/api/ask/threads/${TID}/commands/`)) return ok(view || { blockId: BID, sessionId: 't-0000000001', status: 'running', exitCode: null, tail: '', command: 'npm test', startedAt: '2026-10-01T00:00:00.000Z', runBy: 'ask:ask_0000c0de' });
    if (url.startsWith('/api/terminal/sessions/') && method === 'POST') { stops.push(url); return ok({ ok: true }); }
    if (url === `/api/ask/threads/${TID}` && method === 'GET') {
      return ok({ thread: thread(), attachments: [], runLinks: [], worktrees: { items: [] }, inFlight: null,
        messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, createdAt: 't' },
          { id: 'askm_00000001', threadId: TID, seq: 2, role: 'assistant', text: 'ok', blocks, status: 'done', createdAt: 't' }] });
    }
    return ok({});
  } });
  return { ctx, calls, stops };
}
const settle = async (ctx) => { for (let i = 0; i < 8; i++) await ctx.tick(); ctx.flush(); };
const ring = (ctx) => ctx.doc.querySelector('[data-ask-ctx-btn]');
const headMeter = (ctx) => ctx.doc.querySelector('.chat-head-meter');
const pop = (ctx) => ctx.doc.querySelector('.ask-pop-ctx');

test('openContext routes: page + dep true → no popover; false → popover; dock → popover, dep not called; new chat → popover', async () => {
  const yes = setup({ openOverview: true });
  await openChat(yes.ctx, TID);
  headMeter(yes.ctx).click();
  ring(yes.ctx).click();
  assert.deepEqual(yes.calls, [{ threadId: TID, section: 'context' }, { threadId: TID, section: 'context' }]);
  assert.equal(pop(yes.ctx), null, 'the Overview, not the popover');
  yes.ctx.panel.setHost('dock');
  ring(yes.ctx).click();
  assert.ok(pop(yes.ctx), 'the side column keeps the popover');
  assert.equal(yes.calls.length, 2, 'the dep is not asked in the dock');
  yes.ctx.panel.destroy();

  const no = setup({ openOverview: false });
  await openChat(no.ctx, TID);
  headMeter(no.ctx).click();
  assert.equal(no.calls.length, 1);
  assert.ok(pop(no.ctx), 'the panel refused: the popover');
  no.ctx.panel.destroy();

  const fresh = setup({ openOverview: true });
  fresh.ctx.panel.open();
  await settle(fresh.ctx);
  assert.equal(fresh.ctx.panel.threadId(), null, 'a new chat');
  headMeter(fresh.ctx).click();
  assert.ok(pop(fresh.ctx), 'a new chat keeps the popover');
  assert.equal(fresh.calls.length, 0);
  fresh.ctx.panel.destroy();
});

test('aria-haspopup follows the route', async () => {
  const { ctx } = setup({ openOverview: true });
  ctx.panel.open();
  await settle(ctx);
  assert.equal(ring(ctx).getAttribute('aria-haspopup'), 'menu', 'a new chat opens the popover');
  assert.equal(headMeter(ctx).getAttribute('aria-haspopup'), 'menu');
  await openChat(ctx, TID);
  assert.equal(ring(ctx).hasAttribute('aria-haspopup'), false, 'the Chat page opens the Overview');
  assert.equal(headMeter(ctx).hasAttribute('aria-haspopup'), false);
  ctx.panel.setHost('dock');
  assert.equal(ring(ctx).getAttribute('aria-haspopup'), 'menu', 'the side column opens the popover');
  ctx.panel.setHost('page');
  assert.equal(ring(ctx).hasAttribute('aria-haspopup'), false);
  ctx.panel.destroy();
});

test('contextSnapshot / threadFacts / contextActions; watch kinds fire on the matching frames', async () => {
  const { ctx } = setup({ blocks: [CMD] });
  assert.equal(ctx.panel.contextSnapshot(), null, 'nothing open: a new chat');
  const kinds = [];
  const unwatch = ctx.panel.watch((k) => kinds.push(k));
  ctx.panel.watch(() => { throw new Error('a listener that throws is swallowed'); });
  await openChat(ctx, TID);
  await settle(ctx);
  assert.ok(kinds.includes('thread'), 'the chat switched');
  const snap = ctx.panel.contextSnapshot();
  assert.equal(snap.threadId, TID);
  assert.equal(snap.ctx, 120400);
  assert.equal(snap.win, 1000000);
  assert.equal(snap.pct, 12);
  assert.equal(snap.level, 'ok');
  assert.deepEqual(snap.contexts.map((c) => c.id), ['p1']);
  assert.deepEqual(snap.agents, []);
  assert.equal(snap.showAgents, true);
  assert.equal(typeof snap.showWorktrees, 'boolean');
  const facts = ctx.panel.threadFacts();
  assert.equal(facts.threadId, TID);
  assert.ok(typeof facts.engineLabel === 'string' && facts.engineLabel.trim(), `engine label: ${JSON.stringify(facts.engineLabel)}`);
  assert.ok(typeof facts.modelLabel === 'string' && facts.modelLabel.trim(), `model label: ${JSON.stringify(facts.modelLabel)}`);
  assert.ok(Object.isFrozen(ctx.panel.contextActions));
  for (const k of ['openTopic', 'removeWorktree', 'copyPath', 'refresh']) assert.equal(typeof ctx.panel.contextActions[k], 'function', k);

  kinds.length = 0;
  ctx.panel.pushServerFrame({ type: 'ask-start', threadId: TID, messageId: 'askm_00000002', seq: 1, userMessageId: 'askm_u0000002', model: 'm', effort: 'high', startedAt: 't' });
  ctx.panel.pushServerFrame({ type: 'ask-usage', threadId: TID, messageId: 'askm_00000002', seq: 2, usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, ctx: 250000 }, costUsd: null });
  ctx.flush();
  assert.ok(kinds.includes('context'), 'meters moved');
  kinds.length = 0;
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID, runId: 'r-1', pipelineId: 'abcd1234', status: 'running' });
  ctx.flush();
  assert.ok(kinds.includes('links'), kinds.join());
  kinds.length = 0;
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, sessionId: 't-0000000001', status: 'running', exitCode: null, tail: 'x', command: 'npm test' } });
  assert.deepEqual(kinds, ['commands']);
  kinds.length = 0;
  ctx.panel.pushServerFrame({ type: 'ask-done', threadId: TID, messageId: 'askm_00000002', seq: 3, status: 'done', contexts: [] });
  assert.ok(kinds.includes('cards'), kinds.join());
  assert.ok(kinds.includes('context'), 'setContexts');
  kinds.length = 0;
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: 'askm_00000001', threadId: TID, seq: 2, role: 'assistant', text: 'ok', status: 'done', createdAt: 't', blocks: [CMD] } });
  assert.ok(kinds.includes('cards'));
  kinds.length = 0;
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: 'ask_99999999', command: { blockId: BID, status: 'done' } });
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: 'ask_99999999', message: { id: 'askm_00000009', threadId: 'ask_99999999', seq: 1, role: 'assistant', text: 'x', status: 'done', createdAt: 't', blocks: [] } });
  assert.deepEqual(kinds, [], 'another chat\'s frames are not this chat\'s');
  unwatch();
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, status: 'running' } });
  assert.deepEqual(kinds, [], 'unsubscribed');
  ctx.panel.destroy();
});

test('runningCommands lists a running card and drops it on its done frame; stopCommand posts the stop route', async () => {
  const { ctx, stops } = setup({ blocks: [CMD] });
  await openChat(ctx, TID);
  await settle(ctx);
  assert.deepEqual(ctx.panel.runningCommands(), [{ blockId: BID, sessionId: 't-0000000001', command: 'npm test', startedAt: '2026-10-01T00:00:00.000Z', runBy: 'ask:ask_0000c0de' }]);
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, status: 'done', exitCode: 0, tail: 'PASS' } });
  assert.deepEqual(ctx.panel.runningCommands(), []);
  await ctx.panel.stopCommand('t-0000000001');
  assert.deepEqual(stops, ['/api/terminal/sessions/t-0000000001/stop']);
  ctx.panel.destroy();
});

test('the watch on a new chat: newThread fires thread; destroy() drops every listener', async () => {
  const { ctx } = setup({});
  await openChat(ctx, TID);
  const kinds = [];
  ctx.panel.watch((k) => kinds.push(k));
  ctx.panel.open({ threadId: null });
  await settle(ctx);
  ctx.doc.querySelector('[data-ask-new-btn]')?.click();
  await settle(ctx);
  assert.ok(kinds.includes('thread'), kinds.join());
  ctx.panel.destroy();
  kinds.length = 0;
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, status: 'running' } });
  assert.deepEqual(kinds, []);
});

test('a done frame emits commands AFTER the card took it: a listener reading runningCommands() sees the command gone', async () => {
  const { ctx } = setup({ blocks: [CMD] });
  await openChat(ctx, TID);
  await settle(ctx);
  assert.equal(ctx.panel.runningCommands().length, 1);
  const seen = [];
  ctx.panel.watch((k) => { if (k === 'commands') seen.push(ctx.panel.runningCommands().length); });
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, sessionId: 't-0000000001', status: 'done', exitCode: 0, tail: 'PASS' } });
  assert.deepEqual(seen, [0], 'the Background redraw this emit drives reads the finished state');
  ctx.panel.destroy();
});

test('a card hydrated over REST emits commands: a quiet running command reaches the Overview with no frame', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const ctx = makePanel({ fetchHandler: async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.startsWith(`/api/ask/threads/${TID}/commands/`)) { await hold; return ok({ blockId: BID, sessionId: 't-0000000001', status: 'running', exitCode: null, tail: 'ready', command: 'npm run dev' }); }
    if (url === `/api/ask/threads/${TID}` && method === 'GET') {
      return ok({ thread: thread(), attachments: [], runLinks: [], worktrees: { items: [] }, inFlight: null,
        messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, createdAt: 't' },
          { id: 'askm_00000001', threadId: TID, seq: 2, role: 'assistant', text: 'ok', blocks: [CMD], status: 'done', createdAt: 't' }] });
    }
    return ok({});
  } });
  await openChat(ctx, TID);
  await settle(ctx);
  assert.deepEqual(ctx.panel.runningCommands(), [], 'the hydration is still out');
  const seen = [];
  ctx.panel.watch((k) => { if (k === 'commands') seen.push(ctx.panel.runningCommands().length); });
  release();
  await settle(ctx);
  assert.deepEqual(seen, [1], 'one commands emit, after the card holds the running view');
  ctx.panel.destroy();
});

test('a card built from a frame that came before its block emits commands: the running command reaches the Overview', async () => {
  const { ctx } = setup({});
  await openChat(ctx, TID);
  await settle(ctx);
  const seen = [];
  ctx.panel.watch((k) => { if (k === 'commands') seen.push(ctx.panel.runningCommands().length); });
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, sessionId: 't-0000000001', status: 'running', exitCode: null, tail: 'ready', command: 'npm run dev' } });
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: 'askm_00000002', threadId: TID, seq: 3, role: 'assistant', text: 'ok', blocks: [CMD], status: 'done', createdAt: 't' } });
  await settle(ctx);
  assert.equal(ctx.panel.runningCommands().length, 1, 'the card took the buffered frame');
  assert.equal(seen.at(-1), 1, `the last commands emit saw the running command (${seen.join()})`);
  ctx.panel.destroy();
});

test('during a chat switch (B still loading) the snapshots say nothing: no A data under B\'s id, no A command to Stop', async () => {
  const B = 'ask_0000b0de';
  let release;
  const hold = new Promise((r) => { release = r; });
  const msgs = (id, blocks) => [{ id: `askm_u${id.slice(-7)}`, threadId: id, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, createdAt: 't' },
    { id: `askm_${id.slice(-8)}`, threadId: id, seq: 2, role: 'assistant', text: 'ok', blocks, status: 'done', createdAt: 't' }];
  const ctx = makePanel({ fetchHandler: async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.startsWith(`/api/ask/threads/${TID}/commands/`)) return ok({ blockId: BID, sessionId: 't-0000000001', status: 'running', exitCode: null, tail: '', command: 'npm test' });
    if (url === `/api/ask/threads/${TID}` && method === 'GET') return ok({ thread: thread(), attachments: [], runLinks: [], worktrees: { items: [] }, inFlight: null, messages: msgs(TID, [CMD]) });
    if (url === `/api/ask/threads/${B}` && method === 'GET') {
      await hold;
      return ok({ thread: thread({ id: B, title: 'B chat', contexts: [{ kind: 'project', id: 'p2', label: 'Q' }], totals: T({ ctx: 10000, ctxWindow: 1000000 }) }),
        attachments: [], runLinks: [], worktrees: { items: [] }, inFlight: null, messages: msgs(B, []) });
    }
    return ok({});
  } });
  await openChat(ctx, TID);
  await settle(ctx);
  assert.equal(ctx.panel.runningCommands().length, 1, 'A runs a command');
  assert.equal(ctx.panel.contextSnapshot().threadId, TID);
  const kinds = [];
  ctx.panel.watch((k) => kinds.push(k));
  ctx.panel.open({ threadId: B });
  for (let i = 0; i < 4; i++) await ctx.tick();
  assert.equal(ctx.panel.threadId(), B, 'the panel already answers B');
  assert.equal(ctx.panel.contextSnapshot(), null, 'no context of A under B');
  assert.equal(ctx.panel.threadFacts(), null, 'no picker labels of A under B');
  assert.deepEqual(ctx.panel.runningCommands(), [], 'no A command a Stop could reach');
  release();
  await settle(ctx);
  assert.ok(kinds.includes('thread'), 'the switch emits thread once B is in');
  const snap = ctx.panel.contextSnapshot();
  assert.equal(snap.threadId, B);
  assert.equal(snap.ctx, 10000);
  assert.deepEqual(snap.contexts.map((c) => c.id), ['p2']);
  assert.equal(ctx.panel.threadFacts().threadId, B);
  assert.deepEqual(ctx.panel.runningCommands(), []);
  ctx.panel.destroy();
});
