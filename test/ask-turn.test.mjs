// AskTurn over the REAL store (temp home) with an injected runClaudeImpl —
// every R-A/R-C/R-F/R-G branch, plus session capture, totals, title, timer,
// stop. Frames asserted BARE (the server stamps threadId/messageId/seq).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { createAskTurn, humanErrorText } from '../src/core/ask/turn.mjs';
import { normalizingOnEvent } from '../src/core/engines/claude-events.mjs';
import {
  createThread, appendMessage, getMessage, getThread,
  updateThread, setThreadTitle, deleteThread,
} from '../src/core/ask/store.mjs';
import { proposalFor } from './helpers/auto-proposal-fixture.mjs';

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
    model: 'claude-opus-5-5', effort: 'high',
    resumeSessionId: null, firstTurn: false, firstText: 'hello there', deterministicTitle: null,
    mock: null, attachmentNames: {},
    ...over,
    deps: {
      onFrame: (f) => frames.push(f),
      onOutOfTurn: (f) => outOfTurn.push(f),
      generateTitle: async () => '',
      failedBecauseSignedOut: async () => false,   // never ask the real CLI
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

test('session: the init frame\'s session event does not store the id a second time', async () => {
  const s = seed();
  const writes = [];
  const { turn } = makeTurn(s, {}, {
    store: { updateThread: (id, patch) => { if ('sessionId' in patch) writes.push(patch.sessionId); updateThread(id, patch); } },
    runClaudeImpl: async (opts) => {
      // What the Claude adapter delivers per spawn: its own session event, then the init frame's.
      opts.onEvent({ type: 'session', sessionId: 'sess-1' });
      opts.onEvent({ type: 'session', sessionId: 'sess-1', model: 'claude-opus-5-5', init: true });
      say(opts.onEvent, 'msg_1', 'answer');
      push(opts.onEvent, RESULT());
      return { text: 'answer', exitCode: 0 };
    },
  });
  await turn.run();
  assert.deepEqual(writes, ['sess-1']);
  assert.equal(getThread(s.thread.id).sessionId, 'sess-1');
});

test('conversation chips: refs resolved and merged as chat chips on ask-done; a failing resolver is logged and the turn still ends done', async () => {
  await checkRows([
    { name: 'conversation chips: the answer\'s refs are resolved, merged as chat chips and ride ask-done', run: async () => {
      const s = seed();
      let seen = null;
      const { turn, frames } = makeTurn(s, {}, {
        runClaudeImpl: async (opts) => {
          say(opts.onEvent, 'msg_1', 'See [Fix login](#history/demo-00000001/1a2b3c4d).');
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
        resolveMentions: async (refs) => {
          seen = refs;
          return [{ kind: 'run', id: '1a2b3c4d', label: 'Fix login', home: 'demo-00000001', source: 'chat' }];
        },
      });
      await turn.run();
      assert.deepEqual(seen, [{ kind: 'run', id: '1a2b3c4d', projectKey: 'demo-00000001' }]);
      const chip = { kind: 'run', id: '1a2b3c4d', label: 'Fix login', home: 'demo-00000001', source: 'chat' };
      assert.deepEqual(getThread(s.thread.id).contexts, [chip]);
      assert.deepEqual(frames.at(-1).contexts, [chip]);
    } },
    { name: 'conversation chips: a failing resolver is logged and the turn still ends done, without contexts', run: async () => {
      const s = seed();
      const warn = console.warn;
      const warned = [];
      console.warn = (m) => warned.push(String(m));
      try {
        const { turn, frames } = makeTurn(s, {}, {
          runClaudeImpl: async (opts) => {
            say(opts.onEvent, 'msg_1', 'See #projects/demo-00000001');
            push(opts.onEvent, RESULT());
            return { text: '', exitCode: 0 };
          },
          resolveMentions: async () => { throw new Error('db gone'); },
        });
        const out = await turn.run();
        assert.equal(out.status, 'done');
        const done = frames.at(-1);
        assert.equal(done.type, 'ask-done');
        assert.equal(Object.hasOwn(done, 'contexts'), false);
        assert.ok(warned.some((m) => /mentioned contexts not recorded: db gone/.test(m)));
      } finally {
        console.warn = warn;
      }
    } },
  ]);
});

test('web access: on hands WORCA_ASK_WEB to the child (config 0600, web sub-agent note); off writes no WORCA_ASK_WEB', async () => {
  await checkRows([
    { name: 'web access: the turn hands WORCA_ASK_WEB to the child, writes the config 0600, and swaps the sub-agent note', run: async () => {
      const s = seed();
      let cfg = null; let mode = null; let note = null;
      const { turn } = makeTurn(s, { web: { enabled: true, allowedDomains: ['docs.example.com'], search: null } }, {
        runClaudeImpl: async (opts) => {
          cfg = JSON.parse(readFileSync(opts.mcpConfigPath, 'utf8'));
          mode = statSync(opts.mcpConfigPath).mode & 0o777;
          note = opts.appendSubagentSystemPrompt;
          throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
        },
      });
      await turn.run();
      assert.deepEqual(JSON.parse(cfg.mcpServers.worca.env.WORCA_ASK_WEB), { allowedDomains: ['docs.example.com'] });
      if (process.platform !== 'win32') assert.equal(mode, 0o600);
      assert.match(note, /network is reachable ONLY through the worca web tools/);
    } },
    { name: 'web access off: no WORCA_ASK_WEB reaches the child', run: async () => {
      const s = seed();
      let cfg = null;
      const { turn } = makeTurn(s, { web: { enabled: false, allowedDomains: [], search: null } }, {
        runClaudeImpl: async (opts) => {
          cfg = JSON.parse(readFileSync(opts.mcpConfigPath, 'utf8'));
          throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
        },
      });
      await turn.run();
      assert.ok(!('WORCA_ASK_WEB' in cfg.mcpServers.worca.env));
    } },
  ]);
});

test('web search key: the value never lands in the written mcp json; its var rides the process env allowlist', async () => {
  const s = seed();
  process.env.ASKTEST_SEARCH_KEY = 'sekrit-key-value-123';
  let raw = null; let allow = null;
  const { turn } = makeTurn(s, { web: { enabled: true, allowedDomains: ['docs.example.com'],
    search: { url: 'https://s.example/?q={query}', keyVar: 'ASKTEST_SEARCH_KEY', keyHeader: 'X-K', keyPrefix: '' } } }, {
    runClaudeImpl: async (opts) => {
      raw = readFileSync(opts.mcpConfigPath, 'utf8');
      allow = opts.envAllowlist;
      throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
    },
  });
  try { await turn.run(); } finally { delete process.env.ASKTEST_SEARCH_KEY; }
  assert.ok(!raw.includes('sekrit-key-value-123'));
  assert.deepEqual(allow, ['SSH_AUTH_SOCK', 'ASKTEST_SEARCH_KEY']);
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

test('R-A: a valid proposal persists a card mid-turn before ask-done; an invalid one is a "Proposal rejected" notice', async () => {
  await checkRows([
    { name: 'R-A: valid proposal → card persisted mid-turn and ask-card precedes ask-done', run: async () => {
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
    } },
    { name: 'invalid proposal → "Proposal rejected" notice, no card', run: async () => {
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
    } },
  ]);
});

test('card proposals (metrics, workspace, away, web): the parent re-validates the INPUT (pin replayed where it applies) and mints the card; a refusal is a notice; a child error is nothing', async () => {
  await checkRows([
    { name: 'propose_metrics_change: the parent re-validates the INPUT (pinned default replayed) and mints the card; a refusal is a notice; a child error is nothing', run: async () => {
      const s = seed();
      const seen = [];
      const runner = (frames) => async (opts) => {
        for (const [id, name, input, text, isError] of frames) {
          push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id, name, input }] } });
          push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
        }
        await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
        push(opts.onEvent, RESULT());
        return { text: '', exitCode: 0 };
      };
      const card = { type: 'metrics', kind: 'record', projectKey: 'demo-00000001', projectName: 'Demo', record: false, summary: 'Turn "Include my runs" off for Demo', effects: [] };
      const { turn, frames } = makeTurn(s, { pinnedScope: { projectKey: 'demo-00000001' } }, {
        validateMetricsChange: async (input) => { seen.push(input); return input.kind === 'record' ? { ok: true, card } : { ok: false, errors: ['gateway already records team metrics on its own branch'] }; },
        runClaudeImpl: runner([
          ['toolu_1', 'mcp__worca__propose_metrics_change', { kind: 'record', record: false }, '{"ok":true,"card":{}}', false],
          ['toolu_2', 'mcp__worca__propose_metrics_change', { kind: 'enable', projectKey: 'gw-00000002' }, '{"ok":true,"card":{}}', false],
          ['toolu_3', 'mcp__worca__propose_metrics_change', { kind: 'record' }, 'error: propose_metrics_change: unavailable', true],
          ['toolu_4', 'mcp__worca__propose_metrics_change', { kind: 'record' }, '{"ok":false,"errors":["x"]}', false],
        ]),
      });
      await turn.run();
      assert.deepEqual(seen, [{ kind: 'record', record: false, projectKey: 'demo-00000001' }, { kind: 'enable', projectKey: 'gw-00000002' }], 'the pin fills the target; child refusals and errors never reach the validator');
      const final = getMessage(s.asst.id);
      const cards = final.blocks.filter((b) => b.kind === 'card');
      assert.equal(cards.length, 1); assert.equal(cards[0].state, 'proposed'); assert.deepEqual(cards[0].card, card);
      assert.ok(final.blocks.some((b) => b.kind === 'notice' && b.text === 'Metrics change rejected: gateway already records team metrics on its own branch'));
      assert.ok(frames.some((f) => f.type === 'ask-card' && f.block.card.type === 'metrics'), 'the card was broadcast mid-turn');
    } },
    { name: 'propose_workspace_change: the parent re-validates the INPUT (pinned workspace replayed, never for create) and mints the card; a refusal is a notice', run: async () => {
      const s = seed();
      const seen = [];
      const runner = (frames) => async (opts) => {
        for (const [id, name, input, text, isError] of frames) {
          push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id, name, input }] } });
          push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
        }
        await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
        push(opts.onEvent, RESULT());
        return { text: '', exitCode: 0 };
      };
      const card = { type: 'workspace', kind: 'add_members', summary: 'Add docs to Shop', workspaceId: 'wks-shop-0000abcd', effects: [], warnings: [], followUps: [] };
      const { turn, frames } = makeTurn(s, { pinnedScope: { workspaceId: 'wks-shop-0000abcd' } }, {
        validateWorkspaceChange: async (input) => { seen.push(input); return input.kind === 'add_members' ? { ok: true, card } : { ok: false, errors: ['a workspace over this exact project set already exists'] }; },
        runClaudeImpl: runner([
          ['toolu_1', 'mcp__worca__propose_workspace_change', { kind: 'add_members', projectKeys: ['kc'] }, '{"ok":true,"card":{}}', false],
          ['toolu_2', 'mcp__worca__propose_workspace_change', { kind: 'create', name: 'X', projectKeys: ['ka', 'kb'] }, '{"ok":true,"card":{}}', false],
          ['toolu_3', 'mcp__worca__propose_workspace_change', { kind: 'rename' }, '{"ok":false,"errors":["x"]}', false],
        ]),
      });
      await turn.run();
      assert.deepEqual(seen, [
        { kind: 'add_members', projectKeys: ['kc'], workspaceId: 'wks-shop-0000abcd' },
        { kind: 'create', name: 'X', projectKeys: ['ka', 'kb'] },
      ], 'the pin fills the workspace of a change to it, never a create; a child refusal never reaches the validator');
      const final = getMessage(s.asst.id);
      const cards = final.blocks.filter((b) => b.kind === 'card');
      assert.equal(cards.length, 1); assert.deepEqual(cards[0].card, card);
      assert.ok(final.blocks.some((b) => b.kind === 'notice' && b.text === 'Workspace change rejected: a workspace over this exact project set already exists'));
      assert.ok(frames.some((f) => f.type === 'ask-card' && f.block.card.type === 'workspace'));
    } },
    { name: 'web card: the parent re-validates against the turn\'s access — a host inside the team cap mints a card, one outside becomes a notice', run: async () => {
      const s = seed();
      const { turn } = makeTurn(s, { web: { enabled: true, allowedDomains: ['a.team.com'], search: null, teamCap: ['*.team.com'] } }, {
        runClaudeImpl: async (opts) => {
          // the child said ok to both (it never sees the team cap); the parent decides
          toolUse(opts.onEvent, 'msg_1', 'toolu_w1', 'mcp__worca__propose_web_access', { url: 'https://docs.team.com/x', reason: 'docs' });
          toolResult(opts.onEvent, 'toolu_w1', '{"ok":true,"card":{}}');
          toolUse(opts.onEvent, 'msg_1', 'toolu_w2', 'mcp__worca__propose_web_access', { url: 'https://evil.example/' });
          toolResult(opts.onEvent, 'toolu_w2', '{"ok":true,"card":{}}');
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      const blocks = getMessage(s.asst.id).blocks;
      const cards = blocks.filter((b) => b.kind === 'card');
      assert.equal(cards.length, 1);
      assert.equal(cards[0].state, 'proposed'); assert.equal(cards[0].card.type, 'web'); assert.equal(cards[0].card.host, 'docs.team.com');
      assert.ok(blocks.some((b) => b.kind === 'notice' && /Web access request rejected: evil\.example is outside the team policy/.test(b.text)));
    } },
    { name: 'propose_away_mode_change: the parent re-validates the input and mints the card; a refusal is a notice', run: async () => {
      const s = seed();
      const seen = [];
      let mid = null;
      const { turn } = makeTurn(s, { pinnedScope: { projectKey: 'demo-00000001' } }, {
        validateAwayChange: async (inp) => { seen.push(inp); return inp.set?.enabled ? { ok: true, card: { type: 'away', summary: 'Which runs: All runs' } } : { ok: false, errors: ['nothing to change'] }; },
        runClaudeImpl: async (opts) => {
          awayCall(opts.onEvent, 1, 'mcp__worca__propose_away_mode_change', { level: 'project', set: { enabled: true } }, '{"ok":true}');
          awayCall(opts.onEvent, 2, 'mcp__worca__propose_away_mode_change', { level: 'user' }, '{"ok":true}');
          for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
          mid = getMessage(s.asst.id).blocks;
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      assert.equal(seen[0].projectKey, 'demo-00000001', 'the pinned project is replayed');
      assert.deepEqual(mid.filter((b) => b.kind === 'card').map((b) => [b.state, b.card.type]), [['proposed', 'away']]);
      assert.ok(mid.some((b) => b.kind === 'notice' && b.text === 'Away mode change rejected: nothing to change'));
    } },
  ]);
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

test('R-C terminations: user stop (stopped/user, null cost, partial text), the 30-min timer (timedOut before abort) and exit-1 limits classified from resultSubtype', async () => {
  await checkRows([
    { name: 'R-C user stop: ask-done stopped/user, costUsd null without a result, partial text kept', run: async () => {
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
    } },
    { name: 'R-C timeout: the timer sets timedOut BEFORE aborting → ask-error "timed out after 30 min"', run: async () => {
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
    } },
    { name: 'R-C limits: exit-1 rejection classified from resultSubtype; notice uses the fresh limit', run: async () => {
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
    } },
  ]);
});

test('R-C resume fallback: retry once without --resume (restored prompt, notice, new session); a failing retry clears the session and ends in ask-error with the runner message + errorClass', async () => {
  await checkRows([
    { name: 'R-C resume fallback: retry once without --resume, restored prompt, notice, new session stored', run: async () => {
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
    } },
    { name: 'retry also fails: session cleared, ask-error with the runner message + errorClass', run: async () => {
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
      assert.equal(last.code, undefined, 'a generic auth failure is not the CLI sign-in');
    } },
  ]);
});

test('a failure on a signed-out CLI ends the turn with ask-error code claude-signed-out, whatever the CLI said', async () => {
  const s = seed();
  const asked = [];
  // Signed out, the CLI can fail a first-party id as unrecognized_model, not "Not logged in".
  const message = 'claude exited with code 1: [claude-code:unrecognized_model] {"model":"claude-opus-5-5","query_source":"sdk"}';
  const { turn, frames } = makeTurn(s, {}, {
    runClaudeImpl: async () => { throw new Error(message); },
    failedBecauseSignedOut: async (o) => { asked.push(o); return true; },
  });
  await turn.run();
  const last = frames.at(-1);
  assert.equal(last.type, 'ask-error');
  assert.equal(last.message, message, 'the raw message still travels');
  assert.equal(last.code, 'claude-signed-out');
  assert.deepEqual(asked, [{ message, model: 'claude-opus-5-5' }]);
});

test('a classified error persists a human notice (errorClass + detail, on the ask-error frame too); an unclassified one persists none', async () => {
  await checkRows([
    { name: 'a classified error persists a human notice block carrying errorClass + detail', run: async () => {
      const s = seed();
      const raw = 'claude exited with code 1: [claude-code:unrecognized_model] {"model":"claude-opus-5-5","query_source":"sdk"}';
      const { turn, frames } = makeTurn(s, {}, {
        runClaudeImpl: async () => {
          throw Object.assign(new Error(raw), { errorClass: 'model' });
        },
      });
      await turn.run();
      const last = frames.at(-1);
      assert.equal(last.type, 'ask-error');
      assert.equal(last.errorClass, 'model');
      const blocks = getMessage(s.asst.id).blocks;
      const notice = blocks.find((b) => b && b.kind === 'notice' && b.errorClass === 'model');
      assert.ok(notice, 'the classified notice block is persisted');
      assert.equal(notice.text, humanErrorText('model'));
      assert.equal(notice.detail, raw, 'the raw runner message rides the block for the Details expander');
      // The frame mirrors ask-done: the terminal blocks ride along, so the LIVE
      // client renders the classified notice without waiting for a reload.
      assert.ok(Array.isArray(last.blocks), 'ask-error carries the terminal blocks');
      assert.ok(last.blocks.some((b) => b && b.kind === 'notice' && b.errorClass === 'model'),
        'the classified notice is among the frame blocks');
    } },
    { name: 'an unclassified error persists NO notice block (raw message stays the only evidence)', run: async () => {
      const s = seed();
      const { turn, frames } = makeTurn(s, {}, {
        runClaudeImpl: async () => {
          throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: undefined });
        },
      });
      await turn.run();
      const blocks = getMessage(s.asst.id).blocks;
      assert.equal(blocks.filter((b) => b && b.kind === 'notice').length, 0);
      assert.ok(Array.isArray(frames.at(-1).blocks), 'ask-error still carries the terminal blocks');
      assert.equal(frames.at(-1).blocks.filter((b) => b && b.kind === 'notice').length, 0);
    } },
  ]);
});

test('a CLI synthetic error line never becomes the answer text; it rides the notice detail instead', async () => {
  const s = seed();
  const apiLine = 'Failed to authenticate. API Error: 403 No access to this model: claude-opus-5-5';
  const stderr = 'claude exited with code 1: [claude-code:unrecognized_model] {"model":"claude-opus-5-5","query_source":"sdk"}';
  const { turn, frames } = makeTurn(s, {}, {
    runClaudeImpl: async (opts) => {
      const onEvent = opts.onEvent;
      push(onEvent, { type: 'system', subtype: 'init', session_id: 'sess-x', tools: [] });
      push(onEvent, { type: 'assistant', message: { id: 'synth-1', model: '<synthetic>', content: [{ type: 'text', text: apiLine }] }, parent_tool_use_id: null });
      push(onEvent, { type: 'result', subtype: 'success', is_error: true, result: apiLine, total_cost_usd: 0, usage: {}, session_id: 'sess-x' });
      throw Object.assign(new Error(stderr), { errorClass: 'model' });
    },
  });
  await turn.run();
  const msg = getMessage(s.asst.id);
  assert.equal(msg.text, '', 'the API refusal line is not persisted as the answer');
  const notice = (msg.blocks || []).find((b) => b && b.kind === 'notice' && b.errorClass === 'model');
  assert.ok(notice, 'the classified notice is persisted');
  assert.match(notice.detail, new RegExp(`${stderr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the runner verdict is in the detail');
  assert.match(notice.detail, /Failed to authenticate/, 'the CLI refusal line rides the detail too');
  const last = frames.at(-1);
  assert.equal(last.type, 'ask-error');
  assert.equal(last.text ?? '', '');
});

test('resume predicate is narrow: an abort never enters the fallback, a healthy-session failure does not retry', async () => {
  await checkRows([
    { name: 'B-4 guard: an abort rejection NEVER enters the resume fallback', run: async () => {
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
    } },
    { name: 'healthy-session failure does NOT retry (narrow predicate)', run: async () => {
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
    } },
  ]);
});

test('title: the first turn titles with the hardened option set; a mid-generation rename wins over the title and over the empty-result fallback; later turns never title', async () => {
  await checkRows([
    { name: 'title: fires on the first turn with the R-D + dontAsk option set; rename guard wins', run: async () => {
      const s = seed();
      const titleCalls = [];
      const { turn, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hello there', deterministicTitle: 'hello there' }, {
        generateTitle: async (text, opts) => { titleCalls.push({ text, opts }); return 'Fable Title'; },
        runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
      });
      // The route stamps NOTHING before the 202: the row's title IS NULL while haiku runs.
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
      assert.equal(o.runModel, 'claude-opus-5-5', '#422: the chat\'s own model is the title default');
      assert.equal(o.engine, undefined, 'a Claude chat\'s title spawn carries no engine option (D8/D12: titles follow the chat\'s engine; Claude chats stay byte-identical)');
      assert.equal(typeof o.onError, 'function', '#422: a failed title is reported, not swallowed');
      assert.equal(o.signal, undefined, 'no signal — fires after ANY terminal, incl. a stop that aborted the controller');
      assert.equal(getThread(s.thread.id).title, 'Fable Title');
      assert.deepEqual(outOfTurn, [{ type: 'ask-title', title: 'Fable Title' }]);
    } },
    { name: 'title suppressed when the user renamed mid-generation; not fired on later turns', run: async () => {
      const s = seed();
      let release;
      const gate = new Promise((r) => { release = r; });
      const { turn, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hi', deterministicTitle: 'hi' }, {
        generateTitle: () => gate.then(() => 'Late Title'),
        runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
      });
      await turn.run();
      assert.equal(getThread(s.thread.id).title, null, 'nothing is stamped while haiku runs — the header stays "Ask Worca"');
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
    } },
    { name: 'title: an empty haiku result applies the route\'s fallback string + announces it, unless the user renamed meanwhile', run: async () => {
      // Nothing is stamped before the 202 any more, so an empty generateTitle()
      // (failure / abort / refusal) would leave the thread untitled for ever. The
      // turn applies the route's fallback (sanitized first 80 chars, or "New chat")
      // behind the same IS NULL guard and announces it with the same frame — the
      // ONLY moment the prompt text may become the title.
      const s = seed();
      const { turn, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hello there', deterministicTitle: 'hello there' }, {
        generateTitle: async () => '',
        runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
      });
      await turn.run();
      await turn.titlePromise;
      assert.equal(getThread(s.thread.id).title, 'hello there', 'fallback applied');
      assert.deepEqual(outOfTurn, [{ type: 'ask-title', title: 'hello there' }], 'fallback announced like a generated title');

      // The rename guard wins over the fallback too.
      const s2 = seed();
      let release;
      const gate = new Promise((r) => { release = r; });
      const { turn: t2, outOfTurn: o2 } = makeTurn(s2, { firstTurn: true, firstText: 'hi', deterministicTitle: 'hi' }, {
        generateTitle: () => gate.then(() => ''),
        runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
      });
      await t2.run();
      setThreadTitle(s2.thread.id, 'User Named It');      // PATCH landed while haiku ran
      release();
      await t2.titlePromise;
      assert.equal(getThread(s2.thread.id).title, 'User Named It');
      assert.equal(o2.length, 0, 'no frame for a suppressed fallback');

      // No fallback string at all: the thread stays untitled and nothing is announced.
      const s3 = seed();
      const { turn: t3, outOfTurn: o3 } = makeTurn(s3, { firstTurn: true, firstText: 'x', deterministicTitle: null }, {
        generateTitle: async () => '',
        runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: 'x', exitCode: 0 }; },
      });
      await t3.run();
      await t3.titlePromise;
      assert.equal(getThread(s3.thread.id).title, null);
      assert.equal(o3.length, 0);
    } },
  ]);
});

test('contract: run() never rejects (terminal error with no listener resolves); done / error fire once for an attached listener', async () => {
  await checkRows([
    { name: "contract: run() never rejects — the terminal 'error' emit with NO listener resolves", run: async () => {
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
    } },
    { name: "contract: 'done' and 'error' events fire once for an attached listener", run: async () => {
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
    } },
  ]);
});

test('thread deleted mid-turn: run() still resolves done and the ledger row is still written', async () => {
  // One scenario: the user deletes the chat while the turn streams; both rows read its outcome.
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
  const out = await turn.run();
  await checkRows([
    { name: 'deleted thread mid-turn: terminal write is harmless, run() still resolves', run: () => {
      assert.equal(out.status, 'done');                   // finishMessage/addThreadTotals hit no rows, swallowed
    } },
    { name: 'thread deleted mid-turn: the ledger row is still written', run: () => {
      const rows = getDb().prepare('SELECT thread_id, amount_usd FROM ask_cost_ledger').all();
      assert.equal(rows.length, 1, 'spend is a financial fact even without the thread (D10)');
      assert.equal(rows[0].thread_id, s.thread.id);
      assert.equal(rows[0].amount_usd, 0.05);
    } },
  ]);
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
  assert.equal(rows[0].model, 'claude-opus-5-5');
  assert.equal(typeof rows[0].ts, 'number');
  assert.equal(ledgerAtDoneFrame, 1, 'row committed before the ask-done broadcast (D12 reads fresh data)');
  deleteThread(s.thread.id);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 1,
    'FK-free: the row survives the thread delete (D1)');
});

test('ledger: a turn with no result writes no row; an error turn that saw a result still records the spend', async () => {
  await checkRows([
    { name: 'a turn that ends before a result leaves no ledger row', run: async () => {
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
    } },
    { name: 'error turn that saw a result still records the spend (money was spent)', run: async () => {
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
    } },
  ]);
});

test('ledger writer: an injected recordAskCost replaces the real writer with the D10/D11 payload; a throwing addThreadTotals never swallows the ledger append', async () => {
  await checkRows([
    { name: 'recordAskCost dep: injected, called once with the D10/D11 payload', run: async () => {
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
      assert.equal(calls[0].model, 'claude-opus-5-5');
      assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_cost_ledger').get().n, 0,
        'the injected dep fully replaces the real writer');
    } },
    { name: 'a throwing store.addThreadTotals does not swallow the ledger append (D10 placement)', run: async () => {
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
    } },
  ]);
});

// ── #397: the user-pinned scope on proposals ─────────────────────────────────

const proposeRun = (input) => async (opts) => {
  push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__propose_run', input }] } });
  push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }] }, tool_use_result: '{"ok":true}' });
  push(opts.onEvent, RESULT());
  return { text: '', exitCode: 0 };
};

test('#397 pinned scope: target-less proposal takes the pin (no flag); another project or a workspace pin flags scopeMismatch; no pin never flags', async () => {
  await checkRows([
    { name: '#397: a target-less proposal is validated with the pinned scope; a matching card carries no flag', run: async () => {
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
    } },
    { name: '#397: a proposal explicitly targeting ANOTHER project than the pin flags the card', run: async () => {
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
    } },
    { name: '#397: a workspace pin flags a project-targeted card too; no pin means no flag ever', run: async () => {
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
    } },
  ]);
});

const toolUse = (onEvent, msgId, toolId, name, input) => push(onEvent, { type: 'assistant', message: { id: msgId, content: [{ type: 'tool_use', id: toolId, name, input }] }, parent_tool_use_id: null });
const toolResult = (onEvent, toolId, text) => push(onEvent, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text }] }] }, parent_tool_use_id: null });
const mainUsage = (onEvent, id, usage) => {
  push(onEvent, { type: 'stream_event', event: { type: 'message_start', message: { id, role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, parent_tool_use_id: null });
  push(onEvent, { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage }, parent_tool_use_id: null });
};

test('mutation sinks: worktree and memory writes in the stream reach their injected sinks once; a throwing sink never breaks the turn', async () => {
  await checkRows([
    { name: 'onWorktreeMutation dep: a worktree write in the stream reaches the injected sink once; a throwing sink is contained', run: async () => {
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
    } },
    { name: 'onMemoryMutation dep: a remember in the stream reaches the injected sink with its scope key', run: async () => {
      const s = seed(); const pokes = [];
      const { turn } = makeTurn(s, {}, {
        onMemoryMutation: (e) => pokes.push(e),
        runClaudeImpl: async ({ onEvent }) => {
          toolUse(onEvent, 'm1', 'toolu_1', 'mcp__worca__remember', { scope: 'global', name: 'style', body: 'x' });
          toolResult(onEvent, 'toolu_1', JSON.stringify({ scope: 'global', projectKey: null, scopeKey: 'global', name: 'style', bytes: 1, created: true, mode: 'replace' }));
          say(onEvent, 'm2', 'saved');
          push(onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      assert.deepEqual(pokes, [{ scope: 'global', tool: 'remember' }]);
    } },
  ]);
});

test('liveCostRates: ask-usage carries a display estimate (injected or list-price default; unknown id → null) and null after the result; no sink sees it', async () => {
  await checkRows([
    { name: 'liveCostRates dep: ask-usage frames carry a display estimate before the result and null after; no sink sees it', run: async () => {
      clearAskLedger();
      const s = seed(); const costs = [];
      const { turn, frames } = makeTurn(s, {}, {
        liveCostRates: (model) => (model === 'claude-opus-5-5' ? { input: 2, output: 4 } : null),
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
    } },
    { name: 'liveCostRates default: a built-in id prices from the list table; an unknown id → estimatedCostUsd null', run: async () => {
      const s = seed();   // makeTurn's model is claude-opus-5-5 → PREDEFINED_LIST_PRICES row ($4 / $20)
      const { turn, frames } = makeTurn(s, {}, {
        runClaudeImpl: async ({ onEvent }) => {
          mainUsage(onEvent, 'm1', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
          say(onEvent, 'm1', 'answer');
          push(onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      assert.equal(frames.filter((f) => f.type === 'ask-usage')[0].estimatedCostUsd, 24, '1M in @ $4 + 1M out @ $20');

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
    } },
  ]);
});

test('title: kicked off at the START of the first turn (ask-title before ask-done); a scratch-dir failure still titles exactly once (post-terminal backstop)', async () => {
  await checkRows([
    { name: 'title: kicked off at the START of the first turn — ask-title lands BEFORE ask-done when haiku beats the turn', run: async () => {
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
      const running = turn.run();
      await started;
      await turn.titlePromise;             // the (fake) haiku call resolved and ask-title went out
      releaseTurn();
      await running;
      assert.ok(order.indexOf('ask-title') > order.indexOf('ask-start'), 'after the turn started');
      assert.ok(order.indexOf('ask-title') < order.indexOf('ask-done'), 'and BEFORE the turn ended');
      assert.equal(getThread(s.thread.id).title, 'Fast Title');
      assert.equal(order.filter((t) => t === 'ask-title').length, 1, 'kicked off once — the post-turn backstop is a no-op');
    } },
    { name: 'title: a scratch-dir failure still titles the first turn exactly once (the post-terminal backstop)', run: async () => {
      const s = seed(); const calls = [];
      const { turn, frames, outOfTurn } = makeTurn(s, { firstTurn: true, firstText: 'hello there', deterministicTitle: 'hello there' }, {
        fs: { mkdir: async () => { throw new Error('EACCES: scratch'); }, writeFile: async () => {}, unlink: async () => {} },
        generateTitle: async () => { calls.push(1); return 'Backstop Title'; },
      });
      await turn.run();
      await turn.titlePromise;
      assert.equal(frames.at(-1).type, 'ask-error', 'the deps failure is an error completion');
      assert.equal(calls.length, 1);
      assert.deepEqual(outOfTurn, [{ type: 'ask-title', title: 'Backstop Title' }]);
    } },
  ]);
});

const WF_TOOL = 'mcp__worca__propose_workflow';
const wfStart = (onEvent, id, input) => push(onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id, name: WF_TOOL, input }] } });
const wfResult = (onEvent, id, text, isError = false) => push(onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
const drain = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
const BUILDING_KEYS = ['mode', 'name', 'note', 'projectKey', 'projectName', 'task', 'thenRun', 'trace', 'type', 'workspaceId', 'workspaceName'];
const PROPOSED_KEYS = ['costUsd', 'fingerprint', 'ignoredProjectOverrides', 'manifest', 'match', 'members', 'mode', 'models', 'name', 'nodes', 'note', 'order',
  'projectKey', 'projectName', 'reasoning', 'round', 'shape', 'signals', 'size', 'summary', 'target', 'taskKind', 'thenRun', 'type', 'warnings', 'workspaceId', 'workspaceName'];

test('workflow card: building at START, proposed at RESULT (cost booked); a tool error, unassemblable shape, {ok:false} or a mid-build end fails it with the reason', async () => {
  await checkRows([
    { name: 'workflow card: building at tool_use START (persisted), proposed at RESULT from the re-validated shape; cost booked on the turn', run: async () => {
      const s = seed();
      const fixture = proposalFor();
      let midBlocks = null; let revalArgs = null;
      const { turn, frames } = makeTurn(s, { pinnedScope: { projectKey: 'demo-00000001' } }, {
        // v4: the stub resolves the project the way the real revalidate does; the tool result below carries projectName:null
        // (what the MOCK child returns), so the card's name must come from r.project.
        revalidateWorkflow: async (o) => { revalArgs = o; return { proposal: fixture, template: {}, match: null, tunables: {}, shape: o.shape, summary: 'stages: x', project: { key: 'demo-00000001', name: 'Demo', path: '/tmp/demo' } }; },
        runClaudeImpl: async (opts) => {
          wfStart(opts.onEvent, 'toolu_wf', { task: 'Add a settings page', note: 'A note', thenRun: true });
          await drain();
          midBlocks = getMessage(s.asst.id).blocks;
          wfResult(opts.onEvent, 'toolu_wf', JSON.stringify({ ok: true, mode: 'task', projectKey: 'demo-00000001', projectName: null, name: 'N', match: null, warnings: ['w1'],
            summary: 'stages: x', shape: { name: 'N', stages: [] }, costUsd: 0.02, fingerprint: 'top-level: src/', note: 'A note', thenRun: true }));
          await drain();
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      const building = (midBlocks || []).find((b) => b.kind === 'card');
      assert.ok(building && building.state === 'building', 'the card exists from the tool_use on');
      assert.match(building.id, /^card_[0-9a-f]{8}$/);
      assert.deepEqual(Object.keys(building.card).sort(), BUILDING_KEYS);
      assert.equal(building.card.type, 'workflow'); assert.equal(building.card.mode, 'task'); assert.equal(building.card.projectKey, 'demo-00000001', 'the pinned project is the default target');
      assert.equal(building.card.note, 'A note'); assert.equal(building.card.trace.step, 1); assert.equal(building.card.thenRun, true);
      assert.deepEqual(revalArgs, { shape: { name: 'N', stages: [] }, projectKey: 'demo-00000001', warnings: ['w1'], costUsd: 0.02, fingerprint: 'top-level: src/' });
      const final = getMessage(s.asst.id);
      const card = final.blocks.find((b) => b.kind === 'card');
      assert.equal(card.id, building.id, 'same block, flipped in place');
      assert.equal(card.state, 'proposed');
      assert.deepEqual(Object.keys(card.card).sort(), PROPOSED_KEYS);
      assert.equal(card.card.manifest.graph.nodes.length, fixture.manifest.graph.nodes.length, 'the card mounts the REAL manifest');
      assert.equal(card.card.summary, 'stages: x'); assert.equal(card.card.projectName, 'Demo', 'projectName: the tool\'s value, else the parent\'s lookup (v4)');
      const states = frames.filter((f) => f.type === 'ask-card').map((f) => f.block.state);
      assert.deepEqual(states, ['building', 'proposed']);
      const done = frames.find((f) => f.type === 'ask-done');
      assert.equal(done.costUsd, 0.07, 'RESULT() bills 0.05 (test/ask-turn.test.mjs:20) + the classifier\'s 0.02 ride the turn\'s four sinks (PD2)');
      assert.equal(final.costUsd, 0.07);
      assert.equal(card.card.workspaceId, null); assert.equal(card.card.workspaceName, null);
    } },
    { name: 'workflow card: a workspace-pinned chat with no explicit target builds a workspace card; the workspace result revalidates with workspaceId and names the workspace', run: async () => {
      const s = seed();
      let midBlocks = null; let revalArgs = null;
      const { turn } = makeTurn(s, { pinnedScope: { workspaceId: 'ws_00000001' } }, {
        revalidateWorkflow: async (o) => { revalArgs = o; return { proposal: { ...proposalFor(), target: 'workspace', members: [] }, shape: o.shape, summary: 's', workspace: { id: 'ws_00000001', name: 'Fleet' } }; },
        runClaudeImpl: async (opts) => {
          wfStart(opts.onEvent, 'toolu_ws', { task: 'Add a settings page' });
          await drain();
          midBlocks = getMessage(s.asst.id).blocks;
          wfResult(opts.onEvent, 'toolu_ws', JSON.stringify({ ok: true, mode: 'task', projectKey: null, workspaceId: 'ws_00000001', workspaceName: null, projectName: 'Stray',
            summary: 's', shape: { name: 'N', stages: [] }, costUsd: 0, fingerprint: 'workspace: Fleet' }));
          await drain();
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      const building = (midBlocks || []).find((b) => b.kind === 'card');
      assert.equal(building.card.projectKey, null, 'a pinned workspace is the default target');
      assert.equal(building.card.workspaceId, 'ws_00000001');
      assert.equal(building.card.workspaceName, null);
      assert.equal(revalArgs.workspaceId, 'ws_00000001', 'revalidate gets the workspace');
      const card = getMessage(s.asst.id).blocks.find((b) => b.kind === 'card');
      assert.equal(card.state, 'proposed');
      assert.equal(card.card.workspaceId, 'ws_00000001');
      assert.equal(card.card.workspaceName, 'Fleet', 'the parent\'s lookup names the workspace when the child returns null');
      assert.equal(card.card.projectName, null, 'a workspace card carries no project name');
      assert.equal(card.card.projectKey, null);
      assert.equal(card.card.target, 'workspace');
    } },
    { name: 'workflow card: an explicit projectKey wins over a workspace pin', run: async () => {
      const s = seed();
      let midBlocks = null;
      const { turn } = makeTurn(s, { pinnedScope: { workspaceId: 'ws_00000001' } }, {
        revalidateWorkflow: async (o) => ({ proposal: proposalFor(), shape: o.shape, summary: 's', project: { key: 'demo-00000001', name: 'Demo' } }),
        runClaudeImpl: async (opts) => {
          wfStart(opts.onEvent, 'toolu_p', { task: 'Add a settings page', projectKey: 'demo-00000001' });
          await drain();
          midBlocks = getMessage(s.asst.id).blocks;
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      const building = (midBlocks || []).find((b) => b.kind === 'card');
      assert.equal(building.card.projectKey, 'demo-00000001');
      assert.equal(building.card.workspaceId, null);
    } },
    { name: 'workflow card: a tool error, an unassemblable shape or an {ok:false} classifier result flips the card to failed with the reason (the failed classifier\'s spend is still booked); a turn that ends mid-build fails it', run: async () => {
      const s = seed();
      const { turn, frames } = makeTurn(s, {}, {
        revalidateWorkflow: async () => { throw new Error('invalid workflow shape: stage "s1": unknown agent "e2e-tester"'); },
        runClaudeImpl: async (opts) => {
          wfStart(opts.onEvent, 'toolu_a', { shape: { stages: [] }, projectKey: 'p' });
          wfResult(opts.onEvent, 'toolu_a', 'error: propose_workflow: the workflow classifier timed out: no reply after 90s', true);
          wfStart(opts.onEvent, 'toolu_b', { shape: { stages: [] }, projectKey: 'p' });
          wfResult(opts.onEvent, 'toolu_b', JSON.stringify({ ok: true, shape: { stages: [] }, projectKey: 'p' }));
          // v7 (PD2): the child's {ok:false} carries what the failed classifier attempts already cost — real money, booked like a success's.
          wfStart(opts.onEvent, 'toolu_d', { task: 'classifier gives up', projectKey: 'p' });
          wfResult(opts.onEvent, 'toolu_d', JSON.stringify({ ok: false, mode: 'task', projectKey: 'p', projectName: 'P', error: 'the workflow classifier failed: unusable shape after 2 attempts: stage "s1": unknown agent "x"', costUsd: 0.03 }));
          wfStart(opts.onEvent, 'toolu_c', { task: 'never answered', projectKey: 'p' });
          await drain();
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      const cards = getMessage(s.asst.id).blocks.filter((b) => b.kind === 'card');
      assert.deepEqual(cards.map((c) => [c.state, c.error]), [
        ['failed', 'propose_workflow: the workflow classifier timed out: no reply after 90s'],
        ['failed', 'invalid workflow shape: stage "s1": unknown agent "e2e-tester"'],
        ['failed', 'the workflow classifier failed: unusable shape after 2 attempts: stage "s1": unknown agent "x"'],
        ['failed', 'the reply ended before the proposal was ready'],
      ]);
      assert.equal(cards[0].card.mode, 'shape', 'the building payload stays under the error');
      assert.equal(frames.find((f) => f.type === 'ask-done').costUsd, 0.08, 'RESULT() 0.05 + the failed classifier\'s 0.03 (PD2, v7)');
    } },
  ]);
});

test('mock ask: the word "workflow" fabricates a propose_workflow pair from mockShapeFor; a "[worca event] … saved … thenRun=true" prompt proposes a run with that workflowId', async () => {
  // runClaude takes the mock branch only under mockEnabled(): the turn passes MARKERS, not a mock flag (spawn.mjs:104).
  const prevMock = process.env.WORCA_MOCK; process.env.WORCA_MOCK = '1';
  try {
  const s = seed();
  const reval = async (o) => ({ proposal: proposalFor(), template: {}, match: null, tunables: {}, shape: o.shape, summary: 's' });
  const a = makeTurn(s, { prompt: 'make me an auto workflow for this plan:\n# Rename\nrename pauseReason to pauseCause', mock: { card: { projectKey: 'demo-00000001', workflowId: 'wf_default', guardrailsId: 'normal', brief: 'b' } } },
    { revalidateWorkflow: reval, validateProposal: async () => ({ ok: true, card: {} }) });
  await a.turn.run();
  const cards = getMessage(s.asst.id).blocks.filter((b) => b.kind === 'card');
  assert.equal(cards.length, 1); assert.equal(cards[0].card.type, 'workflow'); assert.equal(cards[0].state, 'proposed');
  assert.equal(cards[0].card.shape.taskKind, 'plan-complete-small', 'the heading text picks the implement-only recipe');
  const s2 = seed();
  let proposed = null;
  const b = makeTurn(s2, { prompt: '[worca event] workflow card card_0000aa01 saved as wf_rename "Rename"; thenRun=true; project=demo-00000001', mock: { card: { projectKey: 'demo-00000001', workflowId: 'wf_default', guardrailsId: 'normal', brief: 'b' } } },
    { validateProposal: async (input) => { proposed = input; return { ok: true, card: { ...input } }; } });
  await b.turn.run();
  assert.equal(proposed.workflowId, 'wf_rename', 'the event arm proposes the run WITH the saved workflow');
  assert.equal(proposed.brief, 'Run with "Rename"', 'the brief names the workflow, not the event line');
  assert.equal(getMessage(s2.asst.id).blocks.filter((x) => x.kind === 'card' && !x.card.type).length, 1);
  const s3 = seed();
  const c = makeTurn(s3, { prompt: '[worca event] workflow card card_0000aa01 declined; project=demo-00000001', mock: { card: {} } }, {});
  await c.turn.run();
  assert.match(getMessage(s3.asst.id).text, /another auto workflow|what to change|saved workflow/i);
  assert.equal(getMessage(s3.asst.id).blocks.filter((x) => x.kind === 'card').length, 0, 'the word "workflow" inside an EVENT never builds a card');
  } finally { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; }
});

// ── The authoritative re-validation gets the thread's attachment ledger ───────

test('propose_run re-validation gets the owning thread\'s attachment ledger + cardId; a throwing ledger degrades to [] and the card still lands', async () => {
  await checkRows([
    { name: 'propose_run re-validation hands the thread\'s attachment ledger + cardId to the validator', run: async () => {
      const s = seed();
      let seenOpts = null;
      let seenTid = null;   // asserted OUTSIDE the fake: _onProposal wraps the ledger call in try/catch, so a throw in here would be swallowed
      const rows = [{ id: 'att_00000001', threadId: s.thread.id, messageId: null, name: 'a.md', bytes: 1, kind: 'text', mime: null, createdAt: 't' }];
      const { turn } = makeTurn(s, {}, {
        store: { listAttachments: (tid) => { seenTid = tid; return rows; } },
        validateProposal: async (input, o) => { seenOpts = o; return { ok: true, card: { target: 'project', projectKey: 'demo-00000001', workspaceId: null } }; },
        runClaudeImpl: proposeRun({ projectKey: 'demo-00000001', brief: 'x', attachmentIds: ['att_00000001'] }),
      });
      await turn.run();
      assert.ok(seenOpts, 'the validator ran');
      assert.equal(seenTid, s.thread.id, 'the OWNING thread\'s ledger');
      assert.match(seenOpts.cardId, /^card_[0-9a-f]{8}$/);
      assert.deepEqual(seenOpts.attachments, rows);
    } },
    { name: 'propose_run re-validation survives a throwing ledger (empty attachments, card still lands)', run: async () => {
      const s = seed();
      let seenOpts = null;
      const { turn } = makeTurn(s, {}, {
        store: { listAttachments: () => { throw new Error('db gone'); } },
        validateProposal: async (input, o) => { seenOpts = o; return { ok: true, card: { target: 'project', projectKey: 'demo-00000001', workspaceId: null } }; },
        runClaudeImpl: proposeRun({ projectKey: 'demo-00000001', brief: 'x' }),
      });
      await turn.run();
      assert.deepEqual(seenOpts.attachments, []);
      assert.ok(getMessage(s.asst.id).blocks.some((b) => b.kind === 'card'), 'the card still landed');
    } },
  ]);
});

test('track_run: one progress card per pipeline per reply, failure → notice; an isError tool result mints nothing', async () => {
  await checkRows([
    { name: 'track_run: the parent links through deps.trackRun and mints ONE progress card per pipeline per reply; a failure is a notice', run: async () => {
      const s = seed();
      const tracked = [];
      let midBlocks = null;
      const CARD = { type: 'progress', pipelineId: 'abcd1234', runId: null, projectKey: 'demo-00000001', workspaceId: null, title: 'T', label: 'demo', status: 'done' };
      const call = (onEvent, n, id) => {
        push(onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: `msg_${n}`, content: [{ type: 'tool_use', id: `toolu_${n}`, name: 'mcp__worca__track_run', input: { id } }] } });
        push(onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: '{"ok":true}' }] } });
      };
      const { turn, frames } = makeTurn(s, { pinnedScope: { projectKey: 'demo-00000001' } }, {
        trackRun: async (input, { threadId, pin }) => { tracked.push({ input, threadId, pin }); return input.id === 'bad' ? { ok: false, error: 'run not found' } : { ok: true, card: CARD }; },
        runClaudeImpl: async (opts) => {
          call(opts.onEvent, 1, 'abcd1234'); call(opts.onEvent, 2, 'abcd1234'); call(opts.onEvent, 3, 'bad');
          for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
          midBlocks = getMessage(s.asst.id).blocks;
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      assert.equal(tracked.length, 3);
      assert.deepEqual(tracked[0], { input: { id: 'abcd1234' }, threadId: s.thread.id, pin: { projectKey: 'demo-00000001' } });
      const cards = (midBlocks || []).filter((b) => b.kind === 'card');
      assert.equal(cards.length, 1, 'the second track of the same pipeline mints nothing');
      assert.equal(cards[0].state, 'tracked');
      assert.match(cards[0].id, /^card_[0-9a-f]{8}$/);
      assert.deepEqual(cards[0].card, CARD);
      assert.deepEqual(Object.keys(cards[0]).sort(), ['card', 'id', 'kind', 'state']);
      assert.ok(midBlocks.some((b) => b.kind === 'notice' && b.text === 'Could not track the run: run not found'));
      const iCard = frames.findIndex((f) => f.type === 'ask-card');
      assert.ok(iCard !== -1 && iCard < frames.findIndex((f) => f.type === 'ask-done'));
    } },
    { name: 'track_run: an isError tool result mints nothing (the child already told the model why)', run: async () => {
      const s = seed();
      let calls = 0;
      const { turn } = makeTurn(s, {}, {
        trackRun: async () => { calls += 1; return { ok: true, card: {} }; },
        runClaudeImpl: async (opts) => {
          push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__worca__track_run', input: { id: 'zz' } }] } });
          push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'error: track_run: run not found', is_error: true }] } });
          await new Promise((r) => setImmediate(r));
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      assert.equal(calls, 0);
      assert.ok(!getMessage(s.asst.id).blocks.some((b) => b.kind === 'card'));
    } },
  ]);
});

test('memory: the turn refreshes the mount for its project before spawning and hands it to the spawn as --add-dir + the env override; a failing refresh proceeds without memory', async () => {
  const s = seed();
  const calls = [];
  let seenOpts = null;
  const impl = async (opts) => {
    seenOpts = opts;
    opts.onEvent({ type: 'session', sessionId: 'sess-mem' });
    say(opts.onEvent, 'msg_1', 'ok');
    push(opts.onEvent, RESULT());
    return { text: 'ok', exitCode: 0 };
  };
  const { turn } = makeTurn(s, { memoryProject: { key: 'proj-00000001', name: 'Proj' } }, {
    runClaudeImpl: impl,
    memoryMount: async (arg) => { calls.push(arg); return '/m/proj-00000001'; },
  });
  assert.equal((await turn.run()).status, 'done');
  assert.deepEqual(calls, [{ projectKey: 'proj-00000001', projectName: 'Proj' }]);
  assert.equal(turn.memoryDir, '/m/proj-00000001');
  assert.deepEqual(seenOpts.addDirs, ['/m/proj-00000001']);
  assert.equal(seenOpts.modelEnv.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD, '1');
  // No project in the context ⇒ the global-only mount is still refreshed; null ⇒ no flag, no override.
  const calls2 = [];
  const { turn: global } = makeTurn(seed(), {}, { runClaudeImpl: impl, memoryMount: async (arg) => { calls2.push(arg); return null; } });
  assert.equal((await global.run()).status, 'done');
  assert.deepEqual(calls2, [{ projectKey: null, projectName: null }]);
  assert.equal(seenOpts.addDirs, undefined, 'null ⇒ no --add-dir');
  assert.equal('CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD' in seenOpts.modelEnv, false, 'and no override');
  // A store failure never breaks a turn.
  const { turn: broken } = makeTurn(seed(), {}, { runClaudeImpl: impl, memoryMount: async () => { throw new Error('store down'); } });
  assert.equal((await broken.run()).status, 'done');
  assert.equal(broken.memoryDir, null);
  assert.equal(seenOpts.addDirs, undefined);
});

test('relay: the turn hands its web access to the relay, marks the spawn relayed, and writes the MCP config 0640 (0600 when not relayed)', async () => {
  await checkRows([
    { name: 'relay: the turn hands its web access to the relay and marks the spawn relayed', run: async () => {
      const s = seed();
      const web = { enabled: true, allowedDomains: ['docs.example.com'], search: null };
      let relayArgs = null; let relayed = null;
      const { turn } = makeTurn(s, { web }, {
        agentRelay: (a) => { relayArgs = a; return { url: 'http://127.0.0.1:1/api/ask/relay', token: 't', dispose: () => {} }; },
        runClaudeImpl: async (opts) => {
          relayed = opts.asAgent;
          throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
        },
      });
      await turn.run();
      assert.deepEqual(relayArgs.web, web);
      assert.equal(relayed, true);
    } },
    { name: 'the MCP config is readable by the agent user on a relayed turn, by worca alone otherwise', run: async () => {
      // worca-01, 1.6.0-rc.1: a relayed turn runs as the person's agent user, which read a 0600
      // file owned by worca — "Invalid MCP configuration: … EACCES: permission denied".
      const modes = [];
      const fs = { mkdir: async () => {}, writeFile: async (p, _d, o) => { if (/mcp-.*\.json$/.test(p)) modes.push(o.mode); }, unlink: async () => {} };
      const fail = async () => { throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' }); };
      const relayedTurn = makeTurn(seed(), {}, { fs, agentRelay: () => ({ url: 'http://127.0.0.1:1/api/ask/relay', token: 't', dispose: () => {} }), runClaudeImpl: fail }).turn;
      await relayedTurn.run();
      const plainTurn = makeTurn(seed(), {}, { fs, runClaudeImpl: fail }).turn;
      await plainTurn.run();
      assert.deepEqual(modes, [0o640, 0o600]);
    } },
  ]);
});

// set_away_now / set_run_away_mode: the child validated; the parent applies and the chat shows the line.
const awayCall = (onEvent, n, name, input, content, isError = false) => {
  push(onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: `msg_${n}`, content: [{ type: 'tool_use', id: `toolu_${n}`, name, input }] } });
  push(onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content, ...(isError ? { is_error: true } : {}) }] } });
};
async function runAway(s, awaySwitch, calls) {
  let mid = null;
  const { turn } = makeTurn(s, {}, {
    awaySwitch,
    runClaudeImpl: async (opts) => {
      calls.forEach((c, i) => awayCall(opts.onEvent, i + 1, ...c));
      for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
      mid = getMessage(s.asst.id).blocks;
      push(opts.onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  });
  await turn.run();
  return (mid || []).filter((b) => b.kind === 'notice').map((b) => b.text);
}

test('away switches: notices read "Done — <line>." and a refusal names the run; isError applies nothing', async () => {
  await checkRows([
    { name: 'away switches: the notice reads "Done — <line>." with one closing mark; a refusal names the run', run: async () => {
      const seen = [];
      const lines = { g: 'Right now you count as away.', r: 'on run Fix login: never', p: 'Away mode is paused. worca answers nothing until you turn it back on. (Marked runs wait too.)' };
      const G = (line) => ['mcp__worca__set_away_now', { mode: 'away' }, JSON.stringify({ ok: true, requested: { kind: 'global', toggle: line } })];
      const notices = await runAway(seed(), async (req) => { seen.push(req); return req.kind === 'run' ? { ok: true, line: lines.r } : { ok: true, line: lines[req.toggle] }; }, [
        G('g'), G('p'),
        ['mcp__worca__set_run_away_mode', { runId: 'u1', mode: 'off' }, JSON.stringify({ ok: true, requested: { kind: 'run', runId: 'u1', mode: 'off' } })],
        ['mcp__worca__set_away_now', { mode: 'x' }, 'error: set_away_now: mode must be', true],
      ]);
      assert.equal(seen.length, 3, 'an isError result applies nothing');
      assert.deepEqual(notices, ['Done — Right now you count as away.', `Done — ${lines.p}`, 'Done — on run Fix login: never.']);
    } },
    { name: 'away switches: a finished run reaches the parent and the chat says why (Review Focus 4)', run: async () => {
      const seen = [];
      const notices = await runAway(seed(), async (req) => { seen.push(req); return { ok: false, error: 'the run is done' }; }, [
        ['mcp__worca__set_run_away_mode', { runId: 'aaaa0001', mode: 'on' }, JSON.stringify({ ok: false, error: 'the run is done', requested: { kind: 'run', runId: 'aaaa0001', status: 'done', mode: 'on' } })],
      ]);
      assert.equal(seen[0].status, 'done');
      assert.deepEqual(notices, ['Could not change Away mode on this run: the run is done']);
    } },
  ]);
});

// ── MCP registry: threading (§9.2), the Ask column of §10, the turn-end notice (§9.1 D17) ──
const MCP = (extra = []) => ({
  servers: {
    sentry_billing: { type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: 'Bearer ${MCPSECRET_2EB4507A}' } },
    ...Object.fromEntries(extra.map((n) => [n, { type: 'http', url: `https://${n}.example.com/mcp` }])),
  },
  env: { MCPSECRET_2EB4507A: 'sntrys_live_secret_value', MCP_TIMEOUT: '15000' },
  secretValues: ['sntrys_live_secret_value'],
  grants: ['mcp__sentry_billing', ...extra.map((n) => `mcp__${n}`)],
  disallowedTools: [],
  copies: [{ name: 'sentry_billing', setId: 'billing', setName: 'Billing', untested: true },
    ...extra.map((n) => ({ name: n, setId: 'shop', setName: 'Shop', untested: false }))],
  skipped: [], skippedTools: [], sets: [],
});
const INIT = (statuses) => ({ type: 'system', subtype: 'init', session_id: 'sess-2', parent_tool_use_id: null,
  mcp_servers: [{ name: 'worca', status: 'connected' }, ...Object.entries(statuses).map(([name, status]) => ({ name, status }))] });

test('MCP §9.2: both attempts (and the relay) carry the registry; the per-turn file lists copies after worca with refs only; the secret env reaches the agent spawn', async () => {
  await checkRows([
    { name: 'MCP §9.2: both attempts carry the registry; the per-turn file lists the copies after worca with refs only', run: async () => {
      const s = seed();
      const seen = [];
      let cfgText = null;
      const { turn } = makeTurn(s, { mcp: MCP(), resumeSessionId: 'dead-sid' }, {
        runClaudeImpl: async (opts) => {
          cfgText ??= readFileSync(opts.mcpConfigPath, 'utf8');
          seen.push(opts);
          if (seen.length === 1) {
            push(opts.onEvent, RESULT({ subtype: 'error_during_execution', is_error: true, total_cost_usd: 0, errors: ['No conversation found with session ID: dead-sid'] }));
            throw new Error('claude exited with code 1: No conversation found with session ID: dead-sid');
          }
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      assert.equal(seen.length, 2, 'the resume-fallback retry ran');
      for (const o of seen) {
        assert.deepEqual(o.spawnEnv, { MCPSECRET_2EB4507A: 'sntrys_live_secret_value', MCP_TIMEOUT: '15000' });
        assert.deepEqual(o.redactValues, ['sntrys_live_secret_value']);
        assert.ok(o.tools.includes('ToolSearch'));
        assert.deepEqual(o.mcpServerGrants, ['mcp__worca', 'mcp__sentry_billing']);
      }
      const cfg = JSON.parse(cfgText);
      assert.deepEqual(Object.keys(cfg.mcpServers), ['worca', 'sentry_billing']);
      assert.equal(cfg.mcpServers.worca.alwaysLoad, true);
      assert.ok(cfgText.includes('${MCPSECRET_2EB4507A}'), 'refs only');
      assert.ok(!cfgText.includes('sntrys_live_secret_value'), 'the per-turn file never holds a secret value');
    } },
    { name: 'MCP §9.2 relay: the copies ride the relay config and the secret env reaches the agent spawn (sudo -n -E keeps it)', run: async () => {
      const s = seed();
      let cfg = null; let o = null;
      const { turn } = makeTurn(s, { mcp: MCP() }, {
        agentRelay: () => ({ url: 'http://127.0.0.1:1/api/ask/relay', token: 't', dispose: () => {} }),
        runClaudeImpl: async (opts) => { cfg = JSON.parse(readFileSync(opts.mcpConfigPath, 'utf8')); o = opts; throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' }); },
      });
      await turn.run();
      assert.equal(o.asAgent, true);
      assert.equal(o.spawnEnv.MCPSECRET_2EB4507A, 'sntrys_live_secret_value');
      assert.deepEqual(Object.keys(cfg.mcpServers), ['worca', 'sentry_billing']);
      assert.ok(cfg.mcpServers.worca.args.includes('--relay'));
    } },
  ]);
});

test('MCP §10 Ask notices: one muted line per copy the CLI could not start (once per turn), and one for a too-long tool name', async () => {
  await checkRows([
    { name: 'MCP §10 Ask: one muted line per copy the CLI could not start (failed, needs-auth, disabled, absent); connected/pending and an init without a list say nothing; once per turn across the retry', run: async () => {
      const s = seed();
      let n = 0;
      // linear: absent from init; odd: a status that is no own key of the table (never a prototype lookup) says nothing
      const statuses = { sentry_billing: 'failed', jira: 'connected', pg: 'needs-auth', gh: 'disabled', slow: 'pending', odd: 'toString' };
      const { turn } = makeTurn(s, { mcp: MCP(['jira', 'pg', 'gh', 'linear', 'slow', 'odd']), resumeSessionId: 'dead-sid' }, {
        runClaudeImpl: async (opts) => {
          n += 1;
          // What runClaude delivers: the adapter's normalized events, one normalizer per spawn.
          const emit = normalizingOnEvent(opts.onEvent);
          push(emit, { ...INIT({}), parent_tool_use_id: 'toolu_sub' });   // a sub-agent's init is not the turn's
          push(emit, { type: 'system', subtype: 'init', session_id: 'sess-2', parent_tool_use_id: null });   // no list: says nothing (never "absent")
          push(emit, INIT(statuses));
          push(emit, INIT(statuses));                     // a second init in the same attempt adds nothing
          if (n === 1) {
            push(emit, RESULT({ subtype: 'error_during_execution', is_error: true, total_cost_usd: 0, errors: ['No conversation found with session ID: dead-sid'] }));
            throw new Error('claude exited with code 1: No conversation found with session ID: dead-sid');
          }
          push(emit, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      await turn.run();
      assert.equal(n, 2);
      const lines = getMessage(s.asst.id).blocks.filter((b) => b.kind === 'notice' && / unavailable \(/.test(b.text)).map((b) => b.text);
      assert.deepEqual(lines.sort(), [
        'gh unavailable (disabled by your Claude Code settings)',
        'linear unavailable (blocked by managed MCP policy)',
        'pg unavailable (needs-auth)',
        'sentry_billing unavailable (failed)',
      ]);
    } },
    { name: 'MCP §10 Ask: a 400 on a too-long tool name becomes one muted line naming the untested copies and their sets', run: async () => {
      const s = seed();
      const tooLong = async () => {
        throw Object.assign(new Error('claude exited with code 1: API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"tools.12.custom.name: String should have at most 128 characters"}}'), { errorClass: 'api' });
      };
      const { turn } = makeTurn(s, { mcp: MCP(['jira_shop']) }, { runClaudeImpl: tooLong });
      await turn.run();
      const lines = (id) => getMessage(id).blocks.filter((b) => b.kind === 'notice' && /too long for this model/.test(b.text)).map((b) => b.text);
      assert.deepEqual(lines(s.asst.id), ['an MCP tool name is too long for this model — Test the servers in Billing (sentry_billing)']);
      const tested = seed();
      const allTested = MCP(['jira_shop']);
      allTested.copies[0].untested = false;
      await makeTurn(tested, { mcp: allTested }, { runClaudeImpl: tooLong }).turn.run();
      assert.deepEqual(lines(tested.asst.id), ['an MCP tool name is too long for this model — Test the servers in Billing, Shop'], 'none untested ⇒ every copy\'s set');
      const other = seed();
      // another 400 in the same "at most 128" words, about a message instead of a tool name
      const plain = makeTurn(other, { mcp: MCP() }, { runClaudeImpl: async () => { throw Object.assign(new Error('claude exited with code 1: API Error: 400 {"message":"messages.3.content.0.text: String should have at most 128 characters"}'), { errorClass: 'api' }); } }).turn;
      await plain.run();
      assert.ok(!getMessage(other.asst.id).blocks.some((b) => b.kind === 'notice' && /too long/.test(b.text)), 'any other failure adds nothing');
    } },
  ]);
});

test('MCP §9.1 D17: a worktree change ends with the join notice; no change no resolve; a failing or hung notice is bounded and never breaks the turn', { timeout: 10000 }, async () => {
  await checkRows([
    { name: 'MCP §9.1 D17: a turn that changed a worktree ends with the join notice the server computes (flagged mcp for the picker link); no change, no resolve', run: async () => {
      const text = "shop's MCP servers (sentry_shop, postgres-ro_shop) join from the next message";
      const opened = (opts) => {
        toolUse(opts.onEvent, 'm1', 'toolu_1', 'mcp__worca__open_worktree', { projectKey: 'shop-00000002', ref: 'main' });
        toolResult(opts.onEvent, 'toolu_1', '{}');
        push(opts.onEvent, RESULT());
        return { text: '', exitCode: 0 };
      };
      const s = seed();
      await makeTurn(s, { mcp: MCP() }, { mcpJoinNotice: async () => text, runClaudeImpl: opened }).turn.run();
      assert.deepEqual(getMessage(s.asst.id).blocks.filter((b) => b.kind === 'notice'), [{ kind: 'notice', text, mcp: true }]);
      let asked = 0;
      await makeTurn(seed(), { mcp: MCP() }, {
        mcpJoinNotice: async () => { asked += 1; return text; },
        runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: '', exitCode: 0 }; },
      }).turn.run();
      assert.equal(asked, 0, 'no worktree change: no second resolve at turn end');
      const quiet = seed();
      const q = makeTurn(quiet, {}, {
        mcpJoinNotice: async () => { throw new Error('store unreadable'); },
        runClaudeImpl: opened,
      }).turn;
      assert.equal((await q.run()).status, 'done', 'a failing notice never breaks the turn');
      assert.ok(!(getMessage(quiet.asst.id).blocks || []).some((b) => b.kind === 'notice'));
    } },
    { name: 'MCP §9.1 D17: a hung join notice is bounded — the turn still completes, without a notice', run: async () => {
      const s = seed();
      const { turn } = makeTurn(s, { mcp: MCP() }, {
        mcpJoinNotice: () => new Promise(() => {}), mcpJoinNoticeMs: 20,
        runClaudeImpl: (opts) => {
          toolUse(opts.onEvent, 'm1', 'toolu_1', 'mcp__worca__open_worktree', { projectKey: 'shop-00000002', ref: 'main' });
          toolResult(opts.onEvent, 'toolu_1', '{}');
          push(opts.onEvent, RESULT());
          return { text: '', exitCode: 0 };
        },
      });
      assert.equal((await turn.run()).status, 'done');
      assert.ok(!(getMessage(s.asst.id).blocks || []).some((b) => b.kind === 'notice'));
    } },
  ]);
});

test('MCP §15 global: a turn with copies writes only its per-turn MCP file — never ~/.claude.json or a .mcp.json', async () => {
  const writes = [];
  const fs = { mkdir: async () => {}, writeFile: async (p, d) => { writes.push({ p, d }); }, unlink: async () => {} };
  const { turn } = makeTurn(seed(), { mcp: MCP() }, { fs, runClaudeImpl: async (opts) => { push(opts.onEvent, RESULT()); return { text: '', exitCode: 0 }; } });
  await turn.run();
  assert.equal(writes.length, 1);
  assert.match(writes[0].p, /[\\/]tmp[\\/]ask[\\/]mcp-askm_[0-9a-f]{8}\.json$/);
  assert.ok(!writes.some((w) => /\.claude\.json$|\.mcp\.json$/.test(w.p)));
  assert.ok(!writes[0].d.includes('sntrys_live_secret_value'));
});

test('MCP §5.5.3: the persisted answer is redacted whole with the turn\'s registry values', async () => {
  const s = seed();
  const mcp = { ...MCP(), env: { MCPSECRET_2EB4507A: 'plainvalue9f3k2x7q' }, secretValues: ['plainvalue9f3k2x7q'] };   // no token shape: patterns miss it
  await makeTurn(s, { mcp }, {
    runClaudeImpl: async (opts) => {
      say(opts.onEvent, 'msg_1', 'we found plainvalue9f3k2x7q in the reply');
      push(opts.onEvent, RESULT());
      return { text: '', exitCode: 0 };
    },
  }).turn.run();
  const text = getMessage(s.asst.id).text;
  assert.ok(!text.includes('plainvalue9f3k2x7q'), 'the runner redacts per event; the persisted text is redacted whole here');
  assert.match(text, /\[redacted\]/);
});

// ── Agent mode (#574) ─────────────────────────────────────────────────────────────────────────────
test('agent mode: the bridge URL rides the mcp json, the token only spawnEnv; disposed when the turn ends', async () => {
  const s = seed();
  let raw = null; let spawnEnv = null; let note = null; const asked = []; let disposed = 0;
  const { turn } = makeTurn(s, { agentMode: true }, {
    commandBridge: (o) => { asked.push(o); return { url: 'http://127.0.0.1:4317/api/ask/commands', token: 'TOKEN-574-xyz', dispose: () => { disposed += 1; } }; },
    runClaudeImpl: async (opts) => {
      raw = readFileSync(opts.mcpConfigPath, 'utf8');
      spawnEnv = opts.spawnEnv; note = opts.appendSubagentSystemPrompt;
      throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
    },
  });
  await turn.run();
  assert.deepEqual(asked, [{ threadId: s.thread.id }]);
  assert.equal(JSON.parse(JSON.parse(raw).mcpServers.worca.env.WORCA_ASK_COMMANDS).url, 'http://127.0.0.1:4317/api/ask/commands');
  assert.ok(!raw.includes('TOKEN-574-xyz'), 'the token never lands on disk');
  assert.equal(spawnEnv.ASK_COMMAND_TOKEN, 'TOKEN-574-xyz');
  assert.match(note, /never call run_command or stop_command/);
  assert.equal(disposed, 1);
});

test('agent mode off, or relay mode: the bridge is never asked and the mcp json has no command key', async () => {
  for (const [over, deps] of [[{ agentMode: false }, {}],
    [{}, { agentRelay: () => ({ url: 'http://127.0.0.1:1/api/ask/relay', token: 'r', dispose() {} }) }]]) {
    const s = seed();
    let cfg = null; let called = 0;
    const { turn } = makeTurn(s, over, {
      ...deps,
      commandBridge: () => { called += 1; return { url: 'u', token: 't', dispose() {} }; },
      runClaudeImpl: async (opts) => {
        cfg = JSON.parse(readFileSync(opts.mcpConfigPath, 'utf8'));
        throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
      },
    });
    await turn.run();
    assert.equal(called, 0);
    assert.ok(!('WORCA_ASK_COMMANDS' in cfg.mcpServers.worca.env));
  }
});

test('run_command result mints one command card; an error result mints nothing', async () => {
  const s = seed();
  const runner = (frames) => async (opts) => {
    for (const [id, name, input, text, isError] of frames) {
      push(opts.onEvent, { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', content: [{ type: 'tool_use', id, name, input }] } });
      push(opts.onEvent, { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
    }
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    push(opts.onEvent, RESULT());
    return { text: '', exitCode: 0 };
  };
  const ok = JSON.stringify({ ok: true, blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', cwd: '/w/p', folder: 'p · main', warning: null });
  const { turn, frames } = makeTurn(s, {}, {
    runClaudeImpl: runner([
      ['toolu_1', 'mcp__worca__run_command', { command: 'npm test' }, ok, false],
      ['toolu_2', 'mcp__worca__run_command', { command: 'git push --force' }, 'error: run_command: blocked', true],
    ]),
  });
  await turn.run();
  const cards = getMessage(s.asst.id).blocks.filter((b) => b.kind === 'card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].state, 'command');
  assert.deepEqual(cards[0].card, { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'p · main', cwd: '/w/p', warning: null });
  assert.ok(frames.some((f) => f.type === 'ask-card' && f.block.card.type === 'command'));
});
