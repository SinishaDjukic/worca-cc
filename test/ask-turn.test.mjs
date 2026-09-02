// AskTurn over the REAL store (temp home) with an injected runClaudeImpl —
// every R-A/R-C/R-F/R-G branch, plus session capture, totals, title, timer,
// stop. Frames asserted BARE (the server stamps threadId/messageId/seq).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import {
  createThread, appendMessage, getMessage, getThread,
  updateThread, setThreadTitle, deleteThread,
} from '../src/core/ask/store.mjs';

useTempHome(after);

const RESULT = (over = {}) => ({
  type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.05,
  usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: {}, duration_ms: 40, num_turns: 1, session_id: 'sess-1', permission_denials: [], ...over,
});
const push = (onEvent, raw) => onEvent({ type: raw.type, raw });
const say = (onEvent, id, text) => {
  push(onEvent, { type: 'assistant', message: { id, content: [{ type: 'text', text }] }, parent_tool_use_id: null });
};
// B-4: the REAL runClaude pre-checks the signal and throws synchronously before
// any init. run() only reaches runClaudeImpl after two awaited fs calls
// (mkdir + the mcp-json write), so a stop() scheduled by the test can already
// have fired — a fake that only LISTENS for 'abort' would then wait forever.
// Mirror the runner's pre-check.
const waitAbort = (signal) => new Promise((r) => {
  if (signal.aborted) return r();
  signal.addEventListener('abort', r, { once: true });
});

const clearAskLedger = () => getDb().exec('DELETE FROM ask_cost_ledger');

function seed() {
  const thread = createThread();
  const user = appendMessage(thread.id, { role: 'user', text: 'hello there' });
  const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
  return { thread, user, asst };
}

function makeTurn({ thread, user, asst }, over = {}, deps = {}) {
  const frames = [];
  const outOfTurn = [];
  const turn = createAskTurn({
    threadId: thread.id, assistantMessageId: asst.id, userMessageId: user.id,
    prompt: 'PROMPT-1', systemPrompt: 'SYS', restoredPrompt: 'RESTORED-1',
    model: 'claude-opus-5', effort: 'high',
    resumeSessionId: null, firstTurn: false, firstText: 'hello there', deterministicTitle: null,
    mock: null, attachmentNames: {},
    ...over,
    deps: {
      onFrame: (f) => frames.push(f),
      onOutOfTurn: (f) => outOfTurn.push(f),
      generateTitle: async () => '',
      ...deps,
    },
  });
  return { turn, frames, outOfTurn };
}

test('happy path: frames ordered, session stored immediately, row + totals persisted before ask-done', async () => {
  const s = seed();
  let rowStatusAtDoneFrame = null;
  let sessionAtEvent = null;   // observed inside the impl, ASSERTED after run()
  // (an assert thrown inside runClaudeImpl is caught by turn.mjs's own catch and
  // reclassified as a turn failure — the real message would never surface)
  const { turn, frames } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      opts.onEvent({ type: 'session', sessionId: 'sess-1' });
      sessionAtEvent = getThread(s.thread.id).sessionId;
      say(opts.onEvent, 'msg_1', 'partial answer');
      push(opts.onEvent, RESULT());
      return { text: 'partial answer', exitCode: 0 };
    },
  });
  // wrap the default onFrame to observe persistence order at the terminal frame
  const baseOnFrame = turn.deps.onFrame;
  turn.deps.onFrame = (f) => {
    baseOnFrame(f);
    if (f.type === 'ask-done') rowStatusAtDoneFrame = getMessage(s.asst.id).status;
  };
  const out = await turn.run();
  assert.equal(out.status, 'done');
  assert.equal(sessionAtEvent, 'sess-1', 'session id stored the moment it arrives');
  assert.equal(frames[0].type, 'ask-start');
  assert.equal(frames[0].userMessageId, s.user.id);
  assert.equal(frames.at(-1).type, 'ask-done');
  assert.equal(rowStatusAtDoneFrame, 'done', 'persist-before-broadcast');
  const row = getMessage(s.asst.id);
  assert.equal(row.status, 'done');
  assert.equal(row.text, 'partial answer');
  assert.equal(row.costUsd, 0.05);
  const totals = getThread(s.thread.id).totals;
  assert.equal(totals.turns, 1);
  assert.equal(totals.costUsd, 0.05);
  const done = frames.at(-1);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.threadTotals, totals);
});

test('R-G: mcp config written (resolved home, argv twins), deleted in finally even on rejection', async () => {
  const s = seed();
  let sawPath = null;
  let cfg = null;
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      sawPath = opts.mcpConfigPath;
      assert.ok(existsSync(sawPath), 'config exists while the turn runs');
      cfg = JSON.parse(readFileSync(sawPath, 'utf8'));
      throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
    },
  });
  await turn.run();
  const base = pathResolve(process.env.WORCA_HOME);
  assert.match(sawPath, new RegExp(`mcp-${s.asst.id}\\.json$`));
  assert.equal(cfg.mcpServers.worca.env.WORCA_HOME, base);
  assert.equal(cfg.mcpServers.worca.env.WORCA_ASK_THREAD_ID, s.thread.id);
  const args = cfg.mcpServers.worca.args;
  assert.equal(args[args.indexOf('--home') + 1], base);
  assert.equal(args[args.indexOf('--thread') + 1], s.thread.id);
  assert.ok(!existsSync(sawPath), 'unlinked in finally');
});

test('R-A: valid proposal → card persisted mid-turn and ask-card precedes ask-done', async () => {
  const s = seed();
  const card = { target: 'project', projectKey: 'demo-00000001', workflowId: 'wf_default' };
  let proposalArgs = null;   // observed in the hook, asserted after run() (see the
  let midBlocks = null;      // sessionAtEvent note above — inline asserts get swallowed)
  const { turn, frames } = makeTurn(s, {}, {
    validateProposal: async (input, { cardId }) => {
      proposalArgs = { input, cardId };
      return { ok: true, card };
    },
    runClaudeImpl: async (opts) => {
      push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__propose_run', input: { brief: 'do it' } }] } });
      push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }] }, tool_use_result: '{"ok":true}' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      midBlocks = getMessage(s.asst.id).blocks;
      push(opts.onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  assert.match(proposalArgs.cardId, /^card_[0-9a-f]{8}$/);
  assert.equal(proposalArgs.input.brief, 'do it');
  assert.ok((midBlocks || []).some((b) => b.kind === 'card' && b.state === 'proposed'),
    'card persisted via setMessageBlocks WHILE the turn streams');
  const iCard = frames.findIndex((f) => f.type === 'ask-card');
  const iDone = frames.findIndex((f) => f.type === 'ask-done');
  assert.ok(iCard !== -1 && iCard < iDone, 'card broadcast before ask-done');
  assert.deepEqual(frames[iCard].block.card, card);
  const final = getMessage(s.asst.id);
  assert.ok(final.blocks.some((b) => b.kind === 'card' && b.state === 'proposed'));
});

test('invalid proposal → "Proposal rejected" notice, no card', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, {}, {
    validateProposal: async () => ({ ok: false, errors: ['unknown projectKey "nope"'] }),
    runClaudeImpl: async (opts) => {
      push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__propose_run', input: { brief: 'x' } }] } });
      push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":false}' }] }, tool_use_result: '{"ok":false}' });
      push(opts.onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  assert.ok(!frames.some((f) => f.type === 'ask-card'));
  const notice = getMessage(s.asst.id).blocks.find((b) => b.kind === 'notice');
  assert.equal(notice.text, 'Proposal rejected: unknown projectKey "nope"');
});

test('R-A settle race: a hook still pending when the user stops does not hang the turn', async () => {
  const s = seed();
  let release;
  const gate = new Promise((r) => { release = r; });
  const { turn } = makeTurn(s, {}, {
    validateProposal: () => gate.then(() => ({ ok: false, errors: ['late'] })),
    runClaudeImpl: async (opts) => {
      push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__propose_run', input: {} }] } });
      push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x' }] }, tool_use_result: 'x' });
      await waitAbort(opts.signal);
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;
    },
  });
  const done = turn.run();
  setImmediate(() => turn.stop());
  // A missing settle()/abort race is a HANG, not a failure — npm test sets no
  // --test-timeout, so bound it here and fail loudly instead.
  const wedged = new Promise((_res, rej) => {
    const t = setTimeout(() => rej(new Error('turn.run() never settled: settle() must be raced against the abort')), 2000);
    t.unref?.();
  });
  const out = await Promise.race([done, wedged]);   // settle() raced against the abort — resolves
  assert.equal(out.status, 'stopped');
  release();                                  // late hook lands after finish(): swallowed
  await new Promise((r) => setImmediate(r));
  assert.ok(!getMessage(s.asst.id).blocks?.some((b) => b.kind === 'notice' && b.text === 'Proposal rejected: late'));
});

test('R-C user stop: ask-done stopped/user, costUsd null without a result, partial text kept', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      say(opts.onEvent, 'msg_1', 'half an ans');
      await waitAbort(opts.signal);
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;
    },
  });
  const p = turn.run();
  setImmediate(() => { turn.stop(); turn.stop(); });   // idempotent
  const out = await p;
  assert.equal(out.status, 'stopped');
  const done = frames.at(-1);
  assert.equal(done.type, 'ask-done');
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'user');
  assert.equal(done.costUsd, null);
  const row = getMessage(s.asst.id);
  assert.equal(row.status, 'stopped');
  assert.equal(row.reason, 'user');
  assert.equal(row.text, 'half an ans');
  assert.equal(row.costUsd, null);
  assert.equal(getThread(s.thread.id).totals.turns, 1, 'a null-cost turn still counts');
});

test('R-C timeout: the timer sets timedOut BEFORE aborting → ask-error "timed out after 30 min"', async () => {
  const s = seed();
  let fireTimer = null;
  const { turn, frames } = makeTurn(s, {}, {
    // The reducer shares this injected timer for its ≤50 ms delta batching —
    // fire those inline and capture ONLY the 30-minute wall clock.
    setTimeout: (fn, ms) => { if (ms === 1800000) { fireTimer = fn; return 1; } fn(); return 2; },
    clearTimeout: () => {},
    runClaudeImpl: async (opts) => {
      await waitAbort(opts.signal);
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;
    },
  });
  const p = turn.run();
  // run() installs the wall clock only after two awaited fs calls — poll for it.
  await new Promise((res) => { (function tick() { if (fireTimer) return res(); setImmediate(tick); })(); });
  fireTimer();
  await p;
  const last = frames.at(-1);
  assert.equal(last.type, 'ask-error');
  assert.equal(last.message, 'timed out after 30 min');
  assert.equal(getMessage(s.asst.id).status, 'error');
  assert.equal(turn.timedOut, true);
});

test('R-C limits: exit-1 rejection classified from resultSubtype; notice uses the fresh limit', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, {}, {
    askLimits: () => ({ maxTurns: 7, maxBudgetUsd: 2 }),
    runClaudeImpl: async (opts) => {
      push(opts.onEvent, RESULT({ subtype: 'error_max_turns', is_error: true, errors: ['Reached maximum number of turns (7)'] }));
      throw new Error('claude exited with code 1: no stderr');   // F5 shape — never parsed
    },
  });
  await turn.run();
  const done = frames.at(-1);
  assert.equal(done.type, 'ask-done');
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'max_turns');
  const notice = getMessage(s.asst.id).blocks.find((b) => b.kind === 'notice');
  assert.equal(notice.text, 'Stopped: reached the 7-turn limit (Settings → Ask Worca)');
});

test('R-C resume fallback: retry once without --resume, restored prompt, notice, new session stored', async () => {
  const s = seed();
  const calls = [];
  const { turn, frames } = makeTurn(s, { resumeSessionId: 'dead-sid', mock: { card: { a: 1 } } }, {
    runClaudeImpl: async (opts) => {
      calls.push({ resume: opts.resumeSessionId, prompt: opts.prompt, sys: opts.systemPrompt });
      if (calls.length === 1) {
        push(opts.onEvent, RESULT({ subtype: 'error_during_execution', is_error: true, total_cost_usd: 0, errors: ['No conversation found with session ID: dead-sid'] }));
        throw new Error('claude exited with code 1: No conversation found with session ID: dead-sid');
      }
      opts.onEvent({ type: 'session', sessionId: 'fresh-sid' });
      say(opts.onEvent, 'msg_2', 'restored answer');
      push(opts.onEvent, RESULT({ session_id: 'fresh-sid' }));
      return { text: 'restored answer', exitCode: 0 };
    },
  });
  const out = await turn.run();
  assert.equal(out.status, 'done');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].resume, 'dead-sid');
  assert.equal(calls[0].prompt, 'PROMPT-1');
  assert.equal(calls[1].resume, undefined, 'retry drops --resume');
  assert.equal(calls[1].prompt, 'RESTORED-1', 'retry uses the prebuilt restored prompt');
  assert.match(calls[0].sys, /MOCK_ROLE: ask/, 'R-F: markers on attempt 1');
  assert.match(calls[1].sys, /MOCK_ROLE: ask/, 'R-F: markers on the retry too');
  assert.equal(getThread(s.thread.id).sessionId, 'fresh-sid');
  const blocks = getMessage(s.asst.id).blocks;
  assert.ok(blocks.some((b) => b.kind === 'notice' && b.text === 'Context restored from history'));
  assert.equal(frames.at(-1).type, 'ask-done');
});

test('retry also fails: session cleared, ask-error with the runner message + errorClass', async () => {
  const s = seed();
  updateThread(s.thread.id, { sessionId: 'dead-sid' });   // observable clear
  let n = 0;
  const { turn, frames } = makeTurn(s, { resumeSessionId: 'dead-sid' }, {
    runClaudeImpl: async (opts) => {
      n += 1;
      if (n === 1) throw new Error('claude exited with code 1: no stderr'); // no init at all → predicate hits
      throw Object.assign(new Error('claude exited with code 1: auth'), { errorClass: 'auth' });
    },
  });
  await turn.run();
  assert.equal(n, 2);
  assert.equal(getThread(s.thread.id).sessionId, null);
  const last = frames.at(-1);
  assert.equal(last.type, 'ask-error');
  assert.equal(last.message, 'claude exited with code 1: auth');
  assert.equal(last.errorClass, 'auth');
});

test('B-4 guard: an abort rejection NEVER enters the resume fallback', async () => {
  const s = seed();
  let n = 0;
  const { turn } = makeTurn(s, { resumeSessionId: 'live-sid' }, {
    runClaudeImpl: async () => {
      n += 1;
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;                                   // pre-aborted shape: no init seen either
    },
  });
  turn.stop();
  const out = await turn.run();
  assert.equal(out.status, 'stopped');
  assert.equal(n, 1, 'no retry on abort even though !sawInit && resumeSessionId');
});

test('healthy-session failure does NOT retry (narrow predicate)', async () => {
  const s = seed();
  updateThread(s.thread.id, { sessionId: 'live-sid' });   // observable non-clear
  let n = 0;
  const { turn } = makeTurn(s, { resumeSessionId: 'live-sid' }, {
    runClaudeImpl: async (opts) => {
      n += 1;
      opts.onEvent({ type: 'system', raw: { type: 'system', subtype: 'init', session_id: 'live-sid' } });
      throw new Error('claude exited with code 1: network blip');
    },
  });
  await turn.run();
  assert.equal(n, 1, 'sawInit && no no-conversation error → plain failure, session kept');
  assert.equal(getThread(s.thread.id).sessionId, 'live-sid');
});

test('title: fires on the first turn with the R-D + dontAsk option set; rename guard wins', async () => {
  const s = seed();
  const titleCalls = [];
  const { turn, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hello there', deterministicTitle: 'hello there' }, {
    generateTitle: async (text, opts) => { titleCalls.push({ text, opts }); return 'Fable Title'; },
    runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
  });
  setThreadTitle(s.thread.id, 'hello there');   // stamp the deterministic title like the route does
  await turn.run();
  await turn.titlePromise;
  assert.equal(titleCalls.length, 1);
  assert.equal(titleCalls[0].text, 'hello there');
  const o = titleCalls[0].opts;
  assert.deepEqual(o.tools, []);
  assert.equal(o.strictMcpConfig, true);
  assert.deepEqual(o.settingSources, ['project']);
  assert.equal(o.disableSlashCommands, true);
  assert.equal(o.envScrub, true);
  assert.deepEqual(o.envAllowlist, []);
  assert.equal(o.permissionMode, 'dontAsk');
  assert.equal(o.signal, undefined, 'no signal — fires after ANY terminal, incl. a stop that aborted the controller');
  assert.equal(getThread(s.thread.id).title, 'Fable Title');
  assert.deepEqual(outOfTurn, [{ type: 'ask-title', title: 'Fable Title' }]);
});

test('title suppressed when the user renamed mid-generation; not fired on later turns', async () => {
  const s = seed();
  let release;
  const gate = new Promise((r) => { release = r; });
  const { turn, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hi', deterministicTitle: 'hi' }, {
    generateTitle: () => gate.then(() => 'Late Title'),
    runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
  });
  setThreadTitle(s.thread.id, 'hi');
  await turn.run();
  setThreadTitle(s.thread.id, 'User Named It');       // PATCH landed while haiku ran
  release();
  await turn.titlePromise;
  assert.equal(getThread(s.thread.id).title, 'User Named It');
  assert.equal(outOfTurn.length, 0, 'suppressed frame');

  const s2 = seed();
  const calls = [];
  const { turn: t2 } = makeTurn(s2, { firstTurn: false }, {
    generateTitle: async () => { calls.push(1); return 'X'; },
    runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
  });
  await t2.run();
  await t2.titlePromise;
  assert.equal(calls.length, 0, 'no title call on non-first turns');
});

test("contract: run() never rejects — the terminal 'error' emit with NO listener resolves", async () => {
  const s = seed();
  // EventEmitter special-cases 'error': emitting it with zero listeners throws
  // ERR_UNHANDLED_ERROR. The backstop path (a deps failure) is the shortest way
  // to the ask-error terminal, and NO 'error' listener is attached here.
  const { turn, frames } = makeTurn(s, {}, {
    fs: {
      mkdir: async () => { throw new Error('disk full'); },
      writeFile: async () => {},
      unlink: async () => {},
    },
  });
  const out = await turn.run();
  assert.equal(out.status, 'error');
  const last = frames.at(-1);
  assert.equal(last.type, 'ask-error');
  assert.equal(last.message, 'disk full');
  assert.equal(getMessage(s.asst.id).status, 'error');
});

test("contract: 'done' and 'error' events fire once for an attached listener", async () => {
  const s = seed();
  const events = [];
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
  });
  turn.on('done', (e) => events.push(['done', e]));
  turn.on('error', (e) => events.push(['error', e]));
  await turn.run();
  assert.deepEqual(events, [['done', { status: 'done', reason: null }]]);

  const s2 = seed();
  const events2 = [];
  const { turn: t2 } = makeTurn(s2, {}, {
    runClaudeImpl: async () => { throw new Error('claude exited with code 1: boom'); },
  });
  t2.on('done', (e) => events2.push(['done', e]));
  t2.on('error', (e) => events2.push(['error', e]));
  await t2.run();
  assert.deepEqual(events2, [['error', { message: 'claude exited with code 1: boom' }]]);
});

test('deleted thread mid-turn: terminal write is harmless, run() still resolves', async () => {
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      deleteThread(s.thread.id);                      // user deleted while streaming
      push(opts.onEvent, RESULT());
      return { text: 'x', exitCode: 0 };
    },
  });
  const out = await turn.run();
  assert.equal(out.status, 'done');                   // finishMessage/addThreadTotals hit no rows, swallowed
});

test('done turn appends one ask_cost_ledger row that survives thread deletion', async () => {
  clearAskLedger();
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async ({ onEvent }) => {
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT({ usage: { input_tokens: 10, output_tokens: 20,
        cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } }));
      return { text: '', exitCode: 0 };
    },
  });
  // D12 ordering: the row must be committed BEFORE the ask-done broadcast, so
  // a stats refetch triggered by the frame reads fresh data.
  const baseOnFrame = turn.deps.onFrame;
  let ledgerAtDoneFrame = null;
  turn.deps.onFrame = (f) => { baseOnFrame(f);
    if (f.type === 'ask-done') ledgerAtDoneFrame = getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n; };
  await turn.run();
  const rows = getDb().prepare('SELECT * FROM ask_cost_ledger ORDER BY id').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].thread_id, s.thread.id);
  assert.equal(rows[0].message_id, s.asst.id);
  assert.equal(rows[0].amount_usd, 0.05);
  assert.equal(rows[0].tokens, 37, '10 + 20 + 3 + 4 — cache fields count (D11)');
  assert.equal(rows[0].model, 'claude-opus-5');
  assert.equal(typeof rows[0].ts, 'number');
  assert.equal(ledgerAtDoneFrame, 1, 'row committed before the ask-done broadcast (D12 reads fresh data)');
  deleteThread(s.thread.id);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 1,
    'FK-free: the row survives the thread delete (D1)');
});

test('a turn that ends before a result leaves no ledger row', async () => {
  clearAskLedger();
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async ({ signal, onEvent }) => {
      say(onEvent, 'm1', 'partial');
      await waitAbort(signal);
      const err = new Error('aborted'); err.name = 'AbortError'; throw err;
    },
  });
  const p = turn.run();
  setImmediate(() => { turn.stop(); });
  await p;
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 0,
    'costUsd null (no result frame) writes nothing (D2)');
});

test('thread deleted mid-turn: the ledger row is still written', async () => {
  clearAskLedger();
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async ({ onEvent }) => {
      deleteThread(s.thread.id);               // user deletes the chat while the turn runs
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  const rows = getDb().prepare('SELECT thread_id, amount_usd FROM ask_cost_ledger').all();
  assert.equal(rows.length, 1, 'spend is a financial fact even without the thread (D10)');
  assert.equal(rows[0].thread_id, s.thread.id);
  assert.equal(rows[0].amount_usd, 0.05);
});

test('recordAskCost dep: injected, called once with the D10/D11 payload', async () => {
  clearAskLedger();
  const calls = []; const s = seed();
  const { turn } = makeTurn(s, {}, {
    recordAskCost: (a) => calls.push(a),
    runClaudeImpl: async ({ onEvent }) => {
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT({ usage: { input_tokens: 10, output_tokens: 20,
        cache_read_input_tokens: 5, cache_creation_input_tokens: 7 } }));
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].threadId, s.thread.id);
  assert.equal(calls[0].messageId, s.asst.id);
  assert.equal(calls[0].amountUsd, 0.05);
  assert.equal(calls[0].tokens, 42, 'input+output+cacheRead+cacheCreation (D11)');
  assert.equal(calls[0].model, 'claude-opus-5');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 0,
    'the injected dep fully replaces the real writer');
});

test('error turn that saw a result still records the spend (money was spent)', async () => {
  clearAskLedger();
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    runClaudeImpl: async ({ onEvent }) => {
      say(onEvent, 'm1', 'partial');
      push(onEvent, RESULT());                 // cost landed…
      throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
    },
  });
  const out = await turn.run();
  assert.equal(out.status, 'error');
  const rows = getDb().prepare('SELECT amount_usd FROM ask_cost_ledger').all();
  assert.equal(rows.length, 1, 'an error turn with a result frame is still spend (D2/D3)');
  assert.equal(rows[0].amount_usd, 0.05);
});

test('a throwing store.addThreadTotals does not swallow the ledger append (D10 placement)', async () => {
  clearAskLedger();
  const s = seed();
  const { turn } = makeTurn(s, {}, {
    store: { addThreadTotals: () => { throw new Error('db hiccup'); } },
    runClaudeImpl: async ({ onEvent }) => {
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 1,
    'the ledger call sits OUTSIDE the store try/catches');
});

// ── #397: the user-pinned scope on proposals ─────────────────────────────────

const proposeRun = (input) => async (opts) => {
  push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__propose_run', input }] } });
  push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }] }, tool_use_result: '{"ok":true}' });
  push(opts.onEvent, RESULT());
  return { text: '', exitCode: 0 };
};

test('#397: a target-less proposal is validated with the pinned scope; a matching card carries no flag', async () => {
  const s = seed();
  let seen = null;
  const { turn } = makeTurn(s, { pinnedScope: { projectKey: 'demo-00000001' } }, {
    validateProposal: async (input) => { seen = input; return { ok: true, card: { target: 'project', projectKey: input.projectKey, workspaceId: null } }; },
    runClaudeImpl: proposeRun({ brief: 'do it' }),
  });
  await turn.run();
  assert.equal(seen.projectKey, 'demo-00000001', 'the pin fills the missing target before validation');
  assert.equal(seen.brief, 'do it');
  const block = getMessage(s.asst.id).blocks.find((b) => b.kind === 'card');
  assert.equal(block.scopeMismatch, undefined, 'a card ON the pinned scope is not flagged');
});

test('#397: a proposal explicitly targeting ANOTHER project than the pin flags the card', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, { pinnedScope: { projectKey: 'demo-00000001' } }, {
    validateProposal: async (input) => ({ ok: true, card: { target: 'project', projectKey: input.projectKey, workspaceId: null } }),
    runClaudeImpl: proposeRun({ brief: 'do it', projectKey: 'other-00000003' }),
  });
  await turn.run();
  const block = getMessage(s.asst.id).blocks.find((b) => b.kind === 'card');
  assert.equal(block.scopeMismatch, true, 'the mismatch is flagged on the persisted block');
  const frame = frames.find((f) => f.type === 'ask-card');
  assert.equal(frame.block.scopeMismatch, true, 'and on the broadcast card frame');
});

test('#397: a workspace pin flags a project-targeted card too; no pin means no flag ever', async () => {
  const s = seed();
  const { turn } = makeTurn(s, { pinnedScope: { workspaceId: 'wks-team-0000abcd' } }, {
    validateProposal: async (input) => ({ ok: true, card: { target: 'project', projectKey: input.projectKey ?? null, workspaceId: input.workspaceId ?? null } }),
    runClaudeImpl: proposeRun({ brief: 'do it', projectKey: 'demo-00000001' }),
  });
  await turn.run();
  assert.equal(getMessage(s.asst.id).blocks.find((b) => b.kind === 'card').scopeMismatch, true);

  const s2 = seed();
  const { turn: t2 } = makeTurn(s2, {}, {
    validateProposal: async (input) => ({ ok: true, card: { target: 'project', projectKey: input.projectKey ?? null, workspaceId: null } }),
    runClaudeImpl: proposeRun({ brief: 'do it', projectKey: 'other-00000003' }),
  });
  await t2.run();
  assert.equal(getMessage(s2.asst.id).blocks.find((b) => b.kind === 'card').scopeMismatch, undefined,
    'an unpinned chat never flags anything');
});

const toolUse = (onEvent, msgId, toolId, name, input) => push(onEvent, { type: 'assistant', message: { id: msgId, content: [{ type: 'tool_use', id: toolId, name, input }] }, parent_tool_use_id: null });
const toolResult = (onEvent, toolId, text) => push(onEvent, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text }] }] }, parent_tool_use_id: null });
const mainUsage = (onEvent, id, usage) => {
  push(onEvent, { type: 'stream_event', event: { type: 'message_start', message: { id, role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, parent_tool_use_id: null });
  push(onEvent, { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage }, parent_tool_use_id: null });
};

test('onWorktreeMutation dep: a worktree write in the stream reaches the injected sink once; a throwing sink is contained', async () => {
  const s = seed(); const pokes = [];
  const { turn } = makeTurn(s, {}, {
    onWorktreeMutation: (e) => pokes.push(e),
    runClaudeImpl: async ({ onEvent }) => {
      toolUse(onEvent, 'm1', 'toolu_1', 'mcp__worca__open_worktree', { projectKey: 'p', ref: 'main' });
      toolResult(onEvent, 'toolu_1', JSON.stringify({ worktreeId: 'wt_00000001' }));
      toolUse(onEvent, 'm1', 'toolu_2', 'mcp__worca__git', { worktreeId: 'wt_00000001', args: ['status'] });
      toolResult(onEvent, 'toolu_2', '{}');
      say(onEvent, 'm2', 'done');
      push(onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  assert.deepEqual(pokes, [{ tool: 'open_worktree' }], 'the reducer hook is wired to the dep; read-only git filtered');

  const s2 = seed();
  const { turn: t2, frames } = makeTurn(s2, {}, {
    onWorktreeMutation: () => { throw new Error('sink down'); },
    runClaudeImpl: async ({ onEvent }) => {
      toolUse(onEvent, 'm1', 'toolu_1', 'mcp__worca__open_worktree', {});
      toolResult(onEvent, 'toolu_1', '{}');
      push(onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await t2.run();
  assert.equal(frames.at(-1).type, 'ask-done');
  assert.equal(frames.at(-1).status, 'done', 'a broken sink never breaks the turn');
});

test('liveCostRates dep: ask-usage frames carry a display estimate before the result and null after; no sink sees it', async () => {
  clearAskLedger();
  const s = seed(); const costs = [];
  const { turn, frames } = makeTurn(s, {}, {
    liveCostRates: (model) => (model === 'claude-opus-5' ? { input: 2, output: 4 } : null),
    recordAskCost: (a) => costs.push(a),
    runClaudeImpl: async ({ onEvent }) => {
      mainUsage(onEvent, 'm1', { input_tokens: 10, output_tokens: 20 });
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  const usage = frames.filter((f) => f.type === 'ask-usage');
  assert.equal(usage[0].costUsd, null);
  assert.equal(usage[0].estimatedCostUsd, (10 * 2 + 20 * 4) / 1e6, 'priced at the injected rates');
  assert.equal(usage.at(-1).costUsd, 0.05, 'the CLI figure');
  assert.equal(usage.at(-1).estimatedCostUsd, null, 'retired once authoritative');
  const done = frames.at(-1);
  assert.equal(done.type, 'ask-done');
  assert.equal(done.costUsd, 0.05);
  assert.equal('estimatedCostUsd' in done, false);
  assert.equal(getThread(s.thread.id).totals.costUsd, 0.05, 'thread totals: the authoritative figure only');
  assert.equal(costs.length, 1);
  assert.equal(costs[0].amountUsd, 0.05, 'ledger: the authoritative figure only');
});

test('liveCostRates default: a built-in id prices from the list table; an unknown id → estimatedCostUsd null', async () => {
  const s = seed();   // makeTurn's model is claude-opus-5 → PREDEFINED_LIST_PRICES row ($5 / $25)
  const { turn, frames } = makeTurn(s, {}, {
    runClaudeImpl: async ({ onEvent }) => {
      mainUsage(onEvent, 'm1', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  assert.equal(frames.filter((f) => f.type === 'ask-usage')[0].estimatedCostUsd, 30, '1M in @ $5 + 1M out @ $25');

  const s2 = seed();
  const { turn: t2, frames: f2 } = makeTurn(s2, { model: 'onprem-llama' }, {
    runClaudeImpl: async ({ onEvent }) => {
      mainUsage(onEvent, 'm1', { input_tokens: 5, output_tokens: 5 });
      say(onEvent, 'm1', 'answer');
      push(onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await t2.run();
  assert.equal(f2.filter((f) => f.type === 'ask-usage')[0].estimatedCostUsd, null, 'no rates: today\'s behaviour');
});

test('title: kicked off at the START of the first turn — ask-title lands BEFORE ask-done when haiku beats the turn', async () => {
  const s = seed();
  const order = [];
  let releaseTurn, runnerStarted;
  const turnGate = new Promise((r) => { releaseTurn = r; });
  const started = new Promise((r) => { runnerStarted = r; });
  // onFrame/onOutOfTurn are overridden on purpose (deps spread last in makeTurn):
  // one array gives the cross-stream order the rig's two arrays cannot.
  const { turn } = makeTurn(s, { firstTurn: true, firstText: 'hello there', deterministicTitle: 'hello there' }, {
    onFrame: (f) => order.push(f.type),
    onOutOfTurn: (f) => order.push(f.type),
    generateTitle: async () => 'Fast Title',
    runClaudeImpl: async (opts) => {
      runnerStarted();                 // the runner is spawned AFTER mkdir → the title was already kicked off
      await turnGate;                  // …and the turn outlives the title call
      push(opts.onEvent, RESULT());
      return { text: 'x', exitCode: 0 };
    },
  });
  setThreadTitle(s.thread.id, 'hello there');
  const running = turn.run();
  await started;
  await turn.titlePromise;             // the (fake) haiku call resolved and ask-title went out
  releaseTurn();
  await running;
  assert.ok(order.indexOf('ask-title') > order.indexOf('ask-start'), 'after the turn started');
  assert.ok(order.indexOf('ask-title') < order.indexOf('ask-done'), 'and BEFORE the turn ended');
  assert.equal(getThread(s.thread.id).title, 'Fast Title');
  assert.equal(order.filter((t) => t === 'ask-title').length, 1, 'kicked off once — the post-turn backstop is a no-op');
});

test('title: a scratch-dir failure still titles the first turn exactly once (the post-terminal backstop)', async () => {
  const s = seed(); const calls = [];
  const { turn, frames, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hello there', deterministicTitle: 'hello there' }, {
    fs: { mkdir: async () => { throw new Error('EACCES: scratch'); }, writeFile: async () => {}, unlink: async () => {} },
    generateTitle: async () => { calls.push(1); return 'Backstop Title'; },
  });
  setThreadTitle(s.thread.id, 'hello there');
  await turn.run();
  await turn.titlePromise;
  assert.equal(frames.at(-1).type, 'ask-error', 'the deps failure is an error completion');
  assert.equal(calls.length, 1);
  assert.deepEqual(outOfTurn, [{ type: 'ask-title', title: 'Backstop Title' }]);
});
