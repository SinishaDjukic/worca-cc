// Design P5 Task 5: a design chat turn hands its tool results to the parent (onDesignAction), never acts from a
// sub-agent or an Ask turn, and runs with no Task, no sign-in probe, no title and no suggestion (surfaceLocked).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage, getMessage, listMessages, updateCardBlock } from '../src/core/ask/store.mjs';

useTempHome(after);

const RESULT = (over = {}) => ({
  type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.05,
  usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: {}, duration_ms: 40, num_turns: 1, session_id: 'sess-1', permission_denials: [], ...over,
});
const push = (onEvent, raw) => onEvent({ type: raw.type, raw });

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
    model: 'claude-opus-5-5', effort: 'high',
    resumeSessionId: null, firstTurn: false, firstText: 'hello there', deterministicTitle: null,
    mock: null, attachmentNames: {},
    ...over,
    deps: {
      onFrame: (f) => frames.push(f),
      onOutOfTurn: (f) => outOfTurn.push(f),
      generateTitle: async () => '',
      failedBecauseSignedOut: async () => false,   // never ask the real CLI
      claudeAuthState: async () => 'unknown',      // nor for the sign-in it hands the MCP child
      ...deps,
    },
  });
  return { turn, frames, outOfTurn };
}

const call = (on, id, name, input) => push(on, { type: 'assistant', parent_tool_use_id: null, session_id: 's', message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const res = (on, id, text, { isError = false, parent = null } = {}) => push(on, { type: 'user', parent_tool_use_id: parent, session_id: 's', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
const START = JSON.stringify({ ok: true, requested: { kind: 'design-start', brief: 'x' }, note: 'n' });
const run = (s, script, deps = {}, over = {}) => makeTurn(s, { design: true, ...over }, { runClaudeImpl: async (o) => { script(o); push(o.onEvent, RESULT()); return { text: '', exitCode: 0 }; }, ...deps });

test('a design turn spawns once, with no Task, no sign-in probe, no title and no suggestion', async () => {
  let spawns = 0; let opts = null; let titled = 0; let suggested = 0; let authed = 0;
  const { turn } = makeTurn(seed(), { design: true, suggest: true, firstTurn: false }, {
    runClaudeImpl: async (o) => { spawns += 1; opts = o; push(o.onEvent, RESULT()); return { text: '', exitCode: 0 }; },
    generateTitle: async () => { titled += 1; return ''; },
    generateSuggestion: async () => { suggested += 1; return ''; },
    suggestionModel: () => 'claude-haiku-4-5', suggestionsEnabled: () => true,
    claudeAuthState: async () => { authed += 1; return 'unknown'; },
    budgetStatus: () => ({ blocked: false }),   // as ask-turn.test.mjs:2179: never the real settings
  });
  await turn.run();
  await turn.suggestionPromise;
  assert.deepEqual([spawns, titled, suggested, authed], [1, 0, 0, 0]);
  assert.equal(opts.tools.includes('Task'), false);
});
test('start_design_build result: the parent acts, its card lands on the reply, posted(true) runs after the store write', async () => {
  const s = seed(); const seen = []; let storedAtPost = null;
  const { turn } = run(s, (o) => { call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', { brief: 'x' }); res(o.onEvent, 'tu1', START); }, {
    designAction: async (req, ctx) => { seen.push([req, ctx.threadId]); return { ok: true, block: { id: 'card_00000001', state: 'running', card: { type: 'design-round', buildId: 'b_1', summary: 's' } },
      posted: (added) => { storedAtPost = [added, getMessage(s.asst.id).blocks.some((b) => b.id === 'card_00000001')]; } }; },
  });
  await turn.run();
  assert.deepEqual(seen, [[{ kind: 'design-start', brief: 'x' }, s.thread.id]]);
  assert.deepEqual(storedAtPost, [true, true]);
  assert.equal(getMessage(s.asst.id).blocks.find((b) => b.id === 'card_00000001').state, 'running');
});
test('a refusal becomes a notice row; an isError result or a child refusal never calls the parent', async () => {
  const s = seed(); let calls = 0;
  const { turn } = run(s, (o) => {
    call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START);
    call(o.onEvent, 'tu2', 'mcp__worca__change_design', {}); res(o.onEvent, 'tu2', 'error: no', { isError: true });
    call(o.onEvent, 'tu3', 'mcp__worca__change_design', {}); res(o.onEvent, 'tu3', '{"ok":false,"error":"no"}');
  }, { designAction: async () => { calls += 1; return { ok: false, notice: 'A build is already open: wait for it, or press Resume or Stop.' }; } });
  await turn.run();
  assert.equal(calls, 1);
  assert.ok(getMessage(s.asst.id).blocks.some((b) => b.kind === 'notice' && b.text === 'A build is already open: wait for it, or press Resume or Stop.'));
});
test('design_questions result: an asking card, no parent action', async () => {
  const s = seed(); let calls = 0;
  const out = JSON.stringify({ ok: true, heading: 'Your turn', questions: [{ id: 'tone', text: 'T', options: [] }], note: 'n' });
  const { turn } = run(s, (o) => { call(o.onEvent, 'tu1', 'mcp__worca__design_questions', {}); res(o.onEvent, 'tu1', out); }, { designAction: async () => { calls += 1; } });
  await turn.run();
  const card = getMessage(s.asst.id).blocks.find((b) => b.kind === 'card');
  assert.deepEqual([card.state, card.card.type, card.card.heading, card.card.summary, calls], ['asking', 'design-questions', 'Your turn', 'Your turn', 0]);
});
test('a sub-agent result and an Ask turn never act', async () => {
  let calls = 0; const deps = { designAction: async () => { calls += 1; return { ok: false, notice: 'x' }; } };
  await run(seed(), (o) => { call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START, { parent: 'toolu_parent' }); }, deps).turn.run();
  await run(seed(), (o) => { call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START); }, deps, { design: false }).turn.run();
  assert.equal(calls, 0);
});
test('store: a design card takes a sub-patch', () => {
  const s = seed();
  appendMessage(s.thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_00000002', state: 'running', card: { type: 'design-round', buildId: 'b_1' } }] });
  const b = updateCardBlock(s.thread.id, 'card_00000002', { state: 'done', card: { version: 2 } });
  assert.deepEqual([b.state, b.card.version, b.card.buildId], ['done', 2, 'b_1']);
});

// Guard rows (mutation check): each one fails when one guard of the slice is removed.
const rest = (s) => getMessage(s.asst.id).blocks.filter((b) => b.kind !== 'tool');

test('a design turn: Ask\'s card hooks stand down, and only the three design tools reach the parent', async () => {
  const s = seed(); const calls = { validate: 0, track: 0, away: 0, chat: 0, scope: 0, design: 0 };
  const req = JSON.stringify({ ok: true, requested: { kind: 'global', toggle: 'g' } });
  const { turn } = run(s, (o) => {
    call(o.onEvent, 'tu1', 'mcp__worca__propose_run', { projectKey: 'x', prompt: 'p' }); res(o.onEvent, 'tu1', '{"ok":true}');
    call(o.onEvent, 'tu2', 'mcp__worca__propose_workflow', { task: 'build it' }); res(o.onEvent, 'tu2', '{"ok":true}');
    call(o.onEvent, 'tu3', 'mcp__worca__track_run', { id: 'abcd1234' }); res(o.onEvent, 'tu3', '{"ok":true}');
    call(o.onEvent, 'tu4', 'mcp__worca__set_away_now', { mode: 'away' }); res(o.onEvent, 'tu4', req);
    call(o.onEvent, 'tu5', 'mcp__worca__change_setting', {}); res(o.onEvent, 'tu5', req);
    call(o.onEvent, 'tu6', 'mcp__worca__propose_scope_switch', { candidates: ['x'] }); res(o.onEvent, 'tu6', '{"ok":true}');
    call(o.onEvent, 'tu7', 'mcp__worca__ask_question', { answer: 'text', question: 'Which tone?' }); res(o.onEvent, 'tu7', '{"ok":true}');
  }, {
    validateProposal: async () => { calls.validate += 1; return { ok: false, errors: ['no'] }; },
    trackRun: async () => { calls.track += 1; return { ok: true, card: { type: 'progress' } }; },
    awaySwitch: async () => { calls.away += 1; return { ok: true, line: 'Right now you count as away.' }; },
    chatAction: async () => { calls.chat += 1; return { ok: false, notice: 'x' }; },
    validateScopeSwitch: async () => { calls.scope += 1; return { ok: false }; },
    designAction: async () => { calls.design += 1; return { ok: false, notice: 'x' }; },
  });
  await turn.run();
  assert.deepEqual(rest(s).map((b) => [b.kind, b.text || (b.card && b.card.type) || '']), [], 'no card, no notice');
  assert.deepEqual(calls, { validate: 0, track: 0, away: 0, chat: 0, scope: 0, design: 0 });
});
test('the parent is asked only for an ok main-stream result naming a request, and a failure always leaves a notice', async () => {
  let calls = 0; const s1 = seed();
  await run(s1, (o) => {
    call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START, { isError: true });
    call(o.onEvent, 'tu2', 'mcp__worca__change_design', {}); res(o.onEvent, 'tu2', '{"ok":true,"note":"n"}');
    call(o.onEvent, 'tu3', 'mcp__worca__design_questions', {}); res(o.onEvent, 'tu3', JSON.stringify({ ok: false, heading: 'H', questions: [] }));
  }, { designAction: async () => { calls += 1; return { ok: false, notice: 'x' }; } }).turn.run();
  assert.deepEqual([calls, rest(s1)], [0, []], 'an isError result, no requested, a child refusal: nothing');
  const s2 = seed();
  await run(s2, (o) => { call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START); }).turn.run();
  assert.deepEqual(rest(s2), [], 'no designAction dep: nothing, not even a notice');
  const s3 = seed(); let n = 0;
  await run(s3, (o) => {
    call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START);
    call(o.onEvent, 'tu2', 'mcp__worca__change_design', {}); res(o.onEvent, 'tu2', START);
  }, { designAction: async () => { n += 1; if (n === 1) throw new Error('disk full'); return { ok: false }; } }).turn.run();
  assert.deepEqual(rest(s3).map((b) => [b.kind, b.text]).sort(), [['notice', 'Could not start the build.'], ['notice', 'Could not start the build: disk full']]);
});
test('a slow parent still lands its card before the turn completes; a stop before it answers gives posted(false) and no card', async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const answer = (id, onPosted) => ({ ok: true, block: { id, state: 'running', card: { type: 'design-round', buildId: 'b_1' } }, posted: onPosted });
  const script = (o) => { call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START); };
  const s1 = seed(); const posted1 = [];
  await run(s1, script, { designAction: async () => { await wait(20); return answer('card_00000003', (added) => posted1.push(added)); } }).turn.run();
  assert.deepEqual([posted1, rest(s1).map((b) => b.id)], [[true], ['card_00000003']]);
  const s2 = seed(); let postedNow; const posted2 = new Promise((r) => { postedNow = r; });
  const t = run(s2, script, { designAction: async () => { t.turn.stop(); await wait(20); return answer('card_00000004', postedNow); } });
  await t.turn.run();
  assert.equal(await posted2, false);
  assert.equal(getMessage(s2.asst.id).blocks.some((b) => b.id === 'card_00000004'), false);
});
test('M4: a limit or CLI-error exit while the parent still answers: posted sees its card stored, and it is stored once', async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const copies = (s, id) => listMessages(s.thread.id).flatMap((m) => (m.blocks || []).filter((b) => b && b.id === id));
  for (const [exit, id] of [['max_turns', 'card_00000006'], ['cli_error', 'card_00000007']]) {
    const s = seed(); let atPost = null; let addedAt = null;
    const block = { id, state: 'running', card: { type: 'design-round', buildId: 'b_1' } };
    const { turn } = makeTurn(s, { design: true }, {
      askLimits: () => ({ maxTurns: 7, maxBudgetUsd: 2 }),
      runClaudeImpl: async (o) => {
        call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START);
        if (exit === 'max_turns') push(o.onEvent, RESULT({ subtype: 'error_max_turns', is_error: true, errors: ['Reached maximum number of turns (7)'] }));
        throw new Error('claude exited with code 1: no stderr');
      },
      designAction: async () => {
        await wait(20);
        return { ok: true, block, posted: (added) => {
          // As chat-actions' posted: a card the reply did not take goes in as a row of its own, then the receipt follows.
          if (!added) appendMessage(s.thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', ...block }] });
          addedAt = added; atPost = copies(s, id).length;
        } };
      },
    });
    const out = await turn.run();
    assert.equal(out.status, exit === 'max_turns' ? 'stopped' : 'error');
    assert.equal(addedAt, false, `${exit}: the reply is past its last store write, so it does not take the card`);
    assert.equal(atPost, 1, `${exit}: the card is in the DB when posted runs`);
    assert.equal(copies(s, id).length, 1, `${exit}: stored exactly once`);
  }
});
const absorbed = async (fn) => {
  const warned = []; const warn = console.warn;
  console.warn = (...a) => { warned.push(a.join(' ')); };
  try { await fn(); } finally { console.warn = warn; }
  return warned.filter((w) => w.includes('reducer error'));
};
test('posted is optional: an answer without it lands its card and the turn absorbs no error', async () => {
  const s = seed();
  const errs = await absorbed(() => run(s, (o) => { call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START); }, {
    designAction: async () => ({ ok: true, block: { id: 'card_00000005', state: 'running', card: { type: 'design-round', buildId: 'b_1' } } }),
  }).turn.run());
  assert.deepEqual([rest(s).map((b) => b.id), errs], [['card_00000005'], []]);
});
test('an Ask turn lets a design tool result pass with no hook and absorbs no error', async () => {
  const s = seed();
  const errs = await absorbed(() => run(s, (o) => { call(o.onEvent, 'tu1', 'mcp__worca__start_design_build', {}); res(o.onEvent, 'tu1', START); }, {}, { design: false }).turn.run());
  assert.deepEqual([rest(s), errs], [[], []]);
});
test('an asking card is stored while the turn streams, and takes a sub-patch', async () => {
  const s = seed(); let midTurn = null;
  const out = JSON.stringify({ ok: true, heading: 'Your turn', questions: [{ id: 'tone', text: 'T', options: [] }], note: 'n' });
  await run(s, (o) => {
    call(o.onEvent, 'tu1', 'mcp__worca__design_questions', {}); res(o.onEvent, 'tu1', out);
    midTurn = getMessage(s.asst.id).blocks.find((b) => b.kind === 'card') || null;
  }).turn.run();
  assert.equal(midTurn && midTurn.card.type, 'design-questions');
  const b = updateCardBlock(s.thread.id, midTurn.id, { state: 'answered', card: { answers: { tone: 'calm' } } });
  assert.deepEqual([b.state, b.card.answers, b.card.heading], ['answered', { tone: 'calm' }, 'Your turn']);
});
