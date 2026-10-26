// test/ask-panel-commands.test.mjs — Ask agent mode in the Chat page (#574; worca Chat R5: always on): the command card
// (hydration over GET …/commands/:blockId, live ask-command frames, Stop) and the absence of any Agent switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

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
    if (url.startsWith(`/api/ask/threads/${TID}/commands/`)) {
      // Any block of the thread (#911: several command cards): `view` for its own block, else a passed one.
      const bid = decodeURIComponent(url.slice(`/api/ask/threads/${TID}/commands/`.length));
      const mine = view && (!view.blockId || view.blockId === bid) ? view : null;
      return { ok: true, status: 200, json: async () => { if (gate) await gate; return mine || { blockId: bid, status: 'done', exitCode: 0, tail: 'PASS all', command: 'npm test' }; } };
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

// Command summaries (#911): the one-line rows, their groups and their open state in the panel.

const cmdBlock = (n, textAt, summary, over = {}) => ({ ...CMD, id: `card_0000000${n}`, textAt,
  card: { ...CMD.card, blockId: `t-0000000001:${n}`, seq: n, command: `cmd ${n}`, summary }, ...over });

test('summaries on: three commands with no text between them sit in one group box "Ran 3 commands · 6.1s", folded once all passed (#911)', async () => {
  const text = 'I will sync dev first.\n\nDone.';
  const at = text.indexOf('\n\nDone');
  const blocks = [cmdBlock(1, at, 'Syncing the latest code from dev'), cmdBlock(2, at, 'Installing dependencies'), cmdBlock(3, at, 'Building the web bundle')];
  const { ctx } = setup({ blocks });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text, status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  [1400, 1100, 3600].forEach((ms, i) => ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID,
    command: { blockId: `t-0000000001:${i + 1}`, status: 'done', exitCode: 0, durationMs: ms, tail: '' } }));
  ctx.flush();
  const rows = [...ctx.doc.querySelectorAll('.ask-cmd.is-sum')];
  assert.equal(rows.length, 3);
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd-group').length, 1);
  const body = ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gbody');
  assert.deepEqual([...body.querySelectorAll(':scope > .ask-cmd.is-sum')], rows, 'the rows are the one card\'s children');
  assert.equal(ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gwords').textContent, 'Ran 3 commands · 6.1s');
  assert.equal(body.hidden, true, 'all passed: folded to the head line');
  assert.equal(rows[0].querySelector('.ask-cmd-sum').textContent, 'Syncing the latest code from dev');
  assert.ok(rows[0].querySelector('.status-dot').classList.contains('is-green'));
  ctx.panel.destroy();
});

test('summaries on: the group head total ticks with its running row, with no frame between ticks (#911)', async () => {
  const blocks = [cmdBlock(1, 0, 'Checking the git status'), cmdBlock(2, 0, 'Running the slow script')];
  const { ctx } = setup({ blocks });
  const ticks = [];
  const realSet = ctx.window.setInterval.bind(ctx.window);
  ctx.window.setInterval = (fn, ms, ...a) => { if (ms !== 1000) return realSet(fn, ms, ...a); ticks.push(fn); return 9000 + ticks.length; };
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: 't-0000000001:1', status: 'done', exitCode: 0, durationMs: 1000, tail: '' } });
  const t0 = Date.now() - 9000;
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: 't-0000000001:2', status: 'running', exitCode: null, durationMs: null, startedAt: t0, tail: '' } });
  ctx.flush();
  const head = ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gwords');
  assert.equal(head.textContent, 'Running 2 commands · 10s');
  assert.equal(ticks.length, 1, 'one ticker for the running row');
  const realNow = Date.now;
  try {
    Date.now = () => t0 + 19_000;
    ticks[0]();
    assert.equal(head.textContent, 'Running 2 commands · 20s');
  } finally { Date.now = realNow; }
  ctx.panel.destroy();
});

test('summaries on: chat text between two commands splits them into two cards', async () => {
  const text = 'Finding it.\n\nThe count comes from runsNeedingYou().\n\n';
  const blocks = [cmdBlock(1, text.indexOf('\n\nThe'), 'Finding where the badge count is set'), cmdBlock(2, text.length, 'Running the badge test alone')];
  const { ctx } = setup({ blocks });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text, status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd-group').length, 0);
  ctx.panel.destroy();
});

test('summaries switch off (dep) or flag off: today\'s full card, no grouping', async () => {
  const blocks = [cmdBlock(1, 0, 'Syncing'), cmdBlock(2, 0, 'Installing')];
  const { ctx } = setup({ blocks, deps: { summariseCommands: () => false } });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd.is-sum').length, 0);
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd .ask-cmd-kicker').length, 2);
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd-group').length, 0);
  ctx.panel.destroy();
});

test('flag off, switch on (default dep): the first render is today\'s full card, no grouping', async () => {
  const blocks = [cmdBlock(1, 0, 'Syncing'), cmdBlock(2, 0, 'Installing')];
  const { ctx } = setup({ blocks });                       // no summariseCommands dep: the default () => true
  applyFlags({ commandSummaries: false }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd.is-sum').length, 0);
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd .ask-cmd-kicker').length, 2);
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd-group').length, 0);
  ctx.panel.destroy();
});

test('summaries on: a reloaded group whose commands all passed shows folded; the person\'s open survives a rebuild (#911)', async () => {
  const blocks = [cmdBlock(1, 0, 'Checking the git status'), cmdBlock(2, 0, 'Reading the helper')];
  const { ctx } = setup({ blocks });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  await settle(ctx);
  const head = () => ctx.doc.querySelector('.ask-cmd-group .ask-cmd-ghead');
  const body = () => ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gbody');
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd-group').length, 1);
  assert.equal(body().querySelectorAll(':scope > .ask-cmd.is-sum').length, 2);
  assert.equal(head().getAttribute('aria-expanded'), 'false');
  assert.equal(body().hidden, true);
  head().click();
  applyFlags({ commandSummaries: false }, ctx.doc); ctx.panel.refreshCommandCards(); ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-cmd-group'), null, 'flag off: full cards, no group');
  applyFlags({ commandSummaries: true }, ctx.doc); ctx.panel.refreshCommandCards(); ctx.flush();
  await settle(ctx);
  assert.equal(body().hidden, false, 'the open choice survived the rebuild');
  ctx.panel.destroy();
});

test('summaries on: a running group stays open; it folds itself when the last command passes (#911)', async () => {
  const blocks = [cmdBlock(1, 0, 'Checking the git status'), cmdBlock(2, 0, 'Running the slow script')];
  const { ctx } = setup({ blocks });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: 't-0000000001:1', status: 'done', exitCode: 0, durationMs: 1000, tail: '' } });
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: 't-0000000001:2', status: 'running', exitCode: null, durationMs: null, startedAt: Date.now(), tail: '' } });
  ctx.flush();
  const body = () => ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gbody');
  assert.equal(body().hidden, false, 'open while a command runs');
  assert.match(ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gwords').textContent, /^Running 2 commands · /);
  ctx.panel.pushServerFrame({ type: 'ask-command', threadId: TID, command: { blockId: 't-0000000001:2', status: 'done', exitCode: 0, durationMs: 2000, tail: '' } });
  ctx.flush();
  assert.equal(body().hidden, true, 'everything passed: folded');
  assert.equal(ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gwords').textContent, 'Ran 2 commands · 3.0s');
  ctx.panel.destroy();
});

test('summaries on: a reloaded failed group opens itself from the REST views alone; a close survives a rebuild (#911)', async () => {
  const blocks = [cmdBlock(1, 0, 'Checking the git status'), cmdBlock(2, 0, 'Running the tests')];
  const { ctx } = setup({ blocks, view: { blockId: 't-0000000001:2', status: 'done', exitCode: 1, durationMs: 500, tail: 'FAIL' } });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  await settle(ctx);
  const body = () => ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gbody');
  const rows = () => [...ctx.doc.querySelectorAll('.ask-cmd.is-sum')];
  assert.equal(body().hidden, false, 'a failure opens the group');
  assert.equal(rows()[1].querySelector('.ask-cmd-detail').hidden, false, 'and its row');
  assert.equal(ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gfail').textContent, '1 failed');
  assert.ok(ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gwords').textContent.startsWith('Ran 2 commands · 1 failed · '));
  ctx.doc.querySelector('.ask-cmd-group .ask-cmd-ghead').click();
  assert.equal(body().hidden, true);
  applyFlags({ commandSummaries: false }, ctx.doc); ctx.panel.refreshCommandCards(); ctx.flush();
  applyFlags({ commandSummaries: true }, ctx.doc); ctx.panel.refreshCommandCards(); ctx.flush();
  await settle(ctx);
  assert.equal(body().hidden, true, 'the close survived the rebuild');
  ctx.panel.destroy();
});

test('summaries on: a lone row gets a neighbour: it joins the group without being rebuilt (#911)', async () => {
  const one = [cmdBlock(1, 0, 'Checking the git status')];
  const { ctx } = setup({ blocks: one });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks: one } });
  ctx.flush();
  await settle(ctx);
  const row = ctx.doc.querySelector('.ask-cmd.is-sum');
  assert.equal(ctx.doc.querySelector('.ask-cmd-group'), null, 'a lone command: no head');
  const two = [...one, cmdBlock(2, 0, 'Reading the helper')];
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks: two } });
  ctx.flush();
  await settle(ctx);
  const rows = [...ctx.doc.querySelectorAll('.ask-cmd.is-sum')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0], row, 'the same row element');
  assert.equal(row.parentNode, ctx.doc.querySelector('.ask-cmd-group .ask-cmd-gbody'));
  ctx.panel.destroy();
});

test('a running summary row\'s 1 s ticker is cleared when a mode change rebuilds it', async () => {
  const blocks = [cmdBlock(1, 0, 'Running the tests')];
  const { ctx } = setup({ blocks, view: { blockId: 't-0000000001:1', status: 'running', exitCode: null, durationMs: null,
    startedAt: new Date(Date.now() - 2000).toISOString(), tail: '' } });
  // Only the card ticks through the window's timers (the panel's own use bare setInterval); record 1000 ms ones.
  const realSet = ctx.window.setInterval.bind(ctx.window), realClear = ctx.window.clearInterval.bind(ctx.window);
  const ticks = []; const cleared = [];
  ctx.window.setInterval = (fn, ms, ...a) => { if (ms !== 1000) return realSet(fn, ms, ...a); ticks.push(9000 + ticks.length); return ticks.at(-1); };
  ctx.window.clearInterval = (id) => { if (ticks.includes(id)) cleared.push(id); else realClear(id); };
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  await settle(ctx);
  assert.ok(ctx.doc.querySelector('.ask-cmd.is-sum.is-live'), 'the row is running');
  assert.equal(ticks.length, 1, 'one ticker for the running row');
  applyFlags({ commandSummaries: false }, ctx.doc);
  ctx.panel.refreshCommandCards();
  ctx.flush();
  assert.deepEqual(cleared, ticks, 'the rebuilt row\'s ticker is cleared through its dispose');
  ctx.panel.destroy();
});

test('refreshCommandCards: turning the flag on rebuilds full cards as summary rows', async () => {
  const blocks = [cmdBlock(1, 0, 'Syncing')];
  const { ctx } = setup({ blocks });
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd.is-sum').length, 0);
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.refreshCommandCards();
  ctx.flush();
  assert.equal(ctx.doc.querySelectorAll('.ask-cmd.is-sum').length, 1);
  ctx.panel.destroy();
});

test('a closed failed row stays closed after a rebuild (the choice is kept per blockId)', async () => {
  const blocks = [cmdBlock(1, 0, 'Running the tests')];
  const { ctx } = setup({ blocks, view: { blockId: 't-0000000001:1', status: 'done', exitCode: 1, durationMs: 1000, tail: 'FAIL' } });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  await settle(ctx);
  const row = () => ctx.doc.querySelector('.ask-cmd.is-sum');
  assert.equal(row().querySelector('.ask-cmd-detail').hidden, false, 'a failure opens itself');
  const before = row();
  row().querySelector('.ask-cmd-row-btn').click();
  // Force a REAL rebuild: flag off (full card), then on again (a new summary row built from st.commandsRowOpen).
  applyFlags({ commandSummaries: false }, ctx.doc);
  ctx.panel.refreshCommandCards();
  ctx.flush();
  assert.equal(row(), null, 'flag off: the full card replaced the row');
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.refreshCommandCards();
  ctx.flush();
  await settle(ctx);
  assert.notEqual(row(), before, 'the row element was rebuilt, not kept from the cache');
  assert.equal(row().querySelector('.ask-cmd-detail').hidden, true, 'the closed choice survived the rebuild');
  ctx.panel.destroy();
});

test('a failed row that opened itself stays open after a rebuild, with its output and no Output toggle', async () => {
  const blocks = [cmdBlock(1, 0, 'Running the tests')];
  const { ctx } = setup({ blocks, view: { blockId: 't-0000000001:1', status: 'done', exitCode: 1, durationMs: 1000, tail: 'FAIL' } });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: '', status: 'done', createdAt: 't', blocks } });
  ctx.flush();
  await settle(ctx);
  const row = () => ctx.doc.querySelector('.ask-cmd.is-sum');
  const before = row();
  applyFlags({ commandSummaries: false }, ctx.doc); ctx.panel.refreshCommandCards(); ctx.flush();
  applyFlags({ commandSummaries: true }, ctx.doc); ctx.panel.refreshCommandCards(); ctx.flush();
  await settle(ctx);
  assert.notEqual(row(), before, 'a rebuilt row');
  assert.equal(row().querySelector('.ask-cmd-detail').hidden, false, 'the row stays open (auto-open was recorded)');
  assert.equal(row().querySelector('.ask-cmd-outbox').hidden, false, 'its output shows with it');
  assert.equal(row().querySelector('.ask-cmd-toggle'), null, 'no Output toggle');
  ctx.panel.destroy();
});

test('an ask-command-summary frame rewrites the open row in place; another thread\'s frame is ignored (#911 slice 2)', async () => {
  const { ctx } = setup({ blocks: [cmdBlock(1, 0, null)] });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  const el = ctx.doc.querySelector('.ask-card.ask-cmd');
  const sum = el.querySelector('.ask-cmd-sum');
  assert.ok(sum.classList.contains('is-raw'));
  ctx.panel.pushServerFrame({ type: 'ask-command-summary', threadId: 'ask_other', blockId: BID, summary: 'Nope' });
  ctx.flush();
  assert.equal(sum.textContent, 'cmd 1', 'another thread\'s frame changes nothing');
  ctx.panel.pushServerFrame({ type: 'ask-command-summary', threadId: TID, blockId: BID, summary: 'Running the tests' });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-card.ask-cmd'), el, 'same element');
  assert.equal(sum.textContent, 'Running the tests');
  assert.ok(!sum.classList.contains('is-raw'));
  ctx.panel.destroy();
});

test('the stored block carries the generated summary: a rebuild (mode off, then on) still shows it (#911 slice 2)', async () => {
  const { ctx } = setup({ blocks: [cmdBlock(1, 0, null)] });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  // flipCard's own frame (ask-message after the turn) upserts the merged block, then the repaint frame follows.
  const patched = cmdBlock(1, 0, 'Running the tests');
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: 'ok', status: 'done', createdAt: 't', blocks: [patched] } });
  ctx.panel.pushServerFrame({ type: 'ask-command-summary', threadId: TID, blockId: BID, summary: 'Running the tests' });
  ctx.flush();
  applyFlags({ commandSummaries: false }, ctx.doc); ctx.panel.refreshCommandCards(); ctx.flush();
  applyFlags({ commandSummaries: true }, ctx.doc); ctx.panel.refreshCommandCards(); ctx.flush();
  const sum = ctx.doc.querySelector('.ask-cmd-sum');
  assert.equal(sum.textContent, 'Running the tests');
  assert.ok(!sum.classList.contains('is-raw'));
  ctx.panel.destroy();
});

// The no-model proof (0 calls, 0 writes, 0 frames) is in test/ask-command-summary.test.mjs; this pins the panel side.
test('with no ask-command-summary frame (what no ready model sends), the row keeps the raw command (#911 slice 2)', async () => {
  const { ctx } = setup({ blocks: [cmdBlock(1, 0, null)] });
  applyFlags({ commandSummaries: true }, ctx.doc);
  ctx.panel.open();
  await settle(ctx);
  const s = ctx.doc.querySelector('.ask-cmd-sum');
  assert.ok(s.classList.contains('is-raw'));
  assert.equal(s.textContent, 'cmd 1');
  ctx.panel.destroy();
});
