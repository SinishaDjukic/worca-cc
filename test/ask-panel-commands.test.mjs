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

test('shared terminal: a command Ask starts never shows the terminal on its own; the folder label shows its tab on click', async () => {
  const shows = [];
  const { ctx } = setup({ blocks: [CMD], deps: { showTerminal: (...a) => shows.push(a) } });
  const live = { blockId: 't-0000000002:1', sessionId: 't-0000000002', seq: 1, status: 'running', exitCode: null, tail: '' };
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: live });          // the sheet is closed
  ctx.panel.open();
  await settle(ctx);
  const next = { ...live, blockId: 't-0000000002:2', seq: 2 };
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: next });            // a command starting in the open chat
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { ...next, tail: 'more' } });
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { ...live, blockId: 't-0000000002:3', seq: 3, status: 'done', exitCode: 0 } });
  ctx.flush();
  assert.deepEqual(shows, [], 'no running frame opens or switches the terminal pane');
  ctx.doc.querySelector('.ask-card.ask-cmd .ask-cmd-folder').click();
  assert.deepEqual(shows, [['t-0000000001']], 'the folder click still shows (and focuses) its tab');
  ctx.panel.destroy();
});

test('opening a command\'s output while the transcript is pinned to its end keeps the toggle where it was (the pin does not follow the click)', async () => {
  const { ctx } = setup({ blocks: [CMD] });
  ctx.panel.open();
  await settle(ctx);
  const t = ctx.doc.querySelector('.ask-transcript');
  const toggle = ctx.doc.querySelector('.ask-card.ask-cmd .ask-cmd-toggle');
  const out = ctx.doc.querySelector('.ask-card.ask-cmd .ask-cmd-out');
  // 1000px in a 200px scrollport, the toggle 50px below the top at the end; the open output adds 192px below it.
  Object.defineProperty(t, 'scrollHeight', { get: () => 1000 + (out.hidden ? 0 : 192), configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 200, configurable: true });
  toggle.getBoundingClientRect = () => ({ top: 850 - t.scrollTop, bottom: 868 - t.scrollTop, left: 0, right: 120, width: 120, height: 18 });
  t.scrollTop = 800;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  toggle.click();
  ctx.flush();
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));
  assert.equal(out.hidden, false, 'opened');
  assert.equal(t.scrollTop, 800, 'the transcript did not snap to the new end');
  assert.equal(toggle.getBoundingClientRect().top, 50, 'the toggle stays under the pointer');
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, false);
  toggle.click();
  ctx.flush();
  assert.equal(out.hidden, true);
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, true, 'closed at the end: pinned again');
  ctx.panel.destroy();
});

test('a command card\'s output: folded by default, the toggle shows it, and the fold survives a frame and a rebuild of the card', async () => {
  const { ctx } = setup({ blocks: [CMD] });
  ctx.panel.open();
  await settle(ctx);
  const el = ctx.doc.querySelector('.ask-card.ask-cmd');
  const out = () => ctx.doc.querySelector('.ask-card.ask-cmd .ask-cmd-out');
  const toggle = () => ctx.doc.querySelector('.ask-card.ask-cmd .ask-cmd-toggle');
  assert.equal(out().textContent, 'PASS all');
  assert.equal(out().hidden, true, 'folded by default');
  assert.equal(toggle().hidden, false);
  toggle().click();
  assert.equal(out().hidden, false, 'the toggle shows the output');
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: BID, status: 'running', exitCode: null, tail: 'compiling…' } });
  ctx.flush();
  assert.equal(out().hidden, false, 'a live frame keeps it open');
  assert.match(out().textContent, /compiling/);
  ctx.panel.open({ threadId: null });                     // a new chat disposes every card…
  await settle(ctx);
  assert.equal(ctx.doc.querySelector('.ask-card.ask-cmd'), null);
  ctx.panel.open({ threadId: TID });                      // …and coming back builds this one again
  await settle(ctx);
  assert.notEqual(ctx.doc.querySelector('.ask-card.ask-cmd'), el, 'a rebuilt card');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  assert.equal(out().hidden, false, 'still open after the rebuild');
  toggle().click();
  ctx.panel.open({ threadId: null });
  await settle(ctx);
  ctx.panel.open({ threadId: TID });
  await settle(ctx);
  assert.equal(out().hidden, true, 'folded again after the next rebuild');
  ctx.panel.destroy();
});

test('command cards sit in the answer where they ran (textAt), not all below it; an older block without textAt stays below', async () => {
  const text = 'First I run the tests.\n\nThen the linter.\n\nAll green.';
  const CMD2 = { ...CMD, id: 'card_00000002', textAt: text.indexOf('\n\nAll'), card: { ...CMD.card, blockId: 't-0000000001:2', seq: 2, command: 'npm run lint' } };
  const LEGACY = { ...CMD, id: 'card_00000003', card: { ...CMD.card, blockId: 't-0000000001:3', seq: 3, command: 'git status' } };
  const blocks = [{ ...CMD, textAt: text.indexOf('\n\nThen') }, CMD2, LEGACY];
  const { ctx } = setup({ blocks });
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text, status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  const msg = ctx.doc.querySelector('.ask-msg-assistant');
  const order = [...msg.children].filter((c) => !c.hidden && (c.classList.contains('ask-answer') || c.classList.contains('ask-cmd')))
    .map((c) => (c.classList.contains('ask-cmd') ? `card:${c.textContent.match(/npm test|npm run lint|git status/)[0]}` : c.textContent.trim()));
  assert.deepEqual(order, ['First I run the tests.', 'card:npm test', 'Then the linter.', 'card:npm run lint', 'All green.', 'card:git status']);
  ctx.panel.destroy();
});
