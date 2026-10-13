// test/ask-panel-commands.test.mjs — Ask agent mode in the Chat page (#574; worca Chat R5: always on): the command card
// (hydration over GET …/commands/:blockId, live ask-command frames, Stop) and the absence of any Agent switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001', MID = 'askm_00000001', BID = 't-0000000001:1';
const CMD = { kind: 'card', id: 'card_00000001', state: 'command',
  card: { type: 'command', blockId: BID, sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'demo · main', cwd: '/w/demo', warning: null } };
const thread = (over = {}) => ({ id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, ...over });
const snapOf = (blocks, over = {}) => ({ thread: thread(over),
  messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, createdAt: 't' },
    { id: MID, threadId: TID, seq: 2, role: 'assistant', text: 'ok', blocks, status: 'done', createdAt: 't' }],
  attachments: [], runLinks: [], worktrees: [], inFlight: null });

function setup({ blocks = [], enabled = true, threadOver = {}, stored = true, view = null, gate = null, deps = {} } = {}) {
  const state = { patches: [], bodies: [], stops: [] };
  const ctx = makePanel({ fetchHandler: (url, opts) => {
    const method = ((opts || {}).method || 'GET').toUpperCase();
    if (url === '/api/ask/commands/status') return { ok: true, status: 200, json: async () => ({ enabled }) };
    if (url === `/api/ask/threads/${TID}/commands/${encodeURIComponent(BID)}`) {
      return { ok: true, status: 200, json: async () => { if (gate) await gate; return view || { blockId: BID, status: 'done', exitCode: 0, tail: 'PASS all', command: 'npm test' }; } };
    }
    if (url.startsWith('/api/terminal/sessions/') && method === 'POST') { state.stops.push(url); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    if (url === '/api/ask/threads' && method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: thread() }) };
    if (url === `/api/ask/threads/${TID}` && method === 'PATCH') { state.patches.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ thread: { id: TID } }) }; }
    if (url === `/api/ask/threads/${TID}` && method === 'GET') return { ok: true, status: 200, json: async () => snapOf(blocks, threadOver) };
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') { state.bodies.push(JSON.parse(opts.body)); return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', assistantMessageId: 'askm_00000009' }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  }, deps });
  if (stored) ctx.storage.setItem('worca-cc.ask.thread', TID);
  return { state, ctx };
}
const settle = async (ctx) => { for (let i = 0; i < 8; i++) await ctx.tick(); ctx.flush(); };

test('a command card: hydrates once, live frames update it in place, other threads are ignored, Stop posts the session stop', async () => {
  const { state, ctx } = setup({ blocks: [CMD] });
  ctx.panel.open();
  await settle(ctx);
  const cards = ctx.doc.querySelectorAll('.ask-card.ask-cmd');
  assert.equal(cards.length, 1);
  const el = cards[0];
  assert.equal(ctx.fetchCalls.filter((c) => c.url === `/api/ask/threads/${TID}/commands/${encodeURIComponent(BID)}`).length, 1);
  assert.equal(el.querySelector('.ask-cmd-pill').textContent, 'exit 0');
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, status: 'running', exitCode: null, tail: 'compiling…' } });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-card.ask-cmd'), el, 'same element');
  assert.match(el.querySelector('.ask-cmd-out').textContent, /compiling/);
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: 'ask_99999999', command: { blockId: BID, status: 'running', tail: 'OTHER' } });
  assert.doesNotMatch(el.querySelector('.ask-cmd-out').textContent, /OTHER/);
  el.querySelector('.ask-cmd-stop').click();
  await settle(ctx);
  assert.deepEqual(state.stops, ['/api/terminal/sessions/t-0000000001/stop']);
  ctx.panel.destroy();
});

test('a frame that arrives before its card is applied when the card is built', async () => {
  const { ctx } = setup({ blocks: [] });
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, status: 'running', exitCode: null, tail: 'early line' } });
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: 'ok', status: 'done', createdAt: 't', blocks: [CMD] } });
  ctx.flush();
  const el = ctx.doc.querySelector('.ask-card.ask-cmd');
  assert.ok(el);
  assert.match(el.querySelector('.ask-cmd-out').textContent, /early line|PASS all/);
  ctx.panel.destroy();
});

test('a stale "running" reload reply never overwrites the final frame (no live Stop on a finished card)', async () => {
  let open; const gate = new Promise((r) => { open = r; });
  const { ctx } = setup({ blocks: [CMD], gate, view: { blockId: BID, status: 'running', exitCode: null, tail: 'compiling…', command: 'npm test' } });
  ctx.panel.open();
  await settle(ctx);
  const el = ctx.doc.querySelector('.ask-card.ask-cmd');
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, status: 'done', exitCode: 0, tail: 'PASS all' } });
  ctx.flush();
  open();
  await settle(ctx);
  assert.equal(el.querySelector('.ask-cmd-pill').textContent, 'exit 0');
  const stop = el.querySelector('.ask-cmd-stop');
  assert.ok(!stop || stop.hidden || stop.disabled, 'no live Stop on a finished command');
  ctx.panel.destroy();
});

test('always agent: no Agent switch, no message carries agentMode, nothing PATCHes it, /api/ask/commands/status is never fetched', async () => {
  const { state, ctx } = setup({ stored: false });
  ctx.panel.open();
  await settle(ctx);
  assert.equal(ctx.doc.querySelector('[data-ask-agent-btn], .ask-agent-btn'), null);
  ctx.doc.querySelector('textarea.ask-input').value = 'hello';
  ctx.doc.querySelector('[data-ask-send]').click();
  await settle(ctx);
  assert.ok(!('agentMode' in state.bodies.at(-1)));
  assert.ok(!state.patches.some((p) => 'agentMode' in p));
  assert.ok(!ctx.fetchCalls.some((c) => c.url === '/api/ask/commands/status'));
  ctx.panel.destroy();
});

test('shared terminal: a new command in the open chat shows its tab (auto, once per block); the folder label shows it on click', async () => {
  const shows = [];
  const { ctx } = setup({ blocks: [CMD], deps: { showTerminal: (sid, o) => shows.push([sid, o]) } });
  const live = { blockId: 't-0000000002:1', sessionId: 't-0000000002', seq: 1, status: 'running', exitCode: null, tail: '' };
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: live });          // the sheet is closed: nothing
  assert.deepEqual(shows, []);
  ctx.panel.open();
  await settle(ctx);
  const next = { ...live, blockId: 't-0000000002:2', seq: 2 };
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: next });
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { ...next, tail: 'more' } });   // the same block: once
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { ...live, blockId: 't-0000000002:3', seq: 3, status: 'done', exitCode: 0 } });
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: 'ask_99999999', command: { ...live, blockId: 't-0000000009:1', sessionId: 't-0000000009' } });
  assert.deepEqual(shows, [['t-0000000002', { auto: true }]]);
  ctx.doc.querySelector('.ask-card.ask-cmd .ask-cmd-folder').click();
  assert.deepEqual(shows.at(-1), ['t-0000000001', { auto: false }]);
  ctx.panel.destroy();
});
